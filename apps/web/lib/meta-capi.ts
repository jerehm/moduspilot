import { createHash } from 'node:crypto';

/**
 * Meta Conversions API (server side). The browser pixel loses events to ad
 * blockers and iOS privacy settings; sending the same event from the server
 * with the same event id lets Meta keep one copy and still count it.
 *
 * No-op unless NEXT_PUBLIC_META_PIXEL_ID and META_CAPI_ACCESS_TOKEN are set.
 * META_CAPI_TEST_EVENT_CODE (optional) routes events to Events Manager's
 * Test Events tab while verifying; leave it unset in production.
 * Never throws: tracking must not break signup or billing.
 */

// v26.0 is the newest Graph API version as of 2026-11. Override without a deploy
// of code via META_GRAPH_VERSION when Meta ships the next one.
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v26.0';

function sha256(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

export type CapiEvent = {
  eventName: string;
  eventId: string;
  eventSourceUrl: string;
  email?: string;
  externalId?: string;
  clientIp?: string;
  userAgent?: string;
  fbp?: string;
  fbc?: string;
  customData?: Record<string, unknown>;
};

export async function sendCapiEvent(e: CapiEvent): Promise<boolean> {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const token = process.env.META_CAPI_ACCESS_TOKEN;
  if (!pixelId || !token) return false;

  // Meta asks for identifiers hashed with SHA-256; IP, user agent and the
  // _fbp/_fbc cookie values are sent as they are.
  const userData: Record<string, unknown> = {};
  if (e.email) userData.em = [sha256(e.email)];
  if (e.externalId) userData.external_id = [sha256(e.externalId)];
  if (e.clientIp) userData.client_ip_address = e.clientIp;
  if (e.userAgent) userData.client_user_agent = e.userAgent;
  if (e.fbp) userData.fbp = e.fbp;
  if (e.fbc) userData.fbc = e.fbc;

  const testCode = process.env.META_CAPI_TEST_EVENT_CODE;
  const body = {
    data: [{
      event_name: e.eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: e.eventId,
      action_source: 'website',
      event_source_url: e.eventSourceUrl,
      user_data: userData,
      ...(e.customData ? { custom_data: e.customData } : {}),
    }],
    ...(testCode ? { test_event_code: testCode } : {}),
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) {
      console.error('meta capi: rejected', e.eventName, res.status, (await res.text().catch(() => '')).slice(0, 500));
      return false;
    }
    return true;
  } catch (err) {
    console.error('meta capi: request failed', e.eventName, err);
    return false;
  }
}
