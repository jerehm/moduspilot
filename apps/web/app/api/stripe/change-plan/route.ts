import { stripe } from '@/lib/stripe';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { resolvePlanPrice } from '@/lib/pricing';
import { cadenceOfSubscription, isFoundingSubscription, isAddonSubscription, findLivePlanSubscription } from '@/lib/billing';

// Plan changes for an EXISTING subscriber. Unlike /checkout (which is for brand
// new customers), this reprices the customer's
// current subscription in place — so upgrading never grants another free trial
// and never leaves a second, parallel subscription billing alongside the first.
// Price order, so we can charge immediately on an upgrade but only credit the
// next invoice on a downgrade.
const RANK: Record<string, number> = { free: 0, modus: 1, pilot: 2, group: 3 };

export async function POST(req: Request) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let uid: string;
  let email: string | undefined;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    uid = decoded.uid;
    // Billing finds Stripe customers and subscriptions BY EMAIL. Only a verified
    // email may be used for that: an unverified claim would let one account match
    // another person's customer (their plan, their billing portal, their sub).
    email = decoded.email_verified === true ? decoded.email : undefined;
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { plan?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid plan' }, { status: 400 }); }
  const newPlan = body?.plan;
  if (typeof newPlan !== 'string') return Response.json({ error: 'Invalid plan' }, { status: 400 });
  if (newPlan === 'free') return Response.json({ error: 'Invalid plan' }, { status: 400 });
  // The limits add-on is bought and cancelled through Checkout/the portal by
  // quantity — it is not a plan and must never be a repricing target here.
  if (newPlan === 'limitAddon') {
    return Response.json({ error: 'Extra limits are managed separately, not as a plan change.' }, { status: 400 });
  }

  const userRef = adminDb.collection('users').doc(uid);
  const userData = (await userRef.get()).data() ?? {};
  const sub = await findLivePlanSubscription(uid, email);
  if (!sub) return Response.json({ error: 'No active subscription to change.' }, { status: 409 });
  const subId = sub.id;
  const currentPlan = sub.metadata?.plan;
  if (!currentPlan || !['modus', 'pilot', 'group'].includes(currentPlan)) {
    return Response.json({ error: 'Your subscription needs review before changing plans. Contact support.' }, { status: 409 });
  }
  if (newPlan === currentPlan) return Response.json({ error: 'Already on this plan.' }, { status: 400 });
  const itemId = sub.items.data[0]?.id;
  if (!itemId) return Response.json({ error: 'Subscription has no items.' }, { status: 500 });

  // 🚨 NEVER REPRICE AN ADD-ON.
  //
  // users/{uid}.subscriptionId is written by several self-heal paths that each
  // pick "a live subscription" for this customer. Since the limits add-on exists,
  // one of those can point here at the $10 add-on instead of the plan — and this
  // route would then overwrite the add-on's price with $24 or $59, silently
  // cancelling the customer's extra limits AND leaving their real plan untouched.
  // Refuse and let the mirror be repaired (scripts/repair-subscription.ts).
  if (isAddonSubscription(sub)) {
    return Response.json({
      error: 'Your subscription record needs repair before a plan change — contact support.',
      code: 'mirror_points_at_addon',
    }, { status: 409 });
  }

  // A founding member's discount IS the mismatch between the $24 MODUS price and
  // their 'pilot' plan — there is no coupon holding it. Repricing them to any list
  // price destroys the founding rate permanently, and they were promised it for
  // life. Refuse and let a human handle it, rather than silently charging a
  // founder $59. (Group is the only genuine upgrade a founder could want, and
  // Group isn't self-serve sellable yet anyway.)
  if (isFoundingSubscription(userData, sub)) {
    return Response.json({
      error: 'Your founding rate is locked in. Contact us and we will move you across by hand.',
      code: 'founding_locked',
    }, { status: 409 });
  }

  // Keep them on the cadence they actually bought. This map used to be monthly-only,
  // so changing plan moved an annual subscriber onto monthly billing without asking.
  // Read the cadence off the live subscription, never off anything we stored.
  const currentCadence = cadenceOfSubscription(sub);
  const { priceId, cadence } = resolvePlanPrice(newPlan, currentCadence);
  if (!priceId) return Response.json({ error: 'Invalid plan' }, { status: 400 });

  // If the target plan has no price at the cadence they're on (Group is monthly
  // only), that's a real billing-frequency change — say so instead of doing it quietly.
  if (cadence !== currentCadence) {
    return Response.json({
      error: `${newPlan} isn't available on ${currentCadence} billing. Contact us to switch.`,
      code: 'cadence_unavailable',
    }, { status: 409 });
  }

  // Upgrade → invoice the prorated difference now. Downgrade → credit the next
  // invoice. (While still in trial, Stripe defers any charge to trial end.) The
  // metadata.plan drives the customer.subscription.updated webhook.
  const isUpgrade = (RANK[newPlan] ?? 0) > (RANK[currentPlan] ?? 0);
  if (isUpgrade) {
    // An upgrade charges the prorated difference NOW. pending_if_incomplete means
    // Stripe only applies the new price if that charge succeeds; a declined card
    // leaves the subscription exactly as it was. Without it the price, and the
    // plan grant below, switched to the higher tier before any money arrived.
    // Stripe rejects metadata in the same call, so it follows on success.
    const updated = await stripe.subscriptions.update(subId, {
      items: [{ id: itemId, price: priceId }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'pending_if_incomplete',
    });
    if (updated.pending_update) {
      return Response.json({
        error: 'Your card was declined for the upgrade. Update your payment method in Billing and try again.',
        code: 'payment_failed',
      }, { status: 402 });
    }
    // cadence is carried so the mirror matches what Stripe is actually billing.
    await stripe.subscriptions.update(subId, { metadata: { uid, plan: newPlan, cadence } });
  } else {
    await stripe.subscriptions.update(subId, {
      items: [{ id: itemId, price: priceId }],
      proration_behavior: 'create_prorations',
      metadata: { uid, plan: newPlan, cadence },
    });
  }

  // Reflect immediately; the subscription.updated webhook also sets this (idempotent).
  // set+merge so this can never throw `5 NOT_FOUND` on a missing users doc.
  await userRef.set({ plan: newPlan, subscriptionId: sub.id }, { merge: true });

  return Response.json({ updated: true, plan: newPlan, cadence });
}
