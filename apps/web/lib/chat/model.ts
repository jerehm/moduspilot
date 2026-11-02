import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createXai } from '@ai-sdk/xai';
import type { LanguageModel } from 'ai';
import { canonicalModelId, isModelUnlocked, canUseModel, modelSupportsVision, PLATFORM_MODELS, FREE_DEFAULT } from '@/lib/models';
import { repairReasoningStream } from '@/lib/chat/stream-repair';
import { isOpenAIGptReasoning } from '@/lib/chat/model-params';
import { anthropicEffortForBudget } from '@/lib/chat/effort';

// Vision for a user's OWN OpenAI key (BYOK). BYOK models are NOT in the catalog —
// the user can name any id their key serves — so this is the one place capability
// still has to be guessed from the id. Platform models go through
// modelSupportsVision() and the catalog instead.
// gpt-5.6-* included because it IS multimodal — verified 2026-07-16 by sending a
// real image and getting the colour back. gpt-6+ added 2026-10-25: without it a
// BYOK user's GPT-6 image went to gpt-4o-mini.
const OPENAI_VISION = /gpt-5\.6|gpt-([6-9]|[1-9]\d)|gpt-4o|gpt-4\.1|gpt-4-turbo/;
function visionOpenAIModel(model: string): string {
  return OPENAI_VISION.test(model) ? model : 'gpt-4o-mini';
}

/**
 * Vercel AI Gateway — an OpenAI-compatible endpoint in front of ~300 models.
 *
 * MODUS's free floor used to be Groq, which decommissions meta/llama-3.3-70b
 * and meta/llama-3.1-8b on 2026-08-16 (console.groq.com/docs/deprecations, free
 * AND developer tier). That looked like losing the floor. It wasn't: Llama is
 * OPEN-WEIGHT and Groq was only ever one host of it. The Gateway serves the same
 * weights, so this is a host swap, not a model migration — which is why none of
 * the ~13 call sites below needed their token budgets re-measured.
 *
 * Reasons this beats Groq's own replacement path (openai/gpt-oss-120b):
 *  - gpt-oss is a REASONER. Measured on the real API: it returns content='' at
 *    maxTokens 80 (memory.ts's budget), so a drop-in swap would have silently
 *    killed long-term memory extraction with no error to log.
 *  - Groq's free tier caps ~12k tokens/min ORG-WIDE against a ~5.6k-token system
 *    prompt — about 2 messages/minute for the entire product. Verified on the
 *    Gateway: a 6,040-token prompt at maxTokens 2048 goes through, i.e. the exact
 *    request Groq rejects. The cap is gone.
 *  - Groq's Developer tier cannot be bought ("temporarily unavailable due to high
 *    demand", shut since ~May 2026), so the paid escape hatch was never available.
 *
 * ⚠️ Ids are `provider/model` and match NO prefix in the chain below — an unmatched
 * id falls through to downgradedToFree() and is served by Llama SILENTLY. Route
 * them via GATEWAY_HOSTED, and never by pattern: 'openai/gpt-oss-120b' is an
 * OPEN-WEIGHT model the Gateway hosts, so a looser rule would POST it to OpenAI.
 */
const gateway = createOpenAI({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? '',
  baseURL: 'https://ai-gateway.vercel.sh/v1',
});

/**
 * 🪤 @ai-sdk/openai@1.3.24 decides "is this a reasoning model" with
 * `modelId.startsWith("o") || modelId.startsWith("gpt-5")`. For those ids it moves
 * max_tokens to max_completion_tokens, strips temperature and friends, and sends
 * the system prompt as a `developer` message. GPT-6 matches neither prefix, so the
 * SDK sends it the old shape and OpenAI hard-rejects it. Verified live 2026-10-25
 * on gpt-6.1-sol and gpt-6-astra:
 *
 *   Unsupported parameter: 'max_tokens' is not supported with this model.
 *   Use 'max_completion_tokens' instead.
 *
 * Every GPT-6 message would have failed. The SDK is pinned (see the stack notes),
 * so instead of patching node_modules this fetch applies the same rewrite the SDK
 * already applies to gpt-5, keyed on the family helper that covers 6 and later.
 * Ids the SDK already handles pass through untouched.
 */
const SDK_KNOWS_REASONING = (id: string) => id.startsWith('o') || id.startsWith('gpt-5');
const REASONING_UNSUPPORTED = ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'logit_bias', 'logprobs', 'top_logprobs'];

export function rewriteNewGenOpenAIBody(body: Record<string, unknown>): Record<string, unknown> {
  const id = typeof body.model === 'string' ? body.model : '';
  if (!isOpenAIGptReasoning(id) || SDK_KNOWS_REASONING(id)) return body;
  const out: Record<string, unknown> = { ...body };
  if (out.max_tokens != null) {
    if (out.max_completion_tokens == null) out.max_completion_tokens = out.max_tokens;
    delete out.max_tokens;
  }
  for (const k of REASONING_UNSUPPORTED) delete out[k];
  if (Array.isArray(out.messages)) {
    out.messages = out.messages.map((m: { role?: string }) => (m?.role === 'system' ? { ...m, role: 'developer' } : m));
  }
  return out;
}

/** OpenAI provider for a model id the user picked. Use this, not bare createOpenAI. */
function openAIProvider(apiKey: string) {
  return createOpenAI({ apiKey, fetch: jsonBodyFetch(rewriteNewGenOpenAIBody) });
}

/**
 * 🚨 THE EFFORT SLIDER WAS DEAD ON EVERY CLAUDE MODEL. Found 2026-10-25.
 *
 * effort.ts sends Anthropic `thinking: { type: 'enabled', budgetTokens }` for Low
 * and High, because that is the only shape @ai-sdk/anthropic@1.2.12 can express
 * (its schema allows 'enabled' | 'disabled'). Every Claude we serve rejects it,
 * the models that were live at the time included. Verified against the API that
 * day for claude-sonnet-5, claude-opus-4-8, claude-fable-5 and all three 5.5/5.1
 * successors:
 *
 *   "thinking.type.enabled" is not supported for this model. Use
 *   "thinking.type.adaptive" and "output_config.effort" to control thinking.
 *
 * So any user who moved the slider off Medium got an error on every Claude
 * message. Medium sends nothing, which is why it went unnoticed.
 *
 * The rewrite happens on the wire for the same reason as the OpenAI one: the SDK
 * is pinned. Claude 4.6 and later accept adaptive. Older ids (Haiku 4.5 and below,
 * reachable only through a user's own key) still need the budget form, so they
 * pass through untouched.
 */
const CLAUDE_NEEDS_BUDGET_THINKING = /^claude-(3|[a-z]+-3|[a-z]+-4-[0-5](?!\d)|[a-z]+-4-\d{8})/;

export function rewriteClaudeThinkingBody(body: Record<string, unknown>): Record<string, unknown> {
  const id = typeof body.model === 'string' ? body.model : '';
  const thinking = body.thinking as { type?: string; budget_tokens?: number } | undefined;
  if (thinking?.type !== 'enabled' || !/^claude-/.test(id) || CLAUDE_NEEDS_BUDGET_THINKING.test(id)) return body;
  const effort = anthropicEffortForBudget(thinking.budget_tokens);
  const out: Record<string, unknown> = { ...body, thinking: { type: 'adaptive' } };
  if (effort) out.output_config = { ...(body.output_config as object | undefined), effort };
  return out;
}

function jsonBodyFetch(rewrite: (b: Record<string, unknown>) => Record<string, unknown>): typeof fetch {
  return (input, init) => {
    if (init && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        const rewritten = rewrite(body);
        if (rewritten !== body) return fetch(input, { ...init, body: JSON.stringify(rewritten) });
      } catch {
        // Not JSON: nothing to rewrite.
      }
    }
    return fetch(input, init);
  };
}

/**
 * 🚨 EVERY GEMINI TURN THAT CALLED A TOOL DIED. Known since 2026-09-15, fixed
 * 2026-10-25.
 *
 * Gemini 3+ attaches a `thoughtSignature` to each functionCall it emits and
 * requires it back when that call is replayed in the next request. The pinned
 * @ai-sdk/google@1.2.22 drops it, so step two of any tool turn was a hard 400:
 *
 *   Function call is missing a thought_signature in functionCall parts.
 *
 * Measured that day on gemini-3.5-flash-lite (the FREE_DEFAULT), 3.5 Flash,
 * 3.1 Pro, 3.8 Flash and Gemini 4. All five failed. The real fix is the SDK's v5
 * line, which round-trips the signature. Until then Google documents a sentinel for
 * history whose signatures the client did not keep. It passes validation, and
 * Google warns it can cost some reasoning quality on the replayed step. Each of the
 * five answered the tool result correctly with it, versus an error without it.
 */
const GEMINI_SKIP_SIGNATURE = 'skip_thought_signature_validator';

export function rewriteGeminiSignatureBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.contents)) return body;
  let touched = false;
  const contents = body.contents.map((c: { parts?: Array<Record<string, unknown>> }) => {
    if (!Array.isArray(c?.parts)) return c;
    const parts = c.parts.map(part => {
      if (part?.functionCall && !part.thoughtSignature) {
        touched = true;
        return { ...part, thoughtSignature: GEMINI_SKIP_SIGNATURE };
      }
      return part;
    });
    return { ...c, parts };
  });
  return touched ? { ...body, contents } : body;
}

/** Google provider. Use this, not bare createGoogleGenerativeAI. */
function googleProvider(apiKey: string) {
  return createGoogleGenerativeAI({ apiKey, fetch: jsonBodyFetch(rewriteGeminiSignatureBody) });
}

/** Anthropic provider for a model id the user picked. Use this, not bare createAnthropic. */
function anthropicProvider(apiKey: string) {
  return createAnthropic({ apiKey, fetch: jsonBodyFetch(rewriteClaudeThinkingBody) });
}

/**
 * What a user gets when they have not chosen a model — i.e. every new customer's
 * entire first session. On a DIRECT vendor key on purpose: see freeDefaultModel().
 *
 * 💸 MOVED off gemini-3.5-flash 2026-08-04, when Flash's real price turned out to
 * be $1.50/$9.00 rather than the $0.30/$2.50 model-cost.ts had recorded. As the
 * default it was the model most requests land on, at 4.3x the assumed cost, and
 * correcting its weight to 5 would have cut the felt daily allowance ~5x for
 * everyone who never opened the switcher. Flash-Lite is the same family at the
 * price the system already believed it was paying, so ceilings did not move and
 * margin held: worst case ~$7.89/mo of inference on a $24 plan.
 *
 * Only accounts with NO saved Brain move — resolveChatModel reads
 * `opts.modelId ?? ms?.model ?? FREE_DEFAULT`, so anyone who explicitly picked
 * Flash keeps it, now correctly billed at 5x against their own budget.
 *
 * ⚠️ This id is the free tier's ONLY model. Changing it changes what a stranger
 * meets first AND what that costs per signup — re-run scripts/verify-model-cost.ts.
 */
export { FREE_DEFAULT };
/** The failover chain's free link. Still Gateway-hosted, still selectable. */
export const LLAMA_FALLBACK = 'meta/llama-3.3-70b';
/**
 * Second free model — a separate budget from the primary, so a throttled first
 * model can immediately retry here. Also the fallback in proactive-model.ts /
 * briefing.ts.
 */
const FREE_FALLBACK_SECONDARY = 'meta/llama-3.1-8b';

/**
 * Models served by the AI Gateway's OpenAI-compatible endpoint, not by the vendor
 * whose name is in the id.
 *
 * A model missing from this Set matches no prefix in resolveChatModel, falls
 * through to downgradedToFree(), and is served by Llama SILENTLY — the exact bug
 * the onServed disclosure exists to prevent, re-entering through the back door.
 * That is why routing is an explicit list and never a pattern.
 *
 * Verified live on the Gateway key (a real completion each), not from the docs.
 */
const GATEWAY_HOSTED = new Set<string>([
  LLAMA_FALLBACK,
  FREE_FALLBACK_SECONDARY,
  // Every selectable Gateway model MUST be listed here. Adding one to
  // PLATFORM_MODELS and forgetting this line is not a 404 — the id matches no
  // prefix, falls to downgradedToFree(), and the user is served Llama while the
  // chip names the model they picked.
  'meta/llama-4-maverick',
  'deepseek/deepseek-v3.1',
]);

// The concrete language-model object type (LanguageModel is `string | model`; a
// resolved chat model is always the object form).
type LM = Exclude<LanguageModel, string>;

/** Ids that promise nothing: the free defaults MODUS falls back to by design. */
// ⚠️ FREE_DEFAULT deliberately does NOT belong here, though it is tempting.
// gemini-3.5-flash is BOTH the unchosen default AND a model a user can pick from
// the composer. Marking it "free" would silence the downgrade notice for someone
// who explicitly chose it — the silent-downgrade bug (247a582) re-entering
// through the back door. scripts/verify-failover-annotation.ts caught exactly
// that when it was tried. The "user picked nothing" case is handled where it
// belongs instead: the FREE_DEFAULT exemption on the unlock gate below.
const FREE_DEFAULTS = new Set<string>([LLAMA_FALLBACK, FREE_FALLBACK_SECONDARY]);

/**
 * "Did we promise the user this specific model?" — anything that isn't a free
 * default we'd have served anyway.
 *
 * This is the ONE rule, and both downgrade routes read it: the pre-flight gate
 * below (downgradedToFree) and the runtime failover in the chat route. They used
 * to disagree — the failover path reported nothing at all — which is how a $59
 * user could pick Gemini, be answered by Llama, and never be told.
 *
 * It is deliberately an OR of two independent tests, because each one alone has a
 * silent-downgrade hole:
 *  - The CATALOG test alone misses a stale saved Brain. Firestore stores a raw id
 *    with no backfill, so a retired id that never made it into LEGACY_MODEL_IDS
 *    (e.g. 'claude-3-opus') isn't in PLATFORM_MODELS — catalog-only would call it
 *    non-premium and drop that user to Llama in silence.
 *  - The REGEX test alone misses every Groq-hosted id: 'openai/gpt-oss-120b' and
 *    'meta-llama/llama-4-scout-…' match no prefix, so regex-only would silently
 *    downgrade the very models we add for model count.
 * Either test firing means we named a model, so the user gets told.
 */
export function isPremiumModel(id: string): boolean {
  const canonical = canonicalModelId(id);
  if (FREE_DEFAULTS.has(canonical)) return false;
  return /^(gpt-|claude-|gemini-|grok-|o4-)/.test(canonical)
    || PLATFORM_MODELS.some(m => m.id === canonical);
}

/**
 * Can this model be given function tools on the endpoint we call it on?
 *
 * 🪤 OpenAI's gpt-5.x reasoning family CANNOT, over /v1/chat/completions — which
 * is the endpoint @ai-sdk/openai uses by default:
 *
 *   Function tools with reasoning_effort are not supported for gpt-5.6-terra in
 *   /v1/chat/completions. To use function tools, use /v1/responses or set
 *   reasoning_effort to 'none'.
 *
 * It is a hard 400, so attaching MCP tools to a PILOT user's best model turned
 * every message into a blank bubble. Tools are best-effort; an answer is not.
 * Dropping the tools costs a capability the user probably wasn't invoking on
 * that turn — sending them costs the entire reply.
 *
 * Kept as an allow-by-default deny-list: a model we know nothing about keeps its
 * tools, because the failure mode of guessing "no tools" is silent capability
 * loss, which is far harder to notice than an error.
 */
/**
 * Ids whose PROVIDER rejects function tools outright. Listed explicitly and
 * never matched by pattern — the same lesson GATEWAY_HOSTED records above.
 * isOpenAIGptReasoning is a pattern only because OpenAI's limitation is family-wide; tool
 * support is otherwise a per-model, per-host fact that a name cannot predict.
 *
 * 🪤 meta/llama-4-maverick — found 2026-07-23, blank on EVERY message since it
 * was listed. Its Gateway host serves it as Llama-4-Maverick-17B-128E-Instruct-FP8
 * and hard 400s: "Tool calling is not supported for model". Nothing surfaced it,
 * because the route still returns 200 and Vercel logs a healthy request.
 *
 * 🪤 meta/llama-3.3-70b — found 2026-09-15 in prod logs (34 failures/day, 3
 * users, the FREE general default). Once any MCP server is connected its Gateway
 * host hard 400s with "This model doesn't support tool use in streaming mode."
 * MODUS always streams (streamText), so tools are unusable for it here and the
 * whole reply was lost. It used to take tools on this key, so this is a host-side
 * change — exactly why tool support is a per-model fact a name cannot predict.
 * deepseek-v3.1 still takes tools on the same key (no failures logged), so only
 * llama-3.3-70b is listed.
 */
const NO_FUNCTION_TOOLS = new Set<string>([
  'meta/llama-4-maverick',
  'meta/llama-3.3-70b',
]);

export function modelSupportsTools(id: string): boolean {
  const canonical = canonicalModelId(id);
  return !isOpenAIGptReasoning(canonical) && !NO_FUNCTION_TOOLS.has(canonical);
}

export interface ResolvedChatModel {
  model: LanguageModel;
  /** The model id actually used for this request. */
  modelId: string;
  /**
   * True when a premium model was requested but we had to fall back to the free
   * Llama default (missing provider key or plan gate). The caller surfaces this
   * instead of silently answering as if the premium model had been used.
   */
  downgraded: boolean;
  /** The premium model that was requested but not served, when downgraded. */
  requestedId?: string;
  /**
   * WHY the swap happened, so the user is told something true.
   *
   * 'unavailable' — plan gate or a missing provider key; the model could not run.
   * 'vision'      — the model runs fine, it just cannot READ IMAGES, so an image
   *                 message went to one that can.
   *
   * These are not the same sentence. The client's only notice used to be "…is
   * temporarily unavailable", which would be a plain lie about a working model
   * that simply has no vision tower. Absent = 'unavailable' (the prior behaviour).
   */
  downgradeReason?: 'unavailable' | 'vision';
}

function served(model: LanguageModel, modelId: string): ResolvedChatModel {
  // EVERY resolved model goes through the stream repair, not just Anthropic's.
  // The defect is a malformed part reaching a core that throws inside the stream
  // transform — where nothing can catch it — and any thinking-capable provider
  // can produce one. Gating this to `claude-` would mean rediscovering the same
  // blank bubble the next time Gemini or xAI ships reasoning deltas.
  return { model: repairReasoningStream(model), modelId, downgraded: false };
}

/**
 * The model served when nothing was chosen, or when a choice can't be honoured.
 *
 * 🚨 THIS USED TO BE GATEWAY LLAMA, AND "FREE" WAS FICTION. A new customer has no
 * saved Brain, so every one of their messages started at `meta/llama-3.3-70b` on
 * the Gateway's free tier, 429'd, fell to `meta/llama-3.1-8b` (same Gateway, same
 * tier, same 429) and was answered by `gpt-4o-mini`. Verified repeatedly on prod
 * 2026-07-23. So MODUS was ALREADY paying gpt-4o-mini rates on every default
 * message and buying ~1s of dead air for two doomed round trips.
 *
 * Two Gateway links are not two fallbacks — they share one account and one tier.
 * The fix is not a different Llama; it is a different KEY PATH.
 *
 * Order is deliberate:
 *   1. gemini-3.5-flash on a DIRECT Google key — cheap, better than both models
 *      it replaces, and crucially a DIFFERENT VENDOR to the failover floor. The
 *      default and the floor were both OpenAI, so one OpenAI outage took out
 *      everything (the Gateway being already throttled).
 *   2. gpt-4o-mini — what was actually answering anyway, minus the wasted hops.
 *   3. Gateway Llama — only when neither vendor key exists.
 */
function freeDefaultModel(hasImage = false): { model: LanguageModel; modelId: string } {
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (googleKey) {
    return { model: googleProvider(googleKey)(FREE_DEFAULT), modelId: FREE_DEFAULT };
  }
  const openAIKey = process.env.OPENAI_API_KEY?.trim();
  if (openAIKey) {
    return { model: createOpenAI({ apiKey: openAIKey })('gpt-4o-mini'), modelId: 'gpt-4o-mini' };
  }
  // Last resort, and the ONE branch that cannot see. Both vendor keys would have
  // to be missing to reach it, at which point the product is already broken — but
  // an image sent to text-only Llama fails in the provider rather than here, so
  // log it as the misconfiguration it is instead of letting it look like a model bug.
  if (hasImage) {
    console.error('[model] image request with no vision-capable key (GOOGLE_GENERATIVE_AI_API_KEY / OPENAI_API_KEY both unset) — falling back to text-only Llama');
  }
  return { model: gateway(LLAMA_FALLBACK), modelId: LLAMA_FALLBACK };
}

/** The free default, flagged so the caller can tell the user which model did NOT run. */
function downgradedToFree(requested: string, hasImage = false): ResolvedChatModel {
  const requestedPremium = isPremiumModel(requested) ? requested : undefined;
  const { model, modelId } = freeDefaultModel(hasImage);
  return {
    // Same repair as served() — a downgrade must not be the one path that can
    // still die mid-stream.
    model: repairReasoningStream(model),
    modelId,
    downgraded: !!requestedPremium,
    requestedId: requestedPremium,
    downgradeReason: 'unavailable',
  };
}

/**
 * The model that answers when the user's pick cannot read images.
 *
 * Prefers gemini-3.5-flash on the DIRECT Google key — same first choice as
 * freeDefaultModel(), and genuinely the right one here: it is a strong, cheap
 * vision model, and every screenshot MODUS sends is a big image. gpt-4o-mini
 * (what the old code forced on EVERYONE) is the second choice, not the default.
 *
 * `downgraded` is set unconditionally, unlike downgradedToFree's premium-only
 * rule: a free-model user whose image went somewhere else still deserves to know
 * who actually answered.
 */
function visionFallback(requested: string): ResolvedChatModel {
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (googleKey) {
    return {
      model: repairReasoningStream(googleProvider(googleKey)(FREE_DEFAULT)),
      modelId: FREE_DEFAULT,
      downgraded: true,
      requestedId: requested,
      downgradeReason: 'vision',
    };
  }
  const openAIKey = process.env.OPENAI_API_KEY?.trim();
  if (openAIKey) {
    return {
      model: repairReasoningStream(createOpenAI({ apiKey: openAIKey })('gpt-4o-mini')),
      modelId: 'gpt-4o-mini',
      downgraded: true,
      requestedId: requested,
      downgradeReason: 'vision',
    };
  }
  return downgradedToFree(requested, true);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveChatModel(userData: Record<string, any>, opts: { hasImage?: boolean; modelId?: string } = {}): ResolvedChatModel {
  const hasImage = opts.hasImage ?? false;
  const ms = userData.settings?.modelSettings as { provider?: string; model?: string; openaiKey?: string; anthropicKey?: string } | undefined;
  const modelProvider = ms?.provider ?? 'platform';
  const plan = userData.plan as string | undefined;

  // Explicit per-request override (in-chat model switcher / Auto router). Routes
  // as a platform model through the plan gate below, ignoring the saved BYOK
  // provider so the user's in-chat choice wins for this message.
  if (opts.modelId) {
    // fall through to platform routing with the forced id
  } else {
    // BYOK — user's own key always wins, regardless of plan
    if (modelProvider === 'openai' && ms?.openaiKey) {
      const model = ms.model ?? 'gpt-4o';
      const id = hasImage ? visionOpenAIModel(model) : model;
      return served(openAIProvider(ms.openaiKey)(id), id);
    }
    if (modelProvider === 'anthropic' && ms?.anthropicKey) {
      const id = ms.model ?? 'claude-sonnet-4-6';
      return served(anthropicProvider(ms.anthropicKey)(id), id);
    }
  }

  // canonicalModelId so a saved Brain naming a retired model (gpt-4o, grok-3, …)
  // resolves to its successor instead of failing the gate and dropping to Llama.
  // ⚠️ THIS `??` IS THE ACTUAL DEFAULT — the one every new customer gets, because
  // they have no saved Brain. It was LLAMA_FALLBACK, which is Gateway-hosted and
  // 429s on the free tier, so their whole first session was really gpt-4o-mini
  // arriving ~1s late via two doomed hops. See freeDefaultModel().
  const selectedModel = canonicalModelId(opts.modelId ?? ms?.model ?? FREE_DEFAULT);

  const openAIKey = process.env.OPENAI_API_KEY?.trim();

  // 🚨 THE IMAGE BRANCH USED TO LIVE HERE, ABOVE THE TIER GATE, AND IT WAS WRONG
  // TWICE OVER:
  //
  //   if (hasImage && openAIKey) → served(visionOpenAIModel(selectedModel))
  //
  //   1. It sent EVERY image to OpenAI and, via visionOpenAIModel's regex,
  //      collapsed anything not named gpt-* to gpt-4o-mini. Claude Sonnet 5,
  //      Claude Opus, Claude Fable 5, both Geminis and Llama 4 Maverick are all
  //      natively multimodal — and not one of them could ever see an image. A $59
  //      PILOT customer attached a screenshot to Opus and was answered by the
  //      cheapest model in the building, with the switcher still reading "Opus".
  //   2. Sitting ABOVE the tier gate, it also bypassed it: attaching an image was
  //      a way to route around the plan check entirely.
  //
  // Both are fixed by doing nothing here. The gate runs first, then vision is
  // handled below off the CATALOG (models.ts `vision`), not an id regex.
  //
  // ONE tier gate, read off PLATFORM_MODELS[].plans.
  //
  // This used to be re-derived from id prefixes here (isPaid for gpt-*, isPilot
  // for gemini-*/grok-*, a special case for opus), which meant tiers were encoded
  // in two places that could disagree — and did. o4-mini was plans:['pilot'] in
  // the catalog but gated `isPaid` here, and because the line above falls back to
  // the ungated ms?.model, a $24 user whose saved Brain was o4-mini got served a
  // PILOT model. The prefix chain below now ONLY picks the provider SDK; it makes
  // no access decisions, so the catalog is the source of truth its header claims.
  // FREE_DEFAULT is exempt: it is what an unchosen request resolves to, so gating
  // it on the catalog would make a pre-launch or plan-less account "downgrade"
  // from a model it never asked for — and show them a notice naming it.
  // canUseModel gates the pick: a free-tier account is held to the OPEN models
  // (plans:['free']) and a frontier pick downgrades to a free model here, while
  // paid tiers are held to their own plan's models. Free usage is bounded by the
  // window + weekly ceiling (enforceSubscriptionGate), not by this access check.
  if (selectedModel !== FREE_DEFAULT && !canUseModel(selectedModel, plan)) {
    return downgradedToFree(selectedModel, hasImage);
  }

  // 👁️ The model has to be able to SEE. Text-only models (Llama 3.3, DeepSeek
  // V3.1) do not fail loudly on an image part — the provider either 400s from
  // inside the SDK or, worse, answers confidently about an image it never
  // received. Route to one that can, and SAY SO: this is a real swap the user is
  // entitled to know about, flagged 'vision' so they are told the model cannot
  // read images rather than the false "temporarily unavailable".
  if (hasImage && !modelSupportsVision(selectedModel)) {
    return visionFallback(selectedModel);
  }

  // Gateway-hosted models FIRST — they match no prefix, and a looser rule would
  // actively mis-route 'openai/…' ids to OpenAI. See GATEWAY_HOSTED.
  if (GATEWAY_HOSTED.has(selectedModel) && process.env.AI_GATEWAY_API_KEY?.trim()) {
    return served(gateway(selectedModel), selectedModel);
  }

  if (selectedModel.startsWith('gpt-') || selectedModel.startsWith('o4-')) {
    if (openAIKey) return served(openAIProvider(openAIKey)(selectedModel), selectedModel);
  }

  if (selectedModel.startsWith('claude-')) {
    const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (anthropicKey) return served(anthropicProvider(anthropicKey)(selectedModel), selectedModel);
  }

  if (selectedModel.startsWith('gemini-')) {
    const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
    if (googleKey) return served(googleProvider(googleKey)(selectedModel), selectedModel);
  }

  if (selectedModel.startsWith('grok-')) {
    const xaiKey = process.env.XAI_API_KEY?.trim();
    if (xaiKey) return served(createXai({ apiKey: xaiKey })(selectedModel), selectedModel);
  }

  // Default: Groq Llama — fast, free, always available. Reached when a premium
  // model was unlocked but its provider key is missing; flagged as a downgrade so
  // the caller tells the user instead of passing Llama off as the model they picked.
  return downgradedToFree(selectedModel);
}

// Provider errors worth failing over on: transient rate / size / availability
// limits (Groq's per-minute TPM 429 "request too large", overload, 5xx). NOT
// auth/config errors — those would fail on every model, so retrying is pointless.
// HTTP codes worth trying the next model for. 429 rate limit, 5xx availability.
const FAILOVER_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 529]);

/**
 * Walk an error chain for a retryable HTTP status.
 *
 * String matching alone is NOT enough, and that gap took the whole chat down on
 * 2026-07-22: the AI Gateway's free-tier rejection reads "...are rate-limited",
 * and `AI_RetryError`'s own message is "Failed after 3 attempts. Last error: …".
 * Hyphenated "rate-limited" does not contain "rate limit", and the 429 lives on
 * `.lastError.statusCode` / `.errors[].statusCode` — never in the string. So
 * isFailoverError returned false for a textbook 429, no fallback was tried, and
 * the user got nothing at all instead of an answer from the next model.
 * Status codes are structured data; read them as such.
 */
function hasFailoverStatus(err: unknown, depth = 0, seen = new Set<unknown>()): boolean {
  if (!err || typeof err !== 'object' || depth > 4 || seen.has(err)) return false;
  seen.add(err);
  const o = err as Record<string, unknown>;
  for (const key of ['statusCode', 'status'] as const) {
    const v = o[key];
    if (typeof v === 'number' && FAILOVER_STATUS.has(v)) return true;
  }
  // AI_RetryError nests the provider errors it gave up on.
  if (hasFailoverStatus(o.lastError, depth + 1, seen)) return true;
  if (hasFailoverStatus(o.cause, depth + 1, seen)) return true;
  if (Array.isArray(o.errors) && o.errors.some(e => hasFailoverStatus(e, depth + 1, seen))) return true;
  return false;
}

// Provider errors worth failing over on: transient rate / size / availability
// limits (Groq's per-minute TPM 429 "request too large", overload, 5xx). NOT
// auth/config errors — those would fail on every model, so retrying is pointless.
function isFailoverError(err: unknown): boolean {
  if (hasFailoverStatus(err)) return true;
  // Fold -/_ to spaces so "rate-limited", "rate_limit" and "ratelimited" all
  // match the same phrase "rate limit" does.
  const s = String(err).toLowerCase().replace(/[-_]+/g, ' ');
  return (
    s.includes('429') ||
    s.includes('rate limit') ||
    s.includes('too many') ||
    s.includes('too large') ||
    s.includes('tokens per') ||
    s.includes('reduce') ||
    s.includes('quota') ||
    s.includes('overloaded') ||
    s.includes('capacity') ||
    s.includes('503') ||
    s.includes('502')
  );
}

/**
 * Wrap an ordered list of models into a single LanguageModel that transparently
 * fails over: if a model's request is rejected with a transient rate/size/
 * availability error (e.g. Groq's per-minute TPM 429), the next model is tried.
 * Groq rejects over-limit requests at request time — BEFORE any token — so the
 * rejection surfaces here in doStream/doGenerate and the user never sees an error.
 * A Proxy is used so every other property/method delegates to the primary model.
 *
 * `onServed` reports which model ACTUALLY answered. It is the only way to know:
 * the caller's response headers are built before doStream resolves, so a switch
 * that happens here can never reach the client through them. Without it the
 * client keeps displaying (and persisting) the model we merely ATTEMPTED.
 */
export function createFallbackModel(
  models: LM[],
  opts: {
    onFallback?: (fromId: string, toId: string, err: unknown) => void;
    /** Fires with the model whose request was accepted — i.e. the one answering. */
    onServed?: (modelId: string) => void;
  } = {},
): LM {
  // One model = no switch is possible, so the caller's assumed id is already
  // correct and onServed would be pure noise.
  if (models.length <= 1) return models[0];
  const attempt = async <T>(run: (m: LM) => PromiseLike<T>): Promise<T> => {
    let lastErr: unknown;
    for (let i = 0; i < models.length; i++) {
      try {
        const out = await run(models[i]);
        // Resolved = the provider accepted the request. For doStream that means
        // this model is producing the answer (Groq/OpenAI reject at request time,
        // before any token), so it is safe to report it as the served model.
        opts.onServed?.(models[i].modelId);
        return out;
      } catch (e) {
        lastErr = e;
        if (i < models.length - 1 && isFailoverError(e)) {
          opts.onFallback?.(models[i].modelId, models[i + 1].modelId, e);
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  };
  return new Proxy(models[0], {
    get(target, prop, receiver) {
      if (prop === 'doStream') {
        return (options: Parameters<LM['doStream']>[0]) => attempt((m) => m.doStream(options));
      }
      if (prop === 'doGenerate') {
        return (options: Parameters<LM['doGenerate']>[0]) => attempt((m) => m.doGenerate(options));
      }
      // Delegate everything else (modelId, provider, specificationVersion,
      // supportsUrl, …) to the primary model, preserving its `this`.
      void receiver;
      return Reflect.get(target, prop, target);
    },
  });
}

/**
 * Build the ordered failover chain for a chat request: the resolved primary model
 * first, then a free Groq model with a SEPARATE TPM budget, then a paid safety net
 * (gpt-4o-mini) so MODUS ALWAYS answers instead of surfacing "ran out / too long".
 * Duplicates (e.g. primary already gpt-4o-mini) are skipped.
 */
/**
 * A Gateway model for BACKGROUND work, with the same safety net chat has.
 *
 * 🚨 EVERY NON-CHAT AI CALL WAS GATEWAY-ONLY AND FAILED SILENTLY. Chat has had a
 * failover chain for months; memory extraction, the daily briefing, proactive
 * nudges and goal planning did not — they called the Gateway directly, caught
 * their own error, and returned null. So while the Gateway sat on its
 * rate-limited free tier, production logged this on essentially EVERY request:
 *
 *   [memory] extraction failed: AI_RetryError: Failed after 3 attempts.
 *   Last error: Free tier requests on this model are rate-limited.
 *
 * Nothing surfaced. MODUS simply stopped learning anything about the user —
 * silently, for as long as the balance stayed low. That is the life-OS wedge
 * failing quietly, which is far more expensive than any chat model swap, and it
 * is invisible precisely BECAUSE each caller handles its own failure politely.
 *
 * `gpt-4o-mini` is the net for the same reason it is chat's: it is the only
 * model reachable on a DIRECT vendor key, so it cannot fail for the tier reason
 * that just took the Gateway link down. Background work is cheap and small, so
 * the cost of the net is negligible against losing the write entirely.
 */
export function backgroundModel(gatewayModelId: string, label: string): LM {
  const chain: LM[] = [];
  if (process.env.AI_GATEWAY_API_KEY?.trim()) chain.push(gateway(gatewayModelId));
  const openAIKey = process.env.OPENAI_API_KEY?.trim();
  if (openAIKey) chain.push(createOpenAI({ apiKey: openAIKey })('gpt-4o-mini'));
  // No keys at all → let the caller's own try/catch report it, as before.
  if (chain.length === 0) return gateway(gatewayModelId);
  return createFallbackModel(chain, {
    onFallback: (from, to, err) =>
      console.warn(`[${label}] failover: ${from}→${to} (${String(err).slice(0, 120)})`),
  });
}

export function chatFallbackChain(primary: LM): LM[] {
  const chain: LM[] = [primary];
  const seen = new Set<string>([primary.modelId]);
  const add = (model: LM) => {
    if (seen.has(model.modelId)) return;
    seen.add(model.modelId);
    // The failover links are the models we reach for when things are ALREADY
    // going wrong, so they are the last place to leave unrepaired. (`primary`
    // arrives wrapped from served().)
    chain.push(repairReasoningStream(model) as LM);
  };
  if (process.env.AI_GATEWAY_API_KEY?.trim()) add(gateway(FREE_FALLBACK_SECONDARY));
  const openAIKey = process.env.OPENAI_API_KEY?.trim();
  if (openAIKey) add(createOpenAI({ apiKey: openAIKey })('gpt-4o-mini'));
  return chain;
}
