import { Pinecone } from '@pinecone-database/pinecone';

let _pc: Pinecone | null = null;

function pc(): Pinecone {
  if (!_pc) _pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  return _pc;
}

export const MEMORY_INDEX = 'modus-memory';

async function embedText(text: string, inputType: 'passage' | 'query'): Promise<number[]> {
  const result = await pc().inference.embed(
    'llama-text-embed-v2',
    [text],
    { inputType, truncate: 'END' }
  );
  const values = result.data?.[0]?.values;
  if (!values?.length) throw new Error('Pinecone embed returned no values');
  return values;
}

export async function upsertMemory(
  userId: string,
  text: string,
  metadata: Record<string, string> = {}
) {
  const embedding = await embedText(text, 'passage');
  // Fails open: a dedupe lookup error must not lose a new memory.
  if (await hasNearDuplicate(userId, text, embedding).catch(() => false)) return null;
  const id = `${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await pc().index(MEMORY_INDEX).upsert([{
    id,
    values: embedding,
    metadata: { userId, text, ...metadata },
  }]);
  return id;
}

/** Deletes specific memory vectors (the recall verifier's own seeds). */
export async function deleteMemories(ids: string[]) {
  if (ids.length > 0) await pc().index(MEMORY_INDEX).deleteMany(ids);
}

// Raw message dumps written before durable-fact extraction (May 2026). They
// are a reply or a question, not a fact, and outrank real memories on recall.
const LEGACY_TYPES = ['assistant_response', 'user_message'];

export async function queryMemory(userId: string, queryText: string, topK = 5) {
  const vector = await embedText(queryText, 'query');
  const result = await pc().index(MEMORY_INDEX).query({
    vector,
    topK,
    filter: { userId: { $eq: userId }, type: { $nin: LEGACY_TYPES } },
    includeMetadata: true,
  });
  return result.matches ?? [];
}

/**
 * True when this user already has a memory saying the same thing. Onboarding
 * and manual adds could save one fact twice, and a duplicate then took one of
 * the three recall slots. Exact text match, or a near-identical embedding.
 */
async function hasNearDuplicate(userId: string, text: string, vector: number[]): Promise<boolean> {
  const result = await pc().index(MEMORY_INDEX).query({
    vector,
    topK: 3,
    filter: { userId: { $eq: userId } },
    includeMetadata: true,
  });
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return (result.matches ?? []).some(m => (m.score ?? 0) >= 0.97 || norm(String(m.metadata?.text ?? '')) === norm(text));
}

export async function clearMemories(userId: string) {
  const prefix = `${userId}-`;
  let paginationToken: string | undefined;
  do {
    const result = await pc().index(MEMORY_INDEX).listPaginated({ prefix, limit: 100, ...(paginationToken ? { paginationToken } : {}) });
    const ids = (result.vectors ?? []).map(v => v.id).filter(Boolean) as string[];
    if (ids.length > 0) await pc().index(MEMORY_INDEX).deleteMany(ids);
    paginationToken = result.pagination?.next;
  } while (paginationToken);
}
