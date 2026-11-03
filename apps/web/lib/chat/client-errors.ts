/**
 * The ONE place a /api/chat failure becomes words a person can read.
 *
 * Lifted from ChatWindow's onError (11-02). Goals, Projects and Briefing each had
 * their own shorter copy of this chain and Briefing had none at all, so the same
 * failure read differently per page or showed nothing. Every chat surface now
 * calls this. `paywall`/`exhausted` tell the caller which side effects to run.
 */
export type ChatErrorView = { text: string; paywall?: boolean; exhausted?: boolean };

/**
 * "It resets in about 3 hours." from a `resetAt` (ms) in the error body. The
 * body arrives as text (useChat puts the response text in err.message), so it is
 * read with a regex rather than JSON.parse, which also survives a prefix.
 */
export function resetPhrase(raw: string | undefined, now = Date.now()): string {
  const at = Number(/"resetAt"\s*:\s*(\d{10,})/.exec(raw ?? '')?.[1]);
  if (!Number.isFinite(at) || at <= now) return 'Try again in a few hours.';
  const mins = Math.ceil((at - now) / 60000);
  if (mins < 60) return `It resets in about ${mins} minute${mins === 1 ? '' : 's'}.`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `It resets in about ${hours} hour${hours === 1 ? '' : 's'}.`;
  const day = new Date(at).toLocaleDateString(undefined, { weekday: 'long' });
  return `It resets on ${day}.`;
}

export function chatErrorView(raw: string | undefined): ChatErrorView {
  const msg = (raw ?? '').toLowerCase();
  if (msg.includes('authentication_required')) {
    // A signed-in user with a fresh-per-send token should effectively never get
    // here; the next send mints a new token, so ask for a retry, not a login.
    return { text: 'We had trouble verifying your session. Please try again.' };
  }
  if (msg.includes('guest_limit_reached')) {
    return { text: "You've used the free guest messages. Sign up to keep chatting.", paywall: true };
  }
  if (msg.includes('free_limit_reached')) {
    return { text: "You've hit your free limit for now. It refreshes soon, or upgrade for every model.", paywall: true, exhausted: true };
  }
  if (msg.includes('image_requires_subscription')) {
    return { text: 'Images are a paid feature, subscribe to attach one.', paywall: true };
  }
  if (msg.includes('subscription_required')) {
    return { text: 'Continue with the Free plan or upgrade for more access.', paywall: true, exhausted: true };
  }
  if (msg.includes('empty_message')) return { text: 'That message was empty, type something first.' };
  // "usage limit", not "token limit": the ceiling counts cost units. It is NOT
  // daily and does not reset at midnight (the old copy said both): a rolling
  // 5h window plus a weekly cap. The server sends `resetAt` with the code.
  if (msg.includes('token_limit_reached')) return { text: `You've hit your usage limit. ${resetPhrase(raw)}` };
  if (msg.includes('groq_daily_limit')) {
    return { text: 'AI daily limit reached, switch models with the selector below the chat box, or try again tomorrow.' };
  }
  if (msg.includes('rate_limit_reached') || msg.includes('rate limit') || msg.includes('429') || msg.includes('tpd') || msg.includes('tokens per day') || msg.includes('too many')) {
    return { text: 'AI service is busy. Wait a moment and try again.' };
  }
  if (msg.includes('api_key_error') || msg.includes('401') || msg.includes('unauthorized') || msg.includes('api key') || msg.includes('invalid key')) {
    return { text: 'AI service configuration error. Contact support.' };
  }
  if (msg.includes('provider_down') || msg.includes('503') || msg.includes('502') || msg.includes('unavailable') || msg.includes('overloaded')) {
    return { text: 'AI service is down. Try again in a moment.' };
  }
  if (msg.includes('all_models_busy') || msg.includes('message_too_large')) {
    // Not a length problem: every model was briefly throttled.
    return { text: 'The AI is briefly busy right now. Wait a few seconds and try again, or switch models below.' };
  }
  if (msg.includes('invalid_request')) {
    return { text: 'That message could not be sent. Remove the attachment and try again, or start a new chat.' };
  }
  if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed')) {
    return { text: 'Connection lost. Check your internet and try again.' };
  }
  return { text: 'Something went wrong. Please try again.' };
}
