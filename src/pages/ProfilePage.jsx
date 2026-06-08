import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  User, Mail, Phone, Building2, Calendar, Shield, Activity,
  Lock, Bell, Settings, Users, TrendingUp, AlertTriangle,
  CheckCircle, Clock, Star, BarChart2, FileText, LogIn,
  Edit2, Save, X, Award, Zap, UserCheck, Target,
  AlertOctagon, Loader, MapPin, Hash, Globe,
} from 'lucide-react';
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

// ── Mini bar chart (no external lib) ─────────────────────────────────────────
function MiniBarChart({ data }) {
  if (!data?.length) return <div className="prfl-chart-empty">No trend data yet</div>;
  const max = Math.max(...data.map(d => parseInt(d.total) || 0), 1);
  return (
    <div className="prfl-chart">
      {data.map((d, i) => {
        const h  = Math.max(4, ((parseInt(d.total)     || 0) / max) * 80);
        const ch = Math.max(0, ((parseInt(d.converted) || 0) / max) * 80);
        return (
          <div key={i} className="prfl-chart-col" title={`${d.month}: ${d.total} leads, ${d.converted} converted`}>
            <div className="prfl-chart-bar-wrap">
              <div className="prfl-chart-bar prfl-chart-bar--total" style={{ height: h }}  />
              <div className="prfl-chart-bar prfl-chart-bar--conv"  style={{ height: ch }} />
            </div>
            <div className="prfl-chart-label">{d.month}</div>
          </div>
        );
      })}
      <div className="prfl-chart-legend">
        <span><span className="prfl-chart-dot prfl-chart-dot--total" />Total</span>
        <span><span className="prfl-chart-dot prfl-chart-dot--conv"  />Converted</span>
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

function KpiCard({ icon, color, label, val, sub, gradient }) {
  return (
    <div className="prfl-kpi-card">
      <div className="prfl-kpi-icon" style={{ background: gradient || (color + '18'), color }}>{icon}</div>
      <div className="prfl-kpi-val" style={{ color }}>{val}</div>
      {sub && <div className="prfl-kpi-sub">{sub}</div>}
      <div className="prfl-kpi-lbl">{label}</div>
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
    if (!window.confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;
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
    { key: 'security',   label: 'Security',    Icon: Lock       },
    { key: 'settings',   label: 'Settings',    Icon: Settings   },
  ];

  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const t = searchParams.get('tab');
    return t ? t : 'overview';
  });

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
  const [pushTestUser,   setPushTestUser]   = useState('');
  const [pushTestResult, setPushTestResult] = useState('');
  const [pushTestBusy,   setPushTestBusy]   = useState(false);

  // ── Notification settings ────────────────────────────────────────────────
  const [notifSettings, setNotifSettings] = useState({
    overdue_lead: true, missed_followup: true, high_priority_lead: true,
    daily_target: true, inactive_lead: true,   lead_escalation: true,
    duplicate_lead: true, lead_assigned: true, lead_converted: true, no_activity: true,
  });

  // ── Data fetching ────────────────────────────────────────────────────────
  useEffect(() => {
    if ((activeTab === 'overview' || activeTab === 'performance') && !stats) {
      setLoadingStats(true);
      api('/api/me/stats').then(r => setStats(r)).catch(() => {}).finally(() => setLoadingStats(false));
    }
  }, [activeTab, stats]);

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
  }, [activeTab, pushStats]);

  async function sendTestPush() {
    setPushTestBusy(true); setPushTestResult('');
    try {
      const body = pushTestUser ? { user_id: parseInt(pushTestUser, 10) } : {};
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
    <div className="prfl-shell">

      {/* ── LEFT SIDEBAR ── */}
      <aside className="prfl-sidebar">
        {/* Cover banner */}
        <div className="prfl-cover" />

        {/* Avatar */}
        <div className="prfl-avatar-wrap">
          <div className="prfl-avatar">{initials}</div>
          <div className="prfl-online-dot" />
        </div>

        <div className="prfl-sb-body">
          <div className="prfl-sb-name">{user.name}</div>
          <div className="prfl-sb-email">{user.email}</div>
          <span className="prfl-role-badge" style={{ color: role.color, background: role.bg, borderColor: role.color + '30' }}>
            {role.icon}&nbsp;{role.label}
          </span>

          <div className="prfl-sb-divider" />

          <div className="prfl-sb-meta">
            {user.department  && <div className="prfl-sb-meta-row"><Building2 size={12} />{user.department}</div>}
            {user.mobile      && <div className="prfl-sb-meta-row"><Phone size={12} />{user.mobile}</div>}
            {user.joining_date && <div className="prfl-sb-meta-row"><Calendar size={12} />Joined {fmtDate(user.joining_date)}</div>}
            {user.last_login   && <div className="prfl-sb-meta-row"><LogIn size={12} />Last login {timeAgo(user.last_login)}</div>}
            {user.manager_name && <div className="prfl-sb-meta-row"><UserCheck size={12} />Reports to {user.manager_name}</div>}
          </div>

          {stats && (
            <>
              <div className="prfl-sb-divider" />
              <div className="prfl-sb-stats">
                <div className="prfl-sb-stat">
                  <div className="prfl-sb-stat-val">{stats.total_leads}</div>
                  <div className="prfl-sb-stat-lbl">Leads</div>
                </div>
                <div className="prfl-sb-stat">
                  <div className="prfl-sb-stat-val" style={{ color:'#16a34a' }}>{stats.converted_leads}</div>
                  <div className="prfl-sb-stat-lbl">Won</div>
                </div>
                <div className="prfl-sb-stat">
                  <div className="prfl-sb-stat-val" style={{ color:'#dc2626' }}>{stats.overdue_followups}</div>
                  <div className="prfl-sb-stat-lbl">Overdue</div>
                </div>
              </div>
            </>
          )}

          <button className="prfl-edit-btn" onClick={startEdit}>
            <Edit2 size={13} /> Edit Profile
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <div className="prfl-main">

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
            </>}
          </div>
        )}

        {/* ───── PERFORMANCE ───── */}
        {activeTab === 'performance' && (
          <div className="prfl-tab-body">
            {loadingStats ? <Spinner /> : <>
              <div className="prfl-kpi-grid">
                <KpiCard icon={<Users size={18}/>}       color="#2563eb" gradient="linear-gradient(135deg,#dbeafe,#bfdbfe)" label="Total Leads"        val={stats?.total_leads        ?? '—'} />
                <KpiCard icon={<CheckCircle size={18}/>} color="#16a34a" gradient="linear-gradient(135deg,#dcfce7,#bbf7d0)" label="Converted Leads"    val={stats?.converted_leads    ?? '—'} />
                <KpiCard icon={<Clock size={18}/>}       color="#d97706" gradient="linear-gradient(135deg,#fef3c7,#fde68a)" label="Pending Leads"      val={stats?.pending_leads      ?? '—'} />
                <KpiCard icon={<FileText size={18}/>}    color="#0891b2" gradient="linear-gradient(135deg,#cffafe,#a5f3fc)" label="Notes Added"        val={stats?.notes_count        ?? '—'} />
                <KpiCard icon={<Activity size={18}/>}    color="#7c3aed" gradient="linear-gradient(135deg,#ede9fe,#ddd6fe)" label="Monthly Activities" val={stats?.monthly_activities ?? '—'} />
                <KpiCard icon={<Target size={18}/>}      color="#d97706" gradient="linear-gradient(135deg,#fff7ed,#fed7aa)" label="Follow-ups Today"   val={stats?.today_followups    ?? '—'} />
              </div>

              <div className="prfl-card">
                <SectionHeader icon={<TrendingUp size={15}/>} title="Monthly Lead Trend (Last 6 Months)" />
                <MiniBarChart data={stats?.trend} />
              </div>

              {stats?.total_leads > 0 && (
                <div className="prfl-card">
                  <SectionHeader icon={<Award size={15}/>} title="Conversion Rate" />
                  <div className="prfl-conv-rate">
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
                      <div className="prfl-conv-pct">{((stats.converted_leads / stats.total_leads) * 100).toFixed(1)}%</div>
                      <div className="prfl-conv-label" style={{ paddingBottom: 6 }}>{stats.converted_leads} of {stats.total_leads} leads converted</div>
                    </div>
                    <div className="prfl-conv-bar-wrap">
                      <div className="prfl-conv-bar-fill" style={{ width: `${Math.min(100,(stats.converted_leads/stats.total_leads)*100)}%` }} />
                    </div>
                  </div>
                </div>
              )}
            </>}
          </div>
        )}

        {/* ───── ACTIVITY ───── */}
        {activeTab === 'activity' && (
          <div className="prfl-tab-body">
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
            <LogsPanel />
            <div className="prfl-coming-grid">
              {[
                { label: 'Multiple Company Access',    icon: '🏢', g: COMING_GRADIENTS[0]  },
                { label: 'Franchise / Branch Mgmt',   icon: '🌿', g: COMING_GRADIENTS[1]  },
                { label: 'Subscription Plans',         icon: '💳', g: COMING_GRADIENTS[2]  },
                { label: 'Billing Management',         icon: '🧾', g: COMING_GRADIENTS[3]  },
                { label: 'API Key Management',         icon: '🔑', g: COMING_GRADIENTS[4]  },
                { label: 'SMTP / Email Settings',      icon: '📧', g: COMING_GRADIENTS[5]  },
                { label: 'WhatsApp / SMS Integration', icon: '💬', g: COMING_GRADIENTS[6]  },
                { label: 'Backup & Restore',           icon: '🗄️', g: COMING_GRADIENTS[7]  },
                { label: 'Permission Matrix',          icon: '🔒', g: COMING_GRADIENTS[8]  },
                { label: 'Server Status',              icon: '🖥️', g: COMING_GRADIENTS[9]  },
                { label: 'Error Logs',                 icon: '🚨', g: COMING_GRADIENTS[10] },
              ].map(({ label, icon, g }) => (
                <ComingSoon key={label} label={label} icon={icon} gradient={g} />
              ))}
            </div>
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

            <div className="prfl-card">
              <SectionHeader icon={<Zap size={15}/>} title="Send Test Notification" />
              <p className="prfl-card-desc">Send a test push to verify delivery is working. Leave user blank to test your own device.</p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
                <select
                  value={pushTestUser}
                  onChange={e => setPushTestUser(e.target.value)}
                  style={{ flex: 1, minWidth: 180, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13 }}
                >
                  <option value="">My device (self)</option>
                  {(pushStats?.users || []).filter(u => u.device_count > 0).map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.device_count} device{u.device_count > 1 ? 's' : ''})</option>
                  ))}
                </select>
                <button
                  className="prfl-btn-primary"
                  onClick={sendTestPush}
                  disabled={pushTestBusy}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {pushTestBusy ? 'Sending…' : '🔔 Send Test'}
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

        {/* ───── SECURITY ───── */}
        {activeTab === 'security' && (
          <div className="prfl-tab-body">
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

            <div className="prfl-card">
              <SectionHeader icon={<LogIn size={15}/>} title="Login History" />
              <div className="prfl-info-grid">
                <InfoRow icon={<LogIn size={13}/>} label="Last Login"    val={user.last_login ? `${fmtDate(user.last_login)} · ${timeAgo(user.last_login)}` : 'No data yet'} />
                <InfoRow icon={<Mail size={13}/>}  label="Account Email" val={user.email} />
              </div>
            </div>
          </div>
        )}

        {/* ───── SETTINGS ───── */}
        {activeTab === 'settings' && (
          <div className="prfl-tab-body">
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
