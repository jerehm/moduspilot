import { createHash } from 'crypto';

/**
 * Chat and project workspaces: the files beside a conversation.
 *
 * One class, two callers: the model's file tools (lib/chat/workspace-tools.ts)
 * and the Files panel API (app/api/workspace). Both must enforce the same path,
 * size and quota rules, so neither talks to storage directly.
 *
 * Storage sits behind WsStore so the rules can be verified without Firestore
 * (scripts/verify-workspace.ts). The real store is lib/workspace-store.ts.
 */

export type FileSource = 'model' | 'user' | 'upload' | 'tool';
export type FileKind = 'text' | 'binary';

export interface FileMeta {
  id: string;
  path: string;
  mime: string;
  kind: FileKind;
  size: number;
  version: number;
  source: FileSource;
  deleted?: boolean;
  /** Binary only: download URL of the current version. */
  url?: string;
  updatedAt: number;
}

export interface VersionDoc {
  n: number;
  size: number;
  source: FileSource;
  at: number;
  /** Text versions. */
  content?: string;
  /** Binary versions. */
  url?: string;
  storagePath?: string;
}

export interface WsStore {
  listFiles(): Promise<FileMeta[]>;
  getFile(id: string): Promise<FileMeta | null>;
  /** Writes meta + version together. Fails if the stored version != expected. */
  commit(meta: FileMeta, version: VersionDoc, expectedVersion: number): Promise<void>;
  putMeta(meta: FileMeta): Promise<void>;
  getVersion(id: string, n: number): Promise<VersionDoc | null>;
  listVersions(id: string): Promise<Omit<VersionDoc, 'content'>[]>;
  deleteVersion(id: string, n: number): Promise<void>;
  putBlob(id: string, n: number, data: Buffer, mime: string): Promise<{ url: string; storagePath: string }>;
  getBlob(storagePath: string): Promise<Buffer>;
  /** Bytes stored across the whole account. */
  accountBytes(): Promise<number>;
  addAccountBytes(delta: number): Promise<void>;
}

export interface WsLimits {
  maxFiles: number;
  maxWorkspaceBytes: number;
  maxAccountBytes: number;
  maxTextBytes: number;
  maxBinaryBytes: number;
  keepVersions: number;
}

export const DEFAULT_LIMITS: WsLimits = {
  maxFiles: 200,
  maxWorkspaceBytes: 200 * 1024 * 1024,
  maxAccountBytes: 2 * 1024 * 1024 * 1024,
  maxTextBytes: 256 * 1024,
  maxBinaryBytes: 25 * 1024 * 1024,
  keepVersions: 30,
};

export class WorkspaceError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const WS_ID = /^[\w-]{1,80}$/;
export function isWorkspaceId(id: unknown): id is string {
  return typeof id === 'string' && WS_ID.test(id);
}

/**
 * Normalizes a user or model supplied path, or throws. Relative only, no dot
 * segments, no control characters, bounded depth and length. Backslashes are
 * folded to slashes so a Windows-style path means the same file.
 */
export function normalizePath(raw: unknown): string {
  if (typeof raw !== 'string') throw new WorkspaceError('bad_path', 'Path must be a string.');
  let p = raw.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (p.startsWith('./')) p = p.slice(2);
  p = p.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!p) throw new WorkspaceError('bad_path', 'Path is empty.');
  if (p.length > 200) throw new WorkspaceError('bad_path', 'Path is longer than 200 characters.');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(p)) throw new WorkspaceError('bad_path', 'Path contains control characters.');
  const parts = p.split('/');
  if (parts.length > 8) throw new WorkspaceError('bad_path', 'Path is nested deeper than 8 folders.');
  for (const s of parts) {
    if (s === '.' || s === '..') throw new WorkspaceError('bad_path', 'Path may not contain . or .. segments.');
    if (s.length > 120) throw new WorkspaceError('bad_path', 'A path segment is longer than 120 characters.');
  }
  return p;
}

export function fileIdFor(path: string): string {
  return createHash('sha1').update(path).digest('hex');
}

const MIME: Record<string, string> = {
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', csv: 'text/csv', tsv: 'text/tab-separated-values',
  json: 'application/json', html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  ts: 'text/typescript', tsx: 'text/typescript', jsx: 'text/javascript', py: 'text/x-python', rb: 'text/x-ruby', go: 'text/x-go',
  rs: 'text/x-rust', java: 'text/x-java', c: 'text/x-c', h: 'text/x-c', cpp: 'text/x-c++', sh: 'text/x-shellscript',
  yml: 'text/yaml', yaml: 'text/yaml', xml: 'application/xml', svg: 'image/svg+xml', sql: 'text/x-sql', toml: 'text/plain', log: 'text/plain',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip',
};

export function mimeFor(path: string, fallback = 'application/octet-stream'): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? fallback;
}

export function isTextMime(mime: string): boolean {
  return mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml' || mime === 'image/svg+xml';
}

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

export class Workspace {
  constructor(private store: WsStore, private limits: WsLimits = DEFAULT_LIMITS, private now: () => number = Date.now) {}

  async list(): Promise<FileMeta[]> {
    return (await this.store.listFiles()).filter(f => !f.deleted).sort((a, b) => a.path.localeCompare(b.path));
  }

  private async live(path: string): Promise<FileMeta> {
    const f = await this.store.getFile(fileIdFor(path));
    if (!f || f.deleted) throw new WorkspaceError('not_found', `No file at ${path}.`);
    return f;
  }

  /** Text read with optional 1-based line window. */
  async read(rawPath: string, opts: { offset?: number; limit?: number } = {}): Promise<{ meta: FileMeta; content?: string; totalLines?: number }> {
    const path = normalizePath(rawPath);
    const meta = await this.live(path);
    if (meta.kind !== 'text') return { meta };
    const v = await this.store.getVersion(meta.id, meta.version);
    const content = v?.content ?? '';
    const lines = content.split('\n');
    if (!opts.offset && !opts.limit) return { meta, content, totalLines: lines.length };
    const start = Math.max(1, Math.floor(opts.offset ?? 1));
    const count = Math.max(1, Math.floor(opts.limit ?? lines.length));
    return { meta, content: lines.slice(start - 1, start - 1 + count).join('\n'), totalLines: lines.length };
  }

  private async checkQuota(path: string, newSize: number, prevSize: number, isNew: boolean) {
    const files = await this.list();
    if (isNew && files.length >= this.limits.maxFiles) {
      throw new WorkspaceError('quota_files', `This workspace already has ${this.limits.maxFiles} files.`);
    }
    const wsBytes = files.reduce((n, f) => n + (f.path === path ? 0 : f.size), 0) + newSize;
    if (wsBytes > this.limits.maxWorkspaceBytes) throw new WorkspaceError('quota_workspace', 'This workspace is full.');
    const acct = await this.store.accountBytes();
    if (acct - prevSize + newSize > this.limits.maxAccountBytes) throw new WorkspaceError('quota_account', 'Your file storage is full.');
  }

  private async prune(id: string, current: number) {
    const keep = this.limits.keepVersions;
    if (current <= keep) return;
    const versions = await this.store.listVersions(id);
    for (const v of versions) if (v.n <= current - keep) await this.store.deleteVersion(id, v.n);
  }

  async write(rawPath: string, content: unknown, source: FileSource): Promise<FileMeta> {
    const path = normalizePath(rawPath);
    if (typeof content !== 'string') throw new WorkspaceError('bad_content', 'Content must be text.');
    const size = bytes(content);
    if (size > this.limits.maxTextBytes) throw new WorkspaceError('too_large', `Text files are capped at ${Math.round(this.limits.maxTextBytes / 1024)}KB.`);
    const mime = mimeFor(path, 'text/plain');
    if (!isTextMime(mime)) throw new WorkspaceError('not_text', `${path} is not a text file type. Pick a text extension such as .md or .txt.`);
    return this.commitText(path, content, source, mime);
  }

  private async commitText(path: string, content: string, source: FileSource, mime: string): Promise<FileMeta> {
    const id = fileIdFor(path);
    const prev = await this.store.getFile(id);
    const live = prev && !prev.deleted ? prev : null;
    const size = bytes(content);
    await this.checkQuota(path, size, live?.size ?? 0, !live);
    const n = (prev?.version ?? 0) + 1;
    const at = this.now();
    const meta: FileMeta = { id, path, mime, kind: 'text', size, version: n, source, updatedAt: at };
    await this.store.commit(meta, { n, size, source, at, content }, prev?.version ?? 0);
    await this.store.addAccountBytes(size - (live?.size ?? 0));
    await this.prune(id, n);
    return meta;
  }

  /** Exact string replace. Must match once unless replaceAll. */
  async edit(rawPath: string, oldStr: unknown, newStr: unknown, replaceAll: boolean, source: FileSource): Promise<{ meta: FileMeta; replaced: number }> {
    const path = normalizePath(rawPath);
    if (typeof oldStr !== 'string' || typeof newStr !== 'string') throw new WorkspaceError('bad_content', 'old_str and new_str must be text.');
    if (!oldStr) throw new WorkspaceError('bad_edit', 'old_str is empty. Use write_file to create or replace a whole file.');
    if (oldStr === newStr) throw new WorkspaceError('bad_edit', 'old_str and new_str are the same.');
    const { meta, content } = await this.read(path);
    if (meta.kind !== 'text' || content === undefined) throw new WorkspaceError('not_text', `${path} is not a text file.`);
    const count = content.split(oldStr).length - 1;
    if (count === 0) throw new WorkspaceError('no_match', `old_str was not found in ${path}. Read the file and copy the text exactly.`);
    if (count > 1 && !replaceAll) throw new WorkspaceError('ambiguous', `old_str appears ${count} times in ${path}. Add surrounding text so it matches once, or set replace_all.`);
    const next = replaceAll ? content.split(oldStr).join(newStr) : content.replace(oldStr, () => newStr);
    if (bytes(next) > this.limits.maxTextBytes) throw new WorkspaceError('too_large', 'The edit would make the file too large.');
    return { meta: await this.commitText(path, next, source, meta.mime), replaced: replaceAll ? count : 1 };
  }

  async writeBinary(rawPath: string, data: Buffer, mime: string, source: FileSource): Promise<FileMeta> {
    const path = normalizePath(rawPath);
    if (data.length > this.limits.maxBinaryBytes) throw new WorkspaceError('too_large', `Files are capped at ${Math.round(this.limits.maxBinaryBytes / 1024 / 1024)}MB.`);
    const type = mime || mimeFor(path);
    // Text that arrives as bytes (an uploaded .md) is stored as text so it can be edited.
    if (isTextMime(type) && data.length <= this.limits.maxTextBytes) {
      return this.commitText(path, data.toString('utf8'), source, type);
    }
    const id = fileIdFor(path);
    const prev = await this.store.getFile(id);
    const live = prev && !prev.deleted ? prev : null;
    await this.checkQuota(path, data.length, live?.size ?? 0, !live);
    const n = (prev?.version ?? 0) + 1;
    const { url, storagePath } = await this.store.putBlob(id, n, data, type);
    const at = this.now();
    const meta: FileMeta = { id, path, mime: type, kind: 'binary', size: data.length, version: n, source, url, updatedAt: at };
    await this.store.commit(meta, { n, size: data.length, source, at, url, storagePath }, prev?.version ?? 0);
    await this.store.addAccountBytes(data.length - (live?.size ?? 0));
    await this.prune(id, n);
    return meta;
  }

  /** A free path near `rawPath`: "a.png", then "a (2).png", "a (3).png"... */
  async freePath(rawPath: string): Promise<string> {
    const path = normalizePath(rawPath);
    const taken = new Set((await this.list()).map(f => f.path));
    if (!taken.has(path)) return path;
    const dot = path.lastIndexOf('.');
    const slash = path.lastIndexOf('/');
    const [base, ext] = dot > slash + 1 ? [path.slice(0, dot), path.slice(dot)] : [path, ''];
    for (let i = 2; i < 1000; i++) {
      const p = `${base} (${i})${ext}`;
      if (!taken.has(p)) return p;
    }
    throw new WorkspaceError('quota_files', 'Too many files with that name.');
  }

  async delete(rawPath: string): Promise<void> {
    const path = normalizePath(rawPath);
    const meta = await this.live(path);
    await this.store.putMeta({ ...meta, deleted: true, updatedAt: this.now() });
    await this.store.addAccountBytes(-meta.size);
  }

  async rename(rawFrom: string, rawTo: string, source: FileSource): Promise<FileMeta> {
    const from = normalizePath(rawFrom);
    const to = normalizePath(rawTo);
    if (from === to) return this.live(from);
    const meta = await this.live(from);
    const target = await this.store.getFile(fileIdFor(to));
    if (target && !target.deleted) throw new WorkspaceError('exists', `${to} already exists.`);
    const v = await this.store.getVersion(meta.id, meta.version);
    if (!v) throw new WorkspaceError('not_found', `${from} has no content.`);
    let moved: FileMeta;
    if (meta.kind === 'text') {
      moved = await this.commitText(to, v.content ?? '', source, mimeFor(to, meta.mime));
    } else {
      // Binary: copy the bytes under the new path so each version owns its
      // object and pruning one path can never break another.
      const data = await this.store.getBlob(v.storagePath ?? '');
      moved = await this.writeBinary(to, data, meta.mime, source);
    }
    await this.delete(from);
    return moved;
  }

  async versions(rawPath: string) {
    const path = normalizePath(rawPath);
    const meta = await this.store.getFile(fileIdFor(path));
    if (!meta) throw new WorkspaceError('not_found', `No file at ${path}.`);
    return (await this.store.listVersions(meta.id)).sort((a, b) => b.n - a.n);
  }

  async version(rawPath: string, n: number): Promise<VersionDoc> {
    const path = normalizePath(rawPath);
    const v = await this.store.getVersion(fileIdFor(path), n);
    if (!v) throw new WorkspaceError('not_found', `${path} has no version ${n}.`);
    return v;
  }

  /** Restores version n as a new version (history is never rewritten). Also undeletes. */
  async restore(rawPath: string, n: number, source: FileSource): Promise<FileMeta> {
    const path = normalizePath(rawPath);
    const id = fileIdFor(path);
    const meta = await this.store.getFile(id);
    if (!meta) throw new WorkspaceError('not_found', `No file at ${path}.`);
    const v = await this.version(path, n);
    if (meta.kind === 'text') return this.commitText(path, v.content ?? '', source, meta.mime);
    const next = meta.version + 1;
    const at = this.now();
    const restored: FileMeta = { ...meta, deleted: false, size: v.size, url: v.url, version: next, source, updatedAt: at };
    await this.store.commit(restored, { ...v, n: next, at, source }, meta.version);
    await this.store.addAccountBytes(v.size - (meta.deleted ? 0 : meta.size));
    return restored;
  }
}
