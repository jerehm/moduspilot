'use client';

import { motion, AnimatePresence, useInView } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { COMPARE_PROMPTS as PROMPTS, type CompareCol as Col, type ComparePrompt as Prompt } from './compare-prompts';

// Marketing twin of the in-app CompareCard: one prompt, three models answering
// side by side, then a MODUS verdict. It now LOOPS through several prompts —
// each holds ~13s so it's readable — and a different model wins each time, which
// is the real pitch: the right model for the job, picked for you.


function useTypeIn(text: string, active: boolean, speed: number) {
  const [out, setOut] = useState('');
  useEffect(() => {
    setOut('');
    if (!active) return;
    let i = 0;
    const id = setInterval(() => {
      i += 2;
      setOut(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, active, speed]);
  return out;
}

function Column({ col, delayMs }: { col: Col; delayMs: number }) {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setStarted(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  const typed = useTypeIn(col.answer, started, 16);
  const done = typed.length >= col.answer.length;
  const Logo = col.logo;

  return (
    <div className="flex flex-col min-w-0">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-text/[0.06]">
        <span className="flex items-center gap-1.5 min-w-0">
          <Logo className="w-4 h-4 shrink-0" />
          <span className="text-xs font-semibold text-text truncate">{col.name}</span>
        </span>
        {done ? (
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] text-muted tabular-nums">{(col.ms / 1000).toFixed(1)}s</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-2.5 h-2.5 text-emerald-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
            </svg>
          </span>
        ) : (
          <span className="flex items-center gap-0.5 shrink-0">
            {[0, 1, 2].map(i => (
              <motion.span key={i} className="w-1 h-1 rounded-full bg-brand"
                animate={{ opacity: [0.25, 1, 0.25] }}
                transition={{ duration: 1, repeat: Infinity, delay: i * 0.16 }} />
            ))}
          </span>
        )}
      </div>
      <div className="px-3 py-3 min-h-[150px] sm:min-h-[132px]">
        <p className="text-[13px] text-muted leading-relaxed">
          {typed}
          {started && !done && <span className="inline-block w-0.5 h-3.5 bg-brand ml-0.5 align-middle animate-pulse" />}
        </p>
      </div>
    </div>
  );
}

function Round({ prompt }: { prompt: Prompt }) {
  const [showVerdict, setShowVerdict] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowVerdict(true), 2300);
    return () => clearTimeout(t);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      <div className="px-4 py-3 border-b border-text/[0.06]">
        <div className="flex justify-end">
          <div className="bg-brand rounded-xl rounded-tr-sm px-3.5 py-2 max-w-[85%]">
            <p className="text-[13px] text-white">{prompt.q}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-text/[0.06]">
        {prompt.cols.map((c, i) => (
          <Column key={c.name} col={c} delayMs={i * 180} />
        ))}
      </div>

      <motion.div
        initial={false}
        animate={{ opacity: showVerdict ? 1 : 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-start gap-2 px-4 py-3 border-t border-text/[0.06] bg-bg/40"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} className="w-3.5 h-3.5 text-brand shrink-0 mt-0.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
        </svg>
        <p className="text-[11px] text-muted leading-relaxed">
          <span className="text-text font-medium">Modus:</span> {prompt.verdict}
        </p>
      </motion.div>
    </motion.div>
  );
}

export default function ModelCompareDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: false, margin: '-60px' });
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!inView) return;
    // ~8s per prompt: types out (~1.6s), verdict at 2.3s, then reads until it
    // advances and crossfades to the next question, looping back to the first.
    const t = setTimeout(() => setIdx(i => (i + 1) % PROMPTS.length), 8000);
    return () => clearTimeout(t);
  }, [inView, idx]);

  return (
    <div ref={ref} className="rounded-2xl bg-panel border border-border overflow-hidden shadow-[0_16px_40px_-20px_rgba(30,20,60,0.25)]">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-text/[0.06]">
        <span className="flex items-center gap-1.5 text-xs">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} className="w-3.5 h-3.5 text-brand">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 3v18M16 3v18M3 8h18M3 16h18" />
          </svg>
          <span className="font-semibold text-text">Compare</span>
          <span className="text-muted/70">· 3 models, one prompt</span>
        </span>
        <span className="flex items-center gap-1">
          {PROMPTS.map((_, i) => (
            <span key={i} className={`h-1 rounded-full transition-all duration-300 ${i === idx ? 'w-4 bg-brand' : 'w-1 bg-text/15'}`} />
          ))}
        </span>
      </div>

      <AnimatePresence mode="wait">
        <Round key={idx} prompt={PROMPTS[idx]} />
      </AnimatePresence>
    </div>
  );
}
