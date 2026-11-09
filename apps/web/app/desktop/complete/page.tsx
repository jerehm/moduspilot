'use client';

import { signInWithCustomToken } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { auth, db } from '@/lib/firebase';

// Runs INSIDE MODUS Desktop. The app loads it after the browser hands back a
// one-time code (and after the app checked the link's state is one IT started).
// Trades the code for a session. Flow: lib/desktop-auth.ts.
export default function DesktopCompletePage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // the code works once; never send it twice
    ran.current = true;
    const code = new URLSearchParams(window.location.search).get('code') ?? '';
    // Out of the address bar and history before anything else.
    window.history.replaceState(null, '', '/desktop/complete');
    (async () => {
      try {
        const res = await fetch('/api/desktop/auth-exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
        if (!res.ok || !body.token) throw new Error(body.error || 'Sign in failed. Please try again.');
        const { user } = await signInWithCustomToken(auth, body.token);
        let dest = '/onboarding';
        try {
          const snap = await getDoc(doc(db, 'users', user.uid));
          if (snap.data()?.onboardingComplete) dest = '/dashboard';
        } catch { /* default to onboarding */ }
        router.replace(dest);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Sign in failed. Please try again.');
      }
    })();
  }, [router]);

  if (!error) {
    return <div className="flex justify-center"><div className="w-6 h-6 rounded-full border-2 border-brand border-t-transparent animate-spin" /></div>;
  }
  return (
    <div className="text-center">
      <p className="text-text text-sm">{error}</p>
      <Link href="/login" className="inline-block text-brand text-sm mt-4 hover:underline">Back to sign in</Link>
    </div>
  );
}
