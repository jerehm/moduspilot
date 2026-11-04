import { jsonSchema, tool } from 'ai';
import { Workspace, WorkspaceError } from '../workspace';

/**
 * The model's file tools for the chat's workspace. Every rule (paths, sizes,
 * quotas, edit matching) lives in lib/workspace.ts; these only adapt it.
 *
 * A rule violation comes back as an ordinary result the model can act on
 * ("old_str appears 3 times..."), never a throw: makeToolErrorsNonFatal would
 * catch a throw, but it tells the model the tool is unavailable, which is the
 * wrong lesson for a fixable mistake.
 */

export const WORKSPACE_TOOL_NAMES = ['list_files', 'read_file', 'write_file', 'edit_file', 'delete_file'] as const;
export const WORKSPACE_SERVER_LABEL = 'Files';

const READ_CAP = 60_000;

function fail(e: unknown) {
  if (e instanceof WorkspaceError) return { ok: false, error: e.code, message: e.message };
  throw e;
}

const obj = <T,>(properties: Record<string, unknown>, required: string[]) =>
  jsonSchema<T>({ type: 'object', properties, required, additionalProperties: false } as Parameters<typeof jsonSchema>[0]);

export function workspaceTools(ws: Workspace): Record<string, unknown> {
  return {
    list_files: tool({
      description: 'List the files in this chat\'s workspace (path, size, version). Use before reading if unsure what exists.',
      parameters: obj<{ prefix: string }>({ prefix: { type: 'string', description: 'Only paths starting with this folder, e.g. "notes/". Empty for all.' } }, ['prefix']),
      execute: async ({ prefix }: { prefix: string }) => {
        const files = (await ws.list()).filter(f => !prefix || f.path.startsWith(prefix));
        return { ok: true, files: files.slice(0, 300).map(f => ({ path: f.path, size: f.size, version: f.version, kind: f.kind })) };
      },
    }),
    read_file: tool({
      description: 'Read a text file from the workspace. For long files pass offset (1-based line) and limit (lines).',
      parameters: obj<{ path: string; offset: number; limit: number }>({
        path: { type: 'string' },
        offset: { type: 'number', description: 'First line, 1-based. 0 for the start.' },
        limit: { type: 'number', description: 'Number of lines. 0 for all.' },
      }, ['path', 'offset', 'limit']),
      execute: async ({ path, offset, limit }: { path: string; offset: number; limit: number }) => {
        try {
          const r = await ws.read(path, { offset: offset || undefined, limit: limit || undefined });
          if (r.content === undefined) return { ok: true, path: r.meta.path, kind: 'binary', mime: r.meta.mime, size: r.meta.size, note: 'Binary file. It cannot be read as text.' };
          const truncated = r.content.length > READ_CAP;
          return { ok: true, path: r.meta.path, version: r.meta.version, totalLines: r.totalLines, content: truncated ? r.content.slice(0, READ_CAP) : r.content, ...(truncated ? { truncated: true, note: 'Truncated. Read the rest with offset and limit.' } : {}) };
        } catch (e) { return fail(e); }
      },
    }),
    write_file: tool({
      description: 'Create a text file or replace its whole content. Creates folders as needed. Use for documents, notes, code and data. Prefer edit_file for small changes to an existing file.',
      parameters: obj<{ path: string; content: string }>({ path: { type: 'string', description: 'e.g. "docs/plan.md"' }, content: { type: 'string' } }, ['path', 'content']),
      execute: async ({ path, content }: { path: string; content: string }) => {
        try {
          const m = await ws.write(path, content, 'model');
          return { ok: true, path: m.path, version: m.version, size: m.size };
        } catch (e) { return fail(e); }
      },
    }),
    edit_file: tool({
      description: 'Replace exact text in a file. old_str must match the file exactly (read it first) and appear once, unless replace_all is true.',
      parameters: obj<{ path: string; old_str: string; new_str: string; replace_all: boolean }>({
        path: { type: 'string' },
        old_str: { type: 'string' },
        new_str: { type: 'string' },
        replace_all: { type: 'boolean' },
      }, ['path', 'old_str', 'new_str', 'replace_all']),
      execute: async ({ path, old_str, new_str, replace_all }: { path: string; old_str: string; new_str: string; replace_all: boolean }) => {
        try {
          const { meta, replaced } = await ws.edit(path, old_str, new_str, !!replace_all, 'model');
          return { ok: true, path: meta.path, version: meta.version, replaced };
        } catch (e) { return fail(e); }
      },
    }),
    delete_file: tool({
      description: 'Delete a file from the workspace. The user can restore it from its history. Only when the user asked for it.',
      parameters: obj<{ path: string }>({ path: { type: 'string' } }, ['path']),
      execute: async ({ path }: { path: string }) => {
        try { await ws.delete(path); return { ok: true, path }; } catch (e) { return fail(e); }
      },
    }),
  };
}

/** The system prompt block: what exists, and how to work with it. */
export function workspacePromptBlock(paths: string[]): string {
  const shown = paths.slice(0, 60);
  const listing = shown.length
    ? shown.map(p => `- ${p}`).join('\n') + (paths.length > shown.length ? `\n- ...and ${paths.length - shown.length} more (use list_files)` : '')
    : '(empty)';
  return '\n\nWORKSPACE FILES (this chat has a private folder; tools: list_files, read_file, write_file, edit_file, delete_file):\n' +
    listing +
    '\nPut long documents, plans, code and data in files instead of pasting them into the reply, then give a short summary. ' +
    'Edit existing files with edit_file rather than rewriting them. Read a file before editing it. ' +
    'Link a file in your reply as [name](workspace:path). Never claim a file was written unless the tool returned ok.';
}
