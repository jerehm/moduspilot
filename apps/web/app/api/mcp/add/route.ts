import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { addMcpServer, getMcpServers, type McpTransport } from '@/lib/mcp-servers';
import { assertPublicUrl } from '@/lib/ssrf';
import { MAX_MCP_SERVERS as MAX_SERVERS, MCP_PLAN_REQUIRED, mcpAllowed } from '@/lib/mcp/plan-gate';

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { uid } = auth;
  if (!(await mcpAllowed(uid))) return MCP_PLAN_REQUIRED();

  const { name, url, authHeader, transport } = await req.json() as { name: string; url: string; authHeader?: string; transport?: McpTransport };
  if (!name?.trim() || !url?.trim()) {
    return NextResponse.json({ error: 'Name and URL are required' }, { status: 400 });
  }
  const tp: McpTransport = transport === 'sse' ? 'sse' : 'http';

  try { await assertPublicUrl(url); } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid URL' }, { status: 400 });
  }

  const existing = await getMcpServers(uid);
  if (existing.length >= MAX_SERVERS) {
    return NextResponse.json({ error: `Maximum ${MAX_SERVERS} MCP servers allowed` }, { status: 400 });
  }

  const id = await addMcpServer(uid, { name: name.trim(), url: url.trim(), authHeader: authHeader?.trim() || undefined, transport: tp });
  return NextResponse.json({ id });
}
