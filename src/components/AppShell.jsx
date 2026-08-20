import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
// search state is local to AppShell — no API change
import { useAuth } from '../auth/AuthContext.jsx';
import { NOTIF_POLL_MS } from '../config/polling.js';
import { useUpload } from '../context/UploadContext.jsx';
import { usePushNotifications } from '../hooks/usePushNotifications.js';
import { useAppPaths } from '../lib/appPaths.js';
import {
  LayoutDashboard,
  MapPin,
  Car,
  Wrench,
  Store,
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
  UserMinus,
  Trophy,
  Activity,
  User,
  Settings,
  Lock,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Network,
  Calendar,
  CalendarPlus,
  FileText,
  FilePlus,
  Package,
  ReceiptText,
  Receipt,
  Wallet,
  Shield,
  Zap,
  Percent,
  ShieldCheck,
  CreditCard,
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
  // Routing took a lead OFF this person once the customer's answer named a
  // category somebody else handles. Amber, not green: it is not work arriving.
  lead_reassigned:    { Icon: UserMinus,     bg: '#ffedd5', color: '#ea580c', label: 'Moved On'     },
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
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import NewLeadModal from './NewLeadModal.jsx';
import WhatsAppInbox from './WhatsAppInbox.jsx';
import { api } from '../api/client.js';
import { useTopbarSearch, clearPageSearch } from '../lib/pageSearchStore.js';
import { useCrumbLabel } from '../lib/pageCrumbStore.js';
import '../styles/AppShell.css';

// Each nav item declares the permissions it requires (any of). An empty
// `permissions` array means "any authenticated user". Sub-items inherit
// visibility from their own `permissions` field.
// Fixed section order for the grouped sidebar — a section header only
// renders if at least one of its items survives permission filtering.
/**
 * Sidebar sections.
 *
 * These used to be plain uppercase captions — decoration above a list. They are
 * now collapsible groups, so the sidebar rests at ~6 rows instead of 13 links
 * and you open the ones you want. Any number can stand open at once — see
 * openSections below for why that is no longer restricted.
 *
 *   key         matches NAV_ITEMS[].section
 *   label       shown on the header row. Sentence case, not the old ALL CAPS:
 *               a caption can be shouty, a button people click should not be.
 *   collapsible false → the items render flat with no header at all. OVERVIEW
 *               holds only Dashboard, and a dropdown you open to reveal a
 *               single link is worse than the link.
 */
const NAV_SECTIONS = [
  { key: 'OVERVIEW',    label: null,          collapsible: false },
  { key: 'MASTER DATA', label: 'Master Data', collapsible: true  },
  { key: 'WORKFLOW',    label: 'Workflow',    collapsible: true  },
  { key: 'SALES',       label: 'Sales',       collapsible: true  },
  { key: 'ACCOUNTING',  label: 'Accounting',  collapsible: true  },
  { key: 'CUSTOMERS',   label: 'Customers',   collapsible: true  },
  { key: 'SYSTEM',      label: 'System',      collapsible: true  },
  /* Reports sits below the card, flat, the way Dashboard sits above it. It is
     a destination people go to directly and often, and burying it a click deep
     inside System — beside Bulk Upload, which is touched once a quarter — costs
     that click every time to save one row. It takes the same
     `collapsible: false` path OVERVIEW already uses; no new render branch. */
  { key: 'TOOLS',       label: null,          collapsible: false },
];

// Remembering which group was open is worth a line of storage: without it,
// every navigation collapses the group you were just working in.
const NAV_OPEN_KEY = 'spinoto.sidebar.openSection';

/**
 * Open/close motion for a nav group.
 *
 * Height and opacity are given SEPARATE transitions rather than one shared
 * `duration`, which is what made the old version feel abrupt: fading and
 * collapsing on the same curve smears the labels across a box that is moving
 * under them.
 *
 *   opening — height leads on a decelerating curve; opacity is delayed a frame
 *             or two so the links appear into space that already exists.
 *   closing — opacity LEADS and finishes in half the time. The text is gone
 *             before the box starts moving, so nothing is seen to squash.
 *
 * `height: 'auto'` is measured by framer-motion, so this survives a group
 * gaining or losing links to permission filtering — no max-height guess that
 * silently clips the ninth item.
 *
 * The per-link stagger is CSS (`navItemIn` in AppShell.css) rather than
 * staggerChildren: that would need every NavLink wrapped in a motion element,
 * and a wrapper div per row is real DOM on every render to buy an effect a
 * keyframe already gives for free.
 */
const NAV_MOTION = {
  collapsed: {
    height: 0,
    opacity: 0,
    transition: {
      height:  { duration: 0.22, ease: [0.4, 0, 1, 1] },
      opacity: { duration: 0.1 },
    },
  },
  open: {
    height: 'auto',
    opacity: 1,
    transition: {
      height:  { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
      opacity: { duration: 0.2, delay: 0.05 },
    },
  },
};

/* prefers-reduced-motion. The CSS block at the bottom of AppShell.css only ever
   covered the chevron — the height animation is driven by JS and CSS cannot
   reach it, so the setting was quietly ignored on the part of this that
   actually moves. Same end states, no tween. */
const NAV_MOTION_NONE = {
  collapsed: { height: 0,      opacity: 0, transition: { duration: 0 } },
  open:      { height: 'auto', opacity: 1, transition: { duration: 0 } },
};

const NAV_ITEMS = [
  // ── Overview ──────────────────────────────────────────────────────────────
  { label: 'Dashboard',    to: '/',           permissions: [],                            icon: LayoutDashboard, section: 'OVERVIEW' },

  // ── Master Data ───────────────────────────────────────────────────────────
  // These were `children` of a "Master Data" item nested inside WORKFLOW. With
  // sections themselves collapsible that would have been a dropdown inside a
  // dropdown — two clicks to reach a page. They are now an ordinary section, so
  // the whole nested-item code path is gone.
  //
  // The old parent also carried its own permission list, which had to be kept
  // in union with its children's or the group vanished for someone who could
  // see a page inside it. A section is shown when at least one of its items
  // survives the filter, so there is nothing left to keep in sync.
  { label: 'Locations',            to: '/master/locations',     permissions: ['MANAGE_MASTER_DATA'],                                          icon: MapPin,     section: 'MASTER DATA' },
  { label: 'Vehicles',             to: '/master/vehicles',      permissions: ['VIEW_VEHICLE','CREATE_VEHICLE','UPDATE_VEHICLE','MANAGE_MASTER_DATA'], icon: Car,   section: 'MASTER DATA' },
  { label: 'Services & Pricing',   to: '/master/services',      permissions: ['VIEW_SERVICE','VIEW_PRICING_RULE','MANAGE_MASTER_DATA','MANAGE_PRICING'], icon: Wrench, section: 'MASTER DATA' },
  { label: 'Lead Status',          to: '/master/lead-statuses', permissions: ['MANAGE_MASTER_DATA'],                                          icon: Tag,        section: 'MASTER DATA' },
  { label: 'Departments',          to: '/master/departments',   permissions: ['MANAGE_MASTER_DATA'],                                          icon: Building2,  section: 'MASTER DATA' },
  { label: 'Parts',                to: '/master/parts',         permissions: ['MANAGE_PARTS','CREATE_PART','EDIT_PART','DELETE_PART','MANAGE_MASTER_DATA'], icon: Package, section: 'MASTER DATA' },
  { label: 'Discounts',            to: '/master/discounts',     permissions: ['MANAGE_DISCOUNTS','CREATE_DISCOUNT','EDIT_DISCOUNT','DELETE_DISCOUNT','MANAGE_MASTER_DATA'], icon: Percent, section: 'MASTER DATA' },
  { label: 'Warranty & Guarantee', to: '/master/warranties',    permissions: ['MANAGE_WARRANTIES','CREATE_WARRANTY','EDIT_WARRANTY','DELETE_WARRANTY','MANAGE_MASTER_DATA'], icon: ShieldCheck, section: 'MASTER DATA' },

  // ── Workflow ──────────────────────────────────────────────────────────────
  // Above HUBs: a Workshop is the stage before one, and the nav should read in
  // the order the work happens.
  { label: 'Workshops',    to: '/workshops',    permissions: ['VIEW_WORKSHOP','CREATE_WORKSHOP','EDIT_WORKSHOP','MANAGE_HUBS'], icon: Store, section: 'WORKFLOW' },
  { label: 'HUBs',         to: '/hubs',         permissions: ['VIEW_HUB','MANAGE_HUBS','CREATE_HUB','EDIT_HUB'], icon: Network, section: 'WORKFLOW' },
  { label: 'Leads',        to: '/leads',        permissions: ['VIEW_LEAD','VIEW_TEAM_LEADS','VIEW_OWN_LEADS','CREATE_LEAD'], icon: Users, section: 'WORKFLOW' },
  { label: 'Appointments', to: '/appointments', permissions: ['VIEW_APPOINTMENT','VIEW_LEAD','CREATE_APPOINTMENT'], icon: Calendar, section: 'WORKFLOW' },

  // ── Sales ─────────────────────────────────────────────────────────────────
  { label: 'Estimates',          to: '/estimates',         permissions: ['VIEW_ESTIMATE','CREATE_ESTIMATE','EDIT_ESTIMATE'],     icon: FileText, section: 'SALES' },
  { label: 'Customer Invoices', to: '/customer-invoices', permissions: ['VIEW_INVOICE','CREATE_INVOICE','EDIT_INVOICE'],         icon: Receipt, section: 'SALES' },

  // ── Accounting ────────────────────────────────────────────────────────────
  { label: 'Purchase Invoices', to: '/purchase-invoices', permissions: ['VIEW_PURCHASE_INVOICE','CREATE_PURCHASE_INVOICE','APPROVE_PURCHASE_INVOICE'], icon: ReceiptText, section: 'ACCOUNTING' },
  { label: 'Hub Payouts',       to: '/payouts',           permissions: ['VIEW_PURCHASE_INVOICE','VIEW_HUB','MANAGE_HUBS'],       icon: Wallet, section: 'ACCOUNTING' },
  // Money IN, beside the two screens for money out.
  //
  // Gated on VIEW_PAYMENTS alone, not the usual any-of list. COLLECT_PAYMENT is
  // an action taken from an invoice a person is already looking at; being
  // trusted to take one payment is not the same as being shown the ledger of
  // every payment the company has ever received.
  { label: 'Payments',          to: '/payments',          permissions: ['VIEW_PAYMENTS'],                                        icon: CreditCard, section: 'ACCOUNTING' },

  // ── Customers ─────────────────────────────────────────────────────────────
  { label: 'Customers',         to: '/customers',         permissions: ['VIEW_CUSTOMER','VIEW_LEAD','CREATE_LEAD'],              icon: Users2, section: 'CUSTOMERS' },
  { label: 'Claims',            to: '/warranty-claims',   permissions: ['VIEW_CLAIM','CREATE_CLAIM','APPROVE_CLAIM','RESOLVE_CLAIM','MANAGE_CLAIMS'], icon: ShieldCheck, section: 'CUSTOMERS' },

  // ── System ────────────────────────────────────────────────────────────────
  { label: 'Bulk Upload', to: '/bulk-upload', permissions: ['BULK_UPLOAD'],             icon: UploadCloud, section: 'SYSTEM' },
  // 'Users'/'My Team' and 'Super Admins' used to be separate top-level items
  // pointing at /users and /super-admins — both pages now live as tabs
  // inside the consolidated Settings module (those two routes just redirect
  // there now). A single 'Settings' entry replaces all three; internal tab
  // visibility (Manage Users / Super Admins / etc.) is gated inside
  // SettingsPage.jsx itself, same as /profile's tabs always were.
  { label: 'Settings',     to: '/settings',     permissions: [],                                                        icon: Settings, section: 'SYSTEM'  },

  // ── Tools (flat, below the card) ──────────────────────────────────────────
  { label: 'Reports',     to: '/reports',     permissions: ['VIEW_REPORTS'],            icon: BarChart3, section: 'TOOLS' },
];

/**
 * The section a URL belongs to, or null.
 *
 * Longest match wins: '/master/services' must resolve to Master Data, and a
 * plain `startsWith` against '/' would hand every route to Dashboard's section.
 */
function sectionOfPath(pathname) {
  let best = null, bestLen = -1;
  for (const it of NAV_ITEMS) {
    if (!it.to || it.to === '/') continue;
    if ((pathname === it.to || pathname.startsWith(it.to + '/')) && it.to.length > bestLen) {
      best = it.section; bestLen = it.to.length;
    }
  }
  return best;
}

export default function AppShell({ children }) {
  const { user, logout, can } = useAuth();
  usePushNotifications(user); // register push subscription silently after login
  const navigate = useNavigate();
  const location = useLocation();
  const { activeEntries } = useUpload();
  /**
   * Which sidebar groups are expanded. Any number of them.
   *
   * This was one-at-a-time — opening Sales closed Accounting — on the reasoning
   * that keeping the list short was the whole point of having groups. That
   * reasoning was propping up a bug rather than a design: the nav could not
   * scroll (see the flex-shrink note on .nav-card in AppShell.css), so a single
   * eight-item group already overflowed and anything past it was silently
   * clipped. Closing the others was the only thing making that survivable.
   *
   * With scrolling fixed there is no reason to shut a group the person did not
   * ask to shut, and plenty of work spans two — pricing a job means Master Data
   * and Sales.
   *
   * An empty array is a real value (everything closed), so the initial read
   * cannot use `stored || fallback`: that would reopen groups the user
   * deliberately shut. Persisted as a '|'-joined string, which also reads a
   * pre-existing single-key value correctly — 'SALES'.split('|') is ['SALES'] —
   * so nobody's saved state resets on deploy. Section keys contain spaces but
   * never a pipe.
   */
  const [openSections, setOpenSections] = useState(() => {
    try {
      const stored = localStorage.getItem(NAV_OPEN_KEY);
      if (stored !== null) return stored === '' ? [] : stored.split('|');
    } catch { /* private mode / storage disabled — fall through */ }
    const here = sectionOfPath(location.pathname);
    return here ? [here] : [];
  });

  useEffect(() => {
    try { localStorage.setItem(NAV_OPEN_KEY, openSections.join('|')); } catch { /* ignore */ }
  }, [openSections]);

  /**
   * Follow the route INTO a group, but do not fight the user inside one.
   *
   * Keyed on the section rather than the pathname: reacting to every navigation
   * would re-open a group the moment you closed it, because moving from
   * /estimates to /customer-invoices is still "in Sales". Tracking the section
   * means we only act when you actually cross into a different one.
   *
   * Adds rather than replaces now that groups are independent — arriving in
   * Sales must not close the Master Data group you opened to get here.
   */
  const activeSection = sectionOfPath(location.pathname);
  const navSectionMotion = useReducedMotion() ? NAV_MOTION_NONE : NAV_MOTION;
  const lastSectionRef = useRef(activeSection);
  useEffect(() => {
    if (activeSection && activeSection !== lastSectionRef.current) {
      setOpenSections(cur => cur.includes(activeSection) ? cur : [...cur, activeSection]);
    }
    lastSectionRef.current = activeSection;
  }, [activeSection]);

  // Settings gets a full-page takeover — its own sidebar (with a Back to
  // Dashboard link, built inside SettingsPage.jsx) replaces the main nav
  // entirely rather than sitting alongside it. The topbar (search,
  // notifications, user menu) stays, since that wasn't part of what changed.
  const isSettingsRoute = location.pathname.startsWith('/settings');

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

  /* ── Sidebar profile card ────────────────────────────────────────────────
     Everyone gets it, at the top of the sidebar. Super admins get the SAME
     card in a compact variant: the avatar and text turn into one horizontal
     row instead of a centred stack, which costs about half the height.

     Same markup either way — only a modifier class differs — so the two cannot
     drift apart as one of them gets edited. The old card pinned at the bottom
     of the sidebar is gone; keeping it for super admins would have put the
     same avatar at both ends. */
  const isSuperAdmin = !!user?.is_super_admin;
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);
  useEffect(() => {
    function onOut(e) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) setProfileMenuOpen(false);
    }
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, []);

  // ── Top-bar search ────────────────────────────────────────────────────────
  //
  // This used to be a global search over leads and users. It is now the CURRENT
  // PAGE's search: whichever list is open claims the box via usePageSearch()
  // and owns the state, the debounce and the request. The shell only renders
  // what it is handed.
  //
  // Two reasons for the change. The obvious one is that the list pages each had
  // their own search box, so the header search sat directly above a second
  // search box that did something else — on the Customer Invoices screen there
  // were two inputs and neither name told you which was which. The quieter one
  // is that the old header search fired at every page, on a 280ms debounce,
  // hitting /api/leads AND fetching the ENTIRE users table to filter it in the
  // browser. That last part cost a full table read per keystroke-pause.
  //
  // A page that does not claim the box gets no box, rather than one that
  // silently does nothing.
  const pageSearch = useTopbarSearch();

  // The last breadcrumb on a detail route is a raw token. The page that owns
  // the record publishes a readable label for it (CI-000048); this reads that
  // back. Computed at the top level because useCrumbLabel is a hook and the
  // crumb itself is rendered inside a JSX IIFE further down.
  const crumbSegments = location.pathname.split('/').filter(Boolean);
  const crumbToken = crumbSegments.length === 2 ? crumbSegments[1] : null;
  const crumbLabel = useCrumbLabel(crumbToken);
  const searchRef  = useRef(null);

  // ⌘K / Ctrl+K focuses it; Escape clears and blurs.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        // Only swallow the browser's own ⌘K when there is something to focus.
        if (!pageSearch.active) return;
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        clearPageSearch();
        searchRef.current?.blur();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pageSearch.active]);

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

  // Poll the unread count — but only while the tab is actually being looked at.
  //
  // This runs in every open tab for every logged-in user, and AppShell wraps
  // the whole app, so it used to fire every 30s regardless of whether anyone
  // was there. With a serverless Postgres that bills per hour of uptime and
  // suspends after 5 minutes of silence, a single tab left open overnight kept
  // the database awake until morning — which was most of the compute bill.
  //
  // Nobody reads a badge on a tab they aren't looking at, so gating on
  // visibility costs nothing. 120s rather than 30s trims the rest; the count
  // can be up to two minutes stale while you watch it, which for a
  // notification badge is not a meaningful difference.
  useEffect(() => {
    fetchCount();

    const iv = setInterval(() => {
      if (document.visibilityState === 'visible') fetchCount();
    }, NOTIF_POLL_MS);

    // Returning to the tab should refresh immediately rather than waiting out
    // the rest of the interval — this is what keeps the longer interval from
    // being noticeable.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchCount();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisibility);
    };
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

  /**
   * Where "view profile" lands. Lifted out of the bottom card's onClick now
   * that two things call it — the new top card and its menu.
   *
   * Super admin is checked FIRST and lands on Overview. It cannot fall through
   * to the MANAGE_USERS branch: can() returns true for super admins, but
   * ProfilePage builds its Admin tab from
   * `isAdmin = !is_super_admin && perm.has('MANAGE_USERS')` — so a super admin
   * sent to ?tab=admin gets a tab bar with nothing selected and a body
   * rendered under a heading that isn't there.
   */
  const goProfile = () => {
    if (user?.is_super_admin) navigate('/profile?tab=overview');
    else if (can('MANAGE_USERS')) navigate('/profile?tab=admin');
    else if (can('VIEW_TEAM_LEADS')) navigate('/profile?tab=team');
    else navigate('/profile?tab=overview');
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
  // Flat: no nav item has children now that Master Data is a section. The
  // nested branch was removed rather than left in place — dead code that still
  // looks supported invites someone to add a nested item the renderer below
  // would silently drop.
  const filteredNav = NAV_ITEMS.filter(itemVisible);

  // Group the permission-filtered nav into fixed sections, dropping any
  // section that has no visible items.
  const groupedNav = NAV_SECTIONS
    .map((section) => ({
      section,
      items: filteredNav.filter((item) => item.section === section.key),
    }))
    .filter((g) => g.items.length);

  /**
   * Split the sections into blocks so the collapsible groups can share one
   * rounded card while the flat sections (Dashboard above it, Reports below)
   * sit directly on the sidebar.
   *
   * Batched by consecutive RUN rather than by a hardcoded index: a section that
   * vanishes to permission filtering — a user without MANAGE_MASTER_DATA never
   * sees Master Data — must shrink the card, not split it in two. Reordering
   * NAV_SECTIONS needs no change here either.
   *
   * The 72px rail renders every section flat (see the effectiveCollapsed branch
   * below), so it produces one uncarded block and no card is drawn at all.
   */
  const navBlocks = [];
  for (const entry of groupedNav) {
    const card = !effectiveCollapsed && entry.section.collapsible;
    const last = navBlocks[navBlocks.length - 1];
    if (last && last.card === card) last.sections.push(entry);
    else navBlocks.push({ card, sections: [entry] });
  }

  /* Quick-action visibility. Permission AND destination: a hub login holding
     CREATE_LEAD would otherwise get a button opening a modal that posts to a
     leads screen its shell does not have. */
  const P = useAppPaths();
  // ── Can this person read WhatsApp at all? ──────────────────────────────
  //
  // Checked HERE rather than inside the control, so a user without it never
  // renders it and never calls its endpoints. That is not tidiness: an advisor
  // on the WhatsApp rota but without the permission was firing a 403 on every
  // poll, on every socket nudge and on every lead they opened — a console full
  // of red that pointed at the badge when the answer was a checkbox on their
  // user record.
  //
  // Same codes the whatsapp routes use (canRead in routes/whatsapp.routes.js).
  // If these two ever disagree the symptom is either a dead icon or an
  // invisible feature, so they are worth keeping side by side in a search.
  const canWhatsApp = can('SEND_WHATSAPP', 'VIEW_WHATSAPP_LOGS');

  const canQuickLead = !!P.leads && can('CREATE_LEAD');
  const canQuickAppt = !!P.appointments && can('CREATE_APPOINTMENT');
  const canQuickEst  = !!P.estimates && can('CREATE_ESTIMATE');

  const userBadge = user?.is_super_admin ? 'super admin' : 'user';

  return (
    <div className={`shell ${effectiveCollapsed ? 'collapsed' : ''} ${isSettingsRoute ? 'shell--settings' : ''}`}>
      {/* Mobile Backdrop */}
      {mobileMenuOpen && !isSettingsRoute && (
        <div className="sidebar-backdrop" onClick={() => setMobileMenuOpen(false)} />
      )}

      {!isSettingsRoute && (
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

        {/* ── Scroll region ────────────────────────────────────────────────
            The profile card, the quick actions and the navigation scroll as one
            body. Only the brand stays pinned, because its bottom border is
            aligned to the topbar's and a divider that slides out of line with
            the one beside it is worse than no divider.

            The scroll lives here rather than on <nav> — where it was — so that
            reaching the last nav group does not mean scrolling a short strip
            underneath a profile card that never moves. Every child needs
            flex-shrink: 0 or it gets squeezed instead of overflowing; see the
            note on .nav-card in AppShell.css for what that failure looks
            like. */}
        <div className="sidebar-scroll">
          {/* ── Profile card ─────────────────────────────────────────────────
              Compact horizontal variant for super admins, full centred stack for
              everyone else. See isSuperAdmin above.

              On the 72px rail both degrade to the avatar alone. The menu is not
              merely hidden there — a popover anchored to a 72px column would
              hang over the content area, and everything in it is reachable from
              the topbar's own user dropdown anyway. */}
          {(effectiveCollapsed ? (
            <button
              type="button"
              className="sb-profile-mini"
              onClick={goProfile}
              title={user?.name || 'View profile'}
              aria-label="View profile"
            >
              {user?.name?.charAt(0).toUpperCase()}
            </button>
          ) : (
            <div className={`sb-profile${isSuperAdmin ? ' sb-profile--compact' : ''}`} ref={profileMenuRef}>
              <button
                type="button"
                className="sb-profile-kebab"
                onClick={() => setProfileMenuOpen(o => !o)}
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
                aria-label="Account menu"
                title="Account"
              >
                <MoreVertical size={16} />
              </button>

              {/* A button, not a div with onClick: this is the card's primary
                  action and it has to be reachable by keyboard and announced as
                  activatable. The kebab above is a sibling rather than a child
                  for the same reason — a button inside a button is invalid and
                  the inner one stops receiving clicks in some browsers. */}
              <button type="button" className="sb-profile-body" onClick={goProfile} title="View profile">
                <span className="sb-profile-avatar">{user?.name?.charAt(0).toUpperCase()}</span>
                {/* Name and email are wrapped rather than being direct children
                    of the body. The compact variant lays the body out as a row,
                    and without this wrapper the two lines would sit side by side
                    beside the avatar instead of stacking. */}
                <span className="sb-profile-text">
                  <span className="sb-profile-name">{user?.name}</span>
                  <span className="sb-profile-email">{user?.email}</span>
                </span>
              </button>

              {profileMenuOpen && (
                <div className="sb-profile-menu" role="menu">
                  <button type="button" role="menuitem" className="sb-profile-menu-item"
                    onClick={() => { setProfileMenuOpen(false); goProfile(); }}>
                    <User size={14} /> View profile
                  </button>
                  {/* Settings → Account, matching the topbar's user dropdown.
                      This shell also owns a standalone change-password modal
                      (`pwOpen`), but password and notification preferences were
                      consolidated onto that settings tab — sending people to the
                      modal here would be a second, older way to do the same
                      thing. */}
                  <button type="button" role="menuitem" className="sb-profile-menu-item"
                    onClick={() => { setProfileMenuOpen(false); navigate('/settings?tab=account'); }}>
                    <Lock size={14} /> Security &amp; Password
                  </button>
                  <button type="button" role="menuitem" className="sb-profile-menu-item sb-profile-menu-item--danger"
                    onClick={() => { setProfileMenuOpen(false); handleLogout(); }}>
                    <LogOut size={14} /> Logout
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* ── Quick actions ────────────────────────────────────────────────
              The two things people create from anywhere in this application are
              a lead and an appointment. Both previously required navigating to
              the right list page first and finding its own New button; these put
              them one click from every screen.

              Icon-only rather than a labelled "New" button with a menu: a menu
              would add a click in front of BOTH actions to save a row the
              sidebar has to spare. `title` and `aria-label` carry the name for
              the tooltip and for a screen reader respectively — a bare icon with
              neither is unusable without sight and unguessable with it.

              Each button is gated on two things: the permission, and the
              destination existing in this shell at all (P.leads is null in the
              hub portal — see lib/appPaths.js). A button that 403s, or one that
              navigates to "null", is worse than no button. */}
          {(canQuickLead || canQuickAppt || canQuickEst) && !effectiveCollapsed && (
            <div className="sidebar-quick">
              {canQuickLead && (
                <button
                  type="button"
                  className="sidebar-quick-btn"
                  onClick={() => setLeadModalOpen(true)}
                  title="New Lead"
                  aria-label="New Lead"
                >
                  <UserPlus size={18} strokeWidth={2.2} />
                </button>
              )}
              {canQuickAppt && (
                <button
                  type="button"
                  className="sidebar-quick-btn"
                  /* The create-appointment modal is owned by AppointmentsPage,
                     not by this shell, so this cannot just flip a state flag the
                     way the lead button does. It navigates and hands the page a
                     one-shot router-state flag — see the `openCreate` effect
                     there, which sits beside the identical `prefillCustomer` one
                     that already existed for the customer-profile route. */
                  onClick={() => navigate(P.appointments, { state: { openCreate: true } })}
                  title="New Appointment"
                  aria-label="New Appointment"
                >
                  <CalendarPlus size={18} strokeWidth={2.2} />
                </button>
              )}
              {canQuickEst && (
                <button
                  type="button"
                  className="sidebar-quick-btn"
                  /* Opens StartEstimateChoice — the "booked appointment or
                     walk-in?" chooser EstimatesPage owns. A query param rather
                     than the router state the appointment button uses, because
                     that is the idiom EstimatesPage already applies to its
                     create-flows (see createForAppointmentIdParam there): no
                     record exists yet, so there is no id or token to key state
                     off, and the page strips the param once it has read it. */
                  onClick={() => navigate(`${P.estimates}?new=1`)}
                  title="New Estimate"
                  aria-label="New Estimate"
                >
                  <FilePlus size={18} strokeWidth={2.2} />
                </button>
              )}
            </div>
          )}

          <nav>
            {navBlocks.map((block, blockIndex) => {
              const rendered = block.sections.map(({ section, items }) => {
                const link = (item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) => isActive ? 'active' : ''}
                    end={item.to === '/'}
                    title={effectiveCollapsed ? item.label : undefined}
                  >
                    <item.icon size={18} strokeWidth={2} />
                    {!effectiveCollapsed && item.label}
                  </NavLink>
                );

                /* Two cases render as a plain list with no header:
                   - a section marked collapsible:false (OVERVIEW — one item)
                   - the 72px collapsed rail, where there is no room for a label,
                     so a header would be a chevron floating above some icons and
                     an expandable group would have nothing to expand into. */
                if (effectiveCollapsed || !section.collapsible) {
                  return (
                    <div key={section.key} className="nav-section">
                      {items.map(link)}
                    </div>
                  );
                }

                const open = openSections.includes(section.key);
                return (
                  <div key={section.key} className={`nav-section nav-section--group${open ? ' open' : ''}`}>
                    <button
                      type="button"
                      className={`nav-section-header${open ? ' open' : ''}${activeSection === section.key ? ' active-parent' : ''}`}
                      onClick={() => setOpenSections((cur) => cur.includes(section.key)
                        ? cur.filter(k => k !== section.key)
                        : [...cur, section.key])}
                      /* Real button + aria-expanded: a screen reader has to be able
                         to tell that this row hides a list, and that it is shut. */
                      aria-expanded={open}
                    >
                      <span className="nav-section-name">{section.label}</span>
                      {/* One icon rotated by CSS rather than swapping ChevronDown
                          for ChevronRight — swapping remounts the node mid-flight
                          and the rotation never animates. */}
                      <ChevronDown size={15} className="nav-section-chevron" />
                    </button>

                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div
                          className="nav-section-items"
                          initial="collapsed"
                          animate="open"
                          exit="collapsed"
                          variants={navSectionMotion}
                        >
                          {items.map(link)}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              });

              /* One card per run of collapsible groups; flat runs pass straight
                 through. The key is the block index, not a section key — a block
                 holds several sections and its identity is its position. */
              return block.card
                ? <div key={`nav-card-${blockIndex}`} className="nav-card">{rendered}</div>
                : <Fragment key={`nav-flat-${blockIndex}`}>{rendered}</Fragment>;
            })}
          </nav>
        </div>

        {/* The profile card that used to sit here is gone — every role now gets
            one at the TOP of the sidebar (see the sb-profile block above). Its
            .sidebar-profile* rules are left in AppShell.css unused, the same way
            .sidebar-action-btn already was. */}

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
      )}

      <main className="main">
        <header className="topbar">
          {/* ── Left: breadcrumbs & mobile menu ── */}
          <div className="topbar-left">
            {!isSettingsRoute && (
              <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(true)}>
                <Menu size={20} />
              </button>
            )}
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
                      {/* The page publishes a human label for its token —
                          "CI-000048" rather than "zuOAVWTsZ1vqUw". Falls back
                          to the raw token, which is what shows for the moment
                          before the record resolves, and for any detail page
                          that publishes nothing. The URL is untouched either
                          way; this is display only. */}
                      <span className={crumbLabel ? 'crumb-token' : 'capitalize crumb-token'}>
                        {crumbLabel || segments[1]}
                      </span>
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


          {/* ── Center: the current page's search ──
              Rendered only when a page has claimed it. The wrapper stays in the
              DOM either way so the breadcrumb and the action buttons keep their
              positions instead of jumping when you move between pages. */}
          <div className="topbar-center">
            {pageSearch.active && (
              <form className="topbar-search-wrap" onSubmit={e => e.preventDefault()}>
                <svg className="topbar-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                <input
                  ref={searchRef}
                  className="topbar-search-input"
                  placeholder={pageSearch.placeholder}
                  value={pageSearch.value}
                  onChange={e => pageSearch.onChange?.(e.target.value)}
                  autoComplete="off"
                  spellCheck="false"
                />
                {pageSearch.value && (
                  <button
                    type="button"
                    className="topbar-search-clear"
                    onClick={() => { pageSearch.onChange?.(''); searchRef.current?.focus(); }}
                    aria-label="Clear search"
                  >
                    <X size={13} />
                  </button>
                )}
                {/* The hint replaces the ⌘K badge rather than sitting below it,
                    so telling the user to type more never shifts the layout. */}
                {pageSearch.hint
                  ? <span className="topbar-search-hint">{pageSearch.hint}</span>
                  : <kbd className="topbar-search-kbd">⌘K</kbd>}
              </form>
            )}
          </div>

          <div className="topbar-actions">
            <button className="theme-toggle" onClick={toggleTheme} title="Toggle Theme">
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>

            {/* ── WhatsApp ────────────────────────────────────────────────
                Left of the bell and visually its own thing: green, WhatsApp
                mark, its own count. Not a second bell.

                It is separate because of the one thing the bell cannot say —
                WhatsApp only accepts a free-text reply within 24 hours of the
                customer's last message, so these are the only alerts in the
                system that EXPIRE. A list sorted by age has nowhere to put
                "40 minutes left". */}
            {canWhatsApp && <WhatsAppInbox />}

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
                      <button className="user-drop-item" onClick={() => { setUserDropOpen(false); navigate('/settings?tab=super-admins'); }}>
                        <Zap size={15} />
                        Super Admin
                      </button>
                    )}
                    {/* Password change now lives in Settings > Account, alongside
                        notification preferences (both used to be ProfilePage's
                        "Settings" tab sub-tabs). */}
                    <button className="user-drop-item" onClick={() => { setUserDropOpen(false); navigate('/settings?tab=account'); }}>
                      <Lock size={15} />
                      Security &amp; Password
                    </button>
                    <button className="user-drop-item" onClick={() => { setUserDropOpen(false); navigate('/settings?tab=account'); }}>
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
            {/* Keyed on the route SECTION, not the full pathname.
                /customer-invoices/AAA and /customer-invoices/BBB are the same
                screen showing a different record — keying on the whole path
                made AnimatePresence unmount and rebuild the entire page every
                time you clicked a row in a master-detail list. That threw away
                the list rail's scroll position, page number and collapsed
                state, flashed the plain list view for a frame while
                `selectedId` was re-resolved from the token, and fired two
                extra requests per click.
                Moving BETWEEN screens still animates, which is what the
                animation was for. */}
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname.split('/')[1] || 'home'}
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
