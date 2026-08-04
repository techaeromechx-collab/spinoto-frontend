import { useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { api } from '../api/client.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';

/**
 * Confirm and delete one hub payment.
 *
 * Shared by all three places the payment history is shown — the hub tab, the
 * global history and the per-invoice modal — because a delete that behaves
 * differently depending on which table you were looking at is worse than no
 * delete at all.
 *
 * ── Why this is a dialog and not a bare confirm() ─────────────────────────
 * Deleting a hub payout is not an isolated undo. It is the first link in a
 * chain the rest of the app deliberately blocks on:
 *
 *   • purchase_invoices.amount_paid and payment_status are recalculated, so a
 *     "paid" invoice reappears on the Payouts list as pending or partial.
 *   • For a split payout all three installments are re-waterfalled from #1.
 *   • It UNBLOCKS deleting the customer-side payment behind it — the customer
 *     invoice controller refuses that with "Hub payout of ₹X has already been
 *     made… Reverse the hub payment on the Purchase Invoice first."
 *   • It also re-opens editing PI take rates and reversing PI approval.
 *
 * So the dialog states the amount, the method and the invoice rather than
 * asking a generic "are you sure" — the person needs to recognise the specific
 * payment, not just confirm they clicked a button.
 *
 * The payout DUE DATE is not affected: that is driven by customer-invoice
 * payments via syncPayoutDueDate, which this path never touches.
 */
export default function DeleteHubPaymentDialog({ payment, piId, onClose, onDeleted, showToast }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);

  useEscapeClose(onClose, !busy);

  const amount = Number(payment?.amount || 0);
  const piLabel = `PI-${String(piId).padStart(6, '0')}`;

  async function confirm() {
    setBusy(true); setErr(null);
    try {
      const res = await api(`/api/purchase-invoices/${piId}/payments/${payment.id}`, { method: 'DELETE' });
      showToast?.(`Payment of ₹${amount.toFixed(2)} deleted.`);
      // Hands back the refreshed invoice so callers can update in place rather
      // than refetching the whole list.
      onDeleted?.(res.item);
      onClose?.();
    } catch (e) {
      // Shown in the dialog, not as a toast: the dialog is where the user is
      // looking, and a toast behind a modal is easy to miss.
      setErr(e.message || 'Could not delete this payment.');
      setBusy(false);
    }
  }

  return (
    <div className="po-backdrop">
      <div className="po-modal" style={{ maxWidth: 460 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 8, background: 'var(--bg-soft)', color: '#dc2626', flexShrink: 0 }}>
              <AlertTriangle size={17} />
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Delete this payment?</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                This cannot be undone.
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* The payment itself, so it can be recognised rather than assumed. */}
        <div style={{ background: 'var(--bg-soft)', borderRadius: 8, padding: '12px 14px', display: 'grid', gap: 6, marginBottom: 14 }}>
          {[
            ['Amount', `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`],
            ['Method', (payment?.method || '—').replace(/_/g, ' ')],
            ['Reference', payment?.reference_no || '—'],
            ['Invoice', piLabel],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
              <span style={{ color: 'var(--text-muted)' }}>{k}</span>
              <span style={{ fontWeight: k === 'Amount' ? 800 : 600, color: k === 'Amount' ? '#dc2626' : 'var(--text)' }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Consequences, stated plainly. These are the things people are
            surprised by afterwards, so they belong before the click. */}
        <ul style={{ margin: '0 0 16px', paddingLeft: 18, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          <li>The invoice's paid amount and status will be recalculated.</li>
          <li>It may return to the outstanding payouts list.</li>
          <li>The customer-side payment for this job becomes deletable again.</li>
        </ul>

        {err && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 11px', fontSize: 12.5, marginBottom: 14 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{err}</span>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}
          >
            <Trash2 size={14} /> {busy ? 'Deleting…' : 'Delete payment'}
          </button>
        </div>
      </div>
    </div>
  );
}
