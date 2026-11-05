import { BrowserWindow, app, shell } from 'electron';
import log from 'electron-log';
import path from 'path';

// The desktop app is just the real MODUS web app in a native window. The user
// signs in here once; the background sync agent pulls a fresh Firebase ID token
// from this signed-in page (window.__modusGetToken__, exposed by the web app
// when it sees the "MODUSDesktop" user agent) to authenticate its uploads.
//
// Enter at /login, not / (which is the marketing homepage): /login shows the
// sign-in form when signed out and auto-redirects to /dashboard when a
// persisted session exists — so the desktop always lands in the actual app.
const MODUS_URL = !app.isPackaged && process.env.MODUS_DESKTOP_URL
  // Dev only: point the shell at a local web server (http://localhost:3100/login).
  ? process.env.MODUS_DESKTOP_URL
  : 'https://moduspilot.com/login';

// Branded dark splash shown instantly (and again while reconnecting). On an
// auto-launch at login the network stack is often not up yet, so loadURL to the
// remote site fails; without this the window sat blank WHITE until a manual
// relaunch. The splash keeps the window branded (never white) while we retry.
function splashUrl(message: string): string {
  return (
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;height:100%;background:#0A0A0F;color:#E8E8F0;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
      .wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px}
      .logo{font-weight:800;letter-spacing:.32em;font-size:15px;color:#A78BFA}
      .ring{width:26px;height:26px;border-radius:50%;border:2.5px solid #26263a;
        border-top-color:#7C3AED;animation:spin .8s linear infinite}
      .msg{font-size:12px;color:#6B6B80}
      @keyframes spin{to{transform:rotate(360deg)}}
    </style></head><body><div class="wrap">
      <div class="logo">MODUS</div><div class="ring"></div><div class="msg">${message}</div>
    </div></body></html>`)
  );
}

let mainWindow: BrowserWindow | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let retryDelay = 1000;
const MAX_RETRY_DELAY = 15000;

// TRAP: a failed navigation still fires did-finish-load. Chromium commits its
// internal error page AT the failed URL, so ~4ms after did-fail-load a
// did-finish-load arrives with getURL() still reading https://moduspilot.com/…
// — indistinguishable from a real load by URL alone. did-finish-load treated
// that as success and cleared the pending retry, so the retry NEVER ran once:
// every launch since 0.1.1 logged "load failed (-106)" then, 4ms later, a lying
// "loaded MODUS web app", and the window sat on "Reconnecting…" until quit.
// This flag is the only thing that separates the error page from the real one.
let loadFailed = false;

function loadRemote(win: BrowserWindow): void {
  // Cleared here, not in did-finish-load: this is the one place a fresh attempt
  // at the real URL begins, so it is the only correct place to forget the last
  // failure. Reset it anywhere later and the retry's own success gets discarded.
  loadFailed = false;
  // did-fail-load drives the retry; the catch just prevents an unhandled
  // rejection when the network isn't ready.
  win.loadURL(MODUS_URL).catch(() => {});
}

export async function createMainWindow(): Promise<BrowserWindow> {
  if (mainWindow) return mainWindow;

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 880,
    minHeight: 600,
    show: false,
    title: 'MODUS',
    // Match the app's dark background so a slow/failed load never flashes white.
    backgroundColor: '#0A0A0F',
    // Loading our own remote web app. The sync agent reads the token via
    // webContents.executeJavaScript against the page's main world.
    // The local bridge (window.modusDesktop) for folder access and local MCP
    // servers. Sandboxed preload, context isolation on, Node off; main checks
    // every call's origin (local/guard.ts). Screen capture is NOT on it.
    webPreferences: {
      preload: path.join(__dirname, '../preload/bridge.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  const win = mainWindow;

  // Tell the web app it's running inside the desktop shell so it exposes
  // window.__modusGetToken__. setUserAgent (vs a loadURL option) persists the
  // marker across in-app SPA navigations and all subsequent requests.
  // The version suffix is the real packaged app version (app.getVersion()) so
  // the web Settings > About tab can display the installed desktop build; the
  // web only substring-matches "MODUSDesktop", so the number is free to change.
  const ua = `${win.webContents.getUserAgent()} MODUSDesktop/${app.getVersion()}`;
  win.webContents.setUserAgent(ua);

  // Firebase signInWithPopup (Google/Apple) opens an OAuth window via
  // window.open — allow those in-app; send any other external link to the
  // system browser instead of opening a rogue window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Matched on the parsed hostname. The old unanchored regex allowed any URL
    // that merely CONTAINED "moduspilot.com" (evil.example/?moduspilot.com).
    let u: URL | null = null;
    try { u = new URL(url); } catch { /* not a URL */ }
    if (!u) return { action: 'deny' };
    const host = u.hostname;
    const inApp = u.protocol === 'https:' && (
      ['accounts.google.com', 'appleid.apple.com', 'moduspilot.com'].some(h => host === h || host.endsWith(`.${h}`))
      || host.endsWith('.firebaseapp.com')
    );
    if (inApp) return { action: 'allow' };
    // Only web links leave the app. file:, smb:, custom app schemes and the like
    // from a remote page could otherwise open things on this Mac.
    if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:') {
      shell.openExternal(url).catch((err) => log.warn('[window] openExternal failed', err));
    } else {
      log.warn(`[window] blocked external open of ${u.protocol} link`);
    }
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => win.show());

  // A crashed renderer does not fire did-fail-load, so the retry below never ran
  // and the window stayed a dead dark rectangle until the app was relaunched.
  let crashCount = 0;
  let crashReset: NodeJS.Timeout | null = null;
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    crashCount++;
    const delay = Math.min(1000 * 2 ** (crashCount - 1), 30_000);
    log.error(`[window] renderer gone (${details.reason}, exit ${details.exitCode}), reloading in ${delay}ms`);
    if (crashReset) clearTimeout(crashReset);
    crashReset = setTimeout(() => { crashCount = 0; }, 5 * 60_000);
    setTimeout(() => {
      if (win.isDestroyed()) return;
      win.loadURL(splashUrl('Reconnecting…')).catch(() => {});
      loadRemote(win);
    }, delay);
  });
  // A page hung in a loop never crashes on its own. Give it 20s to recover, then
  // crash it on purpose so the handler above reloads it.
  let hangTimer: NodeJS.Timeout | null = null;
  win.webContents.on('unresponsive', () => {
    log.warn('[window] renderer unresponsive');
    if (hangTimer) return;
    hangTimer = setTimeout(() => {
      hangTimer = null;
      if (!win.isDestroyed()) {
        log.error('[window] still unresponsive after 20s, restarting the page');
        win.webContents.forcefullyCrashRenderer();
      }
    }, 20_000);
  });
  win.webContents.on('responsive', () => {
    if (hangTimer) { clearTimeout(hangTimer); hangTimer = null; }
  });

  // Closing the window keeps the app alive in the tray (background sync keeps
  // running). Only a real Quit (sets isQuitting) actually tears it down.
  win.on('close', (e) => {
    if (!(app as unknown as { isQuitting?: boolean }).isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    mainWindow = null;
  });

  // Forward the web app's console into the tray app's log file for debugging.
  win.webContents.on('console-message', (_e, _level, message, line, sourceId) => {
    log.info(`[web-console] ${message} (${sourceId}:${line})`);
  });

  // Retry the remote load whenever it fails — the root cause of the blank-window
  // on auto-launch was the network not being ready at login with no retry.
  // errorCode -3 (ERR_ABORTED) fires during normal redirects / SPA navigation
  // and must NOT trigger a retry.
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    if (!validatedURL.startsWith('http')) return; // ignore the data: splash
    // Always fires before the error page's did-finish-load, which is what makes
    // this flag reliable rather than a race.
    loadFailed = true;
    log.warn(`[window] load failed (${errorCode} ${errorDescription}) — retrying in ${retryDelay}ms`);
    // Show branded "reconnecting" instead of Chromium's error page or white.
    win.loadURL(splashUrl('Reconnecting…')).catch(() => {});
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!win.isDestroyed()) loadRemote(win);
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
  });

  win.webContents.on('did-finish-load', () => {
    // The error page for a failed load reports the http URL too — only the flag
    // can tell them apart, so it is checked before the URL.
    if (loadFailed) return;
    // Only the real app (http) counts as success — the data: splash also fires.
    if (win.webContents.getURL().startsWith('http')) {
      retryDelay = 1000;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      log.info('[window] loaded MODUS web app');
    }
  });

  // Paint the branded splash immediately (guarantees a visible, non-white
  // window), then load the real app with retry.
  await win.loadURL(splashUrl('Connecting…'));
  loadRemote(win);
  return win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
