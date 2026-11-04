import { adminDb } from '../firebase-admin';

/**
 * Per-user hourly cap on widget tool calls. A widget is foreign code that can
 * call its server's tools on a timer; this stops a runaway one from burning a
 * connector account (and our function time). Kept off the user doc so it can
 * never collide with the server-managed billing fields.
 */
export async function rateLimitHourly(uid: string, max: number): Promise<boolean> {
  const hour = new Date().toISOString().slice(0, 13);
  // Top level so firestore.rules' default deny applies; users/{uid}/* is
  // client-writable, which would let a client reset its own count.
  const ref = adminDb.collection('widgetLimits').doc(uid);
  return adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const d = snap.data() as { hour?: string; count?: number } | undefined;
    const count = d?.hour === hour ? (d.count ?? 0) : 0;
    if (count >= max) return false;
    tx.set(ref, { hour, count: count + 1 });
    return true;
  });
}
