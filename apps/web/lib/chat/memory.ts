import { generateText } from 'ai';
import { backgroundModel } from '@/lib/chat/model';

/**
 * Decide what (if anything) from one chat exchange is worth saving to long-term
 * vector memory. Returns a single durable fact about the user, or null when the
 * exchange is ephemeral (email counts, today's schedule, the user's questions,
 * web-search results, generic explanations). Replaces the old behavior of
 * dumping the raw user message + assistant reply, which polluted retrieval with
 * stale, low-value content.
 */
/**
 * Facts about the CONVERSATION, not the user. The model sometimes answers the
 * "is there a durable fact" question with the only thing it is sure of, e.g.
 * "Jeremiah is interacting with the assistant." (seen in the live index,
 * 10-25). Such a line matches nearly every query weakly and teaches nothing.
 */
export function isJunkFact(fact: string): boolean {
  const f = fact.toLowerCase();
  return (
    /\b(interact(s|ing)?|chatting|talking|speaking|conversing)\b.*\b(assistant|modus|ai|chatbot|bot)\b/.test(f) ||
    /\b(is|was) (using|asking|testing|trying)\b.*\b(assistant|modus|ai|chatbot|bot|app)\b/.test(f) ||
    /\b(asked|is asking|wants to know|requested|inquired)\b/.test(f) ||
    /\bno (durable|lasting) fact\b|\bnothing (durable|worth)\b/.test(f)
  );
}

export async function extractDurableMemory(userMsg: string, assistantText: string): Promise<string | null> {
  // Cheap pre-filter: nothing to extract from trivially short turns.
  if (userMsg.trim().length < 12 && assistantText.trim().length < 40) return null;

  try {
    const { text } = await generateText({
      // 🚨 Was the raw Gateway model. A rate-limited free tier then meant this
      // threw on EVERY message, was caught below, and returned null — so MODUS
      // silently learned nothing about the user for as long as the balance was
      // low. Memory is the product's whole wedge; losing it must not be quieter
      // than losing a chat reply.
      model: backgroundModel('meta/llama-3.3-70b', 'memory'),
      maxTokens: 80,
      prompt: `You curate a user's long-term memory. Decide if this chat exchange contains a DURABLE fact about the USER worth remembering for weeks.

SAVE only lasting facts about the user:
- identity/background (role, company, location, family)
- stable preferences and working style
- goals, projects, commitments they are pursuing
- important relationships (name + who they are)
- decisions made or hard constraints

DO NOT save:
- transient state (unread email counts, today's schedule/weather, current task status)
- the user's questions or requests
- general knowledge, definitions, or web-search results
- the assistant's explanations or summaries
- anything tied to a specific day or stale tomorrow

If there is a durable fact, output ONE concise third-person sentence stating it (e.g. "Jeremiah is raising a $1M pre-seed round through Y Combinator."). If nothing is worth saving, output exactly: NONE

User: ${userMsg.slice(0, 2000)}
Assistant: ${assistantText.slice(0, 2000)}

Memory:`,
    });

    const fact = text.trim().replace(/^memory:\s*/i, '').trim();
    if (!fact || /^none\b/i.test(fact) || fact.length < 12) return null;
    if (isJunkFact(fact)) return null;
    return fact;
  } catch (e) {
    console.error('[memory] extraction failed:', e);
    return null;
  }
}
