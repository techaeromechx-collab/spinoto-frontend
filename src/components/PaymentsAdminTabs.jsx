import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Landmark, RefreshCw, ShieldCheck, AlertTriangle, CheckCircle2, Copy, Link2, X, Loader2,
  CreditCard, Send, RotateCcw, Clock, XCircle, Download,
} from 'lucide-react';
import { api, API_URL, getToken } from '../api/client.js';
import { openRefundVoucher } from '../lib/documentPdf.js';

const fmt = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

/**
 * What each hub collected, over the same filters as the Transactions list.
 *
 * WHY THIS COULD NOT EXIST BEFORE
 * ───────────────────────────────
 * payment_transactions has always carried hub_id; customer_invoice_payments —
 * the table that records money actually received — did not, until migration
 * 131. So "what did each hub collect" was answerable for online payments and
 * not for cash, which for most workshops is the larger half. Now both sides of
 * the union carry it and the answer is one GROUP BY.
 *
 * The split matters as much as the total: a hub taking everything in cash and a
 * hub taking everything online have very different reconciliation work behind
 * the same figure.
 */
export function HubCollectionsPanel({ qs = '' }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const out = await api(`/api/payments/by-hub${qs ? `?${qs}` : ''}`);
      setRows(out.items || []);
    } catch (e) {
      setErr(e.message || 'Could not load hub collections.');
      setRows([]);
    } finally { setLoading(false); }
  }, [qs]);

  useEffect(() => { load(); }, [load]);

  const totals = rows.reduce((a, r) => ({
    collected: a.collected + Number(r.collected || 0),
    manual:    a.manual    + Number(r.collected_manual || 0),
    online:    a.online    + Number(r.collected_online || 0),
    payments:  a.payments  + Number(r.payments || 0),
  }), { collected: 0, manual: 0, online: 0, payments: 0 });

  if (err) return <div className="pay-empty" style={{ color: '#b45309' }}><AlertTriangle size={18} /> {err}</div>;
  if (loading) return <div className="pay-empty"><Loader2 size={20} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} /></div>;
  if (!rows.length) return <div className="pay-empty"><CreditCard size={20} /><div>Nothing collected in this period.</div></div>;

  return (
    <div className="lb-list">
      <div className="lb-scroll-x">
        <table className="pay-table">
          <thead>
            <tr>
              <th>Hub</th>
              <th className="pay-num">Payments</th>
              <th className="pay-num">By hand</th>
              <th className="pay-num">Online</th>
              <th className="pay-num">Collected</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.hub_id ?? 'none'}>
                <td><div className="pay-name">{r.hub_name}</div></td>
                <td className="pay-num pay-sub">{r.payments}</td>
                <td className="pay-num pay-sub">{fmt(r.collected_manual)}</td>
                <td className="pay-num pay-sub">{fmt(r.collected_online)}</td>
                <td className="pay-num"><div className="pay-amt">{fmt(r.collected)}</div></td>
              </tr>
            ))}
            {/* A total row, because the reason to open this screen is usually to
                reconcile one hub against everything. */}
            <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
              <td>All hubs</td>
              <td className="pay-num">{totals.payments}</td>
              <td className="pay-num">{fmt(totals.manual)}</td>
              <td className="pay-num">{fmt(totals.online)}</td>
              <td className="pay-num"><div className="pay-amt">{fmt(totals.collected)}</div></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Settlements — money the gateway has actually transferred into the bank.
 *
 * ── Why this is a separate screen and not a column on the payments list ─────
 * A settlement is a different kind of event from a payment. One transfer covers
 * many payments, arrives two or three days later, and is net of the gateway's
 * commission and the GST on that commission. Putting it beside "collected"
 * invites the reading that they should match, and they never will.
 *
 * The three figures are laid out as gross → fees → net for exactly that reason:
 * the gap between what customers paid and what reached the bank is the point of
 * the screen, not a rounding error to be hidden.
 *
 * ── Why nothing here is editable ────────────────────────────────────────────
 * Every row comes from the gateway. A hand-typed settlement is a number that
 * agrees with nothing — not the bank statement, not the payments it claims to
 * cover — and its only possible effect is to make a reconciliation that was
 * failing look like it passed.
 */
/**
 * Money the workshop is holding that belongs to no invoice.
 *
 * WHY THIS SCREEN HAS TO EXIST
 * ────────────────────────────
 * An advance sits unallocated until its invoice is raised, which is normal and
 * usually brief. What is not brief is the one where the customer never came
 * back: the job was cancelled, the car was collected, and ₹2,000 stayed in the
 * account with nothing pointing at it.
 *
 * At some point that money is either a refund the company owes or income it
 * should recognise, and neither answer is available to anyone who cannot see
 * the list. Without this screen it is discovered at year end, by an accountant,
 * from a bank statement.
 *
 * Oldest first, deliberately. The top of this list is the part that needs a
 * decision; the bottom is this morning's advances doing exactly what they
 * should.
 */
export function UnallocatedPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const out = await api('/api/payments/unallocated');
      setItems(out.items || []);
    } catch (e) {
      setErr(e.message || 'Could not load unallocated payments.');
      setItems([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const total = items.reduce((s, r) => s + Number(r.remaining || 0), 0);

  if (err) return <div className="pay-empty" style={{ color: '#b45309' }}><AlertTriangle size={18} /> {err}</div>;
  if (loading) return <div className="pay-empty"><Loader2 size={20} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} /></div>;
  if (!items.length) {
    return (
      <div className="pay-empty">
        <CheckCircle2 size={20} style={{ color: '#16a34a' }} />
        <div>Every payment is against an invoice. Nothing is being held.</div>
      </div>
    );
  }

  return (
    <>
      {/* Classed so the full-bleed page can give it back the inset the
          table is meant to lose. Without a name there is nothing to
          target, and it loses its first pixels off the left edge. */}
      <div className="pay-panelbar" style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: 99, padding: '5px 13px', fontSize: 13, fontWeight: 700 }}>
          <AlertTriangle size={14} /> {fmt(total)} held against no invoice
        </span>
        <button type="button" className="btn btn-ghost" onClick={load}
                style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 5 }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <div className="lb-list">
        <div className="lb-scroll-x">
          <table className="pay-table">
            <thead>
              <tr>
                <th>Receipt</th><th>Customer</th><th>Vehicle</th><th>Hub</th>
                <th>Taken</th><th className="pay-num">Held</th><th className="pay-num">Waiting</th>
              </tr>
            </thead>
            <tbody>
              {items.map(r => {
                const days = Number(r.days_held || 0);
                // 60 days is not a rule from anywhere — it is long enough that
                // an ordinary job would have been invoiced, and short enough to
                // still be fixable. It colours a row; it does not do anything.
                const stale = days >= 60;
                return (
                  <tr key={r.id}>
                    <td><span className="pay-ref">{r.voucher_no || '—'}</span></td>
                    <td className="pay-sub">{r.mobile || '—'}</td>
                    <td className="pay-sub">{r.vehicle_number || '—'}</td>
                    <td className="pay-sub">{r.hub_name || '—'}</td>
                    <td className="pay-sub">
                      {r.paid_at ? new Date(r.paid_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}
                    </td>
                    <td className="pay-num"><div className="pay-amt">{fmt(r.remaining)}</div></td>
                    <td className="pay-num" style={{ color: stale ? '#b45309' : 'var(--text-muted)', fontWeight: stale ? 700 : 400 }}>
                      {days} day{days === 1 ? '' : 's'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export function SettlementsPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  // Which settlement is opened out, and what is inside the ones already asked
  // for. Cached by id rather than refetched on every toggle: the contents of a
  // settled transfer are finished history and cannot change while the screen is
  // open, so re-asking would be a round trip for a guaranteed identical answer.
  const [openId, setOpenId] = useState(null);
  const [inside, setInside] = useState({});      // { [settlementId]: rows[] }
  const [insideBusy, setInsideBusy] = useState(false);

  async function toggle(s) {
    if (openId === s.id) { setOpenId(null); return; }
    setOpenId(s.id);
    if (inside[s.id]) return;
    setInsideBusy(true);
    try {
      const r = await api(`/api/payments/settlements/${s.id}/payments`);
      setInside(prev => ({ ...prev, [s.id]: r.items || [] }));
    } catch (e) {
      // Kept against the id, so the message appears in the row that failed
      // rather than as a page-level error about something else.
      setInside(prev => ({ ...prev, [s.id]: { error: e.message || 'Could not load.' } }));
    } finally { setInsideBusy(false); }
  }

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await api('/api/payments/settlements');
      setItems(r.items || []);
    } catch (e) {
      setError(e.message || 'Could not load settlements.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function sync() {
    setSyncing(true); setError(''); setNote('');
    try {
      const r = await api('/api/payments/settlements/sync', { method: 'POST' });
      setNote(`Checked ${r.from} to ${r.to} — ${r.fetched} settlement${r.fetched === 1 ? '' : 's'} found.`);
      await load();
    } catch (e) {
      setError(e.message || 'Could not fetch settlements from the gateway.');
    } finally { setSyncing(false); }
  }

  const totals = items.reduce((a, s) => ({
    gross: a.gross + Number(s.gross || 0),
    fees:  a.fees  + Number(s.fees || 0) + Number(s.tax || 0),
    net:   a.net   + Number(s.amount || 0),
  }), { gross: 0, fees: 0, net: 0 });

  return (
    <div>
      <div className="lb-toolbar">
        <div className="lb-count">
          {loading ? 'Loading…' : `${items.length} settlement${items.length === 1 ? '' : 's'}`}
        </div>
        <div className="lb-toolbar-right">
          <button type="button" className="btn btn-ghost" onClick={sync} disabled={syncing}>
            <RefreshCw size={15} /> {syncing ? 'Fetching…' : 'Fetch from gateway'}
          </button>
        </div>
      </div>

      {note && <div className="pay-dalert pay-dalert--idle" style={{ marginBottom: 10 }}>{note}</div>}
      {error && (
        <div className="pay-dalert pay-dalert--bad" style={{ marginBottom: 10 }}>
          <AlertTriangle size={15} /> <div>{error}</div>
        </div>
      )}

      {items.length > 0 && (
        <div className="pay-kpis" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
          <div className="pay-kpi">
            <div className="pay-kpi-label">Gross collected</div>
            <div className="pay-kpi-value">{fmt(totals.gross)}</div>
            <div className="pay-kpi-hint">What customers paid, across these settlements.</div>
          </div>
          <div className="pay-kpi pay-kpi--warn">
            <div className="pay-kpi-label">Gateway fees + tax</div>
            <div className="pay-kpi-value">−{fmt(totals.fees)}</div>
            <div className="pay-kpi-hint">The provider's commission and the GST on it. An expense.</div>
          </div>
          <div className="pay-kpi pay-kpi--ok">
            <div className="pay-kpi-label">Reached the bank</div>
            <div className="pay-kpi-value">{fmt(totals.net)}</div>
            <div className="pay-kpi-hint">Match these against the bank statement, by UTR.</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="pay-empty">
          <Loader2 size={20} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : items.length === 0 ? (
        <div className="pay-empty">
          <Landmark size={20} />
          <div>No settlements recorded yet.</div>
          <div className="pay-dnote" style={{ maxWidth: 420, textAlign: 'center' }}>
            The gateway holds collected money for two to three working days before
            transferring it. Use "Fetch from gateway" once payments have been taken.
          </div>
        </div>
      ) : (
        <div className="lb-list">
          <div className="lb-scroll-x">
            <table className="pay-table">
              <thead>
                <tr>
                  <th>Settled on</th>
                  <th>Bank reference (UTR)</th>
                  <th className="pay-num">Gross</th>
                  <th className="pay-num">Fees + tax</th>
                  <th className="pay-num">Net to bank</th>
                  <th className="pay-num">Payments</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map(s => {
                  const rows = inside[s.id];
                  const failed = rows && !Array.isArray(rows);
                  const isOpen = openId === s.id;
                  return (
                  <Fragment key={s.id}>
                  <tr style={{ cursor: 'default' }}>
                    <td>{s.settled_at ? new Date(s.settled_at).toLocaleDateString('en-IN',
                      { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                    <td><code className="pay-code">{s.utr || '—'}</code></td>
                    <td className="pay-num">{fmt(s.gross)}</td>
                    <td className="pay-num pay-refunded">−{fmt(Number(s.fees) + Number(s.tax))}</td>
                    <td className="pay-num"><span className="pay-amt">{fmt(s.amount)}</span></td>
                    {/* The count is the way in. It read as a dash on every row
                        until the sync started writing settlement_id, and it is
                        still a dash for anything settled before that — so a
                        zero stays plain text rather than becoming a button
                        that opens an empty drawer. */}
                    <td className="pay-num pay-sub">
                      {s.payment_count > 0 ? (
                        <button type="button" className="pay-linkbtn" onClick={() => toggle(s)}
                                aria-expanded={isOpen}>
                          {s.payment_count} {isOpen ? '▲' : '▼'}
                        </button>
                      ) : '—'}
                    </td>
                    <td><span className="pay-st pay-st--idle">{s.status || '—'}</span></td>
                  </tr>
                  {isOpen && (
                    <tr className="pay-subrow">
                      <td colSpan={7}>
                        {!rows && insideBusy && <div className="pay-dnote">Loading…</div>}
                        {failed && <div className="pay-dnote">{rows.error}</div>}
                        {Array.isArray(rows) && rows.length === 0 && (
                          <div className="pay-dnote">
                            Nothing is linked to this settlement yet. Press “Fetch from gateway” —
                            settlements taken before this breakdown existed are matched up on the
                            next sync.
                          </div>
                        )}
                        {Array.isArray(rows) && rows.length > 0 && (
                          <table className="pay-subtable">
                            <thead>
                              <tr>
                                <th>Paid on</th><th>Customer</th><th>Invoice</th>
                                <th>Reference</th><th className="pay-num">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map(p => (
                                <tr key={p.id}>
                                  <td className="pay-sub">{p.created_at
                                    ? new Date(p.created_at).toLocaleDateString('en-IN',
                                        { day: 'numeric', month: 'short' }) : '—'}</td>
                                  <td>{p.customer_name || '—'}</td>
                                  <td>{p.entity_type === 'customer_invoice' && p.entity_id
                                    ? <span className="pay-inv">CI-{String(p.entity_id).padStart(6, '0')}</span>
                                    : '—'}</td>
                                  <td><code className="pay-code">{p.gateway_payment_id || p.txn_ref}</code></td>
                                  <td className="pay-num pay-amt">{fmt(p.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Refunds — every rupee sent back, and the tax document for each.
 *
 * ── THE SCREEN THAT DID NOT EXIST ───────────────────────────────────────────
 * A refund voucher is a numbered tax document. Until this panel, the only link
 * to one was on the success screen of the refund dialog — close it and the
 * document was unreachable from anywhere in the application. For a GATEWAY
 * refund it was never reachable at all: the number is issued by the webhook,
 * days after that dialog closed, so the one button that opened it was shown at
 * the one moment it did not yet exist.
 *
 * ── BOTH KINDS, IN ONE LIST ─────────────────────────────────────────────────
 * A cash-advance refund has no txn_ref and appeared on no screen. The endpoint
 * LEFT JOINs both the ledger row and the transaction so neither category is
 * dropped — see listRefunds.
 *
 * ── WHY THE VOUCHER BUTTON IS CONDITIONAL ───────────────────────────────────
 * A pending gateway refund has no voucher number yet, because the money has not
 * gone back and a document saying it has would not be true. The row shows the
 * status instead of a button that 404s.
 */
const REFUND_STATUS = {
  pending:   { label: 'On its way', icon: Clock,        cls: 'pay-st--idle' },
  processed: { label: 'Refunded',   icon: CheckCircle2, cls: 'pay-st--ok'   },
  failed:    { label: 'Failed',     icon: XCircle,      cls: 'pay-st--bad'  },
};

export function RefundsPanel() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const range = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
  }, [month]);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ from: range.from, to: range.to });
    if (status) p.set('status', status);
    if (q.trim()) p.set('q', q.trim());
    return p.toString();
  }, [range, status, q]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await api(`/api/payments/refunds?${qs}`);
      setItems(r.items || []);
      setTotal(Number(r.total_processed || 0));
    } catch (e) {
      setError(e.message || 'Could not load refunds.');
      setItems([]); setTotal(0);
    } finally { setLoading(false); }
  }, [qs]);

  useEffect(() => { load(); }, [load]);

  const monthLabel = new Date(`${month}-01T00:00:00`)
    .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div>
      <div className="lb-toolbar">
        <div className="lb-count">
          {loading ? 'Loading…' : `${items.length} refund${items.length === 1 ? '' : 's'} · ${fmt(total)} sent back · ${monthLabel}`}
        </div>
        <div className="lb-toolbar-right">
          <input className="form-input" style={{ width: 190 }} placeholder="Voucher, reference or reason"
                 value={q} onChange={e => setQ(e.target.value)} />
          <input type="month" className="form-input" style={{ width: 150 }}
                 value={month} max={new Date().toISOString().slice(0, 7)}
                 onChange={e => setMonth(e.target.value)} />
          <select className="form-input" style={{ width: 140 }}
                  value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">Any status</option>
            <option value="processed">Refunded</option>
            <option value="pending">On its way</option>
            <option value="failed">Failed</option>
          </select>
          <button type="button" className="btn btn-ghost" onClick={load} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="pay-dalert pay-dalert--bad" style={{ marginBottom: 10 }}>
          <AlertTriangle size={15} /> <div>{error}</div>
        </div>
      )}

      {loading ? (
        <div className="pay-empty">
          <Loader2 size={20} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : items.length === 0 ? (
        <div className="pay-empty">
          <RotateCcw size={20} />
          <div>No refunds in {monthLabel}.</div>
        </div>
      ) : (
        <div className="lb-list">
          <div className="lb-scroll-x">
            <table className="pay-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Credit note</th>
                  <th>Customer</th>
                  <th className="pay-num">Amount</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Refunded by</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map(rf => {
                  const m = REFUND_STATUS[rf.status] || { label: rf.status, icon: Clock, cls: 'pay-st--idle' };
                  const Icon = m.icon;
                  return (
                    <tr key={rf.id}>
                      <td className="pay-sub">
                        {new Date(rf.created_at).toLocaleDateString('en-IN',
                          { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td>
                        {rf.voucher_no
                          ? <span className="pay-ref">{rf.voucher_no}</span>
                          : <span className="pay-sub">— not issued yet —</span>}
                        {/* What it reverses, so the row is traceable back to the
                            money without opening anything. */}
                        {rf.receipt_voucher_no && (
                          <div className="pay-sub">against {rf.receipt_voucher_no}</div>
                        )}
                        {!rf.receipt_voucher_no && rf.txn_ref && (
                          <div className="pay-sub">against {rf.txn_ref}</div>
                        )}
                      </td>
                      <td>
                        <div className="pay-name">{rf.customer_name || '—'}</div>
                        <div className="pay-sub">{rf.mobile || ''}</div>
                      </td>
                      <td className="pay-num"><div className="pay-amt">{fmt(rf.amount)}</div></td>
                      <td className="pay-sub" style={{ maxWidth: 260, whiteSpace: 'normal' }}>
                        {rf.reason || '—'}
                        {rf.error_description && (
                          <div className="pay-refunded">{rf.error_description}</div>
                        )}
                      </td>
                      <td><span className={`pay-st ${m.cls}`}><Icon size={12} /> {m.label}</span></td>
                      <td className="pay-sub">{rf.requested_by_name || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {rf.voucher_no && (
                          <button type="button" className="pay-linkbtn"
                                  title={`Open credit note ${rf.voucher_no}`}
                                  onClick={() => openRefundVoucher(rf.id)
                                    .catch(e => setError(e.message || 'Could not open the credit note.'))}>
                            Credit note
                          </button>
                        )}
                        {rf.receipt_token && (
                          <button type="button" className="pay-linkbtn"
                                  title="Copy the customer's own link to the original receipt"
                                  onClick={() => {
                                    navigator.clipboard?.writeText(
                                      `${window.location.origin}/advance/${rf.receipt_token}`);
                                  }}>
                            Copy link
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Payouts — money going OUT to workshops.
 *
 * ── WHY THIS IS A TAB AND NOT ROWS IN THE TRANSACTIONS LIST ─────────────────
 * That list is money in, and every total above it sums those rows. A payout
 * dropped among them would be added to "Collected" — a figure that is supposed
 * to mean what customers paid — and no filter could separate them again, because
 * the union underneath has no column for direction.
 *
 * ── WHY IT IS READ-ONLY ─────────────────────────────────────────────────────
 * Payouts are STARTED on the Payouts page, where the outstanding invoices are.
 * This tab answers a different question: what left the bank account, what is
 * still in flight, and what failed or bounced back. That is reconciliation, and
 * it is the same split that already exists between the Customer Invoices page
 * and Payments → Transactions.
 *
 * The one action here is Refresh, and it is not really an edit: money leaving
 * has no browser callback, so if a webhook was missed a payout stays in flight
 * for ever unless somebody asks the provider directly.
 *
 * ── WHAT IS DELIBERATELY MISSING ────────────────────────────────────────────
 * Payments recorded by hand. They belong here by rights — the question is "what
 * have we paid this hub", not "what did the provider send" — but they already
 * have a screen that groups batches and knows how to delete them, and building a
 * second reader over hub_payments would give two answers to one question. The
 * link below goes there instead.
 */
const PAYOUT_STATUS = {
  created:    { label: 'Not sent',   icon: Clock,        cls: 'pay-st--idle' },
  queued:     { label: 'Queued',     icon: Clock,        cls: 'pay-st--idle' },
  processing: { label: 'Processing', icon: Loader2,      cls: 'pay-st--idle' },
  processed:  { label: 'Paid',       icon: CheckCircle2, cls: 'pay-st--ok'   },
  failed:     { label: 'Failed',     icon: XCircle,      cls: 'pay-st--bad'  },
  // Amber rather than red: unlike a failure, money DID leave and has come back,
  // so the invoice is open again and there is work to redo.
  reversed:   { label: 'Reversed',   icon: RotateCcw,    cls: 'pay-st--warn' },
  cancelled:  { label: 'Cancelled',  icon: XCircle,      cls: 'pay-st--idle' },
};

function PayoutStatusChip({ status }) {
  const m = PAYOUT_STATUS[status] || { label: status, icon: Clock, cls: 'pay-st--idle' };
  const Icon = m.icon;
  return <span className={`pay-st ${m.cls}`}><Icon size={12} /> {m.label}</span>;
}

export function PayoutsPanel() {
  const [data, setData] = useState({ items: [], in_flight: [], problems: [] });
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [note, setNote] = useState('');

  // A month, not a free date range.
  //
  // The reason to open this screen is to reconcile a period against a bank
  // statement, and a statement is a month. Two date boxes make that a two-step
  // job that can be got subtly wrong — the 31st omitted, or a range spanning two
  // months that looks like one — every single time.
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [source, setSource] = useState('');

  const range = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const from = `${month}-01`;
    // Day 0 of the NEXT month is the last day of this one, and it gets February
    // and leap years right without a table of month lengths.
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from, to: `${month}-${String(last).padStart(2, '0')}` };
  }, [month]);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ from: range.from, to: range.to });
    if (source) p.set('source', source);
    return p.toString();
  }, [range, source]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [list, sum] = await Promise.all([
        api(`/api/hub-payouts?${qs}`),
        api(`/api/hub-payouts/summary?${qs}`),
      ]);
      setData({ items: list.items || [], in_flight: list.in_flight || [], problems: list.problems || [] });
      setSummary(sum);
    } catch (e) {
      setError(e.message || 'Could not load payouts.');
      setData({ items: [], in_flight: [], problems: [] });
      setSummary(null);
    } finally { setLoading(false); }
  }, [qs]);

  useEffect(() => { load(); }, [load]);

  async function refresh(p) {
    setBusyId(p.id); setError(''); setNote('');
    try {
      const r = await api(`/api/hub-payouts/${p.id}/refresh`, { method: 'POST' });
      setNote(r.unchanged
        ? `${p.payout_ref} is still ${PAYOUT_STATUS[p.status]?.label.toLowerCase() || p.status}.`
        : `${p.payout_ref} is now ${PAYOUT_STATUS[r.item?.status]?.label.toLowerCase() || r.item?.status}.`);
      await load();
    } catch (e) {
      setError(e.message || 'Could not check that payout.');
    } finally { setBusyId(null); }
  }

  async function exportCsv() {
    // Fetched with the bearer token rather than a plain <a href>, which carries
    // no Authorization header and would just 401.
    try {
      const res = await fetch(`${API_URL}/api/hub-payouts/export?${qs}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('Export failed.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hub-payouts-${month}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message || 'Could not export.');
    }
  }

  const blocked = summary?.blocked_hubs || [];
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN',
    { month: 'long', year: 'numeric' });

  return (
    <div>
      <div className="lb-toolbar">
        <div className="lb-count">
          {loading ? 'Loading…' : `${data.items.length} payment${data.items.length === 1 ? '' : 's'} to ${summary?.paid_hubs ?? 0} hub${summary?.paid_hubs === 1 ? '' : 's'} · ${monthLabel}`}
        </div>
        <div className="lb-toolbar-right">
          <input type="month" className="form-input" style={{ width: 150 }}
                 value={month} max={new Date().toISOString().slice(0, 7)}
                 onChange={e => setMonth(e.target.value)} />
          <select className="form-input" style={{ width: 150 }}
                  value={source} onChange={e => setSource(e.target.value)}>
            <option value="">Everything</option>
            <option value="bank">Bank transfers only</option>
            <option value="hand">Recorded by hand only</option>
          </select>
          <button type="button" className="btn btn-ghost" onClick={exportCsv}>
            <Download size={15} /> Export for CA
          </button>
          <button type="button" className="btn btn-ghost" onClick={load} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      {note && <div className="pay-dalert pay-dalert--idle" style={{ marginBottom: 10 }}>{note}</div>}
      {error && (
        <div className="pay-dalert pay-dalert--bad" style={{ marginBottom: 10 }}>
          <AlertTriangle size={15} /> <div>{error}</div>
        </div>
      )}

      {/* Mock mode is not a footnote. With no keys configured every transfer
          reports success and every purchase invoice reads PAID, having moved
          nothing — on a staging server with real hub data that is the most
          expensive silence in the system. */}
      {summary?.gateway && !summary.gateway.configured && (
        <div className="pay-dalert pay-dalert--bad" style={{ marginBottom: 10 }}>
          <AlertTriangle size={15} />
          <div>
            <strong>Test mode — no money is actually being sent.</strong>{' '}
            The payout provider has no credentials configured, so every transfer below
            reports success without moving anything. Rows whose reference starts{' '}
            <code className="pay-code">pout_mock_</code> are not real.
          </div>
        </div>
      )}
      {summary?.gateway?.configured && !summary.gateway.webhook_configured && (
        <div className="pay-dalert pay-dalert--bad" style={{ marginBottom: 10 }}>
          <AlertTriangle size={15} />
          <div>
            <strong>Payout webhooks are not configured, so transfers are blocked.</strong>{' '}
            A payout's result arrives only by webhook — there is no second channel for money leaving.
            Without it a transfer would sit here for ever and the invoice would never be marked paid.
          </div>
        </div>
      )}

      {summary && (
        <div className="pay-kpis" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
          <div className="pay-kpi pay-kpi--ok">
            <div className="pay-kpi-label">Paid — {monthLabel}</div>
            <div className="pay-kpi-value">{fmt(summary.paid)}</div>
            <div className="pay-kpi-hint">
              Money that left the account, by hand and by transfer together.
              This is the figure that should match the bank statement.
            </div>
          </div>
          <div className="pay-kpi">
            <div className="pay-kpi-label">Of which by bank transfer</div>
            <div className="pay-kpi-value">{fmt(summary.paid_by_transfer)}</div>
            <div className="pay-kpi-hint">
              Sent from here and confirmed with a UTR.
              The other {fmt(summary.paid_by_hand)} was paid from your banking app and recorded.
            </div>
          </div>
          <div className={`pay-kpi ${summary.in_flight > 0 ? 'pay-kpi--warn' : ''}`}>
            <div className="pay-kpi-label">Not money yet</div>
            <div className="pay-kpi-value">{fmt(summary.in_flight)}</div>
            <div className="pay-kpi-hint">
              {summary.in_flight_count} transfer{summary.in_flight_count === 1 ? '' : 's'} sent,
              awaiting the bank. Deliberately excluded from the total on the left.
            </div>
          </div>
        </div>
      )}

      {/* ── In flight ────────────────────────────────────────────────────────
          Above the table and outside every total, because it is not money. A
          sent-but-unconfirmed transfer inside a figure someone reconciles makes
          the month fail to balance by exactly that amount, for a reason that is
          invisible on the screen showing the total. */}
      {data.in_flight.length > 0 && (
        <div className="pay-flight">
          <div className="pay-flight-hd">
            <div>
              <strong>
                In flight — {data.in_flight.length} transfer{data.in_flight.length === 1 ? '' : 's'},{' '}
                {fmt(data.in_flight.reduce((s, p) => s + Number(p.amount), 0))}
              </strong>
              <div className="pay-flight-note">
                Sent to the bank, not yet confirmed. Kept out of the table below and out of every
                total on this screen. These stay visible whichever month you are looking at — a
                transfer stuck since July is the one you most need to see today.
              </div>
            </div>
          </div>
          <table className="pay-subtable">
            <tbody>
              {data.in_flight.map(p => (
                <tr key={p.id}>
                  <td style={{ width: 220 }}>
                    <div className="pay-name">{p.hub_name}</div>
                    <div className="pay-sub">
                      {p.account_last4 ? `${p.bank_name || 'Bank'} ••••${p.account_last4}` : '—'}
                    </div>
                  </td>
                  <td>
                    {(p.lines || []).map(l => (
                      <span key={l.purchase_invoice_id} className="pay-inv" style={{ marginRight: 6 }}>
                        PI-{String(l.purchase_invoice_id).padStart(6, '0')}
                      </span>
                    ))}
                  </td>
                  <td className="pay-num" style={{ width: 130 }}>
                    <span className="pay-amt">{fmt(p.amount)}</span>
                  </td>
                  <td style={{ width: 130 }}><PayoutStatusChip status={p.status} /></td>
                  <td className="pay-sub" style={{ width: 210 }}>
                    Sent {fmtWhen(p.created_at)} · {p.utr ? <code className="pay-code">{p.utr}</code> : 'awaiting UTR'}
                  </td>
                  <td style={{ width: 80 }}>
                    <button type="button" className="pay-linkbtn"
                            disabled={busyId === p.id} onClick={() => refresh(p)}>
                      {busyId === p.id ? 'Checking…' : 'Check now'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Hubs that cannot be paid automatically. Not an error — on day one it is
          every hub — so it says what to do rather than what is wrong. */}
      {blocked.length > 0 && (
        <div className="pay-dalert pay-dalert--warn" style={{ marginBottom: 10 }}>
          <AlertTriangle size={15} />
          <div>
            <strong>
              {blocked.length} hub{blocked.length === 1 ? '' : 's'} with work outstanding
              cannot be paid by bank transfer yet.
            </strong>
            <div style={{ marginTop: 4 }}>
              {blocked.map(b => (
                <div key={b.id} className="pay-sub">
                  {b.hub_name} — {fmt(b.outstanding)} outstanding ·{' '}
                  {b.missing_bank_details
                    ? 'no bank details on file'
                    : 'bank details captured, not registered with the provider yet'}
                </div>
              ))}
            </div>
            <div className="pay-sub" style={{ marginTop: 4 }}>
              Pay those from your banking app and record them on the Payouts page — they still
              appear in the table below and in the export.
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="pay-empty">
          <Loader2 size={20} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : data.items.length === 0 ? (
        <div className="pay-empty">
          <Send size={20} />
          <div>Nothing was paid to any hub in {monthLabel}.</div>
          <div className="pay-dnote" style={{ maxWidth: 460, textAlign: 'center' }}>
            Payouts are made on the Payouts page — either by bank transfer from here,
            or from your own banking app and recorded there. Both kinds show up in this list.
          </div>
        </div>
      ) : (
        <div className="lb-list">
          <div className="lb-scroll-x">
            <table className="pay-table">
              <thead>
                <tr>
                  <th>Paid on</th>
                  <th>Hub</th>
                  <th>For</th>
                  <th className="pay-num">Amount</th>
                  <th>Method</th>
                  <th>Bank reference</th>
                  <th>Recorded by</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map(p => (
                  <tr key={p.group_key}>
                    <td className="pay-sub">{fmtDay(p.paid_at)}</td>
                    <td>
                      <div className="pay-name">{p.hub_name}</div>
                      <div className="pay-sub">
                        {p.hub_payout_id && p.account_last4
                          ? `${p.bank_name || 'Bank'} ••••${p.account_last4}`
                          : ''}
                      </div>
                    </td>
                    <td>
                      {(p.invoices || []).map(i => (
                        <span key={i.purchase_invoice_id} className="pay-inv" style={{ marginRight: 6 }}>
                          PI-{String(i.purchase_invoice_id).padStart(6, '0')}
                        </span>
                      ))}
                      {p.invoice_count > 1 && (
                        <div className="pay-sub">{p.invoice_count} invoices, one payment</div>
                      )}
                    </td>
                    <td className="pay-num"><div className="pay-amt">{fmt(p.amount)}</div></td>
                    <td className="pay-sub">
                      {METHOD_LABEL[p.method] || p.method || '—'}
                      {/* The tag answers "where do I look this up" without
                          splitting the list — and therefore without splitting
                          the total, which is the entire point of this screen. */}
                      {p.hub_payout_id
                        ? <span className="pay-tag pay-tag--bank">BANK</span>
                        : <span className="pay-tag pay-tag--hand">BY HAND</span>}
                    </td>
                    <td>
                      {p.utr || p.reference_no
                        ? <code className="pay-code">{p.utr || p.reference_no}</code>
                        : <span className="pay-sub">—</span>}
                      {p.payout_ref && <div className="pay-sub">{p.payout_ref}</div>}
                    </td>
                    <td className="pay-sub">
                      {p.recorded_by || '—'}
                      {p.hub_payout_id && <div className="pay-sub">automatic</div>}
                    </td>
                  </tr>
                ))}

                {/* Reversed and failed transfers.
                    They carry NO amount, and that is correct rather than a gap:
                    a reversal's ledger rows were deleted, so it contributed
                    nothing. Listed anyway, because a bounced transfer that
                    silently vanishes from the month it happened in is how nobody
                    finds out the hub was never actually paid. */}
                {data.problems.map(p => (
                  <tr key={`x${p.id}`} className="pay-row--problem">
                    <td className="pay-sub">{fmtDay(p.updated_at)}</td>
                    <td><div className="pay-name">{p.hub_name}</div></td>
                    <td>
                      {(p.lines || []).map(l => (
                        <span key={l.purchase_invoice_id} className="pay-inv" style={{ marginRight: 6 }}>
                          PI-{String(l.purchase_invoice_id).padStart(6, '0')}
                        </span>
                      ))}
                    </td>
                    <td className="pay-num">
                      <span className="pay-sub pay-refunded">
                        {p.status === 'reversed' ? '— came back —' : '— never sent —'}
                      </span>
                    </td>
                    <td><PayoutStatusChip status={p.status} /></td>
                    <td className="pay-sub">
                      <span className="pay-refunded">
                        {fmt(p.amount)} {p.status === 'reversed' ? 'reversed' : 'failed'}
                        {p.failure_reason ? ` — ${p.failure_reason}` : ''}
                      </span>
                      <div className="pay-sub">{p.payout_ref} · invoice reopened</div>
                    </td>
                    <td className="pay-sub">{p.requested_by_name || '—'}</td>
                  </tr>
                ))}

                {/* The reason an accountant opened this screen. Server-computed
                    over the whole period, not summed from the visible rows —
                    the same rule the Transactions list follows, and the reason
                    its totals stay right past the first page. */}
                {summary && (
                  <tr className="pay-row--total">
                    <td colSpan={3}>Total paid — {monthLabel}</td>
                    <td className="pay-num"><span className="pay-amt">{fmt(summary.paid)}</span></td>
                    <td colSpan={3} className="pay-sub">
                      {fmt(summary.paid_by_transfer)} by bank transfer ·{' '}
                      {fmt(summary.paid_by_hand)} by hand.
                      {data.problems.some(x => x.status === 'reversed') && ' Reversed transfers contribute nothing.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const METHOD_LABEL = {
  bank_transfer: 'Bank transfer', upi: 'UPI', cash: 'Cash',
  card: 'Card', app_payment: 'In-app', other: 'Other',
};

function fmtDay(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function fmtWhen(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

/**
 * Gateway configuration — status, and the credentials themselves.
 *
 * ── WRITE-ONLY BY CONSTRUCTION ──────────────────────────────────────────────
 * The server returns {configured, last4, source} per credential and never the
 * value, so these inputs only ever go one way. There is nothing on this screen
 * for a screenshot, a browser cache or a stale tab to leak: type a new value to
 * replace, or Clear to delete the database row and fall back to the backend
 * environment variable (shown as "from the server environment").
 *
 * ── WHY THE SECRETS ARE IN THE DATABASE NOW ─────────────────────────────────
 * They used to be environment-only, on the argument that a signing secret in
 * Postgres is a second copy in every backup. True — and it cost a redeploy for
 * every rotation on a host with no shell, which in practice meant the webhook
 * secret went unset, and an unset webhook secret means money arrives and no
 * invoice ever closes. See the adapter's header for the full trade.
 *
 * ── AND WHY THE TEST BUTTON STAYS ───────────────────────────────────────────
 * A saved key and a working key are different things. A revoked key, or a test
 * key on a live server, looks exactly like a good one until a customer tries to
 * pay — only a real round-trip tells them apart.
 */
export function GatewayPanel() {
  const [cfg, setCfg] = useState(null);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState(null);
  const [copied, setCopied] = useState('');

  // Write-only drafts. '' = untouched; the Clear action sends '' explicitly.
  const [keyId, setKeyId] = useState('');
  const [keySecret, setKeySecret] = useState('');
  const [hookSecret, setHookSecret] = useState('');
  const [apiBase, setApiBase] = useState('');
  const [ttl, setTtl] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');

  // The two non-secret fields ARE returned whole, so they seed their inputs.
  const adopt = useCallback((r) => {
    setCfg(r);
    setApiBase(r.settings?.api_base_url?.value || '');
    setTtl(String(r.settings?.link_ttl_days?.value ?? ''));
  }, []);

  useEffect(() => {
    (async () => {
      try { adopt(await api('/api/payments/gateway')); }
      catch (e) { setError(e.message || 'Could not read the gateway configuration.'); }
    })();
  }, [adopt]);

  async function save(body, note) {
    setSaving(true); setError(''); setSaved('');
    // A stale PASS/FAIL beside credentials that just changed is worse than no
    // result at all — it is the exact thing someone reads as confirmation.
    setTest(null);
    try {
      adopt(await api('/api/payments/gateway', { method: 'PUT', body }));
      setKeyId(''); setKeySecret(''); setHookSecret('');
      setSaved(note);
    } catch (e) {
      setError(e.message || 'Could not save.');
    } finally { setSaving(false); }
  }

  async function runTest() {
    setTesting(true); setTest(null);
    try { setTest(await api('/api/payments/gateway/test', { method: 'POST' })); }
    catch (e) { setTest({ ok: false, error: e.message }); }
    finally { setTesting(false); }
  }

  function copy(text, what) {
    navigator.clipboard?.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(''), 1800);
  }

  if (error && !cfg) {
    return <div className="pay-dalert pay-dalert--bad"><AlertTriangle size={15} /> <div>{error}</div></div>;
  }
  if (!cfg) {
    return <div className="pay-empty">
      <Loader2 size={20} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
    </div>;
  }

  const ready = cfg.configured && cfg.webhook_configured;
  const s = cfg.settings || {};

  return (
    <div style={{ maxWidth: 640, padding: '14px 0' }}>
      <div className={`pay-dalert ${ready ? 'pay-dalert--idle' : 'pay-dalert--bad'}`} style={{ marginTop: 0 }}>
        {ready ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
        <div>
          <strong>
            {!cfg.configured ? 'Online payments are not switched on'
              : !cfg.webhook_configured ? 'Webhooks are not configured'
              : cfg.mode === 'live' ? 'Live — real money' : 'Test mode — no real money'}
          </strong>
          <div>
            {!cfg.configured
              ? 'No gateway credentials are set, so checkout runs in a simulated mode. '
                + 'Add the Key ID and Key Secret below.'
              : !cfg.webhook_configured
                // Named as the serious gap it is, not a nice-to-have.
                ? 'Without a webhook secret, any customer whose browser closes before the payment '
                  + 'confirms has paid money this system will never record. Set it below before going live.'
                : cfg.mode === 'live'
                  ? 'Payments taken here charge real cards and settle to the company bank account.'
                  : 'Payments taken here use test cards and settle nowhere. Safe to experiment with.'}
          </div>
        </div>
      </div>

      <div className="pay-dsec">
        <div className="pay-dsec-t">Configuration</div>
        <Row label="Provider" value={cfg.gateway} />
        <Row label="Mode" value={cfg.mode} />
        <Row label="Key ID" value={<code className="pay-code">{cfg.key_id_masked}</code>} />
        <Row label="Webhook secret" value={cfg.webhook_configured ? 'Set' : 'Not set'} />
        <Row label="Payment links last" value={`${s.link_ttl_days?.value ?? 7} days`} />
      </div>

      {cfg.missing?.length > 0 && (
        <div className="pay-dsec">
          <div className="pay-dsec-t">Still missing</div>
          {cfg.missing.map(m => (
            <div key={m} className="pay-drow">
              <span className="pay-dlabel">·</span>
              <span className="pay-dvalue"><code className="pay-code">{m}</code></span>
            </div>
          ))}
        </div>
      )}

      {/* ── Credentials ─────────────────────────────────────────────────── */}
      <div className="pay-dsec">
        <div className="pay-dsec-t">Credentials</div>

        {error && <div className="pay-dalert pay-dalert--bad"><AlertTriangle size={15} /> <div>{error}</div></div>}
        {saved && <div className="pay-dalert pay-dalert--idle"><CheckCircle2 size={15} /> <div>{saved}</div></div>}

        <div className="pay-dnote" style={{ marginBottom: 10 }}>
          Saved values are never shown back — only their last four characters. Saving a field
          replaces it; <em>Clear</em> removes it and falls back to the server environment
          variable, if one is set. Changes take effect on the next payment, with no restart.
        </div>

        <CredField
          label="Key ID" secretish={false} state={s.key_id} busy={saving}
          value={keyId} onChange={setKeyId} type="text"
          placeholder="rzp_live_… or rzp_test_…"
          onSave={() => save({ key_id: keyId.trim() }, 'Key ID saved.')}
          onClear={() => save({ key_id: '' }, 'Key ID cleared.')}
          clearWarning={'Remove the stored Key ID? Online payments fall back to simulated mode '
            + 'unless RAZORPAY_KEY_ID is set in the server environment.'}
          note={'Razorpay Dashboard → Settings → API Keys. The rzp_test_ / rzp_live_ prefix is '
            + 'what decides whether this workshop charges real cards — there is no separate switch.'}
        />

        <CredField
          label="Key Secret" state={s.key_secret} busy={saving}
          value={keySecret} onChange={setKeySecret}
          placeholder="Shown by Razorpay only once, when the key was generated"
          onSave={() => save({ key_secret: keySecret.trim() }, 'Key Secret saved.')}
          onClear={() => save({ key_secret: '' }, 'Key Secret cleared.')}
          clearWarning={'Remove the stored Key Secret? Online payments fall back to simulated mode '
            + 'unless RAZORPAY_KEY_SECRET is set in the server environment.'}
          note="Signs the checkout callback. Without it, nothing a customer's browser reports is believed."
        />

        <CredField
          label="Webhook Secret" state={s.webhook_secret} busy={saving}
          value={hookSecret} onChange={setHookSecret}
          placeholder="The secret you typed when creating the webhook in Razorpay"
          onSave={() => save({ webhook_secret: hookSecret.trim() }, 'Webhook Secret saved.')}
          onClear={() => save({ webhook_secret: '' }, 'Webhook Secret cleared.')}
          clearWarning={'Remove the stored Webhook Secret? Any customer whose browser closes before '
            + 'the payment confirms will have paid money this system never records.'}
          note={'This is the one people skip. It is a DIFFERENT value from the Key Secret, and it must '
            + 'match the Razorpay webhook page character for character — a mismatch is silent on '
            + 'their side and shows here as payments that never turn green.'}
        />
      </div>

      {/* ── Addresses and lifetimes ─────────────────────────────────────── */}
      <div className="pay-dsec">
        <div className="pay-dsec-t">Addresses</div>

        <div className="pay-drow" style={{ alignItems: 'flex-start' }}>
          <span className="pay-dlabel">This API's public address</span>
          <span className="pay-dvalue" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input
              className="form-input" style={{ minWidth: 260, flex: 1 }} disabled={saving}
              placeholder="https://spinoto-backend.onrender.com"
              value={apiBase} onChange={e => setApiBase(e.target.value)}
              aria-label="This API's public address"
            />
            <button type="button" className="btn btn-primary" disabled={saving}
                    onClick={() => save({ api_base_url: apiBase.trim() },
                      apiBase.trim() ? 'Address saved.' : 'Address cleared.')}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </span>
        </div>
        <div className="pay-dnote">
          Only used to build the webhook URL below, for pasting into Razorpay. Not taken from
          the browser's address bar on purpose — you are about to register this as the endpoint
          that marks invoices paid, and it must be this API's own address, not the CRM's.
          {s.api_base_url?.source === 'environment' && ' Currently coming from the server environment.'}
        </div>

        <div style={{ height: 10 }} />

        <div className="pay-drow">
          <span className="pay-dlabel">Payment links last</span>
          <span className="pay-dvalue" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              className="form-input" type="number" min="1" max="90" step="1"
              style={{ width: 90 }} disabled={saving}
              value={ttl} onChange={e => setTtl(e.target.value)}
              aria-label="Payment link lifetime in days"
            />
            <span className="pay-dlabel">days</span>
            <button type="button" className="btn btn-primary" disabled={saving}
                    onClick={() => save({ link_ttl_days: ttl.trim() }, 'Link lifetime saved.')}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </span>
        </div>
        <div className="pay-dnote">
          The default offered when someone creates a payment link; they can still choose a
          different number, up to 90 days. Links already sent keep the expiry they were made with.
        </div>
      </div>

      <div className="pay-dsec">
        <div className="pay-dsec-t">Paste into the gateway dashboard</div>
        <CopyRow label="Webhook URL" value={cfg.webhook_url} onCopy={copy} copied={copied} />
        <div className="pay-dnote">
          Subscribe it to all five: <code className="pay-code">payment.captured</code>,{' '}
          <code className="pay-code">payment.failed</code>,{' '}
          <code className="pay-code">refund.processed</code>,{' '}
          <code className="pay-code">refund.failed</code>,{' '}
          <code className="pay-code">qr_code.credited</code>.
          {' '}The last one is easy to miss and it is the one UPI QR payments need — Razorpay
          fires <code className="pay-code">payment.captured</code> for a QR too, but that payload
          does not say WHICH QR was scanned, so without it a QR payment cannot be matched to
          its invoice.
        </div>
        <div style={{ height: 8 }} />
        <CopyRow label="Payment links start with" value={cfg.pay_link_base} onCopy={copy} copied={copied} />
      </div>

      <div className="pay-dfoot">
        <button type="button" className="btn btn-ghost" onClick={runTest} disabled={testing}>
          <ShieldCheck size={15} /> {testing ? 'Checking…' : 'Test connection'}
        </button>
        {test && (
          <div className={test.ok ? 'pay-st pay-st--ok' : 'pay-st pay-st--bad'}>
            {test.ok ? test.message : test.error}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="pay-drow">
      <span className="pay-dlabel">{label}</span>
      <span className="pay-dvalue">{value}</span>
    </div>
  );
}

/**
 * One write-only credential: its current state, a box to replace it, and — only
 * when there is a database row to remove — a Clear button.
 *
 * Clear is hidden when the value came from the environment, because there would
 * be nothing to delete and the button would appear to do nothing. That is not a
 * cosmetic choice: an admin who clicks Clear, sees the field still say "set",
 * and concludes the screen is broken is the failure this avoids.
 *
 * The input is type="password" for the two real secrets so a shoulder or a
 * screen-share does not read them, and plain text for the Key ID, which is
 * embedded in every checkout page and whose prefix an admin needs to SEE to
 * confirm they pasted the live one rather than the test one.
 */
function CredField({
  label, state, value, onChange, onSave, onClear, clearWarning, note,
  placeholder, busy, secretish = true, type,
}) {
  const configured = !!state?.configured;
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="pay-drow" style={{ alignItems: 'flex-start' }}>
        <span className="pay-dlabel">{label}</span>
        <span className="pay-dvalue">
          {configured
            ? <span className="pay-st pay-st--ok" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <CheckCircle2 size={13} /> set
                {secretish && state.last4 ? <> — ends <code className="pay-code">…{state.last4}</code></> : null}
                {state.source === 'environment' ? ' (from the server environment)' : ''}
              </span>
            : <span className="pay-st pay-st--bad" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <AlertTriangle size={13} /> not set
              </span>}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        <input
          className="form-input" style={{ minWidth: 260, flex: 1 }}
          type={type || (secretish ? 'password' : 'text')}
          autoComplete="new-password" spellCheck={false}
          placeholder={placeholder} value={value} disabled={busy}
          onChange={e => onChange(e.target.value)}
          aria-label={label}
        />
        <button type="button" className="btn btn-primary" disabled={busy || !value.trim()}
                onClick={onSave}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {state?.source === 'database' && (
          <button type="button" className="btn btn-ghost" disabled={busy}
                  onClick={() => window.confirm(clearWarning) && onClear()}>
            Clear
          </button>
        )}
      </div>
      {note && <div className="pay-dnote" style={{ marginTop: 5 }}>{note}</div>}
    </div>
  );
}

function CopyRow({ label, value, onCopy, copied }) {
  return (
    <div className="pay-drow">
      <span className="pay-dlabel">{label}</span>
      <span className="pay-dvalue" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <code className="pay-code">{value || '— not configured —'}</code>
        {value && (
          <button type="button" onClick={() => onCopy(value, label)} aria-label={`Copy ${label}`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', display: 'flex' }}>
            {copied === label ? <CheckCircle2 size={13} /> : <Copy size={13} />}
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * Payment links against one invoice.
 *
 * Shown on the Payments module's Links tab and reusable from the invoice
 * screen. A link is a public URL that keeps working for whoever it is forwarded
 * to, so this list makes the two facts that matter visible at a glance: when it
 * expires, and how many times it has been opened. "I never got the link" is
 * answerable when that count is zero.
 */
export function PaymentLinksPanel({ customerInvoiceId = null }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  // Embedded on a customer invoice rather than standing on the Links tab.
  //
  // Two things follow from that, and both are why this is a flag rather than a
  // second component. The Invoice and Customer columns say the same thing on
  // every row — the invoice number and the customer are already the heading of
  // the page you are looking at — so seven columns compete for a half-width
  // column and the Cancel button falls off the right edge. And the .lb-list
  // chrome around the table is page furniture: a sticky header that binds to
  // .page-scroll and 20px cell padding, both correct on a full-page list and
  // both wrong in a panel beside the Payments box.
  const compact = customerInvoiceId != null;

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = customerInvoiceId ? `?customer_invoice_id=${customerInvoiceId}` : '';
      const r = await api(`/api/payments/links${qs}`);
      setItems(r.items || []);
    } catch (e) {
      setError(e.message || 'Could not load payment links.');
    } finally { setLoading(false); }
  }, [customerInvoiceId]);

  useEffect(() => { load(); }, [load]);

  async function cancel(id) {
    try { await api(`/api/payments/links/${id}/cancel`, { method: 'POST' }); await load(); }
    catch (e) { setError(e.message || 'Could not cancel that link.'); }
  }

  function copyUrl(token) {
    const url = `${window.location.origin}/pay/${token}`;
    navigator.clipboard?.writeText(url);
    setCopied(token);
    setTimeout(() => setCopied(''), 1800);
  }

  if (loading) {
    return <div className="pay-empty">
      <Loader2 size={20} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
    </div>;
  }

  return (
    <div>
      {error && (
        <div className="pay-dalert pay-dalert--bad" style={{ marginBottom: 10 }}>
          <AlertTriangle size={15} /> <div>{error}</div>
        </div>
      )}
      {items.length === 0 ? (
        /* Two empty states, because they answer two different questions.
           On the Links TAB, "no links yet" is a dead end and the note tells you
           where links come from. Embedded on a customer invoice you are already
           standing on the thing that makes them, so that sentence is advice to
           go where you are — and the 20px icon plus three centred lines took
           more vertical space than the payments table beside it. */
        compact ? (
          <div className="pay-links-none">No payment links raised for this invoice yet.</div>
        ) : (
        <div className="pay-empty">
          <Link2 size={20} />
          <div>No payment links yet.</div>
          <div className="pay-dnote" style={{ maxWidth: 420, textAlign: 'center' }}>
            Create one from a customer invoice to send someone a page where they can pay
            without logging in.
          </div>
        </div>
        )
      ) : (
        <div className={`lb-list${compact ? ' pay-links--compact' : ''}`}>
          <div className="lb-scroll-x">
            <table className="pay-table">
              <thead>
                <tr>
                  {!compact && <th>Invoice</th>}
                  {!compact && <th>Customer</th>}
                  <th className="pay-num">Amount</th>
                  <th>Opened</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map(l => {
                  const expired = l.is_expired || l.status === 'expired';
                  return (
                    <tr key={l.id} style={{ cursor: 'default' }}>
                      {!compact && (
                        <td><span className="pay-inv">CI-{String(l.entity_id).padStart(6, '0')}</span></td>
                      )}
                      {!compact && <td className="pay-name">{l.customer_name || '—'}</td>}
                      <td className="pay-num pay-amt">{fmt(l.amount)}</td>
                      <td className="pay-sub">
                        {l.opened_count > 0
                          ? `${l.opened_count}×`
                          : /* The answer to "I never got the link". */
                            'never'}
                      </td>
                      <td className="pay-sub">
                        {new Date(l.expires_at).toLocaleDateString('en-IN',
                          { day: 'numeric', month: 'short' })}
                      </td>
                      <td>
                        <span className={`pay-st ${
                          l.status === 'paid' ? 'pay-st--ok'
                          : l.status === 'cancelled' || expired ? 'pay-st--idle'
                          : 'pay-st--warn'}`}>
                          {l.status === 'paid' ? 'Paid'
                            : l.status === 'cancelled' ? 'Cancelled'
                            : expired ? 'Expired' : 'Active'}
                        </span>
                      </td>
                      <td className="pay-num pay-links-actions">
                        {l.status === 'active' && !expired && (
                          <span style={{ display: 'inline-flex', gap: 6 }}>
                            <button type="button" className="btn btn-ghost" onClick={() => copyUrl(l.token)}
                                    style={{ padding: '3px 8px', fontSize: 11.5 }}>
                              {copied === l.token ? <CheckCircle2 size={12} /> : <Copy size={12} />} Copy
                            </button>
                            <button type="button" className="btn btn-ghost" onClick={() => cancel(l.id)}
                                    style={{ padding: '3px 8px', fontSize: 11.5 }}>
                              <X size={12} /> Cancel
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
