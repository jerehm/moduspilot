// Mirror of apps/web/lib/models.ts — the selectable chat models ("Brains"),
// which plans unlock them, and plan-aware helpers for the in-chat model switcher.
// Keep in sync with the web catalog + resolveChatModel() on the server (which
// does the real provider routing). Auto routing itself runs server-side.

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  /** Plans that unlock this model. 'group' is normalized to 'pilot' access. */
  plans: string[];
}

export const PLATFORM_MODELS: ModelInfo[] = [
  { id: 'meta/llama-3.3-70b',      name: 'Llama 3.3',            provider: 'Meta',      plans: ['free', 'modus', 'pilot'] },
  // Free default (server FREE_DEFAULT). Free users must see it in the switcher.
  { id: 'gemini-3.5-flash-lite',   name: 'Gemini 3.5 Flash Lite', provider: 'Google',   plans: ['free', 'modus', 'pilot'] },
  // Free-reachable open models (matches server lib/models.ts): DeepSeek + both Gemini Flashes.
  { id: 'deepseek/deepseek-v3.1',  name: 'DeepSeek V3.1',    provider: 'DeepSeek',  plans: ['free', 'modus', 'pilot'] },
  { id: 'gpt-6.1-sol',           name: 'GPT-6.1 Sol',    provider: 'OpenAI',    plans: ['modus', 'pilot'] },
  { id: 'claude-sonnet-5-5',         name: 'Claude Sonnet 5.5',  provider: 'Anthropic', plans: ['modus', 'pilot'] },
  { id: 'gemini-3.8-flash',        name: 'Gemini 3.8 Flash', provider: 'Google',    plans: ['free', 'modus', 'pilot'] },
  // PILOT-exclusive: the ladder is MODUS = Llama 3, PILOT = Llama 4.
  { id: 'meta/llama-4-maverick',   name: 'Llama 4 Maverick', provider: 'Meta',      plans: ['pilot'] },
  { id: 'gpt-6-astra',             name: 'GPT-6 Astra',      provider: 'OpenAI',    plans: ['pilot'] },
  { id: 'claude-opus-5-5',         name: 'Claude Opus 5.5',      provider: 'Anthropic', plans: ['pilot'] },
  { id: 'gemini-4-argon',  name: 'Gemini 4',   provider: 'Google',    plans: ['pilot'] },
  { id: 'claude-fable-5-1',          name: 'Claude Fable 5.1',   provider: 'Anthropic', plans: ['pilot'] },
  // Grok 4.5 withheld — xAI has no credits. Gemini 3.1 Pro restored 2026-07-17
  // once Google billing went live. See apps/web/lib/models.ts for the detail.
];

export function effectivePlan(plan: string | null | undefined): string {
  return plan === 'group' ? 'pilot' : (plan ?? 'free');
}

// MIRROR of LEGACY_MODEL_IDS in apps/web/lib/models.ts. A saved id from an
// older catalog showed as a raw string with nothing ticked in the switcher.
const LEGACY_MODEL_IDS: Record<string, string> = {
  'gpt-4o': 'gpt-6.1-sol',
  'o4-mini': 'gpt-6-astra',
  'gemini-2.5-pro': 'gemini-3.8-flash',
  'grok-3': 'gpt-6-astra',
  'claude-sonnet-4-6': 'claude-sonnet-5-5',
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

/** Map a stored/legacy model id onto the catalog id that serves it. */
export function canonicalModelId(id: string): string {
  return LEGACY_MODEL_IDS[id] ?? id;
}

export function modelName(id: string): string {
  const c = canonicalModelId(id);
  return PLATFORM_MODELS.find(m => m.id === c)?.name ?? id;
}

/** Same order as the web switcher: unlocked first, then MODUS+, then PILOT. */
export function sortedModels(plan: string): typeof PLATFORM_MODELS {
  const ep = effectivePlan(plan);
  const rank = (m: (typeof PLATFORM_MODELS)[number]) => (m.plans.includes(ep) ? 0 : m.plans.includes('modus') ? 1 : 2);
  return [...PLATFORM_MODELS].sort((a, b) => rank(a) - rank(b));
}
