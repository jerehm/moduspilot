import { useState } from 'react';
import { View, Text, Pressable, Image, Linking } from 'react-native';
import { humanTool, summaryLine, type ToolCallRecord, type ToolMedia } from '@/lib/tool-activity';

/**
 * Mobile twin of web components/chat/ToolActivity.tsx: a one line summary of
 * what the tools did, expandable per call, with image results inline. Video and
 * audio open in the system player (no media package in this app).
 */

function Dot({ state }: { state: ToolCallRecord['state'] }) {
  const color = state === 'running' ? 'bg-brand' : state === 'error' ? 'bg-red-500' : 'bg-emerald-500';
  return <View className={`w-1.5 h-1.5 rounded-full ${color}`} />;
}

function Media({ media }: { media: ToolMedia[] }) {
  if (media.length === 0) return null;
  return (
    <View className="gap-2">
      {media.map((m, i) =>
        m.kind === 'image' ? (
          <Pressable key={i} onPress={() => { if (!m.url.startsWith('data:')) Linking.openURL(m.url).catch(() => {}); }}>
            <Image source={{ uri: m.url }} style={{ width: 240, height: 240, borderRadius: 12 }} resizeMode="cover" />
          </Pressable>
        ) : (
          <Pressable
            key={i}
            onPress={() => Linking.openURL(m.url).catch(() => {})}
            className="self-start px-3 py-2 rounded-xl border border-border bg-surface"
          >
            <Text className="text-brand text-xs font-medium">{m.kind === 'video' ? 'Play video' : 'Play audio'}</Text>
          </Pressable>
        ),
      )}
    </View>
  );
}

function Row({ call }: { call: ToolCallRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <View className="pl-3 border-l border-border gap-1.5">
      <Pressable onPress={() => setOpen(o => !o)} className="flex-row items-center gap-2" hitSlop={6}>
        <Dot state={call.state} />
        {call.server ? <Text className="text-text text-xs">{call.server}</Text> : null}
        <Text className="text-muted text-xs">{humanTool(call.tool)}</Text>
        {call.state === 'error' ? <Text className="text-red-500 text-xs">failed</Text> : null}
        {call.state === 'running' ? <Text className="text-muted text-xs">running</Text> : null}
      </Pressable>
      {open ? (
        <View className="gap-1.5">
          {call.args && call.args !== '{}' ? (
            <Text className="text-muted text-[11px] font-mono rounded-lg border border-border bg-surface px-2.5 py-2">{call.args}</Text>
          ) : null}
          {call.result ? (
            <Text className="text-text text-[11px] font-mono rounded-lg border border-border bg-surface px-2.5 py-2" numberOfLines={30}>{call.result}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function ToolActivity({ calls }: { calls: ToolCallRecord[] }) {
  const [open, setOpen] = useState(false);
  if (calls.length === 0) return null;
  const running = calls.some(c => c.state === 'running');
  return (
    <View className="gap-2 self-start">
      <Pressable onPress={() => setOpen(o => !o)} className="flex-row items-center gap-2 px-1" hitSlop={6}>
        {running ? <View className="w-1.5 h-1.5 rounded-full bg-brand" /> : null}
        <Text className="text-muted text-xs">{summaryLine(calls)} {open ? '⌄' : '›'}</Text>
      </Pressable>
      {open ? <View className="gap-2 px-1">{calls.map(c => <Row key={c.id} call={c} />)}</View> : null}
      <Media media={calls.flatMap(c => c.media)} />
    </View>
  );
}
