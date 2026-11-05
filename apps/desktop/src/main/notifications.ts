import { Notification } from 'electron';
import log from 'electron-log';
import { getMainWindow, showMainWindow } from './windows';
import { getIdToken } from './sync/ingest';

const NOTIFICATIONS_URL = 'https://moduspilot.com/api/desktop/notifications';
const WEB_ORIGIN = 'https://moduspilot.com';
// Only surface notifications created in the last 30 min — older unseen ones
// (e.g. a backlog from while the app was closed) are silently acked rather than
// flooding the user on launch.
const FRESH_MS = 30 * 60 * 1000;

interface RemoteNotification {
  id: string;
  title: string;
  body: string;
  data?: { link?: string };
  createdAt: number | null;
}

// Guards against showing the same notification twice within a session if an ack
// request fails (the server seen-flag is the cross-session guard).
const shown = new Set<string>();

export async function pollNotifications(): Promise<void> {
  const token = await getIdToken();
  if (!token) return;

  let items: RemoteNotification[];
  try {
    const res = await fetch(NOTIFICATIONS_URL, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return;
    items = ((await res.json()) as { notifications: RemoteNotification[] }).notifications ?? [];
  } catch (err) {
    log.error('[notifications] poll failed', err);
    return;
  }
  if (items.length === 0) return;

  const now = Date.now();
  const ackIds: string[] = [];
  for (const n of items) {
    ackIds.push(n.id);
    if (shown.has(n.id)) continue;
    // Silently clear stale backlog; only actually display fresh notifications.
    if (n.createdAt && now - n.createdAt > FRESH_MS) continue;
    shown.add(n.id);
    showNative(n);
  }

  try {
    await fetch(NOTIFICATIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ids: ackIds }),
    });
  } catch {
    /* non-fatal — the in-session `shown` set still prevents a re-show */
  }
}

function showNative(n: RemoteNotification): void {
  if (!Notification.isSupported()) return;
  const notif = new Notification({ title: n.title || 'MODUS', body: n.body || '' });
  notif.on('click', () => {
    showMainWindow();
    const link = n.data?.link;
    if (link && link.startsWith('/')) {
      getMainWindow()?.webContents.loadURL(WEB_ORIGIN + link).catch((err) =>
        log.error('[notifications] failed to open link', link, err),
      );
    }
  });
  notif.show();
  log.info('[notifications] shown:', n.title);
}
