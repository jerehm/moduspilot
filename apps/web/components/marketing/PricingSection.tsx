'use client';

import { motion } from 'framer-motion';

const PLANS = [
  {
    tier: 'MODUS',
    price: '$28',
    sub: '$28/mo. Billed when you subscribe · cancel anytime.',
    cta: 'Get started',
    popular: true,
    features: [
      'AI Chat, unlimited with full context',
      'Every provider, auto-routed: GPT-6, Claude, Gemini, Llama',
      'Generate images & editable PDFs',
      'Unlimited briefings + goals + habit engine',
      'Voice interface',
      'Calendar read + write',
      'Gmail / Outlook triage',
      'Habit tracker + streaks',
      'End-of-day reflection',
      '90-day context memory',
      'Weekly review reports',
      'Delegation tracker',
      'Focus protection',
      'Life admin automation',
      'Pattern recognition',
      'Web + Mac apps live · iPhone in beta',
    ],
  },
  {
    tier: 'PILOT',
    price: '$59',
    sub: 'For founders and executives. $59/mo, billed when you subscribe.',
    cta: 'Get started',
    popular: false,
    features: [
      'Everything in MODUS',
      'The frontier models: GPT-6 Astra, Claude Opus 5.5, Claude Fable 5.1 and Gemini 4, with manual pick per message',
      'Unlimited context memory',
      'Wearable sync (HealthKit, Oura, Whoop)',
      'Financial pulse via Plaid',
      'Relationship intelligence CRM',
      'Meeting intelligence (pre + post)',
      'Travel & logistics management',
      'Document vault',
      'Cross-app execution',
      'Slack + Notion + Linear',
      'Multi-workspace support',
      'Priority response SLA',
    ],
  },
];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12 } },
};

const item = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } },
};

export default function PricingSection() {
  return (
    <section id="pricing" className="relative py-32 px-6 overflow-hidden">
      {/* Neutral base so the raised plan cards carry the elevation themselves */}
      <div className="absolute inset-0 bg-bg" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_55%_50%_at_50%_0%,rgba(124,58,237,0.07),transparent_70%)]" />
      <div className="relative max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl md:text-5xl font-semibold tracking-tight text-text mb-4">One subscription. Every model.</h2>
          <p className="text-muted text-lg max-w-2xl mx-auto">
            Write with Gemini, research with Claude, ask ChatGPT, for one price, with far higher limits than paying for any of them alone. Start with the Free plan. Upgrade anytime.
          </p>
          <div className="mt-6 inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-muted bg-panel rounded-full px-4 py-2">
            <span className="text-text font-semibold">Replaces</span>
            <span>ChatGPT Plus</span><span className="text-muted/40">+</span>
            <span>Claude Pro</span><span className="text-muted/40">+</span>
            <span>Gemini Advanced</span>
            <span className="text-brand dark:text-brand-light font-semibold">for less.</span>
          </div>
        </motion.div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto pt-4"
        >
          {PLANS.map(plan => (
            <motion.div
              key={plan.tier}
              variants={item}
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
              className="relative"
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-20">
                  <span className="btn-primary inline-block text-white text-[11px] font-bold px-3.5 py-1 rounded-full whitespace-nowrap">Most Popular</span>
                </div>
              )}
              <div
                className={`relative bg-panel rounded-2xl overflow-hidden flex flex-col h-full ${
                  plan.popular
                    ? 'shadow-2xl shadow-black/60 ring-1 ring-brand/25'
                    : 'shadow-xl shadow-black/30'
                }`}
              >
              {plan.popular && (
                /* Top edge catches the accent, mirroring the /pricing card */
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-brand to-transparent" />
              )}
              <div className="px-8 pt-8 pb-6">
                <p className="text-xs font-bold text-muted uppercase tracking-widest mb-3">{plan.tier}</p>
                <p className="text-4xl font-semibold tracking-tight text-text mb-1">
                  {plan.price}<span className="text-base font-normal text-muted">/mo</span>
                </p>
                <p className="text-sm text-muted mt-2">{plan.sub}</p>
              </div>

              <div className="px-8 pb-6 flex-1">
                <ul className="space-y-3">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-muted">
                      <span aria-hidden className="w-1 h-1 rounded-full bg-brand mt-2 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="px-8 pb-8">
                <a
                  href="/login"
                  className="btn-primary block w-full py-3.5 rounded-xl text-sm font-bold text-center text-white transition-all hover:scale-[1.02] active:scale-100"
                >
                  {plan.cta}
                </a>
              </div>
              </div>
            </motion.div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-12 text-center space-y-2"
        >
          <p className="text-sm text-muted">Annual billing available, 2 months free.</p>
          <p className="text-xs text-muted/60 max-w-lg mx-auto">
            Superhuman charges $30/mo for email alone. A part-time assistant runs $1,500+/mo.
            MODUS at $28 replaces an entire cognitive workflow category.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
