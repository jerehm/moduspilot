'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence, MotionConfig, useReducedMotion } from 'framer-motion';
import Image from 'next/image';
import MarketingDecor from '@/components/marketing/MarketingDecor';
import CadenceToggle from '@/components/marketing/CadenceToggle';
import { ClaudeLogo, OpenAILogo, GeminiLogo, MetaLogo } from '@/components/marketing/ModelLogos';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  doc, getDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { seedOnboardingAccount } from '@/lib/onboarding';
import { trackMetaWithServer } from '@/lib/meta-pixel';
import { isPaidPlan } from '@/lib/plan';
import { CADENCE_STORAGE_KEY, PLAN_PRICING, isCadence, type Cadence } from '@/lib/pricing';

// ── types ──────────────────────────────────────────────────────────────────────
// Reordered 2026-07-21: the multi-model showcase now comes BEFORE any question,
// so the first thing a new account sees is the reason to pay rather than a form.
// `name` and `role` merged into one `you` screen, and the name is prefilled from
// the Google/Apple profile we already have — asking for a name the auth provider
// just handed us was a whole step that bought nothing.
type Screen = 'welcome' | 'you' | 'plan' | 'done';
// 🪤 The plan step is CONDITIONAL — someone who already pays must never be asked
// to pick a plan (see questionScreens() and alreadyPaid below). Anything that
// counts steps has to count the same list the flow actually walks, so this is a
// function of the account rather than a module constant.
function questionScreens(alreadyPaid: boolean): Screen[] {
  return alreadyPaid ? ['you'] : ['you', 'plan'];
}
type PlanId = 'free' | 'modus' | 'pilot';

// ── data ───────────────────────────────────────────────────────────────────────
// Text only. The emoji read as clip-art next to a serif headline.
const ROLE_OPTIONS = ['Founder / builder', 'Executive / manager', 'Professional', 'Student', 'Other'];
const AGE_OPTIONS = ['18-24', '25-34', '35-44', '45-54', '55+'];
// "Prefer not to say" is a real option, not a fallback — nothing downstream
// requires gender, it only sharpens personalContext when volunteered.
const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];

// Premium model brands MODUS routes between — brand names only (no versions), so
// nothing to keep updated. Reuses the shared marketing logo marks.
const BRAND_MODELS = [
  { name: 'ChatGPT', Logo: OpenAILogo },
  { name: 'Claude',  Logo: ClaudeLogo },
  { name: 'Gemini',  Logo: GeminiLogo },
  { name: 'Llama',   Logo: MetaLogo },
];

// ── animation helpers ──────────────────────────────────────────────────────────
const slideVariants = {
  initial: (dir: number) => ({ opacity: 0, x: dir * 40, filter: 'blur(4px)' }),
  animate: { opacity: 1, x: 0, filter: 'blur(0px)' },
  exit:    (dir: number) => ({ opacity: 0, x: dir * -40, filter: 'blur(4px)' }),
};
const slideTx = { duration: 0.28, ease: [0.16, 1, 0.3, 1] as [number,number,number,number] };

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };
const fadeUp  = {
  hidden: { opacity: 0, y: 14, scale: 0.97 },
  show:   { opacity: 1, y: 0,  scale: 1, transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] as [number,number,number,number] } },
};

// ── ThemeButton ────────────────────────────────────────────────────────────────
// Onboarding owns its own light/dark state, exactly like MarketingHome. The
// global AnimatedThemeToggler flips a class on <html>, which does nothing here:
// the `.marketing-*-tokens` subtree re-declares its own colour tokens and wins.
function ThemeButton({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="fixed top-4 right-4 z-50 w-9 h-9 rounded-full bg-panel border border-border/60 text-muted hover:text-text flex items-center justify-center transition-colors"
    >
      {dark ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
          <circle cx="12" cy="12" r="4" />
          <path strokeLinecap="round" d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  );
}

// ── DotProgress ────────────────────────────────────────────────────────────────
function DotProgress({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <motion.div
          key={i}
          animate={{
            width: i + 1 === step ? 20 : 6,
            backgroundColor: i + 1 <= step
              ? 'rgb(var(--color-text))'
              : 'rgb(var(--color-text) / 0.15)',
          }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="h-1.5 rounded-full"
        />
      ))}
    </div>
  );
}

// ── WelcomeScreen ──────────────────────────────────────────────────────────────
function WelcomeScreen({ onStart, reduced }: { onStart: () => void; reduced: boolean }) {
  const [visible, setVisible] = useState([false, false, false]);

  useEffect(() => {
    if (reduced) { setVisible([true, true, true]); return; }
    const t = [
      setTimeout(() => setVisible(v => [true,  v[1],  v[2]]),  900),
      setTimeout(() => setVisible(v => [v[0],  true,  v[2]]),  1400),
      setTimeout(() => setVisible(v => [v[0],  v[1],  true]),  1900),
    ];
    return () => t.forEach(clearTimeout);
  }, [reduced]);

  return (
    <div className="w-full max-w-md px-6 py-12 space-y-8">
      {/* Logo + headline */}
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="text-center space-y-5"
      >
        <div className="flex flex-col items-center gap-3">
          <Image src="/logo.png"      alt="MODUS" width={64} height={48} className="object-contain block dark:hidden" />
          <Image src="/logo-dark.png" alt="MODUS" width={64} height={48} className="object-contain hidden dark:block" />

          <h2 className="hero-gradient-text text-2xl font-black tracking-widest">MODUS</h2>
        </div>

        <div>
          <h1 className="text-[2.6rem] text-text leading-[1.08] tracking-tight" style={{ fontFamily: 'var(--font-serif)', fontWeight: 500 }}>
            Every AI model.<br />One assistant.
          </h1>
          <p className="text-sm text-muted mt-3 leading-relaxed max-w-xs mx-auto">
            Every frontier model in one place, routed to the best one for every task.
          </p>
        </div>

        {/* Every-model strip */}
        <div className="flex items-center justify-center gap-3">
          {BRAND_MODELS.map(({ name, Logo }) => (
            <div key={name} className="flex items-center gap-1.5">
              <Logo className="w-4 h-4" />
              <span className="text-[11px] font-semibold text-muted">{name}</span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* The real live demo. This used to be a separate `models` step that
          repeated this screen's headline, logo strip and pitch almost verbatim;
          merging them removes the repetition AND a whole step. */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.14, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="rounded-2xl border border-border bg-panel p-5 space-y-4" aria-label="Chat preview">
          <p className="text-xs text-muted">Modus</p>
          {['Help me organize my day.', 'Start with your most important task. Leave time for focused work.', 'Keep the plan simple and adjust as your day changes.'].map((line, i) => (
            <p key={line} className={`rounded-xl bg-text/[0.05] px-4 py-3 text-sm text-text transition-opacity ${visible[i] ? 'opacity-100' : 'opacity-0'}`}>{line}</p>
          ))}
        </div>
      </motion.div>

      {/* CTA */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.26, ease: [0.16, 1, 0.3, 1] }}
        className="space-y-3"
      >
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={onStart}
          className="w-full py-4 btn-primary text-white text-sm font-bold rounded-2xl shadow-sm"
        >
          Set up Modus, takes 60 sec →
        </motion.button>
        <p className="text-xs text-muted text-center">Start free · No card required · Upgrade anytime</p>
      </motion.div>
    </div>
  );
}

// ── YouStep ────────────────────────────────────────────────────────────────────
// name + role + age + gender on ONE screen. Name is prefilled from the
// Google/Apple profile, so this is mostly tapping. All of it feeds
// `personalContext` in the chat system prompt — none of it is vanity data.
function ChipGroup({ label, options, value, onChange }: {
  label: string; options: readonly string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map(opt => {
          const active = value === opt;
          return (
            <button
              key={opt}
              onClick={() => onChange(opt)}
              className={`rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'border-brand bg-brand text-white'
                  : 'border-border/60 bg-panel text-text hover:border-brand/40'
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function YouStep({ name, setName, role, setRole, age, setAge, gender, setGender }: {
  name: string; setName: (v: string) => void;
  role: string; setRole: (v: string) => void;
  age: string; setAge: (v: string) => void;
  gender: string; setGender: (v: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-bold text-brand uppercase tracking-[0.15em] mb-3">Make it yours</p>
        <h1 className="text-3xl text-text leading-tight" style={{ fontFamily: 'var(--font-serif)', fontWeight: 500 }}>
          A little about you.
        </h1>
        <p className="text-sm text-muted mt-1.5">So Modus knows who it is working for.</p>
      </div>

      <div>
        <label htmlFor="onboarding-name" className="text-xs font-semibold text-muted mb-2 block">
          What should Modus call you?
        </label>
        <input
          id="onboarding-name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your first name"
          className="w-full bg-panel border border-border/60 rounded-xl px-4 py-3 text-base text-text placeholder:text-muted/40 focus:outline-none focus:border-brand/60 transition-all"
        />
      </div>

      <ChipGroup label="What best describes you?" options={ROLE_OPTIONS}   value={role}   onChange={setRole} />
      <ChipGroup label="Age"                      options={AGE_OPTIONS}    value={age}    onChange={setAge} />
      <ChipGroup label="Gender"                   options={GENDER_OPTIONS} value={gender} onChange={setGender} />
    </div>
  );
}

// ── PlanStep ───────────────────────────────────────────────────────────────────
// Free is available without checkout. Paid plans show the amount charged.
// Prices come from lib/pricing, never from a literal here: someone who picked
// Annually on /pricing gets billed the annual amount, so showing them a hardcoded
// "$24 /mo" on the step right before checkout is a lie about what their card is
// about to be charged.
const PLAN_OPTIONS: { id: PlanId; name: string; tagline: string; popular?: boolean; features: string[] }[] = [
  { id: 'free', name: 'Free', tagline: 'Open models, no card required', features: ['Open models for everyday chat', 'Five-hour allowance plus a weekly cap', 'Upgrade anytime'] },
  {
    id: 'modus', name: 'MODUS', tagline: 'Every provider, auto-routed',
    features: ['Claude + GPT-6 + Gemini, auto-routed', 'Inbox, calendar & goals', 'Daily briefing', 'Memory across every chat'],
  },
  {
    id: 'pilot', name: 'PILOT', tagline: 'Everything, higher limits', popular: true,
    features: ['Everything in MODUS', 'The frontier models, GPT-6 Astra, Claude Opus 5.5, Claude Fable 5.1 + Gemini 4', 'Much higher usage limits', 'Manual model pick per message'],
  },
];

function PlanStep({ selected, setSelected, cadence, setCadence }: {
  selected: PlanId; setSelected: (v: PlanId) => void;
  cadence: Cadence; setCadence: (c: Cadence) => void;
}) {
  const annual = cadence === 'annual';
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-bold text-brand uppercase tracking-[0.15em] mb-3">Pick your plan</p>
        <h1 className="text-3xl text-text leading-tight" style={{ fontFamily: 'var(--font-serif)', fontWeight: 500 }}>Choose your plan.</h1>
        <p className="text-sm text-muted mt-1.5">
          Start free or choose a paid plan. Paid plans are billed at checkout.
        </p>
      </div>

      <div className="flex justify-center">
        <CadenceToggle cadence={cadence} onChange={setCadence} />
      </div>

      <div className="space-y-3">
        {PLAN_OPTIONS.map(p => {
          const active = selected === p.id;
          return (
            <motion.button
              key={p.id}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelected(p.id)}
              className={`relative w-full p-4 rounded-2xl border text-left transition-all duration-200 ${
                active
                  ? 'border-brand/60 bg-text/[0.05]'
                  : 'border-border/60 bg-panel/60 hover:border-brand/25'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-black tracking-wide ${active ? 'text-brand' : 'text-text'}`}>{p.name}</span>
                    {p.popular && (
                      <span className="text-[9px] font-bold uppercase tracking-wider text-brand bg-text/[0.06] px-1.5 py-0.5 rounded-full">Popular</span>
                    )}
                  </div>
                  <p className="text-xs text-muted mt-0.5">{p.tagline}</p>
                </div>
                <div className="text-right">
                  <span className="text-xl font-black text-text">
                    ${p.id === 'free' ? 0 : annual ? PLAN_PRICING[p.id].annualPerMonth : PLAN_PRICING[p.id].monthlyPrice}
                  </span>
                  <span className="text-xs text-muted">/mo</span>
                  {annual && p.id !== 'free' && (
                    <p className="text-[10px] text-muted whitespace-nowrap">
                      ${PLAN_PRICING[p.id].annualTotal} billed yearly
                    </p>
                  )}
                </div>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border-2 transition-colors ${active ? 'border-brand bg-brand' : 'border-muted/40'}`}>
                  {active && (
                    <svg viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5">
                      <path d="M2 6l3 3 5-5" />
                    </svg>
                  )}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-1.5">
                {p.features.map(f => (
                  <div key={f} className="flex items-center gap-2">
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className={`w-2.5 h-2.5 shrink-0 ${active ? 'text-brand' : 'text-muted'}`}>
                      <path d="M2 6l3 3 5-5" />
                    </svg>
                    <span className="text-xs text-text/80">{f}</span>
                  </div>
                ))}
              </div>
            </motion.button>
          );
        })}
      </div>

      <p className="text-xs text-muted/70 text-center leading-relaxed">
        Free needs no card. Paid plans charge the selected monthly or yearly amount at checkout. Cancel anytime.
      </p>
    </div>
  );
}

// ── CompletionScreen ───────────────────────────────────────────────────────────
function CompletionScreen({ name, planName, alreadyPaid, onEnter, saving, chargeLabel }: {
  name: string; planName: string; alreadyPaid: boolean; onEnter: () => void; saving: boolean; chargeLabel: string;
}) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const items = [
    { label: `Profile personalized${name.trim() ? ` for ${name.trim()}` : ''}` },
    { label: 'Memory ready for your chats' },
    { label: 'Daily Review habit, streak starts today' },
  ];

  // 10 burst particles
  const particles = Array.from({ length: 10 }, (_, i) => {
    const angle = (i / 10) * Math.PI * 2;
    const dist  = 50 + (i % 3) * 14;
    return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, brand: i % 2 === 0 };
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full max-w-md px-6 space-y-8"
    >
      {/* Logo burst */}
      <div className="flex flex-col items-center gap-4 pt-6">
        <div className="relative flex items-center justify-center w-24 h-24">
          {particles.map((p, i) => (
            <motion.div
              key={i}
              initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
              animate={{ x: p.x, y: p.y, opacity: 0, scale: 0 }}
              transition={{ delay: 0.15 + i * 0.04, duration: 0.55, ease: 'easeOut' }}
              className="absolute w-2 h-2 rounded-full"
              style={{ backgroundColor: p.brand ? 'rgb(var(--color-text))' : 'rgb(var(--color-muted))' }}
            />
          ))}

          <motion.div
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 14, delay: 0.1 }}
            className="w-20 h-20 rounded-3xl bg-panel border border-border flex items-center justify-center shadow-lg"
          >
            <Image src="/logo.png"      alt="MODUS" width={48} height={36} className="object-contain block dark:hidden" />
            <Image src="/logo-dark.png" alt="MODUS" width={48} height={36} className="object-contain hidden dark:block" />
          </motion.div>

          {/* Glow ring flash */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: [0, 0.6, 0], scale: [0.8, 1.7, 1.7] }}
            transition={{ duration: 0.75, delay: 0.2 }}
            className="absolute inset-0 rounded-3xl border border-border"
          />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="text-center"
        >
          <div className="flex items-center justify-center gap-1.5 mb-2">
            <motion.div animate={{ opacity: [1, 0.35, 1] }} transition={{ duration: 1.8, repeat: Infinity }} className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-xs text-emerald-400 font-semibold tracking-wide uppercase">Ready to go</span>
          </div>
          <h1 className="text-3xl font-black text-text leading-tight">
            {name.trim() ? `You're set, ${name.trim()}.` : "You're set."}
          </h1>
          <p className="text-sm text-muted mt-1.5">{today}</p>
        </motion.div>
      </div>

      {/* Setup summary */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="bg-panel/70 border border-border/60 rounded-2xl p-5 space-y-3 backdrop-blur-sm"
      >
        <p className="text-xs text-muted uppercase tracking-wider font-semibold">What was set up</p>
        <div className="space-y-2.5">
          {items.map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.55 + i * 0.1 }}
              className="flex items-start gap-3"
            >
              <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-text/[0.06]">
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5 text-brand">
                  <path d="M2 6l3 3 5-5" />
                </svg>
              </div>
              <p className="text-sm leading-snug text-text">{item.label}</p>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* CTA */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9 }}
        className="space-y-2 pb-6"
      >
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={onEnter}
          disabled={saving}
          className="w-full py-4 btn-primary text-white text-sm font-bold rounded-2xl shadow-sm"
        >
          {saving ? 'Opening…' : alreadyPaid || planName === 'Free' ? 'Enter Modus →' : `Continue to ${planName} checkout →`}
        </motion.button>
        <p className="text-xs text-muted text-center">
          {alreadyPaid
            ? `Your ${planName} subscription is active`
            : chargeLabel}
        </p>
      </motion.div>
    </motion.div>
  );
}

// ── main page ──────────────────────────────────────────────────────────────────
function OnboardingContent() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // ?trial=1 = user bounced back from an abandoned checkout — jump them straight
  // to the plan/Start step instead of the onboardingComplete→dashboard redirect.
  const [checkoutMode] = useState<boolean>(() =>
    typeof window !== 'undefined' && (new URLSearchParams(window.location.search).get('trial') === '1' || new URLSearchParams(window.location.search).get('checkout') === '1')
  );

  // Whether this account ALREADY has a paid subscription when it reaches
  // onboarding. Normally nobody does — you onboard, then you pay. But the
  // founding path (/grandfathering) charges $24 straight from a password gate and
  // never touches onboardingComplete, so a founding member whose Firebase account
  // predates their purchase lands here already paying. Showing that person a plan
  // picker reads as "you have to pay again", and it trapped founding member #27:
  // she abandoned at the plan step every time, the flag never got written, and
  // /login sent her back to /onboarding on EVERY sign-in.
  const [alreadyPaid, setAlreadyPaid] = useState<boolean>(false);

  const [screen,    setScreen]    = useState<Screen>(checkoutMode ? 'plan' : 'welcome');
  const [direction, setDirection] = useState(1);
  // Same light-by-default marketing shell as the homepage. The old page used the
  // global AnimatedThemeToggler, which does nothing once the subtree re-declares
  // its own tokens — so onboarding was stuck light with a dead toggle.
  const [dark, setDark] = useState(false);
  const [saving,    setSaving]    = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const systemReduced = useReducedMotion();
  const [savedReduced, setSavedReduced] = useState(false);
  const reduced = savedReduced || !!systemReduced;
  useEffect(() => {
    const syncTheme = () => {
      try { setDark(localStorage.getItem('modus-theme') === 'dark'); } catch { setDark(false); }
    };
    syncTheme();
    window.addEventListener('storage', syncTheme);
    return () => window.removeEventListener('storage', syncTheme);
  }, []);
  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('modus-theme', next ? 'dark' : 'light'); } catch { /* Storage is optional. */ }
  }

  // Prefilled from the Google/Apple profile below — asking for a name the auth
  // provider already gave us was an entire step that bought nothing.
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<PlanId>('free');
  // Chosen back on /pricing. Read once on mount so the plan step DISPLAYS the
  // same cadence that checkout will CHARGE — those two drifting apart is how you
  // show someone $24/mo and bill their card $240.
  const [cadence, setCadence] = useState<Cadence>('monthly');
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CADENCE_STORAGE_KEY);
      if (isCadence(stored)) setCadence(stored);
    } catch { /* private mode */ }
  }, []);

  // Google and Apple both hand us a display name at sign-in. Seed the field from
  // it (first name only — "What should MODUS call you?" wants Sarah, not Sarah
  // Chen) and leave it editable. Only overwrite an empty field, so a user who
  // clears it or edits it isn't fought by this effect.
  useEffect(() => {
    const fromAuth = user?.displayName?.trim().split(/\s+/)[0];
    if (fromAuth) setName(prev => (prev === '' ? fromAuth : prev));
  }, [user]);

  // Persist alongside setting state, so a cadence chosen here survives an
  // abandoned checkout bouncing back to /onboarding?trial=1.
  function chooseCadence(next: Cadence) {
    setCadence(next);
    try { window.localStorage.setItem(CADENCE_STORAGE_KEY, next); } catch { /* private mode */ }
  }

  // Auth guard
  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
      return;
    }
    // Returning already-onboarded user (not in trial re-entry) → straight to app.
    // The same read resolves alreadyPaid, so the flow can drop the plan step for
    // someone who is already subscribed — one read, not two.
    if (user) {
      getDoc(doc(db, 'users', user.uid)).then(snap => {
        const data = snap.data();
        setSavedReduced(data?.settings?.reduceMotion === true);
        if (isPaidPlan(data?.plan)) {
          setAlreadyPaid(true);
          // So the completion screen names the plan they actually bought rather
          // than the 'modus' default. 'group' has no card here; leave it alone.
          if (data!.plan === 'pilot' || data!.plan === 'modus') setSelectedPlan(data!.plan);
        }
        if (!checkoutMode && data?.onboardingComplete) router.push('/dashboard');
      }).catch(() => { /* offline: fall through to the full flow */ });
    }
  }, [user, loading, router, checkoutMode]);

  if (loading || !user) return null;

  function go(next: Screen, dir = 1) {
    setDirection(dir);
    setScreen(next);
  }

  async function startCheckout() {
    if (pending.current) return;
    if (alreadyPaid || selectedPlan === 'free') { router.push('/chat'); return; }
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      const token = await user!.getIdToken();
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: selectedPlan, returnTo: 'dashboard', cadence }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not open checkout. Please retry or continue free.');
      window.location.href = data.url;
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not open checkout. Please retry or continue free.'); }
    finally { pending.current = false; setSaving(false); }
  }

  // The account-seeding write, shared by the paid finish and the free escape.
  // Idempotent: a trial re-entry (?trial=1) or a second tap is already onboarded,
  // so it must not duplicate the seeded habit/memories.
  async function seedAccount() {
    const memories = await seedOnboardingAccount(user!.uid, { name, role, age, gender });
    if (memories.length > 0) {
      // First completed setup only (memories come back empty on a re-entry), so
      // each account is one Meta signup. Fire and forget: never blocks setup.
      void trackMetaWithServer('CompleteRegistration', () => user!.getIdToken());
      // Vector indexing is supplementary. Durable memories are already saved.
      void user!.getIdToken().then(token => Promise.all(memories.map(text => fetch('/api/memory/upsert', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ text }),
      })))).catch(() => {});
    }
  }

  async function handleFinish() {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError('');
    try { await seedAccount(); go('done'); }
    catch { setError('Could not finish setup. Please retry. Your progress is still here.'); }
    finally { pending.current = false; setSaving(false); }
  }

  async function handleContinueFree() {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError('');
    try { await seedAccount(); router.push('/chat'); }
    catch { setError('Could not finish setup. Please retry.'); }
    finally { pending.current = false; setSaving(false); }
  }

  // Navigation maps. A paying account has no plan step, so `you` is the last one.
  const NEXT: Partial<Record<Screen, Screen>> = alreadyPaid ? {} : { you: 'plan' };
  const PREV: Partial<Record<Screen, Screen>> = { plan: 'you' };
  const isValid: Record<Screen, boolean> = {
    welcome: true,
    // Name is prefilled from the auth profile, so this is usually already
    // satisfied on arrival; role is the one real tap.
    // Gender is deliberately NOT required — 'Prefer not to say' is a real
    // answer and nothing downstream needs it.
    you:     name.trim() !== '' && role !== '' && age !== '',
    plan:    true,
    done:    true,
  };

  const screens = questionScreens(alreadyPaid);
  const stepIndex = screens.indexOf(screen) + 1;
  const selectedPlanName = PLAN_OPTIONS.find(p => p.id === selectedPlan)?.name ?? 'MODUS';

  // ── welcome ────────────────────────────────────────────────────────────────
  if (screen === 'welcome') {
    return (
      <div className={`onboarding ${reduced ? 'onboarding-reduced' : ''} marketing ${dark ? 'marketing-dark-tokens' : 'marketing-light-tokens'} w-full relative min-h-screen flex flex-col items-center overflow-y-auto`}>
        <ThemeButton dark={dark} onToggle={toggleTheme} />
      <MarketingDecor dark={dark} />
        <div className="relative z-10"><WelcomeScreen onStart={() => go('you')} reduced={reduced} /></div>
      </div>
    );
  }

  // ── done ───────────────────────────────────────────────────────────────────
  if (screen === 'done') {
    return (
      <div className={`onboarding ${reduced ? 'onboarding-reduced' : ''} marketing ${dark ? 'marketing-dark-tokens' : 'marketing-light-tokens'} w-full relative min-h-screen flex flex-col items-center overflow-y-auto`}>
        <MarketingDecor dark={dark} />
        <div className="relative z-10 py-10">
          {error && <p role="alert" className="px-6 mb-4 text-sm text-red-500">{error}</p>}
          <CompletionScreen
            name={name}
            planName={selectedPlanName}
            alreadyPaid={alreadyPaid}
            onEnter={startCheckout}
            saving={saving}
            chargeLabel={selectedPlan === 'free' ? 'No card required' : cadence === 'annual' ? `$${PLAN_PRICING[selectedPlan].annualTotal} billed yearly at checkout` : `$${PLAN_PRICING[selectedPlan].monthlyPrice}/mo billed at checkout`}
          />
          {!alreadyPaid && selectedPlan !== 'free' && <button onClick={handleContinueFree} disabled={saving} className="block mx-auto text-sm text-muted underline">Continue free</button>}
        </div>
      </div>
    );
  }

  // ── you / plan — one centered column ────────────────────────────────────────
  // Back/Continue sit in the same place at the bottom on every step.
  const isLast = screen === screens[screens.length - 1];
  const handleNext = () => {
    if (isLast) { handleFinish(); return; }
    const next = NEXT[screen];
    if (next && isValid[screen]) go(next);
  };

  return (
    <div className={`onboarding ${reduced ? 'onboarding-reduced' : ''} marketing ${dark ? 'marketing-dark-tokens' : 'marketing-light-tokens'} w-full relative min-h-screen flex flex-col`}>
      <ThemeButton dark={dark} onToggle={toggleTheme} />
      <MarketingDecor dark={dark} />

      <div className="relative z-10 flex-1 flex items-center justify-center px-6 py-16 sm:py-20">
        <div className="w-full mx-auto max-w-lg">
          {/* Progress */}
          <div className="mb-8 flex justify-center">
            <DotProgress step={stepIndex} total={screens.length} />
          </div>

          {/* Step content */}
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={screen}
              custom={direction}
              variants={slideVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={slideTx}
            >
              {screen === 'you'    && <YouStep name={name} setName={setName} role={role} setRole={setRole} age={age} setAge={setAge} gender={gender} setGender={setGender} />}
              {screen === 'plan'   && <PlanStep selected={selectedPlan} setSelected={setSelectedPlan} cadence={cadence} setCadence={chooseCadence} />}
            </motion.div>
          </AnimatePresence>

          {error && <p role="alert" className="mt-4 text-sm text-red-500">{error}</p>}
          {/* Nav — same position on every step */}
          <div className="mt-8 flex items-center justify-between">
            <button
              disabled={saving}
              onClick={() => go(PREV[screen] ?? 'welcome', -1)}
              className="text-sm text-muted hover:text-text transition-colors py-2 pr-4"
            >
              ← Back
            </button>
            <motion.button
              whileHover={isValid[screen] ? { scale: 1.03 } : {}}
              whileTap={isValid[screen] ? { scale: 0.97 } : {}}
              onClick={handleNext}
              disabled={!isValid[screen] || saving}
              className="px-7 py-3 btn-primary text-white text-sm font-bold rounded-2xl disabled:opacity-40 shadow-sm"
            >
              {!isLast ? 'Continue →' : alreadyPaid ? 'Finish →' : 'Review & start →'}
            </motion.button>
          </div>

          {/* Free escape — only on the plan step, so we still collect name/role
              and still show the plans as the upsell, but a visitor who isn't
              ready to add a card can start on the free tier instead of bouncing.
              Makes the /pricing "10 messages, no card" promise actually true. */}
          {screen === 'plan' && !alreadyPaid && (
            <div className="mt-5 text-center">
              <button
                onClick={handleContinueFree}
                disabled={saving}
                className="w-full inline-flex items-center justify-center px-6 py-3 rounded-xl bg-text/[0.06] text-text hover:bg-text/10 transition-colors text-sm font-semibold disabled:opacity-40"
              >
                Start free on the open models, no card →
              </button>
              <p className="text-[11px] text-muted/70 mt-2">The open models, on a window that refreshes through the day. No card. Upgrade anytime.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return <MotionConfig reducedMotion="user"><OnboardingContent /></MotionConfig>;
}
