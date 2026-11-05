import { execFile } from 'child_process';
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
// Async, and a LOGIN shell without -i: the old execFileSync on `-ilc` ran the
// user's interactive .zshrc on the main thread, froze the whole app for up to
// 5s, and anything .zshrc printed ended up inside PATH. Markers fence the value.
let shellPath: Promise<string> | null = null;
function loginPath(): Promise<string> {
  if (shellPath) return shellPath;
  shellPath = new Promise<string>(resolve => {
    const sh = process.env.SHELL || '/bin/zsh';
    execFile(sh, ['-lc', 'printf "__MODUS_PATH__%s__MODUS_PATH__" "$PATH"'], { timeout: 5000, encoding: 'utf8' }, (_err, stdout) => {
      const found = /__MODUS_PATH__(.*?)__MODUS_PATH__/s.exec(String(stdout ?? ''))?.[1]?.trim() ?? '';
      const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
      resolve([...new Set([...(found || process.env.PATH || '').split(':'), ...extra].filter(Boolean))].join(':'));
    });
  });
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
  // These change what a trusted-looking command actually loads, so the dialog
  // could show "npx some-real-server" while running anything.
  const blocked = Object.keys(env ?? {}).filter(k => /^(NODE_OPTIONS|NODE_PATH|DYLD_.*|LD_.*|PYTHONSTARTUP|PYTHONPATH|PERL5OPT|RUBYOPT|BASH_ENV|ENV|PATH)$/i.test(k));
  if (blocked.length) throw new LocalMcpError(`These settings are not allowed for a local server: ${blocked.join(', ')}.`);
  // One line per thing, control characters removed, so the text cannot be
  // laid out to hide part of the command.
  const flat = (v: string) => v.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 300);
  const envLines = env ? Object.entries(env).map(([k, v]) => `${flat(k)}=${flat(v)}`).join('\n') : '';
  const choice = await ask({
    message: `Run "${flat(name)}" on this Mac?`,
    detail: `MODUS will start this program when the model needs it:\n\n${[command, ...args].map(flat).join(' ')}${envLines ? `\n\nWith settings:\n${envLines}` : ''}\n\nOnly add programs you trust.`,
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

/**
 * Close a transport and make sure its process is really gone. The SDK's close
 * only signals the child; a server that ignores SIGTERM (found by test: a
 * server whose start timed out) stayed alive for the rest of the session.
 */
async function hardClose(transport: StdioClientTransport): Promise<void> {
  const pid = transport.pid;
  await transport.close().catch(() => {});
  if (typeof pid !== 'number') return;
  setTimeout(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }, 2000).unref?.();
}

async function stop(id: string) {
  const l = live.get(id);
  if (!l) return;
  live.delete(id);
  if (l.idle) clearTimeout(l.idle);
  await l.client.close().catch(() => {});
  await hardClose(l.transport);
}

/** True while any local server process exists, running or starting. */
export function hasRunning(): boolean {
  return live.size > 0 || startingTransports.size > 0;
}

/**
 * Quit path. Kills every server process right away, including ones still
 * starting. The old version first awaited servers that were still starting (the
 * SDK's initialize timeout is 60s) and then the SDK's close() (2s, SIGTERM, 2s,
 * SIGKILL), so the 3s quit cap fired first and children outlived the app.
 */
export async function stopAll(): Promise<void> {
  const transports = [...[...live.values()].map(l => l.transport), ...startingTransports];
  for (const l of live.values()) if (l.idle) clearTimeout(l.idle);
  live.clear();
  const pids = transports.map(t => t.pid).filter((p): p is number => typeof p === 'number');
  for (const t of transports) void t.close().catch(() => {});
  for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
  await new Promise(r => setTimeout(r, 1200));
  for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
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
// Transports between spawn and a finished connect, so quit can kill them too.
const startingTransports = new Set<StdioClientTransport>();

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
    env: { ...(process.env as Record<string, string>), PATH: await loginPath(), ...(cfg.env ?? {}) },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (d: Buffer) => log.info(`[local-mcp:${cfg.name}] ${String(d).trim().slice(0, 500)}`));
  const client = new Client({ name: 'MODUS Desktop', version: '1.0.0' });
  // Set BEFORE connect: the SDK chains a handler that was already there. Set
  // after, it replaced the SDK's own, so a server that crashed mid-call left the
  // pending callTool waiting out the full 120s instead of failing at once.
  transport.onclose = () => { live.delete(cfg.id); };
  startingTransports.add(transport);
  try {
    await client.connect(transport);
  } catch (e) {
    // A server that fails to start must not leave its process behind.
    await hardClose(transport);
    throw e;
  } finally {
    startingTransports.delete(transport);
  }
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
  // Two servers whose names slug the same ("GitHub", "git-hub") used to emit
  // identical tool names, and calls went to whichever listed last.
  const used = new Set<string>();
  const unique = (base: string) => {
    let n = base, i = 2;
    while (used.has(n)) { const sfx = `_${i++}`; n = base.slice(0, 64 - sfx.length) + sfx; }
    used.add(n);
    return n;
  };
  await Promise.all(getLocalMcpServers().map(async cfg => {
    try {
      const client = await Promise.race([connect(cfg), new Promise<never>((_, r) => setTimeout(() => r(new Error('start timeout')), LIST_MS))]);
      const { tools } = await client.listTools(undefined, { timeout: LIST_MS });
      for (const t of tools.slice(0, 40)) {
        const name = unique(`local__${slug(cfg.name)}__${t.name.replace(/[^\w-]/g, '_')}`.slice(0, 64));
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
