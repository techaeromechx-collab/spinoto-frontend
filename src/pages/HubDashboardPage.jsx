'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';
import { usePushNotifications } from '../hooks/usePushNotifications.js';
import {
  LayoutDashboard, Calendar, FileText, Receipt, ReceiptText,
  LogOut, Moon, Sun, Menu, Building2,
  Loader2, IndianRupee, TrendingUp,
  PanelLeftClose, PanelLeftOpen,
  Wrench, Layers, Search, ChevronDown, ChevronUp, Tag,
  Bell, CheckCheck, Percent, Database,
} from 'lucide-react';
import AppointmentsPage     from './AppointmentsPage.jsx';
import EstimatesPage        from './EstimatesPage.jsx';
import PurchaseInvoicesPage from './PurchaseInvoicesPage.jsx';
import CustomerInvoicesPage from './CustomerInvoicesPage.jsx';
import '../styles/HubDashboardPage.css';

// ─── Notification type → icon/color/label (mirrors AppShell.jsx's NOTIF_META,
// trimmed to the types that ever reach a hub-portal login) ───────────────────
const NOTIF_META = {
  appointment_reminder:   { Icon: Bell,     bg: '#f3e8ff', color: '#7c3aed', label: 'Reminder'       },
  pricing_changed:        { Icon: Percent,  bg: '#dcfce7', color: '#15803d', label: 'Pricing'        },
  reference_data_changed: { Icon: Database, bg: '#e0e7ff', color: '#4338ca', label: 'Reference Data' },
};
function getNotifMeta(type) {
  return NOTIF_META[type] || { Icon: Bell, bg: '#dbeafe', color: '#2563eb', label: '' };
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

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtINR(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const EST_STATUS = {
  draft:                  { label: 'Draft',           bg: 'var(--bg-soft)', color: 'var(--text-muted)' },
  pending_company_review: { label: 'Pending Review',  bg: '#fef3c7',        color: '#92400e'           },
  sent_to_customer:       { label: 'Sent to Customer',bg: '#dbeafe',        color: '#1d4ed8'           },
  partially_approved:     { label: 'Partial Approval',bg: '#d1fae5',        color: '#065f46'           },
  fully_approved:         { label: 'Approved',        bg: '#bbf7d0',        color: '#14532d'           },
  revision_requested:     { label: 'Revision Needed', bg: '#fee2e2',        color: '#991b1b'           },
};

// ─── KPI card (matches app dashboard style) ───────────────────────────────────

function KpiCard({ icon: Icon, label, value, accent, sub, onClick }) {
  const clickable = typeof onClick === 'function';
  return (
    <div
      className="card"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 16, padding: '20px 24px',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'box-shadow 0.15s, transform 0.15s, border-color 0.15s',
        borderBottom: clickable ? `3px solid ${accent}` : undefined,
      }}
      onMouseEnter={e => { if (clickable) { e.currentTarget.style.boxShadow = '0 4px 18px rgba(0,0,0,0.10)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}}
      onMouseLeave={e => { if (clickable) { e.currentTarget.style.boxShadow = ''; e.currentTarget.style.transform = ''; }}}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 10, flexShrink: 0,
        background: accent + '18', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={20} style={{ color: accent }} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: accent, marginTop: 4, fontWeight: 500 }}>{sub}</div>}
      </div>
      {clickable && (
        <div style={{ fontSize: 11, color: accent, fontWeight: 600, alignSelf: 'center', opacity: 0.7, flexShrink: 0 }}>
          View →
        </div>
      )}
    </div>
  );
}

// ─── Tab: Dashboard ──────────────────────────────────────────────────────────

function DashboardTab({ hubId, onNavigate }) {
  const [stats, setStats]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const today = new Date().toISOString().split('T')[0];
        const [apptRes, estRes, piRes] = await Promise.all([
          api(`/api/appointments?hub_id=${hubId}&limit=200`),
          api(`/api/estimates?hub_id=${hubId}&limit=200`),
          api(`/api/purchase-invoices?hub_id=${hubId}&limit=200`),
        ]);
        const appts = apptRes.items || [];
        const ests  = estRes.items  || [];
        const pis   = piRes.items   || [];

        setStats({
          todayAppts:     appts.filter(a => a.scheduled_date?.slice(0, 10) === today).length,
          totalAppts:     appts.length,
          pendingEsts:    ests.filter(e => e.status === 'pending_company_review').length,
          approvedEsts:   ests.filter(e => e.status === 'fully_approved' || e.status === 'partially_approved').length,
          totalEsts:      ests.length,
          outstanding:    pis.filter(p => p.payment_status !== 'paid').reduce((s, p) => s + Number(p.grand_total || 0), 0),
          totalReceived:  pis.filter(p => p.payment_status === 'paid').reduce((s, p) => s + Number(p.amount_paid || 0), 0),
          pendingPIs:     pis.filter(p => p.payment_status === 'pending').length,
        });
      } catch { setStats(null); }
      finally  { setLoading(false); }
    })();
  }, [hubId]);

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
      <Loader2 size={28} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Overview</h2>
          <p>Your hub's live summary</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 8 }}>
        <KpiCard icon={Calendar}    label="Today's Appointments" value={stats?.todayAppts ?? 0}              accent="var(--primary)"  onClick={() => onNavigate('appointments')} />
        <KpiCard icon={Calendar}    label="Total Appointments"   value={stats?.totalAppts ?? 0}              accent="#6366f1"          onClick={() => onNavigate('appointments')} />
        <KpiCard icon={FileText}    label="Pending Estimates"    value={stats?.pendingEsts ?? 0}             accent="#f59e0b" sub="Awaiting company review" onClick={() => onNavigate('estimates')} />
        <KpiCard icon={FileText}    label="Approved Estimates"   value={stats?.approvedEsts ?? 0}            accent="var(--ok)"        onClick={() => onNavigate('estimates')} />
        <KpiCard icon={IndianRupee} label="Outstanding Payments" value={fmtINR(stats?.outstanding)}         accent="var(--danger)" sub={`${stats?.pendingPIs ?? 0} invoices pending`} onClick={() => onNavigate('sell-invoices')} />
        <KpiCard icon={TrendingUp}  label="Total Received"       value={fmtINR(stats?.totalReceived)}       accent="var(--ok)"        onClick={() => onNavigate('sell-invoices')} />
      </div>
    </div>
  );
}

// ─── Tab: Services & Pricing ──────────────────────────────────────────────────

// Colour palette for rule-type chips
const RULE_CHIP_STYLE = {
  Universal:    { bg: '#eff6ff', color: '#1d4ed8' },
  'Vehicle Type':{ bg: '#f5f3ff', color: '#6d28d9' },
  'Body Type':  { bg: '#fef9c3', color: '#854d0e' },
  Segment:      { bg: '#dcfce7', color: '#166534' },
  Make:         { bg: '#dbeafe', color: '#1e40af' },
  Model:        { bg: '#ede9fe', color: '#5b21b6' },
  'CC Category':{ bg: '#fce7f3', color: '#9d174d' },
};
function chipStyle(ruleType) {
  // ruleType can be combos like "Make + Segment" — use the first keyword
  const key = Object.keys(RULE_CHIP_STYLE).find(k => ruleType?.includes(k)) || 'Universal';
  return RULE_CHIP_STYLE[key];
}

// Single price chip: "₹1,299 · Make + Model" or "₹899 · Universal"
function PriceChip({ rule }) {
  const cs = chipStyle(rule.rule_type);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 20, fontSize: 12, fontWeight: 600,
      background: cs.bg, color: cs.color, whiteSpace: 'nowrap',
    }}>
      <IndianRupee size={11} />
      {Number(rule.price).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
      <span style={{ opacity: 0.7, fontWeight: 500 }}>· {rule.applies_to}</span>
    </span>
  );
}

function ServicesTab({ hubId }) {
  const [categories,    setCategories]    = useState([]);
  const [servicePrices, setServicePrices] = useState({}); // { service_id: [rule,...] }
  const [catPrices,     setCatPrices]     = useState({}); // { cat_id: [rule,...] }
  const [loading,       setLoading]       = useState(true);
  const [priceLoading,  setPriceLoading]  = useState(false);
  const [error,         setError]         = useState('');
  const [search,        setSearch]        = useState('');
  const [collapsed,     setCollapsed]     = useState({});

  // ── Load services, then fetch all pricing rules in parallel ─────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const svcRes = await api(`/api/hubs/${hubId}/services`);
        const mapped = (svcRes.categories || [])
          .filter(c => c.category_mapped)
          .map(c => ({
            ...c,
            services: (c.services || []).filter(s => s.service_mapped),
          }))
          .filter(c => c.services.length > 0);

        if (!cancelled) setCategories(mapped);

        // Now load pricing rules for every service + every category in parallel
        setPriceLoading(true);

        const allSvcIds = mapped.flatMap(c => c.services.map(s => s.service_id));
        const allCatIds = [...new Set(mapped.map(c => c.id))];

        const [svcResults, catResults] = await Promise.all([
          Promise.all(allSvcIds.map(async sid => {
            try {
              const r = await api(`/api/pricing?service_id=${sid}&is_active=true&limit=50`);
              return { sid, rules: r.items || [] };
            } catch { return { sid, rules: [] }; }
          })),
          Promise.all(allCatIds.map(async cid => {
            try {
              const r = await api(`/api/pricing?category_id=${cid}&is_active=true&limit=50`);
              return { cid, rules: r.items || [] };
            } catch { return { cid, rules: [] }; }
          })),
        ]);

        if (!cancelled) {
          const sp = {};
          svcResults.forEach(({ sid, rules }) => { sp[sid] = rules; });
          setServicePrices(sp);

          const cp = {};
          catResults.forEach(({ cid, rules }) => { cp[cid] = rules; });
          setCatPrices(cp);
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load services');
      } finally {
        if (!cancelled) { setLoading(false); setPriceLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [hubId]);

  // ── Filtered view ────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const filteredCats = categories
    .map(c => ({
      ...c,
      services: q ? c.services.filter(s => s.name.toLowerCase().includes(q)) : c.services,
    }))
    .filter(c => c.services.length > 0);

  const totalServices = filteredCats.reduce((n, c) => n + c.services.length, 0);

  function toggleCat(id) {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  }

  // ── Resolve pricing to show for a service ───────────────────────────────
  // Shows service-level rules first; falls back to category-level rules.
  function getPriceDisplay(svc, catId) {
    const svcRules = servicePrices[svc.service_id] || [];
    if (svcRules.length > 0) return { rules: svcRules, source: 'service' };
    const catRules = catPrices[catId] || [];
    if (catRules.length > 0) return { rules: catRules, source: 'category' };
    return { rules: [], source: 'none' };
  }

  // ── Loading / error ──────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
      <Loader2 size={28} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
    </div>
  );

  if (error) return (
    <div className="card" style={{ padding: 24, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <Wrench size={16} /> {error}
    </div>
  );

  return (
    <div>
      {/* ── Page header ── */}
      <div className="page-header">
        <div>
          <h2>Services &amp; Pricing</h2>
          <p>Services assigned to your hub with active pricing rules</p>
        </div>
      </div>

      {/* ── Search + count ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 160 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search services…"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '8px 10px 8px 32px',
              border: '1px solid var(--border)', borderRadius: 8,
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 13, fontFamily: 'inherit',
            }}
          />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', fontWeight: 500 }}>
          {filteredCats.length} {filteredCats.length === 1 ? 'category' : 'categories'} · {totalServices} {totalServices === 1 ? 'service' : 'services'}
          {priceLoading && <span style={{ marginLeft: 8, color: 'var(--primary)' }}>Loading prices…</span>}
        </div>
      </div>

      {/* ── Empty state ── */}
      {filteredCats.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
          <Layers size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
          <div style={{ fontWeight: 600 }}>{q ? 'No services match your search' : 'No services assigned yet'}</div>
          {!q && <div style={{ fontSize: 12, marginTop: 4 }}>Contact admin to assign services to this hub</div>}
        </div>
      )}

      {/* ── Category cards ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {filteredCats.map(cat => {
          const isOpen = !collapsed[cat.id];
          return (
            <div key={cat.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>

              {/* Category header */}
              <button
                onClick={() => toggleCat(cat.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '14px 18px', background: 'transparent', border: 'none', cursor: 'pointer',
                  textAlign: 'left', fontFamily: 'inherit',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                    background: 'var(--primary)18',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Layers size={15} style={{ color: 'var(--primary)' }} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{cat.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                      {cat.services.length} {cat.services.length === 1 ? 'service' : 'services'}
                      {(catPrices[cat.id] || []).length > 0 && (
                        <span style={{ marginLeft: 6, color: '#0369a1' }}>
                          · {(catPrices[cat.id] || []).length} category {(catPrices[cat.id] || []).length === 1 ? 'rule' : 'rules'} (fallback)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {isOpen
                  ? <ChevronUp size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  : <ChevronDown size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
              </button>

              {/* Services list */}
              {isOpen && (
                <div style={{ borderTop: '1px solid var(--border)' }}>
                  {/* Column headers */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: '220px 1fr',
                    padding: '7px 18px', background: 'var(--bg-soft)',
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.06em', color: 'var(--text-muted)',
                  }}>
                    <span>Service</span>
                    <span>Pricing Rules (active)</span>
                  </div>

                  {cat.services.map((svc, idx) => {
                    const { rules, source } = getPriceDisplay(svc, cat.id);
                    return (
                      <div
                        key={svc.service_id}
                        style={{
                          display: 'grid', gridTemplateColumns: '220px 1fr',
                          alignItems: 'flex-start', gap: 12,
                          padding: '11px 18px',
                          borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                        }}
                      >
                        {/* Service name */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{
                            width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                            background: '#f0f9ff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <Wrench size={12} style={{ color: '#0369a1' }} />
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', lineHeight: 1.3 }}>
                            {svc.name}
                          </span>
                        </div>

                        {/* Price chips */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', paddingTop: 2 }}>
                          {priceLoading ? (
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</span>
                          ) : rules.length > 0 ? (
                            <>
                              {rules.map(rule => <PriceChip key={rule.id} rule={rule} />)}
                              {source === 'category' && (
                                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                  (category rate)
                                </span>
                              )}
                            </>
                          ) : (
                            <span style={{
                              fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
                              background: '#f3f4f6', color: '#6b7280',
                            }}>
                              No pricing rules set
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Nav tabs config ──────────────────────────────────────────────────────────

const TABS = [
  { key: 'dashboard',         label: 'Dashboard',         Icon: LayoutDashboard },
  { key: 'appointments',      label: 'Appointments',      Icon: Calendar        },
  { key: 'estimates',         label: 'Estimates',         Icon: FileText        },
  { key: 'sell-invoices',     label: 'Sell Invoices',     Icon: ReceiptText     },
  { key: 'customer-invoices', label: 'Customer Invoices', Icon: Receipt         },
  { key: 'services-pricing',  label: 'Services & Pricing', Icon: Wrench         },
];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HubDashboardPage() {
  const { user, logout } = useAuth();
  const [tab,       setTab]       = useState('dashboard');
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('spinoto_sidebar_collapsed') === 'true');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('spinoto_theme') || 'light');

  // Register this device for browser push (same hook AppShell uses) —
  // the hub portal is a standalone shell, so it never mounted this before.
  usePushNotifications(user);

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

  useEffect(() => {
    fetchCount();
    const iv = setInterval(fetchCount, 30000);
    return () => clearInterval(iv);
  }, [fetchCount]);

  useEffect(() => {
    if (notifOpen) fetchNotifs();
  }, [notifOpen, fetchNotifs]);

  useEffect(() => {
    function onOut(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    }
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, []);

  // Notification click routes to a hub-portal tab, not a router path
  // (this page manages its own tab state rather than react-router routes).
  function getNotifTab(n) {
    if (n.type === 'appointment_reminder') return 'appointments';
    if (n.type === 'pricing_changed' || n.type === 'reference_data_changed') return 'services-pricing';
    return null;
  }

  async function handleMarkRead(n) {
    try {
      await api(`/api/notifications/${n.id}/read`, { method: 'PATCH' });
      setNotifItems(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
      setNotifCount(c => Math.max(0, c - 1));
      const target = getNotifTab(n);
      if (target) { setNotifOpen(false); setTab(target); }
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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('spinoto_theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('spinoto_sidebar_collapsed', collapsed);
  }, [collapsed]);

  const hubId   = user?.hub_id;
  const hubName = user?.hub_name || 'Hub Portal';

  function renderTab() {
    if (!hubId) return (
      <div className="card" style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
        Hub not linked. Contact admin.
      </div>
    );
    switch (tab) {
      case 'dashboard':         return <DashboardTab hubId={hubId} onNavigate={setTab} />;
      case 'appointments':      return <AppointmentsPage />;
      case 'estimates':         return <EstimatesPage />;
      case 'sell-invoices':     return <PurchaseInvoicesPage />;
      case 'customer-invoices': return <CustomerInvoicesPage />;
      case 'services-pricing':  return <ServicesTab hubId={hubId} />;
      default: return null;
    }
  }

  return (
    <>

      <div className={`shell${collapsed ? ' collapsed' : ''}`}>

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside className={`sidebar${mobileOpen ? ' open' : ''}`}>

          {/* Brand */}
          <div className="brand">
            {!collapsed && <span>Spinoto</span>}
            {collapsed && <span className="brand-mini">S</span>}
            <button
              className="sidebar-toggle"
              onClick={() => setCollapsed(c => !c)}
              title={collapsed ? 'Expand' : 'Collapse'}
            >
              {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
            </button>
          </div>

          {/* Hub badge */}
          {!collapsed && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', background: 'var(--bg-soft)',
              border: '1px solid var(--border)', borderRadius: 10, margin: '0 4px',
            }}>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Building2 size={16} style={{ color: '#fff' }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hubName}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name}</div>
              </div>
            </div>
          )}

          {/* Nav */}
          <nav>
            {TABS.map(({ key, label, Icon }) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  onClick={() => { setTab(key); setMobileOpen(false); }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center',
                    gap: collapsed ? 0 : 12,
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    padding: collapsed ? '10px 0' : '10px 12px',
                    borderRadius: 8, border: 'none', cursor: 'pointer',
                    marginBottom: 2, textAlign: 'left', fontSize: 14, fontWeight: active ? 600 : 500,
                    background: active ? (theme === 'dark' ? 'rgba(59,130,246,0.12)' : '#eff6ff') : 'transparent',
                    color: active ? 'var(--primary)' : 'var(--text-muted)',
                    borderLeft: active ? '3px solid var(--primary)' : '3px solid transparent',
                    paddingLeft: active && !collapsed ? 9 : collapsed ? undefined : 12,
                    transition: 'all 0.15s',
                    fontFamily: 'inherit',
                  }}
                  title={collapsed ? label : undefined}
                >
                  <Icon size={16} style={{ flexShrink: 0 }} />
                  {!collapsed && <span>{label}</span>}
                </button>
              );
            })}
          </nav>

          {/* Bottom actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button
              onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
              style={{
                display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 10,
                justifyContent: collapsed ? 'center' : 'flex-start',
                padding: collapsed ? '10px 0' : '9px 12px',
                borderRadius: 8, border: 'none', cursor: 'pointer',
                background: 'transparent', color: 'var(--text-muted)', fontSize: 14,
                fontFamily: 'inherit', width: '100%',
              }}
              title={collapsed ? (theme === 'dark' ? 'Light mode' : 'Dark mode') : undefined}
            >
              {theme === 'dark' ? <Sun size={15} style={{ flexShrink: 0 }} /> : <Moon size={15} style={{ flexShrink: 0 }} />}
              {!collapsed && (theme === 'dark' ? 'Light mode' : 'Dark mode')}
            </button>

            <button
              onClick={logout}
              style={{
                display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 10,
                justifyContent: collapsed ? 'center' : 'flex-start',
                padding: collapsed ? '10px 0' : '9px 12px',
                borderRadius: 8, border: 'none', cursor: 'pointer',
                background: 'transparent', color: 'var(--danger)', fontSize: 14, fontWeight: 500,
                fontFamily: 'inherit', width: '100%',
              }}
              title={collapsed ? 'Logout' : undefined}
            >
              <LogOut size={15} style={{ flexShrink: 0 }} />
              {!collapsed && 'Logout'}
            </button>
          </div>
        </aside>

        {/* Mobile sidebar backdrop */}
        {mobileOpen && (
          <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />
        )}

        {/* ── Main area ──────────────────────────────────────────────────── */}
        <div className="main">
          {/* Topbar */}
          <header className="topbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Mobile menu toggle */}
              <button
                onClick={() => setMobileOpen(o => !o)}
                className="mobile-menu-btn"
                style={{ padding: 7, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', display: 'none' }}
              >
                <Menu size={20} />
              </button>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                  {TABS.find(t => t.key === tab)?.label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hubName}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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

              <div className="user">
                <span className="role">Hub Portal</span>
                <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{user?.name}</span>
              </div>
            </div>
          </header>

          {/* Page content */}
          <div className="page-scroll">
            <div className="content">
              {renderTab()}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
