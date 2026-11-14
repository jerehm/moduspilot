'use client';

/**
 * Meta Pixel helpers (browser side).
 *
 * Everything here is a no-op until NEXT_PUBLIC_META_PIXEL_ID is set AND the
 * visitor is allowed to be tracked. <MetaPixel /> (root layout) decides that:
 * visitors in the EU, EEA, UK and Switzerland must say yes first, a visitor whose
 * country is unknown is asked too, and a browser sending Global Privacy Control
 * is never tracked. Everyone else is tracked unless they said no earlier.
 *
 * Conversions are sent twice with one shared event id: once from the browser
 * (fbq) and once from our server (Conversions API, /api/meta/event). Meta keeps
 * one of the two, so ad blockers and iOS privacy settings cost us less signal.
 */

export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '';

/** localStorage key holding the visitor's ad tracking choice. */
export const AD_CONSENT_KEY = 'modus-ad-consent';
export type AdConsent = 'granted' | 'denied';

/** EU 27 + EEA (Iceland, Liechtenstein, Norway) + UK + Switzerland. */
const CONSENT_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO', 'GB', 'CH',
]);

/** Unknown country counts as "ask first". Never assume a visitor is outside Europe. */
export function countryNeedsConsent(country: string | null): boolean {
  if (!country) return true;
  return CONSENT_COUNTRIES.has(country.toUpperCase());
}

export function readAdConsent(): AdConsent | null {
  try {
    const v = localStorage.getItem(AD_CONSENT_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch { return null; }
}

export function writeAdConsent(v: AdConsent) {
  try { localStorage.setItem(AD_CONSENT_KEY, v); } catch { /* storage blocked: choice lasts this page only */ }
}

/** Global Privacy Control: a browser-level "do not sell or share". Honored as a no. */
export function browserSendsGpc(): boolean {
  try { return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true; }
  catch { return false; }
}

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[][];
  push?: Fbq;
  loaded?: boolean;
  version?: string;
};
declare global {
  interface Window { fbq?: Fbq; _fbq?: Fbq }
}

let trackingAllowed = false;
let markDecided: () => void = () => {};
const decided = new Promise<void>(resolve => { markDecided = resolve; });

/** Called by <MetaPixel /> once the visitor's tracking state is known (never while still asking). */
export function setTrackingAllowed(v: boolean) { trackingAllowed = v; markDecided(); }
export function isTrackingAllowed(): boolean { return trackingAllowed && META_PIXEL_ID !== ''; }

/** Waits until consent is known, or gives up after `ms` (an unanswered banner means no). */
function whenDecided(ms: number): Promise<void> {
  return Promise.race([decided, new Promise<void>(r => setTimeout(r, ms))]);
}

/** Loads fbevents.js once (Meta's standard base code, written out in TypeScript). */
export function loadPixel(pixelId: string) {
  if (typeof window === 'undefined' || window.fbq) return;
  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue!.push(args);
  } as Fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
  window.fbq = fbq;
  window._fbq = fbq;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(s);
  // No automatic button-click and page-metadata collection. Modus is a chat app:
  // sidebar buttons and page text can carry conversation titles, which must never
  // reach Meta. We send only the events below (PageView and named conversions).
  fbq('set', 'autoConfig', false, pixelId);
  fbq('init', pixelId);
}

export function newEventId(): string {
  try { return crypto.randomUUID(); }
  catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

/** Browser-only event. Safe to call anywhere: does nothing when tracking is off. */
export function trackMeta(event: string, params?: Record<string, unknown>, eventId?: string) {
  if (!isTrackingAllowed() || typeof window === 'undefined' || !window.fbq) return;
  if (eventId) window.fbq('track', event, params ?? {}, { eventID: eventId });
  else window.fbq('track', event, params ?? {});
}

function readCookie(name: string): string | undefined {
  try {
    const hit = document.cookie.split('; ').find(c => c.startsWith(`${name}=`));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : undefined;
  } catch { return undefined; }
}

export type ServerEvent = 'CompleteRegistration' | 'Subscribe';

/**
 * The browser event plus the same event from our server, deduplicated by event
 * id. Never throws and never blocks the caller's flow.
 *
 * `retries` covers Subscribe: the Stripe webhook can land a few seconds after
 * the user is back on our site, and the server only reports a subscription
 * once the webhook has granted the plan.
 */
export async function trackMetaWithServer(
  event: ServerEvent,
  getToken: () => Promise<string>,
  opts: { params?: Record<string, unknown>; retries?: number } = {},
): Promise<void> {
  if (!META_PIXEL_ID) return;
  await whenDecided(20000);
  if (!isTrackingAllowed()) return;
  const eventId = newEventId();
  trackMeta(event, opts.params, eventId);
  const attempts = 1 + (opts.retries ?? 0);
  for (let i = 0; i < attempts; i++) {
    try {
      const token = await getToken();
      const res = await fetch('/api/meta/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          event, eventId,
          fbp: readCookie('_fbp'), fbc: readCookie('_fbc'),
          sourceUrl: window.location.href,
        }),
        keepalive: true,
      });
      const data = await res.json().catch(() => ({})) as { retry?: boolean };
      if (!data.retry) return;
    } catch { /* network hiccup: try again if attempts remain */ }
    await new Promise(r => setTimeout(r, 3000));
  }
}
