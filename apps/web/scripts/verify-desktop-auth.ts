/**
 * Verify the MODUS Desktop browser sign-in handoff (lib/desktop-auth.ts):
 * /api/desktop/auth-code + /api/desktop/auth-exchange.
 *
 * Uses the TEST account only (never a customer uid).
 *
 *   cd apps/web && npx tsx scripts/verify-desktop-auth.ts [baseUrl]
 *   default base http://localhost:3100, or https://moduspilot.com after deploy
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash, randomBytes } from 'crypto';
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

const BASE = process.argv[2] || 'http://localhost:3100';
const TEST_UID = 'hLTVRUQlvycaHY6mFVlFu9FJ32b2';
const KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

function app() {
  if (getApps().length) return getApp();
  return initializeApp({ credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }) });
}

async function signInCustom(token: string): Promise<{ idToken?: string; localId?: string }> {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, returnSecureToken: true }),
  });
  return r.json() as Promise<{ idToken?: string; localId?: string }>;
}

const post = (path: string, body: unknown, idToken?: string) => fetch(`${BASE}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
  body: JSON.stringify(body),
});

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
}

async function main() {
  console.log(`base ${BASE}, test uid ${TEST_UID}\n`);
  const { idToken } = await signInCustom(await getAuth(app()).createCustomToken(TEST_UID));
  if (!idToken) throw new Error('could not get a test ID token');
  const state = randomBytes(32).toString('base64url');

  let r = await post('/api/desktop/auth-code', { state });
  check('auth-code without sign-in is refused', r.status === 401, String(r.status));

  r = await post('/api/desktop/auth-code', { state: 'short' }, idToken);
  check('auth-code with a malformed state is refused', r.status === 400, String(r.status));

  r = await post('/api/desktop/auth-code', { state }, idToken);
  const { code } = await r.json() as { code?: string };
  check('auth-code issues a code', r.ok && /^[A-Za-z0-9_-]{43}$/.test(code ?? ''), String(r.status));

  r = await post('/api/desktop/auth-exchange', { code });
  const { token } = await r.json() as { token?: string };
  check('exchange returns a token', r.ok && !!token, String(r.status));
  const who = await signInCustom(token!);
  const signedInUid = who.idToken ? (await getAuth(app()).verifyIdToken(who.idToken)).uid : '';
  check('token signs in as the SAME account', signedInUid === TEST_UID, signedInUid);

  r = await post('/api/desktop/auth-exchange', { code });
  check('a code works only once', r.status === 400, String(r.status));

  r = await post('/api/desktop/auth-exchange', { code: randomBytes(32).toString('base64url') });
  check('an unknown code is refused', r.status === 400, String(r.status));

  r = await post('/api/desktop/auth-exchange', { code: 'x' });
  check('a malformed code is refused', r.status === 400, String(r.status));

  // Expired: plant a code that ran out a minute ago.
  const stale = randomBytes(32).toString('base64url');
  const ref = getFirestore(app()).collection('desktopAuthCodes').doc(createHash('sha256').update(stale).digest('hex'));
  await ref.set({ uid: TEST_UID, createdAt: Date.now() - 180_000, expiresAt: Date.now() - 60_000 });
  r = await post('/api/desktop/auth-exchange', { code: stale });
  check('an expired code is refused', r.status === 400, String(r.status));
  check('an expired code is deleted', !(await ref.get()).exists);

  // --- App polling (the path that works even if the browser never opens the link)
  const st = randomBytes(32).toString('base64url');
  r = await post('/api/desktop/auth-poll', { state: st });
  check('poll before the browser finished says pending', r.ok && (await r.json() as { pending?: boolean }).pending === true, String(r.status));
  r = await post('/api/desktop/auth-code', { state: st }, idToken);
  const first = (await r.json() as { code: string }).code;
  r = await post('/api/desktop/auth-code', { state: st }, idToken); // a second tab, same state
  const second = (await r.json() as { code: string }).code;
  r = await post('/api/desktop/auth-poll', { state: st });
  const polled = (await r.json() as { code?: string }).code;
  check('poll hands over the LATEST code for the state', polled === second && polled !== first);
  r = await post('/api/desktop/auth-poll', { state: st });
  check('poll hands a code over only once', (await r.json() as { pending?: boolean }).pending === true);
  r = await post('/api/desktop/auth-exchange', { code: polled });
  check('the polled code signs in', r.ok && !!(await r.json() as { token?: string }).token, String(r.status));
  r = await post('/api/desktop/auth-poll', { state: randomBytes(32).toString('base64url') });
  check('a different state gets nothing', (await r.json() as { pending?: boolean }).pending === true);
  r = await post('/api/desktop/auth-poll', { state: 'nope' });
  check('a malformed state is refused', r.status === 400, String(r.status));
  const staleState = randomBytes(32).toString('base64url');
  const sref = getFirestore(app()).collection('desktopAuthStates').doc(createHash('sha256').update(`state:${staleState}`).digest('hex'));
  await sref.set({ code: stale, createdAt: Date.now() - 180_000, expiresAt: Date.now() - 60_000 });
  r = await post('/api/desktop/auth-poll', { state: staleState });
  check('an expired mailbox gives nothing', (await r.json() as { pending?: boolean }).pending === true);
  check('an expired mailbox is deleted', !(await sref.get()).exists);

  // --- Phishing: an attacker starts a sign-in, sends the victim the link, and
  // polls from THEIR network. The victim's browser approves; the attacker must
  // get nothing, and the victim's own app (same network) still gets the code.
  const ph = randomBytes(32).toString('base64url');
  const fromVictim = { 'x-forwarded-for': '203.0.113.10' };
  const fromAttacker = { 'x-forwarded-for': '198.51.100.66' };
  const postAs = (path: string, body: unknown, h: Record<string, string>, tok?: string) => fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...h, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: JSON.stringify(body),
  });
  r = await postAs('/api/desktop/auth-code', { state: ph }, fromVictim, idToken);
  const victimCode = (await r.json() as { code: string }).code;
  r = await postAs('/api/desktop/auth-poll', { state: ph }, fromAttacker);
  const atk = await r.json() as { code?: string; pending?: boolean };
  check('a poller on ANOTHER network gets no code (phishing blocked)', !atk.code && atk.pending === true);
  r = await postAs('/api/desktop/auth-poll', { state: ph }, fromVictim);
  const mine = (await r.json() as { code?: string }).code;
  check('the same-network app still gets the code after the attacker tried', mine === victimCode);

  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
