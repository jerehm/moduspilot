'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import ChatWindow from '@/components/chat/ChatWindow';
import ConversationList from '@/components/chat/ConversationList';
import { useConversations } from '@/hooks/useConversations';
import { useAuth } from '@/components/providers/AuthProvider';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useResizableSidebar } from '@/hooks/useResizableSidebar';
import { Tooltip } from '@/components/ui/Tooltip';
import PaywallModal from '@/components/chat/PaywallModal';
import { accountModelChoice, resolveModelChoice } from '@/lib/model-choice';
import { isPaidPlan } from '@/lib/plan';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { motion, AnimatePresence } from 'framer-motion';
import type { Message } from 'ai';

type Plan = 'free' | 'modus' | 'pilot' | 'group';

function ChatContent() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const isGuest = !uid;
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') ?? undefined;

  const { conversations, loading, createConversation, setConversationModel, saveMessages, renameConversation, togglePin, deleteConversation, restoreConversation } = useConversations(uid);
  const { settings, plan, loading: settingsLoading } = useUserSettings(user);
  // Conversation rail: same drag/collapse behaviour as the app sidebar. A chat
  // list has no icons to shrink to, so collapsed hides it behind a reopen tab.
  const convRail = useResizableSidebar({
    storageKey: 'chat-conversations', defaultWidth: 208, min: 180, max: 340, snap: 140, collapsedWidth: 0,
  });

  const [activeId, setActiveId] = useState<string | null>(null);
  // Draft = "New chat" clicked but nothing typed yet. No Firestore doc exists;
  // one is created lazily on the first message. Blocks the auto-select effect
  // so we don't snap back to the most-recent chat.
  // 🆕 OPENING /chat ALWAYS STARTS A NEW CHAT.
  // It used to auto-open the most recent conversation, so arriving at the chat
  // dropped you into the middle of something old — usually yesterday's briefing
  // — instead of an empty composer. Starting in draft suppresses that effect
  // (it is gated on !isDraft); picking a conversation in the list clears the
  // draft as before. No Firestore doc is created until the first message, so
  // this does not leave empty "New chat" ghosts behind.
  const [isDraft, setIsDraft] = useState(true);
  const [editingHeader, setEditingHeader] = useState(false);
  const [headerTitle, setHeaderTitle] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);

  // Whether the plan read has come back at all. 'free' above is a placeholder, not
  // an answer, and treating it as one is what showed the paywall to paying users.
  const planLoaded = !settingsLoading;
  const defaultModelChoice = accountModelChoice(settings.modelSettings, plan);
  const [connectedToast, setConnectedToast] = useState('');
  const [modelSaveError, setModelSaveError] = useState('');
  const [failedSaves, setFailedSaves] = useState<Record<string, () => Promise<void>>>({});
  const viewEpoch = useRef(0);
  // Mobile-only: the conversation list is a slide-in drawer on narrow screens
  // (on desktop it's the always-visible left column).
  const [convDrawerOpen, setConvDrawerOpen] = useState(false);
  const pendingConvIdRef = useRef<string | null>(null);
  const [inFlightMessages, setInFlightMessages] = useState<Message[]>([]);
  // A model the user switched to before the chat had a Firestore doc (still a
  // draft). It rides here across the draft→real remount so createConversation
  // can persist it onto the new doc; cleared once the doc exists.
  const draftModelRef = useRef<string | null>(null);
  // A draft's workspace id. A chat has no doc (so no id) until its first turn
  // finishes, but the model may write files on that turn; this id is carried
  // onto the doc at creation. createdWorkspaceRef bridges the moment after
  // creation before the snapshot carries the field.
  const [draftWorkspaceId, setDraftWorkspaceId] = useState<string>(() => crypto.randomUUID());
  const draftWorkspaceRef = useRef(draftWorkspaceId);
  useEffect(() => { draftWorkspaceRef.current = draftWorkspaceId; }, [draftWorkspaceId]);
  const [createdWorkspaces, setCreatedWorkspaces] = useState<Record<string, string>>({});

  // Show toast when returning from OAuth with ?connected= param
  useEffect(() => {
    const connected = searchParams.get('connected');
    if (!connected) return;
    const labels: Record<string, string> = { notion: 'Notion connected', slack: 'Slack connected', github: 'GitHub connected', google: 'Google connected' };
    setConnectedToast(labels[connected] ?? `${connected} connected`);
    window.history.replaceState({}, '', window.location.pathname);
    const t = setTimeout(() => setConnectedToast(''), 4000);
    return () => clearTimeout(t);
  }, [searchParams]);

  // Load active conversation from most recent on mount (but not while drafting a new chat)
  useEffect(() => {
    if (!loading && conversations.length > 0 && !activeId && !isDraft) {
      setActiveId(conversations[0].id);
    }
  }, [loading, conversations, activeId, isDraft]);

  // Once a pending new conversation appears in Firestore (with messages), activate it
  useEffect(() => {
    const pending = pendingConvIdRef.current;
    if (pending && conversations.find(c => c.id === pending)) {
      setActiveId(pending);
      pendingConvIdRef.current = null;
    }
  }, [conversations]);

  // Plan state is live; the API remains authoritative for access.
  const isPaid = isPaidPlan(plan);
  const hasAccess = isPaid;
  // Used for upsell surfaces (the conversation rail), NOT to gate the composer.
  const needsSubscription = planLoaded && !hasAccess && !isGuest;

  // 🚨 WHAT IS ALLOWED TO SILENCE THE COMPOSER, and why it is not `needsSubscription`.
  //
  // Two separate bugs lived on that expression, both reported by Jeremiah:
  //
  //  1. `plan` initialises to 'free', so before the Firestore read resolved,
  //     hasAccess was false and a PAYING customer was shown "You've used your free
  //     messages" with no composer, on every single mount. Three states (loading /
  //     entitled / not entitled) were collapsed into two, and the unknown one
  //     rendered as the worst one.
  //  2. Since the free tier shipped 2026-08-04, "not paid" no longer means "no
  //     access" — lib/plan.ts says so in as many words. A brand-new free signup is
  //     not paid, so they got the wall INSTEAD of a composer
  //     and could never spend the 10 free messages the server was happy to serve.
  //     The free tier existed to remove exactly that wall and never worked in the UI.
  //
  // So the client no longer PREDICTS exhaustion. The server owns that decision and
  // already reports it precisely (`free_limit_reached`, `subscription_required`);
  // the composer only locks once we have actually been told. Guests are the one
  // case we can still decide locally, since they have no account to spend from.
  const [outOfMessages, setOutOfMessages] = useState(false);
  // Paying (or resubscribing) clears the wall without a reload.
  useEffect(() => { if (hasAccess) setOutOfMessages(false); }, [hasAccess]);

  const activeConversation = conversations.find(c => c.id === activeId) ?? null;

  // Clear in-flight messages once Firestore has confirmed the conversation has messages
  useEffect(() => {
    if (activeConversation?.messages?.length && inFlightMessages.length) {
      setInFlightMessages([]);
    }
  }, [activeConversation?.messages?.length, inFlightMessages.length]);

  const handleNew = useCallback(() => {
    viewEpoch.current++;
    // Open an empty draft — no Firestore doc until the first message is sent.
    // Prevents the pile of empty "New chat" ghosts.
    setInFlightMessages([]); // never inherit a previous chat's in-flight messages
    pendingConvIdRef.current = null;
    draftModelRef.current = null; // a new draft starts from the account default
    setDraftWorkspaceId(crypto.randomUUID());
    setActiveId(null);
    setIsDraft(true);
    setConvDrawerOpen(false);
  }, []);

  const handleSelect = useCallback((id: string) => {
    viewEpoch.current++;
    setInFlightMessages([]);
    draftModelRef.current = null; // opening an existing thread: use its own saved model
    setIsDraft(false);
    setActiveId(id);
    setConvDrawerOpen(false);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    await deleteConversation(id);
    if (activeId === id) {
      const remaining = conversations.filter(c => c.id !== id);
      setActiveId(remaining[0]?.id ?? null);
    }
  }, [deleteConversation, activeId, conversations]);

  const handleRestore = useCallback(async (id: string) => {
    await restoreConversation(id);
    setShowDeleted(false);
    setIsDraft(false);
    setActiveId(id);
    setConvDrawerOpen(false);
  }, [restoreConversation]);

  // Asks the model to name the conversation from its first exchange, then
  // renames it in place. Never throws into the send path.
  const generateTitle = useCallback(async (convId: string, messages: Message[]) => {
    try {
      const firstUser = messages.find(m => m.role === 'user');
      const firstAssistant = messages.find(m => m.role === 'assistant');
      const userMessage = typeof firstUser?.content === 'string' ? firstUser.content : '';
      if (!userMessage.trim()) return;
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch('/api/chat/title', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage,
          assistantMessage: typeof firstAssistant?.content === 'string' ? firstAssistant.content : '',
        }),
      });
      if (!res.ok) return;
      const data = await res.json() as { title?: string | null };
      if (data.title) await renameConversation(convId, data.title);
    } catch {
      // Keep the provisional title.
    }
  }, [renameConversation]);

  const handleMessagesChange = useCallback(async (messages: Message[], title?: string) => {
    if (isGuest || !uid) return;
    let convId = activeId ?? pendingConvIdRef.current;
    const epoch = viewEpoch.current;
    const chosenModel = draftModelRef.current ?? defaultModelChoice;
    const draftSaveId = crypto.randomUUID();
    let persisting = false;
    // Retry captures the original conversation, even after the user switches.
    const persist = async () => {
      if (persisting) return;
      persisting = true;
      try {
        if (!convId) {
          const wsForDraft = draftWorkspaceRef.current;
          convId = await createConversation(chosenModel, wsForDraft);
          const createdId = convId;
          setCreatedWorkspaces(prev => ({ ...prev, [createdId]: wsForDraft }));
          if (viewEpoch.current === epoch) {
            pendingConvIdRef.current = convId;
            setIsDraft(false);
            setActiveId(convId);
            setInFlightMessages(messages);
          }
        }
        await saveMessages(convId, messages, title);
        setFailedSaves(previous => {
          const next = { ...previous };
          delete next[draftSaveId];
          if (convId) delete next[convId];
          return next;
        });
        if (title) void generateTitle(convId, messages);
      } catch {
        setFailedSaves(previous => ({ ...previous, [convId ?? draftSaveId]: persist }));
      } finally { persisting = false; }
    };
    await persist();
  }, [isGuest, uid, activeId, createConversation, saveMessages, generateTitle, defaultModelChoice]);

  // Access is server-authoritative: the API returns subscription_required (402)
  // and the composer opens the paywall via onShowPaywall. Nothing to track here.
  const handleUserMessage = useCallback(() => {}, []);

  // A per-thread switch: persist onto the conversation doc, or stash on the draft
  // ref if the doc does not exist yet (it lands via createConversation). The
  // account default changes only through the separate default action.
  const handleThreadModelChange = useCallback((v: string) => {
    const convId = activeId ?? pendingConvIdRef.current;
    setModelSaveError('');
    if (convId) void setConversationModel(convId, v).catch(() => setModelSaveError('Could not save the model choice. Select it again to retry.'));
    else draftModelRef.current = v;
  }, [activeId, setConversationModel]);

  return (
    <div className="flex h-full overflow-hidden relative">
      {Object.keys(failedSaves).length > 0 && <div role="alert" className="absolute top-2 left-1/2 -translate-x-1/2 z-50 max-w-lg rounded-xl border border-border bg-panel p-3 text-sm text-text shadow-lg">
        Some conversation changes could not be saved. <button className="text-brand underline" onClick={() => { void Promise.all(Object.values(failedSaves).map(retry => retry())); }}>Retry saving</button>
      </div>}
      {/* OAuth connected toast */}
      {connectedToast && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-emerald-500 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-lg pointer-events-none">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0">
            <path d="M2 6l3 3 5-5" />
          </svg>
          {connectedToast}
        </div>
      )}
      {/* Conversation sidebar — signed in only. Desktop: always-visible left
          column. Mobile: hidden here and opened as a drawer (below) via the
          header button, so the chat itself gets the full narrow screen. */}
      {!isGuest && (
        <div
          className={`hidden md:block shrink-0 h-full relative ${convRail.collapsed ? '' : 'border-r border-border'} ${convRail.dragging ? '' : 'transition-[width] duration-200 ease-out'}`}
          style={{ width: convRail.width }}
        >
          {!convRail.collapsed && (
            <ConversationPanel
              uid={uid} showDeleted={showDeleted} setShowDeleted={setShowDeleted}
              conversations={conversations} activeId={activeId}
              onSelect={handleSelect} onNew={handleNew} onDelete={handleDelete}
              onRename={renameConversation} onTogglePin={togglePin} onRestore={handleRestore}
              restoreConversation={restoreConversation} user={user}
              needsSubscription={needsSubscription} setShowPaywall={setShowPaywall}
              isPaid={isPaid} plan={plan}
              onCollapse={convRail.toggle}
            />
          )}
          {/* Collapsed width is 0, so a handle here would sit on top of the app
              sidebar's own handle. Reopen via the tab instead. */}
          {!convRail.collapsed && (
            <div
              className="absolute inset-y-0 -right-0.5 w-1.5 cursor-col-resize hover-surface-tint0 active:bg-brand/60 transition-colors z-20"
              onMouseDown={convRail.startDrag}
            />
          )}
        </div>
      )}

      {/* Reopen tab — the only way back when the rail is fully collapsed */}
      {!isGuest && convRail.collapsed && (
        <div className="hidden md:flex shrink-0 items-start pt-3 pl-2">
          <Tooltip label="Show chats" side="right">
            <button
              onClick={convRail.toggle}
              aria-label="Show chats"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-text hover:bg-panel transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" />
              </svg>
            </button>
          </Tooltip>
        </div>
      )}

      {/* Mobile conversation drawer */}
      {!isGuest && (
        <AnimatePresence>
          {convDrawerOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-40 bg-black/50 md:hidden"
                onClick={() => setConvDrawerOpen(false)}
              />
              <motion.div
                initial={{ x: -288 }} animate={{ x: 0 }} exit={{ x: -288 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="fixed inset-y-0 left-0 z-50 w-72 max-w-[80vw] bg-bg border-r border-border md:hidden"
              >
                <ConversationPanel
                  uid={uid} showDeleted={showDeleted} setShowDeleted={setShowDeleted}
                  conversations={conversations} activeId={activeId}
                  onSelect={handleSelect} onNew={handleNew} onDelete={handleDelete}
                  onRename={renameConversation} onTogglePin={togglePin} onRestore={handleRestore}
                  restoreConversation={restoreConversation} user={user}
                  needsSubscription={needsSubscription} setShowPaywall={setShowPaywall}
                  isPaid={isPaid} plan={plan}
                />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      )}

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* No border-b: the transcript below already reads as its own region,
            and a full-width rule under a single line of text was the heaviest
            thing on the screen. */}
        <div className="shrink-0">
        {/* Full width, not max-w-6xl mx-auto — centring the header meant the
            conversation title floated in the middle of the pane instead of
            sitting against the sidebar it belongs to. */}
        <div className="w-full px-4 md:px-6 py-3 flex items-center gap-3">
          {/* Mobile: open the conversation drawer (desktop has the sidebar) */}
          {!isGuest && (
            <button
              onClick={() => setConvDrawerOpen(true)}
              className="md:hidden w-8 h-8 -ml-1 flex items-center justify-center text-muted hover:text-text transition-colors rounded-lg hover:bg-panel shrink-0"
              aria-label="Open chats"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
            </button>
          )}
          {isGuest && (
            <button onClick={handleNew} className="text-xs bg-panel border border-border px-3 py-1.5 rounded-lg text-muted hover:text-text transition-colors">
              + New chat
            </button>
          )}
          {!isGuest && activeConversation && editingHeader ? (
            <input
              autoFocus
              value={headerTitle}
              onChange={e => setHeaderTitle(e.target.value)}
              onBlur={() => { renameConversation(activeConversation.id, headerTitle); setEditingHeader(false); }}
              onKeyDown={e => {
                if (e.key === 'Enter') { renameConversation(activeConversation.id, headerTitle); setEditingHeader(false); }
                if (e.key === 'Escape') setEditingHeader(false);
              }}
              className="flex-1 text-sm font-semibold text-text bg-transparent border-b border-brand outline-none min-w-0"
            />
          ) : (
            <h1
              className={`text-sm font-semibold text-text truncate ${!isGuest && activeConversation ? 'cursor-pointer hover:text-brand transition-colors' : ''}`}
              title={!isGuest && activeConversation ? 'Click to rename' : undefined}
              onClick={() => {
                if (!isGuest && activeConversation) {
                  setHeaderTitle(activeConversation.title);
                  setEditingHeader(true);
                }
              }}
            >
              {activeConversation?.title ?? 'Modus Pilot'}
            </h1>
          )}
          {isGuest && (
            <span className="ml-auto text-xs text-muted shrink-0">
              <a href="/login" className="text-brand hover:underline">Sign in</a> to save
            </span>
          )}
        </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          {modelSaveError && <p role="alert" className="px-4 py-2 text-sm text-red-500">{modelSaveError}</p>}
          {/* Wait until activeId is settled so ChatWindow doesn't remount with a key change */}
          {!isGuest && (settingsLoading || (!isDraft && (loading || (conversations.length > 0 && !activeId)))) ? (
            // Mirror ChatWindow's exact layout (centered content above a
            // composer-shaped footer) so the spinner sits precisely where the
            // greeting will — the loading→loaded hand-off has zero vertical jump.
            <div className="flex flex-col h-full">
              <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3">
                <div className="w-10 h-10 rounded-2xl surface-tint border border-tint flex items-center justify-center">
                  <div className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                </div>
                <p className="text-xs text-muted">Loading your chat…</p>
              </div>
              <div className="px-4 md:px-8 py-4 border-t border-border shrink-0" aria-hidden>
                <div className="flex items-center gap-3 bg-panel border border-border rounded-2xl px-4 py-3">
                  <span className="w-5 h-5 rounded bg-muted/10 shrink-0" />
                  <span className="flex-1 text-sm text-muted/30">Talk to Modus…</span>
                  <span className="w-8 h-8 rounded-lg bg-brand/30 shrink-0" />
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="inline-block h-[26px] w-24 rounded-lg border border-border" />
                  <span className="text-muted/40 text-xs">Enter to send · Shift+Enter for new line</span>
                </div>
              </div>
            </div>
          ) : (
          <ChatWindow
            key={activeId ?? (isGuest ? 'guest' : `draft:${viewEpoch.current}`)}
            conversationId={activeId}
            workspaceId={
              activeConversation?.workspaceId
              ?? (activeId ? createdWorkspaces[activeId] ?? activeId : draftWorkspaceId)
            }
            initialMessages={activeConversation?.messages?.length ? activeConversation.messages : inFlightMessages}
            initialInput={initialQuery}
            onMessagesChange={isGuest ? undefined : handleMessagesChange}
            onUserMessage={handleUserMessage}
            isGuest={isGuest}
            isAtLimit={outOfMessages}
            onShowPaywall={() => setShowPaywall(true)}
            onExhausted={() => setOutOfMessages(true)}
            personalContext={settings.personalContext}
            responseStyle={settings.responseStyle}
            customStyle={settings.customStyle}
            presets={settings.presets}
            briefingHour={settings.briefingHour}
            briefingTimezone={settings.briefingTimezone}
            plan={plan}
            initialModelChoice={resolveModelChoice(activeConversation?.modelChoice ?? draftModelRef.current ?? defaultModelChoice, plan)}
            onThreadModelChange={handleThreadModelChange}
          />
          )}
        </div>
      </div>

      {showPaywall && (
        <PaywallModal onClose={() => setShowPaywall(false)} />
      )}
    </div>
  );
}

// The conversation list column, shared by the desktop sidebar and the mobile
// drawer so both stay in sync. The caller supplies the outer width/border via
// its wrapper; this owns the internal flex-column layout (list + pinned footer).
function ConversationPanel({
  uid, showDeleted, setShowDeleted, conversations, activeId,
  onSelect, onNew, onDelete, onRename, onTogglePin, onRestore, restoreConversation, user,
  needsSubscription, setShowPaywall, isPaid, plan, onCollapse,
}: {
  uid: string | null;
  onCollapse?: () => void;
  showDeleted: boolean;
  setShowDeleted: React.Dispatch<React.SetStateAction<boolean>>;
  conversations: ReturnType<typeof useConversations>['conversations'];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onRestore: (id: string) => void;
  restoreConversation: (id: string) => Promise<void>;
  user: ReturnType<typeof useAuth>['user'];
  needsSubscription: boolean;
  setShowPaywall: (v: boolean) => void;
  isPaid: boolean;
  plan: Plan;
}) {
  return (
    <div className="flex flex-col h-full py-4">
      <div className="px-3 mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted uppercase tracking-wider">Chats</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowDeleted(s => !s)}
            className="text-xs text-muted hover:text-text transition-colors"
          >
            {showDeleted ? 'Active' : 'Trash'}
          </button>
          {onCollapse && (
            <Tooltip label="Hide chats" side="right">
              <button
                onClick={onCollapse}
                aria-label="Hide chats"
                className="w-6 h-6 hidden md:flex items-center justify-center rounded-md text-muted/60 hover:text-text hover:bg-panel transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" />
                </svg>
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {showDeleted ? (
        <DeletedList uid={uid} onRestore={onRestore} restoreFn={restoreConversation} />
      ) : (
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          onSelect={onSelect}
          onNew={onNew}
          onDelete={onDelete}
          onRename={onRename}
          onTogglePin={onTogglePin}
          user={user}
        />
      )}

      {/* Free plan upgrade option */}
      {needsSubscription && (
        <div className="px-3 pt-3 border-t border-border mt-auto">
          <div className="flex justify-between text-xs text-muted mb-1">
            <span>Free plan</span>
            <button onClick={() => setShowPaywall(true)} className="text-brand hover:underline">Upgrade</button>
          </div>
          <p className="text-[11px] text-muted/70 leading-snug">Continue with the Free plan or upgrade for more access.</p>
        </div>
      )}

      {isPaid && (
        <div className="px-3 pt-3 border-t border-border mt-auto">
          <p className="text-xs text-brand font-semibold uppercase tracking-wider">{plan === 'pilot' ? 'Pilot' : 'Modus'}</p>
        </div>
      )}
    </div>
  );
}

function DeletedList({ uid, onRestore, restoreFn }: {
  uid: string | null;
  onRestore: (id: string) => void;
  restoreFn: (id: string) => Promise<void>;
}) {
  const [deleted, setDeleted] = useState<Array<{ id: string; title: string }>>([]);

  useEffect(() => {
    if (!uid) return;
    let unsub: (() => void) | undefined;
    import('firebase/firestore').then(({ collection, query, where, orderBy, onSnapshot }) => {
      const q = query(
        collection(db, 'users', uid, 'conversations'),
        where('deleted', '==', true),
        orderBy('updatedAt', 'desc'),
      );
      unsub = onSnapshot(q, snap => {
        setDeleted(snap.docs.map(d => ({ id: d.id, title: d.data().title || 'Untitled' })));
      });
    });
    return () => unsub?.();
  }, [uid]);

  if (deleted.length === 0) {
    return <p className="text-xs text-muted text-center py-6 px-3">No deleted chats.</p>;
  }

  return (
    <div className="flex-1 overflow-y-auto space-y-0.5 px-2">
      {deleted.map(d => (
        <div key={d.id} className="flex items-center gap-2 px-3 py-2 rounded-lg group">
          <span className="flex-1 text-sm text-muted truncate">{d.title}</span>
          <button
            onClick={async () => { await restoreFn(d.id); onRestore(d.id); }}
            className="text-xs text-brand opacity-0 group-hover:opacity-100 transition-all"
          >
            Restore
          </button>
        </div>
      ))}
    </div>
  );
}

export default function ChatPage() {
  const { user } = useAuth();
  return <ChatContent key={user?.uid ?? 'guest'} />;
}
