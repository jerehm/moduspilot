'use client';

/**
 * window.modusDesktop, exposed by the desktop app's preload
 * (apps/desktop/src/preload/bridge.ts). Null in a normal browser.
 */
export type BridgeResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface LocalToolDef { name: string; description: string; inputSchema: Record<string, unknown>; server: string }
export interface LocalServer { id: string; name: string; command: string; args: string[]; env?: Record<string, string>; running: boolean }
export interface LocalEntry { path: string; size: number; kind: 'text' | 'binary' | 'folder' }

export interface DesktopBridge {
  bridgeVersion: number;
  toolDefs(): Promise<BridgeResult<LocalToolDef[]>>;
  callTool(name: string, args: unknown): Promise<BridgeResult<unknown>>;
  folder: {
    current(): Promise<BridgeResult<string | null>>;
    pick(): Promise<BridgeResult<string | null>>;
    clear(): Promise<BridgeResult<null>>;
    list(prefix?: string): Promise<BridgeResult<LocalEntry[]>>;
    preview(path: string): Promise<BridgeResult<{ path: string; mime: string; text?: string; dataUrl?: string }>>;
  };
  mcp: {
    servers(): Promise<BridgeResult<LocalServer[]>>;
    add(cfg: { name: string; command: string; args: string[]; env?: Record<string, string> }): Promise<BridgeResult<LocalServer>>;
    remove(id: string): Promise<BridgeResult<void>>;
  };
}

export function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { modusDesktop?: DesktopBridge }).modusDesktop;
  return b && typeof b.toolDefs === 'function' ? b : null;
}

export function isLocalTool(name: string): boolean {
  return name.startsWith('local__');
}
