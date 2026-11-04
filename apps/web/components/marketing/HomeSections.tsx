'use client';

import Link from 'next/link';
import { ClaudeLogo, OpenAILogo, GeminiLogo, MetaLogo, DeepSeekLogo } from './ModelLogos';

const MODELS = [
  { name: 'Claude', Logo: ClaudeLogo },
  { name: 'GPT-6', Logo: OpenAILogo },
  { name: 'Gemini', Logo: GeminiLogo },
  { name: 'Llama', Logo: MetaLogo },
  { name: 'DeepSeek', Logo: DeepSeekLogo },
];

const INTEGRATIONS = [
  'Gmail', 'Outlook', 'Google Calendar', 'Google Drive', 'Notion',
  'Slack', 'GitHub', 'Linear', 'Apple Notes', 'iMessage', 'Plaid', 'MCP servers',
];

const STACK = [
  { name: 'ChatGPT Plus', price: '$20' },
  { name: 'Claude Pro', price: '$20' },
  { name: 'Google AI Pro', price: '$20' },
  { name: 'Perplexity Pro', price: '$20' },
  { name: 'Midjourney', price: '$30' },
];

/**
 * The three tight homepage sections below the hero (Anthropic-calm, left-aligned,
 * hairline dividers, no animation). Kept deliberately short — the depth lives on
 * the Product pages.
 */
export default function HomeSections() {
  return (
    <>
      {/* 1 — Every model */}
      <section className="max-w-5xl mx-auto px-6 py-16 sm:py-20 border-t border-border">
        <div className="grid md:grid-cols-[260px_1fr] gap-8 md:gap-12">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted mb-2">Every model</p>
            <h2 className="text-2xl sm:text-3xl text-text tracking-tight">One chat, every frontier model</h2>
          </div>
          <div>
            <p className="text-muted leading-relaxed max-w-xl mb-8">
              Leave it on Auto and Modus routes each message to the model that fits, or pick one yourself. Ask
              several at once and get one clear answer.
            </p>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              {MODELS.map(({ name, Logo }) => (
                <div key={name} className="flex items-center gap-2">
                  <Logo className="w-5 h-5" />
                  <span className="text-sm text-text/80">{name}</span>
                </div>
              ))}
            </div>
            <Link href="/product/compare" className="inline-block mt-8 text-sm text-text underline underline-offset-4 hover:opacity-70">
              Compare the models
            </Link>
          </div>
        </div>
      </section>

      {/* 2 — Connected to your life */}
      <section className="max-w-5xl mx-auto px-6 py-16 sm:py-20 border-t border-border">
        <div className="grid md:grid-cols-[260px_1fr] gap-8 md:gap-12">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted mb-2">Connected</p>
            <h2 className="text-2xl sm:text-3xl text-text tracking-tight">Your whole life, connected</h2>
          </div>
          <div>
            <p className="text-muted leading-relaxed max-w-xl mb-8">
              Modus reads your inbox, calendar, files and apps only to surface what matters, and never sends or
              changes anything without your approval.
            </p>
            <div className="flex flex-wrap gap-2">
              {INTEGRATIONS.map(name => (
                <span key={name} className="text-sm text-text/80 border border-border rounded-full px-3 py-1.5">
                  {name}
                </span>
              ))}
            </div>
            <Link href="/product/integrations" className="inline-block mt-8 text-sm text-text underline underline-offset-4 hover:opacity-70">
              See all integrations
            </Link>
          </div>
        </div>
      </section>

      {/* 3 — The math */}
      <section className="max-w-5xl mx-auto px-6 py-16 sm:py-20 border-t border-border">
        <div className="grid md:grid-cols-[260px_1fr] gap-8 md:gap-12">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted mb-2">The math</p>
            <h2 className="text-2xl sm:text-3xl text-text tracking-tight">You&apos;re paying for five. Modus is one.</h2>
          </div>
          <div>
            <p className="text-muted leading-relaxed max-w-xl mb-8">
              The subscriptions people stack to get every model come to more than $100 a month, and none of them
              know your calendar, your inbox, or what you decided last week.
            </p>
            <div className="rounded-2xl border border-border bg-panel divide-y divide-border max-w-md">
              {STACK.map(row => (
                <div key={row.name} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm text-muted line-through">{row.name}</span>
                  <span className="text-sm text-muted">{row.price}</span>
                </div>
              ))}
              <div className="flex items-center justify-between px-5 py-4">
                <span className="text-sm font-semibold text-text">Modus, all of it</span>
                <span className="text-base font-semibold text-text">$28/mo</span>
              </div>
            </div>
            <Link href="/pricing" className="inline-block mt-8 text-sm text-text underline underline-offset-4 hover:opacity-70">
              See pricing
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
