import {
  collection, query, orderBy, onSnapshot,
  addDoc, updateDoc, setDoc, getDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';

/**
 * Chat persistence — same `users/{uid}/conversations` schema as the web app, so
 * conversations sync across web and iOS. Messages are stored as
 * { id, role, content }; briefing/check-in docs in the same collection are
 * filtered out of the chat history.
 */

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Server annotations (model chip, tool records). Web reads and writes the
   *  same field, so dropping it here erased them whenever a chat was continued
   *  on the phone. */
  annotations?: unknown[];
}

/**
 * A proactively-surfaced conversation: MODUS started it on its own (inbox triage
 * drafts a reply, relationship-nurture suggests reconnecting). The Inngest jobs
 * tag the conversation doc with `inboxTriage:true` / `relationshipNudge:true`.
 */
export type ProactiveKind = 'inboxTriage' | 'relationshipNudge';

function readProactive(data: Record<string, unknown> | undefined): ProactiveKind | undefined {
  if (data?.inboxTriage === true) return 'inboxTriage';
  if (data?.relationshipNudge === true) return 'relationshipNudge';
  return undefined;
}

export interface ConvSummary {
  id: string;
  title: string;
  updatedAt: Date;
  proactive?: ProactiveKind;
}

export function subscribeConversations(uid: string, cb: (convs: ConvSummary[]) => void) {
  const q = query(collection(db, 'users', uid, 'conversations'), orderBy('updatedAt', 'desc'));
  return onSnapshot(
    q,
    snap => {
      cb(
        snap.docs
          .filter(d => {
            const data = d.data();
            // Hide empty ghost chats (0 messages) — conversations are created
            // lazily on the first message, so an empty one is a stale doc.
            const hasMessages = Array.isArray(data.messages) && data.messages.length > 0;
            return data.deleted !== true && data.briefing !== true && data.checkin !== true && hasMessages;
          })
          .map(d => ({
            id: d.id,
            title: d.data().title || 'New chat',
            updatedAt: d.data().updatedAt?.toDate?.() ?? d.data().createdAt?.toDate?.() ?? new Date(),
            proactive: readProactive(d.data()),
          })),
      );
    },
    () => cb([]),
  );
}

export async function createConversation(uid: string, title: string): Promise<string> {
  const ref = await addDoc(collection(db, 'users', uid, 'conversations'), {
    title: title || 'New chat',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    deleted: false,
    messages: [],
  });
  return ref.id;
}

export async function saveMessages(
  uid: string,
  convId: string,
  messages: StoredMessage[],
  title?: string,
): Promise<void> {
  const update: Record<string, unknown> = {
    messages: messages.map(m => (Array.isArray(m.annotations) && m.annotations.length
      ? { id: m.id, role: m.role, content: m.content, annotations: m.annotations }
      : { id: m.id, role: m.role, content: m.content })),
    updatedAt: serverTimestamp(),
  };
  if (title) update.title = title;
  await updateDoc(doc(db, 'users', uid, 'conversations', convId), update);
}

/**
 * Ensure a deterministic scoped conversation exists (id `goal-{id}` /
 * `project-{id}`, matching web so the thread syncs across devices). Creates the
 * shell if missing, otherwise just refreshes title/links; returns any existing
 * messages so the chat can seed from prior history.
 */
export async function ensureScopedConversation(
  uid: string,
  convId: string,
  fields: { title: string; goalId?: string; projectId?: string; taskId?: string },
): Promise<StoredMessage[]> {
  const ref = doc(db, 'users', uid, 'conversations', convId);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await setDoc(ref, { ...fields, deleted: false }, { merge: true });
    return (snap.data()?.messages ?? []) as StoredMessage[];
  }
  await setDoc(ref, {
    ...fields,
    messages: [],
    deleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return [];
}

export async function loadConversation(
  uid: string,
  convId: string,
): Promise<{ messages: StoredMessage[]; proactive?: ProactiveKind }> {
  const snap = await getDoc(doc(db, 'users', uid, 'conversations', convId));
  const data = snap.data();
  return {
    messages: (data?.messages ?? []) as StoredMessage[],
    proactive: readProactive(data),
  };
}

export async function deleteConversation(uid: string, convId: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid, 'conversations', convId), { deleted: true });
}

/** Derive a conversation title from the first user message. */
export function deriveTitle(messages: StoredMessage[]): string {
  const first = messages.find(m => m.role === 'user');
  if (!first) return 'New chat';
  const t = first.content.trim().replace(/\s+/g, ' ');
  return t.length > 44 ? t.slice(0, 44) + '…' : t || 'New chat';
}
