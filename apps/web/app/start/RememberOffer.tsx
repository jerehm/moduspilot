'use client';

import { useEffect } from 'react';
import { DOLLAR_OFFER } from '@/lib/offer';

/**
 * Saves the $1 code for the checkout, which applies it automatically
 * (components/checkout/PaymentForm.tsx). Sign-in and onboarding sit between
 * this page and checkout, so the code travels in localStorage, not the URL.
 */
export default function RememberOffer() {
  useEffect(() => {
    try {
      localStorage.setItem(
        DOLLAR_OFFER.storageKey,
        JSON.stringify({ code: DOLLAR_OFFER.code, exp: DOLLAR_OFFER.endsAt }),
      );
    } catch { /* storage blocked: the code is still on the page to type in */ }
  }, []);
  return null;
}
