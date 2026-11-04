'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import type { PromptEntry, ResourceEntry } from '@/lib/mcp/catalog';

/**
 * Plugin prompts (slash commands) and resources (attachable context) in the
 * composer. One fetch per page session, refreshed when the menus open after
 * five minutes, matching the server cache.
 */
type Catalog = { prompts: PromptEntry[]; resources: ResourceEntry[] };
// Keyed by uid: after switching accounts in one tab, the previous user's
// prompts used to show for up to a minute.
let cached: { at: number; uid: string; data: Catalog } | null = null;
let inflight: Promise<Catalog> | null = null;

async function authHeaders(): Promise<Record<string, string>> {
  const t = await auth.currentUser?.getIdToken().catch(() => null);
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function loadCatalog(): Promise<Catalog> {
  const uid = auth.currentUser?.uid ?? '';
  if (cached && cached.uid === uid && Date.now() - cached.at < 60_000) return Promise.resolve(cached.data);
  inflight ??= (async () => {
    try {
      const res = await fetch('/api/mcp/catalog', { headers: await authHeaders() });
      const data = res.ok ? await res.json() as Catalog : { prompts: [], resources: [] };
      cached = { at: Date.now(), uid, data };
      return data;
    } finally { inflight = null; }
  })();
  return inflight;
}

export function useCatalog(active: boolean): Catalog | null {
  const [data, setData] = useState<Catalog | null>(cached?.data ?? null);
  useEffect(() => {
    if (!active || !auth.currentUser) return;
    let alive = true;
    loadCatalog().then(d => { if (alive) setData(d); }).catch(() => {});
    return () => { alive = false; };
  }, [active]);
  return data;
}

async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/mcp/catalog', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A connector removed or re-added since the list loaded: drop the copy so
    // the next open lists what exists now.
    if (data.error === 'connector_not_found') cached = null;
    throw new Error(data.error === 'connector_not_found' ? 'That plugin was removed. Reopen this menu.' : data.error ?? 'That plugin did not answer.');
  }
  return data;
}

/** "/name" at the start of the composer, nothing after a space yet. */
export function slashQuery(input: string): string | null {
  const m = input.match(/^\/([\w.:-]*)$/);
  return m ? m[1].toLowerCase() : null;
}

/** Prompts whose name, or a word of the title, STARTS with the query. A
 * substring match let "/s" or "/a" match nearly everything. */
export function matchPrompts(prompts: PromptEntry[], q: string): PromptEntry[] {
  const starts = (t: string) => t.toLowerCase().split(/[\s_.:-]+/).some(w => w.startsWith(q)) || t.toLowerCase().startsWith(q);
  return prompts.filter(p => !q || starts(p.name) || starts(p.title ?? '')).slice(0, 8);
}

/**
 * Whether Enter should run a prompt instead of sending the message: only when
 * the user plainly means one (the exact name, or the only match). Otherwise
 * Enter sends what they typed, and prompts stay one click away.
 */
export function enterPicksPrompt(prompts: PromptEntry[], q: string): boolean {
  if (!q) return false;
  const m = matchPrompts(prompts, q);
  return m.some(p => p.name.toLowerCase() === q) || m.length === 1;
}

export function SlashMenu({ prompts, query, pickSignal, onUse, onClose }: {
  prompts: PromptEntry[];
  query: string;
  /** Bumped by the composer on Enter: use the top match. */
  pickSignal: number;
  onUse: (text: string) => void;
  onClose: () => void;
}) {
  const matches = useMemo(() => matchPrompts(prompts, query), [prompts, query]);
  const [picked, setPicked] = useState<PromptEntry | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(p: PromptEntry, values: Record<string, string>) {
    setBusy(true); setError(null);
    try {
      const { text } = await post({ op: 'prompt', serverId: p.serverId, name: p.name, arguments: values });
      onUse(String(text ?? ''));
    } catch (e) { setError(e instanceof Error ? e.message : 'That prompt failed.'); }
    finally { setBusy(false); }
  }

  async function submitArgs() {
    if (!picked) return;
    const missing = picked.arguments.filter(a => a.required && !(args[a.name] ?? '').trim()).map(a => a.name);
    if (missing.length) { setError(`Fill in ${missing.join(', ')}.`); return; }
    await run(picked, args);
  }

  function choose(p: PromptEntry) {
    if (p.arguments.length === 0) { void run(p, {}); return; }
    setPicked(p); setArgs({});
  }

  const [lastPick, setLastPick] = useState(pickSignal);
  if (pickSignal !== lastPick) {
    // Adjusting state during render on a prop change (React's documented
    // pattern), not in an effect.
    setLastPick(pickSignal);
    // Not while a prompt is loading or just failed: each Enter re-ran it.
    if (!picked && !busy && !error && matches[0]) {
      const top = matches.find(p => p.name.toLowerCase() === query) ?? matches[0];
      if (top.arguments.length === 0) queueMicrotask(() => { void run(top, {}); });
      else { setPicked(top); setArgs({}); }
    }
  }

  if (!picked && matches.length === 0) return null;
  return (
    <div className="absolute bottom-full mb-2 left-0 right-0 bg-panel border border-border rounded-xl shadow-2xl p-1.5 z-50" role="listbox" aria-label="Plugin prompts">
      {picked ? (
        // Not a <form>: this sits inside the composer's form, and a nested form
        // is dropped by the browser, so its submit would send the chat message.
        <div
          className="p-2 space-y-2"
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); e.stopPropagation(); void submitArgs(); }
            if (e.key === 'Escape') { e.preventDefault(); setPicked(null); onClose(); }
          }}
        >
          <p className="text-sm text-text"><span className="text-muted">{picked.server} · </span>{picked.title ?? picked.name}</p>
          {picked.arguments.map(a => (
            <label key={a.name} className="block">
              <span className="text-[11px] text-muted">{a.name}{a.required ? '' : ' (optional)'}{a.description ? ` · ${a.description}` : ''}</span>
              <input
                autoFocus={a === picked.arguments[0]}
                data-required={a.required ? '1' : undefined}
                value={args[a.name] ?? ''}
                onChange={e => setArgs(s => ({ ...s, [a.name]: e.target.value }))}
                className="mt-0.5 w-full bg-transparent text-sm text-text outline-none px-2 py-1.5 rounded-md border border-border focus:border-brand/50"
              />
            </label>
          ))}
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setPicked(null); onClose(); }} className="text-xs text-muted hover:text-text px-2 py-1">Cancel</button>
            <button type="button" onClick={() => void submitArgs()} disabled={busy} className="text-xs font-medium text-white bg-brand rounded-lg px-3 py-1.5 disabled:opacity-50">{busy ? 'Loading…' : 'Use prompt'}</button>
          </div>
        </div>
      ) : (
        <>
          <p className="px-2.5 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Plugin prompts</p>
          {matches.map(p => (
            <button
              key={`${p.serverId}:${p.name}`}
              type="button"
              onClick={() => choose(p)}
              disabled={busy}
              className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-bg transition-colors disabled:opacity-50"
            >
              <span className="text-sm text-text">/{p.name}</span>
              <span className="text-xs text-muted"> · {p.server}</span>
              {p.description && <span className="block text-xs text-muted truncate">{p.description}</span>}
            </button>
          ))}
          {error && <p className="text-xs text-red-500 px-2.5 py-1">{error}</p>}
        </>
      )}
    </div>
  );
}

export function ResourcePicker({ resources, onAttach, onClose }: {
  resources: ResourceEntry[];
  onAttach: (name: string, text: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = resources.filter(r => !q || `${r.name} ${r.uri} ${r.server}`.toLowerCase().includes(q.toLowerCase())).slice(0, 50);

  async function attach(r: ResourceEntry) {
    setBusy(r.uri); setError(null);
    try {
      const { text } = await post({ op: 'resource', serverId: r.serverId, uri: r.uri });
      onAttach(r.name || r.uri, String(text ?? ''));
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not attach that.'); }
    finally { setBusy(null); }
  }

  return (
    <div className="absolute bottom-full mb-2 left-0 w-[min(100%,420px)] bg-panel border border-border rounded-xl shadow-2xl p-2 z-50" aria-label="Add from a plugin">
      <div className="flex items-center gap-2 mb-1.5">
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search plugin resources" className="flex-1 bg-transparent text-sm text-text outline-none px-2 py-1.5 rounded-md border border-border" />
        <button type="button" onClick={onClose} className="text-xs text-muted hover:text-text px-1">Close</button>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {shown.length === 0 && <p className="text-xs text-muted px-2 py-3">No resources match.</p>}
        {shown.map(r => (
          <button key={`${r.serverId}:${r.uri}`} type="button" onClick={() => attach(r)} disabled={!!busy} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-bg disabled:opacity-50">
            <span className="text-sm text-text">{r.name}</span>
            <span className="text-xs text-muted"> · {r.server}</span>
            <span className="block text-[11px] text-muted truncate font-mono">{busy === r.uri ? 'Attaching…' : r.uri}</span>
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-red-500 px-2 pt-1">{error}</p>}
    </div>
  );
}
