import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { API_BASE, getAuthHeader } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { DetailHeader } from '@/components/DetailHeader';
import { Icon } from '@/components/Icon';
import { useSheets } from '@/components/ui/Sheets';
import { useThemeColors } from '@/lib/theme';
import { haptics } from '@/lib/haptics';

type McpTransport = 'sse' | 'http';

interface McpServer {
  id: string;
  name: string;
  url: string;
  authHeader?: string;
  transport: McpTransport;
}

// Mirrors apps/web/lib/plugin-directory.ts (mobile can't import from apps/web).
type PluginTemplate = {
  id: string; name: string; description: string;
  transport: McpTransport; url?: string; tokenless?: boolean;
  authLabel?: string; authPlaceholder?: string; docsUrl?: string;
};

const PLUGIN_DIRECTORY: PluginTemplate[] = [
  { id: 'deepwiki', name: 'DeepWiki', description: 'Ask questions about any public GitHub repo, its code and docs.', transport: 'http', url: 'https://mcp.deepwiki.com/mcp', tokenless: true },
  { id: 'gitmcp', name: 'GitMCP', description: 'Docs & code search for popular open-source libraries.', transport: 'http', url: 'https://gitmcp.io/docs', tokenless: true },
  { id: 'mslearn', name: 'Microsoft Learn', description: 'Search official Microsoft, Azure, and .NET docs.', transport: 'http', url: 'https://learn.microsoft.com/api/mcp', tokenless: true },
  { id: 'custom', name: 'Custom server', description: 'Connect any MCP server, paste its endpoint and an optional token.', transport: 'http' },
];

/**
 * Add/remove go through the web API, like the web settings page. Writing
 * Firestore directly skipped the paid-only check (MCP is MODUS and PILOT only),
 * the 10 server cap, the URL safety check and the server cache reset, so a Free
 * user could add a connector that then silently never ran.
 */
async function mcpApi(path: 'add' | 'remove', body: unknown): Promise<void> {
  const headers = { 'Content-Type': 'application/json', ...(await getAuthHeader()) };
  const res = await fetch(`${API_BASE}/api/mcp/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data.error === 'string' ? data.error : `Request failed (${res.status})`);
  }
}

export default function McpServersScreen() {
  const { user } = useAuth();
  const c = useThemeColors();
  const { prompt, confirm } = useSheets();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [authHeader, setAuthHeader] = useState('');
  const [transport, setTransport] = useState<McpTransport>('http');
  const [saving, setSaving] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'users', user.uid, 'mcpServers'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, snap => {
      setServers(snap.docs.map(d => ({
        id: d.id,
        name: d.data().name ?? 'Unnamed',
        url: d.data().url ?? '',
        authHeader: d.data().authHeader ?? undefined,
        transport: (d.data().transport as McpTransport) ?? 'sse',
      })));
    }, () => {});
  }, [user]);

  // Test the server the same way web does (/api/mcp/test) so users can confirm it
  // connects and see its tool count before saving, instead of adding blind.
  async function testConnection() {
    if (!url.trim() || testing) return;
    setTesting(true); setTestMsg(null);
    try {
      const headers = { 'Content-Type': 'application/json', ...(await getAuthHeader()) };
      const res = await fetch(`${API_BASE}/api/mcp/test`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: url.trim(), authHeader: authHeader.trim() || undefined, transport }),
      });
      const data = await res.json().catch(() => ({} as { ok?: boolean; tools?: string[]; error?: string }));
      if (res.ok && data.ok) {
        const n = Array.isArray(data.tools) ? data.tools.length : 0;
        setTestMsg({ ok: true, text: `Connected, ${n} tool${n === 1 ? '' : 's'} available` });
        haptics.success();
      } else {
        setTestMsg({ ok: false, text: data.error || `Connection failed (${res.status})` });
      }
    } catch {
      setTestMsg({ ok: false, text: 'Connection failed, check the URL and your network.' });
    } finally { setTesting(false); }
  }

  async function saveServer() {
    if (!user || !name.trim() || !url.trim()) return;
    setSaving(true);
    try {
      await mcpApi('add', { name: name.trim(), url: url.trim(), authHeader: authHeader.trim() || undefined, transport });
      haptics.medium();
      setName(''); setUrl(''); setAuthHeader(''); setTransport('http'); setAdding(false); setTestMsg(null);
    } catch (e) {
      setTestMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not add this plugin.' });
    } finally { setSaving(false); }
  }

  function chooseTemplate(t: PluginTemplate) {
    if (t.tokenless && t.url) { addFromTemplate(t); return; }
    setName(t.id === 'custom' ? '' : t.name);
    setUrl(t.url ?? '');
    setAuthHeader('');
    setTransport(t.transport);
    setAdding(true);
  }

  async function addFromTemplate(t: PluginTemplate) {
    if (!user || !t.url || servers.some(s => s.url === t.url)) return;
    setAddingId(t.id);
    try {
      await mcpApi('add', { name: t.name, url: t.url, transport: t.transport });
      haptics.medium();
    } catch (e) {
      Alert.alert('Plugins', e instanceof Error ? e.message : 'Could not add this plugin.');
    } finally { setAddingId(null); }
  }

  async function removeServer(server: McpServer) {
    if (!user) return;
    const ok = await confirm({ title: `Remove "${server.name}"?`, message: 'This plugin will no longer be available in MODUS.', confirmLabel: 'Remove', destructive: true });
    if (ok) mcpApi('remove', { serverId: server.id }).catch(e => Alert.alert('Plugins', e instanceof Error ? e.message : 'Could not remove this plugin.'));
  }

  return (
    <SafeAreaView className="flex-1" edges={['top']}>
      <DetailHeader
        title="Plugins"
        right={
          <TouchableOpacity
            onPress={() => { setAdding(v => !v); setTestMsg(null); }}
            activeOpacity={0.8}
            className={`w-10 h-10 rounded-xl items-center justify-center ${adding ? 'bg-surface border border-border' : 'bg-brand'}`}
          >
            <Icon name={adding ? 'close' : 'add'} color={adding ? c.muted : '#fff'} size={22} />
          </TouchableOpacity>
        }
      />

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }} showsVerticalScrollIndicator={false}>

          {/* Explainer */}
          <View className="bg-surface border border-border rounded-2xl p-4 gap-1.5">
            <View className="flex-row items-center gap-2">
              <Icon name="hub" tone="brand" size={18} />
              <Text className="text-text font-semibold text-sm">What are plugins?</Text>
            </View>
            <Text className="text-muted text-xs leading-5">
              Plugins give MODUS new tools &amp; data. They connect over MCP (Model Context Protocol) and their tools become available in chat.
            </Text>
          </View>

          {/* Starter directory */}
          {!adding && (
            <View className="gap-2">
              <Text className="text-muted text-xs font-semibold uppercase tracking-wider ml-1">Add a plugin</Text>
              {PLUGIN_DIRECTORY.map(t => {
                const already = !!t.url && servers.some(s => s.url === t.url);
                return (
                  <View key={t.id} className="bg-surface border border-border rounded-2xl px-4 py-3 flex-row items-start gap-3">
                    <View className="flex-1">
                      <View className="flex-row items-center gap-1.5">
                        <Text className="text-text font-medium text-[15px]">{t.name}</Text>
                        {t.tokenless && <View className="bg-emerald-500/10 rounded px-1 py-0.5"><Text className="text-emerald-500 text-[9px] font-bold uppercase">1-tap</Text></View>}
                      </View>
                      <Text className="text-muted text-xs mt-0.5 leading-4">{t.description}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => chooseTemplate(t)}
                      disabled={already || addingId === t.id}
                      activeOpacity={0.7}
                      className="mt-0.5"
                    >
                      <Text className="text-brand text-sm font-semibold" style={{ opacity: already ? 0.4 : 1 }}>
                        {already ? 'Added' : addingId === t.id ? 'Adding…' : t.id === 'custom' ? 'Add' : t.tokenless ? 'Add' : 'Use'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}

          {/* Add form */}
          {adding && (
            <View className="bg-surface border border-brand/30 rounded-2xl p-4 gap-3">
              <Text className="text-text font-semibold text-sm">Add a plugin</Text>
              <Field label="Name" value={name} onChange={setName} placeholder="e.g. My CRM" />
              <View className="gap-1">
                <Text className="text-muted text-xs font-semibold uppercase tracking-wider">Transport</Text>
                <View className="flex-row bg-bg border border-border rounded-xl p-0.5 self-start">
                  {(['http', 'sse'] as const).map(tp => (
                    <TouchableOpacity key={tp} onPress={() => setTransport(tp)} activeOpacity={0.7} className={`px-4 py-1.5 rounded-lg ${transport === tp ? 'bg-brand' : ''}`}>
                      <Text className={`text-xs font-semibold ${transport === tp ? 'text-white' : 'text-muted'}`}>{tp === 'http' ? 'HTTP' : 'SSE'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <Field label="Endpoint URL" value={url} onChange={v => { setUrl(v); setTestMsg(null); }} placeholder={transport === 'http' ? 'https://mcp.example.com/mcp' : 'https://mcp.example.com/sse'} autoCapitalize="none" />
              <Field label="Auth header (optional)" value={authHeader} onChange={v => { setAuthHeader(v); setTestMsg(null); }} placeholder="Bearer sk-…" autoCapitalize="none" secureTextEntry />
              {testMsg && (
                <View className={`flex-row items-center gap-2 rounded-xl px-3 py-2.5 ${testMsg.ok ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                  <Icon name={testMsg.ok ? 'check-circle' : 'error-outline'} size={16} color={testMsg.ok ? '#10b981' : '#ef4444'} />
                  <Text className={`text-xs flex-1 ${testMsg.ok ? 'text-emerald-500' : 'text-red-500'}`}>{testMsg.text}</Text>
                </View>
              )}
              <View className="flex-row gap-2">
                <TouchableOpacity
                  onPress={testConnection}
                  activeOpacity={0.8}
                  disabled={!url.trim() || testing}
                  className="flex-1 border border-border rounded-xl py-3 items-center"
                  style={{ opacity: (!url.trim() || testing) ? 0.5 : 1 }}
                >
                  <Text className="text-text font-semibold">{testing ? 'Testing…' : 'Test connection'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={saveServer}
                  activeOpacity={0.8}
                  disabled={!name.trim() || !url.trim() || saving}
                  className="flex-1 bg-brand rounded-xl py-3 items-center"
                  style={{ opacity: (!name.trim() || !url.trim() || saving) ? 0.5 : 1 }}
                >
                  <Text className="text-white font-semibold">{saving ? 'Adding…' : 'Add plugin'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Server list */}
          {servers.length === 0 ? null : (
            <View className="bg-surface border border-border rounded-2xl overflow-hidden">
              <View className="px-4 pt-3 pb-1"><Text className="text-muted text-xs font-semibold uppercase tracking-wider">Your plugins</Text></View>
              {servers.map((s, i) => (
                <View key={s.id} className={`px-4 py-3.5 flex-row items-center gap-3 ${i > 0 ? 'border-t border-border' : ''}`}>
                  <View className="w-8 h-8 rounded-xl bg-brand/10 items-center justify-center">
                    <Icon name="hub" tone="brand" size={17} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-text text-[15px] font-medium">{s.name}</Text>
                    <Text className="text-muted text-xs mt-0.5" numberOfLines={1}>{s.url}</Text>
                  </View>
                  <TouchableOpacity onPress={() => removeServer(s)} className="p-1.5" activeOpacity={0.7}>
                    <Icon name="delete-outline" tone="muted" size={18} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, placeholder, autoCapitalize, secureTextEntry }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
  autoCapitalize?: 'none' | 'sentences'; secureTextEntry?: boolean;
}) {
  const c = useThemeColors();
  return (
    <View className="gap-1">
      <Text className="text-muted text-xs font-semibold uppercase tracking-wider">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        autoCapitalize={autoCapitalize ?? 'sentences'}
        autoCorrect={false}
        secureTextEntry={secureTextEntry}
        className="bg-bg border border-border rounded-xl px-4 py-3 text-text text-[15px]"
      />
    </View>
  );
}
