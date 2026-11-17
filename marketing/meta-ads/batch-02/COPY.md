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

## M07 $8 more gets you all of them (MAIN, one post, all three apps)
Files: `MODUS-07-plus-eight-all_*.png`
Grounding: ChatGPT Plus $20, Claude Pro $20 billed monthly, Google AI Pro $19.99 (shown as $20, the fine print says rounded). All checked Nov 16 2026 on each pricing page. MODUS $28.

**Primary text**
1. Paying $20 for ChatGPT, Claude or Gemini? For $28 you get all three in one app, plus DeepSeek and Llama.
2. Most people pay for one AI and wonder what the others would say. For $8 more MODUS gives you all of them and lets you ask three at once.

**Headline:** $8 more gets you all of them
**Description:** GPT, Claude and Gemini in one app

## M07a/b/c Backups: one version per app (test later against M07)
Files: `MODUS-07a-plus-eight-chatgpt_*.png`, `MODUS-07b-plus-eight-claude_*.png`, `MODUS-07c-plus-eight-gemini_*.png`
Run all three in the same ad set. Each names one app so its users know it is about them; Meta finds who responds to which. 07a is the main one (most users).
Grounding: prices checked Nov 16 2026: ChatGPT Plus $20 (chatgpt.com/pricing), Claude Pro $20 billed monthly (claude.com/pricing, $17 is the annual rate), Google AI Pro $19.99 (gemini.google/subscriptions). MODUS $28. Models from `apps/web/lib/models.ts`.

**07a ChatGPT**
1. Already paying $20 for ChatGPT Plus? For $28 you get GPT plus Claude, Gemini, DeepSeek and Llama in one app.
2. You picked ChatGPT. For $8 more you can ask Claude and Gemini the same question and compare.
Headline: $8 more than ChatGPT Plus / Description: Claude, Gemini and more included

**07b Claude**
1. Already paying $20 for Claude Pro? For $28 you get Claude plus GPT, Gemini, DeepSeek and Llama in one app.
2. You picked Claude. For $8 more you can ask GPT and Gemini the same question and compare.
Headline: $8 more than Claude Pro / Description: GPT, Gemini and more included

**07c Gemini**
1. Already paying $20 for Google AI Pro? For $28 you get Gemini plus GPT, Claude, DeepSeek and Llama in one app.
2. You picked Gemini. For $8 more you can ask GPT and Claude the same question and compare.
Headline: $8 more than Google AI Pro / Description: GPT, Claude and more included

Check before launch: re-check all three prices the day they go live.

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
Batch-01 M01 (the math), batch-02 M06 (hot dog), batch-02 M07 ($8 more, all three apps in one post), plus M08 once you approve the text. Batch-01 M05 is the retargeting ad.

## Highest ceiling, not built
A 20 to 30 second selfie video of you asking MODUS the hot dog question and reacting to the split. Founder-on-camera video is the top Meta format for cold traffic. I can write the script.
