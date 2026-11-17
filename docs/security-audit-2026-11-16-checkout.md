# Security and financial audit: new checkout and the money path (2026-11-16)

Scope: the new on-site checkout (branch `custom-checkout`) and everything money or account data passes through:
- `app/api/stripe/checkout`, `change-plan` and `portal`
- `app/api/founding/checkout`
- the Stripe webhook
- `lib/billing.ts`, `lib/pricing.ts` and `lib/stripe*.ts`
- `/checkout` and `/checkout/return`
- the login redirect
- the Meta pixel and Conversions API
- `next.config.mjs` headers
- the live Stripe webhook configuration

Every finding was reproduced, then retested after the fix. All payment tests ran in Stripe TEST mode against a local server, using the test account only; no customer account was touched.

## Summary for Jeremiah

- **Fixed and tested:** 6 problems.
- **Waiting on your decision:** 2 things in your Stripe settings.
- **Payment tests:** all pass, before and after the fixes. That covers MODUS and PILOT, monthly and yearly, switching plans on the page, a promo code, 3D Secure and a declined card.

## Findings

| # | Severity | What | Status |
|---|----------|------|--------|
| 1 | High impact, low likelihood | Billing matched people to Stripe customers by email without checking that the email was verified | Fixed |
| 2 | Medium | Open redirect after login | Fixed |
| 3 | Medium (money) | A plan upgrade granted PILOT before the upgrade charge succeeded | Fixed |
| 4 | Medium (money) | A chargeback did not stop the subscription or remove access | Fixed in code; needs one Stripe setting |
| 5 | Medium (ad spend) | Meta "Subscribe" fired on plan changes and page revisits | Fixed |
| 6 | Medium (privacy) | The privacy policy did not mention Meta's pixel and Conversions API | Fixed |
| 7 | Medium (data) | A second app's webhook (`phodus.vercel.app`) receives MODUS payment events | Your decision |
| 8 | Low | Two simultaneous checkout starts can create a duplicate empty Stripe customer | Mitigated |
| 9 | Low | No rate limit on starting a checkout (one create per 10 s per account) | Noted |
| 10 | Low | A past-due subscriber keeps their plan until Stripe's retries end (intended grace period) | Noted |
| 11 | Info | One billing self-test expects the September double-billed account to still have 2 subscriptions; it was fixed 09-22, so that test is out of date | Noted |
| 12 | Info | A Stripe TEST-mode key was printed once in the session log | Test key file deleted |

### 1. Email matching trusted unverified emails
- **Files:** `app/api/stripe/checkout`, `founding/checkout`, `change-plan` and `portal`, the line `email = decoded.email`.
- **What it does:** `lib/billing.ts` finds Stripe customers and subscriptions by email (`customerIdsForUser`, `resolveStripeCustomer`).
- **The risk:** if a sign-in token ever carried an email the person had not verified, that account would match someone else's Stripe customer. Then:
  - checkout's "self-heal" would copy the other person's paid plan onto it
  - the billing portal would open the other person's invoices, card ending and address
  - change-plan would reprice the other person's subscription
- **Probe:** Firebase currently refuses to set an unverified email (`OPERATION_NOT_ALLOWED`). So this was not exploitable today, but safety depended on that one setting staying on and on every sign-in provider verifying emails. The Microsoft provider is known not to guarantee that.
- **Fix:** all four routes now use the email only when `email_verified === true`. Without it, matching falls back to the account's own stored customer.

### 2. Open redirect after login
- **File:** `app/(auth)/login/page.tsx` `safeNext`.
- **Problem:** `next=/%09/evil.com` passed the string checks. Browsers strip tabs and newlines, so it became `//evil.com`, and a user who had just signed in was sent to another site, which is a classic phishing setup.
- **Fix:** the path is resolved with `new URL` and must stay on our own origin.
- **Retest:** tab, newline, `//`, `/\` and absolute URLs are all rejected. Normal paths such as `/checkout?...` still work. In the browser, the attack link now lands on /dashboard.

### 3. Upgrade granted before payment
- **File:** `app/api/stripe/change-plan/route.ts`.
- **Problem:** the upgrade switched the price and wrote `plan: pilot` immediately, whether or not the prorated charge succeeded.
- **Fix:** upgrades use `payment_behavior: 'pending_if_incomplete'`, so the new price only applies if the charge succeeds. Metadata and the Firestore plan are written only after that.
- **Retest (test mode):**
  - good card: upgrade to $59, plan becomes PILOT
  - card that always declines: HTTP 402 with a clear message; Stripe stays at $28 MODUS and Firestore stays MODUS

### 4. Chargebacks
- **Problem:** Stripe does not stop a subscription when the customer disputes a charge, so it kept billing and access stayed on.
- **Fix:** the webhook now handles `charge.dispute.created` by cancelling the subscription. The usual `customer.subscription.deleted` downgrade follows.
- **Retest:** with Stripe's dispute test card, the subscription was cancelled automatically and the plan went to free.
- **Your action:** add `charge.dispute.created` to the MODUS webhook endpoint in Stripe. Until then this code never runs.

### 5. Meta Subscribe accuracy
- **Problem:** the browser pixel fired "Subscribe" on any visit to `?upgraded=1`, which plan changes and revisits also reach. Meta would treat those as new customers and spend the ad budget chasing them.
- **Fix:**
  - The server reports each conversion once per subscription, claimed in a transaction.
  - The browser fires only after the server confirms.
- **Retest:**

| Case | Reported to Meta? |
|------|-------------------|
| Free account | No |
| Paid, first visit | Yes |
| Revisit | No |
| Plan change | No |
| New subscription | Yes |
| Signup | Once |

### 6. Privacy policy
- `app/privacy/page.tsx` now lists Meta: what is sent (events, IP address, browser details, and a hashed account ID and email), what is never sent (messages), and the Global Privacy Control and consent behaviour.

### 7. Another app on the same Stripe account
- The live account has a second webhook, `https://phodus.vercel.app/api/webhooks/stripe`.
- It is subscribed to `checkout.session.completed` and to subscription updated and deleted events, so it receives every MODUS payment, including customer IDs and MODUS user IDs.
- **Recommendation:** delete it if PHODUS doesn't take payments on this account, or move PHODUS to its own Stripe account. This is a change to your Stripe account, so it is left to you.

## What was checked and held up
- **Sign-in on every money route:**
  - no token, a garbage token and non-JSON bodies are all rejected
  - the user ID comes only from the verified token
- **Tampering:**
  - ignored fields: injected `priceId`, `amount` and `unit_amount`
  - rejected: `plan` values of `group`, `free` and `__proto__`
  - safely defaulted: quantity 50 or -3, junk cadence, `from=javascript:`
  - the price, quantity and plan always come from the server
- **Return page:**
  - forged, foreign and already-paid session IDs only redirect to fixed internal pages
  - outside URLs are ignored
  - nothing is granted there; the webhook alone grants access
- **Webhook:**
  - the signature is verified
  - unpaid sessions grant nothing
  - replays are harmless
  - access comes only from metadata the server wrote
  - add-ons can't grant a plan
- **Double charges:**
  - one active subscription after every test
  - switching plan or billing expires the other open checkout
  - an expired checkout can't be paid
  - "already subscribed" is sent to Billing
- **Secrets:**
  - no secret in the browser bundle; all 11 `NEXT_PUBLIC_*` values are meant to be public
  - no browser file imports server code
  - the checkout secret never appears in a URL
  - no sensitive values in logs
- **Headers:** `frame-ancestors 'self'` and `X-Frame-Options`, so the checkout can't be framed.
- **Prices:** live Stripe prices verified at $28 and $280 for MODUS, $59 and $588 for PILOT, and $10 for the add-on. What's shown always matches what's charged, including the promo and the yearly per-month figure.

## Payment test matrix (Stripe test mode)

| Plan | Billing | Charged | Subscription | Plan saved | After cancel |
|------|---------|---------|--------------|------------|--------------|
| MODUS | Monthly | $28.00 | monthly price, 1 live | modus | free |
| MODUS | Yearly | $280.00 | yearly price, 1 live | modus | free |
| PILOT | Monthly | $59.00 | monthly price, 1 live | pilot | free |
| PILOT | Yearly | $588.00 | yearly price, 1 live | pilot | free |
| Switch MODUS to PILOT | Monthly | $59.00 | PILOT only | pilot | free |
| MODUS + TEST20 + 3D Secure | Monthly | $22.40 ($5.60 off) | MODUS | modus | free |

The first four rows were run twice: before the fixes and again after them.

Live billing self-tests:
- `verify-plan-change`: 23 of 23 pass.
- `verify-billing-invariants`: everything passes except the out-of-date fixture in item 11.
