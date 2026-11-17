/**
 * Fires one CompleteRegistration through the live /api/meta/event route as the
 * TEST account, so the Conversions API token can be checked end to end.
 *
 * Only run this while META_CAPI_TEST_EVENT_CODE is set in production, so the
 * event lands in Events Manager > Test events and stays out of live data.
 *
 *   npx tsx scripts/verify-meta-capi.ts [base]
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { initializeApp, getApps, cert, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}

const TEST_UID = 'hLTVRUQlvycaHY6mFVlFu9FJ32b2'; // test account, never a customer
const BASE = process.argv[2] || 'https://app.moduspilot.com';

function app() {
  if (getApps().length) return getApp();
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

async function main() {
  const user = (await getFirestore(app()).collection('users').doc(TEST_UID).get()).data();
  if (user?.onboardingComplete !== true) throw new Error('test account has onboardingComplete !== true, route would skip');

  const custom = await getAuth(app()).createCustomToken(TEST_UID);
  const ex = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) },
  ).then(r => r.json()) as { idToken?: string };
  if (!ex.idToken) throw new Error('token exchange failed');

  const eventId = `verify-${randomUUID()}`;
  const res = await fetch(`${BASE}/api/meta/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ex.idToken}` },
    body: JSON.stringify({ event: 'CompleteRegistration', eventId }),
  });
  const body = await res.json().catch(() => ({}));
  console.log(`HTTP ${res.status}`, JSON.stringify(body), `eventId=${eventId}`);
  if (!res.ok || (body as { ok?: boolean }).ok !== true) {
    console.log('FAIL: Meta rejected the event or the token/pixel env is missing. Check Vercel logs for "meta capi".');
    process.exit(1);
  }
  console.log('PASS: Meta accepted the server event. Confirm it in Events Manager > Test events.');
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
