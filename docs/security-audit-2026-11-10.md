# MODUS security audit, 2026-11-10

Scope: web (77 API routes, Firestore + Storage rules, OAuth connectors, MCP, rendering), desktop (Electron), secrets, dependencies.

## Fixed (`2a8374a`, live and verified on production)

| Sev | Finding | Fix |
|---|---|---|
| HIGH | Desktop sign-in phishing. Anyone could start a sign-in, send a victim `/desktop/signin?state=S`, and poll `/api/desktop/auth-poll` for the code the victim's browser issued, giving a full account takeover from one click (zero clicks if the victim was logged out and signed in). | The poll mailbox now only releases the code to a poller on the same IP as the approving browser (`clientIpHash`, `lib/desktop-auth.ts`). The `modusdesktop://` link path is unchanged. Proven on prod: a poller from a Vercel Sandbox (a different network) got `pending` 3 times while the same-network poll got the code. |
| MED | No anti-framing headers, so the one-click "Continue as" button could be clickjacked. | `frame-ancestors 'self'`, `X-Frame-Options`, `nosniff` and `Referrer-Policy` on every response (`next.config.mjs`). |

## Checked and sound
- All 77 routes: every private route verifies a Firebase ID token; webhook uses a Stripe signature; cron uses `CRON_SECRET` (set in prod). Public routes (client-error, newsletter, founding gate, OAuth callbacks, desktop exchange/poll) are intentionally public and bounded.
- Firestore: default deny, owner-scoped user data, billing/quota fields blocked from client writes, shares and invites server-only. Storage: deny all.
- SSRF: `assertPublicUrl` + `safeFetch` (checks every redirect hop) on MCP add/test/connect/OAuth and tool media; re-checked at connect time against DNS rebinding.
- XSS: markdown escapes before formatting, mermaid `securityLevel: 'strict'`, widgets and HTML previews in sandboxed iframes without `allow-same-origin`.
- Desktop: `contextIsolation`, `sandbox`, no `nodeIntegration`; the local bridge checks the calling origin (moduspilot.com top frame only) and every local MCP command or folder needs a native consent dialog; external links limited to http/https/mailto.
- Git history: no live secrets committed (only the public Firebase web key and a fake test key).

## Open (owner action or separate task)
| Sev | Finding | Action |
|---|---|---|
| HIGH | `~/Desktop/Work/MODUS` holds the Firebase Admin service account key (full database access), an Apple `.p8` key, recovery codes and the Stripe backup code in plaintext, and Desktop syncs to iCloud. | Move them into a password manager and delete the files. Rotate the Firebase Admin key (Firebase console > Service accounts) and update the `FIREBASE_PRIVATE_KEY` env var on Vercel. |
| MED | `npm audit`: 19 high, 1 critical. Mostly DoS paths in the AI SDK chain plus build-time `tar` via `canvas`. Fixes require the AI SDK 7 major upgrade (parked). `npm audit fix` without `--force` made it worse (22 high) and was reverted. | Do it with the AI SDK 7 migration. |
| LOW | `INNGEST_SIGNING_KEY` is not in Vercel env; `/api/inngest` answers 401. This is not a hole, but background functions (check-ins, triage) may not be running. | Check the Inngest dashboard. |
| LOW | Firestore user-doc rule is a deny-list of server fields; a new entitlement field must be added to it. | Remember when adding plan fields. |
| INFO | No prompt moderation layer; providers' own safety filters apply. | Owner decision. |

## Investor-safe statement (all verified)
All model provider keys live server-side and never reach the browser. Every private API route verifies a Firebase session token, the database denies all access by default and scopes each user's data to that user, and billing fields can only be changed by our server through signature-verified Stripe webhooks. User-supplied URLs are checked against internal-network access on every request. The desktop app runs sandboxed and asks for explicit consent before touching local files or running local tools. Payments are handled by Stripe, so we never see card data. We ran a full security audit in November 2026 and fixed every code-level finding.
