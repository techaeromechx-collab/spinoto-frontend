import react from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import PaginationBar from '../components/PaginationBar.jsx';
import {
  FileText, Plus, Search, RefreshCw, X, ChevronRight,
  CheckCircle2, XCircle, Clock, AlertCircle, Eye, Minus, ReceiptText, Printer, Check, MoreVertical,
} from 'lucide-react';
import '../styles/EstimatesPage.css';

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_META = {
  draft: { bg: '#f3f4f6', color: '#374151', label: 'Draft' },
  pending_company_review: { bg: '#fef3c7', color: '#92400e', label: 'Pending Review' },
  revision_requested: { bg: '#ffedd5', color: '#9a3412', label: 'Revision Requested' },
  sent_to_customer: { bg: '#dbeafe', color: '#1e40af', label: 'Sent to Customer' },
  partially_approved: { bg: '#f3e8ff', color: '#6b21a8', label: 'Partially Approved' },
  fully_approved: { bg: '#dcfce7', color: '#166534', label: 'Fully Approved' },
  work_in_progress: { bg: '#fef3c7', color: '#92400e', label: 'Work In Progress' },
  work_completed: { bg: '#dcfce7', color: '#166534', label: 'Work Completed' },
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

// ── Work status badge ─────────────────────────────────────────────────────────
const WS_STYLE = {
  pending: { bg: '#f3f4f6', color: '#6b7280', border: '#d1d5db', label: 'Pending' },
  in_progress: { bg: '#fef3c7', color: '#92400e', border: '#fcd34d', label: 'In Progress' },
  completed: { bg: '#dcfce7', color: '#166534', border: '#86efac', label: 'Done' },
  rejected: { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5', label: 'Rejected' },
};

function WorkStatusBadge({ status }) {
  const m = WS_STYLE[status] || WS_STYLE.pending;
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: m.bg, color: m.color, border: `1.5px solid ${m.border}`, letterSpacing: '0.02em' }}>
      {m.label}
    </span>
  );
}

function WorkStatusSelect({ value, onChange, disabled }) {
  const current = WS_STYLE[value] || WS_STYLE.pending;
  return (
    <select
      value={value || 'pending'}
      onChange={e => onChange && onChange(e.target.value)}
      disabled={disabled}
      style={{
        fontSize: 11, fontWeight: 700,
        padding: '4px 22px 4px 10px',
        borderRadius: 99,
        border: `1.5px solid ${current.border}`,
        background: current.bg,
        color: current.color,
        cursor: disabled ? 'default' : 'pointer',
        appearance: 'none', WebkitAppearance: 'none',
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='${encodeURIComponent(current.color)}'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 7px center',
        backgroundSize: '8px',
        outline: 'none',
        letterSpacing: '0.02em',
        minWidth: 90,
      }}
    >
      <option value="pending">Pending</option>
      <option value="in_progress">In Progress</option>
      <option value="completed">Done</option>
    </select>
  );
}

// ── Currency formatter ────────────────────────────────────────────────────────
function fmt(n) {
  if (n == null || n === '') return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function amountToWords(amount) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
    'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function inWords(n) {
    if (n === 0) return '';
    if (n < 20) return a[n] + ' ';
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '') + ' ';
    if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred ' + inWords(n % 100);
    if (n < 100000) return inWords(Math.floor(n / 1000)) + 'Thousand ' + inWords(n % 1000);
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + 'Lakh ' + inWords(n % 100000);
    return inWords(Math.floor(n / 10000000)) + 'Crore ' + inWords(n % 10000000);
  }
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  let result = inWords(rupees).trim();
  result = result ? result + ' Rupees' : '';
  if (paise > 0) result += (result ? ' and ' : '') + inWords(paise).trim() + ' Paise';
  return (result || 'Zero Rupees') + ' Only';
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }) {
  react.useEffect(() => {
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
      animation: 'est-fadeUp 0.2s ease',
    }}>
      {isErr ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
      {msg}
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', marginLeft: 4 }}>
        <X size={14} />
      </button>
    </div>
  );
}

// ── Approval icon ─────────────────────────────────────────────────────────────
function ApprovalIcon({ value }) {
  if (value === true) return <CheckCircle2 size={16} style={{ color: '#16a34a' }} />;
  if (value === false) return <XCircle size={16} style={{ color: '#dc2626' }} />;
  return <Minus size={16} style={{ color: '#9ca3af' }} />;
}

// ── Compute line-item totals (production-grade GST rounding) ─────────────────
// Rules: total is source of truth; gstAmount = total − exGST (never exGST × rate)
// This prevents cumulative ₹0.01 drift across invoices/monthly reports.
const r2 = (n) => Math.round(n * 100) / 100; // ROUND HALF UP to 2dp
function computeItem(item) {
  const qty = parseFloat(item.quantity) || 0;
  const exRate = parseFloat(item.unit_rate) || 0;
  const gst = parseFloat(item.gst_percent) || 0;
  const storedInc = parseFloat(item.inc_rate) || 0;

  // 1. Total inc-GST before discount (source of truth)
  const totalBefore = storedInc > 0
    ? r2(qty * storedInc)
    : r2(qty * exRate * (1 + gst / 100));

  // 2. Compute discount amount dynamically from stored rule
  let discountAmount = 0;
  const dType = item.discount_type;
  const dValue = parseFloat(item.discount_value) || 0;
  if (dType === 'percent' && dValue > 0) {
    discountAmount = r2(totalBefore * dValue / 100);
  } else if (dType === 'flat' && dValue > 0) {
    discountAmount = Math.min(dValue, totalBefore); // can't discount more than the line total
  }

  // 3. Total after discount
  const total = r2(Math.max(0, totalBefore - discountAmount));

  // 4. ex-GST = round(total / (1 + gstRate), 2)  ← correct inclusive GST formula
  const amount = gst > 0 ? r2(total / (1 + gst / 100)) : total;

  // 5. GST = round(total − exGST, 2)  ← NOT exGST × rate (avoids double-rounding drift)
  const gst_amount = r2(total - amount);

  const inc_rate = storedInc > 0 ? storedInc : r2(exRate * (1 + gst / 100));
  return { subtotal: amount, amount, gst_amount, total, inc_rate, discountAmount };
}

// ── Inline error box ──────────────────────────────────────────────────────────
function ErrorBox({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: '#fef2f2', border: '1px solid #fca5a5',
      borderRadius: 8, padding: '10px 14px',
      color: '#991b1b', fontSize: 13,
    }}>
      <AlertCircle size={15} /> {msg}
    </div>
  );
}

// ── Searchable Select ─────────────────────────────────────────────────────────
function SearchableSelect({ value, onChange, options, placeholder = 'Select…', searchPlaceholder = 'Search…' }) {
  const [open, setOpen] = react.useState(false);
  const [query, setQuery] = react.useState('');
  const ref = react.useRef(null);

  // Close on outside click
  react.useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(query.toLowerCase())
  );

  const selected = options.find(o => String(o.value) === String(value));

  function pick(o) {
    onChange(o.value);
    setOpen(false);
    setQuery('');
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', borderRadius: 8, fontSize: 14, cursor: 'pointer',
          background: 'var(--card-bg, #fff)',
          border: open ? '1.5px solid var(--primary, #0ea5e9)' : '1px solid var(--border, #e2e8f0)',
          color: selected ? 'var(--text)' : 'var(--text-muted)',
          outline: 'none',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.label : placeholder}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" style={{ flexShrink: 0, marginLeft: 6, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 9999,
          background: 'var(--card-bg, #fff)',
          border: '1px solid var(--border, #e2e8f0)',
          borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          overflow: 'hidden',
        }}>
          {/* Search input */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border, #e2e8f0)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              style={{
                border: 'none', outline: 'none', background: 'transparent',
                fontSize: 13, width: '100%', color: 'var(--text)',
              }}
            />
          </div>
          {/* Options list */}
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>No results</div>
            ) : (
              filtered.map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => pick(o)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '9px 14px',
                    background: String(o.value) === String(value) ? 'var(--primary-light, #eff6ff)' : 'transparent',
                    border: 'none', cursor: 'pointer', fontSize: 13,
                    color: String(o.value) === String(value) ? 'var(--primary)' : 'var(--text)',
                    fontWeight: String(o.value) === String(value) ? 600 : 400,
                  }}
                  onMouseEnter={e => { if (String(o.value) !== String(value)) e.currentTarget.style.background = 'var(--hover-bg, #f8fafc)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = String(o.value) === String(value) ? 'var(--primary-light, #eff6ff)' : 'transparent'; }}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Discount Mode Modal ───────────────────────────────────────────────────────
function DiscountModeModal({ current, onSave, onClose }) {
  const [mode, setMode] = react.useState(current || 'line_item');
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div className="modal-header">
          <h3 style={{ fontSize: 15 }}>Discount Settings</h3>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Do you give discounts?</p>
          {[
            { value: 'none',        label: 'No',                    desc: 'No discounts on this estimate' },
            { value: 'line_item',   label: 'Line item level',       desc: 'Discount per individual item' },
            { value: 'transaction', label: 'Transaction level',     desc: 'Single discount on the total amount' },
          ].map(opt => (
            <label key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 12px', borderRadius: 8, border: `1.5px solid ${mode === opt.value ? 'var(--primary)' : 'var(--border)'}`, background: mode === opt.value ? 'var(--primary-light, #eff6ff)' : 'transparent' }}>
              <input type="radio" name="discount_mode" value={opt.value} checked={mode === opt.value} onChange={() => setMode(opt.value)} style={{ marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
        <div style={{ padding: '12px 24px 20px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => { onSave(mode); onClose(); }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── Line Item Discount Popup ──────────────────────────────────────────────────
function LineItemDiscountPopup({ item, onSave, onClose }) {
  const [dType, setDType]   = react.useState(item.discount_type || 'percent');
  const [dValue, setDValue] = react.useState(item.discount_value || 0);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 320 }}>
        <div className="modal-header">
          <h3 style={{ fontSize: 14 }}>Item Discount</h3>
          <button className="modal-close" onClick={onClose}><X size={15} /></button>
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</p>
          <div className="form-field">
            <label style={{ fontSize: 12 }}>Discount Type</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[{ v: 'percent', l: '% Percentage' }, { v: 'flat', l: '₹ Fixed Amount' }].map(opt => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setDType(opt.v)}
                  style={{
                    flex: 1, padding: '8px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: `1.5px solid ${dType === opt.v ? 'var(--primary)' : 'var(--border)'}`,
                    background: dType === opt.v ? 'var(--primary-light, #eff6ff)' : 'transparent',
                    color: dType === opt.v ? 'var(--primary)' : 'var(--text)',
                  }}
                >{opt.l}</button>
              ))}
            </div>
          </div>
          <div className="form-field">
            <label style={{ fontSize: 12 }}>Discount Value {dType === 'percent' ? '(%)' : '(₹)'}</label>
            <input
              className="form-input"
              type="number" min="0" step="any"
              value={dValue}
              onChange={e => setDValue(e.target.value)}
              style={{ fontSize: 13 }}
              autoFocus
            />
          </div>
        </div>
        <div style={{ padding: '10px 20px 16px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }}
            onClick={() => { onSave(null, 0); onClose(); }}>Remove</button>
          <button type="button" className="btn btn-primary" style={{ fontSize: 12 }}
            onClick={() => { onSave(dType, parseFloat(dValue) || 0); onClose(); }}>Apply</button>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Customer Approval Modal
// ═════════════════════════════════════════════════════════════════════════════
function CustomerApprovalModal({ estimate, onClose, onDone }) {
  const [approvals, setApprovals] = react.useState(() =>
    (estimate.items || []).map(item => ({
      item_id: item.id,
      approved: item.customer_approved === true,
      description: item.description,
    }))
  );
  const [saving, setSaving] = react.useState(false);
  const [error, setError] = react.useState(null);

  function toggle(id) {
    setApprovals(prev => prev.map(a => a.item_id === id ? { ...a, approved: !a.approved } : a));
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      await api(`/api/estimates/${estimate.id}/customer-approval`, {
        method: 'POST',
        body: { approvals: approvals.map(a => ({ item_id: a.item_id, approved: a.approved })) },
      });
      onDone();
    } catch (err) {
      setError(err.message || 'Failed to save approvals.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <h3>Mark Customer Approval</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            Set the customer's decision for each item below.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {approvals.map(a => (
              <div key={a.item_id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', borderRadius: 8,
                border: `1.5px solid ${a.approved ? '#86efac' : '#fca5a5'}`,
                background: a.approved ? '#f0fdf4' : '#fff5f5',
                transition: 'all 0.15s',
              }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                  {a.description}
                </span>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => setApprovals(prev => prev.map(x => x.item_id === a.item_id ? { ...x, approved: true } : x))}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', transition: 'all 0.15s',
                      border: a.approved ? '1.5px solid #16a34a' : '1.5px solid #d1d5db',
                      background: a.approved ? '#16a34a' : '#fff',
                      color: a.approved ? '#fff' : '#6b7280',
                    }}
                  >
                    <CheckCircle2 size={13} /> Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => setApprovals(prev => prev.map(x => x.item_id === a.item_id ? { ...x, approved: false } : x))}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', transition: 'all 0.15s',
                      border: !a.approved ? '1.5px solid #dc2626' : '1.5px solid #d1d5db',
                      background: !a.approved ? '#dc2626' : '#fff',
                      color: !a.approved ? '#fff' : '#6b7280',
                    }}
                  >
                    <XCircle size={13} /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
          <ErrorBox msg={error} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Approvals'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Request Revision Modal
// ═════════════════════════════════════════════════════════════════════════════
function RevisionModal({ estimateId, onClose, onDone }) {
  const [notes, setNotes] = react.useState('');
  const [saving, setSaving] = react.useState(false);
  const [error, setError] = react.useState(null);
  const taRef = react.useRef(null);

  react.useEffect(() => { taRef.current?.focus(); }, []);

  async function submit(e) {
    e.preventDefault();
    if (!notes.trim()) { setError('Please enter revision notes.'); return; }
    setSaving(true); setError(null);
    try {
      await api(`/api/estimates/${estimateId}/company-revise`, {
        method: 'POST',
        body: { notes: notes.trim() },
      });
      onDone();
    } catch (err) {
      setError(err.message || 'Failed to request revision.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h3>Request Revision</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="form-field">
            <label>Revision Notes <span style={{ color: '#dc2626' }}>*</span></label>
            <textarea
              ref={taRef}
              className="form-input"
              style={{ minHeight: 100, resize: 'vertical' }}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Describe what needs to be changed…"
            />
          </div>
          <ErrorBox msg={error} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-danger" disabled={saving}>
              {saving ? 'Sending…' : 'Request Revision'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Create / Edit Modal
// ═════════════════════════════════════════════════════════════════════════════
function EstimateModal({ editEstimate, onClose, onSaved, isHubUser = false, userHubId = '', initialAppointmentId = '' }) {
  const isEdit = !!editEstimate?.id;

  // Master data
  const [appointments, setAppointments] = react.useState([]);
  const [hubs, setHubs] = react.useState([]);
  const [services, setServices] = react.useState([]);
  const [parts, setParts] = react.useState([]);
  const [masterLoading, setMasterLoading] = react.useState(true);

  // Guard: auto-trigger onAppointmentChange exactly once after master data loads
  const initialApptTriggered = react.useRef(false);

  // Vehicle context from selected appointment — used for pricing lookup
  const [vehicleCtx, setVehicleCtx] = react.useState(null);

  // Hub service picker state
  const [hubCategories, setHubCategories] = react.useState([]); // from GET /api/hubs/:id/services
  const [selectedCatId, setSelectedCatId] = react.useState(null);
  const [svcPickerSearch, setSvcPickerSearch] = react.useState('');
  const [hubSvcLoading, setHubSvcLoading] = react.useState(false);
  const [showPartPicker, setShowPartPicker] = react.useState(false);
  const [partPickerSearch, setPartPickerSearch] = react.useState('');
  const [partPickerCat, setPartPickerCat] = react.useState('All');

  // Form state — hub users get their hub pre-filled
  const [form, setForm] = react.useState({
    appointment_id: editEstimate?.appointment_id || initialAppointmentId || '',
    hub_id: editEstimate?.hub_id ? String(editEstimate.hub_id) : (isHubUser ? userHubId : ''),
    notes: editEstimate?.notes || '',
  });
  const [items, setItems] = react.useState(() =>
    (editEstimate?.items || []).map(it => {
      // DB stores ex-GST rate as customer_rate; back-calc inc_rate for display
      const exRate = parseFloat(it.customer_rate ?? it.unit_rate) || 0;
      const gst = parseFloat(it.gst_percent) || 0;
      const incRate = exRate * (1 + gst / 100);
      return {
        _key: it.id || Math.random(),
        type: it.item_type || 'service',
        item_id: it.service_id || it.item_id || '',
        description: it.description || '',
        quantity: it.quantity ?? 1,
        unit_rate: exRate > 0 ? exRate.toFixed(4) : '',
        inc_rate: incRate > 0 ? incRate.toFixed(2) : '',
        gst_percent: gst,
        hsn_sac: it.hsn_sac || '',
        is_fixed: it.is_fixed_from_appointment || false,
        discount_type: it.discount_type || null,
        discount_value: parseFloat(it.discount_value) || 0,
        discount_source: it.discount_source || null,
      };
    })
  );

  const [saving, setSaving] = react.useState(false);
  const [error, setError] = react.useState(null);

  // Discount mode state
  const [discountMode, setDiscountMode] = react.useState(
    editEstimate?.discount_mode || 'none'
  );
  const [txDiscountType, setTxDiscountType]   = react.useState(
    editEstimate?.transaction_discount_type || 'percent'
  );
  const [txDiscountValue, setTxDiscountValue] = react.useState(
    parseFloat(editEstimate?.transaction_discount_value) || 0
  );
  const [showDiscountSettings, setShowDiscountSettings] = react.useState(false);
  const [discountPopupKey, setDiscountPopupKey]         = react.useState(null); // _key of item being edited

  // Service / part search dropdowns
  const [serviceSearch, setServiceSearch] = react.useState('');
  const [partSearch, setPartSearch] = react.useState('');

  react.useEffect(() => {
    async function loadMaster() {
      setMasterLoading(true);
      try {
        const [apptRes, hubRes, svcRes, partRes] = await Promise.all([
          api(`/api/appointments?limit=200${isHubUser && userHubId ? `&hub_id=${userHubId}` : ''}`),
          api('/api/hubs?limit=100'),
          api('/api/services/services'),
          api('/api/parts'),
        ]);
        setAppointments(apptRes.items || []);
        setHubs(hubRes.items || []);
        setServices(svcRes.items || svcRes.services || []);
        setParts(partRes.items || []);

        // In edit mode: restore vehicle context from the pre-filled appointment
        if (editEstimate?.appointment_id) {
          const appt = (apptRes.items || []).find(a => String(a.id) === String(editEstimate.appointment_id));
          if (appt) {
            setVehicleCtx({
              vehicle_type_id: appt.vehicle_type_id || null,
              make_id: appt.make_id || null,
              model_id: appt.model_id || null,
              body_type_id: appt.body_type_id || null,
              cc_category_id: appt.cc_category_id || null,
              segment_id: Array.isArray(appt.segment_ids) && appt.segment_ids.length > 0
                ? appt.segment_ids[0] : null,
            });
          }
        }
      } catch {
        setError('Failed to load data. Please close and retry.');
      } finally {
        setMasterLoading(false);
      }
    }
    loadMaster();
  }, []); // eslint-disable-line

  // When opened via "Create Estimate" from an appointment, auto-trigger the
  // hub + services pre-fill once master data (appointments + services) is ready.
  react.useEffect(() => {
    if (!initialAppointmentId || isEdit) return;           // only for "create from appt" flow
    if (initialApptTriggered.current) return;              // fire exactly once
    if (!appointments.length && !services.length) return;  // wait until loaded
    initialApptTriggered.current = true;
    onAppointmentChange(initialAppointmentId);
  }, [appointments, services]); // eslint-disable-line

  // Auto-select hub + pre-fill appointment services when appointment changes
  async function onAppointmentChange(appt_id) {
    if (!appt_id) {
      setForm(f => ({ ...f, appointment_id: '', hub_id: '' }));
      setVehicleCtx(null);
      return;
    }

    // The appointments list already has all vehicle IDs — no extra fetch needed
    const appt = appointments.find(a => String(a.id) === String(appt_id));
    setForm(f => ({ ...f, appointment_id: appt_id, hub_id: appt?.hub_id ? String(appt.hub_id) : f.hub_id }));
    // hub_id change is handled by the useEffect below — no explicit call needed

    // Build vehicle context for pricing lookup
    const ctx = appt ? {
      vehicle_type_id: appt.vehicle_type_id || null,
      make_id: appt.make_id || null,
      model_id: appt.model_id || null,
      body_type_id: appt.body_type_id || null,
      cc_category_id: appt.cc_category_id || null,
      // segment_ids is an array; pricing lookup takes one segment_id
      segment_id: Array.isArray(appt.segment_ids) && appt.segment_ids.length > 0
        ? appt.segment_ids[0]
        : null,
    } : null;
    setVehicleCtx(ctx);

    // Fetch full appointment detail to get its fixed services
    try {
      const detail = await api(`/api/appointments/${appt_id}`);
      const apptServices = detail?.services || detail?.item?.services || [];
      if (apptServices.length > 0) {
        // For each fixed service, look up price from pricing rules using vehicle context
        const fixedItems = await Promise.all(apptServices.map(async s => {
          const gst = parseFloat(s.gst_percent) || 0;

          // Call the existing pricing lookup API (no logic change)
          const lookedUpPrice = await lookupServicePrice(s.service_id, ctx);

          // lookedUpPrice is inc-GST (the price from your pricing rules)
          const incRate = lookedUpPrice ?? 0;
          const exRate = incRate > 0 && gst > 0 ? incRate / (1 + gst / 100) : incRate;

          // Auto-lookup discount (uses already-loaded services list from closure)
          let discount_type = null, discount_value = 0, discount_source = null;
          try {
            const fullSvc = services.find(sv => String(sv.id) === String(s.service_id));
            const params = new URLSearchParams({ service_id: s.service_id });
            if (fullSvc?.category_id) params.set('category_id', fullSvc.category_id);
            const disc = await api(`/api/discount-master/lookup?${params}`);
            if (disc.matched) {
              discount_type = disc.discount_type;
              discount_value = parseFloat(disc.discount_value) || 0;
              discount_source = 'master';
            }
          } catch { /* silently ignore */ }

          return {
            _key: Math.random(),
            type: 'service',
            item_id: s.service_id,
            description: s.service_name || s.name || '',
            quantity: 1,
            inc_rate: incRate > 0 ? incRate.toFixed(2) : '',
            unit_rate: exRate > 0 ? exRate.toFixed(2) : '',
            gst_percent: gst,
            is_fixed: true,
            discount_type,
            discount_value,
            discount_source,
          };
        }));

        // Merge: keep any manually added items, prepend fixed ones
        setItems(prev => {
          const nonFixed = prev.filter(i => !i.is_fixed);
          return [...fixedItems, ...nonFixed];
        });
      }
    } catch {
      // Silently ignore — user can add items manually
    }
  }

  async function addServiceItem(svc) {
    const gst = parseFloat(svc.gst_percent) || 0;

    // Look up price from pricing rules using vehicle context from appointment
    const lookedUpPrice = await lookupServicePrice(svc.id, vehicleCtx);

    // lookedUpPrice is inc-GST from your pricing rules
    const incRate = lookedUpPrice ?? 0;
    const exRate = incRate > 0 && gst > 0 ? incRate / (1 + gst / 100) : incRate;

    // Auto-lookup discount from discount master
    let discount_type = null, discount_value = 0, discount_source = null;
    try {
      const fullSvc = services.find(s => String(s.id) === String(svc.id));
      const params = new URLSearchParams({ service_id: svc.id });
      if (fullSvc?.category_id) params.set('category_id', fullSvc.category_id);
      const disc = await api(`/api/discount-master/lookup?${params}`);
      if (disc.matched) {
        discount_type = disc.discount_type;
        discount_value = parseFloat(disc.discount_value) || 0;
        discount_source = 'master';
      }
    } catch { /* silently ignore — discount is optional */ }

    setItems(prev => [...prev, {
      _key: Math.random(),
      type: 'service',
      item_id: svc.id,
      description: svc.name,
      quantity: 1,
      inc_rate: incRate > 0 ? incRate.toFixed(2) : '',
      unit_rate: exRate > 0 ? exRate.toFixed(2) : '',
      gst_percent: gst,
      hsn_sac: svc.sac_code || '',
      is_fixed: false,
      discount_type,
      discount_value,
      discount_source,
    }]);
    setServiceSearch('');
  }

  async function addPartItem(part) {
    // master customer_rate = inc-GST price; back-calc ex-GST
    const incRate = parseFloat(part.customer_rate) || 0;
    const gst = parseFloat(part.gst_percent) || 0;
    const exRate = incRate > 0 ? incRate / (1 + gst / 100) : 0;

    // Auto-lookup discount from discount master
    let discount_type = null, discount_value = 0, discount_source = null;
    try {
      const disc = await api(`/api/discount-master/lookup?part_id=${part.id}`);
      if (disc.matched) {
        discount_type = disc.discount_type;
        discount_value = parseFloat(disc.discount_value) || 0;
        discount_source = 'master';
      }
    } catch { /* silently ignore */ }

    setItems(prev => [...prev, {
      _key: Math.random(),
      type: 'part',
      item_id: part.id,
      description: part.name,
      quantity: 1,
      inc_rate: incRate > 0 ? incRate.toFixed(2) : '',
      unit_rate: exRate > 0 ? exRate.toFixed(2) : '',
      gst_percent: gst,
      hsn_sac: part.hsn_code || '',
      is_fixed: false,
      discount_type,
      discount_value,
      discount_source,
    }]);
    setPartSearch('');
  }

  // ── Pricing lookup helper ─────────────────────────────────────────────────
  // Two-step fallback per your pricing rules doc:
  //   Step 1 → service-level rule (most specific wins)
  //   Step 2 → category-level rule (if no service rule matched)
  //   Step 3 → null (no price)
  async function lookupServicePrice(serviceId, ctx) {
    if (!serviceId || !ctx) return null;

    function buildParams(target) {
      const p = new URLSearchParams(target);
      if (ctx.vehicle_type_id) p.set('vehicle_type_id', ctx.vehicle_type_id);
      if (ctx.make_id) p.set('make_id', ctx.make_id);
      if (ctx.model_id) p.set('model_id', ctx.model_id);
      if (ctx.body_type_id) p.set('body_type_id', ctx.body_type_id);
      if (ctx.cc_category_id) p.set('cc_category_id', ctx.cc_category_id);
      if (ctx.segment_id) p.set('segment_id', ctx.segment_id);
      return p;
    }

    try {
      // Step 1: service-level rule
      const svcRes = await api(`/api/pricing/lookup?${buildParams({ service_id: serviceId })}`);
      if (svcRes.matched) return parseFloat(svcRes.price);

      // Step 2: category-level fallback — find this service's category_id
      const fullSvc = services.find(s => String(s.id) === String(serviceId));
      if (!fullSvc?.category_id) return null;

      const catRes = await api(`/api/pricing/lookup?${buildParams({ category_id: fullSvc.category_id })}`);
      if (catRes.matched) return parseFloat(catRes.price);

      return null; // No rule matched at either level
    } catch {
      return null;
    }
  }

  // ── Load hub-assigned services (for service picker panel) ────────────────
  async function loadHubServices(hubId) {
    if (!hubId) { setHubCategories([]); setSelectedCatId(null); return; }
    setHubSvcLoading(true);
    try {
      const res = await api(`/api/hubs/${hubId}/services`);
      // Keep only categories that have at least one service_mapped = true
      const cats = (res.categories || [])
        .map(cat => ({
          ...cat,
          services: cat.services.filter(s => s.service_mapped),
        }))
        .filter(cat => cat.services.length > 0);
      setHubCategories(cats);
      setSelectedCatId(cats.length > 0 ? cats[0].id : null);
    } catch {
      setHubCategories([]);
    } finally {
      setHubSvcLoading(false);
    }
  }

  // Reload services whenever hub changes — also fires on initial open (edit mode pre-fill)
  react.useEffect(() => {
    loadHubServices(form.hub_id);
  }, [form.hub_id]); // eslint-disable-line

  function updateItem(key, field, value) {
    setItems(prev => prev.map(it => {
      if (it._key !== key) return it;
      const updated = { ...it, [field]: value };
      const gst = parseFloat(field === 'gst_percent' ? value : it.gst_percent) || 0;

      if (field === 'inc_rate') {
        // User typed inc-GST rate → back-calculate ex-GST
        const inc = parseFloat(value) || 0;
        const ex = inc / (1 + gst / 100);
        return { ...updated, unit_rate: ex > 0 ? ex.toFixed(4) : '' };
      }
      if (field === 'unit_rate') {
        // User typed ex-GST rate → calculate inc-GST
        const ex = parseFloat(value) || 0;
        const inc = ex * (1 + gst / 100);
        return { ...updated, inc_rate: inc > 0 ? inc.toFixed(4) : '' };
      }
      if (field === 'gst_percent') {
        // GST % changed → keep RATE (inc-GST) fixed, back-calculate TAXABLE (ex-GST)
        const inc = parseFloat(it.inc_rate) || 0;
        const ex = gst > 0 ? inc / (1 + gst / 100) : inc;
        return { ...updated, unit_rate: ex > 0 ? ex.toFixed(4) : '' };
      }
      return updated;
    }));
  }

  function removeItem(key) {
    setItems(prev => prev.filter(it => it._key !== key));
  }

  // Grand total + total discount (mode-aware)
  const { itemsTotal, totalDiscount: lineDiscount } = items.reduce((acc, it) => {
    const itemForCalc = discountMode !== 'line_item'
      ? { ...it, discount_type: null, discount_value: 0 }
      : it;
    const c = computeItem(itemForCalc);
    return { itemsTotal: acc.itemsTotal + c.total, totalDiscount: acc.totalDiscount + c.discountAmount };
  }, { itemsTotal: 0, totalDiscount: 0 });

  // Transaction-level discount calculation
  let txDiscountAmount = 0;
  if (discountMode === 'transaction' && txDiscountValue > 0) {
    if (txDiscountType === 'percent') {
      txDiscountAmount = r2(itemsTotal * txDiscountValue / 100);
    } else {
      txDiscountAmount = Math.min(txDiscountValue, itemsTotal);
    }
  }
  const grandTotal   = discountMode === 'transaction' ? r2(itemsTotal - txDiscountAmount) : itemsTotal;
  const totalDiscount = discountMode === 'line_item' ? lineDiscount : txDiscountAmount;
  const hasDiscount  = discountMode === 'line_item';

  async function submit(e) {
    e.preventDefault();
    if (!form.appointment_id) { setError('Please select an appointment.'); return; }
    if (!form.hub_id) { setError('Please select a hub.'); return; }
    setSaving(true); setError(null);
    try {
      const forceZero = discountMode !== 'line_item';
      const payload = {
        appointment_id: Number(form.appointment_id),
        hub_id: Number(form.hub_id),
        notes: form.notes.trim() || null,
        discount_mode: discountMode,
        transaction_discount_type:  discountMode === 'transaction' ? txDiscountType  : null,
        transaction_discount_value: discountMode === 'transaction' ? txDiscountValue : 0,
        items: items.map(it => {
          const itemForCalc = forceZero ? { ...it, discount_type: null, discount_value: 0 } : it;
          const { discountAmount } = computeItem(itemForCalc);
          return {
            item_type: it.type,
            item_id: it.item_id || null,
            description: it.description,
            quantity: Number(it.quantity) || 1,
            customer_rate: parseFloat(parseFloat(it.unit_rate).toFixed(4)) || 0,
            gst_percent: parseFloat(it.gst_percent) || 0,
            discount_type:   forceZero ? null : (it.discount_type || null),
            discount_value:  forceZero ? 0    : (it.discount_value || 0),
            discount_amount: forceZero ? 0    : discountAmount,
            discount_source: forceZero ? null : (it.discount_source || null),
          };
        }),
      };
      const res = isEdit
        ? await api(`/api/estimates/${editEstimate.id}`, { method: 'PATCH', body: payload })
        : await api('/api/estimates', { method: 'POST', body: payload });
      onSaved(res.item || res.estimate || res);
    } catch (err) {
      setError(err.message || 'Something went wrong.');
      setSaving(false);
    }
  }

  const filteredParts = parts.filter(p =>
    !partSearch || p.name.toLowerCase().includes(partSearch.toLowerCase())
  ).slice(0, 12);

  // ── Part picker derived values ────────────────────────────────────────────
  const partCategories = ['All', ...Array.from(new Set(parts.map(p => p.category).filter(Boolean))).sort()];
  const addedPartIds = new Set(items.filter(it => it.type === 'part' && it.item_id).map(it => Number(it.item_id)));
  const pickerParts = parts.filter(p => {
    const matchCat = partPickerCat === 'All' || p.category === partPickerCat;
    const matchSearch = !partPickerSearch || p.name.toLowerCase().includes(partPickerSearch.toLowerCase());
    return matchCat && matchSearch;
  });

  // ── Vehicle info for display ──────────────────────────────────────────────
  const selectedAppt = appointments.find(a => String(a.id) === String(form.appointment_id));
  const isTwo = selectedAppt?.vehicle_type_name?.toLowerCase().includes('2') || false;
  const vehicleBadge = selectedAppt
    ? (isTwo ? '2W services' : '4W services')
    : null;
  const vehicleInfoStr = selectedAppt
    ? isTwo
      ? [selectedAppt.make_name, selectedAppt.model_name, selectedAppt.cc_category_name].filter(Boolean).join(' · ')
      : [selectedAppt.make_name, selectedAppt.model_name, selectedAppt.body_type_name, Array.isArray(selectedAppt.segment_names) ? selectedAppt.segment_names.join('/') : selectedAppt.segment_names].filter(Boolean).join(' · ')
    : null;

  // ── Picker: services in selected category, filtered by search + vehicle type ─
  // Set of service IDs already present in the line items (for checkmark display)
  const addedServiceIds = new Set(
    items.filter(it => it.type === 'service' && it.item_id).map(it => Number(it.item_id))
  );

  const pickerCatServices = (() => {
    const vcFilter = selectedAppt ? (isTwo ? '2W' : '4W') : null;

    const byVehicle = (s) => {
      if (!vcFilter) return true; // no appointment selected — show all
      return s.vehicle_class === vcFilter || s.vehicle_class === 'both';
    };

    if (svcPickerSearch.trim()) {
      const q = svcPickerSearch.toLowerCase();
      return hubCategories
        .flatMap(c => c.services)
        .filter(s => byVehicle(s) && s.name.toLowerCase().includes(q));
    }
    const cat = hubCategories.find(c => c.id === selectedCatId);
    return cat ? cat.services.filter(byVehicle) : [];
  })();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 780, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header" style={{ flexShrink: 0 }}>
          <h3>{isEdit ? 'Edit Estimate' : 'New Estimate'}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              title="Discount settings"
              onClick={() => setShowDiscountSettings(true)}
              style={{
                background: discountMode !== 'none' ? 'var(--primary-light, #eff6ff)' : 'var(--bg-soft)',
                border: `1px solid ${discountMode !== 'none' ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: 7, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                color: discountMode !== 'none' ? 'var(--primary)' : 'var(--text-muted)',
                display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
              {discountMode === 'none' ? 'No Discount' : discountMode === 'line_item' ? 'Line Item Discount' : 'Transaction Discount'}
            </button>
            <button className="modal-close" onClick={onClose}><X size={18} /></button>
          </div>
        </div>
        {showDiscountSettings && (
          <DiscountModeModal
            current={discountMode}
            onSave={mode => {
              setDiscountMode(mode);
              if (mode !== 'line_item') {
                // clear per-item discounts when switching away from line_item
                setItems(prev => prev.map(it => ({ ...it, discount_type: null, discount_value: 0, discount_source: null })));
              }
              if (mode !== 'transaction') {
                setTxDiscountValue(0);
              }
            }}
            onClose={() => setShowDiscountSettings(false)}
          />
        )}
        {discountPopupKey !== null && (() => {
          const popupItem = items.find(it => it._key === discountPopupKey);
          if (!popupItem) return null;
          return (
            <LineItemDiscountPopup
              item={popupItem}
              onSave={(dType, dValue) => {
                setItems(prev => prev.map(it => it._key === discountPopupKey
                  ? { ...it, discount_type: dType, discount_value: dValue, discount_source: dType ? 'manual' : null }
                  : it
                ));
              }}
              onClose={() => setDiscountPopupKey(null)}
            />
          );
        })()}

        {masterLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
        ) : (
          <form onSubmit={submit} style={{ flex: 1, overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Appointment + Hub row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="form-field">
                <label>Appointment <span style={{ color: '#dc2626' }}>*</span></label>
                <SearchableSelect
                  value={form.appointment_id}
                  onChange={val => onAppointmentChange(val)}
                  placeholder="Select appointment…"
                  searchPlaceholder="Search appointment…"
                  options={appointments.map(a => ({
                    value: a.id,
                    label: `#${a.id} · ${a.customer_name || 'Unknown'} · ${a.vehicle_number || '—'}`,
                  }))}
                />
              </div>
              <div className="form-field">
                <label>Hub <span style={{ color: '#dc2626' }}>*</span></label>
                {isHubUser ? (
                  <input
                    className="form-input"
                    value={hubs.find(h => String(h.id) === String(form.hub_id))?.hub_name || 'Your hub'}
                    readOnly
                    style={{ background: 'var(--bg-soft)', color: 'var(--text-muted)', cursor: 'not-allowed' }}
                  />
                ) : (
                  <SearchableSelect
                    value={form.hub_id}
                    onChange={val => setForm(f => ({ ...f, hub_id: val }))}
                    placeholder="Select hub…"
                    searchPlaceholder="Search hub…"
                    options={[
                      { value: '', label: 'Select hub…' },
                      ...hubs.map(h => ({ value: h.id, label: `${h.hub_name}${h.city_name ? ' — ' + h.city_name : ''}` })),
                    ]}
                  />
                )}
              </div>
            </div>

            {/* Notes */}
            <div className="form-field">
              <label>Notes <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
              <textarea
                className="form-input"
                style={{ minHeight: 70, resize: 'vertical' }}
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Any notes for this estimate…"
              />
            </div>

            {/* Line Items */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Line Items
              </div>

              {items.length > 0 && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflowX: 'auto', marginBottom: 12 }}>
                  <table className="est-modal-table" style={{ minWidth: hasDiscount ? 1020 : 920 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 36, textAlign: 'center' }}>Sr.</th>
                        <th>Item</th>
                        <th style={{ width: 80 }}>HSN/SAC</th>
                        <th style={{ width: 60 }}>Qty</th>
                        <th style={{ width: 105 }}>Rate</th>
                        {hasDiscount && <th style={{ width: 100 }}>Discount</th>}
                        <th style={{ width: 105 }}>Taxable</th>
                        <th style={{ width: 65 }}>GST %</th>
                        <th style={{ width: 90 }}>Tax Amount</th>
                        <th style={{ width: 95 }}>Total</th>
                        <th style={{ width: 30 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, idx) => {
                        const { gst_amount, amount, total, discountAmount } = computeItem(it);
                        return (
                          <tr key={it._key}>
                            <td style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{idx + 1}</td>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <input
                                  className="form-input"
                                  style={{ padding: '5px 8px', fontSize: 12 }}
                                  value={it.description}
                                  onChange={e => updateItem(it._key, 'description', e.target.value)}
                                  placeholder="Description"
                                />
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                  <span style={{
                                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                                    background: it.type === 'service' ? '#dbeafe' : '#dcfce7',
                                    color: it.type === 'service' ? '#1e40af' : '#166534',
                                  }}>
                                    {it.type === 'service' ? 'Service' : 'Part'}
                                  </span>
                                  {it.is_fixed && (
                                    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#fef3c7', color: '#92400e' }}>Fixed</span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td>
                              <input
                                className="form-input"
                                style={{ padding: '5px 8px', fontSize: 12, background: 'var(--bg-soft)', color: 'var(--text-muted)' }}
                                value={it.hsn_sac || ''}
                                readOnly
                                placeholder="—"
                                title="Auto-filled from service/part"
                              />
                            </td>
                            <td>
                              <input
                                className="form-input"
                                style={{ padding: '5px 8px', fontSize: 12 }}
                                type="number" min="1" step="1"
                                value={it.quantity}
                                onChange={e => updateItem(it._key, 'quantity', e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                className="form-input"
                                style={{ padding: '5px 8px', fontSize: 12, background: '#f0fdf4' }}
                                type="number" min="0" step="any"
                                value={it.inc_rate ?? ''}
                                onChange={e => updateItem(it._key, 'inc_rate', e.target.value)}
                                placeholder="0.00"
                              />
                            </td>
                            {hasDiscount && (
                              <td style={{ textAlign: 'center' }}>
                                <button
                                  type="button"
                                  title="Set item discount"
                                  onClick={() => setDiscountPopupKey(it._key)}
                                  style={{
                                    background: discountAmount > 0 ? '#fef3c7' : 'transparent',
                                    border: `1px solid ${discountAmount > 0 ? '#fcd34d' : 'var(--border)'}`,
                                    borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                                    minWidth: 60,
                                  }}
                                >
                                  {discountAmount > 0 ? (
                                    <>
                                      <span style={{ fontSize: 11, fontWeight: 700, color: '#b45309' }}>
                                        −{fmt(discountAmount)}
                                      </span>
                                      <span style={{ fontSize: 9, color: '#92400e', fontWeight: 600 }}>
                                        {it.discount_type === 'percent' ? `${it.discount_value}%` : 'Flat'}
                                        {it.discount_source === 'master' && ' · Auto'}
                                      </span>
                                    </>
                                  ) : (
                                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>0%</span>
                                  )}
                                </button>
                              </td>
                            )}
                            <td>
                              <input
                                className="form-input"
                                style={{ padding: '5px 8px', fontSize: 12 }}
                                type="number" min="0" step="any"
                                value={it.unit_rate}
                                onChange={e => updateItem(it._key, 'unit_rate', e.target.value)}
                                placeholder="0.00"
                              />
                            </td>
                            <td>
                              <input
                                className="form-input"
                                style={{ padding: '5px 8px', fontSize: 12 }}
                                type="number" min="0" max="100" step="0.01"
                                value={it.gst_percent}
                                onChange={e => updateItem(it._key, 'gst_percent', e.target.value)}
                              />
                            </td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>
                              {fmt(gst_amount)}
                            </td>
                            <td style={{ fontSize: 12, fontWeight: 600, textAlign: 'right' }}>
                              {fmt(total)}
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() => removeItem(it._key)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 4, display: 'flex', alignItems: 'center' }}
                                title="Remove"
                              >
                                <X size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── Service Picker Panel ── */}
              <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
                {/* Panel header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-soft)', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Search size={13} style={{ color: 'var(--text-muted)' }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Select Services</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {vehicleInfoStr && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{vehicleInfoStr}</span>
                    )}
                    {vehicleBadge && (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 99, background: '#dbeafe', color: '#1e40af' }}>{vehicleBadge}</span>
                    )}
                  </div>
                </div>

                {!form.appointment_id ? (
                  <div style={{ padding: '20px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
                    ← Select an appointment first
                  </div>
                ) : !form.hub_id ? (
                  <div style={{ padding: '20px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
                    ← Select a hub to see assigned services
                  </div>
                ) : hubSvcLoading ? (
                  <div style={{ padding: '20px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>Loading services…</div>
                ) : hubCategories.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>No services assigned to this hub yet.</div>
                ) : (
                  <>
                    {/* Search */}
                    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ position: 'relative' }}>
                        <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                        <input
                          className="form-input"
                          style={{ paddingLeft: 26, fontSize: 12, padding: '6px 8px 6px 26px' }}
                          placeholder="Search services…"
                          value={svcPickerSearch}
                          onChange={e => setSvcPickerSearch(e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Category + Service body */}
                    <div style={{ display: 'flex', height: 220 }}>
                      {/* Left: Categories */}
                      {!svcPickerSearch && (
                        <div style={{ width: 160, borderRight: '1px solid var(--border)', overflowY: 'auto', flexShrink: 0 }}>
                          {hubCategories.map(cat => (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() => setSelectedCatId(cat.id)}
                              style={{
                                width: '100%', textAlign: 'left', padding: '9px 14px',
                                background: selectedCatId === cat.id ? 'var(--primary-light, #eff6ff)' : 'transparent',
                                border: 'none', borderLeft: selectedCatId === cat.id ? '3px solid var(--primary)' : '3px solid transparent',
                                cursor: 'pointer', fontSize: 13,
                                fontWeight: selectedCatId === cat.id ? 700 : 400,
                                color: selectedCatId === cat.id ? 'var(--primary)' : 'var(--text)',
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              }}
                            >
                              <span>{cat.name}</span>
                              <Plus size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Right: Services */}
                      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
                        {pickerCatServices.length === 0 ? (
                          <div style={{ padding: '20px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
                            {svcPickerSearch ? 'No services found' : '← Pick a category'}
                          </div>
                        ) : (
                          pickerCatServices.map(svc => {
                            const alreadyAdded = addedServiceIds.has(Number(svc.service_id));
                            return (
                              <button
                                key={svc.service_id}
                                type="button"
                                disabled={alreadyAdded}
                                onClick={() => {
                                  if (alreadyAdded) return;
                                  const fullSvc = services.find(s => s.id === svc.service_id) || {};
                                  addServiceItem({ id: svc.service_id, name: svc.name, gst_percent: fullSvc.gst_percent ?? 0 });
                                }}
                                style={{
                                  width: '100%', textAlign: 'left', padding: '9px 16px',
                                  background: alreadyAdded ? '#f0fdf4' : 'transparent',
                                  border: 'none',
                                  cursor: alreadyAdded ? 'default' : 'pointer',
                                  fontSize: 13,
                                  color: alreadyAdded ? '#15803d' : 'var(--text)',
                                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                  borderBottom: '1px solid var(--border)',
                                }}
                                onMouseEnter={e => { if (!alreadyAdded) e.currentTarget.style.background = 'var(--bg-soft)'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = alreadyAdded ? '#f0fdf4' : 'transparent'; }}
                              >
                                <span style={{ fontWeight: alreadyAdded ? 600 : 400 }}>{svc.name}</span>
                                {alreadyAdded
                                  ? <Check size={14} style={{ color: '#16a34a', flexShrink: 0 }} />
                                  : <Plus size={13} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                                }
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* ── Parts Picker Button ── */}
              <div style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  onClick={() => { setShowPartPicker(true); setPartPickerSearch(''); setPartPickerCat('All'); }}
                  style={{
                    width: '100%', padding: '9px 14px', border: '1.5px dashed var(--border)',
                    borderRadius: 8, background: 'transparent', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    fontSize: 13, color: 'var(--text-muted)', transition: 'all .15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  <Plus size={14} /> Add Parts
                  {addedPartIds.size > 0 && (
                    <span style={{ marginLeft: 4, background: 'var(--primary)', color: '#fff', borderRadius: 99, fontSize: 11, fontWeight: 700, padding: '1px 7px' }}>
                      {addedPartIds.size}
                    </span>
                  )}
                </button>
              </div>

              {/* ── Parts Picker Modal ── */}
              {showPartPicker && (
                <div
                  style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  onMouseDown={e => { if (e.target === e.currentTarget) setShowPartPicker(false); }}
                >
                  <div style={{ background: 'var(--bg)', borderRadius: 14, width: 600, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}
                    onMouseDown={e => e.stopPropagation()}>

                    {/* Modal header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Select Parts</span>
                      <button type="button" onClick={() => setShowPartPicker(false)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
                        <X size={16} />
                      </button>
                    </div>

                    {/* Search bar */}
                    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ position: 'relative' }}>
                        <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                        <input
                          className="form-input"
                          style={{ paddingLeft: 26, fontSize: 12, padding: '6px 8px 6px 26px' }}
                          placeholder="Search parts…"
                          value={partPickerSearch}
                          onChange={e => { setPartPickerSearch(e.target.value); setPartPickerCat('All'); }}
                          autoFocus
                        />
                      </div>
                    </div>

                    {/* Body: categories left, parts right */}
                    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                      {/* Left: categories */}
                      {!partPickerSearch && (
                        <div style={{ width: 160, borderRight: '1px solid var(--border)', overflowY: 'auto', flexShrink: 0 }}>
                          {partCategories.map(cat => (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => setPartPickerCat(cat)}
                              style={{
                                width: '100%', textAlign: 'left', padding: '9px 14px',
                                background: partPickerCat === cat ? 'var(--primary-light, #eff6ff)' : 'transparent',
                                border: 'none',
                                borderLeft: partPickerCat === cat ? '3px solid var(--primary)' : '3px solid transparent',
                                cursor: 'pointer', fontSize: 13,
                                fontWeight: partPickerCat === cat ? 700 : 400,
                                color: partPickerCat === cat ? 'var(--primary)' : 'var(--text)',
                              }}
                            >
                              {cat}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Right: parts list */}
                      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
                        {parts.length === 0 ? (
                          <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>No parts available</div>
                        ) : pickerParts.length === 0 ? (
                          <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
                            {partPickerSearch ? 'No parts found' : 'No parts in this category'}
                          </div>
                        ) : (
                          pickerParts.map(p => {
                            const alreadyAdded = addedPartIds.has(Number(p.id));
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => { if (!alreadyAdded) addPartItem(p); }}
                                disabled={alreadyAdded}
                                style={{
                                  width: '100%', textAlign: 'left', padding: '9px 16px',
                                  background: alreadyAdded ? '#f0fdf4' : 'transparent',
                                  border: 'none', borderBottom: '1px solid var(--border)',
                                  cursor: alreadyAdded ? 'default' : 'pointer',
                                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                                }}
                                onMouseEnter={e => { if (!alreadyAdded) e.currentTarget.style.background = 'var(--bg-soft)'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = alreadyAdded ? '#f0fdf4' : 'transparent'; }}
                              >
                                <div>
                                  <div style={{ fontSize: 13, fontWeight: alreadyAdded ? 600 : 400, color: alreadyAdded ? '#15803d' : 'var(--text)' }}>{p.name}</div>
                                  {p.category && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{p.category}</div>}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                  {p.customer_rate && (
                                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>₹{Number(p.customer_rate).toLocaleString('en-IN')}</span>
                                  )}
                                  {alreadyAdded
                                    ? <Check size={14} style={{ color: '#16a34a' }} />
                                    : <Plus size={13} style={{ color: 'var(--primary)' }} />
                                  }
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* Footer */}
                    <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {addedPartIds.size > 0 ? `${addedPartIds.size} part${addedPartIds.size > 1 ? 's' : ''} added` : 'No parts added yet'}
                      </span>
                      <button type="button" className="btn btn-primary" style={{ fontSize: 13, padding: '6px 18px' }} onClick={() => setShowPartPicker(false)}>
                        Done
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Grand total */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', flexDirection: 'column', alignItems: 'flex-end', gap: 6, paddingTop: 4 }}>
                {/* Line-item discount summary */}
                {discountMode === 'line_item' && totalDiscount > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: '#b45309' }}>Total Discount:</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#b45309' }}>−{fmt(totalDiscount)}</span>
                  </div>
                )}

                {/* Transaction-level discount input row */}
                {discountMode === 'transaction' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '8px 12px' }}>
                    <span style={{ fontSize: 12, color: '#92400e', fontWeight: 600 }}>Sub Total:</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{fmt(itemsTotal)}</span>
                    <span style={{ fontSize: 12, color: '#92400e', fontWeight: 600, marginLeft: 12 }}>Discount:</span>
                    <input
                      type="number" min="0" step="any"
                      value={txDiscountValue}
                      onChange={e => setTxDiscountValue(parseFloat(e.target.value) || 0)}
                      style={{ width: 70, padding: '4px 8px', borderRadius: 6, border: '1px solid #fcd34d', fontSize: 13, textAlign: 'right' }}
                    />
                    <select
                      value={txDiscountType}
                      onChange={e => setTxDiscountType(e.target.value)}
                      style={{ padding: '4px 6px', borderRadius: 6, border: '1px solid #fcd34d', fontSize: 13, background: '#fff', cursor: 'pointer' }}
                    >
                      <option value="percent">%</option>
                      <option value="flat">₹</option>
                    </select>
                    {txDiscountAmount > 0 && (
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#b45309' }}>−{fmt(txDiscountAmount)}</span>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Grand Total (inc GST):</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--primary)' }}>{fmt(grandTotal)}</span>
                </div>
              </div>
            </div>

            <ErrorBox msg={error} />

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save Draft' : 'Save as Draft')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Invoice Sync Warning Modal
// ─────────────────────────────────────────────────────────────────────────────
function InvoiceSyncWarningModal({ hasPi, piPaid, hasCi, ciPaid, syncBusy, onCancel, onConfirm }) {
  const blockedByPi = hasPi && piPaid;
  const blockedByCi = hasCi && ciPaid;
  const allBlocked  = (!hasPi || blockedByPi) && (!hasCi || blockedByCi);

  return (
    <div className="modal-backdrop" onClick={!syncBusy ? onCancel : undefined}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={18} style={{ color: '#f59e0b' }} />
            Invoices Exist
          </h3>
        </div>
        <div style={{ padding: '16px 20px', fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 12px' }}>
            This estimate has existing invoices. Updating them will recalculate all line items and totals.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {hasPi && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: blockedByPi ? '#fef2f2' : '#f0fdf4', border: `1px solid ${blockedByPi ? '#fca5a5' : '#86efac'}` }}>
                {blockedByPi
                  ? <><XCircle size={15} style={{ color: '#dc2626', flexShrink: 0 }} /><span style={{ color: '#991b1b', fontWeight: 600 }}>Purchase Invoice — already paid, cannot update</span></>
                  : <><CheckCircle2 size={15} style={{ color: '#16a34a', flexShrink: 0 }} /><span>Purchase Invoice — will be recalculated</span></>
                }
              </div>
            )}
            {hasCi && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: blockedByCi ? '#fef2f2' : '#f0fdf4', border: `1px solid ${blockedByCi ? '#fca5a5' : '#86efac'}` }}>
                {blockedByCi
                  ? <><XCircle size={15} style={{ color: '#dc2626', flexShrink: 0 }} /><span style={{ color: '#991b1b', fontWeight: 600 }}>Customer Invoice — already paid, cannot update</span></>
                  : <><CheckCircle2 size={15} style={{ color: '#16a34a', flexShrink: 0 }} /><span>Customer Invoice — will be recalculated</span></>
                }
              </div>
            )}
          </div>
          {allBlocked && (
            <p style={{ margin: 0, color: '#b45309', fontWeight: 600, background: '#fffbeb', padding: '8px 12px', borderRadius: 8 }}>
              All invoices are paid — no updates possible.
            </p>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-ghost" onClick={onCancel} disabled={syncBusy}>
            {allBlocked ? 'Close' : 'Skip'}
          </button>
          {!allBlocked && (
            <button className="btn btn-primary" onClick={onConfirm} disabled={syncBusy}>
              {syncBusy ? 'Syncing…' : 'Update Invoices'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Delete Confirm Modal
// ─────────────────────────────────────────────────────────────────────────────
function DeleteConfirmModal({ estimate, deleting, onCancel, onConfirm }) {
  const hasPi    = !!estimate.purchase_invoice_id;
  const piPaid   = estimate.purchase_invoice_status === 'paid';
  const hasCi    = !!estimate.customer_invoice_id;
  const ciPaid   = estimate.customer_invoice_status === 'paid';
  const blocked  = (hasPi && piPaid) || (hasCi && ciPaid);

  return (
    <div className="modal-backdrop" onClick={!deleting ? onCancel : undefined}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <XCircle size={18} style={{ color: '#dc2626' }} />
            Delete Estimate
          </h3>
        </div>
        <div style={{ padding: '16px 20px', fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
          {blocked ? (
            <p style={{ margin: '0 0 12px', color: '#991b1b', fontWeight: 600 }}>
              Cannot delete — one or more linked invoices have already been paid.
            </p>
          ) : (
            <p style={{ margin: '0 0 12px' }}>
              This will permanently delete the following. <strong>This cannot be undone.</strong>
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {/* Always: the estimate itself */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fca5a5' }}>
              <XCircle size={15} style={{ color: '#dc2626', flexShrink: 0 }} />
              <span style={{ color: '#991b1b', fontWeight: 600 }}>Estimate #{estimate.id}</span>
            </div>
            {hasPi && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: piPaid ? '#f9fafb' : '#fef2f2', border: `1px solid ${piPaid ? '#d1d5db' : '#fca5a5'}` }}>
                {piPaid
                  ? <><AlertCircle size={15} style={{ color: '#f59e0b', flexShrink: 0 }} /><span style={{ color: '#92400e', fontWeight: 600 }}>Purchase Invoice — already paid, <em>cannot delete</em></span></>
                  : <><XCircle size={15} style={{ color: '#dc2626', flexShrink: 0 }} /><span style={{ color: '#991b1b', fontWeight: 600 }}>Purchase Invoice — will be deleted</span></>
                }
              </div>
            )}
            {hasCi && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: ciPaid ? '#f9fafb' : '#fef2f2', border: `1px solid ${ciPaid ? '#d1d5db' : '#fca5a5'}` }}>
                {ciPaid
                  ? <><AlertCircle size={15} style={{ color: '#f59e0b', flexShrink: 0 }} /><span style={{ color: '#92400e', fontWeight: 600 }}>Customer Invoice — already paid, <em>cannot delete</em></span></>
                  : <><XCircle size={15} style={{ color: '#dc2626', flexShrink: 0 }} /><span style={{ color: '#991b1b', fontWeight: 600 }}>Customer Invoice — will be deleted</span></>
                }
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-ghost" onClick={onCancel} disabled={deleting}>Cancel</button>
          {!blocked && (
            <button
              className="btn"
              style={{ background: '#dc2626', color: '#fff', borderColor: '#dc2626' }}
              onClick={onConfirm}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Detail Drawer
// ═════════════════════════════════════════════════════════════════════════════
function DetailDrawer({ estimateId, onClose, onUpdated, showToast, isHubUser = false }) {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const isSuperAdmin = !!authUser?.is_super_admin;
  const [estimate, setEstimate] = react.useState(null);
  const [loading, setLoading] = react.useState(true);
  const [actionBusy, setActionBusy] = react.useState(false);
  const [generatingInvoice, setGeneratingInvoice] = react.useState(false);
  const [generatingPI, setGeneratingPI] = react.useState(false);

  // Company settings for print header
  const [company, setCompany] = react.useState(null);

  // Sub-modal states
  const [showApproval, setShowApproval] = react.useState(false);
  const [showRevision, setShowRevision] = react.useState(false);
  const [showEdit, setShowEdit] = react.useState(false);
  const [showSyncWarning, setShowSyncWarning] = react.useState(false);
  const [syncBusy, setSyncBusy] = react.useState(false);
  const [showKebab, setShowKebab] = react.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = react.useState(false);
  const [deleting, setDeleting] = react.useState(false);

  const load = react.useCallback(async () => {
    setLoading(true);
    try {
      const [res, co] = await Promise.all([
        api(`/api/estimates/${estimateId}`),
        api('/api/settings/company').catch(() => null),
      ]);
      setEstimate(res.item || res.estimate || res);
      if (co) setCompany(co);
    } catch {
      showToast('Failed to load estimate.', 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  }, [estimateId, showToast, onClose]);

  react.useEffect(() => { load(); }, [load]);

  async function doAction(path, body) {
    setActionBusy(true);
    try {
      await api(path, { method: 'POST', body });
      await load();
      showToast('Done.');
    } catch (err) {
      showToast(err.message || 'Action failed.', 'error');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api(`/api/estimates/${estimateId}`, { method: 'DELETE' });
      showToast('Estimate deleted successfully.');
      setShowDeleteConfirm(false);
      onClose();
      if (onUpdated) onUpdated();
    } catch (err) {
      showToast(err.message || 'Failed to delete estimate.', 'error');
      setDeleting(false);
    }
  }

  async function handleWorkStatusChange(itemId, newStatus) {
    try {
      const res = await api(`/api/estimates/${estimateId}/items/${itemId}/work-status`, {
        method: 'PATCH',
        body: { work_status: newStatus },
      });
      // Update local drawer state immediately — no reload needed
      setEstimate(res.item);
      // Notify parent list to sync its shallow copy
      onUpdated && onUpdated(res.item);
    } catch (err) {
      showToast(err.message || 'Failed to update work status', 'error');
    }
  }

  async function handleGeneratePurchaseInvoice(estimateId) {
    setGeneratingPI(true);
    try {
      const res = await api('/api/purchase-invoices/generate', { method: 'POST', body: { estimate_id: estimateId } });
      await load(); // refresh estimate so purchase_invoice_id appears
      navigate('/purchase-invoices', { state: { openId: res.item.id } });
    } catch (err) {
      if (err.status === 409) {
        showToast('A purchase invoice already exists for this estimate.', 'error');
        await load();
      } else {
        showToast(err.message || 'Failed to generate purchase invoice.', 'error');
      }
      setGeneratingPI(false);
    }
  }

  async function handleGenerateCustomerInvoice(estimateId) {
    setGeneratingInvoice(true);
    try {
      const res = await api('/api/customer-invoices/from-estimate', { method: 'POST', body: { estimate_id: estimateId } });
      await load(); // refresh estimate so customer_invoice_id appears
      navigate('/customer-invoices', { state: { openId: res.item.id } });
    } catch (err) {
      if (err.status === 409) {
        showToast('Customer invoice already exists for this estimate.', 'error');
        await load();
      } else {
        showToast(err.message || 'Failed to generate customer invoice.', 'error');
      }
      setGeneratingInvoice(false);
    }
  }

  if (loading) {
    return (
      <div className="card est-detail-view">
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>
          <Clock size={28} style={{ opacity: 0.3, marginBottom: 10 }} />
          <p style={{ margin: 0 }}>Loading estimate…</p>
        </div>
      </div>
    );
  }

  if (!estimate) return null;

  const status = estimate.status;
  const items = estimate.items || [];

  // Transaction discount fields from saved estimate
  const detailDiscountMode    = estimate.discount_mode || 'none';
  const detailTxDiscountType  = estimate.transaction_discount_type || 'percent';
  const detailTxDiscountValue = parseFloat(estimate.transaction_discount_value) || 0;

  // Totals + dynamic GST slab grouping
  let subtotalEx = 0, totalGst = 0, grandTotal = 0, totalDiscount = 0;
  const gstSlabMap = {}; // { '18': { cgst: n, sgst: n }, '5': { ... } }
  // Exclude rejected items from all totals (customer_approved === false means rejected)
  const activeItems = items.filter(it => it.customer_approved !== false);
  activeItems.forEach(it => {
    // Derive pre-discount inc-GST rate from customer_rate (ex-GST, pre-discount) stored in DB.
    // Do NOT use total_inc_gst ÷ qty here — that is the post-discount per-unit value and would
    // cause computeItem to apply the discount a second time (double-discount bug).
    const exRate = parseFloat(it.customer_rate ?? it.unit_rate) || 0;
    const gstPct = parseFloat(it.gst_percent) || 0;
    const preDiscountIncRate = exRate > 0 ? r2(exRate * (1 + gstPct / 100)) : 0;
    const c = computeItem({ ...it, unit_rate: it.customer_rate ?? it.unit_rate, inc_rate: preDiscountIncRate });
    subtotalEx += c.amount;
    totalGst += c.gst_amount;
    grandTotal += c.total;
    totalDiscount += c.discountAmount;
    const pct = parseFloat(it.gst_percent ?? 0);
    if (pct > 0) {
      const key = pct.toString();
      if (!gstSlabMap[key]) gstSlabMap[key] = { pct, cgst: 0, sgst: 0, gstTotal: 0 };
      gstSlabMap[key].gstTotal += c.gst_amount;
    }
  });
  // CGST/SGST split: ceil goes to CGST, floor to SGST — ensures CGST+SGST = gstTotal exactly
  Object.values(gstSlabMap).forEach(slab => {
    slab.cgst = r2(Math.ceil(slab.gstTotal * 100 / 2) / 100);
    slab.sgst = r2(slab.gstTotal - slab.cgst);
  });
  subtotalEx = r2(subtotalEx);
  totalGst = r2(totalGst);
  grandTotal = r2(grandTotal);
  totalDiscount = r2(totalDiscount);

  // Apply transaction-level discount on top of items total
  let txDiscountAmount = 0;
  if (detailDiscountMode === 'transaction' && detailTxDiscountValue > 0) {
    if (detailTxDiscountType === 'percent') {
      txDiscountAmount = r2(grandTotal * detailTxDiscountValue / 100);
    } else {
      txDiscountAmount = Math.min(detailTxDiscountValue, grandTotal);
    }
    grandTotal = r2(grandTotal - txDiscountAmount);
  }

  // Rounding adjustment: difference between grand total and sum of components (should be 0.00 or ±0.01)
  const roundingAdj = r2(grandTotal - subtotalEx - totalGst + txDiscountAmount);
  // Sort slabs descending by rate (18% first, then 12%, 5%, etc.)
  const gstSlabs = Object.values(gstSlabMap).sort((a, b) => b.pct - a.pct);
  const hasDiscountInDetail = totalDiscount > 0;

  const approvedCount = items.filter(i => i.customer_approved === true).length;
  const rejectedCount = items.filter(i => i.customer_approved === false).length;

  return (
    <>
      <div className="card est-detail-view">
        {/* ── Print header (company + estimate title + QR) ── */}
        <div className="est-print-header">
          {/* Left: company details */}
          <div style={{ flex: 1 }}>
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
                {company.email && <div style={{ fontSize: 12, color: '#444' }}>Email : {company.email}</div>}
                {company.phone && <div style={{ fontSize: 12, color: '#444' }}>Phone : {company.phone}</div>}
                {company.gstin && <div style={{ fontSize: 12, color: '#444' }}>GSTIN : {company.gstin}</div>}
              </>
            ) : (
              <div style={{ fontSize: 12, color: '#888', fontStyle: 'italic' }}>
                No company details set — add them in Super Admin → Profile
              </div>
            )}
          </div>
          {/* Right: estimate label + ID + QR code */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: '#111', letterSpacing: '0.04em' }}>ESTIMATE</div>
              <div style={{ fontSize: 13, color: '#555', marginTop: 3 }}>EST-{String(estimate.id).padStart(6, '0')}</div>
              <div style={{ marginTop: 6 }}><StatusBadge status={status} /></div>
            </div>
            {/* QR Code — always show in print header */}
            <div className="est-print-qr" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <img
                src="/qr-code.png"
                alt="QR Code"
                style={{ width: 72, height: 72, imageRendering: 'pixelated' }}
              />
              <span style={{ fontSize: 8, color: '#888', letterSpacing: '0.03em' }}>Scan to visit us</span>
            </div>
          </div>
        </div>

        {/* ── Screen header bar (hidden on print) ── */}
        <div className="est-detail-header est-screen-only">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FileText size={18} style={{ color: 'var(--primary)' }} />
            <span style={{ fontWeight: 700, fontSize: 16 }}>Estimate #{estimate.id}</span>
            <StatusBadge status={status} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="btn btn-ghost"
              onClick={() => window.print()}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontSize: 13 }}
              title="Print estimate"
            >
              <Printer size={15} /> Print
            </button>

            {/* Kebab menu */}
            <div style={{ position: 'relative' }}>
              <button
                className="btn btn-ghost"
                onClick={() => setShowKebab(v => !v)}
                style={{ padding: '6px 8px', display: 'flex', alignItems: 'center' }}
                title="More options"
              >
                <MoreVertical size={16} />
              </button>
              {showKebab && (
                <>
                  {/* Backdrop to close on outside click */}
                  <div
                    style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                    onClick={() => setShowKebab(false)}
                  />
                  <div style={{
                    position: 'absolute', right: 0, top: '100%', marginTop: 4,
                    background: 'var(--bg)', border: '1px solid var(--border)',
                    borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                    zIndex: 100, minWidth: 160, overflow: 'hidden',
                  }}>
                    <button
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        width: '100%', padding: '10px 14px', background: 'none',
                        border: 'none', cursor: 'pointer', fontSize: 13,
                        color: 'var(--text)', textAlign: 'left',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-soft, #f3f4f6)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      onClick={() => { setShowKebab(false); setShowEdit(true); }}
                    >
                      <FileText size={14} /> Edit Estimate
                    </button>
                    {isSuperAdmin && (
                      <button
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          width: '100%', padding: '10px 14px', background: 'none',
                          border: 'none', borderTop: '1px solid var(--border)',
                          cursor: 'pointer', fontSize: 13,
                          color: '#dc2626', textAlign: 'left',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        onClick={() => { setShowKebab(false); setShowDeleteConfirm(true); }}
                      >
                        <XCircle size={14} /> Delete Estimate
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ── Info Section — two-column bill-to / estimate-meta ── */}
          <div className="est-info-grid">
            {/* Left column: customer / vehicle */}
            <div style={{ padding: '16px 20px', borderRight: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Bill To</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {[
                  { label: 'Customer', value: estimate.customer_name },
                  { label: 'Mobile', value: estimate.mobile },
                  { label: 'Hub', value: estimate.hub_name },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: 'flex' }}>
                    <span className="est-info-label">{label}</span>
                    <span className="est-info-value">{value || '—'}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Right column: vehicle details + estimate meta */}
            <div style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Vehicle & Estimate</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {/* Vehicle number */}
                <div style={{ display: 'flex' }}>
                  <span className="est-info-label">Reg. No.</span>
                  <span className="est-info-value">{estimate.vehicle_number || '—'}</span>
                </div>
                {/* Make + Model */}
                {(estimate.make_name || estimate.model_name) && (
                  <div style={{ display: 'flex' }}>
                    <span className="est-info-label">Make / Model</span>
                    <span className="est-info-value">{[estimate.make_name, estimate.model_name].filter(Boolean).join(' ')}</span>
                  </div>
                )}
                {/* 4W: Body Type */}
                {estimate.body_type_name && (
                  <div style={{ display: 'flex' }}>
                    <span className="est-info-label">Body Type</span>
                    <span className="est-info-value">{estimate.body_type_name}{estimate.segment_names ? ` (${estimate.segment_names})` : ''}</span>
                  </div>
                )}
                {/* 2W: CC Category */}
                {estimate.cc_category_name && (
                  <div style={{ display: 'flex' }}>
                    <span className="est-info-label">CC Category</span>
                    <span className="est-info-value">{estimate.cc_category_name}{estimate.engine_cc ? ` (${estimate.engine_cc} cc)` : ''}</span>
                  </div>
                )}
                {/* Estimate meta */}
                <div style={{ display: 'flex' }}>
                  <span className="est-info-label">Est. No.</span>
                  <span className="est-info-value">{`EST-${String(estimate.id).padStart(6, '0')}`}</span>
                </div>
                <div style={{ display: 'flex' }}>
                  <span className="est-info-label">Date</span>
                  <span className="est-info-value">{estimate.created_at ? new Date(estimate.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</span>
                </div>
                {/* Created by — screen only, not in PDF */}
                <div className="est-no-print" style={{ display: 'flex' }}>
                  <span className="est-info-label">Created by</span>
                  <span className="est-info-value">{estimate.created_by_name || '—'}</span>
                </div>
              </div>
            </div>
          </div>

          {estimate.notes && !['fully_approved', 'partially_approved', 'work_in_progress', 'work_completed'].includes(status) && (
            <div className="est-no-print" style={{ background: 'var(--bg-soft)', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: 'var(--text)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Notes</div>
              {estimate.notes}
            </div>
          )}

          {/* ── Line Items ── */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>Line Items</div>
            {items.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px', fontSize: 13 }}>No items yet.</div>
            ) : (
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflowX: 'auto' }}>
                <table className="est-items-table" style={{ minWidth: hasDiscountInDetail ? 1040 : 920 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 36, textAlign: 'center' }}>Sr.</th>
                      <th style={{ minWidth: 160, maxWidth: 220 }}>Item</th>
                      <th>HSN/SAC</th>
                      <th style={{ textAlign: 'right' }}>Qty</th>
                      <th style={{ textAlign: 'right' }}>Rate</th>
                      {hasDiscountInDetail && <th style={{ textAlign: 'center' }}>Discount</th>}
                      <th style={{ textAlign: 'right' }}>Taxable</th>
                      <th style={{ textAlign: 'right' }}>CGST %</th>
                      <th style={{ textAlign: 'right' }}>SGST %</th>
                      <th style={{ textAlign: 'right' }}>Tax Amount</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th className="est-no-print" style={{ textAlign: 'center' }}>Approved?</th>
                      {['fully_approved', 'partially_approved', 'work_in_progress', 'work_completed'].includes(status) && (
                        <th className="est-no-print" style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>Work Status</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => {
                      const exRate = parseFloat(it.customer_rate ?? it.unit_rate) || 0;
                      const gstPct = parseFloat(it.gst_percent) || 0;
                      // Use pre-discount inc-GST rate for display in Rate column
                      const preDiscIncRate = exRate > 0 ? r2(exRate * (1 + gstPct / 100)) : 0;
                      // computeItem with pre-discount inc_rate so discount shows correctly
                      const c = computeItem({ ...it, unit_rate: exRate, inc_rate: preDiscIncRate });
                      return (
                        <tr key={it.id}>
                          <td style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{idx + 1}</td>
                          <td style={{ maxWidth: 220 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3, overflowWrap: 'break-word', wordBreak: 'normal' }} title={it.description}>{it.description}</div>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap' }}>
                              <span style={{
                                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                                whiteSpace: 'nowrap', display: 'inline-block',
                                background: it.item_type === 'service' ? '#dbeafe' : '#dcfce7',
                                color: it.item_type === 'service' ? '#1e40af' : '#166534',
                              }}>
                                {it.item_type === 'service' ? 'Service' : 'Part'}
                              </span>
                              {it.is_fixed_from_appointment && (
                                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#fef3c7', color: '#92400e' }}>Fixed</span>
                              )}
                            </div>
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{it.hsn_sac || '—'}</td>
                          <td style={{ textAlign: 'right', fontSize: 13 }}>{it.quantity}</td>
                          <td style={{ textAlign: 'right', fontSize: 13, color: '#166534', fontWeight: 600 }}>{fmt(preDiscIncRate)}</td>
                          {hasDiscountInDetail && (
                            <td style={{ textAlign: 'center' }}>
                              {c.discountAmount > 0 ? (
                                <div className="est-discount-cell" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                                  <span style={{ fontSize: 12, fontWeight: 600, color: '#b45309', whiteSpace: 'nowrap' }}>
                                    {fmt(c.discountAmount)}
                                  </span>
                                  <span style={{ fontSize: 11, color: '#92400e', fontWeight: 500, whiteSpace: 'nowrap' }}>
                                    {it.discount_type === 'percent' ? `${it.discount_value}%` : 'Flat'}
                                  </span>
                                </div>
                              ) : (
                                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
                              )}
                            </td>
                          )}
                          <td style={{ textAlign: 'right', fontSize: 13 }}>{fmt(c.amount)}</td>
                          <td style={{ textAlign: 'right', fontSize: 13 }}>{gstPct > 0 ? `${(gstPct / 2).toFixed(1)}%` : '—'}</td>
                          <td style={{ textAlign: 'right', fontSize: 13 }}>{gstPct > 0 ? `${(gstPct / 2).toFixed(1)}%` : '—'}</td>
                          <td style={{ textAlign: 'right', fontSize: 13, color: 'var(--text-muted)' }}>{fmt(c.gst_amount)}</td>
                          <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmt(c.total)}</td>
                          <td className="est-no-print" style={{ textAlign: 'center' }}>
                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                              <ApprovalIcon value={it.customer_approved} />
                            </div>
                          </td>
                          {['fully_approved', 'partially_approved', 'work_in_progress', 'work_completed'].includes(status) && (
                            <td className="est-no-print" style={{ textAlign: 'center' }}>
                              {it.customer_approved === true ? (
                                status === 'work_completed' ? (
                                  <WorkStatusBadge status={it.work_status || 'pending'} />
                                ) : (
                                  <WorkStatusSelect
                                    value={it.work_status || 'pending'}
                                    onChange={val => handleWorkStatusChange(it.id, val)}
                                  />
                                )
                              ) : (
                                <WorkStatusBadge status={it.customer_approved === false ? 'rejected' : 'pending'} />
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Totals ── */}
          <div className="est-totals-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderTop: '1px solid var(--border)', paddingTop: 16, gap: 24, flexWrap: 'wrap' }}>

            {/* Amount in words — left */}
            <div className="est-amount-words" style={{
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
            <div style={{ flex: '0 0 auto', minWidth: 250, display: 'flex', flexDirection: 'column', gap: 0 }}>

              {/* Subtotal */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', padding: '5px 0', borderBottom: '1px solid #f3f4f6' }}>
                <span>Subtotal (ex-GST)</span>
                <span style={{ fontWeight: 600, color: '#374151', minWidth: 100, textAlign: 'right' }}>{fmt(subtotalEx)}</span>
              </div>

              {/* Line-item discount row */}
              {hasDiscountInDetail && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderBottom: '1px solid #f3f4f6', background: '#fffbeb', margin: '0 -2px', padding: '5px 2px' }}>
                  <span style={{ color: '#b45309', fontWeight: 600 }}>Total Discount</span>
                  <span style={{ fontWeight: 700, color: '#b45309', minWidth: 100, textAlign: 'right' }}>−{fmt(totalDiscount)}</span>
                </div>
              )}

              {/* Transaction-level discount row */}
              {txDiscountAmount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderBottom: '1px solid #f3f4f6', background: '#fffbeb', margin: '0 -2px', padding: '5px 2px' }}>
                  <span style={{ color: '#b45309', fontWeight: 600 }}>
                    Discount{detailTxDiscountType === 'percent' ? ` (${detailTxDiscountValue}%)` : ' (Flat)'}
                  </span>
                  <span style={{ fontWeight: 700, color: '#b45309', minWidth: 100, textAlign: 'right' }}>−{fmt(txDiscountAmount)}</span>
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

              {/* Rounding adjustment line — shown only when non-zero */}
              {roundingAdj !== 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af', padding: '4px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <span>Rounding</span>
                  <span style={{ minWidth: 100, textAlign: 'right' }}>{roundingAdj > 0 ? '+' : ''}{fmt(roundingAdj)}</span>
                </div>
              )}

              {/* Grand Total */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 800, color: '#16b994', padding: '8px 0' }}>
                <span>Grand Total</span>
                <span style={{ minWidth: 100, textAlign: 'right' }}>{fmt(grandTotal)}</span>
              </div>

            </div>
          </div>

          {/* Approval summary for terminal states — screen only */}
          {(status === 'fully_approved' || status === 'partially_approved' || status === 'work_in_progress' || status === 'work_completed') && (
            <div className="est-no-print" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 600, background: '#dcfce7', color: '#166534', borderRadius: 8, padding: '6px 12px' }}>
                <CheckCircle2 size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                {approvedCount} approved
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, background: '#fef2f2', color: '#991b1b', borderRadius: 8, padding: '6px 12px' }}>
                <XCircle size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                {rejectedCount} rejected
              </span>
            </div>
          )}

          {/* Next-step instruction — screen only */}
          {(status === 'fully_approved' || status === 'partially_approved') && (
            <div className="est-no-print" style={{
              background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10,
              padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              <AlertCircle size={16} style={{ color: '#2563eb', flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 13, color: '#1e40af', lineHeight: 1.5 }}>
                <strong>Next step — Work Execution:</strong> Change each approved item's Work Status below
                from <em>Pending → In Progress → Completed</em>. Once all approved items are marked
                Completed, the estimate moves to <strong>Work Completed</strong> and you can generate
                the Purchase Invoice.
              </div>
            </div>
          )}

          {/* Work progress summary */}
          {(status === 'fully_approved' || status === 'partially_approved' || status === 'work_in_progress' || status === 'work_completed') && (() => {
            const approvedItems = items.filter(i => i.customer_approved === true);
            const completedItems = approvedItems.filter(i => i.work_status === 'completed');
            const pct = approvedItems.length > 0 ? Math.round((completedItems.length / approvedItems.length) * 100) : 0;
            const allDone = pct === 100 && approvedItems.length > 0;
            if (allDone) return null;
            return (
              <div className="est-no-print" style={{ background: 'var(--bg-soft)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                  <span>Work Progress</span>
                  <span style={{ color: allDone ? '#166534' : 'var(--text-muted)' }}>
                    {completedItems.length} of {approvedItems.length} items completed
                    {allDone && ' ✓'}
                  </span>
                </div>
                <div style={{ height: 8, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: allDone ? '#16a34a' : '#f59e0b', borderRadius: 99, transition: 'width 0.3s ease' }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>{pct}%</div>
              </div>
            );
          })()}

          {/* ── Action Buttons — screen only ── */}
          <div className="est-no-print" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 4 }}>
            {(status === 'draft' || status === 'revision_requested') && (
              <button className="btn btn-primary" disabled={actionBusy}
                onClick={() => doAction(`/api/estimates/${estimate.id}/submit`)}>
                {actionBusy ? 'Submitting…' : 'Submit to Company'}
              </button>
            )}

            {status === 'pending_company_review' && !isHubUser && (
              <>
                <button className="btn btn-primary" disabled={actionBusy}
                  onClick={() => doAction(`/api/estimates/${estimate.id}/company-approve`)}>
                  {actionBusy ? 'Approving…' : 'Approve → Send to Customer'}
                </button>
                <button className="btn btn-danger" disabled={actionBusy}
                  onClick={() => setShowRevision(true)}>
                  Request Revision
                </button>
              </>
            )}

            {status === 'sent_to_customer' && (
              <button className="btn btn-primary" disabled={actionBusy}
                onClick={() => setShowApproval(true)}>
                Mark Customer Approval
              </button>
            )}

            {status === 'work_completed' && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>

                {/* ── Two action buttons, always visible ── */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>

                  {/* Button 1: Spinoto Invoice (Purchase Invoice) */}
                  {estimate.purchase_invoice_id ? (
                    <button
                      className="btn btn-sm-outline"
                      onClick={() => navigate('/purchase-invoices', { state: { openId: estimate.purchase_invoice_id } })}
                    >
                      <ReceiptText size={13} />
                      View Spinoto Invoice #{estimate.purchase_invoice_id}
                    </button>
                  ) : (
                    <button
                      className="btn btn-sm-amber"
                      onClick={() => handleGeneratePurchaseInvoice(estimate.id)}
                      disabled={generatingPI}
                    >
                      <ReceiptText size={13} />
                      {generatingPI ? 'Generating…' : 'Generate Spinoto Invoice'}
                    </button>
                  )}

                  {/* Button 2: Customer Invoice */}
                  {estimate.customer_invoice_id ? (
                    <button
                      className="btn btn-sm-outline"
                      onClick={() => navigate('/customer-invoices', { state: { openId: estimate.customer_invoice_id } })}
                    >
                      <ReceiptText size={13} />
                      View Customer Invoice #{estimate.customer_invoice_id}
                    </button>
                  ) : (
                    <button
                      className="btn btn-sm-primary"
                      onClick={() => handleGenerateCustomerInvoice(estimate.id)}
                      disabled={generatingInvoice || estimate.purchase_invoice_status !== 'approved'}
                      title={estimate.purchase_invoice_status !== 'approved' ? 'Spinoto Invoice must be approved first' : ''}
                    >
                      <ReceiptText size={13} />
                      {generatingInvoice ? 'Generating…' : 'Generate Customer Invoice'}
                    </button>
                  )}
                </div>

                {/* Status hint below the buttons */}
                {!estimate.purchase_invoice_id && (
                  <div style={{ fontSize: 12, color: '#92400e', display: 'flex', gap: 6, alignItems: 'center' }}>
                    <AlertCircle size={12} />
                    Generate the Spinoto Invoice first, then get it approved to unlock Customer Invoice.
                  </div>
                )}
                {estimate.purchase_invoice_id && estimate.purchase_invoice_status !== 'approved' && !estimate.customer_invoice_id && (
                  <div style={{ fontSize: 12, color: '#92400e', display: 'flex', gap: 6, alignItems: 'center' }}>
                    <AlertCircle size={12} />
                    Spinoto Invoice is pending approval — Customer Invoice will unlock once approved.
                  </div>
                )}

              </div>
            )}
          </div>

          {/* ── Estimate Footer ── */}
          <div className="est-invoice-footer" style={{
            marginTop: 8,
            borderTop: '1px solid #e5e7eb',
            paddingTop: 14,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280' }}>Thank you for choosing us.</div>
            <div style={{ fontSize: 10, color: '#9ca3af' }}>This is a computer generated estimate and is subject to change upon final inspection.</div>
            {(company?.phone || company?.email) && (
              <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
                {[company.phone && `📞 ${company.phone}`, company.email && `✉ ${company.email}`].filter(Boolean).join('   ·   ')}
              </div>
            )}
          </div>

        </div>

        {/* Sub-modals */}
        {showApproval && (
          <CustomerApprovalModal
            estimate={estimate}
            onClose={() => setShowApproval(false)}
            onDone={() => { setShowApproval(false); load(); showToast('Customer approvals saved.'); }}
          />
        )}
        {showRevision && (
          <RevisionModal
            estimateId={estimate.id}
            onClose={() => setShowRevision(false)}
            onDone={() => { setShowRevision(false); load(); showToast('Revision requested.'); }}
          />
        )}
        {showEdit && (
          <EstimateModal
            editEstimate={estimate}
            onClose={() => setShowEdit(false)}
            onSaved={async () => {
              setShowEdit(false);
              await load();
              // If PI or CI exist, show sync warning
              if (estimate.purchase_invoice_id || estimate.customer_invoice_id) {
                setShowSyncWarning(true);
              } else {
                showToast('Estimate updated.');
              }
            }}
          />
        )}

        {showDeleteConfirm && estimate && (
          <DeleteConfirmModal
            estimate={estimate}
            deleting={deleting}
            onCancel={() => setShowDeleteConfirm(false)}
            onConfirm={handleDelete}
          />
        )}

        {showSyncWarning && (
          <InvoiceSyncWarningModal
            hasPi={!!estimate.purchase_invoice_id}
            piPaid={estimate.purchase_invoice_status === 'paid'}
            hasCi={!!estimate.customer_invoice_id}
            ciPaid={estimate.customer_invoice_status === 'paid'}
            syncBusy={syncBusy}
            onCancel={() => { setShowSyncWarning(false); showToast('Estimate updated. Invoices not synced.'); }}
            onConfirm={async () => {
              setSyncBusy(true);
              const errors = [];
              try {
                if (estimate.purchase_invoice_id) {
                  try {
                    await api(`/api/purchase-invoices/${estimate.purchase_invoice_id}/sync-from-estimate`, { method: 'POST' });
                  } catch (e) {
                    errors.push(`PI: ${e.message}`);
                  }
                }
                if (estimate.customer_invoice_id) {
                  try {
                    await api(`/api/customer-invoices/${estimate.customer_invoice_id}/sync-from-estimate`, { method: 'POST' });
                  } catch (e) {
                    errors.push(`CI: ${e.message}`);
                  }
                }
              } finally {
                setSyncBusy(false);
                setShowSyncWarning(false);
                await load();
                if (errors.length > 0) {
                  showToast(`Estimate updated. Some invoices could not sync: ${errors.join('; ')}`, 'error');
                } else {
                  showToast('Estimate updated. Invoices synced successfully.');
                }
              }
            }}
          />
        )}
      </div>
    </>
  );
}


// ═════════════════════════════════════════════════════════════════════════════
// Main Page
// ═════════════════════════════════════════════════════════════════════════════
export default function EstimatesPage() {
  const { user } = useAuth();
  const location = useLocation();
  const isHubUser = !!user?.hub_id;

  const [estimates, setEstimates] = react.useState([]);
  const [total, setTotal] = react.useState(0);
  const [loading, setLoading] = react.useState(true);

  const [page, setPage] = react.useState(1);
  const [pageSize, setPageSize] = react.useState(10);

  const [search, setSearch] = react.useState('');
  const [statusFilter, setStatusFilter] = react.useState('');
  const [hubFilter, setHubFilter] = react.useState(() => user?.hub_id ? String(user.hub_id) : '');

  const [hubs, setHubs] = react.useState([]);
  const [hubsLoaded, setHubsLoaded] = react.useState(false);

  // Auto-open a specific estimate if navigated here from Purchase Invoice or Customer Invoice
  const [selectedId, setSelectedId] = react.useState(() => location.state?.openId ?? null);
  const [showCreate, setShowCreate] = react.useState(() => !!location.state?.createForAppointmentId);
  const [createApptId, setCreateApptId] = react.useState(() => location.state?.createForAppointmentId ?? null);
  const [toast, setToast] = react.useState(null);

  const showToast = react.useCallback((msg, type = 'success') => setToast({ msg, type }), []);

  // Stable close handler — avoids recreating DetailDrawer's `load` on every re-render
  const handleCloseDetail = react.useCallback(() => setSelectedId(null), []);

  // Load hubs once for filter dropdown
  react.useEffect(() => {
    api('/api/hubs?limit=100')
      .then(r => { setHubs(r.items || []); setHubsLoaded(true); })
      .catch(() => setHubsLoaded(true));
  }, []);

  const fetchEstimates = react.useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (search.trim()) q.set('search', search.trim());
      if (statusFilter) q.set('status', statusFilter);
      if (hubFilter) q.set('hub_id', hubFilter);
      q.set('page', String(page));
      q.set('limit', String(pageSize));
      const res = await api(`/api/estimates?${q.toString()}`);
      setEstimates(res.items || []);
      setTotal(res.total ?? (res.items || []).length);
    } catch {
      showToast('Failed to load estimates.', 'error');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, hubFilter, page, pageSize, showToast]);

  react.useEffect(() => { fetchEstimates(); }, [fetchEstimates]);

  function onCreated(item) {
    setShowCreate(false);
    showToast('Estimate created.');
    fetchEstimates();
    if (item?.id) setSelectedId(item.id);
  }

  // Work status changes are now handled inside DetailDrawer directly.
  // The drawer calls onUpdated(updatedItem) to sync the list here.
  function handleDrawerUpdated(updatedItem) {
    fetchEstimates();
    if (updatedItem?.id) {
      setEstimates(prev => prev.map(e =>
        e.id === updatedItem.id ? { ...e, status: updatedItem.status, grand_total: updatedItem.grand_total } : e
      ));
    }
  }

  return (
    <div className="estimates-page">
      {/* ── Header ── */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        {selectedId ? (
          /* Detail view header */
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="btn btn-ghost"
              onClick={() => { setSelectedId(null); fetchEstimates(); }}
              style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} />
              All Estimates
            </button>
            <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10, fontSize: 18 }}>
              <FileText size={20} style={{ color: 'var(--primary)' }} />
              Estimate Detail
            </h2>
          </div>
        ) : (
          /* List view header */
          <div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <FileText size={22} style={{ color: 'var(--primary)' }} />
              Estimates
            </h2>
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
              Manage service estimates linked to appointments.
            </p>
          </div>
        )}

        {!selectedId && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New Estimate
          </button>
        )}
      </div>

      {selectedId ? (
        /* ── Full-page Detail View ── */
        <DetailDrawer
          estimateId={selectedId}
          onClose={handleCloseDetail}
          onUpdated={handleDrawerUpdated}
          showToast={showToast}
          isHubUser={isHubUser}
        />
      ) : (
        <>
          {/* ── Filters ── */}
          <div className="card" style={{ padding: '14px 18px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: '1 1 220px' }}>
              <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                className="form-input"
                style={{ paddingLeft: 32 }}
                placeholder="Search by customer, vehicle, mobile…"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <select
              className="form-input"
              style={{ flex: '0 0 180px' }}
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            >
              <option value="">All statuses</option>
              {Object.entries(STATUS_META).map(([val, m]) => (
                <option key={val} value={val}>{m.label}</option>
              ))}
            </select>
            {!isHubUser && (
              <select
                className="form-input"
                style={{ flex: '0 0 160px' }}
                value={hubFilter}
                onChange={e => { setHubFilter(e.target.value); setPage(1); }}
              >
                <option value="">All hubs</option>
                {hubs.map(h => <option key={h.id} value={h.id}>{h.hub_name}</option>)}
              </select>
            )}
            <button className="btn btn-ghost" onClick={fetchEstimates} title="Refresh" style={{ flexShrink: 0 }}>
              <RefreshCw size={15} />
            </button>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {total} estimate{total !== 1 ? 's' : ''}
            </span>
          </div>

          {/* ── Table ── */}
          <div className="card" style={{ overflowX: 'auto' }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                <Clock size={28} style={{ opacity: 0.3, marginBottom: 10 }} />
                <p style={{ margin: 0 }}>Loading estimates…</p>
              </div>
            ) : estimates.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                <FileText size={32} style={{ opacity: 0.3, marginBottom: 10 }} />
                <p style={{ margin: 0 }}>
                  {search || statusFilter || hubFilter ? 'No estimates match your filters.' : 'No estimates yet. Create your first one above.'}
                </p>
              </div>
            ) : (
              <div className="est-table-wrap">
                <table className="est-table">
                  <thead>
                    <tr>
                      <th>#ID</th>
                      <th>Appointment</th>
                      <th>Hub</th>
                      <th style={{ textAlign: 'right' }}>Items</th>
                      <th style={{ textAlign: 'right' }}>Grand Total</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th style={{ width: 60 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {estimates.map(est => (
                      <tr
                        key={est.id}
                        className="est-table-row"
                        onClick={() => setSelectedId(est.id)}
                      >
                        <td style={{ fontWeight: 700, color: 'var(--primary)' }}>#{est.id}</td>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{est.customer_name || '—'}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{est.vehicle_number || '—'}</div>
                        </td>
                        <td style={{ fontSize: 13 }}>{est.hub_name || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                        <td style={{ textAlign: 'right', fontSize: 13 }}>{est.item_count ?? (est.items?.length ?? '—')}</td>
                        <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{fmt(est.grand_total)}</td>
                        <td><StatusBadge status={est.status} /></td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {est.created_at ? new Date(est.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <button
                            className="icon-action"
                            title="View"
                            onClick={() => setSelectedId(est.id)}
                          >
                            <Eye size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <PaginationBar
              page={page} total={total} pageSize={pageSize}
              onPage={setPage}
              onPageSize={n => { setPageSize(n); setPage(1); }}
              noun="estimate"
            />
          </div>
        </>
      )}

      {/* ── Create Modal ── */}
      {showCreate && (
        <EstimateModal
          editEstimate={null}
          initialAppointmentId={createApptId || ''}
          onClose={() => { setShowCreate(false); setCreateApptId(null); }}
          onSaved={onCreated}
          isHubUser={isHubUser}
          userHubId={user?.hub_id ? String(user.hub_id) : ''}
        />
      )}

      {/* ── Toast ── */}
      {toast && (
        <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Styles
