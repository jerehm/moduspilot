// Local (stdio) MCP test server for the desktop bridge: one echo tool.
//   node scripts/dev-stdio-echo.mjs   (spawned by MODUS Desktop as a local plugin)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'echo-lab', version: '1.0.0' });
server.registerTool('echo', {
  description: 'Echo text back, prefixed so the caller can tell it ran locally.',
  inputSchema: { text: z.string() },
}, async ({ text }) => ({ content: [{ type: 'text', text: `echo from this Mac: ${text}` }] }));
await server.connect(new StdioServerTransport());
