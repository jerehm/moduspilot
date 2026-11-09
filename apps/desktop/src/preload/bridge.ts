import { contextBridge, ipcRenderer } from 'electron';

/**
 * window.modusDesktop: the remote MODUS web app's ONLY way to reach this Mac.
 *
 * Narrow on purpose. No raw ipcRenderer, no screen capture (that stays with the
 * overlay's own local page), no arbitrary paths: the folder is chosen in a
 * native picker, commands are confirmed in native dialogs, and main refuses any
 * caller that is not a MODUS page (main/local/guard.ts).
 */
type Result<T> = Promise<{ ok: true; value: T } | { ok: false; error: string }>;
const call = <T>(channel: string, ...args: unknown[]): Result<T> => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('modusDesktop', {
  bridgeVersion: 2,
  // Sign in through the user's browser (passkeys, Touch ID, saved logins).
  // main/auth.ts. The /login page shows its browser button only when this exists.
  auth: {
    signInWithBrowser: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('auth:browser:start'),
    cancel: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('auth:browser:cancel'),
    // Lets the page restore its waiting screen after a reload.
    status: (): Promise<{ pending: boolean; expiresAt: number | null }> => ipcRenderer.invoke('auth:browser:status'),
    // Fires when a browser sign-in ends WITHOUT signing in (cancelled, timed out).
    // Returns an unsubscribe function.
    onEnded: (cb: (reason: string) => void) => {
      const fn = (_e: unknown, reason: string) => cb(reason);
      ipcRenderer.on('auth:browser:ended', fn);
      return () => { ipcRenderer.removeListener('auth:browser:ended', fn); };
    },
  },
  toolDefs: () => call('local:toolDefs'),
  callTool: (name: string, args: unknown) => call('local:callTool', name, args),
  folder: {
    current: () => call('local:folder:current'),
    pick: () => call('local:folder:pick'),
    clear: () => call('local:folder:clear'),
    list: (prefix?: string) => call('local:folder:list', prefix ?? ''),
    preview: (path: string) => call('local:folder:preview', path),
  },
  mcp: {
    servers: () => call('local:mcp:servers'),
    add: (cfg: { name: string; command: string; args: string[]; env?: Record<string, string> }) => call('local:mcp:add', cfg),
    remove: (id: string) => call('local:mcp:remove', id),
  },
});
