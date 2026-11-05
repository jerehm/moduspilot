import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DetailHeader } from '@/components/DetailHeader';
import { Icon } from '@/components/Icon';
import { useSheets } from '@/components/ui/Sheets';
import { useThemeColors } from '@/lib/theme';
import {
  currentUid, currentEmail, currentName, callGroup,
  subscribeUserGroup, subscribeGroup, subscribeMembers, subscribeMyInvites,
  subscribeSentInvites, subscribeShared, setAvailabilitySharing, addSharedItem, removeSharedItem,
  type GroupMember, type GroupInvite, type SharedItem,
} from '@/lib/group';

export default function GroupScreen() {
  const c = useThemeColors();
  const { prompt, confirm } = useSheets();
  const uid = currentUid();
  const email = currentEmail();

  const [groupId, setGroupId] = useState<string | null | undefined>(undefined);
  const [plan, setPlan] = useState<string>('free');
  const [groupName, setGroupName] = useState('Group');
  const [ownerUid, setOwnerUid] = useState<string | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [myInvites, setMyInvites] = useState<GroupInvite[]>([]);
  const [sentInvites, setSentInvites] = useState<GroupInvite[]>([]);
  const [shared, setShared] = useState<SharedItem[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (uid) return subscribeUserGroup(uid, (g, p) => { setGroupId(g); setPlan(p); }); }, [uid]);
  useEffect(() => {
    if (!groupId) { setMembers([]); setOwnerUid(null); setShared([]); return; }
    const unsubs = [
      subscribeGroup(groupId, g => { setGroupName(g.name); setOwnerUid(g.ownerUid); }),
      subscribeMembers(groupId, setMembers),
      subscribeShared(groupId, setShared),
    ];
    return () => unsubs.forEach(u => u());
  }, [groupId]);
  useEffect(() => { if (email) return subscribeMyInvites(email, setMyInvites); }, [email]);
  useEffect(() => { if (uid && groupId) return subscribeSentInvites(uid, setSentInvites); else setSentInvites([]); }, [uid, groupId]);

  const isOwner = ownerUid === uid;
  const me = members.find(m => m.uid === uid);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch (e) { Alert.alert('Group', e instanceof Error ? e.message : 'Something went wrong'); }
    finally { setBusy(false); }
  }

  const createGroup = () => run(async () => {
    const name = await prompt({ title: 'Start a group', message: 'Name your group (e.g. Acme founders).', confirmLabel: 'Create' });
    if (name?.trim()) await callGroup('create', { name: name.trim() });
  });
  const invite = () => run(async () => {
    const e = await prompt({ title: 'Invite someone', message: 'Their email address.', confirmLabel: 'Invite' });
    if (e?.trim()) await callGroup('invite', { email: e.trim() });
  });
  const accept = (inviteId: string) => run(async () => { await callGroup('accept', { inviteId }); });
  const leave = () => run(async () => {
    const ok = await confirm({ title: 'Leave group?', message: 'You can be re-invited later.', confirmLabel: 'Leave', destructive: true });
    if (ok) await callGroup('leave');
  });
  const disband = () => run(async () => {
    const ok = await confirm({ title: 'Disband group?', message: 'This removes the group for everyone.', confirmLabel: 'Disband', destructive: true });
    if (ok) await callGroup('delete');
  });
  const addShared = () => run(async () => {
    if (!groupId || !uid) return;
    const text = await prompt({ title: 'Group space', message: 'Add a trip, plan, or link the group should see.', multiline: true, confirmLabel: 'Add' });
    if (text?.trim()) await addSharedItem(groupId, uid, currentName(), text.trim());
  });
  const removeShared = (id: string) => { if (groupId) removeSharedItem(groupId, id).catch(() => {}); };
  const toggleSharing = (next: boolean) => { if (groupId && uid) setAvailabilitySharing(groupId, uid, next).catch(() => {}); };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <DetailHeader title="Group" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>

        {/* Invites addressed to me */}
        {!groupId && myInvites.map(inv => (
          <View key={inv.id} className="bg-surface border border-brand rounded-xl p-4 gap-3">
            <Text className="text-text text-[15px]">
              <Text className="font-semibold">{inv.invitedByName ?? 'Someone'}</Text> invited you to join{' '}
              <Text className="font-semibold">{inv.groupName}</Text>.
            </Text>
            <TouchableOpacity onPress={() => accept(inv.id)} disabled={busy}
              className="bg-brand rounded-lg py-2.5 items-center">
              <Text className="text-white font-semibold text-[15px]">Join group</Text>
            </TouchableOpacity>
          </View>
        ))}

        {groupId === undefined && <ActivityIndicator color={c.brand} style={{ marginTop: 24 }} />}

        {/* No group, on Group plan → create */}
        {groupId === null && plan === 'group' && (
          <View className="bg-surface border border-border rounded-xl p-5 gap-2">
            <Text className="text-text text-base font-semibold">Start a group</Text>
            <Text className="text-muted text-[13px]">Create a group, then invite up to 4 people. Each gets their own private MODUS.</Text>
            <TouchableOpacity onPress={createGroup} disabled={busy} className="bg-brand rounded-lg py-3 items-center mt-2">
              <Text className="text-white font-semibold text-[15px]">Create group</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* No group, not on Group plan. Group has no Stripe price and was pulled
            from customer surfaces, so the old $79 upgrade card always 400'd. */}
        {groupId === null && plan !== 'group' && myInvites.length === 0 && (
          <View className="bg-surface border border-border rounded-xl p-5 gap-2">
            <Text className="text-text text-base font-semibold">Group plans are not open yet.</Text>
            <Text className="text-muted text-[13px]">If someone invites you to their group, the invite shows up here.</Text>
          </View>
        )}

        {/* In a group */}
        {groupId && (
          <>
            <View className="bg-surface border border-border rounded-xl overflow-hidden">
              <View className="px-4 py-3 border-b border-border flex-row items-center justify-between">
                <Text className="text-text text-base font-semibold">{groupName}</Text>
                <Text className="text-muted text-xs">{members.length} / 5</Text>
              </View>
              {members.map((m, i) => (
                <View key={m.uid} className={`px-4 py-3 flex-row items-center gap-3 ${i > 0 ? 'border-t border-border' : ''}`}>
                  <View className="w-8 h-8 rounded-full items-center justify-center" style={{ backgroundColor: c.brand + '26' }}>
                    <Text className="text-[13px] font-semibold" style={{ color: c.brand }}>{(m.displayName || m.email || '?')[0]?.toUpperCase()}</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-text text-[14px]">{m.displayName || m.email}{m.uid === uid ? ' (you)' : ''}</Text>
                    {!!m.email && <Text className="text-muted text-[11px]">{m.email}</Text>}
                  </View>
                  {m.role === 'owner' && <Text className="text-[10px] font-semibold tracking-wider" style={{ color: c.brand }}>OWNER</Text>}
                </View>
              ))}
            </View>

            {/* Group space */}
            <View className="bg-surface border border-border rounded-xl overflow-hidden">
              <View className="px-4 py-3 border-b border-border flex-row items-center justify-between">
                <Text className="text-text text-base font-semibold">Group space</Text>
                <TouchableOpacity onPress={addShared}><Icon name="add" tone="brand" size={20} /></TouchableOpacity>
              </View>
              {shared.length === 0 ? (
                <Text className="text-muted text-[13px] px-4 py-4">Nothing here yet, add a trip or plan.</Text>
              ) : shared.map((s, i) => (
                <View key={s.id} className={`px-4 py-3 flex-row items-start gap-2.5 ${i > 0 ? 'border-t border-border' : ''}`}>
                  <View className="flex-1">
                    <Text className="text-text text-[14px]">{s.text}</Text>
                    {!!s.authorName && <Text className="text-muted text-[11px] mt-0.5">{s.authorName}</Text>}
                  </View>
                  <TouchableOpacity onPress={() => removeShared(s.id)}><Icon name="close" tone="muted" size={16} /></TouchableOpacity>
                </View>
              ))}
            </View>

            {/* Availability sharing */}
            <View className="bg-surface border border-border rounded-xl p-4 flex-row items-center gap-3">
              <View className="flex-1">
                <Text className="text-text text-[15px] font-medium">Share my availability</Text>
                <Text className="text-muted text-xs mt-0.5">Lets the group ask your MODUS when you’re free. Nothing else is shared.</Text>
              </View>
              <Switch value={me?.sharing?.availability ?? false} onValueChange={toggleSharing} trackColor={{ true: c.brand }} />
            </View>

            {/* Invite (owner) */}
            {isOwner && members.length < 5 && (
              <View className="bg-surface border border-border rounded-xl p-4 gap-3">
                <View className="flex-row items-center justify-between">
                  <Text className="text-text text-[15px] font-medium">Invite someone</Text>
                  <TouchableOpacity onPress={invite} disabled={busy} className="bg-brand rounded-lg px-4 py-2">
                    <Text className="text-white font-semibold text-[13px]">Invite</Text>
                  </TouchableOpacity>
                </View>
                {sentInvites.map(inv => (
                  <Text key={inv.id} className="text-muted text-[12px]">• {inv.email}, pending</Text>
                ))}
              </View>
            )}

            {/* Leave / disband */}
            <TouchableOpacity onPress={isOwner ? disband : leave} disabled={busy} className="py-2">
              <Text className="text-red-500 text-[14px]">{isOwner ? 'Disband group' : 'Leave group'}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
