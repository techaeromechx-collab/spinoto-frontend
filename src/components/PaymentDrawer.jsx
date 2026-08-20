import { useCallback, useEffect, useState } from 'react';
import {
  X, RotateCcw, AlertTriangle, Loader2, CheckCircle2, XCircle, Clock, Radio,
} from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth, useCan } from '../auth/AuthContext.jsx';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import RefundDialog from './RefundDialog.jsx';

const fmt = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

/**
 * Everything known about one payment.
 *
 * ── What is deliberately not here ───────────────────────────────────────────
 * The raw gateway response. It is stored (scrubbed) for support, but a JSON
 * dump on an admin screen is how internal identifiers end up pasted into
 * customer emails. What a person actually needs is on the face of this drawer:
 * the amount, the status, the reason it failed, and whether we ever heard from
 * the gateway.
 *
 * ── The delivery log is the point of the bottom section ─────────────────────
 * "The money left my account but the invoice says unpaid" is the most common
 * payment ticket there is, and the first question is always whether the gateway
 * told us. Without this list the answer is a shrug — the provider's dashboard
 * says "delivered", the CRM shows nothing, and a lost delivery is
 * indistinguishable from a handler that failed quietly.
 */
export default function PaymentDrawer({ txnRef, onClose, onChanged }) {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refundOpen, setRefundOpen] = useState(false);
  const { user } = useAuth();

  const canRefund = useCan('REFUND_PAYMENT') && !user?.hub_id;

  useEscapeClose(onClose, !refundOpen);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await api(`/api/payments/${encodeURIComponent(txnRef)}`);
      setItem(r.item);
    } catch (e) {
      setError(e.message || 'Could not load that payment.');
    } finally {
      setLoading(false);
    }
  }, [txnRef]);

  useEffect(() => { load(); }, [load]);

  const refunded = Number(item?.refunds?.filter(r => r.status === 'processed')
    .reduce((s, r) => s + Number(r.amount), 0) || 0);
  const refundable = Number(((item?.amount || 0) - Number(item?.refunds
    ?.filter(r => ['pending', 'processed'].includes(r.status))
    .reduce((s, r) => s + Number(r.amount), 0) || 0)).toFixed(2));

  // Only a captured payment can be sent back, and only what has not already
  // been committed to another refund. Pending refunds count against the
  // remainder — two quick requests must not refund the same rupees twice.
  const showRefund = canRefund
    && item && ['captured', 'partially_refunded'].includes(item.status)
    && refundable > 0.001;

  return (
    <div className="po-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pay-drawer" role="dialog" aria-modal="true" aria-label="Payment detail">
        <div className="pay-dhd">
          <div>
            <div className="pay-dref">{txnRef}</div>
            <div className="pay-dsub">
              {item ? `${fmt(item.amount)} · ${item.method_detail || 'unknown method'}` : 'Loading…'}
              {item?.mode === 'test' && <span className="pay-testtag">TEST</span>}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="pay-dclose">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="pay-empty">
            <Loader2 size={20} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
          </div>
        ) : error ? (
          <div className="pay-empty" style={{ color: '#b45309' }}>
            <AlertTriangle size={18} /> {error}
          </div>
        ) : !item ? null : (
          <div className="pay-dbody">

            {item.status === 'failed' && (
              <div className="pay-dalert pay-dalert--bad">
                <XCircle size={15} />
                <div>
                  <strong>This payment did not go through.</strong>
                  <div>{item.error_description || 'No reason was given by the gateway.'}</div>
                  {/* Named, because "no money was taken" is the thing the person
                      reading this actually needs to be able to tell a customer. */}
                  <div className="pay-dnote">Nothing was charged.</div>
                </div>
              </div>
            )}
            {['created', 'attempted'].includes(item.status) && (
              <div className="pay-dalert pay-dalert--idle">
                <Clock size={15} />
                <div>
                  <strong>Never completed.</strong>
                  <div>Checkout was opened but no payment was made. No money is involved.</div>
                </div>
              </div>
            )}

            <Section title="Payment">
              <Row label="Status" value={<StatusText status={item.status} />} />
              <Row label="Amount" value={<strong>{fmt(item.amount)}</strong>} />
              {refunded > 0 && <Row label="Refunded" value={`−${fmt(refunded)}`} />}
              {refunded > 0 && <Row label="Net" value={<strong>{fmt(item.amount - refunded)}</strong>} />}
              <Row label="Method" value={item.method_detail || '—'} />
              <Row label="Started" value={fmtWhen(item.created_at)} />
              <Row label="Last update" value={fmtWhen(item.updated_at)} />
              <Row label="Taken by" value={item.created_by_name
                || (item.payment_link_id ? 'Customer, from a payment link' : 'Customer')} />
            </Section>

            <Section title="Invoice">
              <Row label="Invoice" value={item.entity_type === 'customer_invoice'
                ? `CI-${String(item.entity_id).padStart(6, '0')}` : '—'} />
              <Row label="Customer" value={item.customer_name || '—'} />
              <Row label="Mobile" value={item.mobile || '—'} />
              <Row label="Vehicle" value={item.vehicle_number || '—'} />
              <Row label="Invoice total" value={item.invoice_total ? fmt(item.invoice_total) : '—'} />
              <Row label="Invoice status" value={item.invoice_status || '—'} />
              <Row label="Hub" value={item.hub_name || '—'} />
            </Section>

            <Section title="Gateway">
              <Row label="Provider" value={item.gateway} />
              <Row label="Mode" value={item.mode} />
              {/* Shown because an accountant reconciles against it in the
                  provider's own dashboard. Our txn_ref is what staff quote to
                  customers; this one is for matching a settlement line. */}
              <Row label="Payment ID" value={<code className="pay-code">{item.gateway_payment_id || '—'}</code>} />
              <Row label="Order ID" value={<code className="pay-code">{item.gateway_order_id || '—'}</code>} />
              {item.error_code && <Row label="Error code" value={item.error_code} />}
            </Section>

            {item.refunds?.length > 0 && (
              <Section title="Refunds">
                {item.refunds.map(r => (
                  <div key={r.id} className="pay-refrow">
                    <div>
                      <div className="pay-refamt">{fmt(r.amount)}</div>
                      <div className="pay-dsub">{r.reason}</div>
                      <div className="pay-dnote">
                        {r.requested_by_name ? `${r.requested_by_name} · ` : ''}{fmtWhen(r.created_at)}
                      </div>
                    </div>
                    <span className={`pay-st pay-st--${r.status === 'processed' ? 'ok'
                      : r.status === 'failed' ? 'bad' : 'idle'}`}>
                      {r.status === 'pending' ? 'On its way' : r.status}
                    </span>
                  </div>
                ))}
                {item.refunds.some(r => r.status === 'pending') && (
                  <div className="pay-dnote" style={{ marginTop: 6 }}>
                    {/* Stated plainly: this is the single most misread state in
                        a refund flow, and the invoice deliberately has not
                        moved yet. */}
                    A refund can take 5–7 working days to reach the customer. The invoice
                    balance changes only once the bank confirms it.
                  </div>
                )}
              </Section>
            )}

            <Section title="Gateway messages">
              {item.events?.length ? item.events.map((e, i) => (
                <div key={i} className="pay-evrow">
                  <Radio size={12} />
                  <div>
                    <div className="pay-evtype">{e.event_type}</div>
                    <div className="pay-dnote">
                      {fmtWhen(e.received_at)} · {e.status}
                      {e.error_text ? ` — ${e.error_text}` : ''}
                    </div>
                  </div>
                </div>
              )) : (
                <div className="pay-dnote">
                  Nothing received from the gateway yet.
                  {item.status === 'captured'
                    ? ' This payment was confirmed through the browser instead.'
                    : ''}
                </div>
              )}
            </Section>

            {showRefund && (
              <div className="pay-dfoot">
                <button type="button" className="btn btn-ghost pay-refundbtn"
                        onClick={() => setRefundOpen(true)}>
                  <RotateCcw size={15} /> Refund
                </button>
                <div className="pay-dnote">{fmt(refundable)} can still be refunded.</div>
              </div>
            )}
          </div>
        )}

        {refundOpen && (
          <RefundDialog
            txn={item}
            maxAmount={refundable}
            onClose={() => setRefundOpen(false)}
            onDone={async () => { setRefundOpen(false); await load(); onChanged?.(); }}
          />
        )}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="pay-dsec">
      <div className="pay-dsec-t">{title}</div>
      {children}
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

function StatusText({ status }) {
  const map = {
    captured: ['Paid', CheckCircle2, '#166534'],
    failed: ['Failed', XCircle, '#991b1b'],
    created: ['Not finished', Clock, 'var(--text-muted)'],
    attempted: ['Attempted', Clock, 'var(--text-muted)'],
    expired: ['Expired', XCircle, 'var(--text-muted)'],
    refunded: ['Refunded', RotateCcw, '#b45309'],
    partially_refunded: ['Partly refunded', RotateCcw, '#b45309'],
  };
  const [label, Icon, color] = map[status] || [status, Clock, 'var(--text-muted)'];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color, fontWeight: 700 }}>
      <Icon size={13} /> {label}
    </span>
  );
}

function fmtWhen(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}
