import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import log from 'electron-log';
import { isTrustedSender } from './guard';
import { clearFolder, currentFolder, editFile, FolderError, listFiles, pickFolder, previewFile, readFile, writeFile } from './folder';
import { addServer, callTool, listServers, listTools, LocalMcpError, removeServer, type LocalToolDef } from './mcp';

/**
 * The local bridge's IPC surface. Every handler refuses an untrusted sender
 * (guard.ts) and returns { ok, ... } rather than throwing, so the web app gets a
 * readable reason instead of an opaque IPC error.
 */
const FOLDER_SERVER = 'This Mac';

const FOLDER_TOOLS: LocalToolDef[] = [
  { name: 'local__list_files', server: FOLDER_SERVER, description: 'List files in the folder the user chose on their Mac.', inputSchema: { type: 'object', properties: { prefix: { type: 'string', description: 'Subfolder, or empty for all.' } }, required: ['prefix'] } },
  { name: 'local__read_file', server: FOLDER_SERVER, description: 'Read a text file from the folder on the user\'s Mac. offset/limit are 1-based lines, 0 for all.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['path', 'offset', 'limit'] } },
  { name: 'local__write_file', server: FOLDER_SERVER, description: 'Create or replace a text file in the folder on the user\'s Mac.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'local__edit_file', server: FOLDER_SERVER, description: 'Replace exact text in a file in the folder on the user\'s Mac. old_str must match once unless replace_all.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['path', 'old_str', 'new_str', 'replace_all'] } },
];

type Handler = (e: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown> | unknown;
function handle(channel: string, fn: Handler) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!isTrustedSender(e)) {
      log.warn(`[local] refused ${channel} from ${e.senderFrame?.url ?? 'unknown'}`);
      return { ok: false, error: 'This page may not use local features.' };
    }
    try {
      return { ok: true, value: await fn(e, ...args) };
    } catch (err) {
      const known = err instanceof FolderError || err instanceof LocalMcpError;
      if (!known) log.error(`[local] ${channel} failed`, err);
      return { ok: false, error: known ? (err as Error).message : 'That did not work on this Mac.' };
    }
  });
}

async function callAnyTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const a = args ?? {};
  // Folder tools answer like MCP results, so the chat's tool cards read them the same way.
  const text = (v: unknown) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }] });
  const fail = (m: string) => ({ isError: true, content: [{ type: 'text', text: m }] });
  try {
    switch (name) {
      case 'local__list_files': return text(listFiles(String(a.prefix ?? '')));
      case 'local__read_file': return text(readFile(String(a.path ?? ''), Number(a.offset) || undefined, Number(a.limit) || undefined));
      case 'local__write_file': return text(await writeFile(String(a.path ?? ''), a.content));
      case 'local__edit_file': return text(await editFile(String(a.path ?? ''), a.old_str, a.new_str, a.replace_all === true));
      default: return await callTool(name, a);
    }
  } catch (err) {
    if (err instanceof FolderError || err instanceof LocalMcpError) return fail(err.message);
    // A missing file is the model's mistake, not a broken Mac: say so, so it can correct the path.
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return fail('That file does not exist in the folder.');
    if ((err as NodeJS.ErrnoException)?.code === 'EISDIR') return fail('That path is a folder, not a file.');
    if (/connection closed/i.test(String((err as Error)?.message ?? ''))) return fail('The local server stopped while running this tool.');
    throw err;
  }
}

export function registerLocalIpc(): void {
  handle('local:toolDefs', async () => {
    const folder = currentFolder();
    const mcp = await listTools();
    return [...(folder ? FOLDER_TOOLS : []), ...mcp];
  });
  handle('local:callTool', (_e, name, args) => callAnyTool(String(name), (args ?? {}) as Record<string, unknown>));
  handle('local:folder:current', () => currentFolder());
  handle('local:folder:pick', () => pickFolder());
  handle('local:folder:clear', () => { clearFolder(); return null; });
  handle('local:folder:list', (_e, prefix) => listFiles(String(prefix ?? '')));
  handle('local:folder:preview', (_e, p) => previewFile(String(p ?? '')));
  handle('local:mcp:servers', () => listServers());
  handle('local:mcp:add', (_e, cfg) => addServer(cfg));
  handle('local:mcp:remove', (_e, id) => removeServer(String(id ?? '')));
}
