import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { AUTH_CODE_COLLECTION, AUTH_CODE_TTL_MS, AUTH_STATE_COLLECTION, TOKEN_RE, codeId, newCode, stateId } from '@/lib/desktop-auth';

/**
 * Called by /desktop/signin in the user's BROWSER, already signed in there.
 * Issues a one-time code the desktop app can trade for a session. See
 * lib/desktop-auth.ts for the whole flow.
 */
export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  let state = '';
  try { state = String((await req.json())?.state ?? ''); } catch { /* bad body */ }
  if (!TOKEN_RE.test(state)) return Response.json({ error: 'Invalid request' }, { status: 400 });

  const code = newCode();
  const now = Date.now();
  const expiresAt = now + AUTH_CODE_TTL_MS;
  const batch = adminDb.batch();
  batch.set(adminDb.collection(AUTH_CODE_COLLECTION).doc(codeId(code)), { uid: auth.uid, createdAt: now, expiresAt });
  // The app's mailbox: it polls with its state and gets this code even if the
  // browser never opens the modusdesktop:// link. A newer tab overwrites it.
  batch.set(adminDb.collection(AUTH_STATE_COLLECTION).doc(stateId(state)), { code, createdAt: now, expiresAt });
  await batch.commit();
  return Response.json({ code }, { headers: { 'Cache-Control': 'no-store' } });
}
