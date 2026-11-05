import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { Icon } from '@/components/Icon';
import { useThemeColors } from '@/lib/theme';
import { haptics } from '@/lib/haptics';
import {
  ApprovalData,
  TYPE_LABELS,
  CONNECT_TYPES,
  submitApproval,
  buildFollowUpMessage,
} from '@/lib/approval';

type Status = 'pending' | 'editing' | 'approved' | 'dismissed';

/**
 * Interactive approval card. Parses the raw ```approval JSON and lets the user
 * Approve / Edit / Skip. Approving calls submitApproval (writes to Firestore via
 * /api/approval); onFollowUp appends a confirmation line to the chat.
 */
export function ApprovalCard({
  raw,
  onFollowUp,
}: {
  raw: string;
  onFollowUp?: (text: string) => void;
}) {
  const c = useThemeColors();
  const data = useMemo<ApprovalData | null>(() => {
    try {
      const parsed = JSON.parse(raw);
      // null, a bare string or a non-string field parsed fine and then crashed
      // the render (data.type.replace, an object rendered as a Text child).
      if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') return null;
      const text = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
      return {
        type: parsed.type,
        title: text(parsed.title),
        description: text(parsed.description),
        payload: parsed.payload && typeof parsed.payload === 'object' && !Array.isArray(parsed.payload) ? parsed.payload : {},
      };
    } catch {
      return null;
    }
  }, [raw]);

  const initialProgress =
    data && typeof data.payload?.progress === 'number' ? (data.payload.progress as number) : 0;

  const [status, setStatus] = useState<Status>('pending');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editedTitle, setEditedTitle] = useState(data?.title ?? '');
  const [editedProgress, setEditedProgress] = useState(initialProgress);
  const [editedBody, setEditedBody] = useState(data?.payload?.body ? String(data.payload.body) : '');

  if (!data || !data.type) return null;

  const isProgress = data.type === 'update_goal_progress';
  const isConnect = CONNECT_TYPES.has(data.type);
  const isEmail = data.type === 'send_email' || data.type === 'draft_email';
  const label = TYPE_LABELS[data.type] ?? data.type.replace(/_/g, ' ');

  async function approve(title: string, overridePayload?: Record<string, unknown>) {
    if (!data) return;
    setLoading(true);
    setError('');
    try {
      await submitApproval(data, title, overridePayload);
      haptics.success();
      setStatus('approved');
      if (!isConnect) {
        const merged = { ...data.payload, ...(overridePayload ?? {}) };
        const followUp = buildFollowUpMessage(data.type, title, merged);
        if (followUp) onFollowUp?.(followUp);
      }
    } catch (e) {
      setError((e as Error)?.message ?? 'Network error. Try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Approved ───────────────────────────────────────────────────────────────
  if (status === 'approved') {
    const confirmed = isConnect
      ? 'Opening connection…'
      : data.type === 'send_email'
        ? 'Email sent'
        : `${editedTitle || data.title}, done`;
    return (
      <View className="border border-brand/30 bg-brand/5 rounded-2xl px-4 py-3 flex-row items-center gap-2">
        <Icon name="check-circle" tone="brand" size={18} />
        <Text className="text-brand text-sm flex-1" numberOfLines={2}>{confirmed}</Text>
      </View>
    );
  }

  // ── Dismissed ──────────────────────────────────────────────────────────────
  if (status === 'dismissed') {
    return (
      <View className="border border-border rounded-2xl px-4 py-3">
        <Text className="text-muted text-sm line-through" numberOfLines={1}>{data.title}</Text>
      </View>
    );
  }

  // ── Editing ────────────────────────────────────────────────────────────────
  if (status === 'editing') {
    return (
      <View className="border border-border bg-surface rounded-2xl px-4 py-4 gap-3">
        <Text className="text-muted text-[11px] uppercase tracking-wider">{label}</Text>
        {isProgress ? (
          <View className="gap-2">
            <Text className="text-text font-semibold text-base">{data.title}</Text>
            <View className="flex-row items-center justify-between">
              <TouchableOpacity
                onPress={() => setEditedProgress(p => Math.max(0, p - 10))}
                className="w-10 h-10 rounded-xl bg-surface-2 border border-border items-center justify-center"
              >
                <Icon name="remove" tone="text" size={20} />
              </TouchableOpacity>
              <Text className="text-brand font-bold text-lg">{editedProgress}%</Text>
              <TouchableOpacity
                onPress={() => setEditedProgress(p => Math.min(100, p + 10))}
                className="w-10 h-10 rounded-xl bg-surface-2 border border-border items-center justify-center"
              >
                <Icon name="add" tone="text" size={20} />
              </TouchableOpacity>
            </View>
            <View className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
              <View className="h-full bg-brand rounded-full" style={{ width: `${editedProgress}%` }} />
            </View>
          </View>
        ) : isEmail ? (
          <View className="gap-2">
            <TextInput
              value={editedTitle}
              onChangeText={setEditedTitle}
              placeholder="Subject"
              placeholderTextColor={c.muted}
              className="bg-surface-2 border border-border rounded-xl px-3 py-2.5 text-text text-base"
            />
            <TextInput
              value={editedBody}
              onChangeText={setEditedBody}
              autoFocus
              multiline
              placeholder="Message"
              placeholderTextColor={c.muted}
              textAlignVertical="top"
              className="bg-surface-2 border border-border rounded-xl px-3 py-2.5 text-text text-sm leading-relaxed min-h-[140px]"
            />
          </View>
        ) : (
          <TextInput
            value={editedTitle}
            onChangeText={setEditedTitle}
            autoFocus
            placeholder="Title"
            placeholderTextColor={c.muted}
            className="bg-surface-2 border border-border rounded-xl px-3 py-2.5 text-text text-base"
          />
        )}
        <View className="flex-row gap-2">
          <TouchableOpacity
            disabled={loading || (!isProgress && !editedTitle.trim()) || (isEmail && !editedBody.trim())}
            onPress={() =>
              isProgress
                ? approve(data.title, { progress: editedProgress })
                : isEmail
                  ? approve(editedTitle, { subject: editedTitle, body: editedBody })
                  : approve(editedTitle)
            }
            className="flex-1 bg-brand rounded-xl py-2.5 items-center"
            style={{ opacity: loading || (!isProgress && !editedTitle.trim()) || (isEmail && !editedBody.trim()) ? 0.5 : 1 }}
          >
            {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text className="text-white font-semibold text-sm">Confirm</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStatus('pending')} className="px-4 bg-surface-2 border border-border rounded-xl py-2.5 items-center justify-center">
            <Text className="text-muted font-semibold text-sm">Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Pending ────────────────────────────────────────────────────────────────
  const emailTo = data.payload?.to ? String(data.payload.to) : null;
  const emailSubject = data.payload?.subject ? String(data.payload.subject) : data.title;
  const emailBody = data.payload?.body ? String(data.payload.body) : null;

  return (
    <View className="border border-brand/20 bg-surface rounded-2xl px-4 py-4 gap-3">
      <View>
        <Text className="text-muted text-[11px] uppercase tracking-wider mb-1">{label}</Text>
        <Text className="text-text font-semibold text-base">{data.title}</Text>

        {isProgress ? (
          <View className="mt-2 gap-1.5">
            <View className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
              <View className="h-full bg-brand rounded-full" style={{ width: `${initialProgress}%` }} />
            </View>
            <Text className="text-muted text-xs">{initialProgress}% complete</Text>
          </View>
        ) : isEmail ? (
          <View className="mt-2 gap-1">
            {emailTo && <Text className="text-muted text-xs"><Text className="text-text/60">To: </Text>{emailTo}</Text>}
            {emailSubject && <Text className="text-muted text-xs"><Text className="text-text/60">Subject: </Text>{emailSubject}</Text>}
            {emailBody && (
              <View className="mt-2 bg-surface-2 border border-border rounded-xl p-2.5">
                <Text className="text-text/80 text-xs" numberOfLines={8}>{emailBody}</Text>
              </View>
            )}
          </View>
        ) : data.description ? (
          <Text className="text-muted text-xs mt-0.5">{data.description}</Text>
        ) : null}
      </View>

      <View className="flex-row gap-2">
        <TouchableOpacity
          disabled={loading}
          onPress={() => approve(data.title)}
          className="flex-1 bg-brand rounded-xl py-2.5 items-center"
          style={{ opacity: loading ? 0.5 : 1 }}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text className="text-white font-semibold text-sm">{isConnect ? 'Connect' : 'Approve'}</Text>
          )}
        </TouchableOpacity>
        {!isConnect && (
          <TouchableOpacity
            onPress={() => {
              setEditedTitle(isEmail ? (data.payload?.subject ? String(data.payload.subject) : data.title) : data.title);
              setEditedBody(isEmail ? (data.payload?.body ? String(data.payload.body) : '') : '');
              setEditedProgress(initialProgress);
              setStatus('editing');
            }}
            className="flex-1 border border-border rounded-xl py-2.5 items-center"
          >
            <Text className="text-muted font-semibold text-sm">Edit</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={() => { haptics.light(); setStatus('dismissed'); }}
          className="flex-1 bg-surface-2 border border-border rounded-xl py-2.5 items-center"
        >
          <Text className="text-muted font-semibold text-sm">Skip</Text>
        </TouchableOpacity>
      </View>

      {error ? <Text className="text-red-400 text-xs">{error}</Text> : null}
    </View>
  );
}
