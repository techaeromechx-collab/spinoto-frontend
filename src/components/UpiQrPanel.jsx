import { useState, useEffect, useRef, useCallback } from 'react';
import { QrCode, Loader2, AlertTriangle, CheckCircle2, RefreshCw, Clock, X } from 'lucide-react';
import { api } from '../api/client.js';

const fmt = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

/**
 * A fixed-amount UPI QR the customer scans at the counter.
 *
 * ── There is no browser on the customer's side ──────────────────────────────
 * The whole point of this panel is that the customer never touches our page.
 * They open GPay or PhonePe, scan, and pay inside their bank's app. So unlike
 * checkout there is no success handler to listen to and nothing to verify — the
 * ONLY way this screen learns the money arrived is by asking our own backend,
 * which learned it from the gateway's webhook.
 *
 * That is why this polls. It is not a shortcut around a missing callback; there
 * is no callback to have.
 *
 * ── Polling asks about OUR reference, not the gateway's ─────────────────────
 * GET /api/payments/:txn_ref. The QR id is never in the frontend. The backend
 * already owns the mapping and there is no reason for a browser to hold a
 * gateway identifier it cannot do anything with.
 *
 * ── The QR dies in two hours, and that is the provider's rule ───────────────
 * Razorpay caps close_by at 2 hours from creation. The countdown is shown
 * because a customer being handed a dead code and told "it's not working" is
 * the failure this feature would otherwise produce every morning.
 *
 * ── Closing cancels ─────────────────────────────────────────────────────────
 * An abandoned QR is a live payment request against an invoice whose amount the
 * advisor may be about to change. Photographs of screens exist. It is closed on
 * the way out.
 */
export default function UpiQrPanel({ invoice, amount, balance, onSuccess, showToast, registerCleanup }) {
  // idle → creating → waiting → paid | expired
  const [phase, setPhase] = useState('idle');
  const [qr, setQr] = useState(null);
  const [err, setErr] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(null);

  // Refs, not state: the cleanup path runs after unmount has already begun, so
  // it cannot read a value React is in the middle of discarding.
  const qrRef = useRef(null);
  const paidRef = useRef(false);

  /**
   * Closes an unpaid QR on the server. Fire-and-forget by design — this runs
   * while the dialog is closing and there is no screen left to report an error
   * to. The QR expires on its own regardless.
   */
  const cancelServerSide = useCallback(() => {
    const ref = qrRef.current?.txn_ref;
    if (!ref || paidRef.current) return;
    api(`/api/payments/qr/${encodeURIComponent(ref)}/cancel`, { method: 'POST' }).catch(() => {});
  }, []);

  // Hand the parent a way to cancel when the whole modal closes, not just when
  // this panel unmounts.
  useEffect(() => {
    registerCleanup?.(cancelServerSide);
    return () => { cancelServerSide(); };
  }, [registerCleanup, cancelServerSide]);

  /**
   * Dismisses the QR popup: closes the code at the gateway and returns to the
   * idle state.
   *
   * Back to idle, NOT closing the whole dialog. The advisor was in the middle
   * of collecting a payment and the amount they typed is still in the box
   * behind this — dropping them out to the invoice would make them start again
   * to switch to card.
   */
  const cancelAndReset = useCallback(() => {
    cancelServerSide();
    qrRef.current = null;
    setQr(null);
    setSecondsLeft(null);
    setErr(null);
    setPhase('idle');
  }, [cancelServerSide]);

  async function createQr() {
    setErr(null);
    setPhase('creating');
    try {
      const created = await api('/api/payments/qr', {
        method: 'POST',
        body: { customer_invoice_id: invoice.id, amount },
      });
      qrRef.current = created;
      setQr(created);
      setPhase('waiting');
    } catch (e) {
      setErr(e.message || 'Could not create the QR.');
      setPhase('idle');
    }
  }

  // ── Polling ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'waiting' || !qr?.txn_ref) return undefined;

    let stopped = false;
    const tick = async () => {
      try {
        const out = await api(`/api/payments/${encodeURIComponent(qr.txn_ref)}`);
        const item = out?.item;
        if (stopped || !item) return;

        if (item.status === 'captured') {
          paidRef.current = true;          // stops the cleanup cancelling a paid QR
          setReceipt(item);
          setPhase('paid');
          showToast?.(`Payment of ${fmt(item.amount)} received.`);
          onSuccess?.();
        } else if (item.status === 'expired' || item.status === 'failed') {
          setPhase('expired');
        }
      } catch {
        // A dropped poll is not worth a message. The next one is 3 seconds
        // away, and the payment is recorded on the server either way — this
        // screen is a view of that, never the thing that makes it true.
      }
    };

    const id = setInterval(tick, 3000);
    tick();
    return () => { stopped = true; clearInterval(id); };
  }, [phase, qr?.txn_ref, onSuccess, showToast]);

  // ── Countdown ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'waiting' || !qr?.expires_at) return undefined;
    const end = new Date(qr.expires_at).getTime();

    const update = () => {
      const left = Math.floor((end - Date.now()) / 1000);
      setSecondsLeft(left);
      // Expired locally. The server row stays at 'created' until someone
      // cancels it, so this is a display state — but showing a live countdown
      // that has gone negative is worse than saying the code is dead.
      if (left <= 0) setPhase('expired');
    };

    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [phase, qr?.expires_at]);

  const mmss = (s) => {
    const v = Math.max(0, s || 0);
    return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
  };

  // ── Paid ──────────────────────────────────────────────────────────────────
  if (phase === 'paid') {
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 14px', fontSize: 13 }}>
        <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <div style={{ fontWeight: 700 }}>{fmt(receipt?.amount)} received by UPI</div>
          <div style={{ marginTop: 3, fontSize: 12 }}>
            Reference <strong>{receipt?.txn_ref}</strong>
            {receipt?.invoice_status === 'paid'
              ? ' — this invoice is now fully paid.'
              : ' — a balance is still outstanding.'}
          </div>
        </div>
      </div>
    );
  }

  // ── Before the QR exists ──────────────────────────────────────────────────
  if (phase === 'idle' || phase === 'creating') {
    return (
      <div>
        <div style={{ background: 'var(--bg-soft)', borderRadius: 8, padding: '14px', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.55 }}>
          Creates a UPI QR for <strong style={{ color: 'var(--text)' }}>{fmt(Math.min(amount || 0, balance))}</strong>.
          The customer scans it with any UPI app — the amount is fixed and they cannot change it.
          <div style={{ marginTop: 6 }}>The code stops working after 30 minutes.</div>
        </div>

        {err && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 11px', fontSize: 12.5, marginBottom: 12 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{err}</span>
          </div>
        )}

        <button
          type="button" onClick={createQr}
          disabled={phase === 'creating' || !amount || amount <= 0}
          className="btn btn-primary"
          style={{ width: '100%', padding: '10px 18px', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, opacity: (phase === 'creating' || !amount) ? 0.6 : 1 }}
        >
          {phase === 'creating'
            ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Creating…</>
            : <><QrCode size={15} /> Show QR for {fmt(Math.min(amount || 0, balance))}</>}
        </button>
      </div>
    );
  }

  // ── Expired ───────────────────────────────────────────────────────────────
  if (phase === 'expired') {
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', borderRadius: 8, padding: '11px 13px', fontSize: 12.5, marginBottom: 12 }}>
          <Clock size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>This QR has expired and will not accept payment. Nothing was charged.</span>
        </div>
        <button
          type="button"
          onClick={() => { qrRef.current = null; setQr(null); setSecondsLeft(null); setPhase('idle'); }}
          className="btn btn-primary"
          style={{ width: '100%', padding: '10px 18px', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
        >
          <RefreshCw size={14} /> Create a new QR
        </button>
      </div>
    );
  }

  // ── Waiting to be scanned — its own popup ─────────────────────────────────
  //
  // WHY THIS IS NOT INLINE IN THE COLLECT DIALOG
  // ────────────────────────────────────────────
  // A QR is the only thing on this screen a CUSTOMER looks at. Everything
  // around it — the amount field, the balance, the method tabs — is for the
  // advisor, and while a phone is being pointed at the monitor it is all just
  // noise the customer has to look past.
  //
  // It also has to be big. A code squeezed under a form competes for height
  // with the form, and a QR that a camera has to be held still for is a QR the
  // customer gives up on and pays by card instead.
  //
  // Rendered above the collect dialog rather than replacing it: cancelling the
  // QR must put the advisor back exactly where they were, with the amount they
  // had typed still in the box.
  const tall = !String(qr?.image_url || '').startsWith('data:');

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', background: 'var(--bg-soft)', borderRadius: 8, padding: '12px 14px', fontSize: 12.5, color: 'var(--text-muted)' }}>
        <QrCode size={15} /> <span>QR is open in a separate window.</span>
      </div>

      <div
        className="po-backdrop"
        style={{ zIndex: 70 }}
        onMouseDown={e => { if (e.target === e.currentTarget) cancelAndReset(); }}
        role="dialog" aria-modal="true" aria-label="Scan to pay"
      >
        <div
          className="po-modal"
          style={{ maxWidth: tall ? 420 : 380, textAlign: 'center', maxHeight: '92vh', overflowY: 'auto' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Scan to pay</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {invoice?.customer_name || 'Customer'}
                {invoice?.vehicle_number ? ` · ${invoice.vehicle_number}` : ''}
              </div>
            </div>
            <button
              onClick={cancelAndReset} aria-label="Close"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
            >
              <X size={18} />
            </button>
          </div>

          {qr?.mock && (
            <div style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 11px', fontSize: 11.5, margin: '12px 0 0', textAlign: 'left' }}>
              Test placeholder — no gateway keys are configured, so this code is
              not scannable and no money can be collected with it.
            </div>
          )}

          {/* height:auto and a viewport-relative cap, never a fixed pair.
              The backend draws a square code from the gateway's raw upi://
              intent when it can, but falls back to Razorpay's hosted POSTER —
              a tall, branded image — when the account does not return one.
              Pinning both dimensions squashes that fallback into something a
              phone camera cannot lock onto, and capping only the width lets it
              run off the bottom of the screen. */}
          <div style={{ display: 'inline-block', padding: 14, background: '#fff', border: '1px solid var(--border)', borderRadius: 12, lineHeight: 0, marginTop: 14 }}>
            {qr?.image_url
              ? <img
                  src={qr.image_url}
                  alt="UPI payment QR code"
                  style={{ display: 'block', width: tall ? 300 : 340, height: 'auto', maxWidth: '100%', maxHeight: '52vh', objectFit: 'contain' }}
                />
              : <div style={{ width: 300, height: 300, display: 'grid', placeItems: 'center', color: 'var(--text-muted)', fontSize: 12 }}>QR image unavailable</div>}
          </div>

          <div style={{ fontWeight: 800, fontSize: 26, marginTop: 14 }}>{fmt(qr?.amount)}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Scan with any UPI app — GPay, PhonePe, Paytm
          </div>

          <div style={{ display: 'flex', gap: 7, alignItems: 'center', justifyContent: 'center', background: 'var(--bg-soft)', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, marginTop: 16 }}>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: 'var(--primary)' }} />
            <span>Waiting for payment</span>
            {secondsLeft != null && (
              <span style={{ color: 'var(--text-muted)' }}>· expires in {mmss(secondsLeft)}</span>
            )}
          </div>

          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
            This closes on its own once the bank confirms the payment.
            Reference <strong>{qr?.txn_ref}</strong>.
          </div>

          <div style={{ marginTop: 16 }}>
            <button
              type="button" onClick={cancelAndReset}
              style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Cancel this QR
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
