/**
 * The $1 first month for Meta ad traffic (/start), Nov 24 to Dec 31 2026.
 *
 * Stripe holds the real discount: promotion code ONEDOLLAR on a $27-off coupon
 * that applies once, to the MODUS product only, for customers with no earlier
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
