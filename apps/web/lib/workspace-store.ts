import { randomUUID } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminBucket, adminDb } from './firebase-admin';
import { Workspace, WorkspaceError, type FileMeta, type VersionDoc, type WsStore } from './workspace';

/**
 * Firestore + Storage backing for lib/workspace.ts.
 *
 *   users/{uid}/workspaces/{ws}                       { updatedAt }
 *   users/{uid}/workspaces/{ws}/files/{id}            FileMeta
 *   users/{uid}/workspaces/{ws}/files/{id}/versions/{n}   VersionDoc
 *   workspaceUsage/{uid}                              { bytes }   (top level: client can't reset it)
 *   Storage workspaces/{uid}/{ws}/{id}/{n}            binary versions
 *
 * Everything below users/{uid}/workspaces is 2+ levels deep, so firestore.rules'
 * one-level wildcard does not reach it and the default deny applies.
 */
export function firestoreWsStore(uid: string, ws: string): WsStore {
  const wsRef = adminDb.collection('users').doc(uid).collection('workspaces').doc(ws);
  const files = wsRef.collection('files');
  const usage = adminDb.collection('workspaceUsage').doc(uid);
  const touch = () => wsRef.set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  return {
    async listFiles() {
      const snap = await files.get();
      return snap.docs.map(d => d.data() as FileMeta);
    },
    async getFile(id) {
      const s = await files.doc(id).get();
      return s.exists ? (s.data() as FileMeta) : null;
    },
    async commit(meta, version, expected) {
      await adminDb.runTransaction(async tx => {
        const cur = await tx.get(files.doc(meta.id));
        const have = cur.exists ? ((cur.data() as FileMeta).version ?? 0) : 0;
        if (have !== expected) throw new WorkspaceError('conflict', `${meta.path} changed while saving. Read it again and retry.`);
        tx.set(files.doc(meta.id), stripUndefined(meta));
        tx.set(files.doc(meta.id).collection('versions').doc(String(version.n)), stripUndefined(version));
      });
      await touch();
    },
    async putMeta(meta) {
      await files.doc(meta.id).set(stripUndefined(meta));
      await touch();
    },
    async getVersion(id, n) {
      const s = await files.doc(id).collection('versions').doc(String(n)).get();
      return s.exists ? (s.data() as VersionDoc) : null;
    },
    async listVersions(id) {
      const snap = await files.doc(id).collection('versions').select('n', 'size', 'source', 'at', 'url', 'storagePath').get();
      return snap.docs.map(d => d.data() as Omit<VersionDoc, 'content'>);
    },
    async deleteVersion(id, n) {
      const ref = files.doc(id).collection('versions').doc(String(n));
      const s = await ref.get();
      const sp = (s.data() as VersionDoc | undefined)?.storagePath;
      // Each version owns its object (rename copies), so this is safe to drop.
      if (sp) await adminBucket().file(sp).delete().catch(() => {});
      await ref.delete();
    },
    async putBlob(id, n, data, mime) {
      const storagePath = `workspaces/${uid}/${ws}/${id}/${n}`;
      const token = randomUUID();
      const bucket = adminBucket();
      await bucket.file(storagePath).save(data, {
        resumable: false,
        contentType: mime,
        metadata: { contentType: mime, metadata: { firebaseStorageDownloadTokens: token } },
      });
      return { storagePath, url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}` };
    },
    async getBlob(storagePath) {
      if (!storagePath.startsWith(`workspaces/${uid}/`)) throw new WorkspaceError('not_found', 'Stored file is missing.');
      const [buf] = await adminBucket().file(storagePath).download();
      return buf;
    },
    async accountBytes() {
      const s = await usage.get();
      return (s.data()?.bytes as number | undefined) ?? 0;
    },
    async addAccountBytes(delta) {
      if (!delta) return;
      await usage.set({ bytes: FieldValue.increment(delta) }, { merge: true });
    },
  };
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export function openWorkspace(uid: string, ws: string): Workspace {
  return new Workspace(firestoreWsStore(uid, ws));
}

/** Removes every workspace file, version and blob for a user (account / history wipe). */
export async function purgeWorkspaces(uid: string): Promise<{ workspaces: number }> {
  const wsCol = adminDb.collection('users').doc(uid).collection('workspaces');
  const list = await wsCol.listDocuments();
  for (const ref of list) await adminDb.recursiveDelete(ref.path);
  await adminBucket().deleteFiles({ prefix: `workspaces/${uid}/` }).catch(e => console.error('[workspace] blob purge failed:', String(e)));
  await adminDb.collection('workspaceUsage').doc(uid).delete().catch(() => {});
  return { workspaces: list.length };
}
