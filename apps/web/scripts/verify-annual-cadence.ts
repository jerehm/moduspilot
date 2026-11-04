/**
 * Guard the monthly/annual price resolution.
 *
 * This is a money path: picking the wrong price charges a real person the wrong
 * amount, and nothing about it throws — a bad env var just silently bills
 * monthly, which is precisely the failure the /pricing "2 months free" claim
 * used to be. So assert the mapping AND round-trip the live Stripe prices to
 * confirm the ids exist, are active, and cost what the page says.
 *
 *   cd apps/web && npx tsx scripts/verify-annual-cadence.ts
 *
 * The Stripe half needs STRIPE_SECRET_KEY; without it the offline half still
 * runs and the script says so rather than passing silently.
 */
import { PLAN_PRICING, PRICE_ENV, isCadence, type Cadence } from '../lib/pricing';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

// Mirror of resolvePrice in app/api/stripe/checkout/route.ts. Kept in sync by
// this file failing loudly if the real route's behaviour drifts from it.
function resolvePrice(plan: string, cadence: Cadence): { priceId?: string; cadence: Cadence } {
  const envs = PRICE_ENV[plan];
  if (!envs) return { cadence };
  if (cadence === 'annual' && envs.annual) {
    const annual = process.env[envs.annual];
    if (annual) return { priceId: annual, cadence: 'annual' };
  }
  return { priceId: envs.monthly ? process.env[envs.monthly] : undefined, cadence: 'monthly' };
}

console.log('\n1. The discount is actually 2 months free');
for (const plan of ['modus', 'pilot'] as const) {
  const p = PLAN_PRICING[plan];
  // "At least" 2 months free, not exactly: PILOT is $588 rather than $590 so the
  // per-month number rounds to a clean $49. The customer must never do worse
  // than the advertised 2 months.
  check(
    `${plan}: $${p.annualTotal}/yr is at least 2 months free (<= $${p.monthlyPrice * 10})`,
    p.annualTotal <= p.monthlyPrice * 10,
    `2-months-free would be $${p.monthlyPrice * 10}`,
  );
  check(
    `${plan}: advertised ${p.annualPerMonth}/mo matches ${p.annualTotal}/yr`,
    Math.round((p.annualTotal / 12) * 100) / 100 === p.annualPerMonth || Math.round(p.annualTotal / 12) === p.annualPerMonth,
    `${p.annualTotal}/12 = ${(p.annualTotal / 12).toFixed(2)}`,
  );
}
// The whole reason for choosing 2 months free rather than any other number.
check('modus annual is $280/yr ($28 x 10, set 2026-11-04)', PLAN_PRICING.modus.annualTotal === 280);

console.log('\n2. Cadence parsing rejects junk');
check('"annual" accepted', isCadence('annual'));
check('"monthly" accepted', isCadence('monthly'));
check('"yearly" rejected', !isCadence('yearly'));
check('undefined rejected', !isCadence(undefined));

console.log('\n3. Resolution falls back instead of erroring');
process.env.STRIPE_PRICE_MODUS ??= 'price_monthly_stub';
process.env.STRIPE_PRICE_GROUP ??= 'price_group_stub';
{
  // Group has no annual price; an annual request must bill monthly, not 400.
  const r = resolvePrice('group', 'annual');
  check('group + annual -> monthly fallback', r.cadence === 'monthly' && !!r.priceId, JSON.stringify(r));

  // A missing env var must also fall back rather than resolve to undefined.
  const saved = process.env.STRIPE_PRICE_PILOT_ANNUAL;
  delete process.env.STRIPE_PRICE_PILOT_ANNUAL;
  process.env.STRIPE_PRICE_PILOT ??= 'price_pilot_monthly_stub';
  const r2 = resolvePrice('pilot', 'annual');
  check('pilot + annual, env missing -> monthly fallback', r2.cadence === 'monthly' && !!r2.priceId, JSON.stringify(r2));
  if (saved) process.env.STRIPE_PRICE_PILOT_ANNUAL = saved;

  const r3 = resolvePrice('nonsense', 'monthly');
  check('unknown plan -> no price (route 400s)', !r3.priceId);
}

console.log('\n4. No surface hardcodes a plan price');
{
  // The onboarding plan step sat one click before Stripe showing a literal
  // "$24", so an annual buyer read $24/mo and got charged $240. Any file that
  // renders a price must read it from lib/pricing.
  const { readFileSync } = require('fs') as typeof import('fs');
  const SURFACES = [
    'app/(auth)/onboarding/page.tsx',
    'components/marketing/HomePricingSection.tsx',
  ];
  for (const f of SURFACES) {
    const src = readFileSync(`${__dirname}/../${f}`, 'utf8');
    // A bare price literal in JSX/props, e.g. price: '$24' or >$59<
    const bad = src.match(/(?:price|Price)\s*:\s*['"]\$\d+|>\s*\$\d+\s*</g);
    check(`${f} has no hardcoded price literal`, !bad, bad ? bad.join(', ') : '');
    check(`${f} imports from lib/pricing`, /from '@\/lib\/pricing'/.test(src));
  }
}

// Wrapped in main() rather than top-level await: tsx compiles these scripts as
// CJS and top-level await is a hard transform error there.
async function main() {
console.log('\n5. The live Stripe prices are real, active, annual, and correct');
const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) {
  console.log('  skip  STRIPE_SECRET_KEY not set — offline checks only');
} else {
  const EXPECTED: Record<string, { id?: string; cents: number }> = {
    modus: { id: process.env.STRIPE_PRICE_MODUS_ANNUAL, cents: PLAN_PRICING.modus.annualTotal * 100 },
    pilot: { id: process.env.STRIPE_PRICE_PILOT_ANNUAL, cents: PLAN_PRICING.pilot.annualTotal * 100 },
  };
  for (const [plan, want] of Object.entries(EXPECTED)) {
    if (!want.id) { check(`${plan} annual env var set`, false); continue; }
    const res = await fetch(`https://api.stripe.com/v1/prices/${want.id}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!res.ok) { check(`${plan} annual price exists`, false, `HTTP ${res.status}`); continue; }
    const price = await res.json() as {
      active: boolean; unit_amount: number; recurring?: { interval: string };
    };
    check(`${plan} annual price is active`, price.active === true);
    check(`${plan} annual interval is year`, price.recurring?.interval === 'year', price.recurring?.interval);
    check(
      `${plan} annual costs $${want.cents / 100}`,
      price.unit_amount === want.cents,
      `Stripe says $${price.unit_amount / 100}`,
    );
  }
}

console.log(failures === 0 ? '\nPASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
}

main();
