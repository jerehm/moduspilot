import { app, dialog, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import log from 'electron-log';
import { getLocalFolder, setLocalFolder } from '../settings';
import { ask } from './guard';

/**
 * One folder on this Mac that the model may read and write, the way Claude
 * Desktop works in a project folder.
 *
 * The folder is chosen ONLY through the native picker: the web page can never
 * name a path. Every path the model gives is relative, resolved inside the
 * folder, and checked with realpath so neither ".." nor a symlink can reach
 * outside it. The first change each session asks for consent.
 */
const TEXT_CAP = 256 * 1024;
const PREVIEW_CAP = 8 * 1024 * 1024;
const SKIP = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.DS_Store', '.venv', '__pycache__']);
let writesAllowedFor: string | null = null;

export class FolderError extends Error {}

export function currentFolder(): string | null {
  const f = getLocalFolder();
  if (!f) return null;
  try { return fs.statSync(f).isDirectory() ? f : null; } catch { return null; }
}

export async function pickFolder(): Promise<string | null> {
  let chosen: string | null = null;
  const testPath = !app.isPackaged ? process.env.MODUS_TEST_FOLDER : undefined;
  if (testPath) chosen = testPath;
  else {
    const win = BrowserWindow.getFocusedWindow() ?? undefined;
    const r = win
      ? await dialog.showOpenDialog(win, { title: 'Choose a folder for MODUS', properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ title: 'Choose a folder for MODUS', properties: ['openDirectory', 'createDirectory'] });
    if (!r.canceled && r.filePaths[0]) chosen = r.filePaths[0];
  }
  if (!chosen) return null;
  const real = fs.realpathSync(chosen);
  // Refuse the obvious footguns: the whole disk or the home folder itself.
  if (real === '/' || real === app.getPath('home')) throw new FolderError('Pick a specific folder, not your whole home folder or disk.');
  setLocalFolder(real);
  writesAllowedFor = null;
  log.info(`[local] folder set to ${real}`);
  return real;
}

export function clearFolder(): void {
  setLocalFolder(null);
  writesAllowedFor = null;
}

function root(): string {
  const f = currentFolder();
  if (!f) throw new FolderError('No folder is chosen. Pick one in Capabilities, On this Mac.');
  return fs.realpathSync(f);
}

/** Resolves a relative path inside the folder, or throws. */
export function resolveInside(rel: unknown): { abs: string; rel: string; base: string } {
  if (typeof rel !== 'string') throw new FolderError('Path must be text.');
  const clean = rel.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (clean.split('/').some(s => s === '..')) throw new FolderError('Paths may not contain "..".');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(clean) || clean.length > 400) throw new FolderError('That path is not allowed.');
  const base = root();
  const abs = path.resolve(base, clean || '.');
  // realpath of the deepest part that exists, so a symlink cannot point out.
  let probe = abs;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const realProbe = fs.realpathSync(probe);
  if (realProbe !== base && !realProbe.startsWith(base + path.sep)) throw new FolderError('That path is outside the chosen folder.');
  return { abs, rel: path.relative(base, abs).split(path.sep).join('/'), base };
}

function isText(buf: Buffer): boolean {
  return !buf.subarray(0, 8192).includes(0);
}

export function listFiles(prefix = ''): { path: string; size: number; kind: 'text' | 'binary' | 'folder' }[] {
  const { abs, base } = resolveInside(prefix);
  const out: { path: string; size: number; kind: 'text' | 'binary' | 'folder' }[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || out.length >= 800) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (SKIP.has(e.name) || out.length >= 800) continue;
      const p = path.join(dir, e.name);
      const rel = path.relative(base, p).split(path.sep).join('/');
      if (e.isDirectory()) { out.push({ path: rel, size: 0, kind: 'folder' }); walk(p, depth + 1); }
      else if (e.isFile()) {
        const size = fs.statSync(p).size;
        const ext = path.extname(e.name).toLowerCase();
        const binaryExt = /^\.(png|jpe?g|gif|webp|avif|pdf|zip|mp4|mov|mp3|wav|m4a|dmg|ico|icns|woff2?|ttf)$/.test(ext);
        out.push({ path: rel, size, kind: binaryExt ? 'binary' : 'text' });
      }
    }
  };
  walk(abs, 0);
  return out;
}

export function readFile(rel: string, offset?: number, limit?: number): { path: string; content: string; totalLines: number } {
  const r = resolveInside(rel);
  const st = fs.statSync(r.abs);
  if (!st.isFile()) throw new FolderError(`${r.rel} is not a file.`);
  if (st.size > TEXT_CAP * 4) throw new FolderError(`${r.rel} is too large to read (${Math.round(st.size / 1024)}KB).`);
  const buf = fs.readFileSync(r.abs);
  if (!isText(buf)) throw new FolderError(`${r.rel} is a binary file and cannot be read as text.`);
  const lines = buf.toString('utf8').split('\n');
  const start = Math.max(1, Math.floor(offset || 1));
  const count = Math.max(1, Math.floor(limit || lines.length));
  const content = lines.slice(start - 1, start - 1 + count).join('\n');
  return { path: r.rel, content: content.length > 60_000 ? content.slice(0, 60_000) : content, totalLines: lines.length };
}

async function consentToWrite(base: string) {
  if (writesAllowedFor === base) return;
  const choice = await ask({
    message: 'Allow MODUS to change files in this folder?',
    detail: `${base}\n\nMODUS will be able to create and edit files here until you quit the app.`,
    buttons: ['Allow', 'Deny'],
    cancelId: 1,
  });
  if (choice !== 0) throw new FolderError('The user did not allow changes to this folder.');
  writesAllowedFor = base;
}

export async function writeFile(rel: string, content: unknown): Promise<{ path: string; size: number }> {
  if (typeof content !== 'string') throw new FolderError('Content must be text.');
  if (Buffer.byteLength(content) > TEXT_CAP) throw new FolderError('Text files are capped at 256KB.');
  const r = resolveInside(rel);
  if (!r.rel || r.rel === '.') throw new FolderError('Give a file path.');
  await consentToWrite(r.base);
  fs.mkdirSync(path.dirname(r.abs), { recursive: true });
  fs.writeFileSync(r.abs, content, 'utf8');
  log.info(`[local] wrote ${r.rel}`);
  return { path: r.rel, size: Buffer.byteLength(content) };
}

export async function editFile(rel: string, oldStr: unknown, newStr: unknown, replaceAll: boolean): Promise<{ path: string; replaced: number }> {
  if (typeof oldStr !== 'string' || typeof newStr !== 'string' || !oldStr) throw new FolderError('old_str and new_str must be text, and old_str not empty.');
  const r = resolveInside(rel);
  const buf = fs.readFileSync(r.abs);
  if (buf.length > TEXT_CAP || !isText(buf)) throw new FolderError(`${r.rel} is not an editable text file.`);
  const full = buf.toString('utf8');
  const p = r.rel;
  const count = full.split(oldStr).length - 1;
  if (count === 0) throw new FolderError(`old_str was not found in ${p}. Read the file and copy the text exactly.`);
  if (count > 1 && !replaceAll) throw new FolderError(`old_str appears ${count} times in ${p}. Add context or set replace_all.`);
  const next = replaceAll ? full.split(oldStr).join(newStr) : full.replace(oldStr, () => newStr);
  await writeFile(p, next);
  return { path: p, replaced: replaceAll ? count : 1 };
}

/** For the Files panel: text content, or a data URL for images and PDFs. */
export function previewFile(rel: string): { path: string; mime: string; text?: string; dataUrl?: string } {
  const r = resolveInside(rel);
  const st = fs.statSync(r.abs);
  if (!st.isFile()) throw new FolderError(`${r.rel} is not a file.`);
  const ext = path.extname(r.abs).toLowerCase().slice(1);
  const mimes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', svg: 'image/svg+xml' };
  const mime = mimes[ext];
  if (mime && mime !== 'image/svg+xml') {
    if (st.size > PREVIEW_CAP) throw new FolderError('Too large to preview.');
    return { path: r.rel, mime, dataUrl: `data:${mime};base64,${fs.readFileSync(r.abs).toString('base64')}` };
  }
  const t = readFile(rel);
  return { path: t.path, mime: ext === 'md' ? 'text/markdown' : ext === 'html' ? 'text/html' : 'text/plain', text: t.content };
}
