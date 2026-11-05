import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { DetailHeader } from '@/components/DetailHeader';
import { Icon } from '@/components/Icon';
import { useSheets } from '@/components/ui/Sheets';
import { useThemeColors } from '@/lib/theme';
import { haptics } from '@/lib/haptics';
import type { Task } from '@/lib/types';

const PRIORITIES: { key: 'high' | 'medium' | 'low'; label: string; color: string }[] = [
  { key: 'high', label: 'High', color: '#ef4444' },
  { key: 'medium', label: 'Medium', color: '#f59e0b' },
  { key: 'low', label: 'Low', color: '#8b8ba0' },
];

export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const c = useThemeColors();
  const { actionSheet, prompt, confirm } = useSheets();
  const [task, setTask] = useState<Task | null>(null);

  useEffect(() => {
    if (!user || !id) return;
    return onSnapshot(doc(db, 'users', user.uid, 'tasks', id), snap => {
      const d = snap.data();
      if (!d || d.deleted) { setTask(null); return; }
      setTask({
        id: id ?? '',
        title: d.title ?? 'Untitled',
        description: d.description,
        done: d.done ?? false,
        dueDate: d.dueDate,
        priority: d.priority,
      });
    });
  }, [user, id]);

  const ref = () => doc(db, 'users', user!.uid, 'tasks', id!);
  const patch = (fields: Record<string, unknown>) =>
    updateDoc(ref(), { ...fields, updatedAt: serverTimestamp() }).catch(() => {});

  function toggleDone() {
    if (!task) return;
    if (task.done) haptics.light(); else haptics.success();
    patch({ done: !task.done });
  }

  function setPriority(p: 'high' | 'medium' | 'low') {
    haptics.select();
    patch({ priority: task?.priority === p ? null : p });
  }

  async function editField(field: 'title' | 'description', label: string) {
    const text = await prompt({
      title: label,
      defaultValue: field === 'title' ? task?.title : task?.description,
      multiline: field === 'description',
    });
    if (text != null) patch({ [field]: text.trim() });
  }

  async function editDueDate() {
    const text = await prompt({ title: 'Due date', message: 'e.g. Tomorrow, Friday, Mar 20', defaultValue: task?.dueDate });
    if (text != null) patch({ dueDate: text.trim() || null });
  }

  async function confirmDelete() {
    const ok = await confirm({ title: 'Delete task?', message: 'This removes the task.', confirmLabel: 'Delete', destructive: true });
    if (ok) patch({ deleted: true }).then(() => router.back());
  }

  function menu() {
    actionSheet({
      title: task?.title ?? 'Task',
      actions: [
        { label: 'Edit title', onPress: () => editField('title', 'Edit title') },
        { label: 'Edit description', onPress: () => editField('description', 'Edit description') },
        { label: 'Edit due date', onPress: editDueDate },
        { label: 'Delete', destructive: true, onPress: confirmDelete },
      ],
    });
  }

  if (!task) {
    return (
      <SafeAreaView className="flex-1" edges={['top']}>
        <DetailHeader />
        <View className="flex-1 items-center justify-center">
          <Text className="text-muted">Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1" edges={['top']}>
      <DetailHeader
        right={
          <TouchableOpacity onPress={menu} className="w-10 h-10 items-center justify-center rounded-2xl bg-surface border border-border">
            <Icon name="more-horiz" tone="text" size={22} />
          </TouchableOpacity>
        }
      />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }} showsVerticalScrollIndicator={false}>
        {/* Status hero — tap anywhere to toggle done */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={toggleDone}
          className={`rounded-2xl border px-5 py-6 flex-row items-center gap-4 ${task.done ? 'bg-brand/10 border-brand/30' : 'bg-surface border-border'}`}
        >
          <View
            className={task.done ? 'bg-brand' : ''}
            style={{
              width: 40, height: 40, borderRadius: 20,
              borderWidth: task.done ? 0 : 2, borderColor: c.border,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            {task.done && <Icon name="check" color="#fff" size={24} />}
          </View>
          <View className="flex-1">
            <Text
              className="text-text font-display font-bold text-xl tracking-tight"
              style={task.done ? { textDecorationLine: 'line-through', opacity: 0.55 } : undefined}
            >
              {task.title}
            </Text>
            <Text className="text-muted text-xs mt-1">{task.done ? 'Completed, tap to reopen' : 'Tap to mark done'}</Text>
          </View>
        </TouchableOpacity>

        {/* Ask MODUS — scoped AI for this task */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => router.push({ pathname: '/(app)/(tabs)/chat', params: { taskId: id } })}
          className="flex-row items-center gap-3 rounded-xl bg-brand/5 border border-brand/25 px-4 py-3.5"
        >
          <View className="w-9 h-9 rounded-xl bg-brand/15 items-center justify-center">
            <Icon name="auto-awesome" tone="brand" size={18} />
          </View>
          <View className="flex-1">
            <Text className="text-text font-semibold text-[15px]">Ask MODUS about this task</Text>
            <Text className="text-muted text-xs mt-0.5">Break it down, unblock, get it done</Text>
          </View>
          <Icon name="chevron-right" tone="muted" size={20} />
        </TouchableOpacity>

        {/* Priority */}
        <View className="bg-surface border border-border rounded-xl p-4 gap-3">
          <Text className="text-muted text-xs font-semibold uppercase tracking-wider">Priority</Text>
          <View className="flex-row gap-2">
            {PRIORITIES.map(p => {
              const on = task.priority === p.key;
              return (
                <TouchableOpacity
                  key={p.key}
                  onPress={() => setPriority(p.key)}
                  activeOpacity={0.8}
                  className="flex-1 flex-row items-center justify-center gap-1.5 py-2.5 rounded-xl border"
                  style={{
                    backgroundColor: on ? `${p.color}22` : c.surface2,
                    borderColor: on ? p.color : c.border,
                  }}
                >
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.color }} />
                  <Text className="text-xs font-bold" style={{ color: on ? p.color : c.muted }}>{p.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Due date */}
        <TouchableOpacity onPress={editDueDate} activeOpacity={0.7} className="bg-surface border border-border rounded-xl p-4 flex-row items-center gap-3">
          <Icon name="event" tone="muted" size={18} />
          <Text className={`flex-1 text-[15px] ${task.dueDate ? 'text-text' : 'text-muted'}`}>
            {task.dueDate || 'Set a due date…'}
          </Text>
          <Icon name="chevron-right" tone="muted" size={18} />
        </TouchableOpacity>

        {/* Description */}
        <TouchableOpacity onPress={() => editField('description', 'Edit description')} activeOpacity={0.7} className="bg-surface border border-border rounded-xl p-4 gap-1.5">
          <Text className="text-muted text-xs font-semibold uppercase tracking-wider">Notes</Text>
          <Text className={task.description ? 'text-text text-[15px] leading-6' : 'text-muted text-[15px]'}>
            {task.description || 'Tap to add notes…'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
