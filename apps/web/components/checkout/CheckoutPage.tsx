'use client';

/**
 * MODUS checkout on our own domain (the ChatGPT / Claude pattern): our order
 * summary on the left, Stripe's Payment Element inside a MODUS card on the right.
 *
 * The session is a normal Stripe Checkout Session created with ui_mode
 * 'elements' (see app/api/stripe/checkout/route.ts), so the webhook, metadata and
 * duplicate-subscription guard are exactly the ones the hosted page used.
 *
 * Look: the onboarding/login shell. Marketing tokens, light by default from the
 * shared `modus-theme` key, wordmark top left, serif headline, bg-panel card.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { loadStripe, type Appearance } from '@stripe/stripe-js';
import { CheckoutElementsProvider } from '@stripe/react-stripe-js/checkout';
import { useAuth } from '@/components/providers/AuthProvider';
import { PLAN_PRICING, CADENCE_STORAGE_KEY, isCadence, type Cadence } from '@/lib/pricing';
import { planCopy } from '@/lib/plan-copy';
import AnimatedPrice from '@/components/marketing/AnimatedPrice';
import CadenceToggle from '@/components/marketing/CadenceToggle';
import PaymentForm from './PaymentForm';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '');

// One in-flight session start per (plan, cadence, from). React may run the start
// effect twice (dev Strict Mode, a fast remount); both callers share one request
// instead of racing the server's checkout lock.
type StartResult = { ok: boolean; clientSecret?: string; code?: string; error?: string };
const inflight = new Map<string, Promise<StartResult>>();
function startSession(key: string, run: () => Promise<StartResult>): Promise<StartResult> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = run().finally(() => { setTimeout(() => inflight.delete(key), 0); });
  inflight.set(key, p);
  return p;
}

type PaidPlan = 'modus' | 'pilot';
type From = 'onboarding' | 'settings' | 'paywall';

// Matches the login inputs (bg-bg/60, hairline border, 12px radius, violet focus).
function appearance(dark: boolean): Appearance {
  return {
    theme: dark ? 'night' : 'stripe',
    variables: {
      colorPrimary: '#6d28d9',
      colorBackground: dark ? '#18181b' : '#f0eee6',
      colorText: dark ? '#ededf0' : '#141413',
      colorTextSecondary: dark ? '#9898a0' : '#68665e',
      colorDanger: '#dc2626',
      fontFamily: 'Satoshi, ui-sans-serif, system-ui, sans-serif',
      fontSizeBase: '15px',
      borderRadius: '12px',
      spacingUnit: '4px',
    },
    rules: {
      '.Input': { border: `1px solid ${dark ? '#303035' : '#e0ddd2'}`, boxShadow: 'none', padding: '13px 14px' },
      '.Input:focus': { border: '1px solid rgba(109, 40, 217, 0.6)', boxShadow: 'none' },
      '.Label': { fontWeight: '500' },
      '.Tab': { border: `1px solid ${dark ? '#303035' : '#e0ddd2'}`, boxShadow: 'none' },
      '.Tab--selected': { borderColor: 'rgba(109, 40, 217, 0.6)', boxShadow: 'none' },
    },
  };
}
const FONTS = [{ cssSrc: 'https://api.fontshare.com/v2/css?f[]=satoshi@1,2&display=swap' }];

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-4 h-4 shrink-0 mt-0.5 text-text">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function BrandLockup() {
  return (
    <>
      <Image src="/logo.png" alt="Modus" width={40} height={31} className="object-contain block dark:hidden" />
      <Image src="/logo-dark.png" alt="Modus" width={40} height={31} className="object-contain hidden dark:block" />
      <div className="flex flex-col leading-none">
        <span className="text-sm font-bold tracking-widest text-text">MODUS</span>
        <span className="text-[8px] font-semibold text-muted tracking-widest uppercase">pilot</span>
      </div>
    </>
  );
}

function ThemeButton({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="absolute top-4 right-4 z-50 w-9 h-9 rounded-full bg-panel border border-border/60 text-muted hover:text-text flex items-center justify-center transition-colors"
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

export default function CheckoutPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  const plan: PaidPlan = params.get('plan') === 'pilot' ? 'pilot' : 'modus';
  const fromParam = params.get('from');
  const from: From = fromParam === 'onboarding' || fromParam === 'paywall' ? fromParam : 'settings';

  const [cadence, setCadence] = useState<Cadence>(() => {
    const c = params.get('cadence');
    return isCadence(c) ? c : 'monthly';
  });
  const [dark, setDark] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [startError, setStartError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);

  // Same theme key as the homepage, login and app.
  useEffect(() => {
    try { setDark(localStorage.getItem('modus-theme') === 'dark'); } catch { /* storage is optional */ }
  }, []);
  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('modus-theme', next ? 'dark' : 'light'); } catch { /* storage is optional */ }
  }

  function chooseCadence(next: Cadence) {
    setCadence(next);
    try { localStorage.setItem(CADENCE_STORAGE_KEY, next); } catch { /* private mode */ }
    const q = new URLSearchParams(params.toString());
    q.set('cadence', next);
    router.replace(`/checkout?${q.toString()}`, { scroll: false });
  }

  // Signed out: sign in, then come straight back here.
  useEffect(() => {
    if (!loading && !user) {
      const here = `/checkout?${params.toString()}`;
      router.replace(`/login?next=${encodeURIComponent(here)}`);
    }
  }, [loading, user, params, router]);

  // One Checkout Session per (plan, cadence). Switching cadence makes a new one;
  // the server reuses an open session for the same choice.
  useEffect(() => {
    if (!user) return;
    const id = ++requestId.current;
    setClientSecret(null);
    setStartError('');
    (async () => {
      try {
        const data = await startSession(`${plan}:${cadence}:${from}`, async () => {
          const token = await user.getIdToken();
          // The server locks one checkout start per user. A second start that
          // arrives while the first is creating its session gets 409
          // checkout_in_progress; by the retry, the first session exists and
          // the server hands that same session back.
          for (let tries = 0; ; tries++) {
            const res = await fetch('/api/stripe/checkout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ plan, cadence, ui: 'elements', from }),
            });
            const body = await res.json().catch(() => ({}));
            if (body.code === 'checkout_in_progress' && tries < 6) { await new Promise(r => setTimeout(r, 2000)); continue; }
            return { ok: res.ok, ...body };
          }
        });
        const res = { ok: data.ok };
        if (id !== requestId.current) return;
        if (data.code === 'has_subscription') { router.replace('/settings?tab=billing'); return; }
        if (!res.ok || !data.clientSecret) throw new Error(data.error || 'Checkout could not start. Try again.');
        setClientSecret(data.clientSecret);
      } catch (e) {
        if (id === requestId.current) setStartError(e instanceof Error ? e.message : 'Checkout could not start. Try again.');
      }
    })();
  }, [user, plan, cadence, from, router, attempt]);

  const copy = planCopy(plan);
  const price = PLAN_PRICING[plan];
  const annual = cadence === 'annual';
  const dueToday = annual ? price.annualTotal : price.monthlyPrice;
  const options = useMemo(() => clientSecret ? {
    clientSecret,
    // No defaultValues.email: the session's Stripe customer already carries it,
    // and Stripe rejects a second email on a customer-bound session.
    elementsOptions: { appearance: appearance(dark), fonts: FONTS },
  } : null, [clientSecret, dark]);

  const backHref = from === 'onboarding' ? '/onboarding?checkout=1' : from === 'paywall' ? '/chat' : '/settings?tab=billing';

  return (
    <div className={`marketing ${dark ? 'marketing-dark-tokens' : 'marketing-light-tokens'} relative min-h-screen w-full bg-bg text-text`}>
      <div className="absolute top-4 left-4 sm:top-6 sm:left-6 z-50">
        <Link href="/" className="flex items-center gap-1.5"><BrandLockup /></Link>
      </div>
      <ThemeButton dark={dark} onToggle={toggleTheme} />

      <div className="max-w-5xl mx-auto px-6 pt-24 pb-16 grid lg:grid-cols-[1fr_440px] gap-10 lg:gap-16 items-start">
        {/* Order summary */}
        <section>
          <Link href={backHref} className="text-sm text-muted hover:text-text">&larr; Back</Link>
          <h1 className="font-serif text-[2.25rem] sm:text-[2.6rem] leading-[1.1] font-medium mt-6">Upgrade to {copy.name}</h1>
          <p className="text-muted mt-2">{copy.tagline}</p>

          <div className="mt-8 flex items-baseline gap-1">
            <AnimatedPrice
              value={annual ? price.annualPerMonth : price.monthlyPrice}
              direction={annual ? 'up' : 'down'}
              className="text-5xl text-text [font-family:var(--font-serif)] font-medium"
            />
            <span className="text-muted text-lg">/mo</span>
          </div>
          <p className="text-sm text-muted mt-1">
            {annual ? `Billed annually at $${price.annualTotal}.` : 'Billed monthly.'}
          </p>

          <div className="mt-6 flex">
            <div className="-ml-1"><CadenceToggle cadence={cadence} onChange={chooseCadence} /></div>
          </div>

          <ul className="mt-8 space-y-3">
            {copy.features.map(f => (
              <li key={f} className="flex items-start gap-2.5">
                <Check />
                <span className="text-sm text-text/90 leading-relaxed">{f}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Payment */}
        <section className="bg-panel border border-border rounded-2xl p-6 sm:p-7 shadow-xl shadow-black/5">
          {user?.email && (
            <div className="mb-5">
              <p className="text-xs text-muted mb-1">Account</p>
              <p className="text-sm font-medium truncate">{user.email}</p>
            </div>
          )}

          {params.get('retry') === '1' && !startError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400 mb-4">
              Your payment didn&apos;t go through. Try again or use a different card.
            </p>
          )}
          {startError ? (
            <div role="alert" className="text-sm text-red-600 dark:text-red-400 py-6">
              {startError}
              <button onClick={() => setAttempt(a => a + 1)} className="block mt-3 underline text-text">Try again</button>
            </div>
          ) : !options ? (
            <div className="py-16 flex justify-center">
              <div className="w-6 h-6 rounded-full border-2 border-brand border-t-transparent animate-spin" />
            </div>
          ) : (
            <CheckoutElementsProvider key={`${options.clientSecret}:${dark}`} stripe={stripePromise} options={options}>
              <PaymentForm
                planName={copy.name}
                dueToday={dueToday}
                cadence={cadence}
              />
            </CheckoutElementsProvider>
          )}
        </section>
      </div>
    </div>
  );
}
