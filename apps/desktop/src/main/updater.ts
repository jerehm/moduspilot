import { app, Notification, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import { getUpdateInstallTarget, setUpdateInstallTarget } from './settings';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // re-check every 6 hours
export const MANUAL_DOWNLOAD_URL = 'https://moduspilot.com/download/mac';

/**
 * 🪤 WHY "Restart to update" EXISTS (found 2026-11-23).
 *
 * Squirrel installs on quit, and a tray app only quits when the Mac shuts down.
 * An install that runs DURING shutdown fails its code signature check every time
 * (SQRLCodeSignatureErrorDomain -1, OSStatus -67061, "code or signature have been
 * modified") even though the bundle is valid: 10 of 10 failures in ShipIt's log
 * sat right before a reboot, and every success was a normal quit. After 3 failed
 * tries ShipIt gives up ("Too many attempts to install") on the next request too.
 * So an update that waits for quit can sit downloaded for weeks.
 *
 * The fix is to give people a quit that happens while the Mac is up.
 */
export interface UpdateState {
  /** Downloaded and waiting for a restart. */
  ready: string | null;
  /** The last restart did not install this version. Offer the manual download. */
  failed: string | null;
}

let state: UpdateState = { ready: null, failed: null };
let listener: (() => void) | null = null;
let notifiedVersion: string | null = null;

export function getUpdateState(): UpdateState {
  return state;
}

/** The tray registers here so its menu follows the update state. */
export function onUpdateStateChange(fn: () => void): void {
  listener = fn;
}

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  listener?.();
}

/** Numeric x.y.z compare. Pre-release tags are not used for this app. */
function isOlder(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

/**
 * Quit now and let Squirrel swap the app, then relaunch.
 *
 * isQuitting must be set first: windows.ts turns a window close into a hide
 * unless it is set, and quitAndInstall closes every window before it quits, so
 * without it the quit never happens. before-quit in index.ts still runs (local
 * MCP shutdown, globalShortcut.unregisterAll, destroyOverlay) because Electron
 * emits it after the windows close.
 */
export function installUpdateNow(): void {
  if (!state.ready) return;
  log.info('[update] restart to update', state.ready);
  setUpdateInstallTarget(state.ready);
  (app as unknown as { isQuitting?: boolean }).isQuitting = true;
  autoUpdater.quitAndInstall();
}

export function openManualDownload(): void {
  void shell.openExternal(MANUAL_DOWNLOAD_URL)
    .catch((err) => log.error('[update] could not open download page', err));
}

/**
 * Did the last "Restart to update" land? If we are still older than the version
 * it asked for, Squirrel failed, so the tray offers the manual download. The
 * restart button comes back too once the update is downloaded again, since a
 * second try often works (ShipIt clears its attempt counter after giving up).
 */
function checkLastInstall(): void {
  const target = getUpdateInstallTarget();
  if (!target) return;
  const current = app.getVersion();
  if (isOlder(current, target)) {
    log.error(`[update] install of ${target} did not take, still on ${current}`);
    setState({ failed: target });
  } else {
    log.info(`[update] now on ${current}, install of ${target} succeeded`);
  }
  setUpdateInstallTarget(null);
}

function notifyReady(version: string): void {
  if (notifiedVersion === version || !Notification.isSupported()) return;
  notifiedVersion = version;
  const n = new Notification({
    title: `MODUS ${version} is ready`,
    body: 'Click to restart and update. It takes a few seconds.',
  });
  n.on('click', () => installUpdateNow());
  n.show();
}

// Checks GitHub Releases (configured in electron-builder.yml `publish`) for a
// newer signed+notarized build and downloads it in the background. It installs
// on "Restart to update" (tray or notification) or, as before, on quit.
// No-ops in dev (electron-updater requires a packaged app).
export function initAutoUpdate(): void {
  if (!app.isPackaged) {
    log.info('[update] skipped, not a packaged app (dev)');
    return;
  }

  checkLastInstall();

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => log.info('[update] checking…'));
  autoUpdater.on('update-available', (info) => log.info('[update] available:', info.version));
  autoUpdater.on('update-not-available', () => log.info('[update] up to date'));
  autoUpdater.on('download-progress', (p) => log.info(`[update] downloading ${Math.round(p.percent)}%`));
  autoUpdater.on('update-downloaded', (info) => {
    log.info(`[update] downloaded ${info.version}, ready to restart`);
    setState({ ready: info.version });
    notifyReady(info.version);
  });
  autoUpdater.on('error', (err) => log.error('[update] error', err));

  const check = () => autoUpdater.checkForUpdates().catch((e) => log.error('[update] check failed', e));
  setTimeout(check, 10_000);            // shortly after launch
  setInterval(check, CHECK_INTERVAL_MS); // and periodically
}
