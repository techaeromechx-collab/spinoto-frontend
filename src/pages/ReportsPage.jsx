import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line, FunnelChart, Funnel, LabelList,
} from 'recharts';
import {
  LayoutDashboard, Users, TrendingUp, IndianRupee,
  ChevronUp, ChevronDown, Minus, RefreshCw, Calendar, FileDown,
  X, CheckCircle2, Clock, AlertCircle, Phone, ChevronRight,
} from 'lucide-react';
import { api } from '../api/client.js';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import '../styles/ReportsPage.css';

// ── Colours ────────────────────────────────────────────────────────────────────
const CHART_COLORS = ['#3B82F6', '#06B6D4', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#EC4899'];

// ── Date range presets ─────────────────────────────────────────────────────────
const PRESETS = [
  { label: '7D',   days: 7  },
  { label: '30D',  days: 30 },
  { label: '90D',  days: 90 },
  { label: 'All',  days: 0  },
];

function getPresetDates(days) {
  if (!days) return { from: '', to: '' };
  const to   = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return {
    from: from.toISOString().slice(0, 10),
    to:   to.toISOString().slice(0, 10),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function inr(n) {
  return Number(n).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
}
function pct(num, den) {
  if (!den || Number(den) === 0) return '0%';
  return ((Number(num) / Number(den)) * 100).toFixed(1) + '%';
}
function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}
function avatarColor(name = '') {
  const colors = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#ec4899'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
}

// ── KPI Card ───────────────────────────────────────────────────────────────────
function KpiCard({ label, value, icon: Icon, accent = '#3b82f6', sub }) {
  return (
    <div className="rp-kpi">
      <div className="rp-kpi-top">
        <span className="rp-kpi-label">{label}</span>
        <div className="rp-kpi-icon" style={{ background: accent + '18', color: accent }}>
          <Icon size={16} />
        </div>
      </div>
      <div className="rp-kpi-val">{value}</div>
      {sub && <div className="rp-kpi-sub">{sub}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
export default function ReportsPage() {
  const [tab,        setTab]        = useState('overview');   // 'overview' | 'by-user' | 'analytics'
  const [revTrend,   setRevTrend]   = useState([]);
  const [funnel,     setFunnel]     = useState([]);
  const [topPerf,    setTopPerf]    = useState({ top_hubs: [], top_services: [] });
  const [anlLoading, setAnlLoading] = useState(false);
  const [preset,     setPreset]     = useState(30);           // days; 0 = all
  const [dateRange,  setDateRange]  = useState(getPresetDates(30));

  const [summary,    setSummary]    = useState(null);
  const [statusData, setStatusData] = useState([]);
  const [revData,    setRevData]    = useState([]);
  const [byUser,     setByUser]     = useState([]);
  const [scope,      setScope]      = useState('all'); // 'all' | 'team' | 'own'

  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);

  // ── User detail drawer ───────────────────────────────────────────────────
  const [drawerUser,    setDrawerUser]    = useState(null); // { user_id, user_name, email }
  const [drawerData,    setDrawerData]    = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError,   setDrawerError]   = useState(null);

  async function openUserDrawer(row) {
    setDrawerUser(row);
    setDrawerData(null);
    setDrawerError(null);
    setDrawerLoading(true);
    const qs = dateRange.from ? `?from=${dateRange.from}&to=${dateRange.to}` : '';
    try {
      const d = await api(`/api/reports/user-detail/${row.user_id}${qs}`);
      setDrawerData(d);
    } catch (e) {
      console.error('User detail fetch failed:', e);
      setDrawerError(e.message || 'Failed to load user data');
    }
    finally { setDrawerLoading(false); }
  }

  function closeDrawer() { setDrawerUser(null); setDrawerData(null); }

  // ── Sort state for By User table ─────────────────────────────────────────
  const [sortKey, setSortKey] = useState('total_leads');
  const [sortDir, setSortDir] = useState('desc');

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const sortedUsers = useMemo(() => {
    return [...byUser].sort((a, b) => {
      const av = Number(a[sortKey]) || 0;
      const bv = Number(b[sortKey]) || 0;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [byUser, sortKey, sortDir]);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    const qs = dateRange.from
      ? `?from=${dateRange.from}&to=${dateRange.to}`
      : '';
    try {
      const [sum, st, rev, usr] = await Promise.all([
        api(`/api/reports/summary${qs}`),
        api(`/api/reports/status-distribution${qs}`),
        api(`/api/reports/category-revenue${qs}`),
        api(`/api/reports/by-user${qs}`),
      ]);
      setSummary(sum);
      setScope(sum.scope || usr.scope || 'all');
      setStatusData(st.items || []);
      setRevData(rev.items || []);
      setByUser(usr.items || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Load analytics when tab switches to analytics ────────────────────────
  useEffect(() => {
    if (tab !== 'analytics') return;
    if (revTrend.length > 0) return; // already loaded
    setAnlLoading(true);
    Promise.all([
      api('/api/reports/analytics/revenue-trend').catch(() => ({ items: [] })),
      api('/api/reports/analytics/funnel').catch(() => ({ funnel: [] })),
      api('/api/reports/analytics/top-performers').catch(() => ({ top_hubs: [], top_services: [] })),
    ]).then(([rt, fn, tp]) => {
      setRevTrend(rt.items || []);
      setFunnel(fn.funnel || []);
      setTopPerf({ top_hubs: tp.top_hubs || [], top_services: tp.top_services || [] });
    }).finally(() => setAnlLoading(false));
  }, [tab]);

  // ── Date preset handler ───────────────────────────────────────────────────
  function applyPreset(days) {
    setPreset(days);
    setDateRange(getPresetDates(days));
  }

  // ── Sort icon helper ──────────────────────────────────────────────────────
  function SortIcon({ col }) {
    if (sortKey !== col) return <Minus size={11} style={{ opacity: 0.3 }} />;
    return sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />;
  }

  // ── Export PDF ───────────────────────────────────────────────────────────
  function exportPDF() {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW  = doc.internal.pageSize.getWidth();
    const now    = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const period = dateRange.from
      ? `${dateRange.from}  →  ${dateRange.to}`
      : 'All Time';
    const scopeLabel = scope === 'all' ? 'Organisation' : scope === 'team' ? 'My Team' : 'Personal';

    // ── Header band ──────────────────────────────────────────────────────
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, pageW, 28, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Spinoto CRM — Report', 14, 12);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Scope: ${scopeLabel}   |   Period: ${period}   |   Generated: ${now}`, 14, 21);

    let y = 36;

    // ── KPI Summary ──────────────────────────────────────────────────────
    if (summary) {
      doc.setTextColor(30, 30, 30);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Overview Summary', 14, y);
      y += 6;

      const kpis = [
        ['Total Leads',      summary.total_leads],
        ['Converted Leads',  summary.converted_leads],
        ['Conversion Rate',  pct(summary.converted_leads, summary.total_leads)],
        ['Pipeline Value',   inr(summary.total_potential_revenue)],
        ['Realized Revenue', inr(summary.realized_revenue)],
      ];

      autoTable(doc, {
        startY: y,
        head: [['Metric', 'Value']],
        body: kpis,
        theme: 'grid',
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', fontSize: 10 },
        bodyStyles: { fontSize: 10, textColor: [30, 30, 30] },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 70 }, 1: { cellWidth: 70 } },
        margin: { left: 14, right: 14 },
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    // ── Status distribution ───────────────────────────────────────────────
    if (statusData.length > 0) {
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 30, 30);
      doc.text('Lead Status Breakdown', 14, y);
      y += 4;

      autoTable(doc, {
        startY: y,
        head: [['Status', 'Count']],
        body: statusData.map(s => [s.name, s.value]),
        theme: 'striped',
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', fontSize: 10 },
        bodyStyles: { fontSize: 10 },
        columnStyles: { 0: { cellWidth: 100 }, 1: { cellWidth: 40, halign: 'right' } },
        margin: { left: 14, right: 14 },
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    // ── Category revenue ──────────────────────────────────────────────────
    const revFiltered = revData.filter(d => Number(d.value) > 0);
    if (revFiltered.length > 0) {
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 30, 30);
      doc.text('Revenue by Category', 14, y);
      y += 4;

      autoTable(doc, {
        startY: y,
        head: [['Category', 'Revenue (₹)']],
        body: revFiltered.map(d => [d.name, inr(d.value)]),
        theme: 'striped',
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', fontSize: 10 },
        bodyStyles: { fontSize: 10 },
        columnStyles: { 0: { cellWidth: 100 }, 1: { cellWidth: 60, halign: 'right' } },
        margin: { left: 14, right: 14 },
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    // ── By User table (if available) ──────────────────────────────────────
    if (byUser.length > 0 && scope !== 'own') {
      // New page if not enough room
      if (y > 200) { doc.addPage(); y = 16; }

      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 30, 30);
      doc.text(scope === 'team' ? 'Team Performance' : 'Performance by User', 14, y);
      y += 4;

      autoTable(doc, {
        startY: y,
        head: [['Name', 'Email', 'Leads', 'Converted', 'Conv. %', 'Pipeline', 'Realized']],
        body: sortedUsers.map(u => [
          u.user_name || '—',
          u.email,
          u.total_leads,
          u.converted_leads,
          pct(u.converted_leads, u.total_leads),
          inr(u.total_revenue),
          inr(u.realized_revenue),
        ]),
        theme: 'grid',
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { fontSize: 9, textColor: [30, 30, 30] },
        columnStyles: {
          0: { cellWidth: 32 },
          1: { cellWidth: 42 },
          2: { cellWidth: 16, halign: 'right' },
          3: { cellWidth: 20, halign: 'right' },
          4: { cellWidth: 18, halign: 'right' },
          5: { cellWidth: 26, halign: 'right' },
          6: { cellWidth: 26, halign: 'right' },
        },
        margin: { left: 14, right: 14 },
      });
    }

    // ── Footer on every page ──────────────────────────────────────────────
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.setFont('helvetica', 'normal');
      doc.text(`Page ${i} of ${totalPages}`, pageW - 14, 290, { align: 'right' });
      doc.text('Spinoto CRM', 14, 290);
    }

    const filename = `spinoto-report-${scopeLabel.toLowerCase()}-${dateRange.from || 'all'}.pdf`;
    doc.save(filename);
  }

  if (loading && !summary) return <div className="centered">Loading reports…</div>;

  return (
    <div className="rp-page">

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="rp-header">
        <div>
          <h2 className="rp-title">Reports</h2>
          <p className="rp-sub">
            {scope === 'all'  && 'Organisation-wide performance metrics.'}
            {scope === 'team' && 'Performance metrics for your team.'}
            {scope === 'own'  && 'Your personal performance metrics.'}
          </p>
        </div>
        <div className="rp-header-right">
          {/* Date range */}
          <div className="rp-presets">
            <Calendar size={13} className="rp-cal-icon" />
            {PRESETS.map(p => (
              <button key={p.label}
                className={`rp-preset-btn${preset === p.days ? ' rp-preset-btn--on' : ''}`}
                onClick={() => applyPreset(p.days)}>
                {p.label}
              </button>
            ))}
          </div>
          <button className="rp-refresh-btn" onClick={fetchData} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'rp-spin' : ''} />
          </button>
          <button className="rp-export-btn" onClick={exportPDF} disabled={loading || !summary} title="Export PDF">
            <FileDown size={14} />
            Export PDF
          </button>
        </div>
      </div>

      {error && <div className="rp-error">{error}</div>}

      {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
      <div className="rp-tabs">
        <button className={`rp-tab${tab === 'overview' ? ' rp-tab--on' : ''}`}
          onClick={() => setTab('overview')}>
          <LayoutDashboard size={14} /> Overview
        </button>
        {/* By User tab — only visible when data spans more than one person */}
        {scope !== 'own' && (
          <button className={`rp-tab${tab === 'by-user' ? ' rp-tab--on' : ''}`}
            onClick={() => setTab('by-user')}>
            <Users size={14} />
            {scope === 'team' ? 'My Team' : 'By User'}
          </button>
        )}
        <button className={`rp-tab${tab === 'analytics' ? ' rp-tab--on' : ''}`}
          onClick={() => setTab('analytics')}>
          <TrendingUp size={14} /> Analytics
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          OVERVIEW TAB
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'overview' && (
        <div className="rp-overview">

          {/* KPIs */}
          {summary && (
            <div className="rp-kpi-grid">
              <KpiCard label="Total Leads"       value={summary.total_leads}
                icon={TrendingUp} accent="#3b82f6"
                sub={`${summary.converted_leads} converted`} />
              <KpiCard label="Conversion Rate"   value={pct(summary.converted_leads, summary.total_leads)}
                icon={TrendingUp} accent="#10b981" />
              <KpiCard label="Pipeline Value"    value={inr(summary.total_potential_revenue)}
                icon={IndianRupee} accent="#8b5cf6" />
              <KpiCard label="Realized Revenue"  value={inr(summary.realized_revenue)}
                icon={IndianRupee} accent="#f59e0b"
                sub="Converted leads only" />
            </div>
          )}

          {/* Charts */}
          <div className="rp-charts-grid">
            <div className="rp-chart-card">
              <h3 className="rp-chart-title">Lead Status Breakdown</h3>
              {statusData.length === 0
                ? <div className="rp-empty">No data for this period</div>
                : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={statusData} cx="50%" cy="50%"
                        innerRadius={65} outerRadius={90}
                        paddingAngle={4} dataKey="value">
                        {statusData.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={v => [v, 'Leads']} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
            </div>

            <div className="rp-chart-card">
              <h3 className="rp-chart-title">Revenue by Category (₹)</h3>
              {revData.filter(d => Number(d.value) > 0).length === 0
                ? <div className="rp-empty">No revenue data for this period</div>
                : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={revData.filter(d => Number(d.value) > 0)} margin={{ left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => '₹' + Number(v).toLocaleString('en-IN')} />
                      <Tooltip formatter={v => [inr(v), 'Revenue']} />
                      <Bar dataKey="value" fill="var(--primary)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          BY USER TAB
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'by-user' && (
        <div className="rp-byuser">

          {/* Summary totals bar */}
          {summary && (
            <div className="rp-team-summary">
              <div className="rp-ts-item">
                <span className="rp-ts-label">{scope === 'all' ? 'Org' : 'Team'} Total Leads</span>
                <span className="rp-ts-val">{summary.total_leads}</span>
              </div>
              <div className="rp-ts-div" />
              <div className="rp-ts-item">
                <span className="rp-ts-label">Conversion Rate</span>
                <span className="rp-ts-val">{pct(summary.converted_leads, summary.total_leads)}</span>
              </div>
              <div className="rp-ts-div" />
              <div className="rp-ts-item">
                <span className="rp-ts-label">Realized Revenue</span>
                <span className="rp-ts-val">{inr(summary.realized_revenue)}</span>
              </div>
              <div className="rp-ts-div" />
              <div className="rp-ts-item">
                <span className="rp-ts-label">{scope === 'all' ? 'All' : 'Team'} Members</span>
                <span className="rp-ts-val">{byUser.filter(u => Number(u.total_leads) > 0).length}</span>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead>
                <tr>
                  <th className="rp-th rp-th--name">Team Member</th>
                  <th className="rp-th rp-th--sort" onClick={() => toggleSort('total_leads')}>
                    Leads <SortIcon col="total_leads" />
                  </th>
                  <th className="rp-th rp-th--sort" onClick={() => toggleSort('converted_leads')}>
                    Converted <SortIcon col="converted_leads" />
                  </th>
                  <th className="rp-th">Conv. Rate</th>
                  <th className="rp-th rp-th--sort" onClick={() => toggleSort('total_revenue')}>
                    Pipeline <SortIcon col="total_revenue" />
                  </th>
                  <th className="rp-th rp-th--sort" onClick={() => toggleSort('realized_revenue')}>
                    Realized <SortIcon col="realized_revenue" />
                  </th>
                  <th className="rp-th" style={{ width: 32 }} />
                </tr>
              </thead>
              <tbody>
                {sortedUsers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="rp-td-empty">No user data available</td>
                  </tr>
                )}
                {sortedUsers.map(u => {
                  const convRate = pct(u.converted_leads, u.total_leads);
                  const convNum  = Number(u.total_leads) > 0
                    ? (Number(u.converted_leads) / Number(u.total_leads)) * 100
                    : 0;
                  const bg = avatarColor(u.user_name || u.email);
                  return (
                    <tr key={u.user_id} className="rp-tr rp-tr--clickable"
                      onClick={() => openUserDrawer(u)} title="Click to view details">
                      <td className="rp-td rp-td--name">
                        <div className="rp-user-cell">
                          <div className="rp-avatar" style={{ background: bg }}>
                            {initials(u.user_name || u.email)}
                          </div>
                          <div>
                            <div className="rp-uname">{u.user_name || '—'}</div>
                            <div className="rp-uemail">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="rp-td rp-td--num">
                        <span className="rp-lead-badge">{u.total_leads}</span>
                      </td>
                      <td className="rp-td rp-td--num">{u.converted_leads}</td>
                      <td className="rp-td rp-td--num">
                        <div className="rp-conv-wrap">
                          <span className="rp-conv-pct" style={{
                            color: convNum >= 50 ? '#16a34a' : convNum >= 20 ? '#d97706' : 'var(--text-muted)',
                          }}>{convRate}</span>
                          <div className="rp-conv-bar">
                            <div className="rp-conv-fill" style={{
                              width: `${Math.min(convNum, 100)}%`,
                              background: convNum >= 50 ? '#16a34a' : convNum >= 20 ? '#f59e0b' : '#94a3b8',
                            }} />
                          </div>
                        </div>
                      </td>
                      <td className="rp-td rp-td--num">{inr(u.total_revenue)}</td>
                      <td className="rp-td rp-td--num">
                        <span className="rp-rev-val">{inr(u.realized_revenue)}</span>
                      </td>
                      <td className="rp-td rp-td--chevron">
                        <ChevronRight size={14} className="rp-row-chevron" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ User Detail Drawer ═══════════════════════════════════════════════ */}
      {drawerUser && (
        <>
          <div className="rpd-backdrop" onClick={closeDrawer} />
          <div className="rpd-drawer">

            {/* Header */}
            <div className="rpd-hdr">
              <div className="rpd-hdr-left">
                <div className="rpd-avatar" style={{ background: avatarColor(drawerUser.user_name || drawerUser.email) }}>
                  {initials(drawerUser.user_name || drawerUser.email)}
                </div>
                <div>
                  <div className="rpd-name">{drawerUser.user_name || '—'}</div>
                  <div className="rpd-email">{drawerUser.email}</div>
                </div>
              </div>
              <button className="rpd-close" onClick={closeDrawer}><X size={18} /></button>
            </div>

            {drawerLoading && <div className="rpd-loading">Loading…</div>}
            {drawerError && <div className="rpd-drawer-error">{drawerError}</div>}

            {drawerData && (() => {
              const u  = drawerData.user;
              const sb = drawerData.statusBreak;
              const ev = drawerData.pendingEvents;
              const rl = drawerData.recentLeads;
              const today = new Date().toISOString().slice(0, 10);
              const todayEvents    = ev.filter(e => e.due_date.slice(0, 10) === today);
              const overdueEvents  = ev.filter(e => e.due_date.slice(0, 10) < today);

              return (
                <div className="rpd-body">

                  {/* KPI mini-cards */}
                  <div className="rpd-kpi-grid">
                    <div className="rpd-kpi">
                      <div className="rpd-kpi-val">{u.total_leads}</div>
                      <div className="rpd-kpi-label">Total Leads</div>
                    </div>
                    <div className="rpd-kpi rpd-kpi--green">
                      <div className="rpd-kpi-val">{u.leads_today}</div>
                      <div className="rpd-kpi-label">Today</div>
                    </div>
                    <div className="rpd-kpi rpd-kpi--blue">
                      <div className="rpd-kpi-val">{u.active_leads}</div>
                      <div className="rpd-kpi-label">Active</div>
                    </div>
                    <div className="rpd-kpi rpd-kpi--purple">
                      <div className="rpd-kpi-val">{u.converted_leads}</div>
                      <div className="rpd-kpi-label">Converted</div>
                    </div>
                    <div className="rpd-kpi rpd-kpi--amber">
                      <div className="rpd-kpi-val">{ev.length}</div>
                      <div className="rpd-kpi-label">Follow-ups Due</div>
                    </div>
                    <div className="rpd-kpi rpd-kpi--indigo">
                      <div className="rpd-kpi-val">{u.new_leads}</div>
                      <div className="rpd-kpi-label">New (No Status)</div>
                    </div>
                  </div>

                  {/* Revenue */}
                  <div className="rpd-rev-row">
                    <div className="rpd-rev-item">
                      <span className="rpd-rev-label">Pipeline Value</span>
                      <span className="rpd-rev-val">{inr(u.pipeline_value)}</span>
                    </div>
                    <div className="rpd-rev-div" />
                    <div className="rpd-rev-item">
                      <span className="rpd-rev-label">Realized Revenue</span>
                      <span className="rpd-rev-val rpd-rev-val--green">{inr(u.realized_revenue)}</span>
                    </div>
                  </div>

                  {/* Status breakdown */}
                  {sb.length > 0 && (
                    <div className="rpd-section">
                      <div className="rpd-section-title">Lead Status Breakdown</div>
                      <div className="rpd-status-list">
                        {sb.map(s => {
                          const maxCount = Math.max(...sb.map(x => x.count));
                          const pctVal   = maxCount > 0 ? (s.count / maxCount) * 100 : 0;
                          return (
                            <div key={s.status_name} className="rpd-status-row">
                              <span className="rpd-status-name">{s.status_name}</span>
                              <div className="rpd-status-bar-wrap">
                                <div className="rpd-status-bar" style={{ width: `${pctVal}%` }} />
                              </div>
                              <span className="rpd-status-count">{s.count}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Pending follow-ups */}
                  {ev.length > 0 && (
                    <div className="rpd-section">
                      <div className="rpd-section-title">
                        <Clock size={13} />
                        Pending Follow-ups
                        {overdueEvents.length > 0 && (
                          <span className="rpd-overdue-badge">{overdueEvents.length} overdue</span>
                        )}
                      </div>
                      <div className="rpd-ev-list">
                        {ev.map(e => {
                          const isOverdue = e.due_date.slice(0, 10) < today;
                          return (
                            <div key={e.id} className={`rpd-ev-item${isOverdue ? ' rpd-ev-item--overdue' : ''}`}>
                              <div className="rpd-ev-left">
                                {isOverdue
                                  ? <AlertCircle size={13} className="rpd-ev-icon--overdue" />
                                  : <Clock size={13} className="rpd-ev-icon--today" />
                                }
                                <div>
                                  <div className="rpd-ev-lead">{e.lead_name || e.lead_mobile}</div>
                                  <div className="rpd-ev-meta">{e.note} · {e.due_date.slice(0, 10)}</div>
                                </div>
                              </div>
                              <span className="rpd-ev-status">{e.lead_status || 'New Lead'}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {ev.length === 0 && (
                    <div className="rpd-section">
                      <div className="rpd-section-title"><Clock size={13} /> Follow-ups</div>
                      <div className="rpd-empty-state">
                        <CheckCircle2 size={22} style={{ color: '#16a34a' }} />
                        <span>All caught up — no pending follow-ups</span>
                      </div>
                    </div>
                  )}

                  {/* Recent leads */}
                  {rl.length > 0 && (
                    <div className="rpd-section">
                      <div className="rpd-section-title"><Phone size={13} /> Recent Leads</div>
                      <div className="rpd-rl-list">
                        {rl.map(l => (
                          <div key={l.id} className="rpd-rl-item">
                            <div className="rpd-rl-left">
                              <div className="rpd-rl-name">{l.name || l.mobile}</div>
                              {l.name && <div className="rpd-rl-mobile">{l.mobile}</div>}
                              <div className="rpd-rl-meta">
                                {l.vehicle_type_id && <span>{l.vehicle_type_id}</span>}
                                <span>{new Date(l.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                              </div>
                            </div>
                            <div className="rpd-rl-right">
                              {l.status && <span className="rpd-rl-status">{l.status}</span>}
                              {Number(l.total_price) > 0 && <span className="rpd-rl-price">{inr(l.total_price)}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              );
            })()}
          </div>
        </>
      )}

      {/* ── Analytics Tab ──────────────────────────────────────────────────── */}
      {tab === 'analytics' && (
        <div className="anl-wrap">
          {anlLoading ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontSize: 14 }}>Loading analytics…</div>
          ) : (
            <>
              {/* Revenue Trend Chart */}
              <div className="anl-card">
                <div className="anl-card-hd">
                  <TrendingUp size={15} style={{ color: '#3b82f6' }} />
                  Monthly Revenue Trend
                  <span className="anl-badge">Last 12 months</span>
                </div>
                {revTrend.length === 0 ? (
                  <div className="anl-empty">No invoice data yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={revTrend} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={v => `₹${Number(v) >= 1000 ? (Number(v)/1000).toFixed(0)+'k' : v}`} />
                      <Tooltip formatter={(v, n) => [`₹${Number(v).toLocaleString('en-IN')}`, n === 'revenue' ? 'Invoiced' : 'Collected']} />
                      <Legend />
                      <Line type="monotone" dataKey="revenue"   name="Invoiced"   stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4 }} />
                      <Line type="monotone" dataKey="collected" name="Collected"  stroke="#10b981" strokeWidth={2.5} dot={{ r: 4 }} strokeDasharray="5 3" />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="anl-row2">
                {/* Conversion Funnel */}
                <div className="anl-card">
                  <div className="anl-card-hd">
                    <IndianRupee size={15} style={{ color: '#f59e0b' }} />
                    Conversion Funnel
                    <span className="anl-badge">All time</span>
                  </div>
                  {funnel.length === 0 ? (
                    <div className="anl-empty">No data yet</div>
                  ) : (
                    <div className="anl-funnel">
                      {funnel.map((f, i) => {
                        const maxCount = funnel[0]?.count || 1;
                        const pct = Math.round((f.count / maxCount) * 100);
                        const colors = ['#3b82f6', '#6366f1', '#f59e0b', '#10b981'];
                        return (
                          <div key={f.stage} className="anl-funnel-row">
                            <div className="anl-funnel-label">{f.stage}</div>
                            <div className="anl-funnel-track">
                              <div className="anl-funnel-fill" style={{ width: pct + '%', background: colors[i] }} />
                            </div>
                            <div className="anl-funnel-count" style={{ color: colors[i] }}>{f.count.toLocaleString('en-IN')}</div>
                            {i > 0 && (
                              <div className="anl-funnel-drop" title={`Drop from previous stage`}>
                                {funnel[i-1].count > 0 ? Math.round((f.count / funnel[i-1].count) * 100) : 0}%
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Top Hubs */}
                <div className="anl-card">
                  <div className="anl-card-hd">
                    <IndianRupee size={15} style={{ color: '#0ea5e9' }} />
                    Top Hubs
                    <span className="anl-badge">Last 90 days</span>
                  </div>
                  {topPerf.top_hubs.length === 0 ? (
                    <div className="anl-empty">No hub invoice data yet</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={topPerf.top_hubs} layout="vertical" margin={{ left: 10, right: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => `₹${Number(v) >= 1000 ? (Number(v)/1000).toFixed(0)+'k' : v}`} />
                        <YAxis type="category" dataKey="hub_name" width={90} tick={{ fontSize: 11, fill: 'var(--text)' }} />
                        <Tooltip formatter={v => [`₹${Number(v).toLocaleString('en-IN')}`, 'Revenue']} />
                        <Bar dataKey="revenue" fill="#0ea5e9" radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Top Services */}
              <div className="anl-card">
                <div className="anl-card-hd">
                  <IndianRupee size={15} style={{ color: '#8b5cf6' }} />
                  Top Services by Revenue
                  <span className="anl-badge">Last 90 days</span>
                </div>
                {topPerf.top_services.length === 0 ? (
                  <div className="anl-empty">No service revenue data yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={topPerf.top_services} margin={{ top: 5, right: 20, left: 10, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="service_name" tick={{ fontSize: 10, fill: 'var(--text-muted)', angle: -30, textAnchor: 'end' }} interval={0} />
                      <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => `₹${Number(v) >= 1000 ? (Number(v)/1000).toFixed(0)+'k' : v}`} />
                      <Tooltip formatter={v => [`₹${Number(v).toLocaleString('en-IN')}`, 'Revenue']} />
                      <Bar dataKey="revenue" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Styles ─────────────────────────────────────────────────────────── */}
    </div>
  );
}
