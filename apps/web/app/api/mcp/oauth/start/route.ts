import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { requireAuth } from '@/lib/api-auth';
import { getMcpServers, upsertOAuthMcpServer } from '@/lib/mcp-servers';
import { FirestoreMcpOAuthProvider, mcpRedirectUri, setMcpAuthStatus } from '@/lib/mcp/oauth';
import { signOAuthState } from '@/lib/oauth-state';
import crypto from 'crypto';
import { assertPublicUrl, safeFetch } from '@/lib/ssrf';
import { MAX_MCP_SERVERS as MAX_SERVERS, MCP_PLAN_REQUIRED, mcpAllowed } from '@/lib/mcp/plan-gate';
import { MCP_NONCE_COOKIE } from '@/lib/mcp/oauth';
import { PLUGIN_DIRECTORY } from '@/lib/plugin-directory';

// Discovery + registration talk to two foreign servers; give them room.
export const maxDuration = 30;

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
  if (!(await mcpAllowed(uid))) return MCP_PLAN_REQUIRED();

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
  // The nonce ties the consent round trip to THIS browser: it rides in the
  // signed state and in an httpOnly cookie, and the callback needs both to
  // match. Without it, a link from someone else's start would attach the
  // victim's connector account to the attacker's MODUS account.
  const nonce = crypto.randomBytes(16).toString('base64url');
  const provider = new FirestoreMcpOAuthProvider(uid, serverId, redirectUri, {
    state: signOAuthState({ uid, origin: `mcp:${serverId}:${nonce}` }),
    interactive: true,
  });

  try {
    const result = await auth(provider, { serverUrl: url, fetchFn: safeFetch });
    if (result === 'AUTHORIZED') {
      await setMcpAuthStatus(uid, serverId, 'connected');
      return NextResponse.json({ connected: true, id: serverId });
    }
    if (!provider.authorizationUrl) throw new Error('No authorization URL from the server');
    const res = NextResponse.json({ authUrl: provider.authorizationUrl.toString(), id: serverId });
    res.cookies.set(MCP_NONCE_COOKIE, nonce, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
      path: '/api/mcp/oauth', maxAge: 15 * 60,
    });
    return res;
  } catch (e) {
    // Details stay in the log: echoing upstream errors back let the response
    // be used to probe what sits behind the URLs a server names.
    console.error('[mcp/oauth/start]', name, String(e));
    return NextResponse.json({ error: `${name} did not accept a sign in from MODUS.` }, { status: 502 });
  }
}
