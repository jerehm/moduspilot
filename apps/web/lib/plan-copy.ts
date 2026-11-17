/**
 * Plan names, taglines and feature lists. One source for the pricing cards
 * (HomePricingSection) and the checkout order summary, so the offer reads the
 * same everywhere. Prices live in lib/pricing.ts.
 */
export type PlanCopy = {
  id: 'free' | 'modus' | 'pilot';
  name: string;
  tagline: string;
  features: string[];
  popular?: boolean;
  free?: boolean;
};

export const PLANS: PlanCopy[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'For trying it out.',
    free: true,
    features: [
      'The open models: Llama, DeepSeek and Gemini Flash',
      'A rolling window that refreshes through the day',
      'Full context in every conversation',
      'Web and Mac apps',
      'No card, ever',
    ],
  },
  {
    id: 'modus',
    name: 'MODUS',
    tagline: 'Cancel anytime.',
    popular: true,
    features: [
      'Every provider, auto-routed: GPT-6, Claude, Gemini, Llama',
      'Chat with full context and higher limits',
      'Generate images and editable PDFs',
      'Voice interface',
      'Gmail / Outlook, Calendar and Drive',
      'Daily briefings, goals and a habit engine',
      '90-day context memory',
      'Web, Mac and iPhone (beta)',
    ],
  },
  {
    id: 'pilot',
    name: 'PILOT',
    tagline: 'For founders and executives.',
    features: [
      'Everything in MODUS',
      'The frontier models, manual pick per message: GPT-6 Astra, Claude Opus 5.5, Claude Fable 5.1 and Gemini 4',
      'Unlimited context memory',
      'Wearable sync: HealthKit, Oura and Whoop',
      'Financial pulse via Plaid',
      'Relationship CRM and meeting intelligence',
      'Slack, Notion and Linear',
      'Priority response SLA',
    ],
  },
];

export function planCopy(id: 'modus' | 'pilot'): PlanCopy {
  return PLANS.find(p => p.id === id)!;
}
