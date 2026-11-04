'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import { auth } from '@/lib/firebase';
import { humanTool, type ToolUiRef } from '@/lib/chat/tool-activity';

/**
 * The side panel that hosts MCP Apps widgets ("Widget from Higgsfield").
 *
 * Security model, in order of importance:
 *  1. The widget is foreign HTML. It runs in an iframe with sandbox
 *     "allow-scripts allow-forms" and NO allow-same-origin, so its origin is
 *     opaque: it cannot read our cookies, storage, DOM or Firebase session.
 *  2. It gets a CSP built from its own declared _meta.ui.csp (connect and
 *     resource domains). Undeclared network access is blocked.
 *  3. It never sees a credential. Its tool calls go through /api/mcp/ui, which
 *     holds the connector login server side and only calls tools that server
 *     lists, under an hourly cap.
 */

export interface WidgetTarget {
  ui: ToolUiRef;
  server?: string;
  tool: string;
  toolCallId: string;
  /** Live values while the turn is fresh; fetched from the saved copy otherwise. */
  args?: unknown;
  result?: unknown;
}

interface Ctx { open: (t: WidgetTarget) => void }
const WidgetPanelContext = createContext<Ctx | null>(null);
export const WidgetPanelProvider = WidgetPanelContext.Provider;
export function useWidgetPanel(): Ctx | null { return useContext(WidgetPanelContext); }

async function api(body: Record<string, unknown>) {
  const token = await auth.currentUser?.getIdToken().catch(() => null);
  const res = await fetch('/api/mcp/ui', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `widget request failed (${res.status})`);
  return data;
}

function cspFor(meta: { csp?: { connectDomains?: string[]; resourceDomains?: string[]; frameDomains?: string[]; baseUriDomains?: string[] } } | null): string {
  const clean = (xs?: string[]) => (xs ?? []).filter(d => /^https:\/\/[^\s;'"]+$/.test(d)).join(' ');
  const res = clean(meta?.csp?.resourceDomains);
  const conn = clean(meta?.csp?.connectDomains);
  const frames = clean(meta?.csp?.frameDomains);
  const base = clean(meta?.csp?.baseUriDomains);
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${res}`,
    `style-src 'unsafe-inline' ${res}`,
    // Generated media lives on arbitrary CDNs; images and video are low risk.
    `img-src data: blob: https:`,
    `media-src data: blob: https:`,
    `font-src data: ${res}`,
    `connect-src ${conn || "'none'"}`,
    `frame-src ${frames || "'none'"}`,
    `base-uri ${base || "'none'"}`,
    "form-action 'none'",
  ].join('; ');
}

function withCsp(html: string, csp: string): string {
  const tag = `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, '&quot;')}">`;
  // Must precede any script, so it goes first inside <head> (or the document).
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, m => `${m}${tag}`);
  return tag + html;
}

function McpAppFrame({ target, onMessage }: { target: WidgetTarget; onMessage: (text: string) => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [height, setHeight] = useState(420);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let bridge: AppBridge | null = null;
    // No state reset here: the panel keys this component by toolCallId, so a
    // different call is a fresh mount.
    (async () => {
      try {
        const [resource, saved] = await Promise.all([
          api({ op: 'resource', serverId: target.ui.serverId, uri: target.ui.uri }),
          target.result === undefined ? api({ op: 'result', toolCallId: target.toolCallId }).catch(() => null) : null,
        ]);
        if (cancelled || !frameRef.current?.contentWindow) return;
        const args = target.args ?? saved?.args ?? undefined;
        const result = target.result ?? saved?.result ?? undefined;
        const dark = document.documentElement.classList.contains('dark');

        bridge = new AppBridge(
          null,
          { name: 'MODUS', version: '1.0.0' },
          { openLinks: {}, serverTools: {}, downloadFile: {}, logging: {}, message: { text: {} } },
          { hostContext: { theme: dark ? 'dark' : 'light', displayMode: 'inline', availableDisplayModes: ['inline'], platform: 'web', locale: navigator.language, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, toolInfo: { tool: { name: target.tool, inputSchema: { type: 'object' } } } } },
        );
        bridge.oncalltool = async (params) => (await api({ op: 'call', serverId: target.ui.serverId, name: params.name, arguments: params.arguments ?? {} })).result;
        bridge.onopenlink = async ({ url }) => {
          if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
          return {};
        };
        bridge.ondownloadfile = async () => ({});
        bridge.onmessage = async (params) => {
          const text = (params.content ?? []).filter(c => c.type === 'text').map(c => (c as { text: string }).text).join('\n').trim();
          if (text) onMessage(text);
          return {};
        };
        // +2 for the 1px border on each side, which the widget's own measurement excludes.
        bridge.onsizechange = ({ height: h }) => { if (typeof h === 'number' && h > 0) setHeight(Math.min(Math.max(Math.ceil(h) + 2, 120), 2000)); };
        bridge.oninitialized = () => {
          if (args && typeof args === 'object') bridge?.sendToolInput({ arguments: args as Record<string, unknown> }).catch(() => {});
          if (result && typeof result === 'object') bridge?.sendToolResult(result as Parameters<AppBridge['sendToolResult']>[0]).catch(() => {});
        };
        // Connect BEFORE the document loads: the widget posts ui/initialize as
        // soon as its script runs, and a message sent before we listen is lost.
        // contentWindow is a stable WindowProxy across the srcdoc navigation.
        const win = frameRef.current.contentWindow;
        await bridge.connect(new PostMessageTransport(win, win));
        if (cancelled) return;
        setSrcDoc(withCsp(String(resource.html), cspFor(resource.meta)));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load this widget');
      }
    })();
    return () => {
      cancelled = true;
      bridge?.close().catch(() => {});
    };
  }, [target, onMessage]);

  return (
    <div className="w-full">
      {error && <p className="text-xs text-red-500 px-1 py-2">{error}</p>}
      {!srcDoc && !error && <div className="h-40 rounded-lg bg-text/[0.04] animate-pulse" />}
      <iframe
        ref={frameRef}
        title={`${target.server ?? 'Plugin'} widget`}
        sandbox="allow-scripts allow-forms"
        srcDoc={srcDoc ?? '<!doctype html><html><body></body></html>'}
        className={`w-full rounded-lg border border-border bg-transparent ${srcDoc ? '' : 'hidden'}`}
        style={{ height }}
      />
    </div>
  );
}

export function WidgetSidePanel({ target, onClose, onMessage }: { target: WidgetTarget; onClose: () => void; onMessage: (text: string) => void }) {
  return (
    <aside
      aria-label="Plugin widget"
      className="fixed inset-0 z-40 bg-bg flex flex-col md:static md:inset-auto md:z-auto md:w-[min(46%,560px)] md:shrink-0 md:border-l md:border-border"
    >
      <div className="flex items-center gap-2 px-4 h-12 border-b border-border shrink-0">
        <p className="text-sm text-text truncate flex-1">
          <span className="text-muted">Widget from </span>{target.server ?? 'plugin'}
          <span className="text-muted"> · {humanTool(target.tool)}</span>
        </p>
        <button onClick={onClose} className="text-muted hover:text-text text-sm px-2 py-1" aria-label="Close widget">Close</button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <McpAppFrame key={target.toolCallId} target={target} onMessage={onMessage} />
      </div>
    </aside>
  );
}
