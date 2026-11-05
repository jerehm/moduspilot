// Renders modus-plans.md to modus-plans.pdf (plain memo style) via headless Chrome.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { marked } = require('marked');
const dir = new URL('.', import.meta.url).pathname;
let md = readFileSync(dir + 'modus-plans.md', 'utf8');
// Start Part 2 on a new page.
md = md.replace(/\n---\n\n# Part 2/, '\n<div class="pb"></div>\n\n# Part 2');
const body = marked.parse(md, { gfm: true });
const css = `
@page { size: Letter; margin: 14mm 16mm 14mm; }
body { font-family: Georgia, "Times New Roman", serif; color:#111; font-size:10pt; line-height:1.38; margin:0; }
h1 { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size:19pt; margin:0 0 6pt; }
h2 { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size:12.5pt; margin:12pt 0 4pt; border-bottom:1px solid #999; padding-bottom:2pt; }
p { margin:0 0 7pt; } ul { margin:0 0 8pt; padding-left:16pt; } li { margin:0 0 2pt; }
hr { border:none; border-top:1px solid #999; margin:12pt 0; }
table { border-collapse:collapse; width:100%; margin:6pt 0 10pt; font-size:8.6pt; font-family:-apple-system, Helvetica, Arial, sans-serif; }
th { text-align:left; border:1px solid #888; padding:2pt 5pt; background:#eee; }
td { border:1px solid #bbb; padding:2pt 5pt; vertical-align:top; }
tr, table { page-break-inside:avoid; } h2 { page-break-after:avoid; }
sup { font-size:7pt; } .pb { page-break-after:always; }
ol li { font-size:9pt; word-break:break-all; }`;
const html = `<!doctype html><html><head><meta charset="utf-8"><title>MODUS Business Plan</title><style>${css}</style></head><body>${body}</body></html>`;
writeFileSync(dir + '.modus-plans.html', html);
execFileSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${dir}modus-plans.pdf`, `file://${dir}.modus-plans.html`], { stdio: 'ignore' });
console.log('wrote modus-plans.pdf');
