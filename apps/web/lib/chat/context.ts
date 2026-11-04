/**
 * Live-context retrieval for the chat route: intent detection + the per-source
 * fetchers (Pinecone memory, Gmail, Calendar, Drive, web search, Notion/Slack/
 * GitHub connectors, pinned project resources). Each fetcher returns the prompt
 * block string(s) it produces and swallows its own failures behind hard
 * timeouts so a slow integration can never kill the response. Logic and strings
 * are reproduced verbatim from the original route.
 */
import { memoryKey, queryMemory } from '@/lib/pinecone';
import { adminDb } from '@/lib/firebase-admin';
import { getValidAccessToken, getAllValidAccessTokens, getAllGoogleAccounts } from '@/lib/google-oauth';
import { getActionableThreads, type GmailThread } from '@/lib/google-gmail';
import { getTodayEvents, fmtEventTime, type CalendarEvent } from '@/lib/google-calendar';
import { webSearch, shouldWebSearch } from '@/lib/tavily';
import { isSelfQuery } from '@/lib/chat/self-query';
import { searchDriveFiles, shouldSearchDrive, mimeLabel } from '@/lib/google-drive';
import { getNotionAccounts, getFirstNotionToken } from '@/lib/notion-oauth';
import { getSlackAccounts, getFirstSlackToken } from '@/lib/slack-oauth';
import { getGitHubAccounts, getFirstGitHubToken } from '@/lib/github-oauth';
import { getRecentNotionPages } from '@/lib/notion-data';
import { getRecentSlackActivity } from '@/lib/slack-data';
import { getGitHubWorkItems } from '@/lib/github-data';
import type { ProjectContext } from './prompt';

/**
 * Resolve to `fallback` if `p` hasn't settled within `ms`. Never rejects, never
 * blocks past the cap.
 *
 * The file header has always claimed every fetcher sits behind a hard timeout.
 * Two did not: fetchWebSearchBlock (Tavily) and fetchDriveBlock (a Google token
 * refresh + a Drive search) each awaited an unbounded network call on the path to
 * the first token, and fetchGroupAvailabilityBlock was the same. A missing cap is
 * invisible until the day the provider is slow, and then it shows up as a chat
 * that appears to hang.
 *
 * Context is a NICE-TO-HAVE. Answering late is worse than answering without the
 * extra block, so every cap here fails open to ''.
 */
export function withCap<T>(p: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  // 🚨 THE TIMER MUST BE CANCELLED, OR THE LOG LIES ON EVERY REQUEST.
  //
  // This used to be a bare `setTimeout` inside the losing branch of the race.
  // Nothing cleared it, so the callback fired at `ms` REGARDLESS of whether the
  // work had already won — printing "<label> timed out after Xms — answering
  // without it" on essentially every request, for fetches that had succeeded
  // hundreds of milliseconds earlier. Any request living longer than the cap got
  // the warning, which is all of them.
  //
  // That is worse than noise: it is evidence that points the wrong way. It cost
  // real debugging time during the 2026-07-23 audit — "memory query timed out on
  // 25 of 25 requests" was read straight off these lines and was not true.
  // A timeout log must mean a timeout happened.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>(resolve => {
    timer = setTimeout(() => {
      console.warn(`[chat] ${label} timed out after ${ms}ms — answering without it`);
      resolve(fallback);
    }, ms);
  });
  return Promise.race([
    p.catch((e) => { console.error(`[chat] ${label} failed:`, String(e)); return fallback; }),
    timeout,
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

// ── Contact email cross-reference types ──────────────────────────────────────
export interface ContactEmailEntry {
  name: string;
  company?: string;
  category: 'personal' | 'professional' | 'service' | 'excluded';
}

// Normalize email for reliable matching across aliases:
// - Gmail strips dots from local part (john.doe = johndoe)
// - Gmail strips plus-addressing (user+tag = user)
// - All domains: lowercase + trim
function normalizeEmail(email: string): string {
  const [local, domain] = email.toLowerCase().trim().split('@');
  if (!domain) return email.toLowerCase().trim();
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const noPlus = local.split('+')[0];
    return `${noPlus.replace(/\./g, '')}@${domain}`;
  }
  return `${local.split('+')[0]}@${domain}`;
}

// ── Intent detection ─────────────────────────────────────────────────────────
/**
 * ⏱️ INTENT REGEXES ARE A LATENCY BUDGET, NOT A GUESS.
 *
 * Every `true` here buys a Google round trip on the path to the first token.
 * Measured 2026-07-23 on the live route: a turn that fetches Gmail + Calendar
 * spends ~2.5s MORE in `context=` than one that fetches nothing. So a regex that
 * fires on an ordinary English word taxes messages that could never use the
 * result — "can you send me a draft blog post about fitness" was pulling the
 * user's inbox because it contains "send" and "draft" (measured 3887ms vs
 * 1375ms), and "how are you doing today" pulled the calendar because it contains
 * "today" (5918ms). High precision matters more than high recall: a missed block
 * costs one clarifying question, a false block costs every user 2.5s forever.
 */

/** Words that are ABOUT mail. Always sufficient. */
const EMAIL_STRONG = /\b(e-?mails?|inbox|gmail|unread|threads?|mailbox)\b/i;

export function needsEmailCtx(q: string): boolean {
  if (EMAIL_STRONG.test(q)) return true;
  // Ordinary verbs — reply/respond/forward/wrote — only mean "mail" when they
  // have a counterparty. "draft a reply TO Sam" is an inbox question; "send me a
  // draft blog post" is not. Bare `send`/`draft`/`missed` are gone entirely:
  // they were the false positives, and every real use of them also names a
  // recipient or a mail noun.
  return /\b(reply|respond|forward)\s+to\b/i.test(q)
    || /\bmessage\s+from\b/i.test(q)
    || /\bwrote\s+(to\s+)?me\b/i.test(q);
}

/** Words that are ABOUT the calendar. Always sufficient. */
const CAL_STRONG = /\b(calendar|schedule|meetings?|events?|appointments?|when am i|free time|busy)\b/i;
/** Time words that are only a calendar question in the right company. */
const CAL_TEMPORAL = /\b(today|tonight|tomorrow|this week|next week)\b/i;

export function needsCalendarCtx(q: string): boolean {
  if (CAL_STRONG.test(q)) return true;
  if (!CAL_TEMPORAL.test(q)) return false;
  // A bare "today" is not a calendar question. Require it to be about the user's
  // own time ("what do I have today") or an actual enquiry about the day
  // ("anything on tomorrow"). "How are you doing today" now correctly asks for
  // nothing.
  return /\b(i|me|my|we|our)\b/i.test(q) || /\b(what'?s?|anything|any|got)\b/i.test(q);
}
export function needsNotionCtx(q: string): boolean {
  return /\b(notion|notion page|notion doc|notion database|obsidian)\b/i.test(q);
}
export function needsSlackCtx(q: string): boolean {
  return /\b(slack|slack channel|in slack|the channel|team chat)\b/i.test(q);
}
export function needsGithubCtx(q: string): boolean {
  return /\b(github|pull request|\bpr\b|issue|repo|commit|branch|merge|code review)\b/i.test(q);
}
export function needsNotesCtx(q: string): boolean {
  return /\b(notes?|note app|apple notes|jotted|wrote down|grocery|grocery list|reminder)\b/i.test(q);
}
export function needsMessagesCtx(q: string): boolean {
  return /\b(imessage|text(s|ed)?|messaged|message thread|conversation with|texted me|texting)\b/i.test(q);
}
// Contacts are useful whenever a query is about reaching/identifying a person.
// Gating on this (instead of injecting the whole contact list on every message)
// keeps unrelated queries — code, notes, calendar, general chat — from paying
// the ~1.5k-token contacts tax.
// The bare verbs call|text|message|email used to be in here, which meant an
// everyday "email me the summary" or "send him a message" dragged in the whole
// address book (~1.5k tokens). Keep the person-shaped phrasings, and match those
// verbs only when they're followed by a capitalised name ("email Sarah").
export function needsContactsCtx(q: string): boolean {
  return /\b(contacts?|phone ?numbers?|number for|email for|who is|who's|reach out|get in touch|birthday|anniversary|address for|introduce)\b/i.test(q)
    || /\b(email|call|text|message|dm)\s+[A-Z][a-z]+/.test(q);
}
// Pure greetings/acknowledgements. Anchored ^…$ so only a bare greeting matches —
// "hi, check my inbox" still takes the full context path via needsEmailCtx.
// Deliberately does NOT include "morning": "good morning" is a briefing intent.
// Repeated greeting tokens are the common form and the old list missed them:
// `yo\b` cannot match "yoyo" (no word boundary between the two o/y), so "yoyo"
// and "yoyoyo" were NOT small talk. That fell through to isVagueQuery (<6 words),
// which fired a full Gmail + Calendar + contacts + notes fetch to answer a
// greeting, and left the MCP toolset attached — GitMCP's library matcher then
// answered "yoyo" with "matched to the owner/repo clickfwd/yoyo". `(?:yo+)+`
// covers yo / yoo / yoyo / yoyoyo; same shape for hi and hey.
export const SMALL_TALK = /^(?:(?:yo+)+|(?:hi+)+|(?:hey+)+|hell+o+|sup|thanks?|thank you|ty|ok(ay)?|cool|nice|got it|k|lol|np|sure|yes|no|hey there)\b[\s!.?,]*$/i;

/**
 * Input carrying no answerable content: punctuation, symbols/emoji only, or a
 * single stray character. A slip of the keyboard, not a request.
 *
 * 🪤 SMALL_TALK cannot cover this and never could — every branch of it needs a
 * WORD, and "." has none. So a lone period fell through the small-talk gate,
 * kept GitMCP's full toolset, and was handed to Llama 3.3. Measured on prod
 * 2026-07-23: 3 of 5 sends returned ZERO characters, because the model spent
 * its steps on tool calls and never emitted text —
 *
 *   . → match_common_libs_owner_repo_mapping({library:"react"})
 *     → fetch_generic_documentation({owner:"facebook", repo:"react"})
 *     → finishReason "tool-calls", 0 chars
 *
 * — and one send answered a period with 7,785 characters about the React docs
 * repo. A blank answer leaves the composer's typing indicator running forever,
 * which is what the user reports as "stuck loading".
 *
 * This is the "yoyo" bug re-entering through an input with no word in it, so
 * the predicate is about CONTENT, not vocabulary: no letters and no digits
 * means nothing a tool could act on.
 */
// ⚠️ Written with charCodeAt rather than /[\p{L}\p{N}]/u ON PURPOSE: this file's
// TS target predates the `u` flag (TS1501), and the naive ASCII fallback
// /[a-z0-9]/i would classify 日本語 / العربية / Кириллица as "contentless" and
// silently strip their tools — verify-never-blank covers those inputs precisely
// because they are real. Anything non-ASCII outside the punctuation/arrow and
// emoji blocks counts as a letter, which errs toward "has content" (status quo).
export function isContentlessQuery(q: string): boolean {
  const t = q.trim();
  if (!t) return true;

  let codePoints = 0;
  let hasContent = false;
  for (let i = 0; i < t.length; i++) {
    const unit = t.charCodeAt(i);
    let cp = unit;
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < t.length) {
      cp = (unit - 0xd800) * 0x400 + (t.charCodeAt(i + 1) - 0xdc00) + 0x10000;
      i++; // surrogate pair is ONE code point — an emoji must not count as two
    }
    codePoints++;
    const asciiAlnum = (cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122);
    const letterish = cp > 0x7f
      && !(cp >= 0x2000 && cp <= 0x2bff)    // general punctuation, arrows, symbols
      && !(cp >= 0x1f000 && cp <= 0x1ffff); // emoji planes
    if (asciiAlnum || letterish) hasContent = true;
  }

  // One code point is a slip of the keyboard, not a request. Counting code
  // points (not UTF-16 units) is what makes a lone emoji one character.
  if (codePoints === 1) return true;
  return !hasContent;
}

// Explicit "tell me what's going on" intent — these genuinely need live context.
export function isBriefingIntent(q: string): boolean {
  return /\b(focus|priorit|what('s| is) (next|up|happening|going on)|catch me up|status|brief|overview|update me|check in|morning|today)\b/i.test(q);
}

// Short or open-ended queries get Gmail + Calendar by default (most commonly useful).
// The word-count arm used to swallow greetings too: "hi" is 1 word, so it pulled a
// full Gmail + Calendar + contacts + notes fetch (~5s, ~5k tokens) to say "hey".
// Small talk is now excluded; every other short query keeps the old behaviour.
export function isVagueQuery(q: string): boolean {
  const t = q.trim();
  if (isBriefingIntent(t)) return true;
  if (SMALL_TALK.test(t)) return false;
  // "." is one word and under six, so it used to pull a full Gmail + Calendar
  // + contacts + notes fetch (~5s, ~5k tokens) to answer a keystroke.
  if (isContentlessQuery(t)) return false;
  if (t.split(/\s+/).length >= 6) return false;
  // ⏱️ SHORT IS NOT THE SAME AS PERSONAL — and this rule fans out to email,
  // calendar, notes AND contacts at once, so it is the single most expensive
  // predicate in the file. "explain recursion in one sentence" is five words
  // with nothing to do with the user's life, yet it pulled their whole personal
  // context: measured 3931ms of `context=` against 1375ms for a seven-word
  // question that skipped it. Short questions are the most common kind there
  // are, so this made the commonest messages the slowest.
  //
  // A vague question worth answering from personal data is one that is ABOUT the
  // user ("what should I do today", "how's my week looking"). Require that.
  return /\b(i|me|my|mine|we|us|our)\b/i.test(t);
}

// ── Pinecone semantic memory ─────────────────────────────────────────────────
export async function queryMemoryContext(uid: string, queryText: string): Promise<string> {
  // Uses the same withCap every other fetcher in this file uses. The previous
  // hand-rolled `Promise.race([work, rejectingTimer]).catch(...)` was not unsafe
  // — Promise.race handles every input, so the losing branch cannot leak (see
  // scripts/verify-no-unhandled-rejection.ts) — but it logged in its own format
  // and rejected rather than failing open. One shape for every capped fetch.
  // ⏱️ 800ms WAS NOT A BUDGET, IT WAS AN OFF SWITCH. queryMemory makes TWO
  // sequential network round trips (Pinecone inference embed, then the index
  // query). Measured on the live index (scripts/measure-memory-latency.ts):
  // 688 / 713 / 736 / 986 / 4136ms — avg 1452ms, and the cold first call is the
  // slow one, which on serverless is the common case. Production bore that out:
  // `memory query timed out after 800ms` on 25 of 25 consecutive requests.
  //
  // The cap is sized for a COLD call, because on serverless that is the common
  // case — especially at low traffic, where nearly every request gets a fresh
  // instance. A warm query lands at ~700–1100ms; the first call in a process
  // pays client construction and TLS on top and measured 4136ms. A 2500ms cap
  // was verified to still drop that cold call, which would have meant memory
  // working only for users with enough traffic to keep instances warm.
  //
  // This overlaps rather than adds: the promise is started early and awaited in
  // the same parallel block as the Google/notes/contacts fetches (1000–2900ms of
  // `context=` on their own), and it fails open, so the worst case is exactly
  // today's behaviour — no memory — rather than a slower answer with none.
  // 8 candidates, so collapsing duplicates below still leaves three distinct facts.
  const matches = await withCap(queryMemory(uid, queryText, 8), 4000, [], 'memory query');

  // 🚨 0.55 DISCARDED EVERYTHING. Cosine scores are model-specific, and 0.55 is a
  // sensible bar for OpenAI-style embeddings (relevant ≈ 0.7–0.85) — but this
  // index runs `llama-text-embed-v2`, whose scores for short third-person facts
  // land in a much tighter band. Measured across five natural questions against
  // the real stored memories:
  //
  //   "am I raising money"  → 0.349  "The user is actively fundraising."
  //   "tell me about MODUS" → 0.273  "The user is the CEO of MODUS."
  //   "where do I live"     → 0.135  "…raising a pre-seed for MODUS, based in Sydney."
  //   noise floor           → 0.009 … -0.046
  //
  //   whole index: range 0.009–0.349, and the 0.55 filter kept 0 of 7.
  //
  // So memory was written, stored correctly, retrieved correctly, RANKED
  // correctly — and then thrown away every single time. The life-OS layer has
  // never once put a remembered fact into a prompt.
  //
  // The ranking is trustworthy (the right fact is top for every probe), so the
  // job of the threshold is only to cut the noise floor, not to judge relevance.
  // 0.10 clears the -0.05…0.05 junk while keeping the real hits, and TOP_N caps
  // the blast radius of a marginal one.
  const MIN_SCORE = 0.10;
  const TOP_N = 3;
  const seen = new Set<string>();
  const relevant = matches
    .filter(m => (m.score ?? 0) > MIN_SCORE)
    .filter(m => {
      const key = memoryKey(String(m.metadata?.text ?? ''));
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, TOP_N);
  if (relevant.length > 0) {
    return '\n\nRELEVANT MEMORY FROM PAST CONVERSATIONS:\n' +
      relevant.map(m => `- ${String(m.metadata?.text ?? '')}`).join('\n');
  }
  return '';
}

// ── Google Gmail + Calendar ──────────────────────────────────────────────────
export async function fetchGoogleData(
  uid: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userData: Record<string, any>,
  opts: { wantsEmail: boolean; wantsCalendar: boolean; briefingTimezone: string; contactEmailMap?: Map<string, ContactEmailEntry> },
): Promise<{ gmailBlock: string; calendarBlock: string }> {
  const { wantsEmail, wantsCalendar, briefingTimezone, contactEmailMap } = opts;
  let gmailBlock = '';
  let calendarBlock = '';
  // Hard 5s timeout so a slow Gmail API can never kill the whole response
  try {
    await Promise.race([
      (async () => {
        const allAccounts = await getAllValidAccessTokens(uid);
        const googleToken = allAccounts[0]?.token ?? null;
        if (allAccounts.length === 0 && (wantsEmail || wantsCalendar)) {
          // 🚨 "NO VALID TOKEN" AND "NEVER CONNECTED" ARE NOT THE SAME THING, and
          // conflating them makes MODUS lie to every brand-new customer. This
          // branch used to say "Gmail is connected but the access token could not
          // be refreshed" unconditionally — so a stranger who had never linked
          // Google was told to RECONNECT an account they never had. Verified on
          // prod with a fresh paid account (scripts/verify-new-consumer.ts):
          //   "any emails i should care about"
          //     → "Your Gmail token may need to be reconnected."
          // An empty account collection means never connected; records that exist
          // but yield no token means genuinely broken.
          const linked = await getAllGoogleAccounts(uid).catch(() => []);
          // ⚠️ WRITTEN FOR THE WEAKEST MODEL, because that is the one that gets
          // it. A brand-new customer has no saved Brain, so they default to
          // Llama 3.3 — which on the free Gateway tier fails over to gpt-4o-mini.
          // The first, politer version of this block ("do NOT say the calendar is
          // empty") was simply ignored: gpt-4o-mini still answered "There are no
          // events scheduled on your calendar for today." A negative instruction
          // asks a small model to suppress its default; a SCRIPT gives it
          // something to say instead, which it will reliably take.
          gmailBlock = linked.length === 0
            ? '\n\nGOOGLE ACCOUNT: NOT CONNECTED.\nYou have NO access to this user\'s email or calendar. You cannot see them at all. There is no data to report and no empty result to report either.\nFORBIDDEN, these statements are FALSE and must never be written: "there are no events", "your calendar is clear", "no new emails", "your inbox is empty", "nothing scheduled", "reconnect", "your token expired".\nREQUIRED: say you are not connected to their Google account yet, and that connecting it in Settings → Connectors is what lets you answer questions about their inbox and calendar. Answer in that spirit, in your own words.'
            : '\n\nGOOGLE ACCOUNT: CONNECTED, BUT THE TOKEN IS BROKEN.\nYou cannot read their email or calendar right now. Do NOT invent emails or events and do NOT say there are none — you cannot see them. Tell the user their Google connection stopped working and needs reconnecting in Settings → Connectors.';
          return;
        }
        const gmailFilter = (userData.settings?.gmailFilter as 'primary' | 'all' | undefined) ?? 'primary';
        // Fetch from ALL connected accounts in parallel, then merge + dedupe
        const [allThreadResults, events] = await Promise.all([
          wantsEmail
            ? Promise.all(allAccounts.map(a => getActionableThreads(a.token, { filter: gmailFilter }).catch(() => [] as GmailThread[])))
            : Promise.resolve([] as GmailThread[][]),
          wantsCalendar && googleToken ? getTodayEvents(googleToken, briefingTimezone) : Promise.resolve([] as CalendarEvent[]),
        ]);
        const seenIds = new Set<string>();
        const threads = (allThreadResults as GmailThread[][]).flat()
          .filter(t => { if (seenIds.has(t.id)) return false; seenIds.add(t.id); return true; });
        if (threads.length > 0) {
          gmailBlock = '\n\nINBOX (last 10 days — Gmail IS connected; this is the complete list available. Do NOT suggest connecting Gmail or checking inbox — you already have it. Never invent emails not listed here):\n' +
            threads.slice(0, 10).map((t, i) => {
              // Cross-reference sender with user's contacts
              const contact = contactEmailMap?.get(normalizeEmail(t.fromAddress));
              let fromDisplay: string;
              if (!contact || contact.category === 'excluded') {
                // Unknown sender or excluded contact — show Gmail's display name as-is
                fromDisplay = `${t.from} <${t.fromAddress}>`;
              } else if (contact.category === 'service') {
                fromDisplay = `${contact.name} [Service] <${t.fromAddress}>`;
              } else {
                const catLabel = contact.category === 'professional' ? 'Professional' : 'Personal';
                const companyPart = contact.company ? ` @ ${contact.company}` : '';
                fromDisplay = `${contact.name}${companyPart} [${catLabel}] <${t.fromAddress}>`;
              }
              return `${i + 1}. threadId: ${t.id}\n   From: ${fromDisplay}\n   Reply-to address: ${t.fromAddress}\n   Subject: ${t.subject}\n   Body: ${t.body ? t.body.slice(0, 600) : t.snippet}`;
            }).join('\n\n');
        } else if (wantsEmail) {
          gmailBlock = '\n\nINBOX: Gmail IS connected but no emails found in the last 10 days. Do NOT suggest connecting Gmail — it is already connected.';
        }
        const todayEvents = (events as CalendarEvent[]).filter(e => !e.allDay);
        if (todayEvents.length > 0) {
          calendarBlock = "\n\nTODAY'S CALENDAR:\n" +
            todayEvents.map(e => `- ${fmtEventTime(e.start, briefingTimezone)}: ${e.title}`).join('\n');
        } else if (wantsCalendar) {
          calendarBlock = "\n\nTODAY'S CALENDAR: No events today.";
        }
      })(),
      new Promise<void>(resolve => setTimeout(resolve, 5000)), // hard cap — never block streaming
    ]);
  } catch (e) { console.error('[chat] google (gmail/calendar) context failed:', String(e)); }
  return { gmailBlock, calendarBlock };
}

// ── Web search (Tavily) ──────────────────────────────────────────────────────
export interface WebSearchResult {
  /** The system-prompt block, or '' when nothing was searched. */
  block: string;
  /** How many results came back. 0 means no search ran (or it found nothing). */
  count: number;
}

export async function fetchWebSearchBlock(
  queryText: string,
  capabilities: Record<string, boolean>,
  explicit = false,
): Promise<WebSearchResult> {
  // `count` rides along so the answer can carry an honest "Searched the web · N
  // results" marker. Deriving it by re-parsing the block would be guesswork; the
  // only place that knows is right here.
  const none: WebSearchResult = { block: '', count: 0 };
  if (!queryText || !process.env.TAVILY_API_KEY) return none;
  // Never searchable, however the request arrived: there is nothing about MODUS
  // on the public web, and what IS there belongs to somebody else. This veto
  // outranks an explicit request. See lib/chat/self-query.ts.
  if (isSelfQuery(queryText)) return none;
  // `explicit` = the user hit the composer's "+ → Web search" toggle, or Auto
  // already classified this message as research. Either way the decision is
  // MADE, and shouldWebSearch() does not get to overrule it.
  //
  // It used to. shouldWebSearch() was ANDed in regardless of why webSearch was
  // on, so the "+" toggle did not mean "search this" — it meant "search this, if
  // my keyword list happens to agree too". It usually didn't: "who won the game
  // last night", "tesla stock", "anthropic funding round" and "is claude 5 out
  // yet" all came back silent with the toggle explicitly ON. Auto fared no better
  // — its research heuristic matches 'who won' and 'stock', which Tavily's list
  // lacks, so the router turned search on and this line turned it back off.
  //
  // The keyword list now decides ONE thing only: whether to search a message the
  // user never asked us to search.
  if (!explicit && !(capabilities.webSearch && shouldWebSearch(queryText))) return none;
  return withCap((async () => {
    const results = await webSearch(queryText, 5);
    if (results.length === 0) return none;
    return {
      count: results.length,
      block: '\n\nWEB SEARCH RESULTS (for this query — use these to answer, cite sources naturally):\n' +
        results.map((r, i) => `${i + 1}. ${r.title ?? ''}\n   Source: ${r.url ?? ''}\n   ${(r.content ?? '').slice(0, 350)}`).join('\n\n'),
    };
  })(), 6000, none, 'web search');
}

// ── Google Drive file search ─────────────────────────────────────────────────
export async function fetchDriveBlock(uid: string, queryText: string): Promise<string> {
  if (!(queryText && shouldSearchDrive(queryText))) return '';
  return withCap((async () => {
    const googleToken = await getValidAccessToken(uid);
    if (!googleToken) return '';
    const files = await searchDriveFiles(googleToken, queryText, 5);
    if (files.length === 0) return '';
    return '\n\nGOOGLE DRIVE FILES (matching this query):\n' +
      files.map(f => `- ${mimeLabel(f.mimeType)}: ${f.name} — ${f.webViewLink} (modified ${f.modifiedTime.slice(0, 10)})`).join('\n');
  })(), 5000, '', 'drive context');
}

// ── Connector status + live Notion / Slack / GitHub data ─────────────────────
export async function fetchConnectorData(
  uid: string,
  queryText: string,
): Promise<{ connectorBlock: string; notionBlock: string; slackBlock: string; githubBlock: string }> {
  let connectorBlock = '';
  let notionBlock = '';
  let slackBlock = '';
  let githubBlock = '';
  // 4s hard cap — these external APIs must never kill the response
  try {
    await Promise.race([
      (async () => {
        // The *Accounts reads must always run — they build connectorBlock, which is
        // what stops the model telling a connected user to "connect your Notion".
        // The *Token reads are only used by the intent-gated data fetches below, so
        // gate them the same way instead of fetching (and discarding) every message.
        const wantsNotion = needsNotionCtx(queryText);
        const wantsSlack  = needsSlackCtx(queryText);
        const wantsGithub = needsGithubCtx(queryText);
        const [notionAccounts, slackAccounts, githubAccounts, notionToken, slackToken, githubToken] = await Promise.all([
          getNotionAccounts(uid),
          getSlackAccounts(uid),
          getGitHubAccounts(uid),
          wantsNotion ? getFirstNotionToken(uid) : Promise.resolve(null),
          wantsSlack  ? getFirstSlackToken(uid)  : Promise.resolve(null),
          wantsGithub ? getFirstGitHubToken(uid) : Promise.resolve(null),
        ]);

        const connected: string[] = ['Google (Gmail · Calendar · Drive)'];
        if (notionAccounts.length > 0) connected.push(`Notion (${notionAccounts.map(a => a.workspaceName).join(', ')})`);
        if (slackAccounts.length > 0) connected.push(`Slack (${slackAccounts.map(a => a.teamName).join(', ')})`);
        if (githubAccounts.length > 0) connected.push(`GitHub (@${githubAccounts.map(a => a.login).join(', @')})`);
        const notConnected: string[] = [];
        if (notionAccounts.length === 0) notConnected.push('Notion');
        if (slackAccounts.length === 0) notConnected.push('Slack');
        if (githubAccounts.length === 0) notConnected.push('GitHub');
        connectorBlock = `\n\nCONNECTED INTEGRATIONS: ${connected.join(', ')}`;
        if (notConnected.length > 0) connectorBlock += `\nNOT YET CONNECTED: ${notConnected.join(', ')} — generate a connect card if the user asks about these services`;

        // Fetch live data only when the query is about that service
        // Tokens are already intent-gated above, so a non-null token means the
        // query wanted that service — no need to re-test intent here.
        const [notionPages, slackMessages, githubItems] = await Promise.all([
          notionToken ? getRecentNotionPages(notionToken.token, 5)                  : Promise.resolve([]),
          slackToken  ? getRecentSlackActivity(slackToken.token, 8)                 : Promise.resolve([]),
          githubToken ? getGitHubWorkItems(githubToken.token, githubToken.login, 8) : Promise.resolve([]),
        ]);

        if (notionPages.length > 0) {
          notionBlock = '\n\nNOTION (recently edited pages — only reference these, never invent others):\n' +
            notionPages.map(p => `- [${p.type === 'database' ? 'DB' : 'Page'}] ${p.title} (edited ${p.lastEdited})${p.url ? ' — ' + p.url : ''}`).join('\n');
        }
        if (slackMessages.length > 0) {
          slackBlock = '\n\nSLACK (recent messages from your channels):\n' +
            slackMessages.map(m => `#${m.channel} [${m.ts}]: ${m.text}`).join('\n');
        }
        if (githubItems.length > 0) {
          const prs = githubItems.filter(i => i.kind === 'pr');
          const issues = githubItems.filter(i => i.kind === 'issue');
          githubBlock = '\n\nGITHUB:';
          if (prs.length) githubBlock += `\nOpen PRs: ${prs.map(p => `${p.title} (${p.repo})`).join(' · ')}`;
          if (issues.length) githubBlock += `\nAssigned issues: ${issues.map(i => `${i.title} (${i.repo})`).join(' · ')}`;
        }
      })(),
      new Promise<void>(resolve => setTimeout(resolve, 4000)),
    ]);
  } catch (e) { console.error('[chat] connector (notion/slack/github) context failed:', String(e)); }
  return { connectorBlock, notionBlock, slackBlock, githubBlock };
}

// ── Device contacts (synced from iOS address book) ───────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactDoc = Record<string, any>;

// fetchContactEmailMap and fetchContactsBlock each independently read the SAME
// 500-doc collection, so an email-about-a-person query paid for it twice. Share
// one short-lived snapshot between them. Contacts sync from the phone and change
// rarely, so a few seconds of staleness is immaterial.
const CONTACTS_TTL_MS = 30_000;
const contactsCache = new Map<string, { docs: ContactDoc[]; exp: number }>();

async function fetchContactDocs(uid: string): Promise<ContactDoc[]> {
  const hit = contactsCache.get(uid);
  if (hit && hit.exp > Date.now()) return hit.docs;
  const snap = await adminDb.collection('users').doc(uid).collection('contacts').limit(500).get();
  const docs = snap.docs.map(d => d.data() as ContactDoc);
  contactsCache.set(uid, { docs, exp: Date.now() + CONTACTS_TTL_MS });
  return docs;
}

// Builds a lightweight email → contact map for Gmail sender cross-referencing.
// Called only when an email-relevant query is detected — separate from fetchContactsBlock
// so we don't double-fetch on non-email queries.
export async function fetchContactEmailMap(uid: string): Promise<Map<string, ContactEmailEntry>> {
  const map = new Map<string, ContactEmailEntry>();
  try {
    const docs = await fetchContactDocs(uid);
    for (const data of docs as {
      name?: string; email?: string; company?: string;
      userCategory?: 'personal' | 'professional' | 'service' | 'excluded';
    }[]) {
      if (!data.name || !data.email) continue;
      const rawEmail = data.email.replace(/[\r\n\t<>]/g, '').trim();
      if (!rawEmail) continue;
      const key = normalizeEmail(rawEmail);
      const isPhoneOnly = !data.company && /^\+?[\d\s\-().]{7,}$/.test(data.name) && !/[a-zA-Z]/.test(data.name);
      const category = data.userCategory ?? (data.company ? 'professional' : isPhoneOnly ? 'service' : 'personal');
      map.set(key, {
        name: data.name.replace(/[\r\n\t]/g, ' ').trim().slice(0, 80),
        company: data.company ? data.company.replace(/[\r\n\t]/g, ' ').trim().slice(0, 80) : undefined,
        category,
      });
    }
  } catch (e) { console.error('[chat] contact email map failed (Gmail shows without contact names):', String(e)); }
  return map;
}

export async function fetchContactsBlock(uid: string, enabled = true): Promise<string> {
  if (!enabled) return '';
  try {
    // Shares the snapshot with fetchContactEmailMap — see fetchContactDocs.
    const contactDocs = await fetchContactDocs(uid);
    if (contactDocs.length === 0) return '';

    const today = new Date();

    type RawDoc = {
      name?: string; email?: string; phone?: string;
      company?: string; jobTitle?: string;
      birthday?: { month: number; day: number; year?: number };
      userCategory?: 'personal' | 'professional' | 'service' | 'excluded';
    };

    const personal: string[] = [];
    const professional: string[] = [];
    const services: string[] = [];

    for (const data of contactDocs as RawDoc[]) {
      if (!data.name) continue;
      const name = data.name.replace(/[\r\n\t]/g, ' ').trim().slice(0, 80);
      if (!name) continue;

      // User-set exclusion: skip entirely
      if (data.userCategory === 'excluded') continue;

      const email = data.email ? data.email.replace(/[\r\n\t<>]/g, '').slice(0, 100) : null;
      const company = data.company ? data.company.replace(/[\r\n\t]/g, ' ').trim().slice(0, 80) : null;
      const jobTitle = data.jobTitle ? data.jobTitle.replace(/[\r\n\t]/g, ' ').trim().slice(0, 60) : null;

      // Birthday — flag if within 7 days (rolling, handles year-end wrap)
      let birthdayTag = '';
      if (data.birthday?.month && data.birthday?.day) {
        const { month, day } = data.birthday;
        const bdayThisYear = new Date(today.getFullYear(), month - 1, day);
        if (bdayThisYear < today) bdayThisYear.setFullYear(today.getFullYear() + 1);
        const daysUntil = Math.round((bdayThisYear.getTime() - today.getTime()) / 86400000);
        if (daysUntil <= 7) birthdayTag = ` 🎂 birthday in ${daysUntil === 0 ? 'today' : `${daysUntil}d`}`;
      }

      // Category: userCategory overrides auto-detection
      const isPhoneOnly = !email && !company && /^\+?[\d\s\-().]{7,}$/.test(name) && !/[a-zA-Z]/.test(name);
      const category = data.userCategory ?? (company ? 'professional' : isPhoneOnly ? 'service' : 'personal');

      if (category === 'service') {
        services.push(`[Service] ${name}${email ? ` (${email})` : ''}`);
      } else if (category === 'professional') {
        const title = jobTitle ? ` · ${jobTitle}` : '';
        const emailPart = email ? ` (${email})` : '';
        professional.push(`${name}${company ? ` @ ${company}` : ''}${title}${emailPart}${birthdayTag}`);
      } else {
        personal.push(`${name}${email ? ` (${email})` : ''}${birthdayTag}`);
      }
    }

    const total = personal.length + professional.length + services.length;
    if (total === 0) return '';

    const lines: string[] = [
      `\n\nKNOWN CONTACTS (${total} total — reference by name in conversation; if asked to list contacts, reply with group counts and offer to search for a specific person — never output the full list):`,
    ];
    if (personal.length > 0) lines.push(`\nPersonal (${personal.length}):\n${personal.join(', ')}`);
    if (professional.length > 0) lines.push(`\nProfessional (${professional.length}):\n${professional.join('\n')}`);
    if (services.length > 0) lines.push(`\nServices (${services.length}):\n${services.join(', ')}`);

    return lines.join('').slice(0, 6000);
  } catch (e) { console.error('[chat] contacts context failed:', String(e)); return ''; }
}

// Desktop-agent notes sync (MODUS Desktop, Phase 0 proof-of-concept — see
// apps/desktop). Gated on query intent (needsNotesCtx / vague queries) and the
// notesSync capability toggle, same pattern as fetchContactsBlock.
export async function fetchNotesBlock(uid: string, enabled = true): Promise<string> {
  if (!enabled) return '';
  try {
    // Order by the note's actual edit time (modifiedAt), not Firestore's sync
    // time (updatedAt) — a bulk sync writes many notes within the same instant,
    // so updatedAt alone can't surface the most recently *edited* notes.
    const snap = await adminDb
      .collection('users').doc(uid)
      .collection('notes')
      .orderBy('modifiedAt', 'desc')
      .limit(10)
      .get();
    if (snap.empty) return '';

    const lines: string[] = ['\n\nFROM YOUR SYNCED NOTES (desktop app — most recent):'];
    for (const d of snap.docs) {
      const data = d.data() as { title?: string; body?: string };
      const title = (data.title ?? 'Untitled').replace(/[\r\n\t]/g, ' ').trim().slice(0, 100);
      const body = (data.body ?? '').slice(0, 800);
      lines.push(`\n--- ${title} ---\n${body}`);
    }
    return lines.join('').slice(0, 8000);
  } catch (e) { console.error('[chat] notes context failed (missing modifiedAt index?):', String(e)); return ''; }
}

// Desktop-agent iMessage sync (MODUS Desktop — see apps/desktop). Unlike
// notes, this is OTHER people's private correspondence, not just the user's
// own content — gated the same way (intent + capability toggle) but the
// capability defaults to OFF (opt-in), not on.
export async function fetchMessagesBlock(uid: string, enabled = true): Promise<string> {
  if (!enabled) return '';
  try {
    const snap = await adminDb
      .collection('users').doc(uid)
      .collection('messages')
      .orderBy('modifiedAt', 'desc')
      .limit(10)
      .get();
    if (snap.empty) return '';

    const lines: string[] = ['\n\nFROM YOUR SYNCED IMESSAGE CONVERSATIONS (desktop app — most recently active):'];
    for (const d of snap.docs) {
      const data = d.data() as { title?: string; body?: string };
      const title = (data.title ?? 'Unknown').replace(/[\r\n\t]/g, ' ').trim().slice(0, 100);
      const body = (data.body ?? '').slice(0, 800);
      lines.push(`\n--- ${title} ---\n${body}`);
    }
    return lines.join('').slice(0, 8000);
  } catch (e) { console.error('[chat] messages context failed (missing modifiedAt index?):', String(e)); return ''; }
}

// ── Pinned project resources (live data scoped to a project) ─────────────────
export async function fetchProjectResources(uid: string, pc: ProjectContext): Promise<string> {
  if (!(pc.resources.length > 0)) return '';

  const githubResources = pc.resources.filter(r => r.type === 'github');
  const notionResources  = pc.resources.filter(r => r.type === 'notion');
  const slackResources   = pc.resources.filter(r => r.type === 'slack');
  const driveResources   = pc.resources.filter(r => r.type === 'drive');
  const urlResources     = pc.resources.filter(r => r.type === 'url');

  const allLines: string[] = [];

  // 5s hard cap — project resource fetches must never kill the response
  await Promise.race([
    (async () => {
      // Fetch all token types + all resources in parallel
      const [gh, notionToken, sl, driveToken] = await Promise.all([
        githubResources.length > 0 ? getFirstGitHubToken(uid) : Promise.resolve(null),
        notionResources.length  > 0 ? getFirstNotionToken(uid)  : Promise.resolve(null),
        slackResources.length   > 0 ? getFirstSlackToken(uid)   : Promise.resolve(null),
        driveResources.length   > 0 ? getValidAccessToken(uid)  : Promise.resolve(null),
      ]);

      // Fetch all resources across all types in parallel
      const resourceFetches = await Promise.allSettled([
        // GitHub repos — all in parallel
        ...githubResources.slice(0, 3).map(async r => {
          if (!r.repo || !gh) return '';
          const headers = { Authorization: `Bearer ${gh.token}`, Accept: 'application/vnd.github+json' };
          const [prRes, issueRes] = await Promise.all([
            fetch(`https://api.github.com/search/issues?q=is:open+is:pr+repo:${r.repo}&sort=updated&per_page=5`, { headers }),
            fetch(`https://api.github.com/search/issues?q=is:open+is:issue+repo:${r.repo}&sort=updated&per_page=5`, { headers }),
          ]);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const prItems: any[] = prRes.ok ? ((await prRes.json()).items ?? []) : [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const issueItems: any[] = issueRes.ok ? ((await issueRes.json()).items ?? []) : [];
          const parts = [`\nGitHub repo: ${r.repo}`];
          parts.push(prItems.length > 0 ? `  Open PRs: ${prItems.map((p: { title: string; html_url: string }) => `${p.title} — ${p.html_url}`).join('; ')}` : '  Open PRs: none');
          parts.push(issueItems.length > 0 ? `  Open issues: ${issueItems.map((i: { title: string; html_url: string }) => `${i.title} — ${i.html_url}`).join('; ')}` : '  Open issues: none');
          return parts.join('\n');
        }),
        // Notion pages — all in parallel
        ...notionResources.slice(0, 3).map(async r => {
          if (!notionToken) return '';
          const pageId = r.pageId ?? r.url?.split('/').pop();
          if (!pageId) return '';
          const blocksRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=10`, {
            headers: { Authorization: `Bearer ${notionToken.token}`, 'Notion-Version': '2022-06-28' },
          });
          if (!blocksRes.ok) return `\nNotion page: ${r.name} — (content unavailable)`;
          const blocksData = await blocksRes.json();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const text = (blocksData.results ?? []).map((b: any) => {
            const rt = b[b.type]?.rich_text ?? [];
            return rt.map((t: { plain_text: string }) => t.plain_text).join('');
          }).join(' ').slice(0, 600);
          return `\nNotion page: ${r.name}${r.url ? ` — ${r.url}` : ''}\n  Content: ${text || '(empty or no text blocks)'}`;
        }),
        // Slack channels — all in parallel
        ...slackResources.slice(0, 3).map(async r => {
          if (!r.channelId || !sl) return '';
          const msgRes = await fetch(`https://slack.com/api/conversations.history?channel=${r.channelId}&limit=8`, {
            headers: { Authorization: `Bearer ${sl.token}` },
          });
          if (!msgRes.ok) return `\nSlack ${r.name}: (unavailable)`;
          const msgData = await msgRes.json() as { ok: boolean; messages?: { text?: string; ts?: string; subtype?: string }[] };
          if (!msgData.ok) return `\nSlack ${r.name}: (unavailable)`;
          const msgs = (msgData.messages ?? []).filter(m => !m.subtype && m.text).slice(0, 8);
          return `\nSlack ${r.name} (recent messages):\n${msgs.map(m => `  [${m.ts}] ${(m.text ?? '').slice(0, 200)}`).join('\n')}`;
        }),
        // Drive files — all in parallel
        ...driveResources.slice(0, 3).map(async r => {
          if (!r.fileId || !driveToken) return '';
          const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${r.fileId}?fields=id,name,mimeType,webViewLink`, {
            headers: { Authorization: `Bearer ${driveToken}` },
          });
          if (!metaRes.ok) return `\nDrive file: ${r.name} — (unavailable)`;
          const meta = await metaRes.json() as { name: string; mimeType: string; webViewLink: string };
          const isGoogleDoc = meta.mimeType.includes('google-apps.document') || meta.mimeType.includes('google-apps.spreadsheet') || meta.mimeType.includes('google-apps.presentation');
          const isPlainText = meta.mimeType.startsWith('text/');
          if (isGoogleDoc) {
            const exportRes = await fetch(`https://www.googleapis.com/drive/v3/files/${r.fileId}/export?mimeType=text/plain`, {
              headers: { Authorization: `Bearer ${driveToken}` },
            });
            const text = exportRes.ok ? (await exportRes.text()).slice(0, 2000) : '';
            return `\nDrive file: ${meta.name} — ${meta.webViewLink}\n  Content:\n${text || '(empty)'}`;
          } else if (isPlainText) {
            const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${r.fileId}?alt=media`, {
              headers: { Authorization: `Bearer ${driveToken}` },
            });
            const text = dlRes.ok ? (await dlRes.text()).slice(0, 2000) : '';
            return `\nDrive file: ${meta.name} — ${meta.webViewLink}\n  Content:\n${text || '(empty)'}`;
          }
          return `\nDrive file: ${meta.name} — ${meta.webViewLink} (${mimeLabel(meta.mimeType)})`;
        }),
      ]);

      for (const s of resourceFetches) {
        if (s.status === 'fulfilled' && s.value) allLines.push(s.value);
      }
      for (const r of urlResources) {
        allLines.push(`\nURL: ${r.name}${r.url ? ` — ${r.url}` : ''}`);
      }
    })(),
    new Promise<void>(resolve => setTimeout(resolve, 5000)),
  ]).catch(() => {});

  if (allLines.length > 0) {
    return '\n\nPROJECT RESOURCES (live data scoped to pinned resources — treat as primary context for this project):' + allLines.join('');
  }
  return '';
}
