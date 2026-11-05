import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { requireAuth } from '@/lib/api-auth';
import { enforceAuxHourlyLimit } from '@/lib/chat/aux-limit';
import { modelName } from '@/lib/models';

// The one-line verdict under a comparison. Runs on gpt-4o-mini once all three
// columns finish. Judgement is about which answer served the user better, not
// which model is "best" in the abstract.

// This must hold a WHOLE answer, whatever the compare route is currently willing
// to generate. It was 1500, which silently cut a normal 5-paragraph essay in half
// — and the judge then reported the answer as "cut off, leaving it incomplete"
// and marked the model DOWN for damage we had done to it. A judge must see what
// the user saw, or it is reviewing our truncation, not the model.
//
// 🪤 That is a coupling, and it drifted: 4000 was correct when compare capped
// answers at 900 output tokens, but reasoning models there now get 16000 (~64k
// chars). So the identical bug came back on exactly the long-form answers the
// clarify gate invites the user to ask for. Sized to the cap, not to a guess.
// Worst case is 3 x 64k chars ≈ 48k tokens into gpt-4o-mini's 128k context.
const MAX_ANSWER_CHARS = 64000;

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  // Bounded per user per hour. This route calls a model and had no cap at all.
  const limited = await enforceAuxHourlyLimit(auth.uid, 'verdict', 60);
  if (limited) return limited;

  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ verdict: null });

  let body: { prompt?: string; answers?: { model?: string; text?: string; ms?: number }[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Bad JSON' }, { status: 400 });
  }

  const prompt = String(body.prompt ?? '').slice(0, 2000);
  const answers = (body.answers ?? []).filter(a => a?.text?.trim()).slice(0, 3);
  // Nothing meaningful to compare with fewer than two real answers.
  if (!prompt || answers.length < 2) return Response.json({ verdict: null });

  const block = answers
    .map(a => `### ${modelName(String(a.model))} (${a.ms ? `${(a.ms / 1000).toFixed(1)}s` : 'n/a'})\n${String(a.text).slice(0, MAX_ANSWER_CHARS)}`)
    .join('\n\n');

  try {
    const openai = createOpenAI({ apiKey: key });
    const { text } = await generateText({
      model: openai('gpt-4o-mini'),
      temperature: 0.2,
      maxTokens: 90,
      // A judge that cannot answer in 25s is not worth waiting on; it used to hit
      // the 20s function cap and die without a response.
      abortSignal: AbortSignal.timeout(25_000),
      system:
        'You compare answers from different AI models to the same question. In at most 2 short sentences, ' +
        'say which answer served the user best and why, and note one meaningful difference between the others. ' +
        'Name models exactly as given in the headings. Be specific and honest — if they are essentially the ' +
        'same, say so plainly rather than inventing a winner. No preamble, no markdown headers, no lists.\n' +
        // Relevance was not a criterion, so a well-built answer to the WRONG
        // question won on craft: a vague "generate any essay" had one model
        // write about the Titanic and the others about the Berlin Wall, and the
        // verdict crowned the Titanic for being "well-structured". Answering the
        // question is the first test, not one merit among several.
        'ANSWERING THE QUESTION COMES FIRST. An answer that is well written but addresses a different ' +
        'subject than the others has not served the user, however good it reads — say so and do not pick it. ' +
        'If the question was open enough that the models each chose a different subject, that is not one of ' +
        'them being wrong: say the prompt was too open to compare and that a more specific ask would compare ' +
        'them properly.',
      prompt: `Question:\n${prompt}\n\nAnswers:\n${block}\n\nVerdict:`,
    });

    const verdict = text.trim().replace(/^["']|["']$/g, '');
    return Response.json({ verdict: verdict.length > 2 ? verdict : null });
  } catch (err) {
    console.error('[compare/verdict] failed:', err);
    return Response.json({ verdict: null });
  }
}

export const maxDuration = 60;
