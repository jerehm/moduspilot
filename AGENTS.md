# Modus project rules

Monorepo (turborepo). The web app lives in `apps/web`. Run app-level commands
from `apps/web` unless told otherwise.

## Brand and copy (do not undo)
- The product is **Modus**. Tier names stay in caps: MODUS, MODUS+, PILOT.
- The accent color is violet. Never swap it for another color. This has been
  tried (teal) and rejected hard. Violet stays.
- Copy rules for all user-facing text: no em dashes, no en dashes, no Oxford
  comma, no emoji. This is enforced by a guard.
- Before committing any copy change, run `npm run check-copy` from `apps/web`
  (`apps/web/scripts/check-copy.mjs`). It must pass.

## Billing (high risk, read before touching)
- Do not change payment, plan, subscription, or pricing code without care.
  Invariants live in `apps/web/lib/billing.ts`.
- `apps/web/.env.local` holds a LIVE `sk_live_` Stripe key. Billing verifiers
  hit the real Stripe account, so they are not free to run casually.
- Any code path that answers "does this user have a plan" must use
  `findLivePlanSubscription`.

## Tiers
- Free tier = open models only, on a rolling 5 hour window plus a weekly cap.
  Frontier models are paid only. Do not expose frontier models to free users.

## Workflow
- TypeScript must be green (`tsc`) before committing.
- Commit and push every session. Pushing to main auto-deploys to Vercel.
- Do not migrate infra (Cloudflare etc) unless explicitly asked. Nothing is
  migrated today.

## Recent state and conventions (2026-09-13, do not undo)
- Theme: ONE saved key `modus-theme` ('light' | 'dark') drives the homepage,
  login, and the app so they always match. Default is LIGHT (a new visitor and
  the app after login start light). Pre-paint script in `app/layout.tsx` adds
  `.dark` only when the key is 'dark'. The homepage toggle
  (`components/marketing/MarketingHome.tsx`) persists the key and mirrors the
  global `.dark` class. Do not restore a dark default.
- Light-mode purple: low-opacity `bg-brand/N` FILLS read as light purple
  (lavender) over the ivory light ground, which the owner rejected. For surface
  fills/tints use the utilities in `globals.css`: `.surface-tint`,
  `.surface-tint-strong`, `.border-tint`, `.hover-surface-tint`,
  `.hover-border-tint` (neutral in light, violet in dark). Do NOT add new
  `bg-brand/4..20` surface fills on app surfaces. Solid `bg-brand` accents
  (buttons, active tab text, the user chat bubble) stay violet. Marketing pages
  (`components/marketing/*`) keep violet and are out of scope for this rule.
- Login (`app/(auth)/login/page.tsx`): wordmark top-left, logo over a serif
  headline, OAuth (Google, Microsoft, Apple), passwordless email link, a
  Download desktop app link, and `HomePricingSection` revealed on scroll. Auth
  providers are configured in the Firebase console (owner's hands), not in code.
- Provider collisions: when a provider returns an email already registered via
  another provider, `signIn` catches `auth/account-exists-with-different-credential`,
  holds the incoming credential, names the existing provider via
  `fetchSignInMethodsForEmail`, and links the held credential on the next
  successful sign-in so one account carries both. Do not revert this to a plain
  error.
- Workspace: Goals and Reminders are hidden from the sidebar until a phone is
  connected (`hooks/useMobileConnected.ts`, non-empty `users/{uid}/expoPushTokens`).
- Animations: the Display setting "Animations" is the inverse of the stored
  `reduceMotion` flag; the marketing hero film honors it via `?reduced=1`.
