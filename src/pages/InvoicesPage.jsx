import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api/client.js';
import { useCan } from '../auth/AuthContext.jsx';
import {
  FileText, Search, Eye, X, AlertCircle, CheckCircle2,
  ChevronLeft, ChevronRight, ChevronDown,
  IndianRupee, Printer, MessageCircle, Plus, Trash2,
  CreditCard, Banknote, Smartphone, Circle, User, Phone, Car,
} from 'lucide-react';
import '../styles/InvoicesPage.css';
import { getRoundingFunction } from '../lib/math.js';
// Fix #30: Car is now imported from lucide-react; the local Car SVG shim below is removed

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtINR(v) { return `₹${Number(v || 0).toLocaleString('en-IN')}` ; }

const METHOD_META = {
  cash:  { label: 'Cash',  Icon: Banknote,    color: '#16a34a', bg: '#dcfce7' },
  upi:   { label: 'UPI',   Icon: Smartphone,  color: '#7c3aed', bg: '#ede9fe' },
  card:  { label: 'Card',  Icon: CreditCard,  color: '#0891b2', bg: '#cffafe' },
  app_payment: { label: 'In-App Payment', Icon: Smartphone, color: '#c2410c', bg: '#fff7ed' },
  other: { label: 'Other', Icon: Circle,      color: '#6b7280', bg: '#f3f4f6' },
};

// ── Status inline selector ────────────────────────────────────────────────────
function InvStatusSelect({ invId, current, statusList, onChange }) {
  const canEdit = useCan('EDIT_INVOICE');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos,  setPos]  = useState({ top: 0, left: 0, width: 0 });
  const btnRef  = useRef(null);
  const dropRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function close(e) {
      if (dropRef.current && !dropRef.current.contains(e.target) &&
          btnRef.current  && !btnRef.current.contains(e.target)) setOpen(false);
    }
    // Fix #26: close on scroll so fixed dropdown doesn't drift from its button
    function closeOnScroll() { setOpen(false); }
    document.addEventListener('mousedown', close);
    document.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [open]);

  function openDrop() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 180) });
    setOpen(o => !o);
  }

  async function pick(s) {
    setOpen(false);
    if (s.id === current?.id) return;
    setBusy(true);
    try {
      const r = await api(`/api/invoices/${invId}`, { method: 'PATCH', body: { status_id: s.id } });
      onChange(r.item);
    } catch (e) { console.error('[InvStatus]', e.message); }
    finally { setBusy(false); }
  }

  const cfg = current || { name: 'Unknown', color: '#6b7280', bg_color: '#f3f4f6' };

  return (
    <>
      <button ref={btnRef} className="inv-status-btn"
        style={{ background: cfg.bg_color, color: cfg.color, opacity: (busy || !canEdit) ? .6 : 1, cursor: canEdit ? 'pointer' : 'default' }}
        onClick={canEdit ? openDrop : undefined} disabled={busy || !canEdit}>
        {busy ? '…' : cfg.name || '—'}<ChevronDown size={10}/>
      </button>
      {open && (
        <div ref={dropRef} className="inv-status-drop"
          style={{ top: pos.top, left: pos.left, minWidth: pos.width }}>
          {statusList.map(s => (
            <div key={s.id}
              className={`inv-status-opt${s.id === current?.id ? ' inv-status-opt--active' : ''}`}
              onClick={() => pick(s)}>
              <span className="inv-status-dot" style={{ background: s.color }}/>{s.name}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Print Invoice (browser print) ─────────────────────────────────────────────
function printInvoice(inv) {
  const roundFn = getRoundingFunction(inv.created_at);
  const lines = (inv.services || []).map(s => `
    <tr>
      <td>${s.service_name || s.description || '—'}${s.category_name ? `<br/><small>${s.category_name}</small>` : ''}</td>
      <td style="text-align:center">${Number(s.qty)}</td>
      <td style="text-align:right">₹${Number(s.unit_price).toLocaleString('en-IN')}</td>
      <td style="text-align:right">₹${Number(s.total_price).toLocaleString('en-IN')}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>Invoice #${inv.id} — Spinoto</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; background: #fff; padding: 40px; font-size: 14px; }
  .hdr { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
  .brand { font-size: 26px; font-weight: 800; color: #0891b2; letter-spacing: -1px; }
  .brand-sub { font-size: 12px; color: #6b7280; margin-top: 2px; }
  .inv-no { text-align: right; }
  .inv-no h2 { font-size: 20px; font-weight: 800; color: #111; }
  .inv-no p { font-size: 12px; color: #6b7280; margin-top: 3px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 28px; padding: 20px; background: #f8fafc; border-radius: 8px; }
  .info-block h4 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: #9ca3af; margin-bottom: 6px; }
  .info-block p { font-size: 14px; font-weight: 500; color: #111; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
  th { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: #6b7280; padding: 10px 14px; background: #f3f4f6; text-align: left; }
  td { padding: 11px 14px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #111; vertical-align: top; }
  td small { font-size: 11px; color: #6b7280; }
  .totals { margin-top: 0; }
  .totals tr td { border-bottom: none; }
  .totals .sub { color: #6b7280; font-size: 13px; }
  .totals .disc { color: #dc2626; }
  .totals .gst  { color: #0891b2; }
  .totals .grand { font-weight: 800; font-size: 16px; background: #f0fdf4; }
  .totals .paid-row td { color: #16a34a; font-weight: 600; }
  .totals .outstanding-row td { color: #dc2626; font-weight: 700; font-size: 15px; }
  .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; text-align: center; }
  @media print { body { padding: 20px; } }
</style>
</head><body>
<div class="hdr">
  <div><div class="brand">Spinoto</div><div class="brand-sub">Auto Care Management</div></div>
  <div class="inv-no"><h2>INVOICE #${inv.id}</h2><p>${fmtDate(inv.created_at)}</p>${inv.appointment_id ? `<p style="margin-top:3px;color:#0891b2;font-weight:600">Appointment #${inv.appointment_id}</p>` : ''}</div>
</div>
<div class="info-grid">
  <div class="info-block">
    <h4>Bill To</h4>
    <p><strong>${inv.customer_name || '—'}</strong><br/>${inv.mobile}${inv.vehicle_number ? `<br/>Vehicle: ${inv.vehicle_number}` : ''}</p>
  </div>
  <div class="info-block">
    <h4>Hub</h4>
    <p>${inv.hub_name || '—'}</p>
    ${inv.notes ? `<h4 style="margin-top:12px">Notes</h4><p>${inv.notes}</p>` : ''}
  </div>
</div>
<table>
  <thead><tr><th>Service</th><th style="text-align:center;width:60px">Qty</th><th style="text-align:right;width:110px">Unit Price</th><th style="text-align:right;width:110px">Amount</th></tr></thead>
  <tbody>${lines}</tbody>
</table>
<table class="totals">
  <tbody>
    <tr class="sub"><td colspan="3" style="text-align:right;border-top:1px solid #e5e7eb;padding-top:10px">Subtotal</td><td style="text-align:right;border-top:1px solid #e5e7eb;padding-top:10px">${fmtINR(inv.subtotal)}</td></tr>
    ${Number(inv.discount) > 0 ? `<tr class="disc"><td colspan="3" style="text-align:right">Discount${inv.discount_type === 'percent' ? ` (${parseFloat((Number(inv.discount)/Number(inv.subtotal)*100).toFixed(2))}%)` : ''}</td><td style="text-align:right">- ${fmtINR(inv.discount)}</td></tr>` : ''}
    ${Number(inv.gst_rate) > 0 ? `<tr class="gst"><td colspan="3" style="text-align:right">GST (${Number(inv.gst_rate)}%)</td><td style="text-align:right">+ ${fmtINR(roundFn(Math.max(0,Number(inv.subtotal)-Number(inv.discount))*Number(inv.gst_rate)/100))}</td></tr>` : ''}
    <tr class="grand"><td colspan="3" style="text-align:right">Total</td><td style="text-align:right">${fmtINR(inv.total)}</td></tr>
    <tr class="paid-row"><td colspan="3" style="text-align:right">Amount Paid</td><td style="text-align:right">${fmtINR(inv.amount_paid)}</td></tr>
    ${Number(inv.outstanding) > 0 ? `<tr class="outstanding-row"><td colspan="3" style="text-align:right">Outstanding</td><td style="text-align:right">${fmtINR(inv.outstanding)}</td></tr>` : ''}
  </tbody>
</table>
<div class="footer">Thank you for choosing Spinoto! For queries call ${inv.mobile}</div>
</body></html>`;

  const w = window.open('', '_blank', 'width=800,height=900');
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 400);
}

// ── WhatsApp share ────────────────────────────────────────────────────────────
function whatsappShare(inv) {
  const roundFn = getRoundingFunction(inv.created_at);
  const outstanding = Number(inv.outstanding || 0);
  const paid        = Number(inv.amount_paid || 0);
  const lines = (inv.services || [])
    .map(s => `  • ${s.service_name || s.description} — ${fmtINR(s.total_price)}`)
    .join('\n');

  const msg = [
    `🧾 *Invoice #${inv.id} — Spinoto*`,
    `📅 ${fmtDate(inv.created_at)}`,
    ``,
    `👤 ${inv.customer_name || inv.mobile}`,
    inv.vehicle_number ? `🚗 ${inv.vehicle_number}` : null,
    inv.hub_name ? `📍 ${inv.hub_name}` : null,
    ``,
    `*Services:*`,
    lines,
    ``,
    Number(inv.discount) > 0 ? `💰 Subtotal: ${fmtINR(inv.subtotal)}` : null,
    // Fix #25: show precise percent by computing from stored amounts
    Number(inv.discount) > 0 ? `🏷️ Discount${inv.discount_type === 'percent' ? ` (${parseFloat((Number(inv.discount)/Number(inv.subtotal)*100).toFixed(2))}%)` : ''}: - ${fmtINR(inv.discount)}` : null,
    Number(inv.gst_rate) > 0 ? `🧾 GST (${Number(inv.gst_rate)}%): + ${fmtINR(roundFn(Math.max(0,Number(inv.subtotal)-Number(inv.discount))*Number(inv.gst_rate)/100))}` : null,
    `✅ *Total: ${fmtINR(inv.total)}*`,
    paid > 0 ? `💳 Paid: ${fmtINR(paid)}` : null,
    outstanding > 0 ? `⚠️ *Outstanding: ${fmtINR(outstanding)}*` : `✅ Fully Paid`,
    ``,
    `Thank you for choosing Spinoto! 🙏`,
  ].filter(Boolean).join('\n');

  const phone = inv.mobile?.replace(/\D/g, '');
  window.open(`https://wa.me/${phone ? '91' + phone : ''}?text=${encodeURIComponent(msg)}`, '_blank');
}

// ── Payment Modal ─────────────────────────────────────────────────────────────
function PaymentModal({ inv, onClose, onUpdated }) {
  const canPayment = useCan('ADD_INVOICE_PAYMENT', 'EDIT_INVOICE');
  const [payments,  setPayments]  = useState([]);
  const [invData,   setInvData]   = useState(inv);
  const [loading,   setLoading]   = useState(true);
  const [form,      setForm]      = useState({ amount: '', method: 'cash', reference_no: '', notes: '' });
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState(null);
  const [err,       setErr]       = useState('');

  useEffect(() => {
    api(`/api/invoices/${inv.id}/payments`)
      .then(r => { setPayments(r.items || []); setInvData(r.invoice || inv); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [inv.id]);

  async function addPayment(e) {
    e.preventDefault();
    if (!form.amount || Number(form.amount) <= 0) { setErr('Enter a valid amount'); return; }
    setSaving(true); setErr('');
    try {
      const r = await api(`/api/invoices/${inv.id}/payments`, {
        method: 'POST',
        body: { amount: Number(form.amount), method: form.method, reference_no: form.reference_no || null, notes: form.notes || null },
      });
      setPayments(prev => [r.payment, ...prev]);
      setInvData(r.invoice);
      setForm({ amount: '', method: 'cash', reference_no: '', notes: '' });
      onUpdated({ ...inv, amount_paid: r.invoice.amount_paid, outstanding: r.invoice.outstanding });
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function delPayment(payId) {
    setDeleting(payId);
    try {
      const r = await api(`/api/invoices/${inv.id}/payments/${payId}`, { method: 'DELETE' });
      setPayments(prev => prev.filter(p => p.id !== payId));
      setInvData(r.invoice);
      onUpdated({ ...inv, amount_paid: r.invoice.amount_paid, outstanding: r.invoice.outstanding });
    } catch (e) { setErr(e.message); }
    finally { setDeleting(null); }
  }

  const outstanding = Number(invData.outstanding || 0);
  const paid        = Number(invData.amount_paid  || 0);
  const total       = Number(invData.total || inv.total || 0);
  const paidPct     = total > 0 ? Math.min(100, Math.round(paid / total * 100)) : 0;

  return (
    <div className="inv-backdrop" onClick={onClose}>
      <div className="inv-pay-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="invv-hdr">
          <div className="invv-hdr-icon" style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)' }}>
            <IndianRupee size={18}/>
          </div>
          <div className="invv-hdr-body">
            <div className="invv-hdr-title">Payments — Invoice #{inv.id}</div>
            <div className="invv-hdr-sub">{inv.customer_name || inv.mobile}</div>
          </div>
          <button className="inv-icon-btn" onClick={onClose}><X size={16}/></button>
        </div>

        <div className="invv-body">
          {/* Balance summary */}
          <div className="pay-summary">
            <div className="pay-sum-row">
              <span className="pay-sum-lbl">Invoice Total</span>
              <span className="pay-sum-val">{fmtINR(total)}</span>
            </div>
            <div className="pay-progress-bar">
              <div className="pay-progress-fill" style={{ width: `${paidPct}%` }}/>
            </div>
            <div className="pay-sum-row" style={{ marginTop: 8 }}>
              <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>
                Paid {fmtINR(paid)} ({paidPct}%)
              </span>
              <span style={{ fontSize: 12, color: outstanding > 0 ? '#dc2626' : '#16a34a', fontWeight: 700 }}>
                {outstanding > 0 ? `Outstanding ${fmtINR(outstanding)}` : '✓ Fully Paid'}
              </span>
            </div>
          </div>

          {/* Add payment form */}
          {canPayment && outstanding > 0 && (
            <form className="pay-form" onSubmit={addPayment}>
              <div className="pay-form-title">Record Payment</div>
              {err && <div className="pay-err"><AlertCircle size={12}/> {err}</div>}
              <div className="pay-form-row">
                <div className="pay-field">
                  <label className="pay-lbl">Amount (₹) *</label>
                  <input type="number" min="1" max={outstanding} step="0.01" className="pay-input"
                    placeholder={`Max ${fmtINR(outstanding)}`}
                    value={form.amount}
                    onChange={e => { setForm(f => ({ ...f, amount: e.target.value })); setErr(''); }}/>
                </div>
                <div className="pay-field">
                  <label className="pay-lbl">Method</label>
                  <select className="pay-input" value={form.method}
                    onChange={e => setForm(f => ({ ...f, method: e.target.value }))}>
                    <option value="cash">Cash</option>
                    <option value="upi">UPI</option>
                    <option value="card">Card</option>
                    <option value="app_payment">In-App Payment</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div className="pay-field">
                <label className="pay-lbl">Reference No. (UPI ID / last 4 digits)</label>
                <input className="pay-input" placeholder="Optional"
                  value={form.reference_no}
                  onChange={e => setForm(f => ({ ...f, reference_no: e.target.value }))}/>
              </div>
              <button type="submit" className="pay-add-btn" disabled={saving}>
                <Plus size={14}/> {saving ? 'Recording…' : 'Record Payment'}
              </button>
            </form>
          )}
          {outstanding <= 0 && !loading && (
            <div className="pay-paid-banner">
              <CheckCircle2 size={16}/> Invoice is fully paid
            </div>
          )}

          {/* Payment history */}
          <div className="pay-history">
            <div className="pay-history-title">Payment History</div>
            {loading ? (
              <div className="pay-loading">Loading…</div>
            ) : payments.length === 0 ? (
              <div className="pay-empty">No payments recorded yet.</div>
            ) : payments.map(p => {
              const m = METHOD_META[p.method] || METHOD_META.other;
              return (
                <div key={p.id} className="pay-record">
                  <div className="pay-record-icon" style={{ background: m.bg, color: m.color }}>
                    <m.Icon size={14}/>
                  </div>
                  <div className="pay-record-body">
                    <div className="pay-record-top">
                      <span className="pay-record-amt">{fmtINR(p.amount)}</span>
                      <span className="pay-record-method" style={{ background: m.bg, color: m.color }}>{m.label}</span>
                    </div>
                    {p.reference_no && <div className="pay-record-ref">Ref: {p.reference_no}</div>}
                    <div className="pay-record-meta">
                      {fmtDateTime(p.paid_at)}
                      {p.created_by_name && <> · {p.created_by_name}</>}
                    </div>
                    {p.notes && <div className="pay-record-note">{p.notes}</div>}
                  </div>
                  {canPayment && (
                    <button className="pay-del-btn"
                      title="Delete payment"
                      disabled={deleting === p.id}
                      onClick={() => delPayment(p.id)}>
                      {deleting === p.id ? '…' : <Trash2 size={13}/>}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="invv-ftr">
          <button className="button secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── View Modal ────────────────────────────────────────────────────────────────
function InvoiceViewModal({ inv, statusList, onClose, onUpdated, onOpenPayments }) {
  const status = statusList.find(s => s.id === inv.status_id);
  const roundFn = getRoundingFunction(inv.created_at);
  const outstanding = Number(inv.outstanding || 0);
  const paid        = Number(inv.amount_paid  || 0);

  return (
    <div className="inv-backdrop" onClick={onClose}>
      <div className="inv-view-modal" onClick={e => e.stopPropagation()}>

        <div className="invv-hdr">
          <div className="invv-hdr-icon"><FileText size={18}/></div>
          <div className="invv-hdr-body">
            <div className="invv-hdr-title">Invoice #{inv.id}</div>
            {inv.appointment_id && <div className="invv-hdr-sub">Appointment #{inv.appointment_id}</div>}
          </div>
          {status && (
            <span className="invv-status-badge" style={{ background: status.bg_color, color: status.color }}>
              {status.name}
            </span>
          )}
          <button className="inv-icon-btn" onClick={onClose}><X size={16}/></button>
        </div>

        <div className="invv-body">
          {/* Customer */}
          <div className="invv-section">
            <div className="invv-section-title">Customer</div>
            <div className="invv-grid2">
              <div className="invv-field"><span className="invv-lbl">Name</span><span className="invv-val">{inv.customer_name || '—'}</span></div>
              <div className="invv-field"><span className="invv-lbl">Mobile</span><span className="invv-val">{inv.mobile}</span></div>
              {inv.vehicle_number && <div className="invv-field"><span className="invv-lbl">Vehicle No.</span><span className="invv-val">{inv.vehicle_number}</span></div>}
              {inv.hub_name && <div className="invv-field"><span className="invv-lbl">Hub</span><span className="invv-val">{inv.hub_name}</span></div>}
            </div>
          </div>

          {/* Line items */}
          <div className="invv-section">
            <div className="invv-section-title">Services</div>
            <div className="invv-lines">
              <div className="invv-line-hdr">
                <span style={{ flex: 1 }}>Service</span>
                <span style={{ width: 50, textAlign: 'center' }}>Qty</span>
                <span style={{ width: 90, textAlign: 'right' }}>Unit</span>
                <span style={{ width: 90, textAlign: 'right' }}>Total</span>
              </div>
              {inv.services?.map(s => (
                <div key={s.id} className="invv-line-row">
                  <div style={{ flex: 1 }}>
                    <div className="invv-svc-name">{s.service_name || s.description || '—'}</div>
                    {s.category_name && <div className="invv-svc-cat">{s.category_name}</div>}
                  </div>
                  <span style={{ width: 50, textAlign: 'center', fontSize: 13 }}>{Number(s.qty)}</span>
                  <span style={{ width: 90, textAlign: 'right', fontSize: 13 }}>{fmtINR(s.unit_price)}</span>
                  <span style={{ width: 90, textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmtINR(s.total_price)}</span>
                </div>
              ))}
              <div className="invv-subtotal-row"><span>Subtotal</span><span>{fmtINR(inv.subtotal)}</span></div>
              {Number(inv.discount) > 0 && (
                <div className="invv-discount-row">
                  <span>Discount{inv.discount_type === 'percent' ? (() => { const pct = Math.round(Number(inv.discount) / Number(inv.subtotal) * 100); return pct > 0 ? ` (${pct}%)` : ''; })() : ''}</span>
                  <span>- {fmtINR(inv.discount)}</span>
                </div>
              )}
              {Number(inv.gst_rate) > 0 && (
                <div className="invv-gst-row">
                  <span>GST ({Number(inv.gst_rate)}%)</span>
                  <span>+ {fmtINR(roundFn(Math.max(0, Number(inv.subtotal) - Number(inv.discount)) * Number(inv.gst_rate) / 100))}</span>
                </div>
              )}
              <div className="invv-total-row"><span>Total</span><span>{fmtINR(inv.total)}</span></div>
              {paid > 0 && <div className="invv-paid-row"><span>Paid</span><span>{fmtINR(paid)}</span></div>}
              {outstanding > 0 && <div className="invv-outstanding-row"><span>Outstanding</span><span>{fmtINR(outstanding)}</span></div>}
            </div>
          </div>

          {inv.notes && (
            <div className="invv-section">
              <div className="invv-section-title">Notes</div>
              <p className="invv-notes">{inv.notes}</p>
            </div>
          )}
          <div className="invv-meta">
            Created {fmtDate(inv.created_at)}{inv.created_by_name && <> · {inv.created_by_name}</>}
          </div>
        </div>

        <div className="invv-ftr">
          <button className="inv-action-btn inv-action-btn--ghost" onClick={onClose}>Close</button>
          <button className="inv-action-btn inv-action-btn--green" onClick={onOpenPayments}>
            <IndianRupee size={14}/> Payments
            {outstanding > 0 && <span className="inv-pay-badge">{fmtINR(outstanding)}</span>}
          </button>
          <button className="inv-action-btn inv-action-btn--wa" onClick={() => whatsappShare(inv)}>
            <MessageCircle size={14}/> WhatsApp
          </button>
          <button className="inv-action-btn inv-action-btn--print" onClick={() => printInvoice(inv)}>
            <Printer size={14}/> Print
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Customer Picker ───────────────────────────────────────────────────────────
const AVATAR_COLORS_INV = [
  { bg: '#ede9fe', color: '#6d28d9' }, { bg: '#dbeafe', color: '#1d4ed8' },
  { bg: '#dcfce7', color: '#15803d' }, { bg: '#ffedd5', color: '#c2410c' },
  { bg: '#fce7f3', color: '#be185d' }, { bg: '#cffafe', color: '#0e7490' },
];
function avatarStyleInv(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS_INV[Math.abs(h) % AVATAR_COLORS_INV.length];
}

function CustomerPicker({ value, onChange, onAddNew }) {
  const [open,    setOpen]    = useState(false);
  const [q,       setQ]       = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);
  const timer = useRef(null);

  // Fix #19: return cleanup so the debounce timer is cleared when component unmounts
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setLoading(true);
      api(`/api/customers?search=${encodeURIComponent(q)}&limit=20`)
        .then(r => { setOptions(r.items || []); setLoading(false); })
        .catch(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer.current);
  }, [q]);

  useEffect(() => {
    function close(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  function select(c) {
    onChange(c);
    setQ('');
    setOpen(false);
  }

  const avs = value ? avatarStyleInv(value.customer_name || value.mobile) : null;
  const ini = value ? (value.customer_name || value.mobile || '?')[0].toUpperCase() : null;

  return (
    <div ref={ref} className="cpick-wrap">
      <div className={`cpick-box${open ? ' cpick-box--open' : ''}`} onClick={() => setOpen(v => !v)}>
        {value ? (
          <div className="cpick-selected">
            <div className="cpick-av" style={{ background: avs.bg, color: avs.color }}>{ini}</div>
            <div className="cpick-sel-info">
              <div className="cpick-sel-name">{value.customer_name || 'Unknown'}</div>
              <div className="cpick-sel-mobile">{value.mobile}</div>
            </div>
            <button className="cpick-clear" onClick={e => { e.stopPropagation(); onChange(null); setOpen(false); }}>
              <X size={12}/>
            </button>
          </div>
        ) : (
          <div className="cpick-placeholder"><User size={13}/> Search customer…</div>
        )}
        <ChevronDown size={13} className={`cpick-chevron${open ? ' cpick-chevron--up' : ''}`}/>
      </div>
      {open && (
        <div className="cpick-dropdown">
          <div className="cpick-search-row">
            <Search size={12} className="cpick-search-icon"/>
            <input
              className="cpick-search-input"
              placeholder="Type name or mobile…"
              value={q}
              onChange={e => setQ(e.target.value)}
              autoFocus
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div className="cpick-list">
            {loading && <div className="cpick-hint">Searching…</div>}
            {!loading && options.length === 0 && <div className="cpick-hint">No customers found</div>}
            {options.map(c => {
              const av = avatarStyleInv(c.customer_name || c.mobile);
              const in2 = (c.customer_name || c.mobile || '?')[0].toUpperCase();
              return (
                <div key={c.mobile} className="cpick-item" onClick={() => select(c)}>
                  <div className="cpick-av" style={{ background: av.bg, color: av.color }}>{in2}</div>
                  <div className="cpick-item-info">
                    <div className="cpick-item-name">{c.customer_name || 'Unknown'}</div>
                    <div className="cpick-item-mobile">{c.mobile}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <button className="cpick-add-new" onClick={() => { setOpen(false); onAddNew(); }}>
            <Plus size={13}/> Add New Customer
          </button>
        </div>
      )}
    </div>
  );
}

// ── Vehicle Picker ────────────────────────────────────────────────────────────
function VehiclePicker({ mobile, value, onChange, onAddNew }) {
  const [open,    setOpen]    = useState(false);
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!mobile) { setOptions([]); return; }
    setLoading(true);
    api(`/api/customers/${encodeURIComponent(mobile)}`)
      .then(r => { setOptions(r.item?.vehicles || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [mobile]);

  useEffect(() => {
    function close(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  function select(v) { onChange(v); setOpen(false); }

  return (
    <div ref={ref} className="cpick-wrap">
      <div
        className={`cpick-box${open && mobile ? ' cpick-box--open' : ''}${!mobile ? ' cpick-box--disabled' : ''}`}
        onClick={() => { if (mobile) setOpen(v => !v); }}
      >
        {value ? (
          <div className="cpick-selected">
            <Car size={13} style={{ flexShrink: 0, color: '#0891b2' }}/>
            <div className="cpick-sel-info">
              <div className="cpick-sel-name">{value.vehicle_number}</div>
              <div className="cpick-sel-mobile">{[value.make_name, value.model_name].filter(Boolean).join(' ') || '—'}</div>
            </div>
            <button className="cpick-clear" onClick={e => { e.stopPropagation(); onChange(null); }}>
              <X size={12}/>
            </button>
          </div>
        ) : (
          <div className="cpick-placeholder"><Car size={13}/> {mobile ? 'Select vehicle…' : 'Select customer first'}</div>
        )}
        {mobile && <ChevronDown size={13} className={`cpick-chevron${open ? ' cpick-chevron--up' : ''}`}/>}
      </div>
      {open && mobile && (
        <div className="cpick-dropdown">
          <div className="cpick-list">
            {loading && <div className="cpick-hint">Loading vehicles…</div>}
            {!loading && options.length === 0 && <div className="cpick-hint">No vehicles on record</div>}
            {options.map((v, i) => (
              <div key={v.cv_id || i} className="cpick-item" onClick={() => select(v)}>
                <Car size={14} style={{ flexShrink: 0, color: '#0891b2' }}/>
                <div className="cpick-item-info">
                  <div className="cpick-item-name" style={{ fontFamily: 'monospace' }}>{v.vehicle_number}</div>
                  <div className="cpick-item-mobile">
                    {[v.make_name, v.model_name].filter(Boolean).join(' ') || '—'}
                    {v.visit_count > 0 ? ` · ${v.visit_count} visit${v.visit_count !== 1 ? 's' : ''}` : ''}
                  </div>
                </div>
                {v.source === 'manual' && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#fef3c7', color: '#92400e' }}>manual</span>}
              </div>
            ))}
          </div>
          <button className="cpick-add-new" onClick={() => { setOpen(false); onAddNew(); }}>
            <Plus size={13}/> Add New Vehicle
          </button>
        </div>
      )}
    </div>
  );
}

// ── Searchable Select ─────────────────────────────────────────────────────────
// Generic reusable searchable dropdown (replaces <select> where search is needed)
function SearchableSelect({ value, onChange, options, placeholder = 'Select…', disabled = false,
  getLabel = o => o.label, getValue = o => String(o.value) }) {
  const [open, setOpen] = useState(false);
  const [q,    setQ]    = useState('');
  const ref  = useRef(null);
  const inpRef = useRef(null);

  useEffect(() => {
    function close(e) { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQ(''); } }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => { if (open && inpRef.current) inpRef.current.focus(); }, [open]);

  const filtered = q
    ? options.filter(o => getLabel(o).toLowerCase().includes(q.toLowerCase()))
    : options;
  const selected = options.find(o => String(getValue(o)) === String(value));

  function pick(o) { onChange(getValue(o)); setOpen(false); setQ(''); }

  return (
    <div ref={ref} className="ss-wrap">
      <div
        className={`ss-box${open && !disabled ? ' ss-box--open' : ''}${disabled ? ' ss-box--disabled' : ''}`}
        onClick={() => { if (!disabled) setOpen(v => !v); }}
      >
        <span className={`ss-val${!selected ? ' ss-val--ph' : ''}`}>
          {selected ? getLabel(selected) : placeholder}
        </span>
        <ChevronDown size={12} className={`ss-chev${open ? ' ss-chev--up' : ''}`}/>
      </div>
      {open && !disabled && (
        <div className="ss-dropdown">
          <div className="ss-search-row">
            <Search size={11} className="ss-search-icon"/>
            <input ref={inpRef} className="ss-search-input" placeholder="Search…"
              value={q} onChange={e => setQ(e.target.value)}
              onClick={e => e.stopPropagation()}/>
            {q && (
              <button className="ss-clear-q" onClick={e => { e.stopPropagation(); setQ(''); }}>
                <X size={10}/>
              </button>
            )}
          </div>
          <div className="ss-list">
            {filtered.length === 0
              ? <div className="ss-empty">No results for "{q}"</div>
              : filtered.map(o => (
                <div key={getValue(o)}
                  className={`ss-item${String(getValue(o)) === String(value) ? ' ss-item--on' : ''}`}
                  onClick={() => pick(o)}>
                  {getLabel(o)}
                </div>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}

// Builds a display label for a model, appending segment/body-type for duplicates
function buildModelLabel(model, allModels, bodyTypes, segments) {
  const dupes = allModels.filter(m => m.name.toLowerCase() === model.name.toLowerCase());
  if (dupes.length <= 1) return model.name;
  const extras = [];
  if (model.segment_id) {
    const seg = segments.find(s => s.id === model.segment_id);
    if (seg) extras.push(seg.name);
  }
  if (model.body_type_id) {
    const bt = bodyTypes.find(b => b.id === model.body_type_id);
    if (bt) extras.push(bt.name);
  }
  if (model.engine_cc) extras.push(`${model.engine_cc}cc`);
  return extras.length ? `${model.name} — ${extras.join(' · ')}` : model.name;
}

// ── Create Customer Modal ─────────────────────────────────────────────────────
const SALUTATIONS = ['Mr', 'Mrs', 'Miss', 'Ms', 'Dr', 'Prof'];

function CreateCustomerModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    customer_type: 'Individual',
    salutation: 'Mr',
    first_name: '', last_name: '',
    mobile: '', whatsapp_same: true, whatsapp: '',
    alt_phone: '', email: '',
    state_id: '', city_id: '', area_id: '',
  });
  const [states,  setStates]  = useState([]);
  const [cities,  setCities]  = useState([]);
  const [areas,   setAreas]   = useState([]);
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  // Load states on mount
  useEffect(() => {
    api('/api/locations/states').then(r => setStates(r.items || [])).catch(() => {});
  }, []);

  // Load cities when state changes
  useEffect(() => {
    setCities([]); setAreas([]);
    setForm(f => ({ ...f, city_id: '', area_id: '' }));
    if (!form.state_id) return;
    api(`/api/locations/cities?state_id=${form.state_id}`)
      .then(r => setCities(r.items || [])).catch(() => {});
  }, [form.state_id]);

  // Load areas when city changes
  useEffect(() => {
    setAreas([]);
    setForm(f => ({ ...f, area_id: '' }));
    if (!form.city_id) return;
    api(`/api/locations/areas?city_id=${form.city_id}`)
      .then(r => setAreas(r.items || [])).catch(() => {});
  }, [form.city_id]);

  function setF(k, v) { setForm(f => ({ ...f, [k]: v })); }

  // Fix #1: pass ALL collected fields to onCreated so the parent invoice form can use them;
  // previously only {customer_name, mobile, whatsapp} were passed and everything else was lost.
  function handleSave() {
    if (!form.mobile.trim() || form.mobile.trim().length < 10) {
      setErr('Valid 10-digit mobile is required'); return;
    }
    if (!form.first_name.trim()) { setErr('First name is required'); return; }
    const customer_name = [form.salutation, form.first_name.trim(), form.last_name.trim()]
      .filter(Boolean).join(' ');
    const mobile   = form.mobile.trim().replace(/\D/g, '').slice(-10);
    const whatsapp = form.whatsapp_same ? mobile : (form.whatsapp.trim().replace(/\D/g, '').slice(-10) || mobile);
    onCreated({
      customer_name,
      mobile,
      whatsapp,
      alt_phone:     form.alt_phone  || null,
      email:         form.email      || null,
      customer_type: form.customer_type,
      state_id:      form.state_id   || null,
      city_id:       form.city_id    || null,
      area_id:       form.area_id    || null,
    });
    onClose();
  }

  return (
    <div className="ccust-backdrop" onClick={onClose}>
      <div className="ccust-modal" onClick={e => e.stopPropagation()}>
        <div className="ccust-hdr">
          <span className="ccust-title">Create Customer</span>
          <button className="inv-icon-btn" onClick={onClose}><X size={15}/></button>
        </div>

        <div className="ccust-body">
          {err && <div className="ccust-err">{err}</div>}

          {/* Type */}
          <div className="ccust-field ccust-field--full">
            <label>Customer type *</label>
            <select className="ccust-input" value={form.customer_type} onChange={e => setF('customer_type', e.target.value)}>
              <option>Individual</option>
              <option>Business</option>
            </select>
          </div>

          {/* Name row */}
          <div className="ccust-row ccust-row--3">
            <div className="ccust-field">
              <label>Salutation</label>
              <select className="ccust-input" value={form.salutation} onChange={e => setF('salutation', e.target.value)}>
                {SALUTATIONS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="ccust-field" style={{ gridColumn: 'span 2' }}>
              <label>First name *</label>
              <input className="ccust-input ccust-input--focus" placeholder="First name"
                value={form.first_name} onChange={e => setF('first_name', e.target.value)} autoFocus/>
            </div>
          </div>
          <div className="ccust-field ccust-field--full">
            <label>Last name</label>
            <input className="ccust-input" placeholder="Last name"
              value={form.last_name} onChange={e => setF('last_name', e.target.value)}/>
          </div>

          {/* Phone */}
          <div className="ccust-row">
            <div className="ccust-field">
              <label>Phone number *</label>
              <div className="ccust-phone-wrap">
                <span className="ccust-phone-prefix">+91</span>
                <input className="ccust-input ccust-input--phone" placeholder="10-digit"
                  maxLength={10} value={form.mobile}
                  onChange={e => setF('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))}/>
              </div>
            </div>
            <div className="ccust-field">
              <label>
                WhatsApp
                <label className="ccust-same-chk">
                  <input type="checkbox" checked={form.whatsapp_same}
                    onChange={e => setF('whatsapp_same', e.target.checked)}/>
                  Same as phone
                </label>
              </label>
              {form.whatsapp_same ? (
                <div className="ccust-input ccust-input--dimmed">{form.mobile ? `+91 ${form.mobile}` : '+91 ——'}</div>
              ) : (
                <div className="ccust-phone-wrap">
                  <span className="ccust-phone-prefix">+91</span>
                  <input className="ccust-input ccust-input--phone" placeholder="10-digit"
                    maxLength={10} value={form.whatsapp}
                    onChange={e => setF('whatsapp', e.target.value.replace(/\D/g, '').slice(0, 10))}/>
                </div>
              )}
            </div>
          </div>

          {/* Alt phone + email */}
          <div className="ccust-row">
            <div className="ccust-field">
              <label>Alternate Phone</label>
              <div className="ccust-phone-wrap">
                <span className="ccust-phone-prefix">+91</span>
                <input className="ccust-input ccust-input--phone" placeholder="Optional"
                  maxLength={10} value={form.alt_phone}
                  onChange={e => setF('alt_phone', e.target.value.replace(/\D/g, '').slice(0, 10))}/>
              </div>
            </div>
            <div className="ccust-field">
              <label>Email address</label>
              <input className="ccust-input" placeholder="example@email.com" type="email"
                value={form.email} onChange={e => setF('email', e.target.value)}/>
            </div>
          </div>

          {/* Address — fully driven by master data */}
          <div className="ccust-section-title">Address Information</div>
          <div className="ccust-row">
            <div className="ccust-field">
              <label>State</label>
              <select className="ccust-input" value={form.state_id}
                onChange={e => setF('state_id', e.target.value)}>
                <option value="">Select state</option>
                {states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="ccust-field">
              <label>City</label>
              <select className="ccust-input" value={form.city_id}
                onChange={e => setF('city_id', e.target.value)}
                disabled={!form.state_id || cities.length === 0}>
                <option value="">{form.state_id ? (cities.length ? 'Select city' : 'No cities found') : 'Select state first'}</option>
                {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div className="ccust-field ccust-field--full">
            <label>Area / Locality</label>
            <select className="ccust-input" value={form.area_id}
              onChange={e => setF('area_id', e.target.value)}
              disabled={!form.city_id || areas.length === 0}>
              <option value="">{form.city_id ? (areas.length ? 'Select area' : 'No areas found') : 'Select city first'}</option>
              {areas.map(a => (
                <option key={a.id} value={a.id}>{a.name}{a.pincode ? ` — ${a.pincode}` : ''}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="ccust-footer">
          <button className="inv-action-btn inv-action-btn--ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="inv-action-btn" style={{ background: '#0891b2', color: '#fff' }}
            onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create Vehicle Modal ──────────────────────────────────────────────────────
// Determine if a vehicle type is 2W by its name
const TW_KEYWORDS = ['two', '2w', 'bike', 'scoot', 'motor', 'moped'];
function is2W(typeName = '') {
  const n = typeName.toLowerCase();
  return TW_KEYWORDS.some(k => n.includes(k));
}

function CreateVehicleModal({ mobile, onClose, onCreated }) {
  const [form, setForm] = useState({
    vehicle_number: '', vehicle_type_id: '', make_id: '', model_id: '',
    color: '', year: '', notes: '',
  });
  const [types,     setTypes]     = useState([]);
  const [makes,     setMakes]     = useState([]);
  const [models,    setModels]    = useState([]);
  const [bodyTypes, setBodyTypes] = useState([]);
  const [segments,  setSegments]  = useState([]);
  const [saving,    setSaving]    = useState(false);
  const [err,       setErr]       = useState('');

  // Load types, body types, segments on mount
  useEffect(() => {
    api('/api/vehicles/types').then(r => setTypes(r.items || [])).catch(() => {});
    api('/api/vehicles/body-types').then(r => setBodyTypes(r.items || [])).catch(() => {});
    api('/api/vehicles/segments').then(r => setSegments(r.items || [])).catch(() => {});
  }, []);

  // When vehicle type changes → reload makes filtered by type_id, clear make+model
  useEffect(() => {
    setMakes([]); setModels([]);
    setForm(f => ({ ...f, make_id: '', model_id: '' }));
    if (!form.vehicle_type_id) return;
    api(`/api/vehicles/makes?type_id=${form.vehicle_type_id}`)
      .then(r => setMakes(r.items || [])).catch(() => {});
  }, [form.vehicle_type_id]);

  // When make changes → reload models filtered by make_id, clear model
  useEffect(() => {
    setModels([]);
    setForm(f => ({ ...f, model_id: '' }));
    if (!form.make_id) return;
    api(`/api/vehicles/models?make_id=${form.make_id}`)
      .then(r => setModels(r.items || [])).catch(() => {});
  }, [form.make_id]);

  function setF(k, v) { setForm(f => ({ ...f, [k]: v })); }

  // Derived info from selected model
  const selectedModel = models.find(m => String(m.id) === String(form.model_id)) || null;
  const selectedType  = types.find(t => String(t.id) === String(form.vehicle_type_id)) || null;
  const isTwoWheeler  = selectedType ? is2W(selectedType.name) : false;

  // Resolve body_type name and segment name from master lists
  const bodyTypeName = selectedModel?.body_type_id
    ? (bodyTypes.find(b => b.id === selectedModel.body_type_id)?.name || null)
    : null;
  const segmentName  = selectedModel?.segment_id
    ? (segments.find(s => s.id === selectedModel.segment_id)?.name || null)
    : null;
  const engineCC     = selectedModel?.engine_cc || null;

  async function handleSave() {
    if (!form.vehicle_number.trim()) { setErr('License plate number is required'); return; }
    setSaving(true); setErr('');
    try {
      // Fix #2: pass plain object — api() already calls JSON.stringify internally
      const r = await api(`/api/customers/${encodeURIComponent(mobile)}/vehicles`, {
        method: 'POST',
        body: {
          vehicle_number:  form.vehicle_number.trim().toUpperCase(),
          vehicle_type_id: form.vehicle_type_id || null,
          make_id:         form.make_id         || null,
          model_id:        form.model_id        || null,
          color:           form.color           || null,
          year:            form.year ? parseInt(form.year, 10) : null,
          notes:           form.notes           || null,
        },
      });
      onCreated(r.item);
    } catch (e) {
      setErr(e.message || 'Failed to save');
      setSaving(false);
    }
  }

  return (
    <div className="ccust-backdrop" onClick={onClose}>
      <div className="ccust-modal ccust-modal--veh" onClick={e => e.stopPropagation()}>
        <div className="ccust-hdr">
          <span className="ccust-title">Create Vehicle</span>
          <button className="inv-icon-btn" onClick={onClose}><X size={15}/></button>
        </div>

        <div className="ccust-body">
          {err && <div className="ccust-err">{err}</div>}

          {/* License plate — always first */}
          <div className="ccust-field ccust-field--full">
            <label>License Plate Number *</label>
            <input className="ccust-input" placeholder="e.g. GJ07BA9034" autoFocus
              value={form.vehicle_number}
              onChange={e => setF('vehicle_number', e.target.value.toUpperCase())}/>
          </div>

          {/* Vehicle Type — drives makes */}
          <div className="ccust-field ccust-field--full">
            <label>Vehicle Type</label>
            <select className="ccust-input" value={form.vehicle_type_id}
              onChange={e => setF('vehicle_type_id', e.target.value)}>
              <option value="">Select vehicle type</option>
              {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          {/* Make + Model — searchable, cascading */}
          <div className="ccust-row">
            <div className="ccust-field">
              <label>Make</label>
              <SearchableSelect
                value={form.make_id}
                onChange={v => setF('make_id', v)}
                options={makes}
                getLabel={m => m.name}
                getValue={m => String(m.id)}
                placeholder={form.vehicle_type_id ? (makes.length ? 'Search make…' : 'No makes found') : 'Select type first'}
                disabled={!form.vehicle_type_id || makes.length === 0}
              />
            </div>
            <div className="ccust-field">
              <label>Model</label>
              <SearchableSelect
                value={form.model_id}
                onChange={v => setF('model_id', v)}
                options={models}
                getLabel={m => buildModelLabel(m, models, bodyTypes, segments)}
                getValue={m => String(m.id)}
                placeholder={form.make_id ? (models.length ? 'Search model…' : 'No models found') : 'Select make first'}
                disabled={!form.make_id || models.length === 0}
              />
            </div>
          </div>

          {/* Auto-filled model details — shown only when a model is selected */}
          {selectedModel && (
            <div className="cveh-autoinfo">
              {/* 4W: Body Type + Segment */}
              {!isTwoWheeler && (
                <>
                  <div className="cveh-autoinfo-item">
                    <span className="cveh-autoinfo-lbl">Body Type</span>
                    <span className="cveh-autoinfo-val">{bodyTypeName || '—'}</span>
                  </div>
                  <div className="cveh-autoinfo-item">
                    <span className="cveh-autoinfo-lbl">Segment</span>
                    <span className="cveh-autoinfo-val">{segmentName || '—'}</span>
                  </div>
                </>
              )}
              {/* 2W: Engine CC + Category/Segment */}
              {isTwoWheeler && (
                <>
                  <div className="cveh-autoinfo-item">
                    <span className="cveh-autoinfo-lbl">Engine CC</span>
                    <span className="cveh-autoinfo-val">{engineCC ? `${engineCC} cc` : '—'}</span>
                  </div>
                  <div className="cveh-autoinfo-item">
                    <span className="cveh-autoinfo-lbl">Category</span>
                    <span className="cveh-autoinfo-val">{segmentName || '—'}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Year + Color (always manual) */}
          <div className="ccust-row">
            <div className="ccust-field">
              <label>Year</label>
              <input className="ccust-input" type="number" placeholder="e.g. 2022"
                min="1990" max={new Date().getFullYear() + 1}
                value={form.year} onChange={e => setF('year', e.target.value)}/>
            </div>
            <div className="ccust-field">
              <label>Color</label>
              <input className="ccust-input" placeholder="e.g. White"
                value={form.color} onChange={e => setF('color', e.target.value)}/>
            </div>
          </div>

          {/* Notes */}
          <div className="ccust-field ccust-field--full">
            <label>Note</label>
            <textarea className="ccust-input ccust-textarea" rows={2}
              placeholder="Any notes about this vehicle…"
              value={form.notes} onChange={e => setF('notes', e.target.value)}/>
          </div>
        </div>

        <div className="ccust-footer">
          <button className="inv-action-btn inv-action-btn--ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="inv-action-btn" style={{ background: '#0891b2', color: '#fff' }}
            onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Manual Invoice Modal ──────────────────────────────────────────────────────
function ManualInvoiceModal({ statusList, hubs, onClose, onCreated }) {
  const [allServices,      setAllServices]      = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);  // full customer object
  const [selectedVehicle,  setSelectedVehicle]  = useState(null);  // vehicle object
  const [showNewCust,      setShowNewCust]      = useState(false);
  const [showNewVeh,       setShowNewVeh]       = useState(false);
  const [form, setForm] = useState({
    hub_id: '', notes: '',
    discount: '0', discount_type: 'flat', gst_rate: '0',
  });
  const [lines, setLines] = useState([{ desc: '', qty: '1', unit_price: '' }]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/api/services/services?limit=500').then(r => setAllServices(r.items || [])).catch(() => {});
  }, []);

  // When customer changes, clear vehicle selection
  useEffect(() => { setSelectedVehicle(null); }, [selectedCustomer]);

  function setF(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function setLine(i, k, v) { setLines(ls => ls.map((l, idx) => idx === i ? { ...l, [k]: v } : l)); }
  function addLine() { setLines(ls => [...ls, { desc: '', qty: '1', unit_price: '' }]); }
  function removeLine(i) { setLines(ls => ls.filter((_, idx) => idx !== i)); }

  const subtotal    = lines.reduce((s, l) => s + (Number(l.unit_price) || 0) * (Number(l.qty) || 1), 0);
  const r2          = getRoundingFunction(form?.created_at || new Date());
  const discountAmt = form.discount_type === 'percent'
    ? r2(subtotal * (Number(form.discount) || 0) / 100)
    : Number(form.discount) || 0;
  const afterDisc   = Math.max(0, subtotal - discountAmt);
  const gstAmt      = r2(afterDisc * (Number(form.gst_rate) || 0) / 100);
  const total       = afterDisc + gstAmt;

  async function handleSubmit(e) {
    e?.preventDefault();
    if (!selectedCustomer?.mobile) { setErr('Please select a customer'); return; }
    if (lines.every(l => !l.unit_price)) { setErr('Add at least one service with a price'); return; }
    setSaving(true); setErr('');
    try {
      const r = await api('/api/invoices', {
        method: 'POST',
        body: {
          customer_name:  selectedCustomer.customer_name || null,
          mobile:         selectedCustomer.mobile,
          vehicle_number: selectedVehicle?.vehicle_number?.trim() || null,
          hub_id:         Number(form.hub_id) || null,
          notes:          form.notes.trim() || null,
          discount:       Number(form.discount) || 0,
          discount_type:  form.discount_type,
          gst_rate:       Number(form.gst_rate) || 0,
          // Fix #28: filter only truly blank lines (unit_price === ''), not price-0 lines
          services: lines.filter(l => l.unit_price !== '').map(l => ({
            description: l.desc || null,
            qty: Number(l.qty) || 1,
            unit_price: Number(l.unit_price),
          })),
        },
      });
      onCreated(r.item);
      onClose();
    } catch (e) { setErr(e.message); setSaving(false); }
  }

  return (
    <>
    <div className="inv-backdrop" onClick={onClose}>
      <div className="inv-view-modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
        <div className="invv-hdr">
          <div className="invv-hdr-icon" style={{ background: 'linear-gradient(135deg,#0891b2,#0e7490)' }}><FileText size={18}/></div>
          <div className="invv-hdr-body">
            <div className="invv-hdr-title">New Invoice</div>
            <div className="invv-hdr-sub">Create a manual invoice without an appointment</div>
          </div>
          <button className="inv-icon-btn" onClick={onClose}><X size={16}/></button>
        </div>
        <form className="invv-body" onSubmit={handleSubmit} style={{ padding: '0 0 8px' }}>
          {err && <div style={{ margin: '12px 20px 0', padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, color: '#dc2626' }}>{err}</div>}

          {/* Customer + Vehicle */}
          <div className="invv-section">
            <div className="invv-section-title">Customer & Vehicle</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div className="invv-lbl" style={{ marginBottom: 6 }}>Customer <span style={{ color: '#dc2626' }}>*</span></div>
                <CustomerPicker
                  value={selectedCustomer}
                  onChange={setSelectedCustomer}
                  onAddNew={() => setShowNewCust(true)}
                />
              </div>
              <div>
                <div className="invv-lbl" style={{ marginBottom: 6 }}>Vehicle</div>
                <VehiclePicker
                  mobile={selectedCustomer?.mobile}
                  value={selectedVehicle}
                  onChange={setSelectedVehicle}
                  onAddNew={() => setShowNewVeh(true)}
                />
              </div>
            </div>
            {/* Hub */}
            <div style={{ marginTop: 10 }}>
              <div className="invv-lbl" style={{ marginBottom: 4 }}>Hub</div>
              <select className="pay-input" value={form.hub_id} onChange={e => setF('hub_id', e.target.value)}>
                <option value="">Select hub…</option>
                {hubs.map(h => <option key={h.id} value={h.id}>{h.hub_name}</option>)}
              </select>
            </div>
          </div>

          {/* Line items */}
          <div className="invv-section">
            <div className="invv-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Services</span>
              <button type="button" onClick={addLine}
                style={{ fontSize: 11, fontWeight: 700, color: '#0891b2', background: 'none', border: 'none', cursor: 'pointer' }}>
                + Add Line
              </button>
            </div>
            {lines.map((l, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 100px 28px', gap: 6, marginBottom: 8 }}>
                <input className="pay-input" placeholder="Description / service name"
                  value={l.desc} onChange={e => setLine(i, 'desc', e.target.value)} />
                <input className="pay-input" type="number" min="1" placeholder="Qty"
                  value={l.qty} onChange={e => setLine(i, 'qty', e.target.value)} />
                <input className="pay-input" type="number" min="0" step="0.01" placeholder="₹ Price"
                  value={l.unit_price} onChange={e => setLine(i, 'unit_price', e.target.value)} />
                <button type="button" onClick={() => removeLine(i)} disabled={lines.length === 1}
                  style={{ background: 'none', border: 'none', cursor: lines.length > 1 ? 'pointer' : 'default', color: '#dc2626', opacity: lines.length > 1 ? 1 : 0.3, padding: 0, display: 'flex', alignItems: 'center' }}>
                  <Trash2 size={14}/>
                </button>
              </div>
            ))}
          </div>

          {/* Discount + GST */}
          <div className="invv-section">
            <div className="invv-section-title">Pricing</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div>
                <div className="invv-lbl" style={{ marginBottom: 4 }}>Discount Type</div>
                <select className="pay-input" value={form.discount_type} onChange={e => setF('discount_type', e.target.value)}>
                  <option value="flat">Flat (₹)</option>
                  <option value="percent">Percent (%)</option>
                </select>
              </div>
              <div>
                <div className="invv-lbl" style={{ marginBottom: 4 }}>Discount {form.discount_type === 'percent' ? '%' : '₹'}</div>
                <input className="pay-input" type="number" min="0" max={form.discount_type === 'percent' ? 100 : undefined}
                  value={form.discount} onChange={e => setF('discount', e.target.value)} />
              </div>
              <div>
                <div className="invv-lbl" style={{ marginBottom: 4 }}>GST %</div>
                <input className="pay-input" type="number" min="0" max="100" placeholder="e.g. 18"
                  value={form.gst_rate} onChange={e => setF('gst_rate', e.target.value)} />
              </div>
            </div>

            {/* Live summary */}
            <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--bg-soft,#f8fafc)', borderRadius: 8, fontSize: 13 }}>
              {discountAmt > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', marginBottom: 4 }}><span>Subtotal</span><span>{fmtINR(subtotal)}</span></div>}
              {discountAmt > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: '#dc2626', marginBottom: 4 }}><span>Discount</span><span>- {fmtINR(discountAmt)}</span></div>}
              {gstAmt > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: '#0891b2', marginBottom: 4 }}><span>GST ({Number(form.gst_rate)}%)</span><span>+ {fmtINR(gstAmt)}</span></div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 15 }}><span>Total</span><span>{fmtINR(total)}</span></div>
            </div>
          </div>

          <div className="invv-section">
            <div className="invv-lbl" style={{ marginBottom: 4 }}>Notes</div>
            <textarea className="pay-input" rows={2} style={{ resize: 'vertical' }} placeholder="Optional notes…"
              value={form.notes} onChange={e => setF('notes', e.target.value)} />
          </div>
        </form>
        <div className="invv-ftr">
          <button className="inv-action-btn inv-action-btn--ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="inv-action-btn inv-action-btn--print" onClick={handleSubmit} disabled={saving} style={{ background: '#0891b2' }}>
            {saving ? '…' : <><FileText size={14}/> Create Invoice</>}
          </button>
        </div>
      </div>
    </div>

    {/* Create Customer sub-modal */}
    {showNewCust && (
      <CreateCustomerModal
        onClose={() => setShowNewCust(false)}
        onCreated={cust => {
          setSelectedCustomer(cust);
          setShowNewCust(false);
        }}
      />
    )}

    {/* Create Vehicle sub-modal */}
    {showNewVeh && selectedCustomer?.mobile && (
      <CreateVehicleModal
        mobile={selectedCustomer.mobile}
        onClose={() => setShowNewVeh(false)}
        onCreated={veh => {
          // Map the saved vehicle to picker format
          setSelectedVehicle({
            vehicle_number: veh.vehicle_number,
            make_name: veh.make_name || null,
            model_name: veh.model_name || null,
            source: 'manual',
            cv_id: veh.id,
          });
          setShowNewVeh(false);
        }}
      />
    )}
    </>
  );
}

// ── Vehicle History Modal ─────────────────────────────────────────────────────
function VehicleHistoryModal({ onClose }) {
  const [query, setQuery]   = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [err, setErr]         = useState('');

  async function search(e) {
    e?.preventDefault();
    const vnum = query.trim().toUpperCase();
    if (!vnum) return;
    setLoading(true); setErr('');
    try {
      const r = await api(`/api/invoices/vehicle-history/${encodeURIComponent(vnum)}`);
      setResult(r);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  const items = result?.items || [];
  const grandTotal = items.reduce((s, i) => s + Number(i.total || 0), 0);

  return (
    <div className="inv-backdrop" onClick={onClose}>
      <div className="inv-view-modal" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
        <div className="invv-hdr">
          <div className="invv-hdr-icon" style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}><Car size={18}/></div>
          <div className="invv-hdr-body">
            <div className="invv-hdr-title">Vehicle Service History</div>
            <div className="invv-hdr-sub">Lookup all past invoices by vehicle number</div>
          </div>
          <button className="inv-icon-btn" onClick={onClose}><X size={16}/></button>
        </div>

        <div className="invv-body">
          <div className="invv-section">
            <form style={{ display: 'flex', gap: 8 }} onSubmit={search}>
              <input className="inv-search" style={{ flex: 1, padding: '9px 14px', borderRadius: 9, border: '1.5px solid var(--border)', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg)', color: 'var(--text)', outline: 'none', textTransform: 'uppercase' }}
                placeholder="Enter vehicle number e.g. MH12AB1234"
                value={query} onChange={e => { setQuery(e.target.value); setResult(null); }}
                autoFocus />
              <button type="submit" disabled={loading || !query.trim()}
                style={{ padding: '9px 18px', borderRadius: 9, border: 'none', background: '#7c3aed', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
                {loading ? '…' : 'Search'}
              </button>
            </form>
            {err && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 8 }}>{err}</div>}
          </div>

          {result && (
            <div className="invv-section">
              {items.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                  No service history found for <strong>{result.vehicle_number}</strong>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}><strong style={{ color: 'var(--text)' }}>{items.length}</strong> invoice{items.length > 1 ? 's' : ''} found for {result.vehicle_number}</span>
                    <span style={{ fontWeight: 700 }}>Total spent: {fmtINR(grandTotal)}</span>
                  </div>
                  {items.map(inv => (
                    <div key={inv.id} style={{ border: '1.5px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 5, marginRight: 6 }}>#{inv.id}</span>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDate(inv.created_at)}</span>
                          {inv.hub_name && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>📍 {inv.hub_name}</span>}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 800, color: '#0f766e' }}>{fmtINR(inv.total)}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                        {inv.customer_name && <span style={{ fontWeight: 600, color: 'var(--text)', marginRight: 8 }}>{inv.customer_name}</span>}
                        {inv.mobile}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {(inv.services || []).map((s, si) => (
                          <span key={si} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 20, background: 'var(--bg-soft,#f1f5f9)', color: 'var(--text)' }}>
                            {s.service_name || s.description || '—'} · {fmtINR(s.total_price)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        <div className="invv-ftr">
          <button className="inv-action-btn inv-action-btn--ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Bulk Payment Modal ────────────────────────────────────────────────────────
function BulkPaymentModal({ invoices, onClose, onDone }) {
  const outstanding = invoices.filter(i => Number(i.outstanding || 0) > 0);
  const [method,  setMethod]  = useState('cash');
  const [amounts, setAmounts] = useState(() =>
    Object.fromEntries(outstanding.map(i => [i.id, String(Number(i.outstanding || 0))]))
  );
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');
  const [done,   setDone]   = useState([]); // ids that succeeded

  const totalToPay = outstanding.reduce((s, i) => s + (Number(amounts[i.id]) || 0), 0);

  async function handlePay() {
    const targets = outstanding.filter(i => Number(amounts[i.id]) > 0);
    if (!targets.length) { setErr('Enter at least one payment amount'); return; }
    setSaving(true); setErr('');
    const succeeded = [];
    const errors = [];
    for (const inv of targets) {
      try {
        const r = await api(`/api/invoices/${inv.id}/payments`, {
          method: 'POST',
          body: { amount: Number(amounts[inv.id]), method, reference_no: null, notes: 'Bulk payment' },
        });
        succeeded.push({ id: inv.id, invoice: r.invoice });
      } catch (e) {
        errors.push(`#${inv.id}: ${e.message}`);
      }
    }
    setSaving(false);
    setDone(succeeded.map(s => s.id));
    onDone(succeeded);
    if (errors.length) setErr(errors.join(' | '));
    else onClose();
  }

  return (
    <div className="inv-backdrop" onClick={onClose}>
      <div className="inv-pay-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="invv-hdr">
          <div className="invv-hdr-icon" style={{ background: 'linear-gradient(135deg,#0891b2,#0e7490)' }}>
            <IndianRupee size={18}/>
          </div>
          <div className="invv-hdr-body">
            <div className="invv-hdr-title">Bulk Payment</div>
            <div className="invv-hdr-sub">{outstanding.length} invoice{outstanding.length !== 1 ? 's' : ''} with outstanding balance</div>
          </div>
          <button className="inv-icon-btn" onClick={onClose}><X size={16}/></button>
        </div>

        <div className="invv-body">
          {invoices.length !== outstanding.length && (
            <div style={{ padding: '8px 12px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e', marginBottom: 12 }}>
              {invoices.length - outstanding.length} selected invoice{invoices.length - outstanding.length !== 1 ? 's are' : ' is'} already fully paid — skipped.
            </div>
          )}
          {outstanding.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>All selected invoices are already fully paid.</div>
          ) : (
            <>
              {/* Method */}
              <div style={{ marginBottom: 14 }}>
                <label className="pay-lbl">Payment Method</label>
                <select className="pay-input" value={method} onChange={e => setMethod(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="card">Card</option>
                  <option value="app_payment">In-App Payment</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {/* Per-invoice rows */}
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {outstanding.map(inv => (
                  <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>#{inv.id} — {inv.customer_name || inv.mobile}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Outstanding: {fmtINR(inv.outstanding)}</div>
                    </div>
                    {done.includes(inv.id) ? (
                      <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 700 }}>✓ Paid</span>
                    ) : (
                      <input
                        type="number" min="0" max={Number(inv.outstanding)} step="0.01"
                        className="pay-input" style={{ width: 110, textAlign: 'right' }}
                        value={amounts[inv.id] ?? ''}
                        onChange={e => setAmounts(a => ({ ...a, [inv.id]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}
              </div>

              {err && <div className="pay-err" style={{ marginTop: 10 }}><AlertCircle size={12}/> {err}</div>}

              <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--bg-soft,#f8fafc)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14 }}>
                <span>Total to Pay</span>
                <span style={{ color: '#0891b2' }}>{fmtINR(totalToPay)}</span>
              </div>
            </>
          )}
        </div>

        <div className="invv-ftr">
          <button className="button secondary" onClick={onClose} disabled={saving}>Cancel</button>
          {outstanding.length > 0 && (
            <button className="inv-action-btn" style={{ background: '#0891b2', color: '#fff' }}
              onClick={handlePay} disabled={saving || totalToPay <= 0}>
              <IndianRupee size={14}/> {saving ? 'Processing…' : `Pay ${fmtINR(totalToPay)}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function InvoicesPage() {
  const [invoices,     setInvoices]     = useState([]);
  const [total,        setTotal]        = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [statusList,   setStatusList]   = useState([]);
  const [hubs,         setHubs]         = useState([]);

  const [search,       setSearch]       = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterHub,    setFilterHub]    = useState('');
  const [page,         setPage]         = useState(1);
  const LIMIT = 20;

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [modal,  setModal]  = useState(null); // { mode: 'view'|'payments'|'new'|'history'|'bulk', inv? }
  const [toast,  setToast]  = useState(null);
  const searchTimer = useRef(null);
  const canCreate       = useCan('CREATE_INVOICE');
  // Fix #29: gate the Payments button — need at least VIEW_INVOICE (or higher) to open it
  const canViewPayments = useCan('VIEW_INVOICE', 'CREATE_INVOICE', 'EDIT_INVOICE', 'ADD_INVOICE_PAYMENT');

  // Reset selection when filters/page change
  useEffect(() => { setSelectedIds(new Set()); }, [search, filterStatus, filterHub, page]);

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    if (selectedIds.size === invoices.length && invoices.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(invoices.map(i => i.id)));
    }
  }
  const allSelected = invoices.length > 0 && selectedIds.size === invoices.length;
  const someSelected = selectedIds.size > 0 && !allSelected;
  const selectedInvoices = invoices.filter(i => selectedIds.has(i.id));

  useEffect(() => {
    Promise.all([
      api('/api/invoice-statuses'),
      api('/api/hubs?is_active=true&limit=200'),
    ]).then(([sr, hr]) => {
      setStatusList(sr.items || []);
      setHubs(hr.items || []);
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ page, limit: LIMIT });
      if (search)       qs.set('search',    search);
      if (filterStatus) qs.set('status_id', filterStatus);
      if (filterHub)    qs.set('hub_id',    filterHub);
      const r = await api(`/api/invoices?${qs}`);
      setInvoices(r.items || []);
      setTotal(r.total || 0);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [search, filterStatus, filterHub, page]);

  useEffect(() => { load(); }, [load]);

  function handleSearchChange(v) {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setSearch(v); setPage(1); }, 350);
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  function handleUpdated(item) {
    setInvoices(prev => prev.map(i => i.id === item.id ? { ...i, ...item } : i));
    if (modal?.inv?.id === item.id) setModal(m => ({ ...m, inv: { ...m.inv, ...item } }));
  }

  const totalPages = Math.ceil(total / LIMIT);
  const start = (page - 1) * LIMIT + 1;
  const end   = Math.min(page * LIMIT, total);

  return (
    <div className="inv-page">
      {toast && (
        <div className={`inv-toast inv-toast--${toast.type}`}>
          <CheckCircle2 size={14}/> {toast.msg}
        </div>
      )}

      <header className="page-header">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={20}/> Invoices
          </h2>
          <p>Manage invoices, record payments, and share with customers.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button className="inv-action-btn inv-action-btn--ghost"
            onClick={() => setModal({ mode: 'history' })}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            🚗 Vehicle History
          </button>
          {canCreate && (
            <button className="inv-action-btn inv-action-btn--print"
              onClick={() => setModal({ mode: 'new' })}
              style={{ background: '#0891b2', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14}/> New Invoice
            </button>
          )}
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      {/* Filters */}
      <div className="inv-filters">
        <div className="inv-search-wrap">
          <Search size={14} className="inv-search-icon"/>
          <input className="inv-search" placeholder="Search customer, mobile, vehicle no…"
            onChange={e => handleSearchChange(e.target.value)}/>
        </div>
        <select className="inv-filter-sel" value={filterStatus}
          onChange={e => { setFilterStatus(e.target.value); setPage(1); }}>
          <option value="">All Statuses</option>
          {statusList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="inv-filter-sel" value={filterHub}
          onChange={e => { setFilterHub(e.target.value); setPage(1); }}>
          <option value="">All Hubs</option>
          {hubs.map(h => <option key={h.id} value={h.id}>{h.hub_name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table inv-table">
            <thead>
              <tr>
                <th style={{ width: 36, paddingLeft: 12 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleSelectAll}
                    title="Select all"
                  />
                </th>
                <th>#</th>
                <th>Customer</th>
                <th>Hub</th>
                <th>Vehicle No.</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>Paid</th>
                <th style={{ textAlign: 'right' }}>Outstanding</th>
                <th>Date</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 11 }).map((_, j) => <td key={j}><div className="inv-skel"/></td>)}</tr>
                ))
              ) : invoices.length === 0 ? (
                <tr><td colSpan="11">
                  <div className="inv-empty">
                    <FileText size={36} style={{ opacity: .2, marginBottom: 10 }}/>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>No invoices yet</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {search || filterStatus || filterHub ? 'Try adjusting filters.' : 'Invoices are created from completed appointments.'}
                    </div>
                  </div>
                </td></tr>
              ) : invoices.map(inv => {
                const statusCfg  = statusList.find(s => s.id === inv.status_id);
                const outstanding = Number(inv.outstanding || 0);
                const paid        = Number(inv.amount_paid  || 0);
                return (
                  <tr key={inv.id} className={selectedIds.has(inv.id) ? 'inv-row--selected' : ''}>
                    <td style={{ paddingLeft: 12 }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(inv.id)}
                        onChange={() => toggleSelect(inv.id)}
                      />
                    </td>
                    <td>
                      <span className="inv-id-badge">#{inv.id}</span>
                      {inv.appointment_id && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Appt #{inv.appointment_id}</div>}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{inv.customer_name || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{inv.mobile}</div>
                    </td>
                    <td><div style={{ fontSize: 13 }}>{inv.hub_name || '—'}</div></td>
                    <td><div style={{ fontSize: 13 }}>{inv.vehicle_number || '—'}</div></td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{fmtINR(inv.total)}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 13, color: paid > 0 ? '#16a34a' : 'var(--text-muted)', fontWeight: paid > 0 ? 600 : 400 }}>
                        {paid > 0 ? fmtINR(paid) : '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {outstanding > 0
                        ? <span className="inv-outstanding-chip">{fmtINR(outstanding)}</span>
                        : <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>✓ Paid</span>}
                    </td>
                    <td><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDate(inv.created_at)}</div></td>
                    <td>
                      <InvStatusSelect invId={inv.id} current={statusCfg} statusList={statusList} onChange={handleUpdated}/>
                    </td>
                    <td>
                      <div className="inv-actions">
                        <button className="inv-icon-btn" title="View invoice"
                          onClick={() => setModal({ mode: 'view', inv })}>
                          <Eye size={14}/>
                        </button>
                        {canViewPayments && (
                          <button className="inv-icon-btn" title="Payments"
                            onClick={() => setModal({ mode: 'payments', inv })}>
                            <IndianRupee size={14}/>
                          </button>
                        )}
                        {/* Fix #4: fetch full invoice (with services) before printing/sharing */}
                        <button className="inv-icon-btn" title="Print"
                          onClick={async () => {
                            try {
                              const full = await api(`/api/invoices/${inv.id}`);
                              printInvoice(full.item);
                            } catch { printInvoice(inv); } // fallback
                          }}>
                          <Printer size={14}/>
                        </button>
                        <button className="inv-icon-btn inv-icon-btn--wa" title="WhatsApp"
                          onClick={async () => {
                            try {
                              const full = await api(`/api/invoices/${inv.id}`);
                              whatsappShare(full.item);
                            } catch { whatsappShare(inv); } // fallback
                          }}>
                          <MessageCircle size={14}/>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="inv-pagination">
            <span className="inv-pag-info">{start}–{end} of {total} invoice{total !== 1 ? 's' : ''}</span>
            <div className="inv-pag-btns">
              <button className="inv-pag-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={15}/></button>
              <span className="inv-pag-page">{page} / {totalPages}</span>
              <button className="inv-pag-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight size={15}/></button>
            </div>
          </div>
        )}
      </div>

      {/* Pay Selected sticky bar */}
      {selectedIds.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#0f172a', color: '#fff', borderRadius: 14,
          padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)', zIndex: 900, whiteSpace: 'nowrap',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {selectedIds.size} invoice{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>
            Outstanding: {fmtINR(selectedInvoices.reduce((s, i) => s + Number(i.outstanding || 0), 0))}
          </span>
          {canViewPayments && (
            <button
              onClick={() => setModal({ mode: 'bulk' })}
              style={{ background: '#0891b2', color: '#fff', border: 'none', borderRadius: 9, padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <IndianRupee size={13}/> Pay Selected
            </button>
          )}
          <button
            onClick={() => setSelectedIds(new Set())}
            style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', borderRadius: 9, padding: '7px 12px', fontSize: 12, cursor: 'pointer' }}>
            <X size={13}/>
          </button>
        </div>
      )}

      {modal?.mode === 'view' && (
        <InvoiceViewModal
          inv={modal.inv}
          statusList={statusList}
          onClose={() => setModal(null)}
          onUpdated={handleUpdated}
          onOpenPayments={() => setModal({ mode: 'payments', inv: modal.inv })}
        />
      )}
      {modal?.mode === 'payments' && (
        <PaymentModal
          inv={modal.inv}
          onClose={() => setModal(null)}
          onUpdated={handleUpdated}
        />
      )}
      {modal?.mode === 'new' && (
        <ManualInvoiceModal
          statusList={statusList}
          hubs={hubs}
          onClose={() => setModal(null)}
          onCreated={item => {
            setInvoices(prev => [item, ...prev]);
            setTotal(t => t + 1);
            setModal(null);
            showToast('Invoice created successfully');
          }}
        />
      )}
      {modal?.mode === 'history' && (
        <VehicleHistoryModal onClose={() => setModal(null)} />
      )}
      {modal?.mode === 'bulk' && (
        <BulkPaymentModal
          invoices={selectedInvoices}
          onClose={() => setModal(null)}
          onDone={succeeded => {
            succeeded.forEach(({ id, invoice }) => {
              handleUpdated({ id, amount_paid: invoice.amount_paid, outstanding: invoice.outstanding });
            });
            setSelectedIds(new Set());
            showToast(`${succeeded.length} payment${succeeded.length !== 1 ? 's' : ''} recorded`);
          }}
        />
      )}
    </div>
  );
}
