'use client';

import { useState } from 'react';
import type { Message } from 'ai';
import {
  fromInvocation,
  humanTool,
  readToolAnnotations,
  summaryLine,
  type ToolCallRecord,
  type ToolMedia,
} from '@/lib/chat/tool-activity';

/**
 * The record of tool calls on one assistant turn. Live invocations win while
 * the turn streams; after a reload the saved annotation is all there is.
 */
export function toolCallsFor(message: Message): ToolCallRecord[] {
  const { calls: saved, servers } = readToolAnnotations(message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const live = (message as any).toolInvocations as
    | { toolCallId: string; toolName: string; args?: unknown; state: string; result?: unknown }[]
    | undefined;
  if (Array.isArray(live) && live.length > 0) return live.map(inv => fromInvocation(inv, servers));
  return saved;
}

function MediaGrid({ media }: { media: ToolMedia[] }) {
  if (media.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {media.map((m, i) =>
        m.kind === 'image' ? (
          <a key={i} href={m.url} target="_blank" rel="noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.url} alt="" className="max-h-72 max-w-full rounded-lg border border-border object-contain bg-panel" loading="lazy" />
          </a>
        ) : m.kind === 'video' ? (
          <video key={i} src={m.url} controls className="max-h-80 max-w-full rounded-lg border border-border bg-black" />
        ) : (
          <audio key={i} src={m.url} controls className="w-full max-w-sm" />
        ),
      )}
    </div>
  );
}

function StateDot({ state }: { state: ToolCallRecord['state'] }) {
  if (state === 'running') return <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse shrink-0" />;
  if (state === 'error') return <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />;
  return <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />;
}

function CallRow({ call }: { call: ToolCallRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-l border-border pl-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-xs text-muted hover:text-text transition-colors"
        aria-expanded={open}
      >
        <StateDot state={call.state} />
        {call.server && <span className="text-text/80">{call.server}</span>}
        <span>{humanTool(call.tool)}</span>
        {call.state === 'running' && <span className="text-muted/70">running</span>}
        {call.state === 'error' && <span className="text-red-500">failed</span>}
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>›</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs">
          {call.args && call.args !== '{}' && (
            <div>
              <div className="text-muted mb-1">Input</div>
              <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-panel px-2.5 py-2 font-mono text-[11px] text-text/90 max-h-48 overflow-auto">{call.args}</pre>
            </div>
          )}
          {call.result && (
            <div>
              <div className="text-muted mb-1">Result</div>
              <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-panel px-2.5 py-2 font-mono text-[11px] text-text/90 max-h-64 overflow-auto">{call.result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ToolActivity({ calls }: { calls: ToolCallRecord[] }) {
  const [open, setOpen] = useState(false);
  if (calls.length === 0) return null;
  const running = calls.some(c => c.state === 'running');
  const media = calls.flatMap(c => c.media);
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-xs text-muted hover:text-text transition-colors"
        aria-expanded={open}
      >
        {running && <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse shrink-0" />}
        <span>{summaryLine(calls)}</span>
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>›</span>
      </button>
      {open && (
        <div className="space-y-2">
          {calls.map(c => <CallRow key={c.id} call={c} />)}
        </div>
      )}
      <MediaGrid media={media} />
    </div>
  );
}
