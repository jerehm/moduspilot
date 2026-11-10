import { adminDb } from '@/lib/firebase-admin';
import { AUTH_STATE_COLLECTION, TOKEN_RE, clientIpHash, stateId } from '@/lib/desktop-auth';

/**
 * MODUS Desktop's main process polls this every 2s while a browser sign-in is
 * in progress. Once the browser has issued a code for this state, it is handed
 * over exactly once (read and deleted in one transaction), and only to a poller
 * on the same network as the browser that approved it (clientIpHash). A link
 * sent to a victim can't be redeemed from elsewhere. See lib/desktop-auth.ts.
 */
export async function POST(req: Request) {
  let state = '';
  try { state = String((await req.json())?.state ?? ''); } catch { /* bad body */ }
  if (!TOKEN_RE.test(state)) return Response.json({ error: 'Invalid request' }, { status: 400 });

  const ref = adminDb.collection(AUTH_STATE_COLLECTION).doc(stateId(state));
  const ipHash = clientIpHash(req);
  const code = await adminDb.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) return null;
    const d = snap.data() as { code?: string; expiresAt?: number; ipHash?: string };
    if (!d.code || !d.expiresAt || d.expiresAt < Date.now()) { txn.delete(ref); return null; }
    // Wrong network: leave the mailbox alone and look exactly like "not yet".
    // The real app, if this is a VPN mismatch, still finishes via the link.
    if (!d.ipHash || d.ipHash !== ipHash) return null;
    txn.delete(ref);
    return d.code;
  });
  const headers = { 'Cache-Control': 'no-store' };
  return code ? Response.json({ code }, { headers }) : Response.json({ pending: true }, { headers });
}
