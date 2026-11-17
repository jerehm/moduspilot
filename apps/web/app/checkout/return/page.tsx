import { redirect } from 'next/navigation';
import { stripe } from '@/lib/stripe';
import { ELEMENTS_API_VERSION } from '@/lib/stripe-elements';

/**
 * Stripe sends the buyer here after confirming on /checkout. We read the
 * session status and hand off to the SAME success pages the hosted flow used,
 * so MetaCheckoutTracker (Subscribe) and the dashboard welcome keep working.
 * Access itself is granted by the webhook, never by this page.
 */
export const dynamic = 'force-dynamic';

export default async function CheckoutReturn({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; from?: string }>;
}) {
  const { session_id: sessionId, from } = await searchParams;
  const success = from === 'onboarding'
    ? '/dashboard?checkout_completed=1'
    : '/settings?tab=billing&upgraded=1';

  if (!sessionId || !sessionId.startsWith('cs_')) redirect('/settings?tab=billing');

  let status: string | null = null;
  let plan: string | undefined;
  let cadence: string | undefined;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {}, { apiVersion: ELEMENTS_API_VERSION });
    status = session.status;
    plan = session.metadata?.plan;
    cadence = session.metadata?.cadence;
  } catch {
    status = null;
  }

  if (status === 'complete') redirect(success);

  // Still open (payment needs another try) or unknown: back to checkout with a note.
  const q = new URLSearchParams({ plan: plan === 'pilot' ? 'pilot' : 'modus', cadence: cadence === 'annual' ? 'annual' : 'monthly', from: from ?? 'settings', retry: '1' });
  redirect(`/checkout?${q.toString()}`);
}
