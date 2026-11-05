import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, View, Text, ScrollView, RefreshControl, TouchableOpacity, TextInput, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import { router } from 'expo-router';
import {
  collection, query, orderBy, limit, getDocs, doc, updateDoc, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useAuth } from '@/hooks/useAuth';
import { getSettings } from '@/lib/settings';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Icon, type IconName } from '@/components/Icon';
import { useThemeColors } from '@/lib/theme';
import { Skeleton } from '@/components/Skeleton';
import { readCache, readCacheSync, writeCache } from '@/lib/cache';
import { EmptyState, ScreenFade } from '@/components/ui';
import { ProactiveReveal } from '@/components/ui/ProactiveReveal';
import { haptics } from '@/lib/haptics';
import {
  fetchInbox, fetchTodayEvents, fetchNews, fetchWeather, fetchTTS,
  type InboxThread, type CalEvent, type NewsItem, type Weather,
} from '@/lib/api';
import { initHealth, getHealthData, type HealthData } from '@/lib/device';


interface Top3Item { task: string; source: string }
interface BriefingHabit { name: string; streak: number; status: 'at_risk' | 'on_track' | 'done' }
interface ScheduleItem { time: string; title: string }
interface BriefingData {
  openingLine: string;
  narrative?: string;
  top3: Top3Item[];
  looseEnd: { text: string } | null;
  habits: BriefingHabit[];
  patternCallout: string | null;
  relationshipAlert: string | null;
  schedule: ScheduleItem[];
}
interface LiveTask { id: string; title: string; done: boolean; dueDate?: string; completedAt?: { toDate?: () => Date } }
interface LiveHabit { id: string; title: string; streak: number; completedDates: string[] }

interface BriefingEntry { id: string; date: Date; data: BriefingData; energy: string | null; completedTop3: number[] }

const todayStr = () => new Date().toISOString().slice(0, 10);
function yesterdayStr() { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function formatDate(d: Date) { return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }
function fmtShort(d: Date) {
  const t = startOfToday(); const y = new Date(t); y.setDate(y.getDate() - 1);
  if (d >= t) return 'Today';
  if (d >= y) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function isOverdue(d?: string) { return !!d && d < todayStr(); }
function recalcStreak(dates: string[]): number {
  const sorted = [...dates].sort().reverse();
  let streak = 0; const cursor = new Date();
  for (const d of sorted) { if (d === cursor.toISOString().slice(0, 10)) { streak++; cursor.setDate(cursor.getDate() - 1); } else break; }
  return streak;
}
function briefingToSpeech(d: BriefingData): string {
  const parts: string[] = [];
  if (d.narrative) parts.push(d.narrative); else if (d.openingLine) parts.push(d.openingLine);
  if (d.top3?.length) parts.push('Your top 3 today: ' + d.top3.map((t, i) => `${i + 1}. ${t.task}`).join('. '));
  if (d.schedule?.length) parts.push('Schedule: ' + d.schedule.map(s => `${s.time}, ${s.title}`).join('. '));
  if (d.looseEnd?.text) parts.push('Loose end: ' + d.looseEnd.text);
  if (d.patternCallout) parts.push('MODUS noticed: ' + d.patternCallout);
  return parts.join('. ');
}
function weatherEmoji(desc: string) {
  if (desc.includes('Clear')) return '☀️';
  if (desc.includes('cloud') || desc.includes('Overcast')) return '⛅';
  if (desc.includes('ain') || desc.includes('shower')) return '🌧️';
  if (desc.includes('now')) return '❄️';
  if (desc.includes('Thunder')) return '⛈️';
  if (desc.includes('og')) return '🌫️';
  return '🌤️';
}

// ── Labeled card ──────────────────────────────────────────────────────────────
function LabeledCard({ icon, color, label, accent, right, children }: {
  icon: IconName; color: string; label: string; accent?: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <View className="bg-surface dark:bg-surface/70 border border-border dark:border-border/60 rounded-2xl px-5 py-4" style={accent ? { borderLeftWidth: 3, borderLeftColor: accent } : undefined}>
      <View className="flex-row items-center justify-between mb-2.5">
        <View className="flex-row items-center gap-2">
          <Icon name={icon} size={15} color={color} />
          <Text className="text-muted text-[11px] font-bold uppercase tracking-wider">{label}</Text>
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

const ENERGY_OPTS = [
  { key: 'fully_charged', label: 'Fully charged' },
  { key: 'okay', label: 'Okay' },
  { key: 'running_low', label: 'Running low' },
];
const ENERGY_CONFIRM: Record<string, string> = {
  fully_charged: 'front-load your hardest work.',
  okay: 'pace your day around your top 3.',
  running_low: 'protect your focus, only essentials today.',
};

function HabitStatusPill({ status, streak }: { status: BriefingHabit['status']; streak: number }) {
  const map = {
    at_risk: { label: 'At risk', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    done: { label: 'Done today', color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
    on_track: { label: `${streak} day streak`, color: '#a78bfa', bg: 'rgba(167,139,250,0.14)' },
  }[status];
  return (
    <View style={{ backgroundColor: map.bg }} className="rounded-full px-2.5 py-1">
      <Text style={{ color: map.color }} className="text-xs font-semibold">{map.label}</Text>
    </View>
  );
}

function DayScoreRing({ score, border }: { score: number; border: string }) {
  const size = 46, stroke = 3.5, r = (size - stroke * 2) / 2, circ = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 80 ? '#10B981' : pct >= 40 ? '#7C3AED' : '#F59E0B';
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }], position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={border} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ - (pct / 100) * circ} />
      </Svg>
      <Text style={{ color, fontSize: 11, fontWeight: '700' }}>{pct}%</Text>
    </View>
  );
}

// ── Schedule timeline ─────────────────────────────────────────────────────────
const START_H = 8, END_H = 20, TOTAL_M = (END_H - START_H) * 60;
const EVENT_COLORS = ['#7c3aed', '#3b82f6', '#10b981', '#f59e0b', '#f43f5e'];
function evMins(iso: string) { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); }
function evPct(m: number) { return ((Math.max(START_H * 60, Math.min(END_H * 60, m)) - START_H * 60) / TOTAL_M) * 100; }

function ScheduleTimeline({ events, fallback, color }: { events: CalEvent[]; fallback: ScheduleItem[]; color: string }) {
  const day = events.filter(e => !e.allDay && e.start);
  if (day.length === 0 && fallback.length === 0) {
    return <Text className="text-muted text-xs">No meetings today, clear runway.</Text>;
  }
  if (day.length === 0) {
    return (
      <View className="gap-1.5">
        {fallback.map((item, i) => (
          <View key={i} className="flex-row items-center gap-3 px-3 py-2 rounded-lg bg-surface-2">
            <Text className="text-brand-light text-xs font-semibold w-16">{item.time}</Text>
            <Text className="text-text text-[13px] flex-1" numberOfLines={2}>{item.title}</Text>
          </View>
        ))}
      </View>
    );
  }
  return (
    <View className="mt-1">
      <View className="flex-row justify-between mb-1">
        {[8, 10, 12, 14, 16, 18, 20].map(h => (
          <Text key={h} className="text-muted" style={{ fontSize: 8 }}>{h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`}</Text>
        ))}
      </View>
      <View className="rounded-lg overflow-hidden bg-surface-2" style={{ height: 32, position: 'relative' }}>
        {day.map((e, i) => {
          const s = evMins(e.start);
          const en = e.end ? evMins(e.end) : s + 60;
          const left = evPct(s);
          const width = Math.max(evPct(en) - left, 3);
          return (
            <View key={i} style={{ position: 'absolute', top: 4, bottom: 4, left: `${left}%`, width: `${width}%`, backgroundColor: EVENT_COLORS[i % EVENT_COLORS.length], borderRadius: 4, paddingHorizontal: 4, justifyContent: 'center', opacity: 0.9 }}>
              <Text numberOfLines={1} style={{ color: '#fff', fontSize: 8, fontWeight: '600' }}>{e.title}</Text>
            </View>
          );
        })}
      </View>
      <View className="mt-3 gap-1.5">
        {day.map((e, i) => (
          <View key={i} className="flex-row items-center gap-2">
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: EVENT_COLORS[i % EVENT_COLORS.length] }} />
            <Text className="text-muted text-[11px] w-14">{new Date(e.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</Text>
            <Text className="text-text text-xs flex-1" numberOfLines={1}>{e.title}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const AVATAR_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#06b6d4', '#f97316', '#ec4899'];
function avatarColor(name: string) { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff; return AVATAR_COLORS[h % AVATAR_COLORS.length]; }

const NEWS_TOPICS = ['Fitness & Health', 'Technology & SaaS', 'Finance & Investing', 'Real Estate', 'E-commerce & Retail', 'Marketing & Advertising', 'Entrepreneurship & Startups', 'Crypto & Web3', 'Sports', 'Entertainment & Media'];
function hostname(url: string) { try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; } }

export default function BriefingScreen() {
  const { user } = useAuth();
  const c = useThemeColors();
  const _bc = readCacheSync<{ data: BriefingData; date: string }>(`briefing.${user?.uid ?? ''}`);
  const [data, setData] = useState<BriefingData | null>(_bc?.data ?? null);
  const [date, setDate] = useState<Date | null>(_bc ? new Date(_bc.date) : null);
  const [docId, setDocId] = useState<string | null>(null);
  const [energy, setEnergy] = useState<string | null>(null);
  const [completedTop3, setCompletedTop3] = useState<number[]>([]);
  const [customEnergy, setCustomEnergy] = useState('');
  const [allBriefings, setAllBriefings] = useState<BriefingEntry[]>([]);
  const [loading, setLoading] = useState(!_bc);
  const [refreshing, setRefreshing] = useState(false);

  const player = useAudioPlayer();
  const playerStatus = useAudioPlayerStatus(player);
  const [speaking, setSpeaking] = useState(false);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsVoice, setTtsVoice] = useState('onyx');
  const ttsAbort = useRef(false);

  // Auto-detect natural end of playback
  useEffect(() => {
    if (playerStatus.didJustFinish) setSpeaking(false);
  }, [playerStatus.didJustFinish]);

  // Load user's chosen voice
  useEffect(() => {
    if (!user) return;
    getSettings(user.uid).then(s => { if (s.ttsVoice) setTtsVoice(s.ttsVoice); });
  }, [user?.uid]);

  // Stop playback on unmount
  useEffect(() => () => { try { player.pause(); } catch {} }, []);

  function applyBriefing(b: BriefingEntry) {
    setData(b.data); setDate(b.date); setDocId(b.id);
    setEnergy(b.energy); setCompletedTop3(b.completedTop3);
  }

  async function toggleSpeech() {
    if (speaking || ttsLoading) {
      ttsAbort.current = true;
      try { player.pause(); } catch {}
      setSpeaking(false);
      setTtsLoading(false);
      return;
    }
    if (!data) return;
    haptics.select();
    ttsAbort.current = false;
    setTtsLoading(true);
    try {
      // Read voice fresh so a settings change takes effect without needing a screen reload.
      const latestVoice = user
        ? await getSettings(user.uid).then(s => s.ttsVoice || 'onyx')
        : ttsVoice;
      const uri = await fetchTTS(briefingToSpeech(data), latestVoice);
      if (ttsAbort.current) return;
      player.replace(uri);
      player.play();
      setSpeaking(true);
    } catch (e) {
      setSpeaking(false);
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.error('[TTS]', msg);
      Alert.alert('Voice unavailable', msg);
    } finally {
      setTtsLoading(false);
    }
  }

  // Live + integration data
  const [tasks, setTasks] = useState<LiveTask[]>([]);
  const [habits, setHabits] = useState<LiveHabit[]>([]);
  const [inbox, setInbox] = useState<InboxThread[]>([]);
  const [inboxFilter, setInboxFilter] = useState<'primary' | 'all'>('primary');
  const [inboxConnected, setInboxConnected] = useState(true);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [expandedMail, setExpandedMail] = useState<string | null>(null);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsIndustry, setNewsIndustry] = useState('');
  const [newsTopic, setNewsTopic] = useState<string | undefined>(undefined);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsPickerOpen, setNewsPickerOpen] = useState(false);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [briefHidden, setBriefHidden] = useState<Set<string>>(new Set());
  const showS = (k: string) => !briefHidden.has(k);

  async function load() {
    if (!user) { setLoading(false); return; }
    try {
      const snap = await getDocs(query(collection(db, 'users', user.uid, 'conversations'), orderBy('createdAt', 'desc'), limit(30)));
      const all: BriefingEntry[] = [];
      const seenDays = new Set<string>();
      for (const d of snap.docs) {
        const dd = d.data();
        if (dd.briefing !== true || dd.deleted === true || !dd.briefingData) continue;
        const when = dd.createdAt?.toDate ? dd.createdAt.toDate() : new Date();
        const dayKey = when.toISOString().slice(0, 10);
        if (seenDays.has(dayKey)) continue; // one per calendar day (matches web sidebar)
        seenDays.add(dayKey);
        all.push({ id: d.id, date: when, data: dd.briefingData as BriefingData, energy: dd.energy ?? null, completedTop3: dd.completedTop3 ?? [] });
      }
      setAllBriefings(all);
      if (all.length > 0) {
        const keep = docId ? all.find(b => b.id === docId) : null;
        const pick = keep ?? all.find(b => b.date >= startOfToday()) ?? all[0];
        applyBriefing(pick);
        writeCache(`briefing.${user.uid}`, { data: pick.data, date: pick.date.toISOString() });
      } else { setData(null); setDate(null); setDocId(null); }
    } catch { setData(null); }
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => {
    if (!user) return;
    const uid = user.uid;
    let alive = true;
    readCache<{ data: BriefingData; date: string }>(`briefing.${uid}`).then(cached => {
      if (alive && cached) { setData(cached.data); setDate(new Date(cached.date)); setLoading(false); }
    });
    load();

    const unsubT = onSnapshot(collection(db, 'users', uid, 'tasks'), snap => {
      setTasks(snap.docs
        .map(d => ({ id: d.id, title: d.data().title ?? 'Untitled', done: d.data().done ?? false, dueDate: d.data().dueDate, completedAt: d.data().completedAt, deleted: d.data().deleted ?? false }))
        .filter(t => !t.deleted) as LiveTask[]);
    }, () => {});
    const unsubH = onSnapshot(query(collection(db, 'users', uid, 'habits'), orderBy('createdAt', 'desc')), snap => {
      setHabits(snap.docs.map(d => ({ id: d.id, title: d.data().title ?? 'Untitled', streak: d.data().streak ?? 0, completedDates: d.data().completedDates ?? [] })));
    }, () => {});
    // Per-user briefing section visibility (Settings → Display), synced w/ web.
    const unsubS = onSnapshot(doc(db, 'users', uid), snap => {
      const l = snap.data()?.settings?.layout;
      setBriefHidden(new Set(Array.isArray(l?.briefingHidden) ? l.briefingHidden : []));
    }, () => {});

    fetchTodayEvents().then(r => { if (alive) setEvents(r.events); });
    fetchWeather().then(w => { if (alive) setWeather(w); });

    if (Platform.OS === 'ios') {
      initHealth().then(available => {
        if (available && alive) getHealthData().then(h => { if (alive) setHealth(h); });
      });
    }

    return () => { alive = false; unsubT(); unsubH(); unsubS(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Inbox (re-fetch on filter change)
  useEffect(() => {
    if (!user) return;
    let alive = true;
    setInboxLoading(true);
    fetchInbox(inboxFilter)
      .then(r => { if (!alive) return; setInbox(r.threads); setInboxConnected(!r.notConnected); })
      .finally(() => { if (alive) setInboxLoading(false); });
    return () => { alive = false; };
  }, [user, inboxFilter]);

  // News (re-fetch on topic change)
  useEffect(() => {
    if (!user) return;
    let alive = true;
    setNewsLoading(true);
    fetchNews(newsTopic).then(r => { if (!alive) return; setNews(r.items); setNewsIndustry(r.industry); setNewsLoading(false); });
    return () => { alive = false; };
  }, [user, newsTopic]);

  function selectEnergy(key: string) {
    if (!user || !docId) return;
    haptics.select(); setEnergy(key);
    updateDoc(doc(db, 'users', user.uid, 'conversations', docId), { energy: key }).catch(() => {});
  }
  function toggleTop3(i: number) {
    if (!user || !docId) return;
    haptics.select();
    const next = completedTop3.includes(i) ? completedTop3.filter(x => x !== i) : [...completedTop3, i];
    setCompletedTop3(next);
    updateDoc(doc(db, 'users', user.uid, 'conversations', docId), { completedTop3: next }).catch(() => {});
  }
  function markTaskDone(id: string) {
    if (!user) return;
    haptics.success();
    updateDoc(doc(db, 'users', user.uid, 'tasks', id), { done: true, completedAt: serverTimestamp() }).catch(() => {});
  }
  function logHabit(h: LiveHabit) {
    if (!user) return;
    haptics.success();
    const dates = [...h.completedDates, todayStr()];
    updateDoc(doc(db, 'users', user.uid, 'habits', h.id), { completedDates: dates, streak: recalcStreak(dates) }).catch(() => {});
  }
  function draftReply(t: InboxThread) {
    const prompt = `Write a draft reply for this email directly in chat, just the reply text. When I say "send it", generate a send_email approval card with threadId: "${t.id}", subject: "Re: ${t.subject}", and body = the draft.\n\nFrom: ${t.from}\nSubject: ${t.subject}\n\n${t.snippet}`;
    router.push({ pathname: '/(app)/(tabs)/chat', params: { prefill: prompt } });
  }

  // Derived
  const today = todayStr();
  const overdueTasks = tasks.filter(t => !t.done && isOverdue(t.dueDate));
  const atRiskHabits = habits.filter(h => !h.completedDates.includes(today) && h.streak > 0);
  const habitsDone = habits.filter(h => h.completedDates.includes(today)).length;
  const habitPct = habits.length > 0 ? habitsDone / habits.length : 1;
  const dayScore = Math.round(25 + (energy ? 25 : 0) + habitPct * 50);
  const yStr = yesterdayStr();
  const yTasksDone = tasks.filter(t => { const ca = t.completedAt?.toDate?.(); return ca && ca.toISOString().slice(0, 10) === yStr; }).length;
  const yHabitsDone = habits.filter(h => h.completedDates.includes(yStr)).length;
  const energyOpt = ENERGY_OPTS.find(o => o.key === energy);
  const needsAttention = [
    ...overdueTasks.map(t => ({ id: t.id, kind: 'task' as const, title: t.title, sub: t.dueDate === today ? 'Due today' : `Overdue · ${t.dueDate}` })),
    ...atRiskHabits.map(h => ({ id: h.id, kind: 'habit' as const, title: h.title, sub: `${h.streak}d streak at risk`, habit: h })),
  ];

  return (
    <ScreenFade>
      <SafeAreaView className="flex-1" edges={['top']}>
      <ScreenHeader
        title="Briefing"
        right={data ? (
          <TouchableOpacity onPress={toggleSpeech} activeOpacity={0.7} className="w-10 h-10 items-center justify-center rounded-xl bg-surface border border-border">
            <Icon
              name={ttsLoading ? 'hourglass-empty' : speaking ? 'stop' : 'volume-up'}
              tone={speaking || ttsLoading ? 'brand' : 'muted'}
              size={20}
            />
          </TouchableOpacity>
        ) : undefined}
      />


      {loading ? (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} showsVerticalScrollIndicator={false}>
          <View className="gap-2.5"><Skeleton width="45%" height={20} /><Skeleton height={13} /><Skeleton width="85%" height={13} /><Skeleton width="70%" height={13} /></View>
          {[0, 1, 2].map(i => (
            <View key={i} className="bg-surface dark:bg-surface/70 border border-border dark:border-border/60 rounded-2xl px-4 py-4 gap-2.5"><Skeleton width="35%" height={13} /><Skeleton height={12} /><Skeleton width="80%" height={12} /></View>
          ))}
        </ScrollView>
      ) : !data ? (
        <EmptyState icon="wb-sunny" title="No briefing yet" subtitle="MODUS generates your morning briefing automatically each day. Pull down to refresh." />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={c.brand} />}
        >
          {/* Past briefings — day selector (web has a sidebar) */}
          {allBriefings.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {allBriefings.map(b => {
                const active = b.id === docId;
                return (
                  <TouchableOpacity
                    key={b.id}
                    onPress={() => { haptics.select(); applyBriefing(b); }}
                    activeOpacity={0.7}
                    className={`px-3.5 py-1.5 rounded-full border ${active ? 'bg-brand border-brand' : 'bg-surface dark:bg-surface/70 border-border dark:border-border/60'}`}
                  >
                    <Text className={`text-xs font-semibold ${active ? 'text-white' : 'text-muted'}`}>{fmtShort(b.date)}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Hero — narrative + day-score ring + stats banner */}
          <View className="rounded-2xl border border-brand/20 overflow-hidden">
            <View className="flex-row">
              <View className="w-1 bg-brand" />
              <View className="flex-1 p-5">
                <View className="flex-row items-start justify-between gap-3">
                  <View className="flex-1">
                    {date && <Text className="text-brand text-[10px] font-bold uppercase tracking-widest mb-1.5">{formatDate(date)}</Text>}
                    <Text className="text-text text-base leading-6">{data.narrative ?? data.openingLine}</Text>
                  </View>
                  <DayScoreRing score={dayScore} border={c.border} />
                </View>
                {/* stats banner */}
                <View className="flex-row flex-wrap gap-x-4 gap-y-1 mt-3">
                  <Text className="text-muted text-xs"><Text className="text-text font-semibold">{tasks.filter(t => !t.done && t.dueDate === today).length}</Text> due</Text>
                  <Text className="text-muted text-xs"><Text className="text-text font-semibold">{events.filter(e => !e.allDay).length}</Text> meetings</Text>
                  <Text className="text-muted text-xs"><Text className="text-text font-semibold">{habitsDone}/{habits.length}</Text> habits</Text>
                  {inboxConnected && !inboxLoading && <Text className="text-muted text-xs"><Text className="text-text font-semibold">{inbox.length}</Text> unread</Text>}
                  {weather && <Text className="text-muted text-xs">{weatherEmoji(weather.desc)} {weather.temp}{weather.unit}</Text>}
                </View>
                {(yTasksDone > 0 || yHabitsDone > 0) && (
                  <Text className="text-muted text-[11px] mt-2">Yesterday: {yTasksDone} tasks · {yHabitsDone} habits done</Text>
                )}
              </View>
            </View>
          </View>

          {/* Health today */}
          {health && (health.steps !== null || health.sleep !== null) && (
            <LabeledCard icon="directions-walk" color="#10b981" label="Health today">
              <View className="gap-2">
                {health.steps !== null && (
                  <View>
                    <View className="flex-row items-center justify-between mb-1">
                      <Text className="text-text text-[13px] font-medium">{health.steps.toLocaleString()} steps</Text>
                      <Text className="text-muted text-xs">{Math.round((health.steps / 10000) * 100)}% of goal</Text>
                    </View>
                    <View className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(16,185,129,0.15)' }}>
                      <View style={{ width: `${Math.min(100, (health.steps / 10000) * 100)}%` }} className="h-full rounded-full bg-emerald-500" />
                    </View>
                  </View>
                )}
                {health.sleep && (
                  <Text className="text-text text-[13px]">
                    Sleep: <Text className="font-semibold" style={{ color: '#10b981' }}>{health.sleep.hours}h {health.sleep.minutes}m</Text>
                  </Text>
                )}
                {health.heartRate && (
                  <Text className="text-muted text-xs">Heart rate: {health.heartRate} bpm</Text>
                )}
              </View>
            </LabeledCard>
          )}

          {/* Mission today */}
          {showS('mission') && data.top3?.[0]?.task && (
            <LinearGradient colors={['rgba(124,58,237,0.10)', 'rgba(124,58,237,0.03)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 16, borderWidth: 1, borderColor: 'rgba(124,58,237,0.25)' }}>
              <View className="px-5 py-4">
                <View className="flex-row items-center gap-2 mb-1.5">
                  <Icon name="track-changes" size={15} color={c.brand} />
                  <Text className="text-[11px] font-bold uppercase tracking-wider" style={{ color: c.brand }}>Mission today</Text>
                </View>
                <Text className="text-text text-[15px] font-semibold leading-snug">{data.top3[0].task}</Text>
                {!!data.top3[0].source && <Text className="text-muted text-xs mt-1">{data.top3[0].source}</Text>}
              </View>
            </LinearGradient>
          )}

          {/* Needs attention */}
          {showS('actionQueue') && needsAttention.length > 0 && (
            <LabeledCard icon="bolt" color="#f59e0b" label="Needs attention" right={<View className="px-2 py-0.5 rounded-full bg-amber-500/10"><Text className="text-[10px] font-bold" style={{ color: '#f59e0b' }}>{needsAttention.length}</Text></View>}>
              <View className="gap-2">
                {needsAttention.map(item => (
                  <View key={item.id} className="flex-row items-center gap-3 py-1">
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: item.kind === 'task' ? '#f87171' : '#fbbf24' }} />
                    <View className="flex-1">
                      <Text className="text-text text-[13px] font-medium" numberOfLines={1}>{item.title}</Text>
                      <Text className="text-muted text-[11px]">{item.sub}</Text>
                    </View>
                    {item.kind === 'task' ? (
                      <TouchableOpacity onPress={() => markTaskDone(item.id)} activeOpacity={0.7} className="px-2.5 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                        <Text className="text-[11px] font-semibold" style={{ color: '#10b981' }}>Done</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity onPress={() => logHabit(item.habit)} activeOpacity={0.7} className="px-2.5 py-1 rounded-lg border border-amber-500/30 bg-amber-500/5">
                        <Text className="text-[11px] font-semibold" style={{ color: '#f59e0b' }}>Log it</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            </LabeledCard>
          )}

          {/* Energy check */}
          {showS('energy') && (
          <LabeledCard icon="bolt" color="#f59e0b" label="Energy check">
            {energy ? (
              <>
                <Text className="text-text text-sm font-medium mb-1">{energyOpt ? energyOpt.label : energy}</Text>
                <Text className="text-muted text-xs">MODUS will {ENERGY_CONFIRM[energy] ?? 'keep this in mind.'}</Text>
              </>
            ) : (
              <>
                <Text className="text-muted text-sm mb-3">Where are you at this morning?</Text>
                <View className="flex-row flex-wrap gap-1.5">
                  {ENERGY_OPTS.map(o => (
                    <TouchableOpacity key={o.key} onPress={() => selectEnergy(o.key)} activeOpacity={0.7} className="px-3 py-1.5 rounded-lg border border-border bg-surface">
                      <Text className="text-text text-xs">{o.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput value={customEnergy} onChangeText={setCustomEnergy} onSubmitEditing={() => { if (customEnergy.trim()) selectEnergy(customEnergy.trim()); }} placeholder="Or type how you're feeling…" placeholderTextColor={c.muted} className="mt-3 text-muted text-xs" />
              </>
            )}
          </LabeledCard>
          )}

          {/* Top 3 — checkable */}
          {showS('top3') && data.top3?.length > 0 && (
            <LabeledCard icon="track-changes" color="#3b82f6" label="Top 3 today">
              <View className="gap-1.5">
                {data.top3.map((item, i) => {
                  const done = completedTop3.includes(i);
                  return (
                    <TouchableOpacity key={i} onPress={() => toggleTop3(i)} activeOpacity={0.7} className="flex-row items-center gap-3 px-3 py-2.5 rounded-lg bg-surface-2">
                      <Text className="text-[11px] font-bold w-3" style={{ color: done ? c.muted : c.brand }}>{i + 1}</Text>
                      <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: done ? c.brand : c.border, backgroundColor: done ? c.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                        {done && <Icon name="check" color="#fff" size={12} />}
                      </View>
                      <View className="flex-1">
                        <Text className="text-[13px] font-medium" style={[{ color: done ? c.muted : c.text }, done ? { textDecorationLine: 'line-through' } : {}]}>{item.task}</Text>
                        {!!item.source && <Text className="text-muted text-[10px] mt-0.5">{item.source}</Text>}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </LabeledCard>
          )}

          {/* Inbox */}
          {showS('inbox') && inboxConnected && (
            <LabeledCard
              icon="mail-outline" color="#10b981" label="Inbox"
              right={
                <View className="flex-row bg-surface border border-border rounded-lg p-0.5">
                  {(['primary', 'all'] as const).map(f => (
                    <TouchableOpacity key={f} onPress={() => setInboxFilter(f)} className={`px-2 py-0.5 rounded ${inboxFilter === f ? 'bg-brand' : ''}`}>
                      <Text className={`text-[10px] font-medium ${inboxFilter === f ? 'text-white' : 'text-muted'}`}>{f === 'primary' ? 'Primary' : 'All'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              }
            >
              {inboxLoading ? (
                <View className="gap-3 py-1">
                  {[0, 1].map(i => (
                    <View key={i} className="flex-row items-center gap-3">
                      <Skeleton width={28} height={28} radius={14} />
                      <View className="flex-1 gap-1.5">
                        <Skeleton width="40%" height={12} />
                        <Skeleton width="78%" height={11} />
                      </View>
                    </View>
                  ))}
                </View>
              ) : inbox.length === 0 ? (
                <Text className="text-muted text-xs">No unread emails.</Text>
              ) : (
                <View>
                  {inbox.slice(0, 5).map(t => {
                    const open = expandedMail === t.id;
                    return (
                      <View key={t.id} className="border-b border-border/50 last:border-0">
                        <TouchableOpacity onPress={() => setExpandedMail(open ? null : t.id)} activeOpacity={0.7} className="flex-row items-start gap-3 py-3">
                          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: avatarColor(t.from), alignItems: 'center', justifyContent: 'center' }}>
                            <Text className="text-white text-[11px] font-bold">{t.from.trim()[0]?.toUpperCase() ?? '?'}</Text>
                          </View>
                          <View className="flex-1">
                            <View className="flex-row justify-between gap-2">
                              <Text className="text-text text-xs font-semibold flex-1" numberOfLines={1}>{t.from}</Text>
                              <Text className="text-muted text-[10px]">{t.date?.slice(0, 6)}</Text>
                            </View>
                            <Text className="text-text/90 text-[12px]" numberOfLines={1}>{t.subject}</Text>
                            {!open && <Text className="text-muted text-[11px] mt-0.5" numberOfLines={1}>{t.snippet}</Text>}
                          </View>
                          {t.unread && <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 6, backgroundColor: c.brand }} />}
                        </TouchableOpacity>
                        {open && (
                          <View className="pb-3 -mt-1">
                            <View className="bg-surface-2 rounded-lg p-3">
                              <Text className="text-text/80 text-[12px] leading-5">{t.snippet}</Text>
                            </View>
                            <TouchableOpacity onPress={() => draftReply(t)} activeOpacity={0.7} className="mt-2.5 self-start px-3 py-1.5 rounded-lg border border-brand/40 bg-brand/5">
                              <Text className="text-brand text-[11px] font-semibold">Draft reply with MODUS ↗</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </LabeledCard>
          )}

          {/* Schedule timeline */}
          {showS('schedule') && (
          <LabeledCard icon="event" color="#3b82f6" label="Today's schedule">
            <ScheduleTimeline events={events} fallback={data.schedule ?? []} color={c.brand} />
          </LabeledCard>
          )}

          {/* Habits status (from briefing) */}
          {showS('habits') && data.habits?.length > 0 && (
            <LabeledCard icon="local-fire-department" color="#f97316" label="Habits">
              <View className="gap-0.5">
                {data.habits.map((h, i) => (
                  <View key={i} className="flex-row items-center justify-between gap-3 py-2">
                    <Text className="text-text text-[14px] flex-1" numberOfLines={1}>{h.name}</Text>
                    <HabitStatusPill status={h.status} streak={h.streak} />
                  </View>
                ))}
              </View>
            </LabeledCard>
          )}

          {/* Loose end */}
          {showS('looseEnd') && data.looseEnd?.text && (
            <ProactiveReveal delay={0} accent="#f97316">
              <LabeledCard icon="schedule" color="#f97316" label="Loose end" accent="rgba(249,115,22,0.45)">
                <Text className="text-text text-[13px] leading-5">{data.looseEnd.text}</Text>
                <TouchableOpacity onPress={() => router.push('/(app)/(tabs)/reminders' as never)} activeOpacity={0.7} className="mt-3 self-start px-2.5 py-1 rounded-lg border border-border bg-surface">
                  <Text className="text-muted text-[11px]">Handle now ↗</Text>
                </TouchableOpacity>
              </LabeledCard>
            </ProactiveReveal>
          )}

          {/* MODUS noticed */}
          {showS('pattern') && data.patternCallout && (
            <ProactiveReveal delay={90} accent="#f59e0b">
              <LabeledCard icon="visibility" color="#f59e0b" label="MODUS noticed" accent="rgba(245,158,11,0.45)">
                <Text className="text-text text-[13px] leading-5">{data.patternCallout}</Text>
              </LabeledCard>
            </ProactiveReveal>
          )}

          {/* Relationship nudge */}
          {showS('relationship') && data.relationshipAlert && (
            <ProactiveReveal delay={180} accent="#3b82f6">
              <LabeledCard icon="group" color="#3b82f6" label="Relationship nudge" accent="rgba(59,130,246,0.45)">
                <Text className="text-text text-[13px] leading-5">{data.relationshipAlert}</Text>
              </LabeledCard>
            </ProactiveReveal>
          )}

          {/* In the news */}
          {showS('news') && (
          <LabeledCard
            icon="article" color="#3b82f6" label={`In the news${newsIndustry ? ' · ' + newsIndustry : ''}`}
            right={
              <TouchableOpacity onPress={() => setNewsPickerOpen(v => !v)} hitSlop={8}>
                <Icon name={newsPickerOpen ? 'expand-less' : 'expand-more'} tone="muted" size={18} />
              </TouchableOpacity>
            }
          >
            {newsPickerOpen && (
              <View className="mb-3 border border-border rounded-xl overflow-hidden">
                {NEWS_TOPICS.map(topic => (
                  <TouchableOpacity key={topic} onPress={() => { setNewsTopic(topic); setNewsPickerOpen(false); }} className={`px-3 py-2 border-b border-border/40 ${topic === newsIndustry ? 'bg-brand/5' : ''}`}>
                    <Text className={`text-[12px] ${topic === newsIndustry ? 'text-brand font-semibold' : 'text-text'}`}>{topic}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {newsLoading ? (
              <View className="gap-3">{[0, 1, 2].map(i => (<View key={i} className="gap-1.5"><Skeleton height={12} /><Skeleton width="70%" height={11} /></View>))}</View>
            ) : news.length === 0 ? (
              <Text className="text-muted text-xs">No news right now.</Text>
            ) : (
              <View>
                {news.slice(0, 5).map((item, i) => (
                  <TouchableOpacity key={i} onPress={() => { Linking.openURL(item.url).catch(() => {}); }} activeOpacity={0.7} className={`py-3 ${i < Math.min(news.length, 5) - 1 ? 'border-b border-border/50' : ''}`}>
                    <Text className="text-text text-[13px] font-medium leading-snug" numberOfLines={2}>{item.title}</Text>
                    {!!item.snippet && <Text className="text-muted text-[11px] mt-0.5" numberOfLines={2}>{item.snippet}</Text>}
                    {!!hostname(item.url) && <Text className="text-muted/60 text-[10px] mt-1">{hostname(item.url)}</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </LabeledCard>
          )}

          {/* Ask MODUS */}
          <TouchableOpacity onPress={() => router.push('/(app)/(tabs)/chat' as never)} activeOpacity={0.85} className="flex-row items-center gap-3 rounded-2xl bg-brand/5 border border-brand/25 px-5 py-4 mt-1">
            <View className="w-9 h-9 rounded-xl bg-brand/15 items-center justify-center"><Icon name="chat-bubble-outline" tone="brand" size={18} /></View>
            <View className="flex-1">
              <Text className="text-text font-semibold text-[15px]">Anything on your mind?</Text>
              <Text className="text-muted text-xs mt-0.5">Add a task, ask what you missed, or talk it through</Text>
            </View>
            <Icon name="chevron-right" tone="muted" size={20} />
          </TouchableOpacity>
        </ScrollView>
      )}
      </SafeAreaView>
    </ScreenFade>
  );
}
