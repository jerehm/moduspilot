/**
 * End-to-end: MODUS Desktop's browser sign-in, driven through the REAL app.
 *
 * Launches the unpackaged desktop app against the local web server in test mode
 * (own profile, no sync, no real browser: the app logs the browser URL instead)
 * and plays the browser's part with the TEST account. Covers the 2026-11-08 bug
 * (clicking Sign in several times left the app waiting forever) and the
 * scenarios around it.
 *
 *   (web dev server on :3100 first)  cd apps/web && npx tsx scripts/verify-desktop-signin-e2e.ts
 */
import { readFileSync, mkdtempSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { spawn, type ChildProcess } from 'child_process';
import { initializeApp, getApps, cert, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}

const WEB = 'http://localhost:3100';
const TEST_UID = 'hLTVRUQlvycaHY6mFVlFu9FJ32b2';
const DESKTOP = resolve(process.cwd(), '../desktop');
const PORT = 9341;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function admin() {
  if (getApps().length) return getApp();
  return initializeApp({ credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }) });
}

async function testIdToken(): Promise<string> {
  const custom = await getAuth(admin()).createCustomToken(TEST_UID);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  return ((await r.json()) as { idToken: string }).idToken;
}

// --- the app
let appProc: ChildProcess;
let out = '';
function launch(ttlMs?: number) {
  out = '';
  // The real Electron binary, not node_modules/.bin/electron: that is a node
  // wrapper, and killing it leaves the app running on the debug port, so the
  // next scenario silently attached to the OLD app.
  const bin = join(DESKTOP, 'node_modules/electron/dist', readFileSync(join(DESKTOP, 'node_modules/electron/path.txt'), 'utf8').trim());
  appProc = spawn(bin, ['.', `--remote-debugging-port=${PORT}`], {
    cwd: DESKTOP,
    env: {
      ...process.env,
      MODUS_DESKTOP_URL: `${WEB}/login`,
      MODUS_TEST_NO_SYNC: '1',
      MODUS_TEST_AUTH_NO_BROWSER: '1',
      MODUS_TEST_USER_DATA: mkdtempSync(join(tmpdir(), 'modus-e2e-')),
      ...(ttlMs ? { MODUS_TEST_AUTH_TTL_MS: String(ttlMs) } : {}),
    },
  });
  appProc.stdout?.on('data', (d) => { out += d; });
  appProc.stderr?.on('data', (d) => { out += d; });
}
async function stopApp() {
  try { ws?.close(); } catch { /* closed */ }
  appProc.kill('SIGKILL');
  // Wait until the debug port is really gone before the next launch.
  for (let i = 0; i < 40; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json`); } catch { return; }
    await sleep(250);
  }
  throw new Error('previous app still holds the debug port');
}
const states = () => [...out.matchAll(/\[auth\]\[test\] browser url \S+state=([A-Za-z0-9_-]{43})/g)].map((m) => m[1]);

// --- CDP
let ws: WebSocket; let seq = 0;
const waiters = new Map<number, (v: unknown) => void>();
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
      const page = list.find((t) => t.type === 'page' && t.url.startsWith(WEB));
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener('open', r, { once: true }));
        ws.addEventListener('message', (e) => {
          const j = JSON.parse(String(e.data));
          if (j.id && waiters.has(j.id)) { waiters.get(j.id)!(j.result); waiters.delete(j.id); }
        });
        return;
      }
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('app page never appeared');
}
async function js<T = unknown>(expression: string): Promise<T> {
  const id = ++seq;
  const p = new Promise((r) => waiters.set(id, r));
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  const res = (await p) as { result?: { value?: T } };
  return res?.result?.value as T;
}
const text = () => js<string>('document.body ? document.body.innerText : ""');
async function waitFor(fn: () => Promise<boolean>, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await fn()) return true; } catch { /* navigating */ } await sleep(300); }
  return false;
}
const click = (label: string) => js<boolean>(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()===${JSON.stringify(label)}); if(b){b.click();return true} return false })()`);
const signedInUid = () => js<string>(`(async()=>{ try { const t = await window.__modusGetToken__?.(); if(!t) return ''; return JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).user_id||'' } catch { return '' } })()`);
async function signOutApp() {
  await js(`new Promise(r=>{ const q=indexedDB.deleteDatabase('firebaseLocalStorageDb'); q.onsuccess=q.onerror=q.onblocked=()=>r(1) })`);
  await js(`location.href='${WEB}/login'`);
  await sleep(1500);
  await js('location.reload()');
  await waitFor(async () => (await text()).includes('Sign in with your browser'), 20000);
}
async function browserCompletes(state: string, idToken: string) {
  const r = await fetch(`${WEB}/api/desktop/auth-code`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ state }),
  });
  if (!r.ok) throw new Error(`auth-code ${r.status}`);
}

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
}

async function main() {
  const idToken = await testIdToken();
  if (process.env.E2E_ONLY_TIMEOUT) { await timeoutScenario(idToken); return finishRun(); }
  launch();
  await connect();
  check('login page offers browser sign-in', await waitFor(async () => (await text()).includes('Sign in with your browser'), 30000));

  // 1. THE BUG: click several times, then the browser finishes, and the link never arrives.
  await click('Sign in with your browser');
  await waitFor(async () => (await text()).includes('Open browser again'), 5000);
  await click('Open browser again'); await sleep(300);
  await click('Open browser again'); await sleep(300);
  const s1 = states();
  check('3 clicks reuse ONE sign-in', s1.length === 3 && new Set(s1).size === 1, `${s1.length} opens, ${new Set(s1).size} distinct`);
  await browserCompletes(s1[0], idToken); // no modusdesktop:// link at all
  check('app signs in by polling, without the link', await waitFor(async () => (await signedInUid()) === TEST_UID, 20000));

  // 2. Window reloads while waiting
  await signOutApp();
  await click('Sign in with your browser'); await sleep(500);
  await js('location.reload()'); await sleep(2500);
  check('waiting screen comes back after a reload', await waitFor(async () => (await text()).includes('Finish signing in in your browser'), 10000));
  const s2 = states().at(-1)!;
  check('a new sign-in after success gets a NEW state', s2 !== s1[0]);
  await browserCompletes(s2, idToken);
  check('reloaded window still signs in', await waitFor(async () => (await signedInUid()) === TEST_UID, 20000));

  // 3. Cancel, then the browser finishes anyway: must NOT sign in.
  await signOutApp();
  await click('Sign in with your browser'); await sleep(500);
  const s3 = states().at(-1)!;
  await click('Cancel');
  check('cancel returns to the button', await waitFor(async () => (await text()).includes('Sign in with your browser'), 5000));
  await browserCompletes(s3, idToken);
  await sleep(6000);
  check('cancelled sign-in is NOT completed', (await signedInUid()) === '' && !(await text()).includes('Finish signing in'));

  await stopApp();
  await timeoutScenario(idToken);
  finishRun();
}

async function timeoutScenario(idToken: string) {
  // 4. Timeout resets the screen with a message (TTL shortened to 6s)
  launch(6000);
  await connect();
  await waitFor(async () => (await text()).includes('Sign in with your browser'), 30000);
  await click('Sign in with your browser');
  check('timeout resets with a message', await waitFor(async () => (await text()).includes('Sign in timed out'), 15000));
  const s4 = states().at(-1)!;
  await browserCompletes(s4, idToken); await sleep(5000);
  check('a timed-out sign-in is NOT completed', !(await signedInUid()));
  await stopApp();
}

function finishRun() {
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); try { appProc?.kill('SIGKILL'); } catch {} console.log(out.split('\n').filter(l => l.includes('[auth]')).join('\n')); process.exit(1); });
