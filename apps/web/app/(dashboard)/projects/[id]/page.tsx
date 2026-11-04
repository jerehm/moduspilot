'use client';

import { FilesBrowser } from '@/components/workspace/WorkspacePanel';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  doc, onSnapshot, updateDoc, collection, query, where,
  addDoc, serverTimestamp, setDoc, arrayUnion, arrayRemove,
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
import { motion, AnimatePresence } from 'framer-motion';

type ProjectTab = 'overview' | 'resources' | 'tasks' | 'notes' | 'files';
type NoteType = 'win' | 'blocker' | 'idea' | 'reflection';
type ResourceType = 'github' | 'notion' | 'slack' | 'drive' | 'url';

interface PinnedResource {
  type: ResourceType;
  name: string;
  url?: string;
  repo?: string;
  pageId?: string;
  channelId?: string;
  fileId?: string;
}

interface Note { id: string; content: string; date: string; type?: NoteType; pinned?: boolean; }
interface ProjectTask { id: string; title: string; done: boolean; }

interface Project {
  id: string;
  title: string;
  description?: string;
  status: 'active' | 'archived';
  resources: PinnedResource[];
  notes: Note[];
  emoji?: string;
}

const EMOJIS = ['🗂️','🚀','💡','🔧','📐','🎯','⚡','🌐','🔬','🎨','📦','🧪'];

interface ProjectChat { id: string; title: string; messages: Message[]; createdAt: Date; modelChoice?: string; }

const NOTE_TYPES: Record<NoteType, { label: string; color: string; bg: string; border: string }> = {
  win:        { label: 'Win',        color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  blocker:    { label: 'Blocker',    color: 'text-red-400',     bg: 'bg-red-400/10',     border: 'border-red-400/30'     },
  idea:       { label: 'Idea',       color: 'text-amber-500',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30'   },
  reflection: { label: 'Reflection', color: 'text-brand',       bg: 'surface-tint',       border: 'border-tint'       },
};

const RESOURCE_TYPES: { type: ResourceType; label: string; d: string }[] = [
  { type: 'github', label: 'GitHub',  d: 'M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22' },
  { type: 'notion', label: 'Notion',  d: 'M4 4h16v16H4z' },
  { type: 'slack',  label: 'Slack',   d: 'M14.5 10c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5z' },
  { type: 'drive',  label: 'Drive',   d: 'M22 16.74L17.74 9H6.26L2 16.74V17l3.06 5.17a1 1 0 00.87.5h12.14a1 1 0 00.87-.5L22 17v-.26zM12 3L7.74 9h8.52L12 3z' },
  { type: 'url',    label: 'URL',     d: 'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71' },
];

function sanitizeMessages(msgs: Message[]): { id: string; role: string; content: string }[] {
  return msgs.map(m => ({
    id: m.id,
    role: m.role,
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  }));
}

interface AvailableResource {
  id: string;
  name: string;
  sub?: string;
  url?: string;
  repo?: string;
  pageId?: string;
  channelId?: string;
  fileId?: string;
}

function ProjectDetailPageContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { settings, plan, loading: settingsLoading } = useUserSettings(user);

  // In-chat model picker (mirrors the main chat). Defaults to the saved Brain
  // model; users can switch per project chat.
  const [chatError, setChatError] = useState<string | null>(null);

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProjectTab>('overview');

  // Tasks
  const [projectTasks, setProjectTasks] = useState<ProjectTask[]>([]);
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [showDoneTasks, setShowDoneTasks] = useState(false);
  const taskInputRef = useRef<HTMLInputElement>(null);

  // Notes
  const [newNoteContent, setNewNoteContent] = useState('');
  const [selectedNoteType, setSelectedNoteType] = useState<NoteType | undefined>(undefined);
  const [noteFilter, setNoteFilter] = useState<'all' | NoteType>('all');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const editNoteRef = useRef<HTMLTextAreaElement>(null);

  // Inline title/desc editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');

  // Resizable chat
  const [chatWidth, setChatWidth] = useState(360);
  const chatDragStartX = useRef(0);
  const chatDragStartW = useRef(360);
  const chatCurrentW = useRef(360);

  // Resource picker
  const [showPicker, setShowPicker] = useState(false);
  const [pickerType, setPickerType] = useState<ResourceType | null>(null);
  const [availableResources, setAvailableResources] = useState<AvailableResource[]>([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const [urlDraft, setUrlDraft] = useState({ name: '', url: '' });

  // Multi-chat
  const [allChats, setAllChats] = useState<ProjectChat[]>([]);
  const [chatsLoaded, setChatsLoaded] = useState(false);
  const activeChatIdRef = useRef(`project-${id}`);
  const [activeChatId, _setActiveChatId] = useState(`project-${id}`);
  const setActiveChatId = (newId: string) => { activeChatIdRef.current = newId; _setActiveChatId(newId); };
  const { modelChoice, handleModelChange, modelError } = useConversationModel(user?.uid, activeChatId, allChats.find(chat => chat.id === activeChatId)?.modelChoice, settings.modelSettings, plan);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const pendingMsgRef   = useRef<string | null>(null);
  const savedLengthRef  = useRef(0);
  const prevLoadingRef  = useRef(false);
  const seededRef       = useRef(false);
  const bottomRef       = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);

  // ── Auth token ────────────────────────────────────────────────────────────────
  useEffect(() => {
    // onIdTokenChanged (not onAuthStateChanged) so the cached token refreshes
    // when Firebase rotates it (~1h) — otherwise the chat 401s after an hour open.
    const unsub = auth.onIdTokenChanged(async u => {
      setAuthToken(u ? await u.getIdToken() : null);
    });
    return unsub;
  }, []);

  // ── Load project ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !id) return;
    const unsub = onSnapshot(doc(db, 'users', user.uid, 'projects', id), snap => {
      if (!snap.exists()) { router.replace('/projects'); return; }
      const d = snap.data();
      setProject({
        id: snap.id,
        title: d.title ?? 'Untitled',
        description: d.description,
        status: d.status ?? 'active',
        resources: (d.resources as PinnedResource[]) ?? [],
        notes: (d.notes as Note[]) ?? [],
        emoji: d.emoji as string | undefined,
      });
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [user, id, router]);

  // ── Load tasks ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !id) return;
    const q = query(collection(db, 'users', user.uid, 'tasks'), where('projectId', '==', id));
    const unsub = onSnapshot(q, snap => {
      setProjectTasks(
        snap.docs
          .filter(d => !d.data().deleted)
          .map(d => ({ id: d.id, title: d.data().title ?? '', done: d.data().done ?? false }))
          .sort((a, b) => Number(a.done) - Number(b.done))
      );
    });
    return unsub;
  }, [user, id]);

  // ── Load chats ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !id) return;
    const unsub = onSnapshot(
      query(collection(db, 'users', user.uid, 'conversations'), where('projectId', '==', id)),
      snap => {
        const chats: ProjectChat[] = snap.docs
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

  // ── Chat width from localStorage ──────────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('project-chat-width');
    if (saved) {
      const w = Math.min(520, Math.max(260, Number(saved)));
      setChatWidth(w); chatCurrentW.current = w;
    }
  }, []);

  // ── Auto-focus ────────────────────────────────────────────────────────────────
  useEffect(() => { if (addingTask) taskInputRef.current?.focus(); }, [addingTask]);
  useEffect(() => { if (editingNoteId) editNoteRef.current?.focus(); }, [editingNoteId]);
  useEffect(() => {
    if (renamingChatId) setTimeout(() => { renameInputRef.current?.focus(); renameInputRef.current?.select(); }, 10);
  }, [renamingChatId]);

  // ── Save conversation ─────────────────────────────────────────────────────────
  const saveConversation = useCallback(async (msgs: Message[]) => {
    if (!user || !id) return;
    const chatId = activeChatIdRef.current;
    const isMain = chatId === `project-${id}`;
    try {
      await setDoc(doc(db, 'users', user.uid, 'conversations', chatId), {
        projectId: id,
        ...(isMain ? { title: `Project: ${project?.title ?? 'Untitled'}` } : {}),
        messages: sanitizeMessages(msgs),
        modelChoice,
        updatedAt: new Date(),
        deleted: false,
      }, { merge: true });
    } catch { setChatError('Could not save this conversation. Keep this page open and retry when your connection returns.'); }
  }, [user, id, project, modelChoice]);

  const chatSafety = useChatSafety(setChatError);
  const { messages, input, handleInputChange, append, isLoading, setInput, setMessages, stop, reload } = useChat({
    api: '/api/chat',
    // See ChatWindow: per-token updates hit React #185 under React 19.
    experimental_throttle: 50,
    initialMessages: [],
    id: `project-${id}`,
    // Token fetched at SEND time, not baked in once (expired after 1h).
    fetch: chatSafety.fetch,
    body: {
      personalContext: settings.personalContext ?? '',
      responseStyle: settings.responseStyle ?? 'normal',
      customStyle: settings.customStyle ?? '',
      modelChoice,
      projectContext: project
        ? { id: project.id, title: project.title, description: project.description, resources: project.resources, activeChatId }
        : undefined,
      // Every chat in a project shares one workspace, so files outlive the thread.
      workspaceId: `project-${id}`,
    },
    onFinish: chatSafety.onFinish,
    onError: chatSafety.onError,
  });
  useChatSafetyWatch(chatSafety, { messages, isLoading, stop, reload, setMessages });

  // Seed initial message
  useEffect(() => {
    if (!chatsLoaded || seededRef.current || !project) return;
    seededRef.current = true;
    const main = allChats.find(c => c.id === `project-${id}`);
    const seedMsg = project.resources.length > 0
      ? `Welcome back to "${project.title}". I have context on ${project.resources.length} pinned resource${project.resources.length !== 1 ? 's' : ''}. What would you like to work on?`
      : `"${project.title}" is ready. Pin resources in the Resources tab to scope my context to this project specifically.`;
    const msgs: Message[] = main?.messages.length
      ? main.messages
      : [{ id: `project-seed-${id}`, role: 'assistant' as const, content: seedMsg }];
    setMessages(msgs);
    savedLengthRef.current = msgs.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatsLoaded, project]);

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

  // Pin the chat to the bottom by scrolling ONLY the messages container — never
  // scrollIntoView, which scrolls every scrollable ancestor (incl. the page) and
  // can crop the layout (the bug that hit the main /chat).
  useEffect(() => {
    const el = messagesScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // ── Chat helpers ──────────────────────────────────────────────────────────────
  const mainChatId = `project-${id}`;
  const extraChats = allChats.filter(c => c.id !== mainChatId);

  function switchChat(chat: ProjectChat) {
    // Abort any in-flight stream first — otherwise a response from the chat we're
    // leaving keeps streaming and the finish-effect saves it into the chat we
    // just switched TO (activeChatIdRef), bleeding one conversation into another.
    stop();
    setActiveChatId(chat.id);
    setMessages(chat.messages.length ? chat.messages : []);
    savedLengthRef.current = chat.messages.length;
  }

  async function deleteChat(chatId: string) {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid, 'conversations', chatId), { deleted: true });
    if (activeChatId === chatId) {
      stop();
      const main = allChats.find(c => c.id === mainChatId);
      if (main) switchChat(main);
      else { setActiveChatId(mainChatId); setMessages([]); savedLengthRef.current = 0; }
    }
  }

  async function saveRenameChat(chatId: string, title: string) {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid, 'conversations', chatId), { title: title.trim() || 'New chat' });
    setRenamingChatId(null);
  }

  async function startNewChat() {
    if (!user) return;
    stop(); // abort any in-flight stream so it can't save into the new chat
    const ref = await addDoc(collection(db, 'users', user.uid, 'conversations'), {
      projectId: id, title: 'New chat', messages: [],
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), deleted: false,
    });
    setActiveChatId(ref.id);
    setMessages([]);
    savedLengthRef.current = 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    const val = input.trim();
    setInput('');
    setChatError(null);
    await append({ role: 'user', content: val });
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────────
  async function addTask() {
    if (!user || !newTaskTitle.trim()) return;
    await addDoc(collection(db, 'users', user.uid, 'tasks'), {
      title: newTaskTitle.trim(), done: false, projectId: id, priority: 'medium',
      createdAt: serverTimestamp(), deleted: false,
    });
    setNewTaskTitle('');
    setAddingTask(false);
  }

  async function toggleTask(taskId: string, done: boolean) {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid, 'tasks', taskId), { done: !done });
  }

  async function deleteTask(taskId: string) {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid, 'tasks', taskId), { deleted: true });
  }

  // ── Notes ─────────────────────────────────────────────────────────────────────
  async function addNote() {
    if (!user || !project || !newNoteContent.trim()) return;
    const note: Note = { id: crypto.randomUUID(), content: newNoteContent.trim(), date: new Date().toISOString().slice(0, 10), type: selectedNoteType, pinned: false };
    await updateDoc(doc(db, 'users', user.uid, 'projects', id), { notes: [note, ...project.notes] });
    setNewNoteContent('');
    setSelectedNoteType(undefined);
  }

  async function updateNote(noteId: string) {
    if (!user || !project) return;
    const updated = project.notes.map(n => n.id === noteId ? { ...n, content: editDraft } : n);
    await updateDoc(doc(db, 'users', user.uid, 'projects', id), { notes: updated });
    setEditingNoteId(null);
  }

  async function deleteNote(noteId: string) {
    if (!user || !project) return;
    await updateDoc(doc(db, 'users', user.uid, 'projects', id), { notes: project.notes.filter(n => n.id !== noteId) });
  }

  async function togglePinNote(noteId: string) {
    if (!user || !project) return;
    const updated = project.notes.map(n => n.id === noteId ? { ...n, pinned: !n.pinned } : n);
    await updateDoc(doc(db, 'users', user.uid, 'projects', id), { notes: updated });
  }

  // ── Resources ─────────────────────────────────────────────────────────────────
  async function loadPickerResources(type: ResourceType) {
    if (type === 'url') { setAvailableResources([]); return; }
    const token = authToken ?? await auth.currentUser?.getIdToken();
    if (!token) { setAvailableResources([]); return; }
    setLoadingResources(true);
    try {
      const res = await fetch(`/api/projects/resources?type=${type}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        console.error('[picker] API error', res.status, await res.text());
        setAvailableResources([]);
        return;
      }
      const data = await res.json();
      setAvailableResources(data.items ?? []);
    } catch (err) {
      console.error('[picker] fetch error', err);
      setAvailableResources([]);
    } finally {
      setLoadingResources(false);
    }
  }

  async function pinResource(resource: PinnedResource) {
    if (!user) return;
    // arrayUnion is atomic — safe even if project state is stale
    await updateDoc(doc(db, 'users', user.uid, 'projects', id), { resources: arrayUnion(resource) });
    setShowPicker(false);
    setPickerType(null);
    setAvailableResources([]);
  }

  async function unpinResource(index: number) {
    if (!user || !project) return;
    const resource = project.resources[index];
    if (!resource) return;
    await updateDoc(doc(db, 'users', user.uid, 'projects', id), { resources: arrayRemove(resource) });
  }

  async function pinUrl() {
    if (!urlDraft.name.trim() || !urlDraft.url.trim()) return;
    await pinResource({ type: 'url', name: urlDraft.name.trim(), url: urlDraft.url.trim() });
    setUrlDraft({ name: '', url: '' });
  }

  // ── Emoji cycle ───────────────────────────────────────────────────────────────
  async function cycleEmoji() {
    if (!user || !project) return;
    const cur = project.emoji ?? EMOJIS[0];
    const idx = EMOJIS.indexOf(cur);
    const next = EMOJIS[(idx + 1) % EMOJIS.length];
    await updateDoc(doc(db, 'users', user.uid, 'projects', id), { emoji: next });
  }

  // ── Inline title / desc ───────────────────────────────────────────────────────
  async function saveTitle() {
    if (!user || !titleDraft.trim()) { setEditingTitle(false); return; }
    await updateDoc(doc(db, 'users', user.uid, 'projects', id), { title: titleDraft.trim() });
    setEditingTitle(false);
  }

  async function saveDesc() {
    if (!user) { setEditingDesc(false); return; }
    await updateDoc(doc(db, 'users', user.uid, 'projects', id), { description: descDraft.trim() });
    setEditingDesc(false);
  }

  // ── Chat resize drag ──────────────────────────────────────────────────────────
  function startChatDrag(e: React.MouseEvent) {
    chatDragStartX.current = e.clientX;
    chatDragStartW.current = chatWidth;
    chatCurrentW.current = chatWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    function onMove(ev: MouseEvent) {
      const w = Math.min(520, Math.max(260, chatDragStartW.current - (ev.clientX - chatDragStartX.current)));
      setChatWidth(w); chatCurrentW.current = w;
    }
    function onUp() {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('project-chat-width', String(chatCurrentW.current));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Loading / not found ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-8 max-w-3xl mx-auto w-full space-y-6">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
        <div className="flex gap-3 pt-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-8 w-28" rounded="rounded-full" />
          ))}
        </div>
        <div className="space-y-3 pt-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" rounded="rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!project) return null;

  const activeTasks = projectTasks.filter(t => !t.done);
  const doneTasks   = projectTasks.filter(t => t.done);
  const filteredNotes = noteFilter === 'all' ? project.notes : project.notes.filter(n => n.type === noteFilter);
  const sortedNotes = [...filteredNotes].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return 0;
  });

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left column ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-w-0">
        <div className="p-6 md:p-8 max-w-2xl">

          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="mb-6"
          >
            <div className="flex items-start gap-3 mb-2">
              <button onClick={() => router.push('/projects')} className="mt-1 text-muted hover:text-text transition-colors shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>

              {/* Emoji */}
              <button
                onClick={cycleEmoji}
                title="Click to change emoji"
                className="text-2xl leading-none mt-0.5 hover:scale-110 transition-transform shrink-0"
              >
                {project.emoji ?? '🗂️'}
              </button>

              <div className="flex-1 min-w-0">
                {/* Title */}
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  {editingTitle ? (
                    <input
                      autoFocus
                      value={titleDraft}
                      onChange={e => setTitleDraft(e.target.value)}
                      onBlur={saveTitle}
                      onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
                      className="text-xl font-bold bg-transparent border-b border-brand text-text outline-none w-full"
                    />
                  ) : (
                    <h1
                      className="text-xl font-bold text-text cursor-pointer hover:text-brand transition-colors"
                      onClick={() => { setTitleDraft(project.title); setEditingTitle(true); }}
                      title="Click to edit"
                    >
                      {project.title}
                    </h1>
                  )}
                  {project.status === 'archived' && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-border text-muted">Archived</span>
                  )}
                </div>

                {/* Description */}
                {editingDesc ? (
                  <input
                    autoFocus
                    value={descDraft}
                    onChange={e => setDescDraft(e.target.value)}
                    onBlur={saveDesc}
                    onKeyDown={e => { if (e.key === 'Enter') saveDesc(); if (e.key === 'Escape') setEditingDesc(false); }}
                    placeholder="Add a description…"
                    className="text-sm bg-transparent border-b border-brand text-text outline-none w-full placeholder:text-muted"
                  />
                ) : (
                  <p
                    className={`text-sm cursor-pointer hover:text-text transition-colors ${project.description ? 'text-muted' : 'text-muted/40 italic'}`}
                    onClick={() => { setDescDraft(project.description ?? ''); setEditingDesc(true); }}
                    title="Click to edit"
                  >
                    {project.description || 'Add a description…'}
                  </p>
                )}

                {/* Stats strip */}
                <div className="flex items-center gap-2 mt-2 text-[11px] text-muted flex-wrap">
                  <span>{activeTasks.length} open task{activeTasks.length !== 1 ? 's' : ''}</span>
                  <span className="text-border">·</span>
                  <span>{project.resources.length} resource{project.resources.length !== 1 ? 's' : ''}</span>
                  <span className="text-border">·</span>
                  <span>{project.notes.length} note{project.notes.length !== 1 ? 's' : ''}</span>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Tabs */}
          <div className="flex gap-1 mb-6 bg-panel border border-border rounded-lg p-1 w-fit">
            {([
              { key: 'overview',   label: 'Overview' },
              { key: 'resources',  label: 'Resources' },
              { key: 'tasks',      label: 'Tasks' },
              { key: 'notes',      label: 'Notes' },
              { key: 'files',      label: 'Files' },
            ] as const).map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activeTab === t.key ? 'bg-brand text-white' : 'text-muted hover:text-text'
                }`}
              >
                {t.label}
                {t.key === 'tasks' && activeTasks.length > 0 && (
                  <span className={`ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${activeTab === 'tasks' ? 'bg-white/20' : 'surface-tint-strong text-brand'}`}>{activeTasks.length}</span>
                )}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >

          {/* ── Overview Tab ───────────────────────────────────────────────────── */}
          {activeTab === 'overview' && (
            <div className="space-y-6">

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-3">
                {/* Tasks card */}
                <button
                  onClick={() => setActiveTab('tasks')}
                  className="bg-panel border border-border rounded-xl p-4 text-left hover-border-tint transition-colors group"
                >
                  <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">Tasks</p>
                  <p className="text-2xl font-bold text-text">{activeTasks.length}</p>
                  <p className="text-[11px] text-muted mt-0.5">{doneTasks.length} done</p>
                  {projectTasks.length > 0 && (
                    <div className="mt-3 h-1 bg-border rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand rounded-full transition-all"
                        style={{ width: `${Math.round((doneTasks.length / projectTasks.length) * 100)}%` }}
                      />
                    </div>
                  )}
                </button>

                {/* Resources card */}
                <button
                  onClick={() => setActiveTab('resources')}
                  className="bg-panel border border-border rounded-xl p-4 text-left hover-border-tint transition-colors"
                >
                  <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">Resources</p>
                  <p className="text-2xl font-bold text-text">{project.resources.length}</p>
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {Array.from(new Set(project.resources.map(r => r.type))).map(type => {
                      const rt = RESOURCE_TYPES.find(t => t.type === type);
                      return rt ? (
                        <span key={type} className="text-[10px] text-muted capitalize border border-border rounded px-1.5 py-0.5">{rt.label}</span>
                      ) : null;
                    })}
                  </div>
                </button>

                {/* Notes card */}
                <button
                  onClick={() => setActiveTab('notes')}
                  className="bg-panel border border-border rounded-xl p-4 text-left hover-border-tint transition-colors"
                >
                  <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">Notes</p>
                  <p className="text-2xl font-bold text-text">{project.notes.length}</p>
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {(Object.keys(NOTE_TYPES) as NoteType[]).map(type => {
                      const count = project.notes.filter(n => n.type === type).length;
                      return count > 0 ? (
                        <span key={type} className={`text-[10px] px-1.5 py-0.5 rounded border ${NOTE_TYPES[type].border} ${NOTE_TYPES[type].color}`}>{count} {NOTE_TYPES[type].label.toLowerCase()}</span>
                      ) : null;
                    })}
                  </div>
                </button>
              </div>

              {/* Open tasks preview */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-text">Open Tasks</h3>
                  <button
                    onClick={() => { setActiveTab('tasks'); setAddingTask(true); }}
                    className="text-xs text-muted hover:text-brand transition-colors"
                  >
                    + Add
                  </button>
                </div>
                {activeTasks.length === 0 ? (
                  <p className="text-sm text-muted/60 py-3">No open tasks. Add one or ask Modus to help plan.</p>
                ) : (
                  <div className="space-y-1.5">
                    {activeTasks.slice(0, 5).map(t => (
                      <div key={t.id} className="flex items-center gap-3 group px-2 py-1.5 rounded-lg hover:bg-panel transition-colors">
                        <button
                          onClick={() => toggleTask(t.id, t.done)}
                          className="w-4 h-4 rounded border border-border hover:border-brand flex items-center justify-center shrink-0 transition-colors"
                        />
                        <span className="flex-1 text-sm text-text">{t.title}</span>
                      </div>
                    ))}
                    {activeTasks.length > 5 && (
                      <button
                        onClick={() => setActiveTab('tasks')}
                        className="text-xs text-muted hover:text-brand transition-colors px-2 py-1"
                      >
                        View all {activeTasks.length} →
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Pinned resources */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-text">Resources</h3>
                  <button
                    onClick={() => { setActiveTab('resources'); setShowPicker(true); }}
                    className="text-xs text-muted hover:text-brand transition-colors"
                  >
                    + Add
                  </button>
                </div>
                {project.resources.length === 0 ? (
                  <p className="text-sm text-muted/60 py-3">No resources pinned. Pin repos, docs, and channels to scope Modus&apos;s context.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {project.resources.map((r, i) => {
                      const rt = RESOURCE_TYPES.find(t => t.type === r.type);
                      const inner = (
                        <div className="flex items-center gap-2 bg-bg border border-border rounded-lg px-3 py-2 hover-border-tint transition-colors">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-muted shrink-0">
                            <path d={rt?.d ?? ''} />
                          </svg>
                          <span className="text-xs font-medium text-text truncate max-w-[120px]">{r.name}</span>
                        </div>
                      );
                      return r.url ? (
                        <a key={i} href={r.url} target="_blank" rel="noopener noreferrer">{inner}</a>
                      ) : (
                        <div key={i}>{inner}</div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Recent notes */}
              {project.notes.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-text">Recent Notes</h3>
                    <button onClick={() => setActiveTab('notes')} className="text-xs text-muted hover:text-brand transition-colors">+ Add</button>
                  </div>
                  <div className="space-y-2">
                    {[...project.notes].reverse().slice(0, 3).map(note => (
                      <div
                        key={note.id}
                        className={`bg-panel border rounded-xl px-4 py-3 ${note.type ? NOTE_TYPES[note.type].border : 'border-border'}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          {note.type && (
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${NOTE_TYPES[note.type].bg} ${NOTE_TYPES[note.type].color}`}>
                              {NOTE_TYPES[note.type].label}
                            </span>
                          )}
                          <span className="text-[11px] text-muted">{note.date}</span>
                        </div>
                        <p className="text-sm text-text line-clamp-2">{note.content}</p>
                      </div>
                    ))}
                    {project.notes.length > 3 && (
                      <button onClick={() => setActiveTab('notes')} className="text-xs text-muted hover:text-brand transition-colors px-1">
                        View all {project.notes.length} →
                      </button>
                    )}
                  </div>
                </div>
              )}

            </div>
          )}

          {/* ── Resources Tab ──────────────────────────────────────────────────── */}
          {activeTab === 'resources' && (
            <div className="space-y-3">
              {project.resources.length === 0 && !showPicker && (
                <div className="text-center py-10 bg-panel border border-dashed border-border rounded-xl">
                  <p className="text-muted text-sm mb-1">No resources pinned yet.</p>
                  <p className="text-muted/60 text-xs mb-4">Pin repos, docs, channels, and files to scope Modus&apos;s context to this project.</p>
                  <button
                    onClick={() => setShowPicker(true)}
                    className="text-sm text-brand hover:underline"
                  >
                    + Add your first resource
                  </button>
                </div>
              )}

              {/* Pinned resource list */}
              <div className="space-y-2">
                {project.resources.map((r, i) => {
                  const rt = RESOURCE_TYPES.find(t => t.type === r.type);
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: i * 0.04 }}
                      className="flex items-center gap-3 bg-panel border border-border rounded-lg px-4 py-3 group"
                    >
                      <div className="w-7 h-7 rounded-md bg-bg border border-border flex items-center justify-center shrink-0">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-muted">
                          <path d={rt?.d ?? ''} />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-text hover:text-brand transition-colors truncate block" onClick={e => e.stopPropagation()}>
                            {r.name}
                          </a>
                        ) : (
                          <p className="text-sm font-medium text-text truncate">{r.name}</p>
                        )}
                        <p className="text-[11px] text-muted capitalize">{r.type}</p>
                      </div>
                      <button
                        onClick={() => unpinResource(i)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-red-400 p-1 rounded"
                        title="Unpin"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </motion.div>
                  );
                })}
              </div>

              {/* Add resource button */}
              {project.resources.length > 0 && !showPicker && (
                <button
                  onClick={() => setShowPicker(true)}
                  className="flex items-center gap-2 text-sm text-muted hover:text-brand transition-colors px-2 py-1 rounded-lg hover-surface-tint"
                >
                  <span className="text-base leading-none">+</span> Add resource
                </button>
              )}

              {/* Resource picker */}
              <AnimatePresence>
                {showPicker && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.2 }}
                    className="bg-panel border border-border rounded-xl p-4 space-y-4"
                  >
                    {/* Type selector */}
                    <div>
                      <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Source</p>
                      <div className="flex gap-2 flex-wrap">
                        {RESOURCE_TYPES.map(rt => (
                          <button
                            key={rt.type}
                            onClick={() => {
                              setPickerType(rt.type);
                              setAvailableResources([]);
                              if (rt.type !== 'url') loadPickerResources(rt.type);
                            }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                              pickerType === rt.type
                                ? 'surface-tint border-brand/40 text-brand'
                                : 'border-border bg-bg text-muted hover:text-text hover-border-tint'
                            }`}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                              <path d={rt.d} />
                            </svg>
                            {rt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Items list */}
                    {pickerType && pickerType !== 'url' && (
                      <div>
                        <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                          {pickerType === 'github' ? 'Repositories' : pickerType === 'notion' ? 'Pages' : pickerType === 'slack' ? 'Channels' : 'Files'}
                        </p>
                        {loadingResources ? (
                          <div className="flex items-center gap-2 py-4 text-muted text-sm">
                            <div className="w-3.5 h-3.5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                            Loading…
                          </div>
                        ) : availableResources.length === 0 ? (
                          <div className="py-3">
                            <p className="text-sm text-muted mb-2">
                              {pickerType === 'github' ? 'No repositories found.' : pickerType === 'notion' ? 'No pages found.' : pickerType === 'slack' ? 'No channels found.' : 'No files found.'}
                            </p>
                            <p className="text-xs text-muted/70">
                              {pickerType === 'drive' || pickerType === 'notion'
                                ? `Connect ${pickerType === 'drive' ? 'Google' : 'Notion'} in `
                                : `Connect ${pickerType === 'github' ? 'GitHub' : 'Slack'} in `}
                              <a href="/settings?tab=connectors" className="text-brand underline">Settings → Connectors</a>
                              {pickerType === 'slack' ? '. Make sure Modus is added to the channels you want to pin.' : '.'}
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-1 max-h-48 overflow-y-auto">
                            {availableResources.map(r => {
                              const alreadyPinned = project.resources.some(pr => pr.name === r.name && pr.type === pickerType);
                              return (
                                <button
                                  key={r.id}
                                  disabled={alreadyPinned}
                                  onClick={() => {
                                    const res: PinnedResource = {
                                      type: pickerType,
                                      name: r.name,
                                      ...(r.url       ? { url:       r.url }       : {}),
                                      ...(r.repo      ? { repo:      r.repo }      : {}),
                                      ...(r.pageId    ? { pageId:    r.pageId }    : {}),
                                      ...(r.channelId ? { channelId: r.channelId } : {}),
                                      ...(r.fileId    ? { fileId:    r.fileId }    : {}),
                                    };
                                    pinResource(res);
                                  }}
                                  className={`flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                                    alreadyPinned
                                      ? 'text-muted/40 cursor-default'
                                      : 'text-text hover:bg-bg hover:text-brand'
                                  }`}
                                >
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium truncate">{r.name}</p>
                                    {r.sub && <p className="text-[11px] text-muted truncate">{r.sub}</p>}
                                  </div>
                                  {alreadyPinned && <span className="text-[10px] text-muted shrink-0">Pinned</span>}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* URL form */}
                    {pickerType === 'url' && (
                      <div className="space-y-2">
                        <input
                          autoFocus
                          value={urlDraft.name}
                          onChange={e => setUrlDraft(d => ({ ...d, name: e.target.value }))}
                          placeholder="Name (e.g. Design spec)"
                          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-muted outline-none focus:border-brand transition-colors"
                        />
                        <input
                          value={urlDraft.url}
                          onChange={e => setUrlDraft(d => ({ ...d, url: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter' && urlDraft.name.trim() && urlDraft.url.trim()) pinUrl(); }}
                          placeholder="https://…"
                          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-muted outline-none focus:border-brand transition-colors"
                        />
                        <button
                          onClick={pinUrl}
                          disabled={!urlDraft.name.trim() || !urlDraft.url.trim()}
                          className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand/90 disabled:opacity-50 transition-colors"
                        >
                          Add URL
                        </button>
                      </div>
                    )}

                    <div className="flex justify-end">
                      <button
                        onClick={() => { setShowPicker(false); setPickerType(null); setAvailableResources([]); }}
                        className="text-xs text-muted hover:text-text transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* ── Tasks Tab ─────────────────────────────────────────────────────── */}
          {activeTab === 'tasks' && (
            <div className="space-y-4">
              {!addingTask ? (
                <button
                  onClick={() => setAddingTask(true)}
                  className="flex items-center gap-2 text-sm text-muted hover:text-brand transition-colors px-2 py-1 rounded-lg hover-surface-tint"
                >
                  <span className="text-base leading-none">+</span> Add task
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    ref={taskInputRef}
                    value={newTaskTitle}
                    onChange={e => setNewTaskTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addTask(); if (e.key === 'Escape') { setAddingTask(false); setNewTaskTitle(''); } }}
                    placeholder="Task title…"
                    className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-muted outline-none focus:border-brand transition-colors"
                  />
                  <button onClick={addTask} disabled={!newTaskTitle.trim()} className="px-3 py-2 bg-brand text-white text-xs font-medium rounded-lg hover:bg-brand/90 disabled:opacity-50 transition-colors">Add</button>
                  <button onClick={() => { setAddingTask(false); setNewTaskTitle(''); }} className="text-muted hover:text-text transition-colors"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </div>
              )}

              {activeTasks.length === 0 && doneTasks.length === 0 && (
                <p className="text-muted text-sm text-center py-8">No tasks yet.</p>
              )}

              <div className="space-y-1.5">
                {activeTasks.map(t => (
                  <div key={t.id} className="flex items-center gap-3 group px-2 py-1.5 rounded-lg hover:bg-panel transition-colors">
                    <button onClick={() => toggleTask(t.id, t.done)} className="w-4 h-4 rounded border border-border hover:border-brand flex items-center justify-center shrink-0 transition-colors" />
                    <span className="flex-1 text-sm text-text">{t.title}</span>
                    <button onClick={() => deleteTask(t.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-red-400 p-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                  </div>
                ))}
              </div>

              {doneTasks.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowDoneTasks(s => !s)}
                    className="flex items-center gap-1.5 text-xs text-muted hover:text-text transition-colors mb-2"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`w-3 h-3 transition-transform ${showDoneTasks ? 'rotate-180' : ''}`}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                    {doneTasks.length} completed
                  </button>
                  {showDoneTasks && (
                    <div className="space-y-1.5">
                      {doneTasks.map(t => (
                        <div key={t.id} className="flex items-center gap-3 group px-2 py-1.5 rounded-lg hover:bg-panel transition-colors opacity-50">
                          <button onClick={() => toggleTask(t.id, t.done)} className="w-4 h-4 rounded border border-brand surface-tint-strong flex items-center justify-center shrink-0">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5 text-brand">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </button>
                          <span className="flex-1 text-sm text-muted line-through">{t.title}</span>
                          <button onClick={() => deleteTask(t.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-red-400 p-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Files Tab: the workspace every chat in this project shares ──────── */}
          {activeTab === 'files' && <FilesBrowser workspaceId={`project-${id}`} />}

          {/* ── Notes Tab ─────────────────────────────────────────────────────── */}
          {activeTab === 'notes' && (
            <div className="space-y-4">
              {/* Note input */}
              <div className="bg-panel border border-border rounded-xl p-4 space-y-3">
                <textarea
                  value={newNoteContent}
                  onChange={e => setNewNoteContent(e.target.value)}
                  placeholder="Add a note, win, blocker, or idea…"
                  rows={3}
                  className="w-full bg-transparent text-sm text-text placeholder:text-muted outline-none resize-none"
                />
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex gap-1.5 flex-wrap">
                    {(Object.keys(NOTE_TYPES) as NoteType[]).map(type => (
                      <button
                        key={type}
                        onClick={() => setSelectedNoteType(t => t === type ? undefined : type)}
                        className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full border transition-colors ${
                          selectedNoteType === type
                            ? `${NOTE_TYPES[type].bg} ${NOTE_TYPES[type].border} ${NOTE_TYPES[type].color}`
                            : 'border-border text-muted hover:text-text'
                        }`}
                      >
                        {NOTE_TYPES[type].label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={addNote}
                    disabled={!newNoteContent.trim()}
                    className="text-xs px-3 py-1.5 bg-brand text-white rounded-lg hover:bg-brand/90 disabled:opacity-50 transition-colors font-medium"
                  >
                    Save note
                  </button>
                </div>
              </div>

              {/* Filter chips */}
              <div className="flex gap-1.5 flex-wrap">
                {(['all', ...Object.keys(NOTE_TYPES)] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setNoteFilter(f as 'all' | NoteType)}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                      noteFilter === f
                        ? 'surface-tint border-brand/40 text-brand'
                        : 'border-border text-muted hover:text-text'
                    }`}
                  >
                    {f === 'all' ? 'All' : NOTE_TYPES[f as NoteType].label}
                  </button>
                ))}
              </div>

              {/* Notes list */}
              {sortedNotes.length === 0 ? (
                <p className="text-muted text-sm text-center py-8">No notes yet.</p>
              ) : (
                <div className="space-y-3">
                  {sortedNotes.map(note => (
                    <div
                      key={note.id}
                      className={`bg-panel border rounded-xl p-4 ${note.type ? NOTE_TYPES[note.type].border : 'border-border'}`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {note.type && (
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${NOTE_TYPES[note.type].bg} ${NOTE_TYPES[note.type].color}`}>
                              {NOTE_TYPES[note.type].label}
                            </span>
                          )}
                          {note.pinned && <span className="text-[10px] text-muted">📌</span>}
                          <span className="text-[11px] text-muted">{note.date}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => togglePinNote(note.id)} className="p-1 text-muted hover:text-text transition-colors" title={note.pinned ? 'Unpin' : 'Pin'}>
                            <svg viewBox="0 0 24 24" fill={note.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                            </svg>
                          </button>
                          <button onClick={() => { setEditingNoteId(note.id); setEditDraft(note.content); }} className="p-1 text-muted hover:text-text transition-colors">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          <button onClick={() => deleteNote(note.id)} className="p-1 text-muted hover:text-red-400 transition-colors">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      {editingNoteId === note.id ? (
                        <div>
                          <textarea
                            ref={editNoteRef}
                            value={editDraft}
                            onChange={e => setEditDraft(e.target.value)}
                            rows={3}
                            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-brand transition-colors resize-none"
                          />
                          <div className="flex gap-2 mt-2">
                            <button onClick={() => updateNote(note.id)} className="text-xs px-3 py-1.5 bg-brand text-white rounded-lg hover:bg-brand/90 transition-colors">Save</button>
                            <button onClick={() => setEditingNoteId(null)} className="text-xs px-3 py-1.5 border border-border text-muted hover:text-text rounded-lg transition-colors">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-text whitespace-pre-wrap leading-relaxed">{note.content}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          </motion.div>
          </AnimatePresence>

        </div>
      </div>

      {/* ── Right column: chat panel ──────────────────────────────────────────── */}
      <div
        className="hidden md:flex shrink-0 border-l border-border flex-col relative"
        style={{ width: chatWidth }}
      >
        {/* Drag handle — left edge */}
        <div
          className="absolute inset-y-0 left-0 w-1 cursor-col-resize hover-surface-tint0 active:bg-brand/60 transition-colors z-10"
          onMouseDown={startChatDrag}
        />

        {/* Chat tabs */}
        <div className="flex items-center gap-1 px-3 pt-3 pb-0 border-b border-border overflow-x-auto shrink-0">
          {/* Main chat tab */}
          {(() => {
            const isActive = activeChatId === mainChatId;
            return (
              <button
                onClick={() => {
                  const main = allChats.find(c => c.id === mainChatId);
                  if (main) switchChat(main);
                  else { setActiveChatId(mainChatId); }
                }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  isActive ? 'text-brand border-brand' : 'text-muted border-transparent hover:text-text'
                }`}
              >
                MODUS
              </button>
            );
          })()}

          {/* Extra chat tabs */}
          {extraChats.map(chat => {
            const isActive = activeChatId === chat.id;
            return (
              <div key={chat.id} className="flex items-center group shrink-0">
                {renamingChatId === chat.id ? (
                  <input
                    ref={renameInputRef}
                    value={renamingTitle}
                    onChange={e => setRenamingTitle(e.target.value)}
                    onBlur={() => saveRenameChat(chat.id, renamingTitle)}
                    onKeyDown={e => { if (e.key === 'Enter') saveRenameChat(chat.id, renamingTitle); if (e.key === 'Escape') setRenamingChatId(null); }}
                    onClick={e => e.stopPropagation()}
                    className="w-24 text-xs bg-transparent border-b border-brand text-text outline-none px-1 py-2"
                  />
                ) : (
                  <button
                    onClick={() => switchChat(chat)}
                    onDoubleClick={() => { setRenamingChatId(chat.id); setRenamingTitle(chat.title); }}
                    title={`${chat.title} · double-click to rename`}
                    className={`px-3 py-2 rounded-t-lg text-xs font-medium whitespace-nowrap border-b-2 transition-colors max-w-[100px] truncate ${
                      isActive ? 'text-brand border-brand' : 'text-muted border-transparent hover:text-text'
                    }`}
                  >
                    {chat.title}
                  </button>
                )}
                <button
                  onClick={e => { e.stopPropagation(); deleteChat(chat.id); }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-red-400 text-xs px-0.5 py-2"
                  title="Close"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            );
          })}

          <button
            onClick={startNewChat}
            className="text-muted hover:text-brand transition-colors text-sm px-2 py-2 shrink-0"
            title="New chat"
          >
            +
          </button>
        </div>

        {/* Messages */}
        <div ref={messagesScrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.map((m, idx) => (
            <MessageBubble
              key={m.id}
              message={m}
              isStreaming={isLoading && idx === messages.length - 1 && m.role === 'assistant'}
            />
          ))}
          {/* Was a bare `isLoading`, the inverse of the bug the other three had:
              the dots stayed pinned under the answer for the whole response
              instead of vanishing too early. Both are the same missing idea —
              the indicator belongs to "no visible text yet", not to the request. */}
          {isAwaitingAssistantText(messages, isLoading) && (
            <div className="flex items-center gap-2 text-muted">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Quick chips */}
        <div className="shrink-0 border-t border-border px-3 py-2 flex gap-1.5 flex-wrap">
          {["What's blocking?", "Next steps", "Summarize resources", "Daily standup"].map(chip => (
            <button
              key={chip}
              onClick={() => { setChatError(null); append({ role: 'user', content: chip }); }}
              className="text-[11px] px-2.5 py-1 rounded-full border border-border text-muted hover:text-brand hover-border-tint transition-colors"
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Error banner */}
        {chatError && (
          <div className="shrink-0 mx-3 mt-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center justify-between gap-2">
            <p className="text-xs text-red-400">{chatError}</p>
            <button onClick={() => setChatError(null)} className="text-red-400 hover:text-red-300 shrink-0" aria-label="Dismiss">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-3 h-3"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        )}

        {/* Model switcher */}
        <div className="shrink-0 border-t border-border px-3 py-2 flex items-center">
          {modelError && <p role="alert" className="text-xs text-red-500">{modelError}</p>}
          <ModelSwitcher value={modelChoice} onChange={handleModelChange} plan={plan} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-3 border-t border-border">
          <div className="flex items-end gap-2 bg-panel border border-border rounded-xl px-3 py-2">
            <textarea
              value={input}
              onChange={handleInputChange}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e as unknown as React.FormEvent); } }}
              placeholder="Ask Modus about this project…"
              rows={1}
              className="flex-1 bg-transparent text-sm text-text placeholder:text-muted outline-none resize-none max-h-32"
              style={{ height: 'auto', minHeight: '1.5rem' }}
            />
            {isLoading ? (
              // Same Stop as /chat: there was no way to stop a reply here.
              <button type="button" onClick={stop} aria-label="Stop" title="Stop"
                className="w-7 h-7 rounded-lg bg-brand flex items-center justify-center hover:bg-brand/90 shrink-0">
                <span className="w-2.5 h-2.5 rounded-[2px] bg-white" />
              </button>
            ) : (
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="w-7 h-7 rounded-lg bg-brand flex items-center justify-center hover:bg-brand/90 disabled:opacity-40 transition-colors shrink-0"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-white">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ProjectDetailPage() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  return <ProjectDetailPageContent key={`${user?.uid ?? 'guest'}:${id}`} />;
}
