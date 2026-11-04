/**
 * Normalizes the math delimiters models actually write into the ones
 * remark-math reads.
 *
 * Models emit LaTeX as \(x\) and \[x\] at least as often as $x$ / $$x$$.
 * remark-math only knows dollars, and single-dollar inline math is OFF in
 * MarkdownMessage on purpose: in this product "$24/mo or $59/mo" is a price,
 * not a formula. So:
 *   \( x \)  ->  $$x$$   (inline: double dollars on one line stay inline)
 *   \[ x \]  ->  $$\nx\n$$  (display)
 * Code fences and inline code are left exactly as written.
 */
export function normalizeMathDelimiters(md: string): string {
  if (!md.includes('\\(') && !md.includes('\\[')) return md;
  // Split out fenced blocks and inline code so they pass through untouched.
  const parts = md.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // code
      return part
        .replace(/\\\[([\s\S]+?)\\\]/g, (_, body: string) => `\n$$\n${body.trim()}\n$$\n`)
        .replace(/\\\(([^\n]+?)\\\)/g, (_, body: string) => `$$${body.trim()}$$`);
    })
    .join('');
}
