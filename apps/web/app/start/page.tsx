import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import Footer from '@/components/marketing/Footer';
import { planCopy } from '@/lib/plan-copy';
import { unlockedModels } from '@/lib/models';
import { PLAN_PRICING } from '@/lib/pricing';
import { DOLLAR_OFFER, dollarOfferActive } from '@/lib/offer';
import RememberOffer from './RememberOffer';

/**
 * /start: the landing page for the Meta ads (marketing/meta-ads/TRACKING.md).
 *
 * One page for every ad. Only the headline changes, picked from utm_content so
 * the first line matches the ad that was clicked. Everything else is the same
 * for everyone, so a winning ad means the ad won, not the page.
 *
 * Every claim here comes from the same sources as the rest of the site: models
 * from lib/models.ts, features from lib/plan-copy.ts, price from lib/pricing.ts.
 * Rendered per request so the $1 offer switches off by itself when it ends.
 * Not indexed: it exists for ad traffic.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Every model in one app',
  description: 'GPT, Claude, Gemini, DeepSeek and Llama in one app. Cancel anytime.',
  robots: { index: false, follow: false },
};

const HEADLINES: Record<string, string> = {
  M03: 'One login for every model.',
  M03B: 'One login for every model.',
  M03C: 'One login for every model.',
  M01: 'Every model for $28 a month.',
  M02: 'Ask once. Compare three.',
  M05: 'Every model. One app.',
};
const DEFAULT_HEADLINE = 'Every model. One app.';

// Each company's own top consumer plan, monthly billing, checked Nov 24 2026 on
// chatgpt.com/pricing, claude.com/pricing and gemini.google/subscriptions. The
// same numbers are on ad M01. Check again before changing them.
const OTHERS = [
  { name: 'ChatGPT Plus', price: 20 },
  { name: 'Claude Pro', price: 20 },
  { name: 'Google AI Pro', price: 19.99 },
];
const OTHERS_TOTAL = OTHERS.reduce((s, o) => s + o.price, 0);

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

type Search = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
}

function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-4 h-4 shrink-0 mt-1 text-text" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export default async function StartPage({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  const ad = first(q.utm_content).toUpperCase();
  const headline = HEADLINES[ad] ?? DEFAULT_HEADLINE;
  const offer = dollarOfferActive();
  const price = PLAN_PRICING.modus.monthlyPrice;
  const models = unlockedModels('modus').map(m => m.name);
  const features = planCopy('modus').features;

  // Same checkout link the ads used before, with the ad's UTMs carried along.
  const link = new URLSearchParams({ plan: 'modus', cadence: 'monthly' });
  for (const k of UTM_KEYS) {
    const v = first(q[k]).slice(0, 100);
    if (v) link.set(k, v);
  }
  const href = `/login?${link.toString()}`;

  const cta = offer ? `Get your first month for $${DOLLAR_OFFER.firstMonth}` : 'Get MODUS';
  const terms = offer
    ? `$${DOLLAR_OFFER.firstMonth} for your first month, then $${price} a month. Cancel anytime.`
    : `$${price} a month. Cancel anytime.`;

  const faqs = [
    offer
      ? { q: 'When am I charged?', a: `You pay $${DOLLAR_OFFER.firstMonth} today for your first month. After that MODUS is $${price} a month until you cancel.` }
      : { q: 'When am I charged?', a: `Your card is charged $${price} when you subscribe, then every month until you cancel.` },
    { q: 'Can I cancel anytime?', a: 'Yes. Cancel from Settings, Billing and you keep full access until the end of the billing period. After that you drop back to the free tier. Nothing is deleted.' },
    ...(offer
      ? [{ q: `Who gets the $${DOLLAR_OFFER.firstMonth} month?`, a: `New MODUS subscribers on monthly billing, until ${DOLLAR_OFFER.endsLabel} at 11:59 pm Pacific. The code ${DOLLAR_OFFER.code} is added at checkout for you. If it isn't, type it in the promo code box.` }]
      : []),
    { q: 'Which models do I get?', a: `${models.join(', ')}. Leave it on Auto and MODUS picks the model for each message, or pick one yourself.` },
  ];

  const ctaBlock = (
    <div>
      <a href={href} className="btn-ink w-full sm:w-auto px-8 py-4 text-base">{cta}</a>
      <p className="text-sm text-muted mt-3">{terms}</p>
    </div>
  );

  return (
    <div className="marketing marketing-light-tokens">
      {offer && <RememberOffer />}
      <main className="bg-bg text-text min-h-screen overflow-x-hidden">
        <header className="px-6 pt-6 max-w-5xl mx-auto flex items-center">
          <Link href="/" aria-label="MODUS home">
            <Image src="/logo.png" alt="MODUS" width={52} height={40} className="object-contain" priority />
          </Link>
        </header>

        <section className="px-6 pt-14 sm:pt-20 pb-16 max-w-3xl mx-auto text-center">
          {offer && (
            <p className="inline-flex items-center gap-2 rounded-full border border-brand/40 bg-brand/10 text-text text-sm font-medium px-4 py-1.5 mb-7">
              <span>${DOLLAR_OFFER.firstMonth} first month</span>
              <span className="text-muted">Ends {DOLLAR_OFFER.endsLabel}</span>
            </p>
          )}
          <h1 className="font-serif text-5xl sm:text-7xl tracking-tight leading-[1.04] mb-6 text-balance">{headline}</h1>
          <p className="text-muted text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto mb-10">
            GPT, Claude, Gemini, DeepSeek and Llama in one app. Leave it on Auto and MODUS picks the model for
            each message, or pick one yourself.
          </p>
          {ctaBlock}
          <ul className="flex flex-wrap justify-center gap-2 mt-12" aria-label="Models included">
            {models.map(m => (
              <li key={m} className="text-xs sm:text-sm rounded-full border border-border px-3 py-1 text-muted">{m}</li>
            ))}
          </ul>
        </section>

        <section className="px-6 py-16 border-t border-border">
          <div className="max-w-5xl mx-auto">
            <h2 className="font-serif text-3xl sm:text-5xl tracking-tight mb-4 text-center">Ask once. Compare three.</h2>
            <p className="text-muted text-lg max-w-2xl mx-auto text-center mb-10">
              Ask one question and get GPT, Claude and Gemini answering side by side. Keep the best answer and keep going.
            </p>
            <div className="overflow-x-auto rounded-2xl border border-border bg-panel">
              <Image
                src="/marketing/compare-3-models.png"
                alt="MODUS compare mode: the same question answered by GPT, Claude and Gemini side by side"
                width={3467}
                height={1488}
                sizes="(max-width: 768px) 900px, 1024px"
                className="block min-w-[900px] w-full h-auto"
              />
            </div>
            <p className="text-xs text-muted mt-3 text-center">A real MODUS screenshot. Swipe to see all three on a phone.</p>
          </div>
        </section>

        <section className="px-6 py-16 border-t border-border">
          <div className="max-w-xl mx-auto">
            <h2 className="font-serif text-3xl sm:text-5xl tracking-tight mb-10 text-center">The math</h2>
            <div className="rounded-2xl border border-border bg-panel p-6 sm:p-8">
              {OTHERS.map(o => (
                <div key={o.name} className="flex justify-between py-2 text-muted">
                  <span>{o.name}</span>
                  <span>{money(o.price)} a month</span>
                </div>
              ))}
              <div className="flex justify-between py-3 mt-2 border-t border-border">
                <span>All three</span>
                <span>{money(OTHERS_TOTAL)} a month</span>
              </div>
              <div className="flex justify-between py-3 border-t border-border text-lg font-semibold">
                <span>MODUS, every model</span>
                <span>{money(price)} a month</span>
              </div>
              {offer && (
                <p className="text-sm text-muted text-right">${DOLLAR_OFFER.firstMonth} for your first month until {DOLLAR_OFFER.endsLabel}</p>
              )}
            </div>
            <p className="text-xs text-muted mt-3 leading-relaxed">
              Monthly prices of each company&apos;s own plan, checked Nov 24 2026. MODUS gives you their models in one app,
              not each company&apos;s own app features.
            </p>
          </div>
        </section>

        <section className="px-6 py-16 border-t border-border">
          <div className="max-w-3xl mx-auto">
            <h2 className="font-serif text-3xl sm:text-5xl tracking-tight mb-10 text-center">What you get with MODUS</h2>
            <ul className="grid sm:grid-cols-2 gap-x-10 gap-y-4">
              {features.map(f => (
                <li key={f} className="flex items-start gap-2.5">
                  <Check />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="px-6 py-16 border-t border-border">
          <div className="max-w-2xl mx-auto">
            <h2 className="font-serif text-3xl sm:text-4xl tracking-tight mb-8 text-center">Questions</h2>
            <dl className="divide-y divide-border">
              {faqs.map(f => (
                <div key={f.q} className="py-5">
                  <dt className="font-semibold mb-2">{f.q}</dt>
                  <dd className="text-muted leading-relaxed">{f.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="px-6 py-20 border-t border-border text-center">
          <h2 className="font-serif text-4xl sm:text-6xl tracking-tight leading-[1.05] mb-8 text-balance">{headline}</h2>
          {ctaBlock}
        </section>

        <Footer />
      </main>
    </div>
  );
}
