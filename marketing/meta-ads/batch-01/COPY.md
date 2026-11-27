# MODUS ads, batch 01 (Nov 10 2026)

Five concepts, each in 1:1 (1080x1080), 4:5 (1080x1350) and 9:16 (1080x1920).
Use 4:5 for Feed, 9:16 for Stories and Reels, 1:1 as a fallback. Story files keep text out of the top 250px and bottom 360px.

Copy rules applied: no em dashes, no en dashes, no Oxford comma, no emoji.

**Link:** `https://moduspilot.com/start` with URL parameters `utm_source=meta&utm_medium=paid&utm_campaign=us_subscribe_test&utm_content=<ID>` (changed Nov 24 2026 from the old `/login?plan=modus&cadence=monthly` link). `utm_source=meta` is required: it sends new accounts straight to the $1 checkout. See `marketing/meta-ads/TRACKING.md`.

**$1 offer (live since Nov 24 2026, ends Dec 31 2026 at 11:59 pm Pacific):** in Ads Manager every live ad's primary text ends with "Join by Dec 31 and your first month is $1." and every live ad's description is "First month $1. Ends Dec 31." The texts below include both. Live ads: M01, M02, M03, M03B, M03C, M05 (M03B and M03C are variants of M03 made in Ads Manager and are not written out here). M04 is not running.
**CTA button:** Subscribe (Sign Up if Subscribe isn't offered)

---

## M01 The math (comparison)
Files: `MODUS-01-the-math_*.png`
Best for: people who already pay for one or more AI apps (Broad, Founders, Office)

**Primary text**
1. ChatGPT Plus, Claude Pro and Google AI Pro come to $59.99 a month. MODUS puts GPT, Claude, Gemini, DeepSeek and Llama in one app for $28. Join by Dec 31 and your first month is $1.
2. Three AI subscriptions to get three models. Or one app with all of them, plus DeepSeek and Llama, for $28 a month. Join by Dec 31 and your first month is $1.

**Headline:** Every model for $28 a month
**Alt headline:** Stop paying for three
**Description:** First month $1. Ends Dec 31.

Check before launch: the competitor prices on this ad were last checked on Nov 24 2026 (first checked Nov 10, same prices) on chatgpt.com/pricing ($20 Plus), claude.com/pricing ($20 Pro, monthly billing) and gemini.google/subscriptions ($19.99 AI Pro). Re-check them the day the ad goes live. The fine print on the image says MODUS gives you the models, not each company's own app features. Keep that line.

## M02 Ask once. Compare three. (product, real UI)
Files: `MODUS-02-ask-once-compare-three_*.png`
Best for: Students, Founders/creators, Broad

**Primary text**
1. Ask one question and get GPT, Claude and Gemini answering side by side. Keep the best answer and keep going. $28 a month. Join by Dec 31 and your first month is $1.
2. Every model has a blind spot. Put three on the same question and see where they agree. Join by Dec 31 and your first month is $1.

**Headline:** Ask once. Compare three.
**Description:** First month $1. Ends Dec 31.

Note: the cards are cut from your real Nov 3 screenshot (`ui-compare-3-models.png`), not redrawn. GPT's real answer contains an em dash ("we brew"). That is the model's output, not MODUS copy, so it was left as captured. The cards show the real OpenAI, Anthropic and Google icons. If Meta flags them, swap in a crop without the icons.

## M03 Four AI logins (problem/solution, photo)
Files: `MODUS-03-sticky-note_*.png`
Best for: Office workers, Broad

**Primary text**
1. Four AI logins on a sticky note. Or one app with GPT, Claude, Gemini, DeepSeek and Llama for $28 a month. Join by Dec 31 and your first month is $1.
2. Stop switching tabs to find the model that answers best. MODUS has them all in one place. Join by Dec 31 and your first month is $1.

**Headline:** One login. Every model.
**Description:** First month $1. Ends Dec 31.

## M04 Wake up to a plan (connected life, photo)
Files: `MODUS-04-wake-up-to-a-plan_*.png`
Best for: Founders, Office workers

**Primary text**
1. MODUS reads your inbox and calendar and has a briefing ready every morning. It never sends or changes anything without your approval.
2. Ask what is on your plate this week. MODUS checks your Gmail or Outlook and your calendar, then answers with the model that fits.

**Headline:** Wake up to a plan
**Description:** Works with Gmail, Outlook and Calendar

## M05 Every model. One app. (brand)
Files: `MODUS-05-every-model_*.png`
Best for: Broad, retargeting site visitors

**Primary text**
1. GPT, Claude, Gemini, DeepSeek and Llama. Leave it on Auto and MODUS picks the model that fits each message, or pick one yourself. Join by Dec 31 and your first month is $1.
2. One subscription for every model you use. $28 a month. Cancel anytime. Join by Dec 31 and your first month is $1.

**Headline:** Every model. One app.
**Description:** First month $1. Ends Dec 31.

---

## Where each claim comes from
- $28/mo, Cancel anytime, Auto routing, daily briefings, Gmail/Outlook, Calendar and Drive, "never sends or changes anything without your approval": moduspilot.com homepage and pricing, Nov 10 2026.
- GPT, Claude, Gemini, DeepSeek and Llama on the $28 plan: `apps/web/lib/models.ts` (GPT-6.1 Sol, Claude Sonnet 5.5, Gemini 3.8 Flash, DeepSeek V3.1, Llama 3.3).
- Compare runs up to 3 models: `marketing/meta-ads/README.md` and the real screenshot. None of these ads says "ask all 4 at once."
- $1 first month: Stripe promotion code ONEDOLLAR and `apps/web/lib/offer.ts` (MODUS monthly, first-time customers, ends Dec 31 2026 at 11:59 pm Pacific).
- Not used anywhere: user counts, revenue, testimonials, Grok, PILOT-only models (Opus, GPT-6 Astra, Fable), "free" offers.

## Before you spend
- The Meta pixel (MODUS Pixel 1493632635994645) and Conversions API are live on moduspilot.com: PageView, CompleteRegistration at account creation and Subscribe after Stripe confirms. Details in `marketing/meta-ads/TRACKING.md`.
