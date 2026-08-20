'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAppPaths } from '../lib/appPaths.js';
import { istToday } from '../lib/istDate.js';
import AppointmentSchedule from '../components/AppointmentSchedule.jsx';
import { useTopbarSearch, clearPageSearch } from '../lib/pageSearchStore.js';
import { api } from '../api/client.js';
import { usePushNotifications } from '../hooks/usePushNotifications.js';
import { NOTIF_POLL_MS } from '../config/polling.js';
import {
  LayoutDashboard, Calendar, FileText, Receipt, ReceiptText,
  LogOut, Moon, Sun, Menu, Building2,
  Loader2, IndianRupee, TrendingUp,
  PanelLeftClose, PanelLeftOpen,
  Wrench, Layers, Search, ChevronDown, ChevronUp, Tag,
  Bell, CheckCheck, Percent, Database, X, Settings, Eye, EyeOff,
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
      className={`card hubdash-kpi${clickable ? ' hubdash-kpi--link' : ''}`}
      onClick={onClick}
      style={{ borderBottom: clickable ? `3px solid ${accent}` : undefined }}
    >
      <div className="hubdash-kpi-icon" style={{ background: accent + '18' }}>
        <Icon size={20} style={{ color: accent }} />
      </div>
      <div className="hubdash-kpi-body">
        <div className="hubdash-kpi-label">{label}</div>
        {/* title= so a value too long for the card is still readable on hover
            rather than silently ellipsized away. */}
        <div className="hubdash-kpi-value" title={String(value)}>{value}</div>
        {sub && <div className="hubdash-kpi-sub" style={{ color: accent }}>{sub}</div>}
      </div>
      {clickable && <span className="hubdash-kpi-go" style={{ color: accent }}>View →</span>}
    </div>
  );
}

// ─── Tab: Dashboard ──────────────────────────────────────────────────────────

function DashboardTab({ hubId }) {
  const P = useAppPaths();
  const navigate = useNavigate();
  const [stats, setStats]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [addressMissing, setAddressMissing] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      setLoading(true);
      try {
        const today = istToday();
        const [apptRes, estRes, piRes] = await Promise.all([
          api(`/api/appointments?hub_id=${hubId}&limit=200`),
          api(`/api/estimates?hub_id=${hubId}&limit=200`),
          api(`/api/purchase-invoices?hub_id=${hubId}&limit=200`),
        ]);
        // Separate and failure-tolerant: a missing address is a nudge, not a
        // reason for the whole dashboard to show an error.
        api(`/api/hubs/${hubId}`)
          .then(r => { if (!dead) setAddressMissing(!r.item?.address_line1); })
          .catch(() => {});
        const appts = apptRes.items || [];
        const ests  = estRes.items  || [];
        const pis   = piRes.items   || [];

        if (dead) return;
        setStats({
          todayAppts:     appts.filter(a => a.scheduled_date?.slice(0, 10) === today).length,
          // The server's own count, not the length of one 200-row page — the
          // page length silently stops rising at 200 and reads as a plateau.
          totalAppts:     apptRes.total ?? appts.length,
          pendingEsts:    ests.filter(e => e.status === 'pending_company_review').length,
          approvedEsts:   ests.filter(e => e.status === 'fully_approved' || e.status === 'partially_approved').length,
          totalEsts:      estRes.total ?? ests.length,
          outstanding:    pis.filter(p => p.payment_status !== 'paid').reduce((s, p) => s + Number(p.grand_total || 0), 0),
          totalReceived:  pis.filter(p => p.payment_status === 'paid').reduce((s, p) => s + Number(p.amount_paid || 0), 0),
          pendingPIs:     pis.filter(p => p.payment_status === 'pending').length,
        });
      } catch { if (!dead) setStats(null); }
      finally  { if (!dead) setLoading(false); }
    })();
    return () => { dead = true; };
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

      {/* Without this the profile screen exists and nobody visits it, and the
          address stays blank on every invoice. Shown on the one page a hub
          opens every day, and it disappears the moment it is dealt with. */}
      {addressMissing && (
        <button
          type="button"
          className="card"
          onClick={() => navigate(P.profile)}
          style={{
            display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
            padding: '13px 18px', marginBottom: 16, fontFamily: 'inherit',
            borderLeft: '3px solid #f59e0b', background: '#fffbeb',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: '#92400e' }}>
            Your Sales Invoices are missing a supplier address
          </span>
          <span style={{ display: 'block', fontSize: 12.5, color: '#92400e', marginTop: 3 }}>
            A GST tax invoice must carry your address. Add it in Profile &amp; Settings →
          </span>
        </button>
      )}

      <div className="hubdash-kpis">
        <KpiCard icon={Calendar}    label="Today's Appointments" value={stats?.todayAppts ?? 0}      accent="var(--primary)" onClick={() => navigate(P.appointments)} />
        <KpiCard icon={Calendar}    label="Total Appointments"   value={stats?.totalAppts ?? 0}      accent="#6366f1"        onClick={() => navigate(P.appointments)} />
        <KpiCard icon={FileText}    label="Pending Estimates"    value={stats?.pendingEsts ?? 0}     accent="#f59e0b" sub="Awaiting company review" onClick={() => navigate(P.estimates)} />
        <KpiCard icon={FileText}    label="Approved Estimates"   value={stats?.approvedEsts ?? 0}    accent="var(--ok)"      onClick={() => navigate(P.estimates)} />
        <KpiCard icon={IndianRupee} label="Outstanding Payments" value={fmtINR(stats?.outstanding)}  accent="var(--danger)" sub={`${stats?.pendingPIs ?? 0} invoices pending`} onClick={() => navigate(P.salesInvoices)} />
        <KpiCard icon={TrendingUp}  label="Total Received"       value={fmtINR(stats?.totalReceived)} accent="var(--ok)"     onClick={() => navigate(P.salesInvoices)} />
      </div>

      <AppointmentSchedule />
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

// ─── Tab: Profile & Settings ─────────────────────────────────────────────────

function Row({ label, children, hint }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)' }}>{label}</label>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hint}</span>}
    </div>
  );
}

const inputCss = {
  width: '100%', boxSizing: 'border-box',
  padding: '9px 11px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--panel)',
  color: 'var(--text)', fontSize: 13, fontFamily: 'inherit',
};

// A password field with a reveal toggle. Typing a password you cannot see, on a
// phone, in a workshop, is where mistyped-twice comes from — and "confirm does
// not match" gives no clue which of the two was wrong.
//
// Each field owns its own `show`, so revealing the new password does not also
// expose the current one over someone's shoulder.
function PasswordInput({ value, onChange, autoComplete }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        // paddingRight clears the button — without it the text runs underneath.
        style={{ ...inputCss, paddingRight: 40 }}
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
      />
      <button
        // type="button" — inside a <form>, the default is submit, so this would
        // otherwise try to change the password every time someone peeked.
        type="button"
        onClick={() => setShow(v => !v)}
        title={show ? 'Hide password' : 'Show password'}
        aria-label={show ? 'Hide password' : 'Show password'}
        // tabIndex -1 keeps Tab going straight from field to field; the toggle
        // is a mouse/touch affordance, not a step in the form.
        tabIndex={-1}
        style={{
          position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 30, height: 30, padding: 0, borderRadius: 6,
          border: 'none', background: 'transparent', cursor: 'pointer',
          color: 'var(--text-muted)',
        }}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

// Shown, not hidden. These are the hub's own commercial terms and bank details;
// hiding them would just produce the same phone call the page exists to avoid.
// Read-only because a payout account editable from a phished login is how the
// money leaves, and the rates are negotiated, not declared.
function ReadOnly({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{value || '—'}</div>
    </div>
  );
}

function ProfileTab({ hubId }) {
  const { user } = useAuth();
  const [hub, setHub]         = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm]       = useState(null);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState('');
  const [err, setErr]         = useState('');

  const [pw, setPw]           = useState({ current_password: '', new_password: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg]     = useState('');
  const [pwErr, setPwErr]     = useState('');

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await api(`/api/hubs/${hubId}`);
        if (dead) return;
        setHub(r.item);
        setForm({
          person_name:    r.item.person_name    || '',
          contact_number: r.item.contact_number || '',
          owner_name:     r.item.owner_name     || '',
          owner_mobile:   r.item.owner_mobile   || '',
          address_line1:  r.item.address_line1  || '',
          address_line2:  r.item.address_line2  || '',
          pincode:        r.item.pincode        || '',
          map_url:        r.item.map_url        || '',
        });
      } catch (e) {
        if (!dead) setErr(e.message || 'Could not load your workshop details.');
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => { dead = true; };
  }, [hubId]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function saveDetails(e) {
    e.preventDefault();
    setErr(''); setMsg('');
    if (form.pincode && !/^\d{6}$/.test(form.pincode)) { setErr('Pincode must be exactly 6 digits.'); return; }
    if (form.contact_number && !/^\d{10}$/.test(form.contact_number)) { setErr('Contact number must be exactly 10 digits.'); return; }
    if (form.owner_mobile && !/^\d{10}$/.test(form.owner_mobile)) { setErr('Owner mobile must be exactly 10 digits.'); return; }
    setSaving(true);
    try {
      const r = await api('/api/hubs/me', { method: 'PATCH', body: form });
      setHub(r.item);
      setMsg('Saved. Your invoices will use this address from now on.');
    } catch (e) {
      setErr(e.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    setPwErr(''); setPwMsg('');
    if (pw.new_password.length < 6) { setPwErr('New password must be at least 6 characters.'); return; }
    if (pw.new_password !== pw.confirm) { setPwErr('The two new passwords do not match.'); return; }
    setPwSaving(true);
    try {
      await api('/api/me/password', {
        method: 'PATCH',
        body: { current_password: pw.current_password, new_password: pw.new_password },
      });
      setPw({ current_password: '', new_password: '', confirm: '' });
      setPwMsg('Password changed.');
    } catch (e) {
      setPwErr(e.message || 'Could not change the password.');
    } finally {
      setPwSaving(false);
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
      <Loader2 size={28} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
    </div>
  );
  if (!form) return <div className="card" style={{ padding: 40, textAlign: 'center', color: '#b45309' }}>{err || 'Could not load your details.'}</div>;

  const noAddress = !hub?.address_line1;

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="page-header">
        <div>
          <h2>Profile &amp; Settings</h2>
          <p>Your workshop details and login</p>
        </div>
      </div>

      {/* The reason this page exists, said where they will act on it. */}
      {noAddress && (
        <div className="card" style={{ padding: '14px 18px', marginBottom: 16, borderLeft: '3px solid #f59e0b', background: '#fffbeb' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e' }}>Your invoices are missing a supplier address</div>
          <div style={{ fontSize: 12.5, color: '#92400e', marginTop: 3, lineHeight: 1.5 }}>
            A GST tax invoice has to carry the supplier&rsquo;s address — that&rsquo;s you. Until it&rsquo;s filled in below,
            every Sales Invoice you issue prints with the address line blank.
          </div>
        </div>
      )}

      {/* ── Workshop details ── */}
      <form className="card" style={{ padding: 20, marginBottom: 18 }} onSubmit={saveDetails}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14.5, fontWeight: 700 }}>Workshop details</h3>
        <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--text-muted)' }}>
          The address here prints as the supplier block on your Sales Invoices.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
          <Row label="Address line 1">
            <input style={inputCss} value={form.address_line1} maxLength={200}
              onChange={e => set('address_line1', e.target.value)} placeholder="Shop / building no., street" />
          </Row>
          <Row label="Address line 2">
            <input style={inputCss} value={form.address_line2} maxLength={200}
              onChange={e => set('address_line2', e.target.value)} placeholder="Landmark, locality (optional)" />
          </Row>
          <Row label="Pincode">
            <input style={inputCss} value={form.pincode} inputMode="numeric" maxLength={6}
              onChange={e => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 digits" />
          </Row>
          <Row label="Point of contact">
            <input style={inputCss} value={form.person_name} maxLength={120}
              onChange={e => set('person_name', e.target.value)} placeholder="Who to ask for" />
          </Row>
          <Row label="Contact number">
            <input style={inputCss} value={form.contact_number} inputMode="numeric" maxLength={10}
              onChange={e => set('contact_number', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10 digits" />
          </Row>
          <Row label="Owner name">
            <input style={inputCss} value={form.owner_name} maxLength={120}
              onChange={e => set('owner_name', e.target.value)} />
          </Row>
          <Row label="Owner mobile">
            <input style={inputCss} value={form.owner_mobile} inputMode="numeric" maxLength={10}
              onChange={e => set('owner_mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10 digits" />
          </Row>
          <Row label="Google Maps link" hint="Sent to customers with their appointment">
            <input style={inputCss} value={form.map_url} maxLength={500}
              onChange={e => set('map_url', e.target.value)} placeholder="https://maps.app.goo.gl/…" />
          </Row>
        </div>

        {err && <div style={{ marginTop: 14, fontSize: 12.5, color: '#b91c1c', fontWeight: 600 }}>{err}</div>}
        {msg && <div style={{ marginTop: 14, fontSize: 12.5, color: '#15803d', fontWeight: 600 }}>{msg}</div>}

        <div style={{ marginTop: 18 }}>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save details'}
          </button>
        </div>
      </form>

      {/* ── Agreed terms — read only ── */}
      <div className="card" style={{ padding: 20, marginBottom: 18 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14.5, fontWeight: 700 }}>Agreed terms &amp; payout account</h3>
        <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--text-muted)' }}>
          Set by Spinoto. Contact your relationship manager to change any of these.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          <ReadOnly label="Hub code"        value={hub?.hub_code} />
          <ReadOnly label="Legal name"      value={hub?.company_name || hub?.hub_name} />
          <ReadOnly label="GST registered"  value={hub?.has_gst ? 'Yes' : 'No'} />
          <ReadOnly label="GSTIN"           value={hub?.gst_number} />
          <ReadOnly label="Commission %"    value={hub?.commission_percent != null ? `${hub.commission_percent}%` : null} />
          <ReadOnly label="Payout terms"    value={hub?.payout_terms} />
          <ReadOnly label="Bank"            value={hub?.bank_name} />
          <ReadOnly label="Account holder"  value={hub?.account_holder_name} />
          {/* Last four only. The full number is on file with Spinoto and does
              not need to be readable off a screen in a workshop. */}
          <ReadOnly label="Account number"  value={hub?.bank_account_number ? `••••  ${String(hub.bank_account_number).slice(-4)}` : null} />
          <ReadOnly label="IFSC"            value={hub?.bank_ifsc} />
        </div>
      </div>

      {/* ── Password ── */}
      <form className="card" style={{ padding: 20 }} onSubmit={changePassword}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14.5, fontWeight: 700 }}>Login &amp; password</h3>
        <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--text-muted)' }}>
          Signed in as <strong style={{ color: 'var(--text)' }}>{user?.email}</strong>
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
          <Row label="Current password">
            <PasswordInput autoComplete="current-password" value={pw.current_password}
              onChange={e => setPw(p => ({ ...p, current_password: e.target.value }))} />
          </Row>
          <Row label="New password" hint="At least 6 characters">
            <PasswordInput autoComplete="new-password" value={pw.new_password}
              onChange={e => setPw(p => ({ ...p, new_password: e.target.value }))} />
          </Row>
          <Row label="Confirm new password">
            <PasswordInput autoComplete="new-password" value={pw.confirm}
              onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} />
          </Row>
        </div>

        {pwErr && <div style={{ marginTop: 14, fontSize: 12.5, color: '#b91c1c', fontWeight: 600 }}>{pwErr}</div>}
        {pwMsg && <div style={{ marginTop: 14, fontSize: 12.5, color: '#15803d', fontWeight: 600 }}>{pwMsg}</div>}

        {/* Said rather than left to be discovered: the session is a stateless
            token, so changing the password does not sign anyone else out. */}
        <p style={{ margin: '14px 0 0', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Anyone already signed in on another device stays signed in until their session expires.
          If you think someone should not have access, tell Spinoto.
        </p>

        <div style={{ marginTop: 16 }}>
          <button className="btn btn-primary" type="submit"
            disabled={pwSaving || !pw.current_password || !pw.new_password || !pw.confirm}>
            {pwSaving ? 'Saving…' : 'Change password'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Nav tabs config ──────────────────────────────────────────────────────────

// `seg` is the URL segment under /hub. It is the source of truth for which tab
// is active — there is no tab state any more, so a refresh reloads the tab the
// user was on rather than resetting to the dashboard.
// Dashboard is the index route, hence the empty segment.
const TABS = [
  { key: 'dashboard',         seg: '',                  label: 'Dashboard',          Icon: LayoutDashboard },
  { key: 'appointments',      seg: 'appointments',      label: 'Appointments',       Icon: Calendar        },
  { key: 'estimates',         seg: 'estimates',         label: 'Estimates',          Icon: FileText        },
  { key: 'sell-invoices',     seg: 'sales-invoices',    label: 'Sales Invoices',     Icon: ReceiptText     },
  { key: 'customer-invoices', seg: 'customer-invoices', label: 'Customer Invoices',  Icon: Receipt         },
  { key: 'services-pricing',  seg: 'services',          label: 'Services & Pricing', Icon: Wrench          },
];

// Reachable and titled, but not a sidebar item — it is opened from the hub card
// or the sidebar footer. Listed here so tabFromPath resolves it to itself
// instead of falling through to 'dashboard' and highlighting the wrong nav row.
const HIDDEN_TABS = [
  { key: 'profile', seg: 'profile', label: 'Profile & Settings' },
];

const ALL_TABS = [...TABS, ...HIDDEN_TABS];

const TAB_PATH = Object.fromEntries(ALL_TABS.map(t => [t.key, t.seg ? `/hub/${t.seg}` : '/hub']));

/**
 * Which tab does this URL belong to?
 * Reads the FIRST segment after /hub only, so a deep link that carries a
 * record token (/hub/estimates/AbC123) still highlights Estimates.
 */
function tabFromPath(pathname) {
  const seg = pathname.replace(/^\/hub\/?/, '').split('/')[0] || '';
  return ALL_TABS.find(t => t.seg === seg)?.key || 'dashboard';
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HubDashboardPage() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // The list pages (Appointments, Estimates, Sales Invoices, Customer Invoices)
  // all publish their search box through pageSearchStore and expect a shell to
  // render it. Only AppShell did — and the hub portal deliberately renders no
  // AppShell — so every list in here had filters and pagination but no way to
  // search. This is the missing host, the same contract AppShell implements.
  const pageSearch = useTopbarSearch();
  const searchRef = useRef(null);
  // Derived, not state. This is the whole fix: the URL owns which tab is open,
  // so a refresh, the Back button and a pasted link all agree with each other.
  const tab = tabFromPath(location.pathname);
  const goTab = useCallback(key => navigate(TAB_PATH[key] || '/hub'), [navigate]);
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

  // Same polling rules as AppShell — see the comment there for why. This page
  // is the hub portal and renders outside AppShell (App.jsx: "standalone, no
  // AppShell"), so it cannot inherit that effect and needs its own copy.
  useEffect(() => {
    fetchCount();

    const iv = setInterval(() => {
      if (document.visibilityState === 'visible') fetchCount();
    }, NOTIF_POLL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchCount();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisibility);
    };
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

  // ⌘K / Ctrl+K focuses the search; Escape clears and blurs. Same bindings as
  // AppShell — a hub user who also has a staff login should not have to learn
  // two sets of keys.
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

  // Notification click opens the tab that owns that notification type.
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
      if (target) { setNotifOpen(false); goTab(target); }
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
    // Nested <Routes>, relative to the /hub/* splat in App.jsx — the same shape
    // AppShell uses for the admin branch.
    //
    // The ':token?' params are the point of the exercise. All four of these
    // pages already read `useParams().token` and open that record; mounted as
    // a bare <EstimatesPage /> in a switch there was no route to supply it, so
    // a hub could never deep-link or refresh into a record.
    return (
      <Routes>
        <Route index                          element={<DashboardTab hubId={hubId} />} />
        <Route path="appointments/:token?"      element={<AppointmentsPage />} />
        <Route path="estimates/:token?"         element={<EstimatesPage />} />
        <Route path="sales-invoices/:token?"    element={<PurchaseInvoicesPage />} />
        <Route path="customer-invoices/:token?" element={<CustomerInvoicesPage />} />
        <Route path="services"                  element={<ServicesTab hubId={hubId} />} />
        <Route path="profile"                   element={<ProfileTab hubId={hubId} />} />
        {/* Unknown sub-path → the dashboard, replacing history so Back does not
            bounce straight into the bad URL again. */}
        <Route path="*" element={<Navigate to="/hub" replace />} />
      </Routes>
    );
  }

  return (
    <>

      <div className={`shell hub-shell${collapsed ? ' collapsed' : ''}`}>

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

          {/* Hub badge — also the way into Profile & Settings, which is where
              people look for their own account. */}
          {!collapsed && (
            <button
              type="button"
              onClick={() => { goTab('profile'); setMobileOpen(false); }}
              title="Profile & Settings"
              style={{
                display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                padding: '10px 12px', background: 'var(--bg-soft)',
                border: `1px solid ${tab === 'profile' ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: 10, margin: '0 4px', width: 'calc(100% - 8px)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Building2 size={16} style={{ color: '#fff' }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hubName}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name}</div>
              </div>
            </button>
          )}

          {/* Nav */}
          <nav>
            {TABS.map(({ key, label, Icon }) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  onClick={() => { goTab(key); setMobileOpen(false); }}
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
              onClick={() => { goTab('profile'); setMobileOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 10,
                justifyContent: collapsed ? 'center' : 'flex-start',
                padding: collapsed ? '10px 0' : '9px 12px',
                borderRadius: 8, border: 'none', cursor: 'pointer',
                background: tab === 'profile' ? 'var(--bg-soft)' : 'transparent',
                color: tab === 'profile' ? 'var(--text)' : 'var(--text-muted)',
                fontSize: 14, fontFamily: 'inherit', width: '100%',
              }}
              title={collapsed ? 'Profile & Settings' : undefined}
            >
              <Settings size={15} style={{ flexShrink: 0 }} />
              {!collapsed && 'Profile & Settings'}
            </button>

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
          <header className="topbar hub-topbar">
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
                  {ALL_TABS.find(t => t.key === tab)?.label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hubName}</div>
              </div>
            </div>

            {/* Rendered only when the open page has claimed it — the Dashboard
                and Services tabs have their own search, so a box here would be
                a second one that did nothing. The wrapper stays mounted either
                way so the title and the actions keep their positions. */}
            <div className="topbar-center">
              {pageSearch.active && (
                <form className="topbar-search-wrap" onSubmit={e => e.preventDefault()}>
                  <Search size={14} className="topbar-search-icon" />
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
                  {/* The hint replaces the ⌘K badge rather than sitting under
                      it, so "2+ characters" never shifts the layout. */}
                  {pageSearch.hint
                    ? <span className="topbar-search-hint">{pageSearch.hint}</span>
                    : <kbd className="topbar-search-kbd">⌘K</kbd>}
                </form>
              )}
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
