import { app, ipcMain, shell } from 'electron';
import { randomBytes } from 'crypto';
import log from 'electron-log';
import { isTrustedSender } from './local/guard';
import { createMainWindow, modusOrigin, showMainWindow } from './windows';

/**
 * Sign in through the user's real browser.
 *
 * Google/Apple sign-in inside this window can't use the passkeys people already
 * have: those live in iCloud Keychain or Chrome, and an app can't read them
 * (Apple gives that only to browsers). So Touch ID never showed and Google fell
 * back to "use your phone over Bluetooth". Safari/Chrome have all of it.
 *
 * 1. startBrowserSignIn: make a random `state`, open
 *    https://moduspilot.com/desktop/signin?state=S in the default browser.
 * 2. The browser page signs in, gets a one-time code, opens
 *    modusdesktop://auth?code=C&state=S.
 * 3. handleAuthUrl: ONLY if S is the state this app made (and not expired), load
 *    /desktop/complete?code=C in the main window, which trades it for a session.
 *
 * The state check is what stops a link from a stranger (a web page, an email)
 * signing this app into THEIR account. Server side: apps/web/lib/desktop-auth.ts.
 */
export const AUTH_SCHEME = 'modusdesktop';
const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

let pending: { state: string; expires: number } | null = null;

export async function startBrowserSignIn(): Promise<void> {
  const state = randomBytes(32).toString('base64url');
  pending = { state, expires: Date.now() + STATE_TTL_MS };
  const url = `${modusOrigin()}/desktop/signin?state=${state}`;
  log.info('[auth] opening browser sign-in');
  await shell.openExternal(url);
}

export function cancelBrowserSignIn(): void {
  pending = null;
}

/** True if this is one of our links (whether or not it turns out valid). */
export function isAuthUrl(raw: string): boolean {
  return raw.startsWith(`${AUTH_SCHEME}://`);
}

export async function handleAuthUrl(raw: string): Promise<void> {
  let u: URL;
  try { u = new URL(raw); } catch { log.warn('[auth] unparseable link ignored'); return; }
  if (u.protocol !== `${AUTH_SCHEME}:` || u.hostname !== 'auth') { log.warn('[auth] unknown link ignored'); return; }

  const code = u.searchParams.get('code') ?? '';
  const state = u.searchParams.get('state') ?? '';
  const p = pending;
  if (!p || !TOKEN_RE.test(code) || state !== p.state) {
    // Not a sign-in this app started. Never act on it.
    log.warn('[auth] sign-in link refused: no matching sign-in in progress');
    return;
  }
  pending = null; // one use
  const win = await createMainWindow();
  showMainWindow();
  app.focus({ steal: true });
  if (p.expires < Date.now()) {
    log.warn('[auth] sign-in link arrived after the state expired');
    win.loadURL(`${modusOrigin()}/login?error=desktop`).catch(() => {});
    return;
  }
  log.info('[auth] browser sign-in returned, finishing in app');
  win.loadURL(`${modusOrigin()}/desktop/complete?code=${encodeURIComponent(code)}`).catch(() => {});
}

export function registerAuthIpc(): void {
  ipcMain.handle('auth:browser:start', async (e) => {
    if (!isTrustedSender(e)) return { ok: false, error: 'Not allowed.' };
    try { await startBrowserSignIn(); return { ok: true }; }
    catch (err) { log.error('[auth] could not open the browser', err); return { ok: false, error: 'Could not open your browser.' }; }
  });
  ipcMain.handle('auth:browser:cancel', (e) => {
    if (!isTrustedSender(e)) return { ok: false };
    cancelBrowserSignIn();
    return { ok: true };
  });
}
