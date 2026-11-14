import { createHash } from 'crypto';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { isCadence, resolvePlanPrice, type Cadence } from '@/lib/pricing';
import { ensureUserDoc, resolveStripeCustomer, findLivePlanSubscription, stripeId, acquireCheckoutLock } from '@/lib/billing';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.moduspilot.com';

export async function POST(req: Request) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let uid: string;
  let email: string | undefined;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    uid = decoded.uid;
    email = decoded.email ?? undefined;
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { plan?: unknown; returnTo?: unknown; cadence?: unknown; quantity?: unknown };
  try { body = await req.json(); }
  catch { return Response.json({ error: 'Invalid checkout request' }, { status: 400 }); }
  if (!body || typeof body.plan !== 'string') return Response.json({ error: 'Invalid plan' }, { status: 400 });
  const { plan, returnTo, cadence: rawCadence, quantity: rawQuantity } = body;
  const requested: Cadence = isCadence(rawCadence) ? rawCadence : 'monthly';
  const { priceId, cadence } = resolvePlanPrice(plan, requested);
  if (!priceId) return Response.json({ error: 'Invalid plan' }, { status: 400 });
  if (plan !== 'limitAddon' && cadence !== requested) return Response.json({ error: 'This billing cadence is unavailable. Choose monthly billing or try again later.', code: 'cadence_unavailable' }, { status: 409 });

  // The limits add-on is a TOP-UP, not a plan: it grants no access on its own and
  // stacks by Stripe subscription quantity. It therefore takes the opposite path
  // through the duplicate-subscription guard below — it REQUIRES an existing plan
  // instead of being blocked by one.
  const isAddon = plan === 'limitAddon';
  const parsedQuantity = rawQuantity === undefined ? 1 : Number(rawQuantity);
  if (isAddon && (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 20)) {
    return Response.json({ error: 'Choose between 1 and 20 extra limit packs.' }, { status: 400 });
  }
  const quantity = isAddon ? parsedQuantity : 1;

  // Never let a later write hit `5 NOT_FOUND` on a users doc that doesn't exist yet.
  await ensureUserDoc(uid, email);

  // Guard: an active subscriber must NOT get a second (trialing) subscription
  // here — that would double-bill them and grant a fresh trial. Plan changes go
  // through /api/stripe/change-plan, which reprices the existing subscription.
  //
  // This asks STRIPE, not our Firestore mirror. The mirror is only written by the
  // success webhook, so it reads "no subscription" exactly when the webhook failed
  // — the one moment this guard has to work. Firestore-based checking is how a
  // founder ended up paying twice.
  //
  // 🪤 ADD-ONS ARE EXCLUDED FROM BOTH SIDES OF THIS. An add-on must not look like
  // "you already have a subscription" when someone is buying a real plan, and a
  // real plan is exactly what an add-on purchase requires.
  const livePlanSub = await findLivePlanSubscription(uid, email);

  if (isAddon) {
    if (!livePlanSub) {
      return Response.json(
        { error: 'Start a plan before adding extra limits.', code: 'needs_plan' },
        { status: 400 },
      );
    }
  } else if (livePlanSub) {
    // Self-heal the mirror so the user isn't stuck behind a stale paywall.
    const livePlan = livePlanSub.metadata?.plan;
    await adminDb.collection('users').doc(uid).set({
      subscriptionId: livePlanSub.id,
      stripeCustomerId: stripeId(livePlanSub.customer),
      ...(livePlan === 'modus' || livePlan === 'pilot' || livePlan === 'group' ? { plan: livePlan } : {}),
    }, { merge: true });
    return Response.json(
      { error: 'You already have an active subscription. Use plan change instead.', code: 'has_subscription' },
      { status: 409 },
    );
  }

  // Resolve + PERSIST the customer up front, so a retry reuses it instead of
  // minting a second customer (and, with it, a second subscription).
  const existingCustomerId = await resolveStripeCustomer(uid, email);

  // Optional post-checkout destination (e.g. new users land on the dashboard
  // after checkout; billing changes stay in settings).
  const successUrl = returnTo === 'dashboard'
    ? `${APP_URL}/dashboard?checkout_completed=1`
    : `${APP_URL}/settings?tab=billing&upgraded=1`;

  // Abandoning checkout must not dead-end an account-only user with no access:
  // from onboarding (returnTo=dashboard), send them back to the plan/Start step
  // (?checkout=1) so it's one tap to retry. Settings upgrades return to settings.
  const cancelUrl = returnTo === 'dashboard'
    ? `${APP_URL}/onboarding?checkout=1`
    : `${APP_URL}/settings?tab=billing`;

  // 🚨 ADD-ON METADATA CARRIES NO `plan` KEY, DELIBERATELY.
  //
  // The webhook grants access on `isGrantablePlan(sub.metadata.plan)`. Stamping
  // plan:'limitAddon' would fail that check today, but the safer property is that
  // there is nothing there to accidentally start matching — and `addon` is the
  // positive signal isAddonSubscription() keys off, which is what keeps a
  // cancelled plan from being "kept alive" by a $10 add-on.
  const subMetadata: Stripe.MetadataParam = isAddon
    ? { uid, addon: 'limits', cadence }
    : { uid, plan, cadence };

  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = {
    price: priceId,
    quantity,
    // Let people change how many add-ons they hold from Stripe's own page.
    ...(isAddon ? { adjustable_quantity: { enabled: true, minimum: 1, maximum: 20 } } : {}),
  };

  // New purchases are charged at checkout. Existing trial subscriptions keep
  // their original schedule through the webhook lifecycle.
  const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = { metadata: subMetadata };

  // Reuse an abandoned checkout. Concurrent retries for the same intent share
  // a Stripe idempotency key, rather than creating duplicate subscriptions.
  const intent = createHash('sha256').update(JSON.stringify([uid, priceId, quantity, successUrl, cancelUrl])).digest('hex');
  const openSessions = await stripe.checkout.sessions.list({ customer: existingCustomerId, status: 'open', limit: 100 });
  const existing = openSessions.data.find(session => session.metadata?.checkoutIntent === intent && session.url);
  if (existing) return Response.json({ url: existing.url });

  // Second concurrent attempt (two tabs, a fast retry) must not slip past the
  // check-then-act guard above and create a parallel subscription. Fails open on a
  // lock outage so a real checkout is never blocked.
  if (!(await acquireCheckoutLock(uid))) {
    return Response.json(
      { error: 'A checkout is already in progress. Finish or close the other tab, then try again.', code: 'checkout_in_progress' },
      { status: 409 },
    );
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [lineItem],
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer: existingCustomerId,
    subscription_data: subscriptionData,
    payment_method_collection: 'always',
    // Promo code box on Stripe's page (friend + affiliate codes). Access is
    // granted on metadata.plan, never on the amount paid, so a discount can't
    // change what the subscription unlocks.
    allow_promotion_codes: true,
    metadata: { ...subMetadata, checkoutIntent: intent },
  }, { idempotencyKey: `checkout:${intent}:${Math.floor(Date.now() / 1_800_000)}` });

  return Response.json({ url: session.url });
}
