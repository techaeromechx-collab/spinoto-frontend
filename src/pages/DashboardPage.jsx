import { useEffect, useState, useMemo, useId, useCallback } from 'react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';
import {
  Users, TrendingUp, IndianRupee, ArrowRight, PlusCircle,
  FileText, ChevronRight, MapPin, Car, Zap,
  BarChart2, Activity, Clock, Bell, CheckCircle2,
  CalendarDays, AlertCircle, Building2, ClipboardList,
  UserPlus, Calendar, Receipt, Wallet, UploadCloud,
  MoreVertical, Package, Wrench, MessageSquare, ListChecks, Tag, GripVertical, Phone,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  LineChart, Line,
} from 'recharts';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import '../styles/DashboardPage.css';

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats,        setStats]        = useState(null);
  const [dashStats,    setDashStats]    = useState(null);
  const [leads,        setLeads]        = useState([]);
  const [statusList,   setStatusList]   = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [now,          setNow]          = useState(new Date());
  const [teamMembers,  setTeamMembers]  = useState([]);
  const [todayEvents,  setTodayEvents]  = useState([]);
  const [eventsDone,   setEventsDone]   = useState({});
  const [pipelineFilter, setPipelineFilter] = useState('month');
  const [hubFilter,      setHubFilter]      = useState('month');
  const [hubLoading,     setHubLoading]     = useState(false);
  const [hubPerfData,    setHubPerfData]    = useState(null);
  const [teamPerfFilter, setTeamPerfFilter] = useState('month');
  const [teamPerfData,   setTeamPerfData]   = useState([]);
  const [teamPerfLoading,setTeamPerfLoading]= useState(false);
  const [fuFilter,     setFuFilter]     = useState('today');
  const [fuLoading,    setFuLoading]    = useState(false);
  const [customFrom,   setCustomFrom]   = useState('');
  const [customTo,     setCustomTo]     = useState('');
  const [showCustom,   setShowCustom]   = useState(false);
  const [fuShowAll,    setFuShowAll]    = useState(false);
  const FU_LIMIT = 5;

  const [estimates,    setEstimates]    = useState([]);
  const [revTrend,     setRevTrend]     = useState([]);
  const [activities,   setActivities]   = useState([]);
  const [purchaseInvs, setPurchaseInvs] = useState([]);
  const [todayAppts,   setTodayAppts]   = useState([]);
  const [customers,    setCustomers]    = useState([]);
  const [notifications,setNotifications]= useState([]);
  const [partsData,    setPartsData]    = useState(null);
  const [funnelData,   setFunnelData]   = useState([]);
  const [topServices,  setTopServices]  = useState([]);
  const [callSummary,  setCallSummary]  = useState(null);
  const [callLoading,  setCallLoading]  = useState(false);

  // ── Dashboard section order ───────────────────────────────────────────
  const DEFAULT_ORDER = [
    'kpi', 'strip', 'row1', 'row2', 'row3', 'row4', 'row5', 'team', 'calls', 'parts',
  ];
  const storageKey = `db-order-${user?.id || 'default'}`;
  const [sectionOrder, setSectionOrder] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge: keep saved order but add any new sections not yet in it
        const merged = parsed.filter(id => DEFAULT_ORDER.includes(id));
        DEFAULT_ORDER.forEach(id => { if (!merged.includes(id)) merged.push(id); });
        return merged;
      }
    } catch {}
    return DEFAULT_ORDER;
  });
  const [activeId, setActiveId] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleDragEnd = useCallback(({ active, over }) => {
    setActiveId(null);
    if (!over || active.id === over.id) return;
    setSectionOrder(prev => {
      const next = arrayMove(prev, prev.indexOf(active.id), prev.indexOf(over.id));
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  }, [storageKey]);

  // ── Permission gates ─────────────────────────────────────────────────
  const canViewOwnDashboard = user?.permissions?.includes('VIEW_DASHBOARD_OWN');
  const isManager             = user?.permissions?.includes('VIEW_TEAM_LEADS') && !user?.is_super_admin;
  const canViewReports        = user?.is_super_admin || user?.permissions?.includes('VIEW_REPORTS');
  const isSuperAdmin          = !!user?.is_super_admin;
  const canViewDashRevenue    = isSuperAdmin || user?.permissions?.includes('VIEW_DASHBOARD_REVENUE');
  const canViewDashInvoices   = isSuperAdmin || user?.permissions?.includes('VIEW_DASHBOARD_INVOICES');
  const canViewDashAppointments = isSuperAdmin || user?.permissions?.includes('VIEW_DASHBOARD_APPOINTMENTS');
  const canViewDashLeads      = isSuperAdmin || user?.permissions?.includes('VIEW_DASHBOARD_LEADS') || canViewOwnDashboard;
  const canViewDashFollowups  = isSuperAdmin || user?.permissions?.includes('VIEW_DASHBOARD_FOLLOWUPS') || canViewOwnDashboard;
  const canViewDashEstimates        = isSuperAdmin || user?.permissions?.includes('VIEW_DASHBOARD_ESTIMATES');
  const canViewDashApptList         = isSuperAdmin || user?.permissions?.includes('VIEW_DASHBOARD_APPOINTMENTS');
  const canViewDashHubPerformance   = isSuperAdmin || user?.permissions?.includes('VIEW_DASHBOARD_HUB_PERFORMANCE');
  const canViewDashCustomers        = isSuperAdmin || user?.permissions?.includes('VIEW_DASHBOARD_CUSTOMERS');
  const canViewDashNotifications    = isSuperAdmin || user?.permissions?.includes('VIEW_DASHBOARD_NOTIFICATIONS');
  const canViewDashParts            = isSuperAdmin || user?.permissions?.includes('VIEW_DASHBOARD_PARTS');
  const canViewDashTeamPerf         = isSuperAdmin
    || user?.permissions?.includes('VIEW_DASHBOARD_TEAM_PERFORMANCE')
    || user?.permissions?.includes('MANAGE_USERS');
  const canViewDashCalls = isSuperAdmin
    || user?.permissions?.includes('VIEW_LEAD')
    || user?.permissions?.includes('VIEW_OWN_LEADS')
    || user?.permissions?.includes('VIEW_TEAM_LEADS');
  const canViewDashStatsStrip       = isSuperAdmin || user?.permissions?.includes('VIEW_DASHBOARD_STATS_STRIP')
    || canViewReports || canViewDashRevenue || canViewDashLeads || canViewDashInvoices || canViewDashAppointments || canViewDashFollowups;
  const canViewDashRevenueTrend     = isSuperAdmin || user?.permissions?.includes('VIEW_DASHBOARD_REVENUE_TREND') || canViewReports || canViewDashRevenue;
  const canViewDashQuickActions     = isSuperAdmin || user?.permissions?.includes('VIEW_DASHBOARD_QUICK_ACTIONS') || canViewOwnDashboard || true;
  const canViewDashActivities       = isSuperAdmin || user?.permissions?.includes('VIEW_DASHBOARD_ACTIVITIES');
  const canViewDashFunnel           = isSuperAdmin || user?.permissions?.includes('VIEW_DASHBOARD_FUNNEL') || canViewReports;
  const canViewDashTopServices      = isSuperAdmin || user?.permissions?.includes('VIEW_DASHBOARD_TOP_SERVICES') || canViewReports;

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  // Derived: any dashboard or report permission grants summary/dashboard access
  const canViewAnyDash = canViewReports || canViewDashRevenue || canViewDashLeads ||
    canViewDashInvoices || canViewDashAppointments || canViewDashFollowups ||
    canViewDashStatsStrip || canViewDashRevenueTrend || canViewDashActivities;

  // Main data fetch
  useEffect(() => {
    Promise.all([
      canViewAnyDash ? api('/api/reports/summary').catch(() => null) : Promise.resolve(null),
      canViewAnyDash ? api('/api/reports/dashboard').catch(() => null) : Promise.resolve(null),
      canViewDashLeads ? api('/api/leads').catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      canViewDashLeads ? api('/api/lead-statuses').catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      canViewDashFollowups ? api('/api/lead-events?filter=today').catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
    ]).then(([s, ds, l, sl, ev]) => {
      setStats(s);
      setDashStats(ds);
      setLeads(l.items || []);
      setStatusList(sl.items || []);
      setTodayEvents(ev.items || []);
    }).finally(() => setLoading(false));
  }, []);

  // Widget data fetch
  useEffect(() => {
    const todayISO = new Date().toISOString().slice(0, 10);
    Promise.all([
      canViewDashEstimates ? api('/api/estimates?limit=5').catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      (canViewReports || canViewDashRevenue) ? api('/api/reports/analytics/revenue-trend').catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      canViewDashActivities ? api('/api/logs/activity?limit=8').catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      (canViewDashInvoices) ? api('/api/purchase-invoices?limit=5').catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      canViewDashAppointments ? api('/api/appointments?limit=30').catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      canViewDashCustomers ? api('/api/customers?limit=5').catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      canViewDashNotifications ? api('/api/notifications?limit=8').catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      canViewDashParts ? api('/api/parts?limit=200').catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      (canViewReports || canViewDashLeads) ? api('/api/reports/analytics/funnel').catch(() => ({ funnel: [] })) : Promise.resolve({ funnel: [] }),
      (canViewReports || canViewDashRevenue) ? api('/api/reports/analytics/top-performers').catch(() => ({ top_hubs: [], top_services: [] })) : Promise.resolve({ top_hubs: [], top_services: [] }),
    ]).then(([est, rt, act, pi, appts, cust, notifs, parts, fn, tp]) => {
      setEstimates(est.items || []);
      setRevTrend((rt.items || []).slice(-10));
      setActivities(act.items || []);
      setPurchaseInvs(pi.items || []);
      setTodayAppts((appts.items || []).filter(a => a.scheduled_date === todayISO).slice(0, 6));
      setCustomers(cust.items || []);
      setNotifications(notifs.items || []);
      const partsList = parts.items || [];
      setPartsData({ total: partsList.length, activeCount: partsList.filter(p => p.is_active !== false).length });
      setFunnelData(fn.funnel || []);
      setTopServices(tp.top_services || []);
    });
  }, []);

  // Follow-up filter
  useEffect(() => {
    if (fuFilter === 'custom') return;
    setFuLoading(true);
    api(`/api/lead-events?filter=${fuFilter}`)
      .then(ev => setTodayEvents(ev.items || []))
      .catch(() => {})
      .finally(() => setFuLoading(false));
  }, [fuFilter]);

  // Team performance filter
  useEffect(() => {
    if (!canViewDashTeamPerf) return;
    setTeamPerfLoading(true);
    api(`/api/reports/team-performance?period=${teamPerfFilter}`)
      .then(r => setTeamPerfData(r.items || []))
      .catch(() => setTeamPerfData([]))
      .finally(() => setTeamPerfLoading(false));
  }, [teamPerfFilter, canViewDashTeamPerf]);

  // Hub performance filter
  useEffect(() => {
    if (!canViewDashHubPerformance) return;
    setHubLoading(true);
    api(`/api/reports/dashboard?period=${hubFilter}`)
      .then(ds => setHubPerfData(ds?.hub_performance ?? null))
      .catch(() => setHubPerfData(null))
      .finally(() => setHubLoading(false));
  }, [hubFilter, canViewDashHubPerformance]);

  // Call summary fetch (today)
  useEffect(() => {
    if (!canViewDashCalls) return;
    setCallLoading(true);
    api('/api/leads/calls/summary')
      .then(r => setCallSummary(r))
      .catch(() => setCallSummary(null))
      .finally(() => setCallLoading(false));
  }, [canViewDashCalls]);

  function applyCustomFilter() {
    if (!customFrom || !customTo) return;
    setFuLoading(true);
    api(`/api/lead-events?filter=custom&date_from=${customFrom}&date_to=${customTo}`)
      .then(ev => setTodayEvents(ev.items || []))
      .catch(() => {})
      .finally(() => setFuLoading(false));
  }

  // Team members for managers
  useEffect(() => {
    if (!isManager) return;
    api('/api/users')
      .then(r => setTeamMembers((r.items || []).filter(u => u.manager_id === user?.id)))
      .catch(console.error);
  }, [isManager, user?.id]);

  // ── Derived metrics ──────────────────────────────────────────────────
  const todayStr      = now.toDateString();
  const todayLeads    = leads.filter(l => new Date(l.created_at).toDateString() === todayStr).length;
  const pipelineVal   = dashStats ? Number(dashStats.pipeline_value || 0) : 0;
  const totalLeads    = leads.length;
  const myId          = Number(user?.id);
  const assignedLeads = leads.filter(l => Number(l.assigned_to) === myId && Number(l.created_by) !== myId).length;

  const statusCounts = useMemo(() => {
    const map = {};
    for (const l of leads) map[l.status] = (map[l.status] || 0) + 1;
    return map;
  }, [leads]);

  const topStatuses = useMemo(() => {
    return statusList
      .filter(s => statusCounts[s.name])
      .map(s => ({ ...s, count: statusCounts[s.name] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [statusList, statusCounts]);

  const totalInPipeline = topStatuses.reduce((s, x) => s + x.count, 0);

  // ── Pipeline Overview derived data ───────────────────────────────────────
  const pipelineLeads = useMemo(() => {
    const now = new Date();
    return leads.filter(l => {
      const d = new Date(l.created_at);
      if (pipelineFilter === 'week') {
        const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
        return d >= weekAgo;
      }
      if (pipelineFilter === 'month') {
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }
      return true;
    });
  }, [leads, pipelineFilter]);

  const statusRevenue = useMemo(() => {
    const map = {};
    for (const l of leads) map[l.status] = (map[l.status] || 0) + Number(l.total_price || 0);
    return map;
  }, [leads]);

  const pipelineStatusCounts = useMemo(() => {
    const map = {};
    for (const l of pipelineLeads) map[l.status] = (map[l.status] || 0) + 1;
    return map;
  }, [pipelineLeads]);

  const pipelineTopStatuses = useMemo(() => {
    return statusList
      .filter(s => pipelineStatusCounts[s.name])
      .map(s => ({ ...s, count: pipelineStatusCounts[s.name], revenue: statusRevenue[s.name] || 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [statusList, pipelineStatusCounts, statusRevenue]);

  const pipelineTotal      = pipelineLeads.length;
  const pipelineInPipeline = pipelineTopStatuses.reduce((s, x) => s + x.count, 0);
  const pipelineValue      = pipelineLeads.reduce((s, l) => s + Number(l.total_price || 0), 0);
  const pipelineConvRate   = pipelineTotal > 0
    ? Math.round((pipelineLeads.filter(l => l.is_converted).length / pipelineTotal) * 100) : 0;

  const recentLeads     = leads.slice(0, 5);
  const visibleEvents   = todayEvents.filter(e => !eventsDone[e.id]);

  function getStatusCfg(name) {
    const s = statusList.find(s => s.name === name);
    return s ? { color: s.color, bg: s.bg_color } : { color: '#6b7280', bg: '#f3f4f6' };
  }

  async function markEventDone(eventId) {
    try {
      await api(`/api/lead-events/${eventId}/done`, { method: 'PATCH' });
      setEventsDone(prev => ({ ...prev, [eventId]: true }));
    } catch (e) { console.error(e); }
  }

  // Donut chart data
  const donutData = topStatuses.map(s => ({ name: s.name, value: s.count, color: s.color }));

  // Activity icon map
  const activityIcon = (entity) => {
    const map = { lead: Users, appointment: CalendarDays, invoice: FileText, estimate: ClipboardList, hub: Building2 };
    const Icon = map[entity?.toLowerCase()] || Activity;
    return <Icon size={13} />;
  };
  const activityColor = (entity) => {
    const map = { lead: '#3b82f6', appointment: '#8b5cf6', invoice: '#10b981', estimate: '#f59e0b', hub: '#0ea5e9' };
    return map[entity?.toLowerCase()] || '#6b7280';
  };

  // ── Personal dashboard stats (Caller scope) ──────────────────────────
  const myConvertedLeads  = leads.filter(l => l.is_converted).length;
  const myConversionRate  = leads.length > 0 ? Math.round((myConvertedLeads / leads.length) * 100) : 0;
  const myPipelineValue   = leads.reduce((s, l) => s + Number(l.total_price || 0), 0);
  const myFollowupsToday  = visibleEvents.length;

  // ── Sparkline data derived from leads by day (last 7 days) ─────────────
  // Build last-7-days date strings once
  const last7Days = useMemo(() => [...Array(7)].map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    return d.toDateString();
  }), []);

  // Leads created per day — used for Lead Conversion card
  const sparkLeads = useMemo(() =>
    last7Days.map(d => ({ v: leads.filter(l => new Date(l.created_at).toDateString() === d).length })),
  [leads, last7Days]);

  // Converted leads (has appointment) per day — used for Appointments card
  const sparkAppts = useMemo(() =>
    last7Days.map(d => ({
      v: leads.filter(l => l.is_converted && new Date(l.updated_at).toDateString() === d).length,
    })),
  [leads, last7Days]);

  // Pending invoices proxy — leads with total_price > 0 per day, used for Pending Invoices card
  const sparkInvoices = useMemo(() =>
    last7Days.map(d => ({
      v: leads.filter(l => Number(l.total_price) > 0 && new Date(l.created_at).toDateString() === d).length,
    })),
  [leads, last7Days]);

  // Revenue trend — monthly, last 7 months
  const sparkRevenue = useMemo(() => revTrend.slice(-7).map(r => ({ v: Number(r.revenue || 0) })), [revTrend]);

  // Dynamic column counts — avoids empty column gaps when cards are permission-gated
  const row1Cols = [canViewDashLeads, canViewDashAppointments, canViewDashFollowups].filter(Boolean).length;
  const row2Cols = [canViewDashLeads, canViewDashRevenueTrend, canViewDashQuickActions].filter(Boolean).length;
  const canViewRecentInvoices = canViewDashRevenue && (isSuperAdmin || canViewDashInvoices || user?.permissions?.includes('VIEW_INVOICE'));
  const row3Cols = [canViewRecentInvoices, canViewDashEstimates, canViewDashActivities].filter(Boolean).length;
  const row4Cols = [canViewDashInvoices, canViewDashApptList, canViewDashCustomers].filter(Boolean).length;
  const row5Cols = (canViewDashFunnel || canViewDashTopServices || canViewDashNotifications)
    ? [canViewDashFunnel, canViewDashTopServices, canViewDashNotifications].filter(Boolean).length : 0;

  // ── Section render map ────────────────────────────────────────────────
  const sectionMap = {
    kpi:   canViewDashAppointments || canViewDashRevenue || canViewDashInvoices || canViewDashLeads || canViewOwnDashboard,
    strip: canViewDashStatsStrip,
    row1:  canViewDashLeads || canViewDashAppointments || canViewDashFollowups,
    row2:  canViewDashLeads || canViewDashRevenueTrend || canViewDashQuickActions,
    row3:  row3Cols > 0,
    row4:  row4Cols > 0,
    row5:  row5Cols > 0,
    team:  canViewDashTeamPerf,
    calls: canViewDashCalls,
    parts: !!(canViewDashParts && partsData),
  };

  return (
    <div className="db-wrap">

      {/* ── Hero greeting ─────────────────────────────────────────────────── */}
      <div className="db-hero">
        <div className="db-hero-left">
          <div className="db-hero-wave">{getWave(now.getHours())}</div>
          <div>
            <div className="db-hero-greeting">
              {getGreeting(now.getHours())}, <span className="db-hero-name">{user?.name?.split(' ')[0]}</span>
            </div>
            <div className="db-hero-date">
              <Clock size={11} style={{ display:'inline', verticalAlign:'middle', marginRight:3 }} />
              {now.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
            </div>
          </div>
        </div>
        <button className="db-strip-btn" onClick={() => window.dispatchEvent(new Event('open-lead-modal'))}>
          <PlusCircle size={14} /> New Lead
        </button>
      </div>

      {/* ── Sortable sections ────────────────────────────────────────────── */}
      <DndContext sensors={sensors} collisionDetection={closestCenter}
        onDragStart={({ active }) => setActiveId(active.id)}
        onDragEnd={handleDragEnd}>
        <SortableContext items={sectionOrder} strategy={verticalListSortingStrategy}>
          {sectionOrder.filter(id => sectionMap[id]).map(id => (
            <SortableSection key={id} id={id} activeId={activeId}>
              {id === 'kpi' ? (
      <div className="db-kpi-row">
        {canViewDashAppointments && (
          <KpiCard
            icon={<CalendarDays size={18} />} color="#8b5cf6"
            label="Today's Appointments"
            value={loading ? '—' : String(dashStats?.today_appointments ?? '—')}
            sub={dashStats ? `${dashStats.month_invoice_count} invoices this month` : null}
            sparkData={sparkAppts} sparkColor="#8b5cf6"
            to="/appointments"
          />
        )}
        {canViewDashRevenue && (
          <KpiCard
            icon={<IndianRupee size={18} />} color="#10b981"
            label="Monthly Revenue"
            value={loading ? '—' : '₹' + fmtINR(Number(dashStats?.month_revenue || 0))}
            sub="Collected this month"
            sparkData={sparkRevenue} sparkColor="#10b981"
            to="/customer-invoices"
          />
        )}
        {canViewDashInvoices && (
          <KpiCard
            icon={<AlertCircle size={18} />} color="#ef4444"
            label="Pending Invoices"
            value={loading ? '—' : String(dashStats?.pending_invoices ?? '—')}
            sub={dashStats ? `₹${fmtINR(Number(dashStats.outstanding_amount))} outstanding` : null}
            sparkData={sparkInvoices} sparkColor="#ef4444"
            to="/customer-invoices"
          />
        )}
        {canViewDashLeads && (
          <KpiCard
            icon={<TrendingUp size={18} />} color="#f59e0b"
            label="Lead Conversion"
            value={loading ? '—' : (dashStats?.lead_conversion?.conversion_rate ?? 0) + '%'}
            sub={dashStats ? `${dashStats.lead_conversion?.converted_leads || 0} of ${dashStats.lead_conversion?.total_leads || 0} leads` : null}
            sparkData={sparkLeads} sparkColor="#f59e0b"
            to="/leads"
          />
        )}
        {/* Personal KPI cards — Caller only (no full dashboard access) */}
        {canViewOwnDashboard && !canViewDashAppointments && !canViewDashRevenue && !canViewDashInvoices && (
          <>
            <KpiCard
              icon={<Users size={18} />} color="#3b82f6"
              label="My Leads"
              value={loading ? '—' : String(leads.length)}
              sub={`${myConvertedLeads} converted`}
              sparkData={sparkLeads} sparkColor="#3b82f6"
              to="/leads"
            />
            <KpiCard
              icon={<TrendingUp size={18} />} color="#10b981"
              label="My Conversion"
              value={loading ? '—' : myConversionRate + '%'}
              sub={`${myConvertedLeads} of ${leads.length} leads`}
              sparkData={sparkLeads} sparkColor="#10b981"
              to="/leads"
            />
            <KpiCard
              icon={<IndianRupee size={18} />} color="#f59e0b"
              label="My Pipeline"
              value={loading ? '—' : '₹' + fmtINR(myPipelineValue)}
              sub="Total lead value"
              sparkData={sparkLeads} sparkColor="#f59e0b"
              to="/leads"
            />
            <KpiCard
              icon={<Bell size={18} />} color="#ef4444"
              label="Today's Follow-ups"
              value={loading ? '—' : String(myFollowupsToday)}
              sub="Pending today"
              sparkData={sparkLeads} sparkColor="#ef4444"
              to="/leads"
            />
          </>
        )}
      </div>
              ) : id === 'strip' ? (
      <div className="db-strip">
        {/* 1. Total Leads */}
        <StatChip icon={<Users size={14} />} color="#3b82f6" label="Total Leads" value={loading ? '…' : totalLeads} />
        <div className="db-strip-div" />

        {/* 2. Pipeline Value */}
        <StatChip icon={<IndianRupee size={14} />} color="#10b981" label="Pipeline Value" value={loading ? '…' : '₹' + fmtINR(canViewOwnDashboard && !dashStats ? myPipelineValue : pipelineVal)} />
        <div className="db-strip-div" />

        {/* 3. Appointments Today */}
        <StatChip icon={<CalendarDays size={14} />} color="#8b5cf6" label="Appointments Today" value={loading ? '…' : (dashStats?.today_appointments ?? '—')} />
        <div className="db-strip-div" />

        {/* 4. New Today */}
        <StatChip icon={<Activity size={14} />} color="#f59e0b" label="New Today" value={loading ? '…' : todayLeads} />
        <div className="db-strip-div" />

        {/* 5. Unassigned Leads */}
        <StatChip
          icon={<Users size={14} />}
          color={dashStats?.unassigned_leads > 0 ? '#ef4444' : '#6b7280'}
          label="Unassigned"
          value={loading ? '…' : (dashStats?.unassigned_leads ?? '—')}
          warn={dashStats?.unassigned_leads > 0}
        />
        <div className="db-strip-div" />

        {/* 6. Estimates Pending */}
        <StatChip
          icon={<ClipboardList size={14} />}
          color={dashStats?.pending_estimates > 0 ? '#f59e0b' : '#6b7280'}
          label="Estimates Pending"
          value={loading ? '…' : (dashStats?.pending_estimates ?? '—')}
        />
        <div className="db-strip-div" />

        {/* 7. Overdue Follow-ups */}
        <StatChip
          icon={<Activity size={14} />}
          color={dashStats?.overdue_followups > 0 ? '#ef4444' : '#6b7280'}
          label="Overdue Follow-ups"
          value={loading ? '…' : (dashStats?.overdue_followups ?? '—')}
          warn={dashStats?.overdue_followups > 0}
        />
        <div className="db-strip-div" />

        {/* 8. Converted This Month */}
        <StatChip
          icon={<TrendingUp size={14} />}
          color="#10b981"
          label="Converted This Month"
          value={loading ? '…' : (dashStats?.converted_this_month ?? '—')}
        />
      </div>
              ) : id === 'row1' ? (
      <div className={`db-${row1Cols}col`}>

        {/* Pipeline Overview — redesigned */}
        {canViewDashLeads && (
          <div className="db-card">
            <div className="db-card-hd">
              <div className="db-card-title">
                <span className="db-card-dot" style={{ background: '#8b5cf6' }} />
                Pipeline Overview
              </div>
              <select
                className="db-pipeline-filter"
                value={pipelineFilter}
                onChange={e => setPipelineFilter(e.target.value)}
              >
                <option value="week">This Week</option>
                <option value="month">This Month</option>
                <option value="all">All Time</option>
              </select>
            </div>

            {loading ? <SkeletonList n={4} h={28} /> : pipelineTopStatuses.length === 0 ? (
              <EmptyState label="No leads yet." />
            ) : (
              <>
                <div className="db-pipeline-body">
                  {/* Donut */}
                  <div className="db-pipeline-donut">
                    <ResponsiveContainer width="100%" height={148}>
                      <PieChart>
                        <Pie
                          data={pipelineTopStatuses.map(s => ({ name: s.name, value: s.count, color: s.color }))}
                          cx="50%" cy="50%" innerRadius={44} outerRadius={66}
                          dataKey="value" paddingAngle={2} stroke="none"
                        >
                          {pipelineTopStatuses.map((entry, i) => (
                            <Cell key={i} fill={entry.color || '#e5e7eb'} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v, n) => [v, n]}
                          contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', fontSize: 12 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="db-donut-center">
                      <div className="db-donut-total">{pipelineTotal}</div>
                      <div className="db-donut-label">Total Leads</div>
                    </div>
                  </div>

                  {/* Legend */}
                  <div className="db-pipeline-legend">
                    {pipelineTopStatuses.map(s => {
                      const pct = pipelineInPipeline > 0 ? Math.round((s.count / pipelineInPipeline) * 100) : 0;
                      return (
                        <Link key={s.id} to="/leads" className="db-pipeline-row">
                          <span className="db-donut-dot" style={{ background: s.color }} />
                          <span className="db-pipeline-name">{s.name}</span>
                          <span className="db-pipeline-stat">
                            <span className="db-pipeline-count">{s.count}</span>
                            <span className="db-pipeline-pct"> ({pct}%)</span>
                          </span>
                          <span className="db-pipeline-rev">₹{fmtINR(s.revenue)}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>

                {/* Footer KPIs */}
                <div className="db-pipeline-footer">
                  <div className="db-pipeline-kpi">
                    <div className="db-pipeline-kpi-label">Conversion Rate</div>
                    <div className="db-pipeline-kpi-val">{pipelineConvRate}%</div>
                  </div>
                  <div className="db-pipeline-kpi-div" />
                  <div className="db-pipeline-kpi">
                    <div className="db-pipeline-kpi-label">Pipeline Value</div>
                    <div className="db-pipeline-kpi-val" style={{ color: '#10b981' }}>
                      <BarChart2 size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 3 }} />
                      ₹{fmtINR(pipelineValue)}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Hub Performance */}
        {canViewDashHubPerformance && (
          <div className="db-card">
            <div className="db-card-hd">
              <div className="db-card-title">
                <span className="db-card-dot" style={{ background: '#0ea5e9' }} />
                <Building2 size={13} style={{ color: '#0ea5e9' }} />
                Hub Performance
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <select
                  className="db-pipeline-filter"
                  value={hubFilter}
                  onChange={e => setHubFilter(e.target.value)}
                >
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                  <option value="all">All Time</option>
                </select>
                <Link to="/appointments" className="db-view-all">View all <ArrowRight size={12} /></Link>
              </div>
            </div>
            {(loading || hubLoading) ? <SkeletonList n={4} h={32} /> : !(hubPerfData ?? dashStats?.hub_performance)?.length ? (
              <div className="db-empty" style={{ padding: 20 }}>
                <Building2 size={20} style={{ opacity: 0.2 }} />
                <div>No hub data yet</div>
              </div>
            ) : (
              <div className="db-hub-list">
                {(() => {
                  const hubs = hubPerfData ?? dashStats.hub_performance;
                  const maxApts = Math.max(...hubs.map(h => h.appointment_count), 1);
                  return hubs.map((h, i) => (
                    <motion.div key={h.hub_name} className="db-hub-row"
                      initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06 }}>
                      <div className="db-hub-avatar">{h.hub_name.charAt(0)}</div>
                      <div className="db-hub-info">
                        <div className="db-hub-name">{h.hub_name}</div>
                        <div className="db-hub-track">
                          <motion.div className="db-hub-fill"
                            initial={{ width: 0 }}
                            animate={{ width: `${(h.appointment_count / maxApts) * 100}%` }}
                            transition={{ duration: 0.6, delay: 0.05 * i, ease: 'easeOut' }} />
                        </div>
                      </div>
                      <div className="db-hub-right">
                        <span className="db-hub-count">{h.appointment_count}</span>
                        {Number(h.total_value) > 0 && <span className="db-hub-val">₹{fmtINR(Number(h.total_value))}</span>}
                      </div>
                    </motion.div>
                  ));
                })()}
              </div>
            )}
          </div>
        )}

        {/* Follow-ups */}
        {canViewDashFollowups && (
          <div className="db-card db-followups" style={{ padding: 0 }}>
            <div className="db-fu-hdr">
              <div className="db-card-title">
                <span className="db-card-dot" style={{ background: visibleEvents.length > 0 ? '#ef4444' : '#9ca3af' }} />
                <Bell size={13} style={{ color: visibleEvents.length > 0 ? '#ef4444' : 'var(--text-muted)' }} />
                Follow-ups
                {visibleEvents.length > 0 && <span className="db-fu-badge">{visibleEvents.length}</span>}
              </div>
            </div>
            <div className="db-fu-tabbar">
              {[{ key: 'today', label: 'Today' }, { key: 'tomorrow', label: 'Tomorrow' },
                { key: 'week', label: 'This Week' }, { key: 'custom', label: '📅 Custom' }].map(tab => (
                <button key={tab.key}
                  className={`db-fu-tab${fuFilter === tab.key ? ' db-fu-tab--active' : ''}`}
                  onClick={() => { setFuFilter(tab.key); setShowCustom(tab.key === 'custom'); setEventsDone({}); setFuShowAll(false); }}>
                  {tab.label}
                </button>
              ))}
            </div>
            {showCustom && (
              <div className="db-fu-custom-row">
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="db-fu-date-input" />
                <span className="db-fu-date-sep">→</span>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="db-fu-date-input" />
                <button onClick={applyCustomFilter} className="db-fu-apply-btn">Apply</button>
              </div>
            )}
            {fuLoading ? (
              <div className="db-fu-empty"><Clock size={16} /><span>Loading…</span></div>
            ) : visibleEvents.length === 0 ? (
              <div className="db-fu-caught-up">
                <div className="db-fu-caught-text">
                  <div className="db-fu-caught-title">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="8" fill="#dcfce7"/>
                      <path d="M4.5 8.5l2.5 2.5 4.5-4.5" stroke="#16a34a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    All caught up
                  </div>
                  <div className="db-fu-caught-sub">No pending follow-ups for today!</div>
                </div>
                <svg className="db-fu-caught-svg" viewBox="0 0 80 72" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="10" y="10" width="44" height="54" rx="5" fill="#f0fdf4" stroke="#bbf7d0" strokeWidth="1.2"/>
                  <rect x="22" y="5" width="20" height="10" rx="4" fill="#fff" stroke="#bbf7d0" strokeWidth="1.2"/>
                  <rect x="26" y="7.5" width="12" height="3.5" rx="1.8" fill="#bbf7d0"/>
                  <rect x="18" y="26" width="28" height="3" rx="1.5" fill="#bbf7d0"/>
                  <rect x="18" y="33" width="20" height="3" rx="1.5" fill="#d1fae5"/>
                  <rect x="18" y="40" width="24" height="3" rx="1.5" fill="#d1fae5"/>
                  <circle cx="59" cy="52" r="16" fill="#16a34a"/>
                  <path d="M51.5 52.5l5 5 9-9" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="8" cy="16" r="2" fill="#86efac" opacity="0.5"/>
                  <circle cx="66" cy="14" r="1.5" fill="#86efac" opacity="0.4"/>
                </svg>
              </div>
            ) : (
              <div className={`db-fu-list${!fuShowAll && visibleEvents.length > FU_LIMIT ? ' db-fu-list--collapsed' : ''}`}>
                {(fuShowAll ? visibleEvents : visibleEvents.slice(0, FU_LIMIT)).map((ev, i) => {
                  const cfg = getStatusCfg(ev.lead_current_status);
                  const initials = (ev.lead_name || ev.lead_mobile || '?').charAt(0).toUpperCase();
                  const today = now.toISOString().slice(0, 10);
                  const isOverdue = ev.due_date < today;
                  return (
                    <motion.div key={ev.id} className="db-fu-row"
                      initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      onClick={e => { if (!e.target.closest('button')) navigate('/leads', { state: { openLeadId: ev.lead_id } }); }}
                      style={{ cursor: 'pointer' }}>
                      <div className="db-lead-avatar" style={{ background: cfg.bg, color: cfg.color, borderRadius: 10 }}>{initials}</div>
                      <div className="db-lead-info">
                        <div className="db-lead-name">
                          <span>{ev.lead_name || ev.lead_mobile}</span>
                          {isOverdue && <span className="db-fu-overdue-tag">Overdue</span>}
                        </div>
                        <div className="db-lead-meta"><span className="db-meta-note">{ev.note}</span></div>
                      </div>
                      <div className="db-fu-actions">
                        <span className="db-status-pill" style={{ background: cfg.bg, color: cfg.color }}>{ev.lead_current_status || 'New'}</span>
                        <button className="db-fu-done-btn" onClick={() => markEventDone(ev.id)}><CheckCircle2 size={12} /> Done</button>
                      </div>
                    </motion.div>
                  );
                })}
                {visibleEvents.length > FU_LIMIT && (
                  <button className={`db-fu-viewall${fuShowAll ? ' db-fu-viewall--open' : ''}`} onClick={() => setFuShowAll(s => !s)}>
                    {fuShowAll ? 'Show less' : `View all ${visibleEvents.length} follow-ups`}
                    <ChevronRight size={12} className="db-fu-viewall-icon" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

              ) : id === 'row2' ? (
      <div className={`db-${row2Cols}col`}>

        {/* Quick Actions */}
        <div className="db-card">
          <div className="db-card-hd">
            <div className="db-card-title">
              <span className="db-card-dot" style={{ background: '#f59e0b' }} />
              Quick Actions
            </div>
          </div>
          <div className="db-qa-grid">
            {(canViewDashLeads || isSuperAdmin) &&
              <QA to="/leads" icon={<Users size={16} />} color="#3b82f6" label="Add New Lead" onClick={() => window.dispatchEvent(new Event('open-lead-modal'))} />}
            {canViewDashAppointments &&
              <QA to="/appointments" icon={<Calendar size={16} />} color="#8b5cf6" label="Schedule Appointment" />}
            {canViewDashEstimates &&
              <QA to="/estimates" icon={<ClipboardList size={16} />} color="#10b981" label="Create Estimate" />}
            {canViewDashRevenue &&
              <QA to="/customer-invoices" icon={<Receipt size={16} />} color="#f59e0b" label="Create Invoice" />}
            {canViewDashCustomers &&
              <QA to="/customers" icon={<UserPlus size={16} />} color="#06b6d4" label="Add Customer" />}
            {canViewReports &&
              <QA to="/reports" icon={<BarChart2 size={16} />} color="#ef4444" label="View Reports" />}
            {(isSuperAdmin || user?.permissions?.includes('VIEW_HUB') || user?.permissions?.includes('MANAGE_HUBS')) &&
              <QA to="/payouts" icon={<Wallet size={16} />} color="#0ea5e9" label="Hub Payouts" />}
            {canViewDashInvoices &&
              <QA to="/purchase-invoices" icon={<Package size={16} />} color="#f97316" label="Purchase Invoice" />}
            {canViewDashParts &&
              <QA to="/master/parts" icon={<Wrench size={16} />} color="#64748b" label="Parts Catalogue" />}
            {(isSuperAdmin || user?.permissions?.includes('VIEW_SERVICE') || user?.permissions?.includes('MANAGE_PRICING')) &&
              <QA to="/master/services" icon={<Tag size={16} />} color="#10b981" label="Services & Pricing" />}
            {canViewDashFollowups &&
              <QA to="/leads" icon={<ListChecks size={16} />} color="#ec4899" label="View Follow-ups" />}
            {canViewDashCustomers &&
              <QA to="/customers" icon={<Users size={16} />} color="#7c3aed" label="All Customers" />}
            {user?.permissions?.includes('BULK_UPLOAD') &&
              <QA to="/bulk-upload" icon={<UploadCloud size={16} />} color="#6b7280" label="Bulk Upload" />}
          </div>
        </div>

        {/* Revenue Trend — area chart */}
        {canViewDashRevenueTrend && (
          <div className="db-card">
            <div className="db-card-hd">
              <div className="db-card-title">
                <span className="db-card-dot" style={{ background: '#10b981' }} />
                Revenue Trend
                <span className="db-count-badge">last 10 months</span>
              </div>
              <Link to="/reports" className="db-view-all">Reports <ArrowRight size={12} /></Link>
            </div>
            {revTrend.length === 0 ? (
              <div className="db-empty" style={{ padding: 24 }}><BarChart2 size={22} style={{ opacity: 0.2 }} /><div>No data yet</div></div>
            ) : (() => {
              const totalRev = revTrend.reduce((s, r) => s + Number(r.revenue || 0), 0);
              return (
                <div className="db-area-wrap">
                  <div className="db-area-hero">
                    <div className="db-area-total">₹{fmtINR(totalRev)}</div>
                    <div className="db-area-sub">Total Revenue</div>
                  </div>
                  <div className="db-area-chart-fill">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={revTrend} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                      <defs>
                        <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} tickFormatter={v => fmtINR(v)} />
                      <Tooltip formatter={v => ['₹' + fmtINR(Number(v)), 'Revenue']} contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', fontSize: 12 }} />
                      <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} fill="url(#revGrad)" dot={false} activeDot={{ r: 4, fill: '#10b981' }} />
                    </AreaChart>
                  </ResponsiveContainer>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Recent Leads */}
        {canViewDashLeads && (
          <div className="db-card">
            <div className="db-card-hd">
              <div className="db-card-title">
                <span className="db-card-dot" style={{ background: '#3b82f6' }} />
                Recent Leads
                {!loading && <span className="db-count-badge">{recentLeads.length} of {leads.length}</span>}
              </div>
              <Link to="/leads" className="db-view-all">View all <ArrowRight size={12} /></Link>
            </div>
            {loading ? <SkeletonList n={5} h={44} /> : recentLeads.length === 0 ? (
              <EmptyState label="No leads yet." cta="Create your first lead →" />
            ) : (
              <div className="db-lead-list">
                {recentLeads.map((lead, i) => {
                  const cfg = getStatusCfg(lead.status);
                  const initials = (lead.name || lead.mobile || '?').charAt(0).toUpperCase();
                  return (
                    <motion.div key={lead.id} className="db-lead-row"
                      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      onClick={() => navigate('/leads', { state: { openLeadId: lead.id } })}
                      style={{ cursor: 'pointer' }}>
                      <div className="db-lead-avatar" style={{ background: cfg.bg, color: cfg.color }}>{initials}</div>
                      <div className="db-lead-info">
                        <div className="db-lead-name">{lead.name || lead.mobile}</div>
                        <div className="db-lead-meta">
                          {lead.name && lead.mobile && <span>{lead.mobile}</span>}
                          {lead.city_name && <><span className="db-sep">·</span><span className="db-meta-tag"><MapPin size={9} />{lead.city_name}</span></>}
                        </div>
                      </div>
                      <div className="db-lead-right">
                        <span className="db-status-pill" style={{ background: cfg.bg, color: cfg.color }}>{lead.status}</span>
                        <div className="db-lead-val">{Number(lead.total_price) > 0 ? '₹' + fmtINR(Number(lead.total_price)) : '—'}</div>
                      </div>
                      <ChevronRight size={13} className="db-chevron" />
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

              ) : id === 'row3' && row3Cols > 0 ? (
      <div className={`db-${row3Cols}col`}>

        {/* Recent Invoices */}
        {canViewRecentInvoices && (
          <div className="db-card">
            <div className="db-card-hd">
              <div className="db-card-title">
                <span className="db-card-dot" style={{ background: '#10b981' }} />
                <FileText size={13} style={{ color: '#10b981' }} />
                Recent Invoices
              </div>
              <Link to="/customer-invoices" className="db-view-all">View all <ArrowRight size={12} /></Link>
            </div>
            {loading || !dashStats?.recent_invoices?.length ? (
              loading ? <SkeletonList n={3} h={44} /> : <div className="db-empty" style={{ padding: 20 }}><FileText size={20} style={{ opacity: 0.2 }} /><div>No invoices yet</div></div>
            ) : (
              <div className="db-inv-list">
                {dashStats.recent_invoices.map((inv, i) => {
                  const total = Number(inv.total || 0);
                  const outstanding = Number(inv.outstanding || 0);
                  const statusKey = inv.status_name || 'generated';
                  const pillCfg = {
                    paid:           { bg: '#dcfce7', color: '#166534', label: 'Paid' },
                    partially_paid: { bg: '#fef3c7', color: '#92400e', label: 'Partial' },
                    approved:       { bg: '#dbeafe', color: '#1e40af', label: 'Approved' },
                    generated:      { bg: '#f3f4f6', color: '#374151', label: 'Pending' },
                  }[statusKey] || { bg: '#f3f4f6', color: '#6b7280', label: statusKey };
                  return (
                    <div key={inv.id} className="db-inv-row"
                      onClick={() => navigate('/customer-invoices', { state: { openId: inv.id } })}>
                      <div className="db-inv-icon"><FileText size={14} style={{ color: '#10b981' }} /></div>
                      <div className="db-inv-info">
                        <div className="db-inv-name">{inv.customer_name || inv.mobile}</div>
                        <div className="db-inv-meta">INV-{String(inv.id).padStart(6, '0')} · {new Date(inv.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>
                      </div>
                      <div className="db-inv-right">
                        <div className="db-inv-amount">₹{fmtINR(total)}</div>
                        <span className="db-status-pill" style={{ background: pillCfg.bg, color: pillCfg.color }}>{pillCfg.label}</span>
                      </div>
                      <button className="db-3dot" onClick={e => e.stopPropagation()}><MoreVertical size={14} /></button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Recent Estimates */}
        {canViewDashEstimates && (
          <div className="db-card">
            <div className="db-card-hd">
              <div className="db-card-title">
                <span className="db-card-dot" style={{ background: '#8b5cf6' }} />
                <ClipboardList size={13} style={{ color: '#8b5cf6' }} />
                Recent Estimates
              </div>
              <Link to="/estimates" className="db-view-all">View all <ArrowRight size={12} /></Link>
            </div>
            {estimates.length === 0 ? (
              <div className="db-empty" style={{ padding: 20 }}><ClipboardList size={20} style={{ opacity: 0.2 }} /><div>No estimates yet</div></div>
            ) : (
              <div className="db-inv-list">
                {estimates.slice(0, 5).map((est, i) => {
                  const statusMap = {
                    draft: { bg: '#f3f4f6', color: '#6b7280', label: 'Pending' },
                    pending_review: { bg: '#fef3c7', color: '#92400e', label: 'Sent' },
                    approved: { bg: '#dcfce7', color: '#166534', label: 'Accepted' },
                    rejected: { bg: '#fee2e2', color: '#991b1b', label: 'Rejected' },
                    sent_to_customer: { bg: '#dbeafe', color: '#1e40af', label: 'Sent' },
                  };
                  const pill = statusMap[est.status] || statusMap.draft;
                  return (
                    <div key={est.id} className="db-inv-row"
                      onClick={() => navigate('/estimates', { state: { openId: est.id } })}>
                      <div className="db-inv-icon"><ClipboardList size={14} style={{ color: '#8b5cf6' }} /></div>
                      <div className="db-inv-info">
                        <div className="db-inv-name">{est.customer_name || est.mobile || `EST-${String(est.id).padStart(6,'0')}`}</div>
                        <div className="db-inv-meta">EST-{String(est.id).padStart(6, '0')} · {est.item_count || 0} items</div>
                      </div>
                      <div className="db-inv-right">
                        <div className="db-inv-amount">{Number(est.grand_total) > 0 ? '₹' + fmtINR(Number(est.grand_total)) : '—'}</div>
                        <span className="db-status-pill" style={{ background: pill.bg, color: pill.color }}>{pill.label}</span>
                      </div>
                      <button className="db-3dot" onClick={e => e.stopPropagation()}><MoreVertical size={14} /></button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Recent Activities */}
        {canViewDashActivities && <div className="db-card">
          <div className="db-card-hd">
            <div className="db-card-title">
              <span className="db-card-dot" style={{ background: '#6b7280' }} />
              <Activity size={13} style={{ color: '#6b7280' }} />
              Recent Activities
            </div>
            <Link to="/reports" className="db-view-all">View all <ArrowRight size={12} /></Link>
          </div>
          {activities.length === 0 ? (
            <div className="db-empty" style={{ padding: 20 }}><Activity size={20} style={{ opacity: 0.2 }} /><div>No activity yet</div></div>
          ) : (
            <div className="db-act-list">
              {activities.slice(0, 6).map((a, i) => {
                const color = activityColor(a.entity);
                const timeAgo = (() => {
                  const diff = Date.now() - new Date(a.created_at).getTime();
                  const mins = Math.floor(diff / 60000);
                  if (mins < 1) return 'Just now';
                  if (mins < 60) return `${mins} min ago`;
                  const hrs = Math.floor(mins / 60);
                  if (hrs < 24) return `${hrs}h ago`;
                  return `${Math.floor(hrs / 24)}d ago`;
                })();
                return (
                  <div key={a.id} className="db-act-row">
                    <div className="db-act-icon" style={{ background: color + '18', color }}>{activityIcon(a.entity)}</div>
                    <div className="db-act-info">
                      <div className="db-act-desc">{a.description || `${a.action} ${a.entity}`}</div>
                      <div className="db-act-meta">{a.user_name}</div>
                    </div>
                    <div className="db-act-time">{timeAgo}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>}
      </div>
              ) : id === 'row4' && row4Cols > 0 ? (
        <div className={`db-${row4Cols}col`}>

          {/* Purchase Invoices */}
          {canViewDashInvoices && (
            <div className="db-card">
              <div className="db-card-hd">
                <div className="db-card-title">
                  <span className="db-card-dot" style={{ background: '#f59e0b' }} />
                  Purchase Invoices
                </div>
                <Link to="/purchase-invoices" className="db-view-all">View all <ArrowRight size={12} /></Link>
              </div>
              {purchaseInvs.length === 0 ? (
                <div className="db-empty" style={{ padding: 20 }}><FileText size={20} style={{ opacity: 0.2 }} /><div>No purchase invoices yet</div></div>
              ) : (
                <div className="db-inv-list">
                  {purchaseInvs.slice(0, 5).map((pi, i) => {
                    const total = Number(pi.grand_total || 0);
                    const due   = total - Number(pi.amount_paid || 0);
                    return (
                      <div key={pi.id} className="db-inv-row" onClick={() => navigate('/purchase-invoices')}>
                        <div className="db-inv-icon"><FileText size={14} style={{ color: '#f59e0b' }} /></div>
                        <div className="db-inv-info">
                          <div className="db-inv-name">{pi.hub_name || `PI #${pi.id}`}</div>
                          <div className="db-inv-meta">PI-{String(pi.id).padStart(6,'0')} · {new Date(pi.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</div>
                        </div>
                        <div className="db-inv-right">
                          <div className="db-inv-amount">₹{fmtINR(total)}</div>
                          <span className="db-status-pill" style={{ background: due > 0 ? '#fef3c7' : '#dcfce7', color: due > 0 ? '#92400e' : '#166534' }}>
                            {due > 0 ? 'Due' : 'Paid'}
                          </span>
                        </div>
                        <button className="db-3dot" onClick={e => e.stopPropagation()}><MoreVertical size={14} /></button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Today's Appointments — Super Admin only */}
          {canViewDashApptList && (
            <div className="db-card">
              <div className="db-card-hd">
                <div className="db-card-title">
                  <span className="db-card-dot" style={{ background: '#3b82f6' }} />
                  <CalendarDays size={13} style={{ color: '#3b82f6' }} />
                  Today's Appointments
                  {todayAppts.length > 0 && <span className="db-count-badge">{todayAppts.length}</span>}
                </div>
                <Link to="/appointments" className="db-view-all">View all <ArrowRight size={12} /></Link>
              </div>
              {todayAppts.length === 0 ? (
                <div className="db-empty" style={{ padding: 20 }}><CalendarDays size={20} style={{ opacity: 0.2 }} /><div>No appointments today</div></div>
              ) : (
                <div className="db-inv-list">
                  {todayAppts.map((a, i) => {
                    const timeStr = a.scheduled_time || '—';
                    const statusKey = (a.status_name || '').toLowerCase().replace(/\s+/g,'');
                    const pillCfg = {
                      scheduled:  { bg:'#dbeafe', color:'#1e40af' },
                      confirmed:  { bg:'#dcfce7', color:'#166534' },
                      completed:  { bg:'#f3f4f6', color:'#374151' },
                      cancelled:  { bg:'#fee2e2', color:'#991b1b' },
                    }[statusKey] || { bg:'#dbeafe', color:'#1e40af' };
                    return (
                      <div key={a.id} className="db-inv-row" onClick={() => navigate('/appointments')}>
                        <div className="db-appt-time-badge">{timeStr}</div>
                        <div className="db-inv-info">
                          <div className="db-inv-name">{a.customer_name || a.mobile || `Appt #${a.id}`}</div>
                          <div className="db-inv-meta">{a.hub_name}{a.vehicle_number ? ` · ${a.vehicle_number}` : ''}</div>
                        </div>
                        <span className="db-status-pill" style={{ background: pillCfg.bg, color: pillCfg.color }}>{a.status_name || 'Scheduled'}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Recent Customers — Super Admin only */}
          {canViewDashCustomers && (
            <div className="db-card">
              <div className="db-card-hd">
                <div className="db-card-title">
                  <span className="db-card-dot" style={{ background: '#06b6d4' }} />
                  Recent Customers
                </div>
                <Link to="/customers" className="db-view-all">View all <ArrowRight size={12} /></Link>
              </div>
              {customers.length === 0 ? (
                <div className="db-empty" style={{ padding: 20 }}><Users size={20} style={{ opacity: 0.2 }} /><div>No customers yet</div></div>
              ) : (
                <div className="db-inv-list">
                  {customers.slice(0, 5).map((c, i) => (
                    <div key={c.mobile || i} className="db-inv-row" onClick={() => navigate('/customers')}>
                      <div className="db-cust-av">{(c.customer_name || c.mobile || '?').charAt(0).toUpperCase()}</div>
                      <div className="db-inv-info">
                        <div className="db-inv-name">{c.customer_name || c.mobile}</div>
                        <div className="db-inv-meta">{c.mobile}{c.city_name ? ` · ${c.city_name}` : ''}</div>
                      </div>
                      <div className="db-inv-right">
                        <div className="db-inv-amount">{c.total_appointments || 0}</div>
                        <div style={{ fontSize:10, color:'var(--text-muted)' }}>appts</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

              ) : id === 'row5' && row5Cols > 0 ? (
        <div className={`db-${row5Cols}col`}>

          {/* Conversion Funnel */}
          {canViewDashFunnel && <div className="db-card">
            <div className="db-card-hd">
              <div className="db-card-title">
                <span className="db-card-dot" style={{ background: '#10b981' }} />
                Conversion Funnel
              </div>
            </div>
            {funnelData.length === 0 ? (
              <div className="db-empty" style={{ padding: 20 }}><Activity size={20} style={{ opacity: 0.2 }} /><div>No data yet</div></div>
            ) : (() => {
              const maxCount = Math.max(...funnelData.map(f => Number(f.count || 0)), 1);
              const colors   = ['#3b82f6','#8b5cf6','#10b981','#f59e0b'];
              return (
                <div className="db-funnel-list">
                  {funnelData.map((f, i) => {
                    const count = Number(f.count || 0);
                    const pct   = Math.max(4, Math.round((count / maxCount) * 100));
                    return (
                      <div key={i} className="db-funnel-row">
                        <div className="db-funnel-label-row">
                          <span className="db-funnel-name">{f.stage}</span>
                          <span className="db-funnel-count">{count}</span>
                        </div>
                        <div className="db-funnel-track">
                          <motion.div className="db-funnel-fill"
                            style={{ background: colors[i % colors.length] }}
                            initial={{ width: 0 }} animate={{ width: pct + '%' }}
                            transition={{ duration: 0.6, delay: i * 0.07 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>}

          {/* Top Services */}
          {canViewDashTopServices && <div className="db-card">
            <div className="db-card-hd">
              <div className="db-card-title">
                <span className="db-card-dot" style={{ background: '#8b5cf6' }} />
                Top Services
                <span className="db-count-badge">by revenue</span>
              </div>
            </div>
            {topServices.length === 0 ? (
              <div className="db-empty" style={{ padding: 20 }}><BarChart2 size={20} style={{ opacity: 0.2 }} /><div>No data yet</div></div>
            ) : (() => {
              const maxRev = Math.max(...topServices.map(s => Number(s.revenue || 0)), 1);
              return (
                <div className="db-topsvc-list">
                  {topServices.slice(0, 6).map((s, i) => {
                    const rev = Number(s.revenue || 0);
                    const pct = Math.max(4, Math.round((rev / maxRev) * 100));
                    return (
                      <div key={i} className="db-topsvc-row">
                        <div className={`db-topsvc-rank db-topsvc-rank--${i+1}`}>{i+1}</div>
                        <div className="db-topsvc-name" title={s.service_name}>{s.service_name}</div>
                        <div className="db-topsvc-bar-wrap">
                          <div className="db-topsvc-track">
                            <motion.div className="db-topsvc-fill"
                              initial={{ width: 0 }} animate={{ width: pct + '%' }}
                              transition={{ duration: 0.6, delay: i * 0.06 }} />
                          </div>
                          <div className="db-topsvc-val">₹{fmtINR(rev)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>}

          {/* Smart Alerts */}
          {canViewDashNotifications && (
            <div className="db-card">
              <div className="db-card-hd">
                <div className="db-card-title">
                  <span className="db-card-dot" style={{ background: '#ef4444' }} />
                  <Bell size={13} style={{ color: '#ef4444' }} />
                  Smart Alerts
                  {notifications.filter(n => !n.is_read).length > 0 && (
                    <span className="db-fu-badge">{notifications.filter(n => !n.is_read).length}</span>
                  )}
                </div>
                {notifications.length > 0 && (
                  <button
                    onClick={async () => {
                      try {
                        await api('/api/notifications', { method: 'DELETE' });
                        setNotifications([]);
                      } catch {}
                    }}
                    style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}
                  >
                    Clear
                  </button>
                )}
              </div>
              {notifications.length === 0 ? (
                <div className="db-empty" style={{ padding: 20 }}><Bell size={20} style={{ opacity: 0.2 }} /><div>No alerts</div></div>
              ) : (
                <div className="db-act-list">
                  {notifications.slice(0, 6).map((n, i) => {
                    const cfg = {
                      overdue_lead:       { bg:'#fee2e2', color:'#dc2626' },
                      high_priority_lead: { bg:'#ffedd5', color:'#ea580c' },
                      missed_followup:    { bg:'#fee2e2', color:'#dc2626' },
                      lead_assigned:      { bg:'#dcfce7', color:'#16a34a' },
                      lead_converted:     { bg:'#dcfce7', color:'#16a34a' },
                      duplicate_lead:     { bg:'#dbeafe', color:'#2563eb' },
                    }[n.type] || { bg:'#dbeafe', color:'#2563eb' };
                    const timeAgo = (() => {
                      const diff = Date.now() - new Date(n.created_at).getTime();
                      const mins = Math.floor(diff / 60000);
                      if (mins < 60) return `${mins}m ago`;
                      const hrs = Math.floor(mins / 60);
                      return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs/24)}d ago`;
                    })();
                    return (
                      <div key={n.id} className={`db-act-row${!n.is_read ? ' db-act-row--unread' : ''}`}
                        onClick={() => n.lead_id && navigate('/leads', { state: { openLeadId: n.lead_id } })}
                        style={{ cursor: n.lead_id ? 'pointer' : 'default' }}>
                        <div className="db-act-icon" style={{ background: cfg.bg, color: cfg.color }}><Bell size={13} /></div>
                        <div className="db-act-info">
                          <div className="db-act-desc">{n.title}</div>
                          <div className="db-act-meta">{n.body}</div>
                        </div>
                        <div className="db-act-time">{timeAgo}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

              ) : id === 'team' && canViewDashTeamPerf ? (
        <div className="db-card">
          <div className="db-card-hd">
            <div className="db-card-title">
              <span className="db-card-dot" style={{ background: '#8b5cf6' }} />
              <Users size={13} style={{ color: '#8b5cf6' }} />
              Team Performance
            </div>
            <select
              className="db-pipeline-filter"
              value={teamPerfFilter}
              onChange={e => setTeamPerfFilter(e.target.value)}
            >
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="all">All Time</option>
            </select>
          </div>

          {teamPerfLoading ? <SkeletonList n={4} h={44} /> : teamPerfData.length === 0 ? (
            <EmptyState label="No team data yet." />
          ) : (
            <div className="db-tp-wrap">
              <table className="db-tp-table">
                <thead>
                  <tr>
                    <th className="db-tp-th db-tp-th--name">Member</th>
                    <th className="db-tp-th">Generated</th>
                    <th className="db-tp-th">Assigned</th>
                    <th className="db-tp-th">Converted</th>
                    <th className="db-tp-th">Conv%</th>
                    <th className="db-tp-th">Follow-ups</th>
                    <th className="db-tp-th">Today FU</th>
                    <th className="db-tp-th">Today Leads</th>
                  </tr>
                </thead>
                <tbody>
                  {teamPerfData.map((u, i) => {
                    const base = Math.max(u.leads_generated, u.leads_assigned, 1);
                    const convPct = base > 0
                      ? Math.round((u.leads_converted / base) * 100) : 0;
                    const initials = (u.user_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
                    const colors = ['#8b5cf6','#3b82f6','#10b981','#f59e0b','#ef4444','#06b6d4'];
                    const color  = colors[i % colors.length];
                    return (
                      <tr key={u.user_id} className="db-tp-row"
                        onClick={() => navigate(`/leads?assigned_to=${u.user_id}`)}>
                        <td className="db-tp-td db-tp-td--name">
                          <div className="db-tp-avatar" style={{ background: color + '20', color }}>{initials}</div>
                          <span className="db-tp-name">{u.user_name}</span>
                        </td>
                        <td className="db-tp-td"><span className="db-tp-num">{u.leads_generated}</span></td>
                        <td className="db-tp-td"><span className="db-tp-num">{u.leads_assigned}</span></td>
                        <td className="db-tp-td"><span className="db-tp-num" style={{ color: '#10b981' }}>{u.leads_converted}</span></td>
                        <td className="db-tp-td">
                          <span className="db-tp-pill" style={{
                            background: convPct >= 50 ? '#dcfce7' : convPct >= 25 ? '#fef3c7' : '#fee2e2',
                            color:      convPct >= 50 ? '#166534' : convPct >= 25 ? '#92400e' : '#991b1b',
                          }}>{convPct}%</span>
                        </td>
                        <td className="db-tp-td"><span className="db-tp-num">{u.followups_total}</span></td>
                        <td className="db-tp-td">
                          <span className="db-tp-num" style={{ color: u.followups_today > 0 ? '#ef4444' : 'inherit' }}>
                            {u.followups_today}
                          </span>
                        </td>
                        <td className="db-tp-td">
                          <span className="db-tp-num" style={{ color: u.today_leads > 0 ? '#3b82f6' : 'inherit' }}>
                            {u.today_leads}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

              ) : id === 'calls' && canViewDashCalls ? (
        <div className="db-1col">
          <div className="db-card">
            <div className="db-card-hd">
              <div className="db-card-title">
                <span className="db-card-dot" style={{ background: '#6d28d9' }} />
                <Phone size={13} style={{ marginRight: 4 }} />
                Today's Call Log
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>12 AM – 12 AM</span>
            </div>

            {callLoading ? (
              <SkeletonList n={3} h={36} />
            ) : !callSummary || callSummary.agents.length === 0 ? (
              /* ── Own count when no team data yet ── */
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <div style={{ fontSize: 40, fontWeight: 800, color: '#6d28d9', lineHeight: 1 }}>
                  {callSummary?.my_count ?? 0}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {(callSummary?.my_count ?? 0) === 0 ? 'No calls logged yet today' : 'calls logged by you today'}
                </div>
              </div>
            ) : (isManager || isSuperAdmin) ? (
              /* ── Manager view: team table ── */
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11 }}>Agent</th>
                      {(callSummary.outcome_names || []).map(name => (
                        <th key={name} style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11 }}>{name}</th>
                      ))}
                      <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 700, color: 'var(--text)', fontSize: 11 }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {callSummary.agents.map(agent => (
                      <tr key={agent.user_id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 8px', fontWeight: 500 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#ede9fe', color: '#6d28d9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                              {agent.agent_name?.charAt(0)?.toUpperCase()}
                            </span>
                            {agent.agent_name}
                          </span>
                        </td>
                        {(callSummary.outcome_names || []).map(name => (
                          <td key={name} style={{ textAlign: 'center', padding: '8px 8px', color: 'var(--text-muted)' }}>
                            {agent.outcomes_breakdown?.[name] ?? 0}
                          </td>
                        ))}
                        <td style={{ textAlign: 'center', padding: '8px 8px', fontWeight: 700, color: '#6d28d9' }}>
                          {agent.total_calls}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border)' }}>
                      <td style={{ padding: '8px 8px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 12 }}>Total</td>
                      {(callSummary.outcome_names || []).map(name => (
                        <td key={name} style={{ textAlign: 'center', padding: '8px 8px', fontWeight: 700, fontSize: 12 }}>
                          {callSummary.agents.reduce((s, a) => s + (a.outcomes_breakdown?.[name] ?? 0), 0)}
                        </td>
                      ))}
                      <td style={{ textAlign: 'center', padding: '8px 8px', fontWeight: 800, color: '#6d28d9', fontSize: 14 }}>
                        {callSummary.agents.reduce((s, a) => s + a.total_calls, 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              /* ── Regular user: own count + breakdown ── */
              <div>
                <div style={{ textAlign: 'center', padding: '16px 0 20px' }}>
                  <div style={{ fontSize: 44, fontWeight: 800, color: '#6d28d9', lineHeight: 1 }}>
                    {callSummary.my_count}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>calls logged today</div>
                </div>
                {callSummary.agents.length > 0 && (() => {
                  const myRow = callSummary.agents.find(a => a.user_id === user?.id);
                  if (!myRow || !myRow.outcomes_breakdown) return null;
                  return (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', paddingBottom: 8 }}>
                      {(callSummary.outcome_names || []).map(name => (
                        <div key={name} style={{ textAlign: 'center', padding: '8px 14px', background: 'var(--bg-soft)', borderRadius: 10, minWidth: 70 }}>
                          <div style={{ fontSize: 20, fontWeight: 700 }}>{myRow.outcomes_breakdown[name] ?? 0}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{name}</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>

              ) : id === 'parts' && canViewDashParts && partsData ? (
        <div className="db-1col">
          <div className="db-card db-parts-card">
            <div className="db-card-hd">
              <div className="db-card-title">
                <span className="db-card-dot" style={{ background: '#f59e0b' }} />
                Parts Catalogue
              </div>
              <Link to="/master/parts" className="db-view-all">Manage <ArrowRight size={12} /></Link>
            </div>
            <div className="db-parts-grid">
              <div className="db-parts-stat"><div className="db-parts-val">{partsData.total}</div><div className="db-parts-label">Total Parts</div></div>
              <div className="db-parts-stat"><div className="db-parts-val" style={{ color:'#10b981' }}>{partsData.activeCount}</div><div className="db-parts-label">Active</div></div>
              <div className="db-parts-stat"><div className="db-parts-val" style={{ color:'#ef4444' }}>{partsData.total - partsData.activeCount}</div><div className="db-parts-label">Inactive</div></div>
              <div className="db-parts-stat"><div className="db-parts-val" style={{ color:'#8b5cf6' }}>{partsData.total > 0 ? Math.round((partsData.activeCount/partsData.total)*100) : 0}%</div><div className="db-parts-label">Active Rate</div></div>
            </div>
          </div>
        </div>
              ) : null}
            </SortableSection>
          ))}
        </SortableContext>
      </DndContext>

    </div>
  );
}

// ── SortableSection ────────────────────────────────────────────────────────────
function SortableSection({ id, activeId, children }) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
    opacity: isDragging ? 0.45 : 1,
    position: 'relative',
  };

  return (
    <div ref={setNodeRef} style={style} className={`db-sortable${isDragging ? ' db-sortable--dragging' : ''}`}>
      <div
        ref={setActivatorNodeRef}
        className="db-drag-handle"
        {...listeners}
        {...attributes}
        title="Drag to reorder"
      >
        <GripVertical size={13} />
      </div>
      {children}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function getGreeting(h) {
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
function getWave(h) {
  if (h < 12) return '☀️';
  if (h < 17) return '🌤️';
  return '🌙';
}
function fmtINR(n) {
  if (n >= 100000) return (n / 100000).toFixed(1).replace(/\.0$/, '') + 'L';
  if (n >= 1000)   return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

// ── Sub-components ────────────────────────────────────────────────────────────
function KpiCard({ icon, color, label, value, sub, sparkData = [], sparkColor, to }) {
  const uid = useId().replace(/:/g, '');
  const gradId = `spark-${uid}`;
  const card = (
    <div className="db-kpi">
      <div className="db-kpi-top">
        <div className="db-kpi-icon" style={{ background: color + '15', color }}>{icon}</div>
        <div className="db-kpi-label">{label}</div>
      </div>
      <div className="db-kpi-body">
        <div>
          <div className="db-kpi-value">{value}</div>
          {sub && <div className="db-kpi-sub">{sub}</div>}
        </div>
        {sparkData.length > 1 && (
          <div className="db-kpi-spark">
            <ResponsiveContainer width="100%" height={52}>
              <AreaChart data={sparkData} margin={{ top: 6, right: 6, left: 6, bottom: 6 }}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={sparkColor} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={sparkColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={sparkColor}
                  strokeWidth={2}
                  fill={`url(#${gradId})`}
                  dot={false}
                  activeDot={{ r: 3, fill: sparkColor }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      <div className="db-kpi-bar" style={{ background: color }} />
    </div>
  );
  return to ? <Link to={to} style={{ textDecoration: 'none', display: 'contents' }}>{card}</Link> : card;
}

function StatChip({ icon, color, label, value, warn = false }) {
  return (
    <div className="db-stat-chip">
      <span style={{ color }}>{icon}</span>
      <span className="db-stat-val-row">
        <span className="db-stat-val" style={warn ? { color: '#ef4444' } : undefined}>{value}</span>
        {warn && <span className="db-stat-warn" title="Needs attention" />}
      </span>
      <span className="db-stat-label">{label}</span>
    </div>
  );
}

function QA({ to, icon, color, label, onClick }) {
  return (
    <Link to={to} className="db-qa" onClick={onClick}>
      <div className="db-qa-icon" style={{ background: color + '15', color }}>{icon}</div>
      <div className="db-qa-label">{label}</div>
    </Link>
  );
}

function SkeletonList({ n, h = 44 }) {
  return (
    <div className="db-skel-wrap">
      {[...Array(n)].map((_, i) => (
        <div key={i} className="db-skel-row" style={{ height: h }} />
      ))}
    </div>
  );
}

function EmptyState({ label, cta }) {
  return (
    <div className="db-empty">
      <div className="db-empty-icon"><Zap size={22} /></div>
      <div>{label}</div>
      {cta && <button className="db-empty-cta" onClick={() => window.dispatchEvent(new Event('open-lead-modal'))}>{cta}</button>}
    </div>
  );
}
