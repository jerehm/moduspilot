import { adminDb } from './firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

// Transport the plugin's MCP endpoint speaks. Legacy servers (no field stored)
// were all added over SSE, so an absent value defaults to 'sse'.
export type McpTransport = 'sse' | 'http';

/** 'oauth' = signs in through lib/mcp/oauth.ts; absent = static header or none. */
export type McpAuthType = 'oauth' | 'header';

export interface McpServer {
  id: string;
  name: string;
  url: string;
  authHeader?: string;
  transport: McpTransport;
  authType: McpAuthType;
  /** OAuth only. Chat skips anything but 'connected'. */
  authStatus?: 'connected' | 'pending' | 'needs_reconnect';
  /** OAuth only: the callback the client was registered with. */
  redirectUri?: string;
  /** Directory id when added from the directory ("pika"). */
  directoryId?: string;
  createdAt: string;
}

// Every chat message read this collection, even for the majority of users who
// have zero plugins. Cache per-uid on the warm lambda. Writes go through
// add/remove below, which invalidate this instance's entry; another warm
// instance can still serve a stale list until its TTL lapses, so a just-added
// plugin may take up to CACHE_TTL_MS to appear in chat. Acceptable at 60s —
// don't raise the TTL without revisiting that.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { servers: McpServer[]; exp: number }>();

export function invalidateMcpServers(uid: string): void {
  cache.delete(uid);
}

export async function getMcpServers(uid: string): Promise<McpServer[]> {
  const hit = cache.get(uid);
  if (hit && hit.exp > Date.now()) return hit.servers;

  const snap = await adminDb.collection('users').doc(uid).collection('mcpServers').get();
  const servers = snap.docs.map(d => ({
    id: d.id,
    name: d.data().name as string,
    url: d.data().url as string,
    authHeader: d.data().authHeader as string | undefined,
    transport: (d.data().transport as McpTransport) ?? 'sse',
    authType: (d.data().authType as McpAuthType) ?? 'header',
    authStatus: d.data().authStatus as McpServer['authStatus'],
    redirectUri: d.data().redirectUri as string | undefined,
    directoryId: d.data().directoryId as string | undefined,
    createdAt: d.data().createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
  }));
  // Caching the empty result is the point: it's the common case.
  cache.set(uid, { servers, exp: Date.now() + CACHE_TTL_MS });
  return servers;
}

export async function addMcpServer(uid: string, server: { name: string; url: string; authHeader?: string; transport?: McpTransport }): Promise<string> {
  const ref = await adminDb.collection('users').doc(uid).collection('mcpServers').add({
    name: server.name,
    url: server.url,
    authHeader: server.authHeader ?? null,
    transport: server.transport ?? 'http',
    createdAt: FieldValue.serverTimestamp(),
  });
  invalidateMcpServers(uid);
  return ref.id;
}

/** Creates (or reuses, by URL) an OAuth connector record in 'pending'. */
export async function upsertOAuthMcpServer(
  uid: string,
  server: { name: string; url: string; redirectUri: string; directoryId?: string },
): Promise<string> {
  const col = adminDb.collection('users').doc(uid).collection('mcpServers');
  const existing = await col.where('url', '==', server.url).limit(1).get();
  const fields = {
    name: server.name,
    url: server.url,
    transport: 'http' as const,
    authType: 'oauth' as const,
    redirectUri: server.redirectUri,
    ...(server.directoryId ? { directoryId: server.directoryId } : {}),
  };
  let id: string;
  if (!existing.empty) {
    id = existing.docs[0].id;
    // Keep a working grant working while the user re-consents.
    const status = existing.docs[0].data().authStatus === 'connected' ? 'connected' : 'pending';
    await existing.docs[0].ref.set({ ...fields, authHeader: null, authStatus: status }, { merge: true });
  } else {
    const ref = await col.add({ ...fields, authHeader: null, authStatus: 'pending', createdAt: FieldValue.serverTimestamp() });
    id = ref.id;
  }
  invalidateMcpServers(uid);
  return id;
}

export async function removeMcpServer(uid: string, serverId: string): Promise<void> {
  // Tokens live in a subcollection, which a parent delete does not remove.
  await adminDb.collection('users').doc(uid).collection('mcpServers').doc(serverId).collection('private').doc('oauth').delete().catch(() => {});
  await adminDb.collection('users').doc(uid).collection('mcpServers').doc(serverId).delete();
  invalidateMcpServers(uid);
}
