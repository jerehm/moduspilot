'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { auth } from '@/lib/firebase';

interface ImagePayload {
  prompt?: string;
  size?: string;
}

// Renders MODUS-generated images. MODUS emits a ```image {"prompt":"..."}```
// block; this card auto-generates once via /api/generate/image and shows the
// result with download + regenerate.
//
// Re-firing generate() on every mount is intentional and is NOT a re-bill: the
// route caches by (uid, size, prompt) and serves the stored Storage URL back,
// free and without touching the daily cap. Regenerate sends force:true to skip
// that cache, which is the one path that costs. The exception is a failed
// Storage upload — the route then returns an uncacheable inline data URL, and
// that image really does regenerate on reload.
export default function ImageCard({ raw }: { raw: string }) {
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState('');
  const startedRef = useRef(false);

  let data: ImagePayload;
  try { data = JSON.parse(raw); } catch { data = { prompt: raw }; }
  // `null` or a non-object parses fine and then crashed on data.prompt.
  if (!data || typeof data !== 'object') data = { prompt: typeof data === 'string' ? data : '' };
  const prompt = String(data.prompt ?? '').trim();

  async function generate(force = false) {
    setStatus('loading');
    setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/generate/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ prompt, size: data.size, force }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const code = body.error as string | undefined;
        setError(
          code === 'image_limit_reached' ? "You've hit today's image limit. Resets tomorrow."
          : code === 'subscription_required' ? 'Image generation is a paid feature.'
          : 'Could not generate the image. Try again.',
        );
        setStatus('error');
        return;
      }
      const { image: url } = await res.json() as { image: string };
      setImage(url);
      setStatus('done');
    } catch {
      setError('Network error. Try again.');
      setStatus('error');
    }
  }

  useEffect(() => {
    // No prompt means nothing will ever load; say so instead of spinning forever.
    if (!prompt) { setError('The model sent an empty image request.'); setStatus('error'); return; }
    if (startedRef.current) return;
    startedRef.current = true;
    void generate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 24 }}
      className="border border-border rounded-2xl overflow-hidden bg-panel max-w-sm"
    >
      <div className="px-4 py-2.5 flex items-center gap-2 border-b border-border">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4 text-brand shrink-0">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16 2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3Z" />
        </svg>
        <p className="text-xs text-muted truncate flex-1">{prompt || 'Generated image'}</p>
      </div>

      {status === 'loading' && (
        <div className="aspect-square flex flex-col items-center justify-center gap-3 surface-tint">
          <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-muted">Generating image…</p>
        </div>
      )}

      {status === 'done' && image && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt={prompt} className="w-full block" />
          <div className="px-4 py-2.5 flex items-center gap-3 border-t border-border">
            <a
              href={image}
              download="modus-image.png"
              className="text-xs font-semibold text-brand hover:underline"
            >
              Download
            </a>
            <button onClick={() => generate(true)} className="text-xs text-muted hover:text-text transition-colors">
              Regenerate
            </button>
          </div>
        </>
      )}

      {status === 'error' && (
        <div className="aspect-square flex flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-xs text-red-400">{error}</p>
          <button onClick={() => generate()} className="text-xs font-semibold text-brand hover:underline">Try again</button>
        </div>
      )}
    </motion.div>
  );
}
