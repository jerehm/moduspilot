// $1 first month on MODUS monthly, ends Dec 31 2026 11:59:59 pm Pacific.
// Dry run by default. `node q4-dollar-offer.mjs --create` creates the coupon and code.
// Reads STRIPE_SECRET_KEY and STRIPE_PRICE_MODUS from apps/web/.env.local and never prints the key.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, '../../../apps/web/.env.local'), 'utf8')
    .split('\n').filter(l => /^[A-Z0-9_]+=/.test(l))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '').trim()]; }),
);
const KEY = env.STRIPE_SECRET_KEY;
const PRICE = env.STRIPE_PRICE_MODUS;
const CODE = 'ONEDOLLAR';
const ENDS = Math.floor(Date.UTC(2027, 0, 1, 7, 59, 59) / 1000); // Dec 31 2026 23:59:59 PST
const create = process.argv.includes('--create');

async function stripe(method, path, params) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Stripe-Version': '2024-06-20',
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${json.error?.message}`);
  return json;
}

console.log('key mode:', KEY?.startsWith('sk_live_') ? 'live' : KEY?.startsWith('sk_test_') ? 'test' : 'unknown');
console.log('ends at:', new Date(ENDS * 1000).toISOString(), '=', new Date(ENDS * 1000).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }), 'Pacific');
const price = await stripe('GET', `/prices/${PRICE}`);
console.log('price:', price.id, price.unit_amount, price.currency, price.recurring?.interval, 'product', price.product, 'livemode', price.livemode, 'active', price.active);
const existing = await stripe('GET', `/promotion_codes?code=${CODE}&limit=5`);
console.log('existing codes named', CODE + ':', existing.data.length);
if (price.unit_amount !== 2800 || price.recurring?.interval !== 'month') throw new Error('Price is not $28 monthly, stopping.');
if (!create) { console.log('dry run only'); process.exit(0); }
if (existing.data.length) throw new Error(`${CODE} already exists, stopping.`);

const coupon = await stripe('POST', '/coupons', {
  name: '$1 first month (ends Dec 31)',
  amount_off: '2700',
  currency: 'usd',
  duration: 'once',
  redeem_by: String(ENDS),
  'applies_to[products][0]': price.product,
  'metadata[source]': 'meta_us_subscribe_test',
});
console.log('coupon:', coupon.id, coupon.amount_off, coupon.duration, 'redeem_by', coupon.redeem_by, 'applies_to', JSON.stringify(coupon.applies_to));
const promo = await stripe('POST', '/promotion_codes', {
  coupon: coupon.id,
  code: CODE,
  expires_at: String(ENDS),
  'restrictions[first_time_transaction]': 'true',
  'metadata[source]': 'meta_us_subscribe_test',
});
console.log('promotion code:', promo.id, promo.code, 'active', promo.active, 'expires_at', promo.expires_at, 'first_time_only', promo.restrictions?.first_time_transaction, 'livemode', promo.livemode);
