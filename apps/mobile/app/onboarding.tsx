import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withSequence,
  FadeInDown,
  FadeInRight,
  FadeInLeft,
  FadeOut,
} from 'react-native-reanimated';
import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import * as WebBrowser from 'expo-web-browser';
import { API_BASE, getAuthHeader, startCheckout } from '@/lib/api';
import { AuthButtons } from '@/components/AuthButtons';
import { Icon, type IconName } from '@/components/Icon';
import { OpenAILogo, AnthropicLogo, GeminiLogo, MetaLogo } from '@/components/BrandLogo';
import { Logo } from '@/components/ui/Logo';
import { AppBackground } from '@/components/AppBackground';
import { GradientButton } from '@/components/ui/GradientButton';
import { GradientText } from '@/components/ui/GradientText';
import { AnimatedRow } from '@/components/ui/AnimatedRow';
import { GradientProgressBar } from '@/components/ui/GradientProgressBar';
import { useThemeColors } from '@/lib/theme';

interface Option { icon: IconName; label: string; desc?: string }

const EMPLOYMENT: Option[] = [
  { icon: 'work', label: 'Employed full-time', desc: 'Working 9 to 5 and beyond' },
  { icon: 'bolt', label: 'Self-employed / freelancer', desc: 'Running your own show' },
  { icon: 'schedule', label: 'Employed part-time', desc: 'Splitting your time' },
  { icon: 'school', label: 'Student', desc: 'Still in the learning phase' },
  { icon: 'search', label: 'Between roles', desc: 'Looking for the next move' },
  { icon: 'more-horiz', label: 'Other' },
];
const INDUSTRY: Option[] = [
  { icon: 'code', label: 'Tech / software' },
  { icon: 'palette', label: 'Marketing / creative' },
  { icon: 'trending-up', label: 'Finance / business' },
  { icon: 'local-hospital', label: 'Healthcare' },
  { icon: 'school', label: 'Education' },
  { icon: 'handshake', label: 'Sales' },
  { icon: 'build', label: 'Trades / skilled labor' },
  { icon: 'more-horiz', label: 'Other' },
];
const GOALS: Option[] = [
  { icon: 'flag', label: 'Land a new job or role' },
  { icon: 'rocket-launch', label: 'Build a business or side project' },
  { icon: 'schedule', label: 'Get better at managing my time' },
  { icon: 'bolt', label: 'Ship more / be more productive at work' },
  { icon: 'psychology', label: 'Develop a new skill' },
  { icon: 'explore', label: 'Figure out what I actually want to do' },
  { icon: 'more-horiz', label: 'Other' },
];
const CHALLENGE: Option[] = [
  { icon: 'autorenew', label: "Know what to do but can't stay consistent" },
  { icon: 'waves', label: "Overwhelmed and don't know where to start" },
  { icon: 'smartphone', label: 'Get distracted too easily' },
  { icon: 'cloud', label: "Set goals but don't follow through" },
  { icon: 'map', label: "Don't have a clear plan" },
  { icon: 'more-horiz', label: 'Other' },
];
const TASKS: Option[] = [
  { icon: 'check-circle', label: 'I use a to-do app' },
  { icon: 'psychology', label: 'I keep it in my head' },
  { icon: 'edit-note', label: 'I use a notes app' },
  { icon: 'calendar-today', label: 'I use a calendar' },
  { icon: 'warning-amber', label: 'I have a system but it breaks down' },
  { icon: 'help-outline', label: "I don't really manage them" },
  { icon: 'more-horiz', label: 'Other' },
];

const PAYWALL_FEATURES: Array<{ icon: IconName; label: string }> = [
  { icon: 'wb-sunny', label: 'Morning briefing' },
  { icon: 'inbox', label: 'Inbox triage' },
  { icon: 'flag', label: 'Goal tracking' },
  { icon: 'mic', label: 'Voice input' },
  { icon: 'psychology', label: 'AI chief of staff' },
];

function OptionCard({ option, selected, onPress, multi }: {
  option: Option; selected: boolean; onPress: () => void; multi?: boolean;
}) {
  const c = useThemeColors();
  const scale = useSharedValue(1);

  function handlePress() {
    scale.value = withSequence(
      withTiming(0.96, { duration: 60 }),
      withSpring(1, { damping: 8, stiffness: 200 }),
    );
    onPress();
  }

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable onPress={handlePress}>
      <Animated.View
        style={cardStyle}
        className={`flex-row items-center gap-3 p-3.5 rounded-2xl border ${
          selected ? 'border-brand bg-surface-2' : 'border-border bg-surface'
        }`}
      >
        <View className={`w-10 h-10 rounded-xl items-center justify-center ${selected ? 'bg-brand/20' : 'bg-surface-2'}`}>
          <Icon name={option.icon} size={20} color={selected ? c.brand : c.muted} />
        </View>
        <View className="flex-1">
          <Text className={`text-[15px] font-semibold ${selected ? 'text-brand-light' : 'text-text'}`}>
            {option.label}
          </Text>
          {option.desc && <Text className="text-muted text-xs mt-0.5">{option.desc}</Text>}
        </View>
        <View
          className={`items-center justify-center shrink-0 ${multi ? 'w-5 h-5 rounded-md' : 'w-5 h-5 rounded-full'} border-2 ${
            selected ? 'border-brand bg-brand' : 'border-muted/40'
          }`}
        >
          {selected && <Icon name="check" color="#fff" size={12} />}
        </View>
      </Animated.View>
    </Pressable>
  );
}

function OtherInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="Describe in your own words…"
      placeholderTextColor="#6b6b80"
      className="bg-bg border border-brand/40 rounded-xl px-4 py-3 text-text text-[15px] mt-2"
      autoFocus
    />
  );
}

function PaywallScreen({
  name,
  industry,
  goals,
  onContinue,
  onFree,
  onBack,
}: {
  name: string;
  industry: string;
  goals: string[];
  onContinue: () => void;
  /** Skip checkout and start on the Free plan. */
  onFree: () => void;
  onBack: () => void;
}) {
  const c = useThemeColors();
  return (
    <View className="flex-1 bg-bg">
      <AppBackground />
      <SafeAreaView className="flex-1" edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <Animated.View entering={FadeInDown.delay(0).duration(400)} className="items-center pt-4 pb-6">
            <View className="mb-4">
              <Logo width={52} opticalCenter />
            </View>
            <GradientText className="text-[30px] font-black leading-tight">
              Your MODUS is ready
            </GradientText>
            <Animated.View entering={FadeInDown.delay(100).duration(350)}>
              <Text className="text-muted text-sm text-center mt-2 px-4">
                Personalized for you. Activated the moment you sign up.
              </Text>
            </Animated.View>
          </Animated.View>

          {/* Personalized summary card */}
          <AnimatedRow index={0}>
            <View className="bg-surface border border-brand/25 rounded-2xl p-4 mb-5">
              <Text className="text-brand-light text-[10px] font-bold uppercase tracking-widest mb-3">
                Built for {name.trim() || 'you'}
              </Text>
              <View className="gap-2">
                {!!industry && (
                  <View className="flex-row items-center gap-2.5">
                    <Icon name="work" color={c.brand} size={14} />
                    <Text className="text-text text-sm">{industry}</Text>
                  </View>
                )}
                {goals.slice(0, 2).map((g, i) => (
                  <View key={i} className="flex-row items-center gap-2.5">
                    <Icon name="flag" color={c.brand} size={14} />
                    <Text className="text-text text-sm flex-1" numberOfLines={1}>{g}</Text>
                  </View>
                ))}
                {!industry && goals.length === 0 && (
                  <View className="flex-row items-center gap-2.5">
                    <Icon name="auto-awesome" color={c.brand} size={14} />
                    <Text className="text-text text-sm">Your AI operating system</Text>
                  </View>
                )}
              </View>
            </View>
          </AnimatedRow>

          {/* Feature list */}
          <AnimatedRow index={1}>
            <Text className="text-muted text-[10px] uppercase tracking-widest font-semibold mb-3 px-1">
              What you get
            </Text>
          </AnimatedRow>
          <View className="gap-2 mb-6">
            {PAYWALL_FEATURES.map((f, i) => (
              <AnimatedRow key={f.label} index={i + 2}>
                <View className="flex-row items-center gap-3 py-1">
                  <View className="w-8 h-8 rounded-xl bg-brand/15 items-center justify-center">
                    <Icon name={f.icon} color={c.brand} size={16} />
                  </View>
                  <Text className="text-text text-[15px] font-medium flex-1">{f.label}</Text>
                  <Icon name="check-circle" color={c.brand} size={18} />
                </View>
              </AnimatedRow>
            ))}
          </View>

          {/* Divider */}
          <AnimatedRow index={8}>
            <View className="h-px bg-border mb-5" />
          </AnimatedRow>

          {/* Plan comparison */}
          <AnimatedRow index={9}>
            <View className="flex-row gap-3 mb-6">
              {/* Free */}
              <View className="flex-1 bg-surface border border-border rounded-2xl p-4">
                <Text className="text-text font-bold text-sm mb-1">Free</Text>
                <Text className="text-2xl font-display font-black text-text">$0</Text>
                <Text className="text-muted text-[11px] mt-1 leading-relaxed">
                  {'no card'}
                </Text>
                <View className="mt-3 gap-1.5">
                  <Text className="text-muted text-[11px]">· Open models</Text>
                  <Text className="text-muted text-[11px]">· Limits refresh daily</Text>
                </View>
              </View>
              {/* MODUS paid */}
              <View className="flex-1 bg-brand/10 border-2 border-brand rounded-2xl p-4">
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-brand-light font-bold text-sm">MODUS</Text>
                  <View className="bg-brand/20 px-2 py-0.5 rounded-full">
                    <Text className="text-brand-light text-[9px] font-bold">POPULAR</Text>
                  </View>
                </View>
                <Text className="text-2xl font-display font-black text-text">$28</Text>
                <Text className="text-muted text-[11px]">/month</Text>
                <View className="mt-3 gap-1.5">
                  <Text className="text-text text-[11px]">· Every provider</Text>
                  <Text className="text-text text-[11px]">· Higher limits</Text>
                  <Text className="text-text text-[11px]">· Proactive briefings</Text>
                </View>
              </View>
            </View>
          </AnimatedRow>

          {/* CTA */}
          <AnimatedRow index={10}>
            <View className="gap-3">
              <GradientButton
                label="Get MODUS"
                onPress={onContinue}
                size="lg"
                style={{ alignSelf: 'stretch' }}
              />
              <Text className="text-muted/70 text-[11px] text-center leading-4">
                $28/mo or $280/yr. Cancel anytime.
              </Text>
              <TouchableOpacity onPress={onFree} className="py-2 items-center">
                <Text className="text-muted text-sm">Start on Free</Text>
              </TouchableOpacity>
            </View>
          </AnimatedRow>
        </ScrollView>

        {/* Back nav */}
        <View className="px-7 pb-6 pt-3 border-t border-border">
          <TouchableOpacity onPress={onBack} className="py-2">
            <Text className="text-muted text-sm">← Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

// Multi-model showcase — MODUS's core differentiator, surfaced right before the
// paywall so it justifies the trial. Reuses the BrandLogo provider marks + the
// Auto-routing copy from model-settings.tsx.
const MODEL_ROUTES: { task: string; model: string; Logo: React.ComponentType<{ size?: number }> }[] = [
  { task: 'Write a cold email',   model: 'Gemini', Logo: GeminiLogo },
  { task: 'Debug my code',        model: 'GPT-6', Logo: OpenAILogo },
  { task: 'Research a market',    model: 'Claude', Logo: AnthropicLogo },
  { task: 'Plan my week',         model: 'GPT-6', Logo: OpenAILogo },
];

function ModelsScreen({ name, onContinue, onBack }: { name: string; onContinue: () => void; onBack: () => void }) {
  const c = useThemeColors();
  return (
    <View className="flex-1 bg-bg">
      <AppBackground />
      <SafeAreaView className="flex-1" edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.delay(0).duration(400)} className="items-center pt-4 pb-5">
            <View className="mb-4"><Logo width={48} opticalCenter /></View>
            <GradientText className="text-[28px] font-black leading-tight">
              {'Every model.\nOne app.'}
            </GradientText>
            <Text className="text-muted text-sm text-center mt-2 px-2">
              GPT-6, Claude, Gemini, Llama{name.trim() ? '' : ''}, MODUS routes each task to whichever is best. Or pick one yourself.
            </Text>
          </Animated.View>

          {/* Provider logos */}
          <AnimatedRow index={0}>
            <View className="flex-row justify-center gap-3 mb-6">
              {[OpenAILogo, AnthropicLogo, GeminiLogo, MetaLogo].map((L, i) => (
                <View key={i} className="w-11 h-11 rounded-2xl bg-surface border border-border items-center justify-center">
                  <L size={22} />
                </View>
              ))}
            </View>
          </AnimatedRow>

          {/* Auto highlight */}
          <AnimatedRow index={1}>
            <View className="bg-brand/10 border-2 border-brand rounded-2xl p-4 mb-5 flex-row items-center gap-3">
              <View className="w-11 h-11 rounded-2xl bg-brand/20 items-center justify-center shrink-0">
                <Icon name="auto-awesome" tone="brand" size={22} />
              </View>
              <View className="flex-1">
                <Text className="text-brand-light font-bold text-[15px]">Auto: MODUS picks for you</Text>
                <Text className="text-muted text-xs mt-0.5 leading-relaxed">
                  Claude for writing & analysis, a reasoning model for code & math, real-time for research, fast Llama for everyday.
                </Text>
              </View>
            </View>
          </AnimatedRow>

          {/* Routing examples */}
          <AnimatedRow index={2}>
            <Text className="text-muted text-[10px] uppercase tracking-widest font-semibold mb-2 px-1">How Auto routes</Text>
          </AnimatedRow>
          <View className="gap-2 mb-2">
            {MODEL_ROUTES.map((r, i) => (
              <AnimatedRow key={r.task} index={i + 3}>
                <View className="flex-row items-center gap-3 bg-surface border border-border rounded-2xl p-3.5">
                  <Text className="text-text text-sm flex-1">{r.task}</Text>
                  <Icon name="arrow-forward" color={c.muted} size={14} />
                  <View className="flex-row items-center gap-1.5 bg-surface-2 border border-brand/25 rounded-full pl-2 pr-2.5 py-1">
                    <r.Logo size={14} />
                    <Text className="text-text text-xs font-semibold">{r.model}</Text>
                  </View>
                </View>
              </AnimatedRow>
            ))}
          </View>
        </ScrollView>

        {/* Bottom nav */}
        <View className="px-7 pb-6 pt-3 border-t border-border gap-3">
          <GradientButton
            label="Continue"
            icon="arrow-forward"
            onPress={onContinue}
            size="lg"
            style={{ alignSelf: 'stretch' }}
          />
          <TouchableOpacity onPress={onBack} className="py-1">
            <Text className="text-muted text-sm">← Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

type Screen = 'name' | number | 'models' | 'paywall' | 'done';
const TOTAL = 8;

export default function OnboardingScreen() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>('name');
  const [saving, setSaving] = useState(false);
  const directionRef = useRef<'forward' | 'back'>('forward');

  const [name, setName] = useState('');
  const [employment, setEmployment] = useState('');
  const [employmentOther, setEmploymentOther] = useState('');
  const [industry, setIndustry] = useState('');
  const [industryOther, setIndustryOther] = useState('');
  const [goals, setGoals] = useState<string[]>([]);
  const [goalsOther, setGoalsOther] = useState('');
  const [challenge, setChallenge] = useState('');
  const [challengeOther, setChallengeOther] = useState('');
  const [thirtyDayGoal, setThirtyDayGoal] = useState('');
  const [taskSystem, setTaskSystem] = useState('');
  const [taskSystemOther, setTaskSystemOther] = useState('');

  function goForward(next: Screen) {
    directionRef.current = 'forward';
    setScreen(next);
  }

  function goBack(prev: Screen) {
    directionRef.current = 'back';
    setScreen(prev);
  }

  function toggleGoal(g: string) {
    setGoals(prev => (prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]));
  }

  const stepValid: Record<number, boolean> = {
    1: employment !== '' && (employment !== 'Other' || employmentOther.trim() !== ''),
    2: industry !== '' && (industry !== 'Other' || industryOther.trim() !== ''),
    3: goals.length > 0 && (!goals.includes('Other') || goalsOther.trim() !== ''),
    4: challenge !== '' && (challenge !== 'Other' || challengeOther.trim() !== ''),
    5: thirtyDayGoal.trim() !== '',
    6: taskSystem !== '' && (taskSystem !== 'Other' || taskSystemOther.trim() !== ''),
    7: true,
  };

  // Set on the paywall: true = checkout MODUS after sign-in, false = start on Free.
  const wantsPaidRef = useRef(true);

  async function seedAndGo(uid: string) {
    setSaving(true);
    setScreen('done');
    try {
      const existing = await getDoc(doc(db, 'users', uid));
      if (existing.data()?.onboardingComplete === true) {
        setTimeout(() => router.replace('/(app)/(tabs)/briefing'), 700);
        return;
      }

      const empLabel = employment === 'Other' ? employmentOther.trim() : employment;
      const indLabel = industry === 'Other' ? industryOther.trim() : industry;
      const goalsArr = goals.map(g => (g === 'Other' ? goalsOther.trim() : g));
      const chalLabel = challenge === 'Other' ? challengeOther.trim() : challenge;
      const taskLabel = taskSystem === 'Other' ? taskSystemOther.trim() : taskSystem;

      const personalContext = [
        name.trim() && `My name is ${name.trim()}.`,
        empLabel && `Employment: ${empLabel}.`,
        indLabel && `Field: ${indLabel}.`,
        goalsArr.length && `Goals: ${goalsArr.join(', ')}.`,
        chalLabel && `Biggest challenge: ${chalLabel}.`,
        thirtyDayGoal.trim() && `30-day goal: ${thirtyDayGoal.trim()}.`,
        taskLabel && `Task system: ${taskLabel}.`,
      ].filter(Boolean).join(' ');

      await setDoc(doc(db, 'users', uid), {
        displayName: name.trim() || null,
        onboardingComplete: true,
        onboardingAnswers: {
          employment: empLabel, industry: indLabel, goals: goalsArr,
          challenge: chalLabel, thirtyDayGoal: thirtyDayGoal.trim(), taskSystem: taskLabel,
        },
        settings: {
          personalContext,
          responseStyle: 'normal',
          capabilities: { dailyBriefing: false, voiceInput: false, vectorMemory: true },
          generateMemoryFromChat: true,
          helpImprove: false,
          dataRetention: true,
          customStyle: '',
        },
      }, { merge: true });

      if (thirtyDayGoal.trim()) {
        await addDoc(collection(db, 'users', uid, 'goals'), {
          title: thirtyDayGoal.trim(), description: '', status: 'active',
          progress: 0, source: 'onboarding', createdAt: serverTimestamp(),
        });
      }

      await addDoc(collection(db, 'users', uid, 'habits'), {
        name: 'Daily Review',
        description: 'Check in with MODUS each day. Review your goals, plan your day, and stay on track.',
        frequency: 'daily', target: 1, color: '#7c3aed', icon: '🔁',
        completedDates: [], source: 'onboarding', createdAt: serverTimestamp(),
      });

      const memories = [
        name.trim() && `My name is ${name.trim()}.`,
        empLabel && `Employment: ${empLabel}. Field: ${indLabel}.`,
        goalsArr.length && `What I'm working toward: ${goalsArr.join(', ')}.`,
        chalLabel && `My biggest challenge: ${chalLabel}.`,
        thirtyDayGoal.trim() && `My 30-day goal: ${thirtyDayGoal.trim()}.`,
      ].filter(Boolean) as string[];

      const headers = await getAuthHeader();
      for (const mem of memories) {
        await addDoc(collection(db, 'users', uid, 'memories'), {
          content: mem, source: 'onboarding', createdAt: serverTimestamp(),
        });
        fetch(`${API_BASE}/api/memory/upsert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ text: mem }),
        }).catch(() => {});
      }

      // Checkout only when they chose MODUS on the paywall. There is no free
      // trial: checkout charges, so the old "3-day free trial" copy was untrue,
      // and a user who wants Free must not be sent to a card form. If checkout
      // can't start, fall through to the app on Free.
      if (wantsPaidRef.current) {
        try {
          const url = await startCheckout('modus');
          await WebBrowser.openBrowserAsync(url);
        } catch { /* fall through */ }
      }
      setTimeout(() => router.replace('/(app)/(tabs)/briefing'), 900);
    } catch {
      setTimeout(() => router.replace('/(app)/(tabs)/briefing'), 900);
    }
  }

  // ── name screen ──
  if (screen === 'name') {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const previewText = name.trim()
      ? `${greeting}, ${name.trim()}. I'm MODUS. Let's get to work.`
      : `${greeting}. I'm MODUS. What are we working on today?`;
    return (
      <View className="flex-1 bg-bg">
        <AppBackground />
        <SafeAreaView className="flex-1">
          <View className="flex-1 px-7 pt-8 justify-between pb-10">
            <View className="gap-6">
              <Animated.View entering={FadeInDown.delay(0).duration(400)} className="items-center mb-1">
                <Logo width={44} />
              </Animated.View>
              <Animated.View entering={FadeInDown.delay(80).duration(380)}>
                <Text className="text-brand-light text-xs font-bold uppercase tracking-widest mb-2">
                  First things first
                </Text>
                <GradientText className="text-[28px] font-black leading-tight">
                  {'What should\nMODUS call you?'}
                </GradientText>
                <Text className="text-muted text-sm mt-2">Your assistant needs a name for you.</Text>
              </Animated.View>
              <Animated.View entering={FadeInDown.delay(180).duration(360)}>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Your first name"
                  placeholderTextColor="#6b6b80"
                  autoFocus
                  className="bg-surface border border-border rounded-2xl px-5 py-4 text-text text-base"
                />
              </Animated.View>
              <Animated.View entering={FadeInDown.delay(260).duration(360)}>
                <View className="bg-surface border border-border rounded-2xl px-5 py-4">
                  <Text className="text-muted text-xs mb-1">Live preview</Text>
                  <Text className="text-text text-sm leading-relaxed">
                    "{previewText}"
                  </Text>
                </View>
              </Animated.View>
            </View>
            <View className="gap-4">
              <Animated.View entering={FadeInDown.delay(340).duration(360)}>
                <GradientButton
                  label="Continue"
                  icon="arrow-forward"
                  onPress={() => goForward(1)}
                  disabled={!name.trim()}
                  size="lg"
                  style={{ alignSelf: 'stretch' }}
                />
              </Animated.View>
              <TouchableOpacity onPress={() => router.replace('/(auth)/login')} className="py-1">
                <Text className="text-muted text-sm text-center">
                  Already have an account?{' '}
                  <Text className="text-brand-light font-semibold">Sign in</Text>
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── done screen ──
  if (screen === 'done') {
    return (
      <View className="flex-1 bg-bg">
        <AppBackground />
        <SafeAreaView className="flex-1 items-center justify-center gap-4">
          <Logo width={84} opticalCenter />
          <Text className="text-4xl font-display font-bold text-brand tracking-widest">MODUS</Text>
          <Text className="text-text font-bold text-lg">
            MODUS is ready{name.trim() ? `, ${name.trim()}` : ''}.
          </Text>
          <Text className="text-muted text-sm">Setting up your workspace…</Text>
          <ActivityIndicator color="#7C3AED" className="mt-2" />
        </SafeAreaView>
      </View>
    );
  }

  // ── models showcase screen ──
  if (screen === 'models') {
    return (
      <ModelsScreen
        name={name}
        onContinue={() => goForward('paywall')}
        onBack={() => goBack(7)}
      />
    );
  }

  // ── paywall screen ──
  if (screen === 'paywall') {
    const industryLabel = industry === 'Other' ? industryOther.trim() : industry;
    const goalsArr = goals.map(g => (g === 'Other' ? goalsOther.trim() : g)).filter(Boolean);
    return (
      <PaywallScreen
        name={name}
        industry={industryLabel}
        goals={goalsArr}
        onContinue={() => { wantsPaidRef.current = true; goForward(8); }}
        onFree={() => { wantsPaidRef.current = false; goForward(8); }}
        onBack={() => goBack('models')}
      />
    );
  }

  // ── step screens ──
  const step = screen as number;
  const isLast = step === TOTAL;
  const alreadyAuthed = !!auth.currentUser;

  const entering = directionRef.current === 'forward'
    ? FadeInRight.duration(280)
    : FadeInLeft.duration(280);

  const step8Title = name.trim() ? `You're all set, ${name.trim()}.` : "You're all set.";

  const config: Record<number, { label: string; title: string; subtitle?: string; body: React.ReactNode }> = {
    1: {
      label: `Step 1 of ${TOTAL} · Who you are`,
      title: 'What best describes your situation?',
      body: (
        <View className="gap-2">
          {EMPLOYMENT.map((o, i) => (
            <AnimatedRow key={o.label} index={i}>
              <View>
                <OptionCard option={o} selected={employment === o.label} onPress={() => setEmployment(o.label)} />
                {o.label === 'Other' && employment === 'Other' && (
                  <OtherInput value={employmentOther} onChange={setEmploymentOther} />
                )}
              </View>
            </AnimatedRow>
          ))}
        </View>
      ),
    },
    2: {
      label: `Step 2 of ${TOTAL} · Work context`,
      title: 'What field are you in?',
      subtitle: 'Or were in, if between roles.',
      body: (
        <View className="gap-2">
          {INDUSTRY.map((o, i) => (
            <AnimatedRow key={o.label} index={i}>
              <View>
                <OptionCard option={o} selected={industry === o.label} onPress={() => setIndustry(o.label)} />
                {o.label === 'Other' && industry === 'Other' && (
                  <OtherInput value={industryOther} onChange={setIndustryOther} />
                )}
              </View>
            </AnimatedRow>
          ))}
        </View>
      ),
    },
    3: {
      label: `Step 3 of ${TOTAL} · Goals`,
      title: 'What are we working on?',
      subtitle: 'Pick all that apply.',
      body: (
        <View className="gap-2">
          {GOALS.map((o, i) => (
            <AnimatedRow key={o.label} index={i}>
              <View>
                <OptionCard option={o} multi selected={goals.includes(o.label)} onPress={() => toggleGoal(o.label)} />
                {o.label === 'Other' && goals.includes('Other') && (
                  <OtherInput value={goalsOther} onChange={setGoalsOther} />
                )}
              </View>
            </AnimatedRow>
          ))}
        </View>
      ),
    },
    4: {
      label: `Step 4 of ${TOTAL} · Biggest blocker`,
      title: "What's your biggest challenge right now?",
      body: (
        <View className="gap-2">
          {CHALLENGE.map((o, i) => (
            <AnimatedRow key={o.label} index={i}>
              <View>
                <OptionCard option={o} selected={challenge === o.label} onPress={() => setChallenge(o.label)} />
                {o.label === 'Other' && challenge === 'Other' && (
                  <OtherInput value={challengeOther} onChange={setChallengeOther} />
                )}
              </View>
            </AnimatedRow>
          ))}
        </View>
      ),
    },
    5: {
      label: `Step 5 of ${TOTAL} · Right now`,
      title: 'What do you want to accomplish in the next 30 days?',
      body: (
        <View className="gap-2">
          <TextInput
            value={thirtyDayGoal}
            onChangeText={setThirtyDayGoal}
            placeholder="Be specific, MODUS will hold you to it."
            placeholderTextColor="#6b6b80"
            multiline
            autoFocus
            className="bg-surface border border-border rounded-2xl px-5 py-4 text-text text-[15px]"
            style={{ minHeight: 120, textAlignVertical: 'top' }}
          />
          <Text className="text-muted text-xs px-1">This becomes your first tracked goal in MODUS.</Text>
        </View>
      ),
    },
    6: {
      label: `Step 6 of ${TOTAL} · How you operate`,
      title: 'How do you manage tasks today?',
      body: (
        <View className="gap-2">
          {TASKS.map((o, i) => (
            <AnimatedRow key={o.label} index={i}>
              <View>
                <OptionCard option={o} selected={taskSystem === o.label} onPress={() => setTaskSystem(o.label)} />
                {o.label === 'Other' && taskSystem === 'Other' && (
                  <OtherInput value={taskSystemOther} onChange={setTaskSystemOther} />
                )}
              </View>
            </AnimatedRow>
          ))}
        </View>
      ),
    },
    7: {
      label: `Step 7 of ${TOTAL} · Your first habit`,
      title: 'Start with one habit',
      subtitle: "We've picked the one that makes everything else work.",
      body: (
        <View className="gap-4">
          <View className="bg-surface-2 border border-brand/30 rounded-2xl p-5 gap-3">
            <View className="flex-row items-center gap-3">
              <View className="w-12 h-12 rounded-2xl bg-brand/20 items-center justify-center">
                <Icon name="autorenew" tone="brand" size={24} />
              </View>
              <View className="flex-1">
                <Text className="text-text font-bold text-base">Daily Review</Text>
                <Text className="text-muted text-xs">Every day · ~2 minutes</Text>
              </View>
              <View className="bg-brand/15 px-2.5 py-1 rounded-full">
                <Text className="text-brand-light text-xs font-semibold">Added</Text>
              </View>
            </View>
            <Text className="text-muted text-sm leading-relaxed">
              Check in with MODUS each day. Review your goals, plan your day, and stay on track. The single habit that makes everything else work.
            </Text>
          </View>
          <Text className="text-muted text-xs text-center">
            This habit will appear in your Habits tab and be tracked every day.
            {name.trim() ? ` You've got this, ${name.trim()}.` : ''}
          </Text>
        </View>
      ),
    },
    8: {
      label: `Step 8 of ${TOTAL} · Save your setup`,
      title: step8Title,
      subtitle: 'Create your account to save everything and meet MODUS.',
      body: (
        <View className="gap-5">
          <View className="bg-surface border border-border rounded-2xl p-5 gap-3">
            <Text className="text-muted text-xs uppercase tracking-wider font-semibold">What MODUS will set up</Text>
            {[
              thirtyDayGoal.trim() ? `Your 30-day goal: "${thirtyDayGoal.trim()}"` : 'Your first goal',
              'A Daily Review habit to keep you on track',
              'A memory of who you are and what you want',
            ].map((line, i) => (
              <View key={i} className="flex-row items-start gap-2.5">
                <View className="mt-0.5"><Icon name="check" tone="brand" size={16} /></View>
                <Text className="text-text text-sm flex-1 leading-snug">{line}</Text>
              </View>
            ))}
          </View>

          {alreadyAuthed ? (
            <GradientButton
              label="Finish & launch MODUS"
              icon="arrow-forward"
              onPress={() => seedAndGo(auth.currentUser!.uid)}
              disabled={saving}
              loading={saving}
              size="lg"
              style={{ alignSelf: 'stretch' }}
            />
          ) : (
            <AuthButtons afterSignIn={seedAndGo} />
          )}

          <Text className="text-muted/70 text-[11px] text-center px-4 leading-4">
            {wantsPaidRef.current ? 'MODUS is $28/mo. Cancel anytime.' : 'Free plan. Upgrade anytime.'}
          </Text>
        </View>
      ),
    },
  };

  const current = config[step];

  return (
    <View className="flex-1 bg-bg">
      <AppBackground />
      <SafeAreaView className="flex-1">
        {/* Logo + progress header */}
        <View className="items-center pt-5 pb-1">
          <Logo width={28} />
        </View>
        <View className="px-7 pt-2 pb-1">
          <GradientProgressBar progress={(step / TOTAL) * 100} height={4} />
          <View className="flex-row justify-between mt-2">
            <Text className="text-muted text-xs">{current.label}</Text>
            <Text className="text-muted text-xs">{Math.round((step / TOTAL) * 100)}%</Text>
          </View>
        </View>

        {/* Animated step content — keyed on screen so entering fires on every step change */}
        <Animated.View
          key={String(screen)}
          entering={entering}
          exiting={FadeOut.duration(150)}
          className="flex-1"
        >
          <ScrollView
            contentContainerStyle={{ padding: 28, paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Animated.View entering={FadeInDown.delay(0).duration(300)}>
              <GradientText className="text-2xl font-black leading-tight">
                {current.title}
              </GradientText>
              {current.subtitle && (
                <Text className="text-muted text-sm mt-1.5 mb-1">{current.subtitle}</Text>
              )}
            </Animated.View>
            <View className="mt-5">{current.body}</View>
          </ScrollView>
        </Animated.View>

        {/* Bottom nav */}
        <View className="flex-row items-center justify-between px-7 pt-3 pb-8 border-t border-border">
          <TouchableOpacity
            onPress={() => {
              if (step === 1) goBack('name');
              else goBack(step - 1);
            }}
            className="py-2 pr-4"
          >
            <Text className="text-muted text-sm">← Back</Text>
          </TouchableOpacity>
          {!isLast && (
            <GradientButton
              label="Continue"
              icon="arrow-forward"
              onPress={() => goForward(step === 7 ? 'models' : step + 1)}
              disabled={!stepValid[step]}
              size="md"
            />
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}
