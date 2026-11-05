import { Tray, Menu, app, shell, type MenuItem } from 'electron';
import crypto from 'crypto';
import path from 'path';
import log from 'electron-log';
import { showMainWindow } from './windows';
import { openOverlay, openRegionOverlay, setStealth } from './screen/overlay';
import { screenPermission, openScreenRecordingSettings } from './screen/capture';
import { getScreenAssist, getOpenAppOnTrayClick, setOpenAppOnTrayClick, getDeviceId } from './settings';
import { ingest, type IngestResult } from './sync/ingest';
import type { IngestPayload, SourceRead } from '../shared/types';
import { readAppleNotes, isFullDiskAccessGranted as notesFdaGranted } from './sync/appleNotesSync';
import { readRecentMessages, isFullDiskAccessGranted as messagesFdaGranted } from './sync/appleMessagesSync';
import { readAppleReminders, isFullDiskAccessGranted as remindersFdaGranted } from './sync/appleReminders';

let tray: Tray | null = null;
let syncing = false;
let lastSyncAt: Date | null = null;
let lastNotesCount = 0;
let lastMessagesCount = 0;
let lastReconcile: IngestResult['reconcile'] | null = null;
let signedIn = false;
let signedInEmail: string | null = null;
/** The accelerator that actually registered, or null when the combo was taken. */
let hotkey: string | null = null;
let regionHotkey: string | null = null;

/**
 * Told by index.ts what really happened when the hotkey was registered.
 *
 * The menu must not print a shortcut that does nothing. globalShortcut.register
 * returns false on a clash rather than throwing, so without this the tray would
 * confidently advertise a key combination the OS has given to somebody else.
 */
export function setHotkeyRegistered(accelerator: string | null): void {
  hotkey = accelerator;
  rebuildMenu();
}

export function setRegionHotkeyRegistered(accelerator: string | null): void {
  regionHotkey = accelerator;
  rebuildMenu();
}

export function createTray(): void {
  const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
  tray = new Tray(iconPath);
  tray.setToolTip('MODUS');
  // 🪤 This used to be an unconditional `showMainWindow()`. A tray icon with a
  // context menu ALREADY responds to a click by opening its menu, so firing this
  // as well threw the full 1200x820 MODUS window in front of whatever you were
  // working on every single time you reached for the menu — including when you
  // reached for it to ask about the screen you were just covering up.
  // Opt-in, off by default.
  tray.on('click', () => { if (getOpenAppOnTrayClick()) showMainWindow(); });
  rebuildMenu();
}

// Called by the auth poller in index.ts so the tray reflects sign-in state.
export function setSignedIn(state: boolean, email: string | null): void {
  signedIn = state;
  signedInEmail = email;
  rebuildMenu();
}

// Reminders was missing here, so a Mac with Notes+Messages granted but
// Reminders denied showed a healthy "Sync now" while reminders silently never
// synced at all.
const fullDiskAccess = (): boolean =>
  notesFdaGranted() && messagesFdaGranted() && remindersFdaGranted();

/**
 * Run one source's reader without letting it take the others down with it.
 *
 * 🪤 These used to be three sequential statements in one try, so a transient
 * FullDiskAccessError from the notes snapshot (a ~100MB+ file, copied every 5
 * minutes) silently disabled messages AND reminders for as long as it kept
 * failing.
 *
 * Every failure path returns complete:false, which the server treats as "write
 * what arrived, delete nothing" — staleness instead of data loss.
 */
function readSource<R extends SourceRead<{ id: string }>>(
  name: string,
  granted: boolean,
  read: () => R,
  empty: R,
): R {
  if (!granted) return empty;
  try {
    const r = read();
    const ids = new Set(r.allIds);
    if (!r.records.every((x) => ids.has(x.id))) {
      // Our own two queries disagree. Never hand the server a delete mandate
      // we cannot back with an id list containing what we just sent.
      log.error(`[sync] ${name}: records not a subset of allIds, forcing incomplete`);
      return { ...r, complete: false };
    }
    return r;
  } catch (err) {
    log.error(`[sync] ${name} read failed, other sources continue`, err);
    return empty;
  }
}

/**
 * Skip the POST when nothing changed.
 *
 * Never persisted to disk — an app restart should always force one full sync —
 * and overridden hourly so any server-side drift (a failed chunk, a manual
 * Firestore edit) self-heals instead of becoming permanent and invisible.
 */
let lastPayloadHash: string | null = null;
let syncTicks = 0;
const FORCE_FULL_EVERY = 12; // 12 x 5min

// Reads local Apple Notes + iMessage + Reminders and uploads them via the web
// ingest endpoint (authenticated with the signed-in window's token). Safe to
// call on a schedule — no-ops cleanly when not signed in or FDA is off.
export async function runSync(): Promise<void> {
  if (syncing) return;
  syncing = true;
  rebuildMenu();
  try {
    const emptyRead = { records: [], allIds: [], complete: false };
    const notes = readSource('notes', notesFdaGranted(), readAppleNotes, emptyRead);
    const messages = readSource('messages', messagesFdaGranted(), readRecentMessages, emptyRead);
    const reminders = readSource('reminders', remindersFdaGranted(), readAppleReminders, {
      ...emptyRead,
      completedIds: [],
    });

    const nothing =
      notes.records.length === 0 && messages.records.length === 0 && reminders.records.length === 0 &&
      notes.allIds.length === 0 && messages.allIds.length === 0 && reminders.allIds.length === 0;
    if (nothing) {
      log.info('[sync] nothing to sync (Full Disk Access off or no local data)');
      return;
    }

    const payload: IngestPayload = {
      notes: notes.records,
      messages: messages.records,
      reminders: reminders.records,
      sync: {
        v: 2,
        deviceId: getDeviceId(),
        notes: { allIds: notes.allIds, complete: notes.complete },
        messages: { allIds: messages.allIds, complete: messages.complete },
        reminders: {
          allIds: reminders.allIds,
          complete: reminders.complete,
          completedIds: reminders.completedIds,
        },
      },
    };

    const hash = crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
    const forced = syncTicks++ % FORCE_FULL_EVERY === 0;
    if (!forced && hash === lastPayloadHash) {
      log.info('[sync] nothing changed since last sync, skipping upload');
      lastSyncAt = new Date();
      return;
    }

    const result = await ingest(payload);
    if (result) {
      // Only remember the hash once the server confirmed the write. A failed
      // or partial write must force a full retry on the next tick.
      lastPayloadHash = hash;
      lastSyncAt = new Date();
      lastNotesCount = result.notesWritten;
      lastMessagesCount = result.messagesWritten;
      lastReconcile = result.reconcile ?? null;
      signedIn = true;
      log.info(
        `[sync] wrote ${result.notesWritten} note(s), ${result.messagesWritten} conversation(s), ` +
        `${result.remindersWritten ?? 0} reminder(s); skipped unchanged ` +
        `${result.notesSkipped ?? 0}/${result.messagesSkipped ?? 0}/${result.remindersSkipped ?? 0}`
      );
      log.info(`[sync] reconcile: ${JSON.stringify(result.reconcile ?? 'server predates reconciliation')}`);
    } else {
      lastPayloadHash = null;
      log.info('[sync] skipped — open MODUS and sign in first');
    }
  } catch (err) {
    lastPayloadHash = null;
    log.error('[sync] failed', err);
  } finally {
    syncing = false;
    rebuildMenu();
  }
}

/** A guard you cannot see fire is indistinguishable from a bug. */
function reconcileLine(): string | null {
  if (!lastReconcile) return null;
  const held = (Object.keys(lastReconcile) as (keyof typeof lastReconcile)[])
    .filter((k) => 'skipped' in lastReconcile![k] && (lastReconcile![k] as { skipped: string }).skipped !== 'incomplete');
  if (held.length === 0) return null;
  return `Deletions held: ${held.map((k) => `${k} (${(lastReconcile![k] as { skipped: string }).skipped})`).join(', ')}`;
}

function rebuildMenu(): void {
  if (!tray) return;
  const fda = fullDiskAccess();
  const assist = getScreenAssist();
  const screenPerm = screenPermission();

  let syncLabel: string;
  let syncClick: (() => void) | (() => Promise<void>);
  if (syncing) {
    syncLabel = 'Syncing…';
    syncClick = () => {};
  } else if (!fda) {
    syncLabel = 'Grant Full Disk Access…';
    syncClick = handleGrantFullDiskAccess;
  } else {
    syncLabel = 'Sync now';
    syncClick = () => { runSync(); };
  }

  const held = reconcileLine();
  const lastLine = lastSyncAt
    ? (held ?? `Last synced ${lastSyncAt.toLocaleTimeString()} (${lastNotesCount} notes, ${lastMessagesCount} chats)`)
    : 'Not synced yet';

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: signedInEmail
          ? `Signed in as ${signedInEmail}`
          : (signedIn ? 'Signed in' : 'Open MODUS to sign in'),
        enabled: false,
      },
      { type: 'separator' },
      { label: 'Open MODUS', click: () => showMainWindow() },
      { type: 'separator' },
      {
        // The shortcut is shown as a real accelerator only when it registered.
        // `accelerator` here is DISPLAY ONLY — the working binding is the
        // globalShortcut in index.ts, which fires whether or not MODUS is focused.
        label: 'Ask about my screen',
        ...(hotkey ? { accelerator: hotkey } : {}),
        click: () => { void openOverlay(); },
      },
      ...(hotkey ? [] : [{
        label: 'Shortcut unavailable (in use by another app)',
        enabled: false,
      } as Electron.MenuItemConstructorOptions]),
      {
        label: 'Select an area…',
        ...(regionHotkey ? { accelerator: regionHotkey } : {}),
        click: () => { void openRegionOverlay(); },
      },
      {
        label: 'Screen Assist',
        submenu: [
          ...(screenPerm === 'granted' ? [] : [
            {
              label: 'Grant Screen Recording…',
              click: () => openScreenRecordingSettings(),
            } as Electron.MenuItemConstructorOptions,
            {
              label: 'Relaunch required after granting',
              enabled: false,
            } as Electron.MenuItemConstructorOptions,
            { type: 'separator' } as Electron.MenuItemConstructorOptions,
          ]),
          {
            label: 'Hide from screen sharing',
            type: 'checkbox',
            checked: assist.stealth,
            click: (menuItem: MenuItem) => {
              setStealth(menuItem.checked);
              rebuildMenu();
            },
          },
          {
            label: assist.stealth
              ? 'The panel is invisible to Zoom and recordings'
              : 'The panel appears in Zoom and recordings',
            enabled: false,
          },
        ],
      },
      { type: 'separator' },
      { label: syncLabel, enabled: !syncing, click: syncClick },
      { label: lastLine, enabled: false },
      { type: 'separator' },
      {
        label: 'Open MODUS when I click this icon',
        type: 'checkbox',
        checked: getOpenAppOnTrayClick(),
        click: (menuItem: MenuItem) => {
          setOpenAppOnTrayClick(menuItem.checked);
          rebuildMenu();
        },
      },
      {
        label: 'Launch at login',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (menuItem: MenuItem) => {
          app.setLoginItemSettings({ openAtLogin: menuItem.checked });
          log.info('[startup] launch at login set to', menuItem.checked);
        },
      },
      { type: 'separator' },
      {
        label: 'Quit MODUS',
        click: () => {
          (app as unknown as { isQuitting?: boolean }).isQuitting = true;
          app.quit();
        },
      },
    ])
  );
}

// No programmatic request API exists for Full Disk Access (unlike Contacts/
// Camera) — deep-link to the right System Settings pane and let the user grant
// it, then retry sync. Notes and Messages share the same OS-level grant.
async function handleGrantFullDiskAccess(): Promise<void> {
  await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles')
    .catch((err) => log.error('[sync] could not open Full Disk Access settings', err));
  log.info('[sync] opened Full Disk Access settings pane');
}
