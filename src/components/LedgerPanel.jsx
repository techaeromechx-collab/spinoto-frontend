import { useEffect, useState, useCallback, useMemo } from 'react';
import { api, API_URL, getToken } from '../api/client.js';
import { Download, FileText, AlertCircle, Info, CalendarRange, X } from 'lucide-react';
import '../styles/LedgerPanel.css';

/**
 * A party's running statement. Customer or hub — same component, opposite sign.
 *
 * Reads only. Every row is a document that already exists somewhere else, so
 * there is nothing here to edit: a correction is a credit note, and the
 * starting figure is an opening balance. See ledger.controller.js for why.
 *
 * ── WHY THE WORDING CHANGES WITH THE PARTY ─────────────────────────────────
 *
 * "Debit" and "Credit" are correct and almost nobody reading this page thinks
 * in them. The same two columns mean opposite things depending on which side
 * of the deal the party sits on, so they are named for what actually happened:
 * on a hub, money we paid out and what the hub billed us; on a customer, what
 * we invoiced and what they paid. The arithmetic is untouched — only the
 * labels — and the Dr/Cr marker stays on the balance for anyone reconciling
 * against books.
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

const TYPE_LABEL = {
  opening: 'Opening', invoice: 'Invoice', payment: 'Payment',
  credit_note: 'Credit note', debit_note: 'Debit note',
  refund: 'Refund', purchase_invoice: 'Purchase invoice',
};

/* The tag carries the document type so the eye can sort the rows without
   reading them. `cls` groups by what the row does to the balance, not by
   table name — a refund and a payment are the same event to whoever is
   looking. */
const TAG = {
  opening:          { text: 'Opening',     cls: 'open' },
  invoice:          { text: 'Invoice',     cls: 'inv'  },
  purchase_invoice: { text: 'Invoice',     cls: 'inv'  },
  payment:          { text: 'Payment',     cls: 'pay'  },
  refund:           { text: 'Refund',      cls: 'pay'  },
  credit_note:      { text: 'Credit note', cls: 'note' },
  debit_note:       { text: 'Debit note',  cls: 'note' },
};

/* Particulars from the API already open with the document type — "Purchase
   invoice", "Paid to hub · upi · PI-000202". The tag states that now, so the
   opening phrase is dropped and only the detail after it is kept. A row whose
   particulars are nothing but the type is then left blank on purpose. */
const LEAD = /^(Purchase invoice|Payment received|Paid to hub|Refund paid out|Credit note|Debit note|Invoice)\s*(·\s*)?/;

/* The last 13 months, newest first. Thirteen rather than twelve so that in
   January the whole of the previous year is still one click away. */
const monthOptions = () => {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ key, label: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) });
  }
  return out;
};

/* A month key to the first and last day of that month. `new Date(y, m, 0)`
   is the last day of month m — day zero of the next one — which is how you
   get 28, 29, 30 or 31 without a table of month lengths. */
const monthRange = key => {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, '0')}` };
};

const rangeLabel = (from, to) => {
  if (from && to) return `${dmy(from)} to ${dmy(to)}`;
  if (from) return `from ${dmy(from)}`;
  if (to)   return `up to ${dmy(to)}`;
  return 'All time';
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

export default function LedgerPanel({ partyType, partyKey }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);

  /* `applied` is what has actually been asked of the server. The custom inputs
     write to `draft` and only land here on Apply — a type="date" field fires
     change on every partial edit, and refetching a statement on the way to a
     valid date is both slow and briefly wrong on screen. */
  const [period, setPeriod] = useState('all');
  const [applied, setApplied] = useState({ from: '', to: '' });
  const [draft, setDraft]     = useState({ from: '', to: '' });
  const months = useMemo(monthOptions, []);
  const filtered = Boolean(applied.from || applied.to);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (applied.from) p.set('from', applied.from);
    if (applied.to)   p.set('to', applied.to);
    const s = p.toString();
    return s ? `?${s}` : '';
  }, [applied]);

  const load = useCallback(async () => {
    if (!partyKey) return;
    setLoading(true); setError('');
    try {
      setData(await api(`/api/ledger/${partyType}/${encodeURIComponent(partyKey)}${qs}`));
    } catch (e) { setError(e.message || 'Could not load the statement'); setData(null); }
    finally { setLoading(false); }
  }, [partyType, partyKey, qs]);
  useEffect(() => { load(); }, [load]);

  const pickPeriod = key => {
    setPeriod(key);
    if (key === 'all')    { setApplied({ from: '', to: '' }); return; }
    if (key === 'custom') return;          // waits for Apply
    setApplied(monthRange(key));
  };
  const clearPeriod = () => { setPeriod('all'); setApplied({ from: '', to: '' }); setDraft({ from: '', to: '' }); };

  if (loading && !data) return <p className="lg-empty">Loading statement…</p>;
  if (error) return <p className="lg-error"><AlertCircle size={15} /><span>{error}</span></p>;
  if (!data) return null;

  const { party, rows, totals, ageing } = data;
  const hub = partyType === 'hub';
  const owing = totals.closing_direction === (hub ? 'cr' : 'dr');

  /* One place for every label that flips with the party, so the two sides can
     never drift apart in wording. */
  const COL_DR  = hub ? 'We paid'         : 'Invoiced';
  const COL_CR  = hub ? 'They billed'     : 'Received';
  const SUM_DR  = hub ? 'We have paid'    : 'Total invoiced';
  const SUM_CR  = hub ? 'They have billed' : 'Total received';

  /* A raw authenticated fetch rather than api(), which parses JSON — the
     pattern client.js documents API_URL and getToken for. Opened in a new tab
     instead of downloaded: the common case is reading it before deciding
     whether to send it, and a forced download makes that two steps. */
  const openPdf = async () => {
    setPdfBusy(true); setError('');
    try {
      const res = await fetch(`${API_URL}/api/ledger/${partyType}/${encodeURIComponent(partyKey)}/pdf${qs}`,
        { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error(`Could not build the statement (HTTP ${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      window.open(url, '_blank', 'noopener');
      /* Revoked on a delay, not immediately: the new tab has to finish reading
         the blob first, and revoking too early gives a blank viewer. */
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { setError(e.message || 'Could not build the statement'); }
    finally { setPdfBusy(false); }
  };

  /* The period is in the FILENAME, not only in the rows. Two statements for
     the same party, downloaded ten minutes apart for different months, are
     otherwise the same file name twice in a downloads folder. */
  const exportCsv = () => downloadCSV(
    `ledger-${party.name.replace(/[^\w]+/g, '-').toLowerCase()}`
      + (filtered ? `-${applied.from || 'start'}-to-${applied.to || 'today'}` : '') + '.csv',
    rows.map(r => [dmy(r.date), TYPE_LABEL[r.type] || r.type, r.ref, r.particulars,
      r.debit || '', r.credit || '', r.balance, r.balance_direction.toUpperCase()]),
    /* The CSV keeps the accounting names as well as the plain ones — it is the
       file that gets handed to whoever keeps the books. */
    ['Date', 'Type', 'Reference', 'Particulars', `${COL_DR} (debit)`, `${COL_CR} (credit)`, 'Balance', 'Dr/Cr']
  );

  return (
    <div className="lg-wrap">
      <header className="lg-head">
        <div>
          <h3>{party.name}</h3>
          <p>
            {party.gstin && <span className="lg-chip">{party.gstin}</span>}
            {party.mobile && <span className="lg-chip lg-chip--dim">{party.mobile}</span>}
            <span className="lg-chip lg-chip--dim">{totals.documents} document{totals.documents === 1 ? '' : 's'}</span>
          </p>
        </div>
        <div className="lg-actions">
          <button className="btn btn-sm" onClick={openPdf} disabled={!rows.length || pdfBusy}>
            <FileText size={13} /> {pdfBusy ? 'Building…' : 'Statement PDF'}
          </button>
          <button className="btn btn-sm" onClick={exportCsv} disabled={!rows.length}>
            <Download size={13} /> CSV
          </button>
        </div>
      </header>

      <div className="lg-period">
        <CalendarRange size={14} className="lg-period__icon" />
        <select
          className="lg-period__sel"
          value={period}
          onChange={e => pickPeriod(e.target.value)}
          aria-label="Statement period"
        >
          <option value="all">All time</option>
          {months.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          <option value="custom">Custom range…</option>
        </select>

        {period === 'custom' && (
          <span className="lg-period__custom">
            <input
              type="date" value={draft.from} aria-label="From"
              onChange={e => setDraft(d => ({ ...d, from: e.target.value }))}
            />
            <em>to</em>
            <input
              type="date" value={draft.to} aria-label="To"
              onChange={e => setDraft(d => ({ ...d, to: e.target.value }))}
            />
            <button
              className="lg-period__apply"
              onClick={() => setApplied({ from: draft.from, to: draft.to })}
              disabled={!draft.from && !draft.to}
            >Apply</button>
          </span>
        )}

        {/* Either end on its own is a legitimate question — "everything since
            April", "everything up to the year end" — so neither is required. */}
        {filtered && (
          <>
            <span className="lg-period__now">{rangeLabel(applied.from, applied.to)}</span>
            <button className="lg-period__clear" onClick={clearPeriod} title="Show all time">
              <X size={13} /> Clear
            </button>
          </>
        )}
      </div>

      {/* Three names on one mobile is real in this data. Showing them beats
          picking one and being wrong on something sent to a customer. */}
      {party.names?.length > 1 && (
        <p className="lg-note">
          <Info size={13} />
          <span>This number has been invoiced under {party.names.length} names — <strong>{party.names.join(', ')}</strong>.
          They share one statement.</span>
        </p>
      )}

      <div className="lg-summary">
        <div className="lg-sum">
          <span>{filtered ? 'Brought forward' : 'Opening'}</span>
          <strong>{totals.opening ? `${inr0(totals.opening)} ${totals.opening_direction?.toUpperCase()}` : '—'}</strong>
        </div>
        <div className="lg-sum"><span>{SUM_DR}</span><strong>{inr0(totals.debit)}</strong></div>
        <div className="lg-sum"><span>{SUM_CR}</span><strong>{inr0(totals.credit)}</strong></div>
        <div className={`lg-sum lg-sum--closing${owing ? ' lg-sum--owed' : ''}`}>
          <span>{hub
            ? (owing ? 'We owe this hub' : 'Overpaid')
            : (owing ? 'Customer owes' : 'In credit')}</span>
          <strong>{inr(totals.closing)}</strong>
        </div>
      </div>

      {/* Ageing answers "how old is the money owed TODAY", which has nothing to
          do with the window on screen. Under a filter it would be computed from
          the filtered invoices alone and quietly mean something else, so it is
          hidden rather than relabelled. */}
      {!filtered && ageing && totals.closing > 0.011 && owing && (
        <div className="lg-ageing">
          <span className="lg-ageing__label">Age of what is owed</span>
          {[['Current', ageing.current], ['31–60 days', ageing.d30],
            ['61–90 days', ageing.d60], ['Over 90 days', ageing.d90plus]].map(([k, v]) => (
            <div key={k} className={`lg-age${v > 0 ? ' lg-age--on' : ''}${k === 'Over 90 days' && v > 0 ? ' lg-age--bad' : ''}`}>
              <span>{k}</span><strong>{v > 0 ? inr0(v) : '—'}</strong>
            </div>
          ))}
        </div>
      )}

      <div className="lg-tablewrap">
        <table className="lg-table">
          <thead>
            <tr>
              <th>Date</th><th>Reference</th><th>Particulars</th>
              <th className="num">{COL_DR}</th><th className="num">{COL_CR}</th><th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="lg-td-empty">Nothing on this account yet.</td></tr>
            )}
            {rows.map((r, i) => {
              const tag = TAG[r.type] || { text: TYPE_LABEL[r.type] || r.type, cls: 'open' };
              const detail = String(r.particulars || '').replace(LEAD, '');
              /* "Payment #14" is not a document number, it is this page
                 admitting the payment was entered without a reference. Dimmed
                 so a column of real bill numbers stays scannable. */
              const weakRef = !r.ref || /^Payment #/.test(r.ref);
              return (
                <tr key={i} className={`lg-tr lg-tr--${r.type}`}>
                  <td className="lg-date">{dmy(r.date)}</td>
                  <td><span className={`lg-ref${weakRef ? ' lg-ref--dim' : ''}`}>{r.ref || '—'}</span></td>
                  <td className="lg-part">
                    <span className={`lg-tag lg-tag--${tag.cls}`}>{tag.text}</span>
                    {detail}
                  </td>
                  <td className="num lg-dr">{r.debit ? inr(r.debit) : ''}</td>
                  <td className="num lg-cr">{r.credit ? inr(r.credit) : ''}</td>
                  <td className="num lg-bal">
                    {inr(r.balance)} <em>{r.balance_direction.toUpperCase()}</em>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="lg-foot">
        <Info size={13} />
        <span>This statement is assembled from documents — nothing here can be typed in directly.
        To reduce what is owed, issue a {hub ? 'debit note against the purchase invoice' : 'credit note against the invoice'}.</span>
      </p>
    </div>
  );
}
