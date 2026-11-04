import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { adminDb } from '@/lib/firebase-admin';
import { invalidateMcpServers } from '@/lib/mcp-servers';
import { FirestoreMcpOAuthProvider, MCP_NONCE_COOKIE, mcpRedirectUri, setMcpAuthStatus } from '@/lib/mcp/oauth';
import { safeFetch } from '@/lib/ssrf';
import { verifyOAuthState } from '@/lib/oauth-state';

export const maxDuration = 30;

/** The auth server sends the browser back here with ?code&state. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  // Every exit clears the nonce cookie, so a state works once per browser.
  const back = (q: string) => new Response(null, {
    status: 302,
    headers: {
      Location: `${u.origin}/capabilities?${q}`,
      'Set-Cookie': `${MCP_NONCE_COOKIE}=; Path=/api/mcp/oauth; Max-Age=0; HttpOnly; SameSite=Lax`,
    },
  });
  const code = u.searchParams.get('code');
  const verified = verifyOAuthState(u.searchParams.get('state'));
  if (!verified || !verified.origin?.startsWith('mcp:')) return back('error=mcp_state');
  const { uid } = verified;
  const [, serverId, nonce] = verified.origin.split(':');
  const cookieNonce = (req.headers.get('cookie') ?? '').split(/;\s*/).find(c => c.startsWith(`${MCP_NONCE_COOKIE}=`))?.slice(MCP_NONCE_COOKIE.length + 1);
  if (!serverId || !nonce || cookieNonce !== nonce) return back('error=mcp_state');
  if (u.searchParams.get('error') || !code) return back('error=mcp_denied');

  const snap = await adminDb.collection('users').doc(uid).collection('mcpServers').doc(serverId).get();
  if (!snap.exists) return back('error=mcp_missing');
  const url = snap.data()!.url as string;
  const name = String(snap.data()!.name ?? 'connector');

  const provider = new FirestoreMcpOAuthProvider(uid, serverId, mcpRedirectUri(u.origin), { interactive: true });
  try {
    const result = await auth(provider, { serverUrl: url, authorizationCode: code, fetchFn: safeFetch });
    if (result !== 'AUTHORIZED') throw new Error(`auth returned ${result}`);
    await setMcpAuthStatus(uid, serverId, 'connected');
    invalidateMcpServers(uid);
    return back(`mcp_connected=${encodeURIComponent(name)}`);
  } catch (e) {
    console.error('[mcp/oauth/callback]', name, String(e));
    return back(`error=mcp_failed&name=${encodeURIComponent(name)}`);
  }
}
