import { experimental_createMCPClient, type MCPTransport } from 'ai';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { McpTransport } from './mcp-servers';

// Builds the transport arg for `experimental_createMCPClient` for a plugin's
// endpoint. SSE uses the AI SDK's built-in transport; HTTP (Streamable HTTP,
// the modern MCP transport) uses the official MCP SDK's transport, which
// implements the same start/send/close interface AI SDK's client drives.
// Auth, when present, is sent as an `Authorization` header.
export function buildMcpTransport(opts: {
  url: string;
  authHeader?: string;
  transport: McpTransport;
  /** OAuth connectors: the SDK attaches the bearer and refreshes it on 401. */
  authProvider?: OAuthClientProvider;
}) {
  const headers = opts.authHeader ? { Authorization: opts.authHeader } : undefined;

  if (opts.transport === 'http' || opts.authProvider) {
    // The SDK transport's send() accepts a superset of AI SDK's message type;
    // the runtime contract (start/send/close/onmessage) matches, so cast.
    return new StreamableHTTPClientTransport(new URL(opts.url), {
      requestInit: headers ? { headers } : undefined,
      authProvider: opts.authProvider,
    }) as unknown as MCPTransport;
  }

  return { type: 'sse' as const, url: opts.url, headers };
}

// Connects to a plugin endpoint and returns its client (throws on failure).
export function connectMcpClient(opts: {
  url: string;
  authHeader?: string;
  transport: McpTransport;
  authProvider?: OAuthClientProvider;
}) {
  return experimental_createMCPClient({ transport: buildMcpTransport(opts) });
}
