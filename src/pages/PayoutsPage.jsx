'use strict';
import { useEffect, useState, useCallback, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import { useCan } from '../auth/AuthContext.jsx';
import DeleteHubPaymentDialog from '../components/DeleteHubPaymentDialog.jsx';
import PaginationBar from '../components/PaginationBar.jsx';
import HoverCard from '../components/HoverCard.jsx';
import DeletePaymentBatchDialog from '../components/DeletePaymentBatchDialog.jsx';
import EditPaymentDateDialog from '../components/EditPaymentDateDialog.jsx';
import { groupPaymentsByBatch } from '../lib/groupPayments.js';
import {
  Wallet, RefreshCw, AlertCircle, CheckCircle2, Clock,
  X, ChevronRight, ChevronLeft, Search, CreditCard,
  MoreVertical, AlertTriangle, Trophy, Calendar, CalendarDays,
  History, Receipt, Info, Download, Trash2, ChevronDown as ChevDown, Layers, CalendarClock,
  Landmark,
} from 'lucide-react';
import '../styles/PayoutsPage.css';

// Matches the server's `canPayment` on the DELETE route exactly
// (purchase_invoices.routes.js:11). Recording and reversing a payout are the
// same authority — a user who can add money to the record can take it back.
//
// This page had NO permission checks at all before this: every action button
// rendered for everyone and only failed on click with a 403 toast.
const PAYMENT_PERMS = ['ADD_INVOICE_PAYMENT', 'MANAGE_HUBS', 'ADD_PURCHASE_INVOICE_PAYMENT'];

// The PI-000042 link. This expression was copy-pasted six times across this
// file; the token/fallback branch is easy to get subtly wrong in one copy.
function PiLink({ p, navigate }) {
  return (
    <button
      onClick={() => navigate(
        p.purchase_invoice_token ? `/purchase-invoices/${p.purchase_invoice_token}` : '/purchase-invoices',
        p.purchase_invoice_token ? undefined : { state: { openId: p.purchase_invoice_id } }
      )}
      style={{ background:'none', border:'none', padding:0, cursor:'pointer', fontWeight:700, fontSize:13, color:'var(--primary)', fontFamily:'inherit' }}
    >
      PI-{String(p.purchase_invoice_id).padStart(6,'0')}
    </button>
  );
}

/**
 * Has the customer paid us for this job yet?
 *
 * "Awaiting payment" on a payout row is only a DISPLAY label — it comes from
 * payout_due_date being NULL, and nothing in addHubPayment or bulkPayment ever
 * looks at the customer invoice. So paying a hub before the customer has paid
 * is permitted, and sometimes deliberate (fronting a hub). It is also exactly
 * what a mis-click on the wrong row looks like.
 *
 * Hence: warn, do not block. This returns what the warning needs, or null when
 * there is nothing to say.
 */
function customerPaymentGap(pi) {
  if (!pi?.customer_invoice_id) return null;          // no CI linked — nothing to compare
  const total = Number(pi.ci_grand_total || 0);
  const paid  = Number(pi.ci_amount_paid || 0);
  const due   = total - paid;
  if (due <= 0.01) return null;                        // customer has settled
  return { total, paid, due, partial: paid > 0.01 };
}

/**
 * Was this ledger row produced by a bank transfer we sent?
 *
 * Such a row cannot be deleted or re-dated by hand — the server refuses with a
 * 409, because deleting it would leave hub_payouts saying the money left while
 * the ledger says it did not, and the invoice would be paid a second time. The
 * UI hides the actions rather than offering buttons that fail: a disabled or
 * erroring control on a money screen reads as a bug, not as a rule.
 *
 * A reversal is a real thing that happens — it just happens at the bank, and
 * arrives back as a webhook that removes these rows itself.
 */
const isBankTransfer = p => Boolean(p?.hub_payout_id);
/** A whole batch is untouchable if any row in it came from a transfer. */
const batchIsBankTransfer = e => (e?.payments || []).some(isBankTransfer);

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = n => n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const fmtDate = d => !d ? '—' : new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtDateTime = d => !d ? '—' : new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const PSTATUS = {
  pending:        { bg: '#f1f5f9', color: '#64748b', label: 'Unpaid'    },
  partially_paid: { bg: '#fef3c7', color: '#92400e', label: 'Part Paid' },
  paid:           { bg: '#dcfce7', color: '#166534', label: 'Paid'      },
  // A nil invoice. Settled, but not paid — see migration 174 and the matching
  // entry in PurchaseInvoicesPage. Slate rather than green: green here means
  // money reached the hub.
  not_required:   { bg: '#e2e8f0', color: '#475569', label: 'No Payment Due' },
};

/* Settled either way. Every `!== 'paid'` on this screen means "still owes
   money" — which stopped being the same thing the day nil invoices got their
   own label. Without this they would appear as selectable, payable rows in the
   payout run, asking somebody to transfer ₹0. */
const isSettled = st => st === 'paid' || st === 'not_required';
const PayBadge = ({ status }) => {
  const m = PSTATUS[status] || PSTATUS.pending;
  return <span style={{ display:'inline-block', padding:'3px 10px', borderRadius:99, fontSize:11, fontWeight:700, background:m.bg, color:m.color }}>{m.label}</span>;
};

const METHOD_LABELS = { bank_transfer:'Bank Transfer', upi:'UPI', cash:'Cash', card:'Card', app_payment:'In-App Payment', other:'Other' };
const MethodBadge = ({ method }) => (
  <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600, background:'var(--bg-soft)', color:'var(--text-muted)', border:'1px solid var(--border)' }}>
    {METHOD_LABELS[method] || method || '—'}
  </span>
);

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [msg, onClose]);
  const isErr = type === 'error';
  return (
    <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, display:'flex', alignItems:'center', gap:10, background:isErr?'#fef2f2':'#f0fdf4', border:`1px solid ${isErr?'#fca5a5':'#86efac'}`, borderRadius:10, padding:'12px 18px', boxShadow:'0 4px 20px rgba(0,0,0,0.12)', color:isErr?'#991b1b':'#166534', fontWeight:500, fontSize:14 }}>
      {isErr ? <AlertCircle size={16}/> : <CheckCircle2 size={16}/>}
      {msg}
      <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'inherit', marginLeft:4 }}><X size={14}/></button>
    </div>
  );
}

// ── Pay Modal ─────────────────────────────────────────────────────────────────
function PayModal({ pi, onClose, onSuccess }) {
  useEscapeClose(onClose);
  const [form, setForm] = useState({ amount:'', method:'bank_transfer', reference_no:'', notes:'' });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);
  const balance = parseFloat(pi.grand_total) - parseFloat(pi.amount_paid || 0);
  const gap = customerPaymentGap(pi);
  const field = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return; }
    if (amt > balance + 0.01) { setError(`Amount exceeds balance ${fmt(balance)}`); return; }
    setSaving(true); setError(null);
    try {
      await api(`/api/purchase-invoices/${pi.id}/payments`, {
        method:'POST',
        body:{ amount:amt, method:form.method, reference_no:form.reference_no.trim()||null, notes:form.notes.trim()||null },
      });
      onSuccess();
    } catch(err) { setError(err.message||'Failed to record payment'); setSaving(false); }
  }

  return (
    <div className="po-backdrop">
      <div className="po-modal" onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
          <div>
            <div style={{ fontWeight:700, fontSize:15 }}>Record Payment</div>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>PI-{String(pi.id).padStart(6,'0')} · {pi.hub_name}</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex' }}><X size={18}/></button>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#166534', marginBottom:16 }}>
          <CreditCard size={14}/> Balance due: <strong>{fmt(balance)}</strong>
        </div>

        {/* Amber, not red, and above the form rather than beside the submit
            button: this is information to weigh before filling anything in,
            not an error to correct. The figures are already on the row (the
            CI hover card uses the same fields), so this costs no extra call. */}
        {gap && (
          <div style={{ display:'flex', gap:9, alignItems:'flex-start', background:'#fffbeb', border:'1px solid #fcd34d', borderRadius:8, padding:'10px 14px', fontSize:12.5, color:'#92400e', marginBottom:16 }}>
            <AlertTriangle size={15} style={{ flexShrink:0, marginTop:1 }}/>
            <div>
              <strong>
                {gap.partial
                  ? 'The customer has only partly paid this job.'
                  : 'The customer has not paid this job yet.'}
              </strong>
              <div style={{ marginTop:3, opacity:0.9 }}>
                CI-{String(pi.customer_invoice_id).padStart(6,'0')} — {fmt(gap.paid)} of {fmt(gap.total)} received,
                {' '}<strong>{fmt(gap.due)} still due</strong>. Paying the hub now means paying out before you have been paid.
              </div>
            </div>
          </div>
        )}
        <form onSubmit={submit} style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
              <label style={{ fontSize:12, fontWeight:600 }}>Amount (₹) *</label>
              <input className="po-input" type="number" min="0.01" step="0.01" placeholder={`Max ${fmt(balance)}`} value={form.amount} onChange={field('amount')} required />
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
              <label style={{ fontSize:12, fontWeight:600 }}>Method</label>
              <select className="po-input" value={form.method} onChange={field('method')}>
                {Object.entries(METHOD_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
              <label style={{ fontSize:12, fontWeight:600 }}>Reference No</label>
              <input className="po-input" placeholder="UTR / Cheque no…" value={form.reference_no} onChange={field('reference_no')} />
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
              <label style={{ fontSize:12, fontWeight:600 }}>Notes</label>
              <input className="po-input" placeholder="Optional" value={form.notes} onChange={field('notes')} />
            </div>
          </div>
          {error && <div style={{ color:'#dc2626', fontSize:12, display:'flex', gap:6, alignItems:'center' }}><AlertCircle size={13}/>{error}</div>}
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:4 }}>
            <button type="button" className="po-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="po-btn-primary" disabled={saving}>{saving?'Recording…':'Record Payment'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── PI Payment History Modal (3-dot menu) ─────────────────────────────────────
function PIPaymentsModal({ pi, onClose, showToast, onChanged }) {
  useEscapeClose(onClose);
  const canDelete = useCan(...PAYMENT_PERMS);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [delPayment, setDelPayment] = useState(null);
  const [editDate, setEditDate]     = useState(null);

  useEffect(() => {
    api(`/api/purchase-invoices/${pi.id}`)
      .then(res => setPayments(res.item?.hub_payments || []))
      .catch(() => setPayments([]))
      .finally(() => setLoading(false));
  }, [pi.id]);

  return (
    <div className="po-backdrop">
      <div className="po-modal" style={{ maxWidth:560 }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
          <div>
            <div style={{ fontWeight:700, fontSize:15 }}>Payment History</div>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>
              PI-{String(pi.id).padStart(6,'0')} · {pi.hub_name} · {pi.vehicle_number||'—'}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex' }}><X size={18}/></button>
        </div>

        <div style={{ display:'flex', gap:12, marginBottom:16 }}>
          {[
            { label:'Grand Total', val:fmt(pi.grand_total), color:'var(--text)' },
            { label:'Paid',        val:fmt(pi.amount_paid), color:'#16a34a' },
            { label:'Balance',     val:fmt(parseFloat(pi.grand_total)-parseFloat(pi.amount_paid||0)), color:'#ef4444' },
          ].map(c => (
            <div key={c.label} style={{ flex:1, background:'var(--bg-soft)', borderRadius:8, padding:'10px 12px' }}>
              <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }}>{c.label}</div>
              <div style={{ fontSize:15, fontWeight:800, color:c.color }}>{c.val}</div>
            </div>
          ))}
        </div>

        {loading ? (
          <div style={{ padding:24, textAlign:'center', color:'var(--text-muted)' }}>Loading…</div>
        ) : payments.length === 0 ? (
          <div style={{ padding:24, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>No payments recorded yet.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:0, border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
            <div style={{ display:'grid', gridTemplateColumns: canDelete ? '1fr 1fr 1fr 1fr 34px' : '1fr 1fr 1fr 1fr', padding:'8px 14px', background:'var(--bg-soft)', borderBottom:'1px solid var(--border)' }}>
              {['Date', 'Amount', 'Method', 'Reference', ...(canDelete ? [''] : [])].map(h => (
                <div key={h} style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em' }}>{h}</div>
              ))}
            </div>
            {payments.map((p, i) => (
              <div key={p.id} style={{ display:'grid', gridTemplateColumns: canDelete ? '1fr 1fr 1fr 1fr 34px' : '1fr 1fr 1fr 1fr', padding:'10px 14px', borderBottom: i < payments.length-1 ? '1px solid var(--border)' : 'none', alignItems:'center' }}>
                <div style={{ fontSize:12, color:'var(--text-muted)' }}>{fmtDate(p.paid_at)}</div>
                <div style={{ fontSize:13, fontWeight:700, color:'#16a34a' }}>{fmt(p.amount)}</div>
                <MethodBadge method={p.method}/>
                <div style={{ fontSize:12, color:'var(--text-muted)' }}>{p.reference_no||'—'} {isBankTransfer(p) && <span className="po-bank-tag" title={`Sent by bank transfer ${p.payout_ref || ''}`.trim()}>BANK</span>}</div>
                {canDelete && !isBankTransfer(p) && (
                  <span style={{ display:'inline-flex', gap:2, justifyContent:'flex-end' }}>
                    {/* No date edit for a batched payment: it has to move with
                        its batch, which is a Payment History action. The server
                        enforces this too (409 IN_BATCH). */}
                    {!p.payment_batch_id && (
                      <button
                        type="button"
                        className="po-act-btn"
                        title="Change the payment date"
                        aria-label={`Change date of payment of ${fmt(p.amount)}`}
                        onClick={() => setEditDate({ kind:'single', payment:{ ...p, purchase_invoice_id: pi.id } })}
                      ><CalendarClock size={12}/></button>
                    )}
                    <button
                      type="button"
                      className="po-del-btn"
                      title="Delete this payment"
                      aria-label={`Delete payment of ${fmt(p.amount)}`}
                      onClick={() => setDelPayment(p)}
                    ><Trash2 size={13}/></button>
                  </span>
                )}
              </div>
            ))}
            <div style={{ padding:'10px 14px', background:'var(--bg-soft)', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'space-between' }}>
              <span style={{ fontSize:12, fontWeight:700, color:'var(--text-muted)' }}>Total Paid</span>
              <span style={{ fontSize:14, fontWeight:800, color:'#16a34a' }}>{fmt(payments.reduce((s,p)=>s+parseFloat(p.amount),0))}</span>
            </div>
          </div>
        )}

        {delPayment && (
          <DeleteHubPaymentDialog
            payment={delPayment}
            piId={pi.id}
            showToast={showToast}
            onClose={() => setDelPayment(null)}
            /* The response carries the refreshed invoice, so the list updates
               without a second request. onChanged reloads the page behind. */
            onDeleted={(item) => { setPayments(item?.hub_payments || []); onChanged?.(); }}
          />
        )}

        {editDate && (
          <EditPaymentDateDialog
            target={editDate}
            showToast={showToast}
            onClose={() => setEditDate(null)}
            onSaved={() => {
              api(`/api/purchase-invoices/${pi.id}`)
                .then(res => setPayments(res.item?.hub_payments || []))
                .catch(() => {});
              onChanged?.();
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Hub Payments Table ────────────────────────────────────────────────────────
function HubPaymentsTab({ hubName, hubId, onExport, showToast, onChanged }) {
  const navigate = useNavigate();
  const canDelete = useCan(...PAYMENT_PERMS);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [loadErr, setLoadErr]   = useState('');
  const [total, setTotal]       = useState(0);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate]     = useState('');
  const [search, setSearch]     = useState('');
  const [delPayment, setDelPayment] = useState(null);
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [openBatch, setOpenBatch] = useState(null);   // expanded batch key
  const [delBatch, setDelBatch]   = useState(null);
  const [editDate, setEditDate]   = useState(null);   // { kind:'single'|'batch', … }

  // Extracted from the effect so the delete dialog can re-run it.
  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ hub_id: hubId });
    if (fromDate) params.set('from', fromDate);
    if (toDate)   params.set('to',   toDate);
    api(`/api/purchase-invoices/hub-payments?${params}`)
      .then(res => { setPayments(res.payments || []); setTotal(res.total || 0); setLoadErr(''); })
      // Emptying the list on failure made a broken request indistinguishable
      // from a period in which the hub genuinely received nothing — the footer
      // read "0 records · ₹0.00" either way, with nothing suggesting a retry.
      .catch(e => {
        setPayments([]); setTotal(0);
        setLoadErr(e?.message || 'Could not load this hub\'s payments.');
      })
      .finally(() => setLoading(false));
  }, [hubId, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  // Client-side search: PI# or reference_no
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return payments;
    return payments.filter(p =>
      `pi-${String(p.purchase_invoice_id).padStart(6,'0')}`.includes(q) ||
      (p.reference_no || '').toLowerCase().includes(q)
    );
  }, [payments, search]);

  // Back to page 1 whenever the result set changes — searching while on page 3
  // otherwise shows an empty page with a paginator still pointing at it.
  useEffect(() => { setPage(1); }, [search, fromDate, toDate, hubId, pageSize]);

  // Group BEFORE paginating: a page of 10 shows 10 payments as the user
  // understands them. Paginating raw rows first would let one bulk payment of
  // six invoices take most of a page on its own.
  const entries   = useMemo(() => groupPaymentsByBatch(filtered), [filtered]);
  const paginated = useMemo(
    () => entries.slice((page - 1) * pageSize, page * pageSize),
    [entries, page, pageSize]
  );

  const filteredTotal = useMemo(
    () => filtered.reduce((s, p) => s + parseFloat(p.amount), 0),
    [filtered]
  );

  const hasFilters = fromDate || toDate || search;

  function clearFilters() { setFromDate(''); setToDate(''); setSearch(''); }

  return (
    <div>
      {/* A failed load must say so. Silence here is worse than an error:
          the figures below are the ones somebody reconciles against a bank
          statement, and a stale or zeroed total that looks calm is how a wrong
          number gets reported. */}
      {loadErr && (
        <div className="po-loaderr">
          <AlertCircle size={15} style={{ flexShrink:0, marginTop:1 }}/>
          <div style={{ flex:1 }}>{loadErr}</div>
          <button type="button" className="po-btn-ghost" style={{ fontSize:12, padding:'4px 12px' }}
                  onClick={() => load()}>Retry</button>
        </div>
      )}
      {/* Filter bar */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', padding:'12px 16px', borderBottom:'1px solid var(--border)', background:'var(--bg-soft)' }}>
        {/* Search */}
        <div style={{ position:'relative', flex:'1 1 180px', display:'flex', alignItems:'center' }}>
          <Search size={13} style={{ position:'absolute', left:9, color:'var(--text-muted)', pointerEvents:'none' }}/>
          <input
            className="po-input"
            style={{ paddingLeft:29, paddingRight: search ? 28 : 10, fontSize:13 }}
            placeholder="Search PI# or reference…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position:'absolute', right:7, background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex' }}>
              <X size={12}/>
            </button>
          )}
        </div>

        {/* Date range */}
        <div style={{ display:'flex', alignItems:'center', gap:6, flex:'0 0 auto' }}>
          <Calendar size={13} style={{ color:'var(--text-muted)', flexShrink:0 }}/>
          <input
            type="date"
            className="po-input"
            style={{ fontSize:13, width:130 }}
            value={fromDate}
            max={toDate || undefined}
            onChange={e => setFromDate(e.target.value)}
            title="From date"
          />
          <span style={{ fontSize:12, color:'var(--text-muted)' }}>to</span>
          <input
            type="date"
            className="po-input"
            style={{ fontSize:13, width:130 }}
            value={toDate}
            min={fromDate || undefined}
            onChange={e => setToDate(e.target.value)}
            title="To date"
          />
        </div>

        {hasFilters && (
          <button className="po-btn-ghost" style={{ fontSize:12, padding:'5px 12px', whiteSpace:'nowrap' }} onClick={clearFilters}>
            Clear filters
          </button>
        )}
        <button className="po-btn-ghost" style={{ fontSize:12, padding:'5px 12px', display:'flex', alignItems:'center', gap:6, marginLeft:'auto', whiteSpace:'nowrap' }} onClick={() => onExport({ type: 'history', search, hub_id: hubId, from: fromDate, to: toDate })}>
          <Download size={13} /> Export CSV
        </button>
      </div>

      {/* Summary bar */}
      {!loading && (
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 16px', background:'#f0fdf4', borderBottom:'1px solid #86efac' }}>
          <span style={{ fontSize:13, color:'#166534', fontWeight:600 }}>
            {filtered.length} payment{filtered.length !== 1 ? 's' : ''}
            {hasFilters && payments.length !== filtered.length && (
              <span style={{ fontWeight:400, color:'#4ade80', marginLeft:4 }}>
                (filtered from {payments.length})
              </span>
            )}
          </span>
          <span style={{ fontSize:15, fontWeight:800, color:'#16a34a' }}>
            Total: {fmt(filteredTotal)}
          </span>
        </div>
      )}

      {loading ? (
        <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)' }}>
          <Clock size={24} style={{ opacity:0.3 }}/>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>
          {hasFilters ? 'No payments match your filters.' : `No payments recorded for ${hubName} yet.`}
        </div>
      ) : (
        /* minWidth 900, not 600. At 600 the table FITS a normal desktop panel,
           so `overflowX: auto` never triggered and the columns wrapped instead —
           "Bank Transfer" over two lines, "PI-000041" broken across the date.
           Wide enough to overflow is what makes the scroll appear; nowrap on
           the cells below is what stops the wrapping in the first place. */
        <div style={{ overflowX:'auto' }} className="po-hist-scroll">
          <table style={{ width:'100%', borderCollapse:'collapse', minWidth:900 }}>
            <thead>
              <tr>
                {['Date & Time','PI #','Vehicle','Amount','Method','Reference','By', ...(canDelete ? [''] : [])].map((h, hi) => (
                  <th key={h||`act${hi}`} style={{ padding:'9px 14px', fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', borderBottom:'1px solid var(--border)', background:'var(--bg-soft)', textAlign: h==='Amount'?'right':'left', whiteSpace:'nowrap', width: h===''?44:undefined }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.map((e, i) => {
                const zebra = i%2===0 ? undefined : 'var(--bg-soft)';
                const td = { padding:'10px 14px', borderBottom:'1px solid var(--border)' };

                // ── One payment, one invoice ──
                if (e.kind === 'single') {
                  const p = e.payment;
                  return (
                    <tr key={e.key} style={{ background: zebra }}>
                      <td style={{ ...td, fontSize:12, color:'var(--text-muted)' }}>{fmtDateTime(p.paid_at)}</td>
                      <td style={td}><PiLink p={p} navigate={navigate}/></td>
                      <td style={{ ...td, fontSize:12, color:'var(--text-muted)' }}>{p.vehicle_number||'—'}</td>
                      <td style={{ ...td, fontSize:13, fontWeight:700, color:'#16a34a', textAlign:'right' }}>{fmt(p.amount)}</td>
                      <td style={td}><MethodBadge method={p.method}/></td>
                      <td style={{ ...td, fontSize:12, color:'var(--text-muted)' }}>{p.reference_no||'—'} {isBankTransfer(p) && <span className="po-bank-tag" title={`Sent by bank transfer ${p.payout_ref || ''}`.trim()}>BANK</span>}</td>
                      <td style={{ ...td, fontSize:12, color:'var(--text-muted)' }}>{p.created_by_name||'—'}</td>
                      {canDelete && !isBankTransfer(p) && (
                        <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}>
                          <button type="button" className="po-act-btn" title="Change the payment date"
                            aria-label={`Change date of payment of ${fmt(p.amount)}`}
                            onClick={() => setEditDate({ kind:'single', payment:p })}><CalendarClock size={13}/></button>
                          <button type="button" className="po-del-btn" title="Delete this payment"
                            aria-label={`Delete payment of ${fmt(p.amount)}`}
                            onClick={() => setDelPayment(p)}><Trash2 size={13}/></button>
                        </td>
                      )}
                    </tr>
                  );
                }

                // ── One payment, several invoices ──
                const open = openBatch === e.key;
                return (
                  <Fragment key={e.key}>
                    <tr style={{ background: zebra, cursor:'pointer' }} onClick={() => setOpenBatch(open ? null : e.key)}>
                      <td style={{ ...td, fontSize:12, color:'var(--text-muted)' }}>{fmtDateTime(e.paid_at)}</td>
                      <td style={td}>
                        <span className="po-batch-chip">
                          <ChevDown size={12} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition:'transform .12s' }}/>
                          <Layers size={11}/> {e.payments.length} invoices
                        </span>
                      </td>
                      <td style={{ ...td, fontSize:12, color:'var(--text-muted)' }}>—</td>
                      <td style={{ ...td, fontSize:13, fontWeight:700, color:'#16a34a', textAlign:'right' }}>{fmt(e.amount)}</td>
                      <td style={td}><MethodBadge method={e.method}/></td>
                      <td style={{ ...td, fontSize:12, color:'var(--text-muted)' }}>{e.reference_no||'—'} {batchIsBankTransfer(e) && <span className="po-bank-tag" title="Sent by bank transfer">BANK</span>}</td>
                      <td style={{ ...td, fontSize:12, color:'var(--text-muted)' }}>{e.created_by_name||'—'}</td>
                      {canDelete && !batchIsBankTransfer(e) && (
                        <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }} onClick={ev => ev.stopPropagation()}>
                          <button type="button" className="po-act-btn" title="Change the date on the whole bulk payment"
                            aria-label={`Change date of bulk payment of ${fmt(e.amount)}`}
                            onClick={() => setEditDate(e)}><CalendarClock size={13}/></button>
                          <button type="button" className="po-del-btn" title="Reverse this whole bulk payment"
                            aria-label={`Reverse bulk payment of ${fmt(e.amount)}`}
                            onClick={() => setDelBatch(e)}><Trash2 size={13}/></button>
                        </td>
                      )}
                    </tr>
                    {open && e.payments.map(p => (
                      <tr key={p.id} className="po-batch-child">
                        <td style={{ ...td, fontSize:11, color:'var(--text-muted)' }}></td>
                        <td style={td}><PiLink p={p} navigate={navigate}/></td>
                        <td style={{ ...td, fontSize:12, color:'var(--text-muted)' }}>{p.vehicle_number||'—'}</td>
                        <td style={{ ...td, fontSize:12.5, fontWeight:600, color:'#16a34a', textAlign:'right' }}>{fmt(p.amount)}</td>
                        <td style={td}/><td style={td}/><td style={td}/>
                        {canDelete && !isBankTransfer(p) && (
                          <td style={{ ...td, textAlign:'right' }}>
                            {/* Deletes only THIS invoice's share, leaving the
                                rest of the batch intact. */}
                            <button type="button" className="po-del-btn" title="Delete only this invoice's share"
                              aria-label={`Delete ${fmt(p.amount)} from PI-${String(p.purchase_invoice_id).padStart(6,'0')}`}
                              onClick={() => setDelPayment(p)}><Trash2 size={12}/></button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <PaginationBar
          page={page}
          total={filtered.length}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={setPageSize}
          noun="payment"
        />
      )}

      {delPayment && (
        <DeleteHubPaymentDialog
          payment={delPayment}
          piId={delPayment.purchase_invoice_id}
          showToast={showToast}
          onClose={() => setDelPayment(null)}
          /* Refetch rather than splice: deleting changes the invoice's paid
             total, which the hub summary above this table also shows. */
          onDeleted={() => { load(); onChanged?.(); }}
        />
      )}

      {delBatch && (
        <DeletePaymentBatchDialog
          batch={delBatch}
          showToast={showToast}
          onClose={() => setDelBatch(null)}
          onDeleted={() => { load(); onChanged?.(); }}
        />
      )}

      {editDate && (
        <EditPaymentDateDialog
          target={editDate}
          showToast={showToast}
          onClose={() => setEditDate(null)}
          /* Refetch: a re-dated row changes position in a list ordered by
             paid_at, and may leave the active date filter entirely. */
          onSaved={() => { load(); onChanged?.(); }}
        />
      )}
    </div>
  );
}

// ── Global Payment History Tab ────────────────────────────────────────────────
function GlobalPaymentHistory({ onExport, showToast, onChanged }) {
  const canDelete = useCan(...PAYMENT_PERMS);
  const [delPayment, setDelPayment] = useState(null);
  const navigate   = useNavigate();
  const [payments, setPayments] = useState([]);
  const [byHub, setByHub]       = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [loadErr, setLoadErr]   = useState('');
  const [hubFilter, setHubFilter] = useState('');
  const [search, setSearch]     = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate]     = useState('');
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [openBatch, setOpenBatch] = useState(null);   // expanded batch key
  const [delBatch, setDelBatch]   = useState(null);
  const [editDate, setEditDate]   = useState(null);   // { kind:'single'|'batch', … }

  // Extracted from the effect so the delete dialog can re-run it. The per-hub
  // totals above the table come from the same response, so a partial refresh
  // would leave them disagreeing with the rows.
  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (hubFilter) params.set('hub_id', hubFilter);
    if (fromDate)  params.set('from', fromDate);
    if (toDate)    params.set('to',   toDate);
    const q = params.toString() ? `?${params}` : '';
    api(`/api/purchase-invoices/hub-payments${q}`)
      .then(res => {
        setPayments(res.payments||[]); setByHub(res.by_hub||[]); setTotal(res.total||0);
        setLoadErr('');
      })
      // The catch used to be empty, and that was the bug: payments, byHub and
      // total all kept their PREVIOUS values while loading flipped to false, so
      // the per-hub cards and the All Hubs Total re-presented the old result set
      // as though it answered the new filter. Someone reconciling August read an
      // all-time figure sitting directly under an August date range.
      .catch(e => {
        setPayments([]); setByHub([]); setTotal(0);
        setLoadErr(e?.message || 'Could not load payment history.');
      })
      .finally(() => setLoading(false));
  }, [hubFilter, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return payments;
    return payments.filter(p =>
      `pi-${String(p.purchase_invoice_id).padStart(6,'0')}`.includes(q) ||
      (p.vehicle_number||'').toLowerCase().includes(q) ||
      (p.hub_name||'').toLowerCase().includes(q) ||
      (p.reference_no||'').toLowerCase().includes(q)
    );
  }, [payments, search]);

  // Back to page 1 whenever the result set changes — searching while on page 3
  // otherwise shows an empty page with a paginator still pointing at it.
  useEffect(() => { setPage(1); }, [search, hubFilter, fromDate, toDate, pageSize]);

  // Group BEFORE paginating — see the note in HubPaymentsTab.
  const entries   = useMemo(() => groupPaymentsByBatch(filtered), [filtered]);
  const paginated = useMemo(
    () => entries.slice((page - 1) * pageSize, page * pageSize),
    [entries, page, pageSize]
  );

  return (
    <div>
      {/* A failed load must say so. Silence here is worse than an error:
          the figures below are the ones somebody reconciles against a bank
          statement, and a stale or zeroed total that looks calm is how a wrong
          number gets reported. */}
      {loadErr && (
        <div className="po-loaderr">
          <AlertCircle size={15} style={{ flexShrink:0, marginTop:1 }}/>
          <div style={{ flex:1 }}>{loadErr}</div>
          <button type="button" className="po-btn-ghost" style={{ fontSize:12, padding:'4px 12px' }}
                  onClick={() => load()}>Retry</button>
        </div>
      )}
      {/* Summary by hub */}
      {byHub.length > 0 && (
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:16 }}>
          {byHub.map(h => {
            const isActive = String(hubFilter) === String(h.hub_id);
            return (
              <div key={h.hub_name} className="card" style={{ padding:'12px 16px', flex:'1 1 180px', cursor:'pointer', borderLeft:`3px solid ${isActive ? '#16a34a' : 'var(--primary)'}`, background: isActive ? '#f0fdf4' : undefined, outline: isActive ? '2px solid #16a34a' : undefined }} onClick={() => setHubFilter(isActive ? '' : h.hub_id)}>
                <div style={{ fontSize:11, fontWeight:700, color: isActive ? '#16a34a' : 'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>{h.hub_name}</div>
                <div style={{ fontSize:17, fontWeight:800, color:'#16a34a' }}>{fmt(h.total)}</div>
                <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{h.payments.length} payment{h.payments.length!==1?'s':''}</div>
              </div>
            );
          })}
          <div className="card" style={{ padding:'12px 16px', flex:'1 1 180px', borderLeft:'3px solid #7c3aed' }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>All Hubs Total</div>
            <div style={{ fontSize:17, fontWeight:800, color:'#7c3aed' }}>{fmt(total)}</div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{payments.length} payment{payments.length!==1?'s':''}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ padding:'12px 16px', display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:16 }}>
        {/* Search */}
        <div style={{ position:'relative', flex:'1 1 200px', display:'flex', alignItems:'center' }}>
          <Search size={14} style={{ position:'absolute', left:10, color:'var(--text-muted)', pointerEvents:'none' }}/>
          <input className="po-input" style={{ paddingLeft:32, paddingRight:search?32:12 }} placeholder="Search PI#, vehicle, hub, reference…" value={search} onChange={e=>setSearch(e.target.value)}/>
          {search && <button onClick={()=>setSearch('')} style={{ position:'absolute', right:8, background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex' }}><X size={13}/></button>}
        </div>
        {/* Hub filter */}
        <select className="po-input" style={{ flex:'0 0 auto', width:'auto' }} value={hubFilter} onChange={e=>setHubFilter(e.target.value)}>
          <option value="">All Hubs</option>
          {byHub.map(h => <option key={h.hub_id} value={h.hub_id}>{h.hub_name}</option>)}
        </select>
        {/* Date range */}
        <div style={{ display:'flex', alignItems:'center', gap:6, flex:'0 0 auto' }}>
          <Calendar size={13} style={{ color:'var(--text-muted)', flexShrink:0 }}/>
          <input
            type="date"
            className="po-input"
            style={{ fontSize:13, width:130 }}
            value={fromDate}
            max={toDate || undefined}
            onChange={e=>setFromDate(e.target.value)}
            title="From date"
          />
          <span style={{ fontSize:12, color:'var(--text-muted)' }}>to</span>
          <input
            type="date"
            className="po-input"
            style={{ fontSize:13, width:130 }}
            value={toDate}
            min={fromDate || undefined}
            onChange={e=>setToDate(e.target.value)}
            title="To date"
          />
        </div>
        {(search||hubFilter||fromDate||toDate) && (
          <button className="po-btn-ghost" style={{ padding:'7px 14px', fontSize:13 }} onClick={()=>{ setSearch(''); setHubFilter(''); setFromDate(''); setToDate(''); }}>
            Clear all
          </button>
        )}
        <button className="po-btn-ghost" style={{ padding:'7px 14px', fontSize:13, display:'flex', alignItems:'center', gap:6, marginLeft:'auto' }} onClick={() => onExport({ type: 'history', search, hub_id: hubFilter, from: fromDate, to: toDate })}>
          <Download size={14} /> Export CSV
        </button>
      </div>

      {loading ? (
        <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>No payments found.</div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          {/* minWidth 1050: this table has one more column than the hub tab
              (Hub), so it needs more room before it overflows — see the note
              on the hub table above. */}
          <div style={{ overflowX:'auto' }} className="po-hist-scroll">
            <table style={{ width:'100%', borderCollapse:'collapse', minWidth:1050 }}>
              <thead>
                <tr>
                  {['Date & Time','PI #','Hub','Vehicle','Amount','Method','Reference','By', ...(canDelete ? [''] : [])].map((h, hi) => (
                    <th key={h||`act${hi}`} style={{ padding:'9px 14px', fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', borderBottom:'1px solid var(--border)', background:'var(--bg-soft)', textAlign:h==='Amount'?'right':'left', whiteSpace:'nowrap', width: h===''?44:undefined }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map((e, i) => {
                  const zebra = i%2===0 ? undefined : 'var(--bg-soft)';
                  const td = { padding:'10px 14px', borderBottom:'1px solid var(--border)' };

                  if (e.kind === 'single') {
                    const p = e.payment;
                    return (
                      <tr key={e.key} style={{ background: zebra }}>
                        <td style={{ ...td, fontSize:12, color:'var(--text-muted)' }}>{fmtDateTime(p.paid_at)}</td>
                        <td style={td}><PiLink p={p} navigate={navigate}/></td>
                        <td style={{ ...td, fontSize:12, fontWeight:600 }}>{p.hub_name||'—'}</td>
                        <td style={{ ...td, fontSize:12, color:'var(--text-muted)' }}>{p.vehicle_number||'—'}</td>
                        <td style={{ ...td, fontSize:13, fontWeight:700, color:'#16a34a', textAlign:'right' }}>{fmt(p.amount)}</td>
                        <td style={td}><MethodBadge method={p.method}/></td>
                        <td style={{ ...td, fontSize:12, color:'var(--text-muted)' }}>{p.reference_no||'—'} {isBankTransfer(p) && <span className="po-bank-tag" title={`Sent by bank transfer ${p.payout_ref || ''}`.trim()}>BANK</span>}</td>
                        <td style={{ ...td, fontSize:12, color:'var(--text-muted)' }}>{p.created_by_name||'—'}</td>
                        {canDelete && !isBankTransfer(p) && (
                          <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}>
                            <button type="button" className="po-act-btn" title="Change the payment date"
                              aria-label={`Change date of payment of ${fmt(p.amount)}`}
                              onClick={() => setEditDate({ kind:'single', payment:p })}><CalendarClock size={13}/></button>
                            <button type="button" className="po-del-btn" title="Delete this payment"
                              aria-label={`Delete payment of ${fmt(p.amount)}`}
                              onClick={() => setDelPayment(p)}><Trash2 size={13}/></button>
                          </td>
                        )}
                      </tr>
                    );
                  }

                  const open = openBatch === e.key;
                  return (
                    <Fragment key={e.key}>
                      <tr style={{ background: zebra, cursor:'pointer' }} onClick={() => setOpenBatch(open ? null : e.key)}>
                        <td style={{ ...td, fontSize:12, color:'var(--text-muted)' }}>{fmtDateTime(e.paid_at)}</td>
                        <td style={td}>
                          <span className="po-batch-chip">
                            <ChevDown size={12} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition:'transform .12s' }}/>
                            <Layers size={11}/> {e.payments.length} invoices
                          </span>
                        </td>
                        <td style={{ ...td, fontSize:12, fontWeight:600 }}>{e.hub_name||'—'}</td>
                        <td style={{ ...td, fontSize:12, color:'var(--text-muted)' }}>—</td>
                        <td style={{ ...td, fontSize:13, fontWeight:700, color:'#16a34a', textAlign:'right' }}>{fmt(e.amount)}</td>
                        <td style={td}><MethodBadge method={e.method}/></td>
                        <td style={{ ...td, fontSize:12, color:'var(--text-muted)' }}>{e.reference_no||'—'} {batchIsBankTransfer(e) && <span className="po-bank-tag" title="Sent by bank transfer">BANK</span>}</td>
                        <td style={{ ...td, fontSize:12, color:'var(--text-muted)' }}>{e.created_by_name||'—'}</td>
                        {canDelete && !batchIsBankTransfer(e) && (
                          <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }} onClick={ev => ev.stopPropagation()}>
                            <button type="button" className="po-act-btn" title="Change the date on the whole bulk payment"
                              aria-label={`Change date of bulk payment of ${fmt(e.amount)}`}
                              onClick={() => setEditDate(e)}><CalendarClock size={13}/></button>
                            <button type="button" className="po-del-btn" title="Reverse this whole bulk payment"
                              aria-label={`Reverse bulk payment of ${fmt(e.amount)}`}
                              onClick={() => setDelBatch(e)}><Trash2 size={13}/></button>
                          </td>
                        )}
                      </tr>
                      {open && e.payments.map(p => (
                        <tr key={p.id} className="po-batch-child">
                          <td style={td}/>
                          <td style={td}><PiLink p={p} navigate={navigate}/></td>
                          <td style={td}/>
                          <td style={{ ...td, fontSize:12, color:'var(--text-muted)' }}>{p.vehicle_number||'—'}</td>
                          <td style={{ ...td, fontSize:12.5, fontWeight:600, color:'#16a34a', textAlign:'right' }}>{fmt(p.amount)}</td>
                          <td style={td}/><td style={td}/><td style={td}/>
                          {canDelete && !isBankTransfer(p) && (
                            <td style={{ ...td, textAlign:'right' }}>
                              <button type="button" className="po-del-btn" title="Delete only this invoice's share"
                                aria-label={`Delete ${fmt(p.amount)} from PI-${String(p.purchase_invoice_id).padStart(6,'0')}`}
                                onClick={() => setDelPayment(p)}><Trash2 size={12}/></button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Total is over the whole FILTERED set, not the visible page — a
              running total that changes as you page through is not a total. */}
          <div style={{ padding:'10px 16px', background:'var(--bg-soft)', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'space-between' }}>
            <span style={{ fontSize:12, color:'var(--text-muted)' }}>{filtered.length} record{filtered.length!==1?'s':''}</span>
            <span style={{ fontSize:13, fontWeight:800, color:'#16a34a' }}>{fmt(filtered.reduce((s,p)=>s+parseFloat(p.amount),0))}</span>
          </div>
          <PaginationBar
            page={page}
            total={filtered.length}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={setPageSize}
            noun="payment"
          />
        </div>
      )}

      {delPayment && (
        <DeleteHubPaymentDialog
          payment={delPayment}
          piId={delPayment.purchase_invoice_id}
          showToast={showToast}
          onClose={() => setDelPayment(null)}
          /* load() refreshes this table; onChanged tells the page to reload the
             payouts buckets, since the invoice may have returned to unpaid. */
          onDeleted={() => { load(); onChanged?.(); }}
        />
      )}

      {delBatch && (
        <DeletePaymentBatchDialog
          batch={delBatch}
          showToast={showToast}
          onClose={() => setDelBatch(null)}
          onDeleted={() => { load(); onChanged?.(); }}
        />
      )}

      {editDate && (
        <EditPaymentDateDialog
          target={editDate}
          showToast={showToast}
          onClose={() => setEditDate(null)}
          /* Refetch: a re-dated row changes position in a list ordered by
             paid_at, and may leave the active date filter entirely. */
          onSaved={() => { load(); onChanged?.(); }}
        />
      )}
    </div>
  );
}

// ── Summary Cards ─────────────────────────────────────────────────────────────
function SummaryCards({ data, allInvoices, techRate }) {
  if (!data) return null;
  const bal = pi => parseFloat(pi.grand_total) - parseFloat(pi.amount_paid||0);
  const hubCount = arr => new Set(arr.map(p=>p.hub_name).filter(Boolean)).size;
  const overdueList  = data.overdue||[];
  const weekList      = [...(data.due_today||[]), ...(data.due_this_week||[])];
  const monthList      = data.due_this_month||[];
  const awaitingList = data.awaiting_payment||[];
  const cards = [
    { label:'Overdue',           icon:<AlertTriangle size={20}/>, iconBg:'#fee2e2', iconColor:'#dc2626', amount:overdueList.reduce((s,p)=>s+bal(p),0),  hubs:hubCount(overdueList),  amtColor:'#dc2626', bg:'#fff5f5', border:'#fecaca' },
    { label:'Due This Week',     icon:<Calendar size={20}/>,      iconBg:'#fef3c7', iconColor:'#d97706', amount:weekList.reduce((s,p)=>s+bal(p),0),      hubs:hubCount(weekList),     amtColor:'#d97706', bg:'#fffbeb', border:'#fde68a' },
    { label:'This Month',        icon:<CalendarDays size={20}/>,  iconBg:'#ede9fe', iconColor:'#7c3aed', amount:monthList.reduce((s,p)=>s+bal(p),0),     hubs:hubCount(monthList),    amtColor:'#7c3aed', bg:'#f5f3ff', border:'#ddd6fe' },
    { label:'Awaiting Customer Payment', icon:<Clock size={20}/>, iconBg:'#e0f2fe', iconColor:'#0284c7', amount:awaitingList.reduce((s,p)=>s+bal(p),0), hubs:hubCount(awaitingList), amtColor:'#0284c7', bg:'#f0f9ff', border:'#bae6fd' },
    { label:'Total Outstanding', icon:<Trophy size={20}/>,        iconBg:'#d1fae5', iconColor:'#059669', amount:allInvoices.reduce((s,p)=>s+bal(p),0),   hubs:hubCount(allInvoices),  amtColor:'var(--primary)', bg:'var(--bg-soft)', border:'var(--border)' },
  ];
  return (
    <div className="po-summary-grid">
      {cards.map(c => (
        <div key={c.label} className="card po-summary-card" style={{ background:c.bg, borderColor:c.border }}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>{c.label}</div>
              <div style={{ fontSize:22, fontWeight:800, color:c.amtColor, lineHeight:1 }}>{fmt(c.amount)}</div>
              <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:6 }}>{c.hubs} Hub{c.hubs!==1?'s':''}</div>
            </div>
            <div style={{ width:42, height:42, borderRadius:12, background:c.iconBg, color:c.iconColor, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{c.icon}</div>
          </div>
        </div>
      ))}

      {/* 5th card — Total Take Rate */}
      {techRate && (techRate.ex_gst > 0 || techRate.inc_gst > 0) && (
        <div className="card po-summary-card" style={{ background:'#fdf4ff', borderColor:'#e9d5ff' }}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#7c3aed', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>Total Take Rate</div>
              <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                <div>
                  <div style={{ fontSize:10, color:'var(--text-muted)', fontWeight:600, marginBottom:2 }}>Inc. GST</div>
                  <div style={{ fontSize:16, fontWeight:800, color:'#7c3aed', whiteSpace:'nowrap' }}>{fmt(techRate.inc_gst)}</div>
                </div>
                <div style={{ width:1, background:'#e9d5ff', alignSelf:'stretch' }}/>
                <div>
                  <div style={{ fontSize:10, color:'var(--text-muted)', fontWeight:600, marginBottom:2 }}>Ex. GST</div>
                  <div style={{ fontSize:16, fontWeight:800, color:'#9333ea', whiteSpace:'nowrap' }}>{fmt(techRate.ex_gst)}</div>
                </div>
              </div>
            </div>
            <div style={{ width:36, height:36, borderRadius:10, background:'#ede9fe', color:'#7c3aed', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:16, fontWeight:800 }}>%</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Hub Sidebar ───────────────────────────────────────────────────────────────
function HubSidebar({ hubs, selectedHub, onSelect }) {
  return (
    <div className="po-sidebar">
      <div className="po-sidebar-header">
        <span style={{ fontWeight:700, fontSize:14 }}>All Hubs</span>
        <span className="po-count-badge">{hubs.length}</span>
      </div>
      <div className="po-hub-list">
        {hubs.map(h => {
          const isActive = selectedHub === h.name;
          return (
            <button key={h.name} className={`po-hub-item${isActive?' po-hub-item--active':''}`} onClick={()=>onSelect(h.name)}>
              <div className="po-hub-avatar">{h.name.charAt(0).toUpperCase()}</div>
              <div style={{ flex:1, minWidth:0, textAlign:'left' }}>
                <div style={{ fontWeight:600, fontSize:13, color:'var(--text)' }}>{h.name}</div>
                <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:1 }}>
                  {h.count} Invoice{h.count!==1?'s':''}
                  {h.unpaid > 0 && <> · <span style={{ color:'#ef4444' }}>{h.unpaid} Unpaid</span></>}
                </div>
              </div>
              <div style={{ textAlign:'right', flexShrink:0 }}>
                <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>Due</div>
                <div style={{ fontSize:13, fontWeight:800, color:h.totalDue>0.01?'#ef4444':'#16a34a' }}>{fmt(h.totalDue)}</div>
              </div>
              <ChevronRight size={14} style={{ color:'var(--text-muted)', flexShrink:0 }}/>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Bulk Payment Modal ────────────────────────────────────────────────────────
function BulkPaymentModal({ selectedInvoices, onClose, onSuccess }) {
  useEscapeClose(onClose);
  const r2 = n => Math.round(n * 100) / 100;
  // Sort oldest first by PI id
  const sorted = [...selectedInvoices].sort((a,b) => a.id - b.id);
  const totalBalance = r2(sorted.reduce((s,pi) => s + parseFloat(pi.grand_total) - parseFloat(pi.amount_paid||0), 0));

  const [amount, setAmount]   = useState(totalBalance.toFixed(2));
  const [method, setMethod]   = useState('bank_transfer');
  const [refNo, setRefNo]     = useState('');
  const [notes, setNotes]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);

  // Auto-distribute amount across PIs oldest first
  const distribution = useMemo(() => {
    let remaining = r2(parseFloat(amount) || 0);
    return sorted.map(pi => {
      const bal = r2(parseFloat(pi.grand_total) - parseFloat(pi.amount_paid||0));
      const pay = r2(Math.min(remaining, bal));
      remaining = r2(remaining - pay);
      return { ...pi, balance: bal, pay, gap: customerPaymentGap(pi) };
    });
  }, [amount, sorted]);

  // Which of the selected invoices has the customer not paid us for?
  // Counted over the rows that will actually receive money — a row the
  // distribution skips (pay = 0) is not a decision being made right now.
  const unpaidByCustomer = useMemo(() => distribution.filter(d => d.pay > 0 && d.gap), [distribution]);

  async function submit(e) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return; }
    if (amt > totalBalance + 0.01) { setError(`Amount exceeds total balance ${fmt(totalBalance)}`); return; }
    setSaving(true); setError(null);
    try {
      const payments = distribution.filter(d => d.pay > 0).map(d => ({ pi_id: d.id, amount: d.pay }));
      await api('/api/purchase-invoices/bulk-payment', {
        method: 'POST',
        body: { payments, method, reference_no: refNo.trim()||null, notes: notes.trim()||null },
      });
      onSuccess();
    } catch(err) { setError(err.message||'Failed to record payments'); setSaving(false); }
  }

  return (
    <div className="po-backdrop">
      <div className="po-modal" style={{ maxWidth:580 }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
          <div>
            <div style={{ fontWeight:700, fontSize:15 }}>Bulk Payment</div>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>{sorted.length} invoice{sorted.length!==1?'s':''} selected · Total balance: <strong>{fmt(totalBalance)}</strong></div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex' }}><X size={18}/></button>
        </div>

        <form onSubmit={submit} style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {/* Amount + method */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
              <label style={{ fontSize:12, fontWeight:600 }}>Amount (₹) *</label>
              <input className="po-input" type="number" min="0.01" step="0.01" max={totalBalance} value={amount} onChange={e=>setAmount(e.target.value)} required/>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
              <label style={{ fontSize:12, fontWeight:600 }}>Method</label>
              <select className="po-input" value={method} onChange={e=>setMethod(e.target.value)}>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="upi">UPI</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="app_payment">In-App Payment</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
              <label style={{ fontSize:12, fontWeight:600 }}>Reference No</label>
              <input className="po-input" placeholder="UTR / Cheque no…" value={refNo} onChange={e=>setRefNo(e.target.value)}/>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
              <label style={{ fontSize:12, fontWeight:600 }}>Notes</label>
              <input className="po-input" placeholder="Optional" value={notes} onChange={e=>setNotes(e.target.value)}/>
            </div>
          </div>

          {unpaidByCustomer.length > 0 && (
            <div style={{ display:'flex', gap:9, alignItems:'flex-start', background:'#fffbeb', border:'1px solid #fcd34d', borderRadius:8, padding:'10px 14px', fontSize:12.5, color:'#92400e', marginBottom:16 }}>
              <AlertTriangle size={15} style={{ flexShrink:0, marginTop:1 }}/>
              <div>
                <strong>
                  {unpaidByCustomer.length} of these {distribution.filter(d=>d.pay>0).length} payments
                  {unpaidByCustomer.length===1 ? ' is' : ' are'} for a job the customer has not fully paid.
                </strong>
                <div style={{ marginTop:3, opacity:0.9 }}>
                  {fmt(unpaidByCustomer.reduce((s,d)=>s+d.gap.due,0))} is still owed to you across
                  {' '}{unpaidByCustomer.length===1 ? 'that invoice' : 'those invoices'} — marked <strong>⚠</strong> below.
                </div>
              </div>
            </div>
          )}

          {/* Distribution preview */}
          <div>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:8 }}>Payment Distribution Preview</div>
            <div style={{ border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead>
                  <tr>
                    {['PI #','Balance','Will Pay','Status'].map(h=>(
                      <th key={h} style={{ padding:'7px 12px', fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', background:'var(--bg-soft)', borderBottom:'1px solid var(--border)', textAlign:['Balance','Will Pay'].includes(h)?'right':'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {distribution.map((d,i)=>(
                    <tr key={d.id} style={{ background: i%2===0?undefined:'var(--bg-soft)' }}>
                      <td style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)', fontSize:13, fontWeight:700, color:'var(--primary)' }}>
                        PI-{String(d.id).padStart(6,'0')}
                        {d.pay>0 && d.gap && (
                          <span title={`Customer still owes ${fmt(d.gap.due)} on CI-${String(d.customer_invoice_id).padStart(6,'0')}`}
                                style={{ color:'#d97706', marginLeft:5, cursor:'help' }}>⚠</span>
                        )}
                      </td>
                      <td style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)', fontSize:13, textAlign:'right', color:'#ef4444', fontWeight:600 }}>{fmt(d.balance)}</td>
                      <td style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)', fontSize:13, textAlign:'right', fontWeight:700, color: d.pay>=d.balance?'#16a34a':'#d97706' }}>{d.pay>0?fmt(d.pay):'—'}</td>
                      <td style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)', fontSize:11 }}>
                        {d.pay<=0 ? <span style={{ color:'var(--text-muted)' }}>Skipped</span>
                          : d.pay>=d.balance ? <span style={{ color:'#16a34a', fontWeight:700 }}>✓ Fully Paid</span>
                          : <span style={{ color:'#d97706', fontWeight:700 }}>Partial</span>}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={2} style={{ padding:'8px 12px', fontSize:12, fontWeight:700, color:'var(--text-muted)', background:'var(--bg-soft)' }}>Total Payment</td>
                    <td style={{ padding:'8px 12px', fontSize:14, fontWeight:800, color:'var(--primary)', textAlign:'right', background:'var(--bg-soft)' }}>{fmt(distribution.reduce((s,d)=>s+d.pay,0))}</td>
                    <td style={{ background:'var(--bg-soft)' }}/>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {error && <div style={{ color:'#dc2626', fontSize:12, display:'flex', gap:6, alignItems:'center' }}><AlertCircle size={13}/>{error}</div>}
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <button type="button" className="po-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="po-btn-primary" disabled={saving}>
              {saving ? 'Processing…' : `Pay ${fmt(distribution.reduce((s,d)=>s+d.pay,0))}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Paying a hub through the bank ─────────────────────────────────────────────

/**
 * Can this hub be paid by bank transfer, and if not, why not?
 *
 * Asked per hub rather than derived from a list, because the answer changes the
 * moment somebody edits the hub's account number — a trigger in the database
 * resets the registration when that happens (migration 144), and a cached
 * "verified" would offer a Pay button that sends money to an account nobody
 * approved.
 *
 * Returns null while loading and while no hub is selected. A payout goes to ONE
 * bank account, so "All hubs" has no answer to give.
 */
function useHubPayoutReadiness(hubId, reloadKey = 0) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!hubId) { setState(null); return; }
    let alive = true;
    api(`/api/hub-payouts/hubs/${hubId}/readiness`)
      .then(r => { if (alive) setState(r); })
      // A readiness lookup that fails must not break the page. The Pay-via-bank
      // button simply does not appear, and recording by hand still works — which
      // is the correct degradation for a screen whose job is paying people.
      .catch(() => { if (alive) setState({ error: true, blocker: 'unknown' }); });
    return () => { alive = false; };
  }, [hubId, reloadKey]);
  return state;
}

/**
 * Confirm-and-send for a real bank transfer.
 *
 * Everything on this dialog exists because the action is irreversible from
 * inside this system. Once the provider accepts it, this application can no
 * longer stop it — a wrong amount comes back as a conversation with the hub, and
 * a wrong hub comes back as a conversation with a bank.
 *
 * So it shows: which account, the exact per-invoice split, and whether the
 * customer has actually paid for these jobs. Nothing here is editable except the
 * decision to go ahead.
 */
function BankPayoutModal({ hubName, hubId, readiness, invoices, onClose, onSuccess }) {
  useEscapeClose(onClose);
  const r2 = n => Math.round(n * 100) / 100;
  const sorted = [...invoices].sort((a, b) => a.id - b.id);

  // Full balance, every time. A partial bank transfer is a legitimate thing to
  // want, but it is not a thing to offer by default on an irreversible action —
  // the amount typed in the box is the amount that leaves.
  const lines = sorted.map(pi => ({
    id: pi.id,
    amount: r2(parseFloat(pi.grand_total) - parseFloat(pi.amount_paid || 0)),
    gap: customerPaymentGap(pi),
  })).filter(l => l.amount > 0);

  const total = r2(lines.reduce((s, l) => s + l.amount, 0));
  const unpaidByCustomer = lines.filter(l => l.gap);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!lines.length) { setError('Nothing to pay — every selected invoice is settled.'); return; }
    setSending(true); setError(null);
    try {
      const out = await api('/api/hub-payouts', {
        method: 'POST',
        body: {
          hub_id: hubId,
          lines: lines.map(l => ({ purchase_invoice_id: l.id, amount: l.amount })),
        },
      });
      onSuccess(out.item);
    } catch (err) {
      // Left on the dialog rather than closing it. A failed transfer needs the
      // reason read next to the amount it was for.
      setError(err.message || 'Could not start the transfer.');
      setSending(false);
    }
  }

  return (
    <div className="po-backdrop">
      <div className="po-modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
          <div>
            <div style={{ fontWeight:700, fontSize:15 }}>Pay by bank transfer</div>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>
              {hubName} · {lines.length} invoice{lines.length !== 1 ? 's' : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex' }}><X size={18}/></button>
        </div>

        {/* WHERE the money is going, first and largest. On an irreversible
            action the destination matters more than the amount — a wrong amount
            is recoverable by conversation, a wrong account often is not. */}
        <div style={{ background:'var(--bg-soft)', border:'1px solid var(--border)', borderRadius:8, padding:'11px 14px', marginBottom:14 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em' }}>Sending to</div>
          <div style={{ fontSize:14, fontWeight:700, marginTop:3 }}>
            Account ••••{readiness?.account_last4 || '????'}
          </div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>
            IFSC {readiness?.ifsc || '—'} · registered with the payout provider
          </div>
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:8, background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#166534', marginBottom:14 }}>
          <Landmark size={14}/> Total to transfer: <strong>{fmt(total)}</strong>
        </div>

        {unpaidByCustomer.length > 0 && (
          <div style={{ display:'flex', gap:9, alignItems:'flex-start', background:'#fffbeb', border:'1px solid #fcd34d', borderRadius:8, padding:'10px 14px', fontSize:12.5, color:'#92400e', marginBottom:14 }}>
            <AlertTriangle size={15} style={{ flexShrink:0, marginTop:1 }}/>
            <div>
              <strong>
                {unpaidByCustomer.length} of these {lines.length} invoice{lines.length !== 1 ? 's are' : ' is'} for
                a job the customer has not fully paid.
              </strong>
              <div style={{ marginTop:3, opacity:0.9 }}>
                {fmt(unpaidByCustomer.reduce((s, l) => s + l.gap.due, 0))} is still owed to you.
                Sending this now means paying out before you have been paid — marked <strong>⚠</strong> below.
              </div>
            </div>
          </div>
        )}

        <div style={{ border:'1px solid var(--border)', borderRadius:8, overflow:'hidden', marginBottom:14 }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>
                {['PI #', 'Will send'].map(h => (
                  <th key={h} style={{ padding:'7px 12px', fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', background:'var(--bg-soft)', borderBottom:'1px solid var(--border)', textAlign: h === 'Will send' ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id} style={{ background: i % 2 === 0 ? undefined : 'var(--bg-soft)' }}>
                  <td style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)', fontSize:13, fontWeight:700, color:'var(--primary)' }}>
                    PI-{String(l.id).padStart(6, '0')}
                    {l.gap && (
                      <span title={`Customer still owes ${fmt(l.gap.due)}`}
                            style={{ color:'#d97706', marginLeft:5, cursor:'help' }}>⚠</span>
                    )}
                  </td>
                  <td style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)', fontSize:13, textAlign:'right', fontWeight:700 }}>{fmt(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Not a disclaimer. This is the difference between this button and the
            Record Payment one beside it, and somebody pressing it for the first
            time has no other way to know. */}
        <div style={{ fontSize:12, color:'var(--text-muted)', lineHeight:1.5, marginBottom:14 }}>
          This sends money now. It cannot be cancelled from here once the bank accepts it —
          the invoice is only marked paid when the transfer is confirmed, which is usually
          the same day.
        </div>

        {error && <div style={{ color:'#dc2626', fontSize:12, display:'flex', gap:6, alignItems:'flex-start', marginBottom:10 }}><AlertCircle size={13} style={{ marginTop:2, flexShrink:0 }}/>{error}</div>}

        <form onSubmit={submit} style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button type="button" className="po-btn-ghost" onClick={onClose} disabled={sending}>Cancel</button>
          <button type="submit" className="po-btn-primary" disabled={sending || !lines.length}>
            {sending ? 'Sending…' : `Send ${fmt(total)}`}
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * The band that says why a hub cannot be paid automatically, with the one action
 * that fixes it.
 *
 * Shown instead of failing at press time. Two blockers, two different pieces of
 * work for two different people: missing bank details is paperwork on the hub
 * record, missing registration is one button here.
 */
function PayoutReadinessBand({ readiness, hubName }) {
  if (!readiness || readiness.error || !readiness.blocker) return null;
  const needsDetails = readiness.blocker === 'bank_details';
  return (
    <div className="po-readiness">
      <AlertTriangle size={15} style={{ flexShrink:0, marginTop:1 }}/>
      <div style={{ flex:1 }}>
        <strong>{hubName} cannot be paid by bank transfer yet.</strong>
        <div style={{ marginTop:3, opacity:0.9 }}>
          {/* ── Both blockers now point at the SAME place ─────────────────
              There used to be a Register account button here, and the two
              blockers sent you to two different screens: "add bank details"
              to the hub record, "register" to a button on this page. They are
              consecutive steps on one form, so that split made the second one
              feel like a separate system.

              Registration now lives on the hub's own record, beside the
              account it registers — which is also where it has to be, because
              editing the account number un-registers the hub (a database
              trigger, migration 144) and the person editing is the one who
              needs to see it. */}
          {needsDetails
            ? `Missing ${readiness.missing.join(', ')}.`
            : 'Bank details are on file but the account is not registered with the payout provider yet.'}
          {' '}Open the hub under <strong>Master Data → Hubs</strong> to
          {needsDetails ? ' add them and register the account' : ' register the account'}.
          {' '}Until then, pay this hub from your banking app and record it here with <strong>Pay</strong>.
        </div>
      </div>
    </div>
  );
}

// ── Invoice Panel (with tabs) ─────────────────────────────────────────────────
const PAGE_SIZES = [10, 25, 50];

function InvoicePanel({ hubName, hubId, invoices, onPay, onViewPayments, onBulkSuccess, onExport, showToast, onChanged }) {
  const navigate    = useNavigate();
  const [tab, setTab]           = useState('invoices');
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [openMenu, setOpenMenu] = useState(null);
  const [selected, setSelected] = useState(new Set()); // selected PI ids
  const [bulkModal, setBulkModal] = useState(false);

  // ── Bank transfer ──────────────────────────────────────────────────────────
  // Separate permission from PAYMENT_PERMS above, and deliberately so: those
  // govern recording a payout somebody already made from their banking app,
  // which is a bookkeeping entry. This one moves real money and cannot be undone
  // from this application.
  const canPayOnline  = useCan('PAY_HUB_ONLINE');
  // canRegister used to live here for the Register account button. That button
  // moved to the hub's own record (Master Data → Hubs → view a hub), so this
  // page no longer needs the permission — see PayoutReadinessBand below.
  const [readyKey, setReadyKey]   = useState(0);
  const readiness  = useHubPayoutReadiness(hubId, readyKey);
  const [bankModal, setBankModal] = useState(null);   // invoices to transfer for

  // Offered only when the money can actually go somewhere. A disabled Pay-by-
  // bank button on an unregistered hub is a button that explains nothing; the
  // readiness band above the table is what explains it.
  const bankReady = Boolean(hubId) && canPayOnline && readiness && !readiness.error && !readiness.blocker;

  const today    = useMemo(() => { const d=new Date(); d.setHours(0,0,0,0); return d; }, []);
  const sorted   = useMemo(() => [...invoices].sort((a,b)=>a.id-b.id), [invoices]);
  const totalPages = Math.max(1, Math.ceil(sorted.length/pageSize));
  const paginated  = sorted.slice((page-1)*pageSize, page*pageSize);
  const totalDue   = invoices.reduce((s,pi)=>s+parseFloat(pi.grand_total)-parseFloat(pi.amount_paid||0), 0);
  const unpaid     = invoices.filter(pi=>pi.payment_status!=='paid').length;

  useEffect(()=>{ setPage(1); setTab('invoices'); setSelected(new Set()); }, [hubName]);

  const unpaidInvoices   = sorted.filter(pi => !isSettled(pi.payment_status));
  const allPageSelected  = paginated.filter(pi=>pi.payment_status!=='paid').every(pi=>selected.has(pi.id));
  const somePageSelected = paginated.some(pi=>selected.has(pi.id));
  const selectedInvoices = sorted.filter(pi=>selected.has(pi.id));

  function toggleOne(id) {
    setSelected(prev => { const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });
  }
  function toggleAll() {
    const unpaidOnPage = paginated.filter(pi=>pi.payment_status!=='paid');
    if (allPageSelected) {
      setSelected(prev=>{ const n=new Set(prev); unpaidOnPage.forEach(pi=>n.delete(pi.id)); return n; });
    } else {
      setSelected(prev=>{ const n=new Set(prev); unpaidOnPage.forEach(pi=>n.add(pi.id)); return n; });
    }
  }

  return (
    <div className="po-panel">
      {/* Panel header */}
      <div className="po-panel-header">
        <div>
          <div style={{ fontWeight:700, fontSize:16, color:'var(--text)' }}>{hubName}</div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>
            {invoices.length} Invoice{invoices.length!==1?'s':''}
            {unpaid>0 && <> · <span style={{ color:'#ef4444', fontWeight:600 }}>{unpaid} Unpaid</span></>}
          </div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>Total Due</div>
          <div style={{ fontSize:18, fontWeight:800, color:totalDue>0.01?'#ef4444':'#16a34a' }}>{fmt(totalDue)}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="po-tabs">
        <button className={`po-tab${tab==='invoices'?' po-tab--active':''}`} onClick={()=>setTab('invoices')}>
          <Receipt size={14}/> Invoices
        </button>
        <button className={`po-tab${tab==='payments'?' po-tab--active':''}`} onClick={()=>setTab('payments')}>
          <History size={14}/> Payment History
        </button>
      </div>

      {/* Invoices tab */}
      {tab==='invoices' && (
        <>
          {/* Why this hub cannot be paid automatically — said here, once, rather
              than discovered at the moment somebody presses a button. */}
          {canPayOnline && (
            <PayoutReadinessBand
              readiness={readiness} hubName={hubName}
            />
          )}

          {/* Bulk selection action bar */}
          {selected.size > 0 && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 16px', background:'color-mix(in srgb, var(--primary) 8%, var(--bg))', borderBottom:'1px solid var(--border)', borderTop:'1px solid var(--border)' }}>
              <span style={{ fontSize:13, fontWeight:600, color:'var(--primary)' }}>
                {selected.size} invoice{selected.size !== 1 ? 's' : ''} selected
              </span>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <button className="po-btn-ghost" style={{ fontSize:12, padding:'5px 12px' }} onClick={() => setSelected(new Set())}>
                  Clear
                </button>
                {/* Two buttons, not one with a mode. Recording a payment and
                    sending one are different actions with different consequences
                    — a dropdown or a toggle would let the wrong one be pressed
                    by muscle memory, and only one of them can be undone. The
                    ghost styling on Record keeps the irreversible one visually
                    distinct rather than merely adjacent. */}
                <button className="po-btn-ghost" style={{ fontSize:12, padding:'5px 16px', display:'flex', alignItems:'center', gap:6 }} onClick={() => setBulkModal(true)}>
                  <CreditCard size={13}/> Record {selected.size} payment{selected.size !== 1 ? 's' : ''}
                </button>
                {bankReady && (
                  <button className="po-btn-primary" style={{ fontSize:12, padding:'5px 16px', display:'flex', alignItems:'center', gap:6 }}
                          onClick={() => setBankModal(selectedInvoices)}>
                    <Landmark size={13}/> Pay by bank
                  </button>
                )}
              </div>
            </div>
          )}

          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', minWidth:720 }}>
              <thead>
                <tr>
                  <th style={{ padding:'9px 10px 9px 14px', background:'var(--bg-soft)', borderBottom:'1px solid var(--border)', width:36 }}>
                    <input type="checkbox" checked={allPageSelected && unpaidInvoices.length>0} ref={el=>{ if(el) el.indeterminate=somePageSelected&&!allPageSelected; }} onChange={toggleAll} style={{ cursor:'pointer', accentColor:'var(--primary)', width:15, height:15 }}/>
                  </th>
                  {['PI # / CI #','Vehicle','Grand Total','Paid','Balance','Due Date','Status','Action'].map(h=>(
                    <th key={h} style={{ padding:'9px 14px', fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', borderBottom:'1px solid var(--border)', background:'var(--bg-soft)', textAlign:['Grand Total','Paid','Balance'].includes(h)?'right':'left', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.length===0 ? (
                  <tr><td colSpan={8} style={{ padding:32, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>No invoices found.</td></tr>
                ) : paginated.map(pi=>{
                  const balance  = parseFloat(pi.grand_total)-parseFloat(pi.amount_paid||0);
                  const d        = pi.payout_due_date ? new Date(pi.payout_due_date) : null;
                  const isOverdue = d && d<today && pi.payment_status!=='paid';
                  const isSelectable = !isSettled(pi.payment_status);
                  return (
                    <tr key={pi.id} style={{ background: selected.has(pi.id)?'color-mix(in srgb, var(--primary) 5%, var(--bg))': isOverdue?'#fff5f5':undefined }} onMouseLeave={()=>setOpenMenu(null)}>
                      <td style={{ padding:'11px 10px 11px 14px', borderBottom:'1px solid var(--border)' }}>
                        <input type="checkbox" disabled={!isSelectable} checked={selected.has(pi.id)} onChange={()=>toggleOne(pi.id)} style={{ cursor: isSelectable?'pointer':'not-allowed', accentColor:'var(--primary)', width:15, height:15 }}/>
                      </td>
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <button onClick={()=>navigate(pi.purchase_invoice_token ? `/purchase-invoices/${pi.purchase_invoice_token}` : '/purchase-invoices', pi.purchase_invoice_token ? undefined : { state:{ openId:pi.id } })} style={{ background:'none', border:'none', padding:0, cursor:'pointer', fontWeight:700, fontSize:12, color:'var(--primary)', fontFamily:'inherit' }}>
                            PI-{String(pi.id).padStart(6,'0')}
                          </button>
                          {isOverdue && <span style={{ fontSize:10, fontWeight:700, background:'#fee2e2', color:'#991b1b', padding:'1px 6px', borderRadius:99 }}>OVERDUE</span>}
                        </div>
                        {pi.customer_invoice_id && (
                          <HoverCard
                            width={210}
                            card={<>
                              <span style={{ fontSize:11, fontWeight:800, color:'var(--text-muted)', letterSpacing:'0.04em', paddingBottom:5, borderBottom:'1px solid var(--border)' }}>
                                CI-{String(pi.customer_invoice_id).padStart(6,'0')}
                              </span>
                              <span className="po-ci-row"><span>Total</span><strong>{fmt(pi.ci_grand_total)}</strong></span>
                              <span className="po-ci-row"><span>Paid</span><strong style={{ color:'#16a34a' }}>{fmt(pi.ci_amount_paid)}</strong></span>
                              {/* Balance is derived, not stored — showing it saves
                                  the reader the subtraction, and zero is the normal
                                  case worth confirming. */}
                              <span className="po-ci-row">
                                <span>Balance</span>
                                <strong style={{ color:(Number(pi.ci_grand_total||0)-Number(pi.ci_amount_paid||0))>0.01 ? '#dc2626' : 'var(--text-muted)' }}>
                                  {fmt(Math.max(0, Number(pi.ci_grand_total||0)-Number(pi.ci_amount_paid||0)))}
                                </strong>
                              </span>
                              {/* The date the payout schedule is anchored to —
                                  this is what explains the Due Date column. */}
                              <span className="po-ci-row po-ci-row--sep">
                                <span>Customer paid</span>
                                <strong>{pi.ci_last_paid_at ? fmtDate(pi.ci_last_paid_at) : 'Not yet'}</strong>
                              </span>
                            </>}
                          >
                            <button onClick={()=>navigate(pi.customer_invoice_token ? `/customer-invoices/${pi.customer_invoice_token}` : '/customer-invoices', pi.customer_invoice_token ? undefined : { state:{ openId:pi.customer_invoice_id } })} style={{ background:'none', border:'none', padding:0, marginTop:2, cursor:'pointer', fontWeight:700, fontSize:11, color:'var(--text-muted)', fontFamily:'inherit' }}>
                              CI-{String(pi.customer_invoice_id).padStart(6,'0')}
                            </button>
                          </HoverCard>
                        )}
                      </td>
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:13, color:'var(--text-muted)' }}>{pi.vehicle_number||'—'}</td>
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:13, fontWeight:600, textAlign:'right' }}>{fmt(pi.grand_total)}</td>
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:13, color:'#16a34a', fontWeight:600, textAlign:'right' }}>{fmt(pi.amount_paid)}</td>
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:14, fontWeight:800, color:balance>0.01?'#ef4444':'#16a34a', textAlign:'right' }}>{fmt(balance)}</td>
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:12, color:isOverdue?'#dc2626':'var(--text-muted)', fontWeight:isOverdue?700:400 }}>
                        {pi.payout_due_date ? fmtDate(pi.payout_due_date) : (
                          <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:600, color:'#0284c7' }}>
                            <Clock size={11}/> Awaiting payment
                          </span>
                        )}
                      </td>
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}><PayBadge status={pi.payment_status||'pending'}/></td>
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6, justifyContent:'flex-end' }}>
                          {pi.payment_status!=='paid' && (
                            <button className="po-btn-primary" style={{ padding:'5px 14px', fontSize:12 }} onClick={()=>onPay(pi)}>Pay</button>
                          )}
                          <div style={{ position:'relative' }}>
                            <button className="po-icon-btn" onClick={()=>setOpenMenu(openMenu===pi.id?null:pi.id)}><MoreVertical size={15}/></button>
                            {openMenu===pi.id && (
                              <div className="po-menu">
                                {/* In the menu rather than beside Pay. A one-row
                                    bank transfer is the less common case — the
                                    reason to use this feature at all is paying a
                                    fortnight's invoices in one go — and putting
                                    an irreversible action next to a reversible
                                    one at the end of every row is asking for the
                                    wrong click. */}
                                {bankReady && !isSettled(pi.payment_status) && (
                                  <button className="po-menu-item" onClick={()=>{ setBankModal([pi]); setOpenMenu(null); }}>
                                    <Landmark size={13}/> Pay by bank
                                  </button>
                                )}
                                <button className="po-menu-item" onClick={()=>{ onViewPayments(pi); setOpenMenu(null); }}>
                                  <History size={13}/> View Payments
                                </button>
                                <button className="po-menu-item" onClick={()=>{ navigate(pi.purchase_invoice_token ? `/purchase-invoices/${pi.purchase_invoice_token}` : '/purchase-invoices', pi.purchase_invoice_token ? undefined : { state:{ openId:pi.id } }); setOpenMenu(null); }}>
                                  <Receipt size={13}/> View Invoice
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {sorted.length > 0 && (
            <div className="po-pagination">
              <div style={{ fontSize:13, color:'var(--text-muted)' }}>
                Showing <strong>{Math.min((page-1)*pageSize+1,sorted.length)}</strong> to <strong>{Math.min(page*pageSize,sorted.length)}</strong> of <strong>{sorted.length}</strong> invoice{sorted.length!==1?'s':''}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <select className="po-pg-select" value={pageSize} onChange={e=>{ setPageSize(Number(e.target.value)); setPage(1); }}>
                  {PAGE_SIZES.map(s=><option key={s} value={s}>{s} / page</option>)}
                </select>
                <div style={{ display:'flex', gap:4 }}>
                  <button className="po-pg-btn" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}><ChevronLeft size={14}/></button>
                  {Array.from({length:totalPages},(_,i)=>i+1).filter(p=>p===1||p===totalPages||Math.abs(p-page)<=1).reduce((acc,p,i,arr)=>{ if(i>0&&p-arr[i-1]>1)acc.push('...'); acc.push(p); return acc; },[]).map((p,i)=>
                    p==='...'
                      ? <span key={`e${i}`} style={{ padding:'0 4px', fontSize:13, color:'var(--text-muted)', display:'flex', alignItems:'center' }}>…</span>
                      : <button key={p} className={`po-pg-btn${page===p?' po-pg-btn--active':''}`} onClick={()=>setPage(p)}>{p}</button>
                  )}
                  <button className="po-pg-btn" onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}><ChevronRight size={14}/></button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Payments tab */}
      {tab==='payments' && <HubPaymentsTab hubName={hubName} hubId={hubId} onExport={onExport} showToast={showToast} onChanged={onChanged}/>}

      {/* Bulk payment modal */}
      {bulkModal && selectedInvoices.length > 0 && (
        <BulkPaymentModal
          selectedInvoices={selectedInvoices}
          onClose={() => setBulkModal(false)}
          onSuccess={() => { setBulkModal(false); setSelected(new Set()); onBulkSuccess?.(); }}
        />
      )}

      {/* Bank transfer */}
      {bankModal && bankModal.length > 0 && (
        <BankPayoutModal
          hubName={hubName} hubId={hubId} readiness={readiness} invoices={bankModal}
          onClose={() => setBankModal(null)}
          onSuccess={(payout) => {
            setBankModal(null); setSelected(new Set());
            // The message says what actually happened, which is NOT "paid". A
            // queued transfer that reports "Paid" is how somebody concludes the
            // hub has its money and moves on — the invoice only closes when the
            // bank confirms.
            showToast?.(payout?.status === 'processed'
              ? `${payout.payout_ref} sent — ${fmt(payout.amount)} confirmed by the bank.`
              : `${payout?.payout_ref || 'Transfer'} sent to the bank. The invoice is marked paid once it confirms.`);
            onBulkSuccess?.();
          }}
        />
      )}
    </div>
  );
}

// ── Mobile Hub Card ───────────────────────────────────────────────────────────
const MOBILE_PREVIEW = 5;

function MobileHubCard({ hub, invoices, onPay, onViewPayments }) {
  const navigate  = useNavigate();
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const today = useMemo(()=>{ const d=new Date(); d.setHours(0,0,0,0); return d; }, []);
  const sorted  = useMemo(()=>[...invoices].sort((a,b)=>a.id-b.id), [invoices]);
  const visible = showAll ? sorted : sorted.slice(0, MOBILE_PREVIEW);

  return (
    <div className="po-mob-card">
      {/* Hub header */}
      <button className="po-mob-card-header" onClick={()=>setOpen(o=>!o)}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div className="po-hub-avatar">{hub.name.charAt(0).toUpperCase()}</div>
          <div style={{ textAlign:'left' }}>
            <div style={{ fontWeight:700, fontSize:14, color:'var(--text)' }}>{hub.name}</div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:1 }}>
              {hub.count} Invoice{hub.count!==1?'s':''}
              {hub.unpaid>0 && <> · <span style={{ color:'#ef4444' }}>{hub.unpaid} Unpaid</span></>}
            </div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>Total Due</div>
            <div style={{ fontSize:14, fontWeight:800, color:hub.totalDue>0.01?'#ef4444':'#16a34a' }}>{fmt(hub.totalDue)}</div>
          </div>
          <div style={{ color:'var(--text-muted)', fontSize:18 }}>{open?'∧':'∨'}</div>
        </div>
      </button>

      {open && (
        <div>
          {/* Compact table */}
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', minWidth:420 }}>
              <thead>
                <tr>
                  {['PI#','Vehicle','Amount','Balance','Due Date','Status',''].map(h=>(
                    <th key={h} style={{ padding:'7px 10px', fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em', borderBottom:'1px solid var(--border)', background:'var(--bg-soft)', textAlign:['Amount','Balance'].includes(h)?'right':'left', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map(pi=>{
                  const balance  = parseFloat(pi.grand_total)-parseFloat(pi.amount_paid||0);
                  const d        = pi.payout_due_date ? new Date(pi.payout_due_date) : null;
                  const isOverdue = d && d<today && pi.payment_status!=='paid';
                  return (
                    <tr key={pi.id} style={{ background:isOverdue?'#fff5f5':undefined }}>
                      <td style={{ padding:'9px 10px', borderBottom:'1px solid var(--border)' }}>
                        <button onClick={()=>navigate(pi.purchase_invoice_token ? `/purchase-invoices/${pi.purchase_invoice_token}` : '/purchase-invoices', pi.purchase_invoice_token ? undefined : { state:{ openId:pi.id } })} style={{ background:'none', border:'none', padding:0, cursor:'pointer', fontWeight:700, fontSize:12, color:'var(--primary)', fontFamily:'inherit', whiteSpace:'nowrap' }}>
                          PI-{String(pi.id).padStart(6,'0')}
                        </button>
                        {isOverdue && <div style={{ fontSize:9, fontWeight:700, background:'#fee2e2', color:'#991b1b', padding:'1px 5px', borderRadius:4, marginTop:2, display:'inline-block' }}>OD</div>}
                        {pi.customer_invoice_id && (
                          <div>
                            <button onClick={()=>navigate(pi.customer_invoice_token ? `/customer-invoices/${pi.customer_invoice_token}` : '/customer-invoices', pi.customer_invoice_token ? undefined : { state:{ openId:pi.customer_invoice_id } })} style={{ background:'none', border:'none', padding:0, cursor:'pointer', fontWeight:700, fontSize:12, color:'var(--text-muted)', fontFamily:'inherit', whiteSpace:'nowrap' }}>
                              CI-{String(pi.customer_invoice_id).padStart(6,'0')}
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={{ padding:'9px 10px', borderBottom:'1px solid var(--border)', fontSize:11, color:'var(--text-muted)' }}>{pi.vehicle_number||'—'}</td>
                      <td style={{ padding:'9px 10px', borderBottom:'1px solid var(--border)', fontSize:12, fontWeight:600, textAlign:'right' }}>{fmt(pi.grand_total)}</td>
                      <td style={{ padding:'9px 10px', borderBottom:'1px solid var(--border)', fontSize:12, fontWeight:800, color:balance>0.01?'#ef4444':'#16a34a', textAlign:'right' }}>{fmt(balance)}</td>
                      <td style={{ padding:'9px 10px', borderBottom:'1px solid var(--border)', fontSize:11, color:isOverdue?'#dc2626':'var(--text-muted)', whiteSpace:'nowrap' }}>
                        {pi.payout_due_date ? fmtDate(pi.payout_due_date) : (
                          <span style={{ color:'#0284c7', fontWeight:600 }}>Awaiting payment</span>
                        )}
                      </td>
                      <td style={{ padding:'9px 10px', borderBottom:'1px solid var(--border)' }}><PayBadge status={pi.payment_status||'pending'}/></td>
                      <td style={{ padding:'9px 10px', borderBottom:'1px solid var(--border)', textAlign:'right' }}>
                        {pi.payment_status!=='paid' && (
                          <button className="po-btn-primary" style={{ padding:'4px 12px', fontSize:11 }} onClick={()=>onPay(pi)}>Pay</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* View all / show less */}
          {sorted.length > MOBILE_PREVIEW && (
            <button
              onClick={()=>setShowAll(s=>!s)}
              style={{ display:'flex', alignItems:'center', gap:4, padding:'10px 14px', width:'100%', background:'none', border:'none', borderTop:'1px solid var(--border)', cursor:'pointer', fontSize:13, fontWeight:600, color:'var(--primary)', fontFamily:'inherit' }}
            >
              {showAll ? 'Show less' : `View all ${sorted.length} invoices`}
              {!showAll && <ChevronRight size={14}/>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Mobile Payouts View ───────────────────────────────────────────────────────
function MobilePayoutsView({ allInvoices, hubs, data, onPay, onViewPayments, loading, onExport }) {
  const [hubFilter, setHubFilter]     = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch]           = useState('');

  const filtered = useMemo(()=>{
    const q = search.toLowerCase().trim();
    return allInvoices.filter(pi=>{
      if(hubFilter && pi.hub_name!==hubFilter) return false;
      if(statusFilter && (pi.payment_status||'pending')!==statusFilter) return false;
      if(q){ const piNo=`pi-${String(pi.id).padStart(6,'0')}`; if(!piNo.includes(q)&&!(pi.vehicle_number||'').toLowerCase().includes(q)&&!(pi.hub_name||'').toLowerCase().includes(q)) return false; }
      return true;
    });
  }, [allInvoices, hubFilter, statusFilter, search]);

  const groupedHubs = useMemo(()=>{
    const map={};
    filtered.forEach(pi=>{
      const name=pi.hub_name||'Unknown';
      if(!map[name]) map[name]=[];
      map[name].push(pi);
    });
    return Object.entries(map).sort(([an,ai],[bn,bi])=>{
      const ad=ai.reduce((s,p)=>s+parseFloat(p.grand_total)-parseFloat(p.amount_paid||0),0);
      const bd=bi.reduce((s,p)=>s+parseFloat(p.grand_total)-parseFloat(p.amount_paid||0),0);
      return bd-ad;
    });
  }, [filtered]);

  const hubMeta = useMemo(()=>{
    const m={};
    hubs.forEach(h=>{ m[h.name]=h; });
    return m;
  }, [hubs]);

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:14 }}>
        <div style={{ position:'relative', display:'flex', alignItems:'center' }}>
          <Search size={14} style={{ position:'absolute', left:10, color:'var(--text-muted)', pointerEvents:'none' }}/>
          <input className="po-input" style={{ paddingLeft:32, paddingRight:search?32:12 }} placeholder="Search hub, vehicle, invoice…" value={search} onChange={e=>setSearch(e.target.value)}/>
          {search && <button onClick={()=>setSearch('')} style={{ position:'absolute', right:8, background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex' }}><X size={13}/></button>}
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <select className="po-input" style={{ flex:1 }} value={hubFilter} onChange={e=>setHubFilter(e.target.value)}>
            <option value="">All Hubs</option>
            {hubs.map(h=><option key={h.name} value={h.name}>{h.name}</option>)}
          </select>
          <select className="po-input" style={{ flex:1 }} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="pending">Unpaid</option>
            <option value="partially_paid">Part Paid</option>
            <option value="not_required">No Payment Due</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        {(() => {
          const selectedHubId = hubs.find(h=>h.name===hubFilter)?.id;
          return (
            <button className="po-btn-ghost" style={{ fontSize:12, padding:'8px', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }} onClick={() => onExport({ type: 'outstanding', search, status: statusFilter, hub_id: selectedHubId })}>
              <Download size={14} /> Export CSV
            </button>
          );
        })()}
      </div>

      {loading ? (
        <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)' }}><Clock size={28} style={{ opacity:0.3 }}/></div>
      ) : groupedHubs.length===0 ? (
        <div style={{ textAlign:'center', padding:'40px 16px', background:'var(--bg-soft)', borderRadius:12, border:'1px solid var(--border)' }}>
          <CheckCircle2 size={32} style={{ color:'#16a34a', marginBottom:10 }}/>
          <div style={{ fontSize:15, fontWeight:700, color:'#166534' }}>All Caught Up!</div>
          <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:4 }}>No pending payouts.</div>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {groupedHubs.map(([hubName, invoices])=>(
            <MobileHubCard
              key={hubName}
              hub={hubMeta[hubName]||{ name:hubName, count:invoices.length, unpaid:invoices.filter(p=>p.payment_status!=='paid').length, totalDue:invoices.reduce((s,p)=>s+parseFloat(p.grand_total)-parseFloat(p.amount_paid||0),0) }}
              invoices={invoices}
              onPay={onPay}
              onViewPayments={onViewPayments}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════
export default function PayoutsPage() {
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [payPi, setPayPi]         = useState(null);
  const [viewPaymentsPi, setViewPaymentsPi] = useState(null);
  const [toast, setToast]         = useState(null);
  const [selectedHub, setSelectedHub] = useState(null);
  const [mainTab, setMainTab]     = useState('payouts');
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [totalPaid, setTotalPaid]       = useState(0);
  const [techRate, setTechRate]         = useState({ ex_gst:0, inc_gst:0 });

  const showToast = useCallback((msg,type='success')=>setToast({msg,type}), []);

  const load = useCallback(async()=>{
    setLoading(true);
    try {
      const [payoutsRes, paymentsRes, techRes] = await Promise.all([
        api('/api/purchase-invoices/payouts'),
        api('/api/purchase-invoices/hub-payments').catch(()=>({ total:0 })),
        api('/api/purchase-invoices/tech-rate-summary').catch(()=>({ total_ex_gst:0, total_inc_gst:0 })),
      ]);
      setData(payoutsRes);
      setTotalPaid(parseFloat(paymentsRes.total)||0);
      setTechRate({ ex_gst: parseFloat(techRes.total_ex_gst)||0, inc_gst: parseFloat(techRes.total_inc_gst)||0 });
    }
    catch(err){ showToast(err.message||'Failed to load payouts.','error'); }
    finally{ setLoading(false); }
  }, [showToast]);

  useEffect(()=>{ load(); }, [load]);

  const handleExport = useCallback(async ({ type, search, status, hub_id, from, to }) => {
    try {
      const { getToken } = await import('../api/client.js');
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
      const params = new URLSearchParams({ type });
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      if (hub_id) params.set('hub_id', hub_id);
      if (from)   params.set('from', from);
      if (to)     params.set('to', to);

      const res = await fetch(`${API_URL}/api/purchase-invoices/export-payouts?${params.toString()}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) { showToast('Export failed. Check your permissions.', 'error'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payouts_${type}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Payouts exported successfully.');
    } catch {
      showToast('Export failed. Please try again.', 'error');
    }
  }, [showToast]);

  async function handlePaySuccess() {
    setPayPi(null);
    showToast('Payment recorded successfully.');
    await load();
  }

  async function handleBulkPaySuccess() {
    showToast('Bulk payment recorded successfully.');
    await load();
  }

  const SECTIONS = ['overdue','due_today','due_this_week','due_this_month','upcoming','awaiting_payment'];
  const allInvoices = useMemo(()=>{ if(!data)return []; return SECTIONS.flatMap(k=>data[k]||[]); }, [data]);

  const hubs = useMemo(()=>{
    const map={};
    allInvoices.forEach(pi=>{
      const name=pi.hub_name||'Unknown Hub';
      if(!map[name]) map[name]={ name, id:pi.hub_id, count:0, unpaid:0, totalDue:0 };
      map[name].count++;
      map[name].totalDue+=parseFloat(pi.grand_total)-parseFloat(pi.amount_paid||0);
      if(pi.payment_status!=='paid') map[name].unpaid++;
    });
    return Object.values(map).sort((a,b)=>b.totalDue-a.totalDue);
  }, [allInvoices]);

  useEffect(()=>{ if(hubs.length>0&&!selectedHub) setSelectedHub(hubs[0].name); }, [hubs]);

  const selectedHubId = useMemo(()=>hubs.find(h=>h.name===selectedHub)?.id, [hubs, selectedHub]);

  const hubInvoices = useMemo(()=>{
    const q=search.toLowerCase().trim();
    return allInvoices.filter(pi=>{
      if(pi.hub_name!==selectedHub) return false;
      if(statusFilter&&(pi.payment_status||'pending')!==statusFilter) return false;
      if(q){ const piNo=`pi-${String(pi.id).padStart(6,'0')}`; if(!piNo.includes(q)&&!(pi.vehicle_number||'').toLowerCase().includes(q)) return false; }
      return true;
    });
  }, [allInvoices, selectedHub, search, statusFilter]);

  return (
    <div className="po-page">
      {/* Header */}
      <div className="po-page-header">
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <Wallet size={22} style={{ color:'var(--primary)' }}/>
          <div>
            <h2 style={{ margin:0, fontSize:20, fontWeight:800 }}>Hub Payouts</h2>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:1 }}>Track and manage payouts across all hubs</div>
          </div>
          {allInvoices.length>0 && <span className="po-count-badge">{allInvoices.length}</span>}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {/* ── Info hover button ── */}
          {!loading && data && (() => {
            const totalOutstanding = allInvoices.reduce((s,pi)=>s+parseFloat(pi.grand_total)-parseFloat(pi.amount_paid||0),0);
            const totalInvoiced    = totalOutstanding + totalPaid;
            const paidPct          = totalInvoiced > 0 ? Math.round((totalPaid/totalInvoiced)*100) : 0;
            return (
              <div style={{ position:'relative' }}
                onMouseEnter={e => e.currentTarget.querySelector('.po-info-popup').style.display='block'}
                onMouseLeave={e => e.currentTarget.querySelector('.po-info-popup').style.display='none'}
              >
                <button style={{ display:'flex', alignItems:'center', justifyContent:'center', width:32, height:32, borderRadius:'50%', border:'1.5px solid var(--border)', background:'var(--bg)', cursor:'pointer', color:'var(--text-muted)' }}>
                  <Info size={15}/>
                </button>
                <div className="po-info-popup" style={{ display:'none', position:'absolute', top:38, right:0, background:'var(--bg)', border:'1px solid var(--border)', borderRadius:10, padding:'14px 18px', whiteSpace:'nowrap', boxShadow:'0 8px 24px rgba(0,0,0,0.12)', zIndex:100, minWidth:260 }}>
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', gap:24 }}>
                      <span style={{ fontSize:12, color:'var(--text-muted)', fontWeight:500 }}>Total Invoiced</span>
                      <span style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>{fmt(totalInvoiced)}</span>
                    </div>
                    <div style={{ height:1, background:'var(--border)' }}/>
                    <div style={{ display:'flex', justifyContent:'space-between', gap:24 }}>
                      <span style={{ fontSize:12, color:'var(--text-muted)', fontWeight:500 }}>Total Paid</span>
                      <span style={{ fontSize:13, fontWeight:700, color:'#16a34a' }}>{fmt(totalPaid)} <span style={{ fontSize:11, fontWeight:500, color:'var(--text-muted)' }}>({paidPct}% collected)</span></span>
                    </div>
                    <div style={{ height:1, background:'var(--border)' }}/>
                    <div style={{ display:'flex', justifyContent:'space-between', gap:24 }}>
                      <span style={{ fontSize:12, color:'var(--text-muted)', fontWeight:500 }}>Total Outstanding</span>
                      <span style={{ fontSize:13, fontWeight:700, color: totalOutstanding>0?'#ef4444':'#16a34a' }}>{fmt(totalOutstanding)} <span style={{ fontSize:11, fontWeight:500, color:'var(--text-muted)' }}>({100-paidPct}% pending)</span></span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
          <button className="po-btn-ghost" onClick={load} disabled={loading} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <RefreshCw size={15} style={{ animation:loading?'spin 1s linear infinite':undefined }}/> Refresh
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <SummaryCards data={data} allInvoices={allInvoices} techRate={techRate}/>

      {/* Main tabs */}
      <div className="po-main-tabs">
        <button className={`po-main-tab${mainTab==='payouts'?' po-main-tab--active':''}`} onClick={()=>setMainTab('payouts')}>
          <Wallet size={15}/> Payouts
        </button>
        <button className={`po-main-tab${mainTab==='history'?' po-main-tab--active':''}`} onClick={()=>setMainTab('history')}>
          <History size={15}/> Payment History
        </button>
      </div>

      {/* Payouts tab */}
      {mainTab==='payouts' && (
        <>
          {/* ── DESKTOP view ── */}
          <div className="po-desktop-only">
            {/* Filter bar */}
            <div className="card" style={{ padding:'12px 16px', display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:16 }}>
              <div style={{ position:'relative', flex:'1 1 220px', display:'flex', alignItems:'center' }}>
                <Search size={14} style={{ position:'absolute', left:10, color:'var(--text-muted)', pointerEvents:'none' }}/>
                <input className="po-input" style={{ paddingLeft:32, paddingRight:search?32:12 }} placeholder="Search PI#, vehicle…" value={search} onChange={e=>setSearch(e.target.value)}/>
                {search && <button onClick={()=>setSearch('')} style={{ position:'absolute', right:8, background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex' }}><X size={13}/></button>}
              </div>
              <select className="po-input" style={{ flex:'0 0 auto', width:'auto' }} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
                <option value="">All Status</option>
                <option value="pending">Unpaid</option>
                <option value="partially_paid">Part Paid</option>
                <option value="not_required">No Payment Due</option>
            <option value="not_required">No Payment Due</option>
                <option value="paid">Paid</option>
              </select>
              {(search||statusFilter) && <button className="po-btn-ghost" style={{ padding:'7px 14px', fontSize:13 }} onClick={()=>{ setSearch(''); setStatusFilter(''); }}>Clear</button>}
              <button className="po-btn-ghost" style={{ padding:'7px 14px', fontSize:13, display:'flex', alignItems:'center', gap:6, marginLeft:'auto' }} onClick={() => handleExport({ type: 'outstanding', search, status: statusFilter, hub_id: selectedHubId })}>
                <Download size={14} /> Export CSV
              </button>
            </div>

            {loading ? (
              <div style={{ padding:60, textAlign:'center', color:'var(--text-muted)' }}>
                <Clock size={32} style={{ opacity:0.3, marginBottom:12 }}/><p style={{ margin:0, fontSize:14 }}>Loading payouts…</p>
              </div>
            ) : allInvoices.length===0 ? (
              <div style={{ textAlign:'center', padding:'60px 20px', background:'var(--bg-soft)', borderRadius:14, border:'1px solid var(--border)' }}>
                <CheckCircle2 size={40} style={{ color:'#16a34a', marginBottom:12 }}/>
                <div style={{ fontSize:16, fontWeight:700, color:'#166534', marginBottom:4 }}>All Caught Up!</div>
                <div style={{ fontSize:13, color:'var(--text-muted)' }}>No pending or overdue hub payouts right now.</div>
              </div>
            ) : (
              <div className="po-two-panel">
                <HubSidebar hubs={hubs} selectedHub={selectedHub} onSelect={setSelectedHub}/>
                {selectedHub && (
                  <InvoicePanel
                    hubName={selectedHub}
                    hubId={selectedHubId}
                    invoices={hubInvoices}
                    onPay={setPayPi}
                    onViewPayments={setViewPaymentsPi}
                    onBulkSuccess={handleBulkPaySuccess}
                    onExport={handleExport}
                    showToast={showToast}
                    onChanged={load}
                  />
                )}
              </div>
            )}
          </div>

          {/* ── MOBILE view ── */}
          <div className="po-mobile-only">
            <MobilePayoutsView
              allInvoices={allInvoices}
              hubs={hubs}
              data={data}
              onPay={setPayPi}
              onViewPayments={setViewPaymentsPi}
              loading={loading}
              onExport={handleExport}
            />
          </div>
        </>
      )}

      {/* Payment History tab */}
      {mainTab==='history' && <GlobalPaymentHistory onExport={handleExport} showToast={showToast} onChanged={load}/>}

      {payPi && <PayModal pi={payPi} onClose={()=>setPayPi(null)} onSuccess={handlePaySuccess}/>}
      {viewPaymentsPi && <PIPaymentsModal pi={viewPaymentsPi} onClose={()=>setViewPaymentsPi(null)} showToast={showToast} onChanged={load}/>}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={()=>setToast(null)}/>}
    </div>
  );
}
