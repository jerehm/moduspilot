import { app, globalShortcut, session } from 'electron';
import log from 'electron-log';
import { createMainWindow, getMainWindow, showMainWindow } from './windows';
import { createTray, setSignedIn, runSync } from './tray';
import { destroyOverlay } from './screen/overlay';
import { registerScreenAssistHotkeys } from './screen/hotkeys';
import { startScheduler } from './sync/scheduler';
import { initLaunchAtLogin } from './settings';
import { getAuthState } from './sync/ingest';
import { pollNotifications } from './notifications';
import { initAutoUpdate } from './updater';
import { registerLocalIpc } from './local/ipc';
import { stopAll as stopLocalMcp } from './local/mcp';

// Keychain access group for the Touch ID WebAuthn authenticator. MUST stay byte-
// for-byte identical to the keychain-access-groups entry in
// build/entitlements.mac.plist, or macOS rejects the keychain item at runtime.
const WEBAUTHN_KEYCHAIN_GROUP = '8KF5J7X9BU.com.moduspilot.desktop.webauthn';

const SYNC_INTERVAL_MS = 5 * 60 * 1000;    // background sync cadence
const AUTH_POLL_MS = 60 * 1000;            // how often we re-check sign-in state
const NOTIFICATION_POLL_MS = 60 * 1000;    // how often we check for new notifications

// Test runs get their own profile, settings file and single-instance lock, so
// they can run beside the installed app without touching its data.
if (!app.isPackaged && process.env.MODUS_TEST_USER_DATA) {
  app.setPath('userData', process.env.MODUS_TEST_USER_DATA);
}

log.initialize();
log.info('[main] starting MODUS Desktop');

// Single instance — a second launch just focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());

  // Anything that throws in here used to take the whole app down silently: the
  // .then() had no .catch(), so the rejection vanished and everything after the
  // throw simply never ran. That is not hypothetical — it is what 0.1.0 did, and
  // it is why a laptop that woke with no network sat on a white window for days.
  app.whenReady().then(async () => {
    registerLocalIpc();
    // Test runs (unpackaged + MODUS_TEST_NO_SYNC=1) sign the window into a TEST
    // account. Sync would then upload this Mac's real Notes, Messages and
    // Contacts into it, so none of the background agents start.
    const testRun = !app.isPackaged && process.env.MODUS_TEST_NO_SYNC === '1';
    if (testRun) log.warn('[main] test run: sync, login item, updater and notifications are OFF');
    if (!testRun) initLaunchAtLogin();

    // Sign-in is Google/Apple OAuth in the login window, and their pages use
    // WebAuthn (navigator.credentials.get) for passkeys/fingerprint. Electron
    // does NOT service the macOS Touch ID platform authenticator until this is
    // called — until then isUserVerifyingPlatformAuthenticatorAvailable() is
    // false and no Touch ID sheet ever appears (the reported bug). The OAuth
    // popup opens with no partition (windows.ts setWindowOpenHandler), so it
    // inherits the default session this configures. Note: these credentials are
    // device-bound (not iCloud-synced), so the user enrolls a passkey once on
    // this Mac. darwin-only API — guard so a future non-mac build won't throw.
    if (process.platform === 'darwin') {
      app.configureWebAuthn({ touchID: { keychainAccessGroup: WEBAUTHN_KEYCHAIN_GROUP } });
      // Without a handler, a request that resolves multiple discoverable
      // passkeys pends forever. Single-account is the common case here, so pick
      // the first; a real picker UI can come later.
      session.defaultSession.on('select-webauthn-account', (_event, details, callback) => {
        callback(details.accounts[0]?.credentialId);
      });
    }

    // ORDER IS LOAD-BEARING: the tray and the updater come FIRST, and neither is
    // allowed to sit behind the window.
    //
    // In 0.1.0 `await createMainWindow()` was above these, and it did a bare
    // `await loadURL(https://moduspilot.com/login)` with no catch. Auto-launch at
    // login beats the network stack up, so the load rejected, createMainWindow
    // never returned, and createTray()/initAutoUpdate() never ran. The app was
    // left with no tray, no sync, and a white window — AND, because initAutoUpdate
    // was one of the casualties, it could never download the release that fixed
    // it. A broken window must never be able to disable the thing that repairs it.
    createTray();
    if (!testRun) initAutoUpdate();
    registerScreenAssistHotkeys();

    // The window is now the only failure-tolerant step. Its own splash+retry keeps
    // it branded while the network comes up; this catch is the backstop for
    // anything else (a throw here must not kill sync, which is the real product).
    try {
      await createMainWindow();
    } catch (err) {
      log.error('[main] createMainWindow failed — tray + sync continue without it', err);
    }
    log.info('[main] MODUS Desktop ready');

    // Reflect sign-in state in the tray, and kick a sync the moment the user
    // transitions from signed-out to signed-in (instead of waiting for the next
    // scheduler tick). getAuthState reads the token from the signed-in window.
    if (testRun) return;
    let wasSignedIn = false;
    const refreshAuth = async (): Promise<void> => {
      const { signedIn, email } = await getAuthState();
      setSignedIn(signedIn, email);
      if (signedIn && !wasSignedIn) {
        runSync().catch((err) => log.error('[sync] post-login sync failed', err));
      }
      wasSignedIn = signedIn;
    };

    // Give the web app a few seconds to load + restore its session, then start
    // polling auth and the periodic sync.
    setTimeout(() => { refreshAuth().catch((err) => log.error('[auth] refresh failed', err)); }, 4000);
    setInterval(() => { refreshAuth().catch((err) => log.error('[auth] refresh failed', err)); }, AUTH_POLL_MS);

    startScheduler(SYNC_INTERVAL_MS, () => {
      runSync().catch((err) => log.error('[sync] scheduled sync failed', err));
    });

    // Poll for native desktop notifications (FCM web-push doesn't work in
    // Electron). No-ops until signed in.
    setInterval(() => {
      pollNotifications().catch((err) => log.error('[notifications] poll failed', err));
    }, NOTIFICATION_POLL_MS);
  }).catch((err) => {
    // Without this the startup rejection was swallowed by Node and NOTHING was
    // written anywhere: the log showed "[main] starting MODUS Desktop" and then
    // silence, three launches in a row, with no error to search for. A startup
    // that can fail must say so.
    log.error('[main] STARTUP FAILED', err);
  });

  // Clicking the dock icon (app is not quit, just window hidden) reopens it.
  app.on('activate', () => {
    if (getMainWindow()) showMainWindow();
    else createMainWindow().catch((err) => log.error('[main] re-create window failed', err));
  });

  let mcpStopped = false;
  app.on('before-quit', (e) => {
    (app as unknown as { isQuitting?: boolean }).isQuitting = true;
    // Local MCP servers are child processes; none may outlive the app. The
    // SDK's close() waits on the child, so quitting is held until they are
    // down (3s at most), then resumed.
    if (!mcpStopped) {
      e.preventDefault();
      mcpStopped = true;
      void Promise.race([stopLocalMcp(), new Promise(r => setTimeout(r, 3000))]).finally(() => app.quit());
    }
    // A global shortcut is registered with the OS, not with the app. Leaving it
    // behind means the combo stays swallowed system-wide after MODUS is gone.
    globalShortcut.unregisterAll();
    // Tears down any in-flight assist request and stops watch mode. Nothing that
    // reads the screen may survive the app that owns it.
    destroyOverlay();
  });

  // Tray app: closing the window hides it (handled in windows.ts), so this is a
  // no-op guard — never quit just because no window is visible.
  app.on('window-all-closed', () => { /* keep running in the tray */ });
}
