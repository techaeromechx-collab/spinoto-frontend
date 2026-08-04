import { useState } from 'react';
import { AlertTriangle, CalendarClock, X } from 'lucide-react';
import { api } from '../api/client.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';

const fmt = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

function istToday() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Change the date on a hub payment — one payment, or a whole bulk payment.
 *
 * ── Why the date and nothing else ────────────────────────────────────────
 * Amount, method and reference are not editable. Those are what the payment
 * WAS; quietly rewriting them would make the record disagree with the bank
 * statement behind it, with no trace. A wrong amount is a delete and a
 * re-entry, which leaves both events in the audit log.
 *
 * ── Why a batch moves as one ─────────────────────────────────────────────
 * One bank transfer has one date. If a single row inside a batch could be
 * re-dated on its own, the grouped history header would show one date and its
 * own children another — the same transfer displaying two days. So a batched
 * payment is only editable AS the batch, and the server enforces that too
 * (409 IN_BATCH) rather than trusting the UI to hide the control.
 *
 * ── What does NOT change ─────────────────────────────────────────────────
 * Nothing recalculates. amount_paid, payment_status and the split installments
 * all derive from `amount`, and the payout due date is anchored to CUSTOMER
 * invoice payments in a different table. This is close to a display field —
 * which is exactly why it is safe to edit and the amount is not.
 */
export default function EditPaymentDateDialog({ target, onClose, onSaved, showToast }) {
  const isBatch = target?.kind === 'batch';
  const current = String((isBatch ? target.paid_at : target?.payment?.paid_at) || '').slice(0, 10);

  const [date, setDate] = useState(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);

  useEscapeClose(onClose, !busy);

  const amount = isBatch ? target.amount : Number(target?.payment?.amount || 0);
  const count  = isBatch ? target.payments.length : 1;

  async function save() {
    setBusy(true); setErr(null);
    try {
      const url = isBatch
        ? `/api/purchase-invoices/payment-batch/${encodeURIComponent(target.batchId)}`
        : `/api/purchase-invoices/${target.payment.purchase_invoice_id}/payments/${target.payment.id}`;
      await api(url, { method: 'PATCH', body: { paid_at: date } });
      showToast?.(isBatch
        ? `Bulk payment moved to ${date} across ${count} invoices.`
        : `Payment date changed to ${date}.`);
      onSaved?.();
      onClose?.();
    } catch (e) {
      setErr(e.message || 'Could not change the date.');
      setBusy(false);
    }
  }

  const unchanged = !date || date === current;

  return (
    <div className="po-backdrop">
      <div className="po-modal" style={{ maxWidth: 460 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 8, background: 'var(--bg-soft)', color: 'var(--primary)', flexShrink: 0 }}>
              <CalendarClock size={17} />
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                {isBatch ? 'Change bulk payment date' : 'Change payment date'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {isBatch
                  ? `All ${count} invoices in this payment move together.`
                  : 'Only the date changes — amount and method stay as recorded.'}
              </div>
            </div>
          </div>
          <button
            onClick={onClose} disabled={busy} aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ background: 'var(--bg-soft)', borderRadius: 8, padding: '12px 14px', display: 'grid', gap: 6, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
            <span style={{ color: 'var(--text-muted)' }}>Amount</span>
            <span style={{ fontWeight: 800 }}>{fmt(amount)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
            <span style={{ color: 'var(--text-muted)' }}>Currently dated</span>
            <span style={{ fontWeight: 600 }}>{current || '—'}</span>
          </div>
          {isBatch && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
              <span style={{ color: 'var(--text-muted)' }}>Invoices</span>
              <span style={{ fontWeight: 600 }}>
                {target.payments.map(p => `PI-${String(p.purchase_invoice_id).padStart(6, '0')}`).join(', ')}
              </span>
            </div>
          )}
        </div>

        <label htmlFor="epd-date" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5 }}>
          New date
        </label>
        <input
          id="epd-date"
          type="date"
          value={date}
          /* A payment cannot be dated in the future. The server rejects it too;
             this just stops the user picking one in the first place. */
          max={istToday()}
          disabled={busy}
          onChange={e => setDate(e.target.value)}
          style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 14 }}
        />

        {err && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 11px', fontSize: 12.5, marginBottom: 14 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{err}</span>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button" onClick={onClose} disabled={busy}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="button" onClick={save} disabled={busy || unchanged}
            title={unchanged ? 'Pick a different date first' : undefined}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: (busy || unchanged) ? 'not-allowed' : 'pointer', opacity: (busy || unchanged) ? 0.6 : 1 }}
          >
            {busy ? 'Saving…' : 'Save date'}
          </button>
        </div>
      </div>
    </div>
  );
}
