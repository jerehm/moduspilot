import { BrowserWindow, Notification, app, ipcMain, screen } from 'electron';
import path from 'path';
import log from 'electron-log';
import { captureActiveScreen, screenPermission, openScreenRecordingSettings, ScreenPermissionError, BlankScreenError, type Capture } from './capture';
import { ask, buildTurn, buildWatchTurn, WATCH_MODEL, DEFAULT_QUESTION, type AssistError, type AssistTurn } from './assist';
import { startWatch, stopWatch, isWatching } from './watch';
import { selectRegion, cancelRegion, isRegionOpen } from './region';
import { getScreenAssist, setScreenAssist, consumeWatchLook, watchLooksRemaining, MAX_WATCH_LOOKS_PER_DAY } from '../settings';
import { showMainWindow } from '../windows';

/**
 * The Screen Assist overlay: a small always-on-top panel that floats over
 * whatever the user is working on.
 *
 * Owns the whole interaction — capture, question, stream, watch mode — and is the
 * only thing that talks to the renderer. State lives here rather than in the
 * renderer so that a closed/reopened overlay cannot leave a request, a timer, or
 * watch mode running behind it.
 */

/** Long edge of a watch frame. See runWatchLook for why it is not MAX_EDGE. */
const WATCH_FRAME_EDGE = 800;
const MIN_WIDTH = 360;
const MIN_HEIGHT = 300;
const MARGIN = 24;

let win: BrowserWindow | null = null;
let currentCapture: Capture | null = null;
/**
 * A captured frame that has NOT been attached to a question yet.
 *
 * Distinct from currentCapture: that is "the frame we are looking at", this is
 * "the frame the model has not seen". Recapturing sets it; asking consumes it.
 */
let pendingImage: string | null = null;
/** The whole thread. Lives here, not in the renderer — hiding the panel must not erase it. */
let messages: AssistTurn[] = [];
let inflight: AbortController | null = null;
let wired = false;

function send(channel: string, payload?: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/**
 * Move the panel to the top-right of the display the user is on.
 *
 * 🪤 POSITION ONLY. This used to setBounds() with the hardcoded default width and
 * height, which meant every open silently undid the user's resize — you could drag
 * the panel bigger, dismiss it, press the hotkey, and be back to 460x520 with no
 * indication of why. Size is owned by the user and persisted in settings; this
 * function is not allowed to touch it.
 */
function position(w: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width } = display.workArea;
  const [panelWidth] = w.getSize();
  w.setPosition(Math.round(x + width - panelWidth - MARGIN), Math.round(y + MARGIN));
}

/**
 * True while WE are resizing the window, so the persistence below can tell an
 * automatic grow from a deliberate drag.
 *
 * 🪤 Without this, growing to fit one long answer was saved as the user's
 * preferred size — so the panel silently got bigger and STAYED bigger, for every
 * session afterwards, with nothing they did to explain it. A window remembers the
 * size you chose, not the size it chose for itself.
 */
let programmaticResize = false;

/** Remember the size the user chose, debounced — 'resize' fires on every pixel. */
let saveSizeTimer: NodeJS.Timeout | null = null;
function rememberSize(w: BrowserWindow): void {
  if (programmaticResize) return;
  if (saveSizeTimer) clearTimeout(saveSizeTimer);
  saveSizeTimer = setTimeout(() => {
    saveSizeTimer = null;
    if (w.isDestroyed()) return;
    const [width, height] = w.getSize();
    setScreenAssist({ width, height });
  }, 400);
}

function create(): BrowserWindow {
  const settings = getScreenAssist();

  const w = new BrowserWindow({
    // Restored from settings so a resize survives a dismiss, a relaunch and an
    // app update.
    width: settings.width,
    height: settings.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Never steals the user's place in the window order when it appears —
    // the point of this tool is that you keep working in the app underneath.
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    // Native macOS material behind the panel. This is what separates "a floating
    // web page" from something that feels like part of the system — and it is
    // genuinely native blur, which CSS cannot do here: backdrop-filter blurs page
    // content, not the desktop behind a transparent window.
    ...(process.platform === 'darwin'
      ? { vibrancy: 'under-window' as const, visualEffectState: 'active' as const, roundedCorners: true }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '../../preload/overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 'screen-saver' is above full-screen apps and native menus. Plain
  // alwaysAlwaysOnTop sits BELOW a full-screened Chrome or Keynote, which is
  // exactly when someone is most likely to want this.
  w.setAlwaysOnTop(true, 'screen-saver');
  // Follow the user onto other Spaces instead of yanking them back to this one.
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // 👁️‍🗨️ Stealth. NSWindowSharingNone: on the display, absent from any recording
  // or screen share. OFF unless the user turned it on — see settings.ts.
  w.setContentProtection(settings.stealth);

  w.on('resize', () => rememberSize(w));

  // A crashed overlay used to be reused forever (create() only checks
  // isDestroyed), so the hotkey kept showing a dead transparent panel. Destroy
  // it; the next hotkey builds a fresh one. 'closed' below does the teardown.
  w.webContents.on('render-process-gone', (_e, details) => {
    log.error(`[overlay] renderer gone (${details.reason}), destroying`);
    if (!w.isDestroyed()) w.destroy();
  });

  w.on('closed', () => {
    // Closing must tear down everything it started. A live request or a running
    // watch timer outliving its window is how a "closed" feature keeps spending
    // money and keeps capturing the screen.
    abortInflight();
    stopWatch();
    currentCapture = null;
    pendingImage = null;
    previousWatchFrame = null;
    messages = [];
    win = null;
  });

  w.loadFile(path.join(__dirname, '../../../assets/overlay.html')).catch((err) => {
    log.error('[overlay] failed to load overlay.html', err);
  });

  return w;
}

function abortInflight(): void {
  if (inflight) {
    inflight.abort();
    inflight = null;
  }
}

/**
 * Take the overlay out of the shot while we grab it.
 *
 * 🪤 THE OVERLAY CAPTURED ITSELF. Observed live 2026-08-03: the preview thumbnail
 * contained the MODUS panel, because the panel is a normal window sitting on the
 * screen when desktopCapturer runs. Two real consequences, not cosmetics:
 *
 *   1. ~13% of every frame — and of every image token the user pays for — was a
 *      picture of MODUS rather than of their work.
 *   2. On a RECAPTURE after an answer, the panel contains MODUS's own previous
 *      reply, so the model reads its own output back as if it were on the user's
 *      screen. That is a feedback loop, and it looks exactly like the model
 *      hallucinating context that "was on screen".
 *
 * Hiding is used rather than toggling setContentProtection (which also excludes
 * the window from capture) because hiding is deterministic. Content protection
 * takes effect on a compositor frame boundary, so a capture fired immediately
 * after enabling it is a race — and a race here silently reintroduces the bug on
 * whichever machine happens to lose it.
 */
async function withOverlayHidden<T>(fn: () => Promise<T>): Promise<T> {
  const w = win;
  const wasVisible = !!w && !w.isDestroyed() && w.isVisible();
  if (!wasVisible || !w) return fn();

  const hadFocus = w.isFocused();
  w.hide();
  try {
    return await fn();
  } finally {
    if (!w.isDestroyed()) {
      w.showInactive();
      // showInactive keeps the app underneath in front; only take focus back if
      // we had it, so recapturing never steals the caret out of the user's editor.
      if (hadFocus) w.focus();
    }
  }
}

/**
 * Drag-to-select a region, then treat the crop exactly like a full capture.
 *
 * The panel is hidden for the whole selection, not just the grab: leaving an
 * always-on-top window floating over the selector would let the user draw a box
 * across MODUS's own UI, and the crop would contain the panel instead of their work.
 */
async function captureRegion(): Promise<boolean> {
  const w = win;
  const wasVisible = !!w && !w.isDestroyed() && w.isVisible();
  if (wasVisible && w) w.hide();
  try {
    const shot = await selectRegion();
    if (!shot) return false; // cancelled — a normal outcome, not an error
    currentCapture = shot;
    pendingImage = shot.jpegBase64;
    send('assist:capture', {
      width: shot.width,
      height: shot.height,
      bytes: shot.bytes,
      preview: `data:image/jpeg;base64,${shot.jpegBase64}`,
      region: true,
    });
    return true;
  } catch (err) {
    if (err instanceof ScreenPermissionError) { send('assist:permission', err.status); return false; }
    log.error('[overlay] region capture failed', err);
    send('assist:error', { kind: 'server', message: 'MODUS could not capture that area. Try again.' } satisfies AssistError);
    return false;
  } finally {
    // Restore ONLY what was there before. The earlier version also re-showed a
    // panel that had been hidden whenever any old capture happened to still be in
    // memory, so cancelling the selector from the global hotkey popped open a
    // panel the user had never asked for, showing a screenshot from earlier.
    // openRegionOverlay decides whether a SUCCESSFUL selection should reveal it.
    if (wasVisible && w && !w.isDestroyed()) { w.show(); w.focus(); send('assist:shown'); }
  }
}

/** Grab a frame and hand it to the renderer, or show the permission panel. */
async function capture(): Promise<boolean> {
  try {
    currentCapture = await withOverlayHidden(() => captureActiveScreen());
    // Marks this frame as not yet shown to the model, so the NEXT question
    // attaches it. Without this flag a recapture would be silently ignored: the
    // conversation would keep answering about the first screenshot.
    pendingImage = currentCapture.jpegBase64;
    const preview = `data:image/jpeg;base64,${currentCapture.jpegBase64}`;
    send('assist:capture', {
      width: currentCapture.width,
      height: currentCapture.height,
      bytes: currentCapture.bytes,
      preview,
    });
    return true;
  } catch (err) {
    currentCapture = null;
    pendingImage = null;
    if (err instanceof ScreenPermissionError) {
      send('assist:permission', err.status);
      return false;
    }
    if (err instanceof BlankScreenError) {
      // Not a permission problem — do not send the user to System Settings to fix
      // something that is not broken.
      send('assist:error', {
        kind: 'server',
        message: 'That screen looks completely blank, so there is nothing to read. Switch to the window you want help with and press Recapture.',
      } satisfies AssistError);
      return false;
    }
    log.error('[overlay] capture failed', err);
    send('assist:error', { kind: 'server', message: 'MODUS could not capture the screen. Try again.' } satisfies AssistError);
    return false;
  }
}

/**
 * Run one question, streaming into the overlay.
 *
 * 🪤 THIS USED TO THROW THE CONVERSATION AWAY EVERY TURN. Each ask built a single
 * fresh message, so a follow-up ("ok, how do I fix it?") reached the model with no
 * screenshot, no earlier question and no earlier answer. The panel looked like it
 * had amnesia and the model looked stupid; neither was true. The transcript is now
 * kept here, in the main process, because it must outlive the window: hiding the
 * panel and pressing the hotkey again should not wipe what you were discussing.
 */
async function run(question: string): Promise<void> {
  if (!currentCapture) {
    const ok = await capture();
    // capture() already told the renderer what went wrong, but the renderer set
    // itself busy the moment the user pressed Ask. Without this the panel sat on
    // "Stop" forever with nothing running, and the only way out was to close it.
    if (!ok) { send('assist:busy', false); return; }
  }
  if (!currentCapture) { send('assist:busy', false); return; }

  // The image goes on this turn only if it has not been sent yet. A follow-up
  // about the same screen costs text, not a second full image.
  const image = pendingImage ?? undefined;
  const firstTurn = messages.length === 0;
  const turn = buildTurn(question, image, firstTurn);
  messages.push(turn);
  pendingImage = null;

  send('assist:user', question.trim() || DEFAULT_QUESTION);

  abortInflight();
  const controller = new AbortController();
  inflight = controller;
  send('assist:busy', true);

  let answer = '';
  // An error frame does NOT end the stream — the body keeps arriving and onDone
  // still fires at the end of it. Without this flag the error path dropped the
  // user turn and then onDone pushed an ASSISTANT turn on top of a thread that no
  // longer had the question it was answering, leaving the history permanently
  // malformed for every later request.
  let settled = false;
  /**
   * Undo the optimistic push when the request does not produce an answer.
   *
   * 🪤 BY IDENTITY, NOT messages.pop(). Pressing Enter twice quickly runs this
   * function twice: the second call pushes ITS turn and then aborts the first, so
   * a pop() would have deleted the second (still-running) question instead of the
   * cancelled one — corrupting the history in the one situation where a user is
   * most likely to be impatient.
   *
   * The image is handed back too, so a dropped first turn does not take the only
   * copy of the screenshot out of the conversation with it.
   */
  const dropTurn = (): void => {
    const i = messages.indexOf(turn);
    if (i !== -1) messages.splice(i, 1);
    if (image && !pendingImage) pendingImage = image;
  };

  await ask(
    { messages, screenMode: true, signal: controller.signal },
    {
      onDelta: (text) => { answer += text; send('assist:delta', text); },
      onModel: (id) => send('assist:model', id),
      onDone: () => {
        if (inflight === controller) inflight = null;
        if (settled) { send('assist:busy', false); return; }
        settled = true;
        if (answer.trim()) messages.push({ role: 'assistant', content: answer });
        else dropTurn();
        send('assist:done');
      },
      onError: (err) => {
        if (inflight === controller) inflight = null;
        if (settled) return;
        settled = true;
        dropTurn();
        send('assist:error', err);
        send('assist:busy', false);
      },
      onAborted: () => {
        if (inflight === controller) inflight = null;
        if (settled) return;
        settled = true;
        dropTurn();
        send('assist:busy', false);
      },
    },
  );
}

/**
 * One unattended look at the screen.
 *
 * 🚨 COMPLETELY SEPARATE FROM THE USER'S SESSION, and that separation is the fix
 * for four distinct bugs that all had the same root cause — watch mode used to
 * call the same capture() and run() the user's questions go through, so it:
 *
 *   1. Injected its own turns into the user's conversation, so a follow-up like
 *      "ok how do I fix it?" arrived after an unrelated watch turn about a
 *      notification, and the model answered about the wrong thing.
 *   2. Put the panel into its busy state, so the Ask button flipped to "Stop"
 *      while the user was mid-sentence typing their own question.
 *   3. Overwrote currentCapture / pendingImage — so if you had just drag-selected
 *      an area to ask about, a watch tick 20 seconds later silently replaced it
 *      with a full screenshot, and your question was answered about that instead.
 *   4. Read its own "previous frame" back out of currentCapture, which meant a
 *      user region-crop in between made the next comparison "full screen vs a
 *      crop of something else" — a comparison of two unrelated pictures.
 *
 * It also must not stream into the panel: the whole point is that MODUS speaks up
 * when you are NOT looking, so the finding goes to a native notification.
 */
async function runWatchLook(): Promise<void> {
  // The budget check comes FIRST, before the screen is even read. Capturing and
  // then discovering there is no allowance left would still have cost the grab,
  // and — more importantly — would still have read the user's screen for nothing.
  if (!consumeWatchLook()) {
    log.info(`[watch] daily look budget spent (${MAX_WATCH_LOOKS_PER_DAY}) — stopping until tomorrow`);
    setWatch(false);
    return;
  }

  let shot: Capture;
  try {
    // 🪤 SMALLER THAN A REAL SCREENSHOT, ON PURPOSE. A watch look sends TWO frames
    // (before and after) and only has to answer "did anything here matter?" — it
    // does not need to read 10px body text. At 1400px that was ~2,400 image tokens
    // per look, twice an hour, unattended.
    shot = await withOverlayHidden(() => captureActiveScreen(WATCH_FRAME_EDGE));
  } catch (err) {
    log.error('[watch] capture failed', err);
    return;
  }
  const before = previousWatchFrame ?? undefined;
  previousWatchFrame = shot.jpegBase64;

  let answer = '';
  const controller = new AbortController();
  watchInflight = controller;
  await ask(
    {
      messages: [buildWatchTurn(before, shot.jpegBase64)],
      screenMode: true,
      // Pinned to the cheap vision model — see WATCH_MODEL.
      modelChoice: WATCH_MODEL,
      signal: controller.signal,
    },
    {
      onDelta: (t) => { answer += t; },
      onModel: () => {},
      onDone: () => { if (watchInflight === controller) watchInflight = null; },
      onError: (err) => {
        if (watchInflight === controller) watchInflight = null;
        log.warn(`[watch] look failed: ${err.kind} — ${err.message}`);
      },
      onAborted: () => { if (watchInflight === controller) watchInflight = null; },
    },
  );

  const text = answer.trim();
  // The model was explicitly told to say this when there is nothing worth
  // interrupting for, so honour it rather than notifying anyway.
  if (!text || /^nothing to flag/i.test(text)) return;
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title: 'MODUS noticed something', body: text.slice(0, 240) });
  notification.on('click', () => { void openOverlay(); });
  notification.show();
  log.info('[watch] notified the user');
}

/** Start a fresh thread. The frame is kept — only the conversation is cleared. */
function resetConversation(): void {
  abortInflight();
  messages = [];
  if (currentCapture) pendingImage = currentCapture.jpegBase64;
  send('assist:cleared');
}

/**
 * IPC is registered ONCE for the app's lifetime, not per window.
 *
 * ipcMain.on accumulates listeners — registering inside create() would add a new
 * set every time the overlay is reopened, so the third open would run every
 * handler three times and fire three requests per question.
 */
function wireIpc(): void {
  if (wired) return;
  wired = true;

  ipcMain.handle('assist:init', () => {
    const s = getScreenAssist();
    return {
      permission: screenPermission(),
      watchEnabled: isWatching(),
      stealth: s.stealth,
      hotkey: s.hotkey,
      // The thread so far, so a reopened panel redraws what you were discussing
      // instead of looking like it forgot. Only the visible text is sent — the
      // base64 images stay in the main process, because piping a megabyte of
      // screenshots over IPC to redraw a transcript is not worth it.
      transcript: messages.map((m) => ({
        role: m.role,
        text: m.role === 'assistant'
          ? m.content
          : (m.content.find((c) => c.type === 'text') as { text: string } | undefined)?.text ?? '',
      })),
    };
  });

  ipcMain.on('assist:ask', (_e, question: unknown) => {
    void run(typeof question === 'string' ? question : '');
  });

  ipcMain.on('assist:stop', () => {
    abortInflight();
    send('assist:busy', false);
  });

  ipcMain.on('assist:close', () => hideOverlay());

  ipcMain.on('assist:recapture', () => { void capture(); });

  ipcMain.on('assist:select-region', () => { void captureRegion(); });

  ipcMain.on('assist:clear', () => resetConversation());

  // The renderer knows how tall its content is; only the main process can resize
  // the window. Clamped to the display's work area so "grow to fit" can never put
  // the panel taller than the screen it lives on.
  ipcMain.on('assist:grow', (_e, wanted: unknown) => {
    if (typeof wanted !== 'number' || !Number.isFinite(wanted)) return;
    const w = win;
    if (!w || w.isDestroyed()) return;
    // The PANEL's display, not the cursor's. With an external monitor the cursor
    // is routinely on a different screen from the panel, and clamping the panel's
    // height to whichever display the mouse happened to be over would either
    // stunt it or push it off the bottom of the one it is actually on.
    const display = screen.getDisplayMatching(w.getBounds());
    const maxHeight = display.workArea.height - MARGIN * 2;
    const [width, height] = w.getSize();
    const next = Math.max(MIN_HEIGHT, Math.min(Math.round(wanted), maxHeight));
    if (next <= height) return; // only ever grow on the renderer's request

    // 🪤 DO NOT REPOSITION. This used to call position() afterwards, which snapped
    // the panel back to the top-right corner — so if you had dragged it somewhere
    // that suited you, it jumped away the moment an answer got long. Growing
    // downward from where it already is keeps it where the user put it; the only
    // thing that needs care is not growing off the bottom of the screen.
    programmaticResize = true;
    const bounds = w.getBounds();
    const bottomLimit = display.workArea.y + display.workArea.height - MARGIN;
    const y = Math.max(display.workArea.y + MARGIN, Math.min(bounds.y, bottomLimit - next));
    w.setBounds({ x: bounds.x, y, width, height: next }, false);
    // Cleared on the next tick: the resize event lands after this call returns.
    setTimeout(() => { programmaticResize = false; }, 0);
  });

  ipcMain.on('assist:set-watch', (_e, on: unknown) => setWatch(on === true));

  ipcMain.on('assist:open-screen-settings', () => openScreenRecordingSettings());

  ipcMain.on('assist:relaunch', () => {
    // macOS only applies a new Screen Recording grant to a fresh launch, so
    // "relaunch" is a real fix step here rather than a shrug.
    app.relaunch();
    // quit, not exit: exit(0) skipped before-quit, so local MCP server
    // processes were never stopped and the hotkeys stayed registered.
    app.quit();
  });

  ipcMain.on('assist:open-app', () => showMainWindow());
}

/**
 * Watch mode is SESSION-ONLY and is deliberately not written to settings.
 *
 * It used to be persisted, and never read back at launch — so the file recorded a
 * preference the app then ignored. The fix is not to start honouring it: an app
 * that silently resumed capturing the screen on every launch, because of a toggle
 * flipped once last week, is not something to ship. Turning it on is an act, every
 * time.
 */
/**
 * The frame from the previous watch look, held so the next one can be compared
 * against it. This is what "watching" actually means here: MODUS is not streaming
 * video (nothing affordable can), it holds the last picture and shows the model
 * both. Cleared whenever watch stops so a session never compares against a frame
 * from an hour ago.
 */
let previousWatchFrame: string | null = null;
/** Watch's own in-flight request, so cancelling it never touches the user's. */
let watchInflight: AbortController | null = null;

function setWatch(on: boolean): void {
  if (!on) {
    previousWatchFrame = null;
    if (watchInflight) { watchInflight.abort(); watchInflight = null; }
    stopWatch();
    send('assist:watch', false);
    return;
  }
  previousWatchFrame = null;
  const left = watchLooksRemaining();
  if (left <= 0) {
    log.info('[watch] refusing to start — daily look budget already spent');
    send('assist:error', {
      kind: 'limit',
      message: `Watch has used its ${MAX_WATCH_LOOKS_PER_DAY} looks for today. It resets tomorrow.`,
    } satisfies AssistError);
    send('assist:watch', false);
    return;
  }
  log.info(`[watch] starting with ${left} of ${MAX_WATCH_LOOKS_PER_DAY} looks left today`);
  const { watchIntervalMs } = getScreenAssist();
  startWatch(watchIntervalMs, () => runWatchLook());
  send('assist:watch', true);
}

/**
 * Show the overlay and capture. Called by the hotkey and the tray.
 *
 * Pressing the hotkey while it is already open RE-CAPTURES rather than opening a
 * second window or doing nothing — that is what the gesture means when you have
 * moved to a different screen.
 */
export async function openOverlay(): Promise<void> {
  wireIpc();

  if (win && !win.isDestroyed()) {
    // Capture first: when the panel is hidden there is nothing to hide-and-restore,
    // so the common "hotkey again after dismissing" path costs no flicker at all.
    await capture();
    if (win.isDestroyed()) return;
    position(win);
    win.show();
    win.focus();
    // Replays the entrance animation. The window is REUSED rather than reloaded,
    // so without an explicit signal the CSS animation only ever runs once — the
    // first open would feel smooth and every one after it would just snap in.
    send('assist:shown');
    return;
  }

  win = create();
  const w = win;
  position(w);

  // Wait for the renderer before capturing: a frame sent to a page that has not
  // registered its listeners yet is dropped silently, leaving an empty panel.
  //
  // 🪤 A bare `once('did-finish-load')` here would be the SAME bug windows.ts
  // documents at length — a load that fails leaves the promise pending forever,
  // and the hotkey silently does nothing with no error anywhere. Every wait needs
  // both failure paths AND a ceiling.
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (why: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (why !== 'loaded') log.error(`[overlay] renderer not ready (${why}) — showing anyway`);
      resolve();
    };
    const timeout = setTimeout(() => finish('timeout'), 5000);
    w.webContents.once('did-finish-load', () => finish('loaded'));
    w.webContents.once('did-fail-load', (_e, code, desc) => finish(`${code} ${desc}`));
  });

  if (w.isDestroyed()) return;
  // Capture while the panel has never been shown, so the very first frame cannot
  // contain MODUS's own window and the user sees no flicker on the common path.
  await capture();
  if (w.isDestroyed()) return;
  w.show();
  w.focus();
  send('assist:shown');
}

/**
 * Region select from a global hotkey or the tray: pick an area, then show the
 * panel already holding the crop.
 */
export async function openRegionOverlay(): Promise<void> {
  wireIpc();
  if (!win || win.isDestroyed()) {
    win = create();
    const w = win;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => { if (settled) return; settled = true; clearTimeout(t); resolve(); };
      const t = setTimeout(finish, 5000);
      w.webContents.once('did-finish-load', finish);
      w.webContents.once('did-fail-load', finish);
    });
    if (w.isDestroyed()) return;
    position(w);
  }
  const ok = await captureRegion();
  if (!win || win.isDestroyed()) return;
  // Success reveals the panel with the crop in it. A cancel shows nothing at all —
  // pressing the shortcut and changing your mind should leave the screen exactly
  // as it was, not open a window.
  // Success reveals the panel with the crop in it. A cancel does nothing at all —
  // captureRegion already restored whatever visibility there was, so pressing the
  // shortcut and changing your mind leaves the screen exactly as it was.
  if (ok) {
    position(win);
    win.show();
    win.focus();
    send('assist:shown');
  }
}

export function hideOverlay(): void {
  abortInflight();
  // Watch mode is explicitly NOT stopped here: hiding the panel while MODUS keeps
  // watching is the whole point of the mode. It stops on toggle, on close, and on
  // quit — all of which are deliberate acts.
  if (win && !win.isDestroyed()) win.hide();
}

export function isOverlayOpen(): boolean {
  return !!win && !win.isDestroyed() && win.isVisible();
}

/**
 * What the hotkey does.
 *
 * 🪤 THIS USED TO HIDE A PANEL YOU COULD SEE BUT WEREN'T FOCUSED ON. The old test
 * was `isVisible() ? hide() : open()`, and the overwhelmingly common situation is
 * exactly the one it got wrong: the panel is open on screen while you are typing in
 * Chrome. Pressing the hotkey there means "bring it to me and look at what I'm
 * doing now" — the old code read it as "dismiss" and the panel vanished, so the
 * gesture appeared to toggle at random depending on where focus happened to be.
 *
 * Visible AND focused is the only state where the hotkey means dismiss.
 */
export function toggleOverlay(): void {
  // The selector covers the whole screen and is modal by nature. Opening the
  // panel over it would leave two competing always-on-top windows and no obvious
  // way back; treating the hotkey as "get me out of this" is the only reading
  // that makes sense.
  if (isRegionOpen()) { cancelRegion(); return; }
  const visible = isOverlayOpen();
  if (visible && win && !win.isDestroyed() && win.isFocused()) {
    hideOverlay();
    return;
  }
  void openOverlay();
}

/** Tray toggle for stealth — applies to the live window immediately. */
export function setStealth(on: boolean): void {
  setScreenAssist({ stealth: on });
  if (win && !win.isDestroyed()) win.setContentProtection(on);
  log.info(`[overlay] content protection ${on ? 'ON (hidden from capture)' : 'OFF (visible)'}`);
}

/** Called on quit — nothing may outlive the app. */
export function destroyOverlay(): void {
  abortInflight();
  stopWatch();
  // The selector is a separate, FULL-SCREEN window. Leaving it behind on quit
  // would hand the user a black sheet over their entire display owned by a
  // process that no longer exists.
  cancelRegion();
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}
