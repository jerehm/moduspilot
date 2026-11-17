'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { PLAN_PRICING, LIMIT_ADDON, CADENCE_STORAGE_KEY, type Cadence } from '@/lib/pricing';
import AnimatedPrice from './AnimatedPrice';
import CadenceToggle from './CadenceToggle';
import { PLANS } from '@/lib/plan-copy';

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-4 h-4 shrink-0 mt-0.5 text-text">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/**
 * The three plan cards. Shared by the homepage and /pricing so the offer can never
 * drift between them — `showHeading={false}` on /pricing, where the page's own hero
 * already says this. Flat cards (Anthropic / Perplexity look): a single hairline
 * border, the popular plan carries a solid darker border and a plain badge, no glow.
 */
export default function HomePricingSection({
  showHeading = true,
  showCadenceToggle = true,
}: {
  showHeading?: boolean;
  showCadenceToggle?: boolean;
}) {
  const [cadence, setCadence] = useState<Cadence>('monthly');
  const annual = cadence === 'annual';

  function chooseCadence(next: Cadence) {
    setCadence(next);
    try { window.localStorage.setItem(CADENCE_STORAGE_KEY, next); } catch { /* private mode */ }
  }

  return (
    <section id="pricing" className={`${showHeading ? 'py-24 sm:py-28' : 'pt-6 pb-8'} px-6`}>
      <div className="max-w-6xl mx-auto">
        {showHeading && (
        <motion.div
          initial={false}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="text-center mb-14"
        >
          <h2 className="text-4xl md:text-5xl text-text tracking-tight mb-4">Simple, honest pricing</h2>
          <p className="text-muted text-base sm:text-lg max-w-2xl mx-auto">
            Start free on the open models. Upgrade for every frontier model and your whole life connected.
          </p>
        </motion.div>
        )}

        {showCadenceToggle && (
          <div className="flex justify-center mb-10">
            <CadenceToggle cadence={cadence} onChange={chooseCadence} />
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-6 items-start">
          {PLANS.map((plan, i) => (
            <motion.div
              key={plan.name}
              initial={false}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: i * 0.08, ease: 'easeOut' }}
              className={`relative rounded-2xl p-7 sm:p-8 bg-panel border ${
                plan.popular ? 'border-text/40' : 'border-border'
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-8 rounded-full text-[11px] font-semibold px-3 py-1 bg-text text-bg">
                  Most popular
                </span>
              )}

              <div className="mb-1">
                <span className="text-base font-semibold tracking-widest text-text">{plan.name}</span>
              </div>
              <div className="flex items-baseline gap-1 mb-2">
                {plan.free ? (
                  <span className="text-5xl text-text [font-family:var(--font-serif)] font-medium">$0</span>
                ) : (
                  <>
                    <AnimatedPrice
                      value={annual ? PLAN_PRICING[plan.id as 'modus' | 'pilot'].annualPerMonth : PLAN_PRICING[plan.id as 'modus' | 'pilot'].monthlyPrice}
                      direction={annual ? 'up' : 'down'}
                      className="text-5xl text-text [font-family:var(--font-serif)] font-medium"
                    />
                    <span className="text-muted text-lg">/mo</span>
                  </>
                )}
              </div>
              <p className="text-sm text-muted leading-relaxed mb-6 min-h-[40px]">
                {plan.free
                  ? `No card. Refreshes through the day. ${plan.tagline}`
                  : annual
                    ? `Billed annually at $${PLAN_PRICING[plan.id as 'modus' | 'pilot'].annualTotal}. ${plan.tagline}`
                    : `Start free, then $${PLAN_PRICING[plan.id as 'modus' | 'pilot'].monthlyPrice}/mo. ${plan.tagline}`}
              </p>

              <a
                href={plan.free ? '/login' : `/login?plan=${plan.id}&cadence=${cadence}`}
                onClick={() => { if (!plan.free) chooseCadence(cadence); }}
                className={`w-full py-3 text-sm ${plan.popular ? 'btn-ink' : 'btn-outline'}`}
              >
                {plan.free ? 'Start free' : `Get ${plan.name}`}
              </a>

              <ul className="mt-7 space-y-3">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2.5">
                    <Check />
                    <span className="text-sm text-text/90 leading-relaxed">{f}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        {/* Extra limits are purchased separately from the base plan. */}
        <motion.div
          initial={false}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
          className="mt-6 rounded-2xl border border-border bg-panel px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div>
            <p className="text-sm font-semibold text-text mb-1">
              Need more headroom? Add extra limits for ${LIMIT_ADDON.monthlyPrice}/mo
            </p>
            <p className="text-sm text-muted leading-relaxed max-w-xl">
              Each pack adds 500,000 credits per five-hour window and 3,500,000 per week on a paid plan.
              Packs stack and can be canceled separately.
            </p>
          </div>
          <span className="shrink-0 text-xs text-muted">Available once you&apos;re on a plan</span>
        </motion.div>
      </div>
    </section>
  );
}
