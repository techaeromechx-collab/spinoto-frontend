import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line, FunnelChart, Funnel, LabelList,
} from 'recharts';
import {
  LayoutDashboard, Users, TrendingUp, IndianRupee,
  ChevronUp, ChevronDown, Minus, RefreshCw, Calendar, FileDown,
  X, CheckCircle2, Clock, AlertCircle, Phone, ChevronRight, Search,
} from 'lucide-react';
import { api } from '../api/client.js';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import '../styles/ReportsPage.css';

// ── Colours ────────────────────────────────────────────────────────────────────
const CHART_COLORS = ['#3B82F6', '#06B6D4', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#EC4899'];

// ── Date range presets ─────────────────────────────────────────────────────────
const PRESETS = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: 'All', days: 0 },
];

function getPresetDates(days) {
  if (!days) return { from: '', to: '' };
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function getPrevPeriodDates(dateRange) {
  if (!dateRange.from || !dateRange.to) return null;
  const from = new Date(dateRange.from);
  const to = new Date(dateRange.to);
  const days = Math.round((to - from) / (1000 * 60 * 60 * 24));
  const prevTo = new Date(from); prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - days);
  return {
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
  };
}

function trendPct(curr, prev) {
  const c = Number(curr) || 0;
  const p = Number(prev) || 0;
  if (!p) return null;
  return ((c - p) / p * 100).toFixed(1);
}

// Download data as CSV
function downloadCSV(filename, rows, headers) {
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
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
  const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
}

// ── KPI Card ───────────────────────────────────────────────────────────────────
function KpiCard({ label, value, icon: Icon, accent = '#3b82f6', sub, trend, prevValue, compareOn }) {
  const trendNum = trend !== null && trend !== undefined ? Number(trend) : null;
  const isUp = trendNum !== null && trendNum > 0;
  const isDown = trendNum !== null && trendNum < 0;
  return (
    <div className="rp-kpi">
      <div className="rp-kpi-top">
        <span className="rp-kpi-label">{label}</span>
        <div className="rp-kpi-icon" style={{ background: accent + '18', color: accent }}>
          <Icon size={16} />
        </div>
      </div>
      <div className="rp-kpi-val">{value}</div>
      <div className="rp-kpi-bottom">
        {sub && <div className="rp-kpi-sub">{sub}</div>}
        {trendNum !== null && (
          <span className={`rp-trend${isUp ? ' rp-trend--up' : isDown ? ' rp-trend--down' : ' rp-trend--flat'}`}>
            {isUp ? '↑' : isDown ? '↓' : '→'} {Math.abs(trendNum)}%
          </span>
        )}
      </div>
      {compareOn && prevValue !== undefined && (
        <div className="rp-kpi-prev">vs {prevValue}</div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
export default function ReportsPage() {
  const [tab, setTab] = useState('overview');   // 'overview' | 'leads' | 'by-user' | 'analytics'
  const [revTrend, setRevTrend] = useState([]);
  const [funnel, setFunnel] = useState([]);
  const [topPerf, setTopPerf] = useState({ top_hubs: [], top_services: [] });
  const [anlLoading, setAnlLoading] = useState(false);
  const [preset, setPreset] = useState(30);           // days; 0 = all
  const [dateRange, setDateRange] = useState(getPresetDates(30));

  // ── Hub filter ───────────────────────────────────────────────────────────
  const [hubs, setHubs] = useState([]);
  const [hubId, setHubId] = useState('');   // '' = all hubs

  // ── Leads-over-time ──────────────────────────────────────────────────────
  const [leadsData, setLeadsData] = useState([]);
  const [leadsGroupBy, setLeadsGroupBy] = useState('day');
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [sourceData, setSourceData] = useState([]);

  // ── Compare / search ─────────────────────────────────────────────────────
  const [compareOn, setCompareOn] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  const [summary, setSummary] = useState(null);
  const [statusData, setStatusData] = useState([]);
  const [revData, setRevData] = useState([]);
  const [byUser, setByUser] = useState([]);
  const [scope, setScope] = useState('all'); // 'all' | 'team' | 'own'

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── Custom date picker ───────────────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tempFrom, setTempFrom] = useState('');
  const [tempTo, setTempTo] = useState('');
  const pickerRef = useRef(null);

  useEffect(() => {
    function onOut(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false);
    }
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, []);

  function openPicker() {
    setTempFrom(dateRange.from || '');
    setTempTo(dateRange.to || '');
    setPickerOpen(p => !p);
  }

  function applyCustomRange() {
    if (!tempFrom || !tempTo) return;
    setPreset(null);
    setDateRange({ from: tempFrom, to: tempTo });
    setPickerOpen(false);
  }

  // ── User detail drawer ───────────────────────────────────────────────────
  const [drawerUser, setDrawerUser] = useState(null); // { user_id, user_name, email }
  const [drawerData, setDrawerData] = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState(null);

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

  // ── Fetch hubs once on mount ──────────────────────────────────────────────
  useEffect(() => {
    api('/api/hubs?is_active=true&limit=200')
      .then(r => setHubs(r.items || []))
      .catch(() => { });
  }, []);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    const params = new URLSearchParams();
    if (dateRange.from) { params.set('from', dateRange.from); params.set('to', dateRange.to); }
    if (hubId) params.set('hub_id', hubId);
    // Always send prev period so trend indicators can show
    const prev = getPrevPeriodDates(dateRange);
    if (prev) { params.set('prev_from', prev.from); params.set('prev_to', prev.to); }
    const qs = params.toString() ? `?${params.toString()}` : '';
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
  }, [dateRange, hubId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Reset search when leaving By User tab ────────────────────────────────
  useEffect(() => {
    if (tab !== 'by-user') setUserSearch('');
  }, [tab]);

  // ── Load leads-over-time + source when Leads tab is active ──────────────
  useEffect(() => {
    if (tab !== 'leads') return;
    setLeadsLoading(true);
    const params = new URLSearchParams({ group_by: leadsGroupBy });
    if (dateRange.from) { params.set('from', dateRange.from); params.set('to', dateRange.to); }
    if (hubId) params.set('hub_id', hubId);
    const baseParams = new URLSearchParams();
    if (dateRange.from) { baseParams.set('from', dateRange.from); baseParams.set('to', dateRange.to); }
    if (hubId) baseParams.set('hub_id', hubId);
    Promise.all([
      api(`/api/reports/analytics/leads-over-time?${params.toString()}`),
      api(`/api/reports/analytics/leads-by-source?${baseParams.toString()}`),
    ])
      .then(([lt, src]) => { setLeadsData(lt.items || []); setSourceData(src.items || []); })
      .catch(() => { setLeadsData([]); setSourceData([]); })
      .finally(() => setLeadsLoading(false));
  }, [tab, leadsGroupBy, dateRange, hubId]); // eslint-disable-line

  // ── Load analytics when tab is analytics or date/hub changes ────────────
  useEffect(() => {
    if (tab !== 'analytics') return;
    setAnlLoading(true);
    const params = new URLSearchParams();
    if (dateRange.from) { params.set('from', dateRange.from); params.set('to', dateRange.to); }
    if (hubId) params.set('hub_id', hubId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    Promise.all([
      api(`/api/reports/analytics/revenue-trend${qs}`).catch(() => ({ items: [] })),
      api(`/api/reports/analytics/funnel${qs}`).catch(() => ({ funnel: [] })),
      api(`/api/reports/analytics/top-performers${qs}`).catch(() => ({ top_hubs: [], top_services: [] })),
    ]).then(([rt, fn, tp]) => {
      setRevTrend(rt.items || []);
      setFunnel(fn.funnel || []);
      setTopPerf({ top_hubs: tp.top_hubs || [], top_services: tp.top_services || [] });
    }).finally(() => setAnlLoading(false));
  }, [tab, dateRange, hubId]); // eslint-disable-line

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
    const pageW = doc.internal.pageSize.getWidth();
    const now = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
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
        ['Total Leads', summary.total_leads],
        ['Converted Leads', summary.converted_leads],
        ['Conversion Rate', pct(summary.converted_leads, summary.total_leads)],
        ['Lead Pipeline value', inr(summary.total_potential_revenue)],
        ['Appointment Realized Revenue', inr(summary.realized_revenue)],
        ['Customer Invoice Total', inr(summary.customer_invoice_total)],
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
            {scope === 'all' && 'Organisation-wide performance metrics.'}
            {scope === 'team' && 'Performance metrics for your team.'}
            {scope === 'own' && 'Your personal performance metrics.'}
          </p>
        </div>
        <div className="rp-header-right">
          {/* Date range */}
          <div className="rp-presets" ref={pickerRef} style={{ position: 'relative' }}>
            <button
              className={`rp-cal-btn${pickerOpen ? ' rp-cal-btn--on' : ''}`}
              onClick={openPicker}
              title="Custom date range"
            >
              <Calendar size={13} />
            </button>
            {PRESETS.map(p => (
              <button key={p.label}
                className={`rp-preset-btn${preset === p.days ? ' rp-preset-btn--on' : ''}`}
                onClick={() => applyPreset(p.days)}>
                {p.label}
              </button>
            ))}
            {/* Custom date picker popover */}
            {pickerOpen && (
              <div className="rp-datepicker">
                <div className="rp-datepicker-title">Custom Range</div>
                <div className="rp-datepicker-row">
                  <div className="rp-datepicker-field">
                    <label>From</label>
                    <input type="date" value={tempFrom} max={tempTo || undefined}
                      onChange={e => setTempFrom(e.target.value)} />
                  </div>
                  <div className="rp-datepicker-field">
                    <label>To</label>
                    <input type="date" value={tempTo} min={tempFrom || undefined}
                      onChange={e => setTempTo(e.target.value)} />
                  </div>
                </div>
                <button
                  className="rp-datepicker-apply"
                  disabled={!tempFrom || !tempTo}
                  onClick={applyCustomRange}
                >
                  Apply
                </button>
              </div>
            )}
          </div>
          {/* Hub filter */}
          {hubs.length > 0 && (
            <select
              className="rp-hub-select"
              value={hubId}
              onChange={e => setHubId(e.target.value)}
            >
              <option value="">All Hubs</option>
              {hubs.map(h => <option key={h.id} value={h.id}>{h.hub_name}</option>)}
            </select>
          )}
          {/* Compare toggle */}
          {dateRange.from && (() => {
            const prev = getPrevPeriodDates(dateRange);
            return (
              <button
                className={`rp-compare-btn${compareOn ? ' rp-compare-btn--on' : ''}`}
                onClick={() => setCompareOn(o => !o)}
                title={prev ? `Compare to ${prev.from} → ${prev.to}` : 'Compare to previous period'}
              >
                {compareOn && prev
                  ? `vs ${prev.from.slice(5)} → ${prev.to.slice(5)}`
                  : 'Compare'}
              </button>
            );
          })()}
          <button className="rp-refresh-btn" onClick={fetchData} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'rp-spin' : ''} />
          </button>
          <button className="rp-export-btn" onClick={exportPDF} disabled={loading || !summary} title="Export PDF">
            <FileDown size={14} />
            Export PDF
          </button>
          <button className="rp-export-btn" style={{ background: '#16a34a' }}
            onClick={() => {
              const rows = sortedUsers.map(u => [
                u.user_name || '—', u.email,
                u.total_leads, u.converted_leads,
                pct(u.converted_leads, u.total_leads),
                inr(u.total_revenue), inr(u.realized_revenue),
              ]);
              downloadCSV(
                `spinoto-report-${dateRange.from || 'all'}.csv`,
                rows,
                ['Name', 'Email', 'Leads', 'Converted', 'Conv. %', 'Pipeline', 'Realized'],
              );
            }}
            disabled={loading || byUser.length === 0}
            title="Export CSV"
          >
            <FileDown size={14} />
            CSV
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
        <button className={`rp-tab${tab === 'leads' ? ' rp-tab--on' : ''}`}
          onClick={() => setTab('leads')}>
          <TrendingUp size={14} /> Leads
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
              <KpiCard label="Total Leads" value={summary.total_leads}
                icon={TrendingUp} accent="#3b82f6"
                sub={`${summary.converted_leads} converted`}
                trend={trendPct(summary.total_leads, summary.prev?.total_leads)}
                prevValue={summary.prev ? summary.prev.total_leads : undefined}
                compareOn={compareOn} />
              <KpiCard label="Conversion Rate" value={pct(summary.converted_leads, summary.total_leads)}
                icon={TrendingUp} accent="#10b981"
                trend={trendPct(
                  Number(summary.converted_leads) / (Number(summary.total_leads) || 1),
                  Number(summary.prev?.converted_leads) / (Number(summary.prev?.total_leads) || 1)
                )}
                prevValue={summary.prev ? pct(summary.prev.converted_leads, summary.prev.total_leads) : undefined}
                compareOn={compareOn} />
              <KpiCard label="Lead Pipeline value" value={inr(summary.total_potential_revenue)}
                icon={IndianRupee} accent="#8b5cf6"
                trend={trendPct(summary.total_potential_revenue, summary.prev?.total_potential_revenue)}
                prevValue={summary.prev ? inr(summary.prev.total_potential_revenue) : undefined}
                compareOn={compareOn} />
              <KpiCard label="Appointment Realized Revenue" value={inr(summary.realized_revenue)}
                icon={IndianRupee} accent="#f59e0b"
                sub="Converted leads only"
                trend={trendPct(summary.realized_revenue, summary.prev?.realized_revenue)}
                prevValue={summary.prev ? inr(summary.prev.realized_revenue) : undefined}
                compareOn={compareOn} />
              <KpiCard label="Customer Invoice Total" value={inr(summary.customer_invoice_total)}
                icon={IndianRupee} accent="#06b6d4"
                sub={`${inr(summary.customer_invoice_paid)} paid`}
                trend={trendPct(summary.customer_invoice_total, summary.prev?.customer_invoice_total)}
                prevValue={summary.prev ? inr(summary.prev.customer_invoice_total) : undefined}
                compareOn={compareOn} />
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
              {(() => {
                const categoryTotal = revData.reduce((acc, curr) => acc + Number(curr.value || 0), 0);
                return (
                  <>
                    <h3 className="rp-chart-title">Revenue by Category (Total: {inr(categoryTotal)})</h3>
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
                  </>
                );
              })()}
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
                <span className="rp-ts-label">Appointment Realized Revenue</span>
                <span className="rp-ts-val">{inr(summary.realized_revenue)}</span>
              </div>
              <div className="rp-ts-div" />
              <div className="rp-ts-item">
                <span className="rp-ts-label">Customer Invoice Total</span>
                <span className="rp-ts-val">{inr(summary.customer_invoice_total)}</span>
              </div>
              <div className="rp-ts-div" />
              <div className="rp-ts-item">
                <span className="rp-ts-label">{scope === 'all' ? 'All' : 'Team'} Members</span>
                <span className="rp-ts-val">{byUser.length}</span>
              </div>
            </div>
          )}

          {/* Search */}
          <div className="rp-user-search-wrap">
            <Search size={14} className="rp-user-search-icon" />
            <input
              className="rp-user-search"
              placeholder="Search team members…"
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
            />
            {userSearch && (
              <button className="rp-user-search-clear" onClick={() => setUserSearch('')}>
                <X size={13} />
              </button>
            )}
          </div>

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
                  <tr><td colSpan={7} className="rp-td-empty">No user data available</td></tr>
                )}
                {userSearch && sortedUsers.length > 0 &&
                  sortedUsers.filter(u =>
                    (u.user_name || '').toLowerCase().includes(userSearch.toLowerCase()) ||
                    (u.email || '').toLowerCase().includes(userSearch.toLowerCase())
                  ).length === 0 && (
                    <tr><td colSpan={7} className="rp-td-empty">No members match "{userSearch}"</td></tr>
                  )}
                {sortedUsers.filter(u =>
                  !userSearch ||
                  (u.user_name || '').toLowerCase().includes(userSearch.toLowerCase()) ||
                  (u.email || '').toLowerCase().includes(userSearch.toLowerCase())
                ).map(u => {
                  const convRate = pct(u.converted_leads, u.total_leads);
                  const convNum = Number(u.total_leads) > 0
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
              const u = drawerData.user;
              const sb = drawerData.statusBreak;
              const ev = drawerData.pendingEvents;
              const rl = drawerData.recentLeads;
              const today = new Date().toISOString().slice(0, 10);
              const todayEvents = ev.filter(e => e.due_date.slice(0, 10) === today);
              const overdueEvents = ev.filter(e => e.due_date.slice(0, 10) < today);

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
                      <span className="rpd-rev-label">Lead Pipeline value</span>
                      <span className="rpd-rev-val">{inr(u.pipeline_value)}</span>
                    </div>
                    <div className="rpd-rev-div" />
                    <div className="rpd-rev-item">
                      <span className="rpd-rev-label">Appointment Realized Revenue</span>
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
                          const pctVal = maxCount > 0 ? (s.count / maxCount) * 100 : 0;
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
                                {l.vehicle_type_name && <span>{l.vehicle_type_name}</span>}
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

      {/* ══════════════════════════════════════════════════════════════════════
          LEADS TAB
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'leads' && (
        <div className="rp-leads-wrap">
          {/* ── Volume chart ── */}
          <div className="anl-card">
            <div className="anl-card-hd">
              <TrendingUp size={15} style={{ color: '#3b82f6' }} />
              Lead Volume Over Time
              <span className="anl-badge">
                {dateRange.from ? `${dateRange.from} → ${dateRange.to}` : 'All time'}
              </span>
              <div className="rp-groupby-toggle" style={{ marginLeft: 'auto' }}>
                {['day', 'week', 'month'].map(g => (
                  <button key={g}
                    className={`rp-groupby-btn${leadsGroupBy === g ? ' rp-groupby-btn--on' : ''}`}
                    onClick={() => setLeadsGroupBy(g)}>
                    {g.charAt(0).toUpperCase() + g.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Summary stats */}
            {!leadsLoading && leadsData.length > 0 && (() => {
              const total = leadsData.reduce((s, d) => s + d.count, 0);
              const peak = leadsData.reduce((a, b) => b.count > a.count ? b : a, leadsData[0]);
              const divisor = leadsGroupBy === 'month' ? leadsData.length : leadsData.length || 1;
              const avg = (total / divisor).toFixed(1);
              const peakLabel = (() => {
                const d = new Date(peak.period);
                if (leadsGroupBy === 'month') return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
                if (leadsGroupBy === 'week') return `W/C ${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`;
                return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
              })();
              return (
                <div className="rp-leads-stats">
                  <div className="rp-leads-stat"><span className="rp-leads-stat-val">{total}</span><span className="rp-leads-stat-lbl">Total Leads</span></div>
                  <div className="rp-leads-stat-div" />
                  <div className="rp-leads-stat"><span className="rp-leads-stat-val">{avg}</span><span className="rp-leads-stat-lbl">Avg / {leadsGroupBy}</span></div>
                  <div className="rp-leads-stat-div" />
                  <div className="rp-leads-stat"><span className="rp-leads-stat-val">{peakLabel}</span><span className="rp-leads-stat-lbl">Peak {leadsGroupBy}</span></div>
                </div>
              );
            })()}

            {leadsLoading ? (
              <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)', fontSize: 14 }}>Loading…</div>
            ) : leadsData.length === 0 ? (
              <div className="anl-empty">No lead data for this period</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={leadsData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                    tickFormatter={v => {
                      const d = new Date(v);
                      if (leadsGroupBy === 'month') return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
                      if (leadsGroupBy === 'week') return `W/C ${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`;
                      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
                    }}
                    interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} allowDecimals={false} />
                  <Tooltip formatter={v => [v, 'Leads']}
                    labelFormatter={v => {
                      const d = new Date(v);
                      if (leadsGroupBy === 'month') return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
                      if (leadsGroupBy === 'week') return `Week of ${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`;
                      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
                    }} />
                  <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── Source charts ── */}
          {!leadsLoading && sourceData.length > 0 && (
            <div className="anl-row2">
              {/* Lead Source Breakdown */}
              <div className="anl-card">
                <div className="anl-card-hd">
                  <TrendingUp size={15} style={{ color: '#8b5cf6' }} />
                  Leads by Source
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={sourceData} layout="vertical" margin={{ left: 10, right: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} allowDecimals={false} />
                    <YAxis type="category" dataKey="source" width={100} tick={{ fontSize: 11, fill: 'var(--text)' }} />
                    <Tooltip formatter={(v, name) => [v, name === 'total' ? 'Total Leads' : 'Converted']} />
                    <Legend />
                    <Bar dataKey="total" name="Total" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="converted" name="Converted" fill="#10b981" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Source vs Conversion Rate */}
              <div className="anl-card">
                <div className="anl-card-hd">
                  <TrendingUp size={15} style={{ color: '#f59e0b' }} />
                  Conversion Rate by Source
                </div>
                <div className="anl-funnel">
                  {sourceData.filter(s => s.total > 0).map(s => {
                    const rate = s.total > 0 ? Math.round((s.converted / s.total) * 100) : 0;
                    const color = rate >= 50 ? '#10b981' : rate >= 20 ? '#f59e0b' : '#94a3b8';
                    return (
                      <div key={s.source} className="anl-funnel-row">
                        <div className="anl-funnel-label" style={{ width: 110 }}>{s.source}</div>
                        <div className="anl-funnel-track">
                          <div className="anl-funnel-fill" style={{ width: `${rate}%`, background: color }} />
                        </div>
                        <div className="anl-funnel-count" style={{ color }}>{rate}%</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 40, textAlign: 'right' }}>{s.converted}/{s.total}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
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
                  <span className="anl-badge">
                    {dateRange.from ? `${dateRange.from} → ${dateRange.to}` : 'Last 12 months'}
                  </span>
                </div>
                {revTrend.length === 0 ? (
                  <div className="anl-empty">No invoice data yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={revTrend} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={v => `₹${Number(v) >= 1000 ? (Number(v) / 1000).toFixed(0) + 'k' : v}`} />
                      <Tooltip formatter={v => [`₹${Number(v).toLocaleString('en-IN')}`, 'Revenue']} />
                      <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4 }} />
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
                    <span className="anl-badge">
                      {dateRange.from ? `${dateRange.from} → ${dateRange.to}` : 'All time'}
                    </span>
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
                                {funnel[i - 1].count > 0 ? Math.round((f.count / funnel[i - 1].count) * 100) : 0}%
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
                    <span className="anl-badge">
                      {dateRange.from ? `${dateRange.from} → ${dateRange.to}` : 'Last 90 days'}
                    </span>
                  </div>
                  {topPerf.top_hubs.length === 0 ? (
                    <div className="anl-empty">No hub invoice data yet</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={topPerf.top_hubs} layout="vertical" margin={{ left: 10, right: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => `₹${Number(v) >= 1000 ? (Number(v) / 1000).toFixed(0) + 'k' : v}`} />
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
                  <span className="anl-badge">
                    {dateRange.from ? `${dateRange.from} → ${dateRange.to}` : 'Last 90 days'}
                  </span>
                </div>
                {topPerf.top_services.length === 0 ? (
                  <div className="anl-empty">No service revenue data yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(200, topPerf.top_services.length * 36)}>
                    <BarChart data={topPerf.top_services} layout="vertical" margin={{ left: 10, right: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => `₹${Number(v) >= 1000 ? (Number(v) / 1000).toFixed(0) + 'k' : v}`} />
                      <YAxis type="category" dataKey="service_name" width={130} tick={{ fontSize: 11, fill: 'var(--text)' }} />
                      <Tooltip formatter={v => [`₹${Number(v).toLocaleString('en-IN')}`, 'Revenue']} />
                      <Bar dataKey="revenue" fill="#8b5cf6" radius={[0, 6, 6, 0]} />
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
