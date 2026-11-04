import { streamText, experimental_createMCPClient, StreamData, convertToCoreMessages } from 'ai';
import { summarizeSteps } from '@/lib/chat/tool-activity';
import type { CoreMessage } from 'ai';
import { MODUS_SYSTEM_PROMPT, SCREEN_ASSIST_SYSTEM_PROMPT, looksLikePromptExtraction, PROMPT_EXTRACTION_REMINDER, PROJECT_CHAT_RULES } from '@/lib/claude';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { upsertMemory } from '@/lib/pinecone';
import { extractDurableMemory } from '@/lib/chat/memory';
import { messageTextLength, trimMessageText, stripLoneSurrogates } from '@/lib/chat/messages';
import { needsExplicitTemperature, maxTokensFor } from '@/lib/chat/model-params';
import { effortProviderOptions, effortFor } from '@/lib/chat/effort';
import { getMcpServers } from '@/lib/mcp-servers';
import { connectMcpClient } from '@/lib/mcp-client';
import { sanitizeMcpToolSchemas, makeToolErrorsNonFatal } from '@/lib/mcp-schema';
import { assertPublicUrl } from '@/lib/ssrf';
import {
  enforceSubscriptionGate,
  enforcePaidTokenLimit,
  isFreeTierUser,
  trackTokenUsage,
  usagePercent,
} from '@/lib/chat/limits';
import { FREE_MAX_MESSAGE_CHARS, FREE_HISTORY_CHAR_BUDGET } from '@/lib/constants';
import { resolveChatModel, chatFallbackChain, createFallbackModel, silentStreamBackup, isPremiumModel, modelSupportsTools } from '@/lib/chat/model';
import { routeTask } from '@/lib/chat/auto-route';
import { canUseModel } from '@/lib/models';
import {
  needsEmailCtx,
  needsCalendarCtx,
  needsNotesCtx,
  needsMessagesCtx,
  needsContactsCtx,
  isVagueQuery,
  SMALL_TALK,
  isContentlessQuery,
  queryMemoryContext,
  fetchGoogleData,
  fetchWebSearchBlock,
  fetchDriveBlock,
  fetchConnectorData,
  fetchProjectResources,
  fetchContactsBlock,
  fetchContactEmailMap,
  fetchNotesBlock,
  fetchMessagesBlock,
} from '@/lib/chat/context';
import { fetchGroupAvailabilityBlock } from '@/lib/chat/group-context';
import {
  buildUserContextBlock,
  buildStyleBlock,
  buildPresetsBlock,
  buildSettingsBlock,
  buildDateBlock,
  buildGoalContextBlock,
  buildProjectContextBlock,
  buildTaskContextBlock,
  buildGoogleDataBlock,
  buildModelCatalogBlock,
  buildActiveModelBlock,
  type GoalContext,
  type ProjectContext,
  type TaskContext,
} from '@/lib/chat/prompt';

// This route streams LLM output and does Firebase-admin/crypto work → Node
// runtime, not Edge. Without an explicit maxDuration, Vercel applies a short
// default and KILLS the function mid-stream on slower premium/reasoning models —
// which the user experiences as the chat freezing with no answer. The team is on
// Pro with Fluid compute, so 300s is the project's own default ceiling. 60s was
// too short: 3 prod kills (last 10-28) were Opus 5.5 with 11 MCP tools running
// up to 5 tool steps, a live stream that simply needed longer. Fluid bills
// active CPU, so time spent waiting on the provider costs almost nothing. The
// client's 45s STALL watchdog still ends a turn that has truly gone silent.
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  // Time-to-first-token is the whole complaint this instrumentation exists for
  // ("it took 30 seconds for it to register"). Everything between here and
  // streamText is dead air the user stares at, so measure it rather than guess:
  // grep Vercel logs for `[chat] timing`.
  const t0 = Date.now();
  try {
    // The free floor is the AI Gateway now, not Groq. Gating on GROQ_API_KEY
    // here would keep 500ing after Groq is gone from the chat path entirely.
    const key = process.env.AI_GATEWAY_API_KEY ?? '';
    if (!process.env.OPENAI_API_KEY && !key) {
      console.error('[chat] no AI API key configured');
      return Response.json({ error: 'API key not configured' }, { status: 500 });
    }

    // Auth is REQUIRED — MODUS is accounts-only. A missing or invalid/expired
    // token leaves uid null, which is rejected with a 401 just below.
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    let uid: string | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let userData: Record<string, any> = {};
    // Body parsing is independent of auth, so read it concurrently rather than
    // after. The user-doc read still waits on verifyIdToken — it needs the uid,
    // and it gates the paywall, so it must be a real read of real identity.
    const bodyPromise = req.json().catch(() => null);
    if (token) {
      try {
        const decoded = await adminAuth.verifyIdToken(token);
        uid = decoded.uid;
        const snap = await adminDb.collection('users').doc(uid).get();
        userData = snap.data() ?? {};
      } catch {
        // Invalid/expired token → treated as unauthenticated (401 below).
      }
    }

    // MODUS is accounts-only — there is no guest/anonymous access. Reject any
    // request without a valid signed-in user (missing OR invalid/expired token).
    if (!uid) {
      return Response.json({ error: 'authentication_required' }, { status: 401 });
    }

    // The access gate sits below the payload validation. The free gate is now a
    // read of the window/weekly counters (no side effect), and trackTokenUsage does
    // the metering after the answer streams — so a malformed or image-rejected
    // request never advances a free user's usage. See lib/chat/limits.ts.

    const body = await bodyPromise as {
      messages: CoreMessage[];
      personalContext?: string;
      responseStyle?: string;
      customStyle?: string;
      // Active composer presets: plain directive strings applied to this message.
      presets?: string[];
      briefingHour?: number;
      briefingTimezone?: string;
      goalContext?: GoalContext;
      projectContext?: ProjectContext;
      taskContext?: TaskContext;
      // In-chat model switcher: 'auto' (MODUS picks per task), 'auto-saver' (same,
      // but biased to the cheapest capable model), a specific model id, or
      // undefined/'default' (use the saved Brain setting).
      modelChoice?: string;
      // The model Auto picked for the PREVIOUS turn. Lets a short follow-up
      // ("make it shorter") stay on the model that wrote the thing it refers to.
      lastRoutedModel?: string;
      // Per-message "+" menu: force a web search for this message, and any files
      // the user attached (PDF text extracted server-side, text files read client-side).
      webSearch?: boolean;
      attachments?: { name: string; text: string }[];
      /**
       * Desktop Screen Assist: the question is about a screenshot on the user's
       * display, not about their life.
       *
       * 💸 THIS IS A COST AND LATENCY SWITCH, and it was worth adding the moment it
       * was measured: a screen question was costing ~5.6k tokens of assembled
       * context — inbox, calendar, Apple Notes, iMessage, contacts, Pinecone
       * memory, Notion/Slack/GitHub/Drive — before the model saw a single pixel.
       * A $24 MODUS account has 500k tokens a day, so "what does this error mean?"
       * was burning ~1.5% of a day's allowance on the user's unread email.
       *
       * Worse, "what's on my screen" trips isVagueQuery(), which is exactly the
       * branch that pulls in email/calendar/notes/contacts wholesale.
       *
       * None of it helps answer a question about a screenshot, and every block is a
       * network round trip (Firestore, Google, Pinecone) that the user waits on.
       */
      screenMode?: boolean;
    };

    // req.json() rejects on a malformed body; bodyPromise swallows that into null.
    if (!body) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }

    // Validate payload before touching any model. A malformed/empty history is a
    // client bug or a truncated request — return a clean 400 the UI can surface,
    // never a 500 or an empty stream that looks like a silent drop.
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }

    // 🚨 NORMALISE TO CoreMessage AT THE BOUNDARY — EVERYTHING BELOW DEPENDS ON IT.
    // body.messages is UI-shaped: useChat puts `parts` on every message
    // (fillMessageParts), and the POST body keeps it even on the default reduced
    // path (@ai-sdk/react:284). convertToCoreMessages reads a user turn's text
    // from `parts` and IGNORES `content` when it is present (ai:1750), so every
    // trim below used to operate on a field the model never read — measured:
    // 50,000 chars reaching the model against an 8,000-char cap. Converting first
    // makes `content` the real payload, so a trim is actually a trim.
    //
    // It also keeps the Anthropic cache alive: ONE message carrying `parts` types
    // the WHOLE array as "ui-messages" (detectPromptType, ai:2194), and streamText
    // then rebuilds every entry — dropping providerOptions off our system messages
    // and with them cache_control. Normalising here means that path never runs.
    //
    // `tools` is deliberately not passed: it only feeds experimental_toToolResultContent,
    // which nothing sets — not our code, and not the SDK's MCP client (the SDK only
    // ever READS that field). So this is identical to streamText's internal conversion.
    // 🚨 IMAGE + CAPTION SENDS ARRIVED MALFORMED (fixed 2026-09-15, prod-confirmed).
    // A user message carrying BOTH typed text and an image is built client-side as
    // array content ([{type:'text',text},{type:'image',image}]) and handed to the
    // SDK's append(). getMessageParts (@ai-sdk/ui-utils) then fills
    //   parts: [{ type:'text', text: <the whole content array> }]
    // because the message had no `parts` and its content was not a string. This
    // route reads `parts` for a user turn (convertToCoreMessages) and copies
    // part.text verbatim, so `text` became a NESTED array — which streamText
    // rejects with "AI_InvalidPromptError: message must be a CoreMessage or a UI
    // message", surfacing to the user as "Something went wrong. Please try again."
    // (verified in prod logs 2026-08-04 → 2026-09-14). An image with no caption or
    // plain text both take other branches and were fine; only image+caption nested.
    //
    // Two guards, applied before conversion:
    //   1. flatten any text part whose `.text` is not a string (covers turns
    //      reloaded from Firestore that were already persisted nested), and
    //   2. drop the SDK-filled `parts` on any user turn whose `content` is an array,
    //      so convertToCoreMessages takes its clean `content` path and keeps the
    //      image part as a sibling of a proper string text part.
    const flattenPartText = (t: unknown): string => {
      if (typeof t === 'string') return t;
      if (Array.isArray(t)) return t.map(flattenPartText).join('');
      if (t && typeof t === 'object') {
        const o = t as { text?: unknown; content?: unknown };
        if ('text' in o) return flattenPartText(o.text);
        if ('content' in o) return flattenPartText(o.content);
      }
      return '';
    };
    const sanitizedMessages = (body.messages as Array<Record<string, unknown>>).map((m) => {
      if (!m || typeof m !== 'object') return m;
      if (!Array.isArray(m.content)) return m;
      const content = (m.content as Array<Record<string, unknown>>).map((p) =>
        p && p.type === 'text' && typeof p.text !== 'string'
          ? { ...p, text: flattenPartText(p.text) }
          : p,
      );
      // A user turn with array content must NOT keep the SDK-filled `parts` — that
      // field is what carries the nesting. Text-only turns keep `parts`; the trims
      // below rely on it (see lib/chat/messages.ts).
      if (m.role === 'user') {
        const rest = { ...m };
        delete rest.parts;
        return { ...rest, content };
      }
      return { ...m, content };
    });

    let clientCore: CoreMessage[];
    try {
      clientCore = convertToCoreMessages(sanitizedMessages as Parameters<typeof convertToCoreMessages>[0]);
    } catch {
      // Thrown on a malformed history (e.g. an assistant turn whose toolInvocation
      // has no result). streamText threw on this before, just later and as a 500.
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }

    // 👁️ Images are a PAID feature, and this check must run BEFORE the access gate
    // so a rejected image does not silently spend one of the ten free messages.
    //
    // 💸 It is here on cost grounds, not product ones. An image request is forced
    // onto a vision model and carries a whole screenshot of input tokens; the free
    // tier is costed on ~10k text tokens a message (lib/constants.ts) and a single
    // screenshot blows through that. Screen Assist stays behind the card until
    // image usage is metered in its own right — the last time image cost was
    // assumed rather than measured it was billed at 27x for months.
    const freeTier = isFreeTierUser(userData);
    if (freeTier && clientCore.some(m =>
      Array.isArray(m.content) && (m.content as { type?: string }[]).some(p => p?.type === 'image'),
    )) {
      return Response.json({ error: 'image_requires_subscription' }, { status: 402 });
    }

    // Access + usage limits (each returns a ready 4xx Response when blocked). Both
    // are now read-only pre-checks; usage is metered after the answer.
    const gateBlocked = enforceSubscriptionGate(uid, userData);
    if (gateBlocked) return gateBlocked;
    const paidBlocked = enforcePaidTokenLimit(userData);
    if (paidBlocked) return paidBlocked;

    // 🚨 TWO INPUTS COULD 400 THE PROVIDER AND LOSE THE ANSWER (verified on prod,
    // scripts/verify-never-blank.ts). Both arrive as a 200 with zero characters,
    // which is indistinguishable from the product being broken:
    //
    //   whitespace-only → "messages: text content blocks must contain
    //                      non-whitespace text"
    //   lone surrogate  → "The request body is not valid JSON: no low surrogate
    //                      in string" (and Pinecone: "unexpected end of hex escape")
    //
    // Strip the surrogates rather than reject: half an emoji is never what the
    // user meant, and dropping it costs them nothing. The whitespace case is a
    // genuinely empty turn, so it gets a clean 400 the UI can explain instead of
    // an empty stream that looks like a failure.
    clientCore = clientCore.map(m => {
      if (typeof m.content === 'string') return { ...m, content: stripLoneSurrogates(m.content) } as CoreMessage;
      if (!Array.isArray(m.content)) return m;
      const parts = (m.content as { type: string; text?: string }[]).map(p =>
        p?.type === 'text' && typeof p.text === 'string' ? { ...p, text: stripLoneSurrogates(p.text) } : p,
      );
      return { ...m, content: parts } as unknown as CoreMessage;
    });

    // An "empty" turn is only empty if it also carries no image/file part — an
    // image with no caption is a perfectly good message and must still go through.
    // The same is true of documents: extracted file text rides out-of-band in
    // `body.attachments` (NOT in `content`), so a PDF-only send has empty `content`
    // but is a real message. Counting only the image `content` parts here rejected
    // every attachment-only send with `empty_message` — the composer allowed it,
    // the server refused it. Treat a non-empty `body.attachments` as content too.
    const newest = clientCore[clientCore.length - 1];
    if (newest?.role === 'user') {
      const hasImagePart = Array.isArray(newest.content)
        && (newest.content as { type: string }[]).some(p => p?.type !== 'text');
      const hasFileAttachment = Array.isArray(body.attachments) && body.attachments.length > 0;
      const text = typeof newest.content === 'string'
        ? newest.content
        : (newest.content as { type: string; text?: string }[])
            .filter(p => p?.type === 'text').map(p => p.text ?? '').join('');
      if (!hasImagePart && !hasFileAttachment && text.trim() === '') {
        return Response.json({ error: 'empty_message' }, { status: 400 });
      }
      // 🚨 A file-only send arrives here with EMPTY message content — the extracted
      // file text rides in body.attachments (→ the system prompt), never in the
      // message. An empty user message is invalid for several providers: measured
      // on prod, meta/llama-3.3-70b rejects it with
      //   AI_APICallError: user message must have content
      // which surfaced to the user as "Something went wrong. Please try again."
      // (the whole reason attachment-only sends failed). Give the message a minimal
      // instruction so it is a valid message AND points the model at the files.
      if (!hasImagePart && hasFileAttachment && text.trim() === '') {
        const names = body.attachments!.map(a => a?.name).filter(Boolean).join(', ');
        const plural = body.attachments!.length > 1 ? 's' : '';
        newest.content = names
          ? `Please read the attached file${plural} (${names}) and help me with ${body.attachments!.length > 1 ? 'them' : 'it'}.`
          : `Please read the attached file${plural} and help me with ${body.attachments!.length > 1 ? 'them' : 'it'}.`;
      }
    }

    // Cap history by TOTAL size, walking backwards from the newest message.
    //
    // MAX_MESSAGE_CHARS is deliberately generous (~25k words). Pasting a long
    // document into the composer is a real use of MODUS, and the old 8k (~1.2k
    // words) would have cut a report off mid-page the moment the trim started
    // working — the cap has to be one a real paste doesn't hit.
    // ⚠️ HISTORY_CHAR_BUDGET MUST EXCEED MAX_MESSAGE_CHARS. The budget drops whole
    // messages, it does not shrink them, so a budget below the per-message cap
    // would evict a big paste on the NEXT turn and the model would forget the
    // document it just read.
    //
    // 💸 The free tier gets much smaller caps. A free account is costed at ~10k
    // tokens a message (lib/constants.ts); at the paid 100k-char cap ONE pasted
    // document is ~25k tokens on its own, which would make the whole per-signup
    // costing wrong by 3x. The message limit alone does not bound spend unless the
    // message itself is bounded — that is the entire reason these two exist.
    const MAX_MESSAGE_CHARS = freeTier ? FREE_MAX_MESSAGE_CHARS : 100_000;
    const HISTORY_CHAR_BUDGET = freeTier ? FREE_HISTORY_CHAR_BUDGET : 120_000;
    const MAX_HISTORY_MESSAGES = 20;
    const recent = clientCore.slice(-MAX_HISTORY_MESSAGES);
    const kept: CoreMessage[] = [];
    let historyChars = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
      const trimmed = trimMessageText(recent[i], MAX_MESSAGE_CHARS);
      const size = messageTextLength(trimmed);
      // Always keep the newest message even if it alone blows the budget —
      // dropping the thing the user just asked would be worse than the cost.
      if (kept.length > 0 && historyChars + size > HISTORY_CHAR_BUDGET) break;
      historyChars += size;
      kept.unshift(trimmed);
    }
    // 🚨 THE HISTORY MUST START WITH A USER MESSAGE. Goal and Project chats open
    // with a seeded Modus greeting ("You're at 0% on ..."), and trimming a long
    // chat can leave an assistant or orphan tool result first. Llama on Groq
    // rejects that outright ("A conversation must start with a user message"),
    // so every Auto-routed general question on a goal or project answered with
    // "Something went wrong" (found 11-02 driving the real UI). Drop orphan tool
    // results, and put a short user line in front of a leading assistant turn so
    // its text stays in context instead of being thrown away.
    while (kept.length > 1 && kept[0].role === 'tool') kept.shift();
    if (kept[0]?.role === 'assistant') {
      kept.unshift({
        role: 'user',
        content: kept.length < clientCore.length
          ? '(Earlier messages in this conversation are not shown.)'
          : '(Modus opened this conversation with the message below.)',
      });
    }
    const cappedMessages = kept;

    // Safety net: never hand the provider an empty-content user message. Several
    // providers reject it ("user message must have content"), and a single empty
    // message ANYWHERE in the history 500s the whole turn — not just the newest.
    // The newest file-only message is synthesized above; this catches empty
    // strings already saved in history (older messages, or a non-web client).
    for (const m of cappedMessages) {
      if (m.role === 'user' && typeof m.content === 'string' && m.content.trim() === '') {
        m.content = '(no additional text)';
      }
    }

    let personalContext = (body.personalContext ?? '').slice(0, 2000);
    let responseStyle = body.responseStyle ?? '';
    let customStyle = (body.customStyle ?? '').slice(0, 500);
    // Active composer presets: array of plain directive strings. Cap count and
    // length so a crafted client can't blow up the system prompt.
    const activePresets: string[] = Array.isArray(body.presets)
      ? body.presets.filter((p: unknown): p is string => typeof p === 'string').slice(0, 12).map((p: string) => p.slice(0, 400))
      : [];
    let briefingHour = body.briefingHour ?? 7;
    let briefingTimezone = body.briefingTimezone ?? 'UTC';

    if (uid && (!personalContext && !responseStyle)) {
      const settings = userData.settings ?? {};
      personalContext = settings.personalContext ?? '';
      responseStyle = settings.responseStyle ?? '';
      customStyle = settings.customStyle ?? '';
      briefingHour = settings.briefingHour ?? 7;
      briefingTimezone = settings.briefingTimezone ?? 'UTC';
    }

    // Derive query text early so context detection can use it. For image
    // messages the content is an array of parts — pull the text out of it.
    const lastUserMsg = [...cappedMessages].reverse().find(m => m.role === 'user');
    const queryText = typeof lastUserMsg?.content === 'string'
      ? lastUserMsg.content
      : Array.isArray(lastUserMsg?.content)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (lastUserMsg!.content as any[]).filter(p => p?.type === 'text').map(p => p.text).join(' ')
        : '';

    // Any image parts in the conversation → we need a vision-capable model.
    const hasImage = cappedMessages.some(m =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Array.isArray(m.content) && (m.content as any[]).some(p => p?.type === 'image'),
    );

    // Screen Assist: answer about the pixels, not about the user's life. See the
    // note on body.screenMode.
    const leanContext = body.screenMode === true;

    const wantsEmail    = !leanContext && (needsEmailCtx(queryText)    || isVagueQuery(queryText));
    const wantsCalendar = !leanContext && (needsCalendarCtx(queryText) || isVagueQuery(queryText));
    const wantsNotes    = !leanContext && (needsNotesCtx(queryText)    || isVagueQuery(queryText));
    // No isVagueQuery fallback — this is other people's private correspondence,
    // not just the user's own content, so only surface it on explicit intent.
    const wantsMessages = !leanContext && needsMessagesCtx(queryText);
    // Contacts are broadly useful for people/vague queries but were previously
    // injected on EVERY message — gate them so unrelated queries don't pay the cost.
    const wantsContacts = !leanContext && (needsContactsCtx(queryText) || isVagueQuery(queryText));

    // Start Pinecone early — runs in parallel with the other context fetches below
    const memoryPromise: Promise<string> =
      (!leanContext && uid && queryText && process.env.PINECONE_API_KEY)
        ? queryMemoryContext(uid, queryText)
        : Promise.resolve('');

    // Auto routing depends only on the query text, never on the fetched context —
    // but it used to be awaited AFTER the Gmail/Calendar fetch, so a context-heavy
    // turn paid Google's 5s cap and the classifier's back to back. Start it here
    // and collect it below; it now overlaps the context fetch instead.
    // (Same trick as memoryPromise above.)
    const savedModelSetting = userData.settings?.modelSettings as { provider?: string; model?: string } | undefined;
    const savedIsPlatformModel = !savedModelSetting?.provider || savedModelSetting.provider === 'platform';
    // Both 'auto' and 'auto-saver' route per-task; saver just biases pickModel to
    // the cheapest capable model (lib/chat/auto-route.ts). A per-message choice
    // wins; otherwise the saved Brain decides. autoChoice is the resolved sentinel
    // (or null), and saverMode is whether it is the cost-saving variant.
    const usingSavedAuto = (!body.modelChoice || body.modelChoice === 'default') && savedIsPlatformModel;
    const autoChoice =
      body.modelChoice === 'auto' || body.modelChoice === 'auto-saver'
        ? body.modelChoice
        : usingSavedAuto && (savedModelSetting?.model === 'auto' || savedModelSetting?.model === 'auto-saver')
          ? savedModelSetting!.model
          : null;
    const wantsAutoRoute = !!uid && !!queryText && !!autoChoice;
    const saverMode = autoChoice === 'auto-saver';
    const routePromise = wantsAutoRoute
      ? routeTask(queryText, userData.plan, { saver: saverMode })
      : null;

    // MCP tool discovery, started HERE rather than just before streamText.
    //
    // It depends on nothing but `uid`, yet it used to be the LAST thing before the
    // model call, so its two 4s caps (connect, then tools) landed on top of every
    // context fetch that came before it. It is the single most expensive step on
    // the path — up to 8s — and now it overlaps the whole context block instead of
    // following it. Awaited before streamText, which is what mcpClients needs:
    // onFinish/onError close them.
    type McpClient = Awaited<ReturnType<typeof experimental_createMCPClient>>;
    const mcpClients: McpClient[] = [];
    let mcpTools: Record<string, unknown> = {};
    // toolName → connector name, so the chat can say "used Pika" not "ran a tool".
    const mcpServerByTool: Record<string, string> = {};
    let mcpBlock = '';
    // "yoyo" must never reach a documentation tool. MCP tools were attached to
    // EVERY message regardless of what it said or which model answered it, so a
    // one-word greeting routed to the weakest model (Llama 3.3, the 'general'
    // default) arrived with GitMCP's full toolset and maxSteps:5 — and Llama did
    // the obvious thing: it called the library matcher on "yoyo" and returned
    // "matched to the owner/repo clickfwd/yoyo" as the whole answer. Small talk
    // has no tool-shaped intent by definition, so skip discovery entirely. This
    // also removes up to 8s (connect + tools()) from the fastest turns there are.
    const isSmallTalk = SMALL_TALK.test(queryText.trim());

    // Small talk was the right gate but not a wide enough one. "any emails i
    // should care about" is not small talk, so it still arrived holding GitMCP's
    // documentation toolset — a question answered entirely from the Gmail block
    // we already fetched. Tools the model cannot use are not free: they cost
    // discovery time, they enlarge every request, and a single malformed one
    // fails the whole call.
    //
    // So: when a message is squarely about the user's OWN data — the paths that
    // already have dedicated context blocks — skip MCP unless it also shows
    // tool-shaped intent (a URL, or docs/code vocabulary a connected server
    // could actually serve). Anything ambiguous still gets the tools.
    const isPersonalDataQuery = wantsEmail || wantsCalendar || wantsNotes || wantsMessages;
    const hasToolIntent = /\bhttps?:\/\/|\b(repo|repository|github|docs?|documentation|readme|library|package|api|source code|codebase)\b/i
      .test(queryText);
    // A message with no word in it cannot be a tool request. Without this a
    // lone "." reached GitMCP and came back with zero characters 3 times in 5.
    const isContentless = isContentlessQuery(queryText);
    const skipMcp = isSmallTalk || isContentless || (isPersonalDataQuery && !hasToolIntent);

    const mcpSetupPromise: Promise<void> = uid && !skipMcp ? (async () => {
      try {
        const mcpServers = await getMcpServers(uid);
        if (mcpServers.length === 0) return;
        // Reject a promise after `ms` without leaving the underlying work
        // uncancelled leaking. Used to bound both connect and tools() so a slow
        // plugin can never stall the whole chat.
        // ℹ️ No extra handler needed on `p`. Promise.race subscribes
        // .then(resolve, reject) to EVERY input, so a losing branch that rejects
        // after the race settled is still "handled" and cannot become an
        // unhandled rejection. Proven in scripts/verify-no-unhandled-rejection.ts
        // — do not add a defensive `p.catch(() => {})` here believing otherwise.
        const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
          Promise.race([
            p,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), ms)),
          ]);

        const connections = await Promise.allSettled(
          mcpServers.map(async (server) => {
            // Re-check at connection time: a stored URL could resolve to an
            // internal address now (DNS rebinding) even if it was public when added.
            await assertPublicUrl(server.url);
            const connectP = connectMcpClient({ url: server.url, authHeader: server.authHeader, transport: server.transport });
            let gaveUp = false;
            // If the socket opens AFTER we already timed out, close it so the
            // connection never leaks (the previous Promise.race dropped it).
            connectP.then(c => { if (gaveUp) c.close().catch(() => {}); }).catch(() => {});
            const client = await Promise.race([
              connectP,
              new Promise<never>((_, reject) => setTimeout(() => { gaveUp = true; reject(new Error('connect timeout')); }, 4000)),
            ]) as McpClient;
            return { server, client };
          })
        );

        // tools() must run in PARALLEL across servers. It used to sit in a
        // sequential for-loop, so each server serialised its own 4s cap —
        // three plugins could add up to 12s before the first token, not 4s.
        const fetched = await Promise.all(
          connections.map(async (conn) => {
            if (conn.status !== 'fulfilled') {
              // Log instead of swallowing — a plugin that stopped working should
              // be visible in logs, not silently dropped from the toolset.
              console.error('[chat] MCP connect failed:', String((conn as PromiseRejectedResult).reason));
              return null;
            }
            const { server, client } = conn.value;
            try {
              const tools = await withTimeout(client.tools(), 4000, 'tools');
              if (Object.keys(tools).length === 0) {
                try { await client.close(); } catch {}
                return null;
              }
              return { server, client, tools };
            } catch (e) {
              console.error(`[chat] MCP tools() failed for ${server.name}:`, String(e));
              try { await client.close(); } catch {}
              return null;
            }
          })
        );

        // Merge in a stable, name-sorted order. Object key order feeds the
        // provider's tool serialisation, which is the first thing in an
        // Anthropic cache prefix — non-deterministic order would break caching
        // (see the Phase 2 plan) and makes logs harder to diff.
        const toolNamesByServer: string[] = [];
        for (const ok of fetched.filter(x => x !== null).sort((a, b) => a!.server.name.localeCompare(b!.server.name))) {
          const { server, client, tools } = ok!;
          // A foreign schema is untrusted input to the model request. GitMCP's
          // `search_generic_code` omits its optional `page` from `required`,
          // which OpenAI rejects outright — and since the tools go out with the
          // request, that 400s the WHOLE message before a token is generated.
          // Every non-small-talk turn on gpt-5.6-terra was a blank bubble.
          // Normalise at the boundary; see lib/mcp-schema.ts.
          const { tools: safeTools, nonConforming } = sanitizeMcpToolSchemas(tools as Record<string, unknown>);
          if (nonConforming.length > 0) {
            console.warn(`[chat] MCP schema repaired for ${server.name}: ${nonConforming.join(', ')}`);
          }
          // And a tool that throws must not end the turn — see makeToolErrorsNonFatal.
          makeToolErrorsNonFatal(safeTools, (toolName, message) =>
            console.warn(`[chat] MCP tool ${server.name}/${toolName} failed (recovered): ${message}`),
          );
          mcpTools = { ...mcpTools, ...safeTools };
          for (const t of Object.keys(safeTools)) mcpServerByTool[t] = server.name;
          toolNamesByServer.push(`${server.name}: ${Object.keys(tools).join(', ')}`);
          mcpClients.push(client);
        }
        if (toolNamesByServer.length > 0) {
          mcpBlock = '\n\nMCP TOOLS AVAILABLE (use these when the user asks for actions your connected servers can perform):\n' +
            toolNamesByServer.join('\n');
        }
      } catch (e) {
        console.error('[chat] MCP setup failed:', e);
      }
    })() : Promise.resolve();

    // Live Google data only when relevant to the query
    let gmailBlock = '';
    let calendarBlock = '';

    // User capabilities (stored under settings.capabilities)
    const capabilities: Record<string, boolean> = uid ? {
      ...(userData.capabilities as Record<string, boolean> ?? {}),
      ...(userData.settings?.capabilities as Record<string, boolean> ?? {}),
    } : {};

    // Model selection for this message. 'auto' → MODUS classifies the task and
    // picks the best unlocked model (and turns web search on for research);
    // a specific id → use it (gated by plan in resolveChatModel); else the saved
    // Brain setting. Only paid and pre-launch users reach here past the gate, but
    // resolveChatModel still falls back to Llama if a model isn't unlocked.
    const modelChoice = body.modelChoice;
    let forcedModelId: string | undefined;
    // Whether MODUS auto-picked the model for this message (composer on "Auto").
    // Surfaced to the client (x-modus-auto header) so it can show a
    // "MODUS routed this to <model>" chip above the answer.
    let wasAutoRouted = false;
    // The "+" menu web-search toggle forces it for this message; Auto-routing can also.
    let forceWebSearch = body.webSearch === true;
    // A model the user explicitly asked for that their plan cannot run. Recorded
    // so the answer can say so instead of quietly substituting another model.
    let lockedChoice: string | undefined;
    if (uid && queryText) {
      // Saved Brain: 'auto' means MODUS routes per task. Used when the composer
      // sends no explicit per-message choice (or sends 'default').
      // wantsAutoRoute + routePromise were resolved before the context fetch above.
      if (routePromise) {
        wasAutoRouted = true;
        const routed = await routePromise;
        forcedModelId = routed.modelId;
        // 🚨 OR, never assign. The user's "+ → Web search" toggle arrives as
        // body.webSearch and was being OVERWRITTEN here by the router's own
        // opinion, which is false for every category except 'research'. So on
        // Auto — the default — switching web search on did nothing at all
        // unless the router happened to agree. An explicit toggle is a
        // decision; the router may only ever ADD to it.
        forceWebSearch = forceWebSearch || routed.webSearch;

        // Sticky Auto. The router only ever sees the LATEST message, so a short
        // follow-up like "make it shorter" or "try again" classifies as 'general'
        // → Llama, and Llama rewrites the code Claude just wrote. When the
        // follow-up carries no task signal of its own, stay on the model that
        // produced the thing it refers to.
        const last = body.lastRoutedModel;
        const isShortFollowUp = queryText.trim().split(/\s+/).length < 6;
        if (
          routed.category === 'general' &&
          isShortFollowUp &&
          cappedMessages.length > 1 &&
          last && last !== forcedModelId && canUseModel(last, userData.plan)
        ) {
          console.log(`[route] sticky: follow-up stays on ${last} (router said general)`);
          forcedModelId = last;
        }
      } else if (modelChoice && modelChoice !== 'default') {
        // canUseModel: free accounts are held to the open models (plans:['free']);
        // a free pick of a frontier model falls into lockedChoice below and is served
        // a free model instead. Paid tiers still can't reach above their plan.
        if (canUseModel(modelChoice, userData.plan)) {
          forcedModelId = modelChoice;
        } else {
          // 🚨 A LOCKED PICK MUST NOT PASS SILENTLY. This branch used to be part
          // of the `if` condition, so a model the plan cannot use simply fell
          // through to the saved Brain — the user asked for Opus and got Sonnet
          // with NO header, NO notice and NO log. Verified 2026-07-23 against
          // prod: modelChoice=claude-opus-4-8 → x-modus-model=claude-sonnet-5,
          // and no x-modus-downgraded at all.
          //
          // The silent-downgrade work (247a582) closed the RUNTIME failover path
          // — a model that fails mid-request can't pose as your pick. This is the
          // other door into the same lie: a pick that was never eligible to run.
          // It is reachable without ever showing a locked model in the composer,
          // because a saved selection outlives the plan that unlocked it (PILOT
          // → MODUS, or a lapsed subscription).
          lockedChoice = modelChoice;
          console.warn(`[chat] locked model requested: ${modelChoice} (plan=${userData.plan ?? 'none'}) — serving the saved default instead`);
        }
      }
    }

    const searchCapabilities = forceWebSearch ? { ...capabilities, webSearch: true } : capabilities;

    // ── ONE parallel context fetch ────────────────────────────────────────────
    // 🚨 EVERY FETCH IN THIS BLOCK IS INDEPENDENT OF EVERY OTHER ONE. Keep it that
    // way, and add new context fetches HERE — never on their own `await` below.
    //
    // They each used to sit on a separate top-level `await`, so their timeouts
    // stacked instead of overlapping, and the wait before the first token was the
    // SUM of the slowest path through all of them:
    //
    //   Google (5s cap) → web search (uncapped) → Drive (uncapped) → group
    //   (uncapped) → project resources (5s cap) → connectors (4s cap) → MCP
    //   (4s connect + 4s tools)
    //
    // ~22s of caps plus three uncapped network calls, before streamText was even
    // called. That is the reported "it took 30 seconds to register" — the request
    // was not stuck, it was queueing. MCP moved earlier still (it overlaps this
    // whole block), and the three uncapped fetches now have caps of their own, so
    // the worst case is the SLOWEST fetch (~6s) rather than the sum.
    //
    // Ordering constraints that DO exist and are preserved:
    //   · routePromise is awaited above — it decides forceWebSearch, which this
    //     block reads via searchCapabilities.
    //   · the contact map must precede the Gmail fetch (it annotates threads with
    //     known names), so those two stay sequential INSIDE their own entry.
    const [
      googleData,
      webSearchResult,
      driveBlock,
      groupBlock,
      projectResourcesBlock,
      connectorData,
      contactsBlock,
      notesBlock,
      messagesBlock,
      memoryContext,
    ] = await Promise.all([
      (async () => {
        if (!uid || !(wantsEmail || wantsCalendar)) return { gmailBlock: '', calendarBlock: '' };
        const contactsEnabled = userData.settings?.deviceAccess?.contacts !== false;
        // Build contact map first (~50ms Firestore read) so Gmail threads can be annotated with known contact names.
        // This is sequential by necessity but adds negligible time vs the Gmail API which takes up to 5s.
        const contactEmailMap = contactsEnabled ? await fetchContactEmailMap(uid) : new Map();
        return fetchGoogleData(uid, userData, { wantsEmail, wantsCalendar, briefingTimezone, contactEmailMap });
      })(),
      // forceWebSearch means the user hit "+ → Web search" for THIS message, or
      // Auto classified it as research. Passed as `explicit` so the keyword
      // heuristic can't veto a decision that was already made.
      fetchWebSearchBlock(queryText, searchCapabilities, forceWebSearch),
      (uid && !leanContext) ? fetchDriveBlock(uid, queryText) : Promise.resolve(''),
      // Agent-to-agent: when the user asks about a groupmate's availability, pull
      // the busy windows of members who opted to share their calendar.
      (uid && !leanContext) ? fetchGroupAvailabilityBlock(uid, queryText, briefingTimezone) : Promise.resolve(''),
      (body.projectContext && uid) ? fetchProjectResources(uid, body.projectContext) : Promise.resolve(''),
      (uid && !leanContext) ? fetchConnectorData(uid, queryText) : Promise.resolve({ connectorBlock: '', notionBlock: '', slackBlock: '', githubBlock: '' }),
      uid ? fetchContactsBlock(uid, wantsContacts && userData.settings?.deviceAccess?.contacts !== false) : Promise.resolve(''),
      // Notes are synced but intentionally never read into the prompt (privacy —
      // his 09-10 call). The notesSync capability still governs desktop sync; it
      // no longer feeds chat context. Flip `false` back to
      // `wantsNotes && capabilities.notesSync !== false` to restore injection.
      uid ? fetchNotesBlock(uid, false) : Promise.resolve(''),
      // Opt-in only — defaults to OFF, unlike notesSync, since this surfaces
      // other people's private messages, not just the user's own content.
      uid ? fetchMessagesBlock(uid, wantsMessages && capabilities.messagesSync === true) : Promise.resolve(''),
      // Pinecone, started before auto-routing above; collected here with the rest.
      memoryPromise,
    ]);
    ({ gmailBlock, calendarBlock } = googleData);
    const { connectorBlock, notionBlock, slackBlock, githubBlock } = connectorData;
    const { block: webSearchBlock, count: webSearchCount } = webSearchResult;
    const tContext = Date.now();

    // Resolve model — an in-chat/Auto override wins for this message, else BYOK
    // keys, then the platform default (Groq). hasImage forces a vision model.
    const resolved = resolveChatModel(userData, { hasImage, modelId: forcedModelId });
    // Fold a locked pick into the SAME downgrade signal the runtime failover
    // uses, so it reaches the user through the machinery that already exists
    // (x-modus-downgraded → the "X was unavailable, Y answered instead" notice)
    // rather than needing a second, parallel way of telling the truth.
    if (lockedChoice && lockedChoice !== resolved.modelId) {
      resolved.downgraded = true;
      resolved.requestedId = lockedChoice;
      // Don't overwrite a 'vision' reason with the generic one: if the locked pick
      // was swapped BECAUSE it cannot see, that is still the true explanation.
      resolved.downgradeReason ??= 'unavailable';
    }
    const chatModel = resolved.model;
    // The model the USER was promised: their explicit pick, Auto's announced
    // choice, or their saved Brain. Nothing reassigns `resolved` after this now
    // that the size guard is gone — it used to swap Llama→Terra on MODUS's own
    // initiative, which is why this snapshot exists: that swap was never a promise
    // to the user, so a later failure must not report "GPT-5.6 Terra was
    // unavailable" to someone who picked the free default and never heard of Terra.
    const promisedModelId = resolved.modelId;
    if (resolved.downgraded) {
      // Loud + alertable: a premium model was requested but we served Llama
      // (missing provider key or plan gate). Previously silent — a rotated/removed
      // key would drop every paid user to Llama with no signal anywhere.
      const why = resolved.downgradeReason === 'vision'
        ? 'requested model cannot read images'
        : 'missing provider key or plan gate';
      console.error(`[chat] MODEL DOWNGRADE: requested ${resolved.requestedId} → served ${resolved.modelId} (${why}) uid=${uid ?? 'guest'}`);
    }

    // System prompt blocks
    const userContextBlock = buildUserContextBlock(personalContext);
    const styleBlock = buildStyleBlock(responseStyle, customStyle);
    const presetsBlock = buildPresetsBlock(activePresets);
    const settingsBlock = buildSettingsBlock(briefingHour, briefingTimezone);
    // Volatile (changes daily) — must NOT join the cached stable prefix below.
    const dateBlock = buildDateBlock(briefingTimezone);
    const goalContextBlock = buildGoalContextBlock(body.goalContext);
    const projectContextBlock = buildProjectContextBlock(body.projectContext);
    const taskContextBlock = buildTaskContextBlock(body.taskContext);
    const googleDataBlock = buildGoogleDataBlock(gmailBlock, calendarBlock);
    const modelCatalogBlock = buildModelCatalogBlock(userData.plan);

    // Files the user attached via the composer "+" menu — treat as primary context.
    // Budgeted in TOTAL, not per-file: the per-file 24k cap left the file COUNT
    // unbounded, so 10 attachments meant ~60k tokens on one request.
    const ATTACHMENT_CHAR_BUDGET = 48_000;
    const MAX_ATTACHMENTS = 10;
    let attachmentsBlock = '';
    if (body.attachments && body.attachments.length) {
      const parts: string[] = [];
      let used = 0;
      for (const a of body.attachments.slice(0, MAX_ATTACHMENTS)) {
        if (used >= ATTACHMENT_CHAR_BUDGET) break;
        const text = (a.text ?? '').slice(0, Math.min(24_000, ATTACHMENT_CHAR_BUDGET - used));
        used += text.length;
        parts.push(`\n--- ${a.name} ---\n${text}`);
      }
      if (parts.length > 0) {
        attachmentsBlock = '\n\nATTACHED FILES (the user attached these to their latest message — use them as primary context for their question; cite by file name):\n' +
          parts.join('\n') + '\n';
      }
      if (parts.length < body.attachments.length) {
        console.log(`[chat] attachments truncated: ${parts.length}/${body.attachments.length} included (${used} chars)`);
      }
    }

    // Project-chat rules only apply when a project is actually in scope; they
    // were previously in MODUS_SYSTEM_PROMPT, costing every other message ~210
    // tokens of instructions about blocks that weren't present.
    const projectRules = body.projectContext ? PROJECT_CHAT_RULES : '';

    // Split for Anthropic prompt caching. Caching is a PREFIX match, so the
    // stable half must be byte-identical across this user's messages and the
    // volatile half must come after it — anything that changes per message
    // sitting early would invalidate the whole thing every turn.
    //   stable   = the ~5.2k-token constant + this user's fixed preferences
    //   volatile = live context (inbox, notes, memory, connectors, …)
    // Screen Assist gets a compact, task-specific prompt instead of the 5.8k-token
    // life-OS persona. See SCREEN_ASSIST_SYSTEM_PROMPT for the measurement that
    // forced it: the persona alone was ~45% of a screen question's cost, and on a
    // 9x-weighted model that made four questions a whole day's allowance.
    const stableSystem = leanContext
      ? SCREEN_ASSIST_SYSTEM_PROMPT + userContextBlock + styleBlock + presetsBlock
      : MODUS_SYSTEM_PROMPT + userContextBlock + styleBlock + presetsBlock + settingsBlock + modelCatalogBlock;
    // Identity of the model serving THIS turn. Volatile (changes per turn under
    // Auto), so it goes here, never in the cached stable prefix. Grounds
    // "what model is this?" instead of letting the model answer from its weights.
    // Skipped in Screen Assist's lean prompt, where every token is budgeted and
    // "which model is this" is not a question a screen answer needs to field.
    const activeModelBlock = leanContext ? '' : buildActiveModelBlock(resolved.modelId);
    const volatileSystem = dateBlock + activeModelBlock + projectRules + connectorBlock + contactsBlock + notesBlock + messagesBlock + memoryContext + goalContextBlock + projectContextBlock + taskContextBlock + projectResourcesBlock + googleDataBlock + notionBlock + slackBlock + githubBlock + webSearchBlock + driveBlock + groupBlock + attachmentsBlock;
    const fullSystemPrompt = stableSystem + volatileSystem;

    // The Llama size guard lived here. It existed for ONE reason: Groq's free tier
    // capped the whole org at ~12k tokens/minute, so a large request 429'd with
    // "Request too large". Above ~9k estimated tokens it upgraded the user to a PAID
    // model (Terra/Sonnet) or, for free users, threw away their entire injected
    // context. Llama left Groq for the Vercel AI Gateway in 3d8441d, and the cap
    // left with it — so the guard was buying OpenAI/Anthropic tokens, and shrinking
    // free users' answers, to dodge a limit that no longer exists.
    //
    // Measured on the real Gateway before removing (scripts/verify-llama-size-guard.ts):
    // meta/llama-3.3-70b answers at 8k / 12k / 20k / 40k estimated tokens, every one
    // finish='stop' in under 2s — 29,106 real prompt tokens at the top end, against a
    // 128K context window. Nothing above the old threshold fails.

    // Collect MCP tools (started before the context block above, so by now this
    // is usually already resolved). Must settle before streamText: mcpTools feeds
    // the call, and mcpClients is what onFinish/onError close.
    await mcpSetupPromise;
    console.log(`[chat] timing: context=${tContext - t0}ms mcp+total=${Date.now() - t0}ms model=${resolved.modelId}${leanContext ? ' (screen mode: lean context)' : ''}`);

    // Layer 2: if the latest message looks like a prompt-extraction / override
    // attempt, reinforce the refusal for this turn (the prompt's confidentiality
    // section is layer one).
    const extractionGuard = looksLikePromptExtraction(queryText) ? PROMPT_EXTRACTION_REMINDER : '';

    // OpenAI o-series AND the gpt-5.x family spend hidden reasoning tokens that
    // count against max_completion_tokens. A flat 2048 cap gets entirely consumed
    // by reasoning → the model returns finishReason:'length' with EMPTY visible
    // text → blank message bubble (200, no error). Give them enough headroom to
    // reason AND still emit an answer.
    //
    // gpt-5.x is not a guess. Measured 2026-07-16, one hard prompt to gpt-5.6-sol:
    //   @ 2048  → reasoning_tokens 2048/2048, finish 'length', 0 chars of answer
    //   @ 16000 → reasoning_tokens 3965,      finish 'stop',   4740 chars
    // Miss this and PILOT users get a blank bubble on exactly the hard questions
    // they upgraded for. "gpt-5.6-terra" burns less but is the same shape.
    // The Claude 5 family (Sonnet 5, Fable 5) is the same shape and had to be added
    // here the day it shipped. Measured 2026-07-17 through THIS code path (the real
    // @ai-sdk/anthropic client, one hard prompt):
    //   claude-sonnet-5 @ 2048  → finish 'length', **0 chars** — a blank bubble
    //   claude-sonnet-5 @ 16000 → finish 'stop',   3541 chars
    //   claude-fable-5  @ 2048  → finish 'length', 2322 chars (truncated mid-answer)
    //   claude-fable-5  @ 16000 → finish 'stop',   2173 chars
    // On Claude 5 thinking is adaptive and ALWAYS counts against max_tokens, so a
    // 2048 cap is spent on reasoning before a single visible character is emitted.
    // Gemini 3.x thinks too, and it was ALREADY truncating the model we ship on
    // MODUS $24. Measured 2026-07-17 through @ai-sdk/google, same hard prompt:
    //   gemini-3.5-flash       @ 2048  → finish 'length', 881 chars — CUT OFF
    //   gemini-3.5-flash       @ 16000 → finish 'stop',   2258 chars
    //   gemini-3.1-pro-preview @ 2048  → finish 'stop',   1438 chars (fine either way)
    // Flash was losing the back half of its answers in production. This is a CAP,
    // not a target — a short answer bills what it generates, so raising it costs
    // nothing except on the long answers the user actually asked for.
    // Provider constraints, keyed on model FAMILY and pinned by
    // scripts/verify-model-params.ts across the whole catalog — see
    // lib/chat/model-params.ts for why they no longer live inline here.
    const maxTokens = maxTokensFor(resolved.modelId);
    // Keyed on the model the user asked for. providerOptions is namespaced per
    // provider and each provider reads only its own key, so if the failover chain
    // lands somewhere else the stale namespace is ignored rather than rejected —
    // the fallback just runs at its own default effort. Safe, and the alternative
    // (recomputing inside onServed) is impossible: the request is already in flight.
    const activeEffortOptions = effortProviderOptions(resolved.modelId, effortFor(userData));

    const isCurrentClaude = needsExplicitTemperature(resolved.modelId);

    // Transparent model failover: if the chosen model rejects the request with a
    // transient rate/size limit (e.g. Groq's per-minute TPM 429 on the free
    // model), retry the next model in the chain — a second free Groq model with a
    // fresh TPM budget, then a paid gpt-4o-mini safety net — so MODUS always
    // answers instead of showing "ran out / too long".
    //
    // The failover itself stays transparent. What is NOT transparent any more is
    // WHO ANSWERED. This used to be silent, and the silence was the bug: Google's
    // billing 429 ("check your plan and billing details") matches isFailoverError
    // on both '429' and 'quota', so a PILOT user could pick Gemini, be answered by
    // Llama, and be told nothing — while the routing chip kept Gemini's name and
    // logo on the reply and persisted that claim to Firestore.
    //
    // servedModelId is the answering model. It cannot travel on a response header:
    // toDataStreamResponse() builds headers synchronously, before doStream has
    // resolved, so a switch decided here would miss them every time. It rides the
    // data stream as a message annotation instead — the same channel the routing
    // chip already reads and useConversations already persists.
    const streamData = new StreamData();

    // Tell the user when an answer used the web. Until now this was completely
    // invisible: results were injected with a "cite sources naturally"
    // instruction and nothing on the answer said where they came from, so a
    // web-sourced reply was indistinguishable from the model's own knowledge.
    // That is how "According to Dapto..." reached a question about MODUS without
    // anything looking wrong. Rides the same annotation channel as the routing
    // chip, so it persists with the thread like the model name does.
    if (webSearchCount > 0) {
      streamData.appendMessageAnnotation({ modusWebSearch: webSearchCount });
    }
    // Which connector each tool belongs to. Sent up front so the live tool row
    // can name the connector while the call is still running.
    if (Object.keys(mcpServerByTool).length > 0 && modelSupportsTools(resolved.modelId)) {
      streamData.appendMessageAnnotation({ modusToolServers: mcpServerByTool });
    }

    let servedModelId = resolved.modelId;
    let streamDataClosed = false;
    // close() is idempotent here because onError and onFinish are mutually
    // exclusive in practice but not guaranteed to be — closing twice throws.
    const closeStreamData = async () => {
      if (streamDataClosed) return;
      streamDataClosed = true;
      try { await streamData.close(); } catch (e) { console.error('[chat] streamData close failed:', e); }
    };

    const failoverModel = createFallbackModel(
      chatFallbackChain(chatModel as Parameters<typeof createFallbackModel>[0][number]),
      {
        onFallback: (from, to, err) => console.log(`[chat] failover: ${from}→${to} (${String(err).slice(0, 140)})`),
        silentBackup: silentStreamBackup(resolved.modelId),
        // Must match the maxSteps on streamText below. Only bites when tools are on.
        maxSteps: 5,
        onServed: (id) => {
          servedModelId = id;
          if (id === resolved.modelId) return;
          // Loud, and matches the pre-flight MODEL DOWNGRADE log above: both
          // downgrade routes are now visible in logs AND to the user.
          console.error(`[chat] MODEL FAILOVER: requested ${resolved.modelId} → served ${id} uid=${uid ?? 'guest'}`);
          // Always correct the chip — a wrong model name on a reply is a false
          // claim regardless of tier. Only flag `downgraded` (which surfaces the
          // user-facing notice) when we actually promised a specific model, i.e.
          // the same isPremiumModel rule the pre-flight gate uses, applied to what
          // the USER picked rather than to whatever the size guard swapped in. A
          // free-tier Llama→Llama TPM hop never promised anything, so it stays
          // quiet — Groq's free tier trips that often enough that a notice there
          // would be constant and people would learn to ignore all of them.
          streamData.appendMessageAnnotation({
            modusServedModel: id,
            modusRequestedModel: promisedModelId,
            modusDowngraded: isPremiumModel(promisedModelId),
          });
        },
      },
    );

    // ── Anthropic prompt caching ──────────────────────────────────────────────
    // Claude re-reads the same ~5.6k-token prefix on every message at full price.
    // cache_control drops cached input to ~10% and cuts time-to-first-token — but
    // @ai-sdk/anthropic only attaches it to a system message carrying
    // providerOptions (dist/index.mjs:196), and `system:` is a bare string with
    // nowhere to hang it. So Claude gets the two-system-message form instead.
    //
    // Only Claude. Every other provider keeps the exact string it gets today:
    // Groq can't cache, and OpenAI/Gemini cache the prefix automatically for free
    // (Gemini's implicit caching needs the stable half FIRST, which is why the
    // stable/volatile split above is not Anthropic-specific).
    // Some models cannot be handed function tools at all (see modelSupportsTools).
    // Drop the toolset AND the prompt block that advertises it together — telling
    // a model "MCP TOOLS AVAILABLE" while sending it none invites it to promise
    // an action it has no way to perform.
    const toolsUsable = modelSupportsTools(resolved.modelId);
    const activeMcpTools = toolsUsable ? mcpTools : {};
    const activeMcpBlock = toolsUsable ? mcpBlock : '';
    if (!toolsUsable && Object.keys(mcpTools).length > 0) {
      console.log(`[chat] tools dropped: ${resolved.modelId} cannot take function tools — answering without them`);
    }

    const systemTail = volatileSystem + activeMcpBlock + extractionGuard;
    const useAnthropicCache = resolved.modelId.startsWith('claude-');

    // What we are about to send, in characters — the fallback basis for token
    // accounting when a provider reports no usage (see onFinish).
    const promptCharsSent =
      stableSystem.length + systemTail.length +
      cappedMessages.reduce((n, m) => n + messageTextLength(m), 0);

    // ⚠️ THE BREAKPOINT ONLY SURVIVES BECAUSE cappedMessages WERE NORMALISED TO
    // CoreMessage AT THE BOUNDARY, AND IT DIES THE MOMENT THAT STOPS BEING TRUE.
    // If any UI-shaped message reaches this array, streamText retypes the WHOLE
    // prompt as "ui-messages" (detectPromptType, ai:2194) and rebuilds every entry
    // — stripping providerOptions off the system messages below, and with them
    // cache_control. That is how this cache spent its entire life switched off,
    // while a console.log here correctly announced the reason on every request.
    // scripts/verify-anthropic-cache.ts asserts the breakpoint on the real
    // outgoing HTTP body — keep it green (3/3, no API key needed).
    if (useAnthropicCache) {
      console.log(`[chat] cache: breakpoint on ${Math.ceil(stableSystem.length / 4)}~tok stable prefix (${resolved.modelId})`);
    }

    const cachedSystemMessages: CoreMessage[] = [
      {
        role: 'system',
        content: stableSystem,
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
      },
      ...(systemTail ? [{ role: 'system' as const, content: systemTail }] : []),
    ];

    const result = streamText({
      model: failoverModel,
      ...(useAnthropicCache
        ? { messages: [...cachedSystemMessages, ...cappedMessages] }
        : { system: fullSystemPrompt + activeMcpBlock + extractionGuard, messages: cappedMessages }),
      maxTokens,
      ...(isCurrentClaude ? { temperature: 1 } : {}),
      // Reasoning effort. Empty at the default 'medium' (which is already every
      // provider's own default), so this changes nothing until a user picks
      // low or high. maxTokens stays the ceiling — see lib/chat/effort.ts for
      // why lowering it instead brings the blank bubbles back.
      ...(Object.keys(activeEffortOptions).length > 0 ? { providerOptions: activeEffortOptions } : {}),
      ...(Object.keys(activeMcpTools).length > 0 ? { tools: activeMcpTools as Parameters<typeof streamText>[0]['tools'], maxSteps: 5 } : {}),
      onError: async ({ error }) => {
        // onFinish does NOT fire when the stream errors, so without this the MCP
        // sockets opened above would leak on every failed request. Also surfaces
        // the raw provider error to logs (getErrorMessage below only sends the
        // client a sanitized token).
        console.error('[chat] streamText onError:', String(error));
        for (const client of mcpClients) {
          try { await client.close(); } catch {}
        }
        // onFinish does not run on error, and an unclosed StreamData never ends
        // the response stream — the client would hang instead of seeing the error.
        await closeStreamData();
      },
      onFinish: async ({ text, usage, finishReason, steps }) => {
        // 🚨 An empty answer used to be INVISIBLE here. The route logged a 200,
        // the timing line looked healthy, and nothing recorded that zero
        // characters reached the user — so the blank bubble could only ever be
        // found by a person reproducing it by hand. finishReason is the single
        // most diagnostic field the SDK gives us ('length' = token cap eaten by
        // reasoning, 'tool-calls' = ended on a tool, 'stop' with 0 chars = the
        // provider genuinely returned nothing). Log it whenever the user got
        // nothing, at error level, naming the model that owed them an answer.
        if (!text || text.trim() === '') {
          // finishReason=unknown is the SDK's catch-all: Google sent a reason this
          // pinned SDK cannot name, or the stream ended with no finish chunk. Which
          // step died and what it called is the only way to tell them apart
          // (10-30: two of these on gemini-3.8-flash with 11 MCP tools, not
          // reproducible without tool calls).
          const stepTrail = (steps ?? [])
            .map(s => `${s.finishReason}[${s.toolCalls.map(c => c.toolName).join(',')}]`)
            .join(' > ');
          console.error(
            `[chat] EMPTY ANSWER: finishReason=${finishReason} model=${servedModelId} ` +
            `tools=${Object.keys(mcpTools).length} tokens=${usage?.completionTokens ?? '?'} uid=${uid ?? 'guest'} ` +
            `steps=${steps?.length ?? 0} trail=${stepTrail || 'none'}`,
          );
        } else {
          console.log(`[chat] finish: reason=${finishReason} chars=${text.length} model=${servedModelId}`);
        }
        // Save what the tools did. useConversations persists content and
        // annotations only, so without this every tool call vanishes on reload.
        const toolRecords = summarizeSteps(steps ?? [], mcpServerByTool);
        if (toolRecords.length > 0) {
          streamData.appendMessageAnnotation({ modusTools: toolRecords } as unknown as Parameters<typeof streamData.appendMessageAnnotation>[0]);
        }
        // Close MCP clients
        for (const client of mcpClients) {
          try { await client.close(); } catch {}
        }
        // Must close or the data stream (and so the response) never ends.
        await closeStreamData();
        // Track tokens for paid users (fire-and-forget)
        // 🚨 NOT every provider reports usage. Measured 2026-07-23 on the live
        // stream: Anthropic returns real counts, but Gateway-hosted models AND
        // gpt-5.6-terra both return {promptTokens: null, completionTokens: null},
        // so `usage.totalTokens` is null/NaN — falsy — and the daily/weekly
        // ceilings were simply never incremented for them. The limits looked
        // enforced and were not, on most of the catalog.
        //
        // A rough estimate is strictly better than silently counting zero: ~4
        // chars per token over what we actually sent and received. Prefer real
        // usage whenever the provider gives it.
        if (uid) {
          const reported = usage?.totalTokens;
          const total = typeof reported === 'number' && Number.isFinite(reported) && reported > 0
            ? reported
            : Math.ceil((promptCharsSent + (text?.length ?? 0)) / 4);
          // Weighted by what the model actually costs — see lib/chat/model-cost.ts.
          if (total > 0) trackTokenUsage(uid, userData, total, resolved.modelId);
        }
        if (!uid || !queryText || !process.env.PINECONE_API_KEY) return;
        // Respect the user's "generate memory from chat" setting (was ignored).
        if (userData?.settings?.generateMemoryFromChat === false) return;
        try {
          // Only persist a durable fact about the user — not the raw exchange.
          const fact = await extractDurableMemory(queryText, text);
          if (fact) {
            await upsertMemory(uid, fact, { type: 'extracted_fact', ts: Date.now().toString() });
          }
        } catch (e) {
          console.error('[chat] memory upsert failed:', e);
        }
      },
    });

    const usageNow = usagePercent(userData);

    return result.toDataStreamResponse({
      data: streamData,
      headers: {
        // Honest labeling: what we are ABOUT TO ask, so the client can show a
        // notice when a premium pick was downgraded by the pre-flight gate.
        //
        // Headers are still computed before streaming begins, so this remains the
        // model we ATTEMPTED — it cannot know about a runtime failover. That gap
        // is now covered: createFallbackModel reports the real answering model via
        // onServed, which rides the data stream as a modusServedModel annotation
        // and OVERRIDES this value on the client. Header = intent, annotation =
        // truth; when they disagree, the annotation wins.
        'x-modus-model': resolved.modelId,
        // Where this account stands against its plan ceiling, 0-100. Omitted
        // entirely when no ceiling applies, so the client shows nothing rather
        // than a percentage of nothing.
        ...(usageNow !== null ? { 'x-modus-usage': String(usageNow) } : {}),
        // Auto mode picked this model for the task → client shows a routing chip.
        ...(wasAutoRouted ? { 'x-modus-auto': '1' } : {}),
        ...(resolved.downgraded
          ? {
              'x-modus-downgraded': '1',
              'x-modus-requested-model': resolved.requestedId ?? '',
              // WHY, so the notice is true. 'vision' means the picked model works
              // fine and simply cannot read images — telling that user their model
              // is "temporarily unavailable" would be a lie about a healthy model.
              'x-modus-downgrade-reason': resolved.downgradeReason ?? 'unavailable',
            }
          : {}),
      },
      getErrorMessage: (error) => {
        const s = String(error);
        console.error('[chat] stream error:', s);
        const sl = s.toLowerCase();
        // Normalize Groq/OpenAI rate limit errors → recognizable tokens for the client
        if (sl.includes('tokens per day') || sl.includes('tpd') || sl.includes('daily')) return 'groq_daily_limit';
        if (sl.includes('rate limit') || sl.includes('429') || sl.includes('too many')) return 'rate_limit_reached';
        if (sl.includes('401') || sl.includes('api key') || sl.includes('unauthorized')) return 'api_key_error';
        if (sl.includes('503') || sl.includes('502') || sl.includes('overloaded')) return 'provider_down';
        // "too large"/TPM from Groq is a TRANSIENT per-minute throttle, not a
        // permanent "your message is too long" — and the failover chain above
        // already tried every model, so reaching here means all were briefly
        // busy. Surface that honestly (never tell the user to shorten a 2-char
        // message). Kept the `message_too_large` alias for older cached clients.
        if (sl.includes('too large') || sl.includes('tokens per minute') || sl.includes('reduce') || sl.includes('message_too_large')) return 'all_models_busy';
        // Don't leak raw provider/internal error text to the client.
        return 'chat_error';
      },
    });
  } catch (e) {
    console.error('[chat] route error:', String(e));
    return Response.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
