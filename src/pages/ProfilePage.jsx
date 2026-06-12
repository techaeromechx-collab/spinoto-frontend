import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  User, Mail, Phone, Building2, Calendar, Shield, Activity,
  Lock, Bell, Settings, Users, TrendingUp, AlertTriangle,
  CheckCircle, Clock, Star, BarChart2, FileText, LogIn,
  Edit2, Save, X, Award, Zap, UserCheck, Target,
  AlertOctagon, Loader, MapPin, Hash, Globe,
  UserPlus, BarChart, CalendarPlus, PhoneCall,
} from 'lucide-react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import '../styles/ProfilePage.css';

// ── Role detection (same logic as UsersPage) ─────────────────────────────────
function detectRole(user) {
  if (!user) return { label: 'Unknown', color: '#9ca3af', bg: 'rgba(156,163,175,.10)', icon: '—' };
  if (user.is_super_admin) return { label: 'Super Admin', color: '#16a34a', bg: 'rgba(34,197,94,.10)',    icon: '🏅' };
  const p = new Set(user.permissions || []);
  if (p.has('MANAGE_USERS'))                             return { label: 'Admin',          color: '#dc2626', bg: 'rgba(220,38,38,.10)',    icon: '🛡️' };
  if (p.has('VIEW_TEAM_LEADS'))                          return { label: 'Manager',        color: '#d97706', bg: 'rgba(245,158,11,.10)',   icon: '👤' };
  if (p.has('VIEW_LEAD') && p.has('MANAGE_MASTER_DATA')) return { label: 'Senior Manager', color: '#7c3aed', bg: 'rgba(124,58,237,.10)',  icon: '🏆' };
  if (p.has('CREATE_LEAD') || p.has('VIEW_OWN_LEADS'))   return { label: 'Caller',         color: '#2563eb', bg: 'rgba(37,99,235,.10)',   icon: '📞' };
  if (p.size > 0)                                        return { label: 'Custom',         color: '#6b7280', bg: 'rgba(107,114,128,.10)', icon: '⚙️' };
  return { label: 'No Role', color: '#9ca3af', bg: 'rgba(156,163,175,.10)', icon: '—' };
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function timeAgo(d) {
  if (!d) return 'Never';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function activityLabel(type, oldVal, newVal) {
  switch (type) {
    case 'created':        return `Created lead${newVal ? ` with status "${newVal}"` : ''}`;
    case 'status_changed': return `Status: ${oldVal || '—'} → ${newVal || '—'}`;
    case 'note_added':     return 'Added a note';
    case 'assigned':       return `Assigned to ${newVal || '—'}`;
    default:               return type?.replace(/_/g, ' ') || 'Activity';
  }
}

// ── Lead trend area chart (Recharts) ─────────────────────────────────────────
function LeadTrendChart({ data, loading }) {
  if (loading) return <div className="prfl-chart-empty"><Loader size={18} style={{ animation: 'prfl-spin 0.8s linear infinite' }} /></div>;
  if (!data?.length) return <div className="prfl-chart-empty">No data for this period</div>;
  const chartData = data.map(d => ({
    label: d.label,
    'Total Leads':     parseInt(d.total)     || 0,
    'Converted Leads': parseInt(d.converted) || 0,
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#93c5fd" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#93c5fd" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="gradConv" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#2563eb" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ fontWeight: 600, color: 'var(--text)' }}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
        <Area type="monotone" dataKey="Total Leads"     stroke="#93c5fd" strokeWidth={2} fill="url(#gradTotal)" dot={{ fill: '#93c5fd', r: 4 }} activeDot={{ r: 5 }} />
        <Area type="monotone" dataKey="Converted Leads" stroke="#2563eb" strokeWidth={2} fill="url(#gradConv)"  dot={{ fill: '#2563eb', r: 4 }} activeDot={{ r: 5 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Conversion rate donut ─────────────────────────────────────────────────────
function ConversionDonut({ converted, total }) {
  const pct   = total > 0 ? (converted / total) * 100 : 0;
  const r     = 54;
  const circ  = 2 * Math.PI * r;
  const dash  = (pct / 100) * circ;
  return (
    <div className="prfl-conv-donut-wrap">
      <div className="prfl-conv-donut-pct" style={{ color: '#16a34a' }}>{pct.toFixed(1)}%</div>
      <div className="prfl-conv-donut-sub">{converted} of {total} leads converted</div>
      <div style={{ position: 'relative', width: 140, height: 140, margin: '16px auto 0' }}>
        <svg width="140" height="140" viewBox="0 0 140 140">
          <circle cx="70" cy="70" r={r} fill="none" stroke="var(--border)" strokeWidth="12" />
          {pct > 0 && (
            <circle
              cx="70" cy="70" r={r} fill="none"
              stroke="#16a34a" strokeWidth="12"
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeLinecap="round"
              transform="rotate(-90 70 70)"
            />
          )}
          <text x="70" y="75" textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--text)">{pct.toFixed(0)}%</text>
        </svg>
      </div>
      <div className="prfl-conv-donut-hint">
        {pct === 0 ? 'Keep engaging your leads to improve conversion rate.' : `Great work! ${pct.toFixed(1)}% conversion achieved.`}
      </div>
    </div>
  );
}

// ── Coming soon tile ──────────────────────────────────────────────────────────
function ComingSoon({ label, icon, gradient }) {
  return (
    <div className="prfl-coming-soon">
      <div className="prfl-coming-icon-wrap" style={{ background: gradient || 'linear-gradient(135deg,#e0e7ff,#c7d2fe)' }}>
        <span style={{ fontSize: 22 }}>{icon}</span>
      </div>
      <div className="prfl-coming-title">{label}</div>
      <span className="prfl-coming-badge">Coming Soon</span>
    </div>
  );
}

const COMING_GRADIENTS = [
  'linear-gradient(135deg,#dbeafe,#bfdbfe)',
  'linear-gradient(135deg,#dcfce7,#bbf7d0)',
  'linear-gradient(135deg,#fef3c7,#fde68a)',
  'linear-gradient(135deg,#ede9fe,#ddd6fe)',
  'linear-gradient(135deg,#fce7f3,#fbcfe8)',
  'linear-gradient(135deg,#cffafe,#a5f3fc)',
  'linear-gradient(135deg,#fee2e2,#fecaca)',
  'linear-gradient(135deg,#f0fdf4,#bbf7d0)',
  'linear-gradient(135deg,#fff7ed,#fed7aa)',
  'linear-gradient(135deg,#f5f3ff,#e9d5ff)',
  'linear-gradient(135deg,#ecfeff,#a5f3fc)',
  'linear-gradient(135deg,#fdf4ff,#f5d0fe)',
];

function KpiCard({ icon, color, label, val, sub, gradient, trend }) {
  // trend: { pct: number, dir: 'up'|'down'|'neutral' } | null
  const trendEl = trend ? (
    <div className={`prfl-kpi-trend prfl-kpi-trend--${trend.dir}`}>
      {trend.dir === 'up' ? '↑' : trend.dir === 'down' ? '↓' : '—'}
      {trend.dir !== 'neutral'
        ? ` ${Math.abs(trend.pct).toFixed(0)}% vs last month`
        : ' No change'}
    </div>
  ) : null;
  return (
    <div className="prfl-kpi-card">
      <div className="prfl-kpi-icon" style={{ background: gradient || (color + '18'), color }}>{icon}</div>
      <div className="prfl-kpi-val" style={{ color }}>{val}</div>
      <div className="prfl-kpi-lbl">{label}</div>
      {trendEl}
      {sub && <div className="prfl-kpi-sub">{sub}</div>}
    </div>
  );
}

function InfoRow({ icon, label, val }) {
  return (
    <div className="prfl-info-row">
      <span className="prfl-info-icon">{icon}</span>
      <span className="prfl-info-label">{label}</span>
      <span className="prfl-info-val">{val}</span>
    </div>
  );
}

function Spinner() {
  return (
    <div className="prfl-spinner"><Loader size={22} /></div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ icon, title, count }) {
  return (
    <div className="prfl-card-hd">
      <span className="prfl-card-title">
        {icon && <span className="prfl-card-title-icon">{icon}</span>}
        {title}
      </span>
      {count !== undefined && (
        <span className="prfl-card-count">{count}</span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY DETAILS CARD  (Super Admin only)
// ─────────────────────────────────────────────────────────────────────────────
const EMPTY_CO = {
  company_name: '', address_line1: '', address_line2: '',
  city: '', state: '', pincode: '', phone: '', email: '', gstin: '',
};

function CompanyDetailsCard() {
  const [form,    setForm]    = useState(EMPTY_CO);
  const [saved,   setSaved]   = useState(EMPTY_CO);   // last saved snapshot
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [ok,      setOk]      = useState(false);
  const [err,     setErr]     = useState(null);

  useEffect(() => {
    api('/api/settings/company')
      .then(d => { setForm(d); setSaved(d); })
      .catch(() => setErr('Failed to load company details.'))
      .finally(() => setLoading(false));
  }, []);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  }

  function cancelEdit() {
    setForm(saved);
    setEditing(false);
    setErr(null);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true); setErr(null); setOk(false);
    try {
      const res = await api('/api/settings/company', { method: 'PUT', body: form });
      const updated = res.item || res;
      setForm(updated); setSaved(updated);
      setEditing(false); setOk(true);
      setTimeout(() => setOk(false), 3000);
    } catch (ex) {
      setErr(ex.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="prfl-card">
        <SectionHeader icon={<Building2 size={15} />} title="Company Details" />
        <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          <Loader size={18} style={{ animation: 'spin 1s linear infinite', marginBottom: 6 }} /><br />Loading…
        </div>
      </div>
    );
  }

  const coFields = [
    { icon: <Building2 size={13}/>, label: 'Company Name',  val: saved.company_name  },
    { icon: <Hash      size={13}/>, label: 'GST / Tax No.',  val: saved.gstin         },
    { icon: <MapPin    size={13}/>, label: 'Address Line 1', val: saved.address_line1 },
    { icon: <MapPin    size={13}/>, label: 'Address Line 2', val: saved.address_line2 },
    { icon: <Globe     size={13}/>, label: 'City',           val: saved.city          },
    { icon: <Globe     size={13}/>, label: 'State',          val: saved.state         },
    { icon: <Globe     size={13}/>, label: 'Pincode',        val: saved.pincode       },
    { icon: <Phone     size={13}/>, label: 'Phone',          val: saved.phone         },
    { icon: <Mail      size={13}/>, label: 'Email',          val: saved.email         },
  ];

  return (
    <div className="prfl-card">
      <div className="prfl-card-hd" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="prfl-card-title">
          <span className="prfl-card-title-icon"><Building2 size={15} /></span>
          Company Details
        </span>
        {!editing && (
          <button
            className="prfl-btn-ghost prfl-btn-ghost--sm"
            onClick={() => { setEditing(true); setOk(false); setErr(null); }}
          >
            <Edit2 size={13} /> Edit
          </button>
        )}
      </div>

      {ok  && <div className="prfl-alert prfl-alert--success" style={{ margin: '0 0 14px' }}>Company details saved successfully!</div>}
      {err && <div className="prfl-alert prfl-alert--error"   style={{ margin: '0 0 14px' }}>{err}</div>}

      {!editing ? (
        <div className="prfl-co-grid">
          {coFields.map(({ icon, label, val }) => (
            <div key={label} className="prfl-co-field">
              <div className="prfl-co-field-icon">{icon}</div>
              <div>
                <div className="prfl-co-field-label">{label}</div>
                <div className="prfl-co-field-val" style={{ color: val ? 'var(--text)' : 'var(--text-muted)' }}>{val || '—'}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {[
              { name: 'company_name',  label: 'Company Name *',  placeholder: 'Aeromechx Automotive Pvt. Ltd.', full: true },
              { name: 'address_line1', label: 'Address Line 1',  placeholder: '919, Shilp Epitome, Sindhuabhavan Road' },
              { name: 'address_line2', label: 'Address Line 2',  placeholder: 'Ahmedabad' },
              { name: 'city',          label: 'City',             placeholder: 'Ahmedabad' },
              { name: 'state',         label: 'State',            placeholder: 'Gujarat' },
              { name: 'pincode',       label: 'Pincode',          placeholder: '380054' },
              { name: 'phone',         label: 'Phone / Mobile',   placeholder: '7480033800' },
              { name: 'email',         label: 'Email',            placeholder: 'info@company.com' },
              { name: 'gstin',         label: 'GST / Tax Number', placeholder: '24ABBCA0719K1ZY' },
            ].map(({ name, label, placeholder, full }) => (
              <div key={name} className="prfl-field" style={full ? { gridColumn: '1 / -1' } : {}}>
                <label>{label}</label>
                <input
                  name={name}
                  value={form[name]}
                  onChange={handleChange}
                  placeholder={placeholder}
                  required={name === 'company_name'}
                />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button type="button" className="prfl-btn-ghost" onClick={cancelEdit} disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <X size={14} /> Cancel
            </button>
            <button type="submit" className="prfl-btn-primary" disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Save size={14} /> {saving ? 'Saving…' : 'Save Company Details'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROLE CREATOR PANEL  (Super Admin only)
// ─────────────────────────────────────────────────────────────────────────────

// Permission groups order for the checklist
const PERM_GROUP_ORDER = [
  'Administration', 'Leads', 'Vehicles', 'Reference Data', 'Services', 'Pricing',
  'Hubs', 'Appointments', 'Customers', 'Estimates',
  'Invoices', 'Purchase Invoices', 'Parts', 'Discounts', 'Operations', 'Dashboard',
];

// ── Group icon helper ─────────────────────────────────────────────────────────
function roleGroupIcon(group) {
  const g = (group || '').toLowerCase();

  if (g.includes('admin') || g === 'administration')
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>;

  if (g === 'leads' || g.startsWith('lead'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;

  if (g.includes('vehicle'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v9a2 2 0 0 1-2 2h-2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>;

  if (g === 'services' || g.includes('service'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>;

  if (g === 'pricing' || g.includes('pric'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>;

  if (g === 'hubs' || g.startsWith('hub'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;

  if (g === 'appointments' || g.includes('appoint'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;

  if (g === 'customers' || g.includes('customer'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;

  if (g === 'estimates' || g.includes('estimate'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;

  if (g === 'invoices' || (g.includes('invoice') && !g.includes('purchase')))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>;

  if (g.includes('purchase'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>;

  if (g.includes('reference') || g.includes('ref data'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>;

  if (g === 'parts' || g.includes('part'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>;

  if (g === 'discounts' || g.includes('discount'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="9" r="2"/><circle cx="15" cy="15" r="2"/><line x1="4" y1="20" x2="20" y2="4"/></svg>;

  if (g === 'operations' || g.includes('operat'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>;

  if (g === 'dashboard' || g.includes('dashboard'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>;

  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>;
}

function RoleCreatorPanel() {
  const [roles,      setRoles]      = useState([]);
  const [catalog,    setCatalog]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [modalOpen,  setModalOpen]  = useState(false);
  const [editRole,   setEditRole]   = useState(null);
  const [deleting,   setDeleting]   = useState(null);
  const [err,        setErr]        = useState('');
  const [ok,         setOk]         = useState('');

  // Form state
  const EMPTY_FORM = { name: '', description: '', permissions: [], is_active: true };
  const [form,    setForm]    = useState(EMPTY_FORM);
  const [saving,  setSaving]  = useState(false);
  const [formErr, setFormErr] = useState('');

  // Active group in the two-column permission picker
  const [activeGroup, setActiveGroup] = useState('');

  useEffect(() => {
    Promise.all([
      api('/api/roles'),
      api('/api/users/permissions'),
    ]).then(([r, p]) => {
      setRoles(r.items || []);
      setCatalog(p.items || []);
    }).catch(() => setErr('Failed to load roles. Run the DB migration first.')).finally(() => setLoading(false));
  }, []);

  // Group permissions by group field, respecting PERM_GROUP_ORDER
  const grouped = {};
  for (const p of catalog) {
    if (!grouped[p.group]) grouped[p.group] = [];
    grouped[p.group].push(p);
  }
  const groupOrder = PERM_GROUP_ORDER.filter(g => grouped[g]);

  // Resolve active group — default to first
  const resolvedGroup = (activeGroup && grouped[activeGroup]) ? activeGroup : (groupOrder[0] || '');

  function openCreate() {
    setEditRole(null);
    setForm(EMPTY_FORM);
    setFormErr('');
    setActiveGroup(groupOrder[0] || '');
    setModalOpen(true);
  }

  function openEdit(role) {
    setEditRole(role);
    setForm({
      name:        role.name,
      description: role.description || '',
      permissions: role.permissions || [],
      is_active:   role.is_active,
    });
    setFormErr('');
    setActiveGroup(groupOrder[0] || '');
    setModalOpen(true);
  }

  function togglePerm(code) {
    setForm(f => ({
      ...f,
      permissions: f.permissions.includes(code)
        ? f.permissions.filter(c => c !== code)
        : [...f.permissions, code],
    }));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) { setFormErr('Role name is required.'); return; }
    setSaving(true); setFormErr('');
    try {
      const body = {
        name:        form.name.trim(),
        description: form.description.trim() || null,
        permissions: form.permissions,
        is_active:   form.is_active,
      };
      if (editRole) {
        const r = await api(`/api/roles/${editRole.id}`, { method: 'PUT', body });
        setRoles(prev => prev.map(x => x.id === editRole.id ? r.item : x));
        setOk(`Role "${r.item.name}" updated.`);
      } else {
        const r = await api('/api/roles', { method: 'POST', body });
        setRoles(prev => [...prev, r.item]);
        setOk(`Role "${r.item.name}" created.`);
      }
      setModalOpen(false);
      setTimeout(() => setOk(''), 3000);
    } catch (ex) {
      setFormErr(ex.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(role) {
    const userCount = role.user_count || 0;
    const warning = userCount > 0
      ? `⚠️ "${role.name}" is currently assigned to ${userCount} user${userCount > 1 ? 's' : ''}. Their role label will be removed.\n\n`
      : '';
    if (!window.confirm(`${warning}Delete role "${role.name}"? This cannot be undone.`)) return;
    setDeleting(role.id);
    try {
      await api(`/api/roles/${role.id}`, { method: 'DELETE' });
      setRoles(prev => prev.filter(r => r.id !== role.id));
      setOk(`Role "${role.name}" deleted.`);
      setTimeout(() => setOk(''), 3000);
    } catch (ex) {
      setErr(ex.message || 'Delete failed.');
    } finally {
      setDeleting(null);
    }
  }

  if (loading) return (
    <div className="prfl-card">
      <SectionHeader icon={<Shield size={15}/>} title="Custom Roles" />
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
        <Loader size={18} className="spin" />
      </div>
    </div>
  );

  return (
    <>
      <div className="prfl-card">
        {/* Card header */}
        <div className="rc-header">
          <div className="rc-header-left">
            <span className="rc-header-icon"><Shield size={15}/></span>
            <span className="rc-header-title">Custom Roles</span>
            <span className="rc-header-count">{roles.length}</span>
          </div>
          <button className="up-btn-primary rc-new-btn" onClick={openCreate}>
            + New Role
          </button>
        </div>

        {err && <div className="prfl-alert prfl-alert--error rc-alert">{err}</div>}
        {ok  && <div className="prfl-alert prfl-alert--success rc-alert">{ok}</div>}

        {/* Role list */}
        {roles.length === 0 ? (
          <div className="rc-empty">
            <Shield size={32} className="rc-empty-icon" />
            <p>No roles yet. Create your first role to bundle permissions.</p>
            <button className="up-btn-primary" onClick={openCreate}>+ Create first role</button>
          </div>
        ) : (
          <div className="rc-list">
            {roles.map(role => {
              const permCount = (role.permissions || []).length;
              return (
                <div key={role.id} className={`rc-row${role.is_active ? '' : ' rc-row--inactive'}`}>
                  {/* Shield icon */}
                  <div className="rc-row-icon">
                    <Shield size={17}/>
                  </div>
                  {/* Info */}
                  <div className="rc-row-info">
                    <div className="rc-row-name">
                      {role.name}
                      {!role.is_active && <span className="rc-row-badge rc-row-badge--inactive">Inactive</span>}
                    </div>
                    {role.description && <div className="rc-row-desc">{role.description}</div>}
                    <div className="rc-row-meta">
                      <span className="rc-row-perms">{permCount} permission{permCount !== 1 ? 's' : ''}</span>
                      {(role.user_count > 0) && (
                        <span className="rc-row-perms" style={{ color: '#0891b2' }}>{role.user_count} user{role.user_count !== 1 ? 's' : ''}</span>
                      )}
                      {permCount > 0 && (
                        <span className="rc-row-codes">
                          {(role.permissions || []).slice(0, 3).map(c => (
                            <span key={c} className="rc-row-code">{c.replace(/_/g, ' ')}</span>
                          ))}
                          {permCount > 3 && <span className="rc-row-code rc-row-code--more">+{permCount - 3} more</span>}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Actions */}
                  <div className="rc-row-actions">
                    <button className="up-btn-ghost rc-action-btn" onClick={() => openEdit(role)}>
                      <Edit2 size={13}/> Edit
                    </button>
                    <button
                      className="up-btn-ghost rc-action-btn rc-action-btn--danger"
                      onClick={() => handleDelete(role)}
                      disabled={deleting === role.id}
                    >
                      {deleting === role.id
                        ? <><Loader size={12} className="spin"/> Deleting…</>
                        : <><X size={13}/> Delete</>}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Create / Edit Modal ── */}
      {modalOpen && (
        <div className="up-pw-overlay rc-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModalOpen(false); }}>
          <div className="rc-modal" onClick={e => e.stopPropagation()}>

            {/* Modal header */}
            <div className="rc-modal-hd">
              <div className="rc-modal-title">
                <Shield size={16} style={{ color: 'var(--primary)', flexShrink: 0 }}/>
                {editRole ? `Edit Role: ${editRole.name}` : 'Create New Role'}
              </div>
              <button className="rc-modal-close" onClick={() => setModalOpen(false)} type="button">
                <X size={17}/>
              </button>
            </div>

            <form onSubmit={handleSave}>
              {/* Fields row */}
              <div className="rc-modal-fields">
                {formErr && <div className="prfl-alert prfl-alert--error" style={{ gridColumn: '1/-1' }}>{formErr}</div>}

                <div className="prfl-field">
                  <label>Role Name *</label>
                  <input
                    value={form.name} required
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Telecaller, Hub Manager, Field Agent"
                  />
                </div>

                <div className="prfl-field">
                  <label>Description</label>
                  <input
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="What this role is used for (optional)"
                  />
                </div>

                <div className="rc-active-toggle">
                  <input
                    type="checkbox" id="rc-is-active"
                    checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                    className="up-fg-checkbox"
                  />
                  <label htmlFor="rc-is-active">Active role</label>
                </div>
              </div>

              {/* Two-column permission picker — same as UsersPage */}
              <div className="rc-modal-perms-hd">
                Permissions
                <span className="rc-perms-count">{form.permissions.length} selected</span>
              </div>

              <div className="up-fg-perms rc-perms-picker">
                <div className="up-fg-header">Select permissions for this role</div>
                <div className="up-fg-body">
                  {/* Left: category sidebar */}
                  <div className="up-fg-sidebar">
                    {groupOrder.map(group => {
                      const enabledCount = (grouped[group] || []).filter(p => form.permissions.includes(p.code)).length;
                      const isActive = resolvedGroup === group;
                      return (
                        <button
                          key={group}
                          type="button"
                          className={`up-fg-cat${isActive ? ' up-fg-cat--active' : ''}`}
                          onClick={() => setActiveGroup(group)}
                        >
                          <span className="up-fg-cat-icon">{roleGroupIcon(group)}</span>
                          <span className="up-fg-cat-label">{group}</span>
                          {enabledCount > 0 && (
                            <span className="up-fg-cat-badge">{enabledCount}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Right: permissions for selected category */}
                  <div className="up-fg-perm-list">
                    {(grouped[resolvedGroup] || []).map(p => (
                      <label
                        key={p.code}
                        className={`up-fg-perm-row${form.permissions.includes(p.code) ? ' up-fg-perm-row--checked' : ''}`}
                      >
                        <input
                          type="checkbox"
                          className="up-fg-checkbox"
                          checked={form.permissions.includes(p.code)}
                          onChange={() => togglePerm(p.code)}
                        />
                        <div className="up-fg-perm-text">
                          <div className="up-fg-perm-label">{p.label}</div>
                          {p.description && <div className="up-fg-perm-desc">{p.description}</div>}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="rc-modal-footer">
                <button type="button" className="up-btn-ghost" onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="up-btn-primary" disabled={saving}>
                  {saving
                    ? <><Loader size={13} className="spin"/> Saving…</>
                    : (editRole ? '💾 Update Role' : '✓ Create Role')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGS PANEL  (Super Admin only)
// ─────────────────────────────────────────────────────────────────────────────
function LogsPanel() {
  const [subTab,    setSubTab]   = useState('logins');   // 'logins' | 'activity'

  // ── Login logs state ──────────────────────────────────────────────────────
  const [llRows,    setLlRows]   = useState([]);
  const [llTotal,   setLlTotal]  = useState(0);
  const [llPage,    setLlPage]   = useState(1);
  const [llUser,    setLlUser]   = useState('');
  const [llSuccess, setLlSuccess]= useState('');
  const [llLoading, setLlLoading]= useState(false);

  // ── Activity logs state ───────────────────────────────────────────────────
  const [alRows,    setAlRows]   = useState([]);
  const [alTotal,   setAlTotal]  = useState(0);
  const [alPage,    setAlPage]   = useState(1);
  const [alUser,    setAlUser]   = useState('');
  const [alAction,  setAlAction] = useState('');
  const [alEntity,  setAlEntity] = useState('');
  const [alLoading, setAlLoading]= useState(false);

  const LL_LIMIT = 25;
  const AL_LIMIT = 25;

  // ── Fetch login logs ──────────────────────────────────────────────────────
  useEffect(() => {
    if (subTab !== 'logins') return;
    setLlLoading(true);
    const p = new URLSearchParams({
      limit:  LL_LIMIT,
      offset: (llPage - 1) * LL_LIMIT,
    });
    if (llUser)    p.set('user_id', llUser);
    if (llSuccess !== '') p.set('success', llSuccess);
    api(`/api/logs/logins?${p}`)
      .then(d => { setLlRows(d.items || []); setLlTotal(d.total || 0); })
      .catch(() => {})
      .finally(() => setLlLoading(false));
  }, [subTab, llPage, llUser, llSuccess]);

  // ── Fetch activity logs ───────────────────────────────────────────────────
  useEffect(() => {
    if (subTab !== 'activity') return;
    setAlLoading(true);
    const p = new URLSearchParams({
      limit:  AL_LIMIT,
      offset: (alPage - 1) * AL_LIMIT,
    });
    if (alUser)   p.set('user_id', alUser);
    if (alAction) p.set('action',  alAction);
    if (alEntity) p.set('entity',  alEntity);
    api(`/api/logs/activity?${p}`)
      .then(d => { setAlRows(d.items || []); setAlTotal(d.total || 0); })
      .catch(() => {})
      .finally(() => setAlLoading(false));
  }, [subTab, alPage, alUser, alAction, alEntity]);

  function fmtTs(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  const llPages = Math.max(1, Math.ceil(llTotal / LL_LIMIT));
  const alPages = Math.max(1, Math.ceil(alTotal / AL_LIMIT));

  return (
    <div className="prfl-card" style={{ marginTop: 24 }}>
      <SectionHeader icon={<Activity size={15}/>} title="System Logs" count={subTab === 'logins' ? llTotal : alTotal} />

      {/* Sub-tabs */}
      <div className="logs-subtabs">
        <button className={`logs-subtab ${subTab === 'logins'   ? 'logs-subtab--active' : ''}`} onClick={() => setSubTab('logins')}>
          🔐 Login Logs
        </button>
        <button className={`logs-subtab ${subTab === 'activity' ? 'logs-subtab--active' : ''}`} onClick={() => setSubTab('activity')}>
          📋 Activity Logs
        </button>
      </div>

      {/* ── LOGIN LOGS ── */}
      {subTab === 'logins' && (
        <div>
          {/* Filters */}
          <div className="logs-filters">
            <input
              className="logs-input"
              type="number"
              placeholder="Filter by User ID"
              value={llUser}
              onChange={e => { setLlUser(e.target.value); setLlPage(1); }}
            />
            <select
              className="logs-input"
              value={llSuccess}
              onChange={e => { setLlSuccess(e.target.value); setLlPage(1); }}
            >
              <option value="">All attempts</option>
              <option value="true">✅ Success</option>
              <option value="false">❌ Failed</option>
            </select>
          </div>

          {llLoading ? (
            <div className="logs-loading"><Spinner /> Loading…</div>
          ) : llRows.length === 0 ? (
            <div className="logs-empty">No login logs found.</div>
          ) : (
            <div className="logs-table-wrap">
              <table className="logs-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Email</th>
                    <th>Status</th>
                    <th>IP Address</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {llRows.map(row => (
                    <tr key={row.id}>
                      <td>{row.user_name || <span className="logs-dim">Unknown</span>}</td>
                      <td className="logs-email">{row.email}</td>
                      <td>
                        <span className={`logs-badge ${row.success ? 'logs-badge--success' : 'logs-badge--fail'}`}>
                          {row.success ? '✅ Success' : '❌ Failed'}
                        </span>
                      </td>
                      <td className="logs-mono">{row.ip_address || '—'}</td>
                      <td className="logs-ts">{fmtTs(row.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {llPages > 1 && (
            <div className="logs-pager">
              <button className="logs-pg-btn" disabled={llPage <= 1} onClick={() => setLlPage(p => p - 1)}>‹ Prev</button>
              <span className="logs-pg-info">Page {llPage} / {llPages}  ({llTotal} total)</span>
              <button className="logs-pg-btn" disabled={llPage >= llPages} onClick={() => setLlPage(p => p + 1)}>Next ›</button>
            </div>
          )}
        </div>
      )}

      {/* ── ACTIVITY LOGS ── */}
      {subTab === 'activity' && (
        <div>
          {/* Filters */}
          <div className="logs-filters">
            <input
              className="logs-input"
              type="number"
              placeholder="Filter by User ID"
              value={alUser}
              onChange={e => { setAlUser(e.target.value); setAlPage(1); }}
            />
            <select
              className="logs-input"
              value={alAction}
              onChange={e => { setAlAction(e.target.value); setAlPage(1); }}
            >
              <option value="">All actions</option>
              <option value="CREATE">CREATE</option>
              <option value="UPDATE">UPDATE</option>
              <option value="DELETE">DELETE</option>
              <option value="STATUS">STATUS</option>
            </select>
            <select
              className="logs-input"
              value={alEntity}
              onChange={e => { setAlEntity(e.target.value); setAlPage(1); }}
            >
              <option value="">All entities</option>
              <option value="lead">Lead</option>
              <option value="appointment">Appointment</option>
              <option value="invoice">Invoice</option>
              <option value="estimate">Estimate</option>
              <option value="user">User</option>
            </select>
          </div>

          {alLoading ? (
            <div className="logs-loading"><Spinner /> Loading…</div>
          ) : alRows.length === 0 ? (
            <div className="logs-empty">No activity logs found.</div>
          ) : (
            <div className="logs-table-wrap">
              <table className="logs-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Description</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {alRows.map(row => (
                    <tr key={row.id}>
                      <td>{row.user_name || <span className="logs-dim">—</span>}</td>
                      <td>
                        <span className={`logs-badge logs-badge--action-${(row.action || '').toLowerCase()}`}>
                          {row.action}
                        </span>
                      </td>
                      <td className="logs-entity">{row.entity}{row.entity_id ? <span className="logs-dim"> #{row.entity_id}</span> : ''}</td>
                      <td className="logs-desc">{row.description || '—'}</td>
                      <td className="logs-ts">{fmtTs(row.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {alPages > 1 && (
            <div className="logs-pager">
              <button className="logs-pg-btn" disabled={alPage <= 1} onClick={() => setAlPage(p => p - 1)}>‹ Prev</button>
              <span className="logs-pg-info">Page {alPage} / {alPages}  ({alTotal} total)</span>
              <button className="logs-pg-btn" disabled={alPage >= alPages} onClick={() => setAlPage(p => p + 1)}>Next ›</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const role = detectRole(user);

  const perm         = new Set(user?.permissions || []);
  const isManager    = !user?.is_super_admin && perm.has('VIEW_TEAM_LEADS');
  const isAdmin      = !user?.is_super_admin && perm.has('MANAGE_USERS');
  const isSuperAdmin = !!user?.is_super_admin;
  const hasTeam      = isManager || isAdmin || isSuperAdmin;

  // ── Tabs ────────────────────────────────────────────────────────────────
  const tabs = [
    { key: 'overview',    label: 'Overview',    Icon: User       },
    { key: 'performance', label: 'Performance', Icon: TrendingUp },
    { key: 'activity',    label: 'Activity',    Icon: Activity   },
    ...(hasTeam        ? [{ key: 'team',      label: 'Team',       Icon: Users   }] : []),
    ...(isAdmin        ? [{ key: 'admin',     label: 'Admin',      Icon: Shield  }] : []),
    ...(isSuperAdmin   ? [{ key: 'superadmin',label: 'Super Admin',Icon: Zap     }] : []),
    ...(isSuperAdmin   ? [{ key: 'push',      label: 'Push Alerts', Icon: Bell   }] : []),
    { key: 'settings',   label: 'Settings',    Icon: Settings   },
  ];

  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const t = searchParams.get('tab');
    return t ? t : 'overview';
  });

  // Sub-tab for Activity tab: 'leads' | 'system'
  const [actSubTab, setActSubTab] = useState('leads');

  // Sub-tab for Settings tab: 'notifications' | 'password'
  const [settingsSubTab, setSettingsSubTab] = useState('notifications');

  // If URL tab param changes (e.g. navigated from dropdown)
  const prevTabParam = useRef(searchParams.get('tab'));
  useEffect(() => {
    const t = searchParams.get('tab');
    if (t && t !== prevTabParam.current) {
      prevTabParam.current = t;
      setActiveTab(t);
    }
  }, [searchParams]);

  // ── Remote data ──────────────────────────────────────────────────────────
  const [stats,       setStats]       = useState(null);
  const [activity,    setActivity]    = useState([]);
  const [teamStats,   setTeamStats]   = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [loadingStats,    setLoadingStats]    = useState(false);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [loadingTeam,     setLoadingTeam]     = useState(false);

  // ── Trend chart ──────────────────────────────────────────────────────────
  const TREND_RANGES = [
    { key: '7d',  label: 'Last 7 Days'   },
    { key: '30d', label: 'Last 30 Days'  },
    { key: '3m',  label: 'Last 3 Months' },
    { key: '6m',  label: 'Last 6 Months' },
  ];
  const [trendRange,      setTrendRange]      = useState('7d');
  const [trendData,       setTrendData]       = useState(null);
  const [loadingTrend,    setLoadingTrend]    = useState(false);
  const [trendDropOpen,   setTrendDropOpen]   = useState(false);

  // ── Edit profile ─────────────────────────────────────────────────────────
  const [editing,  setEditing]  = useState(false);
  const [editForm, setEditForm] = useState({});
  const [editBusy, setEditBusy] = useState(false);
  const [editErr,  setEditErr]  = useState('');

  // ── Password change (existing logic — unchanged) ─────────────────────────
  const [curPw,  setCurPw]  = useState('');
  const [newPw,  setNewPw]  = useState('');
  const [confPw, setConfPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr,  setPwErr]  = useState('');
  const [pwOk,   setPwOk]   = useState(false);

  // ── Push admin tab state ─────────────────────────────────────────────────
  const [pushStats,      setPushStats]      = useState(null);
  const [pushLoading,    setPushLoading]    = useState(false);
  const [alertCfg,       setAlertCfg]       = useState(null);
  const [alertCfgBusy,   setAlertCfgBusy]   = useState(false);
  const [alertCfgResult, setAlertCfgResult] = useState('');
  const [pushTestUser,   setPushTestUser]   = useState('');
  const [pushTestTitle,  setPushTestTitle]  = useState('');
  const [pushTestMsg,    setPushTestMsg]    = useState('');
  const [pushTestUrl,    setPushTestUrl]    = useState('/');
  const [pushTestResult, setPushTestResult] = useState('');
  const [pushTestBusy,   setPushTestBusy]   = useState(false);

  // ── Notification settings ────────────────────────────────────────────────
  const [notifSettings, setNotifSettings] = useState({
    overdue_lead: true, missed_followup: true, high_priority_lead: true,
    daily_target: true, inactive_lead: true,   lead_escalation: true,
    duplicate_lead: true, lead_assigned: true, lead_converted: true, no_activity: true,
    follow_up_scheduled: true, appointment_reminder: true, note_added: true,
  });

  // ── Data fetching ────────────────────────────────────────────────────────
  useEffect(() => {
    if ((activeTab === 'overview' || activeTab === 'performance') && !stats) {
      setLoadingStats(true);
      api('/api/me/stats').then(r => setStats(r)).catch(() => {}).finally(() => setLoadingStats(false));
    }
  }, [activeTab, stats]);

  // Fetch trend chart data whenever range changes or tab becomes active
  useEffect(() => {
    if (activeTab !== 'performance') return;
    setLoadingTrend(true);
    setTrendData(null);
    api(`/api/me/trend?range=${trendRange}`)
      .then(r => setTrendData(r.rows || []))
      .catch(() => setTrendData([]))
      .finally(() => setLoadingTrend(false));
  }, [activeTab, trendRange]);

  // Close trend dropdown on outside click
  useEffect(() => {
    if (!trendDropOpen) return;
    const handler = () => setTrendDropOpen(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [trendDropOpen]);

  useEffect(() => {
    if (activeTab === 'activity' && !activity.length) {
      setLoadingActivity(true);
      api('/api/me/activity').then(r => setActivity(r.items || [])).catch(() => {}).finally(() => setLoadingActivity(false));
    }
  }, [activeTab, activity.length]);

  useEffect(() => {
    if (activeTab === 'team' && !teamStats) {
      setLoadingTeam(true);
      Promise.all([
        api('/api/me/team-stats').catch(() => null),
        api('/api/me/team').catch(() => ({ items: [] })),
      ]).then(([ts, tm]) => {
        setTeamStats(ts);
        setTeamMembers(tm?.items || []);
      }).finally(() => setLoadingTeam(false));
    }
  }, [activeTab, teamStats]);

  useEffect(() => {
    if (user?.notification_settings && Object.keys(user.notification_settings).length) {
      setNotifSettings(prev => ({ ...prev, ...user.notification_settings }));
    }
  }, [user]);

  useEffect(() => {
    if (activeTab === 'push' && !pushStats) {
      setPushLoading(true);
      api('/api/push/admin/stats').then(r => setPushStats(r)).catch(() => {}).finally(() => setPushLoading(false));
    }
    if (activeTab === 'push' && !alertCfg) {
      api('/api/settings/alert').then(r => setAlertCfg(r)).catch(() => {});
    }
  }, [activeTab, pushStats, alertCfg]);

  async function saveAlertCfg() {
    setAlertCfgBusy(true); setAlertCfgResult('');
    try {
      const r = await api('/api/settings/alert', { method: 'PUT', body: alertCfg });
      setAlertCfg(r.alert_settings);
      setAlertCfgResult('✅ Saved');
    } catch (e) {
      setAlertCfgResult(`❌ ${e.message}`);
    } finally {
      setAlertCfgBusy(false);
      setTimeout(() => setAlertCfgResult(''), 3000);
    }
  }

  async function sendTestPush() {
    if (!pushTestTitle.trim()) { setPushTestResult('❌ Title is required'); return; }
    setPushTestBusy(true); setPushTestResult('');
    try {
      const body = {
        ...(pushTestUser ? { user_id: parseInt(pushTestUser, 10) } : {}),
        title:   pushTestTitle.trim(),
        message: pushTestMsg.trim() || ' ',
        url:     pushTestUrl || '/',
      };
      const r = await api('/api/push/admin/test', { method: 'POST', body });
      setPushTestResult(`✅ Sent to ${r.sent} device(s)${r.failed ? `, ${r.failed} failed` : ''}`);
    } catch (e) {
      setPushTestResult(`❌ ${e.message}`);
    } finally {
      setPushTestBusy(false);
    }
  }

  // ── Handlers ─────────────────────────────────────────────────────────────
  function startEdit() {
    setEditForm({
      name:         user?.name         || '',
      mobile:       user?.mobile       || '',
      department:   user?.department   || '',
      joining_date: user?.joining_date?.slice(0, 10) || '',
    });
    setEditErr('');
    setEditing(true);
  }

  async function saveProfile() {
    setEditBusy(true); setEditErr('');
    try {
      const r = await api('/api/me/profile', { method: 'PATCH', body: editForm });
      if (setUser) setUser(r.user);
      setEditing(false);
    } catch (e) { setEditErr(e.message); }
    finally { setEditBusy(false); }
  }

  // EXISTING unchanged password handler
  async function handleChangePw(e) {
    e.preventDefault();
    setPwErr(''); setPwOk(false);
    if (newPw !== confPw) { setPwErr('New passwords do not match.'); return; }
    setPwBusy(true);
    try {
      await api('/api/me/password', { method: 'PATCH', body: { current_password: curPw, new_password: newPw } });
      setPwOk(true); setCurPw(''); setNewPw(''); setConfPw('');
    } catch (e) { setPwErr(e.message); }
    finally { setPwBusy(false); }
  }

  async function saveNotifSettings(updated) {
    const next = { ...notifSettings, ...updated };
    setNotifSettings(next);
    api('/api/me/profile', { method: 'PATCH', body: { notification_settings: next } }).catch(() => {});
  }

  if (!user) return null;

  const initials = user.name?.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || '?';

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="prfl-page">

      {/* ── HERO HEADER ── */}
      <div className="prfl-hero">
        {/* Decorative wave lines */}
        <svg className="prfl-hero-wave" viewBox="0 0 900 170" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
          <path d="M0,55 C120,25 240,75 360,45 C480,15 600,65 720,38 C800,18 860,48 900,38" stroke="rgba(124,58,237,0.15)" strokeWidth="1.5"/>
          <path d="M0,90 C120,62 240,108 360,80 C480,52 600,96 720,72 C800,54 860,80 900,72" stroke="rgba(124,58,237,0.10)" strokeWidth="1.5"/>
          <path d="M0,125 C120,102 240,138 360,115 C480,92 600,125 720,108 C800,95 860,112 900,106" stroke="rgba(79,70,229,0.08)" strokeWidth="1"/>
        </svg>

        {/* Top row: avatar + info + edit button */}
        <div className="prfl-hero-top">
          <div className="prfl-hero-left">
            <div className="prfl-avatar-wrap">
              <div className="prfl-avatar">{initials}</div>
              <div className="prfl-online-dot" />
            </div>
            <div className="prfl-hero-info">
              <div className="prfl-hero-name">
                {user.name}
                {user.is_super_admin && <span className="prfl-hero-verified">✓</span>}
              </div>
              <div className="prfl-hero-email">{user.email}</div>
              <span className="prfl-role-badge" style={{ color: role.color, background: role.bg, borderColor: role.color + '30' }}>
                {role.icon}&nbsp;{role.label}
              </span>
            </div>
          </div>
          <button className="prfl-edit-hero-btn" onClick={startEdit}>
            <Edit2 size={13} /> Edit Profile
          </button>
        </div>

        {/* Bottom stats strip */}
        <div className="prfl-hero-stats">
          <div className="prfl-hero-stats-item">
            <User size={13} className="prfl-hero-meta-icon" />
            <div>
              <div className="prfl-hero-meta-label">User ID</div>
              <div className="prfl-hero-meta-val">{user.id}</div>
            </div>
          </div>
          <div className="prfl-hero-meta-sep" />
          <div className="prfl-hero-stats-item">
            <Calendar size={13} className="prfl-hero-meta-icon" />
            <div>
              <div className="prfl-hero-meta-label">Joined</div>
              <div className="prfl-hero-meta-val">{fmtDate(user.joining_date)}</div>
            </div>
          </div>
          <div className="prfl-hero-meta-sep" />
          <div className="prfl-hero-stats-item">
            <LogIn size={13} className="prfl-hero-meta-icon" />
            <div>
              <div className="prfl-hero-meta-label">Last Login</div>
              <div className="prfl-hero-meta-val">{timeAgo(user.last_login)}</div>
            </div>
          </div>
          <div className="prfl-hero-meta-sep" />
          <div className="prfl-hero-stats-item">
            <Globe size={13} className="prfl-hero-meta-icon" />
            <div>
              <div className="prfl-hero-meta-label">Timezone</div>
              <div className="prfl-hero-meta-val">Asia/Kolkata (UTC+5:30)</div>
            </div>
          </div>
          {user.mobile && <>
            <div className="prfl-hero-meta-sep" />
            <div className="prfl-hero-stats-item">
              <Phone size={13} className="prfl-hero-meta-icon" />
              <div>
                <div className="prfl-hero-meta-label">Mobile</div>
                <div className="prfl-hero-meta-val">{user.mobile}</div>
              </div>
            </div>
          </>}
        </div>
      </div>

      {/* ── CONTENT (tabs + body) ── */}
      <div className="prfl-content">

        {/* Tab bar */}
        <div className="prfl-tabs">
          {tabs.map(({ key, label, Icon }) => (
            <button
              key={key}
              className={`prfl-tab${activeTab === key ? ' prfl-tab--active' : ''}`}
              onClick={() => setActiveTab(key)}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        {/* ───── OVERVIEW ───── */}
        {activeTab === 'overview' && (
          <div className="prfl-tab-body">
            {loadingStats ? <Spinner /> : <>
              <div className="prfl-kpi-grid">
                <KpiCard icon={<Users size={18}/>}         color="#2563eb" gradient="linear-gradient(135deg,#dbeafe,#bfdbfe)" label="Total Leads"        val={stats?.total_leads        ?? '—'} />
                <KpiCard icon={<CheckCircle size={18}/>}   color="#16a34a" gradient="linear-gradient(135deg,#dcfce7,#bbf7d0)" label="Converted"          val={stats?.converted_leads    ?? '—'} />
                <KpiCard icon={<Clock size={18}/>}         color="#d97706" gradient="linear-gradient(135deg,#fef3c7,#fde68a)" label="Pending"            val={stats?.pending_leads      ?? '—'} />
                <KpiCard icon={<AlertTriangle size={18}/>} color="#dc2626" gradient="linear-gradient(135deg,#fee2e2,#fecaca)" label="Overdue Follow-ups" val={stats?.overdue_followups  ?? '—'} />
                <KpiCard icon={<Target size={18}/>}        color="#7c3aed" gradient="linear-gradient(135deg,#ede9fe,#ddd6fe)" label="Follow-ups Today"   val={stats?.today_followups    ?? '—'} />
                <KpiCard icon={<Activity size={18}/>}      color="#0891b2" gradient="linear-gradient(135deg,#cffafe,#a5f3fc)" label="Activities (Month)" val={stats?.monthly_activities ?? '—'} />
              </div>

              <div className="prfl-overview-grid">
                <div className="prfl-card">
                  <SectionHeader icon={<User size={15}/>} title="Account Information" />
                  <div className="prfl-info-grid">
                    <InfoRow icon={<User size={13}/>}      label="Full Name"    val={user.name} />
                    <InfoRow icon={<Mail size={13}/>}      label="Email"        val={user.email} />
                    <InfoRow icon={<Phone size={13}/>}     label="Mobile"       val={user.mobile || '—'} />
                    <InfoRow icon={<Building2 size={13}/>} label="Department"   val={user.department || '—'} />
                    <InfoRow icon={<Calendar size={13}/>}  label="Joining Date" val={fmtDate(user.joining_date)} />
                    <InfoRow icon={<Shield size={13}/>}    label="Role"         val={<span style={{ color: role.color, fontWeight: 600 }}>{role.icon} {role.label}</span>} />
                    <InfoRow icon={<LogIn size={13}/>}     label="Last Login"   val={timeAgo(user.last_login)} />
                    <InfoRow icon={<UserCheck size={13}/>} label="Reports To"   val={user.manager_name || '—'} />
                  </div>
                </div>

                {user.permissions?.length > 0 && (
                  <div className="prfl-card">
                    <SectionHeader icon={<Shield size={15}/>} title="Permissions" count={user.permissions.length} />
                    <div className="prfl-perms-grid">
                      {user.permissions.map((code, idx) => (
                        <span key={code} className="prfl-perm-chip" style={{ '--chip-color': ['#2563eb','#16a34a','#7c3aed','#0891b2','#d97706','#dc2626'][idx % 6] }}>
                          <CheckCircle size={9} />
                          {code.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>}
          </div>
        )}

        {/* ───── PERFORMANCE ───── */}
        {activeTab === 'performance' && (
          <div className="prfl-tab-body">
            {loadingStats ? <Spinner /> : (() => {
              function calcTrend(cur, prev) {
                if (prev == null) return null;
                if (prev === 0)   return cur > 0 ? { dir: 'up', pct: 100 } : { dir: 'neutral', pct: 0 };
                const pct = ((cur - prev) / prev) * 100;
                return { dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral', pct };
              }

              const t = {
                total:      calcTrend(stats?.total_leads,        stats?.prev_total_leads),
                converted:  calcTrend(stats?.converted_leads,    stats?.prev_converted_leads),
                pending:    calcTrend(stats?.pending_leads,      stats?.prev_pending_leads),
                notes:      calcTrend(stats?.notes_count,        stats?.prev_notes_count),
                activities: calcTrend(stats?.monthly_activities, stats?.prev_monthly_activities),
                followups:  calcTrend(stats?.today_followups,    stats?.prev_today_followups),
              };

              return <>
                {/* KPI cards */}
                <div className="prfl-kpi-grid">
                  <KpiCard icon={<Users size={20}/>}       color="#2563eb" gradient="linear-gradient(135deg,#dbeafe,#bfdbfe)" label="Total Leads"        val={stats?.total_leads        ?? '—'} trend={t.total} />
                  <KpiCard icon={<CheckCircle size={20}/>} color="#16a34a" gradient="linear-gradient(135deg,#dcfce7,#bbf7d0)" label="Converted Leads"    val={stats?.converted_leads    ?? '—'} trend={t.converted} />
                  <KpiCard icon={<Clock size={20}/>}       color="#d97706" gradient="linear-gradient(135deg,#fef3c7,#fde68a)" label="Pending Leads"      val={stats?.pending_leads      ?? '—'} trend={t.pending} />
                  <KpiCard icon={<FileText size={20}/>}    color="#0891b2" gradient="linear-gradient(135deg,#cffafe,#a5f3fc)" label="Notes Added"        val={stats?.notes_count        ?? '—'} trend={t.notes} />
                  <KpiCard icon={<Activity size={20}/>}    color="#7c3aed" gradient="linear-gradient(135deg,#ede9fe,#ddd6fe)" label="Monthly Activities" val={stats?.monthly_activities ?? '—'} trend={t.activities} />
                  <KpiCard icon={<Target size={20}/>}      color="#d97706" gradient="linear-gradient(135deg,#fff7ed,#fed7aa)" label="Follow-ups Today"   val={stats?.today_followups    ?? '—'} trend={t.followups} />
                </div>

                {/* Chart row */}
                <div className="prfl-perf-chart-row">
                  <div className="prfl-card prfl-perf-chart-main">
                    <div className="prfl-perf-chart-hd">
                      <SectionHeader icon={<TrendingUp size={15}/>} title={`Lead Trend — ${TREND_RANGES.find(r=>r.key===trendRange)?.label}`} />
                      {/* Range dropdown */}
                      <div className="prfl-trend-drop-wrap" onClick={e => e.stopPropagation()}>
                        <button
                          className="prfl-perf-range-badge"
                          onClick={() => setTrendDropOpen(o => !o)}
                        >
                          {TREND_RANGES.find(r=>r.key===trendRange)?.label} ▾
                        </button>
                        {trendDropOpen && (
                          <div className="prfl-trend-drop">
                            {TREND_RANGES.map(r => (
                              <button
                                key={r.key}
                                className={`prfl-trend-drop-item${trendRange===r.key?' prfl-trend-drop-item--active':''}`}
                                onClick={() => { setTrendRange(r.key); setTrendDropOpen(false); }}
                              >
                                {r.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <LeadTrendChart data={trendData} loading={loadingTrend} />
                  </div>
                  <div className="prfl-card prfl-perf-conv-card">
                    <SectionHeader icon={<Award size={15}/>} title="Conversion Rate" />
                    <ConversionDonut converted={stats?.converted_leads ?? 0} total={stats?.total_leads ?? 0} />
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="prfl-perf-qa">
                  <div className="prfl-perf-qa-title">QUICK ACTIONS</div>
                  <div className="prfl-perf-qa-grid">
                    {[
                      { icon: <UserPlus  size={18} color="#16a34a"/>, label: 'Add New Lead',       bg: '#f0fdf4', path: '/leads?action=new'         },
                      { icon: <Building2 size={18} color="#2563eb"/>, label: 'Create HUB',         bg: '#eff6ff', path: '/hubs?action=new'           },
                      { icon: <CalendarPlus size={18} color="#7c3aed"/>, label: 'Schedule Activity', bg: '#f5f3ff', path: '/leads'                    },
                      { icon: <PhoneCall size={18} color="#d97706"/>, label: 'Add Follow-up',      bg: '#fff7ed', path: '/leads'                     },
                      { icon: <BarChart  size={18} color="#16a34a"/>, label: 'View Reports',       bg: '#f0fdf4', path: '/reports'                   },
                    ].map(a => (
                      <button key={a.label} className="prfl-qa-btn" onClick={() => navigate(a.path)}>
                        <span className="prfl-qa-icon" style={{ background: a.bg }}>{a.icon}</span>
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>;
            })()}
          </div>
        )}

        {/* ───── ACTIVITY ───── */}
        {activeTab === 'activity' && (
          <div className="prfl-tab-body">
            {/* Sub-tabs */}
            <div className="act-subtabs">
              <button
                className={`act-subtab${actSubTab === 'leads' ? ' act-subtab--active' : ''}`}
                onClick={() => setActSubTab('leads')}
              >
                📋 Lead Activity
              </button>
              {isSuperAdmin && (
                <button
                  className={`act-subtab${actSubTab === 'system' ? ' act-subtab--active' : ''}`}
                  onClick={() => setActSubTab('system')}
                >
                  🔐 System Logs
                </button>
              )}
            </div>

            {/* Lead Activity */}
            {actSubTab === 'leads' && (
              <div className="prfl-card">
                <SectionHeader icon={<Activity size={15}/>} title="Recent Lead Activities" />
                {loadingActivity ? <Spinner /> : activity.length === 0
                  ? <div className="prfl-empty">No activity yet</div>
                  : (
                    <div className="prfl-timeline">
                      {activity.map(a => (
                        <div key={a.id} className="prfl-timeline-item">
                          <div className="prfl-tl-dot" />
                          <div className="prfl-tl-content">
                            <div className="prfl-tl-label">{activityLabel(a.type, a.old_value, a.new_value)}</div>
                            <div className="prfl-tl-lead">{a.lead_name || a.lead_mobile || `Lead #${a.lead_id}`}</div>
                            <div className="prfl-tl-time">{timeAgo(a.created_at)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            )}

            {/* System Logs — super admin only */}
            {actSubTab === 'system' && isSuperAdmin && (
              <LogsPanel />
            )}
          </div>
        )}

        {/* ───── TEAM ───── */}
        {activeTab === 'team' && (
          <div className="prfl-tab-body">
            {loadingTeam ? <Spinner /> : <>
              <div className="prfl-kpi-grid">
                <KpiCard icon={<Users size={18}/>}         color="#2563eb" gradient="linear-gradient(135deg,#dbeafe,#bfdbfe)" label="Team Members"   val={teamStats?.active_members ?? '—'} />
                <KpiCard icon={<BarChart2 size={18}/>}     color="#7c3aed" gradient="linear-gradient(135deg,#ede9fe,#ddd6fe)" label="Team Leads"     val={teamStats?.team_leads     ?? '—'} />
                <KpiCard icon={<CheckCircle size={18}/>}   color="#16a34a" gradient="linear-gradient(135deg,#dcfce7,#bbf7d0)" label="Team Converted" val={teamStats?.team_converted ?? '—'} />
                <KpiCard icon={<AlertTriangle size={18}/>} color="#dc2626" gradient="linear-gradient(135deg,#fee2e2,#fecaca)" label="Overdue"        val={teamStats?.team_overdue   ?? '—'} />
                <KpiCard icon={<AlertOctagon size={18}/>}  color="#9333ea" gradient="linear-gradient(135deg,#fdf4ff,#f5d0fe)" label="Escalated"      val={teamStats?.escalated      ?? '—'} />
                {teamStats?.best_performer && (
                  <KpiCard icon={<Star size={18}/>} color="#d97706" gradient="linear-gradient(135deg,#fef3c7,#fde68a)"
                    label="Best Performer" val={teamStats.best_performer.name}
                    sub={`${teamStats.best_performer.converted} converted`}
                  />
                )}
              </div>

              <div className="prfl-card">
                <SectionHeader icon={<Users size={15}/>} title="Team Members" count={teamMembers.length} />
                {teamMembers.length === 0
                  ? <div className="prfl-empty">No team members assigned yet</div>
                  : (
                    <div className="prfl-team-list">
                      {teamMembers.map(m => {
                        const mr = detectRole(m);
                        return (
                          <div key={m.id} className="prfl-team-row">
                            <div className="prfl-team-avatar">{m.name?.charAt(0).toUpperCase()}</div>
                            <div className="prfl-team-info">
                              <div className="prfl-team-name">{m.name}</div>
                              <div className="prfl-team-email">{m.email}</div>
                            </div>
                            <span className="prfl-role-badge" style={{ color: mr.color, background: mr.bg, borderColor: mr.color + '30', fontSize: 10 }}>
                              {mr.icon} {mr.label}
                            </span>
                            <div className="prfl-team-stats">
                              <span>{m.total_leads} leads</span>
                              <span style={{ color:'#16a34a' }}>{m.converted_leads} won</span>
                              {parseInt(m.overdue_count) > 0 && <span style={{ color:'#dc2626' }}>{m.overdue_count} overdue</span>}
                            </div>
                            <div className={`prfl-team-status ${m.is_active ? 'prfl-team-status--active':'prfl-team-status--inactive'}`}>
                              {m.is_active ? 'Active' : 'Inactive'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
              </div>
            </>}
          </div>
        )}

        {/* ───── ADMIN ───── */}
        {activeTab === 'admin' && (
          <div className="prfl-tab-body">
            <div className="prfl-coming-grid">
              {[
                { label: 'Lead Source Management',  icon: '🔗', g: COMING_GRADIENTS[0] },
                { label: 'Pipeline Management',     icon: '🏗️', g: COMING_GRADIENTS[1] },
                { label: 'Bulk Upload Control',     icon: '📤', g: COMING_GRADIENTS[2] },
                { label: 'Login Logs',              icon: '🔐', g: COMING_GRADIENTS[3] },
                { label: 'User Activity Logs',      icon: '📋', g: COMING_GRADIENTS[4] },
                { label: 'Full CRM Analytics',      icon: '📊', g: COMING_GRADIENTS[5] },
                { label: 'Revenue Charts',          icon: '💰', g: COMING_GRADIENTS[6] },
                { label: 'Department Reports',      icon: '🗂️', g: COMING_GRADIENTS[7] },
              ].map(({ label, icon, g }) => (
                <ComingSoon key={label} label={label} icon={icon} gradient={g} />
              ))}
            </div>
          </div>
        )}

        {/* ───── SUPER ADMIN ───── */}
        {activeTab === 'superadmin' && (
          <div className="prfl-tab-body">
            <CompanyDetailsCard />
            <RoleCreatorPanel />
          </div>
        )}

        {/* ───── PUSH ALERTS (super admin only) ───── */}
        {activeTab === 'push' && (
          <div className="prfl-tab-body">
            <div className="prfl-card">
              <SectionHeader icon={<Bell size={15}/>} title="Push Notification Devices" count={pushStats?.total_devices} />
              <p className="prfl-card-desc">
                All devices where users have installed the Spinoto PWA and allowed notifications.
                Notifications respect each user's personal toggles in their Settings tab.
              </p>
              {pushLoading && <div style={{ padding: '16px 0', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>}
              {pushStats && (
                <div className="logs-table-wrap" style={{ marginTop: 12 }}>
                  <table className="logs-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Email</th>
                        <th style={{ textAlign: 'center' }}>Devices</th>
                        <th>Last Subscribed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pushStats.users.map(u => (
                        <tr key={u.id}>
                          <td>{u.name || '—'}</td>
                          <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{u.email}</td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{
                              display: 'inline-block',
                              padding: '2px 10px',
                              borderRadius: 12,
                              fontSize: 12,
                              fontWeight: 600,
                              background: u.device_count > 0 ? 'rgba(22,163,74,.12)' : 'var(--bg-hover)',
                              color: u.device_count > 0 ? '#16a34a' : 'var(--text-muted)',
                            }}>
                              {u.device_count}
                            </span>
                          </td>
                          <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                            {u.last_subscribed ? new Date(u.last_subscribed).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Alert Thresholds ── */}
            <div className="prfl-card">
              <SectionHeader icon={<Settings size={15}/>} title="Alert Thresholds" />
              <p className="prfl-card-desc">Configure when each automatic alert fires. Changes take effect on the next scheduler run (every 10 min).</p>
              {alertCfg && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
                  {[
                    { key: 'no_activity_hours',       label: 'No Activity Alert',         unit: 'hours',   desc: 'Alert if no CRM activity for X hours' },
                    { key: 'inactive_lead_days',       label: 'Inactive Lead Alert',        unit: 'days',    desc: 'Alert if lead has no activity for X days' },
                    { key: 'daily_target_hour',        label: 'Daily Target Check Time',    unit: 'hour (24h)', desc: 'Check target after this hour (18 = 6 PM)' },
                    { key: 'escalation_overdue_days',  label: 'Escalation — Overdue Days',  unit: 'days',    desc: 'Escalate if lead overdue by X days' },
                    { key: 'escalation_missed_count',  label: 'Escalation — Missed Follow-ups', unit: 'count', desc: 'Escalate if X or more follow-ups missed' },
                    { key: 'work_start_hour',          label: 'Working Hours Start',        unit: 'hour (24h)', desc: 'No Activity alert starts at this hour' },
                    { key: 'work_end_hour',            label: 'Working Hours End',          unit: 'hour (24h)', desc: 'No Activity alert stops at this hour' },
                  ].map(({ key, label, unit, desc }) => (
                    <div key={key} className="prfl-field" style={{ margin: 0 }}>
                      <label style={{ fontSize: 12 }}>{label} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({unit})</span></label>
                      <input
                        type="number"
                        min={1}
                        value={alertCfg[key] ?? ''}
                        onChange={e => setAlertCfg(prev => ({ ...prev, [key]: parseInt(e.target.value, 10) || 1 }))}
                        title={desc}
                      />
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
                <button className="prfl-btn-primary" onClick={saveAlertCfg} disabled={alertCfgBusy || !alertCfg}>
                  {alertCfgBusy ? 'Saving…' : 'Save Thresholds'}
                </button>
                {alertCfgResult && <span style={{ fontSize: 13, color: alertCfgResult.startsWith('✅') ? '#16a34a' : '#dc2626' }}>{alertCfgResult}</span>}
              </div>
            </div>

            <div className="prfl-card">
              <SectionHeader icon={<Zap size={15}/>} title="Send Custom Notification" />
              <p className="prfl-card-desc">Write your own notification and push it to any subscribed user.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                {/* Send to */}
                <div className="prfl-field">
                  <label>Send To</label>
                  <select
                    value={pushTestUser}
                    onChange={e => setPushTestUser(e.target.value)}
                    style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13 }}
                  >
                    <option value="">My device (self)</option>
                    {(pushStats?.users || []).filter(u => u.device_count > 0).map(u => (
                      <option key={u.id} value={u.id}>{u.name} ({u.device_count} device{u.device_count > 1 ? 's' : ''})</option>
                    ))}
                  </select>
                </div>
                {/* Title */}
                <div className="prfl-field">
                  <label>Title <span style={{ color: '#dc2626' }}>*</span></label>
                  <input
                    value={pushTestTitle}
                    onChange={e => setPushTestTitle(e.target.value)}
                    placeholder="e.g. Meeting at 3 PM"
                    maxLength={80}
                  />
                </div>
                {/* Message */}
                <div className="prfl-field">
                  <label>Message</label>
                  <input
                    value={pushTestMsg}
                    onChange={e => setPushTestMsg(e.target.value)}
                    placeholder="e.g. Please join the Zoom call"
                    maxLength={200}
                  />
                </div>
                {/* Redirect URL */}
                <div className="prfl-field">
                  <label>Opens When Clicked</label>
                  <select
                    value={pushTestUrl}
                    onChange={e => setPushTestUrl(e.target.value)}
                    style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13 }}
                  >
                    <option value="/">Dashboard</option>
                    <option value="/leads">Leads</option>
                    <option value="/appointments">Appointments</option>
                    <option value="/estimates">Estimates</option>
                    <option value="/invoices">Invoices</option>
                    <option value="/customers">Customers</option>
                    <option value="/reports">Reports</option>
                  </select>
                </div>
                <button
                  className="prfl-btn-primary"
                  onClick={sendTestPush}
                  disabled={pushTestBusy || !pushTestTitle.trim()}
                  style={{ alignSelf: 'flex-start' }}
                >
                  {pushTestBusy ? 'Sending…' : '🔔 Send Notification'}
                </button>
              </div>
              {pushTestResult && (
                <div style={{ marginTop: 10, fontSize: 13, color: pushTestResult.startsWith('✅') ? '#16a34a' : '#dc2626' }}>
                  {pushTestResult}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ───── SETTINGS ───── */}
        {activeTab === 'settings' && (
          <div className="prfl-tab-body">
            {/* Settings sub-tabs */}
            <div className="act-subtabs">
              <button className={`act-subtab${settingsSubTab === 'notifications' ? ' act-subtab--active' : ''}`} onClick={() => setSettingsSubTab('notifications')}>
                🔔 Notifications
              </button>
              <button className={`act-subtab${settingsSubTab === 'password' ? ' act-subtab--active' : ''}`} onClick={() => setSettingsSubTab('password')}>
                🔒 Password
              </button>
            </div>

            {/* Notifications sub-tab */}
            {settingsSubTab === 'notifications' && (
              <div className="prfl-card">
                <SectionHeader icon={<Bell size={15}/>} title="Notification Preferences" />
                <div className="prfl-notif-list">
                  {[
                    { key: 'overdue_lead',       label: 'Overdue Lead Alerts',       desc: 'When a lead follow-up is overdue',               color: '#dc2626' },
                    { key: 'missed_followup',    label: 'Missed Follow-up Alerts',   desc: 'When a scheduled follow-up is missed',           color: '#d97706' },
                    { key: 'high_priority_lead', label: 'High Priority Lead Alerts', desc: 'When a high priority lead is assigned',          color: '#7c3aed' },
                    { key: 'daily_target',       label: 'Daily Target Alerts',       desc: 'When daily call target is not met by 6 PM',      color: '#2563eb' },
                    { key: 'inactive_lead',      label: 'Inactive Lead Alerts',      desc: 'When a lead has no activity for 7+ days',        color: '#0891b2' },
                    { key: 'lead_escalation',    label: 'Escalation Alerts',         desc: 'When a lead is escalated to manager',            color: '#9333ea' },
                    { key: 'duplicate_lead',     label: 'Duplicate Lead Alerts',     desc: 'When a duplicate lead is detected',              color: '#16a34a' },
                    { key: 'lead_assigned',      label: 'New Lead Assignment',       desc: 'When a lead is assigned to you',                 color: '#2563eb' },
                    { key: 'lead_converted',     label: 'Lead Conversion',           desc: 'When a lead is won/converted',                   color: '#16a34a' },
                    { key: 'no_activity',        label: 'No Activity Warning',       desc: 'When no CRM activity for 2+ hours during work hours', color: '#d97706' },
                    { key: 'follow_up_scheduled',label: 'Follow-up Scheduled',       desc: 'When a follow-up is scheduled on your lead',     color: '#0891b2' },
                    { key: 'appointment_reminder',label: 'Appointment Reminder',     desc: '30 min / 2 hr / 24 hr before an appointment',   color: '#7c3aed' },
                    { key: 'note_added',         label: 'Note Added',                desc: 'When a note is added on your lead',              color: '#d97706' },
                  ].map(item => (
                    <div key={item.key} className="prfl-notif-row">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 11, flex: 1 }}>
                        <div className="prfl-notif-dot" style={{ background: notifSettings[item.key] ? item.color : 'var(--border)' }} />
                        <div>
                          <div className="prfl-notif-label">{item.label}</div>
                          <div className="prfl-notif-desc">{item.desc}</div>
                        </div>
                      </div>
                      <button
                        className={`prfl-toggle${notifSettings[item.key] ? ' prfl-toggle--on' : ''}`}
                        style={notifSettings[item.key] ? { background: item.color } : {}}
                        onClick={() => saveNotifSettings({ [item.key]: !notifSettings[item.key] })}
                      >
                        <span className="prfl-toggle-knob" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Password sub-tab */}
            {settingsSubTab === 'password' && (
              <div className="prfl-card">
                <SectionHeader icon={<Lock size={15}/>} title="Change Password" />
                <p className="prfl-card-desc">Choose a strong password with at least 6 characters.</p>
                {pwErr && <div className="prfl-alert prfl-alert--error">{pwErr}</div>}
                {pwOk  && <div className="prfl-alert prfl-alert--success">Password updated successfully!</div>}
                <form onSubmit={handleChangePw} className="prfl-pw-form">
                  <div className="prfl-field">
                    <label>Current Password</label>
                    <input type="password" required value={curPw} onChange={e => setCurPw(e.target.value)} placeholder="Enter current password" />
                  </div>
                  <div className="prfl-field">
                    <label>New Password</label>
                    <input type="password" required minLength={6} value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min. 6 characters" />
                  </div>
                  <div className="prfl-field">
                    <label>Confirm New Password</label>
                    <input type="password" required minLength={6} value={confPw} onChange={e => setConfPw(e.target.value)} placeholder="Repeat new password" />
                  </div>
                  <button type="submit" className="prfl-btn-primary" disabled={pwBusy}>
                    {pwBusy ? 'Updating…' : 'Update Password'}
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

      </div>

      {/* ── EDIT PROFILE MODAL ── */}
      {editing && (
        <div className="prfl-overlay" onClick={() => setEditing(false)}>
          <div className="prfl-modal" onClick={e => e.stopPropagation()}>
            <div className="prfl-modal-hd">
              <span className="prfl-modal-title">Edit Profile</span>
              <button className="prfl-modal-close" onClick={() => setEditing(false)}><X size={15} /></button>
            </div>
            {editErr && <div className="prfl-alert prfl-alert--error">{editErr}</div>}
            <div className="prfl-edit-form">
              <div className="prfl-field"><label>Full Name</label>
                <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" />
              </div>
              <div className="prfl-field"><label>Mobile Number</label>
                <input value={editForm.mobile} onChange={e => setEditForm(f => ({ ...f, mobile: e.target.value }))} placeholder="+91 98765 43210" />
              </div>
              <div className="prfl-field"><label>Department</label>
                <input value={editForm.department} onChange={e => setEditForm(f => ({ ...f, department: e.target.value }))} placeholder="e.g. Sales, Support" />
              </div>
              <div className="prfl-field"><label>Joining Date</label>
                <input type="date" value={editForm.joining_date} onChange={e => setEditForm(f => ({ ...f, joining_date: e.target.value }))} />
              </div>
            </div>
            <div className="prfl-modal-footer">
              <button className="prfl-btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
              <button className="prfl-btn-primary" onClick={saveProfile} disabled={editBusy}>
                {editBusy ? 'Saving…' : <><Save size={12} /> Save Changes</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
