import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAppPaths } from '../lib/appPaths.js';
import { usePageSearch } from '../lib/pageSearchStore.js';
import { usePageCrumb } from '../lib/pageCrumbStore.js';
import { useDebouncedSearch } from '../hooks/useDebouncedSearch.js';
import { useDetailRail } from '../hooks/useDetailRail.js';
import { useMediaQuery, MOBILE_LIST_QUERY } from '../hooks/useMediaQuery.js';
import SplitPane, { RecordCard } from '../components/SplitPane.jsx';
import PaginationBar from '../components/PaginationBar.jsx';
import JobCardPage from './JobCardPage.jsx';
import ActivityDrawer from '../components/ActivityDrawer.jsx';
import { ClipboardList, X, ArrowDown, AlertCircle, Clock } from 'lucide-react';
import '../styles/JobCardsPage.css';
/* The trigger button below uses `ad-btn`, which lives in the drawer's
   stylesheet. Imported here as well as by the drawer, because the drawer is
   only mounted once somebody opens it — without this the icon is unstyled
   until the first time it is pressed. */
import '../styles/ActivityDrawer.css';

/* ═══════════════════════════════════════════════════════════════════════════
   Job Cards — the floor.

   ══ THE SAME TWO VIEWS EVERY LIST PAGE HERE HAS ══════════════════════════

   Nothing open  → a full-bleed table with a toolbar, exactly like Customer
                   Invoices, Estimates and Purchase Invoices.
   One open      → SplitPane: the same rows as a rail on the left, the card on
                   the right, with a header bar carrying the card number and a
                   close button.

   The first version of this screen invented its own layout — a floating panel
   with a five-row pile of status pills and a dashed empty box beside it. It
   worked and it looked like a different product. This one reuses SplitPane,
   useDetailRail, PaginationBar, the `lb-` toolbar and the top bar's search, so
   a person who can use the invoice list can use this without learning anything.

   ══ THE STATUS STRIP ═════════════════════════════════════════════════════

   One row, scrolling, with a live count on each. The counts come from their
   own endpoint which ignores the selected status on purpose: a bar that zeroes
   every other tab the moment you press one cannot tell you what is on the
   floor, which is the only reason it exists.
   ═══════════════════════════════════════════════════════════════════════ */

const STATUS_TABS = [
  { key: '',                  label: 'All'           },
  { key: 'open',              label: 'Open'          },
  { key: 'inspection',        label: 'Inspection'    },
  { key: 'awaiting_estimate', label: 'Awaiting est'  },
  { key: 'awaiting_approval', label: 'Awaiting appr' },
  { key: 'in_progress',       label: 'In progress'   },
  { key: 'on_hold',           label: 'On hold'       },
  { key: 'work_done',         label: 'Work done'     },
  { key: 'qc',                label: 'Quality check' },
  { key: 'ready',             label: 'Ready'         },
  { key: 'delivered',         label: 'Delivered'     },
  { key: 'closed',            label: 'Closed'        },
  { key: 'cancelled',         label: 'Cancelled'     },
];

/* Three tones, not thirteen colours: something is stuck, something is
   finished, or work is simply happening. The rail card and the table cell read
   the same map, so a colour cannot mean two things in two views. */
const STATUS_META = {
  open:              { label: 'Open',          color: 'var(--text-muted)' },
  inspection:        { label: 'Inspection',    color: '#7c3aed' },
  awaiting_estimate: { label: 'Awaiting est',  color: '#0ea5e9' },
  awaiting_approval: { label: 'Awaiting appr', color: '#f59e0b' },
  in_progress:       { label: 'In progress',   color: '#d97706' },
  on_hold:           { label: 'On hold',       color: '#dc2626' },
  work_done:         { label: 'Work done',     color: '#0f766e' },
  qc:                { label: 'Quality check', color: '#7c3aed' },
  ready:             { label: 'Ready',         color: '#16a34a' },
  delivered:         { label: 'Delivered',     color: '#16a34a' },
  closed:            { label: 'Closed',        color: 'var(--text-muted)' },
  cancelled:         { label: 'Cancelled',     color: '#991b1b' },
};
const meta = s => STATUS_META[s] || { label: s || '—', color: 'var(--text-muted)' };

/* IST throughout: a hub closing at 21:30 is still working on today's date, and
   the browser's own zone would move it for anybody travelling. */
const fmtDate = v => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'Asia/Kolkata' });
};

/* Empty on the day it opened, because the date beside it already says so.
   The age earns its place only once it is a number worth worrying about. */
const openFor = v => {
  if (!v) return '';
  const days = Math.floor((Date.now() - new Date(v).getTime()) / 86400000);
  if (days <= 0) return '';
  return days === 1 ? '1 day' : `${days} days`;
};

const STILL_IN = s => !['delivered', 'closed', 'cancelled'].includes(s);

/* row → the shape SplitPane's RecordCard wants. Keyed on appointment_id, not
   the job card id: the route is /job-cards/:appointmentId, and the rail has to
   know which of its cards is the one being read. */
function jcCard(row) {
  const m = meta(row.status);
  const age = STILL_IN(row.status) ? openFor(row.opened_at) : '';
  return {
    id: row.appointment_id,
    code: row.job_card_no || `JC-${row.id}`,
    date: fmtDate(row.opened_at),
    name: row.customer_name,
    sub: [row.vehicle_number, [row.make_name, row.model_name].filter(Boolean).join(' ')]
           .filter(Boolean).join(' • '),
    status: m.label,
    statusColor: m.color,
    badges: [
      ...(row.hub_code ? [{ label: row.hub_code, title: row.hub_name }] : []),
      /* A card open more than a week is the one somebody has forgotten.
         Marked here rather than only in the table, so the rail does not lose
         information just because it is narrower. */
      ...(age && Number(age.split(' ')[0]) >= 7
        ? [{ label: age, title: `Open for ${age}`, tone: 'warn' }] : []),
    ],
    figures: [
      ...(row.odometer_in != null
        ? [{ label: 'Odo', value: Number(row.odometer_in).toLocaleString('en-IN') }] : []),
      ...(Number(row.technician_count) > 0
        ? [{ label: 'Techs', value: String(row.technician_count) }] : []),
      ...(Number(row.complaint_count) > 0
        ? [{ label: 'Jobs', value: String(row.complaint_count) }] : []),
    ],
  };
}

export default function JobCardsPage() {
  const { appointmentId } = useParams();
  const navigate = useNavigate();
  const P = useAppPaths();
  const { user } = useAuth();
  const isHub = Boolean(user?.hub_id);
  const isNarrow = useMediaQuery(MOBILE_LIST_QUERY);

  const selectedId = appointmentId ? Number(appointmentId) : null;

  /* The activity drawer. Opened from the header, closed by its own X, the
     scrim or Escape. `bump` nudges the badge after a note is posted, so the
     count catches up without the drawer reaching back into the card's state. */
  const [activityOpen, setActivityOpen] = useState(false);
  const [bump, setBump] = useState(0);
  /* Closed when the vehicle changes: a history panel still showing the last
     car's events over a different card is worse than no panel. */
  useEffect(() => { setActivityOpen(false); }, [selectedId]);

  const { input: searchInput, setInput, search, tooShort, minChars } = useDebouncedSearch();
  const onSearchChange = useCallback(v => setInput(v), [setInput]);
  const [status, setStatus] = useState('');

  const [items, setItems]   = useState([]);
  const [counts, setCounts] = useState({});
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  /* 20, not 15: PaginationBar offers 10/20/50/100, and a value that is not
     in its list renders the select on the wrong option. */
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  /* The top bar's search box, released while a card is open — searching a list
     you cannot see is a control that appears to do nothing. The rail gets its
     own copy of the same state, so the two can never disagree. */
  usePageSearch({
    value: searchInput,
    onChange: onSearchChange,
    placeholder: 'Card no, vehicle, customer or mobile',
    hint: tooShort ? `${minChars}+ characters` : '',
    enabled: !selectedId,
  });

  /* Identity is the rail's reset trigger, so it must change when a filter
     VALUE changes and not on any other render. */
  const buildRailQuery = useCallback(() => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (search) q.set('search', search);
    return q;
  }, [status, search]);

  const rail = useDetailRail({
    endpoint: '/api/job-cards',
    selectedId,
    buildQuery: buildRailQuery,
  });

  /* The table's own fetch. Skipped entirely while a card is open — the rail
     owns the list then, and a second invisible request per keystroke is waste.
     An AbortController keeps a slow early response from overwriting a newer
     one. */
  const abortRef = useRef(null);
  const fetchList = useCallback(async () => {
    if (selectedId) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const q = buildRailQuery();
      q.set('page', String(page));
      q.set('limit', String(pageSize));
      const cq = new URLSearchParams();
      if (search) cq.set('search', search);
      const [list, cnt] = await Promise.all([
        api(`/api/job-cards?${q}`, { signal: ac.signal }),
        api(`/api/job-cards/counts?${cq}`, { signal: ac.signal }),
      ]);
      setItems(list.items || []);
      setTotal(list.total || 0);
      setCounts(cnt.counts || {});
      setError('');
    } catch (e) {
      if (e?.name === 'AbortError') return;      // superseded, not failed
      setError(e.message);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [selectedId, buildRailQuery, page, pageSize, search]);

  useEffect(() => { fetchList(); }, [fetchList]);
  /* Changing a filter must not leave you on page 7 of a set that now has two
     pages — the server would answer with nothing and the screen would read as
     "no job cards". */
  useEffect(() => { setPage(1); }, [status, search]);

  const selectedRow = useMemo(
    () => [...(rail.items || []), ...items].find(r => r.appointment_id === selectedId) || null,
    [rail.items, items, selectedId]);

  usePageCrumb(appointmentId, selectedRow?.job_card_no || (selectedId ? 'Job card' : null));

  const allCount = useMemo(
    () => Object.values(counts).reduce((s, n) => s + n, 0), [counts]);

  const openCard = row => navigate(`${P.jobCards}/${row.appointment_id}`);
  const closeCard = () => navigate(P.jobCards);

  // ── One card open: the split pane ────────────────────────────────────────
  if (selectedId) {
    return (
      <div className="jcl-page lb-page">
        <SplitPane
          rail={rail}
          selectedId={selectedId}
          onSelect={openCard}
          noun="job card"
          search={searchInput}
          onSearch={onSearchChange}
          searchHint={tooShort ? `${minChars}+ characters` : ''}
          mapCard={jcCard}
        >
          {/* The same shape as the invoice and estimate detail bars, but with
              its own class and its own rules — depending on
              CustomerInvoicesPage.css having been loaded would make this
              header's layout a side effect of which page the user visited
              first.

              Below 1100px the rail is hidden by CSS, and the close button here
              is then the only way back that is on this part of the screen. */}
          <div className="jcl-dhead">
            <div className="jcl-dh-left">
              <ClipboardList size={18} style={{ color: 'var(--primary)' }} />
              <span className="jcl-dh-code">{selectedRow?.job_card_no || 'Job card'}</span>
              {selectedRow && (
                <span className="jcl-dh-status" style={{ color: meta(selectedRow.status).color }}>
                  {meta(selectedRow.status).label}
                </span>
              )}
            </div>
            <div className="jcl-dh-right">
              {/* One icon, and the history is behind it. It was a full section
                  in the card's right column until it became this — see
                  components/ActivityDrawer.jsx for why. */}
              {selectedRow && (
                <button type="button"
                        className={`ad-btn${activityOpen ? ' ad-btn--on' : ''}`}
                        onClick={() => setActivityOpen(v => !v)}
                        title="Activity — every change on this card"
                        aria-label="Activity" aria-expanded={activityOpen}>
                  <Clock size={15} />
                  {Number(selectedRow.activity_count) > 0 && (
                    <span className="ad-btn-n">{selectedRow.activity_count}</span>
                  )}
                </button>
              )}
              <button type="button" className="jcl-dh-close" onClick={closeCard}
                      title="Close and return to the job card list" aria-label="Close job card">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* key forces a clean mount per vehicle: without it, moving between
              cards would keep the previous one's open forms and half-typed
              inputs on screen against a different car. */}
          <JobCardPage key={selectedId} appointmentId={selectedId} embedded />
        </SplitPane>

        {activityOpen && selectedRow && (
          <ActivityDrawer
            key={`${selectedRow.id}:${bump}`}
            jobCardId={selectedRow.id}
            code={selectedRow.job_card_no}
            onClose={() => setActivityOpen(false)}
            onPosted={() => setBump(b => b + 1)}
          />
        )}
      </div>
    );
  }

  // ── Nothing open: the table ──────────────────────────────────────────────
  return (
    <div className="jcl-page lb-page">
      {/* One row, scrolling. The counts are the floor at a glance — "In
          progress 4, On hold 1, Ready 2" is the morning meeting — and pressing
          one filters the table without changing the others. */}
      <div className="lb-toolbar jcl-toolbar">
        <div className="jcl-tabs" role="group" aria-label="Filter by status">
          {STATUS_TABS.map(t => {
            const n  = t.key ? (counts[t.key] ?? 0) : allCount;
            const on = status === t.key;
            return (
              <button key={t.key || 'all'} type="button" aria-pressed={on}
                      className={`jcl-tab${on ? ' jcl-tab--on' : ''}${n === 0 ? ' jcl-tab--empty' : ''}`}
                      onClick={() => setStatus(t.key)}>
                {t.label}<em>{n}</em>
              </button>
            );
          })}
        </div>
      </div>

      {error && <div className="jcl-err"><AlertCircle size={13} /> {error}</div>}

      <div className="lb-list">
        {loading ? (
          <div className="lb-empty">Loading…</div>
        ) : items.length === 0 ? (
          <div className="lb-empty">
            <ClipboardList size={32} style={{ opacity: 0.3, marginBottom: 10 }} />
            <p style={{ margin: 0 }}>
              {search || status
                ? 'No job cards match these filters.'
                : 'No job cards yet. Open one from an appointment.'}
            </p>
          </div>
        ) : isNarrow ? (
          /* Below 760px the table is eight columns behind a min-width, which on
             a phone is a horizontal scrollbar showing two of them. These are
             the same cards the rail uses — one component, so the two views
             cannot drift apart. */
          <div className="sp-cardlist">
            {items.map(row => (
              <RecordCard key={row.id} card={{ ...jcCard(row), raw: row }}
                          selected={false} onSelect={openCard} />
            ))}
          </div>
        ) : (
          <div className="jcl-table-wrap lb-scroll-x">
            <table className="jcl-table">
              <thead>
                <tr>
                  <th>Card No.</th>
                  {/* ORDER BY opened_at DESC on the server. The arrow states
                      that; it is not a control, because there is no ?sort= to
                      send. */}
                  <th className="lb-sorted">Opened <ArrowDown size={12} className="lb-sort-icon" /></th>
                  <th>Customer</th>
                  <th>Vehicle</th>
                  {!isHub && <th>Hub</th>}
                  <th>Status</th>
                  <th className="jcl-num">Odo in</th>
                  <th>Open for</th>
                </tr>
              </thead>
              <tbody>
                {items.map(row => {
                  const m = meta(row.status);
                  const age = STILL_IN(row.status) ? openFor(row.opened_at) : '';
                  const stale = age && Number(age.split(' ')[0]) >= 7;
                  return (
                    <tr key={row.id} onClick={() => openCard(row)} className="jcl-tr">
                      <td className="jcl-code">{row.job_card_no || `JC-${row.id}`}</td>
                      <td>{fmtDate(row.opened_at)}</td>
                      <td className="jcl-name">{row.customer_name || '—'}</td>
                      <td>
                        <span className="jcl-veh">{row.vehicle_number || '—'}</span>
                        {(row.make_name || row.model_name) && (
                          <span className="jcl-veh-sub">
                            {[row.make_name, row.model_name].filter(Boolean).join(' ')}
                          </span>
                        )}
                      </td>
                      {!isHub && <td className="jcl-hub">{row.hub_name || '—'}</td>}
                      <td>
                        <span className="jcl-status" style={{ color: m.color }}>{m.label}</span>
                      </td>
                      <td className="jcl-num">
                        {row.odometer_in != null ? Number(row.odometer_in).toLocaleString('en-IN') : '—'}
                      </td>
                      <td className={stale ? 'jcl-stale' : undefined}>{age || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PaginationBar
        page={page} total={total} pageSize={pageSize}
        onPage={setPage}
        onPageSize={n => { setPageSize(n); setPage(1); }}
        noun="job card"
      />
    </div>
  );
}
