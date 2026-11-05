import { Linking } from 'react-native';
import { API_BASE, getAuthHeader } from './api';

/**
 * Approval cards — mirrors the web chat flow. The assistant emits a fenced
 * ```approval JSON block; we parse it out of the streamed text and render an
 * interactive card. Approving POSTs to the same /api/approval endpoint the web
 * app uses (server writes to Firestore), so goals/tasks/habits/etc. stay in sync.
 */

export interface ApprovalData {
  type: string;
  title: string;
  description: string;
  payload: Record<string, unknown>;
}

export const TYPE_LABELS: Record<string, string> = {
  create_project: 'New Project',
  create_goal: 'New Goal',
  create_task: 'New Task',
  create_habit: 'New Habit',
  schedule_event: 'Schedule Event',
  draft_email: 'Draft Email',
  update_goal: 'Update Goal',
  update_goal_progress: 'Goal Progress',
  update_task: 'Update Task',
  update_habit: 'Update Habit',
  delete_task: 'Delete Task',
  delete_habit: 'Delete Habit',
  delete_goal: 'Delete Goal',
  connect_google: 'Connect Google',
  connect_notion: 'Connect Notion',
  connect_slack: 'Connect Slack',
  connect_github: 'Connect GitHub',
  enable_web_search: 'Enable Web Search',
  send_email: 'Send Email',
};

const CONNECT_ENDPOINTS: Record<string, string> = {
  connect_google: '/api/auth/google/connect',
  connect_notion: '/api/auth/notion/connect',
  connect_slack: '/api/auth/slack/connect',
  connect_github: '/api/auth/github/connect',
};

export const CONNECT_TYPES = new Set(Object.keys(CONNECT_ENDPOINTS));

export type ChatPart =
  | { type: 'text'; value: string }
  | { type: 'approval'; value: string }
  | { type: 'draft_options'; value: string }
  | { type: 'image'; value: string }
  | { type: 'document'; value: string }
  | { type: 'chart'; value: string };

// Matches every special block type the assistant emits (mirrors web).
const BLOCK_RE = /```(approval|draft_options|image|document|chart)\n([\s\S]*?)```/g;

/** Split assistant content into text + interactive-card parts (post-stream). */
export function parseApprovalParts(content: string): ChatPart[] {
  const parts: ChatPart[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  BLOCK_RE.lastIndex = 0;
  while ((match = BLOCK_RE.exec(content)) !== null) {
    if (match.index > last) parts.push({ type: 'text', value: content.slice(last, match.index) });
    parts.push({ type: match[1] as ChatPart['type'], value: match[2].trim() });
    last = match.index + match[0].length;
  }
  if (last < content.length) parts.push({ type: 'text', value: content.slice(last) });
  return parts;
}

/** Remove interactive blocks (complete or still-streaming) from text for display. */
export function stripApprovalBlocks(content: string): string {
  return content
    .replace(/```(approval|draft_options|image|document|chart)[\s\S]*?```/g, '')
    .replace(/```(approval|draft_options|image|document|chart)[\s\S]*$/g, '')
    .trimEnd();
}

export function hasApprovalBlock(content: string): boolean {
  return content.includes('```approval') || content.includes('```draft_options')
    || content.includes('```image') || content.includes('```document')
    || content.includes('```chart');
}

/**
 * Execute an approval. Connect types open the OAuth URL in the browser;
 * everything else POSTs to /api/approval which writes to Firestore. Throws on
 * failure with a user-facing message.
 */
export async function submitApproval(
  data: ApprovalData,
  titleOverride?: string,
  payloadOverride?: Record<string, unknown>,
): Promise<void> {
  const headers = await getAuthHeader();

  if (CONNECT_TYPES.has(data.type)) {
    const res = await fetch(`${API_BASE}${CONNECT_ENDPOINTS[data.type]}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(data.type === 'connect_google' ? {} : { origin: 'chat' }),
    });
    if (!res.ok) throw new Error('Failed to start connection.');
    const { url } = await res.json();
    if (url) Linking.openURL(url).catch(() => {});
    return;
  }

  // Match web: prefer an explicit payload, else treat leftover top-level keys as payload.
  const basePayload =
    data.payload && Object.keys(data.payload).length > 0
      ? data.payload
      : Object.fromEntries(
          Object.entries(data).filter(([k]) => !['type', 'title', 'description'].includes(k)),
        );
  const payload = { ...basePayload, ...(payloadOverride ?? {}) };

  const res = await fetch(`${API_BASE}/api/approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      type: data.type,
      title: titleOverride ?? data.title,
      description: data.description,
      payload,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? 'Something went wrong. Try again.');
  }
}

/** Short confirmation message appended after a successful approval (mirrors web). */
export function buildFollowUpMessage(
  type: string,
  title: string,
  payload: Record<string, unknown>,
): string | null {
  switch (type) {
    case 'create_project':
      return `Created the project "${title}".`;
    case 'create_task': {
      const due = payload.dueDate as string | undefined;
      const pr = payload.priority as string | undefined;
      let msg = `Added "${title}" to your tasks.`;
      if (due) msg += ` Due ${due}.`;
      if (pr) msg += ` Marked as ${pr} priority.`;
      return msg;
    }
    case 'create_goal': {
      const due = payload.dueDate as string | undefined;
      let msg = `Goal set: "${title}".`;
      if (due) msg += ` Targeting ${due}.`;
      return msg + ` Progress starts at 0%, I'll track it as you go.`;
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
    case 'send_email': {
      const to = payload.to as string | undefined;
      return `Email sent${to ? ` to ${to}` : ''}.`;
    }
    case 'update_goal_progress': {
      const progress = payload.progress as number | undefined;
      return progress !== undefined
        ? `Updated "${title}" to ${progress}% complete.`
        : `Updated "${title}".`;
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
