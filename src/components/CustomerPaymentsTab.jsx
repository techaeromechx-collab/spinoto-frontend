import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Wallet, Plus, RefreshCw, AlertTriangle, Loader2, CheckCircle2, Search,
  CreditCard, Banknote, X, Lock, FileText, RotateCcw, Link2,
  MoreHorizontal, Send, Receipt,
} from 'lucide-react';
import { api, API_URL } from '../api/client.js';
import { useCan } from '../auth/AuthContext.jsx';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import { useFlipPopup } from '../hooks/useFlipPopup.js';
import { openAdvanceVoucher, openRefundVoucher } from '../lib/documentPdf.js';

const fmt = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const ci = id => `CI-${String(id).padStart(6, '0')}`;
const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '—');

/**
 * One line per invoice, not one per allocation.
 *
 * The same money can reach the same invoice more than once — ₹3,195 applied
 * when the bill was raised and ₹500 more a week later are two rows in
 * payment_allocations, both legitimate and both dated separately. Rendered
 * straight they became two lines reading CI-000063 under a column headed
 * "Invoice", and React saw two children keyed 63 and warned that it may drop
 * one of them.
 *
 * Grouped here and not in SQL: the ledger is right to keep the applications
 * apart, each with its own date and author. This cell is answering a narrower
 * question — where did this money end up — and for that the invoice is the
 * unit. The individual amounts survive in the tooltip.
 */
function byInvoice(allocations) {
  const out = new Map();
  for (const a of (allocations || [])) {
    const amt = Number(a.amount) || 0;
    const row = out.get(a.invoice_id);
    if (row) { row.amount += amt; row.parts.push(amt); }
    else out.set(a.invoice_id, { invoice_id: a.invoice_id, amount: amt, parts: [amt] });
  }
  return [...out.values()];
}

/**
 * What KIND of money this row is, for the badge and the type filters.
 *
 * ── Why this is not payment_type ────────────────────────────────────────────
 *
 * payment_type is 'advance' far more often than the word means to a person.
 * The database rule behind it (migration 133) is:
 *
 *     CHECK (payment_type <> 'invoice' OR customer_invoice_id IS NOT NULL)
 *
 * A row typed 'invoice' must name ONE invoice in its own column. A payment
 * split across two — ₹2,500 landing ₹1,994 on CI-51 and ₹506 on CI-53 — cannot
 * name one, so customer_invoice_id stays NULL and the only type left is
 * 'advance'. The row was stored correctly and then described wrongly: the badge
 * printed the raw column and said ADVANCE about money that had gone straight
 * onto invoices.
 *
 * ── And why payment_type is still not changed ───────────────────────────────
 *
 * It is load-bearing elsewhere. CustomerInvoicesPage keys `isAdvance` off it to
 * render these rows as LOCKED — correctly, because its edit and delete handlers
 * match on `id AND customer_invoice_id`, which is NULL here. Retyping the rows
 * would hand people a pencil that always 404s. So the storage stays and only
 * the description is fixed.
 *
 * ── The order matters ───────────────────────────────────────────────────────
 *
 * The estimate is checked FIRST. A job deposit that has since been applied to
 * its invoice is still a deposit — that is what it was taken as, and what the
 * receipt says. Checking allocations first would quietly relabel every advance
 * the moment its invoice was raised.
 */
function kindOf(p) {
  if (p.estimate_id) return 'advance';                       // taken against a job
  if ((p.allocations || []).length > 0) return 'invoice';    // it paid invoices
  return 'credit';                                           // on account, unapplied
}

const KIND_LABEL = { advance: 'ADVANCE', invoice: 'INVOICE', credit: 'CREDIT' };
const KIND_STYLE = {
  advance: { background: '#fef3c7', color: '#92400e' },
  invoice: { background: 'var(--bg-soft)', color: 'var(--text-muted)' },
  credit:  { background: '#ecfdf5', color: '#065f46' },
};

/**
 * What is LEFT of a receipt: the amount, less what it has paid, less what has
 * been given back.
 *
 * ── THE REFUND TERMS WERE MISSING, AND THE ROW LIED ─────────────────────────
 * This was `amount − allocated`, written out in six places on this screen. A
 * ₹50,000 advance refunded in full still showed ₹50,000 unused, still counted
 * toward the customer's credit in the header, and still rendered a Refund
 * button — so the money could be sent back a second time. Nothing on the row
 * said a refund had ever happened.
 *
 * PENDING counts as well as processed, matching advances.service.REMAINING_SQL
 * and the refund ceiling: money already promised to the customer is not money
 * that can also pay an invoice, and a gateway refund stays pending for days.
 */
function remainingOf(p) {
  return Number(p.amount || 0)
       - Number(p.allocated || 0)
       - Number(p.refunded || 0)
       - Number(p.refund_pending || 0);
}

/** Has any of this receipt been returned? Drives the badge and the filter. */
function refundStateOf(p) {
  const done = Number(p.refunded || 0);
  const pending = Number(p.refund_pending || 0);
  if (done <= 0.001 && pending <= 0.001) return null;
  const total = done + pending;
  return {
    done, pending, total,
    // "Refunded" only once money has actually gone back. A pending refund that
    // later fails must not have left the row claiming the customer was repaid.
    full: total >= Number(p.amount || 0) - 0.011,
    label: pending > 0.001 && done <= 0.001 ? 'REFUNDING' : 'REFUNDED',
  };
}

const TYPE_FILTERS = [
  ['',         'All'],
  ['advance',  'Advances'],
  ['invoice',  'Invoice payments'],
  ['gateway',  'Online'],
  ['manual',   'By hand'],
  ['credit',   'Unused credit'],
  // Its own chip: "where did that ₹50,000 go" is a question people ask, and
  // before this the answer was invisible on every filter.
  ['refunded', 'Refunded'],
];

/**
 * Every action available on one receipt, behind a single ⋯ button.
 *
 * ── WHY A MENU AND NOT MORE ICONS ───────────────────────────────────────────
 * There were three icons in a row and this screen needed a fourth. The table is
 * already eight columns wide inside the customer profile pane — the column that
 * caused the clipping the base `.lb-scroll-x` rule was added to fix. Another
 * icon walks straight back into it.
 *
 * ── WHAT IS NEW IN HERE ─────────────────────────────────────────────────────
 * Two things that existed in the backend and were reachable from nowhere:
 *
 *   Refund voucher — issued by issueRefundVoucher, rendered by
 *     openRefundVoucher, and until now linked ONLY from the success screen of
 *     the refund dialog. Close that dialog and a tax document became
 *     unretrievable. Worse for a gateway refund, where the number is issued by
 *     a webhook days later — so the one screen that linked it showed the button
 *     at the one moment the voucher did not yet exist.
 *
 *   Send receipt — the dispatcher has supported entityType 'advance' all along;
 *     only the messages controller's ENTITY_TYPES list stood in the way. The
 *     automatic send swallows its failures by design, so without this a
 *     customer who never received their receipt had no way to be sent it again.
 */
function RowActions({ p, isAdvance, unused, refund, canRefund, canSendWa, showToast, onRefund }) {
  const [open, setOpen] = useState(false);
  const [popRef, flip] = useFlipPopup(open);
  const [sending, setSending] = useState(false);

  const hasVoucher = Boolean(p.voucher_no);
  // BOTH must be present: the number is what the row shows, the id is what
  // openRefundVoucher actually needs. A number with no id would render a button
  // that cannot open anything.
  const hasRefundVoucher = Boolean(p.refund_voucher_no && p.refund_id);
  const canDoRefund = canRefund && isAdvance && unused > 0.001;
  // Sending needs a receipt to send and a customer to send it to.
  const canDoSend = canSendWa && isAdvance && hasVoucher;

  // No menu at all rather than an empty one. An invoice payment recorded by
  // hand has no voucher, no link and nothing to return — a ⋯ that opens onto
  // nothing is worse than no button.
  if (!hasVoucher && !hasRefundVoucher && !canDoRefund) return null;

  function close() { setOpen(false); }

  async function sendReceipt() {
    setSending(true);
    try {
      await api('/api/whatsapp/messages/send', {
        method: 'POST',
        body: { entity_type: 'advance', entity_id: p.id, template_key: 'advance_receipt' },
      });
      showToast?.(`Receipt ${p.voucher_no} sent again.`);
      close();
    } catch (e) {
      showToast?.(e.message || 'Could not send the receipt.', 'error');
    } finally { setSending(false); }
  }

  return (
    <div className="cpt-menu-wrap">
      <button type="button" className="icon-action" aria-haspopup="menu" aria-expanded={open}
              title="Actions" onClick={() => setOpen(v => !v)}>
        <MoreHorizontal size={14} />
      </button>

      {open && (
        <>
          {/* A fixed-inset backdrop, not a document listener: it closes on any
              outside click including one that lands on another row's button,
              and it cannot be defeated by a stopPropagation somewhere above. */}
          <div className="cpt-menu-backdrop" onClick={close} />
          <div ref={popRef} className={`cpt-menu${flip ? ' cpt-menu--flip' : ''}`} role="menu">
            {hasVoucher && (
              <button type="button" className="cpt-menu-item" role="menuitem"
                      onClick={() => { openAdvanceVoucher(p.id).catch(e => showToast?.(e.message, 'error')); close(); }}>
                <FileText size={13} /> Receipt {p.voucher_no}
              </button>
            )}
            {hasVoucher && p.public_token && (
              <button type="button" className="cpt-menu-item" role="menuitem"
                      onClick={() => {
                        navigator.clipboard?.writeText(`${window.location.origin}/advance/${p.public_token}`);
                        showToast?.('Receipt link copied.');
                        close();
                      }}>
                <Link2 size={13} /> Copy receipt link
              </button>
            )}
            {canDoSend && (
              <button type="button" className="cpt-menu-item" role="menuitem"
                      disabled={sending} onClick={sendReceipt}>
                <Send size={13} /> {sending ? 'Sending…' : 'Send receipt on WhatsApp'}
              </button>
            )}

            {/* The refund's own tax document. Shown only once a number exists —
                a pending gateway refund has none yet, and a button that opens a
                404 is worse than the status the row already shows. */}
            {hasRefundVoucher && (
              <>
                <div className="cpt-menu-sep" />
                <button type="button" className="cpt-menu-item" role="menuitem"
                        onClick={() => { openRefundVoucher(p.refund_id)
                          .catch(e => showToast?.(e.message, 'error')); close(); }}>
                  <Receipt size={13} /> Credit note {p.refund_voucher_no}
                </button>
              </>
            )}

            {canDoRefund && (
              <>
                <div className="cpt-menu-sep" />
                <button type="button" className="cpt-menu-item cpt-menu-item--danger" role="menuitem"
                        onClick={() => { onRefund(); close(); }}>
                  <RotateCcw size={13} /> Refund {fmt(unused)}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Everything one customer has ever paid, in one place.
 *
 * ── Why this could not exist before ─────────────────────────────────────────
 * A payment used to require an invoice, so "this customer's payments" was
 * really "the payments on this customer's invoices" — and an advance, which by
 * definition has no invoice yet, had nowhere to appear. It would have been
 * money the system held and no screen could show.
 *
 * ── Credit is not a balance we store ────────────────────────────────────────
 * It is what the customer has paid minus what has been applied to invoices.
 * An advance waiting for its invoice, the surplus from an advance larger than
 * the job it settled, and money left after a cancellation are all the same
 * thing arrived at three ways, and all show here as one figure.
 */
export default function CustomerPaymentsTab({
  mobile, invoices = [], estimates = [], onChanged, showToast,
  // Credit and the two actions now live in the profile header — the figure is
  // what a person opens this customer to find, and it was invisible from every
  // tab but this one. The PARENT owns the number and passes it down; a second
  // fetch here is how the chip and the card above it start disagreeing.
  credit = 0,
  // Set by the header buttons. The dialogs stay here because everything they
  // need — the invoice list, the reload — is here.
  action = null, onActionDone,
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  // One dialog now, so one flag. `showRecord` and `taking` were the two halves
  // of a choice the user had to make before they had any information — see
  // PaymentModal's header for why that order was wrong.
  const [paying, setPaying] = useState(false);

  const canRecord = useCan('ADD_INVOICE_PAYMENT');
  const canAllocate = useCan('ALLOCATE_PAYMENT');
  // Returning money is not the same authority as taking it, so it is not the
  // same permission — see payments.routes.js.
  const canRefund = useCan('REFUND_PAYMENT');
  // Re-sending a receipt is a WhatsApp send, not a payment action — it moves no
  // money and is gated on the code that governs messaging customers.
  const canSendWa = useCan('SEND_WHATSAPP');
  // Taking money at all. It came back here when the two buttons became one:
  // the dialog offers three destinations and this is the one that decides
  // whether any of them may be used.
  const canCollect = useCan('COLLECT_PAYMENT');
  const [refunding, setRefunding] = useState(null);
  // Whether money can be taken with no job at all. Off until somebody has set
  // the GST rate for it — asked here so the button is never offered on a path
  // that would only refuse. null while unknown, so nothing flickers into view.
  const [acct, setAcct] = useState(null);

  useEffect(() => {
    let alive = true;
    api('/api/payments/account-credit/rate')
      .then(r => { if (alive) setAcct(r); })
      .catch(() => { if (alive) setAcct({ enabled: false }); });
    return () => { alive = false; };
  }, []);

  const load = useCallback(async () => {
    if (!mobile) return;
    setLoading(true); setErr('');
    try {
      const list = await api(`/api/payments/for-customer/${encodeURIComponent(mobile)}`);
      setItems(list.items || []);
    } catch (e) {
      setErr(e.message || 'Could not load payment history.');
      setItems([]);
    } finally { setLoading(false); }
  }, [mobile]);

  useEffect(() => { load(); }, [load]);

  // The header sets `action`; this opens the matching dialog and clears it
  // immediately, so pressing the same button twice works rather than being
  // swallowed as an unchanged prop.
  useEffect(() => {
    if (!action) return;
    // 'take' and 'record' both land here now. The header still sends whichever
    // it was so an older bookmark or a half-deployed frontend cannot open
    // nothing at all.
    setPaying(true);
    onActionDone?.();
  }, [action, onActionDone]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter(p => {
      const unused = remainingOf(p);
      const refund = refundStateOf(p);
      // Matched on the derived kind, not the raw column — otherwise filtering
      // "Invoice payments" misses every payment that settled more than one
      // invoice, which is exactly the kind this feature creates.
      if (filter === 'advance' && kindOf(p) !== 'advance') return false;
      if (filter === 'invoice' && kindOf(p) !== 'invoice') return false;
      if (filter === 'gateway' && p.source !== 'gateway') return false;
      if (filter === 'manual'  && p.source !== 'manual')  return false;
      if (filter === 'credit'  && unused <= 0.001) return false;
      if (filter === 'refunded' && !refund) return false;
      if (!needle) return true;
      return [
        p.voucher_no, p.txn_ref, p.reference_no, p.method, p.vehicle_number,
        p.customer_invoice_id ? ci(p.customer_invoice_id) : '',
        String(p.amount),
      ].filter(Boolean).some(v => String(v).toLowerCase().includes(needle));
    });
  }, [items, filter, q]);

  const totalPaid = items.reduce((s, p) => s + Number(p.amount), 0);
  // Stated separately from "received", never subtracted from it. The customer
  // did pay that money; some of it has since gone back, and those are two facts
  // an accountant needs to see rather than one netted figure.
  const totalRefunded = items.reduce(
    (s, p) => s + Number(p.refunded || 0) + Number(p.refund_pending || 0), 0);

  return (
    <div>
      {/* ── Header: what this list is, and a way to reload it ──────────────
          The credit chip and the two buttons that used to sit here are in the
          profile header now — see CustomersPage. They are not duplicated: one
          Record Payment button on the screen means there is no question about
          which one is the real one, and credit stated once cannot be stated
          twice with two different numbers.

          cpt-toolbar is not decoration. .cust-tab-content bleeds 20px into the
          gutter so its table can reach the pane edge, and CustomersPage.css
          hands that inset back only to elements it knows by name. Without the
          class this row hangs off the left and the pane clips it. */}
      <div className="cpt-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {items.length} payment{items.length === 1 ? '' : 's'} · {fmt(totalPaid)} received
          {credit > 0.001 && ` · ${fmt(credit)} unused`}
          {totalRefunded > 0.001 && (
            <span style={{ color: '#b91c1c', fontWeight: 600 }}> · {fmt(totalRefunded)} refunded</span>
          )}
        </span>
        <button type="button" className="btn btn-ghost" onClick={load} disabled={loading}
                style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 5 }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="cpt-filters" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 3, background: 'var(--bg-soft)', padding: 3, borderRadius: 8 }}>
          {TYPE_FILTERS.map(([key, label]) => (
            <button key={key || 'all'} type="button" onClick={() => setFilter(key)}
                    style={{
                      padding: '5px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                      border: '1px solid ' + (filter === key ? 'var(--border)' : 'transparent'),
                      background: filter === key ? 'var(--bg)' : 'transparent',
                      color: filter === key ? 'var(--text)' : 'var(--text-muted)', cursor: 'pointer',
                    }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 160 }}>
          <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="form-input" placeholder="Receipt, reference, invoice, amount…"
                 value={q} onChange={e => setQ(e.target.value)}
                 style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 28, fontSize: 12.5 }} />
        </div>
      </div>

      {/* ── The list ───────────────────────────────────────────────────────── */}
      {err ? (
        <div className="cust-empty" style={{ color: '#b45309' }}><AlertTriangle size={16} /> {err}</div>
      ) : loading ? (
        <div className="cust-empty"><Loader2 size={18} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} /></div>
      ) : rows.length === 0 ? (
        <div className="cust-empty">{items.length ? 'No payments match those filters.' : 'No payments yet.'}</div>
      ) : (
        /* lb-scroll-x only ever had a rule INSIDE a .lb-list, where it is
           deliberately `overflow: visible` so sticky headers keep binding to
           .page-scroll. This tab is not in a .lb-list, so the class matched
           nothing here and eight columns simply overflowed with no way to reach
           the last of them. listLayout.css now carries a base rule; the
           .lb-list override still wins wherever it applies. */
        <div className="lb-scroll-x">
          <table className="cust-table cpt-table">
            <thead>
              <tr>
                <th>Reference</th><th>Date</th><th className="pay-num">Amount</th>
                <th>Type</th><th>Invoice</th><th>Method</th><th className="pay-num">Unused</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => {
                const unused = remainingOf(p);
                const refund = refundStateOf(p);
                // isAdvance is the STORED type and gates the refund button —
                // only money that never became invoice payment can be handed
                // back from here. `kind` is what the row is called on screen.
                // They are deliberately two different questions.
                const isAdvance = p.payment_type === 'advance';
                const kind = kindOf(p);
                const allocLines = byInvoice(p.allocations);
                return (
                  <tr key={p.id}>
                    <td style={{ fontSize: 12 }}>
                      <div style={{ fontWeight: 600 }}>{p.voucher_no || p.txn_ref || p.reference_no || '—'}</div>
                      {p.vehicle_number && (
                        <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{p.vehicle_number}</div>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>{fmtDate(p.paid_at)}</td>
                    <td className="pay-num" style={{ fontWeight: 700 }}>
                      {/* The amount received is NEVER reduced — the customer
                          did pay ₹50,000 and their bank statement says so. The
                          refund is stated underneath as its own line, the same
                          way the Payments list shows one. */}
                      {fmt(p.amount)}
                      {refund && (
                        <div className="cpt-refunded" title={refund.pending > 0.001
                          ? `${fmt(refund.pending)} is still on its way back to the customer`
                          : (p.refund_voucher_no ? `Credit note ${p.refund_voucher_no}` : 'Returned to the customer')}>
                          −{fmt(refund.total)} {refund.pending > 0.001 && refund.done <= 0.001 ? 'refunding' : 'refunded'}
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        title={
                          kind === 'advance' ? 'Taken against a job, before it was invoiced'
                          : kind === 'invoice' ? 'Applied to the invoices listed'
                          : 'On account — not applied to anything yet'
                        }
                        style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 99,
                          fontSize: 10.5, fontWeight: 700, ...KIND_STYLE[kind],
                        }}>
                        {KIND_LABEL[kind]}
                      </span>
                      {/* Beside the type, not instead of it: this is still an
                          advance, it is just one that has been given back. A
                          badge that replaced the type would lose which kind of
                          money the row was. */}
                      {refund && (
                        <span className={`cpt-badge cpt-badge--${refund.pending > 0.001 && refund.done <= 0.001 ? 'refunding' : 'refunded'}`}>
                          {refund.full ? refund.label : `PART ${refund.label}`}
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {/* An advance can be split across two jobs, so this shows
                          every invoice the money actually reached — not one
                          column that would have to pick a winner. */}
                      {allocLines.length
                        ? allocLines.map(a => (
                            <div
                              key={a.invoice_id}
                              style={{ whiteSpace: 'nowrap' }}
                              title={a.parts.length > 1
                                ? `Applied in ${a.parts.length} parts: ${a.parts.map(fmt).join(' + ')}`
                                : undefined}
                            >
                              {ci(a.invoice_id)}
                              {allocLines.length > 1 && (
                                <span style={{ color: 'var(--text-muted)', fontSize: 10.5 }}> · {fmt(a.amount)}</span>
                              )}
                            </div>
                          ))
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    {/* The flex box goes inside the cell, never on it. A <td>
                        with display:flex stops being a table cell: it leaves the
                        row's layout and loses vertical-align:middle, which is
                        why the method used to sit a few pixels above the amount
                        beside it. */}
                    <td style={{ fontSize: 12 }}>
                      <span className="cpt-method">
                        {p.source === 'gateway' ? <CreditCard size={11} /> : <Banknote size={11} />}
                        {p.method}
                      </span>
                    </td>
                    <td className="pay-num" style={{ fontSize: 12 }}>
                      {unused > 0.001
                        ? <strong style={{ color: '#92400e' }}>{fmt(unused)}</strong>
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>

                    {/* ── Everything you can do with a receipt, behind one ⋯ ──
                        This was three icons in a row, and the row could not take
                        a fourth: adding Send receipt beside them pushed the
                        eight-column table past its container again — the exact
                        problem the base .lb-scroll-x rule was added to solve,
                        walked back into.

                        So the actions collapse into one button. That also makes
                        room for the refund voucher, which until now existed only
                        on the success screen of the refund dialog: close it and
                        the customer's tax document was unreachable from every
                        screen in the application. */}
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <RowActions
                        p={p}
                        isAdvance={isAdvance}
                        unused={unused}
                        refund={refund}
                        canRefund={canRefund}
                        canSendWa={canSendWa}
                        showToast={showToast}
                        onRefund={() => setRefunding({ ...p, unused })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {paying && (
        <PaymentModal
          mobile={mobile}
          invoices={invoices}
          estimates={estimates}
          gstRate={acct?.gst_rate}
          canRecord={canRecord}
          canAllocate={canAllocate}
          canCollect={canCollect}
          showToast={showToast}
          onClose={() => setPaying(false)}
          onDone={() => { setPaying(false); load(); onChanged?.(); }}
        />
      )}

      {refunding && (
        <RefundModal
          payment={refunding}
          showToast={showToast}
          onClose={() => setRefunding(null)}
          onDone={() => { setRefunding(null); load(); onChanged?.(); }}
        />
      )}

    </div>
  );
}

/**
 * Return money the customer has paid but not yet spent.
 *
 * ── What can be returned, and why the ceiling is what it is ─────────────────
 * Only the UNUSED part of an advance. Money that has already been applied to
 * an invoice is not credit any more — it has paid for something — and taking
 * it back here would leave that invoice reading as settled with money that has
 * gone. The server enforces this; the dialog states it so nobody has to
 * discover it from an error.
 *
 * ── Cash and online refunds are not the same event ──────────────────────────
 * Cash is handed back across the counter, so it is done the moment it is
 * recorded and the refund voucher is numbered immediately.
 *
 * Online money goes back along the rails it arrived on, over several days, and
 * it can still fail. So there is no voucher number yet, and this dialog says
 * so — a customer told "here is your refund voucher" for money still in
 * transit will believe it has arrived.
 *
 * ── The reason is required ──────────────────────────────────────────────────
 * Not politeness. A refund with no stated reason is the one an audit asks
 * about years later, and "the person who did it has left" is not an answer.
 */
function RefundModal({ payment, onClose, onDone, showToast }) {
  const max = Number(payment.unused || 0);
  const [amount, setAmount] = useState(max ? max.toFixed(2) : '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  useEscapeClose(onClose, !busy);

  const asked = Number(amount);
  const invalid = !Number.isFinite(asked) || asked <= 0;
  const over = !invalid && asked > max + 0.001;
  const shortReason = reason.trim().length < 3;
  const isOnline = payment.source === 'gateway';

  async function submit() {
    setBusy(true); setErr('');
    try {
      // `body` is an OBJECT, not a string. api() stringifies it itself
      // (api/client.js: `if (body !== undefined) opts.body = JSON.stringify(body)`),
      // so passing JSON.stringify here double-encoded it — the server received a
      // JSON *string* where it expected an object, and the Zod schema rejected
      // every single request. This refund could never be submitted at all.
      const out = await api(`/api/payments/advance/${payment.id}/refund`, {
        method: 'POST',
        body: { amount: asked, reason: reason.trim() },
      });
      setDone(out);
      showToast?.(out.message);
    } catch (e) {
      setErr(e.message || 'Could not process the refund.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cpt-modal-backdrop" onMouseDown={e => e.target === e.currentTarget && !busy && onClose()}>
      <div className="cpt-modal" style={{ maxWidth: 430 }} onMouseDown={e => e.stopPropagation()}>
        <div className="cpt-modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RotateCcw size={16} style={{ color: '#b91c1c' }} />
            <strong>Refund advance</strong>
          </div>
          <button className="icon-action" onClick={onClose} disabled={busy}><X size={15} /></button>
        </div>

        <div className="cpt-modal-body">
          {done ? (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 14px', fontSize: 13, marginBottom: 14 }}>
                <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div style={{ fontWeight: 700 }}>{fmt(done.refund.amount)} refunded</div>
                  {/* The voucher exists only once the money has actually gone
                      back. Saying which case this is prevents an advisor
                      hunting for a number that has not been issued. */}
                  <div style={{ marginTop: 3, fontSize: 12 }}>
                    {done.pending
                      ? 'The bank is sending it back — this usually takes 5–7 working days. The refund voucher is issued once they confirm it.'
                      : <>Voucher <strong>{done.refund.voucher_no}</strong> · reverses {fmt(done.refund.gst_amount)} GST</>}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                {!done.pending && done.refund.id && (
                  <button type="button" className="btn btn-ghost"
                          onClick={() => openRefundVoucher(done.refund.id)
                            .catch(e => showToast?.(e.message, 'error'))}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <FileText size={14} /> Open voucher
                  </button>
                )}
                <button type="button" className="btn btn-primary" onClick={onDone}
                        style={{ padding: '8px 18px', fontSize: 13 }}>Done</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ background: 'var(--bg-soft)', borderRadius: 8, padding: '11px 13px', marginBottom: 14, fontSize: 12.5, lineHeight: 1.7 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Receipt</span>
                  <strong>{payment.voucher_no || payment.txn_ref || '—'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Taken</span>
                  <strong>{fmt(payment.amount)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Can be returned</span>
                  <strong style={{ color: '#92400e' }}>{fmt(max)}</strong>
                </div>
                {Number(payment.allocated) > 0.001 && (
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                    {fmt(payment.allocated)} of this has already paid an invoice, so it is no longer credit.
                  </div>
                )}
              </div>

              <label className="lb-pop-label">Amount to refund</label>
              <input className="form-input" type="number" step="0.01" min="0" max={max}
                     value={amount} onChange={e => setAmount(e.target.value)} autoFocus
                     style={{ width: '100%', boxSizing: 'border-box', fontSize: 15, fontWeight: 700 }} />
              {over && (
                <div style={{ fontSize: 11.5, color: '#b91c1c', marginTop: 4 }}>
                  Only {fmt(max)} of this receipt is unused.
                </div>
              )}

              <label className="lb-pop-label" style={{ marginTop: 12 }}>Why is it being refunded?</label>
              <input className="form-input" value={reason} onChange={e => setReason(e.target.value)}
                     placeholder="Job cancelled, customer changed their mind…"
                     style={{ width: '100%', boxSizing: 'border-box', fontSize: 13 }} />
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                This is recorded permanently against the refund.
              </div>

              <div style={{ background: isOnline ? '#eff6ff' : '#fffbeb', border: `1px solid ${isOnline ? '#bfdbfe' : '#fde68a'}`, borderRadius: 8, padding: '10px 12px', fontSize: 12, color: isOnline ? '#1e40af' : '#92400e', marginTop: 14, lineHeight: 1.6 }}>
                {isOnline
                  ? 'This was paid online, so the money goes back the same way — usually 5–7 working days. The refund voucher is issued when the bank confirms it.'
                  : 'This was taken in cash, so hand the money back now. The refund voucher is issued immediately.'}
              </div>

              {err && (
                <div style={{ marginTop: 12, fontSize: 12.5, color: '#b91c1c', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {err}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="button" className="btn btn-danger" onClick={submit}
                        disabled={busy || invalid || over || shortReason}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', fontSize: 13 }}>
                  {busy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RotateCcw size={14} />}
                  Refund {invalid ? '' : fmt(asked)}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const TAKE_METHODS = [
  ['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card'],
  ['bank_transfer', 'Bank transfer'], ['other', 'Other'],
];

/**
 * One payment dialog.
 *
 * ── WHAT IT REPLACED, AND WHY ───────────────────────────────────────────────
 *
 * There were two buttons: Take Payment and Record Payment. Between them they
 * made the user answer a question before they had any information — "is this
 * money for an invoice, or not?" — and Record Payment then asked a second one,
 * "which invoice?", before it would let them type an amount.
 *
 * At a counter neither question has an obvious answer. Somebody hands over
 * ₹5,000. Which of their three invoices is that? The advisor does not know;
 * the customer usually does not either. It is just money against what they owe.
 *
 * So the order is reversed. The amount comes first, and the system answers the
 * invoice question — oldest first, filling each completely — and SHOWS the
 * answer before anything is saved. Take Payment did not need a button of its
 * own: it is what this dialog does when there is nothing to allocate to.
 *
 * ── THE PLAN COMES FROM THE SERVER ──────────────────────────────────────────
 *
 * GET /api/payments/plan, debounced as you type, rather than the same rule
 * written a second time in JavaScript. Two implementations of "oldest first,
 * fill completely, mind the paise" is two chances to disagree, and the one on
 * screen disagreeing with the one that saves is the worst possible version of
 * that bug — the user approves one thing and a different thing happens.
 *
 * The preview is ADVISORY. On save the client sends the amount, not the split,
 * and the server re-plans inside its transaction. See receivePayment.
 *
 * ── THE CONFIRM STEP ────────────────────────────────────────────────────────
 *
 * Kept, but only where it earns its place. Money going onto invoices is
 * checked by the invoices themselves — you cannot overpay one. Money becoming
 * credit or a job deposit has no ceiling at all, so a stray zero is accepted,
 * recorded, and becomes a refund. That path still has to be agreed to.
 */
function PaymentModal({
  mobile, invoices = [], estimates = [], gstRate,
  canRecord, canAllocate, canCollect,
  onClose, onDone, showToast,
}) {
  const [amount, setAmount]   = useState('');
  const [dest, setDest]       = useState(null);      // 'invoices' | 'job' | 'credit'
  const [estimateId, setEstimateId] = useState('');
  const [useCredit, setUseCredit]   = useState(false);
  const [method, setMethod]   = useState('cash');
  const [reference, setReference] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [notes, setNotes]     = useState('');
  const [editing, setEditing] = useState(false);
  const [overrides, setOverrides] = useState({});
  // Invoices the user has unticked. An unticked invoice takes nothing AND
  // passes nothing to the one below it — see the note by `lines`.
  const [excluded, setExcluded] = useState(() => new Set());
  const [plan, setPlan]       = useState(null);
  const [planErr, setPlanErr] = useState('');
  const [phase, setPhase]     = useState('form');    // form → confirm → done
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');
  const [result, setResult]   = useState(null);

  useEscapeClose(onClose, !busy);

  const asked   = Number(amount);
  const invalid = !Number.isFinite(asked) || asked <= 0;
  const rate    = Number(gstRate) || 0;
  // Inclusive, like every other amount in this feature: what the customer hands
  // over is what they are asked for, and the tax is the part inside it.
  const gst = invalid || rate <= 0 ? 0 : (asked * rate) / (100 + rate);

  // Jobs that have been quoted but not yet billed. An estimate with an invoice
  // behind it is not somewhere a deposit can go — the invoice is.
  const openJobs = (estimates || []).filter(e => !e.customer_invoice_id);

  // ── The plan ───────────────────────────────────────────────────────────────
  //
  // Fetched on open with amount 0 (so the credit figures and the outstanding
  // list are on screen before anything is typed), then again as the amount
  // changes. Debounced: a request per keystroke would be four for "5000", and
  // the answers can arrive out of order.
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({
          mobile,
          amount: String(invalid ? 0 : asked),
          use_credit: String(!!useCredit),
        });
        const r = await api(`/api/payments/plan?${qs}`);
        if (alive) { setPlan(r); setPlanErr(''); }
      } catch (e) {
        if (alive) setPlanErr(e.message || 'Could not work out where this money goes.');
      }
    }, plan ? 220 : 0);        // no delay on the very first load
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobile, amount, useCredit]);

  // ── Which destination, and what may be chosen ──────────────────────────────
  //
  // The default is decided by the customer's situation rather than by a
  // remembered preference: with nothing outstanding there is no invoice branch
  // to default to, and opening on one that is disabled would be a dead end.
  const outstanding = plan ? plan.lines.length + plan.skipped_other_hub.length : 0;
  useEffect(() => {
    if (!plan || dest) return;
    setDest(outstanding > 0 && (canAllocate || canRecord) ? 'invoices' : 'credit');
  }, [plan, dest, outstanding, canAllocate, canRecord]);

  // Per decision 4: a user who may collect but not allocate keeps the dialog
  // and loses one branch of it, shown disabled with the reason. Hiding it would
  // leave them comparing screens with a colleague and finding no explanation.
  // ADD_INVOICE_PAYMENT *or* ALLOCATE_PAYMENT, matching the server. Recording
  // new money on an invoice is what the first one has always meant; requiring
  // the second would take it from everyone who has it today. Spending existing
  // credit is stricter — see the checkbox, which asks for canAllocate alone.
  const canUseInvoices = outstanding > 0 && (canAllocate || canRecord);
  const canUseJob      = openJobs.length > 0;

  // ── The lines, with any hand-set amounts applied ───────────────────────────
  //
  // Recomputed locally ONLY while overriding — the server has already produced
  // the automatic plan, and re-fetching on every digit typed into a row would
  // fight the caret. Everything here is bounded the same way the server bounds
  // it, and the server checks it again on save regardless.
  // The rows, recomputed here rather than re-fetched.
  //
  // Two reasons, and the second is the one that matters. Typing must not fight
  // the caret with a round trip — but more than that, a TICK has to answer
  // instantly. Waiting for the server left the box springing back to ticked for
  // a quarter of a second while the request was in flight, which reads as a
  // control that does not work.
  //
  // The rule is the server's, mirrored, including the part that matters most:
  // `left` drops by what a row WOULD have taken even when it is excluded, so
  // unticking one invoice never hands its share to the invoice below it. The
  // server re-runs the same rule on save and is the authority; this is only
  // what the screen shows in the meantime.
  const lines = (() => {
    if (!plan) return [];
    if (!editing && excluded.size === 0) return plan.lines;
    let left = plan.pot;
    return plan.lines.map(l => {
      const pinned = overrides[l.customer_invoice_id] !== undefined;
      const want = pinned ? Number(overrides[l.customer_invoice_id]) || 0 : l.due;
      const natural = Math.round(Math.max(0, Math.min(want, l.due, left)) * 100) / 100;
      left = Math.round((left - natural) * 100) / 100;
      const off = excluded.has(l.customer_invoice_id);
      const take = off ? 0 : natural;
      const after = Math.round((l.due - take) * 100) / 100;
      return { ...l, take, after, settles: after <= 0.011 && take > 0, pinned, excluded: off };
    });
  })();

  function toggleInvoice(id) {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const allocated = lines.reduce((s, l) => s + l.take, 0);
  const leftover  = plan ? Math.max(0, Math.round((plan.pot - allocated) * 100) / 100) : 0;
  const settles   = lines.filter(l => l.settles).length;
  // More than one hub in play is worth saying out loud — see the note by the
  // hub column below.
  const multiHub = new Set(lines.map(l => l.hub_name || '—')).size > 1;

  function editLine(id, value, el) {
    const clean = String(value).replace(/[^\d.]/g, '');
    setOverrides(o => ({ ...o, [id]: clean }));
    // The rows are redrawn on every keystroke, which destroys the field being
    // typed into. Put the caret back, or the box loses focus after one digit.
    const pos = el?.selectionStart;
    requestAnimationFrame(() => {
      const again = document.querySelector(`input[data-inv="${id}"]`);
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch { /* not supported */ } }
    });
  }

  // ── Saving ─────────────────────────────────────────────────────────────────
  async function submit() {
    setBusy(true); setErr('');
    try {
      let out;
      if (dest === 'job') {
        // The existing advance path, unchanged: money against a quoted job,
        // which applies itself the moment that job is invoiced.
        out = await api('/api/payments/advance', {
          method: 'POST',
          body: {
            estimate_id: Number(estimateId),
            amount: asked,
            method,
            reference_no: reference.trim() || null,
            notes: notes.trim() || null,
          },
        });
        setResult({ kind: 'job', amount: asked, voucher_no: out.voucher_no, payment_id: out.payment_id });
      } else {
        // `null` means "you decide". An empty ARRAY is the different, deliberate
        // instruction: allocate to nothing, keep it all as credit.
        const allocations = dest === 'credit'
          ? []
          : editing
            ? lines.filter(l => l.take > 0.001)
                   .map(l => ({ customer_invoice_id: l.customer_invoice_id, amount: l.take }))
            : null;

        out = await api('/api/payments/receive', {
          method: 'POST',
          body: {
            mobile,
            amount: asked,
            method,
            reference_no:   reference.trim() || null,
            vehicle_number: vehicle.trim() || null,
            notes:          notes.trim() || null,
            use_credit:     dest === 'invoices' && useCredit,
            allocations,
            // Sent WITH allocations:null on the automatic path — the server
            // still decides the split, it is just told which invoices are out.
            exclude_invoice_ids: dest === 'invoices' && excluded.size ? [...excluded] : null,
          },
        });
        setResult({
          kind: dest,
          amount: asked,
          voucher_no:  out.payment.voucher_no,
          payment_id:  out.payment.id,
          gst_amount:  out.payment.gst_amount,
          settled:     out.settled?.length || 0,
          leftover:    out.leftover,
          credit_used: out.credit_used,
        });
      }
      setPhase('done');
      const vno = out.voucher_no || out.payment?.voucher_no;
      showToast?.(vno ? `${fmt(asked)} received — receipt ${vno}.` : `${fmt(asked)} received.`);
    } catch (e) {
      setErr(e.message || 'Could not record the payment.');
      setPhase('form');
    } finally {
      setBusy(false);
    }
  }

  // Invoices police their own ceiling, so that branch needs no confirmation.
  // Credit and a job deposit have none, so they do.
  const needsConfirm = dest === 'credit' || dest === 'job';
  const blocked =
    invalid ||
    !dest ||
    (dest === 'job' && !estimateId) ||
    (dest === 'invoices' && allocated <= 0.001 && leftover <= 0.001);

  return (
    <div className="cpt-modal-backdrop" onMouseDown={e => e.target === e.currentTarget && !busy && onClose()}>
      <div className="cpt-modal cpt-pay" onMouseDown={e => e.stopPropagation()}>
        <div className="cpt-modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Wallet size={16} style={{ color: 'var(--primary)' }} />
            <strong>Payment</strong>
          </div>
          <button className="icon-action" onClick={onClose} disabled={busy}><X size={15} /></button>
        </div>

        <div className="cpt-modal-body">
          {/* ── Done ────────────────────────────────────────────────────── */}
          {phase === 'done' ? (
            <>
              <div className="cpt-pay-done">
                <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div style={{ fontWeight: 700 }}>{fmt(result.amount)} received</div>
                  {result.voucher_no && (
                    <div style={{ marginTop: 3, fontSize: 12 }}>
                      Receipt <strong>{result.voucher_no}</strong>
                      {result.gst_amount ? ` · includes ${fmt(result.gst_amount)} GST` : ''}
                    </div>
                  )}
                  <div style={{ marginTop: 5, fontSize: 12 }}>
                    {result.kind === 'job'
                      ? 'Held against that job. It will apply itself when the job is invoiced.'
                      : result.kind === 'credit'
                        ? "Kept as this customer's credit. Any invoice you raise will offer it."
                        : [
                            result.settled ? `${result.settled} invoice${result.settled > 1 ? 's' : ''} settled` : null,
                            result.credit_used ? `${fmt(result.credit_used)} of credit used` : null,
                            result.leftover > 0.001 ? `${fmt(result.leftover)} kept as credit` : null,
                          ].filter(Boolean).join(' · ') || 'Applied to the outstanding invoices.'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                {/* Only when there IS one. A payment that landed entirely on
                    invoices has no ADV- receipt — those invoices are its
                    documents — and a button that always 404s is worse than no
                    button. */}
                {result.voucher_no && (
                  <button type="button" className="btn btn-ghost"
                          onClick={() => openAdvanceVoucher(result.payment_id)
                            .catch(e => showToast?.(e.message, 'error'))}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <FileText size={14} /> Open receipt
                  </button>
                )}
                <button type="button" className="btn btn-primary" onClick={onDone}
                        style={{ padding: '8px 18px', fontSize: 13 }}>Done</button>
              </div>
            </>

          /* ── Confirm — only where nothing else can question the amount ── */
          ) : phase === 'confirm' ? (
            <>
              <div className="cpt-pay-confirm">
                <div className="cpt-pay-confirm-cap">
                  {dest === 'job' ? 'Hold against this job' : 'Keep as credit'}
                </div>
                <div className="cpt-pay-confirm-amt">{fmt(asked)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  by {TAKE_METHODS.find(([k]) => k === method)?.[1]}
                  {rate > 0 ? ` · includes ${fmt(gst)} GST at ${rate}%` : ''}
                </div>
              </div>

              <div className="cpt-pay-warn">
                There is no invoice to check this against, so nothing else will
                question the amount. Please make sure it is right.
              </div>

              {err && <div className="cpt-pay-err"><AlertTriangle size={14} /> {err}</div>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setPhase('form')} disabled={busy}>
                  Back
                </button>
                <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', fontSize: 13 }}>
                  {busy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={14} />}
                  Confirm {fmt(asked)}
                </button>
              </div>
            </>

          /* ── The form ─────────────────────────────────────────────────── */
          ) : (
            <>
              {/* Credit the customer is holding. Free and held are two numbers
                  because they are two different kinds of money: one can go
                  anywhere, the other was paid for a named job. They used to be
                  added together, which is how a Fortuner deposit came to be
                  spendable on an Innova invoice. */}
              {plan?.credit_available > 0.001 && (
                <div className="cpt-bank cpt-bank--free">
                  <span><strong>{fmt(plan.credit_available)}</strong> unused credit</span>
                  <label className="cpt-bank-use">
                    <input type="checkbox" checked={useCredit}
                           disabled={dest !== 'invoices' || !canUseInvoices || !canAllocate}
                           title={!canAllocate ? 'Spending credit needs the Allocate Payment permission' : ''}
                           onChange={e => setUseCredit(e.target.checked)} />
                    use it too
                  </label>
                </div>
              )}
              {plan?.credit_held > 0.001 && (
                <div className="cpt-bank cpt-bank--held">
                  <span>
                    <strong>{fmt(plan.credit_held)}</strong> held as a deposit
                    {plan.credit_held_items?.[0]?.label ? ` for ${plan.credit_held_items[0].label}` : ''}
                    {plan.credit_held_items?.length > 1 ? ` and ${plan.credit_held_items.length - 1} more` : ''}
                  </span>
                  <span className="cpt-bank-lock"><Lock size={11} /> not spent automatically</span>
                </div>
              )}

              <label className="lb-pop-label">Amount received</label>
              <div className="cpt-pay-amt">
                <span>₹</span>
                <input type="number" step="0.01" min="0" autoFocus
                       value={amount} onChange={e => setAmount(e.target.value)}
                       placeholder="0.00" />
              </div>
              {rate > 0 && (dest === 'credit' || dest === 'job') && (
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                  GST at {rate}% is already included{!invalid ? ` — ${fmt(gst)} of this amount` : ''}. The customer pays exactly this.
                </div>
              )}

              {/* ── Where it goes ─────────────────────────────────────────
                  Three destinations, and only ONE of them is automatic.
                  Invoices are debts, so money may find them by itself. An
                  estimate is not a debt yet and credit is a decision, so both
                  have to be chosen. */}
              <label className="lb-pop-label" style={{ marginTop: 14 }}>Goes to</label>
              <div className="cpt-dest">
                <button type="button"
                        className={dest === 'invoices' ? 'on' : ''}
                        disabled={!canUseInvoices}
                        title={!(canAllocate || canRecord) ? 'Needs the Record Invoice Payment or Allocate Payment permission'
                              : outstanding === 0 ? 'This customer has no outstanding invoices' : ''}
                        onClick={() => { setDest('invoices'); setEditing(false); }}>
                  Outstanding invoices
                </button>
                <button type="button"
                        className={dest === 'job' ? 'on' : ''}
                        disabled={!canUseJob}
                        title={!canUseJob ? 'This customer has no un-billed jobs' : ''}
                        onClick={() => { setDest('job'); setUseCredit(false); setExcluded(new Set()); }}>
                  A job (advance)
                </button>
                <button type="button"
                        className={dest === 'credit' ? 'on' : ''}
                        onClick={() => { setDest('credit'); setUseCredit(false); setExcluded(new Set()); }}>
                  Keep as credit
                </button>
              </div>

              {/* Why the invoice branch is closed, said once, plainly. */}
              {!canUseInvoices && (
                <p className="cpt-dest-note">
                  {!(canAllocate || canRecord)
                    ? 'Putting money against an invoice needs the Record Invoice Payment or Allocate Payment permission. You can still take a deposit or hold it as credit.'
                    : 'This customer has no outstanding invoices, so this will be kept as credit.'}
                </p>
              )}

              {dest === 'job' && (
                <select className="form-input" value={estimateId}
                        onChange={e => setEstimateId(e.target.value)}
                        style={{ width: '100%', marginTop: 10, fontSize: 13 }}>
                  <option value="">Choose the job…</option>
                  {openJobs.map(e => (
                    <option key={e.id} value={e.id}>
                      EST-{String(e.id).padStart(6, '0')}
                      {e.vehicle_number ? ` · ${e.vehicle_number}` : ''} · {fmt(e.grand_total)}
                    </option>
                  ))}
                </select>
              )}

              {/* ── The plan ─────────────────────────────────────────────── */}
              {dest === 'invoices' && (
                <>
                  <div className="cpt-plan-hd">
                    <span>{editing ? 'type to fix an amount' : ''}</span>
                    <button type="button" onClick={() => { setEditing(v => !v); setOverrides({}); }}>
                      {editing ? 'use the automatic split' : 'change'}
                    </button>
                  </div>
                  <div className="cpt-plan">
                    {useCredit && plan?.credit_available > 0.001 && (
                      <div className="cpt-plan-row cpt-plan-row--dim">
                        <span className="inv">Credit</span>
                        <span className="due">{fmt(plan.credit_available)} + {fmt(invalid ? 0 : asked)} new</span>
                        <span className="arrow">=</span>
                        <span className="got">{fmt(plan.pot)}</span>
                        <span className="pill pill--none">TO ALLOCATE</span>
                      </div>
                    )}
                    {lines.map(l => (
                      <div key={l.customer_invoice_id}
                           className={`cpt-plan-row${l.take > 0.001 ? '' : ' cpt-plan-row--dim'}`}>
                        {/* Untick to leave this invoice out. Its money does not
                            move to the next one — it becomes credit. */}
                        <input
                          type="checkbox"
                          className="cpt-plan-tick"
                          checked={!l.excluded}
                          title={l.excluded ? 'Include this invoice' : 'Leave this invoice out'}
                          onChange={() => toggleInvoice(l.customer_invoice_id)}
                        />
                        <span className="inv">CI #{l.customer_invoice_id}</span>
                        <span className="dt">{fmtPlanDate(l.invoice_date)}</span>
                        {/* Shown only when the invoices span more than one hub.
                            On a single-hub customer it is noise; on a
                            multi-hub one it is the difference between two
                            businesses' books, and migration 083 hangs a payout
                            date off whichever invoice this money settles. */}
                        {multiHub && <span className="hub">{l.hub_name || '—'}</span>}
                        <span className="due">{fmt(l.due)} due</span>
                        <span className="arrow">→</span>
                        {editing && !l.excluded
                          ? <input className={`edit${l.pinned ? ' pinned' : ''}`} type="text"
                                   inputMode="decimal" data-inv={l.customer_invoice_id}
                                   value={l.take}
                                   onChange={e => editLine(l.customer_invoice_id, e.target.value, e.target)} />
                          : <span className={`got${l.take > 0.001 ? '' : ' zero'}`}>{fmt(l.take)}</span>}
                        <span className={`pill ${l.settles ? 'pill--paid' : l.take > 0.001 ? 'pill--part' : 'pill--none'}`}>
                          {l.excluded ? 'not included'
                            : l.settles ? 'PAID ✓'
                            : l.take > 0.001 ? `${fmt(l.after)} due`
                            : 'untouched'}
                        </span>
                      </div>
                    ))}
                    {!lines.length && (
                      <div className="cpt-plan-empty">Nothing outstanding — this will be kept as credit.</div>
                    )}
                    {leftover > 0.001 && (
                      <div className="cpt-plan-foot">
                        ↳ kept as credit <span className="n">{fmt(leftover)}</span>
                      </div>
                    )}
                  </div>

                  {/* Invoices at other hubs that the automatic split passed
                      over. Named rather than hidden: the money can still be put
                      there deliberately, and a customer wondering why their
                      oldest bill was skipped deserves the reason on screen. */}
                  {plan?.skipped_other_hub?.length > 0 && (
                    <p className="cpt-dest-note">
                      {plan.skipped_other_hub.length} invoice
                      {plan.skipped_other_hub.length > 1 ? 's' : ''} at another hub
                      {plan.skipped_other_hub.length > 1 ? ' were' : ' was'} left out of the
                      automatic split.
                    </p>
                  )}
                </>
              )}

              {planErr && <div className="cpt-pay-err"><AlertTriangle size={14} /> {planErr}</div>}

              {/* ── The rest of the form ─────────────────────────────────── */}
              <label className="lb-pop-label" style={{ marginTop: 14 }}>Method</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {TAKE_METHODS.map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setMethod(k)}
                          className={`cpt-method${method === k ? ' on' : ''}`}>
                    {label}
                  </button>
                ))}
              </div>

              <label className="lb-pop-label" style={{ marginTop: 12 }}>
                Reference <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span>
              </label>
              <input className="form-input" value={reference} onChange={e => setReference(e.target.value)}
                     placeholder="UPI ref, cheque no…"
                     style={{ width: '100%', boxSizing: 'border-box', fontSize: 13 }} />

              {dest !== 'job' && (
                <>
                  <label className="lb-pop-label" style={{ marginTop: 12 }}>
                    Vehicle <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span>
                  </label>
                  <input className="form-input" value={vehicle}
                         onChange={e => setVehicle(e.target.value.toUpperCase())}
                         placeholder="GJ01AB1234"
                         style={{ width: '100%', boxSizing: 'border-box', fontSize: 13 }} />
                </>
              )}

              <label className="lb-pop-label" style={{ marginTop: 12 }}>
                Note <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span>
              </label>
              <input className="form-input" value={notes} onChange={e => setNotes(e.target.value)}
                     placeholder="What is this for?"
                     style={{ width: '100%', boxSizing: 'border-box', fontSize: 13 }} />

              {err && <div className="cpt-pay-err"><AlertTriangle size={14} /> {err}</div>}

              <div className="cpt-pay-actions">
                <span className="cpt-pay-sum">
                  {invalid ? '' :
                   dest === 'job'    ? `advance of ${fmt(asked)}` :
                   dest === 'credit' ? `${fmt(asked)} to credit` :
                   [settles ? `${settles} invoice${settles > 1 ? 's' : ''} settled` : null,
                    leftover > 0.001 ? `${fmt(leftover)} to credit` : null,
                   ].filter(Boolean).join(' · ')}
                </span>
                <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                <button type="button" className="btn btn-primary" disabled={blocked || busy}
                        onClick={() => (needsConfirm ? setPhase('confirm') : submit())}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', fontSize: 13 }}>
                  {busy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                  {needsConfirm ? 'Continue' : 'Save payment'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** '2026-05-25' → '25 May'. The plan needs the day and month, never the year. */
function fmtPlanDate(d) {
  if (!d) return '';
  const dt = new Date(typeof d === 'string' && d.length <= 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
