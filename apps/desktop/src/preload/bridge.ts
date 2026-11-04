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
  bridgeVersion: 1,
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
