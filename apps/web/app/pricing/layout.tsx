import type { Metadata } from 'next';

const DESC = 'Start free on the open models, no card. $28/mo for every frontier model auto-routed, $59/mo for founders and executives. One subscription instead of five.';

export const metadata: Metadata = {
  title: 'Pricing',
  description: DESC,
  alternates: {
    canonical: 'https://moduspilot.com/pricing',
  },
  openGraph: {
    title: 'Modus Pricing',
    // "Free to start" is accurate and it is the whole point of saying it here: the
    // free plan gives the open models with no card. Before the free tier a card was
    // required for the first message, and cold traffic saw that in the link preview
    // and converted at ~0.
    description: DESC,
    url: 'https://moduspilot.com/pricing',
    siteName: 'Modus',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Modus: every frontier model, one subscription.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Modus Pricing',
    description: DESC,
    images: ['/og.png'],
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
