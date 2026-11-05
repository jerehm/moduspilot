import { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Linking,
  TextInput, FlatList, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import {
  doc, onSnapshot, updateDoc, deleteDoc, arrayUnion, arrayRemove,
  collection, query, where, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { DetailHeader } from '@/components/DetailHeader';
import { Icon, type IconName } from '@/components/Icon';
import { useSheets } from '@/components/ui/Sheets';
import { useThemeColors } from '@/lib/theme';
import { Markdown } from '@/components/Markdown';
import { GlassView } from '@/components/ui/Glass';
import { streamChat, type Message, type ProjectContext } from '@/lib/api';
import { loadConversation, saveMessages, deriveTitle, type StoredMessage } from '@/lib/conversations';
import { haptics } from '@/lib/haptics';

// ── Types ────────────────────────────────────────────────────────────────────

interface Note { id: string; content: string; date: string }
interface Resource { type: string; label?: string; url?: string; title?: string }
interface Project {
  title: string
  description?: string
  status: string
  resources: Resource[]
  notes: Note[]
}
interface ProjectTask { id: string; title: string; done: boolean }
interface ProjectConv { id: string; title: string; updatedAt: Date }
type ChatMsg = { id: string; role: 'user' | 'assistant'; content: string }
type Tab = 'tasks' | 'resources' | 'notes' | 'modus'

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'tasks',     label: 'Tasks',     icon: 'checklist' },
  { key: 'resources', label: 'Resources', icon: 'link' },
  { key: 'notes',     label: 'Notes',     icon: 'description' },
  { key: 'modus',     label: 'MODUS',     icon: 'auto-awesome' },
]

const RESOURCE_ICON: Record<string, IconName> = {
  github: 'code', notion: 'description', slack: 'tag', drive: 'folder', url: 'link',
}

const QUICK_CHIPS = ["What's blocking?", 'Next steps', 'Daily standup']

let msgCount = 0
function newId() { return `pm_${Date.now()}_${++msgCount}` }

// ── Screen ───────────────────────────────────────────────────────────────────

export default function ProjectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user } = useAuth()
  const c = useThemeColors()
  const { actionSheet, prompt, confirm } = useSheets()

  const [project, setProject]   = useState<Project | null>(null)
  const [tasks, setTasks]       = useState<ProjectTask[]>([])
  const [activeTab, setActiveTab] = useState<Tab>('tasks')

  // Multi-conversation state
  const [convs, setConvs]           = useState<ProjectConv[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [chatMsgs, setChatMsgs]     = useState<ChatMsg[]>([])
  const [chatInput, setChatInput]   = useState('')
  const [streaming, setStreaming]   = useState(false)
  const abortRef    = useRef<AbortController | null>(null)
  const listRef     = useRef<FlatList>(null)
  const mountedRef  = useRef(true)
  const savingRef   = useRef(false)
  const chatMsgsRef = useRef<ChatMsg[]>([])
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null)

  useEffect(() => {
    chatMsgsRef.current = chatMsgs
  }, [chatMsgs])

  useEffect(() => () => {
    mountedRef.current = false
    abortRef.current?.abort()
  }, [])

  // Load project doc
  useEffect(() => {
    if (!user || !id) return
    return onSnapshot(doc(db, 'users', user.uid, 'projects', id), snap => {
      const d = snap.data()
      if (!d) { setProject(null); return }
      setProject({
        title: d.title ?? 'Untitled',
        description: d.description,
        status: d.status ?? 'active',
        resources: (d.resources as Resource[]) ?? [],
        notes: (d.notes as Note[]) ?? [],
      })
    })
  }, [user, id])

  // Load tasks
  useEffect(() => {
    if (!user || !id) return
    const q = query(collection(db, 'users', user.uid, 'tasks'), where('projectId', '==', id))
    return onSnapshot(q, snap => {
      setTasks(snap.docs.map(d => ({ id: d.id, title: d.data().title ?? 'Untitled', done: d.data().done ?? false })))
    })
  }, [user, id])

  // Subscribe to project conversations
  useEffect(() => {
    if (!user || !id) return
    const q = query(collection(db, 'users', user.uid, 'conversations'), where('projectId', '==', id))
    return onSnapshot(q, snap => {
      const list: ProjectConv[] = snap.docs
        .filter(d => !d.data().deleted)
        .map(d => ({ id: d.id, title: d.data().title ?? 'Chat', updatedAt: d.data().updatedAt?.toDate?.() ?? new Date() }))
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      setConvs(list)
      if (list.length > 0 && !activeConvId) openConv(list[0].id)
    })
  }, [user, id])

  const projRef = () => doc(db, 'users', user!.uid, 'projects', id!)

  // ── Conversation helpers ────────────────────────────────────────────────────

  async function openConv(convId: string) {
    if (!user || convId === activeConvId) return
    setActiveConvId(convId)
    try {
      const { messages: stored } = await loadConversation(user.uid, convId)
      if (!mountedRef.current) return
      if (stored.length === 0 && project) {
        setChatMsgs([{ id: '0', role: 'assistant', content: `"${project.title}" is ready. Ask me to help plan, break down tasks, or explore next steps.` }])
      } else {
        setChatMsgs(stored.map(m => ({ id: m.id || newId(), role: m.role as ChatMsg['role'], content: m.content })))
      }
    } catch (e) {
      console.error('[openConv]', e)
      if (mountedRef.current) setChatMsgs([{ id: '0', role: 'assistant', content: 'Failed to load conversation. Pull to retry.' }])
    }
  }

  async function newChat() {
    if (!user || !project || !id) return
    haptics.medium()
    const ref = await addDoc(collection(db, 'users', user.uid, 'conversations'), {
      title: 'New chat', projectId: id, messages: [], deleted: false,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })
    setActiveConvId(ref.id)
    setChatMsgs([{ id: '0', role: 'assistant', content: `"${project.title}" is ready. What would you like to work on?` }])
    setChatInput('')
  }

  async function persist(msgs: ChatMsg[], convId: string) {
    if (!user || savingRef.current) return
    savingRef.current = true
    try {
      const stored: StoredMessage[] = msgs.filter(m => m.id !== '0').map(m => ({ id: m.id, role: m.role, content: m.content }))
      await saveMessages(user.uid, convId, stored, deriveTitle(stored) || undefined)
    } catch { } finally { savingRef.current = false }
  }

  async function sendChat(text: string) {
    const trimmed = text.trim()
    if (!trimmed || streaming || !project || !user) return
    haptics.select()
    setChatInput('')

    let convId = activeConvId
    if (!convId) {
      const ref = await addDoc(collection(db, 'users', user.uid, 'conversations'), {
        title: 'New chat', projectId: id, messages: [], deleted: false,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })
      convId = ref.id
      setActiveConvId(convId)
    }

    // Capture messages BEFORE state update — this is the correct history to send
    const apiMsgs: Message[] = [
      ...chatMsgsRef.current.filter(m => m.id !== '0').map(m => ({ role: m.role as Message['role'], content: m.content })),
      { role: 'user', content: trimmed },
    ]

    const userMsg: ChatMsg = { id: newId(), role: 'user', content: trimmed }
    const asstMsg: ChatMsg = { id: newId(), role: 'assistant', content: '' }
    let current: ChatMsg[] = []
    setChatMsgs(prev => { current = [...prev, userMsg, asstMsg]; chatMsgsRef.current = current; return current })
    setStreamingMsgId(asstMsg.id)
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80)

    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStreaming(true)

    const ctx: ProjectContext = { id: id!, title: project.title, description: project.description }

    try {
      for await (const chunk of streamChat(apiMsgs, { signal: ctrl.signal, projectContext: ctx })) {
        if (!mountedRef.current) break
        setChatMsgs(prev => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + chunk }
          current = next
          chatMsgsRef.current = next
          return next
        })
        listRef.current?.scrollToEnd({ animated: false })
      }
      // A reply that completed with nothing used to leave a blank bubble here.
      if (mountedRef.current) {
        setChatMsgs(prev => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.role === 'assistant' && !last.content.trim()) {
            next[next.length - 1] = { ...last, content: 'The model returned an empty response. Try again, or switch models.' }
            current = next
          }
          return next
        })
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError' && mountedRef.current) {
        const text = err.name === 'StallError'
          ? 'The response stalled. Please try again.'
          : 'Something went wrong. Please try again.'
        setChatMsgs(prev => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.role === 'assistant' && !last.content) {
            next[next.length - 1] = { ...last, content: text }
            current = next
          }
          return next
        })
      }
    } finally {
      if (mountedRef.current) { setStreaming(false); setStreamingMsgId(null); abortRef.current = null; persist(current, convId) }
    }
  }

  // ── Overview / project helpers ──────────────────────────────────────────────

  async function editField(field: 'title' | 'description', label: string) {
    const text = await prompt({ title: label, defaultValue: field === 'title' ? project?.title : project?.description, multiline: field === 'description' })
    if (text != null) updateDoc(projRef(), { [field]: text.trim() }).catch(() => {})
  }

  async function addTask() {
    if (!user || !id) return
    const title = (await prompt({ title: 'New task', confirmLabel: 'Add' }))?.trim()
    if (!title) return
    addDoc(collection(db, 'users', user.uid, 'tasks'), { title, done: false, projectId: id, createdAt: serverTimestamp() }).catch(() => {})
  }

  async function deleteTask(t: ProjectTask) {
    if (!user) return
    deleteDoc(doc(db, 'users', user.uid, 'tasks', t.id)).catch(() => {})
  }

  function toggleTask(t: ProjectTask) {
    if (!user) return
    updateDoc(doc(db, 'users', user.uid, 'tasks', t.id), { done: !t.done }).catch(() => {})
  }

  async function addNote() {
    const content = (await prompt({ title: 'New note', multiline: true, confirmLabel: 'Add' }))?.trim()
    if (!content) return
    updateDoc(projRef(), { notes: arrayUnion({ id: `${Date.now()}`, content, date: new Date().toISOString().slice(0, 10) }) }).catch(() => {})
  }

  async function deleteNote(note: Note) {
    updateDoc(projRef(), { notes: arrayRemove(note) }).catch(() => {})
  }

  async function addResource() {
    const url = (await prompt({ title: 'Add resource URL', confirmLabel: 'Add' }))?.trim()
    if (!url) return
    const label = (await prompt({ title: 'Label (optional)', confirmLabel: 'Add' }))?.trim()
    updateDoc(projRef(), { resources: arrayUnion({ type: 'url', url, label: label || url }) }).catch(() => {})
  }

  async function deleteResource(r: Resource) {
    updateDoc(projRef(), { resources: arrayRemove(r) }).catch(() => {})
  }

  async function confirmDelete() {
    const ok = await confirm({ title: 'Delete project?', message: 'This permanently removes the project.', confirmLabel: 'Delete', destructive: true })
    if (ok) deleteDoc(projRef()).then(() => router.back()).catch(() => {})
  }

  function menu() {
    actionSheet({
      title: project?.title ?? 'Project',
      actions: [
        { label: 'Edit title', onPress: () => editField('title', 'Edit title') },
        { label: 'Edit description', onPress: () => editField('description', 'Edit description') },
        project?.status === 'active'
          ? { label: 'Mark complete', onPress: () => updateDoc(projRef(), { status: 'done' }).then(() => router.back()).catch(() => {}) }
          : { label: 'Reopen', onPress: () => updateDoc(projRef(), { status: 'active' }).catch(() => {}) },
        { label: 'Delete', destructive: true, onPress: confirmDelete },
      ],
    })
  }

  if (!project) {
    return (
      <SafeAreaView className="flex-1" edges={['top']}>
        <DetailHeader />
        <View className="flex-1 items-center justify-center"><Text className="text-muted">Loading…</Text></View>
      </SafeAreaView>
    )
  }

  const doneCount = tasks.filter(t => t.done).length
  const noChats   = convs.length === 0 && !activeConvId

  return (
    <SafeAreaView className="flex-1" edges={['top']}>
      <DetailHeader
        right={
          <TouchableOpacity onPress={menu} className="w-10 h-10 items-center justify-center rounded-2xl bg-surface border border-border">
            <Icon name="more-horiz" tone="text" size={22} />
          </TouchableOpacity>
        }
      />

      {/* Project header — always visible */}
      <TouchableOpacity onPress={() => editField('title', 'Edit title')} activeOpacity={0.7} className="px-4 pt-1 pb-3">
        <Text className="text-text font-display font-bold text-2xl tracking-tight" numberOfLines={1}>{project.title}</Text>
        {project.description ? (
          <Text className="text-muted text-sm mt-0.5" numberOfLines={2}>{project.description}</Text>
        ) : (
          <Text className="text-muted/50 text-sm mt-0.5">Tap to add description…</Text>
        )}
      </TouchableOpacity>

      {/* Tab bar */}
      <View className="border-b border-border">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, flexDirection: 'row', gap: 0 }}>
          {TABS.map(tab => {
            const active = activeTab === tab.key
            const badge  = tab.key === 'tasks' && tasks.length > 0 ? tasks.length : null
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                activeOpacity={0.7}
                className={`flex-row items-center gap-1.5 px-3 py-3 border-b-2 ${active ? 'border-brand' : 'border-transparent'}`}
              >
                <Icon name={tab.icon} size={14} color={active ? c.brand : c.muted} />
                <Text className={`text-sm font-semibold ${active ? 'text-brand' : 'text-muted'}`}>{tab.label}</Text>
                {badge && (
                  <View className={`px-1.5 py-0.5 rounded-full ${active ? 'bg-brand/20' : 'bg-surface-2'}`}>
                    <Text className={`text-[10px] font-bold ${active ? 'text-brand' : 'text-muted'}`}>{badge}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      </View>

      {/* ── Tasks tab ────────────────────────────────────────────────────────── */}
      {activeTab === 'tasks' && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }} showsVerticalScrollIndicator={false}>
          <View className="flex-row items-center justify-between">
            <Text className="text-muted text-xs font-semibold uppercase tracking-wider">
              {doneCount}/{tasks.length} done
            </Text>
            <TouchableOpacity onPress={addTask} className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand/10 border border-brand/25">
              <Icon name="add" tone="brand" size={16} />
              <Text className="text-brand text-xs font-semibold">New task</Text>
            </TouchableOpacity>
          </View>

          {tasks.length === 0 ? (
            <EmptyState icon="checklist" title="No tasks yet" sub="Add your first task to start tracking work." />
          ) : (
            <View className="bg-surface border border-border rounded-2xl overflow-hidden">
              {tasks.map((t, i) => (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => toggleTask(t)}
                  onLongPress={() => deleteTask(t)}
                  activeOpacity={0.7}
                  className={`flex-row items-center gap-3 px-4 py-3.5 ${i > 0 ? 'border-t border-border' : ''}`}
                >
                  <View style={{
                    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
                    borderColor: t.done ? c.brand : c.border, backgroundColor: t.done ? c.brand : 'transparent',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {t.done && <Icon name="check" color="#fff" size={14} />}
                  </View>
                  <Text className={`flex-1 text-[15px] ${t.done ? 'text-muted line-through' : 'text-text'}`}>{t.title}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <Text className="text-muted/50 text-xs text-center">Long-press a task to delete</Text>
        </ScrollView>
      )}

      {/* ── Resources tab ────────────────────────────────────────────────────── */}
      {activeTab === 'resources' && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }} showsVerticalScrollIndicator={false}>
          <View className="flex-row items-center justify-between">
            <Text className="text-muted text-xs font-semibold uppercase tracking-wider">
              {project.resources.length} link{project.resources.length !== 1 ? 's' : ''}
            </Text>
            <TouchableOpacity onPress={addResource} className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand/10 border border-brand/25">
              <Icon name="add" tone="brand" size={16} />
              <Text className="text-brand text-xs font-semibold">Add link</Text>
            </TouchableOpacity>
          </View>

          {project.resources.length === 0 ? (
            <EmptyState icon="link" title="No resources yet" sub="Add links to docs, repos, designs, or anything relevant." />
          ) : (
            <View className="bg-surface border border-border rounded-2xl overflow-hidden">
              {project.resources.map((r, i) => (
                <View key={i} className={`flex-row items-center gap-3 px-4 py-3.5 ${i > 0 ? 'border-t border-border' : ''}`}>
                  <View className="w-8 h-8 rounded-xl bg-brand/10 items-center justify-center">
                    <Icon name={RESOURCE_ICON[r.type] ?? 'link'} tone="brand" size={17} />
                  </View>
                  <TouchableOpacity className="flex-1" onPress={() => { if (r.url) Linking.openURL(r.url).catch(() => {}); }} activeOpacity={0.7}>
                    <Text className="text-text text-[15px] font-medium" numberOfLines={1}>{r.label ?? r.title ?? r.url ?? r.type}</Text>
                    {r.url && <Text className="text-muted text-xs mt-0.5" numberOfLines={1}>{r.url}</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => deleteResource(r)} className="p-1.5" activeOpacity={0.7}>
                    <Icon name="close" tone="muted" size={18} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {/* ── Notes tab ────────────────────────────────────────────────────────── */}
      {activeTab === 'notes' && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }} showsVerticalScrollIndicator={false}>
          <View className="flex-row items-center justify-between">
            <Text className="text-muted text-xs font-semibold uppercase tracking-wider">
              {project.notes.length} note{project.notes.length !== 1 ? 's' : ''}
            </Text>
            <TouchableOpacity onPress={addNote} className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand/10 border border-brand/25">
              <Icon name="add" tone="brand" size={16} />
              <Text className="text-brand text-xs font-semibold">New note</Text>
            </TouchableOpacity>
          </View>

          {project.notes.length === 0 ? (
            <EmptyState icon="description" title="No notes yet" sub="Capture ideas, decisions, or context about this project." />
          ) : (
            <View className="gap-3">
              {project.notes.map((n, i) => (
                <View key={n.id ?? i} className="bg-surface border border-border rounded-2xl p-4 gap-2">
                  <Text className="text-text text-[15px] leading-6">{n.content}</Text>
                  <View className="flex-row items-center justify-between">
                    <Text className="text-muted text-xs">{n.date}</Text>
                    <TouchableOpacity onPress={() => deleteNote(n)} className="p-1" activeOpacity={0.7}>
                      <Icon name="delete-outline" tone="muted" size={17} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {/* ── MODUS tab ────────────────────────────────────────────────────────── */}
      {activeTab === 'modus' && (
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {/* Conversation chip row */}
          <View className="border-b border-border">
            <ScrollView
              horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 8, flexDirection: 'row', alignItems: 'center' }}
            >
              {convs.map(conv => (
                <TouchableOpacity
                  key={conv.id}
                  onPress={() => openConv(conv.id)}
                  activeOpacity={0.7}
                  className={`px-3.5 py-1.5 rounded-full border ${activeConvId === conv.id ? 'bg-brand/10 border-brand/40' : 'bg-surface border-border'}`}
                >
                  <Text className={`text-xs font-medium ${activeConvId === conv.id ? 'text-brand' : 'text-text'}`} numberOfLines={1}>{conv.title}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity onPress={newChat} activeOpacity={0.7} className="w-7 h-7 rounded-full border border-border bg-surface items-center justify-center">
                <Icon name="add" tone="brand" size={18} />
              </TouchableOpacity>
            </ScrollView>
          </View>

          {noChats ? (
            <View className="flex-1 items-center justify-center gap-4 px-8">
              <View className="w-12 h-12 rounded-2xl bg-brand/10 items-center justify-center">
                <Icon name="auto-awesome" tone="brand" size={24} />
              </View>
              <Text className="text-text font-semibold text-center">Ask MODUS about this project</Text>
              <Text className="text-muted text-sm text-center">Plan tasks, explore next steps, or get unstuck.</Text>
              <View className="flex-row flex-wrap justify-center gap-2">
                {QUICK_CHIPS.map(chip => (
                  <TouchableOpacity key={chip} onPress={() => sendChat(chip)} activeOpacity={0.8} className="px-3 py-1.5 rounded-full border border-brand/30 bg-brand/5">
                    <Text className="text-brand text-xs font-medium">{chip}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : (
            <>
              <FlatList
                ref={listRef}
                data={chatMsgs}
                keyExtractor={m => m.id}
                contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 8 }}
                onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => {
                  const isTyping = streaming && item.id === streamingMsgId && !item.content
                  return (
                    <View className={`flex-row ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <View
                        className={`rounded-2xl px-4 py-3 ${item.role === 'user' ? 'bg-brand rounded-tr-sm' : 'bg-surface border border-border rounded-tl-sm'}`}
                        style={{ maxWidth: '85%' }}
                      >
                        {item.role === 'user'
                          ? <Text className="text-white text-[15px] leading-6">{item.content}</Text>
                          : isTyping
                            ? <Text className="text-muted text-base tracking-widest">· · ·</Text>
                            : <Markdown text={item.content || 'Something went wrong. Try again.'} />
                        }
                      </View>
                    </View>
                  )
                }}
              />
              {chatMsgs.filter(m => m.role === 'user').length === 0 && (
                <View className="flex-row flex-wrap gap-2 px-4 pb-2">
                  {QUICK_CHIPS.map(chip => (
                    <TouchableOpacity key={chip} onPress={() => sendChat(chip)} activeOpacity={0.8} className="px-3 py-1.5 rounded-full border border-brand/30 bg-brand/5">
                      <Text className="text-brand text-xs font-medium">{chip}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}

          <View className="px-4 pb-7 pt-1">
            <GlassView radius={24} intensity={50}>
              <View className="px-3 py-2 flex-row items-end gap-2">
                <TextInput
                  className="flex-1 text-text text-base px-2 py-2"
                  style={{ maxHeight: 100 }}
                  placeholder="Ask MODUS about this project…"
                  placeholderTextColor={c.muted}
                  value={chatInput}
                  onChangeText={setChatInput}
                  multiline
                  editable={!streaming}
                  onSubmitEditing={() => sendChat(chatInput)}
                />
                <TouchableOpacity
                  onPress={() => sendChat(chatInput)}
                  activeOpacity={0.8}
                  disabled={!chatInput.trim() || streaming}
                  className="bg-brand items-center justify-center"
                  style={{ width: 36, height: 36, borderRadius: 12, opacity: (!chatInput.trim() || streaming) ? 0.45 : 1 }}
                >
                  <Icon name="arrow-upward" color="#fff" size={18} />
                </TouchableOpacity>
              </View>
            </GlassView>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function EmptyState({ icon, title, sub }: { icon: IconName; title: string; sub: string }) {
  const c = useThemeColors()
  return (
    <View className="flex-1 items-center justify-center gap-3 py-16 px-6">
      <View className="w-12 h-12 rounded-2xl bg-surface-2 border border-border items-center justify-center">
        <Icon name={icon} tone="muted" size={22} />
      </View>
      <Text className="text-text font-semibold text-base text-center">{title}</Text>
      <Text className="text-muted text-sm text-center leading-5">{sub}</Text>
    </View>
  )
}
