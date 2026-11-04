import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { purgeWorkspaces } from '@/lib/workspace-store';

/**
 * Permanently delete every conversation for the signed-in user — the "Delete
 * all chats" action in Settings → Account → Danger Zone.
 *
 * This is a HARD delete, unlike the per-row sidebar delete which only sets
 * `deleted: true` (recoverable from Trash). Wiping the whole `conversations`
 * collection also clears anything sitting in Trash, which is the intent.
 *
 * Uses the native Firestore `recursiveDelete` on the collection (reached via
 * `col.firestore`, since the `adminDb` wrapper's own recursiveDelete only takes
 * a document path). recursiveDelete removes each conversation doc AND any legacy
 * `messages` subcollection some old docs still carry — modern chats store
 * messages as an inline array, so a plain doc delete would usually suffice, but
 * this is safe for both shapes.
 *
 * No desktop reconciliation is needed: desktop sync never writes conversations.
 * Mobile subscribes to the same collection in real time, so its list clears
 * automatically.
 */
export async function DELETE(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { uid } = auth;

  try {
    const col = adminDb.collection('users').doc(uid).collection('conversations');
    // select() with no fields fetches ids only — just for the cleared count.
    const snap = await col.select().get();
    await col.firestore.recursiveDelete(col);
    // The chats' files go too (uploads, plugin outputs, documents). Project
    // workspaces stay: they belong to projects, which this does not delete.
    const { workspaces } = await purgeWorkspaces(uid, { keep: id => id.startsWith('project-') });
    console.log(`[conversations/clear] uid=${uid} cleared=${snap.size} workspaces=${workspaces}`);
    return Response.json({ ok: true, cleared: snap.size, workspaces });
  } catch (e) {
    console.error('[conversations/clear] failed', e);
    return Response.json({ error: 'clear_failed' }, { status: 500 });
  }
}
