/**
 * Captures REAL compare answers (GPT, Claude, Gemini) from the live
 * /api/chat/compare route as the PILOT test account, for ad creative.
 * Prints each answer with its wall time. Nothing here is edited.
 *
 *   npx tsx scripts/ad-compare-capture.ts "prompt one" "prompt two"
 */
import { readFileSync, writeFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}
initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') }) });
const BASE = process.env.BASE ?? 'https://app.moduspilot.com';
const MODELS = ['gpt-6.1-sol', 'claude-sonnet-5-5', 'gemini-3.8-flash'];

const user = await getAuth().getUserByEmail('moduspilotaitester@gmail.com'); // test account, never a customer
const custom = await getAuth().createCustomToken(user.uid);
const { idToken } = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) })).json() as { idToken: string };

const out: any[] = [];
for (const prompt of process.argv.slice(2)) {
  const answers = await Promise.all(MODELS.map(async model => {
    const t0 = Date.now();
    const r = await fetch(`${BASE}/api/chat/compare`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ prompt, model }) });
    const text = await r.text();
    return { model, status: r.status, secs: ((Date.now() - t0) / 1000).toFixed(1), text: text.trim() };
  }));
  out.push({ prompt, answers });
  console.log(`\n### ${prompt}`);
  for (const a of answers) console.log(`- ${a.model} [${a.status}, ${a.secs}s]: ${a.text}`);
}
writeFileSync(process.env.OUT ?? '/dev/null', JSON.stringify(out, null, 2));
