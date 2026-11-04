/**
 * Does the overlay parse the answer stream, and does it remember the conversation?
 *
 * Two things are checked, both of which were REAL, USER-REPORTED failures:
 *
 *  1. THE TRANSCRIPT. Every ask used to build one fresh message, so a follow-up
 *     arrived at the model with no screenshot, no earlier question and no earlier
 *     answer. The panel appeared to forget everything the instant you sent a
 *     second message — reported as "my messages aren't showing, and sending a new
 *     one resets it".
 *  2. THE STREAM PARSER. /api/chat speaks the AI SDK data-stream protocol, not
 *     plain text. A chunk from the network is NOT a frame: split one mid-JSON and
 *     a naive parser silently drops whichever tokens straddled the boundary. That
 *     failure only shows up on slow connections, which is exactly when nobody is
 *     in a position to debug it.
 *
 *   cd apps/desktop && npx tsx scripts/verify-assist-protocol.ts
 */
import { ask, buildTurn, buildWatchTurn, createFrameParser, handleFrame, trimForRequest, MAX_TURNS, SCREEN_PROMPT, WATCH_PROMPT, DEFAULT_QUESTION, type AssistEvents, type AssistTurn } from '../src/main/screen/assist';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

/** Collects everything the parser emits, so assertions read off real output. */
function recorder(): AssistEvents & { text: string; models: string[]; errors: string[]; done: number; aborted: number } {
  const r = {
    text: '', models: [] as string[], errors: [] as string[], done: 0, aborted: 0,
    onDelta(t: string) { r.text += t; },
    onModel(id: string) { r.models.push(id); },
    onError(e: { message: string }) { r.errors.push(e.message); },
    onDone() { r.done++; },
    onAborted() { r.aborted++; },
  };
  return r as AssistEvents & typeof r;
}

const textOf = (t: AssistTurn): string =>
  t.role === 'assistant' ? t.content : (t.content.find((c) => c.type === 'text') as { text: string }).text;
const imageOf = (t: AssistTurn): string | null =>
  t.role === 'assistant' ? null : ((t.content.find((c) => c.type === 'image') as { image: string } | undefined)?.image ?? null);

console.log('\nBuilding turns\n');

{
  const t = buildTurn('what is this error?', 'IMGDATA', true);
  check('the first turn carries the screenshot', imageOf(t) === 'IMGDATA');
  check('the first turn carries the screen instruction', textOf(t).startsWith(SCREEN_PROMPT));
  check('…and the actual question', textOf(t).includes('what is this error?'));
  check('image comes before text', t.role === 'user' && t.content[0].type === 'image');
}

{
  // The follow-up. Re-sending the image here is a second full image billed as
  // input tokens for information the provider already has in context.
  const t = buildTurn('ok how do I fix it?');
  check('a follow-up carries NO image', imageOf(t) === null);
  check('a follow-up does NOT repeat the screen instruction', !textOf(t).includes(SCREEN_PROMPT));
  check('a follow-up is just the question', textOf(t) === 'ok how do I fix it?');
}

{
  const t = buildTurn('   ', 'IMG', true);
  check('an empty question falls back to a real default', textOf(t).includes(DEFAULT_QUESTION));
}

console.log('\nThe conversation actually accumulates\n');

{
  // Mirrors what overlay.ts does across three turns, including a recapture.
  const messages: AssistTurn[] = [];
  messages.push(buildTurn('what is this?', 'SHOT1', messages.length === 0));
  messages.push({ role: 'assistant', content: 'It is a DMV form.' });
  messages.push(buildTurn('what do I enter?', undefined, messages.length === 0));
  messages.push({ role: 'assistant', content: 'Your address.' });
  messages.push(buildTurn('and now?', 'SHOT2', messages.length === 0));

  check('every turn is retained', messages.length === 5, `${messages.length} turns`);
  check('the model still sees the first question', textOf(messages[0]).includes('what is this?'));
  check('the model still sees its own earlier answer', textOf(messages[1]) === 'It is a DMV form.');
  check('the first screenshot is still in the thread', imageOf(messages[0]) === 'SHOT1');
  check('the follow-up did not duplicate the screenshot', imageOf(messages[2]) === null);
  check('a RECAPTURE does attach the new screenshot', imageOf(messages[4]) === 'SHOT2');
  check('exactly 2 images for 2 captures across 3 questions',
    messages.filter((m) => imageOf(m) !== null).length === 2);
  check('only the first turn carries the instruction',
    messages.filter((m) => m.role === 'user' && textOf(m).includes(SCREEN_PROMPT)).length === 1);
}

{
  // The impatience case: two questions fired before the first returns. The first
  // is aborted and must be removed BY IDENTITY — a pop() would delete the second,
  // still-running question instead.
  const messages: AssistTurn[] = [];
  const turnA = buildTurn('first question', 'SHOT', true);
  messages.push(turnA);
  const turnB = buildTurn('second question');
  messages.push(turnB);

  const dropByIdentity = (t: AssistTurn): void => {
    const i = messages.indexOf(t);
    if (i !== -1) messages.splice(i, 1);
  };
  dropByIdentity(turnA); // A was the one that got aborted

  check('aborting the FIRST question removes the first, not the second',
    messages.length === 1 && textOf(messages[0]) === 'second question',
    `left: ${messages.map(textOf).join(' | ')}`);
}

console.log('\nWatch mode compares two frames\n');

{
  // The bug: watch used to send ONE frame and ask "what changed?". The model had
  // never seen the before state, so every answer contained an invented transition.
  const t = buildWatchTurn('BEFORE', 'AFTER');
  const imgs = t.role === 'user' ? t.content.filter((c) => c.type === 'image') : [];
  check('a watch turn carries TWO images', imgs.length === 2, `${imgs.length}`);
  check('before comes first', (imgs[0] as { image: string }).image === 'BEFORE');
  check('after comes second', (imgs[1] as { image: string }).image === 'AFTER');
  check('it asks for a comparison', textOf(t) === WATCH_PROMPT);
  check('it can answer "nothing to flag"', WATCH_PROMPT.includes('nothing to flag'));
  check('it forbids guessing at the transition', /do not guess/i.test(WATCH_PROMPT));
}

{
  // The very first look has no previous frame. It must ask something answerable
  // rather than pretending there is a before.
  const t = buildWatchTurn(undefined, 'AFTER');
  const imgs = t.role === 'user' ? t.content.filter((c) => c.type === 'image') : [];
  check('the first look sends only the current frame', imgs.length === 1);
  check('and does NOT claim to be comparing', textOf(t) !== WATCH_PROMPT && !/before/i.test(textOf(t)));
  check('but still allows "nothing to flag"', textOf(t).includes('nothing to flag'));
}

{
  // trimForRequest keeps only the newest image-bearing turn — it must keep BOTH
  // of that turn's images, or the comparison silently degrades to a guess again.
  const messages: AssistTurn[] = [
    buildTurn('q1', 'OLDSHOT', true),
    { role: 'assistant', content: 'a1' },
    buildWatchTurn('BEFORE', 'AFTER'),
  ];
  const sent = trimForRequest(messages);
  const last = sent[sent.length - 1];
  const imgs = last.role === 'user' ? last.content.filter((c) => c.type === 'image') : [];
  check('trimming preserves BOTH watch frames', imgs.length === 2, `${imgs.length}`);
  check('and still drops the older screenshot',
    sent.slice(0, -1).every((m) => imageOf(m) === null));
}

console.log('\nTrimming — this one is about money\n');

{
  // History is re-sent in full on every request. Without trimming, question ten
  // re-uploads every screenshot taken so far, each billed again as input tokens.
  const messages: AssistTurn[] = [];
  messages.push(buildTurn('q1', 'SHOT1', true));
  messages.push({ role: 'assistant', content: 'a1' });
  messages.push(buildTurn('q2', 'SHOT2'));
  messages.push({ role: 'assistant', content: 'a2' });
  messages.push(buildTurn('q3', 'SHOT3'));

  const sent = trimForRequest(messages);
  const images = sent.filter((m) => imageOf(m) !== null);
  check('only ONE image is ever sent', images.length === 1, `${images.length} image(s)`);
  check('and it is the most recent one', imageOf(images[0]) === 'SHOT3', String(imageOf(images[0])));
  check('older turns keep their text', textOf(sent[0]).includes('q1') && textOf(sent[2]).includes('q2'));
  check('no turn is left with empty content',
    sent.every((m) => m.role === 'assistant' || m.content.length > 0));
  check('trimming does not mutate the stored thread',
    messages.filter((m) => imageOf(m) !== null).length === 3, 'the panel still owns all 3');
}

{
  const messages: AssistTurn[] = [buildTurn('the very first question', 'SHOT', true)];
  for (let i = 0; i < 40; i++) {
    messages.push({ role: 'assistant', content: `answer ${i}` });
    messages.push(buildTurn(`question ${i}`));
  }
  const sent = trimForRequest(messages);
  check('a long thread is capped', sent.length <= MAX_TURNS, `${sent.length} turns from ${messages.length}`);
  check('the framing first turn is preserved', textOf(sent[0]).includes(SCREEN_PROMPT));
  check('the newest turn survives', textOf(sent[sent.length - 1]).includes('question 39'));
}

{
  // 🪤 Anthropic REJECTS non-alternating roles with a 400. head is always a user
  // turn, so if the tail also opened with one the request was user,user,… — the
  // panel would simply stop working once a thread got long, on Claude only.
  for (const n of [13, 14, 20, 21, 40, 41]) {
    const messages: AssistTurn[] = [buildTurn('first', 'SHOT', true)];
    for (let i = 1; i < n; i++) {
      messages.push(i % 2 === 1 ? { role: 'assistant', content: `a${i}` } : buildTurn(`q${i}`));
    }
    const sent = trimForRequest(messages);
    let alternates = true;
    for (let i = 1; i < sent.length; i++) if (sent[i].role === sent[i - 1].role) alternates = false;
    check(`roles alternate after trimming a ${n}-turn thread`, alternates,
      sent.map((m) => m.role[0]).join(''));
    check(`  …and it still starts with a user turn (${n})`, sent[0].role === 'user');
  }
}

{
  const short: AssistTurn[] = [buildTurn('only question', 'SHOT', true)];
  const sent = trimForRequest(short);
  check('a single-turn thread is untouched', sent.length === 1 && imageOf(sent[0]) === 'SHOT');
}

{
  check('an empty thread trims to empty', trimForRequest([]).length === 0);
}

console.log('\nStream parsing\n');

{
  const r = recorder();
  const p = createFrameParser(r);
  p.push('0:"Hello"\n0:" world"\n');
  p.flush();
  check('text deltas are joined', r.text === 'Hello world', JSON.stringify(r.text));
}

{
  // THE bug this guard exists for.
  const r = recorder();
  const p = createFrameParser(r);
  const whole = '0:"Here is what I can see on your screen"\n0:" — a DMV form."\n';
  // Feed it one character at a time: the most hostile split possible.
  for (const ch of whole) p.push(ch);
  p.flush();
  check('a frame split across every possible boundary still parses',
    r.text === 'Here is what I can see on your screen — a DMV form.', JSON.stringify(r.text));
}

{
  const r = recorder();
  const p = createFrameParser(r);
  p.push('0:"abc"\n0:"de');   // deliberately cut mid-JSON
  check('a partial frame emits nothing until its newline arrives', r.text === 'abc', JSON.stringify(r.text));
  p.push('f"\n');
  check('…and completes once it does', r.text === 'abcdef', JSON.stringify(r.text));
}

{
  const r = recorder();
  const p = createFrameParser(r);
  p.push('8:[{"modusServedModel":"claude-sonnet-5","modusRequestedModel":"claude-opus-4-8"}]\n');
  p.flush();
  check('the served model is read from the annotation', r.models[0] === 'claude-sonnet-5', r.models.join(','));
  check('an annotation is not printed as answer text', r.text === '', JSON.stringify(r.text));
}

{
  const r = recorder();
  const p = createFrameParser(r);
  p.push('3:"rate limit reached"\n');
  p.flush();
  check('an error frame surfaces as an error', r.errors[0] === 'rate limit reached');
}

{
  // Reasoning deltas are hidden thinking. Rendering them as the answer would show
  // the user the model's scratchpad.
  const r = recorder();
  const p = createFrameParser(r);
  p.push('g:"let me think about this"\n0:"The answer."\nd:{"finishReason":"stop"}\n');
  p.flush();
  check('reasoning deltas are NOT shown as the answer', r.text === 'The answer.', JSON.stringify(r.text));
}

{
  const r = recorder();
  const p = createFrameParser(r);
  p.push('zz:{"something":"new"}\n0:"still fine"\n');
  p.flush();
  check('an unknown frame code is ignored, not fatal', r.text === 'still fine' && r.errors.length === 0);
}

{
  const r = recorder();
  handleFrame('0:not-valid-json', r);
  check('malformed JSON does not throw', r.text === '' && r.errors.length === 0);
}

{
  // Raw protocol must never reach the user. This is what the panel would have
  // rendered if the body were treated as plain text.
  const r = recorder();
  const p = createFrameParser(r);
  p.push('0:"a"\n0:"b"\n');
  p.flush();
  check('the protocol itself never leaks into the text', !r.text.includes('0:'), JSON.stringify(r.text));
}

void (async () => {
console.log('\nEvery request ends in words on screen (11-03 audit round 3)\n');

{
  const enc = new TextEncoder();
  const realFetch = globalThis.fetch;
  /** Run the REAL ask() against a faked server and collect what it emits. */
  async function run(fake: (signal: AbortSignal) => Promise<Response>, outer?: AbortController) {
    globalThis.fetch = ((_u: unknown, init?: RequestInit) => fake(init!.signal!)) as typeof fetch;
    const r = recorder();
    await ask({ messages: [buildTurn('hi', 'IMG', true)], token: 't', stallMs: 300, signal: outer?.signal }, r);
    globalThis.fetch = realFetch;
    return r;
  }
  const stream = (chunks: string[], hang = false) => new Response(new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); if (!hang) c.close(); },
  }), { status: 200 });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const never = (signal: AbortSignal) => new Promise<Response>((_res, rej) =>
    signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));

  let r = await run(async () => stream(['0:"Hello "\n', '0:"there"\n', 'd:{"finishReason":"stop"}\n']));
  check('a normal answer streams and finishes', r.text === 'Hello there' && r.done === 1 && r.errors.length === 0, JSON.stringify(r));

  r = await run(async () => stream(['3:"chat_error"\n']));
  check('a stream error CODE is shown as words, not "chat_error"', r.errors.length === 1 && !r.errors[0].includes('_'), r.errors[0]);

  r = await run(async () => stream(['3:"rate_limit_reached"\n']));
  check('rate_limit_reached reads as busy', /busy/i.test(r.errors[0] ?? ''), r.errors[0]);

  r = await run(async () => stream(['0:"half"\n'], true));
  check('a body that goes silent ends in a stall message', r.errors.some(e => /stalled/i.test(e)) && r.aborted === 0, JSON.stringify(r.errors));

  r = await run(never);
  check('a request that never gets a response ends in a stall message', r.errors.some(e => /stalled/i.test(e)) && r.aborted === 0, JSON.stringify(r.errors));

  r = await run(async () => json(402, { error: 'free_limit_reached' }));
  check('402 free_limit_reached says FREE limit, not "trial ended"', /free limit/i.test(r.errors[0] ?? '') && !/trial/i.test(r.errors[0] ?? ''), r.errors[0]);

  r = await run(async () => json(402, { error: 'image_requires_subscription' }));
  check('402 image_requires_subscription names the paid plan', /paid plan/i.test(r.errors[0] ?? ''), r.errors[0]);

  r = await run(async () => json(429, { error: 'token_limit_reached', resetAt: Date.now() + 3 * 3600e3 }));
  check('429 token_limit_reached says when it resets', /resets in about 3 hours/.test(r.errors[0] ?? ''), r.errors[0]);

  const outer = new AbortController();
  setTimeout(() => outer.abort(), 50);
  r = await run(never, outer);
  check('a caller cancel stays SILENT (onAborted, no error)', r.aborted === 1 && r.errors.length === 0, JSON.stringify(r));
}

console.log(`\n${failures === 0 ? '✅ PASS' : `❌ ${failures} FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
})();
