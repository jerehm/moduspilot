import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { DetailHeader } from '@/components/DetailHeader';
import { Icon, type IconName } from '@/components/Icon';
import { BrandLogo } from '@/components/BrandLogo';
import { useThemeColors } from '@/lib/theme';
import { useSheets } from '@/components/ui/Sheets';
import { haptics } from '@/lib/haptics';
import {
  fetchConnectorStatus, connectProvider, disconnectProvider,
  type ConnectorStatus, type ConnectorProvider,
} from '@/lib/api';
import {
  nativeAvailable,
  requestContactsPermission, getContactsPermissionStatus, getContacts,
  requestPhotosPermission, getPhotosPermissionStatus,
  initHealth, pickTextFile,
} from '@/lib/device';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { doc, writeBatch, setDoc, serverTimestamp } from 'firebase/firestore';

interface Row { label: string; sub: string; key: Record<string, string> }

const CLOUD_META: { provider: ConnectorProvider; name: string; icon: IconName; color: string; desc: string }[] = [
  { provider: 'google', name: 'Google', icon: 'mail-outline', color: '#ea4335', desc: 'Gmail, Calendar & Drive' },
  { provider: 'notion', name: 'Notion', icon: 'description', color: '#7c3aed', desc: 'Pages & databases' },
  { provider: 'slack', name: 'Slack', icon: 'tag', color: '#e01e5a', desc: 'Channels & messages' },
  { provider: 'github', name: 'GitHub', icon: 'code', color: '#6e7681', desc: 'Repos, issues & PRs' },
];

function rowsFor(p: ConnectorProvider, s: ConnectorStatus): Row[] {
  if (p === 'google') return s.google.map(a => ({ label: a.email, sub: 'Connected', key: { email: a.email } }));
  if (p === 'notion') return s.notion.map(a => ({ label: a.workspaceName || a.ownerEmail, sub: a.ownerEmail, key: { workspaceId: a.workspaceId } }));
  if (p === 'slack') return s.slack.map(a => ({ label: a.teamName, sub: 'Workspace', key: { teamId: a.teamId } }));
  return s.github.map(a => ({ label: a.name || a.login, sub: `@${a.login}`, key: { login: a.login } }));
}

type PermStatus = 'granted' | 'denied' | 'undetermined' | 'loading' | 'unavailable';

export default function ConnectorsScreen() {
  const c = useThemeColors();
  const { confirm } = useSheets();
  const { user } = useAuth();
  const [status, setStatus] = useState<ConnectorStatus | null>(null);
  const [busy, setBusy] = useState<ConnectorProvider | null>(null);

  // Device permission states
  const [contactsPerm, setContactsPerm] = useState<PermStatus>('loading');
  const [photosPerm, setPhotosPerm] = useState<PermStatus>('loading');
  const [healthPerm, setHealthPerm] = useState<PermStatus>('loading');

  const load = useCallback(async () => {
    try { setStatus(await fetchConnectorStatus()); } catch { /* keep last */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (nativeAvailable.contacts) {
      getContactsPermissionStatus().then(s => setContactsPerm(s));
    } else {
      setContactsPerm('unavailable');
    }
    if (nativeAvailable.photos) {
      getPhotosPermissionStatus().then(s => setPhotosPerm(s));
    } else {
      setPhotosPerm('unavailable');
    }
    if (nativeAvailable.health) {
      initHealth().then(ok => setHealthPerm(ok ? 'granted' : 'undetermined'));
    } else {
      setHealthPerm('unavailable');
    }
  }, []);

  // Write iOS permission status to Firestore so the web UI can display it accurately
  useEffect(() => {
    if (!user?.uid) return;
    if (contactsPerm === 'loading' || photosPerm === 'loading' || healthPerm === 'loading') return;
    setDoc(doc(db, 'users', user.uid), {
      mobilePermissions: { contacts: contactsPerm, health: healthPerm, photos: photosPerm },
    }, { merge: true }).catch(e => console.error('[permissions] write failed:', e));
  }, [contactsPerm, photosPerm, healthPerm, user?.uid]);

  // Sync contacts when BOTH permission is granted AND auth is ready (guards against race condition
  // where getContactsPermissionStatus resolves before onAuthStateChanged fires)
  useEffect(() => {
    if (contactsPerm === 'granted' && user?.uid) syncContactsToFirestore(user.uid);
  }, [contactsPerm, user?.uid]);

  async function connect(p: ConnectorProvider) {
    if (busy) return;
    haptics.medium();
    setBusy(p);
    try {
      const url = await connectProvider(p);
      await WebBrowser.openBrowserAsync(url);
      await load();
    } catch {
      Alert.alert('Connect failed', 'Could not start the connection. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(p: ConnectorProvider, name: string, key: Record<string, string>) {
    const ok = await confirm({ title: `Disconnect ${name}?`, message: 'MODUS will lose access to this account.', confirmLabel: 'Disconnect', destructive: true });
    if (!ok) return;
    haptics.select();
    try {
      await disconnectProvider(p, key);
      await load();
    } catch {
      Alert.alert('Disconnect failed', 'Please try again.');
    }
  }

  async function syncContactsToFirestore(uid: string) {
    try {
      const contacts = await getContacts();
      const BATCH_SIZE = 500;
      for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
        const chunk = contacts.slice(i, i + BATCH_SIZE);
        const batch = writeBatch(db);
        for (const c of chunk) {
          const ref = doc(db, 'users', uid, 'contacts', c.id);
          batch.set(ref, {
            name: c.name,
            ...(c.email ? { email: c.email } : {}),
            ...(c.phone ? { phone: c.phone } : {}),
            ...(c.company ? { company: c.company } : {}),
            ...(c.jobTitle ? { jobTitle: c.jobTitle } : {}),
            ...(c.birthday ? { birthday: c.birthday } : {}),
            source: 'device',
            updatedAt: serverTimestamp(),
          }, { merge: true });
        }
        await batch.commit();
      }
    } catch (e) {
      console.error('[contacts] sync failed:', e);
    }
  }

  async function grantContacts() {
    if (!nativeAvailable.contacts) return;
    haptics.medium();
    const granted = await requestContactsPermission();
    if (granted) {
      setContactsPerm('granted');
      haptics.success();
      if (user?.uid) syncContactsToFirestore(user.uid);
    } else {
      setContactsPerm('denied');
      Alert.alert('Permission denied', 'To enable contacts, go to Settings → MODUS → Contacts.', [
        { text: 'Open Settings', onPress: () => Linking.openURL('app-settings:') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }

  async function grantPhotos() {
    if (!nativeAvailable.photos) return;
    haptics.medium();
    const granted = await requestPhotosPermission();
    if (granted) {
      setPhotosPerm('granted');
      haptics.success();
    } else {
      setPhotosPerm('denied');
      Alert.alert('Permission denied', 'To enable photos, go to Settings → MODUS → Photos.', [
        { text: 'Open Settings', onPress: () => Linking.openURL('app-settings:') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }

  async function grantHealth() {
    if (!nativeAvailable.health) return;
    haptics.medium();
    const ok = await initHealth();
    if (ok) {
      setHealthPerm('granted');
      haptics.success();
    } else {
      setHealthPerm('denied');
      Alert.alert('Permission denied', 'To enable health data, go to Health app → Sharing → MODUS.', [
        { text: 'Open Health', onPress: () => Linking.openURL('x-apple-health://') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }

  async function shareFile() {
    haptics.medium();
    const file = await pickTextFile();
    if (!file) return;
    const preview = file.content.slice(0, 2000);
    const prompt = `I'm sharing a file with you: "${file.name}"\n\n${preview}${file.content.length > 2000 ? '\n\n[File truncated, ask me to share more if needed]' : ''}`;
    router.push({ pathname: '/(app)/(tabs)/chat', params: { prefill: prompt } });
  }

  function DeviceRow({
    icon, color, label, desc, perm, onGrant,
  }: {
    icon: IconName; color: string; label: string; desc: string;
    perm: PermStatus; onGrant: () => void;
  }) {
    return (
      <View className="flex-row items-center gap-3 px-4 py-4">
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: color + '22' }}>
          <Icon name={icon} size={18} color={color} />
        </View>
        <View className="flex-1">
          <Text className="text-text font-semibold text-[14px]">{label}</Text>
          <Text className="text-muted text-xs">{desc}</Text>
        </View>
        {perm === 'loading' ? (
          <ActivityIndicator color={c.muted} size="small" />
        ) : perm === 'granted' ? (
          <View className="flex-row items-center gap-1.5">
            <Icon name="check-circle" tone="brand" size={15} />
            <Text className="text-brand text-[12px] font-semibold">On</Text>
          </View>
        ) : perm === 'unavailable' ? (
          <View className="px-3 py-1.5 rounded-lg bg-border/50">
            <Text className="text-muted text-[12px] font-semibold">Needs build</Text>
          </View>
        ) : (
          <TouchableOpacity onPress={onGrant} activeOpacity={0.8} className="px-3 py-1.5 rounded-lg border border-brand/40 bg-brand/10">
            <Text className="text-brand text-[12px] font-semibold">Enable</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1" edges={['top']}>
      <DetailHeader title="Connectors" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 36 }} showsVerticalScrollIndicator={false}>
        {!status ? (
          <View className="items-center py-16"><ActivityIndicator color={c.brand} /></View>
        ) : (
          <View className="gap-5">
            {/* Cloud integrations — single unified list */}
            <View>
              <Text className="text-muted text-[11px] font-bold uppercase tracking-wider mb-2 px-1">Integrations</Text>
              <View className="bg-surface border border-border rounded-2xl overflow-hidden">
                {CLOUD_META.map((m, idx) => {
                  const rows = rowsFor(m.provider, status);
                  return (
                    <View key={m.provider}>
                      {idx > 0 && <View className="h-px bg-border" />}
                      <View className="flex-row items-center gap-3 px-4 py-3">
                        <View className="w-8 h-8 rounded-xl items-center justify-center border border-border/60" style={{ backgroundColor: m.color + '14' }}>
                          <BrandLogo provider={m.provider} size={18} />
                        </View>
                        <View className="flex-1">
                          <Text className="text-text font-semibold text-[14px]">{m.name}</Text>
                          <Text className="text-muted text-[11px]">{m.desc}</Text>
                        </View>
                        {rows.length > 0 && (
                          <View className="flex-row items-center gap-1 mr-2">
                            <View className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            <Text className="text-emerald-400 text-[11px] font-medium">{rows.length}</Text>
                          </View>
                        )}
                        <TouchableOpacity
                          onPress={() => connect(m.provider)}
                          disabled={!!busy}
                          activeOpacity={0.8}
                        >
                          {busy === m.provider
                            ? <ActivityIndicator color={c.brand} size="small" />
                            : <Text className="text-brand text-[12px] font-semibold">{rows.length ? '+ Add' : 'Connect'}</Text>
                          }
                        </TouchableOpacity>
                      </View>
                      {rows.map((r, i) => (
                        <View key={i} className="flex-row items-center gap-2.5 pl-11 pr-4 py-2 border-t border-border/50" style={{ backgroundColor: 'rgba(0,0,0,0.03)' }}>
                          <View className="w-5 h-5 rounded-full bg-emerald-400/15 items-center justify-center shrink-0">
                            <Icon name="check-circle" tone="brand" size={12} />
                          </View>
                          <View className="flex-1">
                            <Text className="text-text text-[12px] font-medium" numberOfLines={1}>{r.label}</Text>
                            <Text className="text-muted text-[10px]">{r.sub}</Text>
                          </View>
                          <TouchableOpacity onPress={() => disconnect(m.provider, m.name, r.key)} activeOpacity={0.7} hitSlop={10}>
                            <Text className="text-muted text-[11px]">Remove</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  );
                })}
              </View>
            </View>

            {/* On This Device */}
            <View>
              <Text className="text-muted text-[11px] font-bold uppercase tracking-wider mb-2 px-1">On This Device</Text>
              <View className="bg-surface border border-border rounded-2xl overflow-hidden">
                <DeviceRow
                  icon="people-outline"
                  color="#3b82f6"
                  label="Contacts"
                  desc="Relationship tracking & follow-up nudges"
                  perm={contactsPerm}
                  onGrant={grantContacts}
                />
                {contactsPerm === 'granted' && (
                  <TouchableOpacity
                    onPress={() => router.push('/(app)/contacts-manage' as never)}
                    activeOpacity={0.7}
                    className="flex-row items-center pl-11 pr-4 py-2.5 border-t border-border/50"
                    style={{ backgroundColor: 'rgba(0,0,0,0.03)' }}
                  >
                    <Text className="text-brand text-[12px] font-medium flex-1">Manage contacts & categories</Text>
                    <Icon name="chevron-right" size={14} color={c.brand} />
                  </TouchableOpacity>
                )}
                <View className="h-px bg-border" />
                <DeviceRow
                  icon="favorite-border"
                  color="#f43f5e"
                  label="Health"
                  desc="Steps & sleep in your morning briefing"
                  perm={healthPerm}
                  onGrant={grantHealth}
                />
                <View className="h-px bg-border" />
                <DeviceRow
                  icon="photo-library"
                  color="#f59e0b"
                  label="Photos"
                  desc="Attach & reference photos in chat"
                  perm={photosPerm}
                  onGrant={grantPhotos}
                />
                <View className="h-px bg-border" />
                <View className="flex-row items-center gap-3 px-4 py-3">
                  <View className="w-8 h-8 rounded-xl items-center justify-center border border-border/60" style={{ backgroundColor: '#10b98114' }}>
                    <Icon name="folder-open" size={16} color="#10b981" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-text font-semibold text-[14px]">Files & Notes</Text>
                    <Text className="text-muted text-[11px]">Share notes, docs, or any text file</Text>
                  </View>
                  {nativeAvailable.files ? (
                    <TouchableOpacity onPress={shareFile} activeOpacity={0.8}>
                      <Text className="text-brand text-[12px] font-semibold">Browse</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text className="text-muted text-[11px]">Needs build</Text>
                  )}
                </View>
              </View>
              <Text className="text-muted text-[11px] mt-2 px-1">Permissions managed in iOS Settings → MODUS.</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
