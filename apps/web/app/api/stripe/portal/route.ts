import { stripe } from '@/lib/stripe';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { findLivePlanSubscription, stripeId } from '@/lib/billing';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.moduspilot.com';

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

  // Ask STRIPE which customer actually holds this user's plan, never the Firestore
  // mirror alone. The mirror is blank exactly when the success webhook failed (a
  // real payer would then get "no billing account" and be unable to cancel), and
  // when duplicate customers exist it can point at the wrong, sub-less customer.
  // Resolve the customer carrying the live plan sub, self-heal the mirror, and only
  // fall back to the stored id when there is no live sub to key off.
  const live = await findLivePlanSubscription(uid, email);
  let customerId = stripeId(live?.customer);
  if (customerId) {
    await adminDb.collection('users').doc(uid).set({ stripeCustomerId: customerId }, { merge: true });
  } else {
    const userDoc = await adminDb.collection('users').doc(uid).get();
    customerId = stripeId(userDoc.data()?.stripeCustomerId as string | null);
  }
  if (!customerId) return Response.json({ error: 'No billing account found' }, { status: 404 });

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${APP_URL}/settings?tab=billing`,
  });

  return Response.json({ url: session.url });
}
