import { useState, useCallback } from 'react';
import {
  Wallet, X, AlertTriangle, Loader2, CheckCircle2, Link2, Copy, QrCode, Banknote, FileText,
} from 'lucide-react';
import { api } from '../api/client.js';
import { openAdvanceVoucher } from '../lib/documentPdf.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';

const fmt = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

/**
 * Take money towards a job BEFORE the invoice exists.
 *
 * ── The amount is a slice of a total that already exists ────────────────────
 * A ₹2,000 advance on a ₹5,000 job is ₹2,000 the customer pays — GST included,
 * in the same proportion the estimate carries. Nothing is added on top, and the
 * modal never asks for a tax figure, because the estimate already answers it.
 * That is the whole reason advances attach to an estimate rather than a bare
 * appointment: without a total there is no way to say what tax is inside the
 * money, and a receipt has to state it.
 *
 * ── Two instruments, one act ────────────────────────────────────────────────
 * A link the customer pays online, or cash across the counter. From the
 * advisor's side it is one thing — "take ₹2,000 from this customer now" — so it
 * is one dialog with a choice in it, not two buttons on the screen behind.
 *
 * ── The receipt number appears at different moments, deliberately ───────────
 * Cash gets one immediately: the money is in the drawer. A link gets one only
 * when the customer actually pays, because an abandoned link that had consumed
 * a number would leave a gap in a tax series — and a gap is something a person
 * has to account for later. The copy says so rather than leaving it a mystery.
 */
export default function AdvancePaymentModal({ estimate, onClose, onSuccess, showToast }) {
  const collectable = Math.max(0, Number(estimate?.collectable ?? estimate?.grand_total ?? 0));
  const already = Number(estimate?.already_advanced || 0);

  const [amount, setAmount] = useState(collectable > 0 ? collectable.toFixed(2) : '');
  const [mode, setMode] = useState('link');          // 'link' | 'manual'
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  // idle → working → done
  const [phase, setPhase] = useState('idle');
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const busy = phase === 'working';
  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  useEscapeClose(close, !busy);

  const asked = parseFloat(amount);
  const invalid = !amount || Number.isNaN(asked) || asked <= 0;
  const over = !invalid && asked > collectable + 0.001;

  async function submit() {
    if (invalid || over) return;
    setErr(null);
    setPhase('working');
    try {
      const out = await api('/api/payments/advance', {
        method: 'POST',
        body: {
          estimate_id: estimate.id,
          amount: asked,
          method: mode === 'link' ? 'link' : method,
          reference_no: mode === 'manual' ? (reference.trim() || undefined) : undefined,
          notes: mode === 'manual' ? (notes.trim() || undefined) : undefined,
        },
      });
      setResult(out);
      setPhase('done');
      if (out.kind === 'manual') {
        showToast?.(`Advance of ${fmt(out.amount)} recorded — receipt ${out.voucher_no}.`);
        onSuccess?.();
      }
    } catch (e) {
      setErr(e.message || 'Could not take the advance.');
      setPhase('idle');
    }
  }

  const shareUrl = result?.url || (result?.token ? `${window.location.origin}/pay/${result.token}` : '');

  function copy() {
    navigator.clipboard?.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => setErr('Could not copy — select the link and copy it by hand.'));
  }

  return (
    <div className="po-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="po-modal" style={{ maxWidth: 470 }} role="dialog" aria-modal="true" aria-label="Add advance payment">

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 8, background: 'var(--bg-soft)', color: 'var(--primary)', flexShrink: 0 }}>
              <Wallet size={17} />
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Add advance payment</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {[estimate?.customer_name, estimate?.vehicle_number].filter(Boolean).join(' · ') || 'Against this job'}
              </div>
            </div>
          </div>
          <button onClick={close} disabled={busy} aria-label="Close"
                  style={{ background: 'none', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {/* ── Done: a link to share ─────────────────────────────────────────── */}
        {phase === 'done' && result?.kind === 'link' ? (
          <>
            <div style={{ background: 'var(--bg-soft)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Asking for</div>
              <div style={{ fontWeight: 800, fontSize: 22 }}>{fmt(result.amount)}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
                includes {fmt(result.gst_amount)} GST
              </div>
            </div>

            <label className="lb-pop-label" htmlFor="adv-link">Payment link</label>
            <input id="adv-link" className="form-input" readOnly value={shareUrl}
                   onFocus={e => e.target.select()}
                   style={{ width: '100%', boxSizing: 'border-box', fontSize: 12.5, marginBottom: 10 }} />

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              <button type="button" className="btn btn-primary" onClick={copy}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy link'}
              </button>
              <a className="btn btn-ghost" target="_blank" rel="noreferrer"
                 href={`https://wa.me/?text=${encodeURIComponent(`Advance payment for your vehicle: ${shareUrl}`)}`}
                 style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, textDecoration: 'none' }}>
                <Link2 size={14} /> Share on WhatsApp
              </a>
              <a className="btn btn-ghost" target="_blank" rel="noreferrer" href={shareUrl}
                 style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, textDecoration: 'none' }}>
                <QrCode size={14} /> Open page
              </a>
            </div>

            {/* Why there is no receipt number yet. Without this the advisor
                looks for one, does not find it, and assumes something failed. */}
            <div style={{ background: 'var(--bg-soft)', borderRadius: 8, padding: '11px 13px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 14 }}>
              Nothing is recorded until the customer actually pays. The receipt number is issued
              then — so a link that is never used leaves no gap in your receipt series.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-primary" onClick={() => { onSuccess?.(); onClose(); }}
                      style={{ padding: '8px 18px', fontSize: 13 }}>
                Done
              </button>
            </div>
          </>

        /* ── Done: cash taken ───────────────────────────────────────────────── */
        ) : phase === 'done' ? (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 14px', fontSize: 13, marginBottom: 14 }}>
              <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontWeight: 700 }}>{fmt(result.amount)} received</div>
                <div style={{ marginTop: 3, fontSize: 12 }}>
                  Receipt <strong>{result.voucher_no}</strong> · includes {fmt(result.gst_amount)} GST
                </div>
                <div style={{ marginTop: 5, fontSize: 12 }}>
                  This will be applied automatically when the invoice is raised.
                </div>
              </div>
            </div>
            {/* The receipt exists the moment the cash is recorded, so it is
                offered here rather than only from the customer's Payments tab.
                The advisor has the customer in front of them; this is the one
                moment they can hand over the printed voucher. */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {result.payment_id && (
                <button type="button" className="btn btn-ghost"
                        onClick={() => openAdvanceVoucher(result.payment_id)
                          .catch(e => showToast?.(e.message, 'error'))}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <FileText size={14} /> Open receipt
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={onClose}
                      style={{ padding: '8px 18px', fontSize: 13 }}>
                Done
              </button>
            </div>
          </>

        /* ── The form ───────────────────────────────────────────────────────── */
        ) : (
          <>
            <div style={{ background: 'var(--bg-soft)', borderRadius: 8, padding: '12px 14px', display: 'grid', gap: 6, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                <span style={{ color: 'var(--text-muted)' }}>Job total</span>
                <span style={{ fontWeight: 600 }}>{fmt(estimate?.grand_total)}</span>
              </div>
              {already > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Already advanced</span>
                  <span style={{ fontWeight: 600 }}>− {fmt(already)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                <span style={{ color: 'var(--text-muted)' }}>Can collect up to</span>
                <span style={{ fontWeight: 800 }}>{fmt(collectable)}</span>
              </div>
            </div>

            <label htmlFor="adv-amount" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5 }}>
              Amount to collect
            </label>
            <input
              id="adv-amount" className="form-input" type="number"
              min="1" step="0.01" max={collectable}
              value={amount} disabled={busy}
              onChange={e => setAmount(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: 6 }}
            />
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 14 }}>
              {over
                ? <span style={{ color: '#b45309' }}>More than what is left on this job.</span>
                /* Said plainly, because "is GST extra?" is the first question a
                   customer asks at the counter and the advisor needs the answer
                   on screen, not in their head. */
                : 'GST is already included — the customer pays exactly this.'}
            </div>

            <div role="tablist" aria-label="How the customer pays"
                 style={{ display: 'flex', gap: 4, background: 'var(--bg-soft)', padding: 3, borderRadius: 9, marginBottom: 14 }}>
              {[
                { key: 'link',   label: 'Payment link', Icon: Link2 },
                { key: 'manual', label: 'Cash / UPI / Transfer', Icon: Banknote },
              ].map(({ key, label, Icon }) => (
                <button key={key} type="button" role="tab" aria-selected={mode === key}
                        onClick={() => { if (!busy) { setErr(null); setMode(key); } }}
                        disabled={busy}
                        style={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          padding: '7px 10px', borderRadius: 7, fontSize: 12.5, fontWeight: 700,
                          border: '1px solid ' + (mode === key ? 'var(--border)' : 'transparent'),
                          background: mode === key ? 'var(--bg)' : 'transparent',
                          color: mode === key ? 'var(--text)' : 'var(--text-muted)',
                          cursor: busy ? 'not-allowed' : 'pointer',
                        }}>
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>

            {mode === 'manual' && (
              <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
                <div>
                  <label className="lb-pop-label" htmlFor="adv-method">Method</label>
                  <select id="adv-method" className="form-input" value={method} disabled={busy}
                          onChange={e => setMethod(e.target.value)} style={{ width: '100%' }}>
                    <option value="cash">Cash</option>
                    <option value="upi">UPI</option>
                    <option value="card">Card</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="lb-pop-label" htmlFor="adv-ref">Reference</label>
                  <input id="adv-ref" className="form-input" placeholder="UTR / Txn ID…"
                         value={reference} disabled={busy}
                         onChange={e => setReference(e.target.value)}
                         style={{ width: '100%', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label className="lb-pop-label" htmlFor="adv-notes">Notes</label>
                  <input id="adv-notes" className="form-input" placeholder="Optional…"
                         value={notes} disabled={busy}
                         onChange={e => setNotes(e.target.value)}
                         style={{ width: '100%', boxSizing: 'border-box' }} />
                </div>
              </div>
            )}

            {err && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 11px', fontSize: 12.5, marginBottom: 14 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{err}</span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={close} disabled={busy}
                      style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}>
                Cancel
              </button>
              <button type="button" onClick={submit} disabled={busy || invalid || over}
                      className="btn btn-primary"
                      style={{ padding: '8px 18px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, opacity: (busy || invalid || over) ? 0.6 : 1 }}>
                {busy
                  ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Working…</>
                  : mode === 'link'
                    ? <><Link2 size={14} /> Create link for {fmt(Math.min(asked || 0, collectable))}</>
                    : <><Banknote size={14} /> Record {fmt(Math.min(asked || 0, collectable))}</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
