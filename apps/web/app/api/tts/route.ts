import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { isPaidPlan, isPilotLevelPlan } from '@/lib/plan';

// 💸 THE CAP COUNTS CHARACTERS, NOT CALLS, BECAUSE THAT IS WHAT OPENAI BILLS.
//
// It used to count calls: 30/day free, 300 MODUS, 2000 PILOT, against a 4,000-char
// ceiling per call. Multiply those out at tts-1's $15/1M and the caps authorised
// $54, $547 and $3,650 a month against $0, $24 and $59 of revenue. A cap counted in
// TRIGGERS says nothing about spend when a trigger's cost varies 100x with length —
// the same mistake watch mode made with "12 looks an hour".
//
// Free is a LIFETIME budget, deliberately. The free chat allowance is 10 messages
// for life; a voice allowance that reset every midnight meant an account which
// spent its last message a year ago still had a daily line item, forever.
//
// Every number below is derived in lib/constants.ts and asserted against the
// subscription by scripts/verify-surface-costs.ts.
import {
  TTS_MAX_CHARS, FREE_TTS_CHARS_LIFETIME,
  MODUS_TTS_CHARS_PER_DAY, PILOT_TTS_CHARS_PER_DAY,
} from '@/lib/constants';

const ALLOWED_VOICES = new Set(['alloy', 'echo', 'fable', 'nova', 'onyx', 'shimmer']);
const DEFAULT_VOICE = 'onyx';

export async function POST(req: Request) {
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult;
  const { uid } = authResult;

  const today = new Date().toISOString().slice(0, 10);
  const userRef = adminDb.collection('users').doc(uid);
  const snap = await userRef.get();
  const d = snap.data() ?? {};

  // Prefer user's BYOK OpenAI key (same account their money is on), fall back to server key.
  const openaiKey = (d.settings?.modelSettings?.openaiKey as string | undefined)?.trim()
    || process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return Response.json({ error: 'No OpenAI key available. Add one in Settings → AI Model.' }, { status: 503 });
  }

  const plan = d.plan as string | undefined;
  const paid = isPaidPlan(plan);

  const body = await req.json() as { text?: string; voice?: string };
  const text = (body.text ?? '').trim().slice(0, TTS_MAX_CHARS);
  if (!text) return Response.json({ error: 'No text provided' }, { status: 400 });

  const voice = ALLOWED_VOICES.has(body.voice ?? '') ? body.voice! : DEFAULT_VOICE;

  // 🔒 SPEND FIRST, THEN SYNTHESISE. The budget check and the increment have to be
  // one atomic step, or N concurrent requests all read the same total and all pass —
  // the identical race verify-free-tier caught on the message counter, where a
  // transaction protected the write but a flag outside the callback did not.
  const spend = text.length;
  const budget = paid
    ? (isPilotLevelPlan(plan) ? PILOT_TTS_CHARS_PER_DAY : MODUS_TTS_CHARS_PER_DAY)
    : FREE_TTS_CHARS_LIFETIME;

  try {
    await adminDb.runTransaction(async (txn) => {
      const doc = await txn.get(userRef);
      const cur = doc.data() ?? {};
      // Paid budgets reset daily; free is a lifetime pot and never resets.
      const used = paid
        ? (cur.ttsCharsDate === today ? (cur.ttsCharsToday ?? 0) : 0)
        : (cur.ttsCharsLifetime ?? 0);
      if (used + spend > budget) throw new Error('tts_limit_reached');
      txn.set(userRef, paid
        ? { ttsCharsDate: today, ttsCharsToday: used + spend }
        : { ttsCharsLifetime: used + spend },
      { merge: true });
    });
  } catch (e) {
    if ((e as Error).message === 'tts_limit_reached') {
      // Distinct message for free: theirs does not come back tomorrow, and telling
      // someone to "try again tomorrow" when they never can is worse than a wall.
      return Response.json({
        error: paid ? 'Daily voice limit reached' : 'That is all the free voice on this account.',
        code: paid ? 'tts_daily_limit' : 'tts_free_exhausted',
      }, { status: 429 });
    }
    // A Firestore failure must not become free speech: fail CLOSED, same as the
    // chat gate. Voice is a paid API call and silence is the safe direction.
    console.error('[tts] budget transaction failed', e);
    return Response.json({ error: 'Voice is unavailable right now.' }, { status: 503 });
  }

  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'tts-1', input: text, voice }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('[tts] OpenAI error', res.status, detail);
    // The raw provider body went to the client, and mobile shows `error` in an
    // alert: users saw "OpenAI 401: {json}". The detail stays in the log above.
    return Response.json({ error: 'Voice is unavailable right now. Try again in a moment.' }, { status: 502 });
  }

  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  return Response.json({ audio: base64 });
}
