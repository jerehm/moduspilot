'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { WorkspaceContext as Ctx, type Tab, type WorkspaceCtx } from './workspace-context';
export { useWorkspacePanel, useWidgetPanel } from './workspace-context';
import MarkdownMessage from '@/components/chat/MarkdownMessage';
import { McpAppFrame, type WidgetTarget } from './WidgetPanel';
import { wsApi, fmtAge, fmtSize, type FileMeta, type VersionDoc } from '@/lib/workspace-client';
import { diffLines } from '@/lib/workspace-diff';
import { humanTool } from '@/lib/chat/tool-activity';
import { desktopBridge, type LocalEntry } from '@/lib/desktop-bridge';

/**
 * The panel beside a chat: Files (the workspace tree), Preview (one file:
 * view, edit, history) and Widget (an MCP Apps widget). WorkspaceShell owns
 * the state and hands the chat a context, so a tool card or a workspace: link
 * can open a file or a widget without prop drilling.
 */

// Panel state per workspace, kept across remounts. A new chat's window
// remounts when its draft becomes a real conversation (ChatWindow key), right
// as the first turn's file opens itself; this is what keeps it open.
const memory = new Map<string, { open: boolean; tab: Tab; previewPath: string | null }>();

// ── File tree ────────────────────────────────────────────────────────────────

interface Node { name: string; path: string; file?: FileMeta; children: Map<string, Node> }

function buildTree(files: FileMeta[]): Node {
  const root: Node = { name: '', path: '', children: new Map() };
  for (const f of files) {
    const parts = f.path.split('/');
    let cur = root;
    parts.forEach((p, i) => {
      const path = parts.slice(0, i + 1).join('/');
      if (!cur.children.has(p)) cur.children.set(p, { name: p, path, children: new Map() });
      cur = cur.children.get(p)!;
      if (i === parts.length - 1) cur.file = f;
    });
  }
  return root;
}

function sortNodes(n: Node): Node[] {
  // Folders first, then files, each alphabetical.
  return [...n.children.values()].sort((a, b) => (a.file ? 1 : 0) - (b.file ? 1 : 0) || a.name.localeCompare(b.name));
}

function FileIcon({ f }: { f?: FileMeta }) {
  const cls = 'w-3.5 h-3.5 shrink-0 text-muted';
  if (!f) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={cls}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
  if (f.mime.startsWith('image/')) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={cls}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>;
  if (f.mime.startsWith('video/')) return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={cls}><rect x="3" y="5" width="14" height="14" rx="2" /><path d="m17 10 4-2v8l-4-2" /></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={cls}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>;
}

function TreeRows({ node, depth, open, toggle, selected, onOpen }: {
  node: Node; depth: number; open: Set<string>; toggle: (p: string) => void; selected?: string; onOpen: (p: string) => void;
}) {
  return (
    <>
      {sortNodes(node).map(n => {
        const isFolder = !n.file;
        const expanded = isFolder && !open.has(n.path); // folders start expanded; the set holds collapsed ones
        return (
          <div key={n.path}>
            <button
              type="button"
              onClick={() => (isFolder ? toggle(n.path) : onOpen(n.path))}
              className={`w-full flex items-center gap-1.5 py-1 pr-2 rounded-md text-left text-[13px] hover:bg-text/[0.05] ${selected === n.path ? 'bg-text/[0.07] text-text' : 'text-text/85'}`}
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              {isFolder ? <span className={`text-muted text-[10px] w-2.5 transition-transform ${expanded ? 'rotate-90' : ''}`}>›</span> : <span className="w-2.5" />}
              <FileIcon f={n.file} />
              <span className="truncate flex-1">{n.name}</span>
              {n.file && <span className="text-[11px] text-muted tabular-nums shrink-0">{fmtSize(n.file.size)}</span>}
            </button>
            {expanded && <TreeRows node={n} depth={depth + 1} open={open} toggle={toggle} selected={selected} onOpen={onOpen} />}
          </div>
        );
      })}
    </>
  );
}

function FilesTab({ ws, files, loading, error, selected, onOpen, onRefresh }: {
  ws: string; files: FileMeta[]; loading: boolean; error: string | null; selected?: string; onOpen: (p: string) => void; onRefresh: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = filter ? files.filter(f => f.path.toLowerCase().includes(filter.toLowerCase())) : files;
  const tree = useMemo(() => buildTree(shown), [shown]);
  const toggle = (p: string) => setCollapsed(s => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const f of Array.from(list)) await wsApi.upload(ws, f);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      onRefresh();
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter files"
          className="flex-1 min-w-0 bg-transparent text-sm text-text placeholder:text-muted/70 outline-none px-2 py-1 rounded-md border border-border"
        />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="text-xs font-medium text-brand hover:underline disabled:opacity-50 shrink-0">
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={e => { void upload(e.target.files); e.target.value = ''; }} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-1.5 px-1.5">
        {uploadError && <p className="text-xs text-red-500 px-2 py-1">{uploadError}</p>}
        {error && <p className="text-xs text-red-500 px-2 py-1">{error}</p>}
        {loading && files.length === 0 ? (
          <div className="space-y-1.5 p-2">{[0, 1, 2].map(i => <div key={i} className="h-5 rounded bg-text/[0.05] animate-pulse" />)}</div>
        ) : files.length === 0 ? (
          <p className="text-xs text-muted px-3 py-6 text-center leading-relaxed">No files yet. Ask Modus to write one, or upload a file.</p>
        ) : shown.length === 0 ? (
          <p className="text-xs text-muted px-3 py-4">Nothing matches that filter.</p>
        ) : (
          <TreeRows node={tree} depth={0} open={collapsed} toggle={toggle} selected={selected} onOpen={onOpen} />
        )}
      </div>
    </div>
  );
}

// ── Preview ──────────────────────────────────────────────────────────────────

const HTML_PREVIEW_CSP = "default-src 'none'; img-src data: blob: https:; media-src data: blob: https:; style-src 'unsafe-inline' https:; font-src data: https:; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

function HtmlPreview({ html }: { html: string }) {
  const doc = /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, m => `${m}<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">`)
    : `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">${html}`;
  // Same sandbox as plugin widgets: scripts run, but in an opaque origin with
  // no network, so a page the model wrote cannot reach the user's session.
  return <iframe title="HTML preview" sandbox="allow-scripts" srcDoc={doc} className="w-full h-[70vh] rounded-lg border border-border bg-white" />;
}

function FilePreview({ ws, path, refreshKey, onChanged, onGone }: { ws: string; path: string; refreshKey: number; onChanged: () => void; onGone: () => void }) {
  const [meta, setMeta] = useState<FileMeta | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [history, setHistory] = useState<Omit<VersionDoc, 'content'>[] | null>(null);
  const [compare, setCompare] = useState<VersionDoc | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    wsApi.read(ws, path).then(r => {
      if (!alive) return;
      setMeta(r.meta); setContent(r.content); setError(null);
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Could not open file'); });
    return () => { alive = false; };
  }, [ws, path, nonce, refreshKey]);

  const reload = () => { setNonce(n => n + 1); onChanged(); };

  async function save() {
    setSaving(true);
    try { await wsApi.write(ws, path, draft); setEditing(false); setHistory(null); setCompare(null); reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function openHistory() {
    if (history) { setHistory(null); setCompare(null); return; }
    try { setHistory((await wsApi.versions(ws, path)).versions); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load history'); }
  }

  async function rename() {
    const to = window.prompt('Rename to', path);
    if (!to || to === path) return;
    try { await wsApi.rename(ws, path, to); onChanged(); onGone(); } catch (e) { setError(e instanceof Error ? e.message : 'Rename failed'); }
  }

  async function remove() {
    if (!window.confirm(`Delete ${path}? You can restore it from its history.`)) return;
    try { await wsApi.remove(ws, path); onChanged(); onGone(); } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
  }

  function download() {
    if (meta?.kind === 'binary' && meta.url) { window.open(meta.url, '_blank', 'noopener,noreferrer'); return; }
    const blob = new Blob([content ?? ''], { type: meta?.mime ?? 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = path.split('/').pop() ?? 'file';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  if (error && !meta) return <p className="text-xs text-red-500 p-4">{error}</p>;
  if (!meta) return <div className="p-4"><div className="h-40 rounded-lg bg-text/[0.04] animate-pulse" /></div>;

  const isText = meta.kind === 'text';
  const isMd = meta.mime === 'text/markdown';
  const isHtml = meta.mime === 'text/html';

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Path on its own line, actions wrap under it: the panel is narrow on
          phones and in the project page's two-column layout. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 border-b border-border text-xs">
        <p className="w-full truncate text-muted"><span className="text-text">{path}</span> · v{meta.version} · {fmtSize(meta.size)} · {fmtAge(meta.updatedAt)}</p>
        {isText && !editing && <button onClick={() => { setDraft(content ?? ''); setEditing(true); }} className="text-brand hover:underline">Edit</button>}
        {(isHtml || isMd) && !editing && <button onClick={() => setShowSource(s => !s)} className="text-muted hover:text-text">{showSource ? 'Preview' : 'Source'}</button>}
        <button onClick={openHistory} className={history ? 'text-text' : 'text-muted hover:text-text'}>History</button>
        <button onClick={download} className="text-muted hover:text-text">Download</button>
        <button onClick={rename} className="text-muted hover:text-text">Rename</button>
        <button onClick={remove} className="text-muted hover:text-red-500">Delete</button>
      </div>
      {error && <p className="text-xs text-red-500 px-4 pt-2">{error}</p>}
      {history && (
        <div className="border-b border-border px-4 py-2 max-h-56 overflow-y-auto space-y-1">
          {history.map(v => (
            <div key={v.n} className="flex items-center gap-2 text-xs">
              <span className="text-text tabular-nums w-8">v{v.n}</span>
              <span className="text-muted flex-1">{v.source === 'model' ? 'Modus' : v.source === 'user' ? 'You' : v.source === 'upload' ? 'Upload' : 'Plugin'} · {fmtAge(v.at)} · {fmtSize(v.size)}</span>
              {isText && v.n !== meta.version && (
                <button onClick={async () => setCompare((await wsApi.version(ws, path, v.n)).version)} className="text-muted hover:text-text">Compare</button>
              )}
              {v.n !== meta.version && (
                <button onClick={async () => { try { await wsApi.restore(ws, path, v.n); setHistory(null); setCompare(null); reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Restore failed'); } }} className="text-brand hover:underline">Restore</button>
              )}
              {v.n === meta.version && <span className="text-muted">current</span>}
            </div>
          ))}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {editing ? (
          <div className="flex flex-col h-full gap-2">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              spellCheck={isMd}
              className="flex-1 min-h-[50vh] w-full resize-none rounded-lg border border-border bg-panel p-3 font-mono text-[12.5px] leading-relaxed text-text outline-none focus:border-brand/50"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(false)} className="text-xs text-muted hover:text-text px-3 py-1.5">Cancel</button>
              <button onClick={save} disabled={saving || draft === content} className="text-xs font-medium text-white bg-brand rounded-lg px-3 py-1.5 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        ) : compare ? (
          <div>
            <p className="text-xs text-muted mb-2">Changes from v{compare.n} to v{meta.version} <button onClick={() => setCompare(null)} className="ml-2 text-text hover:underline">Close</button></p>
            <pre className="rounded-lg border border-border bg-panel text-[12px] font-mono overflow-x-auto">
              {diffLines(compare.content ?? '', content ?? '').map((l, i) => (
                <div key={i} className={l.op === 'add' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : l.op === 'del' ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'text-text/70'}>
                  <span className="select-none inline-block w-5 text-center opacity-60">{l.op === 'add' ? '+' : l.op === 'del' ? '-' : ' '}</span>{l.text || ' '}
                </div>
              ))}
            </pre>
          </div>
        ) : !isText ? (
          meta.mime.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={meta.url} alt={path} className="max-w-full rounded-lg border border-border" />
          ) : meta.mime.startsWith('video/') ? (
            <video src={meta.url} controls className="max-w-full rounded-lg border border-border bg-black" />
          ) : meta.mime.startsWith('audio/') ? (
            <audio src={meta.url} controls className="w-full" />
          ) : meta.mime === 'application/pdf' ? (
            <iframe title={path} src={meta.url} className="w-full h-[75vh] rounded-lg border border-border" />
          ) : (
            <p className="text-sm text-muted">No preview for this file type. <button onClick={download} className="text-brand hover:underline">Download</button></p>
          )
        ) : isHtml && !showSource ? (
          <HtmlPreview html={content ?? ''} />
        ) : isMd && !showSource ? (
          <MarkdownMessage>{content ?? ''}</MarkdownMessage>
        ) : (
          <pre className="rounded-lg border border-border bg-panel p-3 text-[12.5px] font-mono leading-relaxed text-text whitespace-pre-wrap break-words">{content}</pre>
        )}
      </div>
    </div>
  );
}

// ── This Mac (desktop app) ───────────────────────────────────────────────────

/**
 * The folder the user chose on their Mac, read-only. The model changes files
 * there through the local__ tools; this is for seeing what it did.
 */
function MacTab({ refreshKey }: { refreshKey: number }) {
  const [bridge] = useState(() => desktopBridge());
  const [entries, setEntries] = useState<LocalEntry[] | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ mime: string; text?: string; dataUrl?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    Promise.all([bridge.folder.current(), bridge.folder.list('')]).then(([f, l]) => {
      if (!alive) return;
      setFolder(f.ok ? f.value : null);
      if (l.ok) { setEntries(l.value); setError(null); } else setError(l.error);
    }).catch(() => {});
    return () => { alive = false; };
  }, [bridge, refreshKey]);

  useEffect(() => {
    if (!bridge || !selected) return;
    let alive = true;
    bridge.folder.preview(selected).then(r => {
      if (!alive) return;
      if (r.ok) { setPreview(r.value); setError(null); } else setError(r.error);
    }).catch(() => {});
    return () => { alive = false; };
  }, [bridge, selected, refreshKey]);

  if (!bridge) return null;
  return (
    <div className="flex flex-col h-full min-h-0">
      <p className="px-4 py-2 border-b border-border text-xs text-muted truncate">{folder ?? 'No folder chosen. Choose one in Capabilities, On this Mac.'}</p>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {error && <p className="text-xs text-red-500 px-4 py-2">{error}</p>}
        {selected && preview ? (
          <div className="p-4 space-y-2">
            <button onClick={() => { setSelected(null); setPreview(null); }} className="text-xs text-muted hover:text-text">‹ All files</button>
            <p className="text-xs text-text font-mono">{selected}</p>
            {preview.dataUrl && preview.mime.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.dataUrl} alt={selected} className="max-w-full rounded-lg border border-border" />
            ) : preview.dataUrl ? (
              <iframe title={selected} src={preview.dataUrl} className="w-full h-[70vh] rounded-lg border border-border" />
            ) : preview.mime === 'text/markdown' ? (
              <MarkdownMessage>{preview.text ?? ''}</MarkdownMessage>
            ) : (
              <pre className="rounded-lg border border-border bg-panel p-3 text-[12.5px] font-mono whitespace-pre-wrap break-words text-text">{preview.text}</pre>
            )}
          </div>
        ) : (
          <div className="py-1.5 px-1.5">
            {entries?.length === 0 && <p className="text-xs text-muted px-3 py-6 text-center">This folder is empty.</p>}
            {entries?.map(e => (
              <button
                key={e.path}
                type="button"
                disabled={e.kind === 'folder'}
                onClick={() => setSelected(e.path)}
                className="w-full flex items-center gap-1.5 py-1 pr-2 rounded-md text-left text-[13px] text-text/85 hover:bg-text/[0.05] disabled:hover:bg-transparent"
                style={{ paddingLeft: 8 + (e.path.split('/').length - 1) * 14 }}
              >
                <FileIcon f={e.kind === 'folder' ? undefined : ({ mime: /\.(png|jpe?g|gif|webp)$/i.test(e.path) ? 'image/png' : 'text/plain' } as FileMeta)} />
                <span className="truncate flex-1">{e.path.split('/').pop()}</span>
                {e.kind !== 'folder' && <span className="text-[11px] text-muted tabular-nums">{fmtSize(e.size)}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Standalone browser (project page) ────────────────────────────────────────

/**
 * Files and preview side by side, outside a chat. The project page uses it for
 * the workspace every chat in that project shares.
 */
export function FilesBrowser({ workspaceId }: { workspaceId: string }) {
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);
  useEffect(() => {
    let alive = true;
    wsApi.list(workspaceId)
      .then(f => { if (alive) { setFiles(f); setError(null); } })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Could not load files'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [workspaceId, refreshKey]);
  return (
    <div className="grid md:grid-cols-[minmax(220px,300px)_1fr] gap-4 min-h-[420px]">
      <div className="bg-panel border border-border rounded-xl overflow-hidden h-[60vh] md:h-[70vh]">
        <FilesTab ws={workspaceId} files={files} loading={loading} error={error} selected={selected ?? undefined} onOpen={setSelected} onRefresh={() => { setLoading(true); refresh(); }} />
      </div>
      <div className="bg-panel border border-border rounded-xl overflow-hidden h-[60vh] md:h-[70vh]">
        {selected ? (
          <FilePreview key={selected} ws={workspaceId} path={selected} refreshKey={refreshKey} onChanged={refresh} onGone={() => setSelected(null)} />
        ) : (
          <p className="text-sm text-muted p-6">Pick a file to preview it. Every chat in this project reads and writes these files.</p>
        )}
      </div>
    </div>
  );
}

// ── Shell ────────────────────────────────────────────────────────────────────

export function WorkspaceShell({ workspaceId, onWidgetMessage, children }: {
  workspaceId?: string;
  onWidgetMessage: (text: string) => void;
  children: ReactNode;
}) {
  const remembered = workspaceId ? memory.get(workspaceId) : undefined;
  const [open, setOpen] = useState(remembered?.open ?? false);
  const [tab, setTab] = useState<Tab>(remembered?.tab === 'widget' ? 'files' : remembered?.tab ?? 'files');
  const [widget, setWidget] = useState<WidgetTarget | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(remembered?.previewPath ?? null);
  const [loading, setLoadingState] = useState(!!remembered?.open);
  useEffect(() => {
    if (workspaceId) memory.set(workspaceId, { open, tab, previewPath });
  }, [workspaceId, open, tab, previewPath]);
  const [files, setFiles] = useState<FileMeta[]>([]);
  const setLoading = setLoadingState;
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);
  const [hasMac] = useState(() => !!desktopBridge());
  useEffect(() => {
    if (!workspaceId || !open) return;
    let alive = true;
    wsApi.list(workspaceId)
      .then(f => { if (alive) { setFiles(f); setError(null); } })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Could not load files'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [workspaceId, open, refreshKey]);

  const ctx = useMemo<WorkspaceCtx>(() => ({
    workspaceId,
    isOpen: open,
    openWidget: (t) => { setWidget(t); setTab('widget'); setOpen(true); },
    openFile: (p) => { setPreviewPath(p); setTab('preview'); setOpen(true); setLoading(true); setRefreshKey(k => k + 1); },
    showFiles: () => { setTab('files'); setOpen(true); setLoading(true); setRefreshKey(k => k + 1); },
    toggleFiles: () => setOpen(o => { if (!o) { setTab(t => (t === 'widget' ? 'files' : t)); setLoading(true); setRefreshKey(k => k + 1); } return !o; }),
    refresh,
  }), [workspaceId, refresh, open]);

  const tabs: { id: Tab; label: string }[] = [
    ...(workspaceId ? [{ id: 'files' as const, label: 'Files' }] : []),
    ...(previewPath && workspaceId ? [{ id: 'preview' as const, label: previewPath.split('/').pop() ?? 'Preview' }] : []),
    ...(widget ? [{ id: 'widget' as const, label: `${widget.server ?? 'Plugin'} widget` }] : []),
    ...(hasMac ? [{ id: 'mac' as const, label: 'This Mac' }] : []),
  ];

  return (
    <Ctx.Provider value={ctx}>
      <div className="flex h-full min-h-0">
        <div className="relative flex-1 min-w-0 h-full min-h-0">
          {children}
        </div>
        {open && tabs.length > 0 && (
          <aside
            aria-label="Workspace"
            className="fixed inset-0 z-40 bg-bg flex flex-col md:static md:inset-auto md:z-auto md:w-[min(46%,600px)] md:shrink-0 md:border-l md:border-border"
          >
            <div className="flex items-center gap-1 px-2 h-12 border-b border-border shrink-0">
              <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
                {tabs.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setTab(t.id); if (t.id === 'files') { setLoading(true); refresh(); } }}
                    className={`text-sm px-2.5 py-1 rounded-md truncate max-w-[45%] ${tab === t.id ? 'bg-text/[0.07] text-text' : 'text-muted hover:text-text'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-text text-sm px-2 py-1 shrink-0" aria-label="Close panel">Close</button>
            </div>
            <div className="flex-1 min-h-0">
              {tab === 'files' && workspaceId && (
                <FilesTab ws={workspaceId} files={files} loading={loading} error={error} selected={previewPath ?? undefined} onOpen={ctx.openFile} onRefresh={() => { setLoading(true); refresh(); }} />
              )}
              {tab === 'preview' && workspaceId && previewPath && (
                <FilePreview key={previewPath} ws={workspaceId} path={previewPath} refreshKey={refreshKey} onChanged={refresh} onGone={() => { setPreviewPath(null); setTab('files'); }} />
              )}
              {tab === 'mac' && hasMac && <MacTab refreshKey={refreshKey} />}
              {tab === 'widget' && widget && (
                <div className="h-full overflow-y-auto p-4">
                  <p className="text-xs text-muted mb-2">Widget from <span className="text-text">{widget.server ?? 'plugin'}</span> · {humanTool(widget.tool)}</p>
                  <McpAppFrame key={widget.toolCallId} target={widget} onMessage={onWidgetMessage} />
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </Ctx.Provider>
  );
}
