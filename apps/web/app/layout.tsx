import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { GlobalErrorCapture } from '@/components/GlobalErrorCapture';
import { MetaPixel } from '@/components/MetaPixel';

export const metadata: Metadata = {
  metadataBase: new URL('https://moduspilot.com'),
  title: {
    default: 'Modus',
    template: '%s | Modus',
  },
  description: 'Stop managing yourself. Modus is your AI chief of staff that tracks your goals, clears your plate and tells you what to focus on next.',
  alternates: {
    canonical: '/',
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/logo.png', type: 'image/png' },
    ],
    apple: '/logo.png',
  },
  openGraph: {
    type: 'website',
    url: 'https://moduspilot.com',
    title: 'Modus',
    description: 'Stop managing yourself. Modus is your AI chief of staff that tracks your goals, clears your plate and tells you what to focus on next.',
    siteName: 'Modus',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: "Modus: the only AI you'll ever need. Every frontier model, one subscription.",
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Modus',
    description: 'Stop managing yourself. Modus is your AI chief of staff that tracks your goals, clears your plate and tells you what to focus on next.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="anonymous" />
        {/* Space Grotesk — a free geometric grotesque close to Anthropic's Styrene,
            for the big marketing hero headlines (wide, bold, well-spaced). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" />
        {/* 🔤 SATOSHI AND SENTIENT ARE LOADED AS VARIABLE FONTS (`@1,2`), NOT
            AS STATIC WEIGHTS — because Satoshi ships NO 600 and Sentient ships
            no 600 either. Tailwind's `font-semibold` IS 600, so every semibold
            in the product was being rendered by the Bold 700 file: measured on
            prod, Satoshi 600 and 700 had an identical advance width
            (717.77px), which is why bold text read as too heavy everywhere,
            the dashboard included.
            The variable faces cover 300–900 (Satoshi) and 200–700 (Sentient),
            so 600 is now a real interpolated weight sitting between Medium and
            Bold. It is also FEWER requests — one file per family per style
            instead of five. Verify with advance width, never
            document.fonts.check(): check() answers "can this family render
            this text" and returns true for weights whose file does not exist. */}
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=clash-display@200,300,400,500,600,700&f[]=satoshi@1,2&f[]=sentient@1,2&display=swap" />
        {/* Apply the saved theme before paint (default light, no FOUC). One
            shared key 'modus-theme' = 'light' | 'dark' drives the homepage,
            login, and the software so they always agree; unset means light
            (the homepage default). Also restore a cached reduce-motion pref so
            animations stay off from the first frame when the user disabled them. */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            try {
              if (localStorage.getItem('modus-theme') === 'dark')
                document.documentElement.classList.add('dark');
              if (localStorage.getItem('modus-reduce-motion') === '1')
                document.documentElement.setAttribute('data-reduce-motion', 'true');
            } catch (e) { /* storage blocked, default light */ }
          })();
        ` }} />
      </head>
      <body>
        <GlobalErrorCapture />
        <QueryProvider>
          {children}
        </QueryProvider>
        {/* Pageviews only. MODUS shipped with no analytics of any kind, which
            means "nobody visits" and "everybody bounces" were indistinguishable
            — two problems with opposite fixes. Needs Web Analytics enabled on
            the project in the Vercel dashboard; until then the script no-ops. */}
        <Analytics />
        {/* Meta ads measurement. Loads nothing until NEXT_PUBLIC_META_PIXEL_ID is
            set; asks first in the EU, EEA, UK and Switzerland (lib/meta-pixel.ts). */}
        <MetaPixel />
      </body>
    </html>
  );
}
