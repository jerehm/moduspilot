import { adminAuth, adminDb, adminBucket } from '@/lib/firebase-admin';

/**
 * Permanently deletes the authenticated user's account: all Firestore data
 * (user doc + every subcollection) and the Firebase Auth user. Runs with the
 * Admin SDK because clients are blocked from deleting the user doc (which would
 * otherwise let them reset rate limits / trial by deleting and recreating it).
 */
export async function POST(req: Request) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(token)).uid;
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Deletes users/{uid} and all of its subcollections (goals, tasks, habits,
    // conversations, memories, etc.).
    await adminDb.recursiveDelete(`users/${uid}`);
    // Stored files live outside the user doc: workspace and generated-image
    // blobs in Storage, plus the top-level counters keyed by uid.
    const bucket = adminBucket();
    for (const prefix of [`workspaces/${uid}/`, `generated/${uid}/`]) {
      await bucket.deleteFiles({ prefix }).catch(e => console.error(`[account/delete] blob purge ${prefix} failed:`, String(e)));
    }
    await adminDb.collection('workspaceUsage').doc(uid).delete().catch(() => {});
    await adminDb.collection('widgetLimits').doc(uid).delete().catch(() => {});
    await adminAuth.deleteUser(uid);
    return Response.json({ ok: true });
  } catch (err) {
    console.error(`[account/delete] failed for uid ${uid}:`, err);
    return Response.json({ error: 'delete_failed' }, { status: 500 });
  }
}
