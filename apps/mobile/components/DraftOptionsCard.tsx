import { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { useThemeColors } from '@/lib/theme';
import { haptics } from '@/lib/haptics';

interface DraftOption { label: string; detail: string }
interface DraftOptionsPayload {
  from?: string;
  subject?: string;
  preview?: string;
  options: DraftOption[];
}

/**
 * Reply-style chooser the assistant emits as a ```draft_options block (mirrors
 * the web). Picking a style (or a custom direction) sends a follow-up message
 * asking MODUS to write the full draft. Flat refined-brand styling.
 */
export function DraftOptionsCard({ raw, onSend }: { raw: string; onSend: (text: string) => void }) {
  const c = useThemeColors();
  const [selected, setSelected] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submittedLabel, setSubmittedLabel] = useState('');

  let data: DraftOptionsPayload;
  try { data = JSON.parse(raw); } catch { return null; }
  // JSON.parse("null") succeeds, and data.options then threw.
  if (!data || typeof data !== 'object') return null;
  const options = (Array.isArray(data.options) ? data.options : [])
    .filter(o => o && typeof o === 'object' && typeof o.label === 'string');
  const isCustom = selected === options.length;
  const canSubmit = selected !== null && (!isCustom || custom.trim().length > 0);

  function generate() {
    if (!canSubmit) return;
    haptics.medium();
    const direction = isCustom ? custom.trim() : `${options[selected!].label}, ${options[selected!].detail}`;
    setSubmittedLabel(isCustom ? custom.trim() : options[selected!].label);
    setSubmitted(true);
    const ctx = data.from ? ` to ${data.from}` : '';
    onSend(`Draft my reply${ctx} using this direction: ${direction}. Write the full email body now.`);
  }

  if (submitted) {
    return (
      <View className="border border-brand/25 bg-brand/5 rounded-xl px-4 py-3 flex-row items-center gap-2.5 self-start">
        <View className="w-1.5 h-1.5 rounded-full bg-brand" />
        <Text className="text-muted text-sm">
          Drafting with: <Text className="text-text font-medium">{submittedLabel}</Text>
        </Text>
      </View>
    );
  }

  function Radio({ on }: { on: boolean }) {
    return (
      <View className={`mt-0.5 w-4 h-4 rounded-full border-2 items-center justify-center ${on ? 'border-brand' : 'border-border'}`}>
        {on ? <View className="w-1.5 h-1.5 rounded-full bg-brand" /> : null}
      </View>
    );
  }

  return (
    <View className="border border-border bg-surface rounded-xl overflow-hidden self-start w-full">
      {/* Header */}
      <View className="px-4 pt-3.5 pb-3 border-b border-border">
        <Text className="text-brand text-[10px] font-bold uppercase tracking-widest mb-1">How do you want to reply?</Text>
        {(data.from || data.subject) ? (
          <Text className="text-muted text-xs" numberOfLines={1}>
            {data.from ? <Text className="text-text font-medium">{data.from}</Text> : null}
            {data.from && data.subject ? ' · ' : ''}
            {data.subject ?? ''}
          </Text>
        ) : null}
        {data.preview ? (
          <Text className="text-muted text-[11px] italic mt-1 leading-4" numberOfLines={2}>"{data.preview}"</Text>
        ) : null}
      </View>

      {/* Options */}
      <View className="p-3 gap-2">
        {options.map((opt, i) => (
          <TouchableOpacity
            key={i}
            activeOpacity={0.8}
            onPress={() => { haptics.select(); setSelected(i); }}
            className={`px-3.5 py-3 rounded-xl border flex-row items-start gap-2.5 ${selected === i ? 'border-brand bg-brand/10' : 'border-border bg-surface-2'}`}
          >
            <Radio on={selected === i} />
            <View className="flex-1">
              <Text className="text-text text-sm font-semibold mb-0.5">{opt.label}</Text>
              <Text className="text-muted text-xs leading-5">{opt.detail}</Text>
            </View>
          </TouchableOpacity>
        ))}

        {/* Custom direction */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => { haptics.select(); setSelected(options.length); }}
          className={`px-3.5 py-3 rounded-xl border flex-row items-start gap-2.5 ${isCustom ? 'border-brand bg-brand/10' : 'border-border bg-surface-2'}`}
        >
          <Radio on={isCustom} />
          <View className="flex-1">
            <Text className="text-text text-sm font-semibold mb-0.5">Specify your own direction</Text>
            {isCustom ? (
              <TextInput
                value={custom}
                onChangeText={setCustom}
                placeholder="e.g. Warm but professional, mention the meeting…"
                placeholderTextColor={c.muted}
                multiline
                className="mt-1.5 bg-bg border border-border rounded-lg px-2.5 py-2 text-text text-xs"
                style={{ minHeight: 52 }}
              />
            ) : (
              <Text className="text-muted text-xs">Write your own tone or instructions</Text>
            )}
          </View>
        </TouchableOpacity>
      </View>

      {/* Action */}
      <View className="px-3 pb-3">
        <TouchableOpacity
          onPress={generate}
          disabled={!canSubmit}
          activeOpacity={0.85}
          className="py-3 rounded-xl items-center bg-brand"
          style={{ opacity: canSubmit ? 1 : 0.4 }}
        >
          <Text className="text-white font-semibold text-sm">Generate draft</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
