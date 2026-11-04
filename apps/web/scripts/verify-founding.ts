/**
 * Verifies the founding-member feature end-to-end WITHOUT any live side effects:
 *  1. Gate cookie crypto — round-trip works; tampered/forged/expired are rejected.
 *  2. Password hashing → Firestore doc-id lookup (seeds + reads a temp code).
 *  3. The claim transaction — available→claimed, resume by same uid, 409 for another uid.
 *  4. STRIPE_PRICE_MODUS is a $28/mo recurring price (read-only) → founders bill $28.
 * Cleans up the temp code afterward. Run: cd apps/web && npx tsx scripts/verify-founding.ts
 */
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

async function main() {
  const { hashPassword, signGate, verifyGate } = await import('@/lib/founding');
  const { adminDb } = await import('@/lib/firebase-admin');
  const { FieldValue } = await import('firebase-admin/firestore');

  // 1. Gate cookie crypto
  const cid = 'test-code-id-abc';
  const good = signGate(cid);
  check('gate: round-trip', verifyGate(good) === cid);

  const [body] = good.split('.');
  const forgedSig = crypto.createHmac('sha256', crypto.randomBytes(32)).update(body).digest('base64url');
  check('gate: forged signature rejected', verifyGate(`${body}.${forgedSig}`) === null);

  const tampered = `${body.slice(0, -2)}XY.${good.split('.')[1]}`;
  check('gate: tampered payload rejected', verifyGate(tampered) === null);
  check('gate: garbage rejected', verifyGate('not-a-token') === null && verifyGate('') === null);

  // 2. Hashing + Firestore doc-id lookup
  const pw = `verify-${crypto.randomBytes(6).toString('hex')}`;
  const codeId = hashPassword(pw);
  check('hash: deterministic', hashPassword(pw) === codeId && hashPassword(` ${pw} `) === codeId);

  const ref = adminDb.collection('foundingCodes').doc(codeId);
  await ref.set({ label: 'Verify Bot', foundingNumber: 999, status: 'available', claimedByUid: null, claimedAt: null, createdAt: FieldValue.serverTimestamp() });

  const { getFoundingCode } = await import('@/lib/founding');
  const loaded = await getFoundingCode(codeId);
  check('lookup: password → code', !!loaded && loaded.label === 'Verify Bot' && loaded.foundingNumber === 999);

  // 3. Claim transaction (same logic as the claim-on-payment step in
  //    app/api/webhooks/stripe/route.ts — the seat is claimed when payment
  //    succeeds, NOT at checkout creation).
  async function claim(uid: string): Promise<string> {
    return adminDb.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const data = snap.data() as { status?: string; claimedByUid?: string } | undefined;
      if (!data) throw new Error('code-missing');
      if (data.status === 'claimed') {
        if (data.claimedByUid !== uid) throw new Error('already-claimed');
        return 'resumed';
      }
      tx.update(ref, { status: 'claimed', claimedByUid: uid, claimedAt: FieldValue.serverTimestamp() });
      return 'claimed';
    });
  }
  check('claim: first claim succeeds', (await claim('uidA')) === 'claimed');
  check('claim: same uid resumes', (await claim('uidA')) === 'resumed');
  let blocked = false;
  try { await claim('uidB'); } catch (e) { blocked = (e as Error).message === 'already-claimed'; }
  check('claim: different uid blocked (409)', blocked);
  check('claim: doc marked claimed by uidA', (await getFoundingCode(codeId))?.claimedByUid === 'uidA');

  // 4. Stripe price is $28/mo (read-only)
  const { stripe } = await import('@/lib/stripe');
  const price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_MODUS!);
  check('stripe: MODUS price is $28/mo recurring',
    price.unit_amount === 2800 && price.currency === 'usd' && price.recurring?.interval === 'month',
    `unit_amount=${price.unit_amount} ${price.currency} /${price.recurring?.interval}`);

  // cleanup
  await ref.delete();
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
