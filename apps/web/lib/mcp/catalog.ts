import { getMcpServers } from '../mcp-servers';
import { connectServerById } from './connect-server';

/**
 * Prompts and resources that connected MCP servers publish, for the composer's
 * slash menu and "Add from a plugin" picker.
 *
 * Listing means connecting to every server, so it is cached per user for five
 * minutes on the warm instance and each server gets a 5s cap. A server that
 * does not announce prompts or resources is skipped without a request.
 */
export interface PromptEntry {
  serverId: string;
  server: string;
  name: string;
  title?: string;
  description?: string;
  arguments: { name: string; description?: string; required?: boolean }[];
}

export interface ResourceEntry {
  serverId: string;
  server: string;
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

const TTL = 5 * 60_000;
const cache = new Map<string, { at: number; sig: string; prompts: PromptEntry[]; resources: ResourceEntry[] }>();

const within = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

export async function listCatalog(uid: string, opts: { fresh?: boolean } = {}) {
  const servers = (await getMcpServers(uid)).filter(s => s.authType !== 'oauth' || s.authStatus === 'connected');
  // Keyed on the current connector set: a removed or re-added connector has a
  // new id, and a cached entry pointing at the old one would fail every use.
  const sig = servers.map(s => s.id).sort().join(',');
  const hit = cache.get(uid);
  if (hit && !opts.fresh && hit.sig === sig && Date.now() - hit.at < TTL) return hit;
  const prompts: PromptEntry[] = [];
  const resources: ResourceEntry[] = [];
  await Promise.all(servers.map(async s => {
    let host;
    try {
      ({ host } = await within(connectServerById(uid, s.id), 5000));
      const caps = host.client.getServerCapabilities() ?? {};
      const [p, r] = await Promise.all([
        caps.prompts ? within(host.client.listPrompts(), 5000).catch(() => null) : null,
        caps.resources ? within(host.client.listResources(), 5000).catch(() => null) : null,
      ]);
      for (const x of p?.prompts ?? []) {
        prompts.push({ serverId: s.id, server: s.name, name: x.name, title: x.title, description: x.description, arguments: (x.arguments ?? []).map(a => ({ name: a.name, description: a.description, required: a.required })) });
      }
      for (const x of r?.resources ?? []) {
        // Widgets (ui://) are not context to attach.
        if (x.uri.startsWith('ui://')) continue;
        resources.push({ serverId: s.id, server: s.name, uri: x.uri, name: x.title ?? x.name, description: x.description, mimeType: x.mimeType });
      }
    } catch (e) {
      console.warn(`[mcp/catalog] ${s.name}: ${String(e).slice(0, 120)}`);
    } finally {
      host?.close().catch(() => {});
    }
  }));
  const out = { at: Date.now(), sig, prompts: prompts.sort((a, b) => a.name.localeCompare(b.name)), resources: resources.slice(0, 500) };
  cache.set(uid, out);
  return out;
}
