import { useState, useMemo, useEffect } from 'react';
import { api } from '../api/client.js';
import { X, AlertTriangle, Info, FileMinus } from 'lucide-react';
import '../styles/CreditNoteModal.css';

/**
 * Issue a credit note against a customer invoice.
 *
 * ── WHY THIS IS A PICK-LIST, NOT AN AMOUNT BOX ─────────────────────────────
 *
 * The obvious design is one field: "how much to credit". It is also the design
 * that makes GSTR-1 Table 12 impossible, because a lump sum cannot be
 * attributed to an HSN code. So the note is built from the invoice's own
 * lines — tick what is being credited, adjust the quantity if only part of it
 * is. Every line carries its HSN and rate across untouched, which is also what
 * makes the note's tax agree with the invoice's by construction.
 *
 * The free-text row at the bottom covers a price correction that maps to no
 * single line.
 */

const REASONS = [
  { value: 'goods_returned',          label: 'Goods returned' },
  { value: 'rejection_after_payment', label: 'Rejected after payment' },
  { value: 'deficiency_in_service',   label: 'Deficiency in service' },
  { value: 'price_correction',        label: 'Price correction' },
  { value: 'post_sale_discount',      label: 'Discount agreed after the sale' },
  { value: 'other',                   label: 'Other' },
];

const inr = n => Number(n || 0).toLocaleString('en-IN',
  { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const todayIso = () => {
  const d = new Date();
  const p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function CreditNoteModal({ invoice, items = [], onClose, onSuccess, showToast }) {
  const [reason, setReason]   = useState('goods_returned');
  const [note, setNote]       = useState('');
  const [date, setDate]       = useState(todayIso());
  const [picked, setPicked]   = useState({});     // itemId -> qty being credited
  const [freeText, setFree]   = useState({ description: '', rate: '', gst_percent: '18' });
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [existing, setExisting] = useState(null); // notes already against this invoice

  /* How much of this invoice is still creditable. Fetched rather than assumed:
     somebody else may have credited part of it a minute ago, and the server
     refuses anything over the headroom regardless of what this form thinks. */
  useEffect(() => {
    let alive = true;
    api(`/api/credit-notes?customer_invoice_id=${invoice.id}&status=issued`)
      .then(r => { if (alive) setExisting(r.items || []); })
      .catch(() => { if (alive) setExisting([]); });
    return () => { alive = false; };
  }, [invoice.id]);

  const alreadyCredited = useMemo(
    () => r2((existing || []).reduce((s, n) => s + Number(n.grand_total || 0), 0)),
    [existing]
  );
  const headroom = r2(Number(invoice.grand_total || 0) - alreadyCredited);

  const lines = useMemo(() => {
    const out = [];
    for (const it of items) {
      const qty = Number(picked[it.id] || 0);
      if (qty <= 0) continue;
      const rate = Number(it.customer_rate || 0);
      const gstP = Number(it.gst_percent || 0);
      const base = r2(rate * qty);
      out.push({
        customer_invoice_item_id: it.id,
        item_type: it.item_type || 'service',
        description: it.description || '',
        hsn_sac: it.hsn_sac || null,
        quantity: qty, rate, gst_percent: gstP,
        _taxable: base, _gst: r2(base * gstP / 100),
      });
    }
    const fRate = Number(freeText.rate || 0);
    if (freeText.description.trim() && fRate > 0) {
      const gstP = Number(freeText.gst_percent || 0);
      const base = r2(fRate);
      out.push({
        item_type: 'service',
        description: freeText.description.trim(),
        hsn_sac: null, quantity: 1, rate: fRate, gst_percent: gstP,
        _taxable: base, _gst: r2(base * gstP / 100),
      });
    }
    return out;
  }, [items, picked, freeText]);

  const subtotal = r2(lines.reduce((s, l) => s + l._taxable, 0));
  const totalGst = r2(lines.reduce((s, l) => s + l._gst, 0));
  const grand    = r2(subtotal + totalGst);
  const overHeadroom = grand > headroom + 0.011;

  const toggle = (it) => setPicked(p => {
    const next = { ...p };
    if (next[it.id]) delete next[it.id];
    else next[it.id] = Number(it.quantity || 1);
    return next;
  });

  async function submit() {
    setError('');
    if (!lines.length) { setError('Tick at least one line, or add a correction below.'); return; }
    if (overHeadroom)  { setError(`This note is ${inr(grand)} but only ${inr(headroom)} is left to credit.`); return; }
    setSaving(true);
    try {
      const body = {
        party_type: 'customer',
        customer_invoice_id: invoice.id,
        note_date: date,
        reason,
        reason_note: note.trim() || null,
        items: lines.map(({ _taxable, _gst, ...l }) => l),
      };
      const r = await api('/api/credit-notes', { method: 'POST', body });
      showToast?.(`${r.note_no} issued for ${inr(r.grand_total)}`, 'success');
      if (r.warning) showToast?.(r.warning, 'warning');
      await onSuccess?.();
      onClose();
    } catch (e) {
      setError(e.message || 'Could not issue the credit note');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cn-backdrop" onClick={onClose}>
      <div className="cn-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="cn-head">
          <div className="cn-head__title">
            <FileMinus size={18} />
            <div>
              <h2>Credit note</h2>
              <p>Against CI-{String(invoice.id).padStart(6, '0')} · {inr(invoice.grand_total)}</p>
            </div>
          </div>
          <button className="cn-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>

        <div className="cn-body">
          {/* The invoice is never edited — say so, because "reduce the invoice"
              is what everyone expects this button to do. */}
          <p className="cn-explain">
            <Info size={14} />
            <span>
              The invoice stays exactly as it is. This note sits beside it and reduces
              what the customer owes, which is what GST law requires instead of editing
              an issued invoice.
            </span>
          </p>

          {alreadyCredited > 0 && (
            <p className="cn-note cn-note--warn">
              <AlertTriangle size={14} />
              <span>{inr(alreadyCredited)} has already been credited against this invoice.
              {' '}<strong>{inr(headroom)}</strong> is left.</span>
            </p>
          )}

          <div className="cn-fields">
            <label>
              <span>Reason</span>
              <select value={reason} onChange={e => setReason(e.target.value)}>
                {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
            <label>
              <span>Note date</span>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </label>
          </div>

          {reason === 'post_sale_discount' && (
            <p className="cn-note cn-note--warn">
              <AlertTriangle size={14} />
              <span>A discount agreed <em>after</em> the sale only reduces the GST if it was
              agreed before or at the time of supply and is linked to these invoices. Otherwise
              this note reduces what is owed but not the tax. Worth checking with your CA.</span>
            </p>
          )}

          <h3 className="cn-sub">What is being credited</h3>
          <div className="cn-lines">
            {items.length === 0 && <p className="cn-empty">This invoice has no line items.</p>}
            {items.map(it => {
              const on = !!picked[it.id];
              const maxQty = Number(it.quantity || 1);
              return (
                <div key={it.id} className={`cn-line${on ? ' cn-line--on' : ''}`}>
                  <label className="cn-line__pick">
                    <input type="checkbox" checked={on} onChange={() => toggle(it)} />
                    <span className="cn-line__desc">
                      {it.description}
                      {it.hsn_sac && <em className="cn-line__hsn">{it.hsn_sac}</em>}
                    </span>
                  </label>
                  <span className="cn-line__rate">{inr(it.customer_rate)} · {Number(it.gst_percent || 0)}%</span>
                  <span className="cn-line__qty">
                    {on ? (
                      <input
                        type="number" min="0.001" step="any" max={maxQty}
                        value={picked[it.id]}
                        onChange={e => {
                          const v = Math.min(Number(e.target.value || 0), maxQty);
                          setPicked(p => ({ ...p, [it.id]: v }));
                        }}
                        /* Capped at the invoiced quantity. Crediting three of
                           two brake pads is not a partial return, it is a
                           typo, and the server would refuse it anyway. */
                      />
                    ) : <em>of {maxQty}</em>}
                  </span>
                </div>
              );
            })}
          </div>

          <h3 className="cn-sub">Or a correction that is not a line</h3>
          <div className="cn-free">
            <input placeholder="Description — e.g. rate corrected"
              value={freeText.description}
              onChange={e => setFree(f => ({ ...f, description: e.target.value }))} />
            <input type="number" placeholder="Amount ex-GST" min="0" step="any"
              value={freeText.rate}
              onChange={e => setFree(f => ({ ...f, rate: e.target.value }))} />
            <input type="number" placeholder="GST %" min="0" max="100" step="any"
              value={freeText.gst_percent}
              onChange={e => setFree(f => ({ ...f, gst_percent: e.target.value }))} />
          </div>

          <label className="cn-reasonnote">
            <span>Internal note (optional)</span>
            <textarea rows={2} value={note} onChange={e => setNote(e.target.value)}
              placeholder="Why this was credited — kept on the record" />
          </label>

          {error && <p className="cn-error"><AlertTriangle size={14} /><span>{error}</span></p>}
        </div>

        <footer className="cn-foot">
          <div className="cn-totals">
            <span>Taxable <strong>{inr(subtotal)}</strong></span>
            <span>GST <strong>{inr(totalGst)}</strong></span>
            <span className={`cn-totals__grand${overHeadroom ? ' cn-totals__grand--over' : ''}`}>
              Credit note <strong>{inr(grand)}</strong>
            </span>
          </div>
          <div className="cn-actions">
            <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={submit}
              disabled={saving || !lines.length || overHeadroom}>
              {saving ? 'Issuing…' : 'Issue credit note'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
