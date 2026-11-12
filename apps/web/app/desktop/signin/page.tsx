'use client';

import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { auth } from '@/lib/firebase';

// Runs in the user's BROWSER (Safari, Chrome), opened by MODUS Desktop. The
// browser has the person's passkeys, Touch ID and saved logins, which the app
// window can't use. Once they're signed in here, this page hands a one-time
// code to the app on its own: the app polls for it, and the modusdesktop://
// link below is only a shortcut that brings the app forward. Flow:
// lib/desktop-auth.ts.

const STATE_RE = /^[A-Za-z0-9_-]{43}$/;
type Phase = 'checking' | 'no-state' | 'confirm' | 'handing-off' | 'done' | 'error';
// Set when we send the user to /login, so on return we know they JUST signed in
// and can hand off without asking. An old session gets a Continue as X choice.
const FRESH_KEY = 'modus-desktop-signin-fresh';

export default function DesktopSignInPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('checking');
  const [user, setUser] = useState<User | null>(null);
  const [link, setLink] = useState('');
  const stateRef = useRef('');
  const sent = useRef<string | null>(null); // uid already handed off, so a re-render never sends twice

  const toLogin = () => {
    try { sessionStorage.setItem(FRESH_KEY, stateRef.current); } catch { /* storage blocked: they'll get one Continue click */ }
    router.replace(`/login?next=${encodeURIComponent(`/desktop/signin?state=${stateRef.current}`)}`);
  };

  const handOff = useCallback(async (u: User) => {
    const state = stateRef.current;
    setPhase('handing-off');
    try {
      const idToken = await u.getIdToken();
      const res = await fetch('/api/desktop/auth-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ state }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { code } = (await res.json()) as { code: string };
      const url = `modusdesktop://auth?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
      setLink(url);
      setPhase('done');
      // Shortcut only. If the browser blocks or asks, the app still gets the
      // code by polling within a couple of seconds.
      window.location.href = url;
    } catch {
      sent.current = null;
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('state') ?? '';
    if (!STATE_RE.test(s)) { setPhase('no-state'); return; }
    stateRef.current = s;
    return onAuthStateChanged(auth, (u) => {
      if (!u) {
        // Normal login page, with every provider. It comes back here after.
        toLogin();
        return;
      }
      setUser(u);
      if (sent.current === u.uid) return;
      let fresh = false;
      try { fresh = sessionStorage.getItem(FRESH_KEY) === s; sessionStorage.removeItem(FRESH_KEY); } catch { /* ignore */ }
      if (fresh) { sent.current = u.uid; void handOff(u); }
      else setPhase('confirm');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, handOff]);

  async function switchAccount() {
    sent.current = null;
    await signOut(auth); // the auth listener sends us to /login with the same state
  }

  function confirm() {
    if (!user) return;
    sent.current = user.uid;
    void handOff(user);
  }

  const spinner = <div className="w-6 h-6 mx-auto rounded-full border-2 border-brand border-t-transparent animate-spin" />;

  return (
    <div className="text-center">
      <Image src="/logo.png" alt="Modus" width={56} height={45} className="object-contain block dark:hidden mx-auto mb-5" />
      <Image src="/logo-dark.png" alt="Modus" width={56} height={45} className="object-contain hidden dark:block mx-auto mb-5" />

      {phase === 'checking' || phase === 'handing-off' ? spinner : null}

      {phase === 'no-state' && (
        <>
          <h1 className="font-serif text-2xl font-medium text-text">Start from MODUS Desktop</h1>
          <p className="text-muted text-sm mt-3 leading-relaxed">
            This page signs in the desktop app. Open MODUS Desktop and click Sign in with your browser.
          </p>
        </>
      )}

      {phase === 'confirm' && (
        <>
          <h1 className="font-serif text-2xl font-medium text-text">Sign in to MODUS Desktop</h1>
          <button
            onClick={confirm}
            className="w-full mt-6 bg-brand hover:bg-brand/90 text-white rounded-xl px-4 py-3.5 text-sm font-semibold transition-colors"
          >
            Continue as {user?.email}
          </button>
          <button onClick={switchAccount} className="text-muted text-xs mt-4 hover:text-text">
            Use a different account
          </button>
        </>
      )}

      {phase === 'done' && (
        <>
          <h1 className="font-serif text-2xl font-medium text-text">You&apos;re signed in</h1>
          <p className="text-muted text-sm mt-3 leading-relaxed">
            MODUS Desktop is signing in as {user?.email}. If it didn&apos;t open, click Open MODUS Desktop below.
          </p>
          <a href={link} className="inline-block text-brand text-sm mt-5 hover:underline">Open MODUS Desktop</a>
        </>
      )}

      {phase === 'error' && (
        <>
          <h1 className="font-serif text-2xl font-medium text-text">Could not reach MODUS</h1>
          <p className="text-muted text-sm mt-3 leading-relaxed">Check your connection and try again.</p>
          <button
            onClick={() => user && (sent.current = user.uid, handOff(user))}
            className="w-full mt-6 bg-brand hover:bg-brand/90 text-white rounded-xl px-4 py-3.5 text-sm font-semibold transition-colors"
          >
            Try again
          </button>
        </>
      )}
    </div>
  );
}
