import { jsonSchema, tool } from 'ai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import type { McpTransport } from '../mcp-servers';

/**
 * MODUS as an MCP host, on the MCP SDK's own Client.
 *
 * This replaces `experimental_createMCPClient` from ai@4 for one reason: that
 * client sends fixed capabilities, so it can never announce MCP Apps support,
 * and servers like Higgsfield only attach widgets (`_meta.ui.resourceUri`) for
 * clients that announce it. It also dropped `_meta` from every tool.
 *
 * `tools()` reproduces the AI SDK's conversion exactly (same jsonSchema
 * wrapper, same `additionalProperties: false`, result = the raw CallToolResult)
 * so sanitizeMcpToolSchemas, makeToolErrorsNonFatal and the tool activity
 * records keep working unchanged.
 */

export const MCP_APPS_EXTENSION = 'io.modelcontextprotocol/ui';
export const MCP_APP_MIME = 'text/html;profile=mcp-app';

export interface ToolUi {
  /** ui:// resource holding the widget HTML. */
  uri: string;
  /** False for tools only the widget may call (visibility: ["app"]). */
  modelVisible: boolean;
}

/** Reads the widget pointer off a tool, modern (`_meta.ui`) or legacy key. */
export function toolUi(t: Pick<McpTool, '_meta'>): ToolUi | null {
  const meta = (t._meta ?? {}) as Record<string, unknown>;
  const ui = (meta.ui ?? {}) as { resourceUri?: unknown; visibility?: unknown };
  const uri = typeof ui.resourceUri === 'string' ? ui.resourceUri
    : typeof meta['ui/resourceUri'] === 'string' ? (meta['ui/resourceUri'] as string)
    : null;
  const visibility = Array.isArray(ui.visibility) ? (ui.visibility as string[]) : null;
  const modelVisible = !visibility || visibility.includes('model');
  if (!uri) return modelVisible ? null : { uri: '', modelVisible };
  return { uri, modelVisible };
}

export interface McpHost {
  client: Client;
  /** AI SDK tools for the model (widget-only tools excluded). */
  tools(): Promise<Record<string, unknown>>;
  /** Tool name to widget, for every tool that has one. Filled by tools(). */
  uiByTool: Record<string, ToolUi>;
  close(): Promise<void>;
}

export async function connectMcpHost(opts: {
  url: string;
  authHeader?: string;
  transport: McpTransport;
  authProvider?: OAuthClientProvider;
  /**
   * Epoch ms by which every tool call must be done (the request's own time
   * limit, minus room to answer). A call gets only what is left, so a long
   * generation cannot run the function past its limit and cut the reply off.
   */
  deadlineAt?: number;
}): Promise<McpHost> {
  const headers = opts.authHeader ? { Authorization: opts.authHeader } : undefined;
  const url = new URL(opts.url);
  const transport = opts.transport === 'sse' && !opts.authProvider
    ? new SSEClientTransport(url, { requestInit: headers ? { headers } : undefined })
    : new StreamableHTTPClientTransport(url, {
        requestInit: headers ? { headers } : undefined,
        authProvider: opts.authProvider,
      });

  const client = new Client(
    { name: 'MODUS', version: '1.0.0' },
    { capabilities: { extensions: { [MCP_APPS_EXTENSION]: { mimeTypes: [MCP_APP_MIME] } } } },
  );
  await client.connect(transport);

  const uiByTool: Record<string, ToolUi> = {};
  return {
    client,
    uiByTool,
    async tools() {
      const out: Record<string, unknown> = {};
      const { tools } = await client.listTools();
      for (const t of tools) {
        const ui = toolUi(t);
        if (ui?.uri) uiByTool[t.name] = ui;
        if (ui && !ui.modelVisible) continue;
        out[t.name] = tool({
          description: t.description,
          parameters: jsonSchema({
            ...(t.inputSchema as Record<string, unknown>),
            properties: (t.inputSchema as { properties?: unknown }).properties ?? {},
            additionalProperties: false,
          } as Parameters<typeof jsonSchema>[0]),
          execute: async (args, options) => {
            options?.abortSignal?.throwIfAborted();
            const left = opts.deadlineAt ? opts.deadlineAt - Date.now() : 280_000;
            if (left < 10_000) {
              return {
                isError: true,
                content: [{ type: 'text', text: 'Out of time on this turn. Tell the user what finished so far and that they can say "continue" to pick it up.' }],
              };
            }
            return client.callTool(
              { name: t.name, arguments: args as Record<string, unknown> },
              undefined,
              // Generation servers block for minutes and stream progress; the
              // SDK's 60s default would cut them off. The route's maxDuration
              // is the real ceiling.
              {
                signal: options?.abortSignal,
                timeout: Math.min(280_000, left),
                // Progress may extend a call, but never past the deadline.
                resetTimeoutOnProgress: true,
                maxTotalTimeout: Math.min(280_000, left),
                onprogress: () => {},
              },
            );
          },
        });
      }
      return out;
    },
    async close() {
      await client.close();
    },
  };
}
