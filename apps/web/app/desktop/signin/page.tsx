'use client';

import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';

// Runs in the user's BROWSER (Safari, Chrome), opened by MODUS Desktop. The
// browser has the person's passkeys, Touch ID and saved logins, which the app
// window can't use. Once they're signed in here, this page hands a one-time
// code back to the app. Flow and threat notes: lib/desktop-auth.ts.

const STATE_RE = /^[A-Za-z0-9_-]{43}$/;

export default function DesktopSignInPage() {
  const router = useRouter();
  const [state, setState] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('state') ?? '';
    setState(STATE_RE.test(s) ? s : '');
  }, []);

  useEffect(() => {
    if (state === null) return;
    if (!state) { setChecking(false); return; }
    return onAuthStateChanged(auth, (u) => {
      if (!u) {
        // Normal login page, with every provider. It comes back here after.
        router.replace(`/login?next=${encodeURIComponent(`/desktop/signin?state=${state}`)}`);
        return;
      }
      setUser(u);
      setChecking(false);
    });
  }, [state, router]);

  async function handOff() {
    if (!user || !state) return;
    setBusy(true); setError('');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/desktop/auth-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ state }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { code } = (await res.json()) as { code: string };
      const url = `modusdesktop://auth?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
      setLink(url);
      window.location.href = url;
    } catch {
      setError('Could not reach MODUS. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function switchAccount() {
    await signOut(auth);
    router.replace(`/login?next=${encodeURIComponent(`/desktop/signin?state=${state}`)}`);
  }

  if (checking) {
    return <div className="flex justify-center"><div className="w-6 h-6 rounded-full border-2 border-brand border-t-transparent animate-spin" /></div>;
  }

  return (
    <div className="text-center">
      <Image src="/logo.png" alt="Modus" width={56} height={45} className="object-contain block dark:hidden mx-auto mb-5" />
      <Image src="/logo-dark.png" alt="Modus" width={56} height={45} className="object-contain hidden dark:block mx-auto mb-5" />

      {!state ? (
        <>
          <h1 className="font-serif text-2xl font-medium text-text">Start from MODUS Desktop</h1>
          <p className="text-muted text-sm mt-3 leading-relaxed">
            This page signs in the desktop app. Open MODUS Desktop and click Sign in with your browser.
          </p>
        </>
      ) : link ? (
        <>
          <h1 className="font-serif text-2xl font-medium text-text">You&apos;re signed in</h1>
          <p className="text-muted text-sm mt-3 leading-relaxed">
            Go back to MODUS Desktop. You can close this tab.
          </p>
          <a href={link} className="inline-block text-brand text-sm mt-5 hover:underline">
            Open MODUS Desktop
          </a>
        </>
      ) : (
        <>
          <h1 className="font-serif text-2xl font-medium text-text">Sign in to MODUS Desktop</h1>
          <p className="text-muted text-sm mt-3 leading-relaxed">Signed in as {user?.email}</p>
          <button
            onClick={handOff}
            disabled={busy}
            className="w-full mt-6 flex items-center justify-center bg-brand hover:bg-brand/90 text-white rounded-xl px-4 py-3.5 text-sm font-semibold transition-colors disabled:opacity-60"
          >
            {busy ? <div className="w-4 h-4 rounded-full border-2 border-white/60 border-t-transparent animate-spin" /> : 'Continue to MODUS Desktop'}
          </button>
          <button onClick={switchAccount} className="text-muted text-xs mt-4 hover:text-text">
            Use a different account
          </button>
          {error && <p className="text-red-400 text-xs mt-4">{error}</p>}
        </>
      )}
    </div>
  );
}
