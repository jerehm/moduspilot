import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { adminDb } from '@/lib/firebase-admin';
import { connectServerById } from '@/lib/mcp/connect-server';
import { MCP_APP_MIME } from '@/lib/mcp/host';
import { rateLimitHourly } from '@/lib/mcp/ui-limit';

// Widget tool calls can be generations (Higgsfield "Animate"), which block.
export const maxDuration = 300;

/**
 * MCP Apps traffic for the side panel. The browser never holds connector
 * credentials, so every widget request comes through here:
 *   { op: 'resource', serverId, uri }           widget HTML + its _meta.ui
 *   { op: 'call', serverId, name, arguments }   a tool call made by the widget
 *   { op: 'result', toolCallId }                the full saved result of a chat tool call
 */
export async function POST(req: NextRequest) {
  const a = await requireAuth(req);
  if (a instanceof Response) return a;
  const { uid } = a;
  const body = await req.json().catch(() => ({})) as {
    op?: string; serverId?: string; uri?: string; name?: string; arguments?: Record<string, unknown>; toolCallId?: string;
  };

  if (body.op === 'result') {
    if (!body.toolCallId || !/^[\w-]{1,200}$/.test(body.toolCallId)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
    const snap = await adminDb.collection('users').doc(uid).collection('toolResults').doc(body.toolCallId).get();
    if (!snap.exists) return NextResponse.json({ result: null });
    const d = snap.data()!;
    return NextResponse.json({ result: JSON.parse(String(d.result ?? 'null')), args: JSON.parse(String(d.args ?? 'null')) });
  }

  if (!body.serverId) return NextResponse.json({ error: 'serverId required' }, { status: 400 });

  // Widgets can call tools in a loop; bound it like every other surface.
  if (body.op === 'call' && !(await rateLimitHourly(uid, 120))) {
    return NextResponse.json({ error: 'widget_rate_limited' }, { status: 429 });
  }

  let host;
  try {
    ({ host } = await connectServerById(uid, body.serverId));
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 400 });
  }

  try {
    if (body.op === 'resource') {
      if (!body.uri?.startsWith('ui://')) return NextResponse.json({ error: 'not a ui:// resource' }, { status: 400 });
      const r = await host.client.readResource({ uri: body.uri });
      const c = r.contents.find(x => x.uri === body.uri) ?? r.contents[0];
      const html = c && 'text' in c ? c.text : c && 'blob' in c ? Buffer.from(c.blob, 'base64').toString('utf8') : '';
      if (!html) return NextResponse.json({ error: 'empty widget' }, { status: 502 });
      if (c.mimeType && !c.mimeType.startsWith('text/html')) return NextResponse.json({ error: `unsupported widget type ${c.mimeType}` }, { status: 415 });
      return NextResponse.json({ html, mimeType: c.mimeType ?? MCP_APP_MIME, meta: (c._meta as Record<string, unknown> | undefined)?.ui ?? null });
    }

    if (body.op === 'call') {
      if (!body.name) return NextResponse.json({ error: 'name required' }, { status: 400 });
      // Only tools this server actually lists, any visibility (widget-only tools are the point).
      const { tools } = await host.client.listTools();
      const t = tools.find(x => x.name === body.name);
      if (!t) return NextResponse.json({ error: 'unknown tool' }, { status: 404 });
      const result = await host.client.callTool(
        { name: body.name, arguments: body.arguments ?? {} },
        undefined,
        { timeout: 280_000, resetTimeoutOnProgress: true, onprogress: () => {} },
      );
      return NextResponse.json({ result });
    }

    return NextResponse.json({ error: 'unknown op' }, { status: 400 });
  } catch (e) {
    console.error('[mcp/ui]', body.op, String(e));
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 300) }, { status: 502 });
  } finally {
    host.close().catch(() => {});
  }
}
