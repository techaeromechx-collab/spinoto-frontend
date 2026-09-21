import { useEffect, useState, useCallback } from 'react';
import { api, API_URL, getToken } from '../api/client.js';
import { Download, FileText, AlertCircle, Info } from 'lucide-react';
import '../styles/LedgerPanel.css';

/**
 * A party's running statement. Customer or hub — same component, opposite sign.
 *
 * Reads only. Every row is a document that already exists somewhere else, so
 * there is nothing here to edit: a correction is a credit note, and the
 * starting figure is an opening balance. See ledger.controller.js for why.
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

  const load = useCallback(async () => {
    if (!partyKey) return;
    setLoading(true); setError('');
    try {
      setData(await api(`/api/ledger/${partyType}/${encodeURIComponent(partyKey)}`));
    } catch (e) { setError(e.message || 'Could not load the statement'); setData(null); }
    finally { setLoading(false); }
  }, [partyType, partyKey]);
  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <p className="lg-empty">Loading statement…</p>;
  if (error) return <p className="lg-error"><AlertCircle size={15} /><span>{error}</span></p>;
  if (!data) return null;

  const { party, rows, totals, ageing } = data;
  const owing = totals.closing_direction === (partyType === 'customer' ? 'dr' : 'cr');

  /* A raw authenticated fetch rather than api(), which parses JSON — the
     pattern client.js documents API_URL and getToken for. Opened in a new tab
     instead of downloaded: the common case is reading it before deciding
     whether to send it, and a forced download makes that two steps. */
  const openPdf = async () => {
    setPdfBusy(true); setError('');
    try {
      const res = await fetch(`${API_URL}/api/ledger/${partyType}/${encodeURIComponent(partyKey)}/pdf`,
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

  const exportCsv = () => downloadCSV(
    `ledger-${party.name.replace(/[^\w]+/g, '-').toLowerCase()}.csv`,
    rows.map(r => [dmy(r.date), TYPE_LABEL[r.type] || r.type, r.ref, r.particulars,
      r.debit || '', r.credit || '', r.balance, r.balance_direction.toUpperCase()]),
    ['Date', 'Type', 'Reference', 'Particulars', 'Debit', 'Credit', 'Balance', 'Dr/Cr']
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
          <span>Opening</span>
          <strong>{totals.opening ? `${inr0(totals.opening)} ${totals.opening_direction?.toUpperCase()}` : '—'}</strong>
        </div>
        <div className="lg-sum"><span>Total debit</span><strong>{inr0(totals.debit)}</strong></div>
        <div className="lg-sum"><span>Total credit</span><strong>{inr0(totals.credit)}</strong></div>
        <div className={`lg-sum lg-sum--closing${owing ? ' lg-sum--owed' : ''}`}>
          <span>{partyType === 'customer'
            ? (owing ? 'Customer owes' : 'In credit')
            : (owing ? 'We owe this hub' : 'Overpaid')}</span>
          <strong>{inr(totals.closing)}</strong>
        </div>
      </div>

      {ageing && totals.closing > 0.011 && owing && (
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
              <th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="lg-td-empty">Nothing on this account yet.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className={`lg-tr lg-tr--${r.type}`}>
                <td className="lg-date">{dmy(r.date)}</td>
                <td><span className="lg-ref">{r.ref}</span></td>
                <td className="lg-part">{r.particulars}</td>
                <td className="num">{r.debit ? inr(r.debit) : ''}</td>
                <td className="num">{r.credit ? inr(r.credit) : ''}</td>
                <td className="num lg-bal">
                  {inr(r.balance)} <em>{r.balance_direction.toUpperCase()}</em>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="lg-foot">
        <Info size={13} />
        <span>This statement is assembled from documents — nothing here can be typed in directly.
        To reduce what is owed, issue a credit note against the invoice.</span>
      </p>
    </div>
  );
}
