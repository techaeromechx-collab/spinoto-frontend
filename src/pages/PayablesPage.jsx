import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { api } from '../api/client.js';
import LedgerPanel from '../components/LedgerPanel.jsx';
import { Wallet, RefreshCw, Download, AlertCircle, ChevronRight, ChevronLeft, Search } from 'lucide-react';
import '../styles/PayablesPage.css';

/**
 * What we owe the hubs — a full-width list, and each hub's statement on its
 * own screen behind it.
 *
 * ── WHY A ROUTE AND NOT AN ACCORDION ───────────────────────────────────────
 *
 * The statement used to open inline under the row. That reads as a dropdown:
 * the list shifts under your cursor, the thing you are reading is boxed inside
 * the thing you were reading, and there is no way back other than clicking the
 * same row again. A statement is a destination, not a disclosure.
 *
 * So the hub id goes in the URL — /payables/:hubId — and this component shows
 * the list or one hub depending on whether it is there. That follows the
 * `/customers/:token?` and `/leads/:token?` pattern already in App.jsx, and it
 * buys three things for free: browser Back leaves the statement instead of the
 * page, a refresh stays on the hub, and the URL can be sent to somebody.
 *
 * ── ONE FLAT LIST, ORDERED BY DAYS ─────────────────────────────────────────
 *
 * An earlier design grouped hubs into "Past 45 days / 31–45 / Up to 30"
 * sections. That was dropped on purpose: the bands are an accounting
 * abstraction, and headed sections over a handful of hubs are more furniture
 * than information. The day count is what people read, so the list is flat,
 * sorted by it, and every row states it.
 *
 * The day number keeps its colour — that is not banding, it is the number
 * itself telling you how bad it is at a glance. 45 days is the MSME payment
 * limit; past it, a hub waiting is a relationship problem before it is an
 * accounting one.
 */

const inr = n => Number(n || 0).toLocaleString('en-IN',
  { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = n => Number(n || 0).toLocaleString('en-IN',
  { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const dmy = v => {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/* Days between a date-only value and today, both pinned to local midnight.
   Comparing a bare date against Date.now() makes a payment recorded this
   morning read as "1 day ago" or "0 days ago" depending on the hour. */
const agoLabel = iso => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const then = new Date(+m[1], +m[2] - 1, +m[3]);
  const now  = new Date();
  const days = Math.max(0, Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()) - then) / 86400000));
  if (days === 0) return 'today';
  return days === 1 ? 'yesterday' : `${days} days ago`;
};

function downloadCSV(filename, rows, headers) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob([[headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n')],
    { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* 45 days is the commercial line — MSME payment terms run to it. 30 is the
   early warning. Used for the colour of the day count only; the list itself
   is not split on these. */
const ageClass = d => (d > 45 ? 'bad' : d > 30 ? 'warn' : 'ok');

const SORTS = {
  days:   { label: 'Longest waiting', fn: (a, b) => (b.oldest_days || 0) - (a.oldest_days || 0) },
  amount: { label: 'Highest amount',  fn: (a, b) => Number(b.outstanding || 0) - Number(a.outstanding || 0) },
  name:   { label: 'Hub name (A–Z)',  fn: (a, b) => String(a.hub_name).localeCompare(String(b.hub_name)) },
};

export default function PayablesPage() {
  const { hubId } = useParams();
  /* The URL is the only state deciding which of the two screens is showing.
     Keeping a copy in useState is what makes list/detail pages drift out of
     sync with the address bar on Back. */
  return hubId ? <HubStatementScreen hubId={hubId} /> : <PayablesListScreen />;
}

// =====================================================================
// One hub, full width, on its own screen.
// =====================================================================
function HubStatementScreen({ hubId }) {
  const navigate = useNavigate();
  const location = useLocation();
  /* Handed over by the row that was clicked so the name and the amount are on
     screen while the statement loads. Absent on a refresh or a pasted link —
     LedgerPanel prints all of it again from its own fetch, so nothing here is
     load-bearing. */
  const hub = location.state?.hub || null;

  return (
    <div className="pay-page">
      <div className="pay-band pay-band--detail">
        <button className="pay-back" onClick={() => navigate('/payables')}>
          <ChevronLeft size={16} /> All hubs
        </button>
        {hub && (
          <div className="pay-back-sum">
            <span className={`pay-chip pay-chip--${ageClass(hub.oldest_days)}`}>
              {hub.oldest_days} day{hub.oldest_days === 1 ? '' : 's'} waiting
            </span>
            <strong>{inr(hub.outstanding)}</strong>
          </div>
        )}
      </div>

      <div className="pay-detail">
        <LedgerPanel partyType="hub" partyKey={String(hubId)} />
      </div>
    </div>
  );
}

// =====================================================================
// Every hub we owe.
// =====================================================================
function PayablesListScreen() {
  const navigate = useNavigate();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [query, setQuery]     = useState('');
  const [sort, setSort]       = useState('days');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await api('/api/ledger/payables')); }
    catch (e) { setError(e.message || 'Could not load'); setData(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  /* Sorted and filtered in one place so the CSV matches what is on screen —
     exporting a different order than the list shows is a small betrayal that
     costs somebody an afternoon of reconciling. */
  const rows = useMemo(() => {
    const all = data?.items || [];
    const q = query.trim().toLowerCase();
    const filtered = q ? all.filter(r => String(r.hub_name).toLowerCase().includes(q)) : all;
    return [...filtered].sort(SORTS[sort].fn);
  }, [data, query, sort]);

  const exportCsv = () => rows.length && downloadCSV('hub-ledger.csv',
    rows.map(r => [r.hub_name, r.open_invoices, r.outstanding, dmy(r.oldest), r.oldest_days,
      r.last_paid ? dmy(r.last_paid) : 'Never paid']),
    ['Hub', 'Open invoices', 'Outstanding', 'Oldest invoice', 'Days waiting', 'Last payment']);

  const open = row => navigate(`/payables/${row.hub_id}`, { state: { hub: row } });

  const oldest    = data?.items?.reduce((m, r) => Math.max(m, r.oldest_days || 0), 0) || 0;
  const invoices  = data?.items?.reduce((s, r) => s + (r.open_invoices || 0), 0) || 0;
  const shown     = rows.length;
  const filtering = query.trim().length > 0;

  return (
    <div className="pay-page">
      <header className="pay-band pay-band--head">
        <div className="pay-head-left">
          <span className="pay-head-icon"><Wallet size={19} /></span>
          <div>
            <h1 className="pay-title">Hub Ledger</h1>
            <p className="pay-sub">What we owe partner hubs, and how long each has been waiting</p>
          </div>
        </div>
        <div className="pay-head-right">
          <button className="pay-icon-btn" onClick={load} disabled={loading} title="Reload">
            <RefreshCw size={15} className={loading ? 'pay-spin' : ''} />
          </button>
          <button className="pay-btn" onClick={exportCsv} disabled={!shown}>
            <Download size={15} /> Export CSV
          </button>
        </div>
      </header>

      {error && <p className="pay-error"><AlertCircle size={15} /><span>{error}</span></p>}
      {loading && !data && <p className="pay-empty">Loading…</p>}

      {data && (
        <>
          {/* One number leads. The old layout gave four equal tiles, so the
              total competed with the invoice count for attention. */}
          <section className="pay-band pay-band--hero">
            <div>
              <span className="pay-hero-value">{inr(data.total)}</span>
              <span className="pay-hero-label">
                Owed to {data.hubs} hub{data.hubs === 1 ? '' : 's'} across {invoices} open
                invoice{invoices === 1 ? '' : 's'}
              </span>
            </div>
            <div className="pay-hero-side">
              <div>
                <span className={`pay-hero-stat pay-hero-stat--${ageClass(oldest)}`}>{oldest} days</span>
                <em>Longest wait</em>
              </div>
              <div>
                <span className="pay-hero-stat">{inr0(data.hubs ? data.total / data.hubs : 0)}</span>
                <em>Average per hub</em>
              </div>
            </div>
          </section>

          {data.items.length === 0 ? (
            <p className="pay-empty pay-empty--good">Nothing outstanding. Every hub is settled.</p>
          ) : (
            <>
              <div className="pay-band pay-band--tools">
                <label className="pay-search">
                  <Search size={15} />
                  <input
                    type="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search a hub…"
                    aria-label="Search hubs"
                  />
                </label>
                <label className="pay-sort">
                  <span>Sort</span>
                  <select value={sort} onChange={e => setSort(e.target.value)}>
                    {Object.entries(SORTS).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              {shown === 0 ? (
                <p className="pay-empty">No hub matches “{query.trim()}”.</p>
              ) : (
                <table className="pay-table">
                  <thead>
                    <tr>
                      <th className="pay-c-hub">Hub</th>
                      <th className="pay-c-inv">Open invoices</th>
                      <th className="pay-c-old">Oldest invoice</th>
                      <th className="pay-c-age">Waiting</th>
                      <th className="pay-c-paid">Last payment</th>
                      <th className="pay-c-amt">Outstanding</th>
                      <th className="pay-c-go" aria-label="Open" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => {
                      const cls = ageClass(row.oldest_days);
                      return (
                        <tr
                          key={row.hub_id}
                          className="pay-tr"
                          onClick={() => open(row)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(row); } }}
                          tabIndex={0}
                          role="link"
                        >
                          {/* The colour is a border on the first cell rather
                              than its own column: a 3px strip does not deserve
                              a header, and this way it stays flush with the
                              left edge of a full-width table. */}
                          <td className={`pay-c-hub pay-edge pay-edge--${cls}`}>{row.hub_name}</td>
                          <td className="pay-c-inv">{row.open_invoices}</td>
                          <td className="pay-c-old">{dmy(row.oldest) || '—'}</td>
                          <td className="pay-c-age">
                            <span className={`pay-chip pay-chip--${cls}`}>
                              {row.oldest_days} day{row.oldest_days === 1 ? '' : 's'}
                            </span>
                          </td>
                          <td className="pay-c-paid">
                            {row.last_paid ? (
                              <>
                                <span className="pay-paid-date">{dmy(row.last_paid)}</span>
                                <span className="pay-paid-ago">{agoLabel(row.last_paid)}</span>
                              </>
                            ) : (
                              /* Not "—". A hub we have never sent a rupee to is
                                 the strongest thing this row can say, and in the
                                 live data it is the three hubs that have waited
                                 longest. */
                              <span className="pay-never">Never paid</span>
                            )}
                          </td>
                          <td className="pay-c-amt">{inr(row.outstanding)}</td>
                          <td className="pay-c-go"><ChevronRight size={16} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {filtering && shown > 0 && (
                <p className="pay-foot">
                  Showing {shown} of {data.items.length} hubs. The total above is for all of them.
                </p>
              )}
            </>
          )}

          <p className="pay-foot">
            Counts only purchase invoices still marked pending with a value above zero.
            Invoices at <strong>no payment due</strong> are excluded — they are settled by
            definition, not waiting.
          </p>
        </>
      )}
    </div>
  );
}
