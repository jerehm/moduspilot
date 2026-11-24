'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PaymentElement, useCheckoutElements } from '@stripe/react-stripe-js/checkout';
import type { Cadence } from '@/lib/pricing';
import { DOLLAR_OFFER } from '@/lib/offer';

/**
 * The right-hand card: Stripe's Payment Element, a promo code field and the
 * Subscribe button. Totals come from the live session, so a promo code shows
 * the real discounted amount Stripe will charge.
 */
export default function PaymentForm({
  planName,
  dueToday,
  cadence,
}: {
  planName: string;
  dueToday: number;
  cadence: Cadence;
}) {
  const result = useCheckoutElements();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [promoOpen, setPromoOpen] = useState(false);
  const [promo, setPromo] = useState('');
  const [promoError, setPromoError] = useState('');
  const [promoBusy, setPromoBusy] = useState(false);
  const autoPromoTried = useRef(false);

  // The $1 ad offer: /start saves its code (lib/offer.ts) and it is applied here
  // once, for MODUS monthly only. Stripe still decides: the code is limited to the
  // MODUS product, first-time customers and its end date, so a code that doesn't
  // fit is refused and quietly dropped, and the visitor can still type one in.
  useEffect(() => {
    if (result.type === 'loading' || result.type === 'error' || autoPromoTried.current) return;
    autoPromoTried.current = true;
    if (planName !== 'MODUS' || cadence !== 'monthly' || result.checkout.discountAmounts?.length) return;
    let saved: { code?: string; exp?: number } | null = null;
    try { saved = JSON.parse(localStorage.getItem(DOLLAR_OFFER.storageKey) || 'null'); } catch { return; }
    if (!saved?.code || !saved.exp || Date.now() > saved.exp) return;
    const code = saved.code;
    setPromoBusy(true);
    result.checkout.applyPromotionCode(code).then(r => {
      if (r.type === 'error') {
        try { localStorage.removeItem(DOLLAR_OFFER.storageKey); } catch { /* storage blocked */ }
      }
    }).catch(() => { /* leave the manual promo box as it was */ }).finally(() => setPromoBusy(false));
  }, [result, planName, cadence]);

  if (result.type === 'loading') {
    return (
      <div className="py-16 flex justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-brand border-t-transparent animate-spin" />
      </div>
    );
  }
  if (result.type === 'error') {
    return <p role="alert" className="text-sm text-red-600 dark:text-red-400 py-6">{result.error.message}</p>;
  }

  const checkout = result.checkout;
  const discount = checkout.discountAmounts?.[0] ?? null;
  const total = checkout.total.total.amount;
  const period = cadence === 'annual' ? 'year' : 'month';

  async function applyPromo() {
    if (!promo.trim() || promoBusy) return;
    setPromoBusy(true);
    setPromoError('');
    // The $1 offer is monthly only. Stripe can't tell it apart (its coupon is
    // limited by product, and annual MODUS shares that product), so refuse it here.
    if (cadence !== 'monthly' && promo.trim().toUpperCase() === DOLLAR_OFFER.code) {
      setPromoError(`${DOLLAR_OFFER.code} is for monthly billing only. Switch to monthly to use it.`);
      setPromoBusy(false);
      return;
    }
    const r = await checkout.applyPromotionCode(promo.trim());
    if (r.type === 'error') setPromoError(r.error.message);
    else setPromo('');
    setPromoBusy(false);
  }

  async function removePromo() {
    setPromoBusy(true);
    await checkout.removePromotionCode();
    setPromoBusy(false);
  }

  async function pay() {
    if (paying) return;
    setPaying(true);
    setError('');
    const r = await checkout.confirm();
    // On success Stripe redirects to /checkout/return. Only errors land here.
    if (r.type === 'error') {
      setError(r.error.message);
      setPaying(false);
    }
  }

  return (
    <div>
      <PaymentElement options={{ layout: 'tabs' }} />

      <div className="mt-5">
        {discount ? (
          <div className="flex items-center justify-between text-sm">
            <span className="text-text">
              {discount.displayName}
              {discount.promotionCode && discount.promotionCode !== discount.displayName ? <span className="text-muted"> ({discount.promotionCode})</span> : null}
            </span>
            <button onClick={removePromo} disabled={promoBusy} className="text-muted hover:text-text underline">Remove</button>
          </div>
        ) : promoOpen ? (
          <div>
            <div className="flex gap-2">
              <input
                value={promo}
                onChange={e => setPromo(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applyPromo(); }}
                placeholder="Promo code"
                aria-label="Promo code"
                className="flex-1 bg-bg/60 border border-border focus:border-brand/60 outline-none rounded-xl px-4 py-3 text-sm"
              />
              <button
                onClick={applyPromo}
                disabled={promoBusy || !promo.trim()}
                className="px-4 rounded-xl border border-border text-sm font-medium hover-surface-tint disabled:opacity-50"
              >
                Apply
              </button>
            </div>
            {promoError && <p role="alert" className="text-xs text-red-600 dark:text-red-400 mt-2">{promoError}</p>}
          </div>
        ) : (
          <button onClick={() => setPromoOpen(true)} className="text-sm text-muted hover:text-text underline">Add promo code</button>
        )}
      </div>

      <div className="mt-6 pt-5 border-t border-border space-y-2 text-sm">
        <div className="flex justify-between text-muted">
          <span>{planName}, billed {cadence === 'annual' ? 'yearly' : 'monthly'}</span>
          <span>${dueToday}</span>
        </div>
        {discount && (
          <div className="flex justify-between text-muted">
            <span>Discount</span>
            <span>&minus;{discount.amount}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold text-text text-base pt-1">
          <span>Due today</span>
          <span>{total}</span>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 mt-4">{error}</p>}

      <button
        onClick={pay}
        disabled={paying || !checkout.canConfirm}
        className="mt-5 w-full bg-brand hover:bg-brand/90 disabled:opacity-60 text-white rounded-xl py-3.5 font-semibold transition-colors"
      >
        {paying ? 'Processing...' : 'Subscribe'}
      </button>

      <p className="text-xs text-muted text-center mt-4 leading-relaxed">
        Renews every {period} until you cancel. Cancel anytime in Settings.
        By subscribing you agree to the <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.
      </p>
    </div>
  );
}
