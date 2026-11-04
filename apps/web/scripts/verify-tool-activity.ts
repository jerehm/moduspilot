/**
 * Tool activity records: media extraction, error detection, saved-copy bounds.
 *
 *   cd apps/web && npx tsx scripts/verify-tool-activity.ts
 */
import { extractMedia, summarizeSteps, fromInvocation, summaryLine, humanTool, readToolAnnotations, annotationsForSave } from '../lib/chat/tool-activity';

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) { failures++; if (detail !== undefined) console.log(`   ${JSON.stringify(detail)}`); }
}

// MCP content with inline image, resource link, and a text URL.
const mcpResult = {
  content: [
    { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    { type: 'resource_link', uri: 'https://cdn.example.com/clip.mp4', mimeType: 'video/mp4' },
    { type: 'text', text: 'Done: https://cdn.example.com/a.webp and http://insecure.example.com/b.png' },
  ],
};
const live = extractMedia(mcpResult, { allowInline: true });
check('live keeps inline image', live.some(m => m.url.startsWith('data:image/png')), live);
check('resource_link video found', live.some(m => m.kind === 'video'), live);
check('https text URL found', live.some(m => m.url.endsWith('a.webp')), live);
check('http URL rejected', !live.some(m => m.url.startsWith('http://')), live);
const saved = extractMedia(mcpResult, { allowInline: false });
check('saved copy drops base64', !saved.some(m => m.url.startsWith('data:')), saved);

// Plain JSON result (how many generation servers answer).
const json = extractMedia({ status: 'completed', video_url: 'https://pika.example/x.mp4?sig=1' }, { allowInline: false });
check('JSON video url with query found', json.length === 1 && json[0].kind === 'video', json);

// Steps → records.
const recs = summarizeSteps(
  [{
    toolCalls: [
      { toolCallId: 'a', toolName: 'generate_image', args: { prompt: 'x'.repeat(5000) } },
      { toolCallId: 'b', toolName: 'task_status', args: {} },
      { toolCallId: 'c', toolName: 'lost', args: {} },
    ],
    toolResults: [
      { toolCallId: 'a', result: mcpResult },
      { toolCallId: 'b', result: { error: true, message: 'boom' } },
    ],
  }],
  { generate_image: 'Pika', task_status: 'Pika' },
);
check('3 records', recs.length === 3, recs.length);
check('args clipped', (recs[0].args ?? '').length <= 601, recs[0].args?.length);
check('server mapped', recs[0].server === 'Pika');
check('non-fatal error shape is error', recs[1].state === 'error');
check('missing result is error', recs[2].state === 'error');
check('saved record has no base64', !JSON.stringify(recs).includes('data:image'));
check('summary line', summaryLine(recs) === 'Used Pika 2 times, ran 1 tool (2 failed)', summaryLine(recs));

const running = fromInvocation({ toolCallId: 'r', toolName: 'generate_video', state: 'call', args: {} }, { generate_video: 'Pika' });
check('running invocation', running.state === 'running' && summaryLine([running]) === 'Using Pika: Generate video', summaryLine([running]));
check('humanTool strips prefix', humanTool('pika__generate_image') === 'Generate image', humanTool('pika__generate_image'));

const ann = readToolAnnotations({ annotations: [{ modusToolServers: { a: 'Pika' } }, { modusTools: recs }] });
check('annotations read back', ann.calls.length === 3 && ann.servers.a === 'Pika');

// Local (desktop) calls: skipped by the server summary, kept by the save-time merge.
const localSteps = summarizeSteps([{ toolCalls: [{ toolCallId: 'L1', toolName: 'local__write_file', args: { path: 'a.md' } }], toolResults: [] }], {});
check('server summary skips unresolved local call', localSteps.length === 0, localSteps);
const msg = {
  annotations: [{ modusServedModel: 'x' }, { modusToolServers: { local__write_file: 'This Mac' } }, { modusTools: [{ id: 'S1', tool: 'generate_image', server: 'Pika', state: 'done', media: [], saved: ['outputs/pika/a.png'] }] }],
  toolInvocations: [
    { toolCallId: 'S1', toolName: 'generate_image', state: 'result', args: {}, result: { content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }] } },
    { toolCallId: 'L1', toolName: 'local__write_file', state: 'result', args: { path: 'a.md' }, result: { content: [{ type: 'text', text: '{"path":"a.md"}' }] } },
  ],
};
const savedAnns = annotationsForSave(msg) as Record<string, unknown>[];
const tools = (savedAnns.find(a => 'modusTools' in a) as { modusTools: { id: string; server?: string; saved?: string[] }[] }).modusTools;
check('local call saved with its label', tools.some(t => t.id === 'L1' && t.server === 'This Mac'), tools);
check('server saved paths kept', tools.find(t => t.id === 'S1')?.saved?.[0] === 'outputs/pika/a.png');
check('no base64 or raw in saved copy', !JSON.stringify(savedAnns).includes('AAAA') && !JSON.stringify(savedAnns).includes('"raw"'));
check('other annotations kept, one modusTools', savedAnns.filter(a => 'modusTools' in a).length === 1 && savedAnns.some(a => 'modusServedModel' in a));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
