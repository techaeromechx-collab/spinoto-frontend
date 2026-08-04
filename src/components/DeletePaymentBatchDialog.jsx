import { useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { api } from '../api/client.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';

const fmt = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

/**
 * Reverse a whole bulk payment — every invoice it touched, in one transaction.
 *
 * Separate from DeleteHubPaymentDialog on purpose. That one deletes a single
 * row and can be reached by expanding a batch; this one is for when the
 * transfer itself was wrong rather than one invoice's share of it. The
 * difference matters enough to be visible: this dialog lists every invoice that
 * will be affected, because reversing four invoices when you meant one is not a
 * mistake a generic confirm would catch.
 */
export default function DeletePaymentBatchDialog({ batch, onClose, onDeleted, showToast }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);

  useEscapeClose(onClose, !busy);

  const rows = batch?.payments || [];

  async function confirm() {
    setBusy(true); setErr(null);
    try {
      const res = await api(`/api/purchase-invoices/payment-batch/${encodeURIComponent(batch.batchId)}`, { method: 'DELETE' });
      showToast?.(`Bulk payment of ${fmt(res.total)} reversed across ${res.deleted} invoice(s).`);
      onDeleted?.();
      onClose?.();
    } catch (e) {
      setErr(e.message || 'Could not reverse this payment.');
      setBusy(false);
    }
  }

  return (
    <div className="po-backdrop">
      <div className="po-modal" style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 8, background: 'var(--bg-soft)', color: '#dc2626', flexShrink: 0 }}>
              <AlertTriangle size={17} />
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Reverse this bulk payment?</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                All {rows.length} invoices in it will be affected. This cannot be undone.
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

        <div style={{ background: 'var(--bg-soft)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
            <span style={{ color: 'var(--text-muted)' }}>Total</span>
            <span style={{ fontWeight: 800, color: '#dc2626' }}>{fmt(batch?.amount)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
            <span style={{ color: 'var(--text-muted)' }}>Method</span>
            <span style={{ fontWeight: 600 }}>{(batch?.method || '—').replace(/_/g, ' ')}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
            <span style={{ color: 'var(--text-muted)' }}>Reference</span>
            <span style={{ fontWeight: 600 }}>{batch?.reference_no || '—'}</span>
          </div>
        </div>

        {/* Every invoice, named. Reversing four when you meant one is the
            mistake this dialog exists to prevent. */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: 180, overflowY: 'auto', marginBottom: 14 }}>
          {rows.map((p, i) => (
            <div
              key={p.id}
              style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', fontSize: 12.5, borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none' }}
            >
              <span style={{ fontWeight: 600, color: 'var(--primary)' }}>
                PI-{String(p.purchase_invoice_id).padStart(6, '0')}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>{p.vehicle_number || '—'}</span>
              <span style={{ fontWeight: 700 }}>{fmt(p.amount)}</span>
            </div>
          ))}
        </div>

        <ul style={{ margin: '0 0 16px', paddingLeft: 18, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          <li>Each invoice's paid amount and status will be recalculated.</li>
          <li>They may return to the outstanding payouts list.</li>
          <li>The customer-side payments for these jobs become deletable again.</li>
        </ul>

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
            type="button" onClick={confirm} disabled={busy}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}
          >
            <Trash2 size={14} /> {busy ? 'Reversing…' : `Reverse ${rows.length} payment${rows.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
