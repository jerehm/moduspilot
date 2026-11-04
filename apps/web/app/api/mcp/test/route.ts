import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { connectMcpClient } from '@/lib/mcp-client';
import type { McpTransport } from '@/lib/mcp-servers';
import { assertPublicUrl } from '@/lib/ssrf';

const TIMEOUT_MS = 6000;

export async function POST(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let uid: string;
  try {
    ({ uid } = await adminAuth.verifyIdToken(token));
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit: 20 MCP connection tests per hour
  const nowHour = new Date().toISOString().slice(0, 13); // "2026-05-26T14"
  const userRef = adminDb.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const userData = userSnap.data() ?? {};
  const testHour = (userData.mcpTestHour as string) ?? '';
  const testCount = (userData.mcpTestCount as number) ?? 0;
  if (testHour === nowHour && testCount >= 20) {
    return NextResponse.json({ error: 'Rate limit: 20 MCP tests per hour' }, { status: 429 });
  }
  await userRef.set({
    mcpTestHour: nowHour,
    mcpTestCount: testHour === nowHour ? FieldValue.increment(1) : 1,
  }, { merge: true });

  const { url, authHeader, transport } = await req.json() as { url: string; authHeader?: string; transport?: McpTransport };
  if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 });

  try {
    await assertPublicUrl(url); // format + SSRF guard (no private/internal hosts)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid URL' }, { status: 400 });
  }

  let client: Awaited<ReturnType<typeof connectMcpClient>> | null = null;
  try {
    const connectPromise = connectMcpClient({ url, authHeader, transport: transport ?? 'http' });

    client = await Promise.race([
      connectPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timed out')), TIMEOUT_MS)
      ),
    ]);

    const tools = await client.tools();
    const toolNames = Object.keys(tools);

    return NextResponse.json({ ok: true, tools: toolNames });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Connection failed';
    // A server that answers 401 with a resource_metadata pointer signs in with
    // OAuth. Say so, and the form offers the sign in instead of a dead end.
    if (!authHeader && await wantsOAuth(url)) {
      return NextResponse.json({ ok: false, needsOAuth: true, error: 'This server uses sign in. Connect with your account instead of a token.' }, { status: 200 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 200 });
  } finally {
    if (client) {
      try { await client.close(); } catch {}
    }
  }
}

async function wantsOAuth(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'MODUS', version: '1' } } }),
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 401 && /resource_metadata=/i.test(res.headers.get('www-authenticate') ?? '');
  } catch {
    return false;
  }
}
