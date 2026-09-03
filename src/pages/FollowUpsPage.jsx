/**
 * FollowUpsPage — the follow-up queue as a screen you go TO.
 *
 * ── Why this exists as a page ──────────────────────────────────────────────
 *
 * This was a drawer inside LeadsPage: no URL, no back button, and unreachable
 * without first navigating to Leads. For a list somebody opens every morning
 * and works down, that is the wrong shape. As a route it can be bookmarked,
 * linked from a notification, and returned to with the browser's back button.
 *
 * ── Why it is a TABLE and not cards ────────────────────────────────────────
 *
 * It shipped as a list of cards, which made it the only work queue in the app
 * that did not look like the others. Estimates, Appointments and both invoice
 * lists share styles/listLayout.css: full-bleed table, one toolbar row, sticky
 * header, no card wrapper. A screen people move between all day should not
 * change its rules on the way. So this page opts into the same layout — the
 * `lb-*` classes below are that stylesheet, not local inventions.
 *
 * The title block went with it, deliberately. The top bar already renders
 * "Home › Follow-ups"; an <h1> underneath said it twice. The count moved to
 * .lb-count on the right of the toolbar, where every other list keeps it.
 *
 * ── What it borrows, and why it borrows rather than copies ─────────────────
 *
 * The status control is LeadsPage's own StatusInlineSelect, imported. Picking a
 * status is NOT a save: four flags on lead_statuses intercept it —
 * converts_to_appointment opens the booking form, and logs_call /
 * needs_follow_up / needs_lost_reason open StatusActionModal to collect what
 * the API will demand. A <select> written for this page would send a bare
 * PATCH that the server rejects for most of the statuses people actually pick,
 * and the two screens would then disagree about what changing a status means.
 * ConvertToAppointmentModal comes with it, hosted at page level for the same
 * reason LeadsPage hosts it there — see the note on Row below.
 *
 * The lead itself still opens on the Leads page. ViewLeadModal is not exported
 * and takes nine props wired to that page's edit, convert and toast machinery;
 * reproducing it here would be a second copy of the hardest part of Leads.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUp, CheckCircle2, Clock, ExternalLink, RefreshCw, Users,
} from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth, useCan } from '../auth/AuthContext.jsx';
import { StatusInlineSelect, ConvertToAppointmentModal } from './LeadsPage.jsx';
import '../styles/listLayout.css';
import '../styles/FollowUpsPage.css';

/* Overdue is its own tab rather than a red block at the top of Today.
   Today used to run `due_date <= today` on the server, so a follow-up three
   weeks late sat in a list labelled Today and there was no way to ask "what is
   actually due today". The two are now disjoint on the server (overdue ends
   YESTERDAY), so the counts add up and neither tab double-counts a row. */
const FILTERS = [
  { key: 'overdue',  label: 'Overdue' },
  { key: 'today',    label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'week',     label: 'This Week' },
  { key: 'custom',   label: 'Custom' },
];

const LS_KEY = 'sp_followups_v1';

function readState() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}

/* Local calendar day, built from parts.
   `new Date().toISOString().slice(0,10)` is UTC, and in IST that is the
   PREVIOUS day until 05:30 — every morning, exactly when this screen is used,
   it would call today's follow-ups overdue. */
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const AVATAR_TINTS = [
  { bg: '#fef3c7', color: '#92400e' }, { bg: '#dbeafe', color: '#1e40af' },
  { bg: '#dcfce7', color: '#166534' }, { bg: '#f3e8ff', color: '#6b21a8' },
  { bg: '#e0f2fe', color: '#075985' }, { bg: '#fee2e2', color: '#b91c1c' },
];
/* Stable per lead, so the same customer keeps the same colour between visits.
   Random would repaint the list on every refresh for no information. */
function tintFor(id) {
  return AVATAR_TINTS[Math.abs(Number(id) || 0) % AVATAR_TINTS.length];
}

function fmtTime(ev) {
  if (!ev.due_at) return null;
  const d = new Date(ev.due_at);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtDay(ymd) {
  if (!ymd) return '—';
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  if (!y) return '—';
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function fmtYear(ymd) {
  const y = Number(String(ymd).slice(0, 4));
  return y || null;
}

function daysBetween(fromYmd, toYmd) {
  const a = String(fromYmd).slice(0, 10).split('-').map(Number);
  const b = String(toYmd).slice(0, 10).split('-').map(Number);
  if (!a[0] || !b[0]) return 0;
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

function statusStyle(name, statusList) {
  const s = statusList.find(x => x.name === name);
  return { background: s?.bg_color || '#f1f5f9', color: s?.color || '#475569' };
}

/* ── Row ──────────────────────────────────────────────────────────────────────
   MODULE SCOPE, and that is load-bearing rather than tidiness.

   It used to be declared inside FollowUpsPage. A component declared inside
   another is a NEW component type on every render of the parent, so React
   unmounts and remounts the whole subtree each time — harmless while a row was
   just text, fatal now that a row contains StatusInlineSelect. Any parent
   re-render (marking something done sets busyId, which re-renders) would tear
   down an open dropdown, and a half-filled "Mark as Lost" dialog with it.

   The convert modal is hoisted a step further, to the page, for the same
   reason one level up — the list re-rendering underneath must not close a form
   somebody is typing into. LeadsPage does exactly this and says so. */
function Row({
  ev, statusList, today, busyId, canEditLead,
  onDone, onOpenLead, onStatusChanged, onOpenConvert,
}) {
  const tint    = tintFor(ev.lead_id);
  const initial = (ev.lead_name || ev.lead_mobile || '?').charAt(0).toUpperCase();
  const time    = fmtTime(ev);
  const late    = ev._overdue ? daysBetween(ev.due_date, today) : 0;
  const year    = fmtYear(ev.due_date);
  const thisYear = new Date().getFullYear();

  return (
    /* Not a click target. The whole row used to navigate, which meant a click
       on the note — or, once it arrived, on the status dropdown — threw you off
       the screen. Opening the lead is its own button in the last column. */
    <tr className={ev._overdue ? 'fu-tr--overdue' : undefined}>
      <td>
        <div className="fu-due">
          {fmtDay(ev.due_date)}
          {/* The year only when it is not this one. On a list that is almost
              entirely the last few weeks, printing 2026 on every row is noise
              that hides the one row from last December. */}
          {year && year !== thisYear && <span className="fu-due-yr"> {year}</span>}
        </div>
        {time && <div className="fu-sub"><Clock size={10} /> {time}</div>}
        {ev._overdue && (
          <span className="fu-od">
            {late > 0 ? `${late} day${late > 1 ? 's' : ''} late` : 'Overdue'}
          </span>
        )}
      </td>

      <td>
        <div className="fu-cust">
          <span className="fu-avatar" style={{ background: tint.bg, color: tint.color }}>
            {initial}
          </span>
          <div className="fu-cust-txt">
            <div className="fu-name">{ev.lead_name || ev.lead_mobile}</div>
            {ev.lead_name && <div className="fu-sub">{ev.lead_mobile}</div>}
          </div>
        </div>
      </td>

      <td className="fu-td-status">
        {canEditLead ? (
          /* Handles the locked case itself, as a badge with a padlock — so
             there is no second rule here about when a status may change. */
          <StatusInlineSelect
            leadId={ev.lead_id}
            leadName={ev.lead_name || ev.lead_mobile}
            current={ev.lead_current_status}
            statusList={statusList}
            onOpenConvert={onOpenConvert}
            onChange={lead => onStatusChanged(ev, lead)}
          />
        ) : (
          <span className="fu-pill" style={statusStyle(ev.lead_current_status, statusList)}>
            {ev.lead_current_status || '—'}
          </span>
        )}
      </td>

      <td>
        {ev.assigned_to_name
          ? <div className="fu-owner">{ev.assigned_to_name}</div>
          : <span className="fu-dash">Unassigned</span>}
        {/* Somebody else's lead, showing here because you manage them. Worth
            one chip: it changes whether you act on it or chase the person. */}
        {ev.is_team_followup && (
          <span className="fu-team"><Users size={9} /> Team</span>
        )}
      </td>

      <td>
        {ev.note
          ? <div className="fu-note" title={ev.note}>{ev.note}</div>
          : <span className="fu-dash">—</span>}
      </td>

      <td className="fu-td-act">
        <div className="fu-acts">
          {!ev._locked ? (
            <button
              className="fu-btn fu-btn--done"
              disabled={busyId === ev.id}
              onClick={() => onDone(ev)}
            >
              <CheckCircle2 size={12} /> {busyId === ev.id ? 'Saving…' : 'Done'}
            </button>
          ) : (
            /* Converted or closed. There is nothing to complete, and a Done
               button that quietly does nothing is worse than none. */
            <span className="fu-noact">no action</span>
          )}
          {/* A lead with no public_token has no URL — /leads/:token resolves
              through public_token alone, so there is nothing to navigate to.
              Migration 165 backfilled every lead, so this should never fire; it
              says why rather than opening a page with nothing on it. */}
          <button
            className="fu-btn fu-btn--open"
            disabled={!ev.lead_token}
            title={ev.lead_token ? 'Open this lead' : 'This lead has no shareable link yet'}
            onClick={() => onOpenLead(ev)}
          >
            <ExternalLink size={11} /> Open Lead
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function FollowUpsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  /* One hook for both halves of the backend's rule. listEvents scopes as
     `is_super_admin || permissions.has('VIEW_TEAM_LEADS')` → everyone / the
     team, and otherwise → own only; useCan returns true for a super admin
     unconditionally (AuthContext), so this single check is the same test and
     cannot drift from it.

     The picker was drawn for everybody. An ordinary agent got a dropdown listing
     every colleague which could only ever return their own rows or an empty
     list — it looked broken, and it named people they have no other reason to
     see. */
  const canSeeOthers = useCan('VIEW_TEAM_LEADS');
  /* PATCH /api/leads/:id needs EDIT_LEAD, but this page opens on a wider set of
     permissions (canFollowUp in lead_events.routes.js). Without this gate a
     read-only user would get a dropdown whose every choice 403s. */
  const canEditLead  = useCan('EDIT_LEAD');

  const ls = readState();

  const [filter, setFilter]   = useState(ls.filter || 'today');
  const [from, setFrom]       = useState(ls.from || '');
  const [to, setTo]           = useState(ls.to || '');
  const [agent, setAgent]     = useState(canSeeOthers ? (ls.agent || '') : '');
  const [events, setEvents]   = useState([]);
  /* null until the first fetch lands, so a tab shows NO badge rather than a
     confident 0 it has not checked. */
  const [counts, setCounts]   = useState(null);
  const [statusList, setStatusList] = useState([]);
  const [agents, setAgents]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId]   = useState(null);
  const [error, setError]     = useState('');
  /* Hosted here, not in the row, so the list re-rendering underneath cannot
     close a booking form somebody is halfway through. */
  const [convertModal, setConvertModal] = useState(null);
  /* Rows the user has just actioned. Removed from the list immediately rather
     than by refetching: the row is gone the instant they click, and a refetch
     over a list somebody is working down would move everything under them. */
  const [dismissed, setDismissed] = useState({});

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ filter, from, to, agent })); } catch { /* private mode */ }
  }, [filter, from, to, agent]);

  useEffect(() => {
    api('/api/lead-statuses').catch(() => ({ items: [] })).then(s => setStatusList(s.items || []));
  }, []);

  /* Only fetched for somebody who may filter by it. It is a list of the team's
     names; an agent who cannot use the picker has no reason to receive it. */
  useEffect(() => {
    if (!canSeeOthers) { setAgents([]); return; }
    api('/api/users/assignable').catch(() => ({ items: [] })).then(u => setAgents(u.items || []));
  }, [canSeeOthers]);

  const load = useCallback(async ({ background = false } = {}) => {
    // Custom with only one date is not a range — asking for it returns whatever
    // the server makes of a half-open window, which is not what was meant.
    if (filter === 'custom' && !(from && to)) { setEvents([]); setLoading(false); return; }
    // A background reload leaves the rows on screen. Blanking a list to
    // skeletons after somebody changed one status reads as the page breaking.
    if (!background) setLoading(true);
    setError('');
    const qs = filter === 'custom'
      ? `filter=custom&date_from=${from}&date_to=${to}`
      : `filter=${filter}`;
    try {
      const r = await api(`/api/lead-events?${qs}`);
      setEvents(r.items || []);
      setDismissed({});
    } catch (e) {
      setError(e.message || 'Could not load follow-ups.');
    } finally {
      setLoading(false);
    }
  }, [filter, from, to]);

  /* The badges. One request for all four tabs, and NOT derived from the rows on
     screen — this list only ever holds the tab you are looking at, so a count
     for Tomorrow could never be computed from it.

     agent_id goes to the server as well as filtering the rows here, or the
     badge would count the whole team while the list under it showed one
     person's. Failing quietly on purpose: a badge is a convenience, and losing
     it must not put an error banner over a list that loaded fine. */
  const loadCounts = useCallback(() => {
    const qs = agent ? `?agent_id=${encodeURIComponent(agent)}` : '';
    api(`/api/lead-events/tab-counts${qs}`)
      .then(r => setCounts(r.counts || null))
      .catch(() => { /* leave the badges as they were */ });
  }, [agent]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  const markDone = useCallback(async (ev) => {
    setBusyId(ev.id);
    try {
      await api(`/api/lead-events/${ev.id}/done`, { method: 'PATCH' });
      setDismissed(d => ({ ...d, [ev.id]: true }));
      // The row left the list; every badge that counted it is now one too high.
      loadCounts();
    } catch (e) {
      setError(e.message || 'Could not mark it done.');
    } finally {
      setBusyId(null);
    }
  }, [loadCounts]);

  const openLead = useCallback((ev) => {
    /* By TOKEN. /leads/:token resolves through
       `SELECT id FROM leads WHERE public_token = $1`, so the lead_id this page
       used to send never matched anything — you landed on Leads with nothing
       open. lead_token is public_token, added to the follow-ups SELECT. */
    if (ev.lead_token) navigate(`/leads/${ev.lead_token}`);
  }, [navigate]);

  /* A status change ALWAYS ends the open follow-up, server-side:
     leads.controller.js closes every open lead_event on any status change
     (auto_closed = TRUE), or replaces it when the new status asked for a date.
     So the row goes immediately — that is the truth, not optimism.

     Then a quiet refetch, because the replacement follow-up may be due today
     and therefore belongs on this list. Only a reload can know that; a local
     patch can remove a row but cannot invent one. */
  const handleStatusChanged = useCallback((ev) => {
    setDismissed(d => ({ ...d, [ev.id]: true }));
    load({ background: true });
    /* A status change can move a follow-up between tabs, not just off this one
       — pick a status that asks for a date and the replacement lands wherever
       that date falls. So all four badges are re-read, not decremented. */
    loadCounts();
  }, [load, loadCounts]);

  const today = todayLocal();

  /* ONE list, in the server's order (due_date ASC).

     The old page split it into an Overdue block and a Today block with their
     own headers. That made sense when Today's query also returned overdue rows
     and they had to be told apart. Overdue is its own tab now, so a header
     saying "Overdue" above a tab saying "Overdue" is the same word twice, and
     on every other tab the block was always empty. The per-row "5 days late"
     chip carries what is left of the distinction. */
  const rows = useMemo(() => {
    return events
      .filter(e => !dismissed[e.id])
      /* lead_assigned_to_id, NOT assigned_to_id — the SELECT aliases it that way
         (lead_events.controller.js). The shorter name reads correctly and
         matches nothing, so the filter would have silently emptied the list for
         every agent. */
      .filter(e => !agent || String(e.lead_assigned_to_id) === String(agent))
      .map(e => {
        const cfg = statusList.find(x => x.name === e.lead_current_status);
        /* A lead that converted or closed is not waiting on anybody, so its
           follow-up cannot be late. Read off the FLAGS, not the status name —
           an admin renaming "Appointment Scheduled" must not turn every
           converted lead red. Same rule as the drawer this replaces. */
        const locked = !!cfg?.is_locked || !!cfg?.converts_to_appointment || !!cfg?.is_closed;
        const isOverdue = !!e.due_date && String(e.due_date).slice(0, 10) < today && !locked;
        return { ...e, _locked: locked, _overdue: isOverdue };
      });
  }, [events, dismissed, agent, statusList, today]);

  const rowProps = {
    statusList, today, busyId, canEditLead,
    onDone: markDone,
    onOpenLead: openLead,
    onStatusChanged: handleStatusChanged,
    onOpenConvert: setConvertModal,
  };

  const needsRange = filter === 'custom' && !(from && to);
  const filtered   = !!agent || filter !== 'today';

  return (
    /* lb-page cancels the app wrapper's padding and max-width so the table runs
       edge to edge, exactly as on Estimates, Appointments and both invoice
       lists. There is no in-page detail view to exempt — a lead opens on its
       own page — so it applies always. */
    <div className="fu-page lb-page">
      {/* Page level, like LeadsPage. saveFn is StatusInlineSelect's own save —
          the control hands it over so the booking form can complete the status
          change it interrupted. */}
      {convertModal && (
        <ConvertToAppointmentModal
          statusName={convertModal.statusName}
          leadId={convertModal.leadId}
          leadName={convertModal.leadName}
          onConfirm={data => {
            const { saveFn, statusName } = convertModal;
            setConvertModal(null);
            saveFn(statusName, null, data);
          }}
          onCancel={() => setConvertModal(null)}
        />
      )}

      {error && <div className="banner error">{error}</div>}

      {/* ── Toolbar ──
          No card: filters sit directly on the page background, one row, actions
          pushed right. Shared with Estimates and the invoice lists — see
          styles/listLayout.css. */}
      <div className="lb-toolbar">
        {FILTERS.map(f => {
          /* Custom is whatever range the user types, so there is nothing to
             count until they type it — and `n != null` rather than a truthy
             test, so a genuine 0 still prints. "Overdue 0" is the single most
             useful number on this screen. */
          const n = counts?.[f.key];
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              className={`lb-control fu-chip${filter === f.key ? ' fu-chip--on' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {n != null && (
                <span className={`fu-n${f.key === 'overdue' && n > 0 ? ' fu-n--alert' : ''}`}>
                  {n}
                </span>
              )}
            </button>
          );
        })}

        {filter === 'custom' && (
          <>
            <input type="date" className="lb-control" value={from} max={to || undefined}
                   onChange={e => setFrom(e.target.value)} aria-label="From" />
            <span className="fu-to">to</span>
            <input type="date" className="lb-control" value={to} min={from || undefined}
                   onChange={e => setTo(e.target.value)} aria-label="To" />
          </>
        )}

        <div className="lb-toolbar-right">
          {canSeeOthers && agents.length > 0 && (
            <select className="lb-control" value={agent} onChange={e => setAgent(e.target.value)}
                    aria-label="Agent">
              <option value="">All agents</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>
                  {String(a.id) === String(user?.id) ? `${a.name} (me)` : a.name}
                </option>
              ))}
            </select>
          )}
          {!loading && !needsRange && (
            <span className="lb-count">{rows.length} follow-up{rows.length !== 1 ? 's' : ''}</span>
          )}
          <button type="button" className="lb-control lb-icon-btn" title="Reload"
                  onClick={() => { load(); loadCounts(); }} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'fu-spin' : undefined} />
          </button>
        </div>
      </div>

      {/* ── Table ──
          Full bleed: no card wrapper, no outer border or radius, horizontal
          dividers only. lb-scroll-x must NOT be given an overflow of its own —
          listLayout.css sets it to visible on purpose so the sticky header binds
          to .page-scroll. Overriding it silently unsticks every header. */}
      <div className="lb-list">
        <div className="lb-scroll-x">
          <table className="data-table fu-table">
            <thead>
              <tr>
                {/* The server sorts ORDER BY due_date ASC, created_at ASC —
                    soonest first. The arrow says which column that is; it is
                    not a control, because there is no ?sort= to send. */}
                <th className="lb-sorted">Due <ArrowUp size={12} className="lb-sort-icon" /></th>
                <th>Customer</th>
                <th>Status</th>
                <th>Assigned To</th>
                <th>Note</th>
                <th className="fu-th-act">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j}><div className="fu-skel" /></td>
                    ))}
                  </tr>
                ))
              ) : needsRange ? (
                <tr>
                  <td colSpan="6">
                    <div className="fu-empty">
                      <Clock size={36} />
                      <div className="fu-empty-t">Pick a date range</div>
                      <div className="fu-empty-s">Choose a start and an end date to list follow-ups.</div>
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan="6">
                    <div className="fu-empty">
                      <CheckCircle2 size={36} />
                      <div className="fu-empty-t">
                        {filter === 'overdue' ? 'Nothing overdue'
                          : filter === 'today' ? 'Nothing due today'
                            : 'No follow-ups'}
                      </div>
                      <div className="fu-empty-s">
                        {filter === 'overdue'
                          ? 'Every follow-up is on schedule.'
                          : filtered
                            ? 'Try another tab, or clear the agent filter.'
                            : 'Follow-ups appear here when they are scheduled on a lead.'}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map(ev => <Row key={ev.id} ev={ev} {...rowProps} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
