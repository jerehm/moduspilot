import { requireAuth } from '@/lib/api-auth';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { isPaidPlan } from '@/lib/plan';
import { sendCapiEvent } from '@/lib/meta-capi';

/**
 * Server copy of a browser conversion event (Meta Conversions API).
 *
 * The client only calls this when the visitor allowed ad tracking (see
 * lib/meta-pixel.ts). The server checks the claim against our own data before
 * reporting it, so nobody can feed Meta a fake signup or subscription:
 * - CompleteRegistration: the users doc must have onboardingComplete.
 * - Subscribe: the users doc must carry a paid plan, which only the Stripe
 *   webhook writes. If the webhook has not landed yet, answer retry:true.
 *
 * Read-only against billing: this never touches Stripe or the plan fields.
 */

const EVENTS = new Set(['CompleteRegistration', 'Subscribe']);
const SITE = 'https://moduspilot.com';

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { uid } = auth;

  let body: { event?: unknown; eventId?: unknown; fbp?: unknown; fbc?: unknown; sourceUrl?: unknown };
  try { body = await req.json(); }
  catch { return Response.json({ error: 'Bad request' }, { status: 400 }); }

  const { event, eventId } = body;
  if (typeof event !== 'string' || !EVENTS.has(event)) return Response.json({ error: 'Unknown event' }, { status: 400 });
  if (typeof eventId !== 'string' || eventId.length < 8 || eventId.length > 100) return Response.json({ error: 'Bad event id' }, { status: 400 });

  const user = (await adminDb.collection('users').doc(uid).get()).data();
  let customData: Record<string, unknown> | undefined;
  if (event === 'CompleteRegistration') {
    if (user?.onboardingComplete !== true) return Response.json({ ok: false });
  } else {
    if (!isPaidPlan(user?.plan)) return Response.json({ ok: false, retry: true });
    customData = { content_name: user!.plan };
  }

  const str = (v: unknown, max: number) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined);
  const sourceUrl = str(body.sourceUrl, 2000);
  const email = await adminAuth.getUser(uid).then(u => u.email ?? undefined).catch(() => undefined);

  const ok = await sendCapiEvent({
    eventName: event,
    eventId,
    eventSourceUrl: sourceUrl?.startsWith(SITE) ? sourceUrl : SITE,
    email,
    externalId: uid,
    clientIp: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
    userAgent: str(req.headers.get('user-agent'), 1000),
    fbp: str(body.fbp, 200),
    fbc: str(body.fbc, 500),
    customData,
  });
  return Response.json({ ok });
}
