'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { AuthProvider, useAuth } from '@/components/providers/AuthProvider';
import { signOut } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { useRef, useState, useEffect, useCallback } from 'react';
import { AnimatedThemeToggler } from '@/components/ui/animated-theme-toggler';
import { collection, query, where, onSnapshot, doc, setDoc } from 'firebase/firestore';
import CommandBar from '@/components/ui/CommandBar';
import { useMobileConnected } from '@/hooks/useMobileConnected';
import { Tooltip } from '@/components/ui/Tooltip';
import { MetaCheckoutTracker } from '@/components/MetaCheckoutTracker';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';

// Minimal inline SVG icons — stroke-based, 24x24 viewBox
function Ico({ d, d2, className }: { d: string; d2?: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`w-[18px] h-[18px] shrink-0 ${className ?? ''}`}
    >
      <path d={d} />
      {d2 && <path d={d2} />}
    </svg>
  );
}

const ICONS = {
  dashboard:   'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  briefing:    'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9',
  briefing2:   'M13.73 21a2 2 0 01-3.46 0',
  chat:        'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
  projects:    'M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z',
  goals:       'M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9',
  reminders:   'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  notes:       'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M8 13h8M8 17h5',
  group:       'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100 8 4 4 0 000-8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  connections: 'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71',
  settings:    'M12 2a10 10 0 110 20A10 10 0 0112 2zm0 5v5l3 3',
} as const;

type NavItem = { key: string; href: string; label: string; icon: keyof typeof ICONS; special?: 'briefing' };

// Primary group — the daily essentials, always visible (no group label).
// Briefing is no longer a destination — it now surfaces at the top of the
// Dashboard (the single "Today" home). The Dashboard item carries the unread
// briefing dot so "you have a new briefing" still has a nav signal. The full
// interactive /briefing page stays reachable via that hero + ⌘K.
const PRIMARY: NavItem[] = [
  { key: 'chat',      href: '/chat',      label: 'Chat',      icon: 'chat'      },
  { key: 'dashboard', href: '/dashboard', label: 'Dashboard', icon: 'dashboard', special: 'briefing' },
  { key: 'projects',  href: '/projects',  label: 'Projects',  icon: 'projects'  },
];

// Workspace group — collapsible, labeled "WORKSPACE".
const WORKSPACE: NavItem[] = [
  { key: 'goals',     href: '/goals',     label: 'Goals',     icon: 'goals'     },
  { key: 'reminders', href: '/reminders', label: 'Reminders', icon: 'reminders' },
];

// Bottom group — pinned above Settings.
const BOTTOM: NavItem[] = [
  { key: 'capabilities', href: '/capabilities', label: 'Capabilities', icon: 'connections' },
];

function NavLink({ item, pathname, onNavClick, collapsed }: { item: NavItem; pathname: string; onNavClick?: () => void; collapsed?: boolean }) {
  const active = pathname === item.href;
  const link = (
    <Link
      href={item.href}
      onClick={onNavClick}
      aria-label={collapsed ? item.label : undefined}
      className={`relative flex items-center rounded-xl text-sm font-medium transition-colors ${
        collapsed ? 'w-full justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'
      } ${active ? 'text-brand' : 'text-muted hover:text-text hover:bg-panel'}`}
    >
      {active && (
        <motion.div
          layoutId="nav-active-pill"
          className="absolute inset-0 rounded-xl surface-tint"
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        />
      )}
      <Ico d={ICONS[item.icon]} className="relative" />
      {!collapsed && <span className="relative">{item.label}</span>}
    </Link>
  );
  return collapsed ? <Tooltip label={item.label} side="right" className="w-full">{link}</Tooltip> : link;
}

// Live-subscribes to the user's sidebar prefs (hidden items + collapse state),
// stored in Firestore users/{uid}.settings.sidebar so they sync across devices.
function useSidebarPrefs(uid: string | undefined) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false);

  useEffect(() => {
    if (!uid) { setHidden(new Set()); setWorkspaceCollapsed(false); return; }
    const unsub = onSnapshot(doc(db, 'users', uid), snap => {
      const s = snap.data()?.settings;
      const sb = s?.sidebar;
      setHidden(new Set(Array.isArray(sb?.hidden) ? sb.hidden : []));
      setWorkspaceCollapsed(!!sb?.workspaceCollapsed);
      // Reduce-motion is synced across devices: reflect the stored pref onto
      // <html> (and cache it so the pre-paint script in the root layout can
      // restore it before first paint next load).
      try {
        const rm = !!s?.reduceMotion;
        document.documentElement.toggleAttribute('data-reduce-motion', rm);
        if (rm) localStorage.setItem('modus-reduce-motion', '1');
        else localStorage.removeItem('modus-reduce-motion');
      } catch { /* storage blocked — attribute still applied */ }
    });
    return unsub;
  }, [uid]);

  const toggleWorkspace = useCallback(() => {
    if (!uid) return;
    const next = !workspaceCollapsed;
    setWorkspaceCollapsed(next); // optimistic
    // Firestore merge is recursive for nested maps, so this leaves `hidden` intact.
    void setDoc(doc(db, 'users', uid), { settings: { sidebar: { workspaceCollapsed: next } } }, { merge: true });
  }, [uid, workspaceCollapsed]);

  return { hidden, workspaceCollapsed, toggleWorkspace };
}

// A NavLink that also shows an unread-briefing dot. Used for the Dashboard item
// now that the briefing lives on the dashboard (no standalone Briefing nav item).
function NavLinkWithBriefingDot({ item, pathname, onNavClick, collapsed }: { item: NavItem; pathname: string; onNavClick?: () => void; collapsed?: boolean }) {
  const { user } = useAuth();
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'users', user.uid, 'conversations'),
      where('briefing', '==', true),
      where('read', '==', false),
    );
    const unsub = onSnapshot(q, snap => setUnread(!snap.empty));
    return unsub;
  }, [user]);

  const active = pathname === item.href;

  const link = (
    <Link
      href={item.href}
      onClick={onNavClick}
      aria-label={collapsed ? item.label : undefined}
      className={`relative flex items-center rounded-xl text-sm font-medium transition-colors ${
        collapsed ? 'w-full justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'
      } ${active ? 'text-brand' : 'text-muted hover:text-text hover:bg-panel'}`}
    >
      {active && (
        <motion.div
          layoutId="nav-active-pill"
          className="absolute inset-0 rounded-xl surface-tint"
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        />
      )}
      <Ico d={ICONS[item.icon]} className="relative" />
      {!collapsed && <span className="relative flex-1">{item.label}</span>}
      {/* Collapsed: the dot rides the icon corner instead of the row's right edge */}
      {unread && !active && (
        collapsed
          ? <span className="absolute top-1.5 right-2.5 w-1.5 h-1.5 rounded-full bg-brand" />
          : <span className="relative w-1.5 h-1.5 rounded-full bg-brand shrink-0" />
      )}
    </Link>
  );
  return collapsed ? <Tooltip label={item.label} side="right" className="w-full">{link}</Tooltip> : link;
}

// Group left the sidebar when multi-seat moved to a future Enterprise section.
// /group and /api/group/* are still reachable by direct URL for any account that
// already has a groupId — this only stops advertising it.

function SidebarContent({
  pathname,
  user,
  open,
  setOpen,
  onCmdOpen,
  onNavClick,
  hidden,
  workspaceCollapsed,
  onToggleWorkspace,
  collapsed = false,
  onToggleCollapse,
}: {
  pathname: string;
  user: ReturnType<typeof useAuth>['user'];
  open: boolean;
  setOpen: (v: boolean) => void;
  onCmdOpen: () => void;
  onNavClick?: () => void;
  hidden: Set<string>;
  workspaceCollapsed: boolean;
  onToggleWorkspace: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  // Goals and Reminders are phone-sourced surfaces: keep them out of the sidebar
  // until the user connects the Modus phone app, then let them hide them anyway.
  const mobileConnected = useMobileConnected(user?.uid);
  const visibleWorkspace = WORKSPACE.filter(i => mobileConnected && !hidden.has(i.key));
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [setOpen]);

  return (
    <div className={`flex flex-col h-full py-5 ${collapsed ? 'px-2' : 'px-3'}`}>
      {/* Logo. Collapsed: the wordmark drops and the mark alone doubles as the expander. */}
      <div className={`mb-5 flex items-center ${collapsed ? 'justify-center' : 'px-3 gap-2'}`}>
        {collapsed ? (
          <Tooltip label="Expand sidebar" side="right">
            <button
              onClick={onToggleCollapse}
              aria-label="Expand sidebar"
              className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-panel transition-colors"
            >
              <Image src="/logo.png" alt="MODUS" width={28} height={21} className="object-contain block dark:hidden" />
              <Image src="/logo-dark.png" alt="MODUS" width={28} height={21} className="object-contain hidden dark:block" />
            </button>
          </Tooltip>
        ) : (
          <>
            <Image src="/logo.png" alt="MODUS" width={64} height={48} className="object-contain shrink-0 block dark:hidden" />
            <Image src="/logo-dark.png" alt="MODUS" width={64} height={48} className="object-contain shrink-0 hidden dark:block" />
            <div className="flex flex-col leading-none min-w-0 flex-1 overflow-hidden">
              <span className="text-sm font-black tracking-widest text-brand truncate">MODUS</span>
              <span className="text-[9px] font-semibold text-muted tracking-widest uppercase truncate">pilot</span>
            </div>
            {onToggleCollapse && (
              <Tooltip label="Collapse sidebar" side="right">
                <button
                  onClick={onToggleCollapse}
                  aria-label="Collapse sidebar"
                  className="ml-auto shrink-0 w-7 h-7 hidden md:flex items-center justify-center rounded-lg text-muted/60 hover:text-text hover:bg-panel transition-colors"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" />
                  </svg>
                </button>
              </Tooltip>
            )}
          </>
        )}
      </div>

      {/* Ask MODUS button */}
      {collapsed ? (
        <Tooltip label="Ask Modus  ⌘K" side="right" className="w-full">
          <button
            onClick={onCmdOpen}
            aria-label="Ask Modus"
            className="w-full flex items-center justify-center mb-4 py-2 rounded-xl border border-dashed border-border text-muted hover-border-tint hover:text-brand hover-surface-tint transition-all"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
          </button>
        </Tooltip>
      ) : (
        <motion.button
          onClick={onCmdOpen}
          whileHover={{ scale: 1.015, y: -1 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          className="flex items-center gap-2 mx-1 mb-4 px-3 py-2 rounded-xl border border-dashed border-border text-muted hover-border-tint hover:text-brand hover-surface-tint transition-all group"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <span className="flex-1 text-xs font-medium">Ask Modus</span>
          <div className="flex items-center gap-0.5">
            <kbd className="text-[9px] bg-bg border border-border/60 rounded px-1 py-0.5 font-mono leading-none">⌘</kbd>
            <kbd className="text-[9px] bg-bg border border-border/60 rounded px-1 py-0.5 font-mono leading-none">K</kbd>
          </div>
        </motion.button>
      )}

      {/* Nav */}
      <LayoutGroup>
        <nav className="group/nav flex flex-col gap-0.5 flex-1">
          {/* Primary group — daily essentials */}
          {PRIMARY.filter(i => i.key === 'chat' || !hidden.has(i.key)).map(item =>
            item.special === 'briefing'
              ? <NavLinkWithBriefingDot key={item.key} item={item} pathname={pathname} onNavClick={onNavClick} collapsed={collapsed} />
              : <NavLink key={item.key} item={item} pathname={pathname} onNavClick={onNavClick} collapsed={collapsed} />
          )}

          {/* Workspace group — collapsible. When the sidebar is icons-only there's
              no room for the label, so the group header drops and its items always
              show (a hidden group behind an invisible header would be unreachable). */}
          {visibleWorkspace.length > 0 && (
            <div className="mt-3">
              {collapsed ? (
                /* Matches the bottom group's border-border/50, not full-strength */
                <div className="mx-2 mb-1.5 h-px bg-border/50" />
              ) : (
                <button
                  onClick={onToggleWorkspace}
                  className="flex items-center gap-1.5 w-full px-3 mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted/70 hover:text-muted transition-colors"
                >
                  <span className="flex-1 text-left">Workspace</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round"
                    className={`w-3 h-3 shrink-0 transition-transform ${workspaceCollapsed ? '-rotate-90' : ''}`}>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              )}
              <AnimatePresence initial={false}>
                {(collapsed || !workspaceCollapsed) && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden flex flex-col gap-0.5"
                  >
                    {visibleWorkspace.map(item => (
                      <NavLink key={item.key} item={item} pathname={pathname} onNavClick={onNavClick} collapsed={collapsed} />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Bottom group — Capabilities + Settings */}
          <div className="mt-2 pt-2 border-t border-border/50 flex flex-col gap-0.5">
            {BOTTOM.filter(i => !hidden.has(i.key)).map(item => (
              <NavLink key={item.key} item={item} pathname={pathname} onNavClick={onNavClick} collapsed={collapsed} />
            ))}
            <NavLink
              item={{ key: 'settings', href: '/settings', label: 'Settings', icon: 'settings' }}
              pathname={pathname} onNavClick={onNavClick} collapsed={collapsed}
            />
            {/* Customize — subtle, revealed on sidebar hover. No room when icons-only. */}
            {!collapsed && (
              <Link href="/settings?tab=sidebar" onClick={onNavClick}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-medium text-muted/50 hover:text-muted opacity-0 group-hover/nav:opacity-100 focus:opacity-100 transition-opacity"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0">
                  <path d="M12 2a10 10 0 110 20A10 10 0 0112 2z" /><path d="M12 8v4l2.5 2.5" />
                </svg>
                Customize sidebar
              </Link>
            )}
          </div>
        </nav>
      </LayoutGroup>

      {/* User menu */}
      <div className="mt-auto pt-3 border-t border-border" ref={menuRef}>
        <div className={`px-2 pb-2 flex ${collapsed ? 'justify-center' : 'justify-end'}`}>
          <Tooltip label="Toggle theme" side={collapsed ? 'right' : 'left'}>
            <AnimatedThemeToggler sound={false} />
          </Tooltip>
        </div>
        {open && user && !collapsed && (
          <div className="mb-2 bg-panel border border-border rounded-xl overflow-hidden shadow-lg">
            <Link href="/settings?tab=billing" onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-3 text-sm text-muted hover:text-text hover:bg-bg transition-colors">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M21 4H3a2 2 0 00-2 2v12a2 2 0 002 2h18a2 2 0 002-2V6a2 2 0 00-2-2zM1 10h22" /></svg>
              Upgrade Plan
            </Link>
            <button onClick={() => { signOut(auth); setOpen(false); }}
              className="flex items-center gap-3 w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-red-900/10 transition-colors border-t border-border">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>
              Sign Out
            </button>
          </div>
        )}
        {user ? (
          collapsed ? (
            /* Icons-only: the avatar links straight to Settings — a dropdown has
               nowhere to sit in a 64px rail. */
            <Tooltip label={user.displayName || user.email || 'Account'} side="right" className="w-full">
              <Link href="/settings" onClick={onNavClick} aria-label="Account"
                className="flex items-center justify-center w-full py-2 rounded-xl hover:bg-panel transition-colors">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="" className="w-7 h-7 rounded-full shrink-0 ring-1 ring-border" />
                ) : (
                  <div className="w-7 h-7 rounded-full surface-tint-strong flex items-center justify-center shrink-0">
                    <span className="text-xs text-brand font-semibold">{(user.displayName || user.email || '?')[0].toUpperCase()}</span>
                  </div>
                )}
              </Link>
            </Tooltip>
          ) : (
            <button onClick={() => setOpen(!open)}
              className="flex items-center gap-2.5 w-full px-2 py-2 rounded-xl hover:bg-panel transition-colors">
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="w-7 h-7 rounded-full shrink-0 ring-1 ring-border" />
              ) : (
                <div className="w-7 h-7 rounded-full surface-tint-strong flex items-center justify-center shrink-0">
                  <span className="text-xs text-brand font-semibold">{(user.displayName || user.email || '?')[0].toUpperCase()}</span>
                </div>
              )}
              <div className="flex-1 min-w-0 text-left">
                <p className="text-xs text-text font-medium truncate">{user.displayName || user.email}</p>
                <p className="text-[10px] text-muted">Account</p>
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-muted">
                <path d={open ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'} />
              </svg>
            </button>
          )
        ) : (
          <Link href="/login"
            className={`flex items-center rounded-xl text-sm font-medium text-muted hover:text-text hover:bg-panel transition-colors ${collapsed ? 'justify-center py-2.5' : 'gap-3 px-3 py-2.5'}`}>
            <Ico d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" />{!collapsed && 'Sign in'}
          </Link>
        )}
      </div>
    </div>
  );
}

// 180 was narrower than the header needs (logo + wordmark + collapse button),
// so at the low end the button overflowed the aside and landed on the next
// panel. Measured: the wordmark starts truncating below ~216, so 220 is the
// narrowest width the header actually fits in.
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 320;
const SIDEBAR_DEFAULT = 224;
// Icons-only rail. Drag narrower than SIDEBAR_SNAP and it snaps to this.
const SIDEBAR_COLLAPSED = 64;
const SIDEBAR_SNAP = 140;

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const { hidden, workspaceCollapsed, toggleWorkspace } = useSidebarPrefs(user?.uid);
  const [open, setOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(SIDEBAR_DEFAULT);
  const dragCurrentWidth = useRef(SIDEBAR_DEFAULT);
  const dragCollapsed = useRef(false);

  // Load persisted width + collapsed state
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-width');
    if (saved) {
      const w = Number(saved);
      if (w >= SIDEBAR_MIN && w <= SIDEBAR_MAX) {
        setSidebarWidth(w);
        dragCurrentWidth.current = w;
      }
    }
    if (localStorage.getItem('sidebar-collapsed') === '1') {
      setCollapsed(true);
      dragCollapsed.current = true;
    }
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed(c => {
      const next = !c;
      dragCollapsed.current = next;
      localStorage.setItem('sidebar-collapsed', next ? '1' : '0');
      return next;
    });
  }, []);

  // Close mobile sidebar on route change
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Accounts-only: MODUS requires an account — there is no anonymous/guest
  // access. AuthProvider resolves auth before rendering us (it shows a spinner
  // until then), so a null user here means signed-out → send them to login.
  useEffect(() => {
    if (!user) router.replace('/login');
  }, [user, router]);

  // Global Cmd+K / Ctrl+K listener
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen(o => !o);
      }
      if (e.key === 'Escape') { setCmdOpen(false); setMobileOpen(false); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function startSidebarDrag(e: React.MouseEvent) {
    dragStartX.current = e.clientX;
    // Drag from the rail's real edge when collapsed, so pulling right expands it.
    dragStartWidth.current = collapsed ? SIDEBAR_COLLAPSED : sidebarWidth;
    dragCurrentWidth.current = sidebarWidth;
    setDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(ev: MouseEvent) {
      const raw = dragStartWidth.current + ev.clientX - dragStartX.current;
      // Below the snap point the sidebar becomes the icons-only rail; drag back
      // past it and it re-expands to the last real width.
      if (raw < SIDEBAR_SNAP) {
        if (!dragCollapsed.current) {
          dragCollapsed.current = true;
          setCollapsed(true);
        }
        return;
      }
      if (dragCollapsed.current) {
        dragCollapsed.current = false;
        setCollapsed(false);
      }
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, raw));
      setSidebarWidth(w);
      dragCurrentWidth.current = w;
    }

    function onUp() {
      setDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('sidebar-width', String(dragCurrentWidth.current));
      localStorage.setItem('sidebar-collapsed', dragCollapsed.current ? '1' : '0');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Guests never see the app shell — render a brief spinner while the redirect
  // to /login fires (the effect above), matching AuthProvider's loading state.
  if (!user) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="modus-app flex h-screen overflow-hidden bg-bg max-w-[100vw]">
      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex shrink-0 border-r border-border flex-col relative ${dragging ? '' : 'transition-[width] duration-200 ease-out'}`}
        style={{ width: collapsed ? SIDEBAR_COLLAPSED : sidebarWidth }}
      >
        <SidebarContent
          pathname={pathname} user={user} open={open} setOpen={setOpen}
          onCmdOpen={() => setCmdOpen(true)}
          hidden={hidden}
          workspaceCollapsed={workspaceCollapsed} onToggleWorkspace={toggleWorkspace}
          collapsed={collapsed} onToggleCollapse={toggleCollapse}
        />
        {/* Drag handle */}
        <div
          className="absolute inset-y-0 right-0 w-1 cursor-col-resize hover-surface-tint0 active:bg-brand/60 transition-colors z-10"
          onMouseDown={startSidebarDrag}
        />
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              initial={{ x: -224 }}
              animate={{ x: 0 }}
              exit={{ x: -224 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-y-0 left-0 z-50 w-56 bg-bg border-r border-border md:hidden"
            >
              <SidebarContent
                pathname={pathname} user={user} open={open} setOpen={setOpen}
                onCmdOpen={() => { setCmdOpen(true); setMobileOpen(false); }}
                onNavClick={() => setMobileOpen(false)}
                hidden={hidden}
                workspaceCollapsed={workspaceCollapsed} onToggleWorkspace={toggleWorkspace}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <main className="flex-1 overflow-hidden overflow-x-hidden flex flex-col min-w-0">
        {/* Mobile header bar */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="w-8 h-8 flex items-center justify-center text-muted hover:text-text transition-colors rounded-lg hover:bg-panel"
            aria-label="Open menu"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="flex items-center gap-1.5">
            <Image src="/logo.png" alt="MODUS" width={48} height={36} className="object-contain block dark:hidden" />
            <Image src="/logo-dark.png" alt="MODUS" width={48} height={36} className="object-contain hidden dark:block" />
            <span className="text-xs font-black tracking-widest text-brand">MODUS</span>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden overflow-x-hidden">
          {children}
        </div>
      </main>

      <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} user={user} />
      <MetaCheckoutTracker user={user} />
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardLayoutInner>{children}</DashboardLayoutInner>
    </AuthProvider>
  );
}
