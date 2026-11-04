import { requireAuth } from '@/lib/api-auth';
import { upsertMemory } from '@/lib/pinecone';

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { uid } = auth;

  if (!process.env.PINECONE_API_KEY) return Response.json({ ok: true });

  const { text } = await req.json() as { text: string };
  if (!text?.trim()) return Response.json({ error: 'No text' }, { status: 400 });

  const id = await upsertMemory(uid, text.trim(), { type: 'manual_memory', ts: Date.now().toString() });
  // saved:false = already remembered. Reporting plain ok hid that nothing was written.
  return Response.json({ ok: true, saved: id !== null, duplicate: id === null });
}
