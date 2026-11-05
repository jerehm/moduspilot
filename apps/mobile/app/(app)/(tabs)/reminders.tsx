import { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, updateDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useHabits, useTasks } from '@/hooks/useCollections';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Icon } from '@/components/Icon';
import { SkeletonList, SkeletonHabitRow } from '@/components/Skeleton';
import { useSheets } from '@/components/ui/Sheets';
import { ScreenFade, FadeReveal } from '@/components/ui';
import { useThemeColors } from '@/lib/theme';
import { haptics } from '@/lib/haptics';
import { fetchTodayEvents, type CalEvent } from '@/lib/api';
import type { Habit, Task } from '@/lib/types';

function fmtEventTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  catch { return ''; }
}

const PRIORITY_BAND: Record<string, string> = { high: '#f87171', medium: '#facc15', low: '#6b6b80' };
const PRIORITY_TEXT: Record<string, string> = { high: '#f87171', medium: '#facc15', low: '#6b6b80' };
const PRIORITY_FILTERS = ['all', 'high', 'medium', 'low'] as const;
type PriorityFilter = typeof PRIORITY_FILTERS[number];

function localDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isOverdue(d?: string) { return !!d && d < localDateStr(); }

// ── Heatmap helpers (ported from web) ────────────────────────────────────────
interface GridDay { date: string; done: boolean; isToday: boolean; isFuture: boolean; }

function buildWeeks(completedDates: string[]): GridDay[][] {
  const doneSet = new Set(completedDates);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const todayIso = now.toISOString().slice(0, 10);
  const start = new Date(now);
  start.setDate(start.getDate() - start.getDay() - 51 * 7);
  const weeks: GridDay[][] = [];
  const cursor = new Date(start);
  for (let w = 0; w < 53; w++) {
    const week: GridDay[] = [];
    for (let d = 0; d < 7; d++) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const isFuture = cursor > now;
      week.push({ date: dateStr, done: !isFuture && doneSet.has(dateStr), isToday: dateStr === todayIso, isFuture });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function computeStats(completedDates: string[]) {
  const today = new Date().toISOString().slice(0, 10);
  const done = completedDates.filter(d => d <= today).sort();
  let best = 0, run = 0;
  let prev: Date | null = null;
  for (const d of done) {
    const curr = new Date(d + 'T12:00:00');
    if (prev) { const diff = Math.round((curr.getTime() - prev.getTime()) / 86400000); run = diff === 1 ? run + 1 : 1; }
    else { run = 1; }
    best = Math.max(best, run);
    prev = curr;
  }
  const last7 = new Set(Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - i); return d.toISOString().slice(0, 10); }));
  const thisWeek = done.filter(d => last7.has(d)).length;
  const monthPrefix = today.slice(0, 7);
  const thisMonth = done.filter(d => d.startsWith(monthPrefix)).length;
  const dayOfMonth = new Date().getDate();
  const monthPct = dayOfMonth > 0 ? Math.round((thisMonth / dayOfMonth) * 100) : 0;
  return { bestStreak: best, thisWeek, thisMonth, monthPct, totalDone: done.length };
}

function recalcStreak(dates: string[], unchecking: boolean): number {
  const sorted = [...dates].sort().reverse();
  let streak = 0;
  const cursor = new Date();
  if (unchecking) cursor.setDate(cursor.getDate() - 1);
  for (const d of sorted) {
    if (d === cursor.toISOString().slice(0, 10)) { streak++; cursor.setDate(cursor.getDate() - 1); }
    else break;
  }
  return streak;
}

const CELL = 12, GAP = 3;

function Heatmap({ completedDates, onToggle, colors }: { completedDates: string[]; onToggle: (d: string) => void; colors: { brand: string; border: string } }) {
  const weeks = buildWeeks(completedDates);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ flexDirection: 'row', gap: GAP }}>
        {weeks.map((week, wi) => (
          <View key={wi} style={{ gap: GAP }}>
            {week.map(day => {
              const bg = day.isFuture ? 'transparent'
                : day.done ? colors.brand
                : colors.border;
              return (
                <TouchableOpacity
                  key={day.date}
                  disabled={day.isFuture}
                  onPress={() => { haptics.select(); onToggle(day.date); }}
                  activeOpacity={0.6}
                  style={{
                    width: CELL, height: CELL, borderRadius: 2, backgroundColor: bg,
                    borderWidth: day.isToday ? 1.5 : 0, borderColor: colors.brand,
                  }}
                />
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────
const SectionLabel = ({ text, color = '#6b6b80', count }: { text: string; color?: string; count?: number }) => (
  <View className="flex-row items-center gap-2 mb-3">
    <Text className="text-xs font-bold uppercase tracking-widest" style={{ color }}>{text}</Text>
    {count !== undefined && (
      <View className="px-2 py-0.5 rounded-full bg-surface-2">
        <Text className="text-muted text-[11px] font-semibold">{count}</Text>
      </View>
    )}
  </View>
);

export default function RemindersScreen() {
  const { user } = useAuth();
  const c = useThemeColors();
  const { prompt, confirm } = useSheets();
  const todayStr = localDateStr();

  const { data: habits, loading: habitsLoading } = useHabits(user?.uid);
  const { data: tasks, loading: tasksLoading } = useTasks(user?.uid);
  const loading = habitsLoading || tasksLoading;

  const [expandedHabit, setExpandedHabit] = useState<string | null>(null);
  const [tab, setTab] = useState<'todo' | 'done'>('todo');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [quickAdd, setQuickAdd] = useState('');
  const [showCelebration, setShowCelebration] = useState(false);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const prevDone = useRef(0);

  // Today's Google Calendar events — shown as a read-only agenda at the top,
  // mirroring the web Reminders page ("what's on today" in one place).
  useEffect(() => {
    let alive = true;
    fetchTodayEvents()
      .then(r => { if (alive) setEvents((r.events ?? []).filter(e => !e.allDay)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [user?.uid]);

  const doneToday = habits.filter(h => h.completedDates.includes(todayStr)).length;
  const totalHabits = habits.length;
  const topStreak = habits.reduce((m, h) => Math.max(m, h.streak), 0);

  useEffect(() => {
    if (!loading && totalHabits > 0 && doneToday === totalHabits && prevDone.current < totalHabits) {
      setShowCelebration(true);
      haptics.success();
      const t = setTimeout(() => setShowCelebration(false), 3500);
      prevDone.current = doneToday;
      return () => clearTimeout(t);
    }
    prevDone.current = doneToday;
  }, [doneToday, totalHabits, loading]);

  async function toggleHabit(habit: Habit, date: string) {
    if (!user) return;
    const done = habit.completedDates.includes(date);
    const newDates = done ? habit.completedDates.filter(d => d !== date) : [...habit.completedDates, date];
    const streak = recalcStreak(newDates, done && date === todayStr);
    updateDoc(doc(db, 'users', user.uid, 'habits', habit.id), { completedDates: newDates, streak }).catch(() => {});
  }

  function toggleDone(task: Task) {
    if (!user) return;
    if (task.done) haptics.light(); else haptics.success();
    updateDoc(doc(db, 'users', user.uid, 'tasks', task.id), {
      done: !task.done, ...(task.done ? {} : { completedAt: serverTimestamp() }),
    }).catch(() => {});
  }

  async function deleteTask(task: Task) {
    if (!user) return;
    const ok = await confirm({ title: task.title, message: 'Delete this task?', confirmLabel: 'Delete', destructive: true });
    if (ok) updateDoc(doc(db, 'users', user.uid, 'tasks', task.id), { deleted: true }).catch(() => {});
  }

  async function renameTask(task: Task) {
    if (!user) return;
    const next = (await prompt({ title: 'Edit task', defaultValue: task.title, confirmLabel: 'Save' }))?.trim();
    if (next && next !== task.title) updateDoc(doc(db, 'users', user.uid, 'tasks', task.id), { title: next }).catch(() => {});
  }

  function submitQuickAdd() {
    const title = quickAdd.trim();
    if (!title || !user) return;
    setQuickAdd('');
    addDoc(collection(db, 'users', user.uid, 'tasks'), {
      title, done: false, deleted: false, source: 'manual', createdAt: serverTimestamp(),
    }).catch(() => {});
  }

  const visibleTasks = tasks.filter(t => {
    if (tab === 'todo' ? t.done : !t.done) return false;
    if (priorityFilter !== 'all' && tab === 'todo' && t.priority !== priorityFilter) return false;
    return true;
  });
  const allOverdue = tasks.filter(t => !t.done && isOverdue(t.dueDate));
  const taskSections = tab === 'todo'
    ? [
        { label: 'Overdue', color: '#f87171', tasks: visibleTasks.filter(t => isOverdue(t.dueDate)) },
        { label: 'Due today', color: c.brand, tasks: visibleTasks.filter(t => t.dueDate === todayStr) },
        { label: 'Upcoming', color: '#6b6b80', tasks: visibleTasks.filter(t => t.dueDate && t.dueDate > todayStr) },
        { label: 'No date', color: '#6b6b80', tasks: visibleTasks.filter(t => !t.dueDate) },
      ].filter(s => s.tasks.length > 0)
    : [{ label: 'Completed', color: '#6b6b80', tasks: visibleTasks }];

  return (
    <ScreenFade>
      <SafeAreaView className="flex-1" edges={['top']}>
      <ScreenHeader title="Reminders" />

      <FadeReveal
        loading={loading}
        skeleton={<SkeletonList count={6}><SkeletonHabitRow /></SkeletonList>}
      >
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
          {showCelebration && (
            <View className="mb-6 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex-row items-center gap-3">
              <Text className="text-xl">🎉</Text>
              <View className="flex-1">
                <Text className="text-emerald-400 font-semibold text-sm">Perfect day!</Text>
                <Text className="text-muted text-xs">All {totalHabits} habits complete. Keep the streak alive tomorrow.</Text>
              </View>
            </View>
          )}

          {/* ── TODAY'S SCHEDULE (calendar agenda) ─────────────── */}
          {events.length > 0 && (
            <View className="mb-6">
              <View className="flex-row items-center gap-2.5 mb-3">
                <Text className="text-xs font-bold uppercase tracking-widest text-muted">Today&apos;s Schedule</Text>
                <View className="px-2 py-0.5 rounded-full bg-brand/10">
                  <Text className="text-brand text-[10px] font-bold">{events.length}</Text>
                </View>
              </View>
              <View className="gap-2">
                {events.map(e => (
                  <View key={e.id} className="flex-row items-center gap-3 px-4 py-3 bg-surface dark:bg-surface/70 border border-border dark:border-border/60 rounded-2xl">
                    <Text className="text-brand font-semibold text-xs tabular-nums w-16">{fmtEventTime(e.start)}</Text>
                    <Text className="text-text text-[15px] flex-1" numberOfLines={1}>{e.title}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── HABITS ─────────────────────────────────────────── */}
          <View className="flex-row items-center gap-2.5 mb-3">
            <Text className="text-xs font-bold uppercase tracking-widest text-muted">Habits</Text>
            {totalHabits > 0 && (
              <>
                <View className="px-2 py-0.5 rounded-full bg-brand/10">
                  <Text className="text-brand text-[10px] font-bold">{doneToday}/{totalHabits} today</Text>
                </View>
                {topStreak > 0 && (
                  <View className="px-2 py-0.5 rounded-full bg-orange-500/10">
                    <Text className="text-[10px] font-bold" style={{ color: '#fb923c' }}>{topStreak}d best</Text>
                  </View>
                )}
              </>
            )}
          </View>

          {habits.length === 0 ? (
            <View className="py-6 items-center">
              <Text className="text-muted text-sm">No habits yet, tell MODUS what you want to build.</Text>
            </View>
          ) : (
            <View className="gap-2">
              {habits.map(h => {
                const isDone = h.completedDates.includes(todayStr);
                const expanded = expandedHabit === h.id;
                const stats = computeStats(h.completedDates);
                return (
                  <View key={h.id} className="bg-surface dark:bg-surface/70 border border-border dark:border-border/60 rounded-2xl overflow-hidden">
                    <View className="flex-row items-center gap-3 px-4 py-3">
                      <TouchableOpacity
                        onPress={() => { haptics.select(); toggleHabit(h, todayStr); }}
                        activeOpacity={0.7}
                        style={{
                          width: 22, height: 22, borderRadius: 7, borderWidth: 2,
                          borderColor: isDone ? c.brand : c.border, backgroundColor: isDone ? c.brand : 'transparent',
                          alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        {isDone && <Icon name="check" color="#fff" size={14} />}
                      </TouchableOpacity>
                      <TouchableOpacity className="flex-1" activeOpacity={0.7} onPress={() => setExpandedHabit(expanded ? null : h.id)}>
                        <Text className="text-[15px] font-medium" style={[{ color: isDone ? c.muted : c.text }, isDone ? { textDecorationLine: 'line-through' } : {}]} numberOfLines={1}>
                          {h.title}
                        </Text>
                      </TouchableOpacity>
                      <Text className="text-muted text-xs">{h.streak}d</Text>
                      <Text className="text-muted text-xs">{stats.monthPct}%</Text>
                      <TouchableOpacity onPress={() => setExpandedHabit(expanded ? null : h.id)} hitSlop={8}>
                        <Icon name={expanded ? 'expand-less' : 'expand-more'} tone="muted" size={20} />
                      </TouchableOpacity>
                    </View>
                    {expanded && (
                      <View className="border-t border-border dark:border-border/60 px-4 pt-3 pb-4 gap-3">
                        <View className="flex-row gap-4">
                          <Text className="text-muted text-xs"><Text className="text-text font-semibold">{stats.bestStreak}</Text> best</Text>
                          <Text className="text-muted text-xs"><Text className="text-text font-semibold">{stats.thisWeek}</Text> this week</Text>
                          <Text className="text-muted text-xs"><Text className="text-text font-semibold">{stats.totalDone}</Text> total</Text>
                        </View>
                        <Heatmap completedDates={h.completedDates} onToggle={d => toggleHabit(h, d)} colors={{ brand: c.brand, border: c.border }} />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* ── Divider ────────────────────────────────────────── */}
          <View className="h-px bg-border/50 my-8" />

          {/* ── TASKS ──────────────────────────────────────────── */}
          <Text className="text-xs font-bold uppercase tracking-widest text-muted mb-4">Tasks</Text>

          {/* Quick add */}
          <View className="flex-row items-center gap-2 mb-5 px-4 py-2.5 bg-surface dark:bg-surface/70 border border-border dark:border-border/60 rounded-xl">
            <Icon name="add" tone="muted" size={18} />
            <TextInput
              className="flex-1 text-text text-[15px]"
              placeholder="Add a task…"
              placeholderTextColor={c.muted}
              value={quickAdd}
              onChangeText={setQuickAdd}
              returnKeyType="done"
              onSubmitEditing={submitQuickAdd}
            />
          </View>

          {/* Tabs + priority filter */}
          <View className="gap-3 mb-5">
            <View className="flex-row items-center">
              <View className="flex-row bg-surface dark:bg-surface/70 border border-border dark:border-border/60 rounded-lg p-1 gap-1">
                {(['todo', 'done'] as const).map(t => (
                  <TouchableOpacity key={t} onPress={() => { haptics.select(); setTab(t); }} className={`px-4 py-1.5 rounded-md ${tab === t ? 'bg-brand' : ''} flex-row items-center gap-1.5`}>
                    <Text className={`text-sm font-medium ${tab === t ? 'text-white' : 'text-muted'}`}>{t === 'todo' ? 'To Do' : 'Done'}</Text>
                    {t === 'todo' && allOverdue.length > 0 && (
                      <View className="px-1.5 rounded-full" style={{ backgroundColor: '#ef4444' }}>
                        <Text className="text-white text-[10px] font-bold">{allOverdue.length}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {tab === 'todo' && (
              <View className="flex-row items-center gap-1.5">
                {PRIORITY_FILTERS.map(p => {
                  const active = priorityFilter === p;
                  const tint = p === 'high' ? '#f87171' : p === 'medium' ? '#facc15' : p === 'low' ? c.muted : c.brand;
                  return (
                    <TouchableOpacity
                      key={p}
                      onPress={() => { haptics.select(); setPriorityFilter(p); }}
                      className="px-3 py-1 rounded-full border"
                      style={{ borderColor: active ? tint : c.border, backgroundColor: active ? tint + '18' : 'transparent' }}
                    >
                      <Text className="text-[11px] font-medium capitalize" style={{ color: active ? tint : c.muted }}>{p === 'all' ? 'All' : p}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>

          {visibleTasks.length === 0 ? (
            <Text className="text-muted text-sm text-center py-10">
              {tab === 'todo'
                ? priorityFilter !== 'all' ? `No ${priorityFilter}-priority tasks.` : 'No tasks. Add one above or ask MODUS.'
                : 'No completed tasks yet.'}
            </Text>
          ) : (
            <View className="gap-6">
              {taskSections.map(section => (
                <View key={section.label}>
                  <SectionLabel text={section.label} color={section.color} count={section.tasks.length} />
                  <View className="gap-2">
                    {section.tasks.map(t => (
                      <View key={t.id} className="bg-surface dark:bg-surface/70 border border-border dark:border-border/60 rounded-2xl flex-row items-stretch overflow-hidden">
                        {t.priority && <View style={{ width: 4, backgroundColor: PRIORITY_BAND[t.priority] }} />}
                        <View className="flex-row items-start gap-3 px-4 py-3 flex-1">
                          <TouchableOpacity
                            onPress={() => toggleDone(t)}
                            activeOpacity={0.7}
                            style={{
                              marginTop: 2, width: 20, height: 20, borderRadius: 6, borderWidth: 2,
                              borderColor: t.done ? c.brand : c.border, backgroundColor: t.done ? c.brand : 'transparent',
                              alignItems: 'center', justifyContent: 'center',
                            }}
                          >
                            {t.done && <Icon name="check" color="#fff" size={13} />}
                          </TouchableOpacity>
                          <View className="flex-1">
                            <TouchableOpacity activeOpacity={0.7} onPress={() => !t.done && renameTask(t)} onLongPress={() => deleteTask(t)}>
                              <Text className="text-[15px] font-medium" style={[{ color: t.done ? c.muted : c.text }, t.done ? { textDecorationLine: 'line-through' } : {}]}>
                                {t.title}
                              </Text>
                            </TouchableOpacity>
                            {t.description ? <Text className="text-muted text-xs mt-0.5" numberOfLines={1}>{t.description}</Text> : null}
                            {(t.priority || t.dueDate) && (
                              <View className="flex-row items-center gap-2 mt-1">
                                {t.priority && <Text className="text-xs font-medium capitalize" style={{ color: PRIORITY_TEXT[t.priority] }}>{t.priority}</Text>}
                                {t.dueDate && (
                                  <Text className="text-xs" style={{ color: isOverdue(t.dueDate) && !t.done ? '#f87171' : c.muted }}>
                                    {t.dueDate === todayStr ? 'Today' : t.dueDate}
                                  </Text>
                                )}
                              </View>
                            )}
                          </View>
                          <TouchableOpacity onPress={() => deleteTask(t)} hitSlop={8} className="pl-2">
                            <Icon name="delete-outline" tone="muted" size={18} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </FadeReveal>
      </SafeAreaView>
    </ScreenFade>
  );
}
