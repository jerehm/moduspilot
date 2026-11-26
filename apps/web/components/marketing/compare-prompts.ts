import { MODEL_LOGOS, OpenAILogo, ClaudeLogo, GeminiLogo } from './ModelLogos';

// The compare examples: one prompt, three models, a verdict. Shared by the
// homepage's looping ModelCompareDemo and the static cards on /start, so the two
// never drift. A plain module (not 'use client') so server pages can read it.

type Logo = (typeof MODEL_LOGOS)[number]['logo'];
export type CompareCol = { name: string; logo: Logo; answer: string; ms: number };
export type ComparePrompt = { q: string; cols: CompareCol[]; verdict: string };

export const COMPARE_PROMPTS: ComparePrompt[] = [
  {
    q: 'Explain compound interest to a 10 year old.',
    cols: [
      { name: 'ChatGPT', logo: OpenAILogo, ms: 1400, answer: 'Imagine a snowball rolling downhill. It picks up more snow, so it gets bigger. The bigger it gets, the more it picks up.' },
      { name: 'Claude', logo: ClaudeLogo, ms: 2100, answer: 'You have $10. Every year it grows 10%. Year one you earn $1. Year two you earn $1.10, because now $11 is earning for you. Your money makes money.' },
      { name: 'Gemini', logo: GeminiLogo, ms: 900, answer: 'Money that makes money, which then makes more money. Like a tree that grows seeds that grow more trees.' },
    ],
    verdict: 'Claude explained the mechanism, Gemini was fastest, ChatGPT stayed simplest. Modus picked Claude.',
  },
  {
    q: 'Write the first line of a cold email to a busy CEO.',
    cols: [
      { name: 'ChatGPT', logo: OpenAILogo, ms: 1200, answer: '"Hi Sarah, I’ll be quick: we help teams like yours cut reporting time in half."' },
      { name: 'Claude', logo: ClaudeLogo, ms: 1900, answer: '"Hi Sarah, you’re hiring five AEs this quarter. We ramp new reps 40% faster."' },
      { name: 'Gemini', logo: GeminiLogo, ms: 1000, answer: '"Hi Sarah, congrats on the raise. We help post-raise teams scale ops without new headcount."' },
    ],
    verdict: 'Gemini opened with a real trigger, Claude led with their problem, ChatGPT was cleanest. Modus picked Gemini.',
  },
  {
    q: 'Dinner with chicken, rice and spinach?',
    cols: [
      { name: 'ChatGPT', logo: OpenAILogo, ms: 1100, answer: 'One-pan chicken and rice: sear the chicken, add rice and stock, stir spinach in at the end. 25 minutes.' },
      { name: 'Claude', logo: ClaudeLogo, ms: 2000, answer: 'Garlic-butter chicken rice bowl: crisp the chicken, cook rice in the pan juices, wilt the spinach, finish with lemon.' },
      { name: 'Gemini', logo: GeminiLogo, ms: 900, answer: 'Chicken and spinach fried rice: stir-fry the chicken, toss in cold rice, spinach and soy. Weeknight fast.' },
    ],
    verdict: 'Claude added the most flavor, Gemini was the fastest weeknight option, ChatGPT the simplest. Modus picked ChatGPT.',
  },
];
