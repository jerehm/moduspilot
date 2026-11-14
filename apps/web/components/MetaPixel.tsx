'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  META_PIXEL_ID, browserSendsGpc, countryNeedsConsent, loadPixel,
  readAdConsent, setTrackingAllowed, writeAdConsent, type AdConsent,
} from '@/lib/meta-pixel';

type State = 'pending' | 'ask' | 'on' | 'off';

const GEO_CACHE_KEY = 'modus-geo-country';

/** Country from Vercel's edge header via /api/meta/geo, cached for the tab. Null when unknown. */
async function resolveCountry(): Promise<string | null> {
  try {
    const cached = sessionStorage.getItem(GEO_CACHE_KEY);
    if (cached) return cached === '-' ? null : cached;
  } catch { /* storage blocked */ }
  try {
    const res = await fetch('/api/meta/geo', { cache: 'no-store' });
    const { country } = await res.json() as { country: string | null };
    try { sessionStorage.setItem(GEO_CACHE_KEY, country || '-'); } catch { /* storage blocked */ }
    return country || null;
  } catch { return null; }
}

/** No pixel id or GPC: off. A saved choice wins. Otherwise ask in consent countries. */
async function decideTracking(): Promise<State> {
  if (!META_PIXEL_ID || browserSendsGpc()) return 'off';
  const saved = readAdConsent();
  if (saved) return saved === 'granted' ? 'on' : 'off';
  return countryNeedsConsent(await resolveCountry()) ? 'ask' : 'on';
}

/**
 * Meta Pixel loader plus the ad cookie banner. Mounted once in the root layout.
 * Renders nothing and loads nothing until NEXT_PUBLIC_META_PIXEL_ID is set.
 * Rules live in lib/meta-pixel.ts.
 */
export function MetaPixel() {
  const pathname = usePathname();
  const [state, setState] = useState<State>('pending');

  useEffect(() => {
    let cancelled = false;
    void decideTracking().then(next => { if (!cancelled) setState(next); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (state === 'pending' || state === 'ask') return;
    const on = state === 'on';
    setTrackingAllowed(on);
    if (on) loadPixel(META_PIXEL_ID);
  }, [state]);

  // PageView on the first load and on every client-side route change.
  useEffect(() => {
    if (state === 'on') window.fbq?.('track', 'PageView');
  }, [state, pathname]);

  if (state !== 'ask') return null;

  function choose(v: AdConsent) {
    writeAdConsent(v);
    setState(v === 'granted' ? 'on' : 'off');
  }

  return (
    <div
      role="dialog"
      aria-label="Ad cookies"
      className="fixed z-50 bottom-4 inset-x-4 sm:inset-x-auto sm:left-4 sm:max-w-sm rounded-xl border border-border bg-panel text-text shadow-lg p-4"
    >
      <p className="text-sm leading-relaxed">
        Modus uses Meta cookies to see which ads bring people here. They only load if you allow them.{' '}
        <Link href="/privacy" className="underline text-muted hover:text-text">Privacy</Link>
      </p>
      <div className="mt-3 flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => choose('denied')}
          className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-bg"
        >
          No thanks
        </button>
        <button
          type="button"
          onClick={() => choose('granted')}
          className="px-3 py-1.5 text-sm rounded-lg bg-brand text-white hover:opacity-90"
        >
          Allow
        </button>
      </div>
    </div>
  );
}
