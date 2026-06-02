import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';
import {
  Users, TrendingUp, IndianRupee, ArrowRight, PlusCircle,
  FileText, ChevronRight, MapPin, Car, Calendar, Zap,
  BarChart2, Activity, Clock, UserCheck, Bell, CheckCircle2,
  CalendarDays, AlertCircle, Building2,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
  const [todayEvents,   setTodayEvents]   = useState([]);
  const [eventsDone,    setEventsDone]    = useState({});
  const [fuFilter,      setFuFilter]      = useState('today');
  const [fuLoading,     setFuLoading]     = useState(false);
  const [customFrom,    setCustomFrom]    = useState('');
  const [customTo,      setCustomTo]      = useState('');
  const [showCustom,    setShowCustom]    = useState(false);
  const [fuShowAll,     setFuShowAll]     = useState(false);
  const FU_LIMIT = 5; // rows shown before "View all"

  const isManager    = user?.permissions?.includes('VIEW_TEAM_LEADS') && !user?.is_super_admin;
  const canViewReports = user?.is_super_admin || user?.permissions?.includes('VIEW_REPORTS');

  // Tick clock every minute for live greeting
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    Promise.all([
      canViewReports ? api('/api/reports/summary').catch(() => null) : Promise.resolve(null),
      canViewReports ? api('/api/reports/dashboard').catch(() => null) : Promise.resolve(null),
      api('/api/leads').catch(() => ({ items: [] })),
      api('/api/lead-statuses').catch(() => ({ items: [] })),
      api('/api/lead-events?filter=today').catch(() => ({ items: [] })),
    ]).then(([s, ds, l, sl, ev]) => {
      setStats(s);
      setDashStats(ds);
      setLeads(l.items || []);
      setStatusList(sl.items || []);
      setTodayEvents(ev.items || []);
    }).finally(() => setLoading(false));
  }, []);

  // Re-fetch follow-ups when filter tab changes
  useEffect(() => {
    if (fuFilter === 'custom') return; // custom handled separately on Apply
    setFuLoading(true);
    api(`/api/lead-events?filter=${fuFilter}`)
      .then(ev => setTodayEvents(ev.items || []))
      .catch(() => {})
      .finally(() => setFuLoading(false));
  }, [fuFilter]);

  function applyCustomFilter() {
    if (!customFrom || !customTo) return;
    setFuLoading(true);
    api(`/api/lead-events?filter=custom&date_from=${customFrom}&date_to=${customTo}`)
      .then(ev => setTodayEvents(ev.items || []))
      .catch(() => {})
      .finally(() => setFuLoading(false));
  }

  // Fetch team members for managers
  useEffect(() => {
    if (!isManager) return;
    api('/api/users')
      .then(r => setTeamMembers((r.items || []).filter(u => u.manager_id === user?.id)))
      .catch(console.error);
  }, [isManager, user?.id]);

  // ── Derived metrics ─────────────────────────────────────────────────────────
  const todayStr   = now.toDateString();
  const todayLeads = leads.filter(l => new Date(l.created_at).toDateString() === todayStr).length;
  const pipelineVal = dashStats ? Number(dashStats.pipeline_value || 0) : 0;
  const totalLeads = leads.length;
  const convertedLeads = leads.filter(l => l.status === 'converted').length;
  const myId = Number(user?.id);
  const assignedLeads = leads.filter(l => Number(l.assigned_to) === myId && Number(l.created_by) !== myId).length;
  const convRate   = totalLeads > 0
    ? ((convertedLeads / totalLeads) * 100).toFixed(1)
    : '0.0';

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
      .slice(0, 8);
  }, [statusList, statusCounts]);

  const maxCount   = topStatuses[0]?.count || 1;
  const totalInPipeline = topStatuses.reduce((s, x) => s + x.count, 0);
  const recentLeads = leads.slice(0, 6);

  function getStatusCfg(name) {
    const s = statusList.find(s => s.name === name);
    return s ? { color: s.color, bg: s.bg_color } : { color: '#6b7280', bg: '#f3f4f6' };
  }

  const dateLabel = now.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  async function markEventDone(eventId) {
    try {
      await api(`/api/lead-events/${eventId}/done`, { method: 'PATCH' });
      setEventsDone(prev => ({ ...prev, [eventId]: true }));
    } catch (e) { console.error(e); }
  }

  const visibleEvents = todayEvents.filter(e => !eventsDone[e.id]);

  return (
    <div className="db-wrap">

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <motion.div
        className="db-hero"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="db-hero-bg" />
        <div className="db-hero-content">
          <div className="db-hero-left">
            <div className="db-greeting-row">
              <div className="db-greeting-wave">{getWave(now.getHours())}</div>
              <div>
                <div className="db-greeting">
                  {getGreeting(now.getHours())}, <span className="db-name">{user?.name?.split(' ')[0]}</span>
                </div>
                <div className="db-subtitle">
                  <Clock size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                  {dateLabel}
                </div>
              </div>
            </div>
          </div>
          <div className="db-hero-right">
            <button
              className="db-new-btn"
              onClick={() => window.dispatchEvent(new Event('open-lead-modal'))}
            >
              <PlusCircle size={15} /> New Lead
            </button>
          </div>
        </div>
      </motion.div>

      {/* ── KPI row — real data ───────────────────────────────────────────── */}
      <div className="db-kpi-row">
        <KPI
          index={0}
          icon={<CalendarDays size={19} />}
          color="#3b82f6"
          label="Today's Appointments"
          value={dashStats ? String(dashStats.today_appointments) : '—'}
          loading={loading}
          sub={dashStats ? `${dashStats.month_invoice_count} invoices this month` : null}
          to="/customer-invoices"
        />
        <KPI
          index={1}
          icon={<IndianRupee size={19} />}
          color="#10b981"
          label="Monthly Revenue"
          value={dashStats ? '₹' + fmtINR(Number(dashStats.month_revenue)) : '—'}
          loading={loading}
          sub={dashStats ? `collected this month` : null}
          to="/customer-invoices"
        />
        <KPI
          index={2}
          icon={<AlertCircle size={19} />}
          color="#ef4444"
          label="Pending Invoices"
          value={dashStats ? String(dashStats.pending_invoices) : '—'}
          loading={loading}
          sub={dashStats ? `₹${fmtINR(Number(dashStats.outstanding_amount))} outstanding` : null}
          to="/customer-invoices"
        />
        <KPI
          index={3}
          icon={<TrendingUp size={19} />}
          color="#f59e0b"
          label="Lead Conversion"
          value={dashStats ? (dashStats.lead_conversion?.conversion_rate ?? 0) + '%' : '—'}
          loading={loading}
          sub={dashStats ? `${dashStats.lead_conversion?.converted_leads || 0} of ${dashStats.lead_conversion?.total_leads || 0} leads` : null}
          to="/leads"
        />
      </div>

      {/* ── Secondary stats row ───────────────────────────────────────────── */}
      {!loading && (
        <div className="db-sec-row">
          <div className="db-sec-stat">
            <Users size={13} style={{ color: '#3b82f6' }} />
            <span className="db-sec-val">{totalLeads}</span>
            <span className="db-sec-label">Total Leads</span>
          </div>
          <div className="db-sec-divider" />
          <div className="db-sec-stat">
            <Activity size={13} style={{ color: '#8b5cf6' }} />
            <span className="db-sec-val">{todayLeads}</span>
            <span className="db-sec-label">New Today</span>
          </div>
          <div className="db-sec-divider" />
          <div className="db-sec-stat">
            <IndianRupee size={13} style={{ color: '#f59e0b' }} />
            <span className="db-sec-val">₹{fmtINR(pipelineVal)}</span>
            <span className="db-sec-label">Pipeline Value</span>
          </div>
          {assignedLeads > 0 && (
            <>
              <div className="db-sec-divider" />
              <div className="db-sec-stat">
                <Users size={13} style={{ color: '#10b981' }} />
                <span className="db-sec-val">{assignedLeads}</span>
                <span className="db-sec-label">Assigned to You</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Follow-ups ───────────────────────────────────────────────────── */}
      {!loading && (
        <motion.div
          className={`db-card db-followups${visibleEvents.length > 0 ? ' db-followups--has-items' : ''}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
        >
          {/* Header row */}
          <div className="db-fu-hdr">
            <div className="db-card-title">
              <span className="db-card-dot" style={{ background: visibleEvents.length > 0 ? '#ef4444' : '#9ca3af' }} />
              <Bell size={14} style={{ color: visibleEvents.length > 0 ? '#ef4444' : 'var(--text-muted)' }} />
              Follow-ups
              {visibleEvents.length > 0 && <span className="db-fu-badge">{visibleEvents.length}</span>}
            </div>
            <span className="db-fu-date">
              {now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          </div>

          {/* Filter tab bar */}
          <div className="db-fu-tabbar">
            {[
              { key: 'today',    label: 'Today' },
              { key: 'tomorrow', label: 'Tomorrow' },
              { key: 'week',     label: 'This Week' },
              { key: 'custom',   label: '📅 Custom' },
            ].map(tab => (
              <button
                key={tab.key}
                className={`db-fu-tab${fuFilter === tab.key ? ' db-fu-tab--active' : ''}`}
                onClick={() => { setFuFilter(tab.key); setShowCustom(tab.key === 'custom'); setEventsDone({}); setFuShowAll(false); }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Custom date range picker */}
          {showCustom && (
            <div className="db-fu-custom-row">
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="db-fu-date-input" />
              <span className="db-fu-date-sep">→</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="db-fu-date-input" />
              <button onClick={applyCustomFilter} className="db-fu-apply-btn">Apply</button>
            </div>
          )}

          {fuLoading ? (
            <div className="db-fu-empty" style={{ color: 'var(--text-muted)' }}>
              <Clock size={18} style={{ color: 'var(--text-muted)' }} />
              <span>Loading follow-ups…</span>
            </div>
          ) : visibleEvents.length === 0 ? (
            <div className="db-fu-empty">
              <CheckCircle2 size={20} style={{ color: '#16a34a' }} />
              <span>
                {fuFilter === 'today'    && 'All caught up — no pending follow-ups for today!'}
                {fuFilter === 'tomorrow' && 'No follow-ups scheduled for tomorrow.'}
                {fuFilter === 'week'     && 'No follow-ups for this week.'}
                {fuFilter === 'custom'   && 'No follow-ups found for the selected date range.'}
              </span>
            </div>
          ) : (
            <div className={`db-fu-list${!fuShowAll && visibleEvents.length > FU_LIMIT ? ' db-fu-list--collapsed' : ''}`}>
              {(fuShowAll ? visibleEvents : visibleEvents.slice(0, FU_LIMIT)).map((ev, i) => {
                const cfg = getStatusCfg(ev.lead_current_status);
                const initials = (ev.lead_name || ev.lead_mobile || '?').charAt(0).toUpperCase();
                const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
                const isOverdue = ev.due_date < today;

                const contextMsg = ev.is_team_followup
                  ? `Follow-up reminder for ${ev.assigned_to_name || 'a team member'}'s lead`
                  : ev.assigned_to_name
                  ? `Assigned to: ${ev.assigned_to_name} · Need to follow up this lead`
                  : null;

                return (
                  <motion.div
                    key={ev.id}
                    className="db-fu-row"
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    onClick={(e) => { if (!e.target.closest('button')) navigate('/leads', { state: { openLeadId: ev.lead_id } }); }}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="db-lead-avatar" style={{ background: cfg.bg, color: cfg.color, borderRadius: 10 }}>
                      {initials}
                    </div>
                    <div className="db-lead-info">
                      <div className="db-lead-name">
                        <span className="db-lead-name-text">{ev.lead_name || ev.lead_mobile}</span>
                        {isOverdue && <span className="db-fu-overdue-tag">Overdue</span>}
                      </div>
                      <div className="db-lead-meta">
                        {ev.lead_name && <><span>{ev.lead_mobile}</span><span className="db-sep">·</span></>}
                        <span className="db-meta-note">{ev.note}</span>
                        {isOverdue && (
                          <><span className="db-sep">·</span>
                          <span className="db-due-date">
                            Due {new Date(ev.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                          </span></>
                        )}
                      </div>
                      {contextMsg && (
                        <div className="db-context-msg" style={{ color: ev.is_team_followup ? '#7c3aed' : 'var(--text-muted)' }}>
                          {contextMsg}
                        </div>
                      )}
                    </div>
                    <div className="db-fu-actions">
                      <span className="db-status-pill" style={{ background: cfg.bg, color: cfg.color }}>
                        {ev.lead_current_status || 'New Lead'}
                      </span>
                      <button
                        className="db-fu-done-btn"
                        onClick={() => markEventDone(ev.id)}
                        title="Mark as done"
                      >
                        <CheckCircle2 size={13} /> Done
                      </button>
                    </div>
                  </motion.div>
                );
              })}

              {/* ── View all / Collapse footer ── */}
              {visibleEvents.length > FU_LIMIT && (
                <button
                  className={`db-fu-viewall${fuShowAll ? ' db-fu-viewall--open' : ''}`}
                  onClick={() => setFuShowAll(s => !s)}
                >
                  {fuShowAll
                    ? 'Show less'
                    : `View all ${visibleEvents.length} follow-ups`}
                  <ChevronRight size={13} className="db-fu-viewall-icon" />
                </button>
              )}
            </div>
          )}
        </motion.div>
      )}

      {/* ── Main grid ─────────────────────────────────────────────────────── */}
      <div className="db-grid">

        {/* ── Left: Recent Leads ── */}
        <div className="db-card db-recent">
          <div className="db-card-hd">
            <div className="db-card-title">
              <span className="db-card-dot" style={{ background: '#3b82f6' }} />
              Recent Leads
              {!loading && <span className="db-count-badge">{recentLeads.length} of {leads.length}</span>}
            </div>
            <Link to="/leads" className="db-view-all">
              View all <ArrowRight size={13} />
            </Link>
          </div>

          {loading ? (
            <SkeletonList n={5} h={52} />
          ) : recentLeads.length === 0 ? (
            <EmptyState label="No leads yet." cta="Create your first lead →" />
          ) : (
            <div className="db-lead-list">
              {recentLeads.map((lead, i) => {
                const cfg = getStatusCfg(lead.status);
                const initials = (lead.name || lead.mobile || '?').charAt(0).toUpperCase();
                return (
                  <motion.div
                    key={lead.id}
                    className="db-lead-row"
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    onClick={() => navigate('/leads', { state: { openLeadId: lead.id } })}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="db-lead-avatar" style={{ background: cfg.bg, color: cfg.color }}>
                      {initials}
                    </div>
                    <div className="db-lead-info">
                      <div className="db-lead-name">{lead.name || lead.mobile}</div>
                      <div className="db-lead-meta">
                        {lead.name && lead.mobile && <span>{lead.mobile}</span>}
                        {(lead.make_name || lead.model_name) && (
                          <>
                            <span className="db-sep">·</span>
                            <span className="db-meta-tag">
                              <Car size={9} /> {[lead.make_name, lead.model_name].filter(Boolean).join(' ')}
                            </span>
                          </>
                        )}
                        {lead.city_name && (
                          <>
                            <span className="db-sep">·</span>
                            <span className="db-meta-tag"><MapPin size={9} /> {lead.city_name}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="db-lead-right">
                      <span className="db-status-pill" style={{ background: cfg.bg, color: cfg.color }}>
                        {lead.status}
                      </span>
                      <div className="db-lead-val">
                        {Number(lead.total_price) > 0 ? '₹' + fmtINR(Number(lead.total_price)) : '—'}
                      </div>
                      <div className="db-lead-date">
                        {new Date(lead.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                      </div>
                    </div>
                    <ChevronRight size={14} className="db-chevron" />
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Right column ── */}
        <div className="db-right-col">

          {/* Pipeline */}
          <div className="db-card db-pipeline">
            <div className="db-card-hd">
              <div className="db-card-title">
                <span className="db-card-dot" style={{ background: '#8b5cf6' }} />
                Lead Pipeline
              </div>
              {!loading && (
                <span className="db-count-badge">{totalInPipeline} leads</span>
              )}
            </div>

            {loading ? (
              <SkeletonList n={5} h={28} />
            ) : topStatuses.length === 0 ? (
              <EmptyState label="No leads yet." />
            ) : (
              <div className="db-pipeline-list">
                {topStatuses.map((s, i) => {
                  const pct = Math.round((s.count / totalInPipeline) * 100);
                  return (
                    <Link key={s.id} to="/leads" className="db-pipeline-row">
                      <div className="db-pipeline-label">
                        <span className="db-pipeline-dot" style={{ background: s.color }} />
                        <span className="db-pipeline-name">{s.name}</span>
                      </div>
                      <div className="db-pipeline-track">
                        <motion.div
                          className="db-pipeline-fill"
                          style={{ background: s.color + '28' }}
                          initial={{ width: 0 }}
                          animate={{ width: `${(s.count / maxCount) * 100}%` }}
                          transition={{ duration: 0.65, delay: 0.05 * i, ease: 'easeOut' }}
                        >
                          <div className="db-pipeline-inner" style={{ background: s.color }} />
                        </motion.div>
                      </div>
                      <div className="db-pipeline-right">
                        <span className="db-pipeline-count" style={{ color: s.color }}>{s.count}</span>
                        <span className="db-pipeline-pct">{pct}%</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Hub Performance */}
          <div className="db-card db-hubs">
            <div className="db-card-hd">
              <div className="db-card-title">
                <span className="db-card-dot" style={{ background: '#0ea5e9' }} />
                <Building2 size={14} style={{ color: '#0ea5e9' }} />
                Hub Performance
                <span className="db-count-badge">this month</span>
              </div>
              <Link to="/appointments" className="db-view-all">
                Appointments <ArrowRight size={13} />
              </Link>
            </div>
            {loading ? (
              <SkeletonList n={4} h={32} />
            ) : !dashStats?.hub_performance?.length ? (
              <div className="db-empty" style={{ padding: '20px' }}>
                <Building2 size={20} style={{ opacity: 0.25 }} />
                <div>No hub data yet</div>
              </div>
            ) : (
              <div className="db-hub-list">
                {(() => {
                  const hubs = dashStats.hub_performance;
                  const maxApts = Math.max(...hubs.map(h => h.appointment_count), 1);
                  return hubs.map((h, i) => (
                    <motion.div
                      key={h.hub_name}
                      className="db-hub-row"
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06 }}
                    >
                      <div className="db-hub-name">{h.hub_name}</div>
                      <div className="db-hub-track">
                        <motion.div
                          className="db-hub-fill"
                          initial={{ width: 0 }}
                          animate={{ width: `${(h.appointment_count / maxApts) * 100}%` }}
                          transition={{ duration: 0.6, delay: 0.05 * i, ease: 'easeOut' }}
                        />
                      </div>
                      <div className="db-hub-right">
                        <span className="db-hub-count">{h.appointment_count}</span>
                        {Number(h.total_value) > 0 && (
                          <span className="db-hub-val">₹{fmtINR(Number(h.total_value))}</span>
                        )}
                      </div>
                    </motion.div>
                  ));
                })()}
              </div>
            )}
          </div>

          {/* My Team — managers only */}
          {isManager && (
            <div className="db-card db-team">
              <div className="db-card-hd">
                <div className="db-card-title">
                  <span className="db-card-dot" style={{ background: '#f59e0b' }} />
                  My Team
                  {teamMembers.length > 0 && <span className="db-count-badge">{teamMembers.length} member{teamMembers.length !== 1 ? 's' : ''}</span>}
                </div>
                <Link to="/users" className="db-view-all">
                  Manage <ArrowRight size={13} />
                </Link>
              </div>

              {teamMembers.length === 0 ? (
                <div className="db-empty" style={{ padding: '24px 20px' }}>
                  <div className="db-empty-icon"><UserCheck size={20} /></div>
                  <div>No team members assigned yet.</div>
                  <Link to="/users" style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>
                    Go to Users →
                  </Link>
                </div>
              ) : (
                <div className="db-team-list">
                  {teamMembers.map((member, i) => {
                    const memberLeads = leads.filter(l => l.created_by_id === member.id);
                    const initials = member.name.trim().split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
                    return (
                      <motion.div
                        key={member.id}
                        className="db-team-row"
                        initial={{ opacity: 0, x: 8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                      >
                        <div className={`db-team-avatar ${!member.is_active ? 'db-team-avatar--inactive' : ''}`}>
                          {initials}
                        </div>
                        <div className="db-team-info">
                          <div className="db-team-name">
                            {member.name}
                            {!member.is_active && <span className="db-team-inactive-pill">inactive</span>}
                          </div>
                          <div className="db-team-email">{member.email}</div>
                        </div>
                        <div className="db-team-right">
                          <div className="db-team-leads">{memberLeads.length}</div>
                          <div className="db-team-leads-label">lead{memberLeads.length !== 1 ? 's' : ''}</div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Quick Actions */}
          <div className="db-card db-actions">
            <div className="db-card-hd">
              <div className="db-card-title">
                <span className="db-card-dot" style={{ background: '#f59e0b' }} />
                Quick Actions
              </div>
            </div>
            <div className="db-action-grid">
              <QA to="/leads"          icon={<Users size={17} />}         color="#3b82f6" label="All Leads"      sub="Browse pipeline"  />
              <QA to="/appointments"   icon={<CalendarDays size={17} />}  color="#0ea5e9" label="Appointments"   sub="Schedule & track" />
              <QA to="/customer-invoices" icon={<FileText size={17} />}    color="#10b981" label="Invoices"       sub="Billing & payments" />
              <QA to="/reports"        icon={<BarChart2 size={17} />}     color="#8b5cf6" label="Reports"        sub="View analytics"   />
            </div>
          </div>

        </div>
      </div>

      {/* ── Recent Invoices ────────────────────────────────────────────────── */}
      {!loading && dashStats?.recent_invoices?.length > 0 && (
        <motion.div
          className="db-card db-recent-inv"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.2 }}
        >
          <div className="db-card-hd">
            <div className="db-card-title">
              <span className="db-card-dot" style={{ background: '#10b981' }} />
              <FileText size={14} style={{ color: '#10b981' }} />
              Recent Invoices
            </div>
            <Link to="/customer-invoices" className="db-view-all">
              View all <ArrowRight size={13} />
            </Link>
          </div>
          <div className="db-rinv-list">
            {dashStats.recent_invoices.map((inv, i) => {
              const paid    = Number(inv.amount_paid || 0);
              const total   = Number(inv.total || 0);
              const outstanding = Number(inv.outstanding || 0);
              const paidPct = total > 0 ? Math.min(100, Math.round(paid / total * 100)) : 0;
              const isFullyPaid = outstanding <= 0 && total > 0;
              return (
                <motion.div
                  key={inv.id}
                  className="db-rinv-row"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => navigate('/customer-invoices', { state: { openId: inv.id } })}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="db-rinv-avatar">
                    {(inv.customer_name || inv.mobile || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="db-rinv-info">
                    <div className="db-rinv-name">{inv.customer_name || inv.mobile}</div>
                    <div className="db-rinv-meta">
                      {inv.customer_name && <span>{inv.mobile}</span>}
                      <span className="db-sep">·</span>
                      <span>{new Date(inv.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                    </div>
                  </div>
                  <div className="db-rinv-bar-wrap">
                    <div className="db-rinv-track">
                      <div className="db-rinv-fill" style={{ width: paidPct + '%', background: isFullyPaid ? '#10b981' : '#f59e0b' }} />
                    </div>
                    <span className="db-rinv-pct">{paidPct}%</span>
                  </div>
                  <div className="db-rinv-right">
                    <div className="db-rinv-total">₹{fmtINR(total)}</div>
                    {outstanding > 0 && (
                      <div className="db-rinv-out">₹{fmtINR(outstanding)} due</div>
                    )}
                  </div>
                  {inv.status_name && (() => {
                    const CI_STATUS = {
                      paid:           { bg: '#dcfce7', color: '#166534', label: 'Paid' },
                      partially_paid: { bg: '#fef3c7', color: '#92400e', label: 'Partial' },
                      approved:       { bg: '#dbeafe', color: '#1e40af', label: 'Approved' },
                      generated:      { bg: '#f3f4f6', color: '#374151', label: 'Generated' },
                    };
                    const s = CI_STATUS[inv.status_name] || { bg: '#f3f4f6', color: '#6b7280', label: inv.status_name };
                    return (
                      <span className="db-status-pill" style={{ background: s.bg, color: s.color, flexShrink: 0 }}>
                        {s.label}
                      </span>
                    );
                  })()}
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}
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
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

// ── Sub-components ────────────────────────────────────────────────────────────
function KPI({ icon, color, label, value, loading, index, sub, to }) {
  const card = (
    <motion.div
      className={`db-kpi${to ? ' db-kpi--link' : ''}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.06 * index }}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      style={{ '--kpi-color': color }}
    >
      <div className="db-kpi-top">
        <div className="db-kpi-icon" style={{ background: color + '18', color }}>{icon}</div>
        <div className="db-kpi-label">{label}</div>
      </div>
      {loading
        ? <div className="db-kpi-skel" />
        : <>
            <div className="db-kpi-value">{value}</div>
            {sub && <div className="db-kpi-sub">{sub}</div>}
          </>
      }
      <div className="db-kpi-bar" style={{ background: color }} />
    </motion.div>
  );
  return to
    ? <Link to={to} style={{ textDecoration: 'none', display: 'contents' }}>{card}</Link>
    : card;
}

function QA({ to, icon, color, label, sub }) {
  return (
    <Link to={to} className="db-qa">
      <div className="db-qa-icon" style={{ background: color + '15', color }}>{icon}</div>
      <div className="db-qa-body">
        <div className="db-qa-label">{label}</div>
        <div className="db-qa-sub">{sub}</div>
      </div>
      <ChevronRight size={14} className="db-qa-arr" />
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
      {cta && (
        <button className="db-empty-cta" onClick={() => window.dispatchEvent(new Event('open-lead-modal'))}>
          {cta}
        </button>
      )}
    </div>
  );
}

