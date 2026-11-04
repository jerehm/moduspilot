'use client';

import { useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { LIMIT_ADDON } from '@/lib/pricing';

const PLANS: Array<{
  key: 'free' | 'modus' | 'pilot' | 'group';
  label: string;
  price: string;
  period: string;
  features: string[];
  popular?: boolean;
}> = [
  {
    key: 'modus',
    label: 'MODUS',
    price: '$28',
    period: '/mo',
    features: [
      'Higher chat limits',
      'Full chat history',
      'Priority AI responses',
      'Daily briefings',
      'Vector memory',
    ],
    popular: true,
  },
  {
    key: 'pilot',
    label: 'PILOT',
    price: '$59',
    period: '/mo',
    features: [
      'Everything in MODUS',
      'Wearables integration',
      'CRM sync',
      'Financial intelligence',
      'Dedicated onboarding',
    ],
  },
];

// Price order — decides whether a target plan is an upgrade or a downgrade.
//
// 🪤 'group' STAYS HERE even though the Group card is gone. Multi-seat moved to a
// future Enterprise section, but accounts created before that still carry
// plan:'group' in Firestore. Drop the key and RANK['group'] is undefined, which
// makes `undefined > RANK[p.key]` false for every comparison below — so a group
// user would see MODUS and PILOT both labelled a downgrade.
const RANK: Record<'free' | 'modus' | 'pilot' | 'group', number> = { free: 0, modus: 1, pilot: 2, group: 3 };

interface Props {
  plan: 'free' | 'modus' | 'pilot' | 'group';
  /** Purchased limits add-ons. 0 when they hold none. */
  limitAddonQty?: number;
}

async function getToken() {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

export default function BillingSettings({ plan, limitAddonQty = 0 }: Props) {
  const searchParams = useSearchParams();
  const upgraded = searchParams.get('upgraded') === '1';
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const pending = useRef(false);
  // Plan awaiting confirmation (existing subscribers only — new customers get
  // Stripe's own hosted confirm/pay page, so no extra step needed there).
  // Group is no longer a purchasable target — only the two live plans are.
  // `plan` (the prop) still accepts 'group' because existing accounts carry it.
  const [confirmPlan, setConfirmPlan] = useState<'modus' | 'pilot' | null>(null);

  const handleChangePlan = async (targetPlan: 'modus' | 'pilot') => {
    if (pending.current) return;
    pending.current = true;
    setLoading(targetPlan);
    setError('');
    try {
      const token = await getToken();
      if (!token) { setError('Please sign in first.'); return; }

      // New customers pay through Checkout. Existing
      // subscribers reprice their current subscription in place — no second
      // trial, no duplicate subscription, prorated immediately.
      const isNewCustomer = plan === 'free';
      const endpoint = isNewCustomer ? '/api/stripe/checkout' : '/api/stripe/change-plan';

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: targetPlan }),
      });

      const data = await res.json();
      if (!res.ok) { setConfirmPlan(null); setError(data.error ?? 'Something went wrong.'); return; }

      if (isNewCustomer) {
        window.location.href = data.url; // redirect to Stripe Checkout
      } else {
        // Repriced in place — reload so the new plan + success banner show.
        window.location.href = '/settings?tab=billing&upgraded=1';
      }
    } catch {
      setConfirmPlan(null);
      setError('Failed to change plan. Try again.');
    } finally {
      pending.current = false;
      setLoading(null);
    }
  };

  // Buying extra limits always goes through Checkout, never change-plan: it is a
  // SECOND subscription stacked on the plan, not a repricing of it. Each purchase adds the requested quantity to the existing total.
  const handleBuyAddon = async () => {
    if (pending.current) return;
    pending.current = true;
    setLoading('addon');
    setError('');
    try {
      const token = await getToken();
      if (!token) { setError('Please sign in first.'); return; }

      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: 'limitAddon', quantity: 1 }),
      });

      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Something went wrong.'); return; }
      window.location.href = data.url;
    } catch {
      setError('Failed to start checkout. Try again.');
    } finally {
      pending.current = false;
      setLoading(null);
    }
  };

  const handleManage = async () => {
    if (pending.current) return;
    pending.current = true;
    setLoading('portal');
    setError('');
    try {
      const token = await getToken();
      if (!token) { setError('Please sign in.'); return; }

      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });

      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Something went wrong.'); return; }
      window.location.href = data.url;
    } catch {
      setError('Failed to open portal. Try again.');
    } finally {
      pending.current = false;
      setLoading(null);
    }
  };

  return (
    <div id="paid-plans" className="space-y-8 scroll-mt-6">
      <div>
        <h2 className="text-lg font-semibold text-text mb-1">Billing</h2>
        <p className="text-sm text-muted">Manage your subscription and payment details.</p>
      </div>

      {/* Success banner */}
      {upgraded && plan !== 'free' && (
        <div className="surface-tint border border-tint rounded-xl px-5 py-4 flex items-center gap-3">
          <span className="text-brand text-lg">◆</span>
          <div>
            <p className="text-sm font-semibold text-text">You&apos;re on {plan.toUpperCase()} welcome.</p>
            <p className="text-xs text-muted">Your plan is active. Your usage limits have been updated.</p>
          </div>
        </div>
      )}

      {/* Current plan */}
      <div className="bg-panel border border-border rounded-xl p-6 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted font-medium uppercase tracking-wider mb-1">Current Plan</p>
          <p className="text-2xl font-black tracking-wide text-brand">{plan.toUpperCase()}</p>
          {plan === 'free' && <p className="text-xs text-muted mt-1">Open models with a five-hour allowance and a weekly cap. No card required.</p>}
          {plan === 'modus' && <p className="text-xs text-muted mt-1">See Manage for your billing amount and renewal date.</p>}
          {plan === 'pilot' && <p className="text-xs text-muted mt-1">See Manage for your billing amount and renewal date.</p>}
          {plan === 'group' && <p className="text-xs text-muted mt-1">$79/mo, up to 5 members.</p>}
        </div>
        {plan !== 'free' && (
          <button
            onClick={handleManage}
            disabled={!!loading}
            className="px-4 py-2 border border-border text-muted text-sm rounded-lg hover:text-text hover-border-tint transition-colors disabled:opacity-50"
          >
            {loading === 'portal' ? 'Opening…' : 'Manage'}
          </button>
        )}
      </div>

      {/* Plan cards — two of them since Group left, so the grid caps at 2.
          It was lg:grid-cols-4 back when free/MODUS/PILOT/Group all rendered. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {PLANS.map(p => {
          const isCurrent = p.key === plan;
          const isUpgrade = RANK[p.key] > RANK[plan];
          return (
            <div
              key={p.key}
              className={`relative bg-panel border rounded-xl p-5 flex flex-col gap-4 ${
                isCurrent ? 'border-brand' : p.popular ? 'border-tint' : 'border-border'
              }`}
            >
              {p.popular && !isCurrent && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] bg-brand text-white font-semibold px-2.5 py-0.5 rounded-full">Most Popular</span>
              )}
              {isCurrent && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] bg-brand text-white font-semibold px-2.5 py-0.5 rounded-full">Current</span>
              )}
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">{p.label}</p>
                <p className="text-2xl font-bold text-text">{p.price}<span className="text-sm font-normal text-muted">{p.period}</span></p>
              </div>
              <ul className="space-y-1.5 flex-1">
                {p.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-xs text-muted">
                    <span className="text-brand mt-0.5">◆</span>
                    {f}
                  </li>
                ))}
              </ul>
              {!isCurrent && (
                <button
                  onClick={() => plan === 'free'
                    ? handleChangePlan(p.key as 'modus' | 'pilot')
                    : setConfirmPlan(p.key as 'modus' | 'pilot')}
                  disabled={!!loading}
                  className={`w-full py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                    isUpgrade
                      ? 'bg-brand text-white hover:bg-brand/90'
                      : 'border border-border text-muted hover:text-text'
                  }`}
                >
                  {loading === p.key ? 'Working…' : isUpgrade ? 'Upgrade' : 'Downgrade'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Extra limits — an add-on, never a third plan. Only offered to people who
          already pay, because the API rejects it otherwise (code: needs_plan). */}
      {plan !== 'free' && (
        <div className="bg-panel border border-border rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-text">Extra limits</h3>
              {limitAddonQty > 0 && (
                <span className="text-[10px] font-bold uppercase tracking-wider surface-tint-strong text-brand px-2 py-0.5 rounded-full">
                  {limitAddonQty}× active
                </span>
              )}
            </div>
            <p className="text-xs text-muted leading-relaxed max-w-md">
              Each pack adds 500,000 credits per five-hour window and 3,500,000 per week for ${LIMIT_ADDON.monthlyPrice}/mo. Packs stack and can be canceled in the billing portal.
            </p>
          </div>
          <button
            onClick={handleBuyAddon}
            disabled={!!loading}
            className="shrink-0 px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand/90 transition-colors disabled:opacity-50"
          >
            {loading === 'addon' ? 'Working…' : limitAddonQty > 0 ? 'Add another' : `Add for $${LIMIT_ADDON.monthlyPrice}/mo`}
          </button>
        </div>
      )}

      {/* Payment + invoices — managed via Stripe portal */}
      <div className="bg-panel border border-border rounded-xl p-6 space-y-3">
        <h3 className="text-sm font-semibold text-text">Payment Method & Invoices</h3>
        <p className="text-xs text-muted">Manage cards, view invoices, and download receipts in the Stripe billing portal.</p>
        {plan !== 'free' && (
          <button
            onClick={handleManage}
            disabled={!!loading}
            className="text-xs text-brand hover:underline disabled:opacity-50"
          >
            Open billing portal →
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Confirm a plan change before we charge / reprice the subscription. */}
      {confirmPlan && (() => {
        const target = PLANS.find(p => p.key === confirmPlan)!;
        const isUp = RANK[confirmPlan] > RANK[plan];
        const busy = loading === confirmPlan;
        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-panel border border-border rounded-2xl max-w-md w-full p-6 space-y-4">
              <div>
                <h3 className="text-base font-semibold text-text">
                  {isUp ? 'Upgrade' : 'Downgrade'} to {target.label}?
                </h3>
                <p className="text-sm text-muted mt-2">
                  {isUp ? (
                    <>Your plan switches to <span className="text-text font-medium">{target.label}</span> right now. Upgrades are prorated, you&apos;ll be charged the difference for the rest of this billing period (existing trials keep their original schedule), then renewal follows your existing billing cadence.</>
                  ) : (
                    <>Your plan switches to <span className="text-text font-medium">{target.label}</span> right now, keeping your existing billing cadence. Any unused credit is applied to your next invoice.</>
                  )}
                </p>
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setConfirmPlan(null)}
                  disabled={busy}
                  className="px-4 py-2 text-sm text-muted hover:text-text transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleChangePlan(confirmPlan)}
                  disabled={busy}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-brand text-white hover:bg-brand/90 transition-colors disabled:opacity-50"
                >
                  {busy ? 'Working…' : isUp ? `Confirm upgrade` : `Confirm downgrade`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
