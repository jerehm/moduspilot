// Our own checkout page (/checkout) renders Stripe's Payment Element inside the
// MODUS UI instead of redirecting to checkout.stripe.com. That needs a Checkout
// Session created with ui_mode 'elements', which only exists from this API
// version. It is applied PER REQUEST (create, list, retrieve of those sessions);
// everything else, including webhook parsing, stays on the version pinned in
// lib/stripe.ts.
export const ELEMENTS_API_VERSION = '2026-03-25.dahlia';
