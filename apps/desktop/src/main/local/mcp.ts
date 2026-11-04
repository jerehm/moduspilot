import { execFileSync } from 'child_process';
import crypto from 'crypto';
import log from 'electron-log';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getLocalMcpAllowed, getLocalMcpServers, setLocalMcpAllowed, setLocalMcpServers, type LocalMcpServerConfig } from '../settings';
import { ask } from './guard';

/**
 * Local (stdio) MCP servers: programs on this Mac the model can use, the way
 * Claude Desktop runs them.
 *
 * Two consents, both native dialogs the web page cannot click for the user:
 *  - adding a server shows the exact command it will run;
 *  - the first call of each tool asks Allow once / Always allow / Deny.
 * Processes start on first use and stop after 10 idle minutes or on quit.
 */
const IDLE_MS = 10 * 60_000;
const CALL_MS = 120_000;
const LIST_MS = 30_000;

interface Live { client: Client; transport: StdioClientTransport; idle?: NodeJS.Timeout }
const live = new Map<string, Live>();

export class LocalMcpError extends Error {}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) || 'server';

/** Apps opened from Finder get a bare PATH, so "npx" or "uvx" is not found. Use the login shell's. */
let shellPath: string | null = null;
function loginPath(): string {
  if (shellPath !== null) return shellPath;
  try {
    const sh = process.env.SHELL || '/bin/zsh';
    shellPath = execFileSync(sh, ['-ilc', 'printf %s "$PATH"'], { timeout: 5000, encoding: 'utf8' }).trim();
  } catch { shellPath = ''; }
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  shellPath = [...new Set([...(shellPath || process.env.PATH || '').split(':'), ...extra].filter(Boolean))].join(':');
  return shellPath;
}

export function listServers(): (LocalMcpServerConfig & { running: boolean })[] {
  return getLocalMcpServers().map(s => ({ ...s, env: s.env ? Object.fromEntries(Object.keys(s.env).map(k => [k, '••••'])) : undefined, running: live.has(s.id) }));
}

export async function addServer(input: unknown): Promise<LocalMcpServerConfig> {
  const i = (input ?? {}) as { name?: unknown; command?: unknown; args?: unknown; env?: unknown };
  const name = String(i.name ?? '').trim().slice(0, 40);
  const command = String(i.command ?? '').trim();
  const args = Array.isArray(i.args) ? i.args.map(a => String(a)).slice(0, 40) : [];
  const env = i.env && typeof i.env === 'object' ? Object.fromEntries(Object.entries(i.env as Record<string, unknown>).slice(0, 30).map(([k, v]) => [k.slice(0, 80), String(v)])) : undefined;
  if (!name || !command) throw new LocalMcpError('A name and a command are required.');
  const choice = await ask({
    message: `Run "${name}" on this Mac?`,
    detail: `MODUS will start this program when the model needs it:\n\n${command} ${args.join(' ')}${env ? `\n\nWith settings: ${Object.keys(env).join(', ')}` : ''}\n\nOnly add programs you trust.`,
    buttons: ['Add server', 'Cancel'],
    cancelId: 1,
  });
  if (choice !== 0) throw new LocalMcpError('Not added.');
  const cfg: LocalMcpServerConfig = { id: crypto.randomUUID(), name, command, args, env };
  setLocalMcpServers([...getLocalMcpServers(), cfg]);
  log.info(`[local-mcp] added ${name}: ${command} ${args.join(' ')}`);
  return cfg;
}

export async function removeServer(id: string): Promise<void> {
  await stop(id);
  setLocalMcpServers(getLocalMcpServers().filter(s => s.id !== id));
  const allowed = getLocalMcpAllowed();
  delete allowed[id];
  setLocalMcpAllowed(allowed);
}

async function stop(id: string) {
  const l = live.get(id);
  if (!l) return;
  live.delete(id);
  if (l.idle) clearTimeout(l.idle);
  await l.client.close().catch(() => {});
}

export async function stopAll(): Promise<void> {
  await Promise.all([...live.keys()].map(stop));
}

function touch(id: string) {
  const l = live.get(id);
  if (!l) return;
  if (l.idle) clearTimeout(l.idle);
  l.idle = setTimeout(() => { log.info(`[local-mcp] ${id} idle, stopping`); void stop(id); }, IDLE_MS);
}

// One start per server at a time. toolDefs runs on every window focus, and two
// quick focuses used to spawn the same server twice, leaving an orphan process.
const starting = new Map<string, Promise<Client>>();

async function connect(cfg: LocalMcpServerConfig): Promise<Client> {
  const have = live.get(cfg.id);
  if (have) { touch(cfg.id); return have.client; }
  const pending = starting.get(cfg.id);
  if (pending) return pending;
  const p = start(cfg).finally(() => starting.delete(cfg.id));
  starting.set(cfg.id, p);
  return p;
}

async function start(cfg: LocalMcpServerConfig): Promise<Client> {
  const transport = new StdioClientTransport({
    command: cfg.command,
    args: cfg.args,
    env: { ...(process.env as Record<string, string>), PATH: loginPath(), ...(cfg.env ?? {}) },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (d: Buffer) => log.info(`[local-mcp:${cfg.name}] ${String(d).trim().slice(0, 500)}`));
  const client = new Client({ name: 'MODUS Desktop', version: '1.0.0' });
  try {
    await client.connect(transport);
  } catch (e) {
    // A server that fails to start must not leave its process behind.
    await transport.close().catch(() => {});
    throw e;
  }
  transport.onclose = () => { live.delete(cfg.id); };
  live.set(cfg.id, { client, transport });
  touch(cfg.id);
  log.info(`[local-mcp] started ${cfg.name}`);
  return client;
}

export interface LocalToolDef { name: string; description: string; inputSchema: Record<string, unknown>; server: string }

const toolIndex = new Map<string, { serverId: string; tool: string }>();

/** Tool definitions across every added server, named local__<server>__<tool>. */
export async function listTools(): Promise<LocalToolDef[]> {
  const out: LocalToolDef[] = [];
  await Promise.all(getLocalMcpServers().map(async cfg => {
    try {
      const client = await Promise.race([connect(cfg), new Promise<never>((_, r) => setTimeout(() => r(new Error('start timeout')), LIST_MS))]);
      const { tools } = await client.listTools(undefined, { timeout: LIST_MS });
      for (const t of tools.slice(0, 40)) {
        const name = `local__${slug(cfg.name)}__${t.name.replace(/[^\w-]/g, '_')}`.slice(0, 64);
        toolIndex.set(name, { serverId: cfg.id, tool: t.name });
        out.push({ name, description: (t.description ?? '').slice(0, 1000), inputSchema: t.inputSchema as Record<string, unknown>, server: cfg.name });
      }
    } catch (e) {
      log.warn(`[local-mcp] ${cfg.name} tools failed: ${String(e).slice(0, 200)}`);
    }
  }));
  return out;
}

export function isLocalMcpTool(name: string): boolean {
  return toolIndex.has(name);
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const hit = toolIndex.get(name);
  if (!hit) throw new LocalMcpError(`Unknown local tool ${name}.`);
  const cfg = getLocalMcpServers().find(s => s.id === hit.serverId);
  if (!cfg) throw new LocalMcpError('That local server was removed.');
  const allowed = getLocalMcpAllowed();
  if (!(allowed[cfg.id] ?? []).includes(hit.tool)) {
    const choice = await ask({
      message: `Let MODUS use "${hit.tool}" from ${cfg.name}?`,
      detail: `Input:\n${JSON.stringify(args, null, 2).slice(0, 800)}`,
      buttons: ['Allow once', 'Always allow', 'Deny'],
      cancelId: 2,
    });
    if (choice === 2) return { isError: true, content: [{ type: 'text', text: 'The user denied this tool call.' }] };
    if (choice === 1) setLocalMcpAllowed({ ...allowed, [cfg.id]: [...(allowed[cfg.id] ?? []), hit.tool] });
  }
  const client = await connect(cfg);
  try {
    return await client.callTool({ name: hit.tool, arguments: args }, undefined, { timeout: CALL_MS });
  } finally {
    touch(cfg.id);
  }
}
