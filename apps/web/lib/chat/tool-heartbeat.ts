/**
 * Keeps a stream alive while a tool runs.
 *
 * A generation tool (Pika, Higgsfield) can block for minutes. The model sends
 * nothing meanwhile, so both clients' 45s inactivity watchdogs called a healthy
 * run "stalled" and killed it. Each wrapped execute emits a beat every
 * HEARTBEAT_MS until it settles; the clients count any line as life.
 */
export const HEARTBEAT_MS = 10_000;

export function withToolHeartbeat(
  tools: Record<string, unknown>,
  beat: () => void,
  everyMs = HEARTBEAT_MS,
): Record<string, unknown> {
  for (const tool of Object.values(tools)) {
    if (!tool || typeof tool !== 'object') continue;
    const t = tool as { execute?: (...args: unknown[]) => unknown };
    if (typeof t.execute !== 'function') continue;
    const original = t.execute;
    t.execute = async (...args: unknown[]) => {
      const timer = setInterval(() => { try { beat(); } catch {} }, everyMs);
      try {
        return await original(...args);
      } finally {
        clearInterval(timer);
      }
    };
  }
  return tools;
}
