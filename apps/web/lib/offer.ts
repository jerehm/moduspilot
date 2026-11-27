/**
 * The $1 first month for Meta ad traffic (/start), Nov 24 to Dec 31 2026.
 *
 * Stripe holds the real discount: promotion code ONEDOLLAR on a $27-off coupon
 * that applies once, to the MODUS monthly product only (annual MODUS is a
 * separate product, so the code can't touch it), for customers with no earlier
 * payment, and expires at ENDS_AT below. The page and the code end at the same
 * moment, so /start stops showing the offer by itself and nothing still says
 * "ends Dec 31" in January. To extend or end it, change Stripe first, then this.
 */
export const DOLLAR_OFFER = {
  code: 'ONEDOLLAR',
  firstMonth: 1,
  /** Dec 31 2026, 11:59:59 pm Pacific (PST, UTC-8). */
  endsAt: Date.UTC(2027, 0, 1, 7, 59, 59, 999),
  endsLabel: 'Dec 31',
  /** localStorage key /start writes and the checkout reads to apply the code. */
  storageKey: 'modus-promo',
} as const;

export function dollarOfferActive(now: number = Date.now()): boolean {
  return now <= DOLLAR_OFFER.endsAt;
}

/** True when `code` is the live $1 offer code (case-insensitive) and the offer is still running. */
export function isLiveDollarCode(code: string | null | undefined, now: number = Date.now()): boolean {
  return !!code && code.trim().toUpperCase() === DOLLAR_OFFER.code && dollarOfferActive(now);
}

/**
 * Browser only. Saves the $1 code where checkout looks for it. Used by /start
 * (RememberOffer) and by /login when the link carries promo=ONEDOLLAR, so the
 * offer survives the email sign-in link opening in another browser.
 */
export function rememberDollarOffer(): void {
  try {
    localStorage.setItem(DOLLAR_OFFER.storageKey, JSON.stringify({ code: DOLLAR_OFFER.code, exp: DOLLAR_OFFER.endsAt }));
  } catch { /* storage blocked: the code can still be typed at checkout */ }
}

/** Browser only. True when the $1 code is saved and not past its end. */
export function hasSavedDollarOffer(now: number = Date.now()): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(DOLLAR_OFFER.storageKey) || 'null') as { code?: string; exp?: number } | null;
    return !!saved?.code && !!saved.exp && now <= saved.exp && isLiveDollarCode(saved.code, now);
  } catch { return false; }
}

/**
 * The Meta ad path: /start sends people to /login with plan=modus,
 * cadence=monthly and utm_source=meta. A new account on this path skips the
 * pre-payment onboarding and goes straight to checkout (see app/(auth)/login).
 */
export function isMetaAdPath(q: URLSearchParams): boolean {
  return q.get('plan') === 'modus' && q.get('cadence') === 'monthly' && q.get('utm_source') === 'meta';
}
