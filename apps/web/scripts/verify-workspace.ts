/**
 * Workspace rules against an in-memory store: paths, edit semantics, versions,
 * quotas, rename, restore. No Firestore, no network.
 *
 *   cd apps/web && npx tsx scripts/verify-workspace.ts
 */
import { Workspace, WorkspaceError, normalizePath, DEFAULT_LIMITS, type FileMeta, type VersionDoc, type WsStore } from '../lib/workspace';

let failures = 0;
const check = (l: string, c: boolean, d?: unknown) => { console.log(`${c ? '✅' : '❌'} ${l}`); if (!c) { failures++; if (d !== undefined) console.log('  ', JSON.stringify(d)); } };
async function code(p: Promise<unknown>): Promise<string> { try { await p; return 'ok'; } catch (e) { return e instanceof WorkspaceError ? e.code : `THREW ${String(e)}`; } }
function codeSync(f: () => unknown): string { try { f(); return 'ok'; } catch (e) { return e instanceof WorkspaceError ? e.code : 'THREW'; } }

function memStore(): WsStore & { acct: number; blobs: Map<string, Buffer> } {
  const files = new Map<string, FileMeta>();
  const versions = new Map<string, Map<number, VersionDoc>>();
  const blobs = new Map<string, Buffer>();
  const s = {
    acct: 0,
    blobs,
    async listFiles() { return [...files.values()]; },
    async getFile(id: string) { return files.get(id) ?? null; },
    async commit(meta: FileMeta, v: VersionDoc, expected: number) {
      if ((files.get(meta.id)?.version ?? 0) !== expected) throw new WorkspaceError('conflict', 'conflict');
      files.set(meta.id, meta);
      if (!versions.has(meta.id)) versions.set(meta.id, new Map());
      versions.get(meta.id)!.set(v.n, v);
    },
    async putMeta(meta: FileMeta) { files.set(meta.id, meta); },
    async deleteMeta(id: string) { files.delete(id); versions.delete(id); },
    async getVersion(id: string, n: number) { return versions.get(id)?.get(n) ?? null; },
    async listVersions(id: string) { return [...(versions.get(id)?.values() ?? [])]; },
    async deleteVersion(id: string, n: number) { const v = versions.get(id)?.get(n); if (v?.storagePath) blobs.delete(v.storagePath); versions.get(id)?.delete(n); },
    async putBlob(id: string, n: number, data: Buffer) { const sp = `b/${id}/${n}`; blobs.set(sp, data); return { url: `https://x/${sp}`, storagePath: sp }; },
    async getBlob(sp: string) { const b = blobs.get(sp); if (!b) throw new Error('missing'); return b; },
    async accountBytes() { return s.acct; },
    async addAccountBytes(d: number) { s.acct += d; },
  };
  return s;
}

async function main() {
  // Paths
  check('normalizes ./, slashes, backslashes', normalizePath('./notes\\\\plan.md/') === 'notes/plan.md', normalizePath('./notes\\\\plan.md/'));
  check('strips leading slash', normalizePath('/a/b.txt') === 'a/b.txt');
  for (const bad of ['..', 'a/../b', '', '   ', 'a/./b', 'x'.repeat(201), 'a/b/c/d/e/f/g/h/i.txt', 'a\u0000b', 5]) {
    check(`rejects ${JSON.stringify(bad).slice(0, 30)}`, codeSync(() => normalizePath(bad)) === 'bad_path');
  }

  const store = memStore();
  const ws = new Workspace(store, { ...DEFAULT_LIMITS, keepVersions: 3, maxFiles: 5, maxTextBytes: 1000, maxWorkspaceBytes: 3000, maxAccountBytes: 2500 });

  // Write / read / versions
  const m1 = await ws.write('notes/plan.md', '- a\n- b\n- c', 'model');
  check('write v1', m1.version === 1 && m1.kind === 'text' && m1.mime === 'text/markdown');
  check('account bytes tracked', store.acct === 11, store.acct);
  const r = await ws.read('notes/plan.md', { offset: 2, limit: 1 });
  check('line window read', r.content === '- b' && r.totalLines === 3, r);
  check('write to non-text ext refused', await code(ws.write('pic.png', 'x', 'model')) === 'not_text');
  check('too large refused', await code(ws.write('big.txt', 'x'.repeat(1001), 'model')) === 'too_large');
  check('missing read is not_found', await code(ws.read('nope.md')) === 'not_found');

  // Edit
  const e = await ws.edit('notes/plan.md', '- b', '- B', false, 'model');
  check('edit makes v2', e.meta.version === 2 && (await ws.read('notes/plan.md')).content === '- a\n- B\n- c');
  check('no match', await code(ws.edit('notes/plan.md', 'zzz', 'y', false, 'model')) === 'no_match');
  await ws.write('dup.txt', 'x x x', 'model');
  check('ambiguous without replace_all', await code(ws.edit('dup.txt', 'x', 'y', false, 'model')) === 'ambiguous');
  const ra = await ws.edit('dup.txt', 'x', 'y', true, 'model');
  check('replace_all replaces every match', ra.replaced === 3 && (await ws.read('dup.txt')).content === 'y y y');
  check('empty old_str refused', await code(ws.edit('dup.txt', '', 'q', false, 'model')) === 'bad_edit');
  check('$ in new_str is literal', (await ws.edit('dup.txt', 'y y y', "cost $& $1", false, 'user'), (await ws.read('dup.txt')).content === 'cost $& $1'));

  // Version pruning (keep 3)
  for (let i = 0; i < 4; i++) await ws.write('notes/plan.md', `v${i}`, 'user');
  const vs = await ws.versions('notes/plan.md');
  check('keeps last 3 versions', vs.length === 3 && vs[0].n === 6, vs.map(v => v.n));

  // Restore
  const restored = await ws.restore('notes/plan.md', 5, 'user');
  check('restore is a new version with old content', restored.version === 7 && (await ws.read('notes/plan.md')).content === 'v2');

  // Delete + undelete through restore
  await ws.delete('dup.txt');
  check('deleted file hidden from list', !(await ws.list()).some(f => f.path === 'dup.txt'));
  check('restore undeletes', (await ws.restore('dup.txt', 3, 'user')).deleted !== true && (await ws.list()).some(f => f.path === 'dup.txt'));

  // Binary + rename copies the blob
  const bin = await ws.writeBinary('outputs/a.png', Buffer.alloc(500, 1), 'image/png', 'tool');
  check('binary stored with url', bin.kind === 'binary' && !!bin.url);
  const uploadedMd = await ws.writeBinary('uploads/readme.md', Buffer.from('# hi'), 'text/markdown', 'upload');
  check('text upload becomes editable text', uploadedMd.kind === 'text' && (await ws.read('uploads/readme.md')).content === '# hi');
  check('freePath suffixes', await ws.freePath('outputs/a.png') === 'outputs/a (2).png', await ws.freePath('outputs/a.png'));
  const moved = await ws.rename('outputs/a.png', 'outputs/b.png', 'user');
  check('binary rename', moved.path === 'outputs/b.png' && !(await ws.list()).some(f => f.path === 'outputs/a.png'));
  check('rename frees the old copy (one blob, not two)', store.blobs.size === 1, String(store.blobs.size));
  {
    // Fresh workspace: the main one above runs at its 5-file cap, and the
    // quota checks below depend on its exact contents.
    const st2 = memStore();
    const ws = new Workspace(st2, { ...DEFAULT_LIMITS });
    // Panel delete = purge: bytes really come back.
    await ws.writeBinary('outputs/b.png', Buffer.alloc(500, 1), 'image/png', 'tool');
    const before = st2.acct;
    await ws.purge('outputs/b.png');
    check('purge frees the bytes', st2.acct === before - 500, `${before} -> ${st2.acct}`);
    check('purge removes the record and blob', !(await ws.list()).some(f => f.path === 'outputs/b.png') && st2.blobs.size === 0);
    // Editor save against a stale version is refused.
    const t1 = await ws.write('notes/c.md', 'one', 'user');
    await ws.write('notes/c.md', 'model edit', 'model');
    let conflict = false;
    try { await ws.write('notes/c.md', 'stale save', 'user', t1.version); } catch (e) { conflict = (e as { code?: string }).code === 'conflict'; }
    check('stale editor save is a conflict', conflict);
    // Rename a text file to a binary extension is refused.
    let refused = false;
    try { await ws.rename('notes/c.md', 'notes/c.png', 'user'); } catch (e) { refused = (e as { code?: string }).code === 'not_text'; }
    check('text renamed to .png refused', refused);
    // Restore follows the version's kind, not the path's current kind.
    await ws.writeBinary('mix/p.png', Buffer.alloc(300, 2), 'image/png', 'tool');
    await ws.delete('mix/p.png');
    await ws.write('mix/p.md', 'text', 'user');
    const r = await ws.restore('mix/p.png', 1, 'user');
    check('restore of a binary version stays binary', r.kind === 'binary' && r.size === 300, `${r.kind} ${r.size}`);
  }

  // Quotas
  check('5th file allowed', await code(ws.write('f5.txt', 'x', 'model')) === 'ok');
  check('file count quota', await code(ws.write('f6.txt', 'x', 'model')) === 'quota_files', (await ws.list()).length);
  check('overwrite allowed at the file cap', await code(ws.write('f5.txt', 'xy', 'model')) === 'ok');
  await ws.delete('uploads/readme.md');
  check('account quota', await code(ws.writeBinary('outputs/huge.bin', Buffer.alloc(2100), 'application/octet-stream', 'tool')) === 'quota_account', store.acct);
  check('workspace quota', await code(ws.writeBinary('outputs/huge.bin', Buffer.alloc(2900), 'application/octet-stream', 'tool')) === 'quota_workspace');
  check('account bytes never negative', store.acct >= 0, store.acct);

  // Accounting counts every stored version; pruning frees; binary restore copies.
  {
    const st = memStore();
    const w = new Workspace(st, { ...DEFAULT_LIMITS, keepVersions: 2, maxAccountBytes: 10_000 });
    await w.write('a.txt', 'x'.repeat(100), 'model');
    await w.write('a.txt', 'y'.repeat(100), 'model');
    check('two versions count twice', st.acct === 200, st.acct);
    await w.write('a.txt', 'z'.repeat(100), 'model');
    check('pruned version is freed', st.acct === 200, st.acct);
    await w.delete('a.txt');
    check('soft delete keeps bytes (history kept)', st.acct === 200, st.acct);
    await w.writeBinary('b.png', Buffer.alloc(300, 1), 'image/png', 'tool');
    await w.writeBinary('b.png', Buffer.alloc(300, 2), 'image/png', 'tool');
    const r = await w.restore('b.png', 1, 'user');
    check('binary restore is a new version', r.version === 3);
    const v2 = await w.version('b.png', 3);
    check('restored version owns its own object', !!v2.storagePath && st.blobs.has(v2.storagePath!) && v2.storagePath !== (await w.version('b.png', 2)).storagePath);
    await w.writeBinary('b.png', Buffer.alloc(300, 3), 'image/png', 'tool');
    check('pruning old versions leaves restored bytes intact', st.blobs.has(v2.storagePath!) && (await st.getBlob(v2.storagePath!))[0] === 1);
    check('history cannot exceed the account cap', await code(w.writeBinary('big.bin', Buffer.alloc(9_500), 'application/octet-stream', 'tool')) === 'quota_account', st.acct);
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} failed.`);
  process.exit(failures ? 1 : 0);
}
main();
