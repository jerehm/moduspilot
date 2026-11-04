import { assertPublicUrl } from '../ssrf';
import { extractMedia, type ToolCallRecord } from './tool-activity';
import { mimeFor, type Workspace } from '../workspace';

/**
 * Copies images, video and audio that connector tools returned into the
 * chat's workspace under outputs/{connector}/, the way a desktop host keeps
 * generations on disk. Plugin CDN links expire; the copy does not.
 *
 * Bounded so it can sit in onFinish before the stream closes: 6 files, 25MB
 * each, 20s per download, 30s overall. Anything past the budget is skipped
 * and the card still shows the original link.
 */
const MAX_FILES = 6;
const MAX_BYTES = 25 * 1024 * 1024;
const PER_FILE_MS = 20_000;
const TOTAL_MS = 30_000;

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg',
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'plugin';

async function fetchMedia(url: string): Promise<{ data: Buffer; mime: string } | null> {
  if (url.startsWith('data:')) {
    const m = url.match(/^data:([^;,]+);base64,(.*)$/);
    if (!m) return null;
    const data = Buffer.from(m[2], 'base64');
    return data.length <= MAX_BYTES ? { data, mime: m[1] } : null;
  }
  // Redirects are followed by hand so every hop is checked: a public link that
  // 302s to an internal address must not get through on the first check.
  let current = url;
  let res: Response | null = null;
  const signal = AbortSignal.timeout(PER_FILE_MS);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(current);
    res = await fetch(current, { signal, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return null;
      current = new URL(loc, current).toString();
      if (!/^https:\/\//i.test(current)) return null;
      res = null;
      continue;
    }
    break;
  }
  if (!res || !res.ok) return null;
  url = current;
  const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim() || mimeFor(new URL(url).pathname);
  if (!/^(image|video|audio)\//.test(mime)) return null;
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) return null;
  const data = Buffer.from(await res.arrayBuffer());
  return data.length <= MAX_BYTES ? { data, mime } : null;
}

function nameFor(url: string, tool: string, i: number, mime: string): string {
  let base = '';
  if (!url.startsWith('data:')) {
    try { base = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? ''); } catch {}
  }
  base = base.replace(/[^\w.\- ]+/g, '_').slice(0, 80);
  const ext = EXT[mime] ?? (mime.split('/')[1] || 'bin');
  if (!base || !base.includes('.')) base = `${slug(tool)}-${i + 1}.${ext}`;
  return base;
}

export async function saveToolMedia(
  ws: Workspace,
  steps: ReadonlyArray<{ toolResults: ReadonlyArray<unknown> }>,
  records: ToolCallRecord[],
): Promise<void> {
  const byId = new Map(records.map(r => [r.id, r]));
  const jobs: { rec: ToolCallRecord; url: string; i: number }[] = [];
  for (const step of steps) {
    for (const raw of step.toolResults as { toolCallId: string; result: unknown }[]) {
      const rec = byId.get(raw.toolCallId);
      if (!rec || rec.server === 'Files' || rec.state !== 'done') continue;
      // Structured media parts always count. Links found in TEXT only count when
      // there are a few, the way a generator reports its output; a docs tool
      // returning a README full of screenshots is not producing media.
      const structured = extractMedia(raw.result, { allowInline: true, scanText: false });
      const all = extractMedia(raw.result, { allowInline: true });
      const fromText = all.filter(m => !structured.some(s => s.url === m.url));
      const picked = [...structured, ...(fromText.length <= 3 ? fromText : [])];
      picked.forEach((m, i) => jobs.push({ rec, url: m.url, i }));
    }
  }
  if (jobs.length === 0) return;
  const deadline = Date.now() + TOTAL_MS;
  for (const job of jobs.slice(0, MAX_FILES)) {
    if (Date.now() > deadline) break;
    try {
      const got = await Promise.race([
        fetchMedia(job.url),
        new Promise<null>(r => setTimeout(() => r(null), Math.max(0, deadline - Date.now()))),
      ]);
      if (!got) continue;
      const folder = `outputs/${slug(job.rec.server ?? 'plugin')}`;
      const path = await ws.freePath(`${folder}/${nameFor(job.url, job.rec.tool, job.i, got.mime)}`);
      const meta = await ws.writeBinary(path, got.data, got.mime, 'tool');
      (job.rec.saved ??= []).push(meta.path);
    } catch (e) {
      console.warn('[chat] tool media not saved:', String(e).slice(0, 160));
    }
  }
}
