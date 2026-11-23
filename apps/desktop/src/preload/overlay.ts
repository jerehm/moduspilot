import { contextBridge, ipcRenderer } from 'electron';

/**
 * The overlay's ONLY bridge to the main process.
 *
 * Deliberately tiny, and deliberately not `ipcRenderer` itself. Exposing the raw
 * ipcRenderer (or `require`) would hand the renderer the ability to invoke any
 * channel in the app, including the sync agent's. The overlay needs six verbs; it
 * gets six verbs.
 *
 * This is also why the overlay loads a LOCAL html file rather than a page from
 * moduspilot.com: windows.ts gives the remote web app no preload at all, on
 * purpose. Attaching this bridge to remote content would quietly reverse that
 * decision — a compromised or hijacked page would inherit screen capture.
 */

export interface CaptureInfo {
  width: number;
  height: number;
  bytes: number;
  /** data: URL of the captured frame, so the user can SEE what is being sent. */
  preview: string;
  /** True when this came from a drag-selected area rather than the whole screen. */
  region?: boolean;
}

export interface OverlayInit {
  permission: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';
  watchEnabled: boolean;
  stealth: boolean;
  hotkey: string;
  /** The thread so far (text only) so a reopened panel can redraw it. */
  transcript: { role: 'user' | 'assistant'; text: string }[];
}

const api = {
  /** Initial state; the renderer paints nothing until this resolves. */
  init: (): Promise<OverlayInit> => ipcRenderer.invoke('assist:init'),
  ask: (question: string): void => { ipcRenderer.send('assist:ask', question); },
  stop: (): void => { ipcRenderer.send('assist:stop'); },
  close: (): void => { ipcRenderer.send('assist:close'); },
  recapture: (): void => { ipcRenderer.send('assist:recapture'); },
  /** Drag-to-select an area of the screen instead of grabbing all of it. */
  selectRegion: (): void => { ipcRenderer.send('assist:select-region'); },
  /** Start a new thread, keeping the current screenshot. */
  clear: (): void => { ipcRenderer.send('assist:clear'); },
  /** Ask main to grow the window to fit the transcript (main clamps it). */
  grow: (height: number): void => { ipcRenderer.send('assist:grow', height); },
  setWatch: (on: boolean): void => { ipcRenderer.send('assist:set-watch', on); },
  openScreenSettings: (): void => { ipcRenderer.send('assist:open-screen-settings'); },
  relaunch: (): void => { ipcRenderer.send('assist:relaunch'); },
  openApp: (): void => { ipcRenderer.send('assist:open-app'); },
  /** Plans and checkout in the main window, for errors a plan would fix. */
  openCheckout: (): void => { ipcRenderer.send('assist:open-checkout'); },

  // Main → renderer. Each returns nothing; the renderer registers once at boot.
  onCapture: (fn: (info: CaptureInfo) => void): void => {
    ipcRenderer.on('assist:capture', (_e, info: CaptureInfo) => fn(info));
  },
  /** The question exactly as it was put into the request, echoed back by main. */
  onUser: (fn: (text: string) => void): void => {
    ipcRenderer.on('assist:user', (_e, text: string) => fn(text));
  },
  /** A muted note in the transcript that is neither the user nor the model. */
  onNote: (fn: (text: string) => void): void => {
    ipcRenderer.on('assist:note', (_e, text: string) => fn(text));
  },
  onCleared: (fn: () => void): void => {
    ipcRenderer.on('assist:cleared', () => fn());
  },
  onDelta: (fn: (text: string) => void): void => {
    ipcRenderer.on('assist:delta', (_e, text: string) => fn(text));
  },
  onModel: (fn: (modelId: string) => void): void => {
    ipcRenderer.on('assist:model', (_e, id: string) => fn(id));
  },
  onDone: (fn: () => void): void => {
    ipcRenderer.on('assist:done', () => fn());
  },
  onError: (fn: (err: { kind: string; message: string }) => void): void => {
    ipcRenderer.on('assist:error', (_e, err: { kind: string; message: string }) => fn(err));
  },
  onPermission: (fn: (status: string) => void): void => {
    ipcRenderer.on('assist:permission', (_e, status: string) => fn(status));
  },
  onWatch: (fn: (on: boolean) => void): void => {
    ipcRenderer.on('assist:watch', (_e, on: boolean) => fn(on));
  },
  /** Fires every time the panel is shown, so the entrance can replay. */
  onShown: (fn: () => void): void => {
    ipcRenderer.on('assist:shown', () => fn());
  },
  onBusy: (fn: (busy: boolean) => void): void => {
    ipcRenderer.on('assist:busy', (_e, busy: boolean) => fn(busy));
  },
};

contextBridge.exposeInMainWorld('modus', api);

export type OverlayApi = typeof api;
