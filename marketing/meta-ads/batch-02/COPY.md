# MODUS ads, batch 02 (Nov 16 2026)

Replaces batch-01 M03 (sticky note) and M04 (coffee and phone): both are AI photos and read as AI. Keep batch-01 M01 (the math) and M05 (every model).

Each concept comes in 4:5 (Feed) and 9:16 (Stories and Reels, text kept out of the top 250px and bottom 360px).
Rebuild with `python3 src/build.py`. No AI imagery anywhere: type, real product output and the real logo.

**Link:** `https://moduspilot.com/login?plan=modus&cadence=monthly&utm_source=meta&utm_medium=paid&utm_campaign=<audience>&utm_content=<ID>`
**CTA button:** Subscribe (Sign Up if Subscribe isn't offered)

---

## M06 Is a hot dog a sandwich? (real compare, curiosity)
Files: `MODUS-06-hot-dog_*.png`
Grounding: every answer, verdict and time is the real output of `/api/chat/compare` on the PILOT test account, Nov 16 2026, saved verbatim in `compare-captures.json` (captured with `apps/web/scripts/ad-compare-capture.mts`). GPT and Gemini said yes, Claude said no.

**Primary text**
1. We asked GPT, Claude and Gemini the same question at the same time. Two said yes. One said no. MODUS puts every answer side by side for $28 a month.
2. Every AI sounds sure of itself. Ask three at once and see where they disagree.

**Headline:** Ask once. See all three answers.
**Description:** GPT, Claude and Gemini in one app

## M07 $8 more gets you the rest (price anchor, objection)
Files: `MODUS-07-plus-eight_*.png`
Grounding: ChatGPT Plus $20/mo (chatgpt.com/pricing, checked Nov 10). MODUS $28/mo. Models from `apps/web/lib/models.ts`.

**Primary text**
1. Already paying $20 for ChatGPT Plus? For $28 you get GPT plus Claude, Gemini, DeepSeek and Llama in one app.
2. Most people pick one AI and wonder what the others would say. MODUS is $8 more than ChatGPT Plus and has all of them.

**Headline:** $8 more than ChatGPT Plus
**Description:** Claude, Gemini and more included

Check before launch: re-check the ChatGPT Plus price the day it goes live.

## M08 Founder letter (DRAFT, needs your OK)
Files: `MODUS-08-founder-letter_*.png`
Grounding: YOU. Every line is in your voice and has to be true for you before it runs. Confirm or rewrite: you paid for three AI apps, you used Claude for writing, you read every cancel email (and the reply address works).

**Primary text**
1. I built MODUS because I was paying for ChatGPT, Claude and Gemini at the same time. Now it's one app, $28 a month. If it isn't worth it, cancel and tell me why.
2. One founder, one app, every model. Ask GPT, Claude and Gemini the same question at once and keep the best answer.

**Headline:** Why I built MODUS
**Description:** $28 a month. Cancel anytime.

---

## Launch set (my pick)
Batch-01 M01 (the math), batch-02 M06 (hot dog), batch-02 M07 ($8 more), plus M08 once you approve the text. Batch-01 M05 is the retargeting ad.

## Highest ceiling, not built
A 20 to 30 second selfie video of you asking MODUS the hot dog question and reacting to the split. Founder-on-camera video is the top Meta format for cold traffic. I can write the script.
