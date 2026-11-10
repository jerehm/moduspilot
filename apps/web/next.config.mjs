/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@modus/shared'],

  // Bake the deploying commit into the client bundle so Settings > About can
  // show which web build a user is on (the web package version is a static
  // 0.1.0 and tells you nothing). Vercel sets VERCEL_GIT_COMMIT_SHA at build;
  // local `next dev`/`next build` leaves it unset, so About falls back to "dev".
  env: {
    NEXT_PUBLIC_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || '',
  },

  async redirects() {
    return [
      // Redirect www → non-www (permanent)
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.moduspilot.com' }],
        destination: 'https://moduspilot.com/:path*',
        permanent: true,
      },
      // Connections page was renamed to Capabilities — keep old bookmarks working.
      { source: '/connections', destination: '/capabilities', permanent: true },
      // /features is restored as the Product / Chat page (linked from the Product
      // nav dropdown) in the 2026-09 redesign, so it no longer redirects. The old
      // /how-it-works alias still folds into it.
      { source: '/how-it-works', destination: '/features', permanent: true },
    ];
  },

  async headers() {
    return [
      // Baseline hardening on every response. frame-ancestors stops other sites
      // from framing MODUS (clickjacking), most importantly the one-click
      // "Continue as" on /desktop/signin. Widgets/HTML previews are srcdoc
      // iframes INSIDE our pages, which this does not affect.
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      // Tell Google not to index auth-protected dashboard pages
      {
        source: '/(dashboard|chat|goals|habits|tasks|briefing|settings)/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      {
        source: '/(dashboard|chat|goals|habits|tasks|briefing|settings)',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      // Also noindex the auth and onboarding flows
      {
        source: '/(login|onboarding)/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      {
        source: '/(login|onboarding)',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

// Sentry is opt-in: with no DSN the config is untouched (identical build). Set
// NEXT_PUBLIC_SENTRY_DSN (+ SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN for
// source-map upload) to activate error reporting. See .env.local.example.
let config = nextConfig;

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  const { withSentryConfig } = await import('@sentry/nextjs');
  config = {
    ...nextConfig,
    experimental: { ...nextConfig.experimental, instrumentationHook: true },
  };
  config = withSentryConfig(config, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    silent: !process.env.CI,
    widenClientFileUpload: true,
    disableLogger: true,
    // Only upload source maps when an auth token is present (else the build
    // would fail trying to authenticate).
    sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  });
}

export default config;
