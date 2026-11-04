import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { requireAuth } from '@/lib/api-auth';
import { getMcpServers, upsertOAuthMcpServer } from '@/lib/mcp-servers';
import { FirestoreMcpOAuthProvider, mcpRedirectUri, setMcpAuthStatus } from '@/lib/mcp/oauth';
import { signOAuthState } from '@/lib/oauth-state';
import { assertPublicUrl } from '@/lib/ssrf';
import { PLUGIN_DIRECTORY } from '@/lib/plugin-directory';

// Discovery + registration talk to two foreign servers; give them room.
export const maxDuration = 30;

const MAX_SERVERS = 25;

/**
 * Starts a connector sign-in. Body: { directoryId } for a listed connector, or
 * { name, url } for any MCP server that supports OAuth.
 * Returns { authUrl } to send the browser to, or { connected: true } when the
 * grant we hold still works (or the server needs no sign-in at all).
 */
export async function POST(req: NextRequest) {
  const a = await requireAuth(req);
  if (a instanceof Response) return a;
  const { uid } = a;

  const body = await req.json().catch(() => ({})) as { directoryId?: string; name?: string; url?: string };
  const listed = body.directoryId ? PLUGIN_DIRECTORY.find(d => d.id === body.directoryId && d.url && d.oauth) : undefined;
  const name = (listed?.name ?? body.name ?? '').trim();
  const url = (listed?.url ?? body.url ?? '').trim();
  if (!name || !url) return NextResponse.json({ error: 'Name and URL are required' }, { status: 400 });

  try { await assertPublicUrl(url); } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid URL' }, { status: 400 });
  }
  const existing = await getMcpServers(uid);
  if (!existing.some(s => s.url === url) && existing.length >= MAX_SERVERS) {
    return NextResponse.json({ error: `Maximum ${MAX_SERVERS} connectors allowed` }, { status: 400 });
  }

  const redirectUri = mcpRedirectUri(new URL(req.url).origin);
  const serverId = await upsertOAuthMcpServer(uid, { name, url, redirectUri, directoryId: listed?.id });
  const provider = new FirestoreMcpOAuthProvider(uid, serverId, redirectUri, {
    state: signOAuthState({ uid, origin: `mcp:${serverId}` }),
    interactive: true,
  });

  try {
    const result = await auth(provider, { serverUrl: url });
    if (result === 'AUTHORIZED') {
      await setMcpAuthStatus(uid, serverId, 'connected');
      return NextResponse.json({ connected: true, id: serverId });
    }
    if (!provider.authorizationUrl) throw new Error('No authorization URL from the server');
    return NextResponse.json({ authUrl: provider.authorizationUrl.toString(), id: serverId });
  } catch (e) {
    console.error('[mcp/oauth/start]', name, String(e));
    return NextResponse.json(
      { error: `${name} did not accept a sign in from MODUS. ${String(e instanceof Error ? e.message : e).slice(0, 160)}` },
      { status: 502 },
    );
  }
}
