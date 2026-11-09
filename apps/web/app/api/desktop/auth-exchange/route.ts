import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { AUTH_CODE_COLLECTION, TOKEN_RE, codeId } from '@/lib/desktop-auth';

/**
 * Called by /desktop/complete INSIDE MODUS Desktop. Trades a one-time code for
 * a Firebase custom token. The code is deleted in the same transaction that
 * reads it, so it works exactly once, and it expires after 2 minutes.
 * Every failure is the same 400 so a guesser learns nothing.
 */
const FAIL = () => Response.json({ error: 'This sign in link expired. Try again from MODUS Desktop.' }, { status: 400 });

export async function POST(req: Request) {
  let code = '';
  try { code = String((await req.json())?.code ?? ''); } catch { /* bad body */ }
  if (!TOKEN_RE.test(code)) return FAIL();

  const ref = adminDb.collection(AUTH_CODE_COLLECTION).doc(codeId(code));
  let uid: string | null = null;
  try {
    uid = await adminDb.runTransaction(async (txn) => {
      const snap = await txn.get(ref);
      if (!snap.exists) return null;
      txn.delete(ref);
      const d = snap.data() as { uid?: string; expiresAt?: number };
      if (!d.uid || !d.expiresAt || d.expiresAt < Date.now()) return null;
      return d.uid;
    });
  } catch (e) {
    console.error('[desktop/auth-exchange] transaction failed', e);
    return FAIL();
  }
  if (!uid) return FAIL();

  try {
    const token = await adminAuth.createCustomToken(uid);
    return Response.json({ token }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[desktop/auth-exchange] custom token mint failed', e);
    return Response.json({ error: 'Sign in failed. Please try again.' }, { status: 500 });
  }
}
