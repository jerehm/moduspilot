'use client';

import {
  signInWithPopup,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithRedirect,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  fetchSignInMethodsForEmail,
  linkWithCredential,
} from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { AnimatedThemeToggler } from '@/components/ui/animated-theme-toggler';
import HomePricingSection from '@/components/marketing/HomePricingSection';
import type { User, OAuthCredential } from 'firebase/auth';

// Which provider a stored Firebase sign-in method maps to, for the "you already
// use this email with X" message when two providers share one email.
function providerLabel(methods: string[]): string {
  if (methods.includes('google.com')) return 'Google';
  if (methods.includes('apple.com')) return 'Apple';
  if (methods.includes('microsoft.com')) return 'Microsoft';
  if (methods.includes('emailLink') || methods.includes('password')) return 'email';
  return '';
}

function credentialFromError(kind: OAuthKind, e: unknown): OAuthCredential | null {
  return kind === 'google'
    ? GoogleAuthProvider.credentialFromError(e as never)
    : OAuthProvider.credentialFromError(e as never);
}

// A `?next=` internal path (e.g. the founding claim flow returning to
// /grandfathering) takes precedence over the default routing. Same-origin paths
// only — never an absolute or protocol-relative URL — to avoid an open redirect.
function safeNext(): string | null {
  if (typeof window === 'undefined') return null;
  const n = new URLSearchParams(window.location.search).get('next');
  // A backslash counts too: browsers read `/\evil.com` as `//evil.com`.
  return n && n.startsWith('/') && !n.startsWith('//') && !n.includes('\\') ? n : null;
}

async function getDestination(user: User): Promise<string> {
  const next = safeNext();
  if (next) return next;
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    return snap.data()?.onboardingComplete ? '/dashboard' : '/onboarding';
  } catch {
    return '/onboarding';
  }
}

const googleProvider = new GoogleAuthProvider();
const appleProvider = new OAuthProvider('apple.com');
const microsoftProvider = new OAuthProvider('microsoft.com');
const OAUTH_PROVIDERS = { google: googleProvider, apple: appleProvider, microsoft: microsoftProvider } as const;
type OAuthKind = keyof typeof OAUTH_PROVIDERS;
const EMAIL_KEY = 'modus-email-for-signin';

// MODUS Desktop 0.4.5+ exposes this. It opens sign-in in the user's real
// browser, where their passkeys, Touch ID and saved logins work (an app window
// can't reach them). Older desktop builds lack it and keep the popup buttons.
type DesktopAuthBridge = {
  signInWithBrowser: () => Promise<{ ok: boolean; error?: string }>;
  cancel: () => Promise<unknown>;
  // Desktop builds after the first browser sign-in build (same release) have these.
  status?: () => Promise<{ pending: boolean }>;
  onEnded?: (cb: (reason: string) => void) => () => void;
};
function desktopAuth(): DesktopAuthBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { modusDesktop?: { auth?: DesktopAuthBridge } }).modusDesktop?.auth;
  return b && typeof b.signInWithBrowser === 'function' ? b : null;
}

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState<OAuthKind | 'email' | null>(null);
  const [checking, setChecking] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  // When a provider collides with an existing account on the same email, we hold
  // its credential here and link it once the user signs in with the original
  // provider, so both buttons end up on one account.
  const [pendingCred, setPendingCred] = useState<OAuthCredential | null>(null);
  // Hide the "Download desktop app" button inside the desktop shell — there is
  // nothing to download there. Set after mount to avoid a hydration mismatch;
  // the desktop shell tags its user-agent with "MODUSDesktop".
  const [isDesktop, setIsDesktop] = useState(false);
  // Desktop browser sign-in: available, waiting on the browser, or the user
  // chose the old in-app buttons instead.
  const [browserAuth, setBrowserAuth] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [inApp, setInApp] = useState(false);

  useEffect(() => {
    setIsDesktop(typeof navigator !== 'undefined' && navigator.userAgent.includes('MODUSDesktop'));
    setBrowserAuth(desktopAuth() !== null);
    if (new URLSearchParams(window.location.search).get('error') === 'desktop') {
      setError('That sign in did not finish. Please try again.');
    }
    try {
      setReduced(
        document.documentElement.hasAttribute('data-reduce-motion') ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      );
    } catch { /* no matchMedia — leave animations on */ }
  }, []);

  // Complete a passwordless email-link sign-in if the user landed here from the
  // emailed link. onAuthStateChanged below then routes them onward.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isSignInWithEmailLink(auth, window.location.href)) return;
    let stored = '';
    try { stored = localStorage.getItem(EMAIL_KEY) || ''; } catch { /* storage blocked */ }
    const addr = stored || window.prompt('Confirm your email to finish signing in') || '';
    if (!addr) return;
    signInWithEmailLink(auth, addr, window.location.href)
      .then(() => { try { localStorage.removeItem(EMAIL_KEY); } catch { /* ignore */ } })
      .catch(() => setError('That sign in link is invalid or expired. Please try again.'));
  }, []);

  // Desktop: a browser sign-in may already be running (the page reloaded, or the
  // window was reopened), so pick the waiting screen back up. And reset it the
  // moment the app says that sign-in ended without signing in.
  useEffect(() => {
    const b = desktopAuth();
    if (!b) return;
    b.status?.().then((st) => { if (st.pending) setWaiting(true); }).catch(() => {});
    return b.onEnded?.((reason) => {
      setWaiting(false);
      setError(reason === 'timed-out' ? 'Sign in timed out. Please try again.' : '');
    });
  }, []);

  // If already signed in, skip straight to the app
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        router.replace(await getDestination(user));
      } else {
        setChecking(false);
      }
    });
    return unsub;
  }, [router]);

  // Release the spinner if the user backs out of the OAuth window. In Electron
  // (and some browsers) Firebase's signInWithPopup can hang without ever
  // rejecting when the popup is closed, freezing the button forever. When focus
  // returns to our window after the popup closes, give Firebase a beat to settle
  // a real sign-in; if none happened, clear loading so the user can retry.
  useEffect(() => {
    if (loading !== 'google' && loading !== 'apple' && loading !== 'microsoft') return;
    const release = () => {
      window.setTimeout(() => {
        if (!auth.currentUser) setLoading(null);
      }, 1200);
    };
    window.addEventListener('focus', release);
    return () => window.removeEventListener('focus', release);
  }, [loading]);

  async function signIn(kind: OAuthKind) {
    const provider = OAUTH_PROVIDERS[kind];
    setError(''); setLoading(kind);
    try {
      const result = await signInWithPopup(auth, provider);
      // If a previous attempt collided on this email, attach that provider now so
      // the account carries both. Failure here is harmless (already linked).
      if (pendingCred) {
        try { await linkWithCredential(result.user, pendingCred); } catch { /* already linked */ }
        setPendingCred(null);
      }
      router.push(await getDestination(result.user));
    } catch (e: unknown) {
      const err = e as { code?: string; customData?: { email?: string } };
      const code = err.code;
      if (code === 'auth/account-exists-with-different-credential') {
        // Same email already registered with another provider. Hold this
        // credential and point the user at the button that will link it.
        const cred = credentialFromError(kind, e);
        if (cred) setPendingCred(cred);
        let existing = '';
        try {
          if (err.customData?.email) {
            existing = providerLabel(await fetchSignInMethodsForEmail(auth, err.customData.email));
          }
        } catch { /* email enumeration protection hides the methods */ }
        setError(existing
          ? `You already use this email with ${existing}. Continue with ${existing} to finish signing in.`
          : 'This email already has an account. Continue with the method you first signed up with.');
      } else if (code === 'auth/popup-blocked') {
        try {
          await signInWithRedirect(auth, provider);
          return; // navigating away; leave the spinner until the redirect lands
        } catch {
          setError('Sign in failed. Please try again.');
        }
      } else if (code === 'auth/operation-not-allowed') {
        // Provider not enabled yet (e.g. Microsoft before its Azure app is set up).
        setError(`${kind === 'microsoft' ? 'Microsoft' : 'That'} sign in is not available yet. Use Google or Apple.`);
      } else if (code !== 'auth/cancelled-popup-request' && code !== 'auth/popup-closed-by-user') {
        console.error('[sign-in error]', code, e);
        setError('Sign in failed. Please try again.');
      }
      setLoading(null);
    }
  }

  async function signInWithBrowser() {
    const b = desktopAuth();
    if (!b) return;
    setError('');
    const r = await b.signInWithBrowser().catch(() => ({ ok: false }));
    if (r.ok) setWaiting(true);
    else setError('Could not open your browser. Use Sign in here instead.');
  }

  function cancelBrowser() {
    desktopAuth()?.cancel().catch(() => {});
    setWaiting(false);
  }

  async function signInEmail(e: React.FormEvent) {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) return;
    setError(''); setLoading('email');
    try {
      const next = safeNext();
      const url = `${window.location.origin}/login${next ? `?next=${encodeURIComponent(next)}` : ''}`;
      await sendSignInLinkToEmail(auth, addr, { url, handleCodeInApp: true });
      try { localStorage.setItem(EMAIL_KEY, addr); } catch { /* storage blocked */ }
      setEmailSent(true);
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === 'auth/operation-not-allowed') {
        setError('Email sign in is not available yet. Use Google or Apple.');
      } else if (code === 'auth/invalid-email') {
        setError('That email does not look right. Please check it.');
      } else {
        setError('Could not send the sign in link. Please try again.');
      }
    } finally {
      setLoading(null);
    }
  }

  if (checking) {
    return (
      <div className="fixed inset-0 bg-bg flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-brand border-t-transparent animate-spin" />
      </div>
    );
  }

  const anim = reduced
    ? {}
    : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, ease: 'easeOut' as const } };

  return (
    <>
      {/* Wordmark, top left. Links home on the web; inert in the desktop shell. */}
      <div className="fixed top-4 left-4 sm:top-6 sm:left-6 z-50">
        {isDesktop ? (
          <div className="flex items-center gap-1.5">
            <BrandLockup />
          </div>
        ) : (
          <Link href="/" className="flex items-center gap-1.5">
            <BrandLockup />
          </Link>
        )}
      </div>

      {/* Theme toggle, top right */}
      <div className="fixed top-4 right-4 z-50">
        <AnimatedThemeToggler />
      </div>

      <div className="w-full flex flex-col bg-bg">
        {/* First screen: logo, heading, card, centered */}
        <div className="min-h-screen flex items-center justify-center px-6 py-24">
          <motion.div {...anim} className="w-full max-w-sm">
            {/* Logo above the heading */}
            <div className="flex flex-col items-center text-center mb-8">
              <Image src="/logo.png" alt="Modus" width={72} height={58} className="object-contain block dark:hidden mb-5" />
              <Image src="/logo-dark.png" alt="Modus" width={72} height={58} className="object-contain hidden dark:block mb-5" />
              <h1 className="font-serif text-[2rem] leading-[1.1] font-medium text-text">
                The only AI you&apos;ll ever need.
              </h1>
              <p className="text-muted text-sm mt-3 leading-relaxed">
                Sign in to pick up where you left off.
              </p>
            </div>

            {/* Card */}
            <div className="bg-panel/90 backdrop-blur-sm border border-border rounded-2xl p-6 sm:p-7 shadow-xl shadow-black/5">
              {browserAuth && !inApp ? (
                <div className="text-center">
                  {waiting ? (
                    <>
                      <div className="w-5 h-5 mx-auto rounded-full border-2 border-brand border-t-transparent animate-spin" />
                      <p className="text-text text-sm font-medium mt-4">Finish signing in in your browser</p>
                      <p className="text-muted text-xs mt-1.5 leading-relaxed">
                        MODUS opens here as soon as you&apos;re done.
                      </p>
                      <div className="flex items-center justify-center gap-4 mt-5">
                        <button onClick={signInWithBrowser} className="text-brand text-xs hover:underline">Open browser again</button>
                        <button onClick={cancelBrowser} className="text-muted text-xs hover:text-text">Cancel</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={signInWithBrowser}
                        className="w-full flex items-center justify-center gap-2 bg-brand hover:bg-brand/90 text-white rounded-xl px-4 py-3.5 text-sm font-semibold transition-colors"
                      >
                        Sign in with your browser
                      </button>
                      <p className="text-muted text-xs mt-3 leading-relaxed">
                        Use Touch ID, passkeys and saved passwords from Safari or Chrome.
                      </p>
                      <button onClick={() => setInApp(true)} className="text-muted/80 text-xs mt-4 hover:text-text">
                        Sign in here instead
                      </button>
                    </>
                  )}
                  {error && <p className="text-red-400 text-xs text-center mt-4">{error}</p>}
                </div>
              ) : (<>
              <div className="space-y-3">
                <button
                  onClick={() => signIn('google')}
                  disabled={loading !== null}
                  className="w-full flex items-center justify-center gap-3 bg-bg/60 border border-border hover:border-brand/50 rounded-xl px-4 py-3.5 text-text text-sm font-medium transition-all hover-surface-tint disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading === 'google' ? (
                    <div className="w-4 h-4 rounded-full border-2 border-brand border-t-transparent animate-spin" />
                  ) : (
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                  )}
                  Continue with Google
                </button>

                <button
                  onClick={() => signIn('microsoft')}
                  disabled={loading !== null}
                  className="w-full flex items-center justify-center gap-3 bg-bg/60 border border-border hover:border-brand/50 rounded-xl px-4 py-3.5 text-text text-sm font-medium transition-all hover-surface-tint disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading === 'microsoft' ? (
                    <div className="w-4 h-4 rounded-full border-2 border-brand border-t-transparent animate-spin" />
                  ) : (
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 23 23">
                      <path fill="#f25022" d="M1 1h10v10H1z"/>
                      <path fill="#7fba00" d="M12 1h10v10H12z"/>
                      <path fill="#00a4ef" d="M1 12h10v10H1z"/>
                      <path fill="#ffb900" d="M12 12h10v10H12z"/>
                    </svg>
                  )}
                  Continue with Microsoft
                </button>

                <button
                  onClick={() => signIn('apple')}
                  disabled={loading !== null}
                  className="w-full flex items-center justify-center gap-3 bg-bg/60 border border-border hover:border-brand/50 rounded-xl px-4 py-3.5 text-text text-sm font-medium transition-all hover-surface-tint disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading === 'apple' ? (
                    <div className="w-4 h-4 rounded-full border-2 border-brand border-t-transparent animate-spin" />
                  ) : (
                    <svg className="w-4 h-4 fill-text shrink-0" viewBox="0 0 24 24">
                      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                    </svg>
                  )}
                  Continue with Apple
                </button>
              </div>

              {emailSent ? (
                <div className="mt-6 text-center">
                  <p className="text-text text-sm font-medium">Check your email</p>
                  <p className="text-muted text-xs mt-1.5 leading-relaxed">
                    We emailed a link to {email.trim()}. Open it to finish signing in.
                  </p>
                  <button
                    onClick={() => { setEmailSent(false); setEmail(''); }}
                    className="text-brand text-xs mt-3 hover:underline"
                  >
                    Use a different email
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 my-5">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-muted/70 text-[11px] font-medium tracking-wider">OR</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>

                  <form onSubmit={signInEmail} className="space-y-3">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email"
                      autoComplete="email"
                      disabled={loading !== null}
                      className="w-full bg-bg/60 border border-border focus:border-brand/60 rounded-xl px-4 py-3.5 text-text text-sm placeholder:text-muted/60 outline-none transition-colors disabled:opacity-60"
                    />
                    <button
                      type="submit"
                      disabled={loading !== null || !email.trim()}
                      className="w-full flex items-center justify-center gap-2 bg-brand hover:bg-brand/90 text-white rounded-xl px-4 py-3.5 text-sm font-semibold transition-colors disabled:bg-border disabled:text-muted disabled:cursor-not-allowed"
                    >
                      {loading === 'email' ? (
                        <div className="w-4 h-4 rounded-full border-2 border-white/60 border-t-transparent animate-spin" />
                      ) : 'Continue with email'}
                    </button>
                  </form>
                </>
              )}

              {error && (
                <p className="text-red-400 text-xs text-center mt-4">{error}</p>
              )}

              <p className="text-muted/60 text-[11px] text-center mt-5 leading-relaxed">
                By continuing you agree to our{' '}
                <Link href="/terms" className="underline hover:text-muted">Terms</Link> and{' '}
                <Link href="/privacy" className="underline hover:text-muted">Privacy</Link>.
              </p>
              </>)}
            </div>

            {/* Download desktop app — hidden inside the desktop shell */}
            {!isDesktop && (
              <div className="mt-5 flex justify-center">
                <Link
                  href="/download/mac"
                  className="inline-flex items-center gap-2 text-muted text-xs hover:text-text transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current" aria-hidden>
                    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                  </svg>
                  Download desktop app
                </Link>
              </div>
            )}
          </motion.div>
        </div>

        {/* Revealed on scroll, like the Claude sign-in: the actual plans. */}
        <div className="pb-8">
          <div className="text-center mb-2 pt-4">
            <h2 className="font-serif text-3xl sm:text-4xl font-medium text-text">Explore plans</h2>
          </div>
          <HomePricingSection showHeading={false} />
        </div>
      </div>
    </>
  );
}

// The "MODUS pilot" lockup, matching the marketing navbar.
function BrandLockup() {
  return (
    <>
      <Image src="/logo.png" alt="Modus" width={40} height={31} className="object-contain block dark:hidden" />
      <Image src="/logo-dark.png" alt="Modus" width={40} height={31} className="object-contain hidden dark:block" />
      <div className="flex flex-col leading-none">
        <span className="text-sm font-bold tracking-widest text-text">MODUS</span>
        <span className="text-[8px] font-semibold text-muted tracking-widest uppercase">pilot</span>
      </div>
    </>
  );
}
