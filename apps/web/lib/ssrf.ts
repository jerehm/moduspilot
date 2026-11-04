import dns from 'dns';

/**
 * SSRF guard for user-supplied URLs (MCP server endpoints).
 *
 * Without this, a signed-in user can point an "MCP server" at an internal
 * address — http://169.254.169.254/ (cloud metadata), http://localhost, or
 * RFC-1918 hosts — and our server will dutifully fetch it, turning the feature
 * into a server-side request forgery primitive against our own infrastructure.
 *
 * We require http/https, reject obvious private hostnames, AND resolve the host
 * and reject if ANY resolved address is private/loopback/link-local (catches a
 * public domain that points at an internal IP).
 */

function ipToLong(ip: string): number | null {
  const m = ip.split('.');
  if (m.length !== 4) return null;
  let n = 0;
  for (const part of m) {
    const o = Number(part);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = n * 256 + o;
  }
  return n >>> 0;
}

function inV4Range(ip: number, base: string, bits: number): boolean {
  const b = ipToLong(base)!;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (b & mask);
}

function isPrivateV4(ip: string): boolean {
  const n = ipToLong(ip);
  if (n === null) return false;
  return (
    inV4Range(n, '0.0.0.0', 8) ||
    inV4Range(n, '10.0.0.0', 8) ||
    inV4Range(n, '100.64.0.0', 10) ||   // CGNAT
    inV4Range(n, '127.0.0.0', 8) ||     // loopback
    inV4Range(n, '169.254.0.0', 16) ||  // link-local incl. 169.254.169.254 metadata
    inV4Range(n, '172.16.0.0', 12) ||
    inV4Range(n, '192.0.0.0', 24) ||
    inV4Range(n, '192.168.0.0', 16) ||
    inV4Range(n, '198.18.0.0', 15)      // benchmarking
  );
}

function isPrivateV6(ip: string): boolean {
  // URL canonicalization converts dotted IPv4-mapped hosts into hex words.
  // Expand those words so both URL literals and DNS answers use the same checks.
  const a = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const [left, right] = a.split('::');
  const head = left ? left.split(':') : [];
  const tail = right ? right.split(':') : [];
  const words = (right === undefined ? head : [
    ...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail,
  ]).map(word => parseInt(word, 16));
  if (words.slice(0, 7).every(word => word === 0) && words[7] <= 1) return true;
  if ((words[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((words[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) {
    const v4 = [words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join('.');
    return isPrivateV4(v4);
  }
  return false;
}

function isPrivateAddr(ip: string): boolean {
  return ip.includes(':') ? isPrivateV6(ip) : isPrivateV4(ip);
}

/** Throws if `rawUrl` is not a safe, public http(s) endpoint. */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new Error('Invalid URL'); }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed');
  }

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  // Dev only: lets a local test MCP server (scripts/dev-mcp-app-server.mts) be
  // connected. Requires BOTH a non-production build and an explicit opt-in.
  if (process.env.NODE_ENV !== 'production' && process.env.MCP_ALLOW_LOCALHOST === '1' && (host === 'localhost' || host === '127.0.0.1')) {
    return;
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('URL points to a disallowed host');
  }

  // If the host is already an IP literal, check it directly.
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    if (isPrivateAddr(host)) throw new Error('URL points to a private address');
    return;
  }

  // Resolve and reject if ANY address is private (defeats domains → internal IP).
  const addrs = await dns.promises.lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new Error('Host could not be resolved');
  for (const { address } of addrs) {
    if (isPrivateAddr(address)) throw new Error('URL resolves to a private address');
  }
}
