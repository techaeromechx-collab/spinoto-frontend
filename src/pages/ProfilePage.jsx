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
    // 'Super Admin' and 'Settings' tabs moved to the consolidated Settings
    // module (see SettingsPage.jsx) — 'Push Alerts' stays here since it also
    // hosts device stats + the custom-notification sender, which weren't
    // part of that move (only its Alert Thresholds section was, into
    // Settings > Reminders).
    ...(isSuperAdmin   ? [{ key: 'push',      label: 'Push Alerts', Icon: Bell   }] : []),
  ];

  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const t = searchParams.get('tab');
    return t ? t : 'overview';
  });

  // Sub-tab for Activity tab: 'leads' | 'system'
  const [actSubTab, setActSubTab] = useState('leads');

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

  // Password change + notification-preference state moved to
  // components/settings/AccountSettings.jsx (now self-contained there).
  // Alert-threshold state moved to components/settings/RemindersSettings.jsx.
  // Push admin tab keeps its own state below since device stats + the
  // custom-notification sender stayed on this page.
  const [pushStats,      setPushStats]      = useState(null);
  const [pushLoading,    setPushLoading]    = useState(false);
  const [pushTestUser,   setPushTestUser]   = useState('');
  const [pushTestTitle,  setPushTestTitle]  = useState('');
  const [pushTestMsg,    setPushTestMsg]    = useState('');
  const [pushTestUrl,    setPushTestUrl]    = useState('/');
  const [pushTestResult, setPushTestResult] = useState('');
  const [pushTestBusy,   setPushTestBusy]   = useState(false);

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
    if (activeTab === 'push' && !pushStats) {
      setPushLoading(true);
      api('/api/push/admin/stats').then(r => setPushStats(r)).catch(() => {}).finally(() => setPushLoading(false));
    }
  }, [activeTab, pushStats]);

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

        {/* 'Super Admin' tab (Company Details + Role Creator) moved to the
            Settings module — see SettingsPage.jsx's 'business'/'super-admins'
            tabs. */}

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

            {/* Alert Thresholds moved to Settings > Reminders
                (components/settings/RemindersSettings.jsx). */}

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

        {/* 'Settings' tab (notification prefs + password change) moved to
            Settings > Account — see components/settings/AccountSettings.jsx. */}

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
