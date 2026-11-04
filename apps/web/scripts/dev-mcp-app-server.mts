/**
 * Local MCP Apps test server: one widget tool the model can call, one tool only
 * the widget can call. Speaks the MCP Apps postMessage protocol by hand (no
 * ext-apps App class) so it checks our host bridge independently.
 *
 *   cd apps/web && npx tsx scripts/dev-mcp-app-server.mts        # :3199/mcp
 *   MCP_ALLOW_LOCALHOST=1 npx next dev -p 3100                  # dev only
 *
 * Then add http://localhost:3199/mcp as a custom plugin on the TEST account.
 */
import { createServer } from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const URI = 'ui://modus-test/poster';
const MIME = 'text/html;profile=mcp-app';
const COLORS = ['#7c3aed', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444'];

const WIDGET = `<!doctype html><html><body style="margin:0;font:14px system-ui;background:transparent">
<div id="card" style="padding:20px;border-radius:12px;color:white;background:#444;min-height:120px">
  <div id="title" style="font-size:22px;font-weight:600">Waiting for result</div>
  <div id="sub" style="opacity:.8;margin-top:6px"></div>
</div>
<div style="display:flex;gap:8px;margin-top:10px">
  <button id="recolor">Recolor</button><button id="ask">Ask for a bigger one</button>
</div>
<script>
let id = 0; const pending = {};
const send = (m) => parent.postMessage(Object.assign({ jsonrpc: '2.0' }, m), '*');
const request = (method, params) => new Promise((res) => { const i = ++id; pending[i] = res; send({ id: i, method, params }); });
const notify = (method, params) => send({ method, params });
function render(r) {
  const s = (r && r.structuredContent) || {};
  document.getElementById('title').textContent = s.title || 'No title';
  document.getElementById('sub').textContent = 'color ' + (s.color || '?');
  document.getElementById('card').style.background = s.color || '#444';
  notify('ui/notifications/size-changed', { height: document.body.scrollHeight });
}
window.addEventListener('message', (e) => {
  const m = e.data; if (!m || m.jsonrpc !== '2.0') return;
  if (m.id && pending[m.id]) { pending[m.id](m.result ?? m); delete pending[m.id]; return; }
  if (m.method === 'ui/notifications/tool-result') render(m.params);
});
document.getElementById('recolor').onclick = async () => render(await request('tools/call', { name: 'recolor', arguments: {} }));
document.getElementById('ask').onclick = () => request('ui/message', { role: 'user', content: [{ type: 'text', text: 'Make the poster bigger' }] });
request('ui/initialize', { protocolVersion: '2026-01-26', appInfo: { name: 'poster', version: '1' }, appCapabilities: {} })
  .then((r) => { window.__host = r && r.hostInfo; notify('ui/notifications/initialized', {}); });
</script></body></html>`;

function build() {
  const s = new McpServer({ name: 'modus-test-apps', version: '1.0.0' });
  let i = 0;
  s.registerTool('make_poster', {
    description: 'Make a test poster with a title. Shows an interactive widget.',
    inputSchema: { title: z.string().describe('Poster title') },
    _meta: { ui: { resourceUri: URI } },
  }, async ({ title }) => ({
    content: [{ type: 'text', text: `Poster "${title}" is ready.` }],
    structuredContent: { title, color: COLORS[0] },
  }));
  s.registerTool('recolor', {
    description: 'Widget only: next color.',
    inputSchema: {},
    _meta: { ui: { resourceUri: URI, visibility: ['app'] } },
  }, async () => {
    i = (i + 1) % COLORS.length;
    return { content: [{ type: 'text', text: 'recolored' }], structuredContent: { title: 'Recolored poster', color: COLORS[i] } };
  });
  // A generation-style tool: one CDN link and one inline image, the two shapes
  // real servers use. Checks the outputs/ copy (lib/chat/save-tool-media.ts).
  s.registerTool('make_image', {
    description: 'Generate a test image from a prompt.',
    inputSchema: { prompt: z.string() },
  }, async ({ prompt }) => ({
    content: [
      { type: 'text', text: `Image for "${prompt}" ready: https://moduspilot.com/og.png` },
      { type: 'image', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', mimeType: 'image/png' },
    ],
  }));
  // Phase 6: a prompt (slash command) with an argument, and a text resource.
  s.registerPrompt('brainstorm', {
    title: 'Brainstorm',
    description: 'Ten ideas about a topic.',
    argsSchema: { topic: z.string().describe('What to brainstorm') },
  }, ({ topic }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: `Give me ten fresh ideas about ${topic}. One line each.` } }],
  }));
  s.registerResource('style-guide', 'docs://modus-test/style-guide', { title: 'Poster style guide', mimeType: 'text/markdown' }, async () => ({
    contents: [{ uri: 'docs://modus-test/style-guide', mimeType: 'text/markdown', text: '# Poster style guide\n\nThe house color is violet #7c3aed. Codeword: PELICAN-42.' }],
  }));
  s.registerResource('poster', URI, { mimeType: MIME }, async () => ({
    contents: [{ uri: URI, mimeType: MIME, text: WIDGET, _meta: { ui: { prefersBorder: true } } }],
  }));
  return s;
}

createServer(async (req, res) => {
  if (!req.url?.startsWith('/mcp')) { res.writeHead(404).end(); return; }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
  // Stateless: a fresh server + transport per request.
  const server = build();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}).listen(3199, () => console.log('MCP Apps test server on http://localhost:3199/mcp'));
