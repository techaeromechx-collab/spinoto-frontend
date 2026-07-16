import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
// search state is local to AppShell — no API change
import { useAuth } from '../auth/AuthContext.jsx';
import { useUpload } from '../context/UploadContext.jsx';
import { usePushNotifications } from '../hooks/usePushNotifications.js';
import {
  LayoutDashboard,
  MapPin,
  Car,
  Wrench,
  Users,
  UserCog,
  Users2,
  UploadCloud,
  BarChart3,
  LogOut,
  ChevronDown,
  ChevronRight,
  Database,
  Moon,
  Sun,
  Menu,
  X,
  Tag,
  Building2,
  Bell,
  UserCheck,
  CheckCheck,
  AlertTriangle,
  Flame,
  Clock,
  Target,
  ZapOff,
  TrendingUp,
  Copy,
  UserPlus,
  Trophy,
  Activity,
  User,
  Settings,
  Search,
  Phone,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Network,
  Calendar,
  FileText,
  Package,
  ReceiptText,
  Receipt,
  Wallet,
  Shield,
  Zap,
  Percent,
  ShieldCheck,
} from 'lucide-react';

// ── Notification type → { icon, bg, color, label } ────────────────────────
const NOTIF_META = {
  overdue_lead:       { Icon: AlertTriangle, bg: '#fee2e2', color: '#dc2626', label: 'Overdue'      },
  high_priority_lead: { Icon: Flame,         bg: '#ffedd5', color: '#ea580c', label: 'High Priority' },
  missed_followup:    { Icon: Clock,         bg: '#fee2e2', color: '#dc2626', label: 'Missed F/U'   },
  daily_target:       { Icon: Target,        bg: '#fef9c3', color: '#ca8a04', label: 'Target'       },
  inactive_lead:      { Icon: ZapOff,        bg: '#f3f4f6', color: '#6b7280', label: 'Inactive'     },
  lead_escalation:    { Icon: TrendingUp,    bg: '#f3e8ff', color: '#9333ea', label: 'Escalated'    },
  duplicate_lead:     { Icon: Copy,          bg: '#dbeafe', color: '#2563eb', label: 'Duplicate'    },
  lead_assigned:      { Icon: UserPlus,      bg: '#dcfce7', color: '#16a34a', label: 'Assigned'     },
  lead_converted:     { Icon: Trophy,        bg: '#dcfce7', color: '#16a34a', label: 'Converted'    },
  no_activity:        { Icon: Activity,      bg: '#ffedd5', color: '#ea580c', label: 'No Lead Activity'  },
  follow_up_scheduled:{ Icon: Clock,         bg: '#dbeafe', color: '#2563eb', label: 'Follow-up'    },
  note_added:         { Icon: Activity,      bg: '#fef9c3', color: '#d97706', label: 'Note Added'   },
  appointment_reminder:{ Icon: Bell,         bg: '#f3e8ff', color: '#7c3aed', label: 'Reminder'     },
  pricing_changed:     { Icon: Percent,      bg: '#dcfce7', color: '#15803d', label: 'Pricing'      },
  reference_data_changed:{ Icon: Database,   bg: '#e0e7ff', color: '#4338ca', label: 'Reference Data' },
};

function getNotifMeta(type) {
  return NOTIF_META[type] || { Icon: Bell, bg: '#dbeafe', color: '#2563eb', label: '' };
}
import { motion, AnimatePresence } from 'framer-motion';
import NewLeadModal from './NewLeadModal.jsx';
import { api } from '../api/client.js';
import '../styles/AppShell.css';

// Each nav item declares the permissions it requires (any of). An empty
// `permissions` array means "any authenticated user". Sub-items inherit
// visibility from their own `permissions` field.
// Fixed section order for the grouped sidebar — a section header only
// renders if at least one of its items survives permission filtering.
const NAV_SECTIONS = ['OVERVIEW', 'WORKFLOW', 'SALES', 'ACCOUNTING', 'CUSTOMERS', 'SYSTEM'];

const NAV_ITEMS = [
  // ── Overview ──────────────────────────────────────────────────────────────
  { label: 'Dashboard',    to: '/',           permissions: [],                            icon: LayoutDashboard, section: 'OVERVIEW' },

  // ── Workflow ──────────────────────────────────────────────────────────────
  {
    label: 'Master Data',
    permissions: ['MANAGE_MASTER_DATA','VIEW_VEHICLE','VIEW_SERVICE','VIEW_PRICING_RULE','MANAGE_PARTS','MANAGE_DISCOUNTS','CREATE_PART','EDIT_PART','CREATE_DISCOUNT','EDIT_DISCOUNT','CREATE_SERVICE','UPDATE_SERVICE','CREATE_VEHICLE','UPDATE_VEHICLE'],
    icon: Database,
    section: 'WORKFLOW',
    children: [
      { label: 'Locations',          to: '/master/locations',     permissions: ['MANAGE_MASTER_DATA'],                                          icon: MapPin    },
      { label: 'Vehicles',           to: '/master/vehicles',      permissions: ['VIEW_VEHICLE','CREATE_VEHICLE','UPDATE_VEHICLE','MANAGE_MASTER_DATA'], icon: Car       },
      { label: 'Services & Pricing', to: '/master/services',      permissions: ['VIEW_SERVICE','VIEW_PRICING_RULE','MANAGE_MASTER_DATA','MANAGE_PRICING'], icon: Wrench    },
      { label: 'Lead Status',        to: '/master/lead-statuses', permissions: ['MANAGE_MASTER_DATA'],                                          icon: Tag       },
      { label: 'Departments',        to: '/master/departments',   permissions: ['MANAGE_MASTER_DATA'],                                          icon: Building2 },
      { label: 'Parts',              to: '/master/parts',         permissions: ['MANAGE_PARTS','CREATE_PART','EDIT_PART','DELETE_PART','MANAGE_MASTER_DATA'], icon: Package   },
      { label: 'Discounts',          to: '/master/discounts',     permissions: ['MANAGE_DISCOUNTS','CREATE_DISCOUNT','EDIT_DISCOUNT','DELETE_DISCOUNT','MANAGE_MASTER_DATA'], icon: Percent   },
      { label: 'Warranty & Guarantee', to: '/master/warranties',  permissions: ['MANAGE_WARRANTIES','CREATE_WARRANTY','EDIT_WARRANTY','DELETE_WARRANTY','MANAGE_MASTER_DATA'], icon: ShieldCheck },
    ],
  },
  { label: 'HUBs',         to: '/hubs',         permissions: ['VIEW_HUB','MANAGE_HUBS','CREATE_HUB','EDIT_HUB'], icon: Network, section: 'WORKFLOW' },
  { label: 'Leads',        to: '/leads',        permissions: ['VIEW_LEAD','VIEW_TEAM_LEADS','VIEW_OWN_LEADS','CREATE_LEAD'], icon: Users, section: 'WORKFLOW' },
  { label: 'Appointments', to: '/appointments', permissions: ['VIEW_APPOINTMENT','VIEW_LEAD','CREATE_APPOINTMENT'], icon: Calendar, section: 'WORKFLOW' },

  // ── Sales ─────────────────────────────────────────────────────────────────
  { label: 'Estimates',          to: '/estimates',         permissions: ['VIEW_ESTIMATE','CREATE_ESTIMATE','EDIT_ESTIMATE'],     icon: FileText, section: 'SALES' },
  { label: 'Customer Invoices', to: '/customer-invoices', permissions: ['VIEW_INVOICE','CREATE_INVOICE','EDIT_INVOICE'],         icon: Receipt, section: 'SALES' },

  // ── Accounting ────────────────────────────────────────────────────────────
  { label: 'Purchase Invoices', to: '/purchase-invoices', permissions: ['VIEW_PURCHASE_INVOICE','CREATE_PURCHASE_INVOICE','APPROVE_PURCHASE_INVOICE'], icon: ReceiptText, section: 'ACCOUNTING' },
  { label: 'Hub Payouts',       to: '/payouts',           permissions: ['VIEW_PURCHASE_INVOICE','VIEW_HUB','MANAGE_HUBS'],       icon: Wallet, section: 'ACCOUNTING' },

  // ── Customers ─────────────────────────────────────────────────────────────
  { label: 'Customers',         to: '/customers',         permissions: ['VIEW_CUSTOMER','VIEW_LEAD','CREATE_LEAD'],              icon: Users2, section: 'CUSTOMERS' },
  { label: 'Claims',            to: '/warranty-claims',   permissions: ['VIEW_CLAIM','CREATE_CLAIM','APPROVE_CLAIM','RESOLVE_CLAIM','MANAGE_CLAIMS'], icon: ShieldCheck, section: 'CUSTOMERS' },

  // ── System ────────────────────────────────────────────────────────────────
  { label: 'Bulk Upload', to: '/bulk-upload', permissions: ['BULK_UPLOAD'],             icon: UploadCloud, section: 'SYSTEM' },
  { label: 'Reports',     to: '/reports',     permissions: ['VIEW_REPORTS'],            icon: BarChart3, section: 'SYSTEM' },
  { label: 'Users',        to: '/users',        permissions: ['MANAGE_USERS'],                                          icon: UserCog, section: 'SYSTEM' },
  { label: 'My Team',     to: '/users',        permissions: ['VIEW_TEAM_LEADS'], excludePermissions: ['MANAGE_USERS'], icon: Users2, section: 'SYSTEM'  },
  { label: 'Super Admins', to: '/super-admins', superAdminOnly: true,                                                   icon: Shield, section: 'SYSTEM'  },
];

export default function AppShell({ children }) {
  const { user, logout, can } = useAuth();
  usePushNotifications(user); // register push subscription silently after login
  const navigate = useNavigate();
  const location = useLocation();
  const { activeEntries } = useUpload();
  const [masterOpen, setMasterOpen] = useState(location.pathname.startsWith('/master'));

  const [theme, setTheme] = useState(localStorage.getItem('spinoto_theme') || 'light');
  const [isLeadModalOpen, setLeadModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    return localStorage.getItem('spinoto_sidebar_collapsed') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('spinoto_sidebar_collapsed', isCollapsed);
  }, [isCollapsed]);

  // On mobile, sidebar is always fully expanded regardless of desktop collapse state
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const isMobile = windowWidth <= 768;
  const effectiveCollapsed = isMobile ? false : isCollapsed;

  // ── Topbar user dropdown ─────────────────────────────────────────────────
  const [userDropOpen, setUserDropOpen] = useState(false);
  const userDropRef = useRef(null);
  useEffect(() => {
    function onOut(e) {
      if (userDropRef.current && !userDropRef.current.contains(e.target)) setUserDropOpen(false);
    }
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, []);

  // ── Global search ─────────────────────────────────────────────────────────
  const [searchQ,       setSearchQ]       = useState('');
  const [searchResults, setSearchResults] = useState({ leads: [], users: [] });
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearchDrop, setShowSearchDrop] = useState(false);
  const searchRef     = useRef(null);
  const searchWrapRef = useRef(null);
  const searchTimer   = useRef(null);

  const canSearchUsers = useMemo(() => can('MANAGE_USERS', 'VIEW_TEAM_LEADS'), [can]);

  // Debounced search
  useEffect(() => {
    const q = searchQ.trim();
    if (!q) { setSearchResults({ leads: [], users: [] }); setShowSearchDrop(false); return; }
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const promises = [api(`/api/leads?search=${encodeURIComponent(q)}&limit=6`)];
        if (canSearchUsers) promises.push(api(`/api/users`));
        const [leadsRes, usersRes] = await Promise.all(promises);
        const leads = leadsRes?.items || [];
        const users = canSearchUsers
          ? (usersRes?.items || []).filter(u =>
              u.name.toLowerCase().includes(q.toLowerCase()) ||
              u.email.toLowerCase().includes(q.toLowerCase())
            ).slice(0, 4)
          : [];
        setSearchResults({ leads: leads.slice(0, 6), users });
        setShowSearchDrop(true);
      } catch { /* silent */ }
      finally { setSearchLoading(false); }
    }, 280);
    return () => clearTimeout(searchTimer.current);
  }, [searchQ, canSearchUsers]);

  // Close search dropdown on outside click
  useEffect(() => {
    function onOut(e) {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target)) {
        setShowSearchDrop(false);
      }
    }
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, []);

  // ⌘K / Ctrl+K focuses the search bar
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        setShowSearchDrop(!!searchQ.trim());
      }
      if (e.key === 'Escape') { setShowSearchDrop(false); searchRef.current?.blur(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [searchQ]);

  function handleSearchSubmit(e) {
    e.preventDefault();
    if (searchQ.trim()) {
      setShowSearchDrop(false);
      navigate(`/leads?search=${encodeURIComponent(searchQ.trim())}`);
      searchRef.current?.blur();
    }
  }

  function handleSearchSelectLead(lead) {
    setShowSearchDrop(false);
    setSearchQ('');
    navigate('/leads', { state: { openLeadId: lead.id } });
  }

  function handleSearchSelectUser(u) {
    setShowSearchDrop(false);
    setSearchQ('');
    navigate('/users', { state: { openUserId: u.id } });
  }

  const hasSearchResults = searchResults.leads.length > 0 || searchResults.users.length > 0;

  // ── Profile password modal ─────────────────────────────────────────────────
  const [pwOpen, setPwOpen]       = useState(false);
  const [curPw,  setCurPw]        = useState('');
  const [newPw,  setNewPw]        = useState('');
  const [pwBusy, setPwBusy]       = useState(false);
  const [pwErr,  setPwErr]        = useState('');
  const [pwOk,   setPwOk]         = useState(false);

  async function handleChangePw(e) {
    e.preventDefault();
    setPwErr(''); setPwOk(false); setPwBusy(true);
    try {
      await api('/api/me/password', { method: 'PATCH', body: { current_password: curPw, new_password: newPw } });
      setPwOk(true); setCurPw(''); setNewPw('');
    } catch (err) { setPwErr(err.message); }
    finally { setPwBusy(false); }
  }

  // ── Notifications ──────────────────────────────────────────────────────────
  const [notifOpen,  setNotifOpen]  = useState(false);
  const [notifCount, setNotifCount] = useState(0);
  const [notifItems, setNotifItems] = useState([]);
  const notifRef = useRef(null);

  const fetchCount = useCallback(async () => {
    try {
      const r = await api('/api/notifications/unread-count');
      setNotifCount(r.count || 0);
    } catch { /* silent */ }
  }, []);

  const fetchNotifs = useCallback(async () => {
    try {
      const r = await api('/api/notifications');
      setNotifItems(r.items || []);
    } catch { /* silent */ }
  }, []);

  // Poll unread count every 30s
  useEffect(() => {
    fetchCount();
    const iv = setInterval(fetchCount, 30000);
    return () => clearInterval(iv);
  }, [fetchCount]);

  // Open: load notifications
  useEffect(() => {
    if (notifOpen) fetchNotifs();
  }, [notifOpen, fetchNotifs]);

  // Close on outside click
  useEffect(() => {
    function onOut(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    }
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, []);

  function getNotifRoute(n) {
    // Appointment reminder → appointments page
    if (n.type === 'appointment_reminder') return ['/appointments', {}];
    // User-level alerts with no specific lead → leads page (general)
    if (['daily_target', 'no_activity'].includes(n.type)) return ['/leads', {}];
    // All lead-linked notifications → open that lead's detail modal
    if (n.lead_id) return ['/leads', { state: { openLeadId: n.lead_id } }];
    // Fallback
    return [null, {}];
  }

  async function handleMarkRead(n) {
    try {
      await api(`/api/notifications/${n.id}/read`, { method: 'PATCH' });
      setNotifItems(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
      setNotifCount(c => Math.max(0, c - 1));
      const [path, opts] = getNotifRoute(n);
      if (path) { setNotifOpen(false); navigate(path, opts); }
    } catch { /* silent */ }
  }

  async function handleMarkAllRead() {
    try {
      await api('/api/notifications/read-all', { method: 'PATCH' });
      setNotifItems(prev => prev.map(x => ({ ...x, is_read: true })));
      setNotifCount(0);
    } catch { /* silent */ }
  }

  async function handleClearAll() {
    try {
      await api('/api/notifications', { method: 'DELETE' });
      setNotifItems([]);
      setNotifCount(0);
    } catch { /* silent */ }
  }

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  useEffect(() => {
    const handleOpen = () => setLeadModalOpen(true);
    window.addEventListener('open-lead-modal', handleOpen);
    return () => window.removeEventListener('open-lead-modal', handleOpen);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('spinoto_theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light');

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Filter nav by permissions. A nav group is shown if AT LEAST ONE of its
  // children is visible. An empty `permissions` array means visible to all.
  const itemVisible = (it) => {
    if (it.superAdminOnly) return !!user?.is_super_admin;
    if (it.excludePermissions?.length && can(...it.excludePermissions)) return false;
    return it.permissions?.length ? can(...it.permissions) : !!user;
  };
  const filteredNav = NAV_ITEMS
    .map((item) => {
      if (!item.children) return itemVisible(item) ? item : null;
      const children = item.children.filter(itemVisible);
      return children.length ? { ...item, children } : null;
    })
    .filter(Boolean);

  // Group the permission-filtered nav into fixed sections, dropping any
  // section that has no visible items.
  const groupedNav = NAV_SECTIONS
    .map((section) => ({
      section,
      items: filteredNav.filter((item) => item.section === section),
    }))
    .filter((g) => g.items.length);

  const userBadge = user?.is_super_admin ? 'super admin' : 'user';

  return (
    <div className={`shell ${effectiveCollapsed ? 'collapsed' : ''}`}>
      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div className="sidebar-backdrop" onClick={() => setMobileMenuOpen(false)} />
      )}

      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''} ${effectiveCollapsed ? 'collapsed' : ''}`}>
        <div className="brand">
          {!effectiveCollapsed && <img src="/logo.svg" alt="Spinoto" style={{ height: 24, width: 'auto', display: 'block' }} />}
          {effectiveCollapsed && <img src="/logo.svg" alt="Spinoto" style={{ height: 18, width: 'auto', display: 'block' }} />}
          {!isMobile && (
            <button className="sidebar-toggle" onClick={() => setIsCollapsed(!isCollapsed)} title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}>
              {isCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
          )}
        </div>
        <nav>
          {groupedNav.map((group) => (
            <div key={group.section} className="nav-section">
              {!effectiveCollapsed && <div className="nav-section-label">{group.section}</div>}
              {group.items.map((item) => {
                if (item.children) {
                  return (
                    <div key={item.label} className="nav-group">
                      <button
                        className={`nav-group-header ${masterOpen ? 'open' : ''} ${location.pathname.startsWith('/master') ? 'active-parent' : ''}`}
                        onClick={() => setMasterOpen(!masterOpen)}
                      >
                        <div className="label-wrap">
                          <item.icon size={18} strokeWidth={2} />
                          {!effectiveCollapsed && item.label}
                        </div>
                        {!effectiveCollapsed && (masterOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
                      </button>
                      <AnimatePresence>
                        {masterOpen && !effectiveCollapsed && (
                          <motion.div
                            className="nav-group-children"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            {item.children.map(child => (
                              <NavLink key={child.to} to={child.to} className={({ isActive }) => isActive ? 'active' : ''}>
                                <child.icon size={16} strokeWidth={2} />
                                {child.label}
                              </NavLink>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                }
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) => isActive ? 'active' : ''}
                    end={item.to === '/'}
                  >
                    <item.icon size={18} strokeWidth={2} />
                    {!effectiveCollapsed && item.label}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        {/* ── Sidebar profile card ── */}
        <div
          className="sidebar-profile"
          onClick={() => {
            if (user?.is_super_admin) navigate('/profile?tab=superadmin');
            else if (can('MANAGE_USERS')) navigate('/profile?tab=admin');
            else if (can('VIEW_TEAM_LEADS')) navigate('/profile?tab=team');
            else navigate('/profile?tab=overview');
          }}
          title="View profile"
        >
          <div className="sidebar-profile-avatar">
            {user?.name?.charAt(0).toUpperCase()}
          </div>
          {!effectiveCollapsed && (
            <div className="sidebar-profile-info">
              <div className="sidebar-profile-name">{user?.name}</div>
              <div className="sidebar-profile-hint">
                {user?.is_super_admin ? 'Super Admin Panel'
                  : user?.role_name ? user.role_name
                  : 'View my profile'}
              </div>
            </div>
          )}
          {!effectiveCollapsed && (
            <button className="sidebar-profile-logout" onClick={(e) => { e.stopPropagation(); handleLogout(); }} title="Logout">
              <LogOut size={15} />
            </button>
          )}
        </div>

        {/* ── Change password modal ── */}
        {pwOpen && (
          <div className="sp-pw-overlay" onClick={() => setPwOpen(false)}>
            <form className="sp-pw-modal" onSubmit={handleChangePw} onClick={e => e.stopPropagation()}>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Change Password</h4>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>Update your login password.</p>
              {pwErr && <div style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>{pwErr}</div>}
              {pwOk  && <div style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>Password updated successfully!</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Current Password</label>
                  <input type="password" required value={curPw} onChange={e => setCurPw(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>New Password</label>
                  <input type="password" required minLength={6} value={newPw} onChange={e => setNewPw(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setPwOpen(false)}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="submit" disabled={pwBusy}
                  style={{ padding: '8px 16px', borderRadius: 8, border: 0, background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: pwBusy ? 0.6 : 1 }}>
                  {pwBusy ? 'Saving…' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        )}
      </aside>

      <main className="main">
        <header className="topbar">
          {/* ── Left: breadcrumbs & mobile menu ── */}
          <div className="topbar-left">
            <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(true)}>
              <Menu size={20} />
            </button>
            <div className="crumbs">
              <Link to="/">Home</Link>
              {location.pathname !== '/' && (() => {
                const segments = location.pathname.split('/').filter(Boolean);
                // Detail views (/entity/:token) get a 3-level crumb —
                // Home > Entity > token — so the entity name isn't lost
                // behind the opaque token. Entity crumb links back to the list.
                const TOKEN_ENTITIES = ['leads', 'appointments', 'estimates', 'purchase-invoices', 'customer-invoices', 'customers'];
                if (segments.length === 2 && TOKEN_ENTITIES.includes(segments[0])) {
                  return (
                    <>
                      <ChevronRight size={12} className="mx-1" />
                      <Link to={`/${segments[0]}`} className="capitalize">{segments[0].replace(/-/g, ' ')}</Link>
                      <ChevronRight size={12} className="mx-1" />
                      <span className="capitalize crumb-token">{segments[1]}</span>
                    </>
                  );
                }
                return (
                  <>
                    <ChevronRight size={12} className="mx-1" />
                    <span className="capitalize">{segments.pop()?.replace(/-/g, ' ')}</span>
                  </>
                );
              })()}
            </div>
          </div>


          {/* ── Center: global search ── */}
          <div className="topbar-center" ref={searchWrapRef}>
            <form className="topbar-search-wrap" onSubmit={handleSearchSubmit}>
              <svg className="topbar-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input
                ref={searchRef}
                className="topbar-search-input"
                placeholder="Search leads, users…"
                value={searchQ}
                onChange={e => { setSearchQ(e.target.value); }}
                onFocus={() => { if (searchQ.trim() && hasSearchResults) setShowSearchDrop(true); }}
                autoComplete="off"
                spellCheck="false"
              />
              {searchLoading
                ? <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>…</span>
                : <kbd className="topbar-search-kbd">⌘K</kbd>
              }
            </form>

            {/* Search suggestions dropdown */}
            {showSearchDrop && (searchLoading || hasSearchResults) && (
              <div className="gsearch-drop">
                {searchLoading && !hasSearchResults && (
                  <div className="gsearch-loading">Searching…</div>
                )}
                {!searchLoading && !hasSearchResults && (
                  <div className="gsearch-empty">No results for "{searchQ}"</div>
                )}

                {searchResults.leads.length > 0 && (
                  <div>
                    <div className="gsearch-group-label">Leads</div>
                    {searchResults.leads.map(lead => (
                      <button
                        key={lead.id}
                        type="button"
                        className="gsearch-item"
                        onMouseDown={() => handleSearchSelectLead(lead)}
                      >
                        <div className="gsearch-item-icon gsearch-item-icon--lead">
                          <Users size={13}/>
                        </div>
                        <div className="gsearch-item-body">
                          <div className="gsearch-item-name">{lead.name || lead.mobile}</div>
                          <div className="gsearch-item-meta">
                            {lead.mobile && <span><Phone size={10}/> {lead.mobile}</span>}
                            {lead.status_name && <span style={{ background: lead.status_bg_color || '#dbeafe', color: lead.status_color || '#1d4ed8', borderRadius: 4, padding: '0 5px', fontSize: 10, fontWeight: 700 }}>{lead.status_name}</span>}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {searchResults.users.length > 0 && (
                  <div>
                    <div className="gsearch-group-label">Users</div>
                    {searchResults.users.map(u => (
                      <button
                        key={u.id}
                        type="button"
                        className="gsearch-item"
                        onMouseDown={() => handleSearchSelectUser(u)}
                      >
                        <div className="gsearch-item-icon gsearch-item-icon--user">
                          <User size={13}/>
                        </div>
                        <div className="gsearch-item-body">
                          <div className="gsearch-item-name">{u.name}</div>
                          <div className="gsearch-item-meta">
                            <span>{u.email}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {searchQ.trim() && (
                  <button
                    type="button"
                    className="gsearch-see-all"
                    onMouseDown={handleSearchSubmit}
                  >
                    <Search size={12}/> See all results for "<strong>{searchQ}</strong>"
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="topbar-actions">
            <button className="theme-toggle" onClick={toggleTheme} title="Toggle Theme">
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>

            {/* ── Notification Bell ── */}
            <div className="notif-wrap" ref={notifRef}>
              <button className="notif-bell" onClick={() => setNotifOpen(o => !o)} title="Notifications">
                <Bell size={18} />
                {notifCount > 0 && (
                  <span className="notif-badge">{notifCount > 99 ? '99+' : notifCount}</span>
                )}
              </button>

              {notifOpen && (
                <div className="notif-dropdown">
                  <div className="notif-dd-header">
                    <span className="notif-dd-title"><Bell size={13} /> Notifications</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {notifCount > 0 && (
                        <button className="notif-dd-mark-all" onClick={handleMarkAllRead}>
                          <CheckCheck size={12} /> Mark all read
                        </button>
                      )}
                      {notifItems.length > 0 && (
                        <button className="notif-dd-clear" onClick={handleClearAll}>
                          Clear all
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="notif-dd-list">
                    {notifItems.length === 0 && (
                      <div className="notif-dd-empty">No notifications yet</div>
                    )}
                    {notifItems.map(n => {
                      const meta = getNotifMeta(n.type);
                      return (
                        <div
                          key={n.id}
                          className={`notif-dd-item${n.is_read ? '' : ' notif-dd-item--unread'}`}
                          onClick={() => handleMarkRead(n)}
                        >
                          <div className="notif-dd-icon" style={{ background: meta.bg, color: meta.color }}>
                            <meta.Icon size={14} />
                          </div>
                          <div className="notif-dd-content">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div className="notif-dd-item-title">{n.title}</div>
                              {meta.label && (
                                <span style={{
                                  fontSize: 9, fontWeight: 700, padding: '1px 5px',
                                  borderRadius: 4, background: meta.bg, color: meta.color,
                                  whiteSpace: 'nowrap', flexShrink: 0,
                                }}>
                                  {meta.label}
                                </span>
                              )}
                            </div>
                            {n.body && <div className="notif-dd-item-body">{n.body}</div>}
                            <div className="notif-dd-item-time">{timeAgo(n.created_at)}</div>
                          </div>
                          {!n.is_read && <span className="notif-dd-dot" style={{ background: meta.color }} />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── User dropdown ── */}
            <div className="topbar-user-wrap" ref={userDropRef}>
              <div
                className={`topbar-user-card${userDropOpen ? ' topbar-user-card--open' : ''}`}
                onClick={() => setUserDropOpen(o => !o)}
                title="Account menu"
              >
                <div className="topbar-user-avatar">
                  {user?.name?.charAt(0).toUpperCase()}
                </div>
                <div className="topbar-user-info">
                  <div className="topbar-user-name">{user?.name}</div>
                  <div className="topbar-user-role">{user?.is_super_admin ? 'Super Admin' : (user?.role_name || 'User')}</div>
                </div>
                <ChevronDown size={14} className={`topbar-user-chevron${userDropOpen ? ' topbar-user-chevron--open' : ''}`} />
              </div>

              {userDropOpen && (
                <div className="user-drop">
                  {/* Header */}
                  <div className="user-drop-header">
                    <div className="user-drop-avatar">
                      {user?.name?.charAt(0).toUpperCase()}
                    </div>
                    <div className="user-drop-info">
                      <div className="user-drop-name">{user?.name}</div>
                      <div className="user-drop-email">{user?.email}</div>
                      {user?.is_super_admin && (
                        <div className="sidebar-profile-badge" style={{ marginTop: 8, display: 'inline-block', width: 'fit-content' }}>Super Admin</div>
                      )}
                    </div>
                  </div>

                  <div className="user-drop-divider" />

                  {/* Menu items */}
                  <div className="user-drop-menu">
                    <button className="user-drop-item" onClick={() => { setUserDropOpen(false); navigate('/profile?tab=overview'); }}>
                      <User size={15} />
                      My Profile
                    </button>
                    <button className="user-drop-item" onClick={() => { setUserDropOpen(false); navigate('/profile?tab=performance'); }}>
                      <TrendingUp size={15} />
                      Performance
                    </button>
                    {(can('VIEW_TEAM_LEADS') || can('MANAGE_USERS') || user?.is_super_admin) && (
                      <button className="user-drop-item" onClick={() => { setUserDropOpen(false); navigate('/profile?tab=team'); }}>
                        <Users size={15} />
                        My Team
                      </button>
                    )}
                    {can('MANAGE_USERS') && !user?.is_super_admin && (
                      <button className="user-drop-item" onClick={() => { setUserDropOpen(false); navigate('/profile?tab=admin'); }}>
                        <Shield size={15} />
                        Admin Panel
                      </button>
                    )}
                    {user?.is_super_admin && (
                      <button className="user-drop-item" onClick={() => { setUserDropOpen(false); navigate('/profile?tab=superadmin'); }}>
                        <Zap size={15} />
                        Super Admin
                      </button>
                    )}
                    <button className="user-drop-item" onClick={() => { setUserDropOpen(false); navigate('/profile?tab=security'); }}>
                      <Lock size={15} />
                      Security &amp; Password
                    </button>
                    <button className="user-drop-item" onClick={() => { setUserDropOpen(false); navigate('/profile?tab=settings'); }}>
                      <Settings size={15} />
                      Notification Settings
                    </button>
                  </div>

                  <div className="user-drop-divider" />

                  <div className="user-drop-menu">
                    <button className="user-drop-item user-drop-item--danger" onClick={() => { setUserDropOpen(false); handleLogout(); }}>
                      <LogOut size={15} />
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="page-scroll">
          <section className="content">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </section>
        </div>
      </main>

      <NewLeadModal 
        isOpen={isLeadModalOpen} 
        onClose={() => setLeadModalOpen(false)} 
        onSuccess={() => {
          // Trigger a refresh if on Leads page?
          // We can use a simple event or just let the user refresh/re-navigate
          window.dispatchEvent(new Event('lead-created'));
        }}
      />

      {/* ── Mobile Bottom Navigation Bar ── */}
      <nav className="mobile-bottom-nav">
        <NavLink to="/" end className={({ isActive }) => `mbn-item${isActive ? ' mbn-item--active' : ''}`}>
          <LayoutDashboard size={22} />
          <span>Dashboard</span>
        </NavLink>
        <NavLink to="/leads" className={({ isActive }) => `mbn-item${isActive ? ' mbn-item--active' : ''}`}>
          <Users size={22} />
          <span>Leads</span>
        </NavLink>
        <NavLink to="/appointments" className={({ isActive }) => `mbn-item${isActive ? ' mbn-item--active' : ''}`}>
          <Calendar size={22} />
          <span>Appointments</span>
        </NavLink>
        <NavLink to="/estimates" className={({ isActive }) => `mbn-item${isActive ? ' mbn-item--active' : ''}`}>
          <FileText size={22} />
          <span>Estimates</span>
        </NavLink>
        <NavLink to="/customer-invoices" className={({ isActive }) => `mbn-item${isActive ? ' mbn-item--active' : ''}`}>
          <Receipt size={22} />
          <span>Invoices</span>
        </NavLink>
      </nav>

      {/* ── Background upload floating indicator ── */}
      {activeEntries.length > 0 && location.pathname !== '/bulk-upload' && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {activeEntries.map(([typeId, state]) => {
            const isActive  = state.status === 'uploading' || state.status === 'validating';
            const isSuccess = state.status === 'success';
            const isError   = state.status === 'error';
            const bg        = isActive ? '#1e40af' : isSuccess ? '#166534' : '#991b1b';
            const icon      = isActive ? '⬆' : isSuccess ? '✓' : '✕';
            const label     = isActive
              ? `Uploading ${typeId}${state.progress ? ` ${state.progress}%` : '…'}`
              : isSuccess ? `${typeId} upload complete`
              : `${typeId} upload failed`;
            return (
              <div
                key={typeId}
                onClick={() => navigate('/bulk-upload')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: bg, color: '#fff',
                  padding: '10px 16px', borderRadius: 10,
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
                  minWidth: 220,
                }}
              >
                <span style={{ fontSize: 16 }}>{icon}</span>
                <span>{label}</span>
                {isActive && (
                  <div style={{ marginLeft: 'auto', width: 60, height: 4, background: 'rgba(255,255,255,0.3)', borderRadius: 4 }}>
                    <div style={{ width: `${state.progress || 0}%`, height: '100%', background: '#fff', borderRadius: 4, transition: 'width 0.3s' }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
