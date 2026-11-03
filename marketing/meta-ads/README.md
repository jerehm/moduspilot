# MODUS Meta photo ads

Angle: **4 models, 1 platform.** GPT, Claude, Gemini and DeepSeek in one app for $24 a month.
Offer: paid MODUS ($24/mo, or $20/mo billed yearly). No free-tier CTA.

## What's in here
- `copy.md` has the primary text, headlines and CTA for each audience.
- `prompts/` has image prompts grouped by audience (`broad`, `students`, `founders`, `office`, `native`). Each concept has an ID like `B1` or `S2`.
- `reference/` has the real logo files to attach in OpenAI.

## How to make an image in OpenAI
1. Attach `reference/logo.png` (or `logo-with-text.png` when the prompt asks for the wordmark).
2. If the prompt says **[REAL UI]**, also attach a real screenshot (see below).
3. Paste the prompt and the **Brand block** below it.
4. Generate at **1024x1536**. Crop to **1080x1350 (4:5)** for feed and use full height for Stories.
5. Read every word in the image. Image models still misspell, so regenerate if one letter is off.

### Brand block (paste under every prompt)
> Use the attached MODUS logo exactly as provided. Do not redraw, recolor or restyle it. Colors: warm ivory background #F0EEE6, near-black ink #141413, violet #7C3AED for small accents only. Clean modern sans serif or elegant serif type, high contrast and easy to read on a phone. Do not include any other company's logo or app icon. Model names appear as plain text only.

### Screenshots to take yourself (for [REAL UI] concepts)
The old `screenshot-models.png` is dark mode, shows your name and lists Llama, so don't use it. Take two fresh light-mode screenshots instead:
1. **Picker:** open the model picker on moduspilot.com so GPT, Claude, Gemini and DeepSeek are visible.
2. **Compare:** turn on Multi-model, pick 3 models and ask one question so the 3 answers sit side by side.

Use a throwaway account name or crop the name out. Never let OpenAI invent a fake MODUS screen.

## Truth rules (Meta reviews claims, and so do customers)
- The $24 plan includes GPT, Claude, Gemini, DeepSeek and Llama, verified in `apps/web/lib/models.ts`.
- **Compare runs up to 3 models at once, not 4.** Never write "ask all 4 at once" or "4 answers side by side".
- **Grok is not live.** Don't mention it.
- The $24 plan includes Gmail/Outlook, Calendar and Drive, so the inbox and calendar lines are true.
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
None of these are proven. MODUS has no ad history, and cold traffic has converted close to zero so far. A paid offer at $24 will get fewer clicks than a free one, and every buyer is real revenue. The first week is about finding out which angle gets the cheapest checkout, not about profit.
