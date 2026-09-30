import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAppPaths } from '../lib/appPaths.js';
import { usePageSearch } from '../lib/pageSearchStore.js';
import { useDebouncedSearch } from '../hooks/useDebouncedSearch.js';
import { useMediaQuery, MOBILE_LIST_QUERY } from '../hooks/useMediaQuery.js';
import PaginationBar from '../components/PaginationBar.jsx';
import { ClipboardCheck, CircleCheck, CircleDashed, ArrowUp, AlertCircle } from 'lucide-react';
import '../styles/InspectionsPage.css';

/* ═══════════════════════════════════════════════════════════════════════════
   Inspections — the queue.

   ══ WHY THIS IS NOT THE CHECKLISTS SCREEN ════════════════════════════════

   Master data → Checklists holds the TEMPLATES: the questions, the option
   labels, the groups. This holds the RUNS: the sheet somebody started on a
   real car at 11:20 and has not finished.

   Different screens for different people on different days. Editing a template
   is a decision the business makes once a quarter; finding the sheet that has
   been half-answered since Tuesday is a thing somebody does at four in the
   afternoon with a customer waiting.

   ══ TABLE ONLY, NO SPLIT PANE ════════════════════════════════════════════

   A row here opens the inspection RUNNER, which is a screen of its own — a
   44-point sheet filled in over minutes wants the whole window, not a detail
   pane beside a list. So this is the plain `lb-` table half of the house
   pattern: toolbar, full-bleed table, PaginationBar, search in the top bar.

   ══ UNFINISHED FIRST, OLDEST FIRST ═══════════════════════════════════════

   The server orders it and this screen does not re-sort. A completed
   inspection is a record; an unfinished one is a job, and the one sitting
   longest is the one most likely to have been forgotten. Newest-first would
   bury it under this morning's completions — which is exactly how it stayed
   invisible before this screen existed.
   ═══════════════════════════════════════════════════════════════════════ */

/* The only two kinds there are — migration 190's CHECK allows nothing else.
   The quality check is a pre_delivery run; 'qc' is a SIGNATURE kind, not an
   inspection one, and offering it here would advertise a filter that can never
   match anything. */
const KIND_LABEL = { intake: 'Intake', pre_delivery: 'Pre-delivery' };

/* 'draft' is migration 190's word for a sheet started and not finished. The
   tab says "Unfinished" because that is what it is to the person hunting for
   it; the key stays the schema's. */
const TABS = [
  { key: '',          label: 'All'        },
  { key: 'draft',     label: 'Unfinished' },
  { key: 'completed', label: 'Completed'  },
];

const fmtWhen = v => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
};

const fmtAge = v => {
  if (!v) return '';
  const mins = Math.floor((Date.now() - new Date(v).getTime()) / 60000);
  if (mins < 60)   return `${Math.max(mins, 0)}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  const d = Math.floor(mins / 1440);
  return d === 1 ? '1 day' : `${d} days`;
};

export default function InspectionsPage() {
  const navigate = useNavigate();
  const P = useAppPaths();
  const { user } = useAuth();
  const isHub = Boolean(user?.hub_id);
  const isNarrow = useMediaQuery(MOBILE_LIST_QUERY);

  const { input: searchInput, setInput, search, tooShort, minChars } = useDebouncedSearch();
  const onSearchChange = useCallback(v => setInput(v), [setInput]);

  /* Unfinished by default. Opening on four hundred completed rows would bury
     the twelve that need somebody. */
  const [status, setStatus] = useState('draft');
  const [kind, setKind]     = useState('');

  const [items, setItems]   = useState([]);
  const [counts, setCounts] = useState({ draft: 0, completed: 0 });
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  /* 20, not 15: PaginationBar offers 10/20/50/100, and a value that is not
     in its list renders the select on the wrong option. */
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  usePageSearch({
    value: searchInput,
    onChange: onSearchChange,
    placeholder: 'Vehicle, customer, card no. or sheet',
    hint: tooShort ? `${minChars}+ characters` : '',
  });

  const abortRef = useRef(null);
  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (status) q.set('status', status);
      if (kind)   q.set('kind', kind);
      if (search) q.set('search', search);
      q.set('page', String(page));
      q.set('limit', String(pageSize));
      const r = await api(`/api/inspections?${q}`, { signal: ac.signal });
      setItems(r.items || []);
      setTotal(r.total || 0);
      setCounts(r.counts || { draft: 0, completed: 0 });
      setError('');
    } catch (e) {
      if (e?.name === 'AbortError') return;
      setError(e.message);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [status, kind, search, page, pageSize]);

  useEffect(() => { load(); }, [load]);
  /* A filter change must not leave you on page 7 of a set that now has one. */
  useEffect(() => { setPage(1); }, [status, kind, search]);

  const allCount = useMemo(
    () => (counts.draft || 0) + (counts.completed || 0), [counts]);

  /* Straight into the sheet, not the card. Somebody on this screen is about to
     answer the remaining points; landing them on the job card would be one
     more click on every row. */
  const open = r => navigate(`${P.jobCards}/${r.appointment_id}/inspection/${r.id}`);

  const Progress = ({ r }) => {
    if (r.status === 'completed') {
      if (r.critical_count > 0)  return <span className="ins-pill ins-pill--bad">{r.critical_count} critical</span>;
      if (r.attention_count > 0) return <span className="ins-pill ins-pill--warn">{r.attention_count} attention</span>;
      return <span className="ins-pill ins-pill--ok">Clear</span>;
    }
    /* What is LEFT, not what is done — an unfinished sheet is a job, and the
       job is the remainder. */
    const left = r.point_count - r.answered_count;
    const pct  = r.point_count ? Math.round((r.answered_count / r.point_count) * 100) : 0;
    return (
      <span className="ins-prog">
        <span className="ins-pill ins-pill--open">{left} of {r.point_count} left</span>
        <span className="ins-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
      </span>
    );
  };

  return (
    <div className="ins-page lb-page">
      <div className="lb-toolbar ins-toolbar">
        <div className="lb-toolbar-left">
          <div className="ins-tabs" role="group" aria-label="Filter by state">
            {TABS.map(t => {
              const n  = t.key === '' ? allCount : counts[t.key] ?? 0;
              const on = status === t.key;
              return (
                <button key={t.key || 'all'} type="button" aria-pressed={on}
                        className={`ins-tab${on ? ' ins-tab--on' : ''}`}
                        onClick={() => setStatus(t.key)}>
                  {t.label}<em>{n}</em>
                </button>
              );
            })}
          </div>

          <select className="lb-control" value={kind} onChange={e => setKind(e.target.value)}
                  aria-label="Filter by inspection type">
            <option value="">All types</option>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="ins-err"><AlertCircle size={13} /> {error}</div>}

      <div className="lb-list">
        {loading ? (
          <div className="lb-empty">Loading…</div>
        ) : items.length === 0 ? (
          <div className="lb-empty">
            <ClipboardCheck size={32} style={{ opacity: 0.3, marginBottom: 10 }} />
            <p style={{ margin: 0 }}>
              {search || kind
                ? 'No inspections match these filters.'
                : status === 'draft'
                  ? 'Nothing half-finished. The floor is clear.'
                  : 'No inspections yet — one starts from a job card.'}
            </p>
          </div>
        ) : isNarrow ? (
          /* Below 760px the table's nine columns are a horizontal scrollbar
             showing two of them. A card per run instead, carrying the same
             facts in the order they matter. */
          <div className="ins-cardlist">
            {items.map(r => (
              <button key={r.id} type="button"
                      className={`ins-card${r.status === 'completed' ? ' ins-card--done' : ''}`}
                      onClick={() => open(r)}>
                <span className="ins-card-top">
                  <strong>{r.vehicle_number || '—'}</strong>
                  <Progress r={r} />
                </span>
                <span className="ins-card-sub">
                  {r.template_name}<em className="ins-kind">{KIND_LABEL[r.kind] || r.kind}</em>
                </span>
                <span className="ins-card-meta">
                  {r.customer_name || '—'} · {r.job_card_no || `card #${r.job_card_id}`}
                  {!isHub && r.hub_name && ` · ${r.hub_name}`}
                </span>
                <span className="ins-card-meta">
                  {r.status === 'completed'
                    ? `completed ${fmtWhen(r.completed_at)}`
                    : <>started {fmtWhen(r.started_at)} · <b>{fmtAge(r.started_at)}</b> ago</>}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="ins-table-wrap lb-scroll-x">
            <table className="ins-table">
              <thead>
                <tr>
                  <th className="ins-th-state" aria-label="State" />
                  <th>Vehicle</th>
                  <th>Sheet</th>
                  <th>Type</th>
                  <th>Job card</th>
                  <th>Customer</th>
                  {!isHub && <th>Hub</th>}
                  <th>Who</th>
                  <th>Progress</th>
                  {/* Unfinished first, then oldest first — the server's order,
                      stated rather than offered, because there is no ?sort= to
                      send. */}
                  <th className="lb-sorted">
                    Started <ArrowUp size={12} className="lb-sort-icon" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map(r => {
                  const done = r.status === 'completed';
                  return (
                    <tr key={r.id} className={`ins-tr${done ? ' ins-tr--done' : ''}`}
                        onClick={() => open(r)}>
                      <td className="ins-state-cell">
                        {done
                          ? <CircleCheck size={15} className="ins-ico ins-ico--done" />
                          : <CircleDashed size={15} className="ins-ico" />}
                      </td>
                      <td className="ins-veh">{r.vehicle_number || '—'}</td>
                      <td className="ins-sheet">{r.template_name}</td>
                      <td className="ins-muted">{KIND_LABEL[r.kind] || r.kind}</td>
                      <td className="ins-code">{r.job_card_no || `#${r.job_card_id}`}</td>
                      <td>{r.customer_name || '—'}</td>
                      {!isHub && <td className="ins-muted">{r.hub_name || '—'}</td>}
                      <td className="ins-muted">
                        {r.technician_name || r.performed_by_name || '—'}
                      </td>
                      <td><Progress r={r} /></td>
                      <td className="ins-when">
                        {done ? fmtWhen(r.completed_at) : (
                          <>
                            {fmtWhen(r.started_at)}
                            <span className="ins-age">{fmtAge(r.started_at)} ago</span>
                          </>
                        )}
                      </td>
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
        noun="inspection"
      />
    </div>
  );
}
