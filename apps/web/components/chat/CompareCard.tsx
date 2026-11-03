'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { auth } from '@/lib/firebase';
import { modelName } from '@/lib/models';
import { chatErrorView } from '@/lib/chat/client-errors';
import { logoForModel } from '@/components/marketing/ModelLogos';
import MarkdownMessage from '@/components/chat/MarkdownMessage';
import OptionsCard from '@/components/chat/OptionsCard';

// Compare mode: one prompt, three models, side by side, streaming in parallel.
// Each column owns its own fetch, so a slow model never blocks the others and
// one failing column never takes the card down with it.
//
// Mobile has no room for three columns, so the same data renders as a swipeable
// single column with a tab strip. Same state, different shell.

/**
 * Why a comparison can't run, in the user's terms — never "unsupported".
 *
 * The honest reason in every case: MODUS makes these with ONE tool, not with the
 * model you picked. An image comes from /api/generate/image, so three columns
 * would race the same thing against itself.
 */
const UNSUPPORTED_COPY = {
  image: {
    title: 'This reads like an image request.',
    body: 'Modus makes images with one image model, so there are no three answers to put side by side. Make it the normal way, or compare how the models answer it in words.',
    cta: 'Make the image',
  },
  document: {
    title: 'This reads like a PDF request.',
    body: 'A PDF is built by Modus itself rather than by the model you picked. Make it the normal way, or compare how the models answer it in words.',
    cta: 'Make the PDF',
  },
  chart: {
    title: 'This reads like a chart request.',
    body: 'Charts are drawn by Modus from your data, not written by the model. Make it the normal way, or compare how the models answer it in words.',
    cta: 'Make the chart',
  },
} as const;

type ColumnState = {
  modelId: string;
  text: string;
  status: 'streaming' | 'done' | 'error';
  error?: string;
  ms?: number;
};

function StatusDot({ status }: { status: ColumnState['status'] }) {
  if (status === 'streaming') {
    return (
      <span className="flex items-center gap-0.5" aria-label="Streaming">
        {[0, 1, 2].map(i => (
          <motion.span
            key={i}
            className="w-1 h-1 rounded-full bg-brand"
            animate={{ opacity: [0.25, 1, 0.25] }}
            transition={{ duration: 1, repeat: Infinity, delay: i * 0.16 }}
          />
        ))}
      </span>
    );
  }
  if (status === 'error') return <span className="text-red-400 text-[10px]">failed</span>;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-2.5 h-2.5 text-emerald-400" aria-label="Done">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ColumnHeader({ col, onExpand }: { col: ColumnState; onExpand?: () => void }) {
  const Logo = logoForModel(col.modelId);
  return (
    <div className="group/head flex items-center justify-between gap-2 px-3 py-2 border-b border-border/60">
      <span className="flex items-center gap-1.5 min-w-0">
        <Logo className="w-3.5 h-3.5 shrink-0" />
        <span className="text-xs font-semibold text-text truncate">{modelName(col.modelId)}</span>
      </span>
      <span className="flex items-center gap-1.5 shrink-0">
        {onExpand && (
          <button
            onClick={onExpand}
            aria-label={`Expand ${modelName(col.modelId)}`}
            title="Expand to read"
            className="opacity-0 group-hover/head:opacity-100 focus:opacity-100 text-muted hover:text-brand transition-all"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} className="w-3 h-3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </button>
        )}
        {col.ms !== undefined && col.status === 'done' && (
          <span className="text-[10px] text-muted tabular-nums">{(col.ms / 1000).toFixed(1)}s</span>
        )}
        <StatusDot status={col.status} />
      </span>
    </div>
  );
}

function ColumnBody({ col, onUse, expanded = false }: { col: ColumnState; onUse?: (text: string) => void; expanded?: boolean }) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Expanded gets a readable measure and more height; a column stays short
          so three of them still fit on one screen. */}
      <div className={`flex-1 overflow-y-auto py-2.5 min-h-[140px] ${expanded ? 'px-4 max-h-[560px]' : 'px-3 max-h-[420px]'}`}>
        {col.status === 'error' ? (
          <p className="text-xs text-red-400">{col.error ?? 'This model failed to answer.'}</p>
        ) : col.text ? (
          <div className={`text-sm ${expanded ? 'max-w-2xl' : ''}`}>
            <MarkdownMessage>{col.text}</MarkdownMessage>
          </div>
        ) : (
          <div className="space-y-2 pt-1" aria-hidden>
            {[100, 82, 91].map((w, i) => (
              <motion.div
                key={i}
                className="h-2 rounded bg-text/[0.07]"
                style={{ width: `${w}%` }}
                animate={{ opacity: [0.4, 0.8, 0.4] }}
                transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.12 }}
              />
            ))}
          </div>
        )}
      </div>
      {onUse && col.status === 'done' && col.text && (
        <div className="px-3 pb-2.5 pt-1">
          <button
            onClick={() => onUse(col.text)}
            className="w-full text-[11px] font-medium text-muted hover:text-brand border border-border hover-border-tint rounded-md py-1 transition-colors"
          >
            Continue with this
          </button>
        </div>
      )}
    </div>
  );
}

export default function CompareCard({
  prompt, models, onClose, onUse, onRunNormally,
}: {
  prompt: string;
  models: string[];
  onClose: () => void;
  /** Feeds a chosen answer back into the normal conversation. */
  onUse?: (text: string) => void;
  /** Drops out of compare mode and sends the prompt as an ordinary chat turn. */
  onRunNormally?: (prompt: string) => void;
}) {
  const [columns, setColumns] = useState<ColumnState[]>(
    () => models.map(m => ({ modelId: m, text: '', status: 'streaming' as const })),
  );
  const [verdict, setVerdict] = useState<string | null>(null);
  const [verdictLoading, setVerdictLoading] = useState(false);
  const [tab, setTab] = useState(0);
  // null = every column at once (the comparison view); a number = that column
  // expanded full width, for reading an essay rather than scanning three.
  const [expanded, setExpanded] = useState<number | null>(null);
  // 'clarifying' = waiting on the gate; 'asking' = an options block on screen;
  // 'running' = fanned out; 'unsupported' = terminal, nothing was ever sent.
  // MODUS only asks when the ask is genuinely vague.
  const [phase, setPhase] = useState<'clarifying' | 'asking' | 'running' | 'unsupported'>('clarifying');
  const [optionsRaw, setOptionsRaw] = useState<string | null>(null);
  // The artifact the user actually wanted, when it isn't something 3 text models
  // can be compared on.
  const [unsupported, setUnsupported] = useState<'image' | 'document' | 'chart' | null>(null);
  // The clarify gate errored and we fanned out on the raw prompt anyway.
  const [gateSkipped, setGateSkipped] = useState(false);
  const startedRef = useRef(false);
  const fannedRef = useRef(false);
  const abortRef = useRef<AbortController[]>([]);

  const runColumn = useCallback(async (modelId: string, index: number, token: string, finalPrompt: string) => {
    const ctrl = new AbortController();
    abortRef.current.push(ctrl);
    const t0 = performance.now();
    // The stall cap covers waiting for the response too, not only the body:
    // a request that never gets headers would otherwise shimmer forever.
    let stalledBeforeResponse = false;
    const headerTimer = setTimeout(() => { stalledBeforeResponse = true; ctrl.abort(); }, 45000);
    try {
      const res = await fetch('/api/chat/compare', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: finalPrompt, model: modelId }),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(headerTimer));

      if (!res.ok || !res.body) {
        const msg = await res.json().catch(() => ({})) as { error?: string; resetAt?: number };
        // The route answers with two kinds of error: sentences it wrote itself
        // ("Model not available on your plan") and the shared limit gates' bare
        // codes (token_limit_reached, free_limit_reached), which a column used to
        // print verbatim. Codes go through the same copy every chat surface uses.
        const raw = msg.error?.trim();
        // The whole body goes to the mapper so a limit's resetAt comes along.
        const text = raw && !/^[a-z0-9_]+$/.test(raw) ? raw : chatErrorView(raw ? JSON.stringify(msg) : String(res.status)).text;
        setColumns(c => c.map((col, i) => i === index
          ? { ...col, status: 'error', error: text } : col));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      // 🚨 A column could shimmer FOREVER. ColumnBody shows the skeleton whenever
      // text is empty, and a text stream swallows a mid-stream provider error, so
      // a model that died, hung or answered nothing looked identical to one still
      // thinking (11-02 round 2 audit). Inactivity cap per column (same 45s as
      // chat), and an empty finish is an error the column says out loud.
      const STALL_MS = 45000;
      for (;;) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const stalled = new Promise<'stalled'>(r => { timer = setTimeout(() => r('stalled'), STALL_MS); });
        const next = await Promise.race([reader.read(), stalled]).finally(() => clearTimeout(timer));
        if (next === 'stalled') {
          setColumns(c => c.map((col, i) => (i === index
            ? { ...col, status: 'error', error: acc.trim() ? 'This model stalled partway through its answer. Try again.' : 'This model stalled. Try again.' } : col)));
          ctrl.abort();
          return;
        }
        const { done, value } = next;
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        // Snapshot into the closure-free updater so columns never clobber each other.
        setColumns(c => c.map((col, i) => (i === index ? { ...col, text: acc } : col)));
      }
      if (!acc.trim()) {
        setColumns(c => c.map((col, i) => (i === index
          ? { ...col, status: 'error', error: 'This model returned an empty answer.' } : col)));
        return;
      }
      setColumns(c => c.map((col, i) => (i === index
        ? { ...col, status: 'done', ms: Math.round(performance.now() - t0) } : col)));
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        if (stalledBeforeResponse) {
          setColumns(c => c.map((col, i) => (i === index
            ? { ...col, status: 'error', error: 'This model stalled. Try again.' } : col)));
        }
        return;
      }
      setColumns(c => c.map((col, i) => (i === index
        ? { ...col, status: 'error', error: 'Could not reach this model.' } : col)));
    }
  }, []);

  /** Fan out to every model at once. Guarded so a re-render can't double-bill. */
  const fanOut = useCallback(async (finalPrompt: string) => {
    if (fannedRef.current) return;
    fannedRef.current = true;
    setPhase('running');
    const token = await auth.currentUser?.getIdToken();
    if (!token) {
      setColumns(c => c.map(col => ({ ...col, status: 'error', error: 'Not signed in.' })));
      return;
    }
    await Promise.all(models.map((m, i) => runColumn(m, i, token, finalPrompt)));
  }, [models, runColumn]);

  // Ask MODUS whether anything needs clarifying first. A vague prompt sent to 3
  // models produces 3 answers to 3 different questions, which compares nothing.
  // Runs exactly once — React 18 StrictMode double-mounts in dev, and without
  // this guard every comparison would be billed twice.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) { await fanOut(prompt); return; }
        const res = await fetch('/api/chat/compare/clarify', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json().catch(() => ({})) as {
          options?: string | null;
          unsupported?: 'image' | 'document' | 'chart' | null;
        };
        // Terminal: no fanOut. This is the whole saving — the 3 model calls and
        // the verdict never happen for something they could never answer.
        if (data.unsupported) { setUnsupported(data.unsupported); setPhase('unsupported'); }
        else if (data.options) { setOptionsRaw(data.options); setPhase('asking'); }
        else await fanOut(prompt);
      } catch {
        // The gate stays an optimisation, never a blocker — a comparison the
        // user asked for still runs. But it used to fail INVISIBLY, fanning a
        // vague prompt out to 3 models (the exact thing the gate exists to
        // prevent) while looking identical to a prompt that was clear enough not
        // to need asking. If they each answer a different question, the user
        // deserves to know we skipped the step that would have stopped it.
        setGateSkipped(true);
        await fanOut(prompt);
      }
    })();
  }, [prompt, fanOut]);

  // Abort in-flight streams ONLY on a true unmount (card close, or the
  // key={compare.id} remount for a new comparison) — never on a mid-stream
  // re-render. This used to live in the clarify effect's cleanup, whose deps
  // include `fanOut`, so it fired whenever `fanOut`'s identity changed — e.g. the
  // user edits the compare model selection while columns are still streaming and
  // ChatWindow hands down a new `models` array. That aborted all three fetches;
  // runColumn swallows the AbortError without setting a status, and startedRef
  // blocks any restart, so the columns froze on skeletons forever with no error
  // and no verdict. Same unmount-only ref pattern as ChatWindow's stopRef.
  const abortAllRef = useRef(() => abortRef.current.forEach(c => c.abort()));
  useEffect(() => () => abortAllRef.current(), []);

  // Verdict once every column has settled and at least two actually answered.
  const allSettled = columns.every(c => c.status !== 'streaming');
  const answered = columns.filter(c => c.status === 'done' && c.text.trim());
  useEffect(() => {
    if (!allSettled || verdict || verdictLoading || answered.length < 2) return;
    setVerdictLoading(true);
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch('/api/chat/compare/verdict', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            answers: answered.map(c => ({ model: c.modelId, text: c.text, ms: c.ms })),
          }),
        });
        const data = await res.json().catch(() => ({})) as { verdict?: string | null };
        if (data.verdict) setVerdict(data.verdict);
      } finally {
        setVerdictLoading(false);
      }
    })();
  }, [allSettled, answered, prompt, verdict, verdictLoading]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="w-full rounded-xl border border-border bg-bg overflow-hidden"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/60 bg-panel/40">
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} className="w-3.5 h-3.5 text-brand">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 3v18M16 3v18M3 8h18M3 16h18" />
          </svg>
          <span className="font-semibold text-text">Multi-model</span>
          <span className="text-muted/70">· {columns.length} models</span>
        </span>
        <span className="flex items-center gap-1">
          {expanded !== null && (
            <button
              onClick={() => setExpanded(null)}
              className="hidden sm:flex items-center gap-1 text-[11px] text-muted hover:text-brand px-1.5 py-0.5 rounded transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 3H5a2 2 0 0 0-2 2v4m18 0V5a2 2 0 0 0-2-2h-4M3 15v4a2 2 0 0 0 2 2h4m10 0h4a2 2 0 0 0 2-2v-4" />
              </svg>
              Compare all
            </button>
          )}
          <button onClick={onClose} aria-label="Close comparison" className="p-1 rounded text-muted hover:text-text transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <path strokeLinecap="round" d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </span>
      </div>

      {/* MODUS asks first, but only when the prompt is genuinely vague — three
          models guessing three different essays compares nothing. */}
      {phase === 'clarifying' && (
        <div className="flex items-center gap-2 px-3 py-4">
          <span className="w-1.5 h-1.5 bg-brand rounded-full animate-pulse" />
          <span className="text-xs text-muted">Checking what these models need to know…</span>
        </div>
      )}

      {gateSkipped && phase === 'running' && (
        <div className="flex items-start gap-2 px-3 py-2 border-b border-border/60 bg-amber-500/[0.06]">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 mt-1.5" />
          <p className="text-[11px] text-amber-500/90 leading-relaxed">
            Modus couldn’t check whether this needed narrowing down first, so each model answered it as
            written. If they went in different directions, ask again with more detail.
          </p>
        </div>
      )}

      {/* Terminal, and nothing was sent. Comparing models only works on written
          answers; these come from one model either way, so there is nothing to
          race. Say it plainly and offer the thing they actually wanted. */}
      {phase === 'unsupported' && unsupported && (
        <div className="px-4 py-4 space-y-3">
          <div className="flex items-start gap-2.5">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} className="w-4 h-4 text-brand shrink-0 mt-0.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            </svg>
            <div className="min-w-0">
              <p className="text-sm font-medium text-text leading-snug">
                {UNSUPPORTED_COPY[unsupported].title}
              </p>
              <p className="text-xs text-muted leading-relaxed mt-1">
                {UNSUPPORTED_COPY[unsupported].body}
              </p>
            </div>
          </div>
          {/* 26px = the w-4 icon (16) + gap-2.5 (10), so the actions line up
              under the text. pl-6.5 is NOT a Tailwind class — it does nothing.
              The gate that lands here is a drift-prone gpt-4o-mini guess, so
              "Compare anyway" is the PRIMARY action and is always offered — it
              runs fanOut on the raw prompt, the same path a READY prompt takes,
              and is the one click that recovers a false positive. */}
          <div className="flex flex-wrap items-center gap-2 pl-[26px]">
            <button
              onClick={() => fanOut(prompt)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white btn-primary"
            >
              Compare the models anyway
            </button>
            {onRunNormally && (
              <button
                onClick={() => onRunNormally(prompt)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted hover:text-text border border-border hover-border-tint transition-colors"
              >
                {UNSUPPORTED_COPY[unsupported].cta}
              </button>
            )}
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted hover:text-text transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'asking' && optionsRaw && (
        <div className="p-3">
          <OptionsCard
            raw={optionsRaw}
            onAppend={(answer) => {
              // The card's answer normally becomes a user turn. Here it refines
              // the prompt instead, so all models get the SAME clarified brief —
              // which is the only way the comparison is fair.
              setOptionsRaw(null);
              fanOut(`${prompt}\n\n${answer}`);
            }}
          />
        </div>
      )}

      {/* Desktop: three real columns, so the race is visible. */}
      {/* Desktop: columns by default so the race is visible and answers can be
          scanned against each other. Click one to expand it full width — an
          essay in a 1/3-width column is unreadable, which is the whole reason
          this has two modes. */}
      {phase === 'running' && (
      <div className="hidden sm:block">
        {expanded === null ? (
          <div className="grid grid-cols-3 divide-x divide-border/60">
            {columns.map((col, i) => (
              <div key={col.modelId} className="flex flex-col min-w-0">
                <ColumnHeader col={col} onExpand={() => setExpanded(i)} />
                <ColumnBody col={col} onUse={onUse} />
              </div>
            ))}
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-0.5 p-1 border-b border-border/60">
              {columns.map((col, i) => {
                const Logo = logoForModel(col.modelId);
                return (
                  <button
                    key={col.modelId}
                    onClick={() => setExpanded(i)}
                    className={`relative flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                      expanded === i ? 'text-brand' : 'text-muted hover:text-text'
                    }`}
                  >
                    {expanded === i && (
                      <motion.span layoutId="compareExpandedTab" transition={{ type: 'spring', stiffness: 420, damping: 34 }} className="absolute inset-0 surface-tint-strong rounded-md" />
                    )}
                    <span className="relative z-10 flex items-center gap-1.5">
                      <Logo className="w-3.5 h-3.5" />
                      {modelName(col.modelId)}
                      <StatusDot status={col.status} />
                    </span>
                  </button>
                );
              })}
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={expanded}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.16 }}
                className="flex flex-col"
              >
                <ColumnHeader col={columns[expanded]} />
                <ColumnBody col={columns[expanded]} onUse={onUse} expanded />
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </div>
      )}

      {/* Mobile: one column + a tab strip. Three columns at 390px is unreadable. */}
      {phase === 'running' && (
      <div className="sm:hidden">
        <div className="flex items-center gap-0.5 p-1 border-b border-border/60">
          {columns.map((col, i) => {
            const Logo = logoForModel(col.modelId);
            return (
              <button
                key={col.modelId}
                onClick={() => setTab(i)}
                className={`relative flex-1 flex items-center justify-center gap-1 px-1 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                  tab === i ? 'text-brand' : 'text-muted'
                }`}
              >
                {tab === i && (
                  <motion.span layoutId="compareTab" transition={{ type: 'spring', stiffness: 420, damping: 34 }} className="absolute inset-0 surface-tint-strong rounded-md" />
                )}
                <span className="relative z-10 flex items-center gap-1">
                  <Logo className="w-3 h-3" />
                  <StatusDot status={col.status} />
                </span>
              </button>
            );
          })}
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.16 }}
            className="flex flex-col"
          >
            <ColumnHeader col={columns[tab]} />
            <ColumnBody col={columns[tab]} onUse={onUse} expanded />
          </motion.div>
        </AnimatePresence>
      </div>
      )}

      <AnimatePresence>
        {(verdict || verdictLoading) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="border-t border-border/60 bg-panel/40 overflow-hidden"
          >
            <div className="flex items-start gap-2 px-3 py-2.5">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} className="w-3.5 h-3.5 text-brand shrink-0 mt-0.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
              </svg>
              {verdict ? (
                <p className="text-xs text-muted leading-relaxed">
                  <span className="text-text font-medium">Modus:</span> {verdict}
                </p>
              ) : (
                <p className="text-xs text-muted/70">Comparing answers…</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
