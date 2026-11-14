'use client';

import { useEffect } from 'react';
import type { User } from 'firebase/auth';
import { trackMetaWithServer } from '@/lib/meta-pixel';

/**
 * Reports a Meta Subscribe event once when Stripe sends a new subscriber back
 * to us. The success URLs come from app/api/stripe/checkout/route.ts:
 * /dashboard?checkout_completed=1 (from onboarding) and
 * /settings?tab=billing&upgraded=1 (an upgrade from settings).
 * The server only confirms once the webhook has granted the plan, so this
 * retries for about 15 seconds. Renders nothing.
 */
export function MetaCheckoutTracker({ user }: { user: User | null }) {
  useEffect(() => {
    if (!user) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get('checkout_completed') !== '1' && q.get('upgraded') !== '1') return;
    const key = `modus-meta-subscribe-${user.uid}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch { /* storage blocked: may report twice, Meta dedupes on event id only */ }
    void trackMetaWithServer('Subscribe', () => user.getIdToken(), { retries: 5 });
  }, [user]);
  return null;
}
