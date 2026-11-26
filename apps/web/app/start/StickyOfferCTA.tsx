'use client';

import { useEffect, useState } from 'react';

/**
 * Phone-only sticky CTA for /start. Ad traffic is mostly mobile, and the page is
 * long, so the checkout stays one tap away. It shows once the hero CTA has
 * scrolled away and hides again when the final CTA comes into view (and below
 * it), so it never covers a real button or the footer.
 *
 * Not StickyTrialCTA: that one is the homepage's "Start free" pill with a fixed
 * /login link. This one carries the ad's checkout link with its UTMs.
 */
export default function StickyOfferCTA({ href, label }: { href: string; label: string }) {
  const [heroVisible, setHeroVisible] = useState(true);
  const [finalReached, setFinalReached] = useState(false);

  useEffect(() => {
    const hero = document.getElementById('hero-cta');
    const final = document.getElementById('final-cta');
    if (!hero || !final || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.target === hero) setHeroVisible(e.isIntersecting);
        // Reached = on screen, or already scrolled past it (footer zone).
        if (e.target === final) setFinalReached(e.isIntersecting || e.boundingClientRect.top < 0);
      }
    });
    io.observe(hero);
    io.observe(final);
    return () => io.disconnect();
  }, []);

  const show = !heroVisible && !finalReached;

  return (
    <div
      aria-hidden={!show}
      className={`sm:hidden fixed inset-x-4 bottom-4 z-40 transition-all duration-300 motion-reduce:transition-none ${
        show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6 pointer-events-none'
      }`}
    >
      <a
        href={href}
        tabIndex={show ? 0 : -1}
        className="flex items-center justify-center gap-2 w-full rounded-full bg-brand text-white font-semibold py-4 shadow-[0_12px_36px_-10px_rgba(109,40,217,0.7)]"
      >
        {label}
        <span aria-hidden>&rarr;</span>
      </a>
    </div>
  );
}
