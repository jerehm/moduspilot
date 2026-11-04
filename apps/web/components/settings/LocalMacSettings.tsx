'use client';

import { useCallback, useEffect, useState } from 'react';
import { desktopBridge, type LocalServer } from '@/lib/desktop-bridge';

/**
 * "On this Mac": the folder the model may work in and local (stdio) MCP
 * servers. Only rendered inside the desktop app, where window.modusDesktop
 * exists. Every sensitive step (choosing the folder, adding a command, the
 * first write, the first tool call) is confirmed in a native macOS dialog,
 * not here.
 */
export default function LocalMacSettings() {
  const [bridge] = useState(() => desktopBridge());
  const [folder, setFolder] = useState<string | null>(null);
  const [servers, setServers] = useState<LocalServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');

  const refresh = useCallback(async () => {
    if (!bridge) return;
    const [f, s] = await Promise.all([bridge.folder.current(), bridge.mcp.servers()]);
    if (f.ok) setFolder(f.value);
    if (s.ok) setServers(s.value);
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    Promise.all([bridge.folder.current(), bridge.mcp.servers()]).then(([f, s]) => {
      if (!alive) return;
      if (f.ok) setFolder(f.value);
      if (s.ok) setServers(s.value);
    }).catch(() => {});
    return () => { alive = false; };
  }, [bridge]);

  if (!bridge) return null;

  async function run<T>(p: Promise<{ ok: true; value: T } | { ok: false; error: string }>) {
    setBusy(true); setError(null);
    try {
      const r = await p;
      if (!r.ok) setError(r.error);
      await refresh();
      return r.ok;
    } finally { setBusy(false); }
  }

  async function add() {
    // Split args on spaces, keeping "quoted parts" together.
    const parts = (args.match(/"[^"]*"|\S+/g) ?? []).map(a => a.replace(/^"|"$/g, ''));
    const ok = await run(bridge!.mcp.add({ name: name.trim(), command: command.trim(), args: parts }));
    if (ok) { setFormOpen(false); setName(''); setCommand(''); setArgs(''); }
  }

  return (
    <div className="mb-8">
      <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2 px-1">On this Mac</p>
      <div className="bg-panel border border-border rounded-xl divide-y divide-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text">Folder</p>
            <p className="text-xs text-muted truncate">{folder ? folder : 'Let Modus read and edit files in one folder you choose.'}</p>
          </div>
          <button onClick={() => run(bridge.folder.pick())} disabled={busy} className="text-xs font-medium text-brand hover:underline disabled:opacity-50 shrink-0">{folder ? 'Change' : 'Choose folder'}</button>
          {folder && <button onClick={() => run(bridge.folder.clear())} disabled={busy} className="text-xs text-muted hover:text-red-400 shrink-0">Remove</button>}
        </div>
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text">Local plugins</p>
              <p className="text-xs text-muted">MCP servers that run on this Mac. You confirm each one, and each tool the first time it runs.</p>
            </div>
            {!formOpen && <button onClick={() => setFormOpen(true)} className="text-xs font-medium text-brand hover:underline shrink-0">Add</button>}
          </div>
          {formOpen && (
            <div className="mt-3 grid gap-2">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Name, e.g. Filesystem" className="bg-transparent text-sm text-text outline-none px-2.5 py-1.5 rounded-md border border-border" />
              <input value={command} onChange={e => setCommand(e.target.value)} placeholder="Command, e.g. npx" className="bg-transparent text-sm text-text font-mono outline-none px-2.5 py-1.5 rounded-md border border-border" />
              <input value={args} onChange={e => setArgs(e.target.value)} placeholder="Arguments, e.g. -y @modelcontextprotocol/server-everything" className="bg-transparent text-sm text-text font-mono outline-none px-2.5 py-1.5 rounded-md border border-border" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setFormOpen(false)} className="text-xs text-muted hover:text-text px-2 py-1">Cancel</button>
                <button onClick={add} disabled={busy || !name.trim() || !command.trim()} className="text-xs font-medium text-white bg-brand rounded-lg px-3 py-1.5 disabled:opacity-50">{busy ? 'Waiting for you…' : 'Add'}</button>
              </div>
            </div>
          )}
          {servers.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {servers.map(s => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  <span className={`w-1.5 h-1.5 rounded-full ${s.running ? 'bg-emerald-500' : 'bg-border'}`} />
                  <span className="text-text font-medium">{s.name}</span>
                  <span className="text-muted font-mono truncate flex-1">{s.command} {s.args.join(' ')}</span>
                  <button onClick={() => run(bridge.mcp.remove(s.id))} disabled={busy} className="text-muted hover:text-red-400 shrink-0">Remove</button>
                </div>
              ))}
            </div>
          )}
        </div>
        {error && <p className="text-xs text-red-500 px-4 py-2">{error}</p>}
      </div>
    </div>
  );
}
