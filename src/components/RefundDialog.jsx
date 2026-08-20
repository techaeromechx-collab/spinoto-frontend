import { useState } from 'react';
import { RotateCcw, X, AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../api/client.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';

const fmt = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

/**
 * Send money back to a customer.
 *
 * ── Why this dialog is deliberately awkward ─────────────────────────────────
 * A refund cannot be undone from this system. Every other money action in the
 * CRM is a bookkeeping entry someone can correct; this one instructs a bank to
 * move funds out of the company's account. So it asks for a written reason,
 * states the consequences in full sentences, and does not pre-fill the amount
 * with the maximum — a full refund should be a decision, not a default someone
 * clicks past.
 *
 * ── Why the invoice does not change when this succeeds ──────────────────────
 * Requesting a refund moves nothing. The gateway accepts it and the money
 * reaches the customer over the following days, and it can still fail. The
 * invoice balance only comes back up when the refund.processed webhook
 * confirms it. The copy says this plainly, because a screen that showed the
 * invoice as unpaid immediately would have staff chasing a customer for money
 * they have not been sent yet.
 */
export default function RefundDialog({ txn, maxAmount, onClose, onDone }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);

  useEscapeClose(onClose, !busy);

  const asked = parseFloat(amount);
  const invalidAmount = !amount || Number.isNaN(asked) || asked <= 0 || asked > maxAmount + 0.001;
  const invalidReason = reason.trim().length < 3;

  async function submit() {
    if (invalidAmount || invalidReason) return;
    setBusy(true); setErr(null);
    try {
      const out = await api(`/api/payments/${encodeURIComponent(txn.txn_ref)}/refund`, {
        method: 'POST',
        body: { amount: asked, reason: reason.trim() },
      });
      setResult(out);
    } catch (e) {
      setErr(e.message || 'Could not process the refund.');
      setBusy(false);
    }
  }

  return (
    <div className="po-backdrop" style={{ zIndex: 60 }}
         onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="po-modal" style={{ maxWidth: 460 }} role="dialog" aria-modal="true" aria-label="Refund payment">

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 8, background: '#fef3c7', color: '#b45309', flexShrink: 0 }}>
              <RotateCcw size={17} />
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Refund this payment</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {txn?.txn_ref} · {fmt(txn?.amount)} paid by {txn?.customer_name || 'the customer'}
              </div>
            </div>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close"
                  style={{ background: 'none', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {result ? (
          <>
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: '12px 14px', fontSize: 13, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                {result.pending ? 'Refund requested' : 'Refund completed'}
              </div>
              <div>{result.message}</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-primary" onClick={onDone}
                      style={{ padding: '8px 18px', fontSize: 13 }}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, marginBottom: 14 }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                This sends money out of the company account and cannot be reversed from
                the CRM. If the invoice drops out of PAID, the hub payout for this job is
                pulled back with it.
              </span>
            </div>

            <label htmlFor="rf-amount" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5 }}>
              Amount to refund
            </label>
            <input
              id="rf-amount" className="form-input" type="number"
              min="1" step="0.01" max={maxAmount}
              placeholder={`Up to ${fmt(maxAmount)}`}
              value={amount} disabled={busy}
              onChange={e => setAmount(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: 4 }}
            />
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 12 }}>
              {/* Not pre-filled. A full refund should be typed, not defaulted. */}
              {fmt(maxAmount)} available. Enter less for a partial refund.
              {' '}
              <button type="button" onClick={() => setAmount(maxAmount.toFixed(2))} disabled={busy}
                      style={{ background: 'none', border: 'none', padding: 0, color: 'var(--primary)', cursor: 'pointer', fontSize: 11.5, fontWeight: 600 }}>
                Refund it all
              </button>
            </div>

            <label htmlFor="rf-reason" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5 }}>
              Reason (required)
            </label>
            <textarea
              id="rf-reason" className="form-input" rows={3}
              placeholder="Why is this being refunded? This is kept permanently against the payment."
              value={reason} disabled={busy}
              onChange={e => setReason(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: 14, resize: 'vertical', fontFamily: 'inherit' }}
            />

            {err && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 11px', fontSize: 12.5, marginBottom: 14 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{err}</span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={onClose} disabled={busy}
                      style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>
                Cancel
              </button>
              <button
                type="button" onClick={submit} disabled={busy || invalidAmount || invalidReason}
                style={{
                  padding: '8px 18px', borderRadius: 8, border: 'none', background: '#b45309',
                  color: '#fff', fontSize: 13, fontWeight: 700,
                  display: 'flex', alignItems: 'center', gap: 6,
                  cursor: (busy || invalidAmount || invalidReason) ? 'not-allowed' : 'pointer',
                  opacity: (busy || invalidAmount || invalidReason) ? 0.55 : 1,
                }}>
                {busy
                  ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Sending…</>
                  : <><RotateCcw size={14} /> Refund {amount ? fmt(asked) : ''}</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
