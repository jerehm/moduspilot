/**
 * A wrapped tool beats while it runs and stops when it settles (ok or throw).
 *
 *   cd apps/web && npx tsx scripts/verify-tool-heartbeat.ts
 */
import { withToolHeartbeat } from '../lib/chat/tool-heartbeat';

let failures = 0;
const check = (l: string, c: boolean, d?: unknown) => { console.log(`${c ? '✅' : '❌'} ${l}`); if (!c) { failures++; if (d !== undefined) console.log('  ', d); } };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  let beats = 0;
  const tools = withToolHeartbeat({
    slow: { execute: async () => { await sleep(260); return 'done'; } },
    boom: { execute: async () => { await sleep(130); throw new Error('x'); } },
    noexec: { description: 'schema only' },
  }, () => { beats++; }, 50);
  const r = await (tools.slow as { execute: () => Promise<string> }).execute();
  check('result passes through', r === 'done');
  check('beats while running (~5)', beats >= 4 && beats <= 6, beats);
  const after = beats; await sleep(200);
  check('no beats after settle', beats === after, beats - after);
  beats = 0;
  let threw = false;
  try { await (tools.boom as { execute: () => Promise<void> }).execute(); } catch { threw = true; }
  const afterThrow = beats; await sleep(200);
  check('error still propagates', threw);
  check('beat stops after throw', beats === afterThrow);
  check('schema-only tool untouched', !('execute' in (tools.noexec as object)));
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} failed.`);
  process.exit(failures ? 1 : 0);
}
main();
