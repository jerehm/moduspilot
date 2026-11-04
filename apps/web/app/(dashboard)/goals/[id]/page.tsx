'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  doc, onSnapshot, updateDoc, collection, query, where,
  addDoc, serverTimestamp, setDoc,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { useAuth } from '@/components/providers/AuthProvider';
import { Skeleton } from '@/components/ui/Skeleton';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useChat } from 'ai/react';
import { useChatSafety, useChatSafetyWatch } from '@/hooks/useChatSafety';
import { isAwaitingAssistantText } from '@/lib/chat/pending';
import type { Message } from 'ai';
import MessageBubble from '@/components/chat/MessageBubble';
import { useConversationModel } from '@/hooks/useConversationModel';
import ModelSwitcher from '@/components/chat/ModelSwitcher';
import { motion } from 'framer-motion';

type Timeframe = 'short' | 'long';
type GoalTab = 'tasks' | 'habits' | 'notes' | 'explore';
type NoteType = 'win' | 'blocker' | 'idea' | 'reflection';

interface Milestone { id: string; title: string; done: boolean; }
interface ProgressEntry { progress: number; date: string; }
interface Note { id: string; content: string; date: string; type?: NoteType; pinned?: boolean; }
interface GoalTask { id: string; title: string; done: boolean; }
interface HabitRef { id: string; title: string; streak: number; }

const NOTE_TYPES: Record<NoteType, { label: string; color: string; bg: string; border: string }> = {
  win:        { label: 'Win',        color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  blocker:    { label: 'Blocker',    color: 'text-red-400',     bg: 'bg-red-400/10',     border: 'border-red-400/30'     },
  idea:       { label: 'Idea',       color: 'text-amber-500',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30'   },
  reflection: { label: 'Reflection', color: 'text-brand',       bg: 'surface-tint',       border: 'border-tint'       },
};

interface Goal {
  id: string;
  title: string;
  description?: string;
  progress: number;
  status: 'active' | 'completed';
  dueDate?: string;
  timeframe?: Timeframe;
  createdAt?: string;
  milestones: Milestone[];
  progressLog: ProgressEntry[];
  linkedHabitIds: string[];
  notes: Note[];
}

interface GoalChat { id: string; title: string; messages: Message[]; createdAt: Date; modelChoice?: string; }

const TF_BADGE: Record<Timeframe, string> = {
  short: 'bg-blue-500/10 text-blue-500',
  long:  'surface-tint text-brand',
};
const TF_RING: Record<Timeframe, string> = {
  short: '#3B82F6',
  long:  '#7C3AED',
};
const TF_LABEL: Record<Timeframe, string> = {
  short: 'Short term',
  long:  'Long term',
};

const CHAT_CHIPS = [
  'Log a progress update',
  "What's blocking me?",
  'Help me plan next steps',
  'Reflect on this goal',
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDue(dueDate: string): string {
  const due = new Date(dueDate + 'T00:00:00');
  const now = new Date();
  const days = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const dateStr = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (days < 0) return `${dateStr} · ${Math.abs(days)}d overdue`;
  if (days === 0) return `${dateStr} · Due today`;
  if (days === 1) return `${dateStr} · Tomorrow`;
  return `${dateStr} · ${days}d left`;
}

function getMomentum(goal: Goal): { label: string; color: string } | null {
  if (!goal.dueDate || !goal.createdAt || goal.status !== 'active') return null;
  const created = new Date(goal.createdAt);
  const due = new Date(goal.dueDate + 'T00:00:00');
  const now = new Date();
  if (now > due) return { label: 'Past due', color: 'text-red-400' };
  const total = due.getTime() - created.getTime();
  if (total <= 0) return null;
  const expected = Math.min(100, ((now.getTime() - created.getTime()) / total) * 100);
  const gap = goal.progress - expected;
  if (gap >= 10)  return { label: 'Ahead of schedule', color: 'text-emerald-500' };
  if (gap >= -10) return { label: 'On track', color: 'text-brand' };
  if (gap >= -25) return { label: 'Slightly behind', color: 'text-amber-500' };
  return { label: 'At risk', color: 'text-red-400' };
}

function checkinMessage(goal: Goal): string {
  if (goal.progress === 0)   return `You're at 0% on "${goal.title}". What's the first move to get this started?`;
  if (goal.progress < 50)    return `You're ${goal.progress}% into "${goal.title}". What's moved since you set this, and what's next?`;
  if (goal.progress < 100)   return `You're ${goal.progress}% through "${goal.title}", solid. What's left to get this across the line?`;
  return `"${goal.title}" is done. Want to capture any lessons before closing it out?`;
}

function sanitizeMessages(msgs: Message[]): { id: string; role: string; content: string }[] {
  return msgs.map(m => ({
    id: m.id,
    role: m.role,
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  }));
}

// ── Ring ───────────────────────────────────────────────────────────────────────

function Ring({ pct, color, size = 52, stroke = 5 }: { pct: number; color: string; size?: number; stroke?: number }) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * circ;
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-border" />
      <motion.circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: circ - dash }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      />
    </svg>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

function GoalDetailPageContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { settings, plan, loading: settingsLoading } = useUserSettings(user);

  // In-chat model picker (mirrors the main + project chat) + error surface.
  const [chatError, setChatError] = useState<string | null>(null);

  const [goal, setGoal] = useState<Goal | null>(null);
  const [loading, setLoading] = useState(true);
  const [draftProgress, setDraftProgress] = useState(0);
  const [savingProgress, setSavingProgress] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);

  // Left column tab
  const [activeTab, setActiveTab] = useState<GoalTab>('tasks');

  // Milestones
  const [addingMilestone, setAddingMilestone] = useState(false);
  const [newMilestoneTitle, setNewMilestoneTitle] = useState('');
  const [planGenerating, setPlanGenerating] = useState(false);
  const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null);
  const [editingMilestoneTitle, setEditingMilestoneTitle] = useState('');
  const milestoneInputRef = useRef<HTMLInputElement>(null);
  const milestoneEditRef = useRef<HTMLInputElement>(null);

  // Tasks
  const [goalTasks, setGoalTasks] = useState<GoalTask[]>([]);
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [showDoneTasks, setShowDoneTasks] = useState(false);
  const taskInputRef = useRef<HTMLInputElement>(null);

  // Habits
  const [allHabits, setAllHabits] = useState<HabitRef[]>([]);
  const [showHabitPicker, setShowHabitPicker] = useState(false);
  const habitPickerRef = useRef<HTMLDivElement>(null);

  // Notes
  const [newNoteContent, setNewNoteContent] = useState('');
  const [selectedNoteType, setSelectedNoteType] = useState<NoteType | undefined>(undefined);
  const [noteFilter, setNoteFilter] = useState<'all' | NoteType>('all');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const editNoteRef = useRef<HTMLTextAreaElement>(null);

  // Suggestions (explore tab)
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const suggestionsFetchedRef = useRef(false);

  // Multi-chat
  const [allChats, setAllChats] = useState<GoalChat[]>([]);
  const [chatsLoaded, setChatsLoaded] = useState(false);
  const activeChatIdRef = useRef(`goal-${id}`);
  const [activeChatId, _setActiveChatId] = useState(`goal-${id}`);
  const setActiveChatId = (newId: string) => { activeChatIdRef.current = newId; _setActiveChatId(newId); };
  const { modelChoice, handleModelChange, modelError } = useConversationModel(user?.uid, activeChatId, allChats.find(chat => chat.id === activeChatId)?.modelChoice, settings.modelSettings, plan);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  async function saveRenameChat(chatId: string, title: string) {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid, 'conversations', chatId), { title: title.trim() || 'New chat' });
    setRenamingChatId(null);
  }

  const pendingMsgRef   = useRef<string | null>(null);
  const savedLengthRef  = useRef(0);
  const prevLoadingRef  = useRef(false);
  const seededRef       = useRef(false);
  const bottomRef       = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);

  // ── Effects ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    // onIdTokenChanged (not onAuthStateChanged) so the cached token refreshes
    // when Firebase rotates it (~1h) — otherwise the chat 401s after an hour open.
    const unsub = auth.onIdTokenChanged(async u => {
      setAuthToken(u ? await u.getIdToken() : null);
    });
    return unsub;
  }, []);

  // Load goal
  useEffect(() => {
    if (!user || !id) return;
    const unsub = onSnapshot(doc(db, 'users', user.uid, 'goals', id), snap => {
      if (!snap.exists()) { router.replace('/goals'); return; }
      const d = snap.data();
      setGoal({
        id: snap.id,
        title: d.title ?? 'Untitled',
        description: d.description,
        progress: d.progress ?? 0,
        status: d.status ?? 'active',
        dueDate: d.dueDate,
        timeframe: d.timeframe,
        createdAt: d.createdAt?.toDate?.()?.toISOString() ?? d.createdAt,
        milestones: d.milestones ?? [],
        progressLog: d.progressLog ?? [],
        linkedHabitIds: d.linkedHabitIds ?? [],
        notes: d.notes ?? [],
      });
      setDraftProgress(d.progress ?? 0);
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [user, id, router]);

  // Load goal tasks
  useEffect(() => {
    if (!user || !id) return;
    const q = query(collection(db, 'users', user.uid, 'tasks'), where('goalId', '==', id));
    const unsub = onSnapshot(q, snap => {
      setGoalTasks(
        snap.docs
          .filter(d => !d.data().deleted)
          .map(d => ({ id: d.id, title: d.data().title ?? '', done: d.data().done ?? false }))
          .sort((a, b) => Number(a.done) - Number(b.done))
      );
    });
    return unsub;
  }, [user, id]);

  // Load all habits for picker
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, 'users', user.uid, 'habits'), snap => {
      setAllHabits(snap.docs.map(d => ({
        id: d.id,
        title: d.data().title ?? '',
        streak: d.data().streak ?? 0,
      })));
    });
    return unsub;
  }, [user]);

  // Load chats
  useEffect(() => {
    if (!user || !id) return;
    const unsub = onSnapshot(
      query(collection(db, 'users', user.uid, 'conversations'), where('goalId', '==', id)),
      snap => {
        const chats: GoalChat[] = snap.docs
          .filter(d => !d.data().deleted)
          .map(d => ({
            id: d.id,
            title: d.data().title ?? 'Chat',
            messages: (d.data().messages as Message[]) ?? [],
            modelChoice: d.data().modelChoice,
            createdAt: d.data().createdAt?.toDate() ?? new Date(),
          }))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        setAllChats(chats);
        setChatsLoaded(true);
      },
      () => setChatsLoaded(true),
    );
    return unsub;
  }, [user, id]);

  // Load suggestions (only when explore tab is opened)
  useEffect(() => {
    if (activeTab !== 'explore' || !goal || suggestionsFetchedRef.current) return;
    suggestionsFetchedRef.current = true;
    setSuggestionsLoading(true);
    fetch('/api/goals/suggestions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ title: goal.title, description: goal.description, timeframe: goal.timeframe }),
    })
      .then(r => r.json())
      .then(data => { if (data.suggestions?.length) setSuggestions(data.suggestions); })
      .catch(() => {})
      .finally(() => setSuggestionsLoading(false));
  }, [activeTab, goal, authToken]);

  // Close habit picker on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!habitPickerRef.current?.contains(e.target as Node)) setShowHabitPicker(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Auto-focus inputs
  useEffect(() => { if (addingMilestone) milestoneInputRef.current?.focus(); }, [addingMilestone]);
  useEffect(() => { if (editingMilestoneId) { milestoneEditRef.current?.focus(); milestoneEditRef.current?.select(); } }, [editingMilestoneId]);
  useEffect(() => { if (addingTask) taskInputRef.current?.focus(); }, [addingTask]);
  useEffect(() => { if (editingNoteId) editNoteRef.current?.focus(); }, [editingNoteId]);

  // Save conversation
  const saveConversation = useCallback(async (msgs: Message[]) => {
    if (!user || !id) return;
    const chatId = activeChatIdRef.current;
    const isMain = chatId === `goal-${id}`;
    try {
      await setDoc(doc(db, 'users', user.uid, 'conversations', chatId), {
        goalId: id,
        ...(isMain ? { title: `Goal: ${goal?.title ?? 'Untitled'}` } : {}),
        messages: sanitizeMessages(msgs),
        modelChoice,
        updatedAt: new Date(),
        deleted: false,
      }, { merge: true });
    } catch { setChatError('Could not save this conversation. Keep this page open and retry when your connection returns.'); }
  }, [user, id, goal, modelChoice]);

  const chatSafety = useChatSafety(setChatError);
  const { messages, input, handleInputChange, append, isLoading, setInput, setMessages, stop, reload } = useChat({
    api: '/api/chat',
    // See ChatWindow: per-token updates hit React #185 under React 19.
    experimental_throttle: 50,
    initialMessages: [],
    id: `goal-${id}`,
    // Token fetched at SEND time, not baked in once (expired after 1h).
    fetch: chatSafety.fetch,
    body: {
      personalContext: settings.personalContext ?? '',
      responseStyle: settings.responseStyle ?? 'normal',
      customStyle: settings.customStyle ?? '',
      modelChoice,
      goalContext: goal
        ? { id: goal.id, title: goal.title, description: goal.description, progress: goal.progress, timeframe: goal.timeframe, activeChatId }
        : undefined,
    },
    onFinish: chatSafety.onFinish,
    onError: chatSafety.onError,
  });
  useChatSafetyWatch(chatSafety, { messages, isLoading, stop, reload, setMessages });

  useEffect(() => {
    if (!chatsLoaded || seededRef.current || !goal) return;
    seededRef.current = true;
    const main = allChats.find(c => c.id === `goal-${id}`);
    const msgs: Message[] = main?.messages.length
      ? main.messages
      : [{ id: `goal-checkin-${id}`, role: 'assistant' as const, content: checkinMessage(goal) }];
    setMessages(msgs);
    savedLengthRef.current = msgs.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatsLoaded, goal]);

  useEffect(() => {
    if (!pendingMsgRef.current || isLoading) return;
    const msg = pendingMsgRef.current;
    pendingMsgRef.current = null;
    append({ role: 'user', content: msg });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  useEffect(() => {
    const justFinished = prevLoadingRef.current && !isLoading;
    prevLoadingRef.current = isLoading;
    if (!justFinished || messages.length === 0 || messages.length <= savedLengthRef.current) return;
    savedLengthRef.current = messages.length;
    saveConversation(messages);
  }, [isLoading, messages, saveConversation]);

  // Scroll ONLY the messages container (separate chat column) — never
  // scrollIntoView, which scrolls every scrollable ancestor and can crop the
  // page (the bug that hit the main /chat).
  useEffect(() => {
    const el = messagesScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // ── Chat helpers ──────────────────────────────────────────────────────────────

  const mainChatId = `goal-${id}`;
  const isMainChat = activeChatId === mainChatId;
  const extraChats = allChats.filter(c => c.id !== mainChatId);

  function switchChat(chat: GoalChat) {
    // Abort any in-flight stream first — otherwise a response from the chat we're
    // leaving keeps streaming and the finish-effect saves it into the chat we
    // switched TO (activeChatIdRef), bleeding one conversation into another.
    stop();
    setActiveChatId(chat.id);
    const msgs: Message[] = chat.messages.length
      ? chat.messages
      : (chat.id === mainChatId && goal)
        ? [{ id: `goal-checkin-${id}`, role: 'assistant' as const, content: checkinMessage(goal) }]
        : [];
    setMessages(msgs);
    savedLengthRef.current = msgs.length;
  }

  async function deleteChat(chatId: string) {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid, 'conversations', chatId), { deleted: true });
    if (activeChatId === chatId) {
      stop();
      const main = allChats.find(c => c.id === mainChatId);
      if (main) { switchChat(main); }
      else {
        setActiveChatId(mainChatId);
        const msgs: Message[] = goal
          ? [{ id: `goal-checkin-${id}`, role: 'assistant' as const, content: checkinMessage(goal) }]
          : [];
        setMessages(msgs);
        savedLengthRef.current = 0;
      }
    }
  }

  async function startNewChat() {
    if (!user) return;
    stop(); // abort any in-flight stream so it can't save into the new chat
    const ref = await addDoc(collection(db, 'users', user.uid, 'conversations'), {
      goalId: id, title: 'New chat', messages: [],
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), deleted: false,
    });
    setActiveChatId(ref.id);
    setMessages([]);
    savedLengthRef.current = 0;
  }

  async function tapSuggestion(text: string) {
    if (!user) return;
    stop(); // abort any in-flight stream before spinning up the suggestion chat
    const ref = await addDoc(collection(db, 'users', user.uid, 'conversations'), {
      goalId: id, title: text, messages: [],
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), deleted: false,
    });
    setActiveChatId(ref.id);
    savedLengthRef.current = 0;
    pendingMsgRef.current = text;
    setMessages([]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    const val = input.trim();
    setInput('');
    setChatError(null);
    await append({ role: 'user', content: val });
  }

  // ── Progress ──────────────────────────────────────────────────────────────────

  async function saveProgress() {
    if (!user || !goal) return;
    setSavingProgress(true);
    const today = new Date().toISOString().slice(0, 10);
    const newLog = [{ progress: draftProgress, date: today }, ...goal.progressLog].slice(0, 10);
    await updateDoc(doc(db, 'users', user.uid, 'goals', id), {
      progress: draftProgress,
      progressLog: newLog,
      ...(draftProgress >= 100 ? { status: 'completed' } : {}),
    });
    setSavingProgress(false);
  }

  async function markComplete() {
    if (!user) return;
    const today = new Date().toISOString().slice(0, 10);
    const newLog = [{ progress: 100, date: today }, ...(goal?.progressLog ?? [])].slice(0, 10);
    await updateDoc(doc(db, 'users', user.uid, 'goals', id), { status: 'completed', progress: 100, progressLog: newLog });
    router.push('/goals');
  }

  // ── Milestones ────────────────────────────────────────────────────────────────

  async function addMilestone() {
    if (!user || !goal || !newMilestoneTitle.trim()) return;
    const milestone: Milestone = { id: crypto.randomUUID(), title: newMilestoneTitle.trim(), done: false };
    await updateDoc(doc(db, 'users', user.uid, 'goals', id), { milestones: [...goal.milestones, milestone] });
    setNewMilestoneTitle('');
    setAddingMilestone(false);
  }

  async function toggleMilestone(milestoneId: string) {
    if (!user || !goal) return;
    const newMilestones = goal.milestones.map(m => m.id === milestoneId ? { ...m, done: !m.done } : m);
    const doneCount = newMilestones.filter(m => m.done).length;
    const newProgress = Math.round((doneCount / newMilestones.length) * 100);
    const today = new Date().toISOString().slice(0, 10);
    const newLog = newProgress !== goal.progress
      ? [{ progress: newProgress, date: today }, ...goal.progressLog].slice(0, 10)
      : goal.progressLog;
    await updateDoc(doc(db, 'users', user.uid, 'goals', id), {
      milestones: newMilestones,
      progress: newProgress,
      progressLog: newLog,
      ...(newProgress >= 100 ? { status: 'completed' } : {}),
    });
  }

  async function deleteMilestone(milestoneId: string) {
    if (!user || !goal) return;
    const newMilestones = goal.milestones.filter(m => m.id !== milestoneId);
    const updates: Record<string, unknown> = { milestones: newMilestones };
    if (newMilestones.length > 0) {
      updates.progress = Math.round((newMilestones.filter(m => m.done).length / newMilestones.length) * 100);
    }
    await updateDoc(doc(db, 'users', user.uid, 'goals', id), updates);
  }

  async function updateMilestone(milestoneId: string, title: string) {
    setEditingMilestoneId(null);
    if (!user || !goal || !title.trim()) return;
    await updateDoc(doc(db, 'users', user.uid, 'goals', id), {
      milestones: goal.milestones.map(m => m.id === milestoneId ? { ...m, title: title.trim() } : m),
    });
  }

  async function generatePlan() {
    if (!user || !goal || !authToken || planGenerating) return;
    setPlanGenerating(true);
    try {
      const res = await fetch('/api/goals/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ title: goal.title, description: goal.description, timeframe: goal.timeframe }),
      });
      const data = await res.json();
      if (data.milestones?.length) {
        const milestones: Milestone[] = (data.milestones as string[]).map(t => ({
          id: crypto.randomUUID(), title: t, done: false,
        }));
        await updateDoc(doc(db, 'users', user.uid, 'goals', id), { milestones });
      }
    } catch { /* silent */ } finally { setPlanGenerating(false); }
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────────

  async function addTask() {
    if (!user || !newTaskTitle.trim()) return;
    await addDoc(collection(db, 'users', user.uid, 'tasks'), {
      title: newTaskTitle.trim(),
      goalId: id,
      done: false,
      deleted: false,
      createdAt: serverTimestamp(),
      source: 'manual',
    });
    setNewTaskTitle('');
    setAddingTask(false);
  }

  async function toggleTask(taskId: string) {
    const task = goalTasks.find(t => t.id === taskId);
    if (!user || !task) return;
    await updateDoc(doc(db, 'users', user.uid, 'tasks', taskId), { done: !task.done });
  }

  // ── Habits ────────────────────────────────────────────────────────────────────

  async function linkHabit(habitId: string) {
    if (!user || !goal) return;
    await updateDoc(doc(db, 'users', user.uid, 'goals', id), {
      linkedHabitIds: [...goal.linkedHabitIds, habitId],
    });
    setShowHabitPicker(false);
  }

  async function unlinkHabit(habitId: string) {
    if (!user || !goal) return;
    await updateDoc(doc(db, 'users', user.uid, 'goals', id), {
      linkedHabitIds: goal.linkedHabitIds.filter(hid => hid !== habitId),
    });
  }

  // ── Notes ─────────────────────────────────────────────────────────────────────

  async function addNote() {
    if (!user || !goal || !newNoteContent.trim()) return;
    const note: Note = {
      id: crypto.randomUUID(),
      content: newNoteContent.trim(),
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      ...(selectedNoteType ? { type: selectedNoteType } : {}),
    };
    await updateDoc(doc(db, 'users', user.uid, 'goals', id), { notes: [note, ...goal.notes] });
    setNewNoteContent('');
    setSelectedNoteType(undefined);
  }

  async function updateNote(noteId: string, content: string) {
    if (!user || !goal) return;
    setEditingNoteId(null);
    if (!content.trim()) { await deleteNote(noteId); return; }
    await updateDoc(doc(db, 'users', user.uid, 'goals', id), {
      notes: goal.notes.map(n => n.id === noteId ? { ...n, content: content.trim() } : n),
    });
  }

  async function togglePin(noteId: string) {
    if (!user || !goal) return;
    await updateDoc(doc(db, 'users', user.uid, 'goals', id), {
      notes: goal.notes.map(n => n.id === noteId ? { ...n, pinned: !n.pinned } : n),
    });
  }

  async function deleteNote(noteId: string) {
    if (!user || !goal) return;
    await updateDoc(doc(db, 'users', user.uid, 'goals', id), {
      notes: goal.notes.filter(n => n.id !== noteId),
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading || !goal) {
    return (
      <div className="flex-1 overflow-y-auto p-8 max-w-3xl mx-auto w-full space-y-6">
        <Skeleton className="h-4 w-24" />
        <div className="flex items-center gap-5">
          <Skeleton className="w-20 h-20 shrink-0" rounded="rounded-full" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <div className="space-y-3 pt-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" rounded="rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const ringColor = goal.timeframe ? TF_RING[goal.timeframe] : '#7C3AED';
  const hasMilestones = goal.milestones.length > 0;
  const momentum = getMomentum(goal);
  const progressChanged = draftProgress !== goal.progress;
  const incompleteTasks = goalTasks.filter(t => !t.done).length;
  const unlinkedHabits = allHabits.filter(h => !goal.linkedHabitIds.includes(h.id));

  return (
    <div className="h-full overflow-hidden flex flex-col bg-bg">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border px-8 py-5 flex items-start gap-5">
        <button onClick={() => router.push('/goals')} className="shrink-0 mt-1 text-xs text-muted hover:text-text transition-colors">
          ← Goals
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {goal.timeframe && (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TF_BADGE[goal.timeframe]}`}>
                {TF_LABEL[goal.timeframe]}
              </span>
            )}
            {goal.status === 'completed' && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500">Complete</span>
            )}
            {goal.dueDate && <span className="text-xs text-muted">{formatDue(goal.dueDate)}</span>}
          </div>
          <h1 className="text-2xl font-bold text-text leading-tight">{goal.title}</h1>
          {goal.description && <p className="text-sm text-muted mt-0.5">{goal.description}</p>}
        </div>
        {goal.status === 'active' && (
          <button
            onClick={markComplete}
            className="shrink-0 text-xs font-medium px-4 py-2 rounded-lg border border-border text-muted hover:text-emerald-500 hover:border-emerald-500/30 transition-colors"
          >
            Mark complete
          </button>
        )}
      </div>

      {/* ── 2-column body ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex min-h-0">

        {/* Left ─ scrollable */}
        <div className="flex-1 overflow-y-auto min-w-0 flex flex-col">

          {/* Always-visible: progress + milestones */}
          <div className="px-8 pt-6 pb-4 space-y-5">

            {/* Progress hero */}
            <div className="bg-panel border border-border rounded-xl p-6">
              <div className="flex items-center gap-8">
                <div className="relative shrink-0">
                  <Ring pct={goal.progress} color={ringColor} size={116} stroke={7} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-text leading-none">{goal.progress}%</span>
                    <span className="text-[10px] text-muted mt-0.5">complete</span>
                  </div>
                </div>
                <div className="flex-1 min-w-0 space-y-3">
                  {momentum && <p className={`text-xs font-semibold ${momentum.color}`}>{momentum.label}</p>}
                  {!hasMilestones && goal.status === 'active' && (
                    <div className="space-y-2">
                      <input
                        type="range" min={0} max={100} step={5}
                        value={draftProgress}
                        onChange={e => setDraftProgress(Number(e.target.value))}
                        className="w-full accent-brand"
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted">{draftProgress}%</span>
                        {progressChanged && (
                          <button onClick={saveProgress} disabled={savingProgress}
                            className="text-xs font-semibold text-brand hover:underline disabled:opacity-50">
                            {savingProgress ? 'Saving…' : 'Save progress'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {hasMilestones && <p className="text-xs text-muted">Progress synced from milestones</p>}
                  {goal.progressLog.length > 0 && (
                    <div className="space-y-1 pt-1">
                      {goal.progressLog.slice(0, 4).map((entry, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-muted">
                          <span className="w-1 h-1 rounded-full bg-border shrink-0" />
                          <span>{entry.date}</span>
                          <span className="font-medium text-text/50">{entry.progress}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Milestones */}
            <div className="bg-panel border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">Milestones</span>
                  {hasMilestones && (
                    <span className="text-[10px] bg-border text-muted px-1.5 py-0.5 rounded-full">
                      {goal.milestones.filter(m => m.done).length}/{goal.milestones.length}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {goal.status === 'active' && (
                    <button onClick={generatePlan} disabled={planGenerating}
                      className="text-xs text-muted hover:text-brand transition-colors disabled:opacity-50">
                      {planGenerating ? 'Generating…' : hasMilestones ? '↺ Regenerate' : '✦ Generate plan'}
                    </button>
                  )}
                  {goal.status === 'active' && !addingMilestone && (
                    <button onClick={() => setAddingMilestone(true)} className="text-xs text-muted hover:text-brand transition-colors">
                      + Add
                    </button>
                  )}
                </div>
              </div>

              {goal.milestones.length === 0 && !addingMilestone && (
                <p className="text-xs text-muted/50 text-center py-3">
                  Add steps manually or hit &ldquo;Generate plan&rdquo; to let Modus build them for you.
                </p>
              )}

              <div className="space-y-0.5">
                {goal.milestones.map(m => (
                  <div key={m.id} className="flex items-center gap-2.5 group py-1.5">
                    <button
                      onClick={() => goal.status === 'active' && toggleMilestone(m.id)}
                      className={`w-4 h-4 shrink-0 rounded border transition-colors flex items-center justify-center ${
                        m.done ? 'bg-brand border-brand' : 'border-border hover:border-brand'
                      } ${goal.status !== 'active' ? 'cursor-default' : ''}`}
                    >
                      {m.done && <span className="text-white text-[8px] leading-none">✓</span>}
                    </button>
                    {editingMilestoneId === m.id ? (
                      <input
                        ref={milestoneEditRef}
                        value={editingMilestoneTitle}
                        onChange={e => setEditingMilestoneTitle(e.target.value)}
                        onBlur={() => updateMilestone(m.id, editingMilestoneTitle)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') updateMilestone(m.id, editingMilestoneTitle);
                          if (e.key === 'Escape') setEditingMilestoneId(null);
                        }}
                        className="flex-1 bg-transparent border-b border-brand text-sm text-text outline-none"
                      />
                    ) : (
                      <span
                        onClick={() => {
                          if (goal.status === 'active') {
                            setEditingMilestoneId(m.id);
                            setEditingMilestoneTitle(m.title);
                          }
                        }}
                        className={`flex-1 text-sm ${m.done ? 'line-through text-muted' : 'text-text'} ${goal.status === 'active' ? 'cursor-text' : ''}`}
                      >
                        {m.title}
                      </span>
                    )}
                    {goal.status === 'active' && editingMilestoneId !== m.id && (
                      <button onClick={() => deleteMilestone(m.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted/50 hover:text-red-400 text-base leading-none transition-all">
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {addingMilestone && (
                <div className="mt-2 flex items-center gap-2">
                  <input ref={milestoneInputRef} value={newMilestoneTitle}
                    onChange={e => setNewMilestoneTitle(e.target.value)}
                    placeholder="Milestone description…"
                    className="flex-1 bg-bg border border-border rounded-lg px-3 py-1.5 text-sm text-text placeholder:text-muted outline-none focus:border-brand transition-colors"
                    onKeyDown={e => {
                      if (e.key === 'Enter') addMilestone();
                      if (e.key === 'Escape') { setAddingMilestone(false); setNewMilestoneTitle(''); }
                    }}
                  />
                  <button onClick={addMilestone} disabled={!newMilestoneTitle.trim()}
                    className="text-xs font-semibold text-brand hover:underline disabled:opacity-40">Add</button>
                  <button onClick={() => { setAddingMilestone(false); setNewMilestoneTitle(''); }}
                    className="text-xs text-muted hover:text-text transition-colors">Cancel</button>
                </div>
              )}
            </div>
          </div>

          {/* Tab switcher */}
          <div className="shrink-0 border-t border-b border-border px-8 flex items-center gap-0.5">
            {([
              { key: 'tasks',   label: 'Tasks',   badge: incompleteTasks > 0 ? incompleteTasks : null },
              { key: 'habits',  label: 'Habits',  badge: goal.linkedHabitIds.length > 0 ? goal.linkedHabitIds.length : null },
              { key: 'notes',   label: 'Notes',   badge: goal.notes.length > 0 ? goal.notes.length : null },
              { key: 'explore', label: 'Explore', badge: null },
            ] as { key: GoalTab; label: string; badge: number | null }[]).map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === t.key
                    ? 'border-brand text-brand'
                    : 'border-transparent text-muted hover:text-text'
                }`}
              >
                {t.label}
                {t.badge !== null && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${
                    activeTab === t.key ? 'surface-tint-strong text-brand' : 'bg-border text-muted'
                  }`}>{t.badge}</span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 px-8 py-5">

            {/* Tasks tab */}
            {activeTab === 'tasks' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    {goalTasks.some(t => t.done) && (
                      <button onClick={() => setShowDoneTasks(s => !s)} className="text-xs text-muted hover:text-text transition-colors">
                        {showDoneTasks ? 'Hide done' : `Show done (${goalTasks.filter(t => t.done).length})`}
                      </button>
                    )}
                  </div>
                  {!addingTask && goal.status === 'active' && (
                    <button onClick={() => setAddingTask(true)} className="text-xs text-muted hover:text-brand transition-colors">
                      + Add task
                    </button>
                  )}
                </div>

                {goalTasks.length === 0 && !addingTask && (
                  <p className="text-xs text-muted/50 text-center py-8">Add tasks to build a daily action plan for this goal.</p>
                )}

                <div className="space-y-0.5">
                  {goalTasks.filter(t => showDoneTasks || !t.done).map(t => (
                    <div key={t.id} className="flex items-center gap-2.5 py-1.5">
                      <button
                        onClick={() => toggleTask(t.id)}
                        className={`w-4 h-4 shrink-0 rounded border transition-colors flex items-center justify-center ${
                          t.done ? 'bg-brand border-brand' : 'border-border hover:border-brand'
                        }`}
                      >
                        {t.done && <span className="text-white text-[8px] leading-none">✓</span>}
                      </button>
                      <span className={`flex-1 text-sm ${t.done ? 'line-through text-muted' : 'text-text'}`}>{t.title}</span>
                    </div>
                  ))}
                </div>

                {addingTask && (
                  <div className="mt-3 flex items-center gap-2">
                    <input ref={taskInputRef} value={newTaskTitle}
                      onChange={e => setNewTaskTitle(e.target.value)}
                      placeholder="Task description…"
                      className="flex-1 bg-bg border border-border rounded-lg px-3 py-1.5 text-sm text-text placeholder:text-muted outline-none focus:border-brand transition-colors"
                      onKeyDown={e => {
                        if (e.key === 'Enter') addTask();
                        if (e.key === 'Escape') { setAddingTask(false); setNewTaskTitle(''); }
                      }}
                    />
                    <button onClick={addTask} disabled={!newTaskTitle.trim()}
                      className="text-xs font-semibold text-brand hover:underline disabled:opacity-40">Add</button>
                    <button onClick={() => { setAddingTask(false); setNewTaskTitle(''); }}
                      className="text-xs text-muted hover:text-text transition-colors">Cancel</button>
                  </div>
                )}
              </div>
            )}

            {/* Habits tab */}
            {activeTab === 'habits' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs text-muted">Link habits that support this goal to track consistency.</p>
                  <div className="relative shrink-0" ref={habitPickerRef}>
                    <button
                      onClick={() => setShowHabitPicker(s => !s)}
                      disabled={unlinkedHabits.length === 0}
                      className="text-xs text-muted hover:text-brand transition-colors disabled:opacity-40"
                    >
                      + Link habit
                    </button>
                    {showHabitPicker && unlinkedHabits.length > 0 && (
                      <div className="absolute right-0 top-6 z-50 bg-panel border border-border rounded-xl shadow-lg w-56 py-1 max-h-52 overflow-y-auto">
                        {unlinkedHabits.map(h => (
                          <button key={h.id} onClick={() => linkHabit(h.id)}
                            className="w-full text-left px-4 py-2 text-sm text-muted hover:text-text hover:bg-bg transition-colors flex items-center justify-between gap-2">
                            <span className="truncate">{h.title}</span>
                            {h.streak > 0 && <span className="text-xs shrink-0">{h.streak}🔥</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {goal.linkedHabitIds.length === 0 ? (
                  <p className="text-xs text-muted/50 text-center py-8">No habits linked yet.</p>
                ) : (
                  <div className="space-y-0.5">
                    {goal.linkedHabitIds
                      .map(hid => allHabits.find(h => h.id === hid))
                      .filter((h): h is HabitRef => !!h)
                      .map(h => (
                        <div key={h.id} className="flex items-center gap-2.5 group py-1.5">
                          <div className="w-4 h-4 shrink-0 rounded border border-tint surface-tint flex items-center justify-center">
                            <span className="text-brand text-[8px] leading-none">↺</span>
                          </div>
                          <span className="flex-1 text-sm text-text">{h.title}</span>
                          {h.streak > 0 && <span className="text-xs text-muted">{h.streak}🔥</span>}
                          <button onClick={() => unlinkHabit(h.id)}
                            className="opacity-0 group-hover:opacity-100 text-muted/50 hover:text-red-400 text-base leading-none transition-all">
                            ×
                          </button>
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>
            )}

            {/* Notes tab */}
            {activeTab === 'notes' && (() => {
              const sorted = [...goal.notes]
                .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false))
                .filter(n => noteFilter === 'all' || n.type === noteFilter);
              return (
                <div>
                  {/* Compose */}
                  <div className="mb-5 bg-panel border border-border rounded-xl overflow-hidden">
                    <textarea
                      value={newNoteContent}
                      onChange={e => setNewNoteContent(e.target.value)}
                      placeholder="Log a win, blocker, idea, or reflection…"
                      rows={3}
                      className="w-full bg-transparent px-4 pt-3 pb-2 text-sm text-text placeholder:text-muted outline-none resize-none"
                      onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote(); }}
                    />
                    <div className="flex items-center justify-between px-4 pb-3 gap-3">
                      {/* Type selector */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {(Object.keys(NOTE_TYPES) as NoteType[]).map(type => (
                          <button
                            key={type}
                            onClick={() => setSelectedNoteType(selectedNoteType === type ? undefined : type)}
                            className={`text-[10px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                              selectedNoteType === type
                                ? `${NOTE_TYPES[type].bg} ${NOTE_TYPES[type].color} ${NOTE_TYPES[type].border}`
                                : 'border-border text-muted hover:text-text'
                            }`}
                          >
                            {NOTE_TYPES[type].label}
                          </button>
                        ))}
                      </div>
                      <button onClick={addNote} disabled={!newNoteContent.trim()}
                        className="shrink-0 text-xs font-semibold text-brand hover:underline disabled:opacity-40">
                        Save  <span className="text-muted font-normal">⌘↵</span>
                      </button>
                    </div>
                  </div>

                  {/* Filter pills */}
                  {goal.notes.length > 0 && (
                    <div className="flex items-center gap-1.5 mb-4 flex-wrap">
                      <button
                        onClick={() => setNoteFilter('all')}
                        className={`text-[10px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                          noteFilter === 'all' ? 'bg-border text-text border-border' : 'border-border text-muted hover:text-text'
                        }`}
                      >
                        All ({goal.notes.length})
                      </button>
                      {(Object.keys(NOTE_TYPES) as NoteType[])
                        .filter(type => goal.notes.some(n => n.type === type))
                        .map(type => (
                          <button
                            key={type}
                            onClick={() => setNoteFilter(noteFilter === type ? 'all' : type)}
                            className={`text-[10px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                              noteFilter === type
                                ? `${NOTE_TYPES[type].bg} ${NOTE_TYPES[type].color} ${NOTE_TYPES[type].border}`
                                : 'border-border text-muted hover:text-text'
                            }`}
                          >
                            {NOTE_TYPES[type].label} ({goal.notes.filter(n => n.type === type).length})
                          </button>
                        ))
                      }
                    </div>
                  )}

                  {/* Notes list */}
                  {sorted.length === 0 ? (
                    <p className="text-xs text-muted/50 text-center py-8">
                      {noteFilter === 'all' ? 'Your notes will appear here.' : `No ${NOTE_TYPES[noteFilter as NoteType].label.toLowerCase()} notes yet.`}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {sorted.map(n => (
                        <div
                          key={n.id}
                          className={`group relative bg-panel border rounded-xl px-4 py-3 transition-colors ${
                            n.type ? NOTE_TYPES[n.type].border : 'border-border'
                          } ${n.pinned ? 'ring-1 ring-brand/20' : ''}`}
                        >
                          {/* Top row: type tag + pin + delete */}
                          <div className="flex items-center justify-between mb-2 gap-2">
                            <div className="flex items-center gap-2">
                              {n.pinned && (
                                <span className="text-[9px] font-semibold uppercase tracking-wider text-brand">Pinned</span>
                              )}
                              {n.type && (
                                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${NOTE_TYPES[n.type].bg} ${NOTE_TYPES[n.type].color}`}>
                                  {NOTE_TYPES[n.type].label}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                              <button
                                onClick={() => togglePin(n.id)}
                                title={n.pinned ? 'Unpin' : 'Pin'}
                                className={`text-xs transition-colors ${n.pinned ? 'text-brand' : 'text-muted hover:text-brand'}`}
                              >
                                {n.pinned ? '📌' : '📍'}
                              </button>
                              <button onClick={() => deleteNote(n.id)}
                                className="text-[10px] text-muted/50 hover:text-red-400 transition-colors">
                                Delete
                              </button>
                            </div>
                          </div>

                          {/* Content — click to edit */}
                          {editingNoteId === n.id ? (
                            <textarea
                              ref={editNoteRef}
                              defaultValue={n.content}
                              rows={3}
                              className="w-full bg-transparent text-sm text-text outline-none resize-none leading-relaxed"
                              onChange={e => setEditDraft(e.target.value)}
                              onFocus={e => setEditDraft(e.target.value)}
                              onBlur={() => updateNote(n.id, editDraft || n.content)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) updateNote(n.id, editDraft || n.content);
                                if (e.key === 'Escape') setEditingNoteId(null);
                              }}
                            />
                          ) : (
                            <p
                              onClick={() => { setEditingNoteId(n.id); setEditDraft(n.content); }}
                              className="text-sm text-text leading-relaxed whitespace-pre-wrap cursor-text"
                            >
                              {n.content}
                            </p>
                          )}

                          {/* Footer */}
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-[10px] text-muted">{n.date}</span>
                            {editingNoteId === n.id && (
                              <span className="text-[10px] text-muted">⌘↵ save · ESC cancel</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Explore tab */}
            {activeTab === 'explore' && (
              <div>
                <p className="text-xs text-muted mb-4">Tap a question to open a dedicated chat thread with Modus.</p>
                {suggestionsLoading ? (
                  <div className="flex flex-wrap gap-2">
                    {[100, 140, 115, 160, 125].map((w, i) => (
                      <div key={i} className="h-7 rounded-full bg-border animate-pulse" style={{ width: `${w}px` }} />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {(suggestions.length > 0 ? suggestions : CHAT_CHIPS).map(s => (
                      <button key={s} onClick={() => tapSuggestion(s)}
                        className="text-[11px] px-3 py-1.5 rounded-full border border-border text-muted hover:text-text hover-border-tint hover-surface-tint transition-colors text-left">
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>

        {/* Right ─ MODUS chat */}
        <div className="w-[360px] shrink-0 flex flex-col overflow-hidden border-l border-border">

          <div className="shrink-0 border-b border-border px-3 pt-3 pb-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted mb-2">Modus on this goal</p>
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
              <button
                onClick={() => {
                  const main = allChats.find(c => c.id === mainChatId);
                  if (main) { switchChat(main); }
                  else {
                    setActiveChatId(mainChatId);
                    const msgs: Message[] = goal
                      ? [{ id: `goal-checkin-${id}`, role: 'assistant' as const, content: checkinMessage(goal) }]
                      : [];
                    setMessages(msgs);
                    savedLengthRef.current = 0;
                  }
                }}
                className={`shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  isMainChat ? 'bg-brand text-white border-brand' : 'border-border text-muted hover:text-text hover-border-tint'
                }`}
              >
                Main
              </button>
              {extraChats.map(c => (
                <div key={c.id} className={`shrink-0 flex items-center rounded-full border transition-colors ${
                  activeChatId === c.id ? 'bg-brand border-brand' : 'border-border hover-border-tint'
                }`}>
                  {renamingChatId === c.id ? (
                    <input
                      ref={renameInputRef}
                      value={renamingTitle}
                      onChange={e => setRenamingTitle(e.target.value)}
                      onBlur={() => saveRenameChat(c.id, renamingTitle)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveRenameChat(c.id, renamingTitle);
                        if (e.key === 'Escape') setRenamingChatId(null);
                      }}
                      onClick={e => e.stopPropagation()}
                      className="text-xs pl-2.5 py-1 w-28 bg-transparent outline-none border-b border-white text-white"
                    />
                  ) : (
                    <button
                      onClick={() => switchChat(c)}
                      onDoubleClick={e => {
                        e.stopPropagation();
                        setRenamingChatId(c.id);
                        setRenamingTitle(c.title);
                        setTimeout(() => { renameInputRef.current?.focus(); renameInputRef.current?.select(); }, 10);
                      }}
                      title={`${c.title} · double-click to rename`}
                      className={`text-xs pl-2.5 pr-1 py-1 max-w-[90px] truncate ${
                        activeChatId === c.id ? 'text-white' : 'text-muted hover:text-text'
                      }`}
                    >
                      {c.title.length > 14 ? c.title.slice(0, 11) + '…' : c.title}
                    </button>
                  )}
                  <button onClick={e => { e.stopPropagation(); deleteChat(c.id); }}
                    className={`pr-2 py-1 text-sm leading-none ${
                      activeChatId === c.id ? 'text-white/60 hover:text-white' : 'text-muted/50 hover:text-muted'
                    }`}>×</button>
                </div>
              ))}
              <button onClick={startNewChat}
                className="shrink-0 text-xs px-2.5 py-1 rounded-full border border-dashed border-border text-muted hover:text-text hover-border-tint transition-colors">
                + New
              </button>
            </div>
          </div>

          <div ref={messagesScrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.map((m, idx) => (
              <MessageBubble key={m.id} message={m} isStreaming={isLoading && idx === messages.length - 1} />
            ))}
            {isAwaitingAssistantText(messages, isLoading) && (
              <div className="flex gap-1 px-1">
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="shrink-0 border-t border-border px-3 py-2 flex gap-1 flex-wrap">
            {CHAT_CHIPS.map(chip => (
              <button key={chip} onClick={() => setInput(chip)} disabled={isLoading}
                className="text-[10px] px-2.5 py-1 rounded-full border border-border text-muted hover:text-text hover-border-tint hover-surface-tint transition-colors disabled:opacity-40 whitespace-nowrap">
                {chip}
              </button>
            ))}
          </div>

          {chatError && (
            <div className="shrink-0 mx-3 mt-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center justify-between gap-2">
              <p className="text-xs text-red-400">{chatError}</p>
              <button onClick={() => setChatError(null)} className="text-red-400 hover:text-red-300 shrink-0" aria-label="Dismiss">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-3 h-3"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          )}

          <div className="shrink-0 border-t border-border px-3 py-2 flex items-center">
            {modelError && <p role="alert" className="text-xs text-red-500">{modelError}</p>}
            <ModelSwitcher value={modelChoice} onChange={handleModelChange} plan={plan} />
          </div>

          <div className="shrink-0 border-t border-border">
            <form onSubmit={handleSubmit} className="flex items-center gap-3 px-4 py-3">
              <input value={input} onChange={handleInputChange} placeholder="Message Modus…"
                className="flex-1 bg-transparent text-sm text-text placeholder:text-muted/40 outline-none border-none" />
              {isLoading ? (
                // Same Stop as /chat: there was no way to stop a reply here.
                <button type="button" onClick={stop} aria-label="Stop" title="Stop"
                  className="w-7 h-7 rounded-full bg-text flex items-center justify-center shrink-0">
                  <span className="w-2.5 h-2.5 rounded-[2px] bg-panel" />
                </button>
              ) : (
              <button type="submit" disabled={!input.trim() || isLoading}
                className="w-7 h-7 rounded-full bg-text flex items-center justify-center text-panel shrink-0 disabled:opacity-30 transition-opacity">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
                </svg>
              </button>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GoalDetailPage() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  return <GoalDetailPageContent key={`${user?.uid ?? 'guest'}:${id}`} />;
}
