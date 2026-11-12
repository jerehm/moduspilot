import { app, ipcMain, shell } from 'electron';
import { randomBytes } from 'crypto';
import log from 'electron-log';
import { isTrustedSender } from './local/guard';
import { createMainWindow, getMainWindow, modusOrigin, showMainWindow } from './windows';

/**
 * Sign in through the user's real browser.
 *
 * Google/Apple sign-in inside this window can't use the passkeys people already
 * have: those live in iCloud Keychain or Chrome, and an app can't read them
 * (Apple gives that only to browsers). So Touch ID never showed and Google fell
 * back to "use your phone over Bluetooth". Safari/Chrome have all of it.
 *
 * 1. start: make (or REUSE) a random state, open
 *    https://moduspilot.com/desktop/signin?state=S in the default browser.
 * 2. The browser signs in and issues a one-time code for S.
 * 3. The code reaches us TWO ways, whichever is first:
 *    - polling /api/desktop/auth-poll with S every 2s (always works), and
 *    - the modusdesktop://auth?code=C&state=S link (a shortcut browsers may
 *      block or ask about).
 * 4. finish: load /desktop/complete?code=C once, which trades it for a session.
 *
 * Rules that make this hold up (2026-11-08: clicking Sign in 3 times made 3
 * states, each dropping the last, and the link never arrived, so the app waited
 * forever):
 * - ONE sign-in at a time. Clicking again reuses the same state, so every tab
 *   the user opened can finish it.
 * - A link is accepted only for the state in progress. A stranger's link (a web
 *   page, an email) can never sign this app into THEIR account.
 * - It ends exactly once: success, cancel, or a 10 minute timeout. The page is
 *   told (auth:browser:ended) so the waiting screen never sticks.
 * Server side: apps/web/lib/desktop-auth.ts.
 */
export const AUTH_SCHEME = 'modusdesktop';
// 10 minutes. Unpackaged test runs may shorten it to exercise the timeout.
const STATE_TTL_MS = (!app.isPackaged && Number(process.env.MODUS_TEST_AUTH_TTL_MS)) || 10 * 60 * 1000;
const POLL_MS = 2000;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

type EndReason = 'signed-in' | 'cancelled' | 'timed-out';
let pending: { state: string; expires: number; timer: NodeJS.Timeout | null } | null = null;

// Unpackaged test runs only: log the URL instead of opening a browser, so a
// script can play the browser's part.
const testNoBrowser = () => !app.isPackaged && process.env.MODUS_TEST_AUTH_NO_BROWSER === '1';

function notifyEnded(reason: EndReason) {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send('auth:browser:ended', reason);
}

function end(reason: EndReason) {
  if (!pending) return;
  if (pending.timer) clearTimeout(pending.timer);
  pending = null;
  log.info(`[auth] browser sign-in ended: ${reason}`);
  if (reason !== 'signed-in') notifyEnded(reason);
}

function schedulePoll() {
  const p = pending;
  if (!p) return;
  p.timer = setTimeout(() => { void poll(p.state); }, POLL_MS);
}

async function poll(state: string) {
  const p = pending;
  if (!p || p.state !== state) return; // ended or replaced meanwhile
  if (p.expires < Date.now()) { end('timed-out'); return; }
  try {
    const res = await fetch(`${modusOrigin()}/api/desktop/auth-poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    if (res.ok) {
      const body = (await res.json()) as { code?: string };
      if (body.code && pending?.state === state) { await finish(body.code, 'poll'); return; }
    }
  } catch {
    // Offline or the server hiccuped. Keep trying until the state expires.
  }
  if (pending?.state === state) schedulePoll();
}

async function finish(code: string, via: 'poll' | 'link') {
  if (!pending || !TOKEN_RE.test(code)) return;
  end('signed-in'); // before any await, so the other path can't finish it again
  log.info(`[auth] browser sign-in returned via ${via}, finishing in app`);
  const win = await createMainWindow();
  showMainWindow();
  app.focus({ steal: true });
  win.loadURL(`${modusOrigin()}/desktop/complete?code=${encodeURIComponent(code)}`).catch(() => {});
}

export async function startBrowserSignIn(): Promise<{ expiresAt: number }> {
  if (!pending || pending.expires < Date.now()) {
    // Replacing an expired one: clear it quietly. Telling the page 'timed-out'
    // here would show that error over the new waiting screen.
    if (pending?.timer) clearTimeout(pending.timer);
    pending = { state: randomBytes(32).toString('base64url'), expires: Date.now() + STATE_TTL_MS, timer: null };
    schedulePoll();
    log.info('[auth] browser sign-in started');
  } else {
    log.info('[auth] browser sign-in already in progress, reopening the same one');
  }
  const url = `${modusOrigin()}/desktop/signin?state=${pending.state}`;
  if (testNoBrowser()) log.info(`[auth][test] browser url ${url}`);
  else await shell.openExternal(url);
  return { expiresAt: pending.expires };
}

export function cancelBrowserSignIn(): void {
  end('cancelled');
}

export function browserSignInStatus(): { pending: boolean; expiresAt: number | null } {
  if (pending && pending.expires < Date.now()) end('timed-out');
  return { pending: !!pending, expiresAt: pending?.expires ?? null };
}

/** True if this is one of our links (whether or not it turns out valid). */
export function isAuthUrl(raw: string): boolean {
  return typeof raw === 'string' && raw.startsWith(`${AUTH_SCHEME}://`);
}

export async function handleAuthUrl(raw: string): Promise<void> {
  let u: URL;
  try { u = new URL(raw); } catch { log.warn('[auth] unparseable link ignored'); return; }
  if (u.protocol !== `${AUTH_SCHEME}:` || u.hostname !== 'auth') { log.warn('[auth] unknown link ignored'); return; }
  const code = u.searchParams.get('code') ?? '';
  const state = u.searchParams.get('state') ?? '';
  if (!pending) {
    // Usually the poll already finished this sign-in a moment earlier. Just
    // bring the app forward; never act on the link.
    log.info('[auth] link arrived with no sign-in in progress (already finished or never started), ignored');
    if (getMainWindow()) showMainWindow();
    return;
  }
  if (state !== pending.state || !TOKEN_RE.test(code)) {
    log.warn('[auth] sign-in link refused: not the sign-in in progress');
    return;
  }
  if (pending.expires < Date.now()) { end('timed-out'); return; }
  await finish(code, 'link');
}

export function registerAuthIpc(): void {
  ipcMain.handle('auth:browser:start', async (e) => {
    if (!isTrustedSender(e)) return { ok: false, error: 'Not allowed.' };
    try { return { ok: true, ...(await startBrowserSignIn()) }; }
    catch (err) { log.error('[auth] could not open the browser', err); return { ok: false, error: 'Could not open your browser.' }; }
  });
  ipcMain.handle('auth:browser:cancel', (e) => {
    if (!isTrustedSender(e)) return { ok: false };
    cancelBrowserSignIn();
    return { ok: true };
  });
  ipcMain.handle('auth:browser:status', (e) => {
    if (!isTrustedSender(e)) return { pending: false, expiresAt: null };
    return browserSignInStatus();
  });
}
