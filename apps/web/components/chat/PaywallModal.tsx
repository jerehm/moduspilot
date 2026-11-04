'use client';

import { useRef, useState } from 'react';
import { auth } from '@/lib/firebase';

interface Props {
  onClose: () => void;
}

const MODUS_FEATURES = [
  'AI chat with higher usage limits',
  'Unlimited briefings',
  'Unlimited goals + habit engine',
  'Voice interface',
  'Calendar integration (read + write)',
  'Gmail / Outlook triage',
  'End-of-day reflection',
  '90-day context memory',
  'Weekly review reports',
  'Focus protection',
  'Web + iOS + Mac access',
];

const PILOT_FEATURES = [
  'Everything in MODUS',
  'Unlimited context memory',
  'Wearable sync (HealthKit, Oura, Whoop)',
  'Financial pulse (Plaid)',
  'Relationship intelligence CRM',
  'Meeting intelligence (pre + post)',
  'Travel & logistics management',
  'Document vault',
  'Cross-app execution (send, schedule)',
  'Slack + Notion + Linear',
  'Priority response SLA',
];

export default function PaywallModal({ onClose }: Props) {
  const [loading, setLoading] = useState<'modus' | 'pilot' | null>(null);
  const [error, setError] = useState('');
  const pending = useRef(false);

  const handleUpgrade = async (plan: 'modus' | 'pilot') => {
    if (pending.current) return;
    pending.current = true;
    setLoading(plan);
    setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) { setError('Please sign in to upgrade.'); return; }
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan }),
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

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-panel border border-border rounded-2xl max-w-3xl w-full p-8 relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted hover:text-text transition-colors"
          aria-label="Close"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <div className="text-center mb-6">
          <span className="text-2xl font-black tracking-widest text-brand">MODUS PILOT</span>
          <p className="text-xs text-muted mt-1 uppercase tracking-widest">Choose your plan</p>
        </div>

        <h2 className="text-xl font-bold text-text mb-1">Choose your plan</h2>
        <p className="text-muted text-sm mb-8">Start free with open models or upgrade to MODUS at $28/mo or PILOT at $59/mo. Paid plans are billed when you subscribe. Cancel anytime.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {/* MODUS tier */}
          <div className="border border-brand rounded-xl p-5 relative">
            <div className="absolute -top-2.5 left-4 bg-brand text-white text-xs font-bold px-2 py-0.5 rounded">MOST POPULAR</div>
            <div className="mb-1">
              <span className="text-lg font-black text-brand">MODUS</span>
            </div>
            <div className="mb-4">
              <span className="text-2xl font-bold text-text">$28</span>
              <span className="text-muted text-sm">/mo</span>
            </div>
            <ul className="space-y-1.5 mb-5">
              {MODUS_FEATURES.map(f => (
                <li key={f} className="flex items-start gap-2 text-xs text-text">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-brand mt-0.5 shrink-0"><polyline points="20 6 9 17 4 12"/></svg>
                  {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => handleUpgrade('modus')}
              disabled={!!loading}
              className="w-full bg-brand text-white font-bold py-3 rounded-xl hover:bg-brand/90 transition-colors text-sm disabled:opacity-50"
            >
              {loading === 'modus' ? 'Redirecting…' : 'Subscribe for $28/mo'}
            </button>
          </div>

          {/* PILOT tier */}
          <div className="border border-border rounded-xl p-5">
            <div className="mb-1">
              <span className="text-lg font-black text-text">PILOT</span>
            </div>
            <div className="mb-4">
              <span className="text-2xl font-bold text-text">$59</span>
              <span className="text-muted text-sm">/mo</span>
            </div>
            <ul className="space-y-1.5 mb-5">
              {PILOT_FEATURES.map(f => (
                <li key={f} className="flex items-start gap-2 text-xs text-text">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-muted mt-0.5 shrink-0"><polyline points="20 6 9 17 4 12"/></svg>
                  {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => handleUpgrade('pilot')}
              disabled={!!loading}
              className="w-full border border-border text-text font-bold py-3 rounded-xl hover:bg-panel transition-colors text-sm disabled:opacity-50"
            >
              {loading === 'pilot' ? 'Redirecting…' : 'Subscribe for $59/mo'}
            </button>
          </div>
        </div>

        {error && <p className="text-center text-xs text-red-400 mb-2">{error}</p>}
        <p className="text-center text-xs text-muted">Paid plans require a card · billed when you subscribe · cancel anytime · annual billing available (2 months free)</p>

        <button onClick={onClose} className="w-full text-center text-muted text-xs mt-4 hover:text-text transition-colors">
          Maybe later
        </button>
      </div>
    </div>
  );
}
