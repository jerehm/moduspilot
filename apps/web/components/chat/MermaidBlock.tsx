'use client';

import { useEffect, useId, useState } from 'react';

/**
 * Renders a fenced ```mermaid block as a diagram.
 *
 * mermaid is large, so it is imported only when a diagram actually appears.
 * securityLevel 'strict' sanitizes labels and disables click handlers, since
 * the source is model output. Rendering is debounced so a streaming block does
 * not re-render on every token; a half-written diagram simply waits, and one
 * that never parses shows its source with a short note instead.
 */
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;
function loadMermaid() {
  mermaidPromise ??= import('mermaid').then(m => m.default);
  return mermaidPromise;
}

export default function MermaidBlock({ source }: { source: string }) {
  const rawId = useId();
  const id = `mmd-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const mermaid = await loadMermaid();
        const dark = document.documentElement.classList.contains('dark');
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral', fontFamily: 'inherit' });
        await mermaid.parse(source);
        const out = await mermaid.render(`${id}-${Date.now()}`, source);
        if (alive) { setSvg(out.svg); setFailed(false); }
      } catch {
        if (alive) setFailed(true);
      }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [source, id]);

  if (failed || !svg) {
    return (
      <div className="my-2">
        <pre className="overflow-x-auto rounded-lg border border-border bg-[#0d0d14] p-3 text-[12.5px] leading-relaxed text-white/85">{source}</pre>
        {failed && <p className="mt-1 text-[11px] text-muted">Diagram could not render. Showing its source.</p>}
      </div>
    );
  }
  return (
    <div
      className="my-2 overflow-x-auto rounded-lg border border-border bg-panel p-3 [&_svg]:max-w-full [&_svg]:h-auto"
      // mermaid output under securityLevel 'strict' (sanitized by mermaid itself).
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
