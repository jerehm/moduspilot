import { app, dialog, BrowserWindow, type IpcMainInvokeEvent } from 'electron';

/**
 * Who may use the local bridge (folder access, local MCP servers).
 *
 * The main window loads the remote MODUS web app, so the bridge is reachable by
 * whatever page that window shows. Every IPC call checks the calling frame's
 * origin: only MODUS itself, plus the local dev server when unpackaged. A page
 * that navigated anywhere else, or an embedded frame, gets nothing.
 */
const PROD_ORIGINS = new Set(['https://moduspilot.com', 'https://app.moduspilot.com']);
const DEV_ORIGINS = new Set(['http://localhost:3100']);

export function isTrustedSender(e: IpcMainInvokeEvent): boolean {
  const frame = e.senderFrame;
  if (!frame || frame.parent) return false; // top frame only
  let origin = '';
  try { origin = new URL(frame.url).origin; } catch { return false; }
  return PROD_ORIGINS.has(origin) || (!app.isPackaged && DEV_ORIGINS.has(origin));
}

/** Test hook for unpackaged runs only: answer every consent dialog with the first button. */
export function autoApprove(): boolean {
  return !app.isPackaged && process.env.MODUS_TEST_AUTO_APPROVE === '1';
}

/** A native consent dialog. Returns the index of the button pressed. */
export async function ask(opts: { message: string; detail: string; buttons: string[]; cancelId: number }): Promise<number> {
  if (autoApprove()) return 0;
  // Only a VISIBLE window may own the sheet. getAllWindows()[0] could be the
  // hidden main window or the hidden overlay, and a sheet on a hidden window is
  // never seen: the dialog, and the tool call waiting on it, hung forever.
  const focused = BrowserWindow.getFocusedWindow();
  const win = (focused && focused.isVisible() ? focused : null)
    ?? BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.isVisible() && !w.isMinimized())
    ?? null;
  if (!win) app.focus({ steal: true });
  const r = win
    ? await dialog.showMessageBox(win, { type: 'question', message: opts.message, detail: opts.detail, buttons: opts.buttons, cancelId: opts.cancelId, defaultId: opts.cancelId, noLink: true })
    : await dialog.showMessageBox({ type: 'question', message: opts.message, detail: opts.detail, buttons: opts.buttons, cancelId: opts.cancelId, defaultId: opts.cancelId, noLink: true });
  return r.response;
}
