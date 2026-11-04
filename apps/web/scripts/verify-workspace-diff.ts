/** cd apps/web && npx tsx scripts/verify-workspace-diff.ts */
import { diffLines } from '../lib/workspace-diff';
let f = 0;
const check = (l: string, c: boolean, d?: unknown) => { console.log(`${c ? '✅' : '❌'} ${l}`); if (!c) { f++; console.log('  ', JSON.stringify(d)); } };
const d1 = diffLines('a\nb\nc', 'a\nB\nc');
check('one line changed', JSON.stringify(d1.map(x => x.op)) === '["same","del","add","same"]', d1);
check('identical', diffLines('x\ny', 'x\ny').every(x => x.op === 'same'));
const d2 = diffLines('', 'new');
check('from empty', d2.some(x => x.op === 'add' && x.text === 'new'), d2);
const d3 = diffLines('a\nb\nc\nd', 'a\nd');
check('two deletions', d3.filter(x => x.op === 'del').map(x => x.text).join() === 'b,c', d3);
const big = Array.from({ length: 3000 }, (_, i) => `l${i}`).join('\n');
const bigB = Array.from({ length: 3000 }, (_, i) => `m${i}`).join('\n');
const t0 = Date.now(); const d4 = diffLines(big, bigB);
check('huge diff degrades fast', Date.now() - t0 < 2000 && d4.length === 6000, Date.now() - t0);
console.log(f ? `\n${f} failed.` : '\nAll checks passed.'); process.exit(f ? 1 : 0);
