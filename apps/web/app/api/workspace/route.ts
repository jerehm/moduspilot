import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { isWorkspaceId, WorkspaceError } from '@/lib/workspace';
import { openWorkspace } from '@/lib/workspace-store';

/**
 * Files panel API. Every op goes through lib/workspace.ts, the same rules the
 * model's file tools use. The caller's uid scopes everything; a workspace id
 * is only a folder name under it.
 *
 *   GET  ?ws=                               list
 *   POST { ws, op: 'read', path }           text content, or url for binary
 *   POST { ws, op: 'write', path, content }
 *   POST { ws, op: 'rename', path, to }
 *   POST { ws, op: 'delete', path }
 *   POST { ws, op: 'versions', path }
 *   POST { ws, op: 'version', path, n }
 *   POST { ws, op: 'restore', path, n }
 */
function err(e: unknown) {
  if (e instanceof WorkspaceError) {
    const status = e.code === 'not_found' ? 404 : e.code.startsWith('quota') ? 413 : e.code === 'conflict' ? 409 : 400;
    return NextResponse.json({ error: e.code, message: e.message }, { status });
  }
  console.error('[workspace]', String(e));
  return NextResponse.json({ error: 'workspace_error', message: 'Something went wrong with that file.' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const a = await requireAuth(req);
  if (a instanceof Response) return a;
  const ws = new URL(req.url).searchParams.get('ws');
  if (!isWorkspaceId(ws)) return NextResponse.json({ error: 'bad_workspace' }, { status: 400 });
  try {
    const files = await openWorkspace(a.uid, ws).list();
    return NextResponse.json({ files });
  } catch (e) { return err(e); }
}

export async function POST(req: NextRequest) {
  const a = await requireAuth(req);
  if (a instanceof Response) return a;
  const b = await req.json().catch(() => ({})) as { ws?: string; op?: string; path?: string; to?: string; content?: unknown; n?: number };
  if (!isWorkspaceId(b.ws)) return NextResponse.json({ error: 'bad_workspace' }, { status: 400 });
  const ws = openWorkspace(a.uid, b.ws);
  const n = Number(b.n);
  try {
    switch (b.op) {
      case 'read': {
        const r = await ws.read(String(b.path ?? ''));
        return NextResponse.json({ meta: r.meta, content: r.content ?? null });
      }
      case 'write':
        return NextResponse.json({ meta: await ws.write(String(b.path ?? ''), b.content, 'user') });
      case 'rename':
        return NextResponse.json({ meta: await ws.rename(String(b.path ?? ''), String(b.to ?? ''), 'user') });
      case 'delete':
        await ws.delete(String(b.path ?? ''));
        return NextResponse.json({ ok: true });
      case 'versions':
        return NextResponse.json({ versions: await ws.versions(String(b.path ?? '')) });
      case 'version':
        if (!Number.isInteger(n) || n < 1) return NextResponse.json({ error: 'bad_version' }, { status: 400 });
        return NextResponse.json({ version: await ws.version(String(b.path ?? ''), n) });
      case 'restore':
        if (!Number.isInteger(n) || n < 1) return NextResponse.json({ error: 'bad_version' }, { status: 400 });
        return NextResponse.json({ meta: await ws.restore(String(b.path ?? ''), n, 'user') });
      default:
        return NextResponse.json({ error: 'unknown_op' }, { status: 400 });
    }
  } catch (e) { return err(e); }
}
