'use client';

import { useEffect } from 'react';
import { rememberDollarOffer } from '@/lib/offer';

/**
 * Saves the $1 code for the checkout, which applies it automatically
 * (components/checkout/PaymentForm.tsx). Sign-in sits between this page and
 * checkout, so the code travels in localStorage. The /start links also carry
 * promo=ONEDOLLAR, which /login saves again, for a sign-in link opened in a
 * different browser.
 */
export default function RememberOffer() {
  useEffect(() => { rememberDollarOffer(); }, []);
  return null;
}
