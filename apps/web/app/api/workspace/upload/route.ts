import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { isWorkspaceId, mimeFor, WorkspaceError } from '@/lib/workspace';
import { openWorkspace } from '@/lib/workspace-store';

export const maxDuration = 60;

/**
 * Stores an original upload in the workspace (multipart: ws, file, folder?).
 * The chat still uses extracted text for the model; this keeps the real file
 * so it shows in Files and can be previewed or downloaded later.
 */
export async function POST(req: NextRequest) {
  const a = await requireAuth(req);
  if (a instanceof Response) return a;
  const form = await req.formData().catch(() => null);
  const ws = form?.get('ws');
  const file = form?.get('file');
  const folder = String(form?.get('folder') ?? 'uploads').replace(/[^\w-]/g, '') || 'uploads';
  if (!isWorkspaceId(ws)) return NextResponse.json({ error: 'bad_workspace' }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: 'no_file' }, { status: 400 });
  try {
    const w = openWorkspace(a.uid, ws);
    const name = file.name.replace(/[\/\\]/g, '_').replace(/[\u0000-\u001f]/g, '').slice(0, 120) || 'file';
    const path = await w.freePath(`${folder}/${name}`);
    const data = Buffer.from(await file.arrayBuffer());
    const meta = await w.writeBinary(path, data, file.type || mimeFor(path), 'upload');
    return NextResponse.json({ meta });
  } catch (e) {
    if (e instanceof WorkspaceError) return NextResponse.json({ error: e.code, message: e.message }, { status: e.code.startsWith('quota') || e.code === 'too_large' ? 413 : 400 });
    console.error('[workspace/upload]', String(e));
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }
}
