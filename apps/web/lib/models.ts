// Single source of truth for the selectable chat models ("Brains"), which plans
// unlock them, and the plan-aware helpers shared by the in-chat model switcher
// and the Auto router (lib/chat/auto-route.ts). Keep the ids in sync with
// resolveChatModel() in lib/chat/model.ts — that function does the actual
// provider routing + env-key gating.
export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  /** Plans that unlock this model. 'group' is normalized to 'pilot' access. */
  plans: string[];
  /**
   * Can this model actually READ an attached image?
   *
   * 🚨 Load-bearing, and it is the flag that fixes a real defect: resolveChatModel
   * used to send EVERY image request to OpenAI and downgrade it to gpt-4o-mini
   * unless the id matched a hardcoded regex. So a $59 customer on Claude Opus or
   * Gemini 3.1 Pro who attached a screenshot was silently answered by the weakest
   * model we serve, while the UI named the one they picked.
   *
   * ⚠️ Same rule as the ids themselves: this is NOT taken from docs. A model that
   * cannot see does not error on an image part — it either 400s deep in the
   * provider SDK or, worse, answers confidently about nothing. Every `vision: true`
   * below is proven by `scripts/verify-vision-routing.ts`, which sends a real
   * generated image containing a known word and asserts the model reads it back.
   */
  vision?: boolean;
}

/**
 * MODUS gets every provider's everyday model; PILOT adds the frontier ones.
 *
 * Every id here was confirmed against the live provider API on 2026-07-16 — list
 * the models, then round-trip a real completion. That is not ceremony: a wrong id
 * does NOT error, it falls through to LLAMA_FALLBACK in lib/chat/model.ts and the
 * user is told a model answered that never ran. The docs are not a source of
 * truth either — "gemini-3.1-pro" is what Google's own release notes call it and
 * it 404s; the servable id is "gemini-3.1-pro-preview".
 */
export const PLATFORM_MODELS: ModelInfo[] = [
  // Served by the Vercel AI Gateway, NOT Groq. Groq decommissions its copy on
  // 2026-08-16 — but Llama is open-weight, so that only ever killed one host, not
  // the model. Same weights, so the switcher entry and every call site's token
  // budget are unchanged. See lib/chat/model.ts for why the Gateway beat Groq's
  // own suggested replacement (gpt-oss is a reasoner and returns '' at maxTokens 80).
  // Text-only: Llama 3.3 has no vision tower (3.2 shipped the multimodal variants,
  // 3.3 did not). An image on this model is routed to the vision fallback.
  { id: 'meta/llama-3.3-70b',      name: 'Llama 3.3',        provider: 'Meta',      plans: ['free', 'modus', 'pilot'], vision: false },
  // ⚠️ Llama 4 Scout was added and REMOVED on 2026-07-17, hours apart. It answered
  // a live round-trip perfectly — and Groq's deprecation table lists its shutdown
  // date as 07/17/26, THE SAME DAY. Round-tripping proves a model serves NOW, not
  // that it serves TOMORROW: check the provider's deprecation page too.
  // PILOT-EXCLUSIVE ON PURPOSE — the tier ladder is "MODUS gets Llama 3, PILOT gets
  // Llama 4", which a customer understands without a benchmark table. It only holds
  // because Maverick genuinely IS the better model: MMLU ties (85.5 vs 86.0) but it
  // wins MMLU-Pro (80.5) and GPQA, with 8x the context (1M vs 128K).
  // ⚠️ Llama 4 SCOUT is deliberately NOT here and must not be added for count: 3.3
  // BEATS it (MMLU 86.0 vs 79.6, math/code 11.9 vs 8.2). Newer ≠ better — that
  // assumption already shipped Scout once and had to be reverted.
  // ✅ Maverick is natively multimodal and its vision is now REACHABLE. It used to
  // not be — resolveChatModel sent any model + an image to gpt-4o-mini before
  // routing, so this line used to read "do not sell it on images". That block is
  // gone; the `vision` flag below is what routes now.
  { id: 'meta/llama-4-maverick',   name: 'Llama 4 Maverick', provider: 'Meta',      plans: ['pilot'], vision: true },
  // ⚠️ The non-thinking DeepSeek ON PURPOSE. deepseek-r1 and v3.2-thinking are
  // reasoners: they spend the budget before emitting, so they return '' at small
  // maxTokens — the exact silent failure that killed the gpt-oss plan. v3.1 answers
  // at maxTokens 80.
  // 🌏 The China objection does NOT apply through this path. Vercel's providers for
  // it are deepinfra / novita / sambanova — all US-headquartered; DeepSeek's own API
  // is NOT among them, so no user data goes to DeepSeek. (Open weights, third-party
  // hosts.) Defensible claim: "US-hosted third parties, not DeepSeek's API" — NOT
  // "no Chinese infrastructure", which is unverified: Novita's GPU locations are not
  // published.
  // Free-reachable: DeepSeek is an open model on cheap US-hosted third parties, so
  // it belongs to the open-model free tier alongside Llama and the Gemini Flashes.
  { id: 'deepseek/deepseek-v3.1',  name: 'DeepSeek V3.1',    provider: 'DeepSeek',  plans: ['free', 'modus', 'pilot'], vision: false },
  // GPT-6.1 Sol replaced GPT-5.6 Terra on 2026-10-25: a generation newer and cheaper
  // ($2/$10 vs $2.50/$15). OpenAI's 6.x line has no Terra; Sol is its everyday tier.
  { id: 'gpt-6.1-sol',             name: 'GPT-6.1 Sol',      provider: 'OpenAI',    plans: ['modus', 'pilot'], vision: true },
  // Sonnet 5.5 replaced Sonnet 5 on 2026-10-25 at the same $2/$10 (Sonnet 5's
  // introductory price became permanent, so neither ever cost $3/$15 after August).
  { id: 'claude-sonnet-5-5',       name: 'Claude Sonnet 5.5', provider: 'Anthropic', plans: ['modus', 'pilot'], vision: true },
  // Free-reachable: Gemini Flash is the dearest of the open/free models (weight 5,
  // see lib/chat/model-cost.ts). The free WEEKLY ceiling is what bounds its cost —
  // re-run scripts/verify-free-tier.ts if this row or that ceiling changes.
  { id: 'gemini-3.8-flash',        name: 'Gemini 3.8 Flash', provider: 'Google',    plans: ['free', 'modus', 'pilot'], vision: true },
  // The FREE_DEFAULT (lib/chat/model.ts) and the BASELINE of the cost table, so it
  // is the one model the free tier can reach. Added 2026-08-04 with the free tier.
  //
  // ⚠️ It is NOT the same model as the row above, and the difference is the whole
  // reason this row exists: Flash is $1.50/$9.00, Flash-Lite is $0.30/$2.50 — 4.3x
  // apart. model-cost.ts previously had Flash-Lite's prices filed under Flash's id,
  // which made the default model look 4.3x cheaper than it is. Keep the two rows
  // visually distinct; they are one careless copy away from repeating that.
  //
  // Id verified 2026-08-04 against the account's own GOOGLE_GENERATIVE_AI_API_KEY
  // (v1beta/models lists `models/gemini-3.5-flash-lite`). Per this file's header, a
  // wrong id does not error — it falls through to LLAMA_FALLBACK and the user is
  // told a model answered that never ran.
  { id: 'gemini-3.5-flash-lite',   name: 'Gemini 3.5 Flash Lite', provider: 'Google', plans: ['free', 'modus', 'pilot'], vision: true },
  // OpenAI's top 6.x tier ($10/$50, Fable's price). Replaced GPT-5.6 Sol 2026-10-25.
  { id: 'gpt-6-astra',             name: 'GPT-6 Astra',      provider: 'OpenAI',    plans: ['pilot'], vision: true },
  { id: 'claude-opus-5-5',         name: 'Claude Opus 5.5',  provider: 'Anthropic', plans: ['pilot'], vision: true },
  // Restored 2026-07-17: Google billing is now live on the `modus-pilot` project
  // ($10 prepay), and this answers — verified with a real completion through
  // @ai-sdk/google, finish='stop', 1438 chars at the route's real 2048 cap. It was
  // withheld for exactly one day because a FREE-TIER key 429'd every Pro request.
  // Gemini 4 replaced 3.1 Pro 2026-10-25. Verified answering on our own key the same
  // day (finish STOP). ⚠️ Its price DOUBLES on 2026-12-01 ($2/$10 → $4/$20);
  // model-cost.ts is already priced at the December rate.
  { id: 'gemini-4-argon',          name: 'Gemini 4',         provider: 'Google',    plans: ['pilot'], vision: true },
  // Anthropic's most capable model — a real PILOT flagship, already covered by the
  // Anthropic account we pay for. ⚠️ $10/$50 per 1M, 2.5x Opus 5.5 ($4/$20): tied with
  // GPT-6 Astra for the priciest thing we serve. Anthropic prompt caching
  // (chat/route.ts) drops cached input to $0.25/1M on 5.1 and is what keeps it viable at $59.
  { id: 'claude-fable-5-1',        name: 'Claude Fable 5.1', provider: 'Anthropic', plans: ['pilot'], vision: true },

  // ── Withheld until the provider account can actually serve them ──────────────
  // Both were live on PILOT and NEITHER could answer a single request, which the
  // failover chain hid: Google's 429 body contains "429"/"quota", isFailoverError
  // matches it, and the request is silently retried on Llama — "the switch is
  // invisible to the user". So $59 customers picked Gemini and were answered by
  // Llama with no error. Listing a model we cannot serve is the bug; the fix is
  // billing, not code.
  //
  // Verified 2026-07-16 with the production keys:
  //   gemini-3.1-pro-preview → 429 "You exceeded your current quota, please check
  //                                 your plan and billing details" (free-tier key)
  //   grok-4.5               → 403 "Your newly created team doesn't have any
  //                                 credits or licenses yet"
  //
  // To restore: enable billing on the Google AI Studio key / buy xAI credits,
  // re-run the round-trip check, then uncomment. The ids below are verified-real
  // (they resolve; they are only quota/credit blocked) so nothing else changes.
  // { id: 'grok-4.5',               name: 'Grok 4.5',       provider: 'xAI',    plans: ['pilot'] },
];

/**
 * Retired id → the successor a user should land on. Saved Brains store a raw id
 * (Firestore settings.modelSettings.model) and there is no backfill, so an id
 * that leaves the catalog would drop that user to Llama and show them the raw
 * string in the switcher. Resolved on read via canonicalModelId().
 *
 * grok-3 and gemini-2.5-pro map ACROSS providers on purpose: they cannot be
 * served at all right now, so anyone holding them is already getting Llama or an
 * error. A working model of the same tier is strictly better than that.
 */
const LEGACY_MODEL_IDS: Record<string, string> = {
  'gpt-4o': 'gpt-6.1-sol',          // May 2024; superseded and now cheaper to beat
  'o4-mini': 'gpt-6-astra',           // o-series reasoning → the OpenAI flagship
  'gemini-2.5-pro': 'gemini-3.8-flash', // retires 2026-10-16, and 429s today
  'grok-3': 'gpt-6-astra',            // xAI has no credits; keep them on a frontier model
  // Sonnet 4.6 left the catalog for Sonnet 5 (same price, better model) on
  // 2026-07-17. Without this line every saved Brain holding the old id fails the
  // plan gate and silently drops that user to Llama — same tier, same provider,
  // so the successor is a clean swap.
  'claude-sonnet-4-6': 'claude-sonnet-5-5',
  // Llama moved OFF Groq onto the AI Gateway (Groq kills its copy 2026-08-16).
  // Same weights, new host, new id. These two lines are load-bearing: Firestore
  // stores settings.modelSettings.model as a RAW id with no backfill, so without
  // them every existing user whose saved Brain is Llama fails the plan gate and
  // gets silently dropped to... Llama, with the raw dead id showing in the
  // switcher. Same model, so the swap is exact.
  // ⚠️ THE LEFT SIDE MUST STAY THE GROQ ID. It is what Firestore already holds for
  // existing users; mapping it to itself makes the alias a no-op and drops every
  // one of them to a raw dead string in the switcher — the exact failure this map
  // exists to stop. A find-and-replace over model ids will silently "fix" it.
  // The 2026-10-25 generation swap. Every saved Brain holding one of these raw ids
  // would otherwise fail the plan gate and drop to Llama. Same provider, same tier,
  // so each is a clean swap. The map is SINGLE-HOP: the aliases above were re-pointed
  // straight at these successors, not chained through the old ids.
  'gpt-5.6-terra': 'gpt-6.1-sol',
  'gpt-5.6-sol': 'gpt-6-astra',
  'claude-sonnet-5': 'claude-sonnet-5-5',
  'claude-opus-4-8': 'claude-opus-5-5',
  'claude-fable-5': 'claude-fable-5-1',
  'gemini-3.5-flash': 'gemini-3.8-flash',
  'gemini-3.1-pro-preview': 'gemini-4-argon',
  'llama-3.3-70b-versatile': 'meta/llama-3.3-70b',
  'llama-3.1-8b-instant': 'meta/llama-3.1-8b',
};

/**
 * The free tier's only default model, and the one every plan can run. Lives here
 * rather than lib/chat/model.ts (which re-exports it) because the chat client
 * needs it too, and that file pulls in the server provider SDKs.
 */
export const FREE_DEFAULT = 'gemini-3.5-flash-lite';

/** Map a stored/legacy model id onto the catalog id that should actually serve it. */
export function canonicalModelId(id: string): string {
  return LEGACY_MODEL_IDS[id] ?? id;
}

/** Group members get PILOT-level model access — normalize so per-model `plans` match. */
export function effectivePlan(plan: string | null | undefined): string {
  return plan === 'group' ? 'pilot' : (plan ?? 'free');
}

/**
 * Can this model read an image? Read off the catalog, never re-derived from the id.
 *
 * Deriving capability from an id prefix is exactly the mistake resolveChatModel's
 * tier gate already had to unwind (tiers encoded in two places that disagreed, and
 * did). An unknown id returns false, which is the safe direction: the caller routes
 * to a model that definitely sees rather than gambling that a stranger id is
 * multimodal.
 */
export function modelSupportsVision(id: string): boolean {
  return PLATFORM_MODELS.find(m => m.id === canonicalModelId(id))?.vision === true;
}

export function isModelUnlocked(id: string, plan: string | null | undefined): boolean {
  const model = PLATFORM_MODELS.find(m => m.id === canonicalModelId(id));
  return !!model && model.plans.includes(effectivePlan(plan));
}

/**
 * May this account RUN this model?
 *
 * 🧊 The free tier is the OPEN MODELS ONLY (plans:['free'] — Llama, DeepSeek and the
 * two Gemini Flashes). A signed-in unpaid account is held to exactly those; a free
 * request for a frontier model is refused so the caller can serve a free model or
 * prompt an upgrade. This USED to let free accounts run any catalog model for a
 * lifetime message count — that was the "metered frontier" tier, replaced on the
 * windowed free-tier change: free is now cheap-models-only, bounded by the rolling
 * window + weekly ceiling in lib/chat/limits.ts (FREE_WINDOW_LIMIT / FREE_WEEKLY_LIMIT),
 * and the frontier models are the reason to upgrade. Paid tiers still get exactly
 * their plan's models — a modus user does not reach pilot models through this.
 *
 * This is now exactly isModelUnlocked (effectivePlan maps an unpaid account to
 * 'free'); it stays a distinct, named accessor because it is the ONE thing both
 * chat gates (model.ts, route.ts) and the compare route read, and
 * scripts/verify-free-tier.ts pins that it holds free to the open models.
 *
 * 🚨 GATE ONLY AUTHENTICATED REQUESTS with this. `!isPaidPlan` is also true of a
 * guest, and /api/chat + /api/chat/compare are accounts-only (they 401 without a
 * uid), so "not paid" there means "signed-in free user". Do not use this to gate
 * an unauthenticated surface.
 */
export function canUseModel(id: string, plan: string | null | undefined): boolean {
  return isModelUnlocked(id, plan);
}

/** The models a given plan can use, in catalog order. */
export function unlockedModels(plan: string | null | undefined): ModelInfo[] {
  const ep = effectivePlan(plan);
  return PLATFORM_MODELS.filter(m => m.plans.includes(ep));
}

/**
 * Display names for models that answer but are NOT selectable Brains: the failover
 * safety net in lib/chat/model.ts (chatFallbackChain). They are deliberately kept
 * out of PLATFORM_MODELS — that list is the switcher AND the tier gate, so adding
 * them would offer them for sale. They still need a human name, because when the
 * chain switches we now tell the user who actually answered, and
 * "answered with meta/llama-3.1-8b instead" is not a sentence for a customer.
 */
export const INTERNAL_MODELS: Record<string, { name: string; provider: string }> = {
  'meta/llama-3.1-8b': { name: 'Llama 3.1', provider: 'Meta' },
  'gpt-4o-mini':          { name: 'GPT-4o mini', provider: 'OpenAI' },
};

/**
 * The provider that owns a model id, for display (logos). Covers the internal
 * fallback models too, so a chip naming the model that really answered can still
 * show its mark — PLATFORM_MODELS alone would return undefined and drop the logo.
 */
export function modelProvider(id: string): string {
  const canonical = canonicalModelId(id);
  return PLATFORM_MODELS.find(m => m.id === canonical)?.provider
    ?? INTERNAL_MODELS[canonical]?.provider
    ?? '';
}

export function modelName(id: string): string {
  const canonical = canonicalModelId(id);
  return PLATFORM_MODELS.find(m => m.id === canonical)?.name
    ?? INTERNAL_MODELS[canonical]?.name
    ?? id;
}
