import { getMcpServers, type McpServer } from '../mcp-servers';
import { assertPublicUrl } from '../ssrf';
import { connectMcpHost, type McpHost } from './host';
import { FirestoreMcpOAuthProvider } from './oauth';

/**
 * Connects to one of the user's connectors by id, with the same auth the chat
 * uses. For widget traffic (resource reads, widget tool calls), which happens
 * outside a chat turn.
 */
export async function connectServerById(uid: string, serverId: string): Promise<{ server: McpServer; host: McpHost }> {
  const server = (await getMcpServers(uid)).find(s => s.id === serverId);
  if (!server) throw new Error('connector_not_found');
  if (server.authType === 'oauth' && server.authStatus !== 'connected') throw new Error('connector_not_signed_in');
  await assertPublicUrl(server.url);
  const host = await connectMcpHost({
    url: server.url,
    authHeader: server.authHeader,
    transport: server.transport,
    authProvider: server.authType === 'oauth'
      ? new FirestoreMcpOAuthProvider(uid, server.id, server.redirectUri ?? '', { interactive: false })
      : undefined,
  });
  return { server, host };
}
