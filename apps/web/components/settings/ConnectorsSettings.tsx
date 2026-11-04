'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { User } from 'firebase/auth';
import { useUserSettings } from '@/hooks/useUserSettings';
import { isPaidPlan } from '@/lib/plan';
import { PLUGIN_DIRECTORY, PLUGIN_DIRECTORY_MORE_URL, type PluginTemplate } from '@/lib/plugin-directory';

interface GoogleAccount { email: string; connectedAt: string | null; needsReconnect?: boolean; }
interface NotionAccount { workspaceId: string; workspaceName: string; workspaceIcon: string | null; ownerEmail: string; connectedAt: string | null; }
interface SlackAccount { teamId: string; teamName: string; connectedAt: string | null; }
interface GitHubAccount { login: string; name: string | null; avatarUrl: string; connectedAt: string | null; }
interface McpServerEntry { id: string; name: string; url: string; authHeader?: string; createdAt: string;
  authType?: 'oauth' | 'header';
  authStatus?: 'connected' | 'pending' | 'needs_reconnect';
}
interface DeviceItem { count?: number; permission: string | null; enabled: boolean; }
interface DeviceStatus { contacts: DeviceItem; health: DeviceItem; photos: DeviceItem; }
interface ContactEntry { id: string; name: string; email: string | null; phone: string | null; company: string | null; userCategory: string | null; }

interface Props { user: User }

// AI behaviors (merged in from the old Capabilities tab). Non-beta features are
// MODUS+ only; beta features are available on any plan.
const AI_FEATURES: { key: 'webSearch' | 'dailyBriefing' | 'voiceInput' | 'inboxTriage' | 'relationshipNurture'; label: string; desc: string; beta?: boolean }[] = [
  // NOT a master switch, and the label must not imply one: "+ → Web search" in the
  // composer always works, and Auto searches when it routes a message to research.
  // This governs ONE thing — searching a message you never asked to be searched.
  { key: 'webSearch', label: 'Search the web automatically', desc: 'When a message looks like it needs current information, Modus searches before answering. You can always search a single message with + → Web search.' },
  { key: 'dailyBriefing', label: 'Daily Briefing', desc: 'A morning brief with your top priorities, pending approvals, and a quick check-in.' },
  { key: 'voiceInput', label: 'Voice Input', desc: 'Speak to Modus instead of typing. Audio is transcribed locally before sending.', beta: true },
  { key: 'inboxTriage', label: 'Inbox Triage', desc: 'Modus drafts replies to emails waiting on you. Nothing sends until you approve, and you can edit any draft.', beta: true },
  { key: 'relationshipNurture', label: 'Relationship Follow-ups', desc: 'Modus drafts warm reach-outs to people you’ve fallen out of touch with. Nothing sends until you approve.', beta: true },
];

// ── Icons ────────────────────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function NotionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z"/>
    </svg>
  );
}

function SlackIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#E01E5A"/>
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
    </svg>
  );
}

function ContactsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}

function HealthIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
  );
}

function PhotosIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  );
}

function McpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <rect x="2" y="3" width="20" height="14" rx="2"/>
      <path d="M8 21h8M12 17v4M7 8l3 3-3 3M13 14h4"/>
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return 'Connected';
  return `Connected ${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ConnectorsSettings({ user }: Props) {
  // This page merges connections + capabilities. Capability toggles (AI
  // features + desktop syncs) all live in settings.capabilities.
  const { settings, plan, saving: settingsSaving, saveSettings, clearSyncedData } = useUserSettings(user);
  const [clearingSource, setClearingSource] = useState<'notes' | 'messages' | null>(null);
  const isPaid = isPaidPlan(plan);
  const setCapability = (key: keyof typeof settings.capabilities, val: boolean) =>
    saveSettings({ capabilities: { ...settings.capabilities, [key]: val } });

  /**
   * Deleting what was already synced is a SEPARATE, explicit action from
   * switching the source off. Turning the toggle off stops the Mac app's data
   * being accepted from that moment (the ingest route enforces it), but
   * everything already uploaded stays until this runs — and silently deleting
   * a user's data because they flipped a toggle is not a thing to do quietly.
   */
  const handleClearSynced = async (source: 'notes' | 'messages', label: string) => {
    if (!confirm(`Delete every ${label} Modus has synced from your Mac? This cannot be undone. They stay on your Mac, only Modus's copy is removed.`)) return;
    setClearingSource(source);
    try {
      const n = await clearSyncedData([source]);
      alert(`Deleted ${n} synced ${label}.`);
    } catch {
      alert(`Failed to delete synced ${label}. Try again.`);
    } finally {
      setClearingSource(null);
    }
  };

  const [googleAccounts, setGoogleAccounts] = useState<GoogleAccount[]>([]);
  const [notionAccounts, setNotionAccounts] = useState<NotionAccount[]>([]);
  const [slackAccounts, setSlackAccounts] = useState<SlackAccount[]>([]);
  const [githubAccounts, setGithubAccounts] = useState<GitHubAccount[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerEntry[]>([]);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [contactsOpen, setContactsOpen] = useState(false);
  const [contactsList, setContactsList] = useState<ContactEntry[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsSearch, setContactsSearch] = useState('');
  const [contactsSaving, setContactsSaving] = useState<string | null>(null);

  const [mcpFormOpen, setMcpFormOpen] = useState(false);
  const [mcpName, setMcpName] = useState('');
  const [mcpUrl, setMcpUrl] = useState('');
  const [mcpAuth, setMcpAuth] = useState('');
  const [mcpTransport, setMcpTransport] = useState<'http' | 'sse'>('http');
  const [mcpTemplate, setMcpTemplate] = useState<PluginTemplate | null>(null);
  const [mcpTesting, setMcpTesting] = useState(false);
  const [mcpTestResult, setMcpTestResult] = useState<{ ok: boolean; tools?: string[]; error?: string; needsOAuth?: boolean } | null>(null);
  const [mcpSaving, setMcpSaving] = useState(false);
  const [mcpAdding, setMcpAdding] = useState<string | null>(null); // directory entry being one-tap added
  const [mcpRemoving, setMcpRemoving] = useState<string | null>(null);

  useEffect(() => {
    user.getIdToken().then(async token => {
      try {
        const [googleRes, connRes, mcpRes, deviceRes] = await Promise.all([
          fetch('/api/google/status', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/connectors/status', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/mcp/list', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/mobile/status', { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        const [googleData, connData, mcpData, deviceData] = await Promise.all([googleRes.json(), connRes.json(), mcpRes.json(), deviceRes.json()]);
        setGoogleAccounts(googleData.accounts ?? []);
        setNotionAccounts(connData.notion ?? []);
        setSlackAccounts(connData.slack ?? []);
        setGithubAccounts(connData.github ?? []);
        setMcpServers(mcpData.servers ?? []);
        setDeviceStatus(deviceData);
      } catch { /* non-fatal */ }
      finally { setLoading(false); }
    });
  }, [user]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const err = params.get('error');
    if (err) {
      const labels: Record<string, string> = { notion_denied: 'Notion auth cancelled.', notion_failed: 'Notion connection failed.', slack_denied: 'Slack auth cancelled.', slack_failed: 'Slack connection failed.', github_denied: 'GitHub auth cancelled.', github_failed: 'GitHub connection failed.', mcp_denied: 'Sign in cancelled.', mcp_state: 'That sign in link expired. Try again.', mcp_missing: 'That plugin was removed before sign in finished.', mcp_failed: `${params.get('name') ?? 'The plugin'} sign in failed. Try again.` };
      setError(labels[err] ?? 'Connection failed.');
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (connected && ['notion', 'slack', 'github'].includes(connected)) {
      user.getIdToken().then(async token => {
        const res = await fetch('/api/connectors/status', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        setNotionAccounts(data.notion ?? []);
        setSlackAccounts(data.slack ?? []);
        setGithubAccounts(data.github ?? []);
        window.history.replaceState({}, '', window.location.pathname);
      });
    }
    if (connected && !['notion', 'slack', 'github'].includes(connected) && !connected.includes('@')) {
      // An MCP connector finished OAuth; the list already shows it from the
      // initial load, so just clear the query string.
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (connected && connected.includes('@')) {
      user.getIdToken().then(async token => {
        const res = await fetch('/api/google/status', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        setGoogleAccounts(data.accounts ?? []);
        window.history.replaceState({}, '', window.location.pathname);
      });
    }
  }, [user]);

  async function connectService(endpoint: string, key: string) {
    setConnecting(key);
    setError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      // Guard the redirect: without this, a failed/misconfigured connect endpoint
      // (no `url` in the response) navigates the browser to "undefined" → a 404,
      // with no error shown.
      if (!res.ok || !data.url) { setError(`Failed to start ${key} auth. Try again.`); setConnecting(null); return; }
      window.location.href = data.url;
    } catch {
      setError(`Failed to start ${key} auth. Try again.`);
      setConnecting(null);
    }
  }

  async function connectGoogle() {
    setConnecting('google');
    setError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/auth/google/connect', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) { setError('Failed to start Google auth. Try again.'); setConnecting(null); return; }
      window.location.href = data.url;
    } catch {
      setError('Failed to start Google auth. Try again.');
      setConnecting(null);
    }
  }

  async function disconnectGoogle(email: string) {
    setDisconnecting(email);
    try {
      const token = await user.getIdToken();
      await fetch('/api/google/disconnect', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      setGoogleAccounts(prev => prev.filter(a => a.email !== email));
    } catch { setError('Failed to disconnect. Try again.'); }
    finally { setDisconnecting(null); }
  }

  async function disconnectNotion(workspaceId: string) {
    setDisconnecting(workspaceId);
    try {
      const token = await user.getIdToken();
      await fetch('/api/notion/disconnect', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId }) });
      setNotionAccounts(prev => prev.filter(a => a.workspaceId !== workspaceId));
    } catch { setError('Failed to disconnect. Try again.'); }
    finally { setDisconnecting(null); }
  }

  async function disconnectSlack(teamId: string) {
    setDisconnecting(teamId);
    try {
      const token = await user.getIdToken();
      await fetch('/api/slack/disconnect', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ teamId }) });
      setSlackAccounts(prev => prev.filter(a => a.teamId !== teamId));
    } catch { setError('Failed to disconnect. Try again.'); }
    finally { setDisconnecting(null); }
  }

  async function disconnectGitHub(login: string) {
    setDisconnecting(login);
    try {
      const token = await user.getIdToken();
      await fetch('/api/github/disconnect', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ login }) });
      setGithubAccounts(prev => prev.filter(a => a.login !== login));
    } catch { setError('Failed to disconnect. Try again.'); }
    finally { setDisconnecting(null); }
  }

  async function loadContacts() {
    setContactsLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/contacts', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setContactsList(data.contacts ?? []);
    } catch { /* non-fatal */ }
    finally { setContactsLoading(false); }
  }

  async function setContactCategory(id: string, category: string | null) {
    setContactsSaving(id);
    try {
      const token = await user.getIdToken();
      await fetch(`/api/contacts/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userCategory: category }),
      });
      setContactsList(prev => prev.map(c => c.id === id ? { ...c, userCategory: category } : c));
    } catch { /* non-fatal */ }
    finally { setContactsSaving(null); }
  }

  function toggleContactsPanel() {
    if (!contactsOpen && contactsList.length === 0) loadContacts();
    setContactsOpen(o => !o);
  }

  async function testMcpConnection() {
    setMcpTesting(true);
    setMcpTestResult(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/mcp/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: mcpUrl.trim(), authHeader: mcpAuth.trim() || undefined, transport: mcpTransport }),
      });
      setMcpTestResult(await res.json());
    } catch {
      setMcpTestResult({ ok: false, error: 'Request failed' });
    } finally {
      setMcpTesting(false);
    }
  }

  async function saveMcpServer() {
    if (!mcpName.trim() || !mcpUrl.trim()) return;
    setMcpSaving(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/mcp/add', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: mcpName.trim(), url: mcpUrl.trim(), authHeader: mcpAuth.trim() || undefined, transport: mcpTransport }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to save server'); return; }
      setMcpServers(prev => [...prev, { id: data.id, name: mcpName.trim(), url: mcpUrl.trim(), authHeader: mcpAuth.trim() || undefined, transport: mcpTransport, createdAt: new Date().toISOString() }]);
      setMcpFormOpen(false); setMcpTemplate(null);
      setMcpName(''); setMcpUrl(''); setMcpAuth(''); setMcpTransport('http'); setMcpTestResult(null);
    } catch {
      setError('Failed to save server');
    } finally {
      setMcpSaving(false);
    }
  }

  // OAuth connectors: the server runs discovery and registration, then hands
  // back the provider's consent page. Coming back lands on ?connected=<name>.
  async function connectOAuth(t: { id?: string; name?: string; url?: string }) {
    setMcpAdding(t.id ?? t.url ?? 'oauth');
    setError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/mcp/oauth/start', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(t.id ? { directoryId: t.id } : { name: t.name, url: t.url }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Could not start sign in'); return; }
      if (data.authUrl) { window.location.assign(data.authUrl); return; }
      const list = await fetch('/api/mcp/list', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
      setMcpServers(list.servers ?? []);
    } catch {
      setError('Could not start sign in');
    } finally {
      setMcpAdding(null);
    }
  }

  // Directory: tokenless entries add in one tap; others open the form prefilled.
  function chooseTemplate(t: PluginTemplate) {
    if (t.oauth && t.url) { connectOAuth(t); return; }
    if (t.id === 'custom') {
      setMcpTemplate(null); setMcpName(''); setMcpUrl(''); setMcpAuth(''); setMcpTransport('http');
      setMcpTestResult(null); setMcpFormOpen(true);
      return;
    }
    if (t.tokenless && t.url) { addFromTemplate(t); return; }
    setMcpTemplate(t);
    setMcpName(t.name); setMcpUrl(t.url ?? ''); setMcpAuth(''); setMcpTransport(t.transport);
    setMcpTestResult(null); setMcpFormOpen(true);
  }

  async function addFromTemplate(t: PluginTemplate) {
    if (!t.url || mcpServers.some(s => s.url === t.url)) return;
    setMcpAdding(t.id);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/mcp/add', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: t.name, url: t.url, transport: t.transport }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to add plugin'); return; }
      setMcpServers(prev => [...prev, { id: data.id, name: t.name, url: t.url!, transport: t.transport, createdAt: new Date().toISOString() }]);
    } catch {
      setError('Failed to add plugin');
    } finally {
      setMcpAdding(null);
    }
  }

  async function removeMcpServer(serverId: string) {
    setMcpRemoving(serverId);
    try {
      const token = await user.getIdToken();
      await fetch('/api/mcp/remove', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId }),
      });
      setMcpServers(prev => prev.filter(s => s.id !== serverId));
    } catch { setError('Failed to remove server'); }
    finally { setMcpRemoving(null); }
  }

  // A sign in that never finished is not an active plugin.
  const activeMcpCount = mcpServers.filter(s => s.authType !== 'oauth' || s.authStatus === 'connected').length;

  // Filtered contacts list (memoised inline)
  const filteredContacts = contactsList.filter(c => {
    const q = contactsSearch.toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q) || c.company?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400/60 hover:text-red-400 transition-colors shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6 items-start">
      {/* ── Integrations ── */}
      <SectionGroup label="Integrations">
        <div className="bg-panel border border-border rounded-xl overflow-hidden divide-y divide-border">
          {/* Google */}
          <CloudRow
            icon={<GoogleIcon />}
            name="Google"
            caption="Gmail · Calendar · Drive"
            loading={loading}
            connectedCount={googleAccounts.length}
            connectLabel={googleAccounts.length > 0 ? '+ Add account' : 'Connect'}
            connecting={connecting === 'google'}
            onConnect={connectGoogle}
          >
            <AnimatePresence>
              {googleAccounts.map(a => (
                <AccountSubRow
                  key={a.email}
                  avatar={<InitialAvatar seed={a.email} />}
                  title={a.email}
                  subtitle={fmtDate(a.connectedAt)}
                  needsReconnect={a.needsReconnect}
                  onReconnect={connectGoogle}
                  removing={disconnecting === a.email}
                  onRemove={() => disconnectGoogle(a.email)}
                />
              ))}
            </AnimatePresence>
          </CloudRow>

          {/* Notion */}
          <CloudRow
            icon={<NotionIcon />}
            name="Notion"
            caption="Pages · Databases · Notes"
            loading={loading}
            connectedCount={notionAccounts.length}
            connectLabel={notionAccounts.length > 0 ? '+ Add workspace' : 'Connect'}
            connecting={connecting === 'notion'}
            onConnect={() => connectService('/api/auth/notion/connect', 'notion')}
          >
            <AnimatePresence>
              {notionAccounts.map(a => (
                <AccountSubRow
                  key={a.workspaceId}
                  avatar={
                    a.workspaceIcon
                      ? <img src={a.workspaceIcon} alt="" className="w-5 h-5 rounded-full object-cover" />
                      : <InitialAvatar seed={a.workspaceName} />
                  }
                  title={a.workspaceName}
                  subtitle={a.ownerEmail ? `${fmtDate(a.connectedAt)} · ${a.ownerEmail}` : fmtDate(a.connectedAt)}
                  removing={disconnecting === a.workspaceId}
                  onRemove={() => disconnectNotion(a.workspaceId)}
                />
              ))}
            </AnimatePresence>
          </CloudRow>

          {/* Slack */}
          <CloudRow
            icon={<SlackIcon />}
            name="Slack"
            caption="Channels · Messages · DMs"
            loading={loading}
            connectedCount={slackAccounts.length}
            connectLabel={slackAccounts.length > 0 ? '+ Add workspace' : 'Connect'}
            connecting={connecting === 'slack'}
            onConnect={() => connectService('/api/auth/slack/connect', 'slack')}
          >
            <AnimatePresence>
              {slackAccounts.map(a => (
                <AccountSubRow
                  key={a.teamId}
                  avatar={<InitialAvatar seed={a.teamName} />}
                  title={a.teamName}
                  subtitle={fmtDate(a.connectedAt)}
                  removing={disconnecting === a.teamId}
                  onRemove={() => disconnectSlack(a.teamId)}
                />
              ))}
            </AnimatePresence>
            {slackAccounts.length > 0 && (
              <div className="pl-11 pr-4 py-2 border-t border-border/40 bg-bg/30">
                <p className="text-[11px] text-muted">Run <span className="font-mono text-text/60">/invite @Modus</span> in channels you want it to read.</p>
              </div>
            )}
          </CloudRow>

          {/* GitHub */}
          <CloudRow
            icon={<GitHubIcon />}
            name="GitHub"
            caption="Repos · Issues · Pull Requests"
            loading={loading}
            connectedCount={githubAccounts.length}
            connectLabel={githubAccounts.length > 0 ? '+ Add account' : 'Connect'}
            connecting={connecting === 'github'}
            onConnect={() => connectService('/api/auth/github/connect', 'github')}
          >
            <AnimatePresence>
              {githubAccounts.map(a => (
                <AccountSubRow
                  key={a.login}
                  avatar={
                    a.avatarUrl
                      ? <img src={a.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
                      : <InitialAvatar seed={a.login} />
                  }
                  title={a.name ?? a.login}
                  subtitle={`@${a.login} · ${fmtDate(a.connectedAt)}`}
                  removing={disconnecting === a.login}
                  onRemove={() => disconnectGitHub(a.login)}
                />
              ))}
            </AnimatePresence>
          </CloudRow>
        </div>
      </SectionGroup>

      {/* ── AI Features ── */}
      <SectionGroup label="AI Features">
        <div className="bg-panel border border-border rounded-xl overflow-hidden divide-y divide-border">
          {AI_FEATURES.map(f => {
            const locked = !isPaid && !f.beta;
            return (
              <div key={f.key} className="flex items-start gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-text">{f.label}</p>
                    {f.beta && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">Beta</span>}
                    {locked && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full surface-tint-strong text-brand">MODUS+</span>}
                  </div>
                  <p className="text-xs text-muted leading-relaxed mt-0.5">{f.desc}</p>
                </div>
                <Toggle
                  checked={settings.capabilities[f.key]}
                  onChange={v => setCapability(f.key, v)}
                  disabled={settingsSaving || locked}
                />
              </div>
            );
          })}
        </div>
      </SectionGroup>

      <SectionGroup label="On This Device">
        <div className="bg-panel border border-border rounded-xl overflow-hidden divide-y divide-border">
          {/* Contacts */}
          <div>
            <div className="flex items-center gap-3 px-4 py-3">
              <IconBox><ContactsIcon /></IconBox>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text">Contacts</p>
                <p className="text-xs text-muted">
                  {deviceStatus?.contacts.count ? `${deviceStatus.contacts.count} synced · relationship tracking` : 'Relationship tracking'}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {loading
                  ? <div className="w-12 h-3 rounded bg-border animate-pulse" />
                  : <PermBadge permission={deviceStatus?.contacts.permission ?? null} />
                }
                {!loading && (deviceStatus?.contacts.count ?? 0) > 0 && (
                  <button onClick={toggleContactsPanel} className="text-xs font-medium text-brand hover:underline">
                    {contactsOpen ? 'Close' : 'Manage'}
                  </button>
                )}
              </div>
            </div>

            <AnimatePresence>
              {contactsOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-border px-4 py-3 space-y-2.5 bg-bg/40">
                    <input
                      type="text"
                      placeholder="Search contacts…"
                      value={contactsSearch}
                      onChange={e => setContactsSearch(e.target.value)}
                      className="w-full bg-panel border border-border rounded-lg px-3 py-2 text-xs text-text placeholder:text-muted focus:outline-none focus:border-brand transition-colors"
                    />
                    {contactsLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <div className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : (
                      <div className="max-h-64 overflow-y-auto space-y-0.5 -mx-1 px-1">
                        {filteredContacts.map(c => {
                          const sub = [c.company, c.email ?? c.phone].filter(Boolean).join(' · ');
                          const saving = contactsSaving === c.id;
                          return (
                            <div key={c.id} className={`flex items-center gap-2 py-1.5 rounded-md px-1 transition-opacity ${c.userCategory === 'excluded' ? 'opacity-40' : ''}`}>
                              <div className="flex-1 min-w-0">
                                <p className={`text-xs font-medium text-text truncate ${c.userCategory === 'excluded' ? 'line-through' : ''}`}>{c.name}</p>
                                {sub && <p className="text-[11px] text-muted truncate">{sub}</p>}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {saving && <div className="w-3 h-3 border border-brand border-t-transparent rounded-full animate-spin" />}
                                {(['personal', 'professional', 'service', 'excluded'] as const).map(cat => (
                                  <button
                                    key={cat}
                                    disabled={saving}
                                    onClick={() => setContactCategory(c.id, c.userCategory === cat ? null : cat)}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                                      c.userCategory === cat
                                        ? cat === 'excluded'
                                          ? 'bg-red-500/15 text-red-400 border border-red-500/25'
                                          : 'surface-tint-strong text-brand border border-tint'
                                        : 'bg-bg border border-border text-muted hover:text-text hover:border-border/80'
                                    }`}
                                  >
                                    {cat === 'excluded' ? 'Hide' : cat[0].toUpperCase() + cat.slice(1)}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                        {filteredContacts.length === 0 && (
                          <p className="text-xs text-muted text-center py-4">No contacts match</p>
                        )}
                      </div>
                    )}
                    <p className="text-[11px] text-muted">Click a category to override · click again to revert to auto-detection.</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Health */}
          <div className="flex items-center gap-3 px-4 py-3">
            <IconBox><HealthIcon /></IconBox>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text">Health</p>
              <p className="text-xs text-muted">Steps & sleep in your morning briefing</p>
            </div>
            {loading
              ? <div className="w-12 h-3 rounded bg-border animate-pulse" />
              : <PermBadge permission={deviceStatus?.health.permission ?? null} />
            }
          </div>

          {/* Photos */}
          <div className="flex items-center gap-3 px-4 py-3">
            <IconBox><PhotosIcon /></IconBox>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text">Photos</p>
              <p className="text-xs text-muted">Attach & reference photos in chat</p>
            </div>
            {loading
              ? <div className="w-12 h-3 rounded bg-border animate-pulse" />
              : <PermBadge permission={deviceStatus?.photos.permission ?? null} />
            }
          </div>
        </div>
        <p className="text-[11px] text-muted mt-2 px-1">Permissions are managed in iOS Settings → Modus.</p>
      </SectionGroup>

      {/* ── On Your Mac (MODUS Desktop) ── */}
      <SectionGroup label="On Your Mac">
        <div className="bg-panel border border-border rounded-xl overflow-hidden divide-y divide-border">
          {/* Apple Notes */}
          <div className="flex items-start gap-3 px-4 py-3">
            <IconBox><MacIcon /></IconBox>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-text">Apple Notes</p>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">Beta</span>
              </div>
              <p className="text-xs text-muted leading-relaxed mt-0.5">Sync notes from the Modus Desktop app (Mac) so you can ask about them in chat, e.g. &quot;what&apos;s on my grocery list?&quot; Turning this off stops new notes being stored.</p>
              <button
                onClick={() => handleClearSynced('notes', 'notes')}
                disabled={clearingSource !== null}
                className="text-[11px] text-red-400 hover:text-red-300 disabled:opacity-50 mt-1.5 transition-colors"
              >
                {clearingSource === 'notes' ? 'Deleting…' : 'Delete synced notes'}
              </button>
            </div>
            <Toggle checked={settings.capabilities.notesSync} onChange={v => setCapability('notesSync', v)} disabled={settingsSaving} />
          </div>
          {/* iMessage */}
          <div className="flex items-start gap-3 px-4 py-3">
            <IconBox><MacIcon /></IconBox>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-text">iMessage</p>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">Beta</span>
              </div>
              <p className="text-xs text-muted leading-relaxed mt-0.5">Sync recent iMessage conversations from the Mac app. Off by default, this includes other people&apos;s messages, not just your own notes. While off, nothing is stored.</p>
              <button
                onClick={() => handleClearSynced('messages', 'conversations')}
                disabled={clearingSource !== null}
                className="text-[11px] text-red-400 hover:text-red-300 disabled:opacity-50 mt-1.5 transition-colors"
              >
                {clearingSource === 'messages' ? 'Deleting…' : 'Delete synced conversations'}
              </button>
            </div>
            <Toggle checked={settings.capabilities.messagesSync} onChange={v => setCapability('messagesSync', v)} disabled={settingsSaving} />
          </div>
          {/* Reminders (synced into the Reminders section automatically) */}
          <div className="flex items-start gap-3 px-4 py-3">
            <IconBox><MacIcon /></IconBox>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text">Apple Reminders</p>
              <p className="text-xs text-muted leading-relaxed mt-0.5">Synced into your Reminders section automatically by the Mac app.</p>
            </div>
            <span className="text-[11px] text-muted shrink-0 mt-1">Auto</span>
          </div>
        </div>
        <p className="text-[11px] text-muted mt-2 px-1">Requires the Modus Desktop app with Full Disk Access granted.</p>
      </SectionGroup>

      {/* ── Plugins (elevated, full width) ── */}
      <div className="md:col-span-2 order-first">
      <SectionGroup label="Plugins">
        <div className="bg-panel border border-border rounded-xl overflow-hidden divide-y divide-border">
          <div className="flex items-center gap-3 px-4 py-3">
            <IconBox><McpIcon /></IconBox>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text">Plugins</p>
              <p className="text-xs text-muted">Give Modus new tools &amp; data. Plugins connect over MCP and their tools become available in chat.</p>
            </div>
            {loading ? (
              <div className="w-12 h-3 rounded bg-border animate-pulse" />
            ) : activeMcpCount > 0 ? (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                {activeMcpCount} active
              </span>
            ) : null}
          </div>

          {/* Starter directory */}
          <div className="px-4 py-3">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">Add a plugin</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {PLUGIN_DIRECTORY.map(t => {
                const match = t.url ? mcpServers.find(s => s.url === t.url) : undefined;
                const already = !!match && (!t.oauth || match.authStatus === 'connected');
                return (
                  <div key={t.id} className="flex items-start gap-3 rounded-lg border border-border bg-bg/40 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-text truncate">{t.name}</p>
                        {t.oauth && <span className="text-[9px] font-semibold uppercase tracking-wide text-muted bg-text/[0.06] rounded px-1 py-0.5 shrink-0">Sign in</span>}
                        {t.tokenless && <span className="text-[9px] font-semibold uppercase tracking-wide text-emerald-400 bg-emerald-500/10 rounded px-1 py-0.5 shrink-0">1-tap</span>}
                      </div>
                      <p className="text-[11px] text-muted leading-snug mt-0.5">{t.description}</p>
                    </div>
                    <button
                      onClick={() => chooseTemplate(t)}
                      disabled={already || mcpAdding === t.id}
                      className="shrink-0 mt-0.5 text-xs font-medium text-brand hover:underline disabled:opacity-40 disabled:no-underline"
                    >
                      {already ? (t.oauth ? 'Connected' : 'Added') : mcpAdding === t.id ? (t.oauth ? 'Opening…' : 'Adding…') : t.oauth ? (match ? 'Finish sign in' : 'Connect') : t.id === 'custom' ? 'Add' : t.tokenless ? 'Add' : 'Use'}
                    </button>
                  </div>
                );
              })}
            </div>
            <a href={PLUGIN_DIRECTORY_MORE_URL} target="_blank" rel="noopener noreferrer" className="inline-block mt-2 text-[11px] text-muted hover:text-brand transition-colors">Browse more plugins →</a>
          </div>

          <AnimatePresence>
            {mcpServers.map(server => (
              <motion.div
                key={server.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-2.5 pl-11 pr-4 py-2.5 bg-bg/40"
              >
                <div className="w-5 h-5 rounded-full surface-tint border border-tint flex items-center justify-center shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-text truncate">{server.name}</p>
                  <p className="text-[11px] text-muted font-mono truncate">{server.url}</p>
                </div>
                {server.authType === 'oauth' && server.authStatus !== 'connected' && (
                  <button
                    onClick={() => connectOAuth({ name: server.name, url: server.url })}
                    disabled={!!mcpAdding}
                    className="text-[11px] font-medium text-brand hover:underline disabled:opacity-40 shrink-0"
                  >
                    {server.authStatus === 'needs_reconnect' ? 'Reconnect' : 'Finish sign in'}
                  </button>
                )}
                <button
                  onClick={() => removeMcpServer(server.id)}
                  disabled={mcpRemoving === server.id}
                  className="text-[11px] text-muted hover:text-red-400 transition-colors disabled:opacity-40 shrink-0"
                >
                  {mcpRemoving === server.id ? '…' : 'Remove'}
                </button>
              </motion.div>
            ))}
          </AnimatePresence>

          <AnimatePresence>
            {mcpFormOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-4 py-4 space-y-3 bg-bg/40">
                  {mcpTemplate && (
                    <div className="rounded-lg surface-tint border border-tint px-3 py-2 text-[11px] text-muted leading-relaxed">
                      Paste your {mcpTemplate.name} {mcpTemplate.authLabel ?? 'API key / token'} in the auth field below.
                      {mcpTemplate.docsUrl && (<> <a href={mcpTemplate.docsUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">How to get it →</a></>)}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-muted uppercase tracking-wide">Plugin name</label>
                    <input value={mcpName} onChange={e => setMcpName(e.target.value)} placeholder="e.g. My Database"
                      className="w-full bg-panel border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-muted/50 focus:outline-none focus:border-brand/50 transition-colors" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-muted uppercase tracking-wide">Transport</label>
                    <div className="flex bg-panel border border-border rounded-lg p-0.5 w-max">
                      {(['http', 'sse'] as const).map(tp => (
                        <button key={tp} onClick={() => { setMcpTransport(tp); setMcpTestResult(null); }}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${mcpTransport === tp ? 'bg-brand text-white' : 'text-muted hover:text-text'}`}>
                          {tp === 'http' ? 'HTTP' : 'SSE'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-muted uppercase tracking-wide">Endpoint URL</label>
                    <input value={mcpUrl} onChange={e => { setMcpUrl(e.target.value); setMcpTestResult(null); }} placeholder={mcpTransport === 'http' ? 'https://your-server.com/mcp' : 'https://your-server.com/sse'}
                      className="w-full bg-panel border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-muted/50 focus:outline-none focus:border-brand/50 transition-colors font-mono text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-muted uppercase tracking-wide">Auth header <span className="text-muted/50 normal-case font-normal">(optional)</span></label>
                    <input value={mcpAuth} onChange={e => setMcpAuth(e.target.value)} placeholder={mcpTemplate?.authPlaceholder ?? 'Bearer your-token'}
                      className="w-full bg-panel border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-muted/50 focus:outline-none focus:border-brand/50 transition-colors font-mono text-xs" />
                  </div>

                  {mcpTestResult && (
                    <div className={`flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs ${mcpTestResult.ok ? 'bg-emerald-500/8 border border-emerald-500/15 text-emerald-400' : 'bg-red-500/8 border border-red-500/15 text-red-400'}`}>
                      {mcpTestResult.ok ? (
                        <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 mt-0.5"><polyline points="20 6 9 17 4 12"/></svg>
                        Connected, {mcpTestResult.tools?.length ?? 0} tool{(mcpTestResult.tools?.length ?? 0) !== 1 ? 's' : ''} found
                        {mcpTestResult.tools?.length ? `: ${mcpTestResult.tools.slice(0, 4).join(', ')}${mcpTestResult.tools.length > 4 ? ` +${mcpTestResult.tools.length - 4} more` : ''}` : ''}</>
                      ) : (
                        <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 mt-0.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg><span className="flex-1">{mcpTestResult.error}</span>
                        {mcpTestResult.needsOAuth && (
                          <button
                            onClick={() => connectOAuth({ name: mcpName.trim() || new URL(mcpUrl.trim()).hostname, url: mcpUrl.trim() })}
                            disabled={!!mcpAdding}
                            className="shrink-0 font-medium text-brand hover:underline disabled:opacity-40"
                          >
                            Sign in
                          </button>
                        )}</>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button onClick={() => { setMcpFormOpen(false); setMcpTemplate(null); setMcpName(''); setMcpUrl(''); setMcpAuth(''); setMcpTransport('http'); setMcpTestResult(null); }}
                      className="px-3 py-2 border border-border text-xs text-muted hover:text-text rounded-lg transition-colors">
                      Cancel
                    </button>
                    <button onClick={testMcpConnection} disabled={mcpTesting || !mcpUrl.trim()}
                      className="flex items-center gap-1.5 px-3 py-2 border border-border text-xs text-muted hover:text-text hover-border-tint rounded-lg transition-colors disabled:opacity-40">
                      {mcpTesting && <span className="w-3 h-3 border border-muted border-t-transparent rounded-full animate-spin" />}
                      {mcpTesting ? 'Testing…' : 'Test connection'}
                    </button>
                    <button onClick={saveMcpServer} disabled={mcpSaving || !mcpName.trim() || !mcpUrl.trim()}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-brand text-white text-xs font-medium rounded-lg hover:bg-brand/90 disabled:opacity-40 transition-colors">
                      {mcpSaving && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      {mcpSaving ? 'Saving…' : 'Save plugin'}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </SectionGroup>
      </div>{/* end plugins */}
      </div>{/* end grid */}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-2 px-0.5">
        <p className="text-[11px] font-semibold text-muted uppercase tracking-wider shrink-0">{label}</p>
        <div className="flex-1 h-px bg-border" />
      </div>
      {children}
    </div>
  );
}

function IconBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-7 h-7 rounded-lg bg-bg border border-border/70 flex items-center justify-center shrink-0 text-muted">
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-40 shrink-0 ${checked ? 'bg-brand' : 'bg-border'}`}
    >
      <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

function MacIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function CloudRow({ icon, name, caption, loading, connectedCount, connectLabel, connecting, onConnect, children }: {
  icon: React.ReactNode; name: string; caption: string; loading: boolean;
  connectedCount: number; connectLabel: string; connecting: boolean;
  onConnect: () => void; children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3">
        <IconBox>{icon}</IconBox>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="text-sm font-medium text-text">{name}</p>
            <p className="text-xs text-muted">{caption}</p>
          </div>
        </div>
        {loading ? (
          <div className="w-16 h-3 rounded bg-border animate-pulse" />
        ) : connectedCount > 0 ? (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            {connectedCount} connected
          </span>
        ) : null}
        <button
          onClick={onConnect}
          disabled={connecting}
          className="ml-2 text-xs font-medium text-brand hover:underline disabled:opacity-50 shrink-0"
        >
          {connecting ? (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 border border-brand border-t-transparent rounded-full animate-spin" />
              Connecting…
            </span>
          ) : connectLabel}
        </button>
      </div>
      {children}
    </div>
  );
}

function AccountSubRow({ avatar, title, subtitle, removing, onRemove, needsReconnect, onReconnect }: {
  avatar: React.ReactNode; title: string; subtitle: string; removing: boolean; onRemove: () => void;
  needsReconnect?: boolean; onReconnect?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.15 }}
      className="overflow-hidden"
    >
      <div className="flex items-center gap-2.5 pl-11 pr-4 py-2 border-t border-border/50 bg-bg/40">
        <div className="shrink-0">{avatar}</div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-text truncate">{title}</p>
          {needsReconnect
            ? <p className="text-[11px] text-yellow-500">Access expired, reconnect to restore</p>
            : <p className="text-[11px] text-muted">{subtitle}</p>}
        </div>
        {needsReconnect && onReconnect && (
          <button
            onClick={onReconnect}
            className="text-[11px] font-medium text-yellow-500 hover:text-yellow-400 transition-colors shrink-0"
          >
            Reconnect
          </button>
        )}
        <button
          onClick={onRemove}
          disabled={removing}
          className="text-[11px] text-muted hover:text-red-400 transition-colors disabled:opacity-40 shrink-0"
        >
          {removing ? '…' : 'Remove'}
        </button>
      </div>
    </motion.div>
  );
}

function InitialAvatar({ seed }: { seed: string }) {
  const colors = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500'];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffff;
  return (
    <div className={`w-5 h-5 rounded-full ${colors[h % colors.length]} flex items-center justify-center shrink-0`}>
      <span className="text-[9px] font-bold text-white">{seed[0]?.toUpperCase() ?? '?'}</span>
    </div>
  );
}

function PermBadge({ permission }: { permission: string | null }) {
  if (!permission) return <span className="text-[11px] text-muted">iOS only</span>;
  if (permission === 'granted') return (
    <span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />On
    </span>
  );
  if (permission === 'denied') return <span className="text-[11px] text-red-400">Denied</span>;
  if (permission === 'unavailable') return <span className="text-[11px] text-muted">Unavailable</span>;
  return <span className="text-[11px] text-muted">Not granted</span>;
}
