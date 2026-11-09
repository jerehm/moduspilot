import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { AUTH_CODE_COLLECTION, AUTH_CODE_TTL_MS, TOKEN_RE, codeId, newCode } from '@/lib/desktop-auth';

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
  await adminDb.collection(AUTH_CODE_COLLECTION).doc(codeId(code)).set({
    uid: auth.uid,
    createdAt: now,
    expiresAt: now + AUTH_CODE_TTL_MS,
  });
  return Response.json({ code }, { headers: { 'Cache-Control': 'no-store' } });
}
