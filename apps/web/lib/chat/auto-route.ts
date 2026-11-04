import { generateText } from 'ai';
import { PLATFORM_MODELS, effectivePlan } from '@/lib/models';
import { SMALL_TALK } from '@/lib/chat/context';
import { isSelfQuery } from '@/lib/chat/self-query';
import { backgroundModel } from '@/lib/chat/model';

/**
 * Auto model routing. When a user leaves the in-chat model switcher on "Auto",
 * MODUS reads the task and picks the model best suited to it — the best writing
 * model for an essay, a reasoning model for math/code, etc. — capped to whatever
 * the user's plan unlocks.
 *
 * Classification is one fast, cheap Groq/Llama call (a few tokens out). On any
 * failure we degrade to 'general' → Llama, so Auto never blocks a chat.
 */


export type TaskCategory = 'writing' | 'research' | 'code' | 'reasoning' | 'general' | 'product';

// Best-first model preference per task category. The router walks each list and
// picks the first model the user's plan unlocks; if none match it falls back to
// Llama (the 'general' default). Ids must exist in PLATFORM_MODELS.
const CATEGORY_PREFERENCE: Record<TaskCategory, string[]> = {
  // Nuanced, human-sounding prose — Claude leads (reads least "AI-generated").
  writing:   ['claude-sonnet-5-5', 'claude-opus-5-5', 'gpt-6.1-sol'],
  // Up-to-date / factual digging. Grok led here for its real-time index and is
  // gone: xAI has no credits, so it could not answer at all (see lib/models.ts).
  // Gemini Flash takes the slot — it's the fastest model on MODUS and this is the
  // category that carries the web-search flag anyway.
  research:  ['gemini-3.8-flash', 'gpt-6.1-sol', 'claude-sonnet-5-5'],
  // Code & math. GPT-6.1 Sol leads on BOTH plans since 2026-10-25: it is
  // newer than the old PILOT lead (5.6 Sol) and costs less than half as much.
  // gpt-6-astra is kept OUT for the same reason as Fable below.
  code:      ['gpt-6.1-sol', 'claude-sonnet-5-5'],
  // Hard multi-step reasoning / strategy.
  //
  // claude-fable-5-1 and gpt-6-astra are DELIBERATELY absent, even though they are
  // the most capable models we serve. At $10/$50 per 1M (2.5x Opus 5.5) they are the
  // priciest things in the catalog, and Auto is the default — routing here would quietly make the most
  // expensive model the standard spend for every PILOT reasoning turn. PILOT's
  // selling point is manual pick per message; let the user choose to spend it.
  // Opus 5.5 (weight 11) leads on PILOT; that is still cheaper than the 5.6 Sol
  // (weight 15) that led here before the swap. MODUS falls through to 6.1 Sol.
  reasoning: ['claude-opus-5-5', 'gpt-6.1-sol', 'claude-sonnet-5-5'],
  // Everyday chat — fast & free.
  general:   ['meta/llama-3.3-70b'],
  // Questions about MODUS itself: which models it has, how Auto routes, what the
  // plan unlocks. The answer is sitting in the system prompt (buildModelCatalogBlock)
  // and the ONLY thing that matters is that the model reads it instead of
  // free-associating from training data — which is exactly what Llama did when it
  // answered "how do u route ur models?" by describing somebody else's product.
  // So this is ranked by instruction-following, not by raw capability, and it is
  // deliberately cheap-ish: these are short, factual, high-frequency questions.
  product:   ['claude-sonnet-5-5', 'gpt-6.1-sol', 'gemini-3.8-flash'],
};

const LLAMA = 'meta/llama-3.3-70b';

// 💸 SAVER routing. When the user picks "Auto (Saver)" the same task categories
// resolve to the cheapest capable model instead of the best one, so the account's
// cost-weighted allowance stretches ~5-7x (a saver code turn on DeepSeek V3.1 is
// weight 2 vs Opus 5.5's 11). Every id here is weight <=2 and modus-reachable,
// pinned as a build gate by scripts/verify-auto-saver.ts — editing an entry
// upward fails that verifier. Research still keeps its web-search flag; it just
// runs on the cheapest model rather than Flash. It is an OPT-IN, never the
// default: plain Auto stays quality-first (CATEGORY_PREFERENCE above).
export const SAVER_PREFERENCE: Record<TaskCategory, string[]> = {
  writing:   [LLAMA],
  research:  ['gemini-3.5-flash-lite'],
  code:      ['deepseek/deepseek-v3.1', LLAMA],
  reasoning: ['deepseek/deepseek-v3.1', LLAMA],
  general:   [LLAMA],
  product:   [LLAMA],
};

const CLASSIFIER_SYSTEM =
  `You are a task router. Read the user's most recent request and classify it into EXACTLY ONE category:\n` +
  `- writing: essays, emails, posts, copy, letters, stories, rewriting/editing prose\n` +
  `- research: questions needing current, factual, or web-sourced information\n` +
  `- code: programming, debugging, scripts, technical/engineering tasks\n` +
  `- reasoning: math, logic, planning, strategy, or hard multi-step problems\n` +
  `- product: questions about MODUS itself — its models, how it routes, plans, pricing, limits, or what it can do\n` +
  `- general: casual conversation, quick questions, task/calendar/personal-assistant actions\n` +
  `Reply with ONLY the single category word, lowercase, nothing else.`;

export function pickModel(
  category: TaskCategory,
  plan: string | null | undefined,
  saver = false,
  /** Only consider models this accepts (e.g. ones that can call tools). */
  accept?: (id: string) => boolean,
): string {
  const ep = effectivePlan(plan);
  const prefs = saver ? SAVER_PREFERENCE[category] : CATEGORY_PREFERENCE[category];
  for (const id of prefs) {
    const model = PLATFORM_MODELS.find(m => m.id === id);
    if (model && model.plans.includes(ep) && (!accept || accept(id))) return id;
  }
  return accept && !accept(LLAMA) ? '' : LLAMA;
}

export interface RouteResult {
  category: TaskCategory;
  modelId: string;
  /** Research tasks turn web search on for the request even if not enabled by default. */
  webSearch: boolean;
}

/**
 * Confident-only regex routing. Returns null when unsure so the caller falls
 * through to the LLM classifier — these patterns must be high-precision, not
 * high-recall. Order matters: code is checked first because code questions
 * often also contain writing/reasoning verbs ("write a function", "solve this
 * bug"), and misrouting code to Llama is the worst outcome.
 */
function heuristicCategory(q: string): TaskCategory | null {
  // Code-shaped prompts must never fall to the classifier's 'general' bucket (→ Llama).
  if (/```|\bdef |\bfunction\b|\bimport |\bclass |=>|console\.|std::|public (static|class)/.test(q)) return 'code';
  const t = q.trim();
  // ⚠️ MUST come before the short-query check below. "ur models?" is two words, so
  // the `< 4` rule would call it small talk and hand a question about MODUS to the
  // weakest model in the catalog. Small talk itself is unaffected: isSelfQuery
  // requires a product noun, and "hi"/"thanks" carry none.
  if (isSelfQuery(t)) return 'product';
  // Greetings/acks are 'general' by definition — no round trip.
  if (SMALL_TALK.test(t)) return 'general';
  // ⚠️ SHORTNESS IS NOT EASINESS. `length < 4` sent every brief question straight
  // to Llama, the weakest model in the catalog: "explain quantum tunnelling",
  // "prove the halting problem", "refactor this hook" are all three words. The
  // fast path is still worth having for genuine throwaways, but a real question
  // — one that asks something, or ends in a question mark — deserves the 1200ms
  // classifier rather than being pre-judged by word count.
  const asksSomething = /\?\s*$/.test(t)
    || /^\s*(explain|why|how|what|when|where|who|which|prove|solve|calculate|compare|debug|fix|refactor|summari[sz]e|translate|write|design|review)\b/i.test(t);
  if (t.split(/\s+/).length < 4 && !asksSomething) return 'general';
  if (/\b(debug|refactor|stack ?trace|compile|typescript|python|javascript|sql query|regex|api endpoint)\b/i.test(t)) return 'code';
  if (/\b(latest|news|current(ly)?|today'?s|price of|search for|look ?up|who won|stock|weather)\b/i.test(t)) return 'research';
  if (/\b(write|draft|rewrite|edit|essay|blog post|caption|copy|linkedin post|tweet|reply to)\b/i.test(t)) return 'writing';
  if (/\b(plan|strategy|prove|calculate|solve|trade-?offs?|step by step)\b/i.test(t)) return 'reasoning';
  return null;
}

/**
 * Classify `queryText` and resolve the best unlocked model for it. Never throws —
 * returns the Llama/general default on any error or empty input.
 */
export async function routeTask(
  queryText: string,
  plan: string | null | undefined,
  opts: { saver?: boolean } = {},
): Promise<RouteResult> {
  const saver = opts.saver ?? false;
  const fallback: RouteResult = { category: 'general', modelId: pickModel('general', plan, saver), webSearch: false };
  if (!queryText.trim()) return fallback;

  // ── Heuristic fast-path ────────────────────────────────────────────────────
  // The classifier is a network round trip that BLOCKS the stream (see below).
  // When a cheap regex is already confident, skip it entirely. Same idea as the
  // code-shaped check that was already here, widened to the other categories.
  // Anything ambiguous still falls through to the LLM classifier.
  const heuristic = heuristicCategory(queryText);
  if (heuristic) {
    console.log(`[route] heuristic=${heuristic}${saver ? ' (saver)' : ''}`);
    return { category: heuristic, modelId: pickModel(heuristic, plan, saver), webSearch: heuristic === 'research' };
  }

  // Only the LLM classifier below needs the Gateway key — the heuristic above
  // needs nothing. This guard used to sit at the top of the function, which meant
  // a missing or rotated AI_GATEWAY_API_KEY silently collapsed EVERY category to
  // 'general' → Llama, including the ones the regex already knew for free and the
  // ones that would have been served by Anthropic's or OpenAI's own key.
  if (!process.env.AI_GATEWAY_API_KEY) return fallback;

  try {
    // Bound the classifier: it runs BEFORE the main stream starts, so if Groq
    // hangs it would stall the entire chat (and eat into the function's time
    // budget). Cap it hard — a slow router must never block the answer; we just
    // fall back to the general/Llama default.
    // The classifier owns its own failure so a Gateway 429 (common on the free
    // tier) resolves to null instead of rejecting, and the cap resolves rather
    // than throwing — the route then falls through to the general default in one
    // place instead of two. Not a leak fix: Promise.race handles every input
    // (scripts/verify-no-unhandled-rejection.ts).
    const classification = generateText({
      // The classifier degrades to 'general' → Llama on failure, which is a
      // silent quality loss on every message while the Gateway is limited: the
      // router stops routing and everything lands on the cheapest model. Give it
      // the same direct-key net the rest of the background work now has.
      model: backgroundModel('meta/llama-3.1-8b', 'route'),
      system: CLASSIFIER_SYSTEM,
      prompt: queryText.slice(0, 2000),
      maxTokens: 4,
      temperature: 0,
    }).catch((e) => {
      // Owned here, so a late rejection can never be unhandled.
      console.error('[route] classifier failed:', String(e).slice(0, 140));
      return null;
    });

    const { text } = (await Promise.race([
      classification,
      // 1200ms, was 3500. meta/llama-3.1-8b with maxTokens:4 answers well
      // inside this; slower than that and the route was going to be stale anyway.
      new Promise<null>(resolve => setTimeout(() => resolve(null), 1200)),
    ])) ?? { text: '' };
    const word = text.trim().toLowerCase().replace(/[^a-z]/g, '');
    const category: TaskCategory =
      (['writing', 'research', 'code', 'reasoning', 'general', 'product'] as const).includes(word as TaskCategory)
        ? (word as TaskCategory)
        : 'general';
    console.log(`[route] llm=${category}${saver ? ' (saver)' : ''}`);
    return { category, modelId: pickModel(category, plan, saver), webSearch: category === 'research' };
  } catch {
    return fallback;
  }
}
