/**
 * Line diff for the Files panel's version history. Plain LCS: files are capped
 * at 256KB, and the table is bounded below so a huge file degrades to a
 * whole-file replace instead of freezing the tab.
 */
export type DiffLine = { op: 'same' | 'add' | 'del'; text: string };

const MAX_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  // Trim the common head and tail; most edits touch a few lines in the middle.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const am = a.slice(head, a.length - tail);
  const bm = b.slice(head, b.length - tail);
  const out: DiffLine[] = a.slice(0, head).map(text => ({ op: 'same' as const, text }));
  if ((am.length + 1) * (bm.length + 1) > MAX_CELLS) {
    out.push(...am.map(text => ({ op: 'del' as const, text })), ...bm.map(text => ({ op: 'add' as const, text })));
  } else {
    const n = am.length, m = bm.length;
    const t: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      t[i][j] = am[i] === bm[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (am[i] === bm[j]) { out.push({ op: 'same', text: am[i] }); i++; j++; }
      else if (t[i + 1][j] >= t[i][j + 1]) { out.push({ op: 'del', text: am[i++] }); }
      else { out.push({ op: 'add', text: bm[j++] }); }
    }
    while (i < n) out.push({ op: 'del', text: am[i++] });
    while (j < m) out.push({ op: 'add', text: bm[j++] });
  }
  out.push(...a.slice(a.length - tail).map(text => ({ op: 'same' as const, text })));
  return out;
}
