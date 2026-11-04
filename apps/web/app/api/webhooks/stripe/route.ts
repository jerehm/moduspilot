import { stripe } from '@/lib/stripe';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { sendPushToUser } from '@/lib/fcm-admin';
import { stripeId, sessionIsPaid, downgradeIfNoLiveSubscription, isAddonSubscription, customerIdsForUser, findLivePlanSubscription, subscriptionIdFromInvoice } from '@/lib/billing';

const PLAN_PRICE: Record<string, string> = { modus: '$28', pilot: '$59', group: '$79' };

type GrantablePlan = 'modus' | 'pilot' | 'group';
function isGrantablePlan(p: unknown): p is GrantablePlan {
  return p === 'modus' || p === 'pilot' || p === 'group';
}

/** Statuses where an add-on is paid for and should actually raise the ceiling. */
const ADDON_LIVE_STATUSES = ['active', 'trialing'];

/**
 * Mirror the total quantity across current live add-on subscriptions.
 *
 * 🪤 THE QUANTITY IS NOT ON THE SESSION. `checkout.session.completed` gives
 * `session.subscription` as a bare id, so reading `items.data[0].quantity`
 * requires retrieving the subscription. Skipping that retrieve is how every
 * purchase silently becomes qty 1 and someone who bought three gets one.
 *
 * set+merge, never update(): a user can pay before their users doc exists, and
 * update() throws 5 NOT_FOUND on a missing doc — the bug that left a real $24
 * payer with no plan.
 */
async function syncAddonQty(
  uid: string,
  sub: { id: string; status: string; items?: { data: Array<{ quantity?: number | null }> } },
  event: { id: string; type: string },
) {
  const ref = adminDb.collection('users').doc(uid);
  await adminDb.runTransaction(async transaction => {
    const account = (await transaction.get(ref)).data();
    const email = typeof account?.email === 'string' ? account.email : undefined;
    const livePlan = await findLivePlanSubscription(uid, email);
    let qty = 0;
    if (livePlan) {
      const seen = new Set<string>();
      for (const customer of await customerIdsForUser(uid, email)) {
        // Ask Stripe for current state, not the possibly delayed event payload.
        for await (const addon of stripe.subscriptions.list({ customer, status: 'all', limit: 100 })) {
          if (seen.has(addon.id) || !isAddonSubscription(addon) || !ADDON_LIVE_STATUSES.includes(addon.status)) continue;
          seen.add(addon.id);
          qty += Math.max(0, Math.floor(addon.items.data[0]?.quantity ?? 0));
        }
      }
    }
    transaction.set(ref, { limitAddonQty: qty }, { merge: true });
  });
  log(event, 'limit add-on total reconciled', { uid, sub: sub.id, status: sub.status });
}

/**
 * Every branch logs one line with the event id. When a payment silently doesn't
 * land, the first question is "did the webhook even run, and what did it decide" —
 * previously nothing answered that, and the only evidence was a stack trace in
 * Vercel logs that happened to include the uid.
 */
function log(event: { id: string; type: string }, decision: string, extra: Record<string, unknown> = {}) {
  const bits = Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`[stripe-webhook] ${event.type} ${event.id} → ${decision}${bits ? ` ${bits}` : ''}`);
}

// When a subscription ends or lapses, the pending "your trial ends, you'll be
// charged $X" heads-up is no longer true — retract it so canceled users don't
// see a stale charge warning (a source of confusion + disputes). Also reset the
// sent flag so a future trial can notify again.
async function clearTrialReminders(ref: FirebaseFirestore.DocumentReference) {
  const snap = await ref.collection('conversations').where('trialReminder', '==', true).get();
  if (snap.empty) return;
  await Promise.all(snap.docs.map(d => d.ref.delete()));
  // set+merge, not update: the parent users doc can be missing even when
  // subcollection docs exist (Firestore allows orphaned subcollections).
  await ref.set({ trialReminderSent: false }, { merge: true });
}

async function findUserBySubscription(subId: string, customerId: string | null, uid?: string | null) {
  if (uid) {
    const doc = await adminDb.collection('users').doc(uid).get();
    if (doc.exists) return doc.ref;
  }
  // Fallback: look up by subscriptionId
  let snap = await adminDb.collection('users').where('subscriptionId', '==', subId).limit(1).get();
  if (!snap.empty) return snap.docs[0].ref;
  // Fallback: look up by stripeCustomerId
  if (customerId) {
    snap = await adminDb.collection('users').where('stripeCustomerId', '==', customerId).limit(1).get();
    if (!snap.empty) return snap.docs[0].ref;
  }
  return null;
}

/** Email for a customer, used to sweep for duplicate customer records. */
async function customerEmail(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  try {
    const c = await stripe.customers.retrieve(customerId);
    return (c as { deleted?: boolean; email?: string | null }).deleted
      ? null
      : ((c as { email?: string | null }).email ?? null);
  } catch { return null; }
}

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature')!;

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return Response.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const uid = session.metadata?.uid;
    const plan = session.metadata?.plan;

    // Never grant on an unpaid session. `no_payment_required` is the legitimate
    // trial case; `unpaid` (async/delayed payment methods) means the money has
    // NOT arrived, and granting on it would hand out a plan — and burn a founding
    // seat — for free. checkout.session.async_payment_succeeded grants it later.
    if (!sessionIsPaid(session)) {
      log(event, 'ignored: not paid', { uid, payment_status: session.payment_status });
      return Response.json({ received: true });
    }

    // Limits add-on: not a plan grant. Mirror the quantity and stop — falling
    // through would do nothing (isGrantablePlan is false for it) but returning
    // here makes it impossible for a future edit to touch `plan` on an add-on.
    if (uid && session.metadata?.addon === 'limits') {
      const addonSubId = stripeId(session.subscription);
      if (addonSubId) {
        const addonSub = await stripe.subscriptions.retrieve(addonSubId);
        await syncAddonQty(uid, addonSub, event);
      } else {
        log(event, 'add-on session had no subscription', { uid });
      }
      return Response.json({ received: true });
    }

    if (uid && isGrantablePlan(plan)) {
      // set+merge, NOT update: a user can pay BEFORE the users doc exists (the
      // founding flow signs in and goes straight to checkout; onboarding is what
      // creates the doc). update() throws 5 NOT_FOUND on a missing doc, so the
      // webhook 500'd and a real founder was left paid-but-on-no-plan.
      await adminDb.collection('users').doc(uid).set({
        plan,
        stripeCustomerId: stripeId(session.customer),
        subscriptionId: stripeId(session.subscription),
        trialReminderSent: false,
        ...(session.metadata?.founding === 'true' ? { founding: true } : {}),
      }, { merge: true });
      log(event, 'plan granted', { uid, plan, sub: stripeId(session.subscription) });

      // Founding: the seat is claimed HERE — on successful payment — never at
      // checkout creation. So abandoning the Stripe page never consumes a seat.
      // Best-effort: the plan grant above is what matters. A claim hiccup must not
      // throw (Stripe would retry the whole event and re-grant); already-claimed
      // is a no-op (webhook retry, or the vanishingly rare two-payers race — the
      // second payer still got their plan above, just not the seat number).
      const foundingCodeId = session.metadata?.foundingCodeId;
      if (session.metadata?.founding === 'true' && foundingCodeId) {
        try {
          const codeRef = adminDb.collection('foundingCodes').doc(foundingCodeId);
          await adminDb.runTransaction(async tx => {
            const data = (await tx.get(codeRef)).data() as { status?: string } | undefined;
            if (!data || data.status === 'claimed') return;
            tx.update(codeRef, { status: 'claimed', claimedByUid: uid, claimedAt: FieldValue.serverTimestamp() });
          });
          log(event, 'founding seat claimed', { uid, codeId: foundingCodeId });
        } catch (e) {
          console.error('founding: claim-on-payment failed', foundingCodeId, uid, e);
        }
      }
    } else {
      log(event, 'ignored: no uid or unknown plan', { uid, plan });
    }
  }

  // A delayed payment method finally cleared. Same grant as above — without this,
  // anything that isn't instantly `paid` never gets its plan at all.
  if (event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object;
    const uid = session.metadata?.uid;
    const plan = session.metadata?.plan;
    if (uid && session.metadata?.addon === 'limits') {
      const addonSubId = stripeId(session.subscription);
      if (addonSubId) await syncAddonQty(uid, await stripe.subscriptions.retrieve(addonSubId), event);
      return Response.json({ received: true });
    }
    if (uid && isGrantablePlan(plan)) {
      await adminDb.collection('users').doc(uid).set({
        plan,
        stripeCustomerId: stripeId(session.customer),
        subscriptionId: stripeId(session.subscription),
        ...(session.metadata?.founding === 'true' ? { founding: true } : {}),
      }, { merge: true });
      log(event, 'plan granted (async payment cleared)', { uid, plan });
    }
  }

  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object;
    const customerId = stripeId(sub.customer);

    // Add-on first, and it returns. Quantity changes (someone stacking a second
    // add-on from Stripe's page) arrive as .updated — there is no
    // customer.subscription.created handler in this file, so this and
    // checkout.session.completed are the only two places qty can be learned.
    if (isAddonSubscription(sub)) {
      const uid = sub.metadata?.uid;
      if (uid) await syncAddonQty(uid, sub, event);
      else log(event, 'ignored: add-on with no uid', { sub: sub.id });
      return Response.json({ received: true });
    }

    const ref = await findUserBySubscription(sub.id, customerId, sub.metadata?.uid);
    const plan = sub.metadata?.plan;
    const status = sub.status; // active, past_due, canceled, unpaid, etc.

    // This handler is the safety net for a paid sub whose checkout.session.completed
    // didn't land. findUserBySubscription returns null when the users doc doesn't
    // exist yet (paid before onboarding), which used to make this silently 200 and
    // leave a payer on no plan. Our own metadata.uid is trustworthy, so grant on it.
    if (!ref) {
      const uid = sub.metadata?.uid;
      if (uid && (status === 'active' || status === 'trialing') && isGrantablePlan(plan)) {
        await adminDb.collection('users').doc(uid).set({
          plan,
          subscriptionId: sub.id,
          stripeCustomerId: customerId,
          ...(sub.metadata?.founding === 'true' ? { founding: true } : {}),
        }, { merge: true });
        log(event, 'plan granted (no users doc — created)', { uid, plan });
      } else {
        log(event, 'ignored: no user found', { sub: sub.id, status });
      }
      return Response.json({ received: true });
    }

    if (status === 'active' || status === 'trialing') {
      if (isGrantablePlan(plan)) {
        await ref.set({ plan, subscriptionId: sub.id }, { merge: true });
        log(event, 'plan set', { uid: ref.id, plan, status });
      }
    } else if (status === 'past_due' || status === 'unpaid' || status === 'paused') {
      // Only strip access if nothing else is still paying. A user can hold a
      // second, healthy subscription (a duplicate from a retry, or a resubscribe
      // overlapping the old one) — downgrading them then is taking away access
      // they are actively being charged for.
      const email = await customerEmail(customerId);
      const outcome = await downgradeIfNoLiveSubscription(ref.id, sub.id, email);
      if (outcome === 'downgraded') await clearTrialReminders(ref);
      log(event, `lapsed → ${outcome}`, { uid: ref.id, status });
    }
  }

  // Trial ending — notify the user before their card is charged. Stripe fires
  // this ~3 days before trial end (immediately for our 3-day trial, i.e. right
  // after signup), so it doubles as a clear "you'll be charged on X" heads-up
  // that reduces surprise charges + disputes. Delivered in-app + push (MODUS
  // has no transactional email provider).
  if (event.type === 'customer.subscription.trial_will_end') {
    const sub = event.data.object;
    const ref = await findUserBySubscription(sub.id, stripeId(sub.customer), sub.metadata?.uid);
    if (!ref) return Response.json({ received: true });

    const snap = await ref.get();
    if (snap.data()?.trialReminderSent === true) return Response.json({ received: true });

    const plan = sub.metadata?.plan ?? 'modus';
    const price = PLAN_PRICE[plan] ?? '$28';
    const chargeDate = sub.trial_end
      ? new Date(sub.trial_end * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
      : 'soon';
    const body = `Your free trial ends ${chargeDate}. Unless you cancel first, your card will be charged ${price}/mo. Manage anytime in Settings → Billing.`;

    await Promise.all([
      ref.collection('conversations').add({
        title: 'Your trial is ending',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        deleted: false,
        system: true,
        trialReminder: true,
        read: false,
        messages: [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: 'assistant', content: body }],
      }),
      ref.set({ trialReminderSent: true }, { merge: true }),
      sendPushToUser(ref.id, 'Your MODUS trial is ending', body).catch(() => {}),
    ]);
    return Response.json({ received: true });
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const customerId = stripeId(sub.customer);

    // Cancelling the ADD-ON drops the boost and touches nothing else. It must not
    // reach downgradeIfNoLiveSubscription, which would re-point subscriptionId.
    if (isAddonSubscription(sub)) {
      const uid = sub.metadata?.uid;
      if (uid) await syncAddonQty(uid, { ...sub, status: 'canceled' }, event);
      else log(event, 'ignored: add-on with no uid', { sub: sub.id });
      return Response.json({ received: true });
    }

    const ref = await findUserBySubscription(sub.id, customerId, sub.metadata?.uid);
    if (ref) {
      // THE bug that would have hit Oliver the moment his duplicate was cancelled:
      // this used to unconditionally set plan=free, so cancelling one of two
      // subscriptions revoked access from someone still paying for the other.
      const email = await customerEmail(customerId);
      const outcome = await downgradeIfNoLiveSubscription(ref.id, sub.id, email);
      if (outcome === 'downgraded') await clearTrialReminders(ref);
      log(event, `canceled → ${outcome}`, { uid: ref.id, sub: sub.id });
    } else {
      log(event, 'ignored: no user found', { sub: sub.id });
    }
  }

  // Downgrade on failed payment after all retries exhausted
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    // Read across API versions: a newer endpoint moves this off invoice.subscription.
    const invoiceSubId = subscriptionIdFromInvoice(invoice);
    // Only act when it's a subscription invoice and next_payment_attempt is null (retries done)
    if (invoiceSubId && invoice.next_payment_attempt === null) {
      const customerId = stripeId(invoice.customer as string | { id: string } | null);

      // A dead invoice on the ADD-ON drops the boost only. Running the plan
      // downgrade path here would strip access over a failed $10 top-up while
      // the $24 plan is still being paid.
      const failedSub = await stripe.subscriptions.retrieve(invoiceSubId).catch(() => null);
      if (failedSub && isAddonSubscription(failedSub)) {
        const uid = failedSub.metadata?.uid;
        if (uid) await syncAddonQty(uid, { ...failedSub, status: 'unpaid' }, event);
        else log(event, 'ignored: add-on with no uid', { sub: invoiceSubId });
        return Response.json({ received: true });
      }

      const ref = await findUserBySubscription(invoiceSubId, customerId, null);
      if (ref) {
        // Same rule as cancellation: a dead invoice on ONE subscription must not
        // revoke access that another live subscription is still paying for.
        const email = await customerEmail(customerId);
        const outcome = await downgradeIfNoLiveSubscription(ref.id, invoiceSubId, email);
        if (outcome === 'downgraded') await clearTrialReminders(ref);
        log(event, `payment failed → ${outcome}`, { uid: ref.id, sub: invoiceSubId });
      }
    }
  }

  return Response.json({ received: true });
}
