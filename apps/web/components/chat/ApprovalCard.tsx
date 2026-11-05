'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { auth } from '@/lib/firebase';

interface ApprovalPayload {
  type: string;
  title: string;
  description: string;
  payload: Record<string, unknown>;
}

const TYPE_LABELS: Record<string, string> = {
  create_project: 'New Project',
  create_goal: 'New Goal',
  create_task: 'New Task',
  create_habit: 'New Habit',
  schedule_event: 'Schedule Event',
  schedule_group_event: 'Group Event',
  draft_email: 'Draft Email',
  update_goal: 'Update Goal',
  update_goal_progress: 'Goal Progress',
  update_task: 'Update Task',
  update_habit: 'Update Habit',
  delete_task: 'Delete Task',
  delete_habit: 'Delete Habit',
  delete_goal: 'Delete Goal',
  create_goal_chat: 'New Goal Chat',
  delete_goal_chat: 'Delete Chat',
  create_project_chat: 'New Project Chat',
  delete_project_chat: 'Delete Chat',
  connect_google: 'Connect Google',
  connect_notion: 'Connect Notion',
  connect_slack: 'Connect Slack',
  connect_github: 'Connect GitHub',
  enable_web_search: 'Enable Web Search',
  send_email: 'Send Email',
  reschedule_event: 'Reschedule Event',
  archive_email: 'Archive Email',
  mark_read_email: 'Mark as Read',
};

const CONNECT_ENDPOINTS: Record<string, string> = {
  connect_google: '/api/auth/google/connect',
  connect_notion: '/api/auth/notion/connect',
  connect_slack: '/api/auth/slack/connect',
  connect_github: '/api/auth/github/connect',
};

const REDIRECT_TYPES = new Set(Object.keys(CONNECT_ENDPOINTS));

const spring = { type: 'spring', stiffness: 300, damping: 26 } as const;
const springFast = { type: 'spring', stiffness: 420, damping: 28 } as const;

function buildFollowUpMessage(type: string, title: string, payload: Record<string, unknown>): string | null {
  switch (type) {
    case 'create_project': {
      const notes = (payload.notes as Array<{ content: string }> | undefined) ?? [];
      if (notes.length === 0) return `Created the project "${title}".`;
      const noteLines = notes.slice(0, 3).map(n => `• ${n.content}`).join('\n');
      return `Created the project "${title}". Added ${notes.length} note${notes.length > 1 ? 's' : ''} to get you started:\n${noteLines}`;
    }
    case 'create_task': {
      const dueDate = payload.dueDate as string | undefined;
      const priority = payload.priority as string | undefined;
      let msg = `Added "${title}" to your tasks.`;
      if (dueDate) msg += ` Due ${dueDate}.`;
      if (priority) msg += ` Marked as ${priority} priority.`;
      return msg;
    }
    case 'create_goal': {
      const dueDate = payload.dueDate as string | undefined;
      let msg = `Goal set: "${title}".`;
      if (dueDate) msg += ` Targeting ${dueDate}.`;
      msg += ` Progress starts at 0%, I'll track it as you move forward.`;
      return msg;
    }
    case 'create_habit': {
      const freq = (payload.frequency as string | undefined) ?? 'daily';
      return `"${title}" is now a ${freq} habit. Day 1 starts today, let's build the streak.`;
    }
    case 'schedule_event': {
      const date = payload.date as string | undefined;
      const startTime = payload.startTime as string | undefined;
      let msg = `Scheduled "${title}"`;
      if (date) msg += ` on ${date}`;
      if (startTime) msg += ` at ${startTime}`;
      return msg + '.';
    }
    case 'schedule_group_event': {
      const attendees = payload.attendees as string[] | undefined;
      const n = attendees?.length ?? 0;
      return `Scheduled "${title}" and invited ${n > 0 ? `${n} group member${n > 1 ? 's' : ''}` : 'the group'}.`;
    }
    case 'send_email': {
      const to = payload.to as string | undefined;
      return `Email sent${to ? ` to ${to}` : ''}.`;
    }
    case 'update_goal_progress': {
      const progress = payload.progress as number | undefined;
      return progress !== undefined ? `Updated "${title}" to ${progress}% complete.` : `Updated "${title}".`;
    }
    case 'update_task':
    case 'update_goal':
    case 'update_habit':
      return `Updated "${title}".`;
    case 'delete_task':
    case 'delete_goal':
    case 'delete_habit':
      return `Removed "${title}".`;
    default:
      return null;
  }
}

export default function ApprovalCard({
  raw,
  cardId,
  onApproved,
}: {
  raw: string;
  /**
   * Stable identity for THIS card: `<messageId>:<blockIndex>`. The message id is
   * persisted to Firestore with the thread, so it is the same on every reload,
   * in every tab, forever.
   */
  cardId?: string;
  onApproved?: (text: string) => void;
}) {
  // Remember that this card was approved, so a remount never offers to do the
  // work a second time. Two things used to break that, and an approval card
  // doing its thing twice means an email sent twice:
  //
  //  - sessionStorage DIES WITH THE TAB. Approve, close the tab, reopen the
  //    conversation, and an already-sent email showed as pending again.
  //  - The key was a module counter incremented per mount, so it only lined up
  //    while cards mounted in the same order in the same page session. Any drift
  //    silently pointed at the wrong key, i.e. pending.
  //
  // localStorage keyed on the persisted message id fixes both. cardId is
  // optional so a card rendered outside a saved thread still works — it just
  // falls back to in-memory state, which is the honest behaviour when there is
  // no durable identity to hang it on.
  const storageKey = cardId ? `modus:approved:${cardId}` : '';

  const [status, setStatus] = useState<'pending' | 'editing' | 'approved' | 'dismissed'>(() => {
    try {
      if (typeof window !== 'undefined' && storageKey && localStorage.getItem(storageKey) === '1') return 'approved';
    } catch {}
    return 'pending';
  });

  useEffect(() => {
    if (status === 'approved' && storageKey) {
      try { localStorage.setItem(storageKey, '1'); } catch {}
    }
  }, [status, storageKey]);

  const [loading, setLoading] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedProgress, setEditedProgress] = useState(0);
  const [editedBody, setEditedBody] = useState('');
  const [error, setError] = useState('');
  const [googleAccounts, setGoogleAccounts] = useState<{ email: string }[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');

  // Parse via useMemo so the "invalid JSON" bail-out (below) happens AFTER every
  // hook has run. A `return null` here — before the useEffect that follows —
  // would be a rules-of-hooks violation: the hook count would change if `raw`
  // ever flipped between parseable and not. (Same bug class fixed in DraftOptionsCard.)
  const parsed = useMemo<ApprovalPayload | null>(() => {
    // Model output: `null`, a bare string, or an object field where text belongs
    // all parsed fine and then crashed the render (.replace on a non-string).
    let v: unknown;
    try { v = JSON.parse(raw); } catch { return null; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.type !== 'string') return null;
    const text = (x: unknown) => (typeof x === 'string' ? x : x == null ? '' : String(x));
    return {
      ...(o as unknown as ApprovalPayload),
      title: text(o.title),
      description: text(o.description),
      payload: o.payload && typeof o.payload === 'object' && !Array.isArray(o.payload)
        ? (o.payload as ApprovalPayload['payload'])
        : {},
    } as ApprovalPayload;
  }, [raw]);

  useEffect(() => {
    if (!parsed || parsed.type !== 'send_email') return;
    auth.currentUser?.getIdToken().then(async token => {
      try {
        const res = await fetch('/api/google/status', { headers: { Authorization: `Bearer ${token}` } });
        const d = await res.json();
        const accounts: { email: string }[] = d.accounts ?? [];
        setGoogleAccounts(accounts);
        const payloadAccount = parsed.payload?.from_account as string | undefined;
        setSelectedAccount(payloadAccount || accounts[0]?.email || '');
      } catch { /* non-fatal */ }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed?.type]);

  // Invalid JSON — bail out only now that all hooks above have run. Alias to a
  // non-null `data` so the rest of the component (and the approve() closure) keep
  // their existing narrowed type.
  if (!parsed) return null;
  const data = parsed;

  async function approve(title: string, overridePayload?: Record<string, unknown>) {
    setLoading(true);
    setError('');
    try {
      const token = await auth.currentUser?.getIdToken();

      if (REDIRECT_TYPES.has(data.type)) {
        const endpoint = CONNECT_ENDPOINTS[data.type];
        const isGoogle = data.type === 'connect_google';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(isGoogle ? {} : { origin: 'chat' }),
        });
        if (!res.ok) { setError('Failed to start connection.'); return; }
        const { url } = await res.json();
        if (url) window.location.href = url;
        return;
      }

      const basePayload = data.payload && Object.keys(data.payload).length > 0
        ? data.payload
        : Object.fromEntries(Object.entries(data).filter(([k]) => !['type', 'title', 'description'].includes(k)));

      const emailOverride = data.type === 'send_email' && selectedAccount
        ? { from_account: selectedAccount }
        : {};

      const payload = { ...basePayload, ...(overridePayload ?? {}), ...emailOverride };

      const res = await fetch('/api/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: data.type, title, description: data.description, payload }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body.error ?? 'Something went wrong. Try again.';
        setError(msg.includes('not connected') ? 'Reconnect Google in Settings → Integrations to send emails.' : msg);
        return;
      }
      setStatus('approved');
      const followUp = buildFollowUpMessage(data.type, title, payload);
      if (followUp) onApproved?.(followUp);
    } catch {
      setError('Network error. Try again.');
    } finally {
      setLoading(false);
    }
  }

  const isEmailType = data.type === 'send_email' || data.type === 'draft_email';
  const emailSubject = data.payload?.subject ? String(data.payload.subject) : null;
  const emailTo = data.payload?.to ? String(data.payload.to) : null;
  const confirmedLabel = data.type === 'send_email'
    ? `Sent${emailSubject ? `: ${emailSubject}` : ''}`
    : data.type === 'draft_email'
    ? `Draft saved${emailSubject ? `: ${emailSubject}` : ''}`
    : `${editedTitle || data.title}, done`;
  const pendingProgress = typeof data.payload?.progress === 'number' ? data.payload.progress : 0;
  const isConnectCard = REDIRECT_TYPES.has(data.type);

  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
    >
      <AnimatePresence mode="wait">
        {/* ── Approved ── */}
        {status === 'approved' && (
          <motion.div
            key="approved"
            initial={{ opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={spring}
            className="border border-tint surface-tint rounded-xl px-4 py-3 space-y-1"
          >
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-brand shrink-0">
                <motion.path
                  d="M2 6l3 3 5-5"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.38, ease: 'easeOut', delay: 0.08 }}
                />
              </svg>
              <span className="text-sm text-brand">{confirmedLabel}</span>
            </div>
            {isEmailType && emailTo && (
              <p className="text-xs text-muted pl-5">To: {emailTo}</p>
            )}
          </motion.div>
        )}

        {/* ── Dismissed ── */}
        {status === 'dismissed' && (
          <motion.div
            key="dismissed"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.22 }}
            className="border border-border rounded-xl px-4 py-3 text-sm text-muted line-through"
          >
            {data.title}
          </motion.div>
        )}

        {/* ── Editing ── */}
        {status === 'editing' && (
          <motion.div
            key="editing"
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={spring}
            className="border border-border bg-panel rounded-xl px-4 py-4 space-y-3"
          >
            <div>
              <p className="text-xs text-muted uppercase tracking-wider mb-2">
                {TYPE_LABELS[data.type] ?? data.type.replace(/_/g, ' ')}
              </p>
              {data.type === 'update_goal_progress' ? (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-text">{data.title}</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted">Progress</span>
                      <span className="text-sm font-semibold text-brand">{editedProgress}%</span>
                    </div>
                    <input type="range" min={0} max={100} step={5} value={editedProgress}
                      onChange={e => setEditedProgress(Number(e.target.value))} className="w-full accent-brand" />
                  </div>
                </div>
              ) : isEmailType ? (
                <div className="space-y-2">
                  <input value={editedTitle} onChange={e => setEditedTitle(e.target.value)}
                    placeholder="Subject"
                    className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-brand transition-colors"
                    onKeyDown={e => { if (e.key === 'Escape') setStatus('pending'); }} />
                  <textarea autoFocus value={editedBody} onChange={e => setEditedBody(e.target.value)}
                    rows={7}
                    placeholder="Message"
                    className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-brand transition-colors resize-y leading-relaxed"
                    onKeyDown={e => { if (e.key === 'Escape') setStatus('pending'); }} />
                </div>
              ) : (
                <>
                  <input autoFocus value={editedTitle} onChange={e => setEditedTitle(e.target.value)}
                    className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-brand transition-colors"
                    onKeyDown={e => { if (e.key === 'Enter') approve(editedTitle); if (e.key === 'Escape') setStatus('pending'); }} />
                  <p className="text-xs text-muted mt-1.5">{data.description}</p>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <motion.button
                onClick={() => {
                  if (data.type === 'update_goal_progress') approve(data.title, { progress: editedProgress });
                  else if (isEmailType) approve(editedTitle, { subject: editedTitle, body: editedBody });
                  else approve(editedTitle);
                }}
                disabled={loading || (data.type !== 'update_goal_progress' && !editedTitle.trim()) || (isEmailType && !editedBody.trim())}
                whileHover={!loading ? { scale: 1.02 } : {}}
                whileTap={!loading ? { scale: 0.97 } : {}}
                transition={springFast}
                className="flex-1 bg-brand text-white text-xs font-semibold py-2 rounded-lg hover:bg-brand/90 transition-colors disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Confirm'}
              </motion.button>
              <motion.button
                onClick={() => setStatus('pending')}
                whileTap={{ scale: 0.97 }}
                transition={springFast}
                className="px-4 bg-border text-muted text-xs font-semibold py-2 rounded-lg hover:text-text transition-colors"
              >
                Cancel
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* ── Pending ── */}
        {status === 'pending' && (
          <motion.div
            key="pending"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={spring}
            className="border border-tint bg-panel rounded-xl px-4 py-4 space-y-3 shadow-[inset_0_0_32px_rgba(124,58,237,0.04)]"
          >
            <div>
              <p className="text-xs text-muted uppercase tracking-wider mb-1">
                {TYPE_LABELS[data.type] ?? data.type.replace(/_/g, ' ')}
              </p>
              <p className="text-sm font-semibold text-text">{data.title}</p>
              {data.type === 'update_goal_progress' ? (
                <div className="mt-2 space-y-1.5">
                  <div className="h-1.5 bg-border rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-brand rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${pendingProgress}%` }}
                      transition={{ type: 'spring', stiffness: 120, damping: 20, delay: 0.2 }}
                    />
                  </div>
                  <p className="text-xs text-muted">{pendingProgress}% complete</p>
                </div>
              ) : (data.type === 'send_email' || data.type === 'draft_email') ? (() => {
                const eTo = data.payload?.to ? String(data.payload.to) : null;
                const eSubject = data.payload?.subject ? String(data.payload.subject) : data.title;
                const eBody = data.payload?.body ? String(data.payload.body) : null;
                return (
                  <div className="mt-2 space-y-1 text-xs text-muted">
                    {eTo && <p><span className="text-text/60 font-medium">To:</span> {eTo}</p>}
                    {eSubject && <p><span className="text-text/60 font-medium">Subject:</span> {eSubject}</p>}
                    {eBody && (
                      <div className="mt-2 bg-bg rounded-lg p-2.5 border border-border whitespace-pre-wrap text-[11px] text-text/80 max-h-36 overflow-y-auto">
                        {eBody}
                      </div>
                    )}
                  </div>
                );
              })() : (
                <p className="text-xs text-muted mt-0.5">{data.description}</p>
              )}

              {data.type === 'send_email' && googleAccounts.length > 1 && (
                <div className="mt-2">
                  <label className="text-[10px] text-muted uppercase tracking-wider block mb-1">Send from</label>
                  <select
                    value={selectedAccount}
                    onChange={e => setSelectedAccount(e.target.value)}
                    className="w-full bg-bg border border-border rounded-lg px-2 py-1.5 text-xs text-text outline-none focus:border-brand transition-colors"
                  >
                    {googleAccounts.map(a => (
                      <option key={a.email} value={a.email}>{a.email}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <motion.button
                onClick={() => approve(data.title)}
                disabled={loading}
                whileHover={!loading ? { scale: 1.03, y: -1 } : {}}
                whileTap={!loading ? { scale: 0.97 } : {}}
                transition={springFast}
                className="btn-primary flex-1 text-white text-xs font-semibold py-2 rounded-lg disabled:opacity-50"
              >
                {loading ? (isConnectCard ? 'Redirecting...' : 'Saving...') : (isConnectCard ? 'Connect' : 'Approve')}
              </motion.button>
              {!isConnectCard && (
                <motion.button
                  onClick={() => {
                    setEditedTitle(isEmailType ? String(data.payload?.subject ?? data.title) : data.title);
                    setEditedBody(isEmailType ? String(data.payload?.body ?? '') : '');
                    setEditedProgress(pendingProgress);
                    setStatus('editing');
                  }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  transition={springFast}
                  className="flex-1 border border-border text-muted text-xs font-semibold py-2 rounded-lg hover:text-text hover:border-brand/50 transition-colors"
                >
                  Edit
                </motion.button>
              )}
              <motion.button
                onClick={() => setStatus('dismissed')}
                whileTap={{ scale: 0.97 }}
                transition={springFast}
                className="flex-1 bg-border text-muted text-xs font-semibold py-2 rounded-lg hover:text-text transition-colors"
              >
                Skip
              </motion.button>
            </div>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-xs text-red-400 mt-1"
              >
                {error}
              </motion.p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
