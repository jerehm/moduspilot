'use client';

import Link from 'next/link';
import MarketingShell from '@/components/marketing/MarketingShell';
import LatestReleaseCard from '@/components/marketing/LatestReleaseCard';
import { ClaudeLogo, OpenAILogo, GeminiLogo, MetaLogo, DeepSeekLogo } from '@/components/marketing/ModelLogos';

const MODELS = [
  { name: 'Claude', Logo: ClaudeLogo },
  { name: 'GPT-6', Logo: OpenAILogo },
  { name: 'Gemini', Logo: GeminiLogo },
  { name: 'Llama', Logo: MetaLogo },
  { name: 'DeepSeek', Logo: DeepSeekLogo },
];

const DOES = [
  {
    title: 'Auto-routing',
    body: 'Leave it on Auto and every message goes to the model that does the task best. You never pick a tab again.',
  },
  {
    title: 'Compare, side by side',
    body: 'Ask three models the same question at once and Modus tells you which answer won, and why.',
  },
  {
    title: 'Reads your work',
    body: 'Connect your inbox, calendar and files so answers are grounded in your real context, not guesses.',
  },
  {
    title: 'Acts, with approval',
    body: 'Draft and send email, move meetings, update goals. Every action waits on an approval card first.',
  },
  {
    title: 'Remembers you',
    body: 'Persistent memory across every conversation, so you are not starting from zero each morning.',
  },
  {
    title: 'Everywhere you are',
    body: 'One account across web, Mac and iPhone. Everything syncs.',
  },
];

const VS = [
  { row: 'The models', them: "One company's models. To get both, you buy both.", us: 'Claude, GPT-6, Gemini, Llama and DeepSeek, in one thread, on one bill.' },
  { row: 'Picking one', them: 'You pick the app, then the model inside it. Guess wrong, wrong answer.', us: 'Auto reads the task and routes it to the best model. You just type.' },
  { row: 'A second opinion', them: 'One model, one answer. You never find out what it missed.', us: 'Ask three at once, side by side, with a verdict.' },
  { row: 'Your life', them: 'A blank chat that forgets you the moment you close the tab.', us: 'Your inbox, calendar and files connected, and memory of you.' },
  { row: 'The bill', them: '$20 here, $20 there, and up from there.', us: 'One $28 subscription. The whole stack, replaced.' },
];

export default function FeaturesPage() {
  return (
    <MarketingShell>
      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-36 pb-12">
        <p className="text-xs uppercase tracking-[0.2em] text-muted mb-5">The product</p>
        <div className="grid md:grid-cols-2 gap-x-12 gap-y-6 md:items-end">
          <h1 className="font-grotesk font-bold text-[2.8rem] sm:text-6xl md:text-[4.2rem] leading-[1.0] text-text tracking-[-0.02em]">
            One AI that<br />actually knows you
          </h1>
          <p className="text-lg text-muted leading-relaxed md:pb-2">
            Every frontier model in one chat, connected to your inbox, calendar and files, and it acts on your
            behalf with your approval. Not another blank tab.
          </p>
        </div>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <Link href="/login" className="btn-ink px-6 py-3 text-sm">Start free</Link>
          <Link href="/pricing" className="btn-outline px-6 py-3 text-sm">See pricing</Link>
        </div>
      </section>

      {/* Big image card — every model */}
      <section className="max-w-6xl mx-auto px-6 py-6">
        <LatestReleaseCard
          eyebrow="Every model"
          title={<>The best model,<br className="hidden sm:block" /> for every task</>}
          subtitle="Claude for writing, GPT for reasoning, Gemini for speed. Modus routes each message to whichever wins."
          image="/marketing/galaxy.jpg"
          href="/product/compare"
          cta="Compare the models"
          align="left"
          height="medium"
        />
        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
          {MODELS.map(({ name, Logo }) => (
            <div key={name} className="flex items-center gap-2">
              <Logo className="w-5 h-5" />
              <span className="text-sm text-text/80">{name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* What it does */}
      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-border">
        <div className="grid md:grid-cols-[260px_1fr] gap-8 md:gap-12">
          <div className="md:sticky md:top-24 self-start">
            <p className="text-xs uppercase tracking-[0.18em] text-muted mb-2">What it does</p>
            <h2 className="text-2xl sm:text-3xl text-text tracking-tight">More than a chat box</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {DOES.map(d => (
              <div key={d.title} className="rounded-xl border border-border bg-panel p-6">
                <h3 className="text-base font-semibold text-text mb-2">{d.title}</h3>
                <p className="text-sm text-muted leading-relaxed">{d.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Big image card — connected life */}
      <section className="max-w-6xl mx-auto px-6 py-6">
        <LatestReleaseCard
          eyebrow="Connected"
          title={<>It knows your<br className="hidden sm:block" /> whole week</>}
          subtitle="A morning briefing built from your calendar, inbox and goals, waiting when you wake up."
          image="/marketing/cosmic.jpg"
          href="/product/integrations"
          cta="See integrations"
          align="left"
          height="medium"
        />
      </section>

      {/* vs the stack */}
      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-border">
        <div className="mb-8">
          <p className="text-xs uppercase tracking-[0.18em] text-muted mb-2">The difference</p>
          <h2 className="font-grotesk font-bold text-3xl sm:text-4xl text-text tracking-[-0.01em]">
            They give you one company&apos;s AI. Modus gives you everyone&apos;s.
          </h2>
        </div>
        <div className="rounded-2xl border border-border overflow-hidden">
          <div className="grid grid-cols-[1fr_1fr] sm:grid-cols-[160px_1fr_1fr] bg-panel border-b border-border">
            <div className="hidden sm:block px-5 py-3" />
            <div className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted">The one-model apps</div>
            <div className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-text">MODUS</div>
          </div>
          {VS.map((r, i) => (
            <div key={r.row} className={`grid grid-cols-[1fr_1fr] sm:grid-cols-[160px_1fr_1fr] ${i < VS.length - 1 ? 'border-b border-border' : ''}`}>
              <div className="hidden sm:block px-5 py-5 text-sm font-medium text-text">{r.row}</div>
              <div className="px-5 py-5 text-sm text-muted leading-relaxed border-r border-border">{r.them}</div>
              <div className="px-5 py-5 text-sm text-text/90 leading-relaxed bg-panel/40">{r.us}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Close */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-border">
        <h2 className="font-grotesk font-bold text-3xl sm:text-4xl text-text tracking-[-0.01em] mb-5">See it for yourself.</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/login" className="btn-ink px-8 py-3.5 text-base">Start free</Link>
          <Link href="/pricing" className="btn-outline px-8 py-3.5 text-base">See pricing</Link>
        </div>
      </section>
    </MarketingShell>
  );
}
