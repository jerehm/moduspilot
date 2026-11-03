import { getUsageWeekKey } from '@/lib/usage';
import { createHash } from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { GUEST_DAILY_LIMIT, WINDOW_MS } from '@/lib/constants';
import { hasActiveAccess, isPaidPlan, planCeilings } from '@/lib/plan';
import { weightedTokens } from '@/lib/chat/model-cost';

/**
 * Is this a free-tier account — signed in, with no subscription?
 *
 * Deliberately "not paid" rather than plan === 'free': the
 * Stripe webhook never writes 'free', so a free-tier user's `plan` is simply
 * absent. Checking for the string would silently match nobody, which is the kind
 * of gate that looks enforced and is not.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isFreeTierUser(userData: Record<string, any> | null | undefined): boolean {
  if (!userData) return false;
  return !isPaidPlan(userData.plan as string | undefined);
}

/** ISO date (YYYY-MM-DD) of the Monday that starts the current UTC week. */
export function getWeekKey(): string { return getUsageWeekKey(); }

/**
 * Guest rate limit — GUEST_DAILY_LIMIT messages per day per IP (unauthenticated).
 * Atomic transaction prevents concurrent-request bypass.
 * Returns a 429 Response when blocked, otherwise null.
 */
export async function enforceGuestRateLimit(req: Request): Promise<Response | null> {
  const ip = (req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown')
    .split(',')[0].trim();
  const ipHash = createHash('sha256').update(ip).digest('hex').slice(0, 32);
  const todayStr = new Date().toISOString().slice(0, 10);
  const guestRef = adminDb.collection('guestRateLimits').doc(ipHash);
  let guestBlocked = false;
  await adminDb.runTransaction(async (txn) => {
    const snap = await txn.get(guestRef);
    const data = snap.data() ?? {};
    const count = (data.date as string) === todayStr ? ((data.count as number) ?? 0) : 0;
    if (count >= GUEST_DAILY_LIMIT) { guestBlocked = true; return; }
    txn.set(guestRef, { count: count + 1, date: todayStr });
  });
  return guestBlocked ? Response.json({ error: 'guest_limit_reached' }, { status: 429 }) : null;
}

/**
 * Subscription gate, in the order access is granted:
 *
 *   1. paid/trialing subscription (plan set by the Stripe webhook, including the
 *      3-day card-required trial) — hasActiveAccess
 *   2. the free plan: the open models, bounded by a rolling window + weekly ceiling
 *   3. otherwise a 402 free_limit_reached (temporary — the window refreshes)
 *
 * 🗑️ There used to be a step between 1 and 2: any account created before
 * PAYWALL_LAUNCH_MS got permanent free access, resolved from its Firebase signup
 * date. **Jeremiah never made that rule** — an earlier session invented it, and its
 * name (`grandfathered`, later `preLaunchAccess`) kept being confused with
 * moduspilot.com/grandfathering, which is the opposite: founding members who PAY
 * $24/mo. Deleted 2026-08-06. Signup date now entitles you to nothing.
 *
 * 🧊 THE FREE PLAN CHANGED SHAPE. It used to be a LIFETIME count of 10 messages on
 * ANY model; it is now the OPEN models only (canUseModel holds the model choice to
 * plans:['free']) on a rolling WINDOW_HOURS window plus a weekly ceiling, so it is a
 * real ongoing free tier and the frontier models are the reason to upgrade. The
 * counters are the same windowStart/windowTokens/weeklyTokens the paid path reads,
 * which trackTokenUsage already writes for free users, so this gate is a read like
 * enforcePaidTokenLimit rather than a write.
 *
 * ⚠️ `plan` is undefined for a free-tier user, so anything keying off isPaidPlan()
 * needs the shared free allowance; paid-only feature gates still skip them.
 *
 * Returns a Response when blocked, otherwise null.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function enforceSubscriptionGate(_uid: string, userData: Record<string, any>): Response | null {
  // Fast path: subscribed or trialing. That is the only thing that skips the tier.
  if (hasActiveAccess(userData)) return null;
  // Free plan: the open models, bounded by the rolling window + weekly ceiling.
  return enforceFreeTokenLimit(userData);
}

/**
 * The free plan's ceiling: a rolling WINDOW_HOURS window plus a weekly cap, read off
 * the SAME counters the paid path uses. Read-only — the post-answer increment in
 * trackTokenUsage advances them, exactly like the paid path.
 *
 * 🕔 Rolling: a windowStart older than WINDOW_MS reads as expired, so its tokens
 * count as 0 and the next message re-anchors it (trackTokenUsage). The WEEKLY cap is
 * the real cost governor — see FREE_WEEKLY_LIMIT in lib/constants.ts for the money.
 *
 * Distinct 402 `free_limit_reached` from 'subscription_required' so the client can
 * say "you've hit your free limit for now, it refreshes soon / upgrade" rather than
 * "start your trial", which reads as a broken loop to someone already using it.
 *
 * 💸 Cost is bounded because the counters store COST UNITS: a dearer free model
 * (Gemini Flash, weight 5) burns the window faster, so the ceiling bounds dollars,
 * not tokens. verify-free-tier.ts turns FREE_WEEKLY_LIMIT into a monthly figure.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function enforceFreeTokenLimit(userData: Record<string, any>): Response | null {
  const now       = Date.now();
  const weekKey   = getWeekKey();
  const windowStart  = (userData.windowStart as number) ?? 0;
  const tokensWindow = now < windowStart + WINDOW_MS ? ((userData.windowTokens as number) ?? 0) : 0;
  const tokensWeek   = (userData.tokenWeek as string) === weekKey ? ((userData.weeklyTokens as number) ?? 0) : 0;
  const { window: windowLimit, weekly: weeklyLimit } = planCeilings({ plan: 'free' });
  if (tokensWindow >= windowLimit || tokensWeek >= weeklyLimit) {
    return Response.json({ error: 'free_limit_reached' }, { status: 402 });
  }
  return null;
}

/**
 * Paid per-window + weekly token ceilings. Non-paid plans are a no-op.
 * Returns a 429 Response when over budget, otherwise null.
 *
 * Ceilings come from planCeilings() so a purchased add-on raises the gate and the
 * meter by the same amount — see lib/plan.ts for why that is not computed here.
 *
 * 🕔 The short window is ROLLING: a windowStart older than WINDOW_MS reads as
 * expired, so its tokens count as 0 (a fresh window begins on the next message in
 * trackTokenUsage). An old doc with no windowStart is treated as expired too,
 * which self-heals the migration off the former calendar-day counter.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function enforcePaidTokenLimit(userData: Record<string, any>): Response | null {
  const plan = userData.plan as string | undefined;
  // Only paid plans have THIS ceiling. Free-tier accounts have their own, tighter
  // window + weekly ceiling in enforceFreeTokenLimit (called via
  // enforceSubscriptionGate), and can only reach the open models anyway.
  if (!isPaidPlan(plan)) return null;
  const now       = Date.now();
  const weekKey   = getWeekKey();
  const { window: windowLimit, weekly: weeklyLimit } = planCeilings(userData);
  const windowStart  = (userData.windowStart as number) ?? 0;
  const tokensWindow = now < windowStart + WINDOW_MS ? ((userData.windowTokens as number) ?? 0) : 0;
  const tokensWeek   = (userData.tokenWeek as string) === weekKey ? ((userData.weeklyTokens as number) ?? 0) : 0;
  if (tokensWindow >= windowLimit || tokensWeek >= weeklyLimit) {
    // When it actually lifts, so the client can say so. The old copy said
    // "Resets at midnight", which is true of neither ceiling: the window rolls
    // 5h from its start, the week resets Monday 00:00 UTC (getUsageWeekKey).
    // If both are hit, the later one is when the user can chat again.
    const windowReset = tokensWindow >= windowLimit ? windowStart + WINDOW_MS : 0;
    const weekReset = tokensWeek >= weeklyLimit ? nextUsageWeekStart(now) : 0;
    return Response.json({ error: 'token_limit_reached', resetAt: Math.max(windowReset, weekReset) }, { status: 429 });
  }
  return null;
}

/** Monday 00:00 UTC after `now`: when the weekly counter (getUsageWeekKey) rolls over. */
export function nextUsageWeekStart(now = Date.now()): number {
  const monday = Date.parse(`${getUsageWeekKey(now)}T00:00:00Z`);
  return monday + 7 * 24 * 60 * 60 * 1000;
}

/**
 * How much of the plan's ceiling this account has consumed, 0–100.
 *
 * Takes the HIGHER of the window and weekly figures, because whichever will stop
 * the user first is the only one worth showing them — reporting 20% of the week
 * while the window is at 95% would be true and useless.
 *
 * Returns null where no ceiling applies (guests, free, unpaid): a percentage of
 * a limit that does not exist is worse than showing nothing.
 *
 * ⏱️ Computed BEFORE the answer streams, from the counters as they stand at the
 * start of the request — so it excludes the message being sent right now. It is
 * a "where you stand" figure, not a live meter, which is what makes it stable
 * enough to show without flickering mid-stream.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function usagePercent(userData: Record<string, any>): number | null {
  const plan = userData.plan as string | undefined;
  if (!isPaidPlan(plan)) return null;
  const now = Date.now();
  const weekKey = getWeekKey();
  const { window: windowLimit, weekly: weeklyLimit } = planCeilings(userData);
  const windowStart  = (userData.windowStart as number) ?? 0;
  const tokensWindow = now < windowStart + WINDOW_MS ? ((userData.windowTokens as number) ?? 0) : 0;
  const tokensWeek   = (userData.tokenWeek as string) === weekKey ? ((userData.weeklyTokens as number) ?? 0) : 0;
  const worst = Math.max(tokensWindow / windowLimit, tokensWeek / weeklyLimit);
  if (!Number.isFinite(worst)) return null;
  // 🪤 100% MEANS BLOCKED, AND ONLY BLOCKED.
  //
  // This used to be a plain Math.round, so 499,999 of a 500,000 ceiling rounded
  // to 100% — the meter told people they were out of usage while
  // enforcePaidTokenLimit was still happily serving them. Reporting "you have
  // nothing left" to someone who does is the same failure as the 27x billing bug,
  // just cheaper: the number shown and the number enforced disagreed.
  //
  // Capping at 99 until `worst` actually reaches 1 makes the two agree by
  // construction, and scripts/verify-limit-addon.ts pins it at every quantity.
  if (worst >= 1) return 100;
  return Math.max(0, Math.min(99, Math.round(worst * 100)));
}

/**
 * Track token usage for paid users (fire-and-forget). No-op for free plans.
 * Increments daily + weekly counters atomically, resetting on date/week roll.
 *
 * 🚨 `modelId` IS REQUIRED AND THE WEIGHTING HAPPENS IN HERE, ON PURPOSE.
 *
 * The counters store COST UNITS, not raw tokens: one Claude Fable 5 token is ~24
 * Llama 3.3 tokens of spend, and before this the ceiling treated them as equal, so
 * it bounded token count while bounding nothing about the bill. See
 * lib/chat/model-cost.ts for the measured exposure.
 *
 * Doing the multiply at the call site instead would mean every future call site
 * has to remember, and the one that forgets is invisible: usage still increments,
 * the limit still appears enforced, and the model is served at a loss. Taking the
 * model id as a required argument makes that mistake a type error.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function trackTokenUsage(uid: string, userData: Record<string, any>, rawTokens: number, modelId: string): void {
  const plan = userData.plan as string | undefined;
  // Record for paid plans AND for the free tier. These counters ARE the free-tier
  // ceiling now: enforceFreeTokenLimit reads windowTokens/weeklyTokens back against
  // FREE_WINDOW_LIMIT/FREE_WEEKLY_LIMIT, so a missed increment here would let a free
  // user run unbounded. The window re-anchors below the same way for both tiers.
  if (!isPaidPlan(plan) && !isFreeTierUser(userData)) return;
  const totalTokens = weightedTokens(modelId, rawTokens);
  if (totalTokens <= 0) return;
  const userRef = adminDb.collection('users').doc(uid);
  adminDb.runTransaction(async (txn) => {
    const snap = await txn.get(userRef);
    const data = snap.data() ?? {};
    const now         = Date.now();
    const weekKey     = getWeekKey();
    // 🕔 Re-anchor the window when the previous one has expired (or never existed).
    // While it is live, keep windowStart fixed so the 5h clock does not slide
    // forward on every message — a window is WINDOW_HOURS from its FIRST message.
    const windowStart = (data.windowStart as number) ?? 0;
    const inWindow    = now < windowStart + WINDOW_MS;
    const isThisWeek  = (data.tokenWeek as string) === weekKey;
    txn.set(userRef, {
      windowTokens: inWindow ? FieldValue.increment(totalTokens) : totalTokens,
      windowStart:  inWindow ? windowStart : now,
      weeklyTokens: isThisWeek ? FieldValue.increment(totalTokens) : totalTokens,
      tokenWeek:    weekKey,
    }, { merge: true });
  }).catch(e => console.error('[chat] token increment failed:', e));
}
