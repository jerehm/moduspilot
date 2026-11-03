'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { Message } from 'ai';
import { auth } from '@/lib/firebase';
import { FREE_DEFAULT } from '@/lib/models';
import { extractTextContent } from '@/components/chat/MessageBubble';
import { chatErrorView } from '@/lib/chat/client-errors';

/**
 * Every chat send ends in an answer or a visible message. Never silence.
 *
 * ChatWindow (/chat) has had all of this for months. Goals, Projects and
 * Briefing each run their own useChat and had none of it (11-02 audit):
 *  - Briefing had no onError at all: any failure showed nothing.
 *  - None had a stall watchdog: a stream that went quiet spun forever.
 *  - None caught an empty answer, incl. the stream that completes with ZERO
 *    frames and never creates an assistant message.
 *  - The token was read once and baked into headers. Firebase tokens last an
 *    hour and onAuthStateChanged does not fire on refresh, so a tab open >1h
 *    401'd every send.
 *
 * Two halves because useChat sits between them: `useChatSafety` returns the
 * options to hand useChat (fetch, onFinish, onError), `useChatSafetyWatch` takes
 * what useChat returns. Logic mirrors ChatWindow.tsx (STALL_MS, the
 * streamCompletedRef zero-frame check, one retry on FREE_DEFAULT per turn).
 */
const STALL_MS = 45000;

/**
 * 🚨 useChat's experimental_throttle (added 11-02 for React #185) delays
 * `messages` but NOT `isLoading`. An answer that lands inside one 50ms window
 * (a short fast reply, or the whole body in one chunk) is still missing from
 * `messages` when isLoading flips false. Everything keyed on that edge then reads
 * a stale list: the empty check calls a real answer empty and retries, and the
 * save drops the tail of the answer (on a new /chat the window remounts from
 * that save, so the answer can vanish). Found by driving the UI with a faked
 * one-chunk reply. Fix: onFinish writes the final message in directly;
 * setMessages is not throttled, so it lands before the loading edge.
 */
export function upsertFinalMessage(prev: Message[], final: Message): Message[] {
  const text = extractTextContent(final.content);
  // An empty final message must stay out, the empty check handles that turn.
  if (text.trim() === '' && !(final.toolInvocations?.length)) return prev;
  const i = prev.findIndex(m => m.id === final.id);
  if (i === -1) return [...prev, final];
  if (prev[i].content === final.content) return prev;
  const next = prev.slice();
  next[i] = { ...prev[i], ...final };
  return next;
}

/** fetch that attaches a token fetched AT SEND TIME (cached unless expired). */
export const authedChatFetch: typeof fetch = async (input, init) => {
  const token = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => null) : null;
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
};

export function useChatSafety(setChatError: (e: string | null) => void) {
  const completedRef = useRef(false);
  const timedOutRef = useRef(false);
  const setMessagesRef = useRef<((fn: (prev: Message[]) => Message[]) => void) | null>(null);

  const onFinish = useCallback((message: Message) => {
    completedRef.current = true;
    setMessagesRef.current?.(prev => upsertFinalMessage(prev, message));
  }, []);
  const onError = useCallback((err: Error) => {
    // These pages have no paywall modal; the copy itself names the next step.
    setChatError(chatErrorView(err?.message).text);
  }, [setChatError]);

  return { fetch: authedChatFetch, onFinish, onError, completedRef, timedOutRef, setMessagesRef, setChatError };
}

type Safety = ReturnType<typeof useChatSafety>;

export function useChatSafetyWatch(
  safety: Safety,
  chat: {
    messages: Message[];
    isLoading: boolean;
    stop: () => void;
    reload: (opts?: { body?: Record<string, unknown> }) => unknown;
    setMessages: (fn: (prev: Message[]) => Message[]) => void;
  },
) {
  const { messages, isLoading, stop, reload, setMessages } = chat;
  const { completedRef, timedOutRef, setMessagesRef, setChatError } = safety;
  const retriedForRef = useRef(-1);
  const wasLoadingRef = useRef(false);

  useEffect(() => { setMessagesRef.current = setMessages; }, [setMessages, setMessagesRef]);

  // Inactivity watchdog: resets on every token (messages in deps).
  useEffect(() => {
    if (!isLoading) return;
    const t = setTimeout(() => {
      timedOutRef.current = true;
      stop();
      setChatError('The response stalled. Please try again, or switch models below.');
    }, STALL_MS);
    return () => clearTimeout(t);
  }, [isLoading, messages, stop, setChatError, timedOutRef]);

  // Empty-answer check, on the loading → done edge.
  useEffect(() => {
    const justFinished = wasLoadingRef.current && !isLoading;
    wasLoadingRef.current = isLoading;
    if (!justFinished) return;
    const completed = completedRef.current;
    completedRef.current = false;
    const watchdogSpoke = timedOutRef.current;
    timedOutRef.current = false;
    // Only a NORMAL completion is judged. Stop and error have their own message.
    if (!completed || watchdogSpoke) return;
    const last = messages[messages.length - 1];
    const text = last?.role === 'assistant' ? extractTextContent(last.content) : '';
    const hasBlock = /```(approval|draft_options|options|image|document|chart)/.test(text);
    if (hasBlock || text.trim() !== '') return;
    const turn = messages.filter(m => m.role === 'user').length;
    if (retriedForRef.current !== turn) {
      retriedForRef.current = turn;
      setChatError(null);
      // Same choice as ChatWindow: a same-model resend failed twice in a row on
      // 10-30, Flash Lite answered. Every plan can run it.
      void reload({ body: { modelChoice: FREE_DEFAULT } });
      return;
    }
    setChatError('The model returned an empty response. Try again, or switch models below.');
  }, [isLoading, messages, reload, setChatError, completedRef, timedOutRef]);
}
