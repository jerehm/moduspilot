'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import Navbar from '@/components/marketing/Navbar';
import { MarketingBackground } from '@/components/marketing/MarketingBackground';
import { AppleLogo } from '@/components/marketing/BrandLogos';

// Version-less filenames (artifactName in apps/desktop/electron-builder.yml), so
// these URLs keep resolving to the newest build without a code change here.
const BASE = 'https://github.com/jerehm/moduspilot/releases/latest/download';
const BUILDS = {
  arm64: { url: `${BASE}/MODUS-Desktop-arm64.dmg`, label: 'Apple Silicon', sub: 'M1, M2, M3, M4' },
  x64:   { url: `${BASE}/MODUS-Desktop-x64.dmg`,   label: 'Intel',         sub: '2020 or earlier' },
} as const;

type Arch = keyof typeof BUILDS;

// Best-effort chip detection from the GPU renderer string. Apple Silicon reports
// an "Apple" GPU; Intel Macs report Intel/AMD/Radeon. Unknown → we don't guess,
// we let the person choose rather than auto-download a build that won't launch.
function detectArch(): Arch | 'unknown' {
  try {
    const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null;
    if (!gl) return 'unknown';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    if (/apple/i.test(renderer)) return 'arm64';
    if (/intel|amd|radeon|nvidia/i.test(renderer)) return 'x64';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

const STEPS = [
  { n: '1', title: 'Open the .dmg', body: 'Find the Modus Desktop .dmg in your Downloads and double-click it.' },
  { n: '2', title: 'Drag Modus to Applications', body: 'A window opens with the Modus icon and an Applications folder. Drag one onto the other.' },
  { n: '3', title: 'Open Modus and sign in', body: 'Use the same account as the web app. Everything syncs across both.' },
];

export default function DownloadMacPage() {
  const [arch, setArch] = useState<Arch | 'unknown'>('unknown');
  const [dark, setDark] = useState(false);
  const [started, setStarted] = useState<Arch | null>(null);
  const fired = useRef(false);

  const download = (a: Arch) => {
    window.location.href = BUILDS[a].url;
    setStarted(a);
  };

  // Detect the chip so we can mark the right build "Recommended" — but NEVER
  // auto-download. The user starts the download by clicking a build.
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    setArch(detectArch());
  }, []);

  const recommended: Arch | null = arch === 'unknown' ? null : arch;

  return (
    <main className={`marketing ${dark ? 'marketing-dark-tokens' : 'marketing-light-tokens'} bg-bg text-text min-h-screen overflow-x-hidden relative`}>
      <MarketingBackground />
      <Navbar marketingTheme={dark ? 'dark' : 'light'} onToggleTheme={() => setDark(d => !d)} />

      <div className="relative pt-36 pb-24 px-6" style={{ zIndex: 2 }}>
        <div className="max-w-2xl mx-auto">

          <div className="mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-text/[0.04] mb-6">
              <AppleLogo className="w-3.5 h-3.5 text-text" />
              <span className="text-[11px] font-semibold tracking-widest text-muted uppercase">Mac App</span>
            </div>

            <h1 className="font-grotesk font-bold text-4xl md:text-5xl text-text tracking-[-0.02em] leading-[1.05] mb-4">
              Download Modus for Mac
            </h1>

            <p className="text-muted text-lg leading-relaxed max-w-md">
              {started
                ? 'Your download has started. Check your Downloads folder.'
                : 'Pick the build that matches your Mac and it downloads right away.'}
            </p>
          </div>

          {/* ── Chip picker — a click starts the download (no auto-download) ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
            {(Object.keys(BUILDS) as Arch[]).map((a) => {
              const isRec = recommended === a;
              return (
                <button
                  key={a}
                  onClick={() => download(a)}
                  className={`relative flex items-center justify-between gap-3 px-5 py-4 rounded-xl border text-left transition-all ${
                    isRec
                      ? 'border-text/40 bg-panel'
                      : 'bg-panel border-border hover:border-text/30 text-text'
                  }`}
                >
                  <span>
                    <span className="block text-sm font-semibold text-text">{BUILDS[a].label}</span>
                    <span className="block text-[11px] text-muted">{BUILDS[a].sub}</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-text shrink-0">
                    {isRec && <span className="text-[9px] font-semibold uppercase tracking-widest text-muted">Recommended</span>}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" /></svg>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted mt-4 max-w-lg">
            Not sure? <span className="text-text">Apple menu → About This Mac</span> shows your chip. Most Macs from 2020 on are Apple Silicon.
          </p>
          <div className="mb-12" />

          {/* Decorative divider */}
          <motion.div
            initial={false}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ duration: 0.8, delay: 0.45 }}
            className="flex items-center justify-center py-8"
          >
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent max-w-md" />
            <div className="mx-4 w-2 h-2 rounded-full bg-text/30" />
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent max-w-md" />
          </motion.div>

          {/* ── Install steps ────────────────────────────────────────── */}
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

          {/* ── Reassurance ──────────────────────────────────────────── */}
          <motion.div
            initial={false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted mb-10"
          >
            {['Signed & notarized by Apple', 'Updates itself automatically', 'Intel & Apple Silicon'].map(t => (
              <span key={t} className="flex items-center gap-1.5">
                <span className="text-text">◆</span>
                {t}
              </span>
            ))}
          </motion.div>

          <motion.p
            initial={false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.7 }}
            className="text-center text-sm text-muted"
          >
            On Windows?{' '}
            <Link href="/download/windows" className="text-text font-semibold hover:underline">
              Download for Windows →
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
