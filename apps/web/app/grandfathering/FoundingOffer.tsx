'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import FoundingCard from './FoundingCard';
import FoundingUrgency from './FoundingUrgency';
import { JOURNEY_PERKS } from './foundingContent';

interface Props {
  label: string;
  foundingNumber: number;
  status: 'available' | 'claimed';
  claimed: number;
  cap: number;
}

function useCountUp(target: number, ms = 900) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0; const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setN(Math.round((1 - Math.pow(1 - p, 3)) * target));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return n;
}

function Check() {
  return (
    <span className="mt-0.5 inline-flex items-center justify-center w-4 h-4 shrink-0 rounded-full bg-brand/20 text-brand ring-1 ring-brand/30">
      <svg viewBox="0 0 20 20" className="w-2.5 h-2.5" fill="currentColor"><path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0l-3.3-3.3a1 1 0 1 1 1.4-1.4l2.6 2.6 6.3-6.3a1 1 0 0 1 1.4 0Z" /></svg>
    </span>
  );
}

function Wordmark() {
  return (
    <div className="flex items-center gap-2 mb-6">
      <Image src="/logo.png" alt="MODUS" width={30} height={23} className="object-contain block dark:hidden" />
      <Image src="/logo-dark.png" alt="MODUS" width={30} height={23} className="object-contain hidden dark:block" />
      <span className="text-muted text-[11px] tracking-[0.34em] uppercase">Founding Members</span>
    </div>
  );
}

export default function FoundingOffer({ label, foundingNumber, status, claimed, cap }: Props) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => onAuthStateChanged(auth, u => { setUser(u); setAuthReady(true); }), []);

  const claimedNow = useCountUp(claimed);
  const spotsLeft = Math.max(0, cap - claimed);
  const filledPct = Math.min(100, Math.round((claimed / cap) * 100));

  // The CTA opens the cinematic value journey, which handles sign-in + payment.
  function claim() { router.push('/grandfathering/join'); }

  // Already claimed — welcome them back.
  if (status === 'claimed') {
    return (
      <div className="w-full max-w-md flex flex-col items-center text-center">
        <Wordmark />
        <motion.div initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} className="w-full max-w-[340px] mb-8">
          <FoundingCard label={label} foundingNumber={foundingNumber} cap={cap} />
        </motion.div>
        <h1 className="text-2xl font-semibold tracking-tight text-text fm-rise" style={{ animationDelay: '0.2s' }}>
          Your seat is secured{label ? `, ${label}` : ''}.
        </h1>
        <p className="text-sm text-muted mt-2 fm-rise" style={{ animationDelay: '0.3s' }}>
          Founding Member No. {String(foundingNumber).padStart(3, '0')} of {cap}. Full PILOT, $28/mo.
        </p>
        <button onClick={() => router.push(authReady && user ? '/dashboard' : '/login')}
          className="btn-primary mt-7 px-7 py-3.5 rounded-xl text-white text-sm font-semibold fm-rise" style={{ animationDelay: '0.4s' }}>
          <span className="relative z-10">Enter Modus</span>
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl">
      <div className="grid md:grid-cols-[minmax(0,360px)_1fr] gap-10 md:gap-14 items-center">
        {/* card */}
        <motion.div initial={{ opacity: 0, y: 30, rotateX: 10 }} animate={{ opacity: 1, y: 0, rotateX: 0 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} className="flex justify-center md:justify-start">
          <FoundingCard label={label} foundingNumber={foundingNumber} cap={cap} />
        </motion.div>

        {/* details */}
        <div>
          <div className="fm-rise" style={{ animationDelay: '0.15s' }}><Wordmark /></div>

          <div className="fm-rise" style={{ animationDelay: '0.2s' }}>
            <span className="fm-chip inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-brand dark:text-violet-200">
              <span className="w-1.5 h-1.5 rounded-full bg-brand shadow-[0_0_8px_2px_rgba(124,58,237,0.6)]" />
              Founding Member No. {String(foundingNumber).padStart(3, '0')}
            </span>
          </div>

          <h1 className="fm-rise text-3xl sm:text-4xl font-semibold tracking-tight text-text text-balance mt-4" style={{ animationDelay: '0.28s' }}>
            {label ? `${label}, you’re in.` : 'You’re in.'}
          </h1>
          <p className="fm-rise text-sm text-muted mt-2.5 leading-relaxed max-w-md" style={{ animationDelay: '0.34s' }}>
            A private invitation to the first {cap} members of Modus. You get our highest tier at our entry price, and you keep that price for as long as you stay.
          </p>

          <ul className="mt-6 space-y-3">
            {JOURNEY_PERKS.map(([title, desc], i) => (
              <li key={title} className="flex gap-3 fm-rise" style={{ animationDelay: `${0.42 + i * 0.07}s` }}>
                <Check />
                <div>
                  <p className="text-sm font-medium text-text leading-snug">{title}</p>
                  <p className="text-xs text-muted leading-snug">{desc}</p>
                </div>
              </li>
            ))}
          </ul>

          {/* scarcity bar */}
          <div className="fm-rise mt-7 mb-4" style={{ animationDelay: '0.82s' }}>
            <div className="flex items-center justify-between text-[11px] text-muted mb-1.5">
              <span className="tabular-nums">{claimedNow} of {cap} seats claimed</span>
              <span className="tabular-nums text-brand dark:text-violet-300 font-medium">{spotsLeft} left</span>
            </div>
            <div className="h-1.5 rounded-full bg-border/60 overflow-hidden">
              <motion.div initial={{ width: 0 }} animate={{ width: `${filledPct}%` }}
                transition={{ duration: 1, delay: 0.9, ease: 'easeOut' }}
                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400" />
            </div>
          </div>

          <div className="fm-rise mb-5" style={{ animationDelay: '0.86s' }}>
            <FoundingUrgency />
          </div>

          <button onClick={claim}
            className="btn-primary fm-rise w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl text-white text-sm font-semibold"
            style={{ animationDelay: '0.9s' }}>
            <span className="relative z-10">Claim your founding seat</span>
          </button>
          <p className="fm-rise text-[11px] text-muted/60 mt-3" style={{ animationDelay: '0.96s' }}>
            $28/mo · billed today · cancel anytime
          </p>
        </div>
      </div>
    </div>
  );
}
