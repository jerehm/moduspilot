import { OpenAILogo, ClaudeLogo, GeminiLogo, MetaLogo } from '@/components/marketing/ModelLogos';
import { PLAN_PRICING } from '@/lib/pricing';

// Single source of truth for the founding journey's facts. Everything here must
// be accurate — a false claim on a page asking for money is worse than none.
//
// ⚠️ Grok / xAI is intentionally absent: MODUS does not serve it (xAI credits
//    are off; grok-4.5 is commented out in lib/models.ts). Never add it here.
// Model display names match lib/models.ts exactly.

export interface FrontierModel {
  name: string;
  provider: string;
  blurb: string;
  logo: (p: { className?: string }) => React.ReactNode;
  accent: string;
}

// The frontier models a founder unlocks at PILOT (lib/models.ts, `pilot` plan).
export const FRONTIER_MODELS: FrontierModel[] = [
  { name: 'Claude Opus 5.5',    provider: 'Anthropic', blurb: 'Deepest reasoning & code',      logo: ClaudeLogo, accent: '#D97757' },
  { name: 'GPT-6 Astra',    provider: 'OpenAI',    blurb: 'Frontier problem-solving',      logo: OpenAILogo, accent: '#10A37F' },
  { name: 'Gemini 4', provider: 'Google',    blurb: 'Massive-context research',      logo: GeminiLogo, accent: '#4285F4' },
  { name: 'Claude Fable 5.1', provider: 'Anthropic', blurb: 'Most capable for writing & taste', logo: ClaudeLogo, accent: '#D97757' },
  { name: 'Llama 4 Maverick', provider: 'Meta',    blurb: 'Open-weight, blazing fast',     logo: MetaLogo,   accent: '#0866FF' },
];

// What buying the frontier tier from each lab costs on its own (flagship consumer
// tier, verified mid-2026). Meta's Llama is open/free, so it isn't a paid row —
// it's a bonus. See the plan for sources.
export interface PriceRow {
  lab: string;
  tier: string;
  price: number;
  logo: (p: { className?: string }) => React.ReactNode;
}
export const PRICE_TEARDOWN: PriceRow[] = [
  { lab: 'OpenAI',    tier: 'ChatGPT Pro', price: 200, logo: OpenAILogo },
  { lab: 'Anthropic', tier: 'Claude Max',  price: 200, logo: ClaudeLogo },
  { lab: 'Google',    tier: 'AI Ultra',    price: 200, logo: GeminiLogo },
];
export const TEARDOWN_TOTAL = PRICE_TEARDOWN.reduce((s, r) => s + r.price, 0); // 600

// The founding offer, stated exactly as /api/founding/checkout bills it: the
// line item is STRIPE_PRICE_MODUS (the entry MODUS price) while the webhook
// grants plan 'pilot'. So a founder pays the MODUS price and receives the PILOT
// tier. Both numbers come from lib/pricing.ts — the same file the checkout
// resolves its Stripe price from — so the page can never quote an amount Stripe
// isn't actually charging.
export const FOUNDING_PRICE = PLAN_PRICING.modus.monthlyPrice; // what they're billed
export const PILOT_PRICE = PLAN_PRICING.pilot.monthlyPrice;    // what they receive
export const PILOT_SAVING = PILOT_PRICE - FOUNDING_PRICE;      // the gap the offer gives away

// The five standing founding perks (single source of truth — FoundingOffer.tsx imports this).
export const JOURNEY_PERKS: [string, string][] = [
  ['Every frontier model', 'Full PILOT. Claude Opus 5.5, GPT-6 Astra, Gemini 4, Fable 5.1 and more.'],
  ['$28/mo for full PILOT', 'You pay the MODUS price and get the $59 PILOT tier.'],
  ['Founder forever', 'You keep top-tier access as Modus grows and plans change.'],
  ['A direct line to the founder', 'Reach Jeremiah directly and help shape the roadmap.'],
  ['Permanent founding badge', 'A founding mark that stays yours as Modus grows.'],
];
