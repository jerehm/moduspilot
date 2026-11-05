import { app } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import log from 'electron-log';

export interface ScreenAssistSettings {
  /**
   * Hide the overlay from screen recordings and shares (NSWindowSharingNone via
   * setContentProtection). DEFAULT OFF, deliberately: an assistant that is
   * invisible to the person you are screen-sharing with is the feature that got
   * this category branded as cheating software. It exists for people who want it;
   * it is not what MODUS leads with.
   */
  stealth: boolean;
  /**
   * How often watch mode looks, when it is on.
   *
   * ⚠️ There is deliberately NO `watchEnabled` here. It used to be persisted and
   * was never read back on launch — a setting that records a preference and then
   * ignores it is worse than no setting, because it reads as a bug the first time
   * someone notices. And the honest default is off anyway: an app that silently
   * resumed capturing the screen every time it launched, because of a toggle
   * flipped once days ago, is not something to ship. Watch mode is per-session and
   * must be turned on deliberately.
   */
  watchIntervalMs: number;
  /** Accelerator string. User-editable so a clash with another app is fixable. */
  hotkey: string;
  /**
   * Drag-to-select an area.
   *
   * 🪤 NOT Cmd-Shift-A, which was the first choice and was wrong: a global
   * shortcut is taken from EVERY app system-wide, and Cmd-Shift-A is Finder's
   * "Applications folder" (plus Select All / Format menus elsewhere). Stealing a
   * shortcut people already use, in every app they use it in, to add a feature
   * they did not ask for, is not a trade worth making by default.
   *
   * Cmd-Shift-2 sits in the same numeric family as macOS's own screenshot
   * shortcuts (3/4/5), which is the right mental neighbourhood, and is unclaimed
   * system-wide.
   */
  regionHotkey: string;
  /**
   * The panel's last size. Persisted so resizing it sticks — the window used to be
   * force-fitted back to 460x520 on every single open, which silently threw away
   * the resize the user had just made.
   */
  width: number;
  height: number;
  /**
   * Watch-mode looks already spent today, and the day they belong to.
   *
   * 🚨 PERSISTED, AND THAT IS THE ENTIRE POINT. The spend brake used to live only
   * in memory (watch.ts TriggerCeiling), so every app restart handed the user a
   * fresh hourly allowance. During one evening of development the app was
   * restarted eight times and the "12 per hour" cap was silently reset eight
   * times with it. A budget that forgets itself on relaunch is not a budget.
   */
  watchLooksDate: string;
  watchLooksToday: number;
}

export const DEFAULT_SCREEN_ASSIST: ScreenAssistSettings = {
  stealth: false,
  watchIntervalMs: 5000,
  hotkey: 'CommandOrControl+Shift+Space',
  regionHotkey: 'CommandOrControl+Shift+2',
  width: 460,
  height: 560,
  watchLooksDate: '',
  watchLooksToday: 0,
};

/**
 * Hard daily cap on unattended watch looks.
 *
 * ⚠️ DERIVED FROM THE PLAN CEILING, not from taste. The previous number (12/hour)
 * was chosen by reasoning about how often an assistant should interrupt someone,
 * and never once costed against the budget it spends from. Measured on a real
 * account: a watch look on Claude Sonnet 5 with the full life-OS context is
 * ~126,000 budget units, and the MODUS daily ceiling is 500,000 — so FOUR looks
 * consumed an entire day, and a 12/hour cap emptied it in twenty minutes.
 *
 * Watch now runs on a fixed cheap vision model (1x weight instead of 9x) with
 * smaller frames, which puts a look near ~1,300 units. 30 looks is then ~7.8% of a
 * MODUS day — a background feature's fair share, rather than all of it.
 *
 * 🪤💸 THESE NUMBERS ARE ONLY TRUE WHILE WATCH_MODEL IS WEIGHT 1. They were briefly
 * false: watch was pinned to `gemini-3.5-flash`, which the flash/flash-lite reprice
 * moved from weight 1 to weight 5, and a look really cost 6,540 units (39.2% of a
 * day) while this comment still claimed ~1,500 and ~9%. A cost written in a comment
 * is not a guard. `scripts/verify-watch-budget.ts` in apps/web is the guard —
 * re-run it whenever WATCH_MODEL, this cap, the frame size or any price changes.
 */
export const MAX_WATCH_LOOKS_PER_DAY = 30;

function today(): string { return new Date().toISOString().slice(0, 10); }

/** Looks left today. Rolls over on date change without needing a scheduler. */
export function watchLooksRemaining(): number {
  const s = getScreenAssist();
  if (s.watchLooksDate !== today()) return MAX_WATCH_LOOKS_PER_DAY;
  return Math.max(0, MAX_WATCH_LOOKS_PER_DAY - s.watchLooksToday);
}

/** Records one look. Returns false when the daily budget is already gone. */
export function consumeWatchLook(): boolean {
  const s = getScreenAssist();
  const day = today();
  const used = s.watchLooksDate === day ? s.watchLooksToday : 0;
  if (used >= MAX_WATCH_LOOKS_PER_DAY) return false;
  setScreenAssist({ watchLooksDate: day, watchLooksToday: used + 1 });
  return true;
}

interface DesktopSettings {
  loginItemInitialized?: boolean;
  screenAssist?: Partial<ScreenAssistSettings>;
  /**
   * Should clicking the menu-bar icon also open the main MODUS window?
   *
   * OFF by default, and the default is the point. The tray icon has a context
   * menu, so a click already does something — it opens the menu. Firing
   * showMainWindow() on the same click meant a full 1200x820 window jumped in
   * front of whatever you were doing every time you reached for "Sync now" or
   * "Ask about my screen". For a menu-bar app that is a surprise, not a shortcut:
   * the icon is there so you DON'T have to open the app.
   */
  openAppOnTrayClick?: boolean;
  /**
   * Stable id for THIS Mac, generated once on first sync.
   *
   * Sync deletes docs that no longer exist locally, and "locally" is per
   * machine. Two Macs signed into one MODUS account with different iCloud
   * accounts each see the other's notes missing from their own id list — so
   * without this stamp, A deletes B's notes, then B deletes A's, every five
   * minutes, forever. Two Macs sharing one iCloud account produce identical id
   * sets and no conflict at all, which is exactly why this would never show up
   * in testing.
   */
  deviceId?: string;
  /** The one folder the model may work in (absolute, realpath). Picked natively. */
  localFolder?: string | null;
  /** Local (stdio) MCP servers the user added, each confirmed in a native dialog. */
  localMcpServers?: LocalMcpServerConfig[];
  /** serverId -> tool names the user chose "Always allow" for. */
  localMcpAllowed?: Record<string, string[]>;
}

export interface LocalMcpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'modus-settings.json');
}

function read(): DesktopSettings {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as DesktopSettings;
  } catch {
    return {};
  }
}

function write(s: DesktopSettings): void {
  try {
    // Temp file + rename is atomic. A crash or power loss mid write left a
    // truncated file that read() turned into {}: deviceId, local servers and
    // their Always allow choices gone, and launch at login switched back on.
    const file = settingsFile();
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s));
    fs.renameSync(tmp, file);
  } catch (err) {
    log.error('[settings] failed to persist', err);
  }
}

// A background sync agent is only useful if it's actually running, so default
// to launching at login on the very first run. Only sets it once (tracked via
// a marker file) so it respects the user toggling it off later in the tray.
/**
 * Screen Assist settings, with every default filled in.
 *
 * Spread over the defaults rather than returned raw: the settings file is written
 * by older versions of the app and read by newer ones, so a key added later is
 * simply absent on disk. Returning it as undefined would make `stealth` falsy by
 * accident rather than by decision — fine here, wrong the moment a default is
 * `true`.
 */
export function getScreenAssist(): ScreenAssistSettings {
  return { ...DEFAULT_SCREEN_ASSIST, ...(read().screenAssist ?? {}) };
}

/** Defaults to false — see the note on DesktopSettings.openAppOnTrayClick. */
export function getOpenAppOnTrayClick(): boolean {
  return read().openAppOnTrayClick === true;
}

export function setOpenAppOnTrayClick(on: boolean): void {
  const s = read();
  write({ ...s, openAppOnTrayClick: on });
  log.info(`[settings] open MODUS on tray click: ${on}`);
}

/**
 * Persist ONLY the keys that were explicitly set — never the defaults.
 *
 * 🪤 THIS USED TO WRITE THE WHOLE MERGED OBJECT, which froze every default at the
 * moment of the first write. Resize the panel once and the file gained a complete
 * copy of every default alongside it; from then on, changing a default in code
 * could never reach that user again, because their file already had an answer.
 *
 * Caught for real: the region shortcut default was changed from Cmd-Shift-A (which
 * steals Finder's Applications shortcut system-wide) to Cmd-Shift-2, and the app
 * kept registering Cmd-Shift-A — because a window resize days earlier had written
 * the old value to disk as though the user had chosen it. That is the same trap
 * LEGACY_MODEL_IDS exists for in apps/web: stored values outlive the code that
 * produced them, so store only what was actually decided.
 */
export function setScreenAssist(patch: Partial<ScreenAssistSettings>): ScreenAssistSettings {
  const s = read();
  const stored: Partial<ScreenAssistSettings> = { ...(s.screenAssist ?? {}), ...patch };
  write({ ...s, screenAssist: stored });
  return { ...DEFAULT_SCREEN_ASSIST, ...stored };
}

/** Lazily generated and persisted. Only ever compared for equality. */
export function getDeviceId(): string {
  const s = read();
  if (s.deviceId) return s.deviceId;
  const id = crypto.randomUUID();
  write({ ...s, deviceId: id });
  log.info(`[settings] generated device id ${id}`);
  return id;
}

export function initLaunchAtLogin(): void {
  const s = read();
  if (s.loginItemInitialized) return;
  app.setLoginItemSettings({ openAtLogin: true });
  write({ ...s, loginItemInitialized: true });
  log.info('[settings] enabled launch-at-login by default (first run)');
}

export function getLocalFolder(): string | null {
  return read().localFolder ?? null;
}

export function setLocalFolder(folder: string | null): void {
  const s = read();
  write({ ...s, localFolder: folder });
}

export function getLocalMcpServers(): LocalMcpServerConfig[] {
  return read().localMcpServers ?? [];
}

export function setLocalMcpServers(list: LocalMcpServerConfig[]): void {
  const s = read();
  write({ ...s, localMcpServers: list });
}

export function getLocalMcpAllowed(): Record<string, string[]> {
  return read().localMcpAllowed ?? {};
}

export function setLocalMcpAllowed(map: Record<string, string[]>): void {
  const s = read();
  write({ ...s, localMcpAllowed: map });
}
