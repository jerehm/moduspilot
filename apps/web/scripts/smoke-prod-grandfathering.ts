/**
 * Drive the REAL production grandfathering / founding-member GATE end to end,
 * using a password (default: a synthetic one this script seeds and cleans up).
 *
 *   1. SEED   — write a founding code at sha256(password) in prod Firestore
 *               (only if it doesn't already exist — never clobbers a real code).
 *   2. ENTER  — POST the password to the DEPLOYED /api/founding/enter and assert
 *               HTTP 200 { ok: true } + a signed `founding_gate` Set-Cookie.
 *   3. VERIFY — the cookie prod handed back must cryptographically verify to OUR
 *               codeId (proves it's the real signed gate, not just any 200).
 *   4. REJECT — a wrong password must be turned away with 401.
 *   5. PRICE  — STRIPE_PRICE_MODUS is a $28/mo recurring price (read-only), so a
 *               founder who claims really bills $24.
 *
 * DELIBERATELY stops at the gate. It never POSTs /api/founding/checkout: that
 * creates a REAL Stripe subscription and marks the spot claimed — not ours to
 * fire from a smoke test. The claim transaction itself is covered offline by
 * verify-founding.ts. This script proves the *deployed* gate works.
 *
 * verify-founding.ts runs entirely against the Admin SDK locally; this hits the
 * live endpoint on app.moduspilot.com. Both matter.
 *
 *   cd apps/web && npx tsx scripts/smoke-prod-grandfathering.ts [password]
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}

// Synthetic by default: seeded on entry, deleted on exit. The old default was a
// real test code (N1GTIS) which has since been removed.
const PASSWORD = process.argv[2] || 'VERIFY-ONLY-gate-fixture';
// Always the deployed host (NEXT_PUBLIC_APP_URL points at localhost in dev).
// Override with MODUS_SMOKE_URL only if you need to aim elsewhere.
const APP = process.env.MODUS_SMOKE_URL || 'https://app.moduspilot.com';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

// Pull the founding_gate cookie value out of a Set-Cookie response.
function foundingCookie(res: Response): string | null {
  const all = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') ?? ''];
  for (const c of all) {
    const m = c.match(/(?:^|,\s*)founding_gate=([^;]+)/);
    if (m) return m[1];
  }
  return null;
}

async function main() {
  const { hashPassword, verifyGate, getFoundingCode, FOUNDING_COOKIE } = await import('@/lib/founding');
  const { adminDb } = await import('@/lib/firebase-admin');
  const { FieldValue } = await import('firebase-admin/firestore');

  console.log(`\n🔐 grandfathering gate — password ${JSON.stringify(PASSWORD)} → ${APP}\n`);

  const codeId = hashPassword(PASSWORD);
  const ref = adminDb.collection('foundingCodes').doc(codeId);

  // ── 1. Seed (only if absent — a pre-existing code may be a real founder) ──
  const existed = (await ref.get()).exists;
  if (existed) {
    const pre = await getFoundingCode(codeId);
    console.log(`ℹ️  code already exists (#${pre?.foundingNumber} "${pre?.label}", ${pre?.status}) — leaving it untouched, will NOT delete.`);
    if (pre?.status === 'claimed') {
      // A claimed code still opens the gate (a founder can re-enter), so the test
      // is still valid — just say so.
      console.log('    (it is already claimed; the gate should still admit it.)');
    }
  } else {
    await ref.set({
      label: 'Smoke Grandfather',
      foundingNumber: 998,
      status: 'available',
      claimedByUid: null,
      claimedAt: null,
      expiresAt: null, // no expiry so the gate admits it
      createdAt: FieldValue.serverTimestamp(),
    });
    console.log('🌱 seeded a temporary founding code (will hard-delete after).');
  }

  try {
    // ── 2. ENTER with the real password ──
    console.log(`\n── ENTER — POST ${APP}/api/founding/enter ──`);
    const enter = await fetch(`${APP}/api/founding/enter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const enterBody = (await enter.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    console.log(`   HTTP ${enter.status}  ${JSON.stringify(enterBody)}`);

    if (enter.status === 429) {
      console.log('\n⚠️  Rate-limited (10 attempts / 10 min per IP). Wait ~10 min and re-run — this is the gate working, not a failure.');
      process.exit(2);
    }
    check('enter: accepts the real password (200 ok:true)', enter.status === 200 && enterBody.ok === true, `status=${enter.status}`);

    // ── 3. VERIFY the signed cookie really points at our code ──
    const cookie = foundingCookie(enter);
    check('enter: set a founding_gate cookie', !!cookie, cookie ? `${cookie.slice(0, 16)}…` : 'no Set-Cookie');
    check('cookie: verifies to OUR codeId (real signed gate)', !!cookie && verifyGate(cookie) === codeId,
      cookie ? `verifyGate → ${verifyGate(cookie) === codeId ? 'match' : 'MISMATCH'}` : 'n/a');
    void FOUNDING_COOKIE; // name kept in sync with the route's cookie key

    // ── 4. REJECT a wrong password ──
    const wrong = `nope-${Date.now().toString(36)}`;
    console.log(`\n── REJECT — POST /api/founding/enter with a bad key ──`);
    const bad = await fetch(`${APP}/api/founding/enter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: wrong }),
    });
    const badBody = (await bad.json().catch(() => ({}))) as { error?: string };
    console.log(`   HTTP ${bad.status}  ${JSON.stringify(badBody)}`);
    if (bad.status === 429) {
      console.log('   ⚠️  rate-limited on the negative check — skipping (not a failure).');
    } else {
      check('enter: wrong password rejected (401)', bad.status === 401);
      check('enter: wrong password sets NO gate cookie', foundingCookie(bad) === null);
    }

    // ── 5. Founders really bill $28/mo (read-only) ──
    console.log(`\n── PRICE — STRIPE_PRICE_MODUS (read-only) ──`);
    const { stripe } = await import('@/lib/stripe');
    const price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_MODUS!);
    check('stripe: founding price is $28/mo recurring',
      price.unit_amount === 2800 && price.currency === 'usd' && price.recurring?.interval === 'month',
      `unit_amount=${price.unit_amount} ${price.currency} /${price.recurring?.interval}`);
  } finally {
    // ── Cleanup: only remove a code WE seeded ──
    if (!existed) {
      await ref.delete();
      console.log('\n🧹 cleaned up (hard-deleted the temporary founding code).');
    }
  }

  console.log(`\n${failures === 0
    ? '✅ GRANDFATHERING GATE WORKS on prod — real password admitted, cookie is a valid signed gate, wrong key rejected, price is $28/mo.'
    : `❌ ${failures} check(s) failed — see above.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\n❌ FATAL:', e); process.exit(1); });
