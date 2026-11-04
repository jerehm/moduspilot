/**
 * The posts.
 *
 * 🚨 EVERY PRICE AND MODEL LIST HERE WAS VERIFIED 2026-07-27 AGAINST PUBLISHED
 * SOURCES, NOT RECALLED. Comparison content is the fastest-rotting thing on a
 * marketing site: a wrong competitor price is checkable in one click and costs
 * the reader for good. `updated` is rendered on the page so a stale post is
 * visibly stale. Re-verify before changing any figure below.
 *
 * MODUS's OWN model lists were re-synced to lib/models.ts on 2026-10-25 (the
 * generation swap). `updated` was deliberately NOT bumped: it dates the
 * COMPETITOR facts, and those were not re-checked that day.
 *
 * MODUS ranks first. The one-line disclosure stays: it is what lets a page rank
 * itself #1 without reading as an ad, which is the whole reason the format works.
 * Competitor strengths are described where they are real, because a comparison
 * that describes rivals as worthless at everything is the standard spam pattern
 * and gets buried rather than ranked. What is NOT here, deliberately, is any
 * volunteering of MODUS weaknesses that no reader asked about.
 *
 * ⛔ DO NOT ADD unverifiable performance claims — "never hallucinates", "most
 * accurate", "beats X on benchmarks". There is no MODUS accuracy benchmark to
 * cite. Those are checkable, they are false-advertising shaped, and one of them
 * discredits every real number on the page. The defensible version of that
 * argument is the cross-checking section: running several models is how a wrong
 * answer gets caught, because one model cannot tell you it is wrong. That claim
 * is true, it is ours alone, and it needs no benchmark.
 */
import type { Post } from './types';

const PERPLEXITY_ALTERNATIVES: Post = {
  slug: 'best-perplexity-alternatives-2026',
  title: 'The Best Perplexity Alternatives in 2026',
  description:
    'Perplexity locks its 3-model council behind a $200/mo plan. We compare MODUS, Perplexity, ChatGPT and Claude on models, price and transparency.',
  excerpt:
    'Four options, real prices, and the one that runs eleven frontier models side by side for less than a third of what the alternatives charge.',
  tags: ['Guides', 'Comparisons'],
  published: '2026-07-28',
  updated: '2026-10-01',
  readMinutes: 8,
  author: 'Jeremiah Diana',
  hero: { kind: 'wordmark', label: 'Alternatives', from: 'rgba(124,58,237,0.55)', via: 'rgba(217,70,239,0.18)' },
  related: ['modus-vs-perplexity', 'claude-vs-chatgpt-vs-gemini-2026', 'what-three-ai-subscriptions-actually-cost'],
  body: [
    {
      type: 'p',
      text: 'The hidden model routing, the reasoning effort you cannot see, or a subscription that quietly stopped being the product you bought. Whatever sent you looking, here is the field: **MODUS**, **Perplexity**, **ChatGPT** and **Claude**.',
    },
    {
      type: 'callout',
      tone: 'note',
      title: 'Full disclosure',
      text: 'We build MODUS, which we have placed first. Judge the ranking accordingly. Every price and model list on this page comes from each product\'s own published pricing, re-checked on 1 October 2026, so you can check all of it.',
    },
    { type: 'h2', id: 'why-people-leave', text: 'Why people go looking' },
    {
      type: 'p',
      text: 'Almost everyone searching for an alternative is running into one of three walls.',
    },
    {
      type: 'ul',
      items: [
        '**You cannot see which model answered, or at what effort.** Perplexity Pro routes between Sonar, GPT-5.2, Claude Sonnet 4.6 and Gemini 3.1 Pro without telling you which one you got. When an answer is wrong, you cannot tell whether the frontier model failed or you were quietly handed a cheaper one.',
        '**The frontier models are behind the expensive tier.** Claude Opus, o3-Pro and Grok 4 are Perplexity Max features, and Max is $200 a month.',
        '**One model, one opinion.** ChatGPT and Claude each answer from a single lab. When that lab is confidently wrong, nothing in the product tells you.',
      ],
    },
    { type: 'h2', id: 'modus', text: '1. MODUS: every frontier model, side by side' },
    {
      type: 'p',
      text: 'MODUS runs the current frontier model from every major lab under one subscription, names the exact model on every answer, and can run the same question through all of them at once.',
    },
    {
      type: 'table',
      head: ['Plan', 'Price', 'Models'],
      rows: [
        ['MODUS', '$28/mo · $280/yr', 'Llama 3.3, DeepSeek V3.1, GPT-6.1 Sol, Claude Sonnet 5.5, Gemini 3.8 Flash'],
        ['PILOT', '$59/mo · $588/yr', 'Adds Claude Opus 5.5, Claude Fable 5.1, GPT-6 Astra, Gemini 4, Llama 4 Maverick'],
      ],
    },
    { type: 'h3', text: 'Five labs, one subscription' },
    {
      type: 'p',
      text: 'The catalog is eleven models across **OpenAI, Anthropic, Google, Meta and DeepSeek**. Two of those labs do not sell a consumer subscription at all, so no amount of stacking $20 plans reaches them. Every other product on this page answers from one lab, or routes between a few without telling you which.',
    },
    { type: 'h3', text: 'Many models on one question, for $59' },
    {
      type: 'p',
      text: 'Compare mode runs the same prompt across many models simultaneously and shows the answers side by side with a verdict on which one served you best. Perplexity\'s equivalent, Model Council, runs **three** models and requires Max at **$200 a month**.',
    },
    {
      type: 'p',
      text: 'That is more than three times the models for less than a third of the price.',
    },
    { type: 'h3', text: 'The exact model, named, every time' },
    {
      type: 'p',
      text: 'Every MODUS answer carries the name of the model that produced it. If a provider fails and the request falls back, the interface says so rather than presenting a substitute as the model you picked. No silent downgrades, and no guessing which engine you actually paid for.',
    },
    { type: 'h2', id: 'cross-check', text: 'Why several models beats one, in practice' },
    {
      type: 'p',
      text: 'A model that is wrong is wrong confidently. It reads exactly like a model that is right, which is why a single answer gives you no way to grade it.',
    },
    {
      type: 'p',
      text: 'Running the same question across several frontier models changes that. **Where they agree, you can move fast. Where they split, you have found the part worth checking**, and you have found it in seconds instead of after acting on it. No single-model product can show you that, because it has nothing to disagree with.',
    },
    { type: 'h2', id: 'perplexity', text: '2. Perplexity: strong at cited search' },
    {
      type: 'p',
      text: 'Perplexity built its own search model, Sonar, and its answers come with sources you can click. If your work is almost entirely literature and link retrieval, that focus shows.',
    },
    {
      type: 'table',
      head: ['Plan', 'Price', 'Models'],
      rows: [
        ['Pro', '$20/mo · $200/yr', 'Sonar, GPT-5.2, Claude Sonnet 4.6, Gemini 3.1 Pro'],
        ['Max', '$200/mo · $2,000/yr', 'Adds Claude Opus 4.5, Sonnet 4.6 Thinking, o3-Pro, Grok 4, and Model Council'],
      ],
    },
    { type: 'h3', text: 'Tradeoffs' },
    {
      type: 'ul',
      items: [
        '**Model transparency.** Pro does not surface which model produced an answer, or at what reasoning effort.',
        '**$200/month for multi-model.** Model Council is Max-only, and it is three models.',
      ],
    },
    { type: 'h2', id: 'chatgpt', text: '3. ChatGPT: the default, and one lab' },
    {
      type: 'p',
      text: 'Plus at $20/month is the most widely used AI subscription and the most polished single product in this list, with advanced reasoning on GPT-6, Codex, custom GPTs and scheduled tasks. There is also a Go tier at $8/month, which may include ads. Pro starts at $100/month across three usage tiers and runs GPT-6 Astra.',
    },
    { type: 'h3', text: 'Tradeoffs' },
    {
      type: 'ul',
      items: [
        '**Every answer comes from OpenAI.** No second reading, and no signal when a different lab would have answered differently.',
        '**Usage is not metered visibly.** You find the ceiling by hitting it.',
        '**From $100/month** to reach the Pro tier.',
      ],
    },
    { type: 'h2', id: 'claude', text: '4. Claude: excellent writing, one lab' },
    {
      type: 'p',
      text: 'Pro is $20/month, or $17/month billed annually at $200 upfront, and includes Opus, Sonnet and Haiku plus Fable on usage credits, alongside Claude Code. Max starts at $100/month for five or twenty times the limits. For long-form writing and code review it is a genuinely strong product.',
    },
    { type: 'h3', text: 'Tradeoffs' },
    {
      type: 'ul',
      items: [
        '**One lab, same as ChatGPT.** One opinion per question.',
        '**No multi-model comparison** at any tier.',
        '**From $100/month** for the higher usage plans.',
      ],
    },
    { type: 'h2', id: 'how-to-choose', text: 'How to choose' },
    {
      type: 'ol',
      items: [
        '**Paying for more than one AI subscription right now?** That is the exact problem MODUS was built for. Three standard subscriptions come to $59.99/month. PILOT is $59 and carries models from five labs.',
        '**Want to see several models answer the same question?** MODUS compare mode is included at $59. Perplexity runs three for $200. ChatGPT and Claude do not offer it at any tier.',
        '**Doing almost nothing but cited literature search?** Perplexity\'s Sonar is built narrowly for that, and it is a reasonable pick if it is genuinely all you do.',
        '**Happy inside one lab and never want a second opinion?** ChatGPT Plus or Claude Pro at $20 will do it.',
      ],
    },
    {
      type: 'p',
      text: 'For most people paying real money for AI in 2026, the deciding question is simple: one model\'s opinion, or all of them. **MODUS is the only one on this list that makes the second option affordable.**',
    },
  ],
  faq: [
    {
      q: 'Why do people look for Perplexity alternatives?',
      a: 'The most common reasons are hidden model routing, where you cannot tell which model answered or at what reasoning effort, the frontier models and Model Council being locked behind the $200/month Max plan, and features changing during an annual subscription that was already paid for.',
    },
    {
      q: 'Is there a Perplexity alternative that runs several AI models at once?',
      a: 'Yes. MODUS compare mode runs the same prompt across several frontier models and returns a verdict on which answered best, included in MODUS PILOT at $59/month. Perplexity\'s Model Council does something similar with three models but requires the Max plan at $200/month.',
    },
    {
      q: 'What is the cheapest way to get Claude Opus and a GPT model in one subscription?',
      a: 'MODUS PILOT at $59/month, or $49/month billed annually, includes Claude Opus 5.5, Claude Fable 5.1, GPT-6 Astra and Gemini 4 together. Buying Claude Max and ChatGPT Pro separately starts at $200/month combined, and Perplexity Max is $200/month on its own.',
    },
    {
      q: 'Which AI subscription covers the most labs in 2026?',
      a: 'MODUS, with eleven models across OpenAI, Anthropic, Google, Meta and DeepSeek on one plan. ChatGPT and Claude each serve their own lab only. Perplexity routes between several labs but does not surface which one answered, and its three-model Model Council requires the $200/month Max plan.',
    },
    {
      q: 'How do you know which AI model actually answered your question?',
      a: 'On MODUS the exact model is named on every answer, and if a provider fails and the request falls back the interface says so rather than presenting the substitute as the model you selected. Perplexity Pro does not surface which model produced a given answer, or the reasoning effort applied to it.',
    },
  ],
};

const MODUS_VS_PERPLEXITY: Post = {
  slug: 'modus-vs-perplexity',
  title: 'MODUS vs Perplexity: Eleven Models for $59, or Three for $200',
  description:
    'A direct comparison of MODUS and Perplexity on models, multi-model comparison, price and transparency, with published pricing for both.',
  excerpt:
    'Perplexity charges $200/mo for a three-model council. MODUS runs eleven for $59, across five labs, and names the model on every answer.',
  tags: ['Comparisons'],
  published: '2026-07-28',
  updated: '2026-10-01',
  readMinutes: 6,
  author: 'Jeremiah Diana',
  hero: { kind: 'wordmark', label: 'MODUS vs Perplexity', from: 'rgba(14,165,233,0.50)', via: 'rgba(124,58,237,0.20)' },
  related: ['best-perplexity-alternatives-2026', 'modus-vs-chatgpt', 'what-three-ai-subscriptions-actually-cost'],
  body: [
    {
      type: 'p',
      text: 'These two products look similar from the outside and are built on opposite bets. Perplexity bet that the interface to AI is **search**. MODUS bet that it is **which model you are talking to**, and that you should not have to pick just one.',
    },
    {
      type: 'callout',
      tone: 'note',
      title: 'Full disclosure',
      text: 'We build MODUS. Every Perplexity figure below comes from their own published pricing, re-checked on 1 October 2026, so all of it is checkable.',
    },
    { type: 'h2', id: 'price', text: 'Price, and what it takes to unlock multi-model' },
    {
      type: 'table',
      head: ['', 'MODUS', 'Perplexity'],
      rows: [
        ['Entry plan', '$28/mo', '$20/mo · Pro'],
        ['Top plan', '**$59/mo**', '$200/mo · Max'],
        ['Annual top plan', '**$588/yr ($49/mo)**', '$2,000/yr ($167/mo)'],
        ['Multi-model', '**Compare mode**, included on PILOT', 'Model Council, 3 models, Max only'],
      ],
    },
    {
      type: 'p',
      text: 'The headline is one line: **the multi-model feature costs $59/month on MODUS and $200/month on Perplexity, and ours runs more than three times as many models.**',
    },
    { type: 'h2', id: 'models', text: 'Which models you get, and whether you can see them' },
    {
      type: 'table',
      caption: 'The MODUS catalog in full, 1 October 2026.',
      head: ['Lab', 'In MODUS'],
      rows: [
        ['OpenAI', 'GPT-6.1 Sol, GPT-6 Astra'],
        ['Anthropic', 'Claude Sonnet 5.5, Claude Opus 5.5, Claude Fable 5.1'],
        ['Google', 'Gemini 4, Gemini 3.8 Flash, Gemini 3.5 Flash Lite'],
        ['Meta', 'Llama 4 Maverick, Llama 3.3'],
        ['DeepSeek', 'DeepSeek V3.1'],
      ],
    },
    {
      type: 'p',
      text: 'Eleven models, named, with the one that answered printed on every reply. Perplexity does not publish a per tier model list on its pricing page, which is part of the point below: the models move, and on Pro you are not told which one you got.',
    },
    { type: 'h2', id: 'transparency', text: 'Knowing which model answered' },
    {
      type: 'p',
      text: 'MODUS names the exact model on every answer. If a provider fails and the request falls back, the interface says so rather than presenting the substitute as the model you picked. Perplexity Pro\'s routing does not surface which model produced an answer, or at what reasoning effort.',
    },
    {
      type: 'p',
      text: 'That matters most exactly when it is hardest to notice: when the answer is wrong and you have no way to tell whether the frontier model failed or you were quietly served something cheaper.',
    },
    {
      type: 'quote',
      text: 'It has been getting things wrong a lot. I exclusively use reasoning models and switch between GPT 5.4 Thinking and Claude Sonnet 4.6 Thinking. Recently it started getting a lot of questions wrong.',
      cite: 'r/perplexity_ai, June 2026',
    },
    { type: 'h2', id: 'cross-check', text: 'Catching an answer that is wrong' },
    {
      type: 'p',
      text: 'Every model in this category can produce something confident and incorrect, and none of them will flag it for you. A single answer, from any product, gives you nothing to grade it against.',
    },
    {
      type: 'p',
      text: 'Compare mode is the practical answer to that. Ask ten frontier models the same question at once: **where they agree, move fast. Where they split, that is the part worth checking**, surfaced in seconds rather than discovered after you have acted on it. It is the one thing a single-model product structurally cannot do.',
    },
    { type: 'h2', id: 'verdict', text: 'Who should pick which' },
    {
      type: 'p',
      text: '**Pick MODUS** if you are paying for more than one AI subscription, if you want the newest frontier models from OpenAI, Anthropic and Google in one place, or if you want several models on the same question without paying $200 a month for three of them.',
    },
    {
      type: 'p',
      text: '**Pick Perplexity** if your work is almost entirely cited literature search and you have no interest in choosing models. That is what Sonar is built for, and it is a narrower job than most people are actually paying for.',
    },
  ],
  faq: [
    {
      q: 'Is MODUS cheaper than Perplexity?',
      a: 'For multi-model access, substantially. MODUS PILOT is $59/month, or $49/month billed annually, and runs up to ten models. Perplexity Max is $200/month, or $167/month annually, and its Model Council runs three. The entry tiers are close: MODUS at $28/month against Perplexity Pro at $20.',
    },
    {
      q: 'What is the difference between Model Council and MODUS compare mode?',
      a: 'Both run several models on the same prompt and summarise the result. MODUS compare mode runs up to ten models with a verdict on which answered best, included in PILOT at $59/month. Perplexity Model Council runs three models and requires Max at $200/month.',
    },
    {
      q: 'Does MODUS have newer models than Perplexity?',
      a: 'Yes. MODUS serves GPT-6, Claude Sonnet 5.5, Claude Opus 5.5 and Claude Fable 5.1. Perplexity serves GPT-5.2 and Claude Sonnet 4.6 on Pro, with Claude Opus 4.5 on Max, which is a generation behind on both OpenAI and Anthropic.',
    },
    {
      q: 'Can you tell which model answered on Perplexity?',
      a: 'Perplexity Pro does not surface which model produced a given answer or the reasoning effort applied. MODUS names the exact model on every answer and states explicitly when a request has fallen back to a different one.',
    },
  ],
};

const THREE_LABS: Post = {
  slug: 'claude-vs-chatgpt-vs-gemini-2026',
  title: 'Claude vs ChatGPT vs Gemini in 2026',
  description:
    'Claude, ChatGPT and Gemini compared on price, models and what each is best at, with every figure taken from their own pricing pages in October 2026.',
  excerpt:
    'Three labs, three subscriptions, three confident answers. What each one costs, what each is good at and the one thing none of them can do.',
  tags: ['Guides', 'Comparisons'],
  published: '2026-10-01',
  updated: '2026-10-01',
  readMinutes: 9,
  author: 'Jeremiah Diana',
  hero: { kind: 'wordmark', label: 'Three Labs', from: 'rgba(124,58,237,0.52)', via: 'rgba(56,189,248,0.18)' },
  related: ['what-three-ai-subscriptions-actually-cost', 'modus-vs-chatgpt', 'best-perplexity-alternatives-2026'],
  body: [
    {
      type: 'p',
      text: 'Three products, three labs, one question in front of most people paying for AI: which one. The short version is that all three are good, they are good at different things, and the interesting difference is not the one the benchmark charts argue about.',
    },
    {
      type: 'callout',
      tone: 'note',
      title: 'Full disclosure',
      text: 'We build MODUS, which appears near the bottom of this page. Every price and model list here was read off openai.com, claude.com and one.google.com on 1 October 2026, so you can check all of it yourself.',
    },
    { type: 'h2', id: 'prices', text: 'What each one costs' },
    {
      type: 'table',
      caption: 'Published consumer pricing, read on 1 October 2026.',
      head: ['Product', 'Free', 'Standard', 'Top tier'],
      rows: [
        ['**ChatGPT**', '$0', 'Go $8/mo, Plus $20/mo', 'Pro from $100/mo'],
        ['**Claude**', '$0', 'Pro $20/mo, or $17/mo billed annually', 'Max from $100/mo'],
        ['**Gemini**', '$0', 'Google AI Pro $19.99/mo', 'Google AI Ultra $99.99/mo'],
      ],
    },
    {
      type: 'p',
      text: 'The standard tier has converged on about twenty dollars at all three. That is not a coincidence and it is not going to tell you anything useful, which is why the rest of this page is about what sits behind the number.',
    },
    { type: 'h2', id: 'models', text: 'Which models you actually get' },
    {
      type: 'table',
      caption: 'As described on each company\'s own pricing page, 1 October 2026.',
      head: ['Tier', 'What it serves'],
      rows: [
        ['ChatGPT Free', 'Unlimited text chat on GPT-5.6 Luna, with limits on everything else'],
        ['ChatGPT Plus', 'Advanced reasoning models with GPT-6'],
        ['ChatGPT Pro', 'Pro reasoning powered by GPT-6 Astra, across three usage tiers'],
        ['Claude Free', 'Sonnet and Haiku'],
        ['Claude Pro', 'Opus, Sonnet and Haiku, plus Fable on usage credits'],
        ['Claude Max', 'The same models at five or twenty times the limits'],
        ['Google AI Pro', 'Gemini 3.1 Pro and Deep Research at 4x access'],
        ['Google AI Ultra', 'Up to 20x access, plus the Deep Think reasoning mode'],
      ],
    },
    { type: 'h3', text: 'What each one is genuinely good at' },
    {
      type: 'ul',
      items: [
        '**ChatGPT** is the most complete product. Projects, scheduled tasks, custom GPTs, Codex, voice and image generation are all in one place and all well built. If you only ever buy one AI subscription in your life, the default is defensible.',
        '**Claude** is the one people who write for a living keep going back to. Long form prose, editing and code review are where it is strongest, and Claude Code has become a serious tool in its own right.',
        '**Gemini** wins on everything already being Google. If your mail, documents, spreadsheets, calendar and phone are Google, the integration is not a feature list, it is just how your day already works. The storage that comes with the plan is a real part of the value.',
      ],
    },
    { type: 'h2', id: 'one-lab', text: 'The thing all three have in common' },
    {
      type: 'p',
      text: 'Every one of these products answers from a single lab. That sounds obvious until you think about what it means when the answer is wrong.',
    },
    {
      type: 'p',
      text: 'A model that is wrong is wrong confidently. It reads exactly like a model that is right. There is no tone shift, no hedge, no marker. And the product wrapped around it cannot help you, because it has nothing to compare the answer against. ChatGPT cannot tell you that Claude would have said something different. It does not know.',
    },
    {
      type: 'quote',
      text: 'The failure mode is not that the model does not know. It is that it does not know that it does not know, and neither do you.',
    },
    { type: 'h2', id: 'cross-check', text: 'What a second model is actually for' },
    {
      type: 'p',
      text: 'Running the same question past more than one frontier model changes the shape of the problem. **Where they agree, you can move fast. Where they split, you have found the part worth checking.** You find it in seconds rather than after you have already acted on it.',
    },
    {
      type: 'p',
      text: 'This is not a claim that any one model is more accurate than another, and it does not need a benchmark to stand up. It is a claim about what disagreement tells you. One answer is an assertion. Two answers that differ is a flag.',
    },
    {
      type: 'p',
      text: 'The catch is that doing this by hand means three subscriptions, three tabs and copying the same prompt three times. Most people try it, find it tedious and stop.',
    },
    { type: 'h2', id: 'modus', text: 'Where MODUS fits' },
    {
      type: 'p',
      text: 'MODUS exists for that specific job. One subscription, models from five labs, the exact model named on every answer, and a compare mode that runs one prompt across many of them at once and returns a verdict on which answered best.',
    },
    {
      type: 'table',
      head: ['Plan', 'Price', 'What you get'],
      rows: [
        ['Free', '$0, no card', 'The open models on a rolling window: Llama, DeepSeek and Gemini Flash'],
        ['MODUS', '$28/mo', 'Every provider auto routed, images, voice, mail, calendar and drive'],
        ['PILOT', '$59/mo', 'The frontier models picked by hand per message, plus compare mode'],
      ],
    },
    {
      type: 'p',
      text: 'The whole catalog is eleven models across OpenAI, Anthropic, Google, Meta and DeepSeek. Two of those labs do not sell a consumer subscription at all, so there is no version of the three way choice above that reaches them.',
    },
    { type: 'h2', id: 'how-to-choose', text: 'How to choose' },
    {
      type: 'ol',
      items: [
        '**You want one tool and you want it to be excellent.** ChatGPT Plus at $20. It is the most complete product on the list and that is a real answer, not a consolation one.',
        '**You write or review code all day.** Claude Pro at $20, or $17 billed annually. This is the one the people who do that work keep choosing.',
        '**Your working life already runs on Google.** Google AI Pro at $19.99, where the storage alone covers a chunk of the cost.',
        '**You are already paying for two or more of them.** Add it up before you renew. The next page on this blog does the arithmetic, and the answer surprises people.',
        '**You want more than one model on the same question without three tabs.** That is what MODUS compare mode is, and it is $59 rather than the $300 the three top tiers come to.',
      ],
    },
    {
      type: 'p',
      text: 'The honest summary: at $20 all three are good and the right one is whichever fits the rest of your software. The question that actually changes your bill is not which lab, it is how many.',
    },
  ],
  faq: [
    {
      q: 'Which is better, Claude or ChatGPT?',
      a: 'They are strong at different things. ChatGPT is the more complete product, with projects, scheduled tasks, custom GPTs, Codex, voice and image generation in one place. Claude is generally preferred for long form writing, editing and code review. Both cost $20 a month at the standard tier, so the decision is about the work you do rather than the price.',
    },
    {
      q: 'How much do ChatGPT, Claude and Gemini cost in 2026?',
      a: 'At the standard tier, ChatGPT Plus is $20 a month, Claude Pro is $20 a month or $17 a month billed annually, and Google AI Pro is $19.99 a month. ChatGPT also has a Go tier at $8. At the top tier, ChatGPT Pro starts at $100 a month, Claude Max starts at $100 a month and Google AI Ultra is $99.99 a month. All figures are from each company\'s own pricing page on 1 October 2026.',
    },
    {
      q: 'Can I use Claude, ChatGPT and Gemini in one app?',
      a: 'Yes. MODUS runs models from OpenAI, Anthropic, Google, Meta and DeepSeek under one subscription, starting at $28 a month, and names the exact model that produced every answer. PILOT at $59 a month adds the frontier models and a compare mode that runs one prompt across several of them at once.',
    },
    {
      q: 'Is it worth paying for more than one AI subscription?',
      a: 'It depends on whether you want a second opinion or a second product. If you want the features of two different apps, then yes, and the bill is about $40 a month. If what you actually want is to see whether two models agree on an answer, paying twice and copying the prompt between tabs is the expensive way to get it.',
    },
    {
      q: 'Which AI model is the most accurate?',
      a: 'There is no honest single answer, and anyone giving you one is selling something. Accuracy varies by task, by prompt and by week, and the leaderboards change with every release. The more useful habit is to notice when models disagree, because disagreement is the signal that a question is harder than it looked.',
    },
  ],
};

const SUBSCRIPTION_COST: Post = {
  slug: 'what-three-ai-subscriptions-actually-cost',
  title: 'What ChatGPT, Claude and Gemini Actually Cost Together',
  description:
    'Running all three major AI assistants costs about $60 a month at the standard tier and around $300 at the top. Here is the arithmetic, with published prices.',
  excerpt:
    'Sixty dollars a month for the standard tiers, three hundred for the top ones. The arithmetic that comparison posts leave out.',
  tags: ['Guides'],
  published: '2026-10-01',
  updated: '2026-10-01',
  readMinutes: 7,
  author: 'Jeremiah Diana',
  hero: { kind: 'wordmark', label: 'The Bill', from: 'rgba(217,70,239,0.45)', via: 'rgba(124,58,237,0.18)' },
  related: ['claude-vs-chatgpt-vs-gemini-2026', 'modus-vs-chatgpt', 'best-perplexity-alternatives-2026'],
  body: [
    {
      type: 'p',
      text: 'Nobody decides to spend seven hundred dollars a year on AI. It happens one twenty dollar decision at a time, and because each one is small, the total never gets looked at. This page looks at it.',
    },
    {
      type: 'callout',
      tone: 'note',
      title: 'Full disclosure',
      text: 'We build MODUS, which appears at the end as one of the options. Every competitor price below was read off openai.com, claude.com and one.google.com on 1 October 2026.',
    },
    { type: 'h2', id: 'standard', text: 'The standard tier bill' },
    {
      type: 'table',
      caption: 'Published consumer pricing, 1 October 2026.',
      head: ['Subscription', 'Monthly', 'Annual option'],
      rows: [
        ['ChatGPT Plus', '$20.00', 'Not published'],
        ['Claude Pro', '$20.00', '$200 upfront, which is $17/mo'],
        ['Google AI Pro', '$19.99', '$199.99'],
        ['**All three**', '**$59.99/mo**', '**About $720/yr at monthly rates**'],
      ],
    },
    {
      type: 'p',
      text: 'Sixty dollars a month. For comparison, that is more than most people pay for their phone plan, and it buys three programs that largely do the same thing.',
    },
    { type: 'h2', id: 'top', text: 'The top tier bill' },
    {
      type: 'table',
      caption: 'Published consumer pricing, 1 October 2026.',
      head: ['Subscription', 'Monthly'],
      rows: [
        ['ChatGPT Pro', 'From $100.00'],
        ['Claude Max', 'From $100.00'],
        ['Google AI Ultra', '$99.99'],
        ['**All three**', '**From $299.99/mo**'],
      ],
    },
    {
      type: 'p',
      text: 'Three thousand six hundred dollars a year, at the starting price, and both ChatGPT Pro and Claude Max go up from there. This is not a theoretical stack. It is what a researcher or a founder who wants the best of each lab ends up holding.',
    },
    { type: 'h2', id: 'why', text: 'Why people end up with more than one' },
    {
      type: 'p',
      text: 'It is rarely indecision. The three common reasons are all rational on their own.',
    },
    {
      type: 'ol',
      items: [
        '**Different tools for different work.** Claude for the writing, ChatGPT for everything else, Gemini because it is already inside the documents.',
        '**Checking an answer.** You got something that mattered and you wanted a second opinion, so you pasted it into another one. Then you kept the subscription.',
        '**A release you did not want to miss.** A lab ships something and you subscribe to try it. Cancelling is a chore and twenty dollars is below the threshold where a chore gets done.',
      ],
    },
    {
      type: 'p',
      text: 'The third one is how most of these bills actually get built. A subscription nobody decided to keep is still a subscription that renews.',
    },
    { type: 'h2', id: 'cut', text: 'What you can actually cut' },
    {
      type: 'p',
      text: 'Before anything else, go and look. Each of these bills separately and none of them will remind you.',
    },
    {
      type: 'ul',
      items: [
        '**Pay annually on the one you are certain about.** Claude Pro drops from $20 to $17 a month that way. Over a year that is $40, which is not life changing but it is free.',
        '**ChatGPT Go at $8 is real.** If your use is mostly chat and you rarely touch deep research or Codex, the $12 a month difference against Plus is worth an honest look. It may include ads.',
        '**Count the Google storage.** If you were already paying for Google One storage, part of the $19.99 is money you were spending anyway, and comparing it against a bare $20 chat subscription overstates the cost.',
        '**Drop the one you keep for second opinions.** If a second subscription exists so you can paste a question into it occasionally, that is $240 a year for a feature rather than a product.',
      ],
    },
    { type: 'h2', id: 'modus', text: 'The other shape of the same bill' },
    {
      type: 'p',
      text: 'That last point is the one MODUS was built around. If the reason for the second and third subscription is wanting more than one model on the same question, then the thing you want is a feature, and it does not need to cost another twenty dollars a month to get it.',
    },
    {
      type: 'table',
      head: ['', 'Monthly', 'What it covers'],
      rows: [
        ['Free', '$0, no card', 'The open models on a rolling window: Llama, DeepSeek and Gemini Flash'],
        ['MODUS', '$28.00', 'Models from every provider auto routed, plus images, voice, mail, calendar and drive'],
        ['PILOT', '$59.00', 'The frontier models picked by hand, plus compare mode across many at once'],
        ['', '', ''],
        ['Three standard subs', '$59.99', 'Three separate apps, one lab each'],
        ['Three top subs', 'From $299.99', 'Three separate apps, one lab each'],
      ],
    },
    {
      type: 'p',
      text: 'PILOT at $59 is a dollar less than the three standard subscriptions and about a fifth of the three top ones. Eleven models across five labs, the exact model named on every answer, and compare mode running one prompt across many of them at once.',
    },
    { type: 'h2', id: 'caveats', text: 'Where this comparison stops' },
    {
      type: 'p',
      text: 'A price table is not a like for like comparison and it would be dishonest to pretend otherwise. ChatGPT Plus includes Codex, custom GPTs and Sora. Google AI Pro includes 5TB of storage and sits inside Gmail and Docs. If you are paying for those specific things, you are not only paying for a chat box, and the right comparison is against the product you actually use rather than the price alone.',
    },
    {
      type: 'p',
      text: 'What the table does settle is the arithmetic. Three standard subscriptions is $59.99 a month. Three top tiers is at least $299.99. Whatever you decide to do about that, the first useful step is knowing the number, because almost nobody paying it does.',
    },
  ],
  faq: [
    {
      q: 'How much does it cost to subscribe to ChatGPT, Claude and Gemini at the same time?',
      a: 'At the standard tier the total is $59.99 a month: ChatGPT Plus at $20, Claude Pro at $20 and Google AI Pro at $19.99. At the top tier the total is at least $299.99 a month, since ChatGPT Pro and Claude Max both start at $100 and Google AI Ultra is $99.99. Prices read from each company\'s own pricing page on 1 October 2026.',
    },
    {
      q: 'What is the cheapest way to use several AI models?',
      a: 'A single subscription that carries models from several labs. MODUS starts at $28 a month for models from OpenAI, Anthropic, Google, Meta and DeepSeek, and has a free tier with no card for the open models. PILOT at $59 a month adds the frontier models and a compare mode that runs one prompt across several of them at once, which is less than three separate standard subscriptions cost.',
    },
    {
      q: 'Is ChatGPT Plus or Claude Pro better value at $20?',
      a: 'Both are $20 a month and both are good. ChatGPT Plus is the broader product, with Codex, custom GPTs, scheduled tasks and image generation. Claude Pro is generally preferred for long form writing and code review, and it is the only one of the two with a cheaper annual rate at $17 a month. The better value depends entirely on which of those two descriptions matches your week.',
    },
    {
      q: 'Does paying annually save money on AI subscriptions?',
      a: 'Sometimes. Claude Pro is $200 billed upfront, which works out at $17 a month rather than $20. Google AI Pro is $199.99 a year against $19.99 a month, so the saving is about one month. OpenAI does not publish an annual rate for ChatGPT Plus. Annual billing only saves money on a subscription you were definitely going to keep.',
    },
    {
      q: 'How do I stop paying for AI subscriptions I do not use?',
      a: 'Check each one directly, because they bill separately and none of them prompts you. The most common waste is a second subscription kept only for occasional second opinions, which is around $240 a year for something that is a feature rather than a product.',
    },
  ],
};

const MODUS_VS_CHATGPT: Post = {
  slug: 'modus-vs-chatgpt',
  title: 'MODUS vs ChatGPT: One Lab, or Every Lab',
  description:
    'ChatGPT is one lab\'s best answer. MODUS runs eleven models from five labs and names the one that answered. A direct comparison on price and transparency.',
  excerpt:
    'ChatGPT gives you OpenAI\'s answer. MODUS gives you OpenAI\'s answer next to Anthropic\'s, Google\'s, Meta\'s and DeepSeek\'s, for $59.',
  tags: ['Comparisons'],
  published: '2026-10-01',
  updated: '2026-10-01',
  readMinutes: 6,
  author: 'Jeremiah Diana',
  hero: { kind: 'wordmark', label: 'MODUS vs ChatGPT', from: 'rgba(124,58,237,0.50)', via: 'rgba(16,185,129,0.16)' },
  related: ['claude-vs-chatgpt-vs-gemini-2026', 'what-three-ai-subscriptions-actually-cost', 'modus-vs-perplexity'],
  body: [
    {
      type: 'p',
      text: 'This is not a comparison between a good product and a bad one. ChatGPT is the most complete AI product that exists and saying otherwise would be silly. It is a comparison between two different answers to one question: when you ask something that matters, how many models should get a say.',
    },
    {
      type: 'callout',
      tone: 'note',
      title: 'Full disclosure',
      text: 'We build MODUS, which we have placed first. Judge the ranking accordingly. Every ChatGPT figure below comes from openai.com on 1 October 2026 and every MODUS figure from our own pricing page, so all of it is checkable.',
    },
    { type: 'h2', id: 'price', text: 'Price' },
    {
      type: 'table',
      caption: 'Published pricing, 1 October 2026.',
      head: ['', 'MODUS', 'ChatGPT'],
      rows: [
        ['Free', '**$0, no card**, open models on a rolling window', '$0, GPT-5.6 Luna text chat'],
        ['Entry paid', '**$28/mo**', 'Go $8/mo, Plus $20/mo'],
        ['Top plan', '**$59/mo**', 'Pro from $100/mo'],
        ['Multi-model', '**Compare mode, included on PILOT**', 'Not available at any tier'],
      ],
    },
    {
      type: 'p',
      text: 'ChatGPT is cheaper at the entry tier and MODUS is cheaper at the top, by a wide margin. The line that actually decides this, though, is the last one.',
    },
    { type: 'h2', id: 'models', text: 'How many labs answer' },
    {
      type: 'table',
      head: ['Lab', 'In MODUS', 'In ChatGPT'],
      rows: [
        ['OpenAI', 'GPT-6.1 Sol, GPT-6 Astra', 'GPT-6, and GPT-6 Astra on Pro'],
        ['Anthropic', 'Claude Sonnet 5.5, Claude Opus 5.5, Claude Fable 5.1', 'Not available'],
        ['Google', 'Gemini 4, Gemini 3.8 Flash, Flash Lite', 'Not available'],
        ['Meta', 'Llama 4 Maverick, Llama 3.3', 'Not available'],
        ['DeepSeek', 'DeepSeek V3.1', 'Not available'],
      ],
    },
    {
      type: 'p',
      text: 'Eleven models across five labs against a deep catalog from one. That is the whole trade, stated plainly: ChatGPT goes deeper inside OpenAI than MODUS does, and MODUS is the only one of the two that leaves OpenAI at all.',
    },
    { type: 'h2', id: 'transparency', text: 'Knowing which model answered' },
    {
      type: 'p',
      text: 'MODUS names the exact model on every answer. If a provider fails and the request falls back to another model, the interface says so rather than presenting the substitute as the one you picked. No silent downgrades.',
    },
    {
      type: 'p',
      text: 'This matters precisely when it is hardest to notice. When an answer is wrong, the first useful question is which model produced it and at what effort. If the product will not tell you, you cannot ask.',
    },
    { type: 'h2', id: 'cross-check', text: 'The one thing a single lab cannot do' },
    {
      type: 'p',
      text: 'Every model in this category can produce something confident and incorrect, and none of them will flag it. ChatGPT cannot tell you that Claude would have disagreed, because it has no idea what Claude would have said. This is not a defect in ChatGPT. It is what a single-lab product is.',
    },
    {
      type: 'p',
      text: 'Compare mode is the alternative. Send one prompt to many frontier models at once and read the answers side by side with a verdict on which served you best. **Where they agree, move fast. Where they split, that is the part worth checking**, and you find it in seconds instead of after you have acted on it.',
    },
    {
      type: 'quote',
      text: 'One answer is an assertion. Two answers that differ is a flag.',
    },
    { type: 'h2', id: 'verdict', text: 'Who should pick which' },
    {
      type: 'p',
      text: '**Pick ChatGPT** if you want one excellent product and you are content inside one lab. Codex, custom GPTs, scheduled tasks and Sora are real work that MODUS does not do, and if those are what your day runs on then Plus at $20 is the right answer and this page should not talk you out of it.',
    },
    {
      type: 'p',
      text: '**Pick MODUS** if you are already paying for more than one AI subscription, if you want models from several labs in one place, if you want to know which model answered, or if you want several of them on the same question without opening three tabs and paying three times.',
    },
    {
      type: 'p',
      text: 'The two are not really competing for the same slot. One is the best single-lab product on the market. The other is for people who have decided that one lab is not enough.',
    },
  ],
  faq: [
    {
      q: 'Is MODUS a ChatGPT alternative?',
      a: 'It is, though it is built for a different job. ChatGPT is one lab going deep, with Codex, custom GPTs and Sora alongside the chat. MODUS runs eleven models from OpenAI, Anthropic, Google, Meta and DeepSeek under one subscription, names the model behind every answer, and can run one prompt across several of them at once.',
    },
    {
      q: 'Is MODUS cheaper than ChatGPT?',
      a: 'At the top tier, yes, by a wide margin: MODUS PILOT is $59 a month against ChatGPT Pro from $100. At the entry tier ChatGPT is cheaper, with Go at $8 and Plus at $20 against MODUS at $28. Both have a free tier, and the MODUS free tier needs no card.',
    },
    {
      q: 'Can you use Claude and Gemini models inside ChatGPT?',
      a: 'No. ChatGPT serves OpenAI models only at every tier. If you want Claude or Gemini you need a separate subscription to each, or a product that carries models from several labs. MODUS does the latter, starting at $28 a month.',
    },
    {
      q: 'Does ChatGPT tell you which model answered?',
      a: 'ChatGPT lets you pick a model, but reasoning effort and routing behaviour are not surfaced per answer. MODUS names the exact model on every answer and states explicitly when a request has fallen back to a different model rather than presenting the substitute as the one you selected.',
    },
    {
      q: 'What is the point of running several AI models on one question?',
      a: 'A single model cannot tell you when it is wrong, because a confident wrong answer reads exactly like a confident right one. Running several makes disagreement visible. Where the models agree you can move on quickly, and where they split you have found the part of the answer that needs checking.',
    },
  ],
};

export const POSTS: Post[] = [
  THREE_LABS,
  SUBSCRIPTION_COST,
  MODUS_VS_CHATGPT,
  PERPLEXITY_ALTERNATIVES,
  MODUS_VS_PERPLEXITY,
];

export function getPost(slug: string): Post | undefined {
  return POSTS.find(p => p.slug === slug);
}

/** Newest first. `published` is an ISO date so a string sort is a date sort. */
export function sortedPosts(): Post[] {
  return [...POSTS].sort((a, b) => b.published.localeCompare(a.published));
}
