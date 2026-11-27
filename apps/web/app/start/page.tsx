import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import HeroFilmWindow from '@/components/marketing/HeroFilmWindow';
import { ClaudeLogo, DeepSeekLogo, GeminiLogo, GrokLogo, MetaLogo, OpenAILogo } from '@/components/marketing/ModelLogos';
import { COMPARE_PROMPTS } from '@/components/marketing/compare-prompts';
import { planCopy } from '@/lib/plan-copy';
import { unlockedModels } from '@/lib/models';
import { PLAN_PRICING } from '@/lib/pricing';
import { DOLLAR_OFFER, dollarOfferActive } from '@/lib/offer';
import RememberOffer from './RememberOffer';
import StickyOfferCTA from './StickyOfferCTA';

/**
 * /start: the landing page for the Meta ads (marketing/meta-ads/TRACKING.md).
 *
 * One page for every ad. Only the headline changes, picked from utm_content so
 * the first line matches the ad that was clicked. Everything else is the same
 * for everyone, so a winning ad means the ad won, not the page.
 *
 * It is styled to look like the ads (marketing/meta-ads/batch-01): bold grotesk
 * headline with one violet italic serif word, the MODUS PILOT wordmark, solid
 * violet CTA and a violet MODUS price card. Someone who taps an ad should land
 * on the same brand they just saw.
 *
 * Every claim here comes from the same sources as the rest of the site: models
 * from lib/models.ts, features from lib/plan-copy.ts, price from lib/pricing.ts.
 * Rendered per request so the $1 offer switches off by itself when it ends.
 * Not indexed: it exists for ad traffic. No site nav or newsletter: the only
 * way forward is the checkout.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Every model in one app',
  description: 'GPT, Claude, Gemini, DeepSeek and Llama in one app. Cancel anytime.',
  robots: { index: false, follow: false },
};

// Headline per ad: a bold lead plus one accent phrase in violet italic serif,
// the same split the ads use ("for three.", "One app.").
type Headline = { lead: string; accent: string };
const HEADLINES: Record<string, Headline> = {
  M03: { lead: 'One login for', accent: 'every model.' },
  M03B: { lead: 'One login for', accent: 'every model.' },
  M03C: { lead: 'One login for', accent: 'every model.' },
  M01: { lead: 'Every model for', accent: '$28 a month.' },
  M02: { lead: 'Ask once.', accent: 'Compare three.' },
  M05: { lead: 'Every model.', accent: 'One app.' },
};
const DEFAULT_HEADLINE: Headline = { lead: 'Every model.', accent: 'One app.' };

// Each company's own top consumer plan, monthly billing, checked Nov 24 2026 on
// chatgpt.com/pricing, claude.com/pricing and gemini.google/subscriptions. The
// same numbers are on ad M01. Check again before changing them.
const OTHERS = [
  { name: 'ChatGPT Plus', price: 20 },
  { name: 'Claude Pro', price: 20 },
  { name: 'Google AI Pro', price: 19.99 },
];
const OTHERS_TOTAL = OTHERS.reduce((s, o) => s + o.price, 0);

// The hero chips name the brands people know, not model versions. Built from
// the providers actually on the MODUS plan (lib/models.ts), so a brand only shows
// once its models are really included. Order is how people rank them.
type Brand = { provider: string; name: string; logo: typeof ClaudeLogo };
const BRANDS: Brand[] = [
  { provider: 'OpenAI', name: 'ChatGPT', logo: OpenAILogo },
  { provider: 'Anthropic', name: 'Claude', logo: ClaudeLogo },
  { provider: 'Google', name: 'Gemini', logo: GeminiLogo },
  { provider: 'DeepSeek', name: 'DeepSeek', logo: DeepSeekLogo },
  { provider: 'Meta', name: 'Llama', logo: MetaLogo },
  { provider: 'xAI', name: 'Grok', logo: GrokLogo },
];
// Announced but not in the catalog yet: shown with a "Soon" tag, because this
// page sells the plan and Grok is not in it. The tag drops off by itself once
// lib/models.ts gives MODUS an xAI model.
const COMING_SOON = ['xAI'];

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

// Solid violet pill, the ads' CTA. Not .btn-primary: inside .marketing that class
// is forced to ink (globals.css).
const BTN_VIOLET =
  'inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white font-semibold transition-opacity hover:opacity-90';

type Search = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
}

function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className="w-4 h-4 shrink-0 mt-0.5 text-brand" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function Wordmark() {
  return (
    <Link href="/" aria-label="MODUS home" className="inline-flex items-center gap-2.5">
      <Image src="/logo.png" alt="" width={42} height={32} className="h-8 object-contain" style={{ width: "auto" }} priority />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-bold tracking-[0.22em] text-text">MODUS</span>
        <span className="text-[9px] font-semibold text-muted tracking-[0.3em] uppercase mt-1">Pilot</span>
      </span>
    </Link>
  );
}

function HeadlineText({ h, className }: { h: Headline; className: string }) {
  return (
    <span className={className}>
      {h.lead}{' '}
      <span className="font-serif italic font-normal text-brand tracking-normal">{h.accent}</span>
    </span>
  );
}

/** The app's chat as a readable card, for phones. The live film is 1280px wide
 *  and unreadable at phone width, so phones get this instead. */
function PhoneChatCard({ models }: { models: string[] }) {
  return (
    <div className="mx-auto max-w-sm rounded-3xl border border-border bg-panel p-4 text-left shadow-[0_24px_60px_-28px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between pb-3 border-b border-border">
        <span className="flex items-center gap-2 text-xs font-bold tracking-[0.18em]">
          <Image src="/logo.png" alt="" width={22} height={17} className="h-[17px] object-contain" style={{ width: "auto" }} />
          MODUS
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted">
          <span className="text-brand" aria-hidden>&#10022;</span> Auto
        </span>
      </div>
      <div className="flex justify-end pt-4">
        <p className="rounded-2xl rounded-br-md bg-brand text-white text-sm px-3.5 py-2 max-w-[85%]">
          Plan a 3 day trip to Lisbon on a budget.
        </p>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted mt-4">
        MODUS routed this to
        <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-text">
          <ClaudeLogo className="w-3 h-3" /> Claude
        </span>
      </p>
      <div className="text-sm leading-relaxed mt-2 space-y-1.5">
        <p><span className="font-semibold">Day 1:</span> Alfama and the castle, then sunset at a miradouro.</p>
        <p><span className="font-semibold">Day 2:</span> Belém by tram 15. Pastéis de nata for under 2 euros.</p>
        <p><span className="font-semibold">Day 3:</span> A day trip to Sintra by train.</p>
      </div>
      <p className="text-[11px] text-muted mt-4 pt-3 border-t border-border">
        Also on this plan: {models.filter(m => !m.startsWith('Claude')).join(', ')}
      </p>
    </div>
  );
}

export default async function StartPage({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  const ad = first(q.utm_content).toUpperCase();
  const headline = HEADLINES[ad] ?? DEFAULT_HEADLINE;
  const offer = dollarOfferActive();
  const price = PLAN_PRICING.modus.monthlyPrice;
  const modelList = unlockedModels('modus');
  const models = modelList.map(m => m.name);
  const providers = new Set(modelList.map(m => m.provider));
  const brands = BRANDS.filter(b => providers.has(b.provider) || COMING_SOON.includes(b.provider)).map(b => ({
    ...b,
    soon: !providers.has(b.provider),
  }));
  const features = planCopy('modus').features;
  const example = COMPARE_PROMPTS[0];

  // Same checkout link the ads used before, with the ad's UTMs carried along.
  const link = new URLSearchParams({ plan: 'modus', cadence: 'monthly' });
  // The code rides in the link too, so /login can save it even when the email
  // sign-in link opens in a different browser than this page.
  if (offer) link.set('promo', DOLLAR_OFFER.code);
  for (const k of UTM_KEYS) {
    const v = first(q[k]).slice(0, 100);
    if (v) link.set(k, v);
  }
  const href = `/login?${link.toString()}`;

  const cta = offer ? `Get your first month for $${DOLLAR_OFFER.firstMonth}` : 'Get MODUS';
  // With the offer on, the big "$1 first month, then $28/mo" line above the
  // button already states the terms, so this line only adds the reassurance.
  const terms = offer ? 'Cancel anytime. No contract.' : `$${price} a month. Cancel anytime.`;

  const faqs = [
    offer
      ? { q: 'When am I charged?', a: `You pay $${DOLLAR_OFFER.firstMonth} today for your first month. After that MODUS is $${price} a month until you cancel.` }
      : { q: 'When am I charged?', a: `Your card is charged $${price} when you subscribe, then every month until you cancel.` },
    { q: 'Can I cancel anytime?', a: 'Yes. Cancel from Settings, Billing and you keep full access until the end of the billing period. After that you drop back to the free tier. Nothing is deleted.' },
    ...(offer
      ? [{ q: `Who gets the $${DOLLAR_OFFER.firstMonth} month?`, a: `New customers on MODUS monthly billing, until ${DOLLAR_OFFER.endsLabel} at 11:59 pm Pacific. The $${DOLLAR_OFFER.firstMonth} price is applied at checkout for you, and you'll see $${DOLLAR_OFFER.firstMonth} due today before you pay.` }]
      : []),
    { q: 'Which models do I get?', a: `${models.join(', ')}. Leave it on Auto and MODUS picks the model for each message, or pick one yourself.` },
  ];

  const ctaBlock = (id: string) => (
    <div id={id}>
      {offer ? (
        <div className="flex items-center justify-center gap-3 mb-6">
          <span className="font-grotesk !font-bold text-6xl sm:text-7xl tracking-tight leading-none">${DOLLAR_OFFER.firstMonth}</span>
          <span className="text-left leading-snug">
            <span className="block font-semibold">first month</span>
            <span className="block text-sm text-muted">then ${price}/mo. Ends {DOLLAR_OFFER.endsLabel}.</span>
          </span>
        </div>
      ) : null}
      <a href={href} className={`${BTN_VIOLET} w-full sm:w-auto px-8 py-4 text-base`}>
        {cta}
        <span aria-hidden>&rarr;</span>
      </a>
      <p className="text-sm text-muted mt-3">{terms}</p>
    </div>
  );

  return (
    <div className="marketing marketing-light-tokens">
      {offer && <RememberOffer />}
      <StickyOfferCTA href={href} label={cta} />
      <main className="bg-bg text-text min-h-screen overflow-x-hidden">
        <header className="px-6 pt-6 max-w-5xl mx-auto flex items-center justify-between">
          <Wordmark />
          {offer && (
            <span className="text-[11px] font-semibold tracking-[0.2em] uppercase text-brand">
              ${DOLLAR_OFFER.firstMonth} first month
            </span>
          )}
        </header>

        <section className="px-6 pt-12 sm:pt-20 pb-16 text-center">
          <div className="max-w-3xl mx-auto">
            <h1 className="font-grotesk !font-bold text-[2.75rem] leading-[1.02] sm:text-7xl !tracking-[-0.03em] mb-6 text-balance">
              <HeadlineText h={headline} className="" />
            </h1>
            <p className="text-muted text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto mb-9">
              GPT, Claude, Gemini, DeepSeek and Llama in one app. Leave it on Auto and MODUS picks the model for
              each message, or pick one yourself.
            </p>
            {ctaBlock('hero-cta')}
            <ul className="flex flex-wrap justify-center gap-2 mt-10" aria-label="Models included">
              {brands.map(b => {
                const Logo = b.logo;
                return (
                  <li
                    key={b.provider}
                    className={`inline-flex items-center gap-1.5 text-sm rounded-full border border-border px-3.5 py-1.5 ${b.soon ? 'text-muted' : 'bg-panel'}`}
                  >
                    <Logo className="w-4 h-4" />
                    {b.name}
                    {b.soon && <span className="text-[10px] font-semibold uppercase tracking-wider text-brand">Soon</span>}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="mt-12 sm:hidden">
            <PhoneChatCard models={models} />
          </div>
          <div className="hidden sm:block max-w-5xl mx-auto mt-16">
            <HeroFilmWindow />
          </div>
        </section>

        <section className="px-6 py-16 sm:py-20 border-t border-border">
          <div className="max-w-5xl mx-auto">
            <h2 className="font-grotesk !font-bold text-4xl sm:text-6xl !tracking-[-0.03em] leading-[1.05] mb-4 text-center">
              Ask once. <span className="font-serif italic font-normal text-brand tracking-normal">Compare three.</span>
            </h2>
            <p className="text-muted text-lg max-w-2xl mx-auto text-center mb-10">
              Ask one question and get GPT, Claude and Gemini answering side by side. Keep the best answer and keep going.
            </p>

            {/* Phones: stacked answers you can read. A 3 column screenshot is a sliver at 390px. */}
            <div className="sm:hidden space-y-3">
              <div className="flex justify-end">
                <p className="rounded-2xl rounded-br-md bg-brand text-white text-sm px-3.5 py-2 max-w-[85%]">{example.q}</p>
              </div>
              {example.cols.map(c => {
                const Logo = c.logo;
                return (
                  <div key={c.name} className="rounded-2xl border border-border bg-panel p-4">
                    <p className="flex items-center gap-2 text-sm font-semibold mb-1.5">
                      <Logo className="w-4 h-4" /> {c.name}
                    </p>
                    <p className="text-sm text-muted leading-relaxed">{c.answer}</p>
                  </div>
                );
              })}
              <p className="text-sm text-center pt-1">{example.verdict}</p>
            </div>

            <div className="hidden sm:block rounded-2xl border border-border bg-panel overflow-hidden shadow-[0_30px_80px_-40px_rgba(0,0,0,0.3)]">
              <Image
                src="/marketing/compare-3-models.png"
                alt="MODUS compare mode: the same question answered by GPT, Claude and Gemini side by side"
                width={3467}
                height={1488}
                sizes="1024px"
                className="block w-full h-auto"
              />
            </div>
            <p className="hidden sm:block text-xs text-muted mt-3 text-center">A real MODUS screenshot.</p>
          </div>
        </section>

        <section className="px-6 py-16 sm:py-20 border-t border-border">
          <div className="max-w-xl mx-auto">
            <h2 className="font-grotesk !font-bold text-4xl sm:text-6xl !tracking-[-0.03em] leading-[1.05] mb-10 text-center">
              You&apos;re paying for <span className="font-serif italic font-normal text-brand tracking-normal">three.</span>
            </h2>
            <div className="border-t-2 border-text">
              {OTHERS.map(o => (
                <div key={o.name} className="flex justify-between py-3.5 border-b border-border text-lg">
                  <span>{o.name}</span>
                  <span className="tabular-nums">{money(o.price)}</span>
                </div>
              ))}
              <div className="flex justify-between py-3.5 text-lg font-semibold">
                <span>Every month</span>
                <span className="tabular-nums text-muted line-through decoration-brand decoration-2">{money(OTHERS_TOTAL)}</span>
              </div>
            </div>
            <div className="mt-4 rounded-2xl bg-brand text-white p-6 sm:p-7 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-bold tracking-[0.3em]">MODUS</p>
                <p className="text-sm text-white/80 mt-1.5 leading-snug">GPT, Claude, Gemini, DeepSeek and Llama in one app.</p>
                {offer && (
                  <p className="inline-block mt-3 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold whitespace-nowrap">
                    ${DOLLAR_OFFER.firstMonth} first month
                  </p>
                )}
              </div>
              <p className="shrink-0 font-grotesk !font-bold leading-none">
                <span className="text-5xl tracking-tight">${price}</span>
                <span className="text-base font-medium text-white/80">/mo</span>
              </p>
            </div>
            <p className="text-xs text-muted mt-4 leading-relaxed">
              Monthly prices of each company&apos;s own plan, checked Nov 24 2026. MODUS gives you their models in one app,
              not each company&apos;s own app features.
            </p>
          </div>
        </section>

        <section className="px-6 py-16 sm:py-20 border-t border-border">
          <div className="max-w-3xl mx-auto">
            <h2 className="font-grotesk !font-bold text-4xl sm:text-6xl !tracking-[-0.03em] leading-[1.05] mb-10 text-center">
              What you <span className="font-serif italic font-normal text-brand tracking-normal">get.</span>
            </h2>
            <ul className="grid sm:grid-cols-2 gap-3">
              {features.map(f => (
                <li key={f} className="flex items-start gap-3 rounded-xl border border-border bg-panel px-4 py-3.5">
                  <Check />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="px-6 py-16 border-t border-border">
          <div className="max-w-2xl mx-auto">
            <h2 className="font-grotesk !font-bold text-3xl sm:text-5xl !tracking-[-0.03em] mb-8 text-center">Questions</h2>
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
          <h2 className="font-grotesk !font-bold text-4xl sm:text-6xl !tracking-[-0.03em] leading-[1.05] mb-10 text-balance max-w-3xl mx-auto">
            <HeadlineText h={headline} className="" />
          </h2>
          {ctaBlock('final-cta')}
        </section>

        <footer className="px-6 py-8 border-t border-border">
          <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
            <span>&copy; {new Date().getFullYear()} Modus. All rights reserved.</span>
            <span className="flex gap-4">
              <a href="/privacy" className="hover:text-text">Privacy</a>
              <a href="/terms" className="hover:text-text">Terms</a>
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}
