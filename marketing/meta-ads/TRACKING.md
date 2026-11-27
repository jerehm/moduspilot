# MODUS Meta ads: test playbook

Set up Nov 24 2026. Read this before touching the Meta ads or answering "how are the ads doing".

## What is set up

- Ad account: **Modus** (ID 2409859279783814) in the **Modus** business portfolio (1554265783388598). Do not use the personal ad account 1103277221270024.
- Facebook Page: **Modus**. Instagram @moduspilot is not connected to the Page yet (Business Suite home → Connect Instagram, needs Jeremiah's login).
- Pixel: **MODUS Pixel 1493632635994645**. This is the one on moduspilot.com (`NEXT_PUBLIC_META_PIXEL_ID` in Vercel, plus `META_CAPI_ACCESS_TOKEN` for the server copy). The other pixel named "MODUS Pixel" (1132051882535809) on the personal ad account is empty, ignore it.
- Pixel events in code: PageView, CompleteRegistration (when the account is first created at sign-in, before payment; changed Nov 26 2026, it used to fire at the end of onboarding), Subscribe (Stripe success, only after the webhook grants the plan). See `apps/web/lib/meta-pixel.ts`, `components/MetaCheckoutTracker.tsx`, `app/api/meta/event/route.ts`.
- Campaign: **MODUS US Subscribe test Nov 2026**. Advantage+ sales campaign, conversion event Subscribe, US, ages 18+, Advantage+ audience and placements, $50 a day campaign budget (Meta may spend up to $87.50 on one day and $350 in a week).
- Ad set: **US Broad Advantage+**.
- Ads (6), each with a 4:5 image for feeds and a 9:16 image for Stories and Reels:
  - M03 Sticky note
  - M03B Sticky tabs
  - M03C Sticky price
  - M01 The math (competitor prices checked Nov 24 2026: ChatGPT Plus $20, Claude Pro $20, Google AI Pro $19.99; check again before reusing)
  - M02 Ask once compare three (cards are crops of the real compare screenshot)
  - M05 Every model
- Every Advantage+ creative enhancement is off (overlays, touch-ups, text improvements, CTA, music, animation, AI images). Only Flex media is on.
- Link: `https://moduspilot.com/start` with `utm_source=meta&utm_medium=paid&utm_campaign=us_subscribe_test&utm_content=<code>` (M01, M02, M03, M03B, M03C, M05). /start is one landing page for all six ads (`apps/web/app/start/page.tsx`, live since Nov 24). Only its headline changes, picked from utm_content to match the ad. Its button goes to `/login?plan=modus&cadence=monthly&promo=ONEDOLLAR` with the ad's UTMs carried along. Not indexed.
- Ad path since Nov 26 2026 (commit d4371b7): a new account arriving with `utm_source=meta` skips onboarding and goes straight to checkout, where ONEDOLLAR is applied server-side ("$1 today, then $28 a month"). After paying, a one-time "about you" screen, then the app. Inside the Instagram/Facebook in-app browser, login puts Apple and email first, because Google sign-in is blocked in in-app browsers. `utm_source=meta` is what triggers this path, so every ad must keep it in its URL parameters.
- Checked Nov 26 2026 in Ads Manager: all six ads have Website URL `https://moduspilot.com/start` and URL parameters `utm_source=meta&utm_medium=paid&utm_campaign=us_subscribe_test&utm_content=<code>` with the right code. Ads Manager's "Preview URL" opens /start with only `?fbclid=fbclid` (Meta does not add the URL parameters to the preview), so the preview shows the general headline; real ad clicks carry the parameters.
- Pixel check Nov 26 2026 (Events Manager → Test events): opening /start fired PageView from the browser, status Processed. Meta's test panel shows the URL as `https://moduspilot.com/` only.
- Offer: **$1 for the first month, then $28 a month, ends Dec 31 2026 at 11:59 pm Pacific.** Stripe promotion code `ONEDOLLAR` on a $27-off coupon: applies once, MODUS product only, first-time customers only, expires at the same moment (promotion code `promo_1UfGdbC8YojAhwhfnQ5iImQ6`, coupon `hKJEDRsA`, created Nov 24, confirmed Nov 26). Script that creates it: `marketing/meta-ads/stripe/q4-dollar-offer.mjs`. The page reads `apps/web/lib/offer.ts` and saves the code in localStorage (`modus-promo`); /login saves it again from the link's `promo=ONEDOLLAR`. The checkout page sends the saved code to `app/api/stripe/checkout/route.ts`, which attaches it to the Checkout Session when it is created (MODUS monthly only). Stripe refuses ONEDOLLAR when it is applied from the browser, which is why it had 0 redemptions until Nov 26. After Dec 31 the page drops the offer by itself. To extend or end it, change Stripe first, then `lib/offer.ts`. Do not keep moving the end date.
- Every ad's text ends with "Join by Dec 31 and your first month is $1." and every description is "First month $1. Ends Dec 31." (M03C's text also had a lowercase "cancel" fixed).
- Images: `marketing/meta-ads/batch-01/launch/`. Copy for every ad: `marketing/meta-ads/batch-01/COPY.md`.

## Where the numbers are

1. Ads Manager → campaign → **Ads** tab, columns preset "Performance and clicks".
2. **MODUS Ads Tracker** (claude.ai): https://claude.ai/artifact/MKxCS12MjLyxhTewb1fP4H. A daily scheduled check copies each ad's numbers for each day into it (collection `data/meta/ad_days`, one document per ad per day, id `YYYY-MM-DD_<code>`).
3. Stripe: new subscriptions (they start at $1 with code ONEDOLLAR).
4. Renewals: once the first $28 bills come due (from late December), count ONEDOLLAR subscribers who paid it versus canceled, and add one document per check to `data/stripe/renewals` in the tracker (id `YYYY-MM-DD`, fields `checked_at`, `renewed`, `canceled`). The tracker's "Still paying after the $1 month" tile reads the latest one. This is the number that says whether the ads work, since $1 sign-ups alone don't show who will pay $28.

Fields in each tracker row: `date`, `ad` (code), `ad_name`, `spend`, `impressions`, `link_clicks`, `landing_page_views`, `subscribes`, `registrations`, `copied_at`.

## Rules for the test

- Wait about 72 hours after launch before judging any ad.
- Pause an ad when its link CTR is under 0.8% after 1,000 impressions.
- Pause an ad when it has spent $50 with no paid subscribers.
- If the whole campaign passes $150 with no paid subscribers, switch the ad set's conversion event from Subscribe to Complete registration. Subscribe had never fired before launch, so Meta starts the Subscribe goal blind.
- After 7 days, keep the best ad and make three new versions of it (different headline, background or color).
- Never pause, edit or change budget without Jeremiah saying so. The daily check only recommends.

## Known gaps

- The login page subhead ("Sign in to pick up where you left off.") is written for returning users, and ad traffic sees it on the way to checkout. (New ad accounts no longer go through onboarding before checkout; that changed Nov 26.)
- Post-launch task: the checkout's "Add promo code" box applies codes from the browser, and Stripe refuses ONEDOLLAR that way, so typing ONEDOLLAR by hand fails. The automatic path is not affected (the server attaches the code). Fix: when ONEDOLLAR is typed on MODUS monthly, save it and restart the session so the server attaches it (`components/checkout/PaymentForm.tsx`, `CheckoutPage.tsx`). The /start FAQ no longer tells people to type the code.
- "Adjust brightness and contrast" and "Relevant comments" show as on under Essential enhancements (seen on M03C, check the others). They were left as Meta set them.
- Events Manager has one open diagnostic: "Confirm domain that belong to you" for moduspilot.com (add it to the pixel's allowed domains). Optional, needs Jeremiah's OK.
- Each ad shows a promotion line "Ends Thu, Dec 31" (Ad creative → Highlight your promotions). It matches the offer; remove it after Dec 31.
- Meta shows "Verification needed" on the business until Jeremiah confirms the code Meta emails to his Facebook login.
- The Page profile picture should be `marketing/meta-ads/batch-01/launch/modus-avatar-dark.png` (matches Instagram: #0E0D14 background, #8555D1 mark, centered).
