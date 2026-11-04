/** cd apps/web && npx tsx scripts/verify-math-delimiters.ts */
import { normalizeMathDelimiters as n } from '../lib/chat/math-delimiters';
let f = 0;
const eq = (l: string, got: string, want: string) => { const ok = got === want; console.log(`${ok ? '✅' : '❌'} ${l}`); if (!ok) { f++; console.log('   got ', JSON.stringify(got)); console.log('   want', JSON.stringify(want)); } };
eq('prices untouched', n('MODUS is $24/mo and PILOT is $59/mo.'), 'MODUS is $24/mo and PILOT is $59/mo.');
eq('inline \\( \\)', n('Area is \\(\\pi r^2\\) here.'), 'Area is $$\\pi r^2$$ here.');
eq('display \\[ \\]', n('Sum:\\[ \\sum_{i=1}^n i \\]done'), 'Sum:\n$$\n\\sum_{i=1}^n i\n$$\ndone');
eq('inline code untouched', n('Use `\\(x\\)` literally, but \\(y\\) renders.'), 'Use `\\(x\\)` literally, but $$y$$ renders.');
eq('fence untouched', n('```latex\n\\[a\\]\n```\n\\[b\\]'), '```latex\n\\[a\\]\n```\n\n$$\nb\n$$\n');
eq('unclosed fence (streaming) untouched', n('text \\(a\\)\n```py\nprint("\\(x\\)")'), 'text $$a$$\n```py\nprint("\\(x\\)")');
eq('no delimiters fast path', n('plain'), 'plain');
console.log(f ? `\n${f} failed.` : '\nAll checks passed.'); process.exit(f ? 1 : 0);
