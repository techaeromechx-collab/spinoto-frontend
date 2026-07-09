import { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';
import PaginationBar from '../components/PaginationBar.jsx';
import { getRoundingFunction } from '../lib/math.js';
import {
  Receipt, Search, RefreshCw, X, Eye, Trash2,
  AlertCircle, CheckCircle2, Clock, Plus, ChevronLeft, Printer, Car, ChevronDown,
} from 'lucide-react';
import '../styles/CustomerInvoicesPage.css';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) {
  if (n == null) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function amountToWords(amount) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function words(n) {
    if (n === 0) return '';
    if (n < 20) return ones[n] + ' ';
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '') + ' ';
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred ' + words(n % 100);
    if (n < 100000) return words(Math.floor(n / 1000)) + 'Thousand ' + words(n % 1000);
    if (n < 10000000) return words(Math.floor(n / 100000)) + 'Lakh ' + words(n % 100000);
    return words(Math.floor(n / 10000000)) + 'Crore ' + words(n % 10000000);
  }
  const num = Math.round(Math.abs(amount || 0));
  const paise = Math.round((Math.abs(amount || 0) - num) * 100);
  let result = (words(num) || 'Zero ').trim() + ' Rupees';
  if (paise > 0) result += ' and ' + words(paise).trim() + ' Paise';
  return result + ' Only';
}

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_META = {
  generated: { bg: '#dbeafe', color: '#1e40af', label: 'Generated' },
  approved: { bg: '#fef9c3', color: '#713f12', label: 'Approved' },
  partially_paid: { bg: '#fef3c7', color: '#92400e', label: 'Partially Paid' },
  paid: { bg: '#dcfce7', color: '#166534', label: 'Paid' },
  cancelled: { bg: '#fee2e2', color: '#991b1b', label: 'Cancelled' },
};

const METHOD_META = {
  cash: { bg: '#f3f4f6', color: '#374151' },
  upi: { bg: '#dbeafe', color: '#1e40af' },
  card: { bg: '#f3e8ff', color: '#7e22ce' },
  bank_transfer: { bg: '#dcfce7', color: '#166534' },
  app_payment: { bg: '#fff7ed', color: '#c2410c' },
  other: { bg: '#f3f4f6', color: '#374151' },
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] || { bg: '#f3f4f6', color: '#374151', label: status || '—' };
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 99,
      fontSize: 11, fontWeight: 700, background: m.bg, color: m.color,
      whiteSpace: 'nowrap',
    }}>{m.label}</span>
  );
}

function MethodBadge({ method }) {
  const m = METHOD_META[method] || METHOD_META.other;
  return (
    <span className="method-badge" style={{ background: m.bg, color: m.color }}>
      {method || 'other'}
    </span>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [msg, onClose]);
  const isErr = type === 'error';
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      display: 'flex', alignItems: 'center', gap: 10,
      background: isErr ? '#fef2f2' : '#f0fdf4',
      border: `1px solid ${isErr ? '#fca5a5' : '#86efac'}`,
      borderRadius: 10, padding: '12px 18px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
      color: isErr ? '#991b1b' : '#166534',
      fontWeight: 500, fontSize: 14,
    }}>
      {isErr ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
      {msg}
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', marginLeft: 4 }}>
        <X size={14} />
      </button>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 14, color: 'var(--text)', fontWeight: 500 }}>{value || '—'}</span>
    </div>
  );
}

// ── Add Payment Form ──────────────────────────────────────────────────────────
function AddPaymentForm({ invoiceId, balance, onSuccess, showToast }) {
  const [form, setForm] = useState({ amount: '', method: 'cash', reference_no: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const field = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const amt = parseFloat(form.amount);
    if (!form.amount || isNaN(amt) || amt <= 0) { setErr('Amount must be greater than 0.'); return; }
    if (amt > balance + 0.001) { setErr(`Amount cannot exceed balance of ${fmt(balance)}.`); return; }
    setSaving(true); setErr(null);
    try {
      await api(`/api/customer-invoices/${invoiceId}/payments`, {
        method: 'POST',
        body: {
          amount: amt,
          method: form.method,
          reference_no: form.reference_no.trim() || undefined,
          notes: form.notes.trim() || undefined,
        },
      });
      setForm({ amount: '', method: 'cash', reference_no: '', notes: '' });
      showToast('Payment recorded.');
      onSuccess();
    } catch (ex) {
      setErr(ex.message || 'Failed to record payment.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h5 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>Add Payment</h5>
        <div className="quick-pay-btn-group">
          <button
            type="button"
            className="quick-pay-chip quick-pay-chip-cash"
            onClick={() => setForm(f => ({ ...f, amount: balance.toFixed(2), method: 'cash' }))}
          >
            Pay Full Cash (₹{balance.toFixed(2)})
          </button>
          <button
            type="button"
            className="quick-pay-chip quick-pay-chip-upi"
            onClick={() => setForm(f => ({ ...f, amount: balance.toFixed(2), method: 'upi' }))}
          >
            Pay Full UPI (₹{balance.toFixed(2)})
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '0 0 120px' }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Amount *</label>
          <input
            className="form-input"
            type="number" min="0.01" step="0.01"
            placeholder="0.00"
            value={form.amount}
            onChange={field('amount')}
          />
        </div>
        <div style={{ flex: '0 0 140px' }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Method</label>
          <select className="form-input" value={form.method} onChange={field('method')}>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="app_payment">In-App Payment</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div style={{ flex: '1 1 140px' }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Reference No</label>
          <input
            className="form-input"
            placeholder="UTR / Txn ID…"
            value={form.reference_no}
            onChange={field('reference_no')}
          />
        </div>
        <div style={{ flex: '1 1 140px' }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Notes</label>
          <input
            className="form-input"
            placeholder="Optional…"
            value={form.notes}
            onChange={field('notes')}
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={saving} style={{ flexShrink: 0 }}>
          <Plus size={14} />
          {saving ? 'Recording…' : 'Record Payment'}
        </button>
      </div>
      {err && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#fef2f2', border: '1px solid #fca5a5',
          borderRadius: 8, padding: '9px 14px', color: '#991b1b', fontSize: 13,
        }}>
          <AlertCircle size={14} /> {err}
        </div>
      )}
    </form>
  );
}

// ── Vehicle History Modal ─────────────────────────────────────────────────────
function VehicleHistoryModal({ onClose }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  async function search(e) {
    e?.preventDefault();
    const vnum = query.trim().toUpperCase();
    if (!vnum) return;
    setLoading(true); setErr(''); setResult(null);
    try {
      const r = await api(`/api/customer-invoices/vehicle-history/${encodeURIComponent(vnum)}`);
      setResult(r);
    } catch (ex) { setErr(ex.message || 'Search failed'); }
    finally { setLoading(false); }
  }

  const STATUS_COLOR = {
    paid: { bg: '#dcfce7', color: '#166534' },
    partially_paid: { bg: '#fef3c7', color: '#92400e' },
    approved: { bg: '#dbeafe', color: '#1e40af' },
    generated: { bg: '#f3f4f6', color: '#374151' },
  };

  const items = result?.items || [];
  const grandTotal = items.reduce((s, i) => s + Number(i.total || 0), 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Car size={18} style={{ color: '#7c3aed' }} /> Vehicle Service History
          </h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            Look up all past customer invoices by vehicle registration number.
          </p>

          <form style={{ display: 'flex', gap: 8 }} onSubmit={search}>
            <input
              className="form-input"
              style={{ flex: 1, textTransform: 'uppercase' }}
              placeholder="e.g. MH12AB1234"
              value={query}
              autoFocus
              onChange={e => { setQuery(e.target.value); setResult(null); }}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !query.trim()}
              style={{ flexShrink: 0 }}
            >
              {loading ? '…' : 'Search'}
            </button>
          </form>

          {err && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#dc2626', fontSize: 13 }}>
              <AlertCircle size={14} /> {err}
            </div>
          )}

          {result && (
            items.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                No invoices found for <strong>{result.vehicle_number}</strong>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--text-muted)' }}>
                    <strong style={{ color: 'var(--text)' }}>{items.length}</strong> invoice{items.length !== 1 ? 's' : ''} for {result.vehicle_number}
                  </span>
                  <span style={{ fontWeight: 700 }}>Total spent: {fmt(grandTotal)}</span>
                </div>
                <div style={{ maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {items.map(inv => {
                    const sc = STATUS_COLOR[inv.status_name] || { bg: '#f3f4f6', color: '#374151' };
                    return (
                      <div key={inv.id} style={{ border: '1.5px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 5 }}>
                              #{inv.id}
                            </span>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDate(inv.created_at)}</span>
                            {(inv.hub_full_name || inv.hub_name) && (
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>📍 {inv.hub_full_name || inv.hub_name}</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5, background: sc.bg, color: sc.color }}>
                              {inv.status_name?.replace('_', ' ')}
                            </span>
                            <span style={{ fontSize: 14, fontWeight: 800, color: '#0f766e' }}>{fmt(inv.total)}</span>
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                          {inv.customer_name && <span style={{ fontWeight: 600, color: 'var(--text)', marginRight: 8 }}>{inv.customer_name}</span>}
                          {inv.mobile}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {(inv.services || []).map((s, si) => (
                            <span key={si} style={{
                              fontSize: 11, padding: '3px 9px', borderRadius: 20,
                              background: s.item_type === 'part' ? '#dcfce7' : '#dbeafe',
                              color: s.item_type === 'part' ? '#166534' : '#1e40af',
                            }}>
                              {s.description} · {fmt(s.total_inc_gst)}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          )}
        </div>

        <div style={{ padding: '12px 24px 20px', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Detail Drawer ─────────────────────────────────────────────────────────────
function DetailDrawer({ invoiceId, onClose, showToast, onRefreshList }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isHubUser = !!user?.hub_id;

  const [inv, setInv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deletingPayId, setDeletingPayId] = useState(null);
  const [approving, setApproving] = useState(false);
  // generatingPI removed — PI is now created BEFORE CI in the new flow
  const [company, setCompany] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, co] = await Promise.all([
        api(`/api/customer-invoices/${invoiceId}`),
        api('/api/settings/company').catch(() => null),
      ]);
      setInv(res.item || res);
      if (co) setCompany(co);
    } catch {
      showToast('Failed to load customer invoice.', 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  }, [invoiceId, showToast, onClose]);

  useEffect(() => { load(); }, [load]);

  async function deletePayment(payId) {
    setDeletingPayId(payId);
    try {
      await api(`/api/customer-invoices/${invoiceId}/payments/${payId}`, { method: 'DELETE' });
      showToast('Payment deleted.');
      await load();
      onRefreshList();
    } catch (err) {
      showToast(err.message || 'Failed to delete payment.', 'error');
    } finally {
      setDeletingPayId(null);
    }
  }

  async function approveInvoice() {
    setApproving(true);
    try {
      await api(`/api/customer-invoices/${invoiceId}/approve`, { method: 'POST' });
      showToast('Invoice approved.');
      await load();
      onRefreshList();
    } catch (err) {
      showToast(err.message || 'Failed to approve invoice.', 'error');
    } finally {
      setApproving(false);
    }
  }

  const items = inv?.items || [];
  const payments = inv?.payments || [];

  const r2 = getRoundingFunction(inv?.created_at);
  function computeDiscount(it) {
    const exRate = parseFloat(it.customer_rate ?? it.rate ?? 0);
    const qty = parseFloat(it.quantity ?? 1);
    const gstPct = parseFloat(it.gst_percent ?? 0);
    const incRate = r2(exRate * (1 + gstPct / 100));
    const totalBefore = r2(qty * incRate);
    const dType = it.discount_type;
    const dValue = parseFloat(it.discount_value) || 0;
    let discountAmount = 0;
    if (dType === 'percent' && dValue > 0) discountAmount = r2(totalBefore * dValue / 100);
    else if (dType === 'flat' && dValue > 0) discountAmount = Math.min(dValue, totalBefore);
    return discountAmount;
  }
  // Discount mode from the CI (carried over from estimate)
  const ciDiscountMode = inv?.discount_mode || 'line_item';
  const ciTxDiscountType = inv?.transaction_discount_type || null;
  const ciTxDiscountValue = parseFloat(inv?.transaction_discount_value) || 0;
  const ciTxDiscountAmount = parseFloat(inv?.transaction_discount_amount) || 0;

  const lineItemDiscount = r2(items.reduce((s, it) => s + computeDiscount(it), 0));
  const totalDiscount = ciDiscountMode === 'transaction' ? ciTxDiscountAmount : lineItemDiscount;
  const hasDiscount = totalDiscount > 0;

  // Trust the database-stored header values directly to ensure 100% alignment
  const subtotal = parseFloat(inv?.subtotal_ex_gst ?? 0);
  const totalGst = parseFloat(inv?.total_gst ?? 0);
  const grandTotal = parseFloat(inv?.grand_total ?? 0);

  // Dynamic GST slab grouping
  const gstSlabMap = {};
  items.forEach(it => {
    const pct = parseFloat(it.gst_percent ?? 0);
    const gstAmt = parseFloat(it.gst_amount ?? 0);
    if (pct > 0 && gstAmt > 0) {
      const key = pct.toString();
      if (!gstSlabMap[key]) gstSlabMap[key] = { pct, gstTotal: 0 };
      gstSlabMap[key].gstTotal += gstAmt;
    }
  });
  Object.values(gstSlabMap).forEach(slab => {
    slab.cgst = r2(Math.ceil(slab.gstTotal * 100 / 2) / 100);
    slab.sgst = r2(slab.gstTotal - slab.cgst);
  });
  const gstSlabs = Object.values(gstSlabMap).sort((a, b) => b.pct - a.pct);
  const paid = inv?.amount_paid ?? payments.reduce((s, p) => s + parseFloat(p.amount ?? 0), 0);
  const balance = Math.max(0, parseFloat(grandTotal) - parseFloat(paid));

  const canApprove = !isHubUser && inv?.status === 'generated';
  const canAddPayment = inv && (inv.status === 'approved' || inv.status === 'partially_paid');
  const canDeletePay = inv && inv.status !== 'paid' && inv.status !== 'cancelled';

  return (
    <div className="card est-detail-view">

      {/* ── Print header — hidden on screen, shown when printing ── */}
      <div className="est-print-header">
        <div style={{ flex: 1 }}>
          {/* Brand logo */}
          <img src="/logo.svg" alt="Spinoto Logo" style={{ height: 44, marginBottom: 10, display: 'block' }} />
          {company?.company_name ? (
            <>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#111', marginBottom: 4 }}>
                {company.company_name.toUpperCase()}
              </div>
              {company.address_line1 && <div style={{ fontSize: 12, color: '#444' }}>{company.address_line1}</div>}
              {company.address_line2 && <div style={{ fontSize: 12, color: '#444' }}>{company.address_line2}</div>}
              {(company.city || company.state || company.pincode) && (
                <div style={{ fontSize: 12, color: '#444' }}>
                  {[company.city, company.state, company.pincode].filter(Boolean).join(', ')}
                </div>
              )}
              {company.phone && <div style={{ fontSize: 12, color: '#444' }}>Phone : {company.phone}</div>}
              {company.email && <div style={{ fontSize: 12, color: '#444' }}>Email : {company.email}</div>}
              {company.gstin && <div style={{ fontSize: 12, color: '#444' }}>GSTIN : {company.gstin}</div>}
            </>
          ) : (
            <div style={{ fontSize: 13, color: '#888', fontStyle: 'italic' }}>Company details not set</div>
          )}
        </div>
        {/* Right: invoice title + ID + QR code */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#111', letterSpacing: '0.04em' }}>CUSTOMER INVOICE</div>
            {inv && <div style={{ fontSize: 13, color: '#555', marginTop: 3 }}>CI-{String(inv.id).padStart(6, '0')}</div>}
            {inv && <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>{fmtDate(inv.created_at)}</div>}
          </div>
          {/* QR Code — shown in print */}
          <div className="ci-print-qr" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <img
              src="/qr-code.png"
              alt="QR Code"
              style={{ width: 72, height: 72, imageRendering: 'pixelated' }}
            />
            <span style={{ fontSize: 8, color: '#888', letterSpacing: '0.03em' }}>Scan to download</span>
          </div>
        </div>
      </div>

      {/* ── Screen header bar — hidden when printing ── */}
      <div className="est-detail-header est-screen-only">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Receipt size={18} style={{ color: 'var(--primary)' }} />
          <span style={{ fontWeight: 700, fontSize: 16 }}>Customer Invoice {inv ? `#${inv.id}` : ''}</span>
          {inv && <StatusBadge status={inv.status} />}
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => {
            const o = document.title;
            if (inv) {
              const invId = `CI-${String(inv.id).padStart(6, '0')}`;
              const vNum = inv.vehicle_number || '';
              const vModel = inv.model_name || '';
              document.title = [invId, vNum, vModel].filter(Boolean).join('_');
            }
            window.print();
            document.title = o;
          }}

          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontSize: 13 }}
          title="Print / Save as PDF"
        >
          <Printer size={15} /> Print / PDF
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          <Clock size={28} style={{ opacity: 0.3, marginBottom: 10 }} />
          <p style={{ margin: 0 }}>Loading…</p>
        </div>
      ) : !inv ? null : (
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Info grid — two-column bill-to / invoice-meta layout */}
          <div className="ci-info-grid" style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0,
            background: 'var(--bg-soft)', borderRadius: 12, overflow: 'hidden',
          }}>
            {/* Left: customer details */}
            <div style={{ padding: '16px 20px', borderRight: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Bill To</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {[
                  { label: 'Customer', value: inv.customer_name },
                  { label: 'Mobile', value: inv.mobile },
                  {
                    label: 'Hub / Branch',
                    value: (
                      <>
                        <span className="est-no-print">{inv.hub_full_name || inv.hub_name}</span>
                        <span className="est-print-show">{inv.hub_name}</span>
                      </>
                    )
                  },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: 'flex' }}>
                    <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500, width: 90, flexShrink: 0 }}>{label}</span>
                    <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{value || '—'}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Right: vehicle details + invoice meta */}
            <div style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Vehicle & Invoice</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {/* Vehicle number */}
                <div style={{ display: 'flex' }}>
                  <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500, width: 90, flexShrink: 0 }}>Reg. No.</span>
                  <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{inv.vehicle_number || '—'}</span>
                </div>
                {/* Make + Model */}
                {(inv.make_name || inv.model_name) && (
                  <div style={{ display: 'flex' }}>
                    <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500, width: 90, flexShrink: 0 }}>Make / Model</span>
                    <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{[inv.make_name, inv.model_name].filter(Boolean).join(' ')}</span>
                  </div>
                )}
                {/* 4W: Body Type */}
                {inv.body_type_name && (
                  <div style={{ display: 'flex' }}>
                    <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500, width: 90, flexShrink: 0 }}>Body Type</span>
                    <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{inv.body_type_name}{inv.segment_names ? ` (${inv.segment_names})` : ''}</span>
                  </div>
                )}

                {/* Invoice meta */}
                {[
                  { label: 'Invoice No.', value: `CI-${String(inv.id).padStart(6, '0')}` },
                  { label: 'Date', value: fmtDate(inv.created_at) },
                  { label: 'Status', node: <StatusBadge status={inv.status} /> },
                ].map(({ label, value, node }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500, width: 90, flexShrink: 0 }}>{label}</span>
                    {node ?? <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{value || '—'}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Approve Invoice action — screen only */}
          {canApprove && (
            <div className="ci-internal" style={{ background: '#fefce8', border: '1px solid #fde047', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#713f12' }}>Invoice Pending Approval</div>
                <div style={{ fontSize: 12, color: '#92400e', marginTop: 2 }}>Review the invoice and approve it before collecting payment.</div>
              </div>
              <button className="btn btn-primary" disabled={approving} onClick={approveInvoice} style={{ flexShrink: 0 }}>
                {approving ? 'Approving…' : 'Approve Invoice'}
              </button>
            </div>
          )}


          {/* Line items */}
          <div>
            <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Line Items</h4>
            <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border)' }}>
              <table className="ci-table ci-items-table">
                <thead>
                  <tr>
                    <th style={{ width: 36, textAlign: 'center' }}>Sr.</th>
                    <th style={{ minWidth: 160, maxWidth: 220 }}>Item</th>
                    <th>HSN/SAC</th>
                    <th style={{ textAlign: 'right' }}>Qty</th>
                    <th style={{ textAlign: 'right' }}>Rate</th>
                    {hasDiscount && <th style={{ textAlign: 'center' }}>Discount</th>}
                    <th style={{ textAlign: 'right' }}>Taxable</th>
                    <th style={{ textAlign: 'right' }}>CGST %</th>
                    <th style={{ textAlign: 'right' }}>SGST %</th>
                    <th style={{ textAlign: 'right' }}>Tax Amount</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr><td colSpan={hasDiscount ? 11 : 10} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>No items</td></tr>
                  ) : items.map((it, i) => {
                    const exRate = parseFloat(it.customer_rate ?? it.rate ?? 0);
                    const qty = parseFloat(it.quantity ?? 1);
                    const gstPct = parseFloat(it.gst_percent ?? 0);
                    
                    // Trust the database-stored fields directly
                    const total = parseFloat(it.total_inc_gst ?? 0);
                    const gstAmt = parseFloat(it.gst_amount ?? 0);
                    const taxable = r2(total - gstAmt);
                    
                    const halfPct = gstPct / 2;
                    const discAmt = parseFloat(it.discount_amount ?? 0);
                    const dType = it.discount_type;
                    const dValue = parseFloat(it.discount_value) || 0;
                    
                    // Display rate including GST (original standard price before discount)
                    const incRate = qty > 0 ? r2((total + discAmt) / qty) : 0;
                    return (
                      <tr key={i}>
                        <td style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{i + 1}</td>
                        <td style={{ maxWidth: 220 }}>
                          <div className="ci-item-name" style={{ fontWeight: 600, fontSize: 13, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 210 }} title={it.description || it.name}>{it.description || it.name || '—'}</div>
                          <span className="ci-item-type-badge" style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                            background: it.item_type === 'service' ? '#dbeafe' : '#dcfce7',
                            color: it.item_type === 'service' ? '#1e40af' : '#166534',
                          }}>
                            {it.item_type === 'service' ? 'Service' : 'Part'}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{it.hsn_sac || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{qty}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(incRate)}</td>
                        {hasDiscount && (
                          <td style={{ textAlign: 'center' }}>
                            {discAmt > 0 ? (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: '#b45309', whiteSpace: 'nowrap' }}>{fmt(discAmt)}</span>
                                <span style={{ fontSize: 11, color: '#92400e', fontWeight: 500, whiteSpace: 'nowrap' }}>
                                  {dType === 'percent' ? `${dValue}%` : 'Flat'}
                                </span>
                              </div>
                            ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          </td>
                        )}
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmt(taxable)}</td>
                        <td style={{ textAlign: 'right' }}>{halfPct > 0 ? `${halfPct.toFixed(1)}%` : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{halfPct > 0 ? `${halfPct.toFixed(1)}%` : '—'}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmt(gstAmt)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Totals ── */}
          <div className="ci-totals-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>

            {/* Amount in words — left */}
            <div style={{
              flex: '1 1 220px', maxWidth: 340,
              background: '#f8fafc', borderRadius: 10,
              padding: '12px 16px', borderLeft: '3px solid #16b994',
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Amount in Words</div>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#374151', fontStyle: 'italic', lineHeight: 1.7 }}>
                {amountToWords(parseFloat(grandTotal))}
              </div>
            </div>

            {/* Summary — right */}
            <div style={{ flex: '0 0 auto', minWidth: 250, display: 'flex', flexDirection: 'column', gap: 0 }}>

              {/* Subtotal */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', padding: '5px 0', borderBottom: '1px solid #f3f4f6' }}>
                <span>Subtotal (ex-GST)</span>
                <span style={{ fontWeight: 600, color: '#374151', minWidth: 100, textAlign: 'right' }}>{fmt(subtotal)}</span>
              </div>

              {/* Total Discount */}
              {hasDiscount && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderBottom: '1px solid #f3f4f6', background: '#fffbeb', margin: '0 -2px', padding: '5px 2px' }}>
                  <span style={{ color: '#b45309', fontWeight: 600 }}>
                    {ciDiscountMode === 'transaction'
                      ? `Discount (${ciTxDiscountType === 'percent' ? ciTxDiscountValue + '%' : '₹' + ciTxDiscountValue})`
                      : 'Total Discount'}
                  </span>
                  <span style={{ fontWeight: 700, color: '#b45309', minWidth: 100, textAlign: 'right' }}>−{fmt(totalDiscount)}</span>
                </div>
              )}

              {/* Tax breakdown */}
              {gstSlabs.length > 0 && (
                <div style={{ padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Tax Breakdown</div>
                  {gstSlabs.map(slab => {
                    const halfLabel = (slab.pct / 2).toFixed(slab.pct % 2 === 0 ? 0 : 1);
                    return (
                      <div key={slab.pct} style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 2 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6b7280' }}>
                          <span>CGST ({halfLabel}%)</span>
                          <span style={{ minWidth: 100, textAlign: 'right' }}>{fmt(slab.cgst)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6b7280' }}>
                          <span>SGST ({halfLabel}%)</span>
                          <span style={{ minWidth: 100, textAlign: 'right' }}>{fmt(slab.sgst)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Grand Total */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 800, color: '#16b994', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                <span>Grand Total</span>
                <span style={{ minWidth: 100, textAlign: 'right' }}>{fmt(grandTotal)}</span>
              </div>

              {/* Paid */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#16a34a', padding: '5px 0', borderBottom: '1px solid #f3f4f6' }}>
                <span style={{ fontWeight: 500 }}>Paid</span>
                <span style={{ fontWeight: 600, minWidth: 100, textAlign: 'right' }}>{fmt(paid)}</span>
              </div>

              {/* Balance Due */}
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 13, fontWeight: 800, padding: '8px 0',
                color: balance > 0.001 ? '#dc2626' : '#16a34a',
              }}>
                <span>Balance Due</span>
                <span style={{ minWidth: 100, textAlign: 'right' }}>{fmt(balance)}</span>
              </div>

            </div>
          </div>

          {/* ── Linked document links — screen only ── */}
          {!isHubUser && (inv?.estimate_id || inv?.linked_purchase_invoice_id) && (
            <div className="ci-internal" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              {inv.estimate_id && (
                <button
                  onClick={() => navigate('/estimates', { state: { openId: inv.estimate_id } })}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                    background: '#f0fdf4', border: '1px solid #86efac',
                    color: '#166534', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                  }}
                >
                  <CheckCircle2 size={13} />
                  View Estimate #EST-{String(inv.estimate_id).padStart(6, '0')}
                </button>
              )}
              {inv.linked_purchase_invoice_id && (
                <button
                  onClick={() => navigate('/purchase-invoices', { state: { openId: inv.linked_purchase_invoice_id } })}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                    background: '#f0f9ff', border: '1px solid #7dd3fc',
                    color: '#0369a1', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                  }}
                >
                  <CheckCircle2 size={13} />
                  View Spinoto Invoice #{inv.linked_purchase_invoice_id}
                </button>
              )}
            </div>
          )}

          {/* Payments section */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Payments</h4>
              <span style={{
                background: 'var(--bg-soft)', border: '1px solid var(--border)',
                borderRadius: 99, padding: '1px 8px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)',
              }}>{payments.length}</span>
            </div>
            {payments.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '8px 0' }}>No payments recorded yet.</div>
            ) : (
              <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border)' }}>
                <table className="ci-table ci-payments-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Method</th>
                      <th>Reference</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      {canDeletePay && <th style={{ width: 40 }}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map(pay => (
                      <tr key={pay.id}>
                        <td style={{ fontSize: 12 }}>{fmtDate(pay.paid_at || pay.created_at)}</td>
                        <td><MethodBadge method={pay.method} /></td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          <div>{pay.reference_no || '—'}</div>
                          {pay.notes && (
                            <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2, fontStyle: 'italic' }}>
                              Note: {pay.notes}
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(pay.amount)}</td>
                        {canDeletePay && (
                          <td>
                            <button
                              className="icon-action icon-action--danger"
                              title="Delete payment"
                              disabled={deletingPayId === pay.id}
                              onClick={() => deletePayment(pay.id)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Add payment form — screen only */}
          {canAddPayment && (
            <div className="ci-internal" style={{
              background: 'var(--bg-soft)', borderRadius: 12, padding: '16px 18px',
              border: '1px solid var(--border)',
            }}>
              <AddPaymentForm
                invoiceId={invoiceId}
                balance={balance}
                showToast={showToast}
                onSuccess={async () => { await load(); onRefreshList(); }}
              />
            </div>
          )}

          {/* ── Invoice Footer ── */}
          <div className="ci-invoice-footer" style={{
            marginTop: 8,
            borderTop: '1px solid #e5e7eb',
            paddingTop: 16,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280' }}>Thank you for your business.</div>
            <div style={{ fontSize: 10, color: '#9ca3af' }}>This is a computer generated invoice and does not require a physical signature.</div>
            {(company?.phone || company?.email) && (
              <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
                {[company.phone && `📞 ${company.phone}`, company.email && `✉ ${company.email}`].filter(Boolean).join('   ·   ')}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Main Page
// ═════════════════════════════════════════════════════════════════════════════
export default function CustomerInvoicesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isHubUser = !!user?.hub_id;

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [search, setSearch] = useState('');
  const [hubFilter, setHubFilter] = useState(() => user?.hub_id ? [String(user.hub_id)] : []);
  const [showHubDropdown, setShowHubDropdown] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState('');
  const [hubs, setHubs] = useState([]);

  // Auto-open a specific invoice if navigated here from Estimates page
  const [selectedId, setSelectedId] = useState(() => location.state?.openId ?? null);
  const [showVehHistory, setShowVehHistory] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg, type = 'success') => setToast({ msg, type }), []);

  useEffect(() => {
    api('/api/hubs?is_active=true&limit=100')
      .then(r => setHubs(r.items || []))
      .catch(() => { });
  }, []);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (search.trim()) q.set('search', search.trim());
      if (hubFilter.length > 0) q.set('hub_ids', hubFilter.join(','));
      if (statusFilter) q.set('status', statusFilter);
      if (vehicleTypeFilter) q.set('vehicle_type', vehicleTypeFilter);
      q.set('page', page);
      q.set('limit', pageSize);
      const res = await api(`/api/customer-invoices?${q.toString()}`);
      setItems(res.items || []);
      setTotal(res.total ?? (res.items || []).length);
    } catch {
      showToast('Failed to load customer invoices.', 'error');
    } finally {
      setLoading(false);
    }
  }, [search, hubFilter, statusFilter, vehicleTypeFilter, page, pageSize, showToast]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  return (
    <div className="ci-page">
      {/* ── Header ── */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        {selectedId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="btn btn-ghost"
              onClick={() => setSelectedId(null)}
              style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <ChevronLeft size={16} />
              All Customer Invoices
            </button>
            <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10, fontSize: 18 }}>
              <Receipt size={20} style={{ color: 'var(--primary)' }} />
              Invoice Detail
            </h2>
          </div>
        ) : (
          <div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <Receipt size={22} style={{ color: 'var(--primary)' }} />
              Customer Invoices
            </h2>
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
              Invoices sent to customers
            </p>
          </div>
        )}
        {!selectedId && (
          <button
            className="btn btn-ghost"
            onClick={() => setShowVehHistory(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
          >
            <Car size={15} /> Vehicle History
          </button>
        )}
      </div>

      {showVehHistory && <VehicleHistoryModal onClose={() => setShowVehHistory(false)} />}

      {selectedId ? (
        /* ── Full-page Detail View ── */
        <DetailDrawer
          invoiceId={selectedId}
          onClose={() => setSelectedId(null)}
          showToast={showToast}
          onRefreshList={fetchInvoices}
        />
      ) : (
        <>
          {/* Filters */}
          <div className="card" style={{ padding: '14px 18px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', overflow: 'visible' }}>
            <div style={{ position: 'relative', flex: '1 1 220px' }}>
              <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                className="form-input"
                style={{ paddingLeft: 32 }}
                placeholder="Search invoices…"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            {!isHubUser && (
              <div style={{ position: 'relative', flex: '0 0 180px' }}>
                <button
                  type="button"
                  className="form-input"
                  style={{ width: '100%', textAlign: 'left', background: 'var(--bg)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  onClick={() => setShowHubDropdown(p => !p)}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {hubFilter.length === 0 
                      ? 'All Hubs' 
                      : `${hubFilter.length} Hubs Selected`}
                  </span>
                  <ChevronDown size={14} style={{ opacity: 0.5 }} />
                </button>
                
                {showHubDropdown && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setShowHubDropdown(false)} />
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
                      background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
                      boxShadow: '0 8px 16px rgba(0,0,0,0.1)', zIndex: 1000, maxH: 220,
                      overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 4
                    }}>
                      {hubs.map(h => {
                        const isChecked = hubFilter.includes(String(h.id));
                        return (
                          <label 
                            key={h.id} 
                            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer', borderRadius: 4, userSelect: 'none' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-soft)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                const newIds = isChecked
                                  ? hubFilter.filter(id => id !== String(h.id))
                                  : [...hubFilter, String(h.id)];
                                setHubFilter(newIds);
                                setPage(1);
                              }}
                            />
                            <span style={{ fontSize: 13, color: 'var(--text)' }}>{h.hub_name || h.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
            <select
              className="form-input"
              style={{ flex: '0 0 140px' }}
              value={vehicleTypeFilter}
              onChange={e => { setVehicleTypeFilter(e.target.value); setPage(1); }}
            >
              <option value="">All Vehicles</option>
              <option value="2W">2W Only</option>
              <option value="4W">4W Only</option>
            </select>
            <select
              className="form-input"
              style={{ flex: '0 0 180px' }}
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            >
              <option value="">All statuses</option>
              <option value="generated">Generated</option>
              <option value="approved">Approved</option>
              <option value="partially_paid">Partially Paid</option>
              <option value="paid">Paid</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <button className="btn btn-ghost" onClick={fetchInvoices} title="Refresh" style={{ flexShrink: 0 }}>
              <RefreshCw size={15} />
            </button>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {total} invoice{total !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Table */}
          <div className="card" style={{ overflowX: 'auto' }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
            ) : items.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                <Receipt size={32} style={{ opacity: 0.3, marginBottom: 10 }} />
                <p style={{ margin: 0 }}>No customer invoices found.</p>
              </div>
            ) : (
              <div className="ci-table-wrap">
                <table className="ci-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Customer</th>
                      <th>Vehicle</th>
                      <th>Hub</th>
                      <th>Date</th>
                      <th style={{ textAlign: 'right' }}>Grand Total</th>
                      <th style={{ textAlign: 'right' }}>Paid</th>
                      <th style={{ textAlign: 'right' }}>Balance</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(inv => {
                      const gt = parseFloat(inv.grand_total ?? 0);
                      const pd = parseFloat(inv.amount_paid ?? 0);
                      const bal = Math.max(0, gt - pd);
                      return (
                        <tr key={inv.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(inv.id)}>
                          <td style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: 12 }}>{inv.id}</td>
                          <td>
                            <div
                              className="ci-cust-link"
                              onClick={(e) => {
                                  e.stopPropagation();
                                  navigate('/customers', { state: { openMobile: inv.mobile } });
                              }}
                            >
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 13 }} className="ci-cust-name">{inv.customer_name || '—'}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{inv.mobile || ''}</div>
                              </div>
                              <span className="ci-cust-arrow">→</span>
                            </div>
                          </td>
                          <td style={{ fontSize: 13 }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontWeight: 600 }}>{inv.vehicle_number || '—'}</span>
                                {inv.vehicle_type_name && (
                                  <span style={{
                                    fontSize: 9,
                                    fontWeight: 800,
                                    padding: '1px 5px',
                                    borderRadius: 4,
                                    background: inv.vehicle_type_name.toLowerCase().includes('2') ? '#dbeafe' : '#dcfce7',
                                    color: inv.vehicle_type_name.toLowerCase().includes('2') ? '#1e40af' : '#15803d',
                                    border: `1px solid ${inv.vehicle_type_name.toLowerCase().includes('2') ? '#bfdbfe' : '#bbf7d0'}`
                                  }}>
                                    {inv.vehicle_type_name.toLowerCase().includes('2') ? '2W' : '4W'}
                                  </span>
                                )}
                              </div>
                              {(inv.make_name || inv.model_name) && (
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                  {[inv.make_name, inv.model_name].filter(Boolean).join(' ')}
                                </div>
                              )}
                            </div>
                          </td>
                          <td style={{ fontSize: 13 }}>{inv.hub_full_name || inv.hub_name || inv.hub?.name || '—'}</td>
                          <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>{fmtDate(inv.created_at)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 13 }}>{fmt(gt)}</td>
                          <td style={{ textAlign: 'right', fontSize: 13, color: '#166534', fontWeight: 600 }}>{fmt(pd)}</td>
                          <td style={{
                            textAlign: 'right', fontWeight: 700, fontSize: 13,
                            color: bal > 0.001 ? '#dc2626' : '#6b7280',
                          }}>{fmt(bal)}</td>
                          <td><StatusBadge status={inv.status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <PaginationBar
            page={page} total={total} pageSize={pageSize}
            onPage={setPage}
            onPageSize={n => { setPageSize(n); setPage(1); }}
            noun="invoice"
          />
        </>
      )}

      {/* Toast */}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Styles
