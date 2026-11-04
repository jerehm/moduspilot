'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import Navbar from '@/components/marketing/Navbar';
import Footer from '@/components/marketing/Footer';
import HomePricingSection from '@/components/marketing/HomePricingSection';
import MarketingDecor from '@/components/marketing/MarketingDecor';

/**
 * /pricing — rebuilt 2026-07-21 to match the light/serif homepage.
 *
 * Deliberately thin: a hero, the SAME two plan cards the homepage renders
 * (imported, not copied, so the offer can never drift), one honest cost line,
 * the questions, one CTA. The old page had a 4-tile comparison grid, a
 * 6-card "what you actually get" grid, a Group card and 7 FAQs on a dark theme.
 *
 * Two factual bugs removed with it:
 *  - "Annual billing available, 2 months free" — no annual price existed in
 *    Stripe at the time, and this page's own FAQ said so two sections earlier.
 *    Annual is real now and the toggle sells it.
 *  - "See how it works" linked to /features, which now redirects to /.
 *
 * Group is gone entirely (2026-08-04) — multi-seat moves to its own Enterprise
 * section rather than sitting as a third tier here. Two plans, plus the limits
 * add-on for anyone who needs headroom without the jump to PILOT.
 */

const FAQS = [
  {
    // First on purpose. "Do I have to pay to look at it" is the question that
    // decides whether a stranger signs in at all.
    q: 'Do I need a card to try it?',
    a: 'No. The free plan gives you the open models (Llama, DeepSeek and Gemini Flash) with no card, on a rolling window that refreshes through the day. Upgrade to MODUS or PILOT for paid models and higher limits. Paid plans are billed when you subscribe.',
  },
  {
    q: 'When am I charged?',
    a: 'Your card is charged when you subscribe: $28/mo for MODUS or $59/mo for PILOT with monthly billing. Annual subscriptions charge the full yearly amount at checkout. The Free plan never requires a card.',
  },
  {
    q: 'Can I cancel anytime?',
    // The webhook sets plan:'free' and hasActiveAccess() rejects it, so the paid
    // product does stop. What it drops to is the same free tier a new signup gets,
    // minus anything they already spent — which is why this no longer says "MODUS
    // stops" flatly. Nothing being deleted is still the part actually worth saying.
    a: 'Yes, no lock-in. Cancel from Settings, Billing and you keep full access until the end of the billing period. After that you drop back to the free tier. Nothing is deleted, and your goals, notes and history are exactly where you left them.',
  },
  {
    q: 'Is there annual billing?',
    // True as of 2026-11-04: price_1UY1uL...PBT5 ($280) and price_1TvWR0... ($588)
    // are live in Stripe and wired through /api/stripe/checkout via `cadence`.
    // The limits add-on is monthly-only, which is why it isn't mentioned here.
    a: 'Yes. Switch the toggle above to Annually and you get 2 months free: MODUS is $280 a year, which works out at $23.33/mo, and PILOT is $588 a year, $49/mo. The full yearly amount is charged when you subscribe. Cancel anytime.',
  },
  {
    q: 'What if I hit my limits?',
    // Deliberately does NOT quote a single message count. One add-on is +500k
    // units/day, which is ~25 more messages on standard models but under one
    // more on Claude Fable 5.1 — a bare "25 more messages" would be false for
    // anyone using the frontier tier. "Double" is exact for every model.
    a: 'On a paid plan, each $10/mo extra limit pack adds 500,000 credits per five-hour window and 3,500,000 credits per week. Packs stack and can be canceled separately from your plan.',
  },
  {
    q: "What's the difference between MODUS and PILOT?",
    a: 'MODUS gives you every provider on Auto, routed to whichever model fits the task. PILOT adds the frontier tier, Claude Opus 5.5, Claude Fable 5.1, GPT-6 Astra and Gemini 4, which you pick per message, plus the executive layer: wearable sync, financial pulse, relationship CRM, meeting intelligence and a document vault.',
  },
  {
    q: 'Is my data private?',
    a: 'Your data is never sold or used to train AI models. Conversations, goals and memories are stored in your own database, Modus reads your connected apps only to surface what matters, and it never sends or publishes anything without your explicit approval.',
  },
];

function FAQItem({ q, a, index }: { q: string; a: string; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: index * 0.05 }}
      className="rounded-xl overflow-hidden border border-border bg-panel"
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-text/[0.03] transition-colors"
      >
        <span className="text-sm font-semibold text-text pr-4">{q}</span>
        <span className={`text-muted text-lg shrink-0 transition-transform duration-200 ${open ? 'rotate-45' : ''}`}>+</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <p className="px-6 py-4 text-sm text-muted leading-relaxed bg-bg/60">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function PricingPage() {
  // Same light-by-default marketing shell the homepage uses (see MarketingHome).
  const [dark, setDark] = useState(false);

  return (
    <div className={`marketing ${dark ? 'marketing-dark-tokens' : 'marketing-light-tokens'}`}>
      <Navbar marketingTheme={dark ? 'dark' : 'light'} onToggleTheme={() => setDark(d => !d)} />

      <main className="bg-bg text-text min-h-screen overflow-x-hidden relative">
        <MarketingDecor dark={dark} />

        <div className="relative" style={{ zIndex: 2 }}>
          {/* ── Hero ──────────────────────────────────────────────────── */}
          <section className="pt-36 pb-14 px-6 max-w-5xl mx-auto">
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              className="text-5xl md:text-6xl text-text tracking-tight leading-[1.08] mb-5"
            >
              One subscription.
              <br />
              Every model.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.12, ease: 'easeOut' }}
              className="text-muted text-lg max-w-xl leading-relaxed"
            >
              Free on the open models, no card. Every frontier model and your apps on a paid plan.
            </motion.p>
          </section>

          {/* ── The two plans (shared with the homepage) ───────────────── */}
          <HomePricingSection showHeading={false} showCadenceToggle />

          {/* ── The honest cost line ──────────────────────────────────── */}
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.5 }}
            className="px-6 pt-6 pb-24"
          >
            <p className="max-w-xl mx-auto text-center text-sm text-muted leading-relaxed">
              ChatGPT Plus, Claude Pro, Google AI Pro, Perplexity Pro and Midjourney come to{' '}
              <span className="text-text font-semibold">$110 a month</span>, and none of them know your
              calendar, your inbox, or what you decided last week.
            </p>
          </motion.section>

          {/* ── Questions ─────────────────────────────────────────────── */}
          <section className="px-6 pb-28">
            <div className="max-w-2xl mx-auto">
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className="text-3xl md:text-4xl text-text tracking-tight text-center mb-10"
              >
                Questions
              </motion.h2>

              <div className="space-y-3">
                {FAQS.map((faq, i) => (
                  <FAQItem key={faq.q} q={faq.q} a={faq.a} index={i} />
                ))}
              </div>
            </div>
          </section>

          {/* ── Final CTA ─────────────────────────────────────────────── */}
          <section className="px-6 pb-32 text-center">
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-4xl md:text-5xl text-text tracking-tight mb-6"
            >
              Start today.
            </motion.h2>
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <Link href="/login" className="btn-ink px-8 py-4 text-base">
                Start free
              </Link>
              <p className="text-muted text-xs mt-5">Free on the open models, no card. Upgrade any time.</p>
            </motion.div>
          </section>

          <Footer />
        </div>
      </main>
    </div>
  );
}
