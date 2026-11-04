import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { listCatalog } from '@/lib/mcp/catalog';
import { connectServerById } from '@/lib/mcp/connect-server';
import { MCP_PLAN_REQUIRED, mcpAllowed } from '@/lib/mcp/plan-gate';

export const maxDuration = 30;

const RESOURCE_CAP = 200_000;

/**
 * GET                                       prompts + resources across connectors
 * POST { op: 'prompt', serverId, name, arguments }   prompt rendered to text
 * POST { op: 'resource', serverId, uri }             a text resource's content
 */
export async function GET(req: NextRequest) {
  const a = await requireAuth(req);
  if (a instanceof Response) return a;
  // Free accounts get an empty catalog, not an error: the slash menu just
  // shows nothing from connectors.
  if (!(await mcpAllowed(a.uid))) return NextResponse.json({ prompts: [], resources: [] });
  const fresh = new URL(req.url).searchParams.get('fresh') === '1';
  const { prompts, resources } = await listCatalog(a.uid, { fresh });
  return NextResponse.json({ prompts, resources });
}

export async function POST(req: NextRequest) {
  const a = await requireAuth(req);
  if (a instanceof Response) return a;
  if (!(await mcpAllowed(a.uid))) return MCP_PLAN_REQUIRED();
  const b = await req.json().catch(() => ({})) as { op?: string; serverId?: string; name?: string; uri?: string; arguments?: Record<string, unknown> };
  if (!b.serverId) return NextResponse.json({ error: 'serverId required' }, { status: 400 });
  let host;
  try {
    ({ host } = await connectServerById(a.uid, b.serverId));
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 400 });
  }
  try {
    if (b.op === 'prompt') {
      if (!b.name) return NextResponse.json({ error: 'name required' }, { status: 400 });
      const args = Object.fromEntries(Object.entries(b.arguments ?? {}).map(([k, v]) => [k, String(v ?? '')]));
      const r = await host.client.getPrompt({ name: b.name, arguments: args });
      // Prompt messages become composer text. Text parts join; embedded text
      // resources inline; images and audio are named, not pasted.
      const text = r.messages.map(m => {
        const c = m.content as { type: string; text?: string; resource?: { text?: string; uri?: string } };
        if (c.type === 'text') return c.text ?? '';
        if (c.type === 'resource') return c.resource?.text ?? `[${c.resource?.uri ?? 'resource'}]`;
        return `[${c.type}]`;
      }).filter(Boolean).join('\n\n');
      return NextResponse.json({ text: text.slice(0, 20_000), description: r.description });
    }
    if (b.op === 'resource') {
      if (!b.uri || b.uri.startsWith('ui://')) return NextResponse.json({ error: 'bad uri' }, { status: 400 });
      const r = await host.client.readResource({ uri: b.uri });
      const parts = r.contents.map(c => ('text' in c && typeof c.text === 'string' ? c.text : '')).filter(Boolean);
      if (parts.length === 0) return NextResponse.json({ error: 'That resource is not text, so it cannot be attached.' }, { status: 415 });
      const text = parts.join('\n\n');
      return NextResponse.json({ text: text.slice(0, RESOURCE_CAP), truncated: text.length > RESOURCE_CAP });
    }
    return NextResponse.json({ error: 'unknown op' }, { status: 400 });
  } catch (e) {
    console.error('[mcp/catalog]', b.op, String(e));
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 200) }, { status: 502 });
  } finally {
    host.close().catch(() => {});
  }
}
