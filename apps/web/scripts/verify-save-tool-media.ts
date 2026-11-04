/**
 * Plugin media copy: redirects to internal addresses are refused at every hop,
 * normal media saves, non-media and inline base64 behave.
 *   cd apps/web && npx tsx scripts/verify-save-tool-media.ts
 */
import { saveToolMedia } from '../lib/chat/save-tool-media';
import type { ToolCallRecord } from '../lib/chat/tool-activity';

let failures = 0;
const check = (l: string, c: boolean, d?: unknown) => { console.log(`${c ? '✅' : '❌'} ${l}`); if (!c) { failures++; console.log('  ', JSON.stringify(d)); } };

const fetched: string[] = [];
globalThis.fetch = (async (input: string | URL) => {
  const u = String(input);
  fetched.push(u);
  if (u === 'https://example.com/evil.png') return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
  if (u === 'https://example.com/hop.png') return new Response(null, { status: 302, headers: { location: 'https://example.com/real.png' } });
  if (u === 'https://example.com/real.png' || u === 'https://example.com/ok.png') return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } });
  if (u === 'https://example.com/page.png') return new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
  return new Response(null, { status: 404 });
}) as typeof fetch;

const written: string[] = [];
const ws = {
  async freePath(p: string) { return p; },
  async writeBinary(p: string) { written.push(p); return { path: p }; },
} as unknown as Parameters<typeof saveToolMedia>[0];

async function main() {
  const urls = ['evil.png', 'hop.png', 'ok.png'].map(n => `https://example.com/${n}`);
  const rec: ToolCallRecord = { id: 'c1', tool: 'generate_image', server: 'Pika', state: 'done', media: [] };
  const rec3: ToolCallRecord = { id: 'c3', tool: 'generate_image', server: 'Pika', state: 'done', media: [] };
  await saveToolMedia(ws, [{ toolResults: [
    { toolCallId: 'c1', result: { content: [
      { type: 'text', text: urls.join(' ') },
      { type: 'image', data: Buffer.from([9, 9]).toString('base64'), mimeType: 'image/png' },
    ] } },
    { toolCallId: 'c3', result: { content: [{ type: 'text', text: 'https://example.com/page.png' }] } },
  ] }], [rec, rec3]);
  check('redirect to metadata IP never fetched', !fetched.some(u => u.includes('169.254')), fetched);
  check('evil.png not saved', !written.some(p => p.includes('evil')), written);
  check('public redirect hop followed and saved', written.includes('outputs/pika/hop.png') && fetched.includes('https://example.com/real.png'), written);
  check('direct image saved', written.includes('outputs/pika/ok.png'), written);
  check('html served as .png refused', !written.some(p => p.includes('page')), written);
  check('inline image saved', written.some(p => /make|generate-image/.test(p)), written);
  check('record lists saved paths', (rec.saved ?? []).length === written.length, rec.saved);
  // A docs-style result with many image links saves none of them.
  written.length = 0; fetched.length = 0;
  const docs: ToolCallRecord = { id: 'c2', tool: 'read_wiki', server: 'DeepWiki', state: 'done', media: [] };
  const many = Array.from({ length: 6 }, (_, i) => `https://example.com/ok.png?shot=${i}`).join(' ');
  await saveToolMedia(ws, [{ toolResults: [{ toolCallId: 'c2', result: { content: [{ type: 'text', text: `README ${many}` }] } }] }], [docs]);
  check('docs result with 6 image links saves nothing', written.length === 0 && fetched.length === 0, written);

  console.log(failures ? `\n${failures} failed.` : '\nAll checks passed.'); process.exit(failures ? 1 : 0);
}
main();
