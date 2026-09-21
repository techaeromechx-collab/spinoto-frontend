import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client.js';
import LedgerPanel from '../components/LedgerPanel.jsx';
import { Wallet, RefreshCw, Download, AlertCircle, ChevronRight, Clock } from 'lucide-react';
import '../styles/PayablesPage.css';

/**
 * What we owe the hubs, and each hub's statement behind it.
 *
 * ── WHY THIS IS ONE PAGE AND NOT TWO ───────────────────────────────────────
 *
 * The question is never "show me a list" — it is "who are we behind on, and
 * what does their account actually look like". Splitting those across a list
 * page and a profile tab makes somebody navigate between them with a figure
 * held in their head. Clicking a row opens the statement in place instead.
 *
 * Both halves read the same ledger engine the customer statement uses, with
 * the sign inverted: a purchase invoice is a credit here, our payment is a
 * debit, and a positive closing balance means we owe them.
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

function downloadCSV(filename, rows, headers) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob([[headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n')],
    { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* Age bands. 45 days is the one that matters commercially — MSME payment terms
   run to 45 days, and a hub kept waiting longer than that is a relationship
   problem before it is an accounting one. */
const ageClass = d => (d > 45 ? 'bad' : d > 30 ? 'warn' : 'ok');

export default function PayablesPage() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [openHub, setOpenHub] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await api('/api/ledger/payables')); }
    catch (e) { setError(e.message || 'Could not load'); setData(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const exportCsv = () => data && downloadCSV('hub-payables.csv',
    data.items.map(r => [r.hub_name, r.open_invoices, r.outstanding, dmy(r.oldest), r.oldest_days]),
    ['Hub', 'Open invoices', 'Outstanding', 'Oldest invoice', 'Days waiting']);

  const oldest = data?.items?.reduce((m, r) => Math.max(m, r.oldest_days || 0), 0) || 0;

  return (
    <div className="pay-page">
      <header className="pay-header">
        <div className="pay-header__left">
          <span className="pay-header__icon"><Wallet size={19} /></span>
          <div>
            <h1 className="pay-title">Hub payables</h1>
            <p className="pay-sub">What we owe, and how long they have been waiting</p>
          </div>
        </div>
        <div className="pay-header__right">
          <button className="pay-icon-btn" onClick={load} disabled={loading} title="Reload">
            <RefreshCw size={15} className={loading ? 'pay-spin' : ''} />
          </button>
          <button className="pay-btn" onClick={exportCsv} disabled={!data?.items?.length}>
            <Download size={15} /> CSV
          </button>
        </div>
      </header>

      {error && <p className="pay-error"><AlertCircle size={15} /><span>{error}</span></p>}
      {loading && !data && <p className="pay-empty">Loading…</p>}

      {data && (
        <>
          <div className="pay-kpis">
            <div className="pay-kpi pay-kpi--strong">
              <span className="pay-kpi__label">Total owed</span>
              <span className="pay-kpi__value">{inr(data.total)}</span>
            </div>
            <div className="pay-kpi">
              <span className="pay-kpi__label">Hubs waiting</span>
              <span className="pay-kpi__value">{data.hubs}</span>
            </div>
            <div className="pay-kpi">
              <span className="pay-kpi__label">Open invoices</span>
              <span className="pay-kpi__value">
                {data.items.reduce((s, r) => s + (r.open_invoices || 0), 0)}
              </span>
            </div>
            <div className={`pay-kpi${oldest > 45 ? ' pay-kpi--bad' : ''}`}>
              <span className="pay-kpi__label">Longest wait</span>
              <span className="pay-kpi__value">{oldest} days</span>
            </div>
          </div>

          {data.items.length === 0 ? (
            <p className="pay-empty pay-empty--good">Nothing outstanding. Every hub is settled.</p>
          ) : (
            <div className="pay-list">
              {data.items.map(row => {
                const open = openHub === row.hub_id;
                return (
                  <div key={row.hub_id} className={`pay-row-wrap${open ? ' pay-row-wrap--open' : ''}`}>
                    <button
                      className="pay-row"
                      onClick={() => setOpenHub(open ? null : row.hub_id)}
                      aria-expanded={open}
                    >
                      <ChevronRight size={15} className={`pay-caret${open ? ' pay-caret--on' : ''}`} />
                      <span className="pay-row__name">{row.hub_name}</span>
                      <span className="pay-row__inv">
                        {row.open_invoices} invoice{row.open_invoices === 1 ? '' : 's'}
                      </span>
                      <span className={`pay-row__age pay-row__age--${ageClass(row.oldest_days)}`}>
                        <Clock size={12} /> {row.oldest_days}d
                        <em>since {dmy(row.oldest)}</em>
                      </span>
                      <span className="pay-row__amt">{inr0(row.outstanding)}</span>
                    </button>

                    {open && (
                      <div className="pay-statement">
                        <LedgerPanel partyType="hub" partyKey={String(row.hub_id)} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
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
