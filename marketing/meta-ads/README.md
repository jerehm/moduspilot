# MODUS Meta photo ads

Angle: **4 models, 1 platform.** GPT, Claude, Gemini and DeepSeek in one app for $28 a month.
Offer: paid MODUS ($28/mo, or $280/yr billed yearly). No free-tier CTA.

## What's in here
- `copy.md` has the primary text, headlines and CTA for each audience.
- The `prompts-*.md` files have image prompts grouped by audience (`broad`, `students`, `founders`, `office`, `native`). Each concept has an ID like `B1` or `S2`.
- this folder has the real logo files and 2 real app screenshots to attach in ChatGPT.
- `CHATGPT-PROMPT.md` is the prompt to paste into ChatGPT, plus fixes for common problems.

## How to make an image in OpenAI
1. Attach `logo.png` (or `logo-with-text.png` when the prompt asks for the wordmark).
2. If the prompt says **[REAL UI]**, also attach a real screenshot (see below).
3. Paste the prompt and the **Brand block** below it.
4. Generate at **1024x1536**. Crop to **1080x1350 (4:5)** for feed and use full height for Stories.
5. Read every word in the image. Image models still misspell, so regenerate if one letter is off.

### Brand block (paste under every prompt)
> Use the attached MODUS logo exactly as provided. Do not redraw, recolor or restyle it. Colors: warm ivory background #F0EEE6, near-black ink #141413, violet #7C3AED for small accents only. Clean modern sans serif or elegant serif type, high contrast and easy to read on a phone. Do not include any other company's logo or app icon. Model names appear as plain text only.

### Real screenshots (already in this folder, for [REAL UI] concepts)
Captured 11-03 on live moduspilot.com, light mode, on the $28 MODUS plan, with no name or chat history in frame:
- `ui-model-picker.png`: the model picker showing DeepSeek V3.1, GPT-6.1 Sol, Claude Sonnet 5.5 and Gemini 3.8 Flash.
- `ui-compare-3-models.png`: one question answered by GPT, Claude and Gemini side by side (real answers).

Both show the real OpenAI, Anthropic and Google icons as they appear in the app. That is the true product, but Meta can occasionally flag third-party marks, so if an ad gets rejected, crop the icons out.

The repo's old `public/screenshot-models.png` is dark mode, shows a real name and lists Llama, so don't use it. Never let ChatGPT invent a fake MODUS screen.

### Logos
- `logo.png`: the mark (light backgrounds). `logo-dark.png`: the mark for dark backgrounds.
- `logo-with-text.png`: the mark with "MODUS PILOT", which matches the live site navbar.

The full ChatGPT prompt is in `CHATGPT-PROMPT.md`.

## Truth rules (Meta reviews claims, and so do customers)
- The $28 plan includes GPT, Claude, Gemini, DeepSeek and Llama, verified in `apps/web/lib/models.ts`.
- **Compare runs up to 3 models at once, not 4.** Never write "ask all 4 at once" or "4 answers side by side".
- **Grok is not live.** Don't mention it.
- The $28 plan includes Gmail/Outlook, Calendar and Drive, so the inbox and calendar lines are true.
- **Competitor prices:** third-party sites (Oct 2026) list ChatGPT Plus, Claude Pro and Google AI Pro at about $20/mo each. DeepSeek is free. Check chatgpt.com/pricing, claude.com/pricing and Google's AI plans page the day you launch any price ad. Never write "4 subscriptions = $80".
- No em dashes, en dashes, Oxford commas or emoji.

## Link
`https://moduspilot.com/login?plan=modus&cadence=monthly&utm_source=meta&utm_medium=paid&utm_campaign=<audience>&utm_content=<concept-id>`

Example: `...&utm_campaign=students&utm_content=S1`

## Launch plan
- **Campaign:** **moduspilot.com has NO Meta pixel yet** (checked 11-03, there's no `fbq` anywhere in the app). Without one, Meta can't see checkouts or optimize for purchases. Either install the pixel plus the Conversions API with Purchase on Stripe checkout success first (recommended), or start with a Traffic objective optimized for landing page views and count purchases by UTM yourself.
- **Ad sets:** Students, Founders/creators, Office workers and Broad (Advantage+ audience). Put 3 ads in each.
- **Starting set:**
  - Broad: B1, B2, N1
  - Students: S1, S3, S5
  - Founders: F1, F2, F4
  - Office: O1, O3, O4
- **Budget:** $10 to $20 a day per ad set for 7 days.
- **Kill rules:**
  - Pause an ad when CTR is under 0.8% after 1,000 impressions.
  - Pause an ad when $50 is spent with zero checkouts.
- **After 7 days:** keep the winner, then make 3 new versions of it (different headline, background or color).

## Honest note
None of these are proven. MODUS has no ad history, and cold traffic has converted close to zero so far. A paid offer at $28 will get fewer clicks than a free one, and every buyer is real revenue. The first week is about finding out which angle gets the cheapest checkout, not about profit.
