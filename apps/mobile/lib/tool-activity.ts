/**
 * Tool activity: what the model DID on a turn, in a shape the chat can show.
 *
 * Until this existed, MCP tool calls were invisible on every surface. A Pika
 * generation that took two minutes looked like a stalled reply, and a tool that
 * failed looked like the model simply forgetting. Two sources feed one record:
 *
 *  - live: useChat's `toolInvocations` on the streaming message
 *  - saved: the `modusTools` annotation the route writes in onFinish, because
 *    useConversations persists content + annotations only, so invocations are
 *    gone after a reload
 *
 * The saved form is size-bounded (Firestore docs cap at 1MB and a thread holds
 * every message), so it keeps short previews and http(s) media URLs only.
 * Inline base64 media shows live and is dropped from the saved copy.
 */

export type ToolState = 'running' | 'done' | 'error';

export interface ToolMedia {
  kind: 'image' | 'video' | 'audio';
  url: string;
}

export interface ToolCallRecord {
  id: string;
  tool: string;
  /** Connector the tool came from, when known ("Pika"). */
  server?: string;
  state: ToolState;
  args?: string;
  result?: string;
  media: ToolMedia[];
  /** MCP Apps widget for this call, opened in the side panel. */
  ui?: ToolUiRef;
  /** Workspace paths this call's media was saved to (outputs/...). */
  saved?: string[];
  /** Client only, never saved: the live args and full result for the widget. */
  raw?: { args?: unknown; result?: unknown };
}

export interface ToolUiRef { serverId: string; uri: string }

const ARGS_CAP = 600;
const RESULT_CAP = 1200;
const MEDIA_CAP = 8;

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|ogg|aac)(\?|#|$)/i;

function clip(s: string, cap: number): string {
  return s.length > cap ? s.slice(0, cap) + '…' : s;
}

function stringify(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function kindFromMime(mime: unknown): ToolMedia['kind'] | null {
  if (typeof mime !== 'string') return null;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
}

function kindFromUrl(url: string): ToolMedia['kind'] | null {
  if (IMAGE_EXT.test(url)) return 'image';
  if (VIDEO_EXT.test(url)) return 'video';
  if (AUDIO_EXT.test(url)) return 'audio';
  return null;
}

/**
 * Pulls displayable media out of a tool result. Handles the MCP content shape
 * ({content:[{type:'image',data,mimeType}|{type:'resource_link',uri}|{type:'text'}]})
 * and plain JSON or text that mentions media URLs, which is how most generation
 * servers report a finished asset.
 */
export function extractMedia(result: unknown, opts: { allowInline: boolean }): ToolMedia[] {
  const out: ToolMedia[] = [];
  const seen = new Set<string>();
  const push = (kind: ToolMedia['kind'] | null, url: string) => {
    if (!kind || seen.has(url) || out.length >= MEDIA_CAP) return;
    if (url.startsWith('data:') && !opts.allowInline) return;
    if (!url.startsWith('data:') && !/^https:\/\//i.test(url)) return;
    seen.add(url);
    out.push({ kind, url });
  };

  const scanText = (text: string) => {
    for (const m of text.matchAll(/https:\/\/[^\s"'<>)\]\\]+/g)) {
      push(kindFromUrl(m[0]), m[0]);
    }
  };

  const content = (result as { content?: unknown })?.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;
      if ((p.type === 'image' || p.type === 'audio') && typeof p.data === 'string') {
        const mime = typeof p.mimeType === 'string' ? p.mimeType : p.type === 'image' ? 'image/png' : 'audio/mpeg';
        push(kindFromMime(mime), `data:${mime};base64,${p.data}`);
      } else if (p.type === 'resource_link' && typeof p.uri === 'string') {
        push(kindFromMime(p.mimeType) ?? kindFromUrl(p.uri), p.uri);
      } else if (p.type === 'resource' && p.resource && typeof p.resource === 'object') {
        const r = p.resource as Record<string, unknown>;
        if (typeof r.uri === 'string') push(kindFromMime(r.mimeType) ?? kindFromUrl(r.uri), r.uri);
      } else if (p.type === 'text' && typeof p.text === 'string') {
        scanText(p.text);
      }
    }
  } else {
    scanText(stringify(result));
  }
  return out;
}

/** Text preview of a result: MCP text parts joined, else the JSON. */
export function resultPreview(result: unknown): string {
  const content = (result as { content?: unknown })?.content;
  if (Array.isArray(content)) {
    const text = content
      .filter((p): p is { type: 'text'; text: string } => !!p && (p as { type?: unknown }).type === 'text' && typeof (p as { text?: unknown }).text === 'string')
      .map(p => p.text)
      .join('\n');
    if (text) return clip(text, RESULT_CAP);
    return '';
  }
  return clip(stringify(result), RESULT_CAP);
}

export function isErrorResult(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const r = result as Record<string, unknown>;
  // makeToolErrorsNonFatal shape, and MCP's own isError flag.
  return r.error === true || r.isError === true;
}

/** Server-side: turns streamText `steps` into the saved annotation. */
export function summarizeSteps(
  steps: ReadonlyArray<{
    toolCalls: ReadonlyArray<{ toolCallId: string; toolName: string; args: unknown }>;
    toolResults: ReadonlyArray<{ toolCallId: string; result: unknown }>;
  }>,
  serverByTool: Record<string, string>,
  uiByTool: Record<string, ToolUiRef> = {},
): ToolCallRecord[] {
  const out: ToolCallRecord[] = [];
  for (const step of steps) {
    const results = new Map(step.toolResults.map(r => [r.toolCallId, r.result]));
    for (const call of step.toolCalls) {
      const has = results.has(call.toolCallId);
      // A local__ tool runs on the user's Mac after this request ends; its
      // result arrives with the next request, and the client saves its record.
      if (!has && call.toolName.startsWith('local__')) continue;
      const result = results.get(call.toolCallId);
      out.push({
        id: call.toolCallId,
        tool: call.toolName,
        server: serverByTool[call.toolName],
        state: !has ? 'error' : isErrorResult(result) ? 'error' : 'done',
        args: clip(stringify(call.args), ARGS_CAP),
        result: has ? resultPreview(result) : 'No result came back.',
        media: has ? extractMedia(result, { allowInline: false }) : [],
        ...(uiByTool[call.toolName] ? { ui: uiByTool[call.toolName] } : {}),
      });
    }
  }
  return out;
}

/** Client-side: a live AI SDK tool invocation → record (inline media allowed). */
export function fromInvocation(
  inv: { toolCallId: string; toolName: string; args?: unknown; state: string; result?: unknown },
  serverByTool: Record<string, string>,
  uiByTool: Record<string, ToolUiRef> = {},
): ToolCallRecord {
  const done = inv.state === 'result';
  return {
    ...(uiByTool[inv.toolName] ? { ui: uiByTool[inv.toolName] } : {}),
    id: inv.toolCallId,
    tool: inv.toolName,
    server: serverByTool[inv.toolName],
    state: !done ? 'running' : isErrorResult(inv.result) ? 'error' : 'done',
    args: clip(stringify(inv.args), ARGS_CAP),
    result: done ? resultPreview(inv.result) : undefined,
    media: done ? extractMedia(inv.result, { allowInline: true }) : [],
    raw: { args: inv.args, result: done ? inv.result : undefined },
  };
}

/** "Used Pika 2 times, GitMCP once" style summary line. */
export function summaryLine(calls: ToolCallRecord[]): string {
  const running = calls.filter(c => c.state === 'running');
  if (running.length > 0) {
    const last = running[running.length - 1];
    return `Using ${last.server ?? 'a tool'}: ${humanTool(last.tool)}`;
  }
  const byServer = new Map<string, number>();
  for (const c of calls) {
    const key = c.server ?? 'tools';
    byServer.set(key, (byServer.get(key) ?? 0) + 1);
  }
  const bits = [...byServer.entries()].map(([s, n]) =>
    s === 'tools' ? `ran ${n} ${n === 1 ? 'tool' : 'tools'}` : `used ${s} ${n === 1 ? 'once' : `${n} times`}`,
  );
  const line = bits.join(', ');
  const failed = calls.filter(c => c.state === 'error').length;
  const text = line.charAt(0).toUpperCase() + line.slice(1);
  return failed > 0 ? `${text} (${failed} failed)` : text;
}

/** generate_image → Generate image */
export function humanTool(name: string): string {
  const base = name.includes('__') ? name.split('__').pop()! : name;
  const words = base.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Reads the saved `modusTools` / `modusToolServers` annotations off a message. */
export function readToolAnnotations(m: unknown): { calls: ToolCallRecord[]; servers: Record<string, string>; ui: Record<string, ToolUiRef> } {
  const anns = (m as { annotations?: unknown[] })?.annotations;
  let calls: ToolCallRecord[] = [];
  let servers: Record<string, string> = {};
  let ui: Record<string, ToolUiRef> = {};
  if (Array.isArray(anns)) {
    for (const a of anns) {
      if (!a || typeof a !== 'object') continue;
      const o = a as Record<string, unknown>;
      if (Array.isArray(o.modusTools)) calls = o.modusTools as ToolCallRecord[];
      if (o.modusToolServers && typeof o.modusToolServers === 'object') servers = o.modusToolServers as Record<string, string>;
      if (o.modusToolUi && typeof o.modusToolUi === 'object') ui = o.modusToolUi as Record<string, ToolUiRef>;
    }
  }
  return { calls, servers, ui };
}

/**
 * The annotations to persist for a message, with every live tool invocation
 * folded into its modusTools record.
 *
 * The server writes modusTools per request, but a local__ tool (desktop) runs
 * between requests, so no request ever sees its result. Folding the client's
 * invocations in at save time keeps every call, local or not, after a reload.
 * Saved copies stay bounded: no raw values, no inline base64.
 */
export function annotationsForSave(m: unknown): unknown[] | undefined {
  const anns = (m as { annotations?: unknown[] })?.annotations;
  const live = (m as { toolInvocations?: { toolCallId: string; toolName: string; args?: unknown; state: string; result?: unknown }[] })?.toolInvocations;
  if (!Array.isArray(live) || live.length === 0) return anns;
  const { calls: saved, servers, ui } = readToolAnnotations(m);
  const byId = new Map(saved.map(r => [r.id, r]));
  for (const inv of live) {
    if (inv.state !== 'result') continue;
    const rec = fromInvocation(inv, servers, ui);
    const prev = byId.get(rec.id);
    byId.set(rec.id, {
      ...rec,
      raw: undefined,
      media: extractMedia(inv.result, { allowInline: false }),
      ...(prev?.saved ? { saved: prev.saved } : {}),
    });
  }
  const merged = [...byId.values()].map(({ raw: _raw, ...r }) => r);
  const rest = (Array.isArray(anns) ? anns : []).filter(a => !(a && typeof a === 'object' && 'modusTools' in (a as object)));
  return [...rest, { modusTools: merged }];
}
