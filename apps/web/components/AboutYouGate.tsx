'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { isPaidPlan } from '@/lib/plan';
import { ROLE_OPTIONS, indexOnboardingMemories, seedOnboardingAccount } from '@/lib/onboarding';

/**
 * The "about you" step, shown ONCE after payment to someone who paid before
 * onboarding. That is the Meta ad path: /start, sign in, straight to checkout
 * (app/(auth)/login), then back to /dashboard?checkout_completed=1.
 *
 * It sits over the dashboard instead of being its own page, so Subscribe
 * (MetaCheckoutTracker, same layout) fires on landing exactly as before, even if
 * the person closes the tab here. Name is prefilled from the sign-in profile and
 * role is the only question. Saving or skipping marks onboarding complete
 * (lib/onboarding.ts), so it never shows again.
 */
export function AboutYouGate({ user }: { user: User | null }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const justPaid = new URLSearchParams(window.location.search).get('checkout_completed') === '1';
    getDoc(doc(db, 'users', user.uid)).then(snap => {
      const data = snap.data();
      if (!alive || data?.onboardingComplete === true) return;
      // Paid, or just back from checkout (the webhook can land a moment later).
      if (!justPaid && !isPaidPlan(data?.plan)) return;
      setName(user.displayName?.trim().split(/\s+/)[0] ?? '');
      setOpen(true);
    }).catch(() => { /* offline: ask next time */ });
    return () => { alive = false; };
  }, [user]);

  if (!open || !user) return null;

  async function finish(skip: boolean) {
    if (saving || !user) return;
    setSaving(true);
    setError('');
    try {
      const memories = await seedOnboardingAccount(user.uid, {
        name: skip ? (user.displayName?.trim().split(/\s+/)[0] ?? '') : name,
        role: skip ? '' : role,
        age: '',
        gender: '',
      });
      indexOnboardingMemories(() => user.getIdToken(), memories);
      setOpen(false);
    } catch {
      setError('Could not save. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="about-you-title" className="fixed inset-0 z-[60] bg-bg overflow-y-auto">
      <div className="min-h-full flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          <Image src="/logo.png" alt="" width={48} height={37} className="object-contain block dark:hidden mb-6" style={{ width: 'auto' }} />
          <Image src="/logo-dark.png" alt="" width={48} height={37} className="object-contain hidden dark:block mb-6" style={{ width: 'auto' }} />
          <p className="text-xs font-bold text-brand uppercase tracking-[0.15em] mb-3">You&apos;re in</p>
          <h1 id="about-you-title" className="text-3xl text-text leading-tight font-serif font-medium">A little about you.</h1>
          <p className="text-sm text-muted mt-1.5">So MODUS knows who it is working for.</p>

          <label htmlFor="about-you-name" className="text-xs font-semibold text-muted mt-8 mb-2 block">What should MODUS call you?</label>
          <input
            id="about-you-name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your first name"
            autoComplete="given-name"
            className="w-full bg-panel border border-border rounded-xl px-4 py-3 text-base text-text placeholder:text-muted/50 outline-none focus:border-brand/60 transition-colors"
          />

          <p className="text-xs font-semibold text-muted mt-6 mb-2">What best describes you?</p>
          <div className="flex flex-wrap gap-2">
            {ROLE_OPTIONS.map(opt => {
              const active = role === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setRole(opt)}
                  className={`rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
                    active ? 'border-brand bg-brand text-white' : 'border-border bg-panel text-text hover-border-tint'
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>

          {error && <p role="alert" className="text-sm text-red-500 mt-4">{error}</p>}

          <button
            type="button"
            onClick={() => finish(false)}
            disabled={saving || !name.trim() || !role}
            className="mt-8 w-full bg-brand hover:bg-brand/90 text-white rounded-xl py-3.5 text-sm font-semibold transition-colors disabled:opacity-40"
          >
            {saving ? 'Opening...' : 'Open MODUS'}
          </button>
          <button
            type="button"
            onClick={() => finish(true)}
            disabled={saving}
            className="mt-3 w-full text-sm text-muted hover:text-text py-2"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
