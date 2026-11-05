import { auth } from './firebase';
import {
  cacheDirectory,
  writeAsStringAsync,
  EncodingType,
} from 'expo-file-system/legacy';

// expo-location is a NATIVE module. Require it lazily inside a try/catch so a
// JS reload before a native rebuild degrades to IP geolocation instead of
// crashing the whole app with "Cannot find native module 'ExpoLocation'".
function loadLocation(): typeof import('expo-location') | null {
  try { return require('expo-location'); } catch { return null; }
}

export const API_BASE = 'https://app.moduspilot.com';

export async function getAuthHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) return {};
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

import { fromInvocation, type ToolCallRecord } from './tool-activity';

export type Message = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

// Scoped-chat context — mirrors the web goal/project detail chat body, so the
// server builds a goal/project-aware system prompt.
export type GoalContext = { id: string; title: string; description?: string; progress?: number };
export type ProjectContext = { id: string; title: string; description?: string; status?: string };
export type TaskContext = { id: string; title: string; description?: string; done?: boolean; dueDate?: string; priority?: string };
export type ChatImage = { base64: string; mimeType: string };
export type ChatOpts = {
  signal?: AbortSignal;
  /** Live tool calls on this answer, re-sent whole on every change. */
  onTools?: (calls: ToolCallRecord[]) => void;
  /** Each message annotation the server sends (persisted with the answer). */
  onAnnotation?: (annotation: Record<string, unknown>) => void;
  goalContext?: GoalContext;
  projectContext?: ProjectContext;
  taskContext?: TaskContext;
  /** Attach an image to the last user message (sent as an AI-SDK image part). */
  image?: ChatImage;
  /** Model selection: 'auto' (server picks per task), a model id, or undefined (saved Brain). */
  modelChoice?: string;
  /** Force a web search for this message (composer "+" menu toggle). */
  webSearch?: boolean;
  /** Files attached via the "+" menu — extracted text injected as chat context. */
  attachments?: { name: string; text: string }[];
  /**
   * Fires once when the response headers arrive, before any text streams, with
   * which model MODUS chose for this answer. Lets the chat surface a "routed to /
   * answered by" chip (mirrors the web x-modus-* headers).
   */
  onMeta?: (meta: ChatMeta) => void;
};

/** Which model served a message + how it was chosen, read from x-modus-* headers. */
export type ChatMeta = {
  /** The model that answered (x-modus-model). */
  model: string;
  /** Auto routing chose it (x-modus-auto). */
  auto: boolean;
  /** The picked model couldn't answer and a fallback did (x-modus-downgraded). */
  downgraded: boolean;
  /** The model the user asked for, when downgraded (x-modus-requested-model). */
  requestedModel?: string;
};

// ── Google: today's inbox + calendar (same endpoints the web dashboard uses) ──

export type InboxThread = {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  accountEmail?: string;
};

export async function fetchInbox(
  filter: 'primary' | 'all' = 'primary',
): Promise<{ threads: InboxThread[]; notConnected: boolean }> {
  const headers = await getAuthHeader();
  if (!headers.Authorization) return { threads: [], notConnected: true };
  try {
    const res = await fetch(`${API_BASE}/api/google/inbox?filter=${filter}`, { headers });
    if (!res.ok) return { threads: [], notConnected: false };
    const data = await res.json();
    return { threads: data.threads ?? [], notConnected: !!data.notConnected };
  } catch {
    return { threads: [], notConnected: false };
  }
}

export type CalEvent = { id: string; title: string; start: string; end?: string; allDay?: boolean };

export async function fetchTodayEvents(): Promise<{ events: CalEvent[]; notConnected: boolean }> {
  const headers = await getAuthHeader();
  if (!headers.Authorization) return { events: [], notConnected: true };
  try {
    const res = await fetch(`${API_BASE}/api/google/today`, { headers });
    if (!res.ok) return { events: [], notConnected: false };
    const data = await res.json();
    return { events: data.events ?? [], notConnected: !!data.notConnected };
  } catch {
    return { events: [], notConnected: false };
  }
}

// ── Briefing: news (server endpoint same as web) ──────────────────────────────
export type NewsItem = { title: string; url: string; snippet: string; image?: string | null };

export async function fetchNews(topic?: string): Promise<{ items: NewsItem[]; industry: string }> {
  const headers = await getAuthHeader();
  if (!headers.Authorization) return { items: [], industry: topic ?? '' };
  try {
    const qs = topic ? `?topic=${encodeURIComponent(topic)}` : '';
    const res = await fetch(`${API_BASE}/api/briefing/news${qs}`, { headers });
    if (!res.ok) return { items: [], industry: topic ?? '' };
    const d = await res.json();
    return { items: d.items ?? [], industry: d.industry ?? topic ?? '' };
  } catch {
    return { items: [], industry: topic ?? '' };
  }
}

// ── Weather (IP geolocation → open-meteo; no native location dep) ─────────────
export type Weather = { temp: number; unit: string; desc: string };
const WMO: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Foggy', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers', 95: 'Thunderstorm',
};

export async function fetchWeather(): Promise<Weather | null> {
  let lat: number | undefined, lon: number | undefined;
  // Precise GPS first (if the native module is present + permission granted),
  // else fall back to IP geolocation.
  const Location = loadLocation();
  if (Location) {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
        lat = pos.coords.latitude; lon = pos.coords.longitude;
      }
    } catch { /* fall through */ }
  }
  if (lat == null || lon == null) {
    try {
      const geo = await fetch('https://ipapi.co/json/').then(r => r.json());
      lat = geo.latitude; lon = geo.longitude;
    } catch { return null; }
  }
  if (lat == null || lon == null) return null;
  try {
    const d = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=fahrenheit`).then(r => r.json());
    const cw = d.current_weather;
    if (!cw) return null;
    return { temp: Math.round(cw.temperature), unit: '°F', desc: WMO[cw.weathercode] ?? 'Clear' };
  } catch {
    return null;
  }
}

// ── Text-to-speech (OpenAI TTS via /api/tts) ─────────────────────────────────

/**
 * Generates speech from text using the server-side OpenAI TTS endpoint,
 * writes the mp3 to the device cache, and returns the local file URI.
 * Use expo-audio's useAudioPlayer to play the returned URI.
 */
export async function fetchTTS(text: string, voice = 'onyx'): Promise<string> {
  const headers = await getAuthHeader();
  const res = await fetch(`${API_BASE}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ text, voice }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `TTS request failed (${res.status})`);
  }
  const { audio } = await res.json() as { audio: string };
  const uri = `${cacheDirectory}modus-tts.mp3`;
  await writeAsStringAsync(uri, audio, { encoding: EncodingType.Base64 });
  return uri;
}

export async function* streamChat(
  messages: Message[],
  opts: ChatOpts = {},
): AsyncGenerator<string> {
  const headers = await getAuthHeader();
  const { signal, goalContext, projectContext, taskContext, image, modelChoice, webSearch, attachments } = opts;

  // When an image is attached, rewrite the final user message into the AI-SDK
  // structured-content form ([{text},{image}]) — mirrors the web client.
  type OutPart = { type: 'text'; text: string } | { type: 'image'; image: string; mimeType: string };
  type OutMessage = { role: Message['role']; content: string | OutPart[] };
  let outgoing: OutMessage[] = messages;
  if (image) {
    outgoing = messages.map((m, i) => {
      if (i !== messages.length - 1 || m.role !== 'user') return m;
      const text = typeof m.content === 'string' ? m.content : '';
      const parts: OutPart[] = [];
      if (text.trim()) parts.push({ type: 'text', text });
      parts.push({ type: 'image', image: image.base64, mimeType: image.mimeType });
      return { role: m.role, content: parts };
    });
  }

  const response = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      messages: outgoing,
      ...(goalContext ? { goalContext } : {}),
      ...(projectContext ? { projectContext } : {}),
      ...(taskContext ? { taskContext } : {}),
      ...(modelChoice ? { modelChoice } : {}),
      ...(webSearch ? { webSearch } : {}),
      ...(attachments && attachments.length ? { attachments } : {}),
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const err = await response.text().catch(() => 'Unknown error');
    throw new Error(err);
  }

  // Report which model answered before the text streams, so the UI can chip it.
  const routedModel = response.headers.get('x-modus-model') || '';
  if (routedModel) {
    opts.onMeta?.({
      model: routedModel,
      auto: response.headers.get('x-modus-auto') === '1',
      downgraded: response.headers.get('x-modus-downgraded') === '1',
      requestedModel: response.headers.get('x-modus-requested-model') || undefined,
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Tool calls (9:) and results (a:) used to be dropped here, so a Pika run
  // looked like a frozen reply. Same records as the web ToolActivity.
  let toolServers: Record<string, string> = {};
  const invocations = new Map<string, { toolCallId: string; toolName: string; args?: unknown; state: string; result?: unknown }>();
  const emitTools = () => opts.onTools?.([...invocations.values()].map(inv => fromInvocation(inv, toolServers)));

  // Inactivity watchdog, same 45s as the web chat: a stream that goes quiet used
  // to spin until the server's 300s kill. Resets on every chunk.
  const STALL_MS = 45000;
  while (true) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stalled = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Reject BEFORE cancelling: cancel() ends the pending read as `done`,
        // and if that won the race the stall would pass as a normal finish
        // (caught by the node harness, 11-03).
        const e = new Error('response_stalled');
        e.name = 'StallError';
        reject(e);
        reader.cancel().catch(() => {});
      }, STALL_MS);
    });
    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await Promise.race([reader.read(), stalled]);
    } finally {
      clearTimeout(timer);
    }
    const { done, value } = result;
    // On done, flush what is left instead of breaking at once: a final `3:`
    // error or `0:` text line with no trailing newline used to be dropped.
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = done ? '' : (lines.pop() ?? '');

    for (const line of lines) {
      // Vercel AI SDK data stream: lines like `0:"text chunk"`
      if (line.startsWith('0:')) {
        try {
          const text: string = JSON.parse(line.slice(2));
          yield text;
        } catch {
          // malformed chunk — skip
        }
      } else if (line.startsWith('8:')) {
        try {
          const anns = JSON.parse(line.slice(2)) as unknown[];
          for (const a of Array.isArray(anns) ? anns : []) {
            if (!a || typeof a !== 'object') continue;
            const o = a as Record<string, unknown>;
            if (o.modusToolServers && typeof o.modusToolServers === 'object') {
              toolServers = o.modusToolServers as Record<string, string>;
              emitTools();
            }
            opts.onAnnotation?.(o);
          }
        } catch {}
      } else if (line.startsWith('9:')) {
        try {
          const c = JSON.parse(line.slice(2)) as { toolCallId: string; toolName: string; args?: unknown };
          invocations.set(c.toolCallId, { ...c, state: 'call' });
          emitTools();
        } catch {}
      } else if (line.startsWith('a:')) {
        try {
          const r = JSON.parse(line.slice(2)) as { toolCallId: string; result: unknown };
          const prev = invocations.get(r.toolCallId);
          if (prev) { invocations.set(r.toolCallId, { ...prev, state: 'result', result: r.result }); emitTools(); }
        } catch {}
      } else if (line.startsWith('3:')) {
        // The server's stream error token (rate_limit_reached, chat_error...).
        // Ignoring it used to turn every mid-stream failure into "Empty response".
        let token = 'chat_error';
        try { token = String(JSON.parse(line.slice(2))); } catch {}
        throw new Error(token);
      }
    }
    if (done) break;
  }
}

// ── Billing (Stripe) ──────────────────────────────────────────────────────────
async function postForUrl(path: string, body?: unknown): Promise<string> {
  const headers = await getAuthHeader();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data.url as string;
}

/** Stripe Checkout URL for a plan upgrade. */
export const startCheckout = (plan: 'modus' | 'pilot', cadence: 'monthly' | 'annual' = 'monthly') =>
  postForUrl('/api/stripe/checkout', { plan, cadence });

/**
 * Move an existing subscription to another plan. Checkout refuses a user who
 * already pays (409 has_subscription), so a paying MODUS user tapping "Switch to
 * PILOT" always failed. Same route the web billing settings use.
 */
export async function changePlan(plan: 'modus' | 'pilot'): Promise<void> {
  const headers = await getAuthHeader();
  const res = await fetch(`${API_BASE}/api/stripe/change-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ plan }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `Request failed (${res.status})`);
}
/** Stripe billing-portal URL (manage/cancel). */
export const openBillingPortal = () => postForUrl('/api/stripe/portal');

// ── Connectors ────────────────────────────────────────────────────────────────
export type ConnectorProvider = 'google' | 'notion' | 'slack' | 'github';
export interface ConnectorStatus {
  google: { email: string; connectedAt: string | null }[];
  notion: { workspaceId: string; workspaceName: string; ownerEmail: string }[];
  slack: { teamId: string; teamName: string }[];
  github: { login: string; name: string | null; avatarUrl: string }[];
}

export async function fetchConnectorStatus(): Promise<ConnectorStatus> {
  const headers = await getAuthHeader();
  const [conn, goog] = await Promise.all([
    fetch(`${API_BASE}/api/connectors/status`, { headers }).then(r => r.json()).catch(() => ({})),
    fetch(`${API_BASE}/api/google/status`, { headers }).then(r => r.json()).catch(() => ({})),
  ]);
  return {
    google: goog.accounts ?? [],
    notion: conn.notion ?? [],
    slack: conn.slack ?? [],
    github: conn.github ?? [],
  };
}

/** OAuth connect URL for a provider (open in an in-app browser). */
export const connectProvider = (p: ConnectorProvider) => postForUrl(`/api/auth/${p}/connect`);

/** Disconnect a specific connected account. */
export async function disconnectProvider(p: ConnectorProvider, body: Record<string, string>): Promise<void> {
  const headers = await getAuthHeader();
  const path = p === 'google' ? '/api/google/disconnect' : `/api/${p}/disconnect`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Disconnect failed (${res.status})`);
}
