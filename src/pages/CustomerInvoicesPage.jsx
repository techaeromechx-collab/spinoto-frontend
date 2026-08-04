import { useEffect, useState, useCallback, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth, useCan } from '../auth/AuthContext.jsx';
import { api, API_URL, getToken } from '../api/client.js';
import PaginationBar from '../components/PaginationBar.jsx';
import InvoiceExtrasEditor from '../components/InvoiceExtrasEditor.jsx';
import InvoiceDateDialog from '../components/InvoiceDateDialog.jsx';
import { openDocumentPdf, downloadDocumentPdf } from '../lib/documentPdf.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import { getRoundingFunction } from '../lib/math.js';
import { readListState, writeListState } from '../lib/listStatePersist.js';
import { useListScrollRestore } from '../hooks/useListScrollRestore.js';
import { useDebouncedSearch, useAbortController, isAbortError } from '../hooks/useDebouncedSearch.js';
import { usePageSearch } from '../lib/pageSearchStore.js';
import {
  Receipt, Search, RefreshCw, X, Eye, Trash2, SlidersHorizontal, ArrowDown,
  AlertCircle, CheckCircle2, Clock, Plus, ChevronLeft, Printer, Download, Car, ChevronDown, Pencil,
} from 'lucide-react';
import '../styles/listLayout.css';
import '../styles/CustomerInvoicesPage.css';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) {
  if (n == null) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

// UTC "today" is yesterday in IST between 00:00 and 05:30, which made today's
// date unselectable in the picker. The rest of the app resolves today in IST;
// this now agrees with it.
function istTodayStr() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function fmtDate(d) {
  if (!d) return '—';
  // A plain 'YYYY-MM-DD' (invoice_date, paid_at dates) is parsed by
  // `new Date()` as UTC midnight, which then renders as the PREVIOUS day in
  // any timezone behind UTC. Build those from their parts as a local date so
  // the calendar day printed is the calendar day stored, everywhere.
  const ymd = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.slice(0, 10))
    ? d.slice(0, 10).split('-').map(Number)
    : null;
  const dt = ymd ? new Date(ymd[0], ymd[1] - 1, ymd[2]) : new Date(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// The date shown to the user is the invoice's legal date. created_at is only a
// fallback for any response that predates migration 099 / hasn't selected the
// column — it is NOT interchangeable (see the rounding note below).
function invoiceDate(inv) {
  return inv?.invoice_date || inv?.created_at;
}

// Older redo invoices stored "Warranty Redo — " inside the item description;
// the redo marker now lives in a banner instead, so strip the legacy prefix.
function cleanItemName(s) {
  return (s || '').replace(/^Warranty Redo\s*—\s*/i, '');
}

// Customer-facing promise labels from the snapshot stored on the invoice item.
// custom text wins; else "6 Months / 5,000 KM (whichever is earlier)".
function promiseLabel(text, months, days, km) {
  if (text) return text;
  const parts = [];
  if (months) parts.push(`${months} Month${months > 1 ? 's' : ''}`);
  if (days)   parts.push(`${days} Day${days > 1 ? 's' : ''}`);
  if (km)     parts.push(`${Number(km).toLocaleString('en-IN')} KM`);
  if (parts.length === 0) return null;
  return parts.length > 1 ? `${parts.join(' / ')} (whichever is earlier)` : parts[0];
}

function warrantyLabel(it) {
  return promiseLabel(it.warranty_text, it.warranty_months, it.warranty_days, it.warranty_km);
}

function guaranteeLabel(it) {
  return promiseLabel(it.guarantee_text, it.guarantee_months, it.guarantee_days, it.guarantee_km);
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
  const [form, setForm] = useState({ amount: '', method: 'cash', reference_no: '', notes: '', paid_at: '' });
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
          paid_at: form.paid_at || undefined, // blank = now
        },
      });
      setForm({ amount: '', method: 'cash', reference_no: '', notes: '', paid_at: '' });
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
        <div style={{ flex: '0 0 150px' }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Payment Date</label>
          <input
            className="form-input"
            type="date"
            max={istTodayStr()}
            title="Leave empty for today — set for backdated entries"
            value={form.paid_at}
            onChange={field('paid_at')}
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
  useEscapeClose(onClose);

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
    <div className="modal-backdrop">
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
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDate(invoiceDate(inv))}</span>
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
function DetailDrawer({ invoiceId, onClose, showToast, onRefreshList, onLoaded }) {
  const rawNavigate = useNavigate();
  const { user } = useAuth();
  const isHubUser = !!user?.hub_id;
  // Hub Portal renders this drawer as a plain tab with no nested routing, and
  // its admin-only routes (Estimates/Customers/Purchase Invoices) bounce hub
  // users straight back to /hub (App.jsx's RequireAdmin). So navigate() has
  // to be a no-op here for hub users — the drawer still opens fine locally.
  const navigate = isHubUser ? () => {} : rawNavigate;

  const [inv, setInv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deletingPayId, setDeletingPayId] = useState(null);
  const [confirmDeletePay, setConfirmDeletePay] = useState(null); // payment pending confirmation (paid invoices)
  const [editingPay, setEditingPay] = useState(null); // { id, date } — inline payment-date editor
  const [savingPayDate, setSavingPayDate] = useState(false);
  const [approving, setApproving] = useState(false);
  // generatingPI removed — PI is now created BEFORE CI in the new flow
  const [company, setCompany] = useState(null);
  const [themedPdfLoading, setThemedPdfLoading] = useState(false);
  // Separate from the Print spinner so the two buttons disable independently.
  const [themedPdfSaving, setThemedPdfSaving] = useState(false);

  // Whether to include B2B billing details (Company Name/GST/Address) when
  // printing — on-screen these always show regardless of this toggle.
  const [includeB2bPrint, setIncludeB2bPrint] = useState(true);

  // Whether to include the Notes box when printing — on-screen it always
  // shows (when present) regardless of this toggle.
  const [includeNotesPrint, setIncludeNotesPrint] = useState(true);

  // Editable CI notes — independent of the estimate's notes (which are only
  // copied over once, at generation time).
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  async function saveNotes() {
    setSavingNotes(true);
    try {
      const r = await api(`/api/customer-invoices/${invoiceId}`, {
        method: 'PATCH',
        body: { notes: notesDraft.trim() || null },
      });
      setInv(r.item || r);
      setEditingNotes(false);
      showToast('Notes updated.');
    } catch (err) {
      showToast(err.message || 'Failed to update notes.', 'error');
    } finally {
      setSavingNotes(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, co] = await Promise.all([
        api(`/api/customer-invoices/${invoiceId}`),
        api('/api/settings/company').catch(() => null),
      ]);
      setInv(res.item || res);
      onLoaded?.(res.item || res);
      if (co) setCompany(co);
    } catch {
      showToast('Failed to load customer invoice.', 'error');
      onClose();
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose/onLoaded
    // intentionally not tracked: they're stable-behavior callbacks (always
    // navigate to the same fixed route / sync the URL once), not data
    // dependencies. Including them would recreate `load` — and re-trigger the
    // fetch effect below — on every parent re-render (e.g. every toast shown
    // from inside this drawer), causing a visible refetch/loading flash.
  }, [invoiceId, showToast]);

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

  // created_at, NOT invoice_date — mirrors the backend rule in utils/math.js.
  // The rounding mode must follow when the invoice was actually created, or a
  // backdated invoice would render different totals than it was billed at.
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
  // Payments are deletable even on PAID invoices (with a confirm) — the
  // backend walks back the paid side effects (appointment, payout, claim).
  // Gated by its own permission since it can un-pay a settled invoice.
  const hasDeletePayPerm = useCan('DELETE_INVOICE_PAYMENT');
  const canDeletePay = inv && inv.status !== 'cancelled' && hasDeletePayPerm;
  // Once the hub has actually been PAID for this job, deletion is blocked —
  // the backend enforces it too; here it drives the warning + disabled button.
  const hubAlreadyPaid = parseFloat(inv?.linked_pi_amount_paid || 0);
  const canEditPayDate = useCan('EDIT_INVOICE_PAYMENT');
  // Changing the legal date is its own permission — it moves revenue between
  // reporting periods and shifts the warranty clock. The override is separate
  // again, for going past the window or into a locked period.
  const canBackdate    = useCan('BACKDATE_INVOICE', 'OVERRIDE_INVOICE_DATE_LIMITS');
  const canOverrideDate = useCan('OVERRIDE_INVOICE_DATE_LIMITS');
  // The server is the authority (it also checks payments and status); this
  // just avoids offering a button that would always be refused.
  const dateEditable   = inv && ['generated', 'approved'].includes(inv.status)
                             && !(inv.payments || []).length;
  const [dateDialog, setDateDialog] = useState(false);

  async function savePaymentDate() {
    if (!editingPay?.date) return;
    setSavingPayDate(true);
    try {
      await api(`/api/customer-invoices/${invoiceId}/payments/${editingPay.id}`, {
        method: 'PATCH', body: { paid_at: editingPay.date },
      });
      showToast('Payment date updated — payout schedule re-synced.');
      setEditingPay(null);
      await load();
      onRefreshList();
    } catch (err) {
      showToast(err.message || 'Failed to update payment date.', 'error');
    } finally {
      setSavingPayDate(false);
    }
  }

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
            {inv && <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>{fmtDate(invoiceDate(inv))}</div>}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {inv?.is_b2b && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeB2bPrint}
                onChange={e => setIncludeB2bPrint(e.target.checked)}
                style={{ width: 13, height: 13 }}
              />
              Include B2B details in print
            </label>
          )}
          {inv?.notes && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeNotesPrint}
                onChange={e => setIncludeNotesPrint(e.target.checked)}
                style={{ width: 13, height: 13 }}
              />
              Include notes in print
            </label>
          )}
          {/* Server-rendered themed PDF. Replaces the old window.print() of
              the on-screen layout, which ignored the configured theme, logo
              and accent colour entirely. */}
          <button
            className="btn btn-ghost"
            disabled={themedPdfLoading}
            onClick={async () => {
              if (!inv) return;
              setThemedPdfLoading(true);
              try {
                await openDocumentPdf('customer_invoice', inv.id);
              } catch (e) {
                showToast(e.message || 'Failed to generate PDF', 'error');
              } finally {
                setThemedPdfLoading(false);
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontSize: 13 }}
            title="Open the themed PDF"
          >
            <Printer size={15} /> {themedPdfLoading ? 'Generating…' : 'Print / PDF'}
          </button>
          {/* Separate from Print because only a download can carry the proper
              filename. Print opens a blob URL, and a blob URL has no name — the
              viewer's own save button can only produce its blob uuid. */}
          <button
            className="btn btn-ghost"
            disabled={themedPdfSaving}
            onClick={async () => {
              if (!inv) return;
              setThemedPdfSaving(true);
              try {
                await downloadDocumentPdf('customer_invoice', inv.id);
              } catch (e) {
                showToast(e.message || 'Failed to download PDF', 'error');
              } finally {
                setThemedPdfSaving(false);
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontSize: 13 }}
            title="Download the PDF as CI-000000_VEHICLE_Model.pdf"
          >
            <Download size={15} /> {themedPdfSaving ? 'Saving…' : 'Download'}
          </button>
        </div>
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
                  ...(inv.is_b2b ? [
                    { label: 'Company Name', value: inv.b2b_company_name, b2b: true },
                    { label: 'GST No', value: inv.b2b_gst_number, b2b: true },
                  ] : []),
                  { label: 'Customer', value: inv.customer_name },
                  { label: 'Mobile', value: inv.mobile },
                  ...(inv.is_b2b ? [
                    { label: 'Address', value: inv.b2b_address, b2b: true },
                  ] : []),
                  {
                    label: 'Hub / Branch',
                    value: (
                      <>
                        <span className="est-no-print">{inv.hub_full_name || inv.hub_name}</span>
                        <span className="est-print-show">{inv.hub_name}</span>
                      </>
                    )
                  },
                ].map(({ label, value, b2b }) => (
                  <div key={label} className={b2b && !includeB2bPrint ? 'est-no-print' : ''} style={{ display: 'flex' }}>
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
                  {
                    label: 'Date',
                    node: (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>
                          {fmtDate(invoiceDate(inv))}
                        </span>
                        {/* A backdated invoice says so on its own face. The
                            reason is in the tooltip and the activity log. */}
                        {inv.original_invoice_date && (
                          <span className="inv-backdated-badge"
                            title={`Originally ${fmtDate(inv.original_invoice_date)}` +
                                   (inv.backdate_reason ? ` — ${inv.backdate_reason}` : '')}>
                            Backdated
                          </span>
                        )}
                        {canBackdate && dateEditable && (
                          <button
                            type="button"
                            onClick={() => setDateDialog(true)}
                            style={{
                              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                              fontSize: 11.5, fontWeight: 600, color: 'var(--primary, #2563eb)',
                            }}>
                            Change
                          </button>
                        )}
                      </span>
                    ),
                  },
                  { label: 'Status', node: <StatusBadge status={inv.status} /> },
                  ...(inv.warranty_claim_id ? [{
                    label: 'Invoice Type',
                    node: (
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 99,
                        background: '#fef3c7', color: '#92400e', whiteSpace: 'nowrap',
                      }}>
                        🛡 Warranty Redo{inv.warranty_claim_code ? ` — Claim ${inv.warranty_claim_code}` : ''}
                      </span>
                    ),
                  }] : []),
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


          {/* Warranty redo banner — prints, so the customer sees why it's ₹0 */}
          {inv.warranty_claim_id && (
            <div style={{
              background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10,
              padding: '10px 16px', fontSize: 13, color: '#92400e', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 15 }}>🛡</span>
              <span>
                <strong>Warranty Redo{inv.warranty_claim_code ? ` — Claim ${inv.warranty_claim_code}` : ''}.</strong>{' '}
                This work was carried out under warranty against a previous invoice
                {parseFloat(inv.grand_total) <= 0 ? ' — free of charge.' : '.'}
              </span>
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
                          <div className="ci-item-name" style={{ fontWeight: 600, fontSize: 13, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 210 }} title={cleanItemName(it.description || it.name)}>{cleanItemName(it.description || it.name) || '—'}</div>
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

            {/* Bottom-left corner: Amount in words, with Notes stacked below it */}
            <div style={{ flex: '1 1 220px', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{
                background: '#f8fafc', borderRadius: 10,
                padding: '12px 16px', borderLeft: '3px solid #16b994',
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Amount in Words</div>
                <div style={{ fontSize: 11, fontWeight: 500, color: '#374151', fontStyle: 'italic', lineHeight: 1.7 }}>
                  {amountToWords(parseFloat(grandTotal))}
                </div>
              </div>

              {/* Optional invoice fields (PO no., e-way bill, batch/exp/mfg,
                  free-item flag, custom fields/columns). Renders nothing
                  unless at least one is enabled in Invoice Settings. */}
              <InvoiceExtrasEditor
                invoice={inv}
                config={company?.document_config?.documents?.customer_invoice}
                showToast={showToast}
                onSaved={updated => setInv(updated)}
              />

              {(inv.notes || editingNotes) ? (
                <div className={editingNotes ? 'est-no-print' : (includeNotesPrint ? '' : 'est-no-print')} style={{
                  background: 'var(--bg-soft)',
                  borderRadius: 8,
                  padding: '12px 14px',
                  fontSize: 13,
                  color: 'var(--text)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}>
                      Notes
                    </div>
                    {!editingNotes && (
                      <button
                        type="button"
                        className="est-no-print"
                        onClick={() => { setNotesDraft(inv.notes || ''); setEditingNotes(true); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: 0 }}
                      >
                        <Pencil size={11} /> Edit
                      </button>
                    )}
                  </div>
                  {editingNotes ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <textarea
                        className="form-input"
                        style={{ minHeight: 70, resize: 'vertical', fontSize: 13 }}
                        value={notesDraft}
                        onChange={e => setNotesDraft(e.target.value)}
                        placeholder="Add a note for this invoice…"
                        autoFocus
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" className="btn btn-primary" style={{ padding: '5px 12px', fontSize: 12 }} disabled={savingNotes} onClick={saveNotes}>
                          {savingNotes ? 'Saving…' : 'Save'}
                        </button>
                        <button type="button" className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 12 }} disabled={savingNotes} onClick={() => setEditingNotes(false)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    inv.notes
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  className="est-no-print"
                  onClick={() => { setNotesDraft(''); setEditingNotes(true); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
                    background: 'none', border: '1px dashed var(--border)', borderRadius: 8,
                    padding: '8px 12px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600,
                  }}
                >
                  <Plus size={13} /> Add note
                </button>
              )}
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
                  onClick={() => navigate(inv.estimate_token ? `/estimates/${inv.estimate_token}` : '/estimates', inv.estimate_token ? undefined : { state: { openId: inv.estimate_id } })}
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
                  onClick={() => navigate(inv.linked_purchase_invoice_token ? `/purchase-invoices/${inv.linked_purchase_invoice_token}` : '/purchase-invoices', inv.linked_purchase_invoice_token ? undefined : { state: { openId: inv.linked_purchase_invoice_id } })}
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

          {/* ── Warranty & Guarantee + Payments — side by side ── */}
          <div className="ci-wg-pay-row" style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>

            {/* Left — Warranty & Guarantee coverage table */}
            {(() => {
              const groups = [];
              const gmap = new Map();
              for (const it of (inv.items || [])) {
                for (const [ptype, label] of [['Warranty', warrantyLabel(it)], ['Guarantee', guaranteeLabel(it)]]) {
                  if (!label) continue;
                  const key = `${ptype}|${label}`;
                  if (!gmap.has(key)) { const g = { ptype, label, names: [] }; gmap.set(key, g); groups.push(g); }
                  gmap.get(key).names.push(cleanItemName(it.description || it.name));
                }
              }
              if (groups.length === 0) return null;
              const claimables = (inv.items || []).filter(it => warrantyLabel(it) || guaranteeLabel(it));
              return (
                <div style={{ flex: '1.2 1 340px', minWidth: 300 }}>
                  <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Warranty &amp; Guarantee</h4>
                  <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border)' }}>
                    <table className="ci-table ci-coverage-table">
                      <thead>
                        <tr>
                          <th style={{ width: '45%' }}>Service / Package</th>
                          <th style={{ width: '22%' }}>Type</th>
                          <th style={{ width: '33%' }}>Coverage / Validity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map((g, i) => (
                          <tr key={i}>
                            <td style={{ fontSize: 12, fontWeight: 500 }}>{g.names.join(', ')}</td>
                            <td style={{ fontSize: 12, whiteSpace: 'nowrap', fontWeight: 600, color: g.ptype === 'Guarantee' ? '#3730a3' : '#166534' }}>
                              {g.ptype === 'Guarantee' ? '✔' : '🛡'} {g.ptype}
                            </td>
                            <td style={{ fontSize: 12 }}>{g.label}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 6, fontStyle: 'italic' }}>
                    Warranty / guarantee is valid from the date of invoice.
                  </div>
                  {/* Claim actions — internal, never printed */}
                  <div className="ci-internal" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
                    {/* Existing claims — one chip per claim, linking to it */}
                    {claimables.filter(it => it.claim_id).map((it, i) => (
                      <button
                        key={it.id || i}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); navigate(`/warranty-claims?claim=${it.claim_id}`); }}
                        title={`${cleanItemName(it.description || it.name)} — open this ${it.claim_type || 'warranty'} claim`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 99,
                          background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {it.claim_type === 'guarantee' ? '✔' : '🛡'} {it.claim_code || `Claim #${it.claim_id}`}
                        <span style={{ fontWeight: 500, color: '#3b82f6' }}>· {(it.claim_status || '').replace(/_/g, ' ')}</span>
                      </button>
                    ))}
                    {/* One entry point for new claims — the register modal
                        already lists this customer's claimable items */}
                    {inv.status === 'paid' && claimables.some(it => !it.claim_id) && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); navigate(`/warranty-claims?register_mobile=${encodeURIComponent(inv.mobile || '')}`); }}
                        title="Register a warranty/guarantee claim for an item on this invoice"
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          fontSize: 11, fontWeight: 700, padding: '5px 14px', borderRadius: 8,
                          background: '#fffbeb', color: '#92400e', border: '1px solid #fcd34d', cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        🛡 Register a Claim
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Right — Payments */}
            <div style={{ flex: '1 1 320px', minWidth: 280 }}>
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
                        <td style={{ fontSize: 12 }}>
                          {editingPay?.id === pay.id ? (
                            <span className="ci-internal" style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                              <input
                                className="form-input"
                                type="date"
                                max={istTodayStr()}
                                style={{ padding: '3px 6px', fontSize: 12, width: 135 }}
                                value={editingPay.date}
                                onChange={e => setEditingPay(p => ({ ...p, date: e.target.value }))}
                              />
                              <button className="icon-action" title="Save date" disabled={savingPayDate} onClick={savePaymentDate}>
                                <CheckCircle2 size={13} style={{ color: '#16a34a' }} />
                              </button>
                              <button className="icon-action" title="Cancel" disabled={savingPayDate} onClick={() => setEditingPay(null)}>
                                <X size={13} />
                              </button>
                            </span>
                          ) : (
                            <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                              {fmtDate(pay.paid_at || pay.created_at)}
                              {canEditPayDate && (
                                <button
                                  className="icon-action ci-internal"
                                  title="Change payment date"
                                  onClick={() => setEditingPay({
                                    id: pay.id,
                                    date: (pay.paid_at || pay.created_at || '').slice(0, 10),
                                  })}
                                >
                                  <Pencil size={11} />
                                </button>
                              )}
                            </span>
                          )}
                        </td>
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
                              onClick={() => (inv.status === 'paid' || hubAlreadyPaid > 0) ? setConfirmDeletePay(pay) : deletePayment(pay.id)}
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

            </div>{/* /right column */}
          </div>{/* /side-by-side row */}

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
            paddingTop: 14,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Thank you for your business.</div>
            <div style={{ fontSize: 10, color: '#9ca3af' }}>This is a computer generated invoice and does not require a physical signature.</div>
            {(company?.phone || company?.email) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, color: '#6b7280', fontWeight: 500, marginTop: 4 }}>
                {company.phone && <span>📞 {company.phone}</span>}
                {company.phone && company.email && <span style={{ color: '#d1d5db' }}>|</span>}
                {company.email && <span>✉ {company.email}</span>}
              </div>
            )}
          </div>

          {/* ── Confirm: delete payment off a PAID invoice ── */}
          {confirmDeletePay && (
            <div className="modal-backdrop" style={{ zIndex: 1100 }} onClick={() => setConfirmDeletePay(null)}>
              <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
                <div className="modal-header">
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Trash2 size={16} style={{ color: '#dc2626' }} /> Delete Payment
                  </h3>
                  <button className="modal-close" onClick={() => setConfirmDeletePay(null)}><X size={18} /></button>
                </div>
                <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {hubAlreadyPaid > 0 ? (
                    <div style={{
                      background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
                      padding: '12px 14px', fontSize: 13, color: '#991b1b',
                    }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠ Deletion blocked — hub already paid</div>
                      A hub payout of <strong>{fmt(hubAlreadyPaid)}</strong> has already been made for this job.
                      Deleting the customer payment would not bring that money back. To correct this,
                      reverse the hub payment on the Purchase Invoice first.
                    </div>
                  ) : (
                    <div style={{
                      background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
                      padding: '10px 14px', fontSize: 13, color: '#991b1b', fontWeight: 600,
                    }}>
                      This invoice is fully PAID — deleting {fmt(confirmDeletePay.amount)} ({confirmDeletePay.method}) will undo that.
                    </div>
                  )}
                  {hubAlreadyPaid <= 0 && (
                    <div style={{ fontSize: 13, color: 'var(--text)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[
                        ['🧾', 'Invoice becomes unpaid / partially paid'],
                        ['📅', 'Appointment reopens (Closed → Invoice Approved)'],
                        ['💸', 'Hub payout is pulled from the payout queue'],
                        ...(inv?.warranty_claim_id ? [['🛡', 'Linked warranty claim moves back to Approved']] : []),
                      ].map(([icon, text], i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 15 }}>{icon}</span>
                          <span>{text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                    <button className="btn btn-ghost" onClick={() => setConfirmDeletePay(null)}>
                      {hubAlreadyPaid > 0 ? 'Close' : 'Cancel'}
                    </button>
                    {hubAlreadyPaid <= 0 && (
                      <button
                        className="btn btn-danger"
                        disabled={deletingPayId === confirmDeletePay.id}
                        onClick={async () => { const pid = confirmDeletePay.id; setConfirmDeletePay(null); await deletePayment(pid); }}
                      >
                        {deletingPayId === confirmDeletePay.id ? 'Deleting…' : 'Delete Payment'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {dateDialog && inv && (
            <InvoiceDateDialog
              invoice={inv}
              canOverride={canOverrideDate}
              onClose={() => setDateDialog(false)}
              onSaved={(r) => {
                // Reload rather than patching state locally: the change can
                // also move the purchase invoice, and the list's date column
                // and ordering both need to catch up.
                load();
                onRefreshList?.();
                showToast(
                  `Invoice date changed to ${fmtDate(r.invoice_date)}` +
                  (r.purchase_invoice?.moved ? ' (purchase invoice moved too)' : '')
                );
                if (r.purchase_invoice && r.purchase_invoice.moved === false) {
                  showToast(r.purchase_invoice.reason, 'error');
                }
              }}
            />
          )}

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
  const rawNavigate = useNavigate();
  const location = useLocation();
  const { token } = useParams();
  const isHubUser = !!user?.hub_id;
  // Hub Portal renders this page as a plain tab (no nested routing), and its
  // own admin-only routes are off-limits to hub users (App.jsx's RequireAdmin
  // bounces them straight back to /hub). So every navigate() call here — this
  // page's own detail view or cross-links to Estimates/Purchase Invoices/
  // Customers — has to be a no-op for hub users; the detail view still opens
  // via local state either way.
  const navigate = isHubUser ? () => {} : rawNavigate;

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Remember page/pageSize/filters across a full navigation away and back —
  // sessionStorage survives the unmount a route change to a different page
  // causes; plain useState does not.
  const listStateRef = useRef(readListState('sp_customer_invoices_list_v1'));
  const ls = listStateRef.current;

  const [page, setPage] = useState(ls.page ?? 1);
  const [pageSize, setPageSize] = useState(ls.pageSize ?? 10);

  // `searchInput` is what the box shows; `search` is what the server is asked
  // for, at most once per 300ms pause and never below 2 characters.
  const { input: searchInput, setInput: setSearchInput, search, tooShort, minChars } =
    useDebouncedSearch(ls.search ?? '');
  const abortSignal = useAbortController();

  // Typing must also send you back to page 1 — otherwise a search run while on
  // page 3 returns two results and shows you an empty page 3 of them.
  // useCallback because usePageSearch compares this by identity.
  const onSearchChange = useCallback(v => { setSearchInput(v); setPage(1); }, [setSearchInput]);
  const [hubFilter, setHubFilter] = useState(() => ls.hubFilter ?? (user?.hub_id ? [String(user.hub_id)] : []));
  const [showHubDropdown, setShowHubDropdown] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState(ls.statusFilter ?? '');
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState(ls.vehicleTypeFilter ?? '');
  // Invoice-date range — both optional; either can be set alone (open-ended).
  const [fromDate, setFromDate] = useState(ls.fromDate ?? '');
  const [toDate, setToDate] = useState(ls.toDate ?? '');
  const [hubs, setHubs] = useState([]);

  // Persist whenever any of these change
  useEffect(() => {
    // searchInput, not search: restore the box exactly as they left it, even
    // mid-word. The hook re-derives the debounced value on mount.
    writeListState('sp_customer_invoices_list_v1', { search: searchInput, page, pageSize, statusFilter, vehicleTypeFilter, hubFilter, fromDate, toDate });
  }, [page, pageSize, searchInput, statusFilter, vehicleTypeFilter, hubFilter, fromDate, toDate]);

  useListScrollRestore('sp_customer_invoices_list_v1', !loading);

  // How many of the filters hidden behind the funnel are actually on. A date
  // range counts as one thing, not two, because that is how a person thinks of
  // it — "filtered by date" is one decision even when both ends are set.
  const hiddenFilterCount =
    (vehicleTypeFilter ? 1 : 0) + ((fromDate || toDate) ? 1 : 0);

  // Auto-open a specific invoice if navigated here from Estimates page
  const [selectedId, setSelectedId] = useState(() => location.state?.openId ?? null);
  const [showVehHistory, setShowVehHistory] = useState(false);
  const [toast, setToast] = useState(null);

  // Claim the top bar's search box. Declared after selectedId because it reads
  // it: the box is released while a single invoice is open, since searching a
  // list you cannot see is a control that appears to do nothing.
  usePageSearch({
    value: searchInput,
    onChange: onSearchChange,
    placeholder: 'Name, mobile, vehicle no. or CI-000048',
    hint: tooShort ? `${minChars}+ characters` : '',
    enabled: !selectedId,
  });

  const showToast = useCallback((msg, type = 'success') => setToast({ msg, type }), []);

  const resolvedTokenRef = useRef(null);
  // Flips true the instant the user explicitly closes the detail view.
  // Guards against a slow/late-resolving fetch (from load(), the by-token
  // resolver, or a re-load after Approve/Save) firing its onLoaded/navigate
  // callback AFTER the user has already navigated back to the list — without
  // this, a stale response could silently re-push the token URL back into
  // the address bar even though the list is showing.
  const closedRef = useRef(false);

  function openInvoice(inv) {
    closedRef.current = false;
    resolvedTokenRef.current = inv.public_token;
    setSelectedId(inv.id);
    navigate(`/customer-invoices/${inv.public_token}`);
  }

  function closeInvoice() {
    closedRef.current = true;
    resolvedTokenRef.current = null;
    // Clear directly rather than relying solely on the `[token]` effect —
    // inside the Hub Portal, `token` never exists (plain tab, not a routed
    // /customer-invoices/:token) and navigate() is a no-op there for hub
    // users, so that effect would never fire on close.
    setSelectedId(null);
    navigate('/customer-invoices');
  }

  function handleInvoiceLoaded(inv) {
    if (closedRef.current) return;
    if (!inv?.public_token || resolvedTokenRef.current === inv.public_token) return;
    resolvedTokenRef.current = inv.public_token;
    navigate(`/customer-invoices/${inv.public_token}`, { replace: true });
  }

  useEffect(() => {
    if (!token) {
      // Only clear if we were previously showing a token-resolved invoice —
      // don't stomp on a `selectedId` that came from location.state (e.g. an
      // inbound deep link) before it's had a chance to resolve its own token.
      if (resolvedTokenRef.current) setSelectedId(null);
      resolvedTokenRef.current = null;
      return;
    }
    closedRef.current = false;
    if (resolvedTokenRef.current === token) return;
    resolvedTokenRef.current = token;
    api(`/api/customer-invoices/by-token/${token}`)
      .then(r => { if (!closedRef.current) setSelectedId(r.item.id); })
      .catch(() => { resolvedTokenRef.current = null; });
  }, [token]);

  useEffect(() => {
    api('/api/hubs?is_active=true&limit=100')
      .then(r => setHubs(r.items || []))
      .catch(() => { });
  }, []);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (search) q.set('search', search);
      if (hubFilter.length > 0) q.set('hub_ids', hubFilter.join(','));
      if (statusFilter) q.set('status', statusFilter);
      if (vehicleTypeFilter) q.set('vehicle_type', vehicleTypeFilter);
      if (fromDate) q.set('from', fromDate);
      if (toDate) q.set('to', toDate);
      q.set('page', page);
      q.set('limit', pageSize);
      const res = await api(`/api/customer-invoices?${q.toString()}`, { signal: abortSignal() });
      setItems(res.items || []);
      setTotal(res.total ?? (res.items || []).length);
      setLoading(false);
    } catch (e) {
      // A cancelled request is this code superseding itself, not a failure.
      // Deliberately NOT in a `finally`: that would run on abort too and clear
      // the spinner while the request that replaced this one is still in
      // flight, flickering the list back to "loaded" and then to loading again.
      if (isAbortError(e)) return;
      showToast('Failed to load customer invoices.', 'error');
      setLoading(false);
    }
  }, [search, hubFilter, statusFilter, vehicleTypeFilter, fromDate, toDate, page, pageSize, showToast, abortSignal]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  async function handleExport() {
    try {
      const q = new URLSearchParams();
      if (search) q.set('search', search);
      if (hubFilter.length > 0) q.set('hub_ids', hubFilter.join(','));
      if (statusFilter) q.set('status', statusFilter);
      if (vehicleTypeFilter) q.set('vehicle_type', vehicleTypeFilter);
      if (fromDate) q.set('from', fromDate);
      if (toDate) q.set('to', toDate);
      const res = await fetch(`${API_URL}/api/customer-invoices/export?${q.toString()}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) { showToast('Export failed. Check your permissions.', 'error'); return; }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `customer_invoices_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast('Customer invoices exported successfully.');
    } catch {
      showToast('Export failed. Please try again.', 'error');
    }
  }

  return (
    /* lb-page cancels the app wrapper's padding and max-width so the table runs
       edge to edge. The detail view deliberately does not get it. */
    <div className={selectedId ? 'ci-page' : 'ci-page lb-page'}>
      {/* ── Header ──
          The list view has no title: the top bar's breadcrumb already reads
          "Home › Customer Invoices", and repeating it under the breadcrumb was
          the same words twice with nothing between them. The whole block is
          skipped rather than left empty, so the toolbar rises to fill the gap.

          The DETAIL view keeps its header — there the back button and "Invoice
          Detail" are the only thing telling you which of the two views you are
          looking at. */}
      {selectedId && (
        <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="btn btn-ghost"
              onClick={closeInvoice}
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
        </div>
      )}

      {showVehHistory && <VehicleHistoryModal onClose={() => setShowVehHistory(false)} />}

      {selectedId ? (
        /* ── Full-page Detail View ── */
        <DetailDrawer
          invoiceId={selectedId}
          onClose={closeInvoice}
          showToast={showToast}
          onRefreshList={fetchInvoices}
          onLoaded={handleInvoiceLoaded}
        />
      ) : (
        <>
          {/* ── Toolbar ──
              No card: filters sit directly on the page background, everything
              on one row, actions pushed right. The search box is in the top
              bar (see usePageSearch above). */}
          <div className="lb-toolbar">
            {!isHubUser && (
              <div style={{ position: 'relative', flex: '0 0 auto' }}>
                <button
                  type="button"
                  className="lb-control"
                  style={{ minWidth: 150, justifyContent: 'space-between' }}
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
                    {/* minWidth, not right:0 — the trigger is now a
                        shrink-to-fit pill rather than a 180px block, so
                        stretching the menu to its edges would leave hub names
                        wrapping in a ~150px column. */}
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: 240, marginTop: 0,
                      background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12,
                      boxShadow: '0 12px 28px rgba(0,0,0,0.12)', zIndex: 1000, maxHeight: 280,
                      overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 4
                    }}>
                      {hubs.length > 0 && hubFilter.length < hubs.length && (
                        <button
                          type="button"
                          style={{
                            width: '100%', padding: '6px 8px', fontSize: 12, fontWeight: 600,
                            color: 'var(--primary, #16b994)', background: 'none', border: 'none',
                            textAlign: 'left', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                            paddingBottom: 8, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4
                          }}
                          onClick={() => { setHubFilter(hubs.map(h => String(h.id))); setPage(1); }}
                        >
                          <CheckCircle2 size={12} /> Select All
                        </button>
                      )}
                      {hubFilter.length > 0 && (
                        <button
                          type="button"
                          style={{
                            width: '100%', padding: '6px 8px', fontSize: 12, fontWeight: 600,
                            color: 'var(--text-danger, #dc2626)', background: 'none', border: 'none',
                            textAlign: 'left', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                            paddingBottom: 8, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4
                          }}
                          onClick={() => { setHubFilter([]); setPage(1); }}
                        >
                          <X size={12} /> Clear Selection
                        </button>
                      )}
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
            {/* Status stays visible — it is the filter people reach for most.
                Vehicle type and the date range live behind the funnel. */}
            <select
              className="lb-control"
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

            {/* ── More filters ──
                A funnel collapses the less-used filters. The badge is what
                stops a filtered list from looking like a broken one: with the
                controls hidden, a count is the only clue that rows are being
                held back. */}
            <div style={{ position: 'relative', flex: '0 0 auto' }}>
              <button
                type="button"
                className="lb-control lb-icon-btn"
                title="More filters"
                aria-expanded={showMoreFilters}
                onClick={() => setShowMoreFilters(p => !p)}
              >
                <SlidersHorizontal size={15} />
                {hiddenFilterCount > 0 && (
                  <span className="lb-filter-count">{hiddenFilterCount}</span>
                )}
              </button>

              {showMoreFilters && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setShowMoreFilters(false)} />
                  <div className="lb-pop">
                    <div>
                      <label className="lb-pop-label" htmlFor="lb-veh">Vehicle type</label>
                      <select
                        id="lb-veh"
                        className="lb-control"
                        value={vehicleTypeFilter}
                        onChange={e => { setVehicleTypeFilter(e.target.value); setPage(1); }}
                      >
                        <option value="">All Vehicles</option>
                        <option value="2W">2W Only</option>
                        <option value="4W">4W Only</option>
                      </select>
                    </div>

                    <div>
                      <label className="lb-pop-label">Invoice date</label>
                      <div className="lb-pop-row">
                        <input
                          type="date"
                          className="lb-control"
                          value={fromDate}
                          max={toDate || undefined}
                          title="From date"
                          onChange={e => { setFromDate(e.target.value); setPage(1); }}
                        />
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>to</span>
                        <input
                          type="date"
                          className="lb-control"
                          value={toDate}
                          min={fromDate || undefined}
                          title="To date"
                          onChange={e => { setToDate(e.target.value); setPage(1); }}
                        />
                      </div>
                    </div>

                    <div className="lb-pop-foot">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '6px 10px', fontSize: 13 }}
                        disabled={hiddenFilterCount === 0}
                        onClick={() => {
                          setVehicleTypeFilter(''); setFromDate(''); setToDate(''); setPage(1);
                        }}
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '6px 10px', fontSize: 13 }}
                        onClick={() => setShowMoreFilters(false)}
                      >
                        Done
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              className="lb-control lb-icon-btn"
              onClick={fetchInvoices}
              title="Refresh"
            >
              <RefreshCw size={15} />
            </button>

            <div className="lb-toolbar-right">
              <span className="lb-count">
                {total} invoice{total !== 1 ? 's' : ''}
              </span>
              <button type="button" className="lb-control" onClick={handleExport} title="Export Excel">
                <Download size={15} /> Export
              </button>
              <button type="button" className="lb-control" onClick={() => setShowVehHistory(true)}>
                <Car size={15} /> Vehicle History
              </button>
            </div>
          </div>

          {/* ── Table ──
              Full bleed: no card wrapper, no outer border or radius, and
              horizontal dividers only. */}
          <div className="lb-list">
            {loading ? (
              <div className="lb-empty">Loading…</div>
            ) : items.length === 0 ? (
              <div className="lb-empty">
                <Receipt size={32} style={{ opacity: 0.3, marginBottom: 10 }} />
                <p style={{ margin: 0 }}>No customer invoices found.</p>
              </div>
            ) : (
              <div className="ci-table-wrap lb-scroll-x">
                <table className="ci-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      {/* The list is ORDER BY invoice_date DESC, id DESC on the
                          server. The arrow states that; it is not a control,
                          because there is no ?sort= parameter to send. */}
                      <th className="lb-sorted">Date <ArrowDown size={12} className="lb-sort-icon" /></th>
                      <th>Customer</th>
                      <th>Vehicle</th>
                      <th>Hub</th>
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
                        <tr key={inv.id} style={{ cursor: 'pointer' }} onClick={() => openInvoice(inv)}>
                          <td style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: 12 }}>
                            {inv.id}
                            {inv.warranty_claim_id && (
                              <div title="Warranty redo invoice" style={{ fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 4, background: '#fef3c7', color: '#92400e', marginTop: 2, whiteSpace: 'nowrap', display: 'inline-block' }}>
                                🛡 REDO
                              </div>
                            )}
                          </td>
                          <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                            <div>{fmtDate(invoiceDate(inv))}</div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', marginTop: 2 }}>
                              CI-{String(inv.id).padStart(6, '0')}
                            </div>
                          </td>
                          <td>
                            <div
                              className="ci-cust-link"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(inv.customer_token ? `/customers/${inv.customer_token}` : '/customers', inv.customer_token ? undefined : { state: { openMobile: inv.mobile } });
                              }}
                            >
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ fontWeight: 600, fontSize: 13 }} className="ci-cust-name">
                                    {inv.is_b2b ? (inv.b2b_company_name || inv.customer_name || '—') : (inv.customer_name || '—')}
                                  </span>
                                  {inv.is_b2b && (
                                    <span title="B2B Invoice" style={{
                                      fontSize: 9,
                                      fontWeight: 800,
                                      padding: '1px 5px',
                                      borderRadius: 4,
                                      background: 'transparent',
                                      color: '#7c3aed',
                                      border: '1px solid #ddd6fe',
                                    }}>
                                      B2B
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                  {inv.is_b2b ? (inv.b2b_gst_number || '—') : (inv.mobile || '')}
                                </div>
                                {inv.is_b2b && (
                                  <div style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.7, marginTop: 1 }}>
                                    {[inv.customer_name, inv.mobile].filter(Boolean).join(' · ')}
                                  </div>
                                )}
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
                                    background: 'transparent',
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
                          <td style={{ fontSize: 12 }}>{inv.hub_full_name || inv.hub_name || inv.hub?.name || '—'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 350, fontSize: 13 }}>{fmt(gt)}</td>
                          <td style={{ textAlign: 'right', fontSize: 13, color: '#166534', fontWeight: 300 }}>{fmt(pd)}</td>
                          <td style={{
                            textAlign: 'right', fontWeight: 350, fontSize: 13,
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
