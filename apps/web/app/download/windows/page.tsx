'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import Navbar from '@/components/marketing/Navbar';
import { MarketingBackground } from '@/components/marketing/MarketingBackground';
import { WindowsLogo } from '@/components/marketing/BrandLogos';

// Version-less filename (artifactName in apps/desktop/electron-builder.yml) so
// this URL keeps resolving to the newest build. Produced by the windows-latest
// GitHub Actions job — Windows installers can't be built on macOS.
const EXE_URL = 'https://github.com/jerehm/moduspilot/releases/latest/download/MODUS-Desktop-x64.exe';

const STEPS = [
  { n: '1', title: 'Run the installer', body: 'Open MODUS-Desktop-x64.exe from your Downloads.' },
  { n: '2', title: 'Pass the SmartScreen notice', body: 'Windows may say "Windows protected your PC" because the app isn’t signed yet. Click More info, then Run anyway, it’s the same file, just without a paid certificate.' },
  { n: '3', title: 'Open Modus and sign in', body: 'Use the same account as the web app. Everything syncs across both.' },
];

export default function DownloadWindowsPage() {
  const [started, setStarted] = useState(false);
  const [dark, setDark] = useState(false);
  const fired = useRef(false);

  const download = () => {
    window.location.href = EXE_URL;
    setStarted(true);
  };

  return (
    <main className={`marketing ${dark ? 'marketing-dark-tokens' : 'marketing-light-tokens'} bg-bg text-text min-h-screen overflow-x-hidden relative`}>
      <MarketingBackground />
      <Navbar marketingTheme={dark ? 'dark' : 'light'} onToggleTheme={() => setDark(d => !d)} />

      <div className="relative pt-36 pb-24 px-6" style={{ zIndex: 2 }}>
        <div className="max-w-2xl mx-auto">

          <div className="mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-text/[0.04] mb-6">
              <WindowsLogo className="w-3.5 h-3.5 text-text" />
              <span className="text-[11px] font-semibold tracking-widest text-muted uppercase">Windows App · Beta</span>
            </div>

            <h1 className="font-grotesk font-bold text-4xl md:text-5xl text-text tracking-[-0.02em] leading-[1.05] mb-4">
              Download Modus for Windows
            </h1>

            <p className="text-muted text-lg leading-relaxed max-w-md mb-6">
              {started
                ? 'Your download has started. Check your Downloads folder.'
                : 'A 64-bit installer for Windows 10 and 11.'}
            </p>

            <button onClick={download} className="btn-ink px-7 py-3.5 text-base">
              Download for Windows
            </button>
            <p className="text-xs text-muted mt-3">MODUS-Desktop-x64.exe · Windows 10 &amp; 11 · 64-bit</p>
          </div>

          {/* ── SmartScreen heads-up (honest, not hidden) ─────────────── */}
          <motion.div
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-5 py-4 mb-8"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} className="w-5 h-5 shrink-0 text-amber-400 mt-0.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-text mb-1">Windows may warn you on first run</p>
              <p className="text-sm text-muted leading-relaxed">
                This build isn&rsquo;t code-signed yet, so SmartScreen shows &ldquo;Windows protected your PC.&rdquo; That&rsquo;s expected, click <span className="text-text font-medium">More info</span> then <span className="text-text font-medium">Run anyway</span>. A signed release is on the way.
              </p>
            </div>
          </motion.div>

          {/* Divider */}
          <motion.div
            initial={false}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ duration: 0.8, delay: 0.45 }}
            className="flex items-center justify-center py-6"
          >
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent max-w-md" />
            <div className="mx-4 w-2 h-2 rounded-full bg-text/30" />
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent max-w-md" />
          </motion.div>

          {/* Install steps */}
          <motion.div
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="bg-panel/60 backdrop-blur-xl border border-border/70 rounded-3xl p-8 mb-8 shadow-xl shadow-black/5"
          >
            <p className="text-xs font-bold tracking-widest text-muted uppercase mb-8 text-center">Installing</p>
            <div className="space-y-6">
              {STEPS.map(s => (
                <div key={s.n} className="flex items-start gap-4">
                  <span className="shrink-0 w-8 h-8 rounded-full bg-text/[0.06] border border-text/20 text-text text-sm font-bold flex items-center justify-center">
                    {s.n}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-text mb-1">{s.title}</p>
                    <p className="text-sm text-muted leading-relaxed">{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.p
            initial={false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.7 }}
            className="text-center text-sm text-muted"
          >
            On a Mac?{' '}
            <Link href="/download/mac" className="text-text font-semibold hover:underline">
              Download for Mac →
            </Link>
            {'  ·  '}
            <Link href="https://app.moduspilot.com" className="text-text font-semibold hover:underline">
              Use the web app
            </Link>
          </motion.p>

        </div>
      </div>
    </main>
  );
}
