import { useState, useRef, useCallback } from 'react';
import { CreditCard, X, AlertTriangle, Loader2, CheckCircle2, ShieldCheck, QrCode } from 'lucide-react';
import { api } from '../api/client.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import { openCheckout } from '../lib/razorpayCheckout.js';
import UpiQrPanel from './UpiQrPanel.jsx';

const fmt = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

/**
 * Take an online payment against a customer invoice.
 *
 * ── The amount shown is not the amount charged ──────────────────────────────
 * It is a request. The backend reads the invoice, computes the balance itself
 * and clamps whatever arrives to it. That is deliberate: this field is in a
 * browser, and a browser is not a place money decisions are made. If a part
 * payment lands from another till while this dialog is open, the customer is
 * charged the smaller, correct figure.
 *
 * ── Three outcomes, three different messages ────────────────────────────────
 * Success, dismissed and failed are genuinely different things and telling them
 * apart is most of the UX here. A customer who closed the window has not failed
 * at anything, and saying "payment failed" to them is the most common lie this
 * kind of integration tells.
 *
 * ── Verifying is not optional and not cosmetic ──────────────────────────────
 * The gateway's success handler runs in the browser. Nothing is paid until the
 * backend has checked the signature, which is why the dialog stays up in a
 * "confirming" state instead of closing on the handler. If that call fails, the
 * money may still have been taken — so the copy says so and gives the reference
 * rather than pretending nothing happened.
 *
 * ── Two instruments, ONE amount field ───────────────────────────────────────
 * Checkout and UPI QR are different journeys but the same decision: which
 * invoice, and how much of its balance. That decision is made once, here, and
 * both tabs read it. Giving the QR panel its own amount input would be two
 * places to keep the clamping copy correct, and the backend applies the same
 * resolveCollectable() to both regardless of what either one sends.
 */
export default function CollectPaymentModal({ invoice, balance, onClose, onSuccess, showToast }) {
  const [amount, setAmount] = useState(balance > 0 ? balance.toFixed(2) : '');
  // idle → starting → waiting (checkout open) → verifying → done
  const [phase, setPhase] = useState('idle');
  const [err, setErr] = useState(null);
  const [receipt, setReceipt] = useState(null);
  // 'checkout' | 'qr'
  const [mode, setMode] = useState('checkout');

  // The QR panel hands us a way to close its QR server-side. Held in a ref so
  // that closing the whole dialog cancels the code even though the panel's own
  // unmount happens in the same tick.
  const qrCleanup = useRef(null);
  const registerQrCleanup = useCallback((fn) => { qrCleanup.current = fn; }, []);

  const busy = phase !== 'idle' && phase !== 'done';

  const close = useCallback(() => {
    try { qrCleanup.current?.(); } catch { /* closing regardless */ }
    onClose();
  }, [onClose]);

  useEscapeClose(close, !busy);

  const asked = parseFloat(amount);
  const invalid = !amount || Number.isNaN(asked) || asked <= 0;
  const overBalance = !invalid && asked > balance + 0.001;

  async function start() {
    if (invalid || overBalance) return;
    setErr(null);
    setPhase('starting');
    try {
      // The backend creates the order and returns the PUBLIC key with it. The
      // key is never stored in the frontend or read from an env var here — it
      // arrives per order, so a mode switch on the server takes effect with no
      // frontend release.
      const order = await api('/api/payments/order', {
        method: 'POST',
        body: { customer_invoice_id: invoice.id, amount: asked },
      });

      setPhase('waiting');
      await openCheckout({
        order,
        customer: { name: invoice.customer_name, mobile: invoice.mobile },
        onClose: () => {
          // Dismissed. Nothing was charged, and the order simply goes unused —
          // there is nothing to clean up and nothing to apologise for.
          setPhase('idle');
        },
        onError: (message) => {
          setErr(message);
          setPhase('idle');
        },
        onDone: async (resp) => {
          setPhase('verifying');
          try {
            const out = await api('/api/payments/verify', {
              method: 'POST',
              body: {
                gateway_order_id: resp.gateway_order_id,
                gateway_payment_id: resp.gateway_payment_id,
                signature: resp.signature,
              },
            });
            setReceipt(out);
            setPhase('done');
            showToast?.(`Payment of ${fmt(out.amount)} received.`);
            onSuccess?.();
          } catch (e) {
            // The dangerous case. The customer may well have been charged, so
            // this must never read like "nothing happened" — it hands over the
            // reference and tells them not to pay again.
            setErr(
              (e.message || 'We could not confirm that payment.') +
              ' Do not pay again — check the Payments tab in a minute, or contact support with this invoice number.'
            );
            setPhase('idle');
            onSuccess?.();   // refresh anyway: the webhook may have recorded it
          }
        },
      });
    } catch (e) {
      setErr(e.message || 'Could not start the payment.');
      setPhase('idle');
    }
  }

  return (
    <div className="po-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) close(); }}>
      <div className="po-modal" style={{ maxWidth: 440 }} role="dialog" aria-modal="true" aria-label="Collect payment online">

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 8, background: 'var(--bg-soft)', color: 'var(--primary)', flexShrink: 0 }}>
              <CreditCard size={17} />
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Collect payment online</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                Card, UPI or net banking. The invoice updates once the payment is confirmed.
              </div>
            </div>
          </div>
          <button
            onClick={close} disabled={busy} aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', color: 'var(--text-muted)', display: 'flex' }}
          >
            <X size={18} />
          </button>
        </div>

        {phase === 'done' ? (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 14px', fontSize: 13, marginBottom: 14 }}>
              <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontWeight: 700 }}>{fmt(receipt?.amount)} received</div>
                <div style={{ marginTop: 3, fontSize: 12 }}>
                  Reference <strong>{receipt?.txn_ref}</strong>
                  {receipt?.invoice_status === 'paid'
                    ? ' — this invoice is now fully paid.'
                    : ' — a balance is still outstanding.'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={close} className="btn btn-primary" style={{ padding: '8px 18px', fontSize: 13 }}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ background: 'var(--bg-soft)', borderRadius: 8, padding: '12px 14px', display: 'grid', gap: 6, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                <span style={{ color: 'var(--text-muted)' }}>Customer</span>
                <span style={{ fontWeight: 600 }}>{invoice.customer_name || '—'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                <span style={{ color: 'var(--text-muted)' }}>Balance due</span>
                <span style={{ fontWeight: 800 }}>{fmt(balance)}</span>
              </div>
            </div>

            {/* Instrument. Disabled while a checkout is mid-flight — switching
                tabs under an open payment window is a way to end up with two
                live payment requests for one balance. */}
            <div role="tablist" aria-label="Payment method" style={{ display: 'flex', gap: 4, background: 'var(--bg-soft)', padding: 3, borderRadius: 9, marginBottom: 14 }}>
              {[
                { key: 'checkout', label: 'Card / Netbanking', Icon: CreditCard },
                { key: 'qr',       label: 'UPI QR',            Icon: QrCode },
              ].map(({ key, label, Icon }) => (
                <button
                  key={key} type="button" role="tab" aria-selected={mode === key}
                  onClick={() => { if (!busy) { setErr(null); setMode(key); } }}
                  disabled={busy}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: '7px 10px', borderRadius: 7, fontSize: 12.5, fontWeight: 700,
                    border: '1px solid ' + (mode === key ? 'var(--border)' : 'transparent'),
                    background: mode === key ? 'var(--bg)' : 'transparent',
                    color: mode === key ? 'var(--text)' : 'var(--text-muted)',
                    cursor: busy ? 'not-allowed' : 'pointer',
                  }}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>

            <label htmlFor="cpm-amount" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5 }}>
              Amount to collect
            </label>
            <input
              id="cpm-amount"
              className="form-input"
              type="number" min="1" step="0.01" max={balance}
              value={amount}
              disabled={busy}
              onChange={e => setAmount(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: 6 }}
            />
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 14 }}>
              {overBalance
                ? <span style={{ color: '#b45309' }}>More than the balance — the customer will only be charged {fmt(balance)}.</span>
                : 'Leave as-is to collect the full balance, or lower it for a part payment.'}
            </div>

            {mode === 'qr' ? (
              <>
                <UpiQrPanel
                  invoice={invoice}
                  amount={Math.min(asked || 0, balance)}
                  balance={balance}
                  onSuccess={onSuccess}
                  showToast={showToast}
                  registerCleanup={registerQrCleanup}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                  <button
                    type="button" onClick={close}
                    style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
            {phase === 'waiting' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--bg-soft)', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, marginBottom: 14 }}>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--primary)' }} />
                <span>Payment window is open. Complete it there, or close it to cancel.</span>
              </div>
            )}
            {phase === 'verifying' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--bg-soft)', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, marginBottom: 14 }}>
                <ShieldCheck size={14} style={{ color: 'var(--primary)' }} />
                {/* Named plainly on purpose: the wait is a security step, not a
                    slow network, and saying so stops anyone closing the tab. */}
                <span>Confirming the payment with the bank — do not close this window.</span>
              </div>
            )}

            {err && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 11px', fontSize: 12.5, marginBottom: 14 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{err}</span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button" onClick={close} disabled={busy}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}
              >
                Cancel
              </button>
              {/* overBalance belongs in `disabled`, and its absence was a real
                  dead end: start() bails on it silently, so the button was fully
                  enabled, the hint underneath promised "the customer will only
                  be charged ₹5,000.00", the label read the clamped figure — and
                  clicking did nothing at all. No spinner, no error, no checkout.
                  The advisor clicks again and concludes the gateway is down.
                  AdvancePaymentModal already gets this right with `|| over`. */}
              <button
                type="button" onClick={start} disabled={busy || invalid || overBalance}
                className="btn btn-primary"
                style={{ padding: '8px 18px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, opacity: (busy || invalid || overBalance) ? 0.6 : 1 }}
              >
                {busy
                  ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Working…</>
                  : <><CreditCard size={14} /> Collect {fmt(Math.min(asked || 0, balance))}</>}
              </button>
            </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
