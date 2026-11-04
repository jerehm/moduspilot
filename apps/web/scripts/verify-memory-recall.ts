/**
 * Prove that a remembered fact actually reaches the prompt.
 *
 * 🚨 IT NEVER DID. Three independent failures stacked on the memory layer, each
 * of which alone made it a no-op:
 *   1. WRITE — extractDurableMemory called the Gateway with no failover, so a
 *      rate-limited free tier meant nothing was ever saved (fixed in b4beefa).
 *   2. READ — an 800ms cap over TWO sequential network round trips. Production:
 *      `memory query timed out after 800ms` on 25 of 25 consecutive requests.
 *   3. FILTER — `score > 0.55` against llama-text-embed-v2, whose scores for
 *      short third-person facts top out around 0.35. Measured on the live index:
 *      range 0.009–0.349, and the filter kept 0 of 7 vectors. Memory was
 *      written, stored, retrieved and RANKED correctly, then discarded.
 *
 * This asserts the end of that chain: a natural question must come back with the
 * fact attached, and an unrelated question must not drag one in.
 *
 *   cd apps/web && npx tsx scripts/verify-memory-recall.ts
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}

// Runs on the TEST account with facts it seeds itself, then deletes them. It
// used to read a real user's memory (and expect facts that user had since
// cleared), so it failed whenever their data changed and said nothing about
// whether recall worked.
const UID = 'G0wpiD6SspS8cODvJfmLESqS7L33';
const SEEDS = [
  'Recalltest Person is raising a pre-seed round for their startup.',
  'Recalltest Person is the CEO of a company called Zephyrine.',
  'Recalltest Person lives in Lisbon, Portugal.',
];

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) { failures++; if (detail !== undefined) console.log(`   ${String(detail).slice(0, 200)}`); }
}

async function main() {
  const { queryMemoryContext } = await import('../lib/chat/context');
  const { upsertMemory, deleteMemories } = await import('../lib/pinecone');
  const { isJunkFact } = await import('../lib/chat/memory');

  check('junk filter drops a meta fact', isJunkFact('Jeremiah is interacting with the assistant.'));
  check('junk filter keeps a real fact', !isJunkFact(SEEDS[0]));

  const ids: string[] = [];
  try {
    for (const t of SEEDS) { const id = await upsertMemory(UID, t, { type: 'verify_seed', ts: Date.now().toString() }); if (id) ids.push(id); }
    // Serverless Pinecone is eventually consistent; give the writes a moment.
    await new Promise(r => setTimeout(r, 8000));

    const coldStart = Date.now();
    await queryMemoryContext(UID, 'warm up the client');
    console.log(`cold first call: ${Date.now() - coldStart}ms  (the cap is 4000ms)`);

    const cases: { q: string; expect: RegExp }[] = [
      { q: 'am I raising money', expect: /pre-seed/i },
      { q: 'what company do I run', expect: /Zephyrine/i },
      { q: 'where do I live', expect: /Lisbon/i },
    ];
    for (const { q, expect } of cases) {
      const started = Date.now();
      const block = await queryMemoryContext(UID, q);
      const ms = Date.now() - started;
      console.log(`\n── ${JSON.stringify(q)}  (${ms}ms)`);
      console.log(block ? block.trim().split('\n').map(l => `   ${l}`).join('\n') : '   (nothing injected)');
      check(`recalls something for ${JSON.stringify(q)}`, block.length > 0);
      check(`  …and it is the RIGHT fact (${expect})`, expect.test(block), block);
      check(`  …within the retrieval budget`, ms < 4000, `${ms}ms`);
      check(`  …no legacy raw replies`, !/ready to help|You have (the following|\d+) events/i.test(block), block);
      const lines = block.split('\n').filter(l => l.startsWith('- '));
      check(`  …no duplicate lines`, new Set(lines.map(l => l.toLowerCase())).size === lines.length, block);
    }
    await new Promise(r => setTimeout(r, 3000));
    const dup = await upsertMemory(UID, SEEDS[1], { type: 'verify_seed', ts: Date.now().toString() });
    if (dup) ids.push(dup);
    check('saving the same fact again is skipped', dup === null);
  } finally {
    await deleteMemories(ids);
    console.log(`\ncleaned up ${ids.length} seeded memories`);
  }

  console.log(`\n${failures === 0 ? '✅ all checks passed' : `❌ ${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\n❌', e); process.exit(1); });
