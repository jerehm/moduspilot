import type { McpTransport } from './mcp-servers';

// Curated starter plugins. Each connects over MCP. `tokenless` entries are
// verified public servers that add in one tap; others prefill the add form and
// ask the user to paste a token. `url` empty => opens a blank custom form.
// URLs here were live-verified to return tools; never ship an unverified URL.
export type PluginTemplate = {
  id: string;
  name: string;
  description: string;
  category: string;
  transport: McpTransport;
  url?: string;
  tokenless?: boolean;
  /** Signs in with OAuth (discovery + dynamic registration). See lib/mcp/oauth.ts. */
  oauth?: boolean;
  authLabel?: string;        // e.g. "GitHub token"
  authPlaceholder?: string;  // e.g. "Bearer ghp_…"
  docsUrl?: string;
};

export const PLUGIN_DIRECTORY: PluginTemplate[] = [
  // OAuth connectors. Both verified 2026-11-03: 401 with a resource_metadata
  // pointer, protected-resource metadata, and a registration_endpoint (DCR).
  {
    id: 'pika',
    name: 'Pika',
    description: 'Generate and edit images, video, music and voice from chat.',
    category: 'Create',
    transport: 'http',
    url: 'https://mcp.pika.me/api/mcp',
    oauth: true,
    docsUrl: 'https://pika.me',
  },
  {
    id: 'higgsfield',
    name: 'Higgsfield',
    description: 'Image and video generation with Higgsfield models.',
    category: 'Create',
    transport: 'http',
    url: 'https://mcp.higgsfield.ai/mcp',
    oauth: true,
    docsUrl: 'https://higgsfield.ai',
  },
  {
    id: 'deepwiki',
    name: 'DeepWiki',
    description: 'Ask questions about any public GitHub repo: its code, architecture and docs.',
    category: 'Knowledge',
    transport: 'http',
    url: 'https://mcp.deepwiki.com/mcp',
    tokenless: true,
    docsUrl: 'https://docs.devin.ai/work-with-devin/deepwiki-mcp',
  },
  {
    id: 'gitmcp',
    name: 'GitMCP',
    description: 'Docs and code search for popular open source libraries.',
    category: 'Knowledge',
    transport: 'http',
    url: 'https://gitmcp.io/docs',
    tokenless: true,
    docsUrl: 'https://gitmcp.io',
  },
  {
    id: 'mslearn',
    name: 'Microsoft Learn',
    description: 'Search official Microsoft, Azure and .NET documentation.',
    category: 'Knowledge',
    transport: 'http',
    url: 'https://learn.microsoft.com/api/mcp',
    tokenless: true,
    docsUrl: 'https://learn.microsoft.com/training/support/mcp',
  },
  {
    id: 'custom',
    name: 'Custom server',
    description: 'Connect any MCP server. Paste its endpoint and an optional token.',
    category: 'Custom',
    transport: 'http',
    docsUrl: 'https://github.com/sylviangth/awesome-remote-mcp-servers',
  },
];

// Link users to a broader community list rather than pretending to be exhaustive.
export const PLUGIN_DIRECTORY_MORE_URL = 'https://github.com/sylviangth/awesome-remote-mcp-servers';
