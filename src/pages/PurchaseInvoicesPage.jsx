import { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';
import PaginationBar from '../components/PaginationBar.jsx';
import {
  ReceiptText, Search, RefreshCw, X, Eye,
  AlertCircle, CheckCircle2, Clock, Trash2, ChevronLeft, Printer, FileText, MoreVertical,
} from 'lucide-react';
import '../styles/PurchaseInvoicesPage.css';

// ── Method badge ──────────────────────────────────────────────────────────────
const METHOD_COLORS = {
  cash:          { bg: '#f3f4f6', color: '#374151' },
  upi:           { bg: '#dbeafe', color: '#1e40af' },
  card:          { bg: '#ede9fe', color: '#5b21b6' },
  bank_transfer: { bg: '#dcfce7', color: '#166534' },
  other:         { bg: '#f3f4f6', color: '#6b7280' },
};
function MethodBadge({ method }) {
  const m = METHOD_COLORS[method] || METHOD_COLORS.other;
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: m.bg, color: m.color, textTransform: 'capitalize' }}>
      {method?.replace('_', ' ')}
    </span>
  );
}

// ── Hub Payment Form ──────────────────────────────────────────────────────────
function HubPaymentForm({ invoiceId, balance, onSuccess }) {
  const [form, setForm] = useState({ amount: '', method: 'bank_transfer', reference_no: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);
  const field = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return; }
    if (amt > balance + 0.01) { setError(`Amount exceeds balance ₹${balance.toFixed(2)}`); return; }
    setSaving(true); setError(null);
    try {
      await api(`/api/purchase-invoices/${invoiceId}/payments`, {
        method: 'POST',
        body: {
          amount:       amt,
          method:       form.method,
          reference_no: form.reference_no.trim() || null,
          notes:        form.notes.trim() || null,
        },
      });
      setForm({ amount: '', method: 'bank_transfer', reference_no: '', notes: '' });
      onSuccess();
    } catch (err) {
      setError(err.message || 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Record Hub Payment</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="form-field">
          <label style={{ fontSize: 12 }}>Amount (₹) *</label>
          <input className="form-input" type="number" min="0.01" step="0.01" placeholder={`Max ₹${balance.toFixed(2)}`} value={form.amount} onChange={field('amount')} required />
        </div>
        <div className="form-field">
          <label style={{ fontSize: 12 }}>Method</label>
          <select className="form-input" value={form.method} onChange={field('method')}>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="upi">UPI</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="form-field">
          <label style={{ fontSize: 12 }}>Reference No</label>
          <input className="form-input" placeholder="UTR / Cheque no…" value={form.reference_no} onChange={field('reference_no')} />
        </div>
        <div className="form-field">
          <label style={{ fontSize: 12 }}>Notes</label>
          <input className="form-input" placeholder="Optional" value={form.notes} onChange={field('notes')} />
        </div>
      </div>
      {error && (
        <div style={{ color: '#dc2626', fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          <AlertCircle size={13} />{error}
        </div>
      )}
      <button type="submit" className="btn btn-primary" disabled={saving} style={{ alignSelf: 'flex-end' }}>
        {saving ? 'Recording…' : 'Record Payment'}
      </button>
    </form>
  );
}

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
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
                 'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen',
                 'Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function words(n) {
    if (n === 0) return '';
    if (n < 20) return ones[n] + ' ';
    if (n < 100) return tens[Math.floor(n/10)] + (n%10 ? ' ' + ones[n%10] : '') + ' ';
    if (n < 1000) return ones[Math.floor(n/100)] + ' Hundred ' + words(n%100);
    if (n < 100000) return words(Math.floor(n/1000)) + 'Thousand ' + words(n%1000);
    if (n < 10000000) return words(Math.floor(n/100000)) + 'Lakh ' + words(n%100000);
    return words(Math.floor(n/10000000)) + 'Crore ' + words(n%10000000);
  }
  const num = Math.round(Math.abs(amount || 0));
  const paise = Math.round((Math.abs(amount || 0) - num) * 100);
  let result = (words(num) || 'Zero ').trim() + ' Rupees';
  if (paise > 0) result += ' and ' + words(paise).trim() + ' Paise';
  return result + ' Only';
}

// ── Status config ─────────────────────────────────────────────────────────────
const PAYMENT_STATUS_META = {
  pending:        { bg: '#f3f4f6', color: '#374151', label: 'Unpaid'     },
  partially_paid: { bg: '#fef3c7', color: '#92400e', label: 'Part Paid'  },
  paid:           { bg: '#dcfce7', color: '#166534', label: 'Paid'       },
};

function PaymentStatusBadge({ status }) {
  const m = PAYMENT_STATUS_META[status] || PAYMENT_STATUS_META.pending;
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 99,
      fontSize: 11, fontWeight: 700, background: m.bg, color: m.color,
      whiteSpace: 'nowrap',
    }}>{m.label}</span>
  );
}

const STATUS_META = {
  pending_approval: { bg: '#fef3c7', color: '#92400e', label: 'Pending Approval' },
  approved:         { bg: '#dcfce7', color: '#166534', label: 'Approved'          },
  cancelled:        { bg: '#fee2e2', color: '#991b1b', label: 'Cancelled'         },
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

// ── Info row helper ───────────────────────────────────────────────────────────
function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 14, color: 'var(--text)', fontWeight: 500 }}>{value || '—'}</span>
    </div>
  );
}

// ── Detail Drawer ─────────────────────────────────────────────────────────────
function DetailDrawer({ invoiceId, onClose, showToast, onRefreshList, isHubUser = false }) {
  const navigate = useNavigate();
  const [inv, setInv]             = useState(null);
  const [loading, setLoading]     = useState(true);
  const [approving, setApproving] = useState(false);
  const [company, setCompany]     = useState(null);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [payoutSchedule, setPayoutSchedule]     = useState('lump_sum');
  const [recalculating, setRecalculating]       = useState(false);
  const [approvalItemRates, setApprovalItemRates] = useState({}); // { [item_id]: rateStr }
  const [showEditModal, setShowEditModal]         = useState(false);
  const [editItemRates, setEditItemRates]         = useState({});
  const [editBusy, setEditBusy]                   = useState(false);
  const [showKebab, setShowKebab]                 = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, co] = await Promise.all([
        api(`/api/purchase-invoices/${invoiceId}`),
        api('/api/settings/company').catch(() => null),
      ]);
      setInv(res.item || res);
      if (co) setCompany(co);
    } catch {
      showToast('Failed to load purchase invoice.', 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  }, [invoiceId, showToast, onClose]);

  useEffect(() => { load(); }, [load]);

  async function handleRecalculate() {
    if (!window.confirm('Recalculate hub rates using the new formula (Hub Rate = Customer Rate − Take Rate deduction)? This will update all line items.')) return;
    setRecalculating(true);
    try {
      await api(`/api/purchase-invoices/${invoiceId}/recalculate`, { method: 'POST' });
      showToast('Invoice recalculated successfully.');
      await load();
      onRefreshList();
    } catch (err) {
      showToast(err.message || 'Recalculation failed.', 'error');
    } finally {
      setRecalculating(false);
    }
  }

  function openApproveModal() {
    // Pre-fill per-item rates from current stored values
    const rates = {};
    (inv?.items || []).forEach(it => {
      rates[it.id] = String(parseFloat(it.commission_percent ?? 0));
    });
    setApprovalItemRates(rates);
    setPayoutSchedule('lump_sum');
    setShowApproveModal(true);
  }

  function openEditModal() {
    const rates = {};
    (inv?.items || []).forEach(it => {
      rates[it.id] = String(parseFloat(it.commission_percent ?? 0));
    });
    setEditItemRates(rates);
    setShowEditModal(true);
  }

  async function handleEditSave() {
    setEditBusy(true);
    try {
      const item_rates = Object.entries(editItemRates).map(([id, rate]) => ({
        item_id:   Number(id),
        take_rate: parseFloat(rate) || 0,
      }));
      const res = await api(`/api/purchase-invoices/${invoiceId}`, { method: 'PATCH', body: { item_rates } });
      setInv(res.item);
      setShowEditModal(false);
      showToast('Purchase invoice updated.');
      onRefreshList();
    } catch (err) {
      showToast(err.message || 'Update failed.', 'error');
    } finally {
      setEditBusy(false);
    }
  }

  async function handleApprove() {
    setApproving(true);
    try {
      const body = { payout_schedule: payoutSchedule };
      // Send per-item rates
      body.item_rates = Object.entries(approvalItemRates).map(([id, rate]) => ({
        item_id: Number(id),
        take_rate: parseFloat(rate) || 0,
      }));
      await api(`/api/purchase-invoices/${invoiceId}/approve`, { method: 'POST', body });
      showToast('Purchase invoice approved. Payout schedule set — Customer Invoice can now be generated.');
      setShowApproveModal(false);
      await load();
      onRefreshList();
    } catch (err) {
      showToast(err.message || 'Approval failed.', 'error');
    } finally {
      setApproving(false);
    }
  }

  async function handleDeleteHubPayment(invoiceId, payId) {
    try {
      const res = await api(`/api/purchase-invoices/${invoiceId}/payments/${payId}`, { method: 'DELETE' });
      setInv(res.item);
      onRefreshList();
      showToast('Payment deleted.');
    } catch (err) {
      showToast(err.message || 'Failed to delete payment.', 'error');
    }
  }

  function refreshDrawer() {
    api(`/api/purchase-invoices/${invoiceId}`)
      .then(res => {
        setInv(res.item || res);
        onRefreshList();
      })
      .catch(() => {});
  }

  const items = inv?.items || [];
  const commPct = parseFloat(inv?.commission_percent ?? 0);

  // Totals + dynamic GST slab grouping
  const subtotal   = items.reduce((s, it) => s + (parseFloat(it.hub_rate ?? 0) * parseFloat(it.quantity ?? 1)), 0);
  const totalGst   = items.reduce((s, it) => s + parseFloat(it.gst_amount ?? 0), 0);
  const grandTotal = parseFloat(inv?.grand_total ?? (subtotal + totalGst));
  const paid       = parseFloat(inv?.amount_paid ?? 0);
  const balance    = Math.max(0, grandTotal - paid);

  const gstSlabMap = {};
  items.forEach(it => {
    const pct    = parseFloat(it.gst_percent ?? 0);
    const gstAmt = parseFloat(it.gst_amount  ?? 0);
    if (pct > 0 && gstAmt > 0) {
      const key = pct.toString();
      if (!gstSlabMap[key]) gstSlabMap[key] = { pct, cgst: 0, sgst: 0 };
      gstSlabMap[key].cgst += gstAmt / 2;
      gstSlabMap[key].sgst += gstAmt / 2;
    }
  });
  const gstSlabs = Object.values(gstSlabMap).sort((a, b) => b.pct - a.pct);

  return (
    <div className="card est-detail-view">

      {/* ── Print header — hidden on screen, shown when printing ── */}
      <div className="est-print-header">
        <div style={{ flex: 1 }}>
          {company?.company_name ? (
            <>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#111', marginBottom: 4 }}>
                {company.company_name.toUpperCase()}
              </div>
              {company.address_line1 && <div style={{ fontSize: 12, color: '#555' }}>{company.address_line1}</div>}
              {company.address_line2 && <div style={{ fontSize: 12, color: '#555' }}>{company.address_line2}</div>}
              {(company.city || company.state || company.pincode) && (
                <div style={{ fontSize: 12, color: '#555' }}>
                  {[company.city, company.state, company.pincode].filter(Boolean).join(', ')}
                </div>
              )}
              {company.phone && <div style={{ fontSize: 12, color: '#555' }}>Phone: {company.phone}</div>}
              {company.gstin && <div style={{ fontSize: 12, color: '#555' }}>GSTIN: {company.gstin}</div>}
            </>
          ) : (
            <div style={{ fontSize: 13, color: '#888', fontStyle: 'italic' }}>Company details not set</div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#111' }}>
            {isHubUser ? 'SELL INVOICE' : 'PURCHASE INVOICE'}
          </div>
          {inv && <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>PI-{String(inv.id).padStart(6, '0')}</div>}
          {inv && <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>{fmtDate(inv.created_at)}</div>}
        </div>
      </div>

      {/* ── Screen header bar — hidden when printing ── */}
      <div className="est-detail-header est-screen-only">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ReceiptText size={18} style={{ color: 'var(--primary)' }} />
          <span style={{ fontWeight: 700, fontSize: 16 }}>
            {isHubUser ? 'Sell Invoice' : 'Purchase Invoice'} {inv ? `#${inv.id}` : ''}
          </span>
          {inv && <StatusBadge status={inv.status} />}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            className="btn btn-ghost"
            onClick={() => window.print()}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontSize: 13 }}
            title="Print / Save as PDF"
          >
            <Printer size={15} /> Print / PDF
          </button>
          {/* Kebab menu */}
          {inv && inv.status === 'approved' && parseFloat(inv.amount_paid ?? 0) === 0 && (
            <div style={{ position: 'relative' }}>
              {showKebab && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setShowKebab(false)} />
              )}
              <button
                className="btn btn-ghost"
                onClick={() => setShowKebab(p => !p)}
                style={{ padding: '6px 8px', display: 'flex', alignItems: 'center' }}
                title="More actions"
              >
                <MoreVertical size={16} />
              </button>
              {showKebab && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 4,
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.13)',
                  minWidth: 170, zIndex: 1000, overflow: 'hidden',
                }}>
                  <button
                    style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-soft)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    onClick={() => { setShowKebab(false); openEditModal(); }}
                  >
                    <FileText size={14} /> Edit Rates
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <Clock size={28} style={{ opacity: 0.3, marginBottom: 10 }} />
            <p style={{ margin: 0 }}>Loading…</p>
          </div>
        ) : !inv ? null : (
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Info grid — two-column layout */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, background: 'var(--bg-soft)', borderRadius: 12, overflow: 'hidden' }}>
              {/* Left: hub + customer */}
              <div style={{ padding: '16px 20px', borderRight: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Hub Details</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {[
                    { label: 'Hub',        value: inv.hub_name },
                    { label: 'Customer',   value: inv.customer_name },
                    { label: 'Mobile',     value: inv.mobile },
                    { label: 'Commission', value: inv?.rate_mode === 'tech_rate' ? 'Take Rate Mode' : `${commPct}%` },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: 'flex' }}>
                      <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500, width: 88, flexShrink: 0 }}>{label}</span>
                      <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{value || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Right: vehicle + invoice meta */}
              <div style={{ padding: '16px 20px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Vehicle & Invoice</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <div style={{ display: 'flex' }}>
                    <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500, width: 90, flexShrink: 0 }}>Reg. No.</span>
                    <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{inv.vehicle_number || '—'}</span>
                  </div>
                  {(inv.make_name || inv.model_name) && (
                    <div style={{ display: 'flex' }}>
                      <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500, width: 90, flexShrink: 0 }}>Make / Model</span>
                      <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{[inv.make_name, inv.model_name].filter(Boolean).join(' ')}</span>
                    </div>
                  )}
                  {inv.body_type_name && (
                    <div style={{ display: 'flex' }}>
                      <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500, width: 90, flexShrink: 0 }}>Body Type</span>
                      <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>
                        {inv.body_type_name}{inv.segment_names ? ` (${inv.segment_names})` : ''}
                      </span>
                    </div>
                  )}
                  {inv.cc_category_name && (
                    <div style={{ display: 'flex' }}>
                      <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500, width: 90, flexShrink: 0 }}>CC Category</span>
                      <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{inv.cc_category_name}{inv.engine_cc ? ` (${inv.engine_cc} cc)` : ''}</span>
                    </div>
                  )}
                  {[
                    { label: 'Invoice No.', value: `PI-${String(inv.id).padStart(6, '0')}` },
                    { label: 'Date',        value: fmtDate(inv.created_at) },
                    { label: 'Status',      node: <StatusBadge status={inv.status} /> },
                  ].map(({ label, value, node }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500, width: 90, flexShrink: 0 }}>{label}</span>
                      {node ?? <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{value || '—'}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Line items */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Line Items</div>
                {/* Rate mode badge — screen only, hidden on print */}
                {inv?.rate_mode === 'tech_rate' ? (
                  <span className="pi-no-print" style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 99, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                    Take Rate Mode
                  </span>
                ) : (
                  <span className="pi-no-print" style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 99, background: '#dbeafe', color: '#1e40af', border: '1px solid #bfdbfe' }}>
                    Commission Mode
                  </span>
                )}
              </div>
              <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border)' }}>
                <table className="pi-table pi-items-table" style={{ minWidth: inv?.rate_mode === 'tech_rate' ? 960 : 860 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 36, textAlign: 'center' }}>Sr.</th>
                      <th style={{ minWidth: 160, maxWidth: 220 }}>Item</th>
                      <th style={{ textAlign: 'right' }}>Qty</th>
                      <th style={{ textAlign: 'right' }}>Cust. Rate</th>
                      <th style={{ textAlign: 'right' }}>
                        {inv?.rate_mode === 'tech_rate' ? 'Take Rate %' : 'Commission %'}
                      </th>
                      {inv?.rate_mode === 'tech_rate' && (
                        <th style={{ textAlign: 'right', color: '#dc2626' }}>Discount</th>
                      )}
                      <th style={{ textAlign: 'right' }}>Hub Rate</th>
                      <th style={{ textAlign: 'right' }}>CGST %</th>
                      <th style={{ textAlign: 'right' }}>SGST %</th>
                      <th style={{ textAlign: 'right' }}>Tax Amt</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr><td colSpan={inv?.rate_mode === 'tech_rate' ? 11 : 10} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>No items</td></tr>
                    ) : items.map((it, i) => {
                      const custRate     = parseFloat(it.customer_rate ?? 0);
                      const hubRate      = parseFloat(it.hub_rate ?? 0);
                      const qty          = parseFloat(it.quantity ?? 1);
                      const gstAmt       = parseFloat(it.gst_amount ?? 0);
                      const gstPct       = parseFloat(it.gst_percent ?? 0);
                      const halfPct      = gstPct / 2;
                      const appliedRate  = parseFloat(it.commission_percent ?? 0); // holds tech rate % or commission %
                      const discountAmt  = parseFloat(((custRate - hubRate) * qty).toFixed(2)); // tech deduction amount
                      const isService    = it.item_type === 'service';
                      return (
                        <tr key={i}>
                          <td style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{i + 1}</td>
                          <td style={{ maxWidth: 220 }}>
                            <div className="pi-item-name" style={{ fontWeight: 600, fontSize: 13, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 210 }} title={it.description || it.name}>{it.description || it.name || '—'}</div>
                            <span className="pi-item-type-badge" style={{
                              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                              background: isService ? '#dbeafe' : '#dcfce7',
                              color: isService ? '#1e40af' : '#166534',
                            }}>{isService ? 'Service' : 'Part'}</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>{qty}</td>
                          <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 12 }}>{fmt(custRate)}</td>
                          <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600,
                            color: inv?.rate_mode === 'tech_rate' ? '#92400e' : '#1e40af' }}>
                            {appliedRate > 0 ? `${appliedRate}%` : '—'}
                          </td>
                          {inv?.rate_mode === 'tech_rate' && (
                            <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#dc2626' }}>
                              − {fmt(discountAmt / qty)}
                            </td>
                          )}
                          <td style={{ textAlign: 'right', fontWeight: 600, color: '#166534' }}>{fmt(hubRate)}</td>
                          <td style={{ textAlign: 'right', fontSize: 12 }}>{gstPct > 0 ? `${halfPct.toFixed(halfPct % 1 === 0 ? 0 : 1)}%` : '—'}</td>
                          <td style={{ textAlign: 'right', fontSize: 12 }}>{gstPct > 0 ? `${halfPct.toFixed(halfPct % 1 === 0 ? 0 : 1)}%` : '—'}</td>
                          <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmt(gstAmt)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(hubRate * qty + gstAmt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="pi-no-print" style={{ margin: '8px 0 0', fontSize: 12, fontStyle: 'italic', color: 'var(--text-muted)' }}>
                {inv?.rate_mode === 'tech_rate'
                  ? 'Discount = Customer Rate × Take Rate%  |  Hub Rate = Customer Rate − Discount  (services use Service Take Rate, parts use Parts Take Rate)'
                  : 'Hub Rate = Customer Rate × (1 − Commission%)'}
              </p>
            </div>

            {/* ── Totals ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderTop: '1px solid var(--border)', paddingTop: 16, gap: 24, flexWrap: 'wrap' }}>

              {/* Amount in words — left */}
              <div style={{
                flex: '1 1 220px', maxWidth: 340,
                background: '#f8fafc', borderRadius: 10,
                padding: '12px 16px', borderLeft: '3px solid #16b994',
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Amount in Words</div>
                <div style={{ fontSize: 11, fontWeight: 500, color: '#374151', fontStyle: 'italic', lineHeight: 1.7 }}>
                  {amountToWords(grandTotal)}
                </div>
              </div>

              {/* Summary — right */}
              <div style={{ flex: '0 0 auto', minWidth: 260, display: 'flex', flexDirection: 'column', gap: 0 }}>

                {/* Subtotal */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', padding: '5px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <span>Subtotal (hub ex-GST)</span>
                  <span style={{ fontWeight: 600, color: '#374151', minWidth: 110, textAlign: 'right' }}>{fmt(subtotal)}</span>
                </div>

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
                            <span style={{ minWidth: 110, textAlign: 'right' }}>{fmt(slab.cgst)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6b7280' }}>
                            <span>SGST ({halfLabel}%)</span>
                            <span style={{ minWidth: 110, textAlign: 'right' }}>{fmt(slab.sgst)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Grand Total */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 800, color: '#16b994', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <span>Grand Total Payable to Hub</span>
                  <span style={{ minWidth: 110, textAlign: 'right' }}>{fmt(grandTotal)}</span>
                </div>

                {/* Paid — only when approved */}
                {inv.status === 'approved' && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#16a34a', padding: '5px 0', borderBottom: '1px solid #f3f4f6' }}>
                      <span style={{ fontWeight: 500 }}>Paid to Hub</span>
                      <span style={{ fontWeight: 600, minWidth: 110, textAlign: 'right' }}>{fmt(paid)}</span>
                    </div>
                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      fontSize: 13, fontWeight: 800, padding: '8px 0',
                      color: balance > 0.001 ? '#dc2626' : '#16a34a',
                    }}>
                      <span>Balance Due</span>
                      <span style={{ minWidth: 110, textAlign: 'right' }}>{fmt(balance)}</span>
                    </div>
                  </>
                )}

              </div>
            </div>

            {/* ── Payout Info — screen only ── */}
            {(inv.payout_due_date || inv.payout_schedule) && (
              <div className="pi-no-print" style={{
                background: 'var(--bg-soft)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '14px 18px',
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Payout Terms</div>
                <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginBottom: inv.schedule?.length ? 14 : 0 }}>
                  {inv.payout_due_date && (
                    <div>
                      <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500 }}>Due Date</div>
                      <div style={{
                        fontSize: 13, fontWeight: 700,
                        color: new Date(inv.payout_due_date) < new Date() && inv.payment_status !== 'paid' ? '#dc2626' : 'var(--text)',
                      }}>
                        {fmtDate(inv.payout_due_date)}
                        {new Date(inv.payout_due_date) < new Date() && inv.payment_status !== 'paid' && (
                          <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, background: '#fee2e2', color: '#991b1b', padding: '2px 7px', borderRadius: 99 }}>OVERDUE</span>
                        )}
                      </div>
                    </div>
                  )}
                  {inv.payout_schedule && (
                    <div>
                      <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500 }}>Schedule</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', textTransform: 'capitalize' }}>
                        {inv.payout_schedule === 'split' ? '3 Installments' : 'Lump Sum'}
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500 }}>Payment Status</div>
                    <div><PaymentStatusBadge status={inv.payment_status || 'pending'} /></div>
                  </div>
                </div>

                {/* Installment Schedule */}
                {inv.schedule?.length > 0 && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        {['Installment', 'Due Date', 'Amount Due', 'Paid', 'Balance', 'Status'].map(h => (
                          <th key={h} style={{ padding: '7px 10px', background: '#f3f4f6', textAlign: h === 'Installment' ? 'center' : 'left', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {inv.schedule.map(inst => {
                        const bal = parseFloat(inst.amount_due) - parseFloat(inst.paid_amount || 0);
                        const isOverdue = new Date(inst.due_date) < new Date() && inst.status !== 'paid';
                        return (
                          <tr key={inst.id}>
                            <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'center', fontWeight: 700, color: '#6b7280' }}>#{inst.installment_no}</td>
                            <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', color: isOverdue ? '#dc2626' : 'var(--text)', fontWeight: isOverdue ? 700 : 400 }}>{fmtDate(inst.due_date)}</td>
                            <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{fmt(inst.amount_due)}</td>
                            <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', color: '#16a34a', fontWeight: 600 }}>{fmt(inst.paid_amount)}</td>
                            <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontWeight: 700, color: bal > 0.01 ? '#dc2626' : '#16a34a' }}>{fmt(bal)}</td>
                            <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
                              <PaymentStatusBadge status={inst.status} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* ── Linked document links — screen only ── */}
            <div className="pi-no-print" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
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
                  <ReceiptText size={13} />
                  View Estimate #EST-{String(inv.estimate_id).padStart(6, '0')}
                </button>
              )}
              {inv.customer_invoice_id && (
                <button
                  onClick={() => navigate('/customer-invoices', { state: { openId: inv.customer_invoice_id } })}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                    background: '#f0f9ff', border: '1px solid #7dd3fc',
                    color: '#0369a1', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                  }}
                >
                  <CheckCircle2 size={13} />
                  View Customer Invoice #{inv.customer_invoice_id}
                </button>
              )}
            </div>

            {/* Actions — screen only */}
            <div className="pi-no-print" style={{ paddingBottom: 8, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {inv.status === 'pending_approval' && (
                <button
                  className="btn btn-amber"
                  onClick={openApproveModal}
                >
                  <CheckCircle2 size={15} />
                  Approve Purchase Invoice
                </button>
              )}
              {inv.status === 'approved' && (
                <>
                  <div style={{ color: '#166534', fontWeight: 500, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CheckCircle2 size={15} />
                    Approved{inv.approved_at ? ` on ${fmtDate(inv.approved_at)}` : ''}{inv.approved_by_name ? ` by ${inv.approved_by_name}` : ''}
                  </div>
                </>
              )}
              {inv.status === 'cancelled' && (
                <div style={{ color: '#991b1b', fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <X size={15} />
                  Cancelled
                </div>
              )}
            </div>

            {/* ── Hub Payments — screen only ── */}
            {inv.status === 'approved' && (
              <div className="pi-no-print" style={{ marginTop: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
                    Hub Payments
                    {inv.hub_payments?.length > 0 && (
                      <span style={{ marginLeft: 8, background: '#f3f4f6', color: '#374151', borderRadius: 99, fontSize: 11, fontWeight: 700, padding: '2px 8px' }}>
                        {inv.hub_payments.length}
                      </span>
                    )}
                  </h4>
                </div>

                {/* Payment history table */}
                {inv.hub_payments?.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
                    <thead>
                      <tr>
                        {['Date', 'Method', 'Reference', 'Amount', ''].map(h => (
                          <th key={h} style={{ padding: '8px 10px', background: 'var(--bg-soft)', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {inv.hub_payments.map(pay => (
                        <tr key={pay.id}>
                          <td style={{ padding: '9px 10px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                            {new Date(pay.paid_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </td>
                          <td style={{ padding: '9px 10px', borderBottom: '1px solid var(--border)' }}>
                            <MethodBadge method={pay.method} />
                          </td>
                          <td style={{ padding: '9px 10px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
                            {pay.reference_no || '—'}
                          </td>
                          <td style={{ padding: '9px 10px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>
                            ₹{Number(pay.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </td>
                          <td style={{ padding: '9px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>
                            {inv.payment_status !== 'paid' && (
                              <button
                                onClick={() => handleDeleteHubPayment(inv.id, pay.id)}
                                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', color: '#dc2626' }}
                                title="Delete payment"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 16px' }}>No payments recorded yet.</p>
                )}

                {/* Add Payment form — only if not fully paid */}
                {inv.payment_status !== 'paid' && (
                  <HubPaymentForm
                    invoiceId={inv.id}
                    balance={Number(inv.grand_total ?? grandTotal) - Number(inv.amount_paid ?? 0)}
                    onSuccess={refreshDrawer}
                  />
                )}
              </div>
            )}

            {/* ── Invoice Footer ── */}
            <div className="pi-invoice-footer" style={{
              marginTop: 8, borderTop: '1px solid #e5e7eb', paddingTop: 16,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
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

      {/* ── Edit Rates modal ── */}
      {showEditModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => !editBusy && setShowEditModal(false)}>
          <div style={{
            background: 'var(--bg)', borderRadius: 14, padding: 28,
            width: '100%', maxWidth: 680, boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Edit Take Rates</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              Adjust take rate per item — hub rate updates live.
            </div>

            {(inv?.items || []).length > 0 && (() => {
              let previewGrandTotal = 0;
              const rows = (inv?.items || []).map(it => {
                const custRate  = parseFloat(it.customer_rate ?? 0);
                const qty       = parseFloat(it.quantity ?? 1);
                const gstPct    = parseFloat(it.gst_percent ?? 0);
                const takeRate  = parseFloat(editItemRates[it.id] ?? it.commission_percent ?? 0);
                const discount  = parseFloat((custRate * (takeRate / 100)).toFixed(4));
                const hubRate   = parseFloat((custRate - discount).toFixed(4));
                const hubAmount = parseFloat((hubRate * qty).toFixed(2));
                const gstAmt    = parseFloat((hubAmount * gstPct / 100).toFixed(2));
                const total     = parseFloat((hubAmount + gstAmt).toFixed(2));
                previewGrandTotal += total;
                return { it, custRate, qty, takeRate, discount, hubRate, total };
              });

              return (
                <div style={{ marginBottom: 20 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-soft,#f3f4f6)' }}>
                        <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' }}>Item</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' }}>Cust. Rate</th>
                        <th style={{ textAlign: 'center', padding: '8px 10px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' }}>Take Rate %</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' }}>Discount</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' }}>Hub Rate</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ it, custRate, takeRate, discount, hubRate, total }) => (
                        <tr key={it.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '10px 10px' }}>
                            <div style={{ fontWeight: 600, color: 'var(--text)' }}>{it.description || it.name}</div>
                            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                              background: it.item_type === 'service' ? '#eff6ff' : '#fef3c7',
                              color: it.item_type === 'service' ? '#1e40af' : '#92400e' }}>
                              {it.item_type === 'service' ? 'Service' : 'Part'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', padding: '10px 10px', color: 'var(--text-muted)' }}>₹{custRate.toFixed(2)}</td>
                          <td style={{ textAlign: 'center', padding: '10px 10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                              <input
                                type="number" min="0" max="100" step="0.1"
                                value={editItemRates[it.id] ?? ''}
                                onChange={e => setEditItemRates(prev => ({ ...prev, [it.id]: e.target.value }))}
                                style={{ width: 60, padding: '4px 6px', borderRadius: 6, border: '1.5px solid var(--primary)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)', textAlign: 'right', fontWeight: 600 }}
                              />
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>%</span>
                            </div>
                          </td>
                          <td style={{ textAlign: 'right', padding: '10px 10px', color: '#dc2626', fontWeight: 600 }}>-₹{discount.toFixed(2)}</td>
                          <td style={{ textAlign: 'right', padding: '10px 10px', fontWeight: 600, color: '#166534' }}>₹{hubRate.toFixed(2)}</td>
                          <td style={{ textAlign: 'right', padding: '10px 10px', fontWeight: 700 }}>₹{total.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--bg-soft,#f3f4f6)' }}>
                        <td colSpan={5} style={{ padding: '10px 10px', fontWeight: 700, fontSize: 13, textAlign: 'right' }}>Grand Total</td>
                        <td style={{ padding: '10px 10px', fontWeight: 800, fontSize: 14, textAlign: 'right', color: 'var(--primary)' }}>₹{previewGrandTotal.toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              );
            })()}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowEditModal(false)} disabled={editBusy}>Cancel</button>
              <button className="btn btn-primary" onClick={handleEditSave} disabled={editBusy}>
                {editBusy ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Approve modal with payout schedule picker ── */}
      {showApproveModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setShowApproveModal(false)}>
          <div style={{
            background: 'var(--bg)', borderRadius: 14, padding: 28,
            width: '100%', maxWidth: 680, boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Approve Purchase Invoice</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              Edit take rate per item — hub rate updates live. Confirm when ready.
            </div>

            {/* ── Live preview table ── */}
            {(inv?.items || []).length > 0 && (() => {
              let previewGrandTotal = 0;
              const rows = (inv?.items || []).map(it => {
                const custRate  = parseFloat(it.customer_rate ?? 0);
                const qty       = parseFloat(it.quantity ?? 1);
                const gstPct    = parseFloat(it.gst_percent ?? 0);
                const takeRate  = parseFloat(approvalItemRates[it.id] ?? it.commission_percent ?? 0);
                const discount  = parseFloat((custRate * (takeRate / 100)).toFixed(4));
                const hubRate   = parseFloat((custRate - discount).toFixed(4));
                const hubAmount = parseFloat((hubRate * qty).toFixed(2));
                const gstAmt    = parseFloat((hubAmount * gstPct / 100).toFixed(2));
                const total     = parseFloat((hubAmount + gstAmt).toFixed(2));
                previewGrandTotal += total;
                return { it, custRate, qty, takeRate, discount, hubRate, hubAmount, gstAmt, total };
              });

              return (
                <div style={{ marginBottom: 20 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-soft,#f3f4f6)' }}>
                        <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' }}>Item</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' }}>Cust. Rate</th>
                        <th style={{ textAlign: 'center', padding: '8px 10px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' }}>Take Rate %</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' }}>Discount</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' }}>Hub Rate</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ it, custRate, takeRate, discount, hubRate, total }) => (
                        <tr key={it.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '10px 10px' }}>
                            <div style={{ fontWeight: 600, color: 'var(--text)' }}>{it.description || it.name}</div>
                            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                              background: it.item_type === 'service' ? '#eff6ff' : '#fef3c7',
                              color: it.item_type === 'service' ? '#1e40af' : '#92400e' }}>
                              {it.item_type === 'service' ? 'Service' : 'Part'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', padding: '10px 10px', color: 'var(--text-muted)' }}>₹{custRate.toFixed(2)}</td>
                          <td style={{ textAlign: 'center', padding: '10px 10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                              <input
                                type="number" min="0" max="100" step="0.1"
                                value={approvalItemRates[it.id] ?? ''}
                                onChange={e => setApprovalItemRates(prev => ({ ...prev, [it.id]: e.target.value }))}
                                style={{ width: 60, padding: '4px 6px', borderRadius: 6, border: '1.5px solid var(--primary)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)', textAlign: 'right', fontWeight: 600 }}
                              />
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>%</span>
                            </div>
                          </td>
                          <td style={{ textAlign: 'right', padding: '10px 10px', color: '#dc2626', fontWeight: 600 }}>-₹{discount.toFixed(2)}</td>
                          <td style={{ textAlign: 'right', padding: '10px 10px', fontWeight: 600, color: '#166534' }}>₹{hubRate.toFixed(2)}</td>
                          <td style={{ textAlign: 'right', padding: '10px 10px', fontWeight: 700 }}>₹{total.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--bg-soft,#f3f4f6)' }}>
                        <td colSpan={5} style={{ padding: '10px 10px', fontWeight: 700, fontSize: 13, textAlign: 'right' }}>Grand Total</td>
                        <td style={{ padding: '10px 10px', fontWeight: 800, fontSize: 14, textAlign: 'right', color: 'var(--primary)' }}>₹{previewGrandTotal.toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              );
            })()}

            {/* ── Payout schedule ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
              {[
                { value: 'lump_sum', label: 'Lump Sum',         desc: 'Single payment on the due date.' },
                { value: 'split',    label: '3 Installments',   desc: 'Three equal payments spread across the payout cycle.' },
              ].map(opt => (
                <label key={opt.value} style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                  border: `2px solid ${payoutSchedule === opt.value ? 'var(--primary)' : 'var(--border)'}`,
                  borderRadius: 10, padding: '12px 14px', cursor: 'pointer',
                  background: payoutSchedule === opt.value ? 'var(--primary-light, #eff6ff)' : 'transparent',
                }}>
                  <input type="radio" name="payoutSchedule" value={opt.value}
                    checked={payoutSchedule === opt.value}
                    onChange={() => setPayoutSchedule(opt.value)}
                    style={{ marginTop: 2 }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{opt.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowApproveModal(false)} disabled={approving}>
                Cancel
              </button>
              <button className="btn btn-amber" onClick={handleApprove} disabled={approving}>
                <CheckCircle2 size={15} />
                {approving ? 'Approving…' : 'Confirm Approval'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Main Page
// ═════════════════════════════════════════════════════════════════════════════
export default function PurchaseInvoicesPage() {
  const { user } = useAuth();
  const location = useLocation();
  const isHubUser = !!user?.hub_id;

  const [items,   setItems]   = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [search,    setSearch]    = useState('');
  const [hubFilter, setHubFilter] = useState(() => user?.hub_id ? String(user.hub_id) : '');
  const [statusFilter, setStatusFilter] = useState('');
  const [hubs,      setHubs]      = useState([]);

  // Auto-open a specific invoice if navigated here from Estimates page
  const [selectedId, setSelectedId] = useState(() => location.state?.openId ?? null);
  const [toast,      setToast]      = useState(null);

  const showToast = useCallback((msg, type = 'success') => setToast({ msg, type }), []);

  // Load hubs for filter
  useEffect(() => {
    api('/api/hubs?limit=100')
      .then(r => setHubs(r.items || []))
      .catch(() => {});
  }, []);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (search.trim())  q.set('search', search.trim());
      if (hubFilter)      q.set('hub_id', hubFilter);
      if (statusFilter)   q.set('status', statusFilter);
      q.set('page', page);
      q.set('limit', pageSize);
      const res = await api(`/api/purchase-invoices?${q.toString()}`);
      setItems(res.items || []);
      setTotal(res.total ?? (res.items || []).length);
    } catch {
      showToast('Failed to load purchase invoices.', 'error');
    } finally {
      setLoading(false);
    }
  }, [search, hubFilter, statusFilter, page, pageSize, showToast]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  return (
    <div className="pi-page">
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
              {isHubUser ? 'All Sell Invoices' : 'All Purchase Invoices'}
            </button>
            <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10, fontSize: 18 }}>
              <ReceiptText size={20} style={{ color: 'var(--primary)' }} />
              {isHubUser ? 'Sell Invoice' : 'Purchase Invoice'} Detail
            </h2>
          </div>
        ) : (
          <div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <ReceiptText size={22} style={{ color: 'var(--primary)' }} />
              {isHubUser ? 'Sell Invoices' : 'Purchase Invoices'}
            </h2>
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
              {isHubUser ? 'Your earnings after commission deduction' : 'Hub payables after commission deduction'}
            </p>
          </div>
        )}
      </div>

      {selectedId ? (
        /* ── Full-page Detail View ── */
        <DetailDrawer
          invoiceId={selectedId}
          onClose={() => setSelectedId(null)}
          showToast={showToast}
          onRefreshList={fetchInvoices}
          isHubUser={isHubUser}
        />
      ) : (
        <>
          {/* Filters */}
          <div className="card" style={{ padding: '14px 18px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
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
              <select
                className="form-input"
                style={{ flex: '0 0 180px' }}
                value={hubFilter}
                onChange={e => { setHubFilter(e.target.value); setPage(1); }}
              >
                <option value="">All hubs</option>
                {hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            )}
            <select
              className="form-input"
              style={{ flex: '0 0 180px' }}
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            >
              <option value="">All statuses</option>
              <option value="pending_approval">Pending Approval</option>
              <option value="approved">Approved</option>
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
                <ReceiptText size={32} style={{ opacity: 0.3, marginBottom: 10 }} />
                <p style={{ margin: 0 }}>No purchase invoices found.</p>
              </div>
            ) : (
              <div className="pi-table-wrap">
              <table className="pi-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Customer / Vehicle</th>
                    <th>Hub</th>
                    <th style={{ textAlign: 'right' }}>Rate Mode</th>
                    <th style={{ textAlign: 'right' }}>Items</th>
                    <th style={{ textAlign: 'right' }}>Grand Total</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th style={{ width: 48 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(inv => (
                    <tr
                      key={inv.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSelectedId(inv.id)}
                    >
                      <td style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: 12 }}>{inv.id}</td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                          {inv.customer_name || inv.customer?.name || '—'}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {inv.vehicle_number || [inv.make_name, inv.model_name].filter(Boolean).join(' ') || '—'}
                        </div>
                      </td>
                      <td style={{ fontSize: 13 }}>{inv.hub_name || inv.hub?.name || '—'}</td>
                      <td style={{ textAlign: 'right', fontSize: 13 }}>
                        {inv.rate_mode === 'tech_rate'
                          ? <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#fef3c7', color: '#92400e' }}>Take Rate</span>
                          : inv.commission_percent != null ? `${inv.commission_percent}%` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 13 }}>{inv.item_count ?? '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 13 }}>{fmt(inv.grand_total)}</td>
                      <td><StatusBadge status={inv.status} /></td>
                      <td>
                        {inv.status === 'approved'
                          ? <PaymentStatusBadge status={inv.payment_status || 'pending'} />
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td onClick={e => { e.stopPropagation(); setSelectedId(inv.id); }}>
                        <button className="icon-action" title="View">
                          <Eye size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
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
