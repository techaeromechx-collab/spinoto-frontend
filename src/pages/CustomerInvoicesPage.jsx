import { useEffect, useState, useCallback, useRef, memo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth, useCan } from '../auth/AuthContext.jsx';
import { useAppPaths } from '../lib/appPaths.js';
import { api, API_URL, getToken } from '../api/client.js';
import PaginationBar from '../components/PaginationBar.jsx';
import SplitPane, { RecordCard } from '../components/SplitPane.jsx';
import DetailSkeleton from '../components/DetailSkeleton.jsx';
import { useMediaQuery, MOBILE_LIST_QUERY } from '../hooks/useMediaQuery.js';
import { useDetailRail } from '../hooks/useDetailRail.js';
import InvoiceExtrasEditor from '../components/InvoiceExtrasEditor.jsx';
import InvoiceDateDialog from '../components/InvoiceDateDialog.jsx';
import CollectPaymentModal from '../components/CollectPaymentModal.jsx';
import { PaymentLinksPanel } from '../components/PaymentsAdminTabs.jsx';
import { openDocumentPdf, downloadDocumentPdf, openAdvanceVoucher } from '../lib/documentPdf.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import { getRoundingFunction } from '../lib/math.js';
import { readListState, writeListState } from '../lib/listStatePersist.js';
import { useListScrollRestore } from '../hooks/useListScrollRestore.js';
import { useDebouncedSearch, useAbortController, isAbortError } from '../hooks/useDebouncedSearch.js';
import { useFlipPopup } from '../hooks/useFlipPopup.js';
import { usePageSearch } from '../lib/pageSearchStore.js';
import { usePageCrumb } from '../lib/pageCrumbStore.js';
import {
  Receipt, Search, RefreshCw, X, Eye, Trash2, SlidersHorizontal, ArrowDown,
  AlertCircle, CheckCircle2, Clock, Plus, ChevronLeft, ChevronRight, Printer, Download, Car, ChevronDown, Pencil,
  CreditCard, Link2, Lock, Wallet, FileText, Loader2,
  // Icon labels on the document header replace an 84px text column per row —
  // which is what buys the width for the summary to sit beside Bill To and
  // Vehicle rather than underneath them. See ci-doc-il in the stylesheet.
  User, Phone, Building2, MapPin, Tag, Layers, Calendar, BadgeCheck, Landmark,
  // Coverage marks in the Warranty panel. These replace 🛡 and ✔, which render
  // as OS colour emoji and were the last cartoon glyphs on the document.
  ShieldCheck,
  // Send the invoice to the customer on WhatsApp.
  MessageCircle,
  // Odometer reading, matching the estimate drawer's choice of icon.
  Gauge,
} from 'lucide-react';

/**
 * A payment taken through the gateway rather than recorded by hand.
 *
 * `source` comes from customer_invoice_payments (migration 125). The fallback
 * on txn_ref covers a response served before that column reached the API — an
 * online payment misread as manual would show a delete button the backend
 * refuses, which is the one wrong answer worth guarding against here.
 */
const isOnline = pay => pay?.source === 'gateway' || Boolean(pay?.txn_ref);

/**
 * An advance applied to this invoice, rather than a payment recorded against it.
 *
 * The money was taken against the estimate before this invoice existed, so the
 * ledger row's customer_invoice_id is NULL and both the edit and delete handlers
 * — which match on `id AND customer_invoice_id` — return 404 for it. Rendering
 * it as an ordinary payment would put a pencil and a bin on a row where neither
 * can work. It is managed from the customer's Payments tab instead.
 */
const isAdvance = pay => pay?.payment_type === 'advance';

/**
 * True when only part of the advance landed on this invoice. The row shows the
 * applied figure — the rest is still credit — and saying so prevents "we took
 * ₹2,000 but the invoice says ₹1,500" being read as a missing payment.
 */
const isPartial = pay =>
  isAdvance(pay) && Number(pay?.payment_amount || 0) - Number(pay?.amount || 0) > 0.01;
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

/**
 * A full timestamp, for the audit footer.
 *
 * Separate from fmtDate on purpose: that one deliberately strips the time,
 * because invoice_date and paid_at are calendar DATES and building them from
 * parts is what stops them rendering a day early west of UTC. created_at and
 * updated_at are real instants — they carry a timezone and want the clock time,
 * which is the whole point of an audit line.
 */
function fmtDateTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
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

// ── Add Payment Modal ─────────────────────────────────────────────────────────
// Was a permanent bar above the payments table. On a settled invoice that is
// five fields of pure noise, and it was the widest block in the detail pane.
// Now a dialog behind a single Record Payment button.
function AddPaymentModal({ invoiceId, balance, onClose, onSuccess, showToast }) {
  useEscapeClose(onClose);
  // Amount pre-filled with the full balance — paying in full is the common
  // case, so it should need no typing. Still editable for a part payment.
  const [form, setForm] = useState({
    amount: balance > 0 ? balance.toFixed(2) : '',
    method: 'cash', reference_no: '', notes: '', paid_at: '',
  });
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
      showToast('Payment recorded.');
      // Close first: onSuccess reloads the invoice, and leaving the dialog up
      // over a reloading record makes it look like nothing happened.
      onClose();
      onSuccess();
    } catch (ex) {
      setErr(ex.message || 'Failed to record payment.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ci-pay-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ci-pay-modal" role="dialog" aria-modal="true" aria-label="Record payment">
        <div className="ci-pay-hd">
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Record Payment</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Balance due <strong>{fmt(balance)}</strong>
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div className="quick-pay-btn-group">
          <button
            type="button"
            className="quick-pay-chip quick-pay-chip-cash"
            onClick={() => setForm(f => ({ ...f, amount: balance.toFixed(2), method: 'cash' }))}
          >
            Full Cash
          </button>
          <button
            type="button"
            className="quick-pay-chip quick-pay-chip-upi"
            onClick={() => setForm(f => ({ ...f, amount: balance.toFixed(2), method: 'upi' }))}
          >
            Full UPI
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
      </div>
    </div>
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

/**
 * One customer invoice, as the shared RecordCard wants it.
 *
 * Module level and used twice — by the split-pane rail and by the LIST view
 * below 760px. Written once so the two can never describe the same invoice
 * differently.
 */
function ciCard(inv) {
  const gt   = parseFloat(inv.grand_total ?? 0);
  const pd   = parseFloat(inv.amount_paid ?? 0);
  const bal  = Math.max(0, gt - pd);
  const meta = STATUS_META[inv.status] || { color: 'var(--text-muted)', label: inv.status || '—' };
  return {
    id: inv.id,
    code: `CI-${String(inv.id).padStart(6, '0')}`,
    date: fmtDate(invoiceDate(inv)),
    name: inv.is_b2b ? (inv.b2b_company_name || inv.customer_name) : inv.customer_name,
    sub: [inv.vehicle_number, [inv.make_name, inv.model_name].filter(Boolean).join(' ')]
           .filter(Boolean).join(' • '),
    status: meta.label,
    statusColor: meta.color,
    // Same two markers the table shows beside the customer name, so a row does
    // not lose information just because it is being read in the rail.
    badges: [
      ...(inv.is_b2b ? [{ label: 'B2B', title: 'B2B invoice' }] : []),
      ...(inv.warranty_claim_id
        ? [{ label: '🛡 REDO', title: 'Warranty redo invoice', tone: 'warn' }]
        : []),
    ],
    figures: [
      { label: 'Total', value: fmt(gt) },
      { label: 'Paid',  value: fmt(pd) },
      // Only when there IS one — a "₹0.00 due" on every settled invoice is a
      // column of noise down the whole list.
      ...(bal > 0.001 ? [{ label: 'Due', value: fmt(bal), tone: 'due' }] : []),
    ],
  };
}

// ── Detail Drawer ─────────────────────────────────────────────────────────────
function DetailDrawer({ invoiceId, onClose, showToast, onRefreshList, onLoaded }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isHubUser = !!user?.hub_id;
  // Where each linked document lives for THIS user — /estimates for staff,
  // /hub/estimates for a hub login. null means the hub portal has no such
  // screen, and the link is hidden rather than pointed somewhere wrong.
  const P = useAppPaths();


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

  // B2B billing details and the Notes box always print.
  //
  // These were two header checkboxes, both defaulting to on, and were removed
  // as clutter. Kept as constants rather than deleted outright: they are read
  // by the `est-no-print` class logic further down, and inlining `true` at
  // those two sites would leave a pair of conditions that look like dead code
  // and read as if something is being suppressed.
  const includeB2bPrint   = true;
  const includeNotesPrint = true;

  // Editable CI notes — independent of the estimate's notes (which are only
  // copied over once, at generation time).
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [showCollect, setShowCollect] = useState(false);
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

  const [applyingCredit, setApplyingCredit] = useState(false);

  /**
   * Put the customer's unused money on this invoice, oldest receipt first.
   *
   * ONE request, not one per receipt. The server does the whole thing in a
   * single transaction — a browser closed halfway cannot leave the invoice
   * part-paid from three receipts and untouched by a fourth.
   */
  async function applyCustomerCredit() {
    if (!inv || applyingCredit) return;
    setApplyingCredit(true);
    try {
      const out = await api('/api/payments/apply-credit', {
        method: 'POST',
        body: { mobile: inv.mobile, customer_invoice_id: inv.id },
      });
      showToast(out.message);
      await load();
    } catch (e) {
      showToast(e.message || 'Could not apply the credit.', 'error');
    } finally {
      setApplyingCredit(false);
    }
  }

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
  /* …with one presentational exception. subtotal_ex_gst is stored AFTER the
     discount — it is what actually got taxed, which is right for the GST maths
     and wrong to print on a row that has a Discount row directly beneath it:
     the reader subtracts the discount a second time and the column no longer
     reaches the grand total.

         shown    761.18 − 84.58 + 137.02 = 813.62
         actual   Grand Total             = 898.20

     Adding the discount back restores the pre-discount figure, so the printed
     column is the arithmetic a customer can check by hand. No total moves —
     only which of the two numbers this one row displays.

     Correct in both discount modes: transaction-level is subtracted from the
     stored subtotal by the shared calculator, and line-item discounts are
     already baked into each line's rate before it is summed. Either way the
     stored value is net and `totalDiscount` is what came off it. */
  const storedSubtotalExGst = parseFloat(inv?.subtotal_ex_gst ?? 0);
  const subtotal = hasDiscount ? r2(storedSubtotalExGst + totalDiscount) : storedSubtotalExGst;
  const totalGst = parseFloat(inv?.total_gst ?? 0);
  const grandTotal = parseFloat(inv?.grand_total ?? 0);
  /* Signed, and ALREADY inside grand_total — shown as its own row so the column
     still adds up, never added to anything. 0 on every invoice raised before
     the cutoff in backend/src/utils/invoiceRounding.js, and the row is hidden
     at 0 so those invoices look exactly as they always did. */
  const roundOff = parseFloat(inv?.round_off ?? 0);

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
  /**
   * The half-rate to print in the CGST/SGST column headers, or null when the
   * lines do not agree.
   *
   * Only taxed lines count: a zero-GST line (an exempt part, a warranty redo at
   * ₹0) is not a second slab, and letting it in would drop every ordinary
   * invoice back to the generic header for no reason.
   */
  const uniformHalfPct = (() => {
    const rates = [...new Set(
      items.map(i => parseFloat(i.gst_percent ?? 0)).filter(r => r > 0)
    )];
    if (rates.length !== 1) return null;
    const half = rates[0] / 2;
    return half.toFixed(half % 1 === 0 ? 0 : 1);
  })();
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
  // Putting money already received against an invoice is its own permission —
  // see payments.routes.js. Nothing new arrives; what changes is where it counts.
  const canAllocateCredit = useCan('ALLOCATE_PAYMENT');
  const customerCredit = parseFloat(inv?.customer_credit || 0);
  // Taking money through the gateway is its own permission, separate from
  // recording a payment by hand: one opens a charge on the company's merchant
  // account, the other writes a bookkeeping row. Hub logins never see it — the
  // backend refuses them outright, and offering a button that always 403s is
  // worse than not offering one.
  const canCollectOnline = useCan('COLLECT_PAYMENT') && !isHubUser;
  // A link is a public URL that keeps working for whoever it is forwarded to,
  // which is a different risk from taking a payment on a device you are
  // holding — hence its own permission rather than riding on COLLECT_PAYMENT.
  const canPayLink = useCan('CREATE_PAYMENT_LINK') && !isHubUser;
  const [linkBusy, setLinkBusy] = useState(false);

  // ── Send the invoice on WhatsApp ────────────────────────────────────────
  //
  // Its own permission, not COLLECT_PAYMENT: this messages the customer on a
  // channel the workshop pays per conversation for, and a template send is
  // irreversible in a way a payment link (which nobody has to open) is not.
  // Hidden for a hub — the message goes out as Spinoto, from Spinoto's number.
  const canSendWa = useCan('SEND_WHATSAPP') && !isHubUser;
  const [waOpen, setWaOpen]       = useState(false);
  const [waPreview, setWaPreview] = useState(null);
  const [waLoading, setWaLoading] = useState(false);
  const [waSending, setWaSending] = useState(false);
  const [waError, setWaError]     = useState('');
  // The number the message will actually go to, and whether it is being edited.
  //
  // Seeded from the preview rather than from inv.mobile: the dispatcher decides
  // the target (whatsapp number, else mobile) and typing the mobile in here by
  // hand would quietly override a customer's separate WhatsApp number.
  const [waTo, setWaTo]           = useState('');
  const [waEditTo, setWaEditTo]   = useState(false);

  // Preview BEFORE send, always, even though it costs a round trip.
  //
  // wa_templates stores the variable ORDER by hand — Meta owns the body text
  // and this system owns only the list of values to slot into it. A template
  // edited on Interakt without the order being re-transcribed here sends the
  // vehicle number where the amount should be, to a real customer, with no way
  // to recall it. The preview is the only place that mismatch is visible, so
  // the button opens it rather than firing.
  const openWhatsApp = useCallback(async () => {
    if (!inv) return;
    setWaOpen(true); setWaPreview(null); setWaError(''); setWaLoading(true);
    setWaTo(''); setWaEditTo(false);
    try {
      const r = await api(
        `/api/whatsapp/messages/preview?entity_type=invoice&entity_id=${inv.id}` +
        `&template_key=invoice_ready`
      );
      setWaPreview(r);
      setWaTo(r?.to || '');
    } catch (e) {
      setWaError(e.message || 'Could not build the message preview.');
    } finally {
      setWaLoading(false);
    }
  }, [inv]);

  const sendWhatsApp = useCallback(async () => {
    if (!inv) return;
    setWaSending(true); setWaError('');
    try {
      const typed = waTo.trim();
      // `to` is sent ONLY when it differs from what the dispatcher resolved.
      // Echoing the resolved number back would record every send as an override
      // in wa_messages, and the log would stop being able to answer "did we
      // message the number on file, or one somebody typed?".
      const overridden = typed && typed !== (waPreview?.to || '');
      await api('/api/whatsapp/messages/send', {
        method: 'POST',
        body: {
          entity_type: 'invoice',
          entity_id: inv.id,
          template_key: 'invoice_ready',
          ...(overridden ? { to: typed } : {}),
        },
      });
      setWaOpen(false);
      showToast(overridden ? `Invoice queued for ${typed}.` : 'Invoice queued for WhatsApp.', 'success');
    } catch (e) {
      setWaError(e.message || 'Could not send.');
    } finally {
      setWaSending(false);
    }
  }, [inv, showToast, waTo, waPreview]);

  // ── The payment split button ────────────────────────────────────────────
  // Record Payment, Collect Online and Payment Link used to be three buttons
  // side by side, which with Print and Download made five in one header and a
  // second row on a narrow window.
  //
  // They are NOT merged into one menu. Recording money already received and
  // charging a customer's card are different acts, and a flat list would put
  // them one keystroke apart — so Record Payment keeps its own direct click and
  // only the two online actions moved behind the caret.
  //
  // hasPayMenu, not `true`: both online actions are staff-only, so a hub login
  // has nothing behind the caret and must not be shown one. Same for a staff
  // user holding neither permission — the button then renders as an ordinary
  // single button, exactly as it did before this existed.
  const hasPayMenu = canCollectOnline || canPayLink;
  const [showPayMenu, setShowPayMenu] = useState(false);
  const [payMenuRef, payMenuFlip] = useFlipPopup(showPayMenu);
  // Only while the menu is open, so this never competes with a dialog's own
  // Escape handler — the menu is always closed by the time one is showing.
  useEscapeClose(() => setShowPayMenu(false), showPayMenu);

  /**
   * Creates a payment link and puts it on the clipboard in one action.
   *
   * Lifted out of the old button's inline handler unchanged. The menu stays
   * OPEN while this runs — that is what `linkBusy` is for, and closing first
   * would take the "Creating…" label off the screen with nothing in its place.
   */
  async function createPaymentLink() {
    setLinkBusy(true);
    try {
      const r = await api('/api/payments/links', {
        method: 'POST',
        body: { customer_invoice_id: inv.id },
      });
      // Built from this app's own origin rather than the server's configured
      // base when that is unset, so a link is still usable in development
      // instead of reading '/pay/<token>'.
      const url = r.url && r.url.startsWith('http')
        ? r.url
        : `${window.location.origin}/pay/${r.link.token}`;
      await navigator.clipboard?.writeText(url);
      showToast('Payment link copied. It expires in 7 days.');
    } catch (e) {
      showToast(e.message || 'Could not create a payment link.');
    } finally {
      setLinkBusy(false);
      setShowPayMenu(false);
    }
  }

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
        {/* The document number, and nothing else.
            "Customer Invoice #66" said the same thing twice — you are on the
            customer invoice screen — and #66 is not the number printed on the
            document, which is CI-000066. One string that matches the paper.

            The status pill is gone from here too: it is already in the document
            header band below, next to the figures it describes, and a second
            copy in the chrome made the bar compete with the invoice. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Receipt size={18} style={{ color: 'var(--primary)' }} />
          <span style={{ fontWeight: 700, fontSize: 16 }}>
            {inv ? `CI-${String(inv.id).padStart(6, '0')}` : 'Customer Invoice'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* First in the row, and the only filled button: recording a payment
              is the action you came here to take, while Print and Download are
              things you do with the result.

              One condition for all three payment actions, which is why they
              live in one block: the invoice is approved or partially paid AND
              something is still owed. Hidden once the balance reaches zero
              rather than disabled — with nothing left to pay, a permanently
              dead button is worse than none. Because the condition is shared,
              the caret can never be left standing over an empty menu.
              `ci-internal` keeps the whole cluster off the printed invoice. */}
          {canAddPayment && balance > 0.001 && (
            <div className="ci-paysplit ci-internal">
              <button
                type="button"
                className={`btn btn-primary ci-paysplit-main${hasPayMenu ? '' : ' ci-paysplit-solo'}`}
                onClick={() => setShowAddPayment(true)}
              >
                <Plus size={15} /> Record Payment
              </button>

              {hasPayMenu && (
                <button
                  type="button"
                  className="btn btn-primary ci-paysplit-caret"
                  aria-haspopup="menu"
                  aria-expanded={showPayMenu}
                  aria-label="Other ways to take this payment"
                  onClick={() => setShowPayMenu(v => !v)}
                >
                  <ChevronDown
                    size={14}
                    className={`ci-paysplit-chev${showPayMenu ? ' ci-paysplit-chev--on' : ''}`}
                  />
                </button>
              )}

              {showPayMenu && (
                <>
                  {/* Click-anywhere-else to dismiss. A fixed full-screen layer
                      rather than a document listener, so it also swallows the
                      click that closed it — otherwise dismissing the menu would
                      press whatever happened to be underneath. */}
                  <div className="ci-paymenu-backdrop" onClick={() => setShowPayMenu(false)} />
                  <div
                    ref={payMenuRef}
                    className={`ci-paymenu${payMenuFlip ? ' ci-paymenu--flip' : ''}`}
                    role="menu"
                  >
                    {/* CHARGES the customer now — the subtitle is not
                        decoration. Once these sit in a list with Record
                        Payment above them, the one-line difference between
                        "money already received" and "take it now" is the only
                        thing separating two very different acts. */}
                    {canCollectOnline && (
                      <button
                        type="button"
                        role="menuitem"
                        className="ci-paymenu-item"
                        onClick={() => { setShowPayMenu(false); setShowCollect(true); }}
                      >
                        <CreditCard size={15} />
                        <span>
                          Collect Online
                          <span className="ci-paymenu-sub">Charge the customer now</span>
                        </span>
                      </button>
                    )}

                    {/* The customer is not standing here. Creates a link and
                        puts it on the clipboard in one action — the next thing
                        anyone does with it is paste it into WhatsApp, so a
                        dialog in between would be a step that exists only to be
                        dismissed. */}
                    {canPayLink && (
                      <button
                        type="button"
                        role="menuitem"
                        className="ci-paymenu-item"
                        disabled={linkBusy}
                        onClick={createPaymentLink}
                      >
                        <Link2 size={15} />
                        <span>
                          {linkBusy ? 'Creating…' : 'Payment Link'}
                          <span className="ci-paymenu-sub">Copies a link to send</span>
                        </span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Server-rendered themed PDF. Replaces the old window.print() of
              the on-screen layout, which ignored the configured theme, logo
              and accent colour entirely. */}
          <button
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
            className="btn btn-ghost ci-hdr-icon"
            title={themedPdfLoading ? 'Generating the PDF…' : 'Print / PDF'}
            aria-label="Print or open the PDF"
          >
            {themedPdfLoading
              ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              : <Printer size={16} />}
          </button>
          {/* Separate from Print because only a download can carry the proper
              filename. Print opens a blob URL, and a blob URL has no name — the
              viewer's own save button can only produce its blob uuid. */}
          <button
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
            className="btn btn-ghost ci-hdr-icon"
            title={themedPdfSaving ? 'Saving…' : 'Download the PDF as CI-000000_VEHICLE_Model.pdf'}
            aria-label="Download the PDF"
          >
            {themedPdfSaving
              ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              : <Download size={16} />}
          </button>

          {/* Sends the customer the public invoice LINK, not the PDF as an
              attachment — that is what the approved invoice_ready template
              carries, and the link opens the same document with no login.

              Deliberately beside Print and Download rather than in the payment
              menu: this is "give the customer their bill", which is the same
              family of act as printing it, and nothing about it collects
              money. */}
          {canSendWa && (
            <button
              className="btn btn-ghost ci-internal ci-hdr-icon"
              onClick={openWhatsApp}
              title="Send this invoice to the customer on WhatsApp"
              aria-label="Send on WhatsApp"
            >
              <MessageCircle size={16} />
            </button>
          )}

          {/* Close. This is the only in-page way back now that the page-header
              bar is gone, and it is the ONLY one below 1100px where the rail is
              hidden too — the breadcrumb still works, but it is in a different
              part of the screen entirely. Sits last, past the actions, so it
              cannot be hit while reaching for Print. */}
          <button
            className="btn btn-ghost ci-detail-close"
            onClick={onClose}
            title="Close and return to the invoice list"
            aria-label="Close invoice"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {loading ? (
        /* A skeleton, not a centred spinner: a spinner collapses the pane to
           nothing and then drops the real content in at a different height, so
           the whole page jumps when it arrives. */
        <DetailSkeleton rows={3} />
      ) : !inv ? null : (
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ── The document header band ──────────────────────────────────────
              Three columns: who it is for, what it is for, and what it comes to.

              The third one is the change that matters. The summary used to sit
              BELOW the line items, so on any invoice longer than three lines you
              scrolled past the work to find out what was owed — and the totals
              were the reason the invoice was opened. Top-right is where a person
              looks first on a bill.

              It only fits because the rows below carry an ICON instead of an
              84px label column. That is 62px back per row, per column, which is
              roughly what the summary needs. */}
          <div className="ci-doc-meta">
            {/* Who the invoice is for */}
            <div className="ci-doc-col">
              <div className="ci-doc-cap">Bill To</div>
              <div className="ci-doc-rows">
                {[
                  ...(inv.is_b2b ? [
                    { label: 'Company Name', Icon: Building2, value: inv.b2b_company_name, b2b: true },
                    { label: 'GST No', Icon: BadgeCheck, value: inv.b2b_gst_number, b2b: true, mono: true },
                  ] : []),
                  { label: 'Customer', Icon: User, value: inv.customer_name },
                  { label: 'Mobile', Icon: Phone, value: inv.mobile, mono: true },
                  ...(inv.is_b2b ? [
                    { label: 'Address', Icon: MapPin, value: inv.b2b_address, b2b: true, wrap: true },
                  ] : []),
                  {
                    label: 'Hub / Branch',
                    Icon: Landmark,
                    value: (
                      <>
                        <span className="est-no-print">{inv.hub_full_name || inv.hub_name}</span>
                        <span className="est-print-show">{inv.hub_name}</span>
                      </>
                    )
                  },
                ].map(({ label, Icon, value, b2b, mono, wrap }) => (
                  /* title AND aria-label, both. An icon on its own is not a
                     label: without them "9712301573" beside a phone glyph is a
                     guess for a screen reader, and for anyone on their first day.
                     The print stylesheet restores the text labels — a printed
                     invoice has no hover. */
                  <div key={label}
                       className={`ci-doc-il${wrap ? ' ci-doc-il--wrap' : ''}${b2b && !includeB2bPrint ? ' est-no-print' : ''}`}
                       title={label} aria-label={label}>
                    <Icon size={14} aria-hidden="true" />
                    <span className="ci-doc-il-lbl">{label}</span>
                    <span className={mono ? 'ci-doc-il-v ci-doc-mono' : 'ci-doc-il-v'}>{value || '—'}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* What the invoice is for */}
            <div className="ci-doc-col">
              <div className="ci-doc-cap">Vehicle &amp; Invoice</div>
              <div className="ci-doc-rows">
                <div className="ci-doc-il" title="Registration number" aria-label="Registration number">
                  <Car size={14} aria-hidden="true" />
                  <span className="ci-doc-il-lbl">Reg. No.</span>
                  <span className="ci-doc-il-v ci-doc-mono">{inv.vehicle_number || '—'}</span>
                </div>
                {(inv.make_name || inv.model_name) && (
                  <div className="ci-doc-il" title="Make and model" aria-label="Make and model">
                    <Tag size={14} aria-hidden="true" />
                    <span className="ci-doc-il-lbl">Make / Model</span>
                    <span className="ci-doc-il-v">{[inv.make_name, inv.model_name].filter(Boolean).join(' ')}</span>
                  </div>
                )}
                {inv.body_type_name && (
                  <div className="ci-doc-il" title="Body type" aria-label="Body type">
                    <Layers size={14} aria-hidden="true" />
                    <span className="ci-doc-il-lbl">Body Type</span>
                    <span className="ci-doc-il-v">{inv.body_type_name}{inv.segment_names ? ` (${inv.segment_names})` : ''}</span>
                  </div>
                )}
                {/* `!= null`, not a truthiness test: 0 km is a real reading on a
                    brand-new vehicle, and `inv.odometer_km &&` would drop it.
                    Same guard the estimate drawer and the PDF adapter use.

                    The value has been in the API response all along
                    (customer_invoices.controller.js selects ci.odometer_km) and
                    on the printed invoice — this screen was the one place that
                    never read it. */}
                {inv.odometer_km != null && (
                  <div className="ci-doc-il" title="Odometer reading" aria-label="Odometer reading">
                    <Gauge size={14} aria-hidden="true" />
                    <span className="ci-doc-il-lbl">Odometer</span>
                    <span className="ci-doc-il-v">{Number(inv.odometer_km).toLocaleString('en-IN')} km</span>
                  </div>
                )}

                {/* Invoice meta */}
                {[
                  { label: 'Invoice No.', Icon: FileText, mono: true, value: `CI-${String(inv.id).padStart(6, '0')}` },
                  {
                    label: 'Date',
                    Icon: Calendar,
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
                  { label: 'Status', Icon: BadgeCheck, node: <StatusBadge status={inv.status} /> },
                  ...(inv.warranty_claim_id ? [{
                    label: 'Invoice Type',
                    Icon: BadgeCheck,
                    node: (
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 99,
                        background: '#fef3c7', color: '#92400e', whiteSpace: 'nowrap',
                      }}>
                        🛡 Warranty Redo{inv.warranty_claim_code ? ` — Claim ${inv.warranty_claim_code}` : ''}
                      </span>
                    ),
                  }] : []),
                ].map(({ label, Icon, value, node, mono }) => (
                  <div key={label} className="ci-doc-il" title={label} aria-label={label}>
                    <Icon size={14} aria-hidden="true" />
                    <span className="ci-doc-il-lbl">{label}</span>
                    {node ?? <span className={mono ? 'ci-doc-il-v ci-doc-mono' : 'ci-doc-il-v'}>{value || '—'}</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* ── What it comes to ────────────────────────────────────────────
                Moved here from below the line items. The words stay words: these
                are distinct legal amounts on a tax document and a reader has to
                be certain which is which — no icon distinguishes CGST from SGST,
                and space was never the constraint in this column. */}
            <div className="ci-doc-col ci-doc-col--sum">
              <div className="ci-doc-cap">Summary</div>
              <div className="ci-doc-sum">
                <div className="ci-doc-sumrow">
                  <span>Subtotal (ex-GST)</span><b>{fmt(subtotal)}</b>
                </div>

                {hasDiscount && (
                  <div className="ci-doc-sumrow ci-doc-sumrow--disc">
                    <span>
                      {ciDiscountMode === 'transaction'
                        ? `Discount (${ciTxDiscountType === 'percent' ? ciTxDiscountValue + '%' : '₹' + ciTxDiscountValue})`
                        : 'Total Discount'}
                    </span>
                    <b>−{fmt(totalDiscount)}</b>
                  </div>
                )}

                {/* Each slab, not a single "tax" line: a two-slab invoice owes
                    two different rates and the GST return needs them apart. */}
                {gstSlabs.map(slab => {
                  const halfLabel = (slab.pct / 2).toFixed(slab.pct % 2 === 0 ? 0 : 1);
                  return (
                    <div key={slab.pct} className="ci-doc-taxpair">
                      <div className="ci-doc-taxrow"><span>CGST {halfLabel}%</span><span>{fmt(slab.cgst)}</span></div>
                      <div className="ci-doc-taxrow"><span>SGST {halfLabel}%</span><span>{fmt(slab.sgst)}</span></div>
                    </div>
                  );
                })}

                {Math.abs(roundOff) > 0.001 && (
                  <div className="ci-doc-sumrow">
                    <span>Round Off</span>
                    <b>{roundOff < 0 ? `−${fmt(Math.abs(roundOff))}` : fmt(roundOff)}</b>
                  </div>
                )}

                <div className="ci-doc-sumrule" />

                {/* One of the only two places green appears on this screen. The
                    other is the Paid pill. Used in five places it meant nothing;
                    used twice it means "this is the number" and "this is
                    settled". */}
                <div className="ci-doc-total"><span>Grand Total</span><b>{fmt(grandTotal)}</b></div>
                <div className="ci-doc-sumrow"><span>Paid</span><b>{fmt(paid)}</b></div>
                <div className={`ci-doc-sumrow ci-doc-due${balance > 0.001 ? ' ci-doc-due--open' : ''}`}>
                  <span>Balance Due</span><b>{fmt(balance)}</b>
                </div>
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
                    {/* THE RATE GOES IN THE HEADER ONLY IF EVERY LINE SHARES IT.
                        Three columns — CGST %, SGST %, Tax Amount — carried two
                        facts, and the third was a total of the first two. Rate in
                        the header, rupees in the cells, is how a GST invoice is
                        normally read and what the printed PDF already does.

                        But an invoice CAN mix slabs (5% parts beside 18% labour),
                        and a header claiming 9% over a column holding two
                        different rates would be a false statement on a tax
                        document. When they differ the header stays generic and
                        each cell shows its own rate. */}
                    <th style={{ textAlign: 'right' }}>{uniformHalfPct != null ? `CGST ${uniformHalfPct}%` : 'CGST'}</th>
                    <th style={{ textAlign: 'right' }}>{uniformHalfPct != null ? `SGST ${uniformHalfPct}%` : 'SGST'}</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr><td colSpan={hasDiscount ? 10 : 9} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>No items</td></tr>
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
                        {/* Halved, because CGST and SGST each take half of the
                            slab. gstAmt is the whole of it, so displaying it in
                            both columns would show twice the tax that was
                            charged. */}
                        <td style={{ textAlign: 'right' }}>
                          {halfPct > 0 ? fmt(gstAmt / 2) : '—'}
                          {uniformHalfPct == null && halfPct > 0 && (
                            <span className="ci-doc-rate">{halfPct.toFixed(halfPct % 1 === 0 ? 0 : 1)}%</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {halfPct > 0 ? fmt(gstAmt / 2) : '—'}
                          {uniformHalfPct == null && halfPct > 0 && (
                            <span className="ci-doc-rate">{halfPct.toFixed(halfPct % 1 === 0 ? 0 : 1)}%</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Amount in words, and notes ──
              The totals that used to sit to the right of this are in the header
              band now. What is left is a caption and a sentence, so it is a
              caption and a sentence — not a card with a coloured stripe down its
              side, which is a lot of decoration for one line of text. */}
          <div className="ci-doc-words-block">

            {/* The sentence on the left, Add note on the right of the SAME line.
                Stacked, a dashed 130px box sitting under a one-line sentence was
                the loudest thing in the lower half of the document — and it left
                two thirds of the band empty, which is what made this area read as
                unfinished rather than as the foot of an invoice. */}
            <div className="ci-doc-words-row">
              <div className="ci-doc-words">
                <span className="ci-doc-cap">Amount in Words</span>
                <em>{amountToWords(parseFloat(grandTotal))}</em>
              </div>
              {!(inv.notes || editingNotes) && (
                <button
                  type="button"
                  className="ci-doc-addnote est-no-print"
                  onClick={() => { setNotesDraft(''); setEditingNotes(true); }}
                >
                  <Plus size={13} /> Add note
                </button>
              )}
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

              {(inv.notes || editingNotes) && (
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
              )}
          </div>

          {/* ── Warranty & Guarantee + Payments — side by side ── */}
          {/* Both are PANELS now — a bordered box with a grey header strip —
              rather than a bare <h4> above a table. Two headings floating over
              two differently-shaped blocks of content is what left this half of
              the screen looking like two unrelated widgets that happened to land
              beside each other. The border is what says "these are two things,
              and each one ends here". */}
          <div className="ci-panels">

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
                <section className="ci-panel ci-panel--wg">
                  <div className="ci-panel-h">
                    <span className="ci-doc-cap">Warranty &amp; Guarantee</span>
                    <span className="ci-panel-count">{groups.length}</span>
                  </div>
                  <div className="ci-panel-scroll">
                    <table className="ci-table ci-panel-table ci-coverage-table">
                      <thead>
                        <tr>
                          <th style={{ width: '45%' }}>Service / Package</th>
                          <th style={{ width: '22%' }}>Type</th>
                          <th style={{ width: '33%' }}>Validity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map((g, i) => (
                          <tr key={i}>
                            <td className="ci-panel-strong">{g.names.join(', ')}</td>
                            {/* Was an emoji — 🛡 and ✔ render as a colour glyph in
                                the OS font and were two of the few cartoon marks
                                left on the document. A stroked icon matches every
                                other icon on the page. */}
                            <td>
                              <span className={g.ptype === 'Guarantee' ? 'ci-panel-tag ci-panel-tag--g' : 'ci-panel-tag'}>
                                {g.ptype === 'Guarantee'
                                  ? <BadgeCheck size={12} aria-hidden="true" />
                                  : <ShieldCheck size={12} aria-hidden="true" />}
                                {g.ptype}
                              </span>
                            </td>
                            <td>{g.label}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* The footer carries the validity note AND the claim
                      controls. They used to be a separate row hanging below the
                      table, outside any box, one of them a bright amber pill —
                      which gave two internal buttons more weight than the
                      coverage they refer to.

                      Claim actions are internal and never printed. Hidden
                      entirely for a hub: every control here goes to
                      /warranty-claims, which the hub portal has no screen for.
                      Claims are raised and tracked by Spinoto. */}
                  <div className="ci-panel-foot">
                    <span>Valid from the date of invoice.</span>
                    {P.warrantyClaims && (
                      <span className="ci-internal ci-panel-foot-acts">
                        {/* Existing claims — one chip per claim, linking to it */}
                        {claimables.filter(it => it.claim_id).map((it, i) => (
                          <button
                            key={it.id || i}
                            type="button"
                            className="ci-claimchip"
                            onClick={(e) => { e.stopPropagation(); navigate(`${P.warrantyClaims}?claim=${it.claim_id}`); }}
                            title={`${cleanItemName(it.description || it.name)} — open this ${it.claim_type || 'warranty'} claim`}
                          >
                            {it.claim_type === 'guarantee'
                              ? <BadgeCheck size={11} aria-hidden="true" />
                              : <ShieldCheck size={11} aria-hidden="true" />}
                            {it.claim_code || `Claim #${it.claim_id}`}
                            <em>· {(it.claim_status || '').replace(/_/g, ' ')}</em>
                          </button>
                        ))}
                        {/* One entry point for new claims — the register modal
                            already lists this customer's claimable items */}
                        {inv.status === 'paid' && claimables.some(it => !it.claim_id) && (
                          <button
                            type="button"
                            className="ci-doc-reflink"
                            onClick={(e) => { e.stopPropagation(); navigate(`${P.warrantyClaims}?register_mobile=${encodeURIComponent(inv.mobile || '')}`); }}
                            title="Register a warranty/guarantee claim for an item on this invoice"
                          >
                            Register a claim
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                </section>
              );
            })()}

            {/* Right — Payments */}
            <div className="ci-panel-stack">
            <section className="ci-panel">
            <div className="ci-panel-h">
              <span className="ci-doc-cap">Payments</span>
              <span className="ci-panel-count">{payments.length}</span>
            </div>

            {/* ── Credit the customer has already given us ─────────────────
                An advance taken against the estimate applied itself when this
                invoice was generated. Money taken ON ACCOUNT has no such
                destination, so it waits — and waiting unseen is how a customer
                who has already paid gets billed the full amount again.

                So the invoice says so, here, where somebody is about to chase
                the balance. It offers; it does not decide — the money may have
                been left for a different vehicle. */}
            {customerCredit > 0.01 && canAllocateCredit && (
              <div className="ci-panel-alert ci-internal">
                <div className="ci-panel-alert-t">
                  {fmt(customerCredit)} credit available
                </div>
                <div className="ci-panel-alert-s">
                  This customer has already paid this money and it is not on any invoice yet.
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={applyingCredit}
                  onClick={applyCustomerCredit}
                  style={{ marginTop: 9, fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {applyingCredit ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={13} />}
                  Apply {fmt(Math.min(customerCredit, parseFloat(inv.balance || 0)))} to this invoice
                </button>
              </div>
            )}
            {payments.length === 0 ? (
              <div className="ci-panel-empty">No payments recorded yet.</div>
            ) : (
              <div className="ci-panel-scroll">
                <table className="ci-table ci-panel-table ci-payments-table">
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
                              {/* Online payments carry the gateway's date, and the
                                  backend refuses to move it — offering a pencil
                                  that always 409s is worse than offering none. */}
                              {canEditPayDate && !isOnline(pay) && !isAdvance(pay) && (
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
                        <td>
                          <MethodBadge method={pay.method} />
                          {isOnline(pay) && (
                            <span
                              title={pay.txn_ref ? `Reference ${pay.txn_ref}` : 'Taken through the payment gateway'}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 5, padding: '1px 6px', borderRadius: 999, fontSize: 9.5, fontWeight: 700, letterSpacing: .3, background: 'var(--bg-soft)', color: 'var(--text-muted)', verticalAlign: 'middle' }}
                            >
                              <CreditCard size={9} /> ONLINE
                            </span>
                          )}
                          {/* Money taken before this invoice existed. The badge
                              carries the receipt number, because that is the
                              document the customer was given and the number an
                              accountant will match this line against. */}
                          {isAdvance(pay) && (
                            <span
                              title={pay.voucher_no
                                ? `Advance receipt ${pay.voucher_no} — taken before this invoice was raised`
                                : 'Advance taken before this invoice was raised'}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 5, padding: '1px 6px', borderRadius: 999, fontSize: 9.5, fontWeight: 700, letterSpacing: .3, background: '#fef3c7', color: '#92400e', verticalAlign: 'middle' }}
                            >
                              <Wallet size={9} /> ADVANCE
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          <div>{pay.voucher_no || pay.txn_ref || pay.reference_no || '—'}</div>
                          {/* Part of the advance is still credit. Without this
                              line the applied figure reads as a smaller payment
                              than the customer remembers making. */}
                          {isPartial(pay) && (
                            <div style={{ fontSize: 10, color: '#92400e', marginTop: 2 }}>
                              {fmt(pay.payment_amount)} advance · {fmt(pay.amount)} applied here
                            </div>
                          )}
                          {pay.notes && (
                            <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2, fontStyle: 'italic' }}>
                              Note: {pay.notes}
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(pay.amount)}</td>
                        {canDeletePay && (
                          <td>
                            {/* Gateway money is reversed by refund, never deleted —
                                the ledger row and its payment_transactions record
                                have to stay together. The Payments screen owns
                                that action, so this cell points there instead of
                                offering a button the backend will refuse. */}
                            {/* An advance cannot be edited or deleted here, but
                                it CAN be opened — the receipt voucher is the
                                document the customer holds, and the invoice is
                                where someone goes looking for it. */}
                            {isAdvance(pay) ? (
                              <button
                                className="icon-action"
                                title={`Open receipt ${pay.voucher_no || ''} — this advance is managed from the customer's Payments tab`}
                                onClick={() => openAdvanceVoucher(pay.id)
                                  .catch(e => alert(e.message))}
                              >
                                <FileText size={13} />
                              </button>
                            ) : isOnline(pay) ? (
                              <span
                                title="Taken online — refund it from the Payments screen rather than deleting it"
                                style={{ color: 'var(--text-muted)', display: 'inline-flex' }}
                              >
                                <Lock size={12} />
                              </span>
                            ) : (
                              <button
                                className="icon-action icon-action--danger"
                                title="Delete payment"
                                disabled={deletingPayId === pay.id}
                                onClick={() => (inv.status === 'paid' || hubAlreadyPaid > 0) ? setConfirmDeletePay(pay) : deletePayment(pay.id)}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            </section>{/* /payments panel */}

            {/* Payment links raised against THIS invoice.
                PaymentLinksPanel has always taken a customerInvoiceId and
                nothing ever passed one, so a link created from this screen
                vanished the moment the clipboard was overwritten — no way to
                see whether it had been opened, when it expires, or to cancel
                it, without going to the Payments module and searching.

                Its own panel rather than a second heading inside the Payments
                box: a link is not a payment, and stacking them under one
                border said they were the same list. */}
            {canCollectOnline && (
              <section className="ci-panel ci-internal">
                <div className="ci-panel-h">
                  <span className="ci-doc-cap">Payment links</span>
                </div>
                <PaymentLinksPanel customerInvoiceId={inv.id} />
              </section>
            )}

            </div>{/* /right stack */}
          </div>{/* /panels */}

          {/* ── Where this invoice came from, and who made it ──
              These were two large pill buttons — the most visually prominent
              controls on a page whose job is to show an invoice. They are
              NAVIGATION, not actions: nobody opens an invoice in order to press
              them. As links in the audit footer they are still one click away
              and no longer compete with Print, Download and Record Payment.

              It sits LAST, under the panels, because that is what a footer is —
              between the invoice and the panels it was a rule across the middle
              of the page, splitting the document from the things attached to it.

              The created/updated line is new. An invoice with no author and no
              last-touched time is the one somebody asks about six months later. */}
          <div className="ci-doc-foot ci-internal">
            <span className="ci-doc-foot-who">
              Created{inv.created_by_name ? ` by ${inv.created_by_name}` : ''}
              {inv.created_at ? ` · ${fmtDateTime(inv.created_at)}` : ''}
              {inv.updated_at && inv.updated_at !== inv.created_at
                ? ` · Last updated ${fmtDateTime(inv.updated_at)}`
                : ''}
            </span>
            {!isHubUser && (inv?.estimate_id || inv?.linked_purchase_invoice_id) && (
              <span className="ci-doc-foot-links">
                {inv.estimate_id && (
                  <button type="button" className="ci-doc-reflink"
                    onClick={() => navigate(inv.estimate_token ? `${P.estimates}/${inv.estimate_token}` : P.estimates, inv.estimate_token ? undefined : { state: { openId: inv.estimate_id } })}>
                    EST-{String(inv.estimate_id).padStart(6, '0')}
                  </button>
                )}
                {inv.linked_purchase_invoice_id && (
                  <button type="button" className="ci-doc-reflink"
                    onClick={() => navigate(inv.linked_purchase_invoice_token ? `${P.salesInvoices}/${inv.linked_purchase_invoice_token}` : P.salesInvoices, inv.linked_purchase_invoice_token ? undefined : { state: { openId: inv.linked_purchase_invoice_id } })}>
                    Spinoto Invoice #{inv.linked_purchase_invoice_id}
                  </button>
                )}
              </span>
            )}
          </div>

          {/* The Add Payment bar used to sit here. It is a dialog now, opened
              from the button beside the Payments heading — see showAddPayment. */}
          {showAddPayment && (
            <AddPaymentModal
              invoiceId={invoiceId}
              balance={balance}
              showToast={showToast}
              onClose={() => setShowAddPayment(false)}
              onSuccess={async () => { await load(); onRefreshList(); }}
            />
          )}

          {showCollect && (
            <CollectPaymentModal
              invoice={inv}
              balance={balance}
              showToast={showToast}
              onClose={() => setShowCollect(false)}
              // Reloaded even when verification errored: the webhook may have
              // recorded the capture in the meantime, and the freshest truth is
              // on the server, never in this component's state.
              onSuccess={async () => { await load(); onRefreshList(); }}
            />
          )}

          {/* No footer here. "Thank you for your business", the
              computer-generated-invoice line and the phone/email strip belong on
              the DOCUMENT, not the screen — on screen they are three lines of
              boilerplate under every invoice you look at.

              They are not hidden with @media print: the PDF and the printed copy
              are rendered server-side from backend/src/utils/documentConfig.js,
              which carries its own copy. Deleting this one changes the screen
              only, and there is no second copy here to drift out of sync. */}

          {/* ── Confirm: delete payment off a PAID invoice ── */}
          {/* ── WhatsApp: preview, then send ────────────────────────────────
              Shows the destination number and every value that will be slotted
              into the template, in position order. If the dispatcher could not
              resolve one, it is listed and Send stays disabled — sending a
              template with a hole in it is not recoverable. */}
          {waOpen && (
            <div className="modal-backdrop" style={{ zIndex: 1100 }} onClick={() => !waSending && setWaOpen(false)}>
              <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
                <div className="modal-header">
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <MessageCircle size={16} style={{ color: '#0f766e' }} /> Send on WhatsApp
                  </h3>
                  <button className="modal-close" disabled={waSending} onClick={() => setWaOpen(false)}><X size={18} /></button>
                </div>
                <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 13 }}>
                  {waLoading && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                      <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Building the preview…
                    </div>
                  )}

                  {waError && (
                    <div className="ci-wa-bad">{waError}</div>
                  )}

                  {waPreview && (
                    <>
                      {/* The destination, editable.
                          Read-only until you ask for it: the number on file is
                          right almost every time, and an open input box invites
                          a typo into the one field where a typo means the
                          invoice goes to a stranger. Change is one click away
                          for the case that matters — the customer gives a
                          different number at the counter. */}
                      <div className="ci-wa-to">
                        <span className="ci-doc-cap">Sending to</span>
                        {waEditTo ? (
                          <>
                            <input
                              className="form-input ci-wa-num"
                              value={waTo}
                              maxLength={20}
                              inputMode="tel"
                              autoFocus
                              placeholder="+919812345678"
                              onChange={e => setWaTo(e.target.value)}
                            />
                            <span className="ci-wa-note">
                              Include the country code. The server normalises it before sending, and
                              rejects a number it cannot read rather than guessing.
                              {waTo.trim() !== (waPreview.to || '') && (
                                <>
                                  {' '}
                                  <button type="button" className="ci-doc-reflink" onClick={() => setWaTo(waPreview.to || '')}>
                                    Use the number on file
                                  </button>
                                </>
                              )}
                            </span>
                          </>
                        ) : (
                          <>
                            <div className="ci-wa-torow">
                              <strong>{waTo || waPreview.to || '—'}</strong>
                              <button type="button" className="ci-doc-reflink" onClick={() => setWaEditTo(true)}>
                                <Pencil size={11} /> Change
                              </button>
                            </div>
                            {/* The customer gave a WhatsApp number different from
                                the one on the job, or gave none and we fell back.
                                Worth saying out loud before it goes. */}
                            {waPreview.fell_back_to_mobile && (
                              <span className="ci-wa-note">No separate WhatsApp number on file — using the mobile.</span>
                            )}
                          </>
                        )}
                        {/* Loud, because this is the case where the invoice
                            reaches somebody who is not the customer. */}
                        {waTo.trim() && waTo.trim() !== (waPreview.to || '') && (
                          <span className="ci-wa-warn">
                            Not the number on this invoice — {waPreview.to || 'none on file'}.
                          </span>
                        )}
                      </div>

                      {/* Position order, because position IS the contract with
                          the approved template. Reading them top to bottom is
                          how a wrong mapping becomes visible. */}
                      <div className="ci-wa-vars">
                        {(waPreview.positions || []).map(p => (
                          <div key={p.position} className="ci-wa-var">
                            <span>{p.key.replace(/_/g, ' ')}</span>
                            <b>{p.value || '—'}</b>
                          </div>
                        ))}
                      </div>

                      {waPreview.missing?.length > 0 && (
                        <div className="ci-wa-bad">
                          Cannot send — no value for {waPreview.missing.join(', ')}.
                          {waPreview.missing.includes('invoice_link')
                            ? ' PUBLIC_APP_URL is not set on the server, so there is no address to send.'
                            : ''}
                        </div>
                      )}

                      {/* Approving the invoice already queues this same
                          template automatically. A manual send bypasses that
                          dedupe on purpose — which is right for a re-send and
                          surprising if you did not know it happened. */}
                      {inv?.status !== 'draft' && !waPreview.missing?.length && (
                        <div className="ci-wa-note">
                          The customer may already have received this when the invoice was approved.
                          Sending now delivers another copy.
                        </div>
                      )}
                    </>
                  )}

                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 2 }}>
                    <button className="btn btn-ghost" disabled={waSending} onClick={() => setWaOpen(false)}>Cancel</button>
                    <button
                      className="btn btn-primary"
                      disabled={waSending || waLoading || !waPreview?.ok
                                || waPreview?.missing?.length > 0
                                /* Blanking the field is not "send to the number
                                   on file" — it is an unfinished edit. */
                                || !waTo.trim()}
                      onClick={sendWhatsApp}
                    >
                      {waSending ? 'Sending…' : 'Send'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

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
/**
 * Filters arriving by URL, e.g. from the Hub Revenue report's
 * /customer-invoices?hub_ids=3&from=2026-08-01&to=2026-08-31 links.
 *
 * A deep link is someone saying "show me exactly this", so it OVERRIDES the
 * session-restored filters rather than merging with them — landing here with
 * last week's status filter still applied would show a different set of rows
 * than the number that was clicked.
 *
 * Only the keys actually present are overridden: `?hub_ids=3` alone must not
 * silently wipe a date range the person set themselves, because they may have
 * arrived from a link that only ever meant to say "this hub".
 *
 * Returns null when there is nothing to apply, so the caller can tell "no
 * deep link" apart from "a deep link that clears everything".
 */
export function urlFilterSeed(searchStr) {
  const q = new URLSearchParams(searchStr || '');
  const seed = {};

  const hubIds = q.get('hub_ids') ?? q.get('hub_id');
  if (hubIds !== null) {
    // Strings, not numbers: hubFilter is compared against String(h.id)
    // throughout this page, and a numeric 3 would never match "3".
    seed.hubFilter = hubIds.split(',').map(v => v.trim()).filter(Boolean);
  }
  // Dates go straight to the API, which casts them with ::date — a value
  // Postgres cannot parse throws and 500s the whole list, so anything
  // suspicious is dropped here rather than forwarded.
  //
  // Shape alone is not enough: /^\d{4}-\d{2}-\d{2}$/ happily accepts
  // "2026-13-99". The round trip through Date is what rejects a month of 13 or
  // a 31st of February — an invalid date normalises to some other day, so it
  // no longer prints as what went in.
  const isDate = v => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  };
  const from = q.get('from');
  const to   = q.get('to');
  if (from !== null) seed.fromDate = isDate(from) ? from : '';
  if (to   !== null) seed.toDate   = isDate(to)   ? to   : '';

  const status = q.get('status');
  if (status !== null) seed.statusFilter = status;

  return Object.keys(seed).length ? seed : null;
}

// ═════════════════════════════════════════════════════════════════════════════
export default function CustomerInvoicesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = useParams();
  const isHubUser = !!user?.hub_id;
  // This page is mounted twice: at /customer-invoices for staff and at
  // /hub/customer-invoices inside the hub portal. P resolves every
  // destination — including this page's own URL — for whichever is rendering.
  const P = useAppPaths();


  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  // Money totals for EVERY row the current filters match, not just this page.
  // They come from the server for exactly that reason.
  const [totals, setTotals] = useState(null);
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
  // Read once, on mount. A ref rather than a live hook: this seeds initial
  // state, and re-reading it on every render would fight the user the moment
  // they changed a filter by hand while the query string still said otherwise.
  const urlSeedRef = useRef(urlFilterSeed(location.search));
  const seed = urlSeedRef.current;

  const [hubFilter, setHubFilter] = useState(
    // A hub user is scoped to their own hub and cannot widen it — the seed
    // must not override that.
    () => (user?.hub_id ? [String(user.hub_id)]
                        : seed?.hubFilter ?? ls.hubFilter ?? [])
  );
  const [showHubDropdown, setShowHubDropdown] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [filterPopRef, filterPopFlip] = useFlipPopup(showMoreFilters);
  const [statusFilter, setStatusFilter] = useState(seed?.statusFilter ?? ls.statusFilter ?? '');
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState(ls.vehicleTypeFilter ?? '');
  // Invoice-date range — both optional; either can be set alone (open-ended).
  const [fromDate, setFromDate] = useState(seed?.fromDate ?? ls.fromDate ?? '');
  const [toDate, setToDate] = useState(seed?.toDate ?? ls.toDate ?? '');
  const [hubs, setHubs] = useState([]);

  // Below this width the invoice table stops being readable and the list
  // switches to cards. Not CSS-only: rendering both and hiding one puts every
  // row in the DOM twice, on the device least able to afford it.
  const isNarrow = useMediaQuery(MOBILE_LIST_QUERY);

  // ── Restored after the split-pane extraction ──
  // The refactor that moved the rail into useDetailRail sliced from the rail's
  // first line to fetchInvoices, and everything between went with it: the
  // toast, the open/close plumbing, the token resolver and the filter count.
  // The build stayed green because these are runtime references — only an
  // undeclared-identifier pass catches it, and that is the check to run after
  // any block deletion.

  // Persist whenever any of these change. searchInput, not search: restore the
  // box exactly as they left it, even mid-word.
  useEffect(() => {
    writeListState('sp_customer_invoices_list_v1', {
      search: searchInput, page, pageSize, statusFilter, vehicleTypeFilter, hubFilter, fromDate, toDate,
    });
  }, [page, pageSize, searchInput, statusFilter, vehicleTypeFilter, hubFilter, fromDate, toDate]);

  useListScrollRestore('sp_customer_invoices_list_v1', !loading);

  // How many of the filters hidden behind the funnel are actually on.
  const hiddenFilterCount = (vehicleTypeFilter ? 1 : 0) + ((fromDate || toDate) ? 1 : 0);

  const [showVehHistory, setShowVehHistory] = useState(false);

  // Auto-open a specific invoice when navigated here from another page.
  const [selectedId, setSelectedId] = useState(() => location.state?.openId ?? null);
  const [toast, setToast] = useState(null);

  // Claim the top bar's search box. Declared after selectedId because it reads
  // it: the box is released while a single invoice is open, since searching a
  // list you cannot see is a control that appears to do nothing.
  usePageSearch({
    value: searchInput,
    onChange: onSearchChange,
    placeholder: 'Name, mobile, vehicle no. or CI-000012',
    hint: tooShort ? `${minChars}+ characters` : '',
    enabled: !selectedId,
  });

  const showToast = useCallback((msg, type = 'success') => setToast({ msg, type }), []);

  const resolvedTokenRef = useRef(null);
  // Flips true the instant the user explicitly closes the detail view. Guards
  // against a slow or late-resolving fetch firing its onLoaded/navigate
  // callback AFTER the user has already gone back to the list — without this a
  // stale response could silently re-push the token URL into the address bar
  // while the list is showing.
  const closedRef = useRef(false);

  function openInvoice(inv) {
    closedRef.current = false;
    resolvedTokenRef.current = inv.public_token;
    setSelectedId(inv.id);
    // Only route by token when there IS one. `${null}` stringifies to the
    // four characters "null" — a valid-looking URL that 404s on by-token/null
    // and prints "null" in the breadcrumb. Rows from before migration 085
    // (added the column, never backfilled) still have nulls; 165 repairs them
    // and this stops a future one becoming a broken URL. The record still
    // opens either way — only the address bar is skipped.
    if (inv.public_token) navigate(`${P.customerInvoices}/${inv.public_token}`);
  }

  function closeInvoice() {
    closedRef.current = true;
    resolvedTokenRef.current = null;
    // Cleared directly rather than left to the `[token]` effect. Belt-and-
    // braces now that the hub portal is routed too, but a record reached via
    // location.state has no token param to change.
    setSelectedId(null);
    navigate(P.customerInvoices);
  }

  function handleInvoiceLoaded(inv) {
    if (closedRef.current) return;
    if (!inv?.public_token || resolvedTokenRef.current === inv.public_token) return;
    resolvedTokenRef.current = inv.public_token;
    navigate(`${P.customerInvoices}/${inv.public_token}`, { replace: true });
  }

  // Resolve an inbound /customer-invoices/:token into a selectedId.
  useEffect(() => {
    // "null"/"undefined" are the STRINGS a template literal makes from a
    // missing token. Truthy, so `!token` never caught them and the effect
    // asked the API for a record whose token is literally "null".
    const real = token && token !== 'null' && token !== 'undefined' ? token : null;
    if (!real) {
      // Only clear if we were previously showing a token-resolved invoice —
      // do not stomp a selectedId that came from location.state (an inbound
      // deep link) before it has resolved its own token.
      if (resolvedTokenRef.current) setSelectedId(null);
      resolvedTokenRef.current = null;
      return;
    }
    closedRef.current = false;

    // openInvoice already knows the id and stores the token before navigating,
    // so by the time this effect sees the new token the record is already
    // selected. Without this guard every click fires a second, pointless
    // request that resolves to the id we set a moment ago.
    // The fetch still runs for a token that arrived from OUTSIDE — a pasted
    // link, a bookmark, a cross-page navigation — which is what it is for.
    if (resolvedTokenRef.current === real) return;

    // Claimed BEFORE the request, so an effect re-run cannot fire a second one.
    // Cleared again on failure so a retry is possible.
    resolvedTokenRef.current = real;

    // NO per-run "cancelled" flag here, and that omission is load-bearing.
    //
    // StrictMode runs every effect twice on mount: run, clean up, run again.
    // With a cancel flag the sequence was:
    //   1. run #1 claims the token and starts the request
    //   2. cleanup #1 sets cancelled = true
    //   3. run #2 sees the token already claimed and returns early
    //   4. request #1 lands, sees its cancelled flag, and discards the result
    // Nothing ever called setSelectedId, so arriving at /customer-invoices/:token
    // from an Estimate, a Purchase Invoice, a bookmark or a reload showed the
    // LIST with the correct URL. Dev only — a production build does not
    // double-invoke — which is the worst way for it to fail.
    //
    // Without the flag, run #1's response still lands and opens the record.
    // `closedRef` remains, and is the guard that actually matters: it stops a
    // slow response re-opening a record the user has already closed.
    // This is exactly how the Estimates and Purchase Invoices resolvers work,
    // which is why neither of them ever had this bug.
    api(`/api/customer-invoices/by-token/${real}`)
      .then(res => { if (!closedRef.current && res?.item?.id) setSelectedId(res.item.id); })
      .catch(() => {
        resolvedTokenRef.current = null;
        showToast('That invoice could not be opened.', 'error');
      });
  }, [token, showToast]);

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
      setTotals(res.totals || null);
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

  /* ── The hub list the Hubs filter offers ─────────────────────────────────
     This was missing entirely. `hubs` was declared, the dropdown was built
     against it, and nothing ever called setHubs — so the menu opened empty on
     every load, with no "Select All" either (it is guarded on hubs.length).
     The filter worked perfectly; it simply had nothing to filter by.

     Skipped for a hub login, which is pinned to its own hub and never sees the
     dropdown (`!isHubUser` above) — asking for the full list would be a request
     that can only be refused.

     Swallowed rather than surfaced: /api/hubs is gated on hub and lead
     permissions, none of which an invoices-only user necessarily holds. For
     them the right outcome is the filter they already have — no hubs listed —
     not a red toast on a page they opened to look at invoices. */
  useEffect(() => {
    if (isHubUser) return;
    api('/api/hubs?is_active=true&limit=200')
      .then(r => setHubs(r.items || []))
      .catch(() => { });
  }, [isHubUser]);

  // Filters for the rail, built from the SAME values the table uses so the two
  // can never disagree about what is being listed.
  const buildRailQuery = useCallback(() => {
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    if (hubFilter.length > 0) q.set('hub_ids', hubFilter.join(','));
    if (statusFilter) q.set('status', statusFilter);
    if (vehicleTypeFilter) q.set('vehicle_type', vehicleTypeFilter);
    if (fromDate) q.set('from', fromDate);
    if (toDate) q.set('to', toDate);
    return q;
  }, [search, hubFilter, statusFilter, vehicleTypeFilter, fromDate, toDate]);

  // Name the last breadcrumb. Without this it renders the raw public_token
  // from the URL — "zuOAVWTsZ1vqUw" instead of "CI-000048". Display only:
  // the URL keeps the token, so shared links and bookmarks are unaffected.
  usePageCrumb(token, selectedId ? `CI-${String(selectedId).padStart(6, '0')}` : null);

  const rail = useDetailRail({
    endpoint: '/api/customer-invoices',
    selectedId,
    buildQuery: buildRailQuery,
  });

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
    /* lb-page cancels the app wrapper's padding and max-width. Both views get
       it now: the detail used to be a lone A4 sheet that needed margins to sit
       against, but as one half of a split pane it wants the full width — the
       rail is what it sits against. */
    <div className="ci-page lb-page">
      {/* ── Header ──
          The list view has no title: the top bar's breadcrumb already reads
          "Home › Customer Invoices", and repeating it under the breadcrumb was
          the same words twice with nothing between them. The whole block is
          skipped rather than left empty, so the toolbar rises to fill the gap.

          The DETAIL view keeps its header — there the back button and "Invoice
          Detail" are the only thing telling you which of the two views you are
          looking at. */}
      {/* No detail header bar. The back button and "Invoice Detail" title lived
          here; the breadcrumb above already reads Home > Customer Invoices >
          <token> and its middle segment links back, so this was a second copy
          of navigation that already existed — and it cost the split pane a
          whole row of height above every invoice. The detail's own header
          carries a close button, which is the escape hatch below 1100px where
          the rail is hidden. */}
      {showVehHistory && <VehicleHistoryModal onClose={() => setShowVehHistory(false)} />}

      {selectedId ? (
        /* ── Split pane: list rail + detail ──
            Below 1100px the rail is hidden by CSS and the detail runs full
            width — two panes in 900px would leave neither usable. The way back
            there is the breadcrumb, or the close button in the detail's own
            header bar. */
        <SplitPane
          rail={rail}
          selectedId={selectedId}
          onSelect={openInvoice}
          noun="invoice"
          /* The rail's search box drives the PAGE's search state, not its own —
             two independent searches would disagree the moment you closed the
             detail and the table showed a different set. */
          search={searchInput}
          onSearch={onSearchChange}
          searchHint={tooShort ? `${minChars}+ characters` : ''}
          mapCard={ciCard}
        >
          <DetailDrawer
            invoiceId={selectedId}
            onClose={closeInvoice}
            showToast={showToast}
            onRefreshList={fetchInvoices}
            onLoaded={handleInvoiceLoaded}
          />
        </SplitPane>
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
                  <div ref={filterPopRef} className={`lb-pop${filterPopFlip ? ' lb-pop--flip' : ''}`}>
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
              {/* The tooltip said "Export Excel" while the file that landed was
                  a .csv — it names the file you get, not the app you open it
                  in, because "Excel" set people up to expect an .xlsx. */}
              <button type="button" className="lb-control" onClick={handleExport} title="Download the filtered list as CSV">
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
            ) : isNarrow ? (
              /* ── Card list ──
                  Below 760px the table is ten columns behind a 680px min-width,
                  which on a phone is a horizontal scrollbar showing two of them.
                  These are the same cards the split-pane rail uses — one
                  component, so the two views cannot drift apart. */
              <div className="sp-cardlist">
                {items.map(inv => (
                  <RecordCard
                    key={inv.id}
                    card={{ ...ciCard(inv), raw: inv }}
                    selected={false}
                    onSelect={openInvoice}
                  />
                ))}
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
                            {/* Gated, not just remapped: the hub portal has no
                                Customers screen, so P.customers is null and an
                                ungated click would navigate to "null/<token>".
                                The name stays visible; only the link comes off. */}
                            <div
                              className={P.customers ? 'ci-cust-link' : undefined}
                              style={P.customers ? undefined : { display: 'inline-flex', alignItems: 'center', gap: 6 }}
                              onClick={P.customers ? (e) => {
                                e.stopPropagation();
                                navigate(inv.customer_token ? `${P.customers}/${inv.customer_token}` : P.customers, inv.customer_token ? undefined : { state: { openMobile: inv.mobile } });
                              } : undefined}
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
                              {P.customers && <span className="ci-cust-arrow">→</span>}
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
            summary={totals && [
              { label: 'total',    value: fmt(totals.amount) },
              { label: 'received', value: fmt(totals.paid), tone: 'ok' },
              { label: 'due',      value: fmt(totals.due),  tone: 'warn' },
            ]}
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
