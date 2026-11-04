/**
 * One source of truth for what MODUS costs.
 *
 * The marketing pages render from this and /api/stripe/checkout resolves its
 * Stripe price from it, so a number on the page can never drift from the number
 * on the card. Amounts here are DISPLAY dollars; Stripe holds the real amounts.
 *
 * Annual = 2 months free. MODUS went $24 -> $28 (annual $240 -> $280) on
 * 2026-11-04 for everyone, founders included, so annual is $23.33/mo effective
 * and no longer equals ChatGPT Plus.
 */

export type Cadence = 'monthly' | 'annual';

export const CADENCES: Cadence[] = ['monthly', 'annual'];

export function isCadence(v: unknown): v is Cadence {
  return v === 'monthly' || v === 'annual';
}

type PlanPricing = {
  /** Headline number, always expressed per-month so the two cadences compare. */
  monthlyPrice: number;
  annualPerMonth: number;
  /** What actually gets charged once a year. */
  annualTotal: number;
};

export const PLAN_PRICING: Record<'modus' | 'pilot', PlanPricing> = {
  modus: { monthlyPrice: 28, annualPerMonth: 23.33, annualTotal: 280 },
  pilot: { monthlyPrice: 59, annualPerMonth: 49, annualTotal: 588 },
};

/** Months of the year you don't pay for, for the toggle's badge. */
export const MONTHS_FREE = 2;

/**
 * The limits add-on: more daily/weekly headroom without jumping to PILOT.
 *
 * 💸 THE PRICE IS SET AGAINST A MEASURED CEILING, NOT A GUESS. A budget unit is
 * pinned to gemini-3.5-flash-LITE at $0.52 per 1M (lib/chat/model-cost.ts), and
 * costWeight rounds UP, so $0.52/1M is a ceiling on what a unit can actually cost
 * us. The add-on raises the WEEKLY cap by 3.5M units (window*7), and the week is
 * what bounds the month: 3.5M x (30/7) = 15M units/month x $0.52/1M = $7.80/month
 * worst case — every unit burned on frontier models — against $10 of revenue. 22%
 * margin at the floor, and far above that in practice.
 *
 * Cost and price both scale linearly with quantity, so the margin is identical
 * whether someone buys one or five.
 *
 * ⚠️ The margin is eaten by ESTIMATION ERROR, not usage — and that has already
 * bitten once: gemini-3.5-flash was carrying flash-LITE's rates, 4.3x understated,
 * while it was the baseline. The unit's dollar value survived that (flash-lite
 * took over the baseline with the same $0.52), so this margin is intact, but the
 * lesson stands: an `est: true` price is an undone to-do, not a hedge.
 * Re-verify the baseline's rate before increasing windowUnits.
 */
export const LIMIT_ADDON = { monthlyPrice: 10, windowUnits: 500_000 } as const;

/** Env var holding the Stripe price for a given plan + cadence. */
export const PRICE_ENV: Record<string, Record<Cadence, string | undefined>> = {
  modus: { monthly: 'STRIPE_PRICE_MODUS', annual: 'STRIPE_PRICE_MODUS_ANNUAL' },
  pilot: { monthly: 'STRIPE_PRICE_PILOT', annual: 'STRIPE_PRICE_PILOT_ANNUAL' },
  // Group is gone — multi-seat moves to a future Enterprise section, so there is
  // no purchasable Group price any more. Accounts already carrying plan:'group'
  // keep their access (see lib/plan.ts); they just can't be sold or repriced.
  //
  // The add-on is monthly-only and stacks by Stripe subscription QUANTITY, so it
  // has no annual price. resolvePlanPrice falls back to monthly for it.
  limitAddon: { monthly: 'STRIPE_PRICE_LIMIT_ADDON', annual: undefined },
};

/** Where the chosen cadence is parked across the /login -> onboarding hop. */
export const CADENCE_STORAGE_KEY = 'modus.cadence';

/**
 * Resolve plan + cadence to a Stripe price. Annual falls back to monthly when no
 * annual price exists (Group), and when the env var is missing — better to bill
 * the cadence we can actually honour than to 400 someone out of checkout.
 *
 * Lives here, not in a route, because BOTH /api/stripe/checkout and
 * /api/stripe/change-plan need it. change-plan used to hold its own monthly-only
 * map, so an annual subscriber who changed plan was silently moved onto monthly
 * billing — the classic "the fix landed in one of the two call sites" bug.
 *
 * Always returns the cadence actually resolved, never the one requested.
 */
export function resolvePlanPrice(plan: string, cadence: Cadence): { priceId?: string; cadence: Cadence } {
  const envs = PRICE_ENV[plan];
  if (!envs) return { cadence };

  if (cadence === 'annual' && envs.annual) {
    const annual = process.env[envs.annual];
    if (annual) return { priceId: annual, cadence: 'annual' };
  }
  return { priceId: envs.monthly ? process.env[envs.monthly] : undefined, cadence: 'monthly' };
}
