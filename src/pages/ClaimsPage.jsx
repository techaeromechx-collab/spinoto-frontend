import { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import useSync from '../hooks/useSync.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import { useCan } from '../auth/AuthContext.jsx';
import {
  Plus, X, Search, RefreshCw, AlertCircle, CheckCircle2, XCircle,
  ShieldAlert, Clock, Eye, Wrench, ChevronRight, BarChart3,
} from 'lucide-react';
import '../styles/DiscountMasterPage.css';

// ── Helpers ───────────────────────────────────────────────────────────────────
function promiseLabelOf(text, months, days, km) {
  if (text) return text;
  const parts = [];
  if (months) parts.push(`${months} Month${months > 1 ? 's' : ''}`);
  if (days)   parts.push(`${days} Day${days > 1 ? 's' : ''}`);
  if (km)     parts.push(`${Number(km).toLocaleString('en-IN')} KM`);
  if (parts.length === 0) return '—';
  return parts.length > 1 ? `${parts.join(' / ')} (whichever is earlier)` : parts[0];
}

function warrantyLabel(w) {
  return promiseLabelOf(w.warranty_text, w.warranty_months, w.warranty_days, w.warranty_km);
}

function guaranteeLabelOf(w) {
  return promiseLabelOf(w.guarantee_text, w.guarantee_months, w.guarantee_days, w.guarantee_km);
}

const CLAIM_TYPE_META = {
  warranty:  { icon: '🛡', label: 'Warranty'  },
  guarantee: { icon: '✔', label: 'Guarantee' },
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS_META = {
  registered:   { bg: '#f3f4f6', color: '#374151', label: 'Registered' },
  under_review: { bg: '#fef3c7', color: '#92400e', label: 'Under Review' },
  approved:     { bg: '#dbeafe', color: '#1e40af', label: 'Approved' },
  rejected:     { bg: '#fee2e2', color: '#991b1b', label: 'Rejected' },
  resolved:     { bg: '#dcfce7', color: '#166534', label: 'Resolved' },
  cancelled:    { bg: '#f3f4f6', color: '#9ca3af', label: 'Cancelled' },
};

const VALIDITY_META = {
  valid:   { bg: '#dcfce7', color: '#166534', label: 'Valid' },
  expired: { bg: '#fee2e2', color: '#991b1b', label: 'Expired' },
  manual:  { bg: '#fef3c7', color: '#92400e', label: 'Manual Check' },
};

function Badge({ meta }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 99,
      fontSize: 11, fontWeight: 700, background: meta.bg, color: meta.color, whiteSpace: 'nowrap',
    }}>{meta.label}</span>
  );
}

function Toast({ msg, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [msg, onClose]);
  const isErr = type === 'error';
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      display: 'flex', alignItems: 'center', gap: 10,
      background: isErr ? '#fef2f2' : '#f0fdf4',
      border: `1px solid ${isErr ? '#fca5a5' : '#86efac'}`,
      borderRadius: 10, padding: '12px 18px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
      color: isErr ? '#991b1b' : '#166534', fontWeight: 500, fontSize: 14, maxWidth: 420,
    }}>
      {isErr ? <AlertCircle size={16} style={{ flexShrink: 0 }} /> : <CheckCircle2 size={16} style={{ flexShrink: 0 }} />}
      {msg}
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', marginLeft: 4 }}>
        <X size={14} />
      </button>
    </div>
  );
}

// ── Register modal ────────────────────────────────────────────────────────────
function RegisterModal({ onClose, onSaved, prefillMobile }) {
  useEscapeClose(onClose);
  const [mobile, setMobile]         = useState(prefillMobile || '');
  const [searching, setSearching]   = useState(false);
  const [eligible, setEligible]     = useState(null);   // null = not searched yet
  const [selectedIds, setSelectedIds] = useState([]);   // multiple customer_invoice_item_ids
  const [typeChoice, setTypeChoice] = useState({});     // { itemId: 'warranty'|'guarantee' }
  const [currentKm, setCurrentKm]   = useState('');
  const [reason, setReason]         = useState('');
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState(null);

  async function search() {
    if (!mobile.trim()) { setError('Enter the customer mobile number.'); return; }
    setSearching(true); setError(null); setEligible(null); setSelectedIds([]); setTypeChoice({});
    try {
      const r = await api(`/api/warranty-claims/eligible-items?mobile=${encodeURIComponent(mobile.trim())}`);
      setEligible(r.items || []);
    } catch (err) {
      setError(err.message || 'Search failed.');
    } finally {
      setSearching(false);
    }
  }

  const defaultType = (it) =>
    it.has_warranty && !it.open_warranty_claim_id ? 'warranty' : 'guarantee';

  function toggleItem(it) {
    const id = it.customer_invoice_item_id;
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    setTypeChoice(prev => prev[id] ? prev : { ...prev, [id]: defaultType(it) });
  }

  const selectedItems = (eligible || []).filter(x => selectedIds.includes(x.customer_invoice_item_id));

  async function submit(e) {
    e.preventDefault();
    if (selectedIds.length === 0) { setError('Select at least one invoice item to claim.'); return; }
    if (!reason.trim() || reason.trim().length < 3) { setError('Describe the problem (reason).'); return; }
    setSaving(true); setError(null);

    // One claim per selected item — registered sequentially so partial
    // failures (e.g. a duplicate open claim) don't kill the whole batch.
    const results = [];
    for (const it of selectedItems) {
      try {
        const res = await api('/api/warranty-claims', {
          method: 'POST',
          body: {
            customer_invoice_item_id: it.customer_invoice_item_id,
            claim_type: typeChoice[it.customer_invoice_item_id] || defaultType(it),
            current_km: currentKm !== '' ? parseInt(currentKm, 10) : null,
            reason: reason.trim(),
          },
        });
        results.push({ ok: true, item: res.item });
      } catch (err) {
        results.push({ ok: false, error: err.message, name: it.description });
      }
    }

    // If nothing succeeded, stay in the modal so the user can fix and retry
    if (!results.some(r => r.ok)) {
      setError(results[0]?.error || 'Claim registration failed.');
      setSaving(false);
      return;
    }
    onSaved(results);
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <h3>Register Warranty Claim</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '75vh', overflowY: 'auto' }}>

          {/* Step 1 — find paid invoices */}
          <div className="form-field">
            <label>Customer Mobile <span style={{ color: '#dc2626' }}>*</span></label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="form-input" style={{ flex: 1 }} placeholder="e.g. 9876543210"
                value={mobile} onChange={e => setMobile(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search(); } }} />
              <button type="button" className="btn btn-primary" onClick={search} disabled={searching}>
                <Search size={14} /> {searching ? 'Searching…' : 'Find'}
              </button>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Shows paid invoices whose line items carry a warranty
            </span>
          </div>

          {/* Step 2 — pick the item */}
          {eligible !== null && (
            eligible.length === 0 ? (
              <div style={{ padding: '14px 16px', background: '#fef2f2', borderRadius: 8, fontSize: 13, color: '#991b1b' }}>
                No claimable items found — either no paid invoices for this mobile, or none of their items carry a warranty.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>Select the item(s) being claimed</label>
                  {selectedIds.length > 0 && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)' }}>
                      {selectedIds.length} selected
                    </span>
                  )}
                </div>
                {eligible.map(it => {
                  const wOpen = !!it.open_warranty_claim_id;
                  const gOpen = !!it.open_guarantee_claim_id;
                  // Fully blocked only when every available promise already has an open claim
                  const blocked = (!it.has_warranty || wOpen) && (!it.has_guarantee || gOpen);
                  const meta = VALIDITY_META[(it.precheck || it.precheck_guarantee)?.validation] || VALIDITY_META.manual;
                  const isOn = selectedIds.includes(it.customer_invoice_item_id);
                  return (
                    <button key={it.customer_invoice_item_id} type="button"
                      disabled={blocked}
                      onClick={() => toggleItem(it)}
                      style={{
                        textAlign: 'left', padding: '10px 14px', borderRadius: 8, cursor: blocked ? 'not-allowed' : 'pointer',
                        border: `1.5px solid ${isOn ? 'var(--primary)' : 'var(--border)'}`,
                        background: isOn ? 'var(--primary-light, #eff6ff)' : 'transparent',
                        opacity: blocked ? 0.55 : 1, display: 'flex', gap: 10,
                      }}>
                      {/* Checkbox indicator */}
                      <div style={{
                        width: 17, height: 17, borderRadius: 4, flexShrink: 0, marginTop: 1,
                        border: `1.5px solid ${isOn ? 'var(--primary)' : 'var(--border)'}`,
                        background: isOn ? 'var(--primary)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {isOn && <CheckCircle2 size={12} style={{ color: '#fff' }} />}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{it.description}</span>
                          <Badge meta={meta} />
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          Invoice #{it.customer_invoice_id} · {it.hub_name || 'No hub'} · Serviced {fmtDate(it.service_date)}
                          {it.service_odometer_km != null && <> at {Number(it.service_odometer_km).toLocaleString('en-IN')} km</>}
                        </div>
                        {it.has_warranty && (
                          <div style={{ fontSize: 12, color: '#166534', fontWeight: 500 }}>
                            🛡 Warranty: {warrantyLabel(it)}{wOpen && <span style={{ color: '#dc2626' }}> — open claim exists</span>}
                          </div>
                        )}
                        {it.has_guarantee && (
                          <div style={{ fontSize: 12, color: '#3730a3', fontWeight: 500 }}>
                            ✔ Guarantee: {guaranteeLabelOf(it)}{gOpen && <span style={{ color: '#dc2626' }}> — open claim exists</span>}
                          </div>
                        )}
                        {blocked && (
                          <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>
                            Open claims already exist for every promise on this item
                          </div>
                        )}
                        {/* Per-item promise picker — only when both are claimable */}
                        {isOn && it.has_warranty && it.has_guarantee && !wOpen && !gOpen && (
                          <div style={{ display: 'flex', gap: 6, marginTop: 2 }} onClick={e => e.stopPropagation()}>
                            {[['warranty', '🛡 Claim warranty'], ['guarantee', '✔ Claim guarantee']].map(([v, l]) => (
                              <span key={v} role="button"
                                onClick={(e) => { e.stopPropagation(); setTypeChoice(p => ({ ...p, [it.customer_invoice_item_id]: v })); }}
                                style={{
                                  fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 99, cursor: 'pointer',
                                  border: `1.5px solid ${(typeChoice[it.customer_invoice_item_id] || defaultType(it)) === v ? 'var(--primary)' : 'var(--border)'}`,
                                  background: (typeChoice[it.customer_invoice_item_id] || defaultType(it)) === v ? '#fff' : 'transparent',
                                }}>
                                {l}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          )}

          {/* Step 3 — claim details (shared across all selected items) */}
          {selectedItems.length > 0 && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-field">
                  <label>
                    Current Odometer (KM)
                    {selectedItems.some(it => (typeChoice[it.customer_invoice_item_id] || defaultType(it)) === 'guarantee' ? it.guarantee_km != null : it.warranty_km != null) && <span style={{ color: '#dc2626' }}> *</span>}
                  </label>
                  <input className="form-input" type="number" min="0" step="1"
                    placeholder="Reading now — applies to all selected items"
                    value={currentKm} onChange={e => setCurrentKm(e.target.value)} />
                  {selectedItems.some(it => it.service_odometer_km == null && (it.warranty_km != null || it.guarantee_km != null)) && (
                    <span style={{ fontSize: 11, color: '#92400e' }}>
                      Some items have no odometer recorded at service time — their KM check will need manual judgment.
                    </span>
                  )}
                </div>
                <div className="form-field">
                  <label>Claiming</label>
                  <div style={{
                    padding: '9px 12px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                    background: 'var(--bg-soft, #f8fafc)', border: '1px solid var(--border)',
                    maxHeight: 84, overflowY: 'auto',
                  }}>
                    {selectedItems.map(it => (
                      <div key={it.customer_invoice_item_id} style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {(typeChoice[it.customer_invoice_item_id] || defaultType(it)) === 'guarantee' ? '✔' : '🛡'} {it.description}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="form-field">
                <label>Problem / Reason <span style={{ color: '#dc2626' }}>*</span> <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(shared by all selected items)</span></label>
                <textarea className="form-input" rows={3} style={{ resize: 'vertical' }}
                  placeholder="What went wrong? e.g. AC stopped cooling again within 2 weeks of service"
                  value={reason} onChange={e => setReason(e.target.value)} />
              </div>
            </>
          )}

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#dc2626', fontSize: 13, background: '#fef2f2', padding: '10px 14px', borderRadius: 8 }}>
              <AlertCircle size={14} style={{ flexShrink: 0 }} /> {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || selectedIds.length === 0}>
              {saving
                ? 'Registering…'
                : selectedIds.length > 1
                  ? `Register ${selectedIds.length} Claims`
                  : 'Register Claim'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Approve modal ─────────────────────────────────────────────────────────────
function ApproveModal({ claim, onClose, onDone }) {
  useEscapeClose(onClose);
  const [resolutionType, setResolutionType] = useState('free_redo');
  const [chargePct, setChargePct] = useState('');
  const [costBearer, setCostBearer] = useState('hub');
  const [confirmExpired, setConfirmExpired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const isExpired = claim.validation === 'expired';

  async function submit(e) {
    e.preventDefault();
    if (resolutionType === 'discounted_redo' && (chargePct === '' || parseFloat(chargePct) <= 0)) {
      setError('Enter the % the customer will pay.'); return;
    }
    if (isExpired && !confirmExpired) {
      setError('This claim is expired — tick the goodwill confirmation to approve anyway.'); return;
    }
    setSaving(true); setError(null);
    try {
      const res = await api(`/api/warranty-claims/${claim.id}/approve`, {
        method: 'POST',
        body: {
          resolution_type: resolutionType,
          redo_charge_percent: resolutionType === 'discounted_redo' ? parseFloat(chargePct) : 0,
          cost_bearer: costBearer,
          confirm_expired: confirmExpired,
        },
      });
      onDone(res.item, 'Claim approved.');
    } catch (err) {
      setError(err.message || 'Approval failed.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h3>Approve Claim {claim.claim_code}</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {isExpired && (
            <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 13, color: '#991b1b' }}>
              <strong>This claim is EXPIRED.</strong> Approving it is a goodwill gesture.
            </div>
          )}

          <div className="form-field">
            <label>Resolution</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { v: 'free_redo',       l: 'Free redo — customer pays nothing' },
                { v: 'discounted_redo', l: 'Discounted redo — customer pays a % of original price' },
                { v: 'no_action',       l: 'No action — approve on record only, no redo job' },
              ].map(o => (
                <label key={o.v} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input type="radio" name="rt" checked={resolutionType === o.v} onChange={() => setResolutionType(o.v)} />
                  {o.l}
                </label>
              ))}
            </div>
          </div>

          {resolutionType === 'discounted_redo' && (
            <div className="form-field">
              <label>Customer pays (% of original price) <span style={{ color: '#dc2626' }}>*</span></label>
              <input className="form-input" type="number" min="1" max="100" step="1" placeholder="e.g. 50"
                value={chargePct} onChange={e => setChargePct(e.target.value)} />
            </div>
          )}

          <div className="form-field">
            <label>Who bears the redo cost?</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="radio" name="cb" checked={costBearer === 'hub'} onChange={() => setCostBearer('hub')} style={{ marginTop: 2 }} />
                <span><strong>Hub</strong> — faulty work: the redo Purchase Invoice pays the hub ₹0</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="radio" name="cb" checked={costBearer === 'company'} onChange={() => setCostBearer('company')} style={{ marginTop: 2 }} />
                <span><strong>Company</strong> — goodwill: the hub is paid its normal rate on the original price</span>
              </label>
            </div>
          </div>

          {isExpired && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', fontWeight: 600, color: '#991b1b' }}>
              <input type="checkbox" checked={confirmExpired} onChange={e => setConfirmExpired(e.target.checked)} />
              I confirm approving this EXPIRED claim as goodwill
            </label>
          )}

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#dc2626', fontSize: 13, background: '#fef2f2', padding: '10px 14px', borderRadius: 8 }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Approving…' : 'Approve Claim'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Reject modal ──────────────────────────────────────────────────────────────
function RejectModal({ claim, onClose, onDone }) {
  useEscapeClose(onClose);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!reason.trim() || reason.trim().length < 3) { setError('Give the customer-facing rejection reason.'); return; }
    setSaving(true); setError(null);
    try {
      const res = await api(`/api/warranty-claims/${claim.id}/reject`, {
        method: 'POST', body: { rejection_reason: reason.trim() },
      });
      onDone(res.item, 'Claim rejected.');
    } catch (err) {
      setError(err.message || 'Rejection failed.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <h3>Reject Claim {claim.claim_code}</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-field">
            <label>Rejection Reason <span style={{ color: '#dc2626' }}>*</span></label>
            <textarea className="form-input" rows={3} style={{ resize: 'vertical' }}
              placeholder="e.g. Damage caused by accident, not covered under service warranty"
              value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#dc2626', fontSize: 13, background: '#fef2f2', padding: '10px 14px', borderRadius: 8 }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-danger" disabled={saving}>
              {saving ? 'Rejecting…' : 'Reject Claim'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// A small clickable chip that deep-links to another module via public token.
function LinkChip({ label, to, navigate, status }) {
  if (!to) return null;
  return (
    <button type="button" onClick={() => navigate(to)}
      title={`Open ${label}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 99,
        background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe',
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
      {label}
      {status && <span style={{ fontWeight: 500, color: '#3b82f6' }}>· {status.replace(/_/g, ' ')}</span>}
      <ChevronRight size={12} />
    </button>
  );
}

// ── Detail modal ──────────────────────────────────────────────────────────────
function DetailModal({ claim, onClose, onAction, canDecide, canResolve, canCreate }) {
  useEscapeClose(onClose);
  const navigate = useNavigate();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const sMeta = STATUS_META[claim.status] || STATUS_META.registered;
  const vMeta = VALIDITY_META[claim.validation] || VALIDITY_META.manual;

  async function doPost(path, successMsg) {
    setWorking(true); setError(null);
    try {
      const res = await api(`/api/warranty-claims/${claim.id}/${path}`, { method: 'POST', body: {} });
      onAction(res.item, successMsg);
    } catch (err) {
      setError(err.message || 'Action failed.');
      setWorking(false);
    }
  }

  const kmUsed = claim.current_km != null && claim.service_odometer_km != null
    ? claim.current_km - claim.service_odometer_km : null;

  const row = (label, value) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  );

  const check = (v) => v === true
    ? <span style={{ color: '#16a34a', fontWeight: 700 }}>✓ within limit</span>
    : v === false
      ? <span style={{ color: '#dc2626', fontWeight: 700 }}>✗ exceeded</span>
      : <span style={{ color: '#92400e', fontWeight: 600 }}>manual check</span>;

  return (
    <div className="modal-backdrop">
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {claim.claim_code || `Claim #${claim.id}`} <Badge meta={sMeta} /> <Badge meta={vMeta} />
          </h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ padding: '18px 24px', maxHeight: '72vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div>
            {row('Customer', `${claim.customer_name || '—'} · ${claim.mobile || ''}`)}
            {row('Vehicle', claim.vehicle_number || '—')}
            {row('Claim Type', `${(CLAIM_TYPE_META[claim.claim_type] || CLAIM_TYPE_META.warranty).icon} ${(CLAIM_TYPE_META[claim.claim_type] || CLAIM_TYPE_META.warranty).label}`)}
            {row('Item', claim.item_description || '—')}
            {row('Original Invoice', claim.ci_public_token
              ? <LinkChip label={`CI-${String(claim.customer_invoice_id).padStart(6, '0')}`} to={`/customer-invoices/${claim.ci_public_token}`} navigate={navigate} />
              : `#${claim.customer_invoice_id}`)}
            {row('Hub (original work)', claim.hub_name || '—')}
            {row(claim.claim_type === 'guarantee' ? 'Guarantee' : 'Warranty', warrantyLabel(claim))}
            {row('Serviced on', `${fmtDate(claim.service_date)}${claim.service_odometer_km != null ? ` at ${Number(claim.service_odometer_km).toLocaleString('en-IN')} km` : ''}`)}
            {row('Claimed on', `${fmtDate(claim.claim_date)}${claim.current_km != null ? ` at ${Number(claim.current_km).toLocaleString('en-IN')} km` : ''}`)}
            {kmUsed != null && row('KM since service', `${kmUsed.toLocaleString('en-IN')} km`)}
            {row('Time check', check(claim.within_time))}
            {row('KM check', check(claim.within_km))}
            {row('Registered by', claim.created_by_name || '—')}
          </div>

          <div style={{ background: 'var(--bg-soft, #f8fafc)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
            <strong>Reason:</strong> {claim.reason}
          </div>

          {claim.status === 'rejected' && claim.rejection_reason && (
            <div style={{ background: '#fef2f2', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#991b1b' }}>
              <strong>Rejected{claim.decided_by_name ? ` by ${claim.decided_by_name}` : ''}:</strong> {claim.rejection_reason}
            </div>
          )}

          {['approved', 'resolved'].includes(claim.status) && (
            <div style={{ background: '#eff6ff', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#1e40af', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div>
                <strong>Approved{claim.decided_by_name ? ` by ${claim.decided_by_name}` : ''}:</strong>{' '}
                {claim.resolution_type === 'free_redo' && 'Free redo'}
                {claim.resolution_type === 'discounted_redo' && `Discounted redo — customer pays ${parseFloat(claim.redo_charge_percent)}%`}
                {claim.resolution_type === 'no_action' && 'No action (recorded only)'}
                {' · '}cost borne by <strong>{claim.cost_bearer === 'hub' ? 'Hub' : 'Company'}</strong>
              </div>
              {claim.redo_appointment_id && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600 }}>Redo job:</span>
                  <LinkChip
                    label={claim.redo_appointment_code || `Appointment #${claim.redo_appointment_id}`}
                    to={claim.redo_appointment_token ? `/appointments/${claim.redo_appointment_token}` : null}
                    navigate={navigate}
                  />
                  <LinkChip
                    label={`Estimate #${claim.redo_estimate_id}`}
                    to={claim.redo_estimate_token ? `/estimates/${claim.redo_estimate_token}` : null}
                    navigate={navigate}
                    status={claim.redo_estimate_status}
                  />
                  <LinkChip
                    label={`PI-${claim.redo_purchase_invoice_id ? String(claim.redo_purchase_invoice_id).padStart(6, '0') : ''}`}
                    to={claim.redo_purchase_invoice_token ? `/purchase-invoices/${claim.redo_purchase_invoice_token}` : null}
                    navigate={navigate}
                    status={claim.redo_purchase_invoice_status}
                  />
                  <LinkChip
                    label={`CI-${claim.redo_customer_invoice_id ? String(claim.redo_customer_invoice_id).padStart(6, '0') : ''}`}
                    to={claim.redo_customer_invoice_token ? `/customer-invoices/${claim.redo_customer_invoice_token}` : null}
                    navigate={navigate}
                    status={claim.redo_customer_invoice_status}
                  />
                </div>
              )}
            </div>
          )}

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#dc2626', fontSize: 13, background: '#fef2f2', padding: '10px 14px', borderRadius: 8 }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {claim.status === 'registered' && canDecide && (
              <button className="btn btn-ghost" disabled={working} onClick={() => doPost('review', 'Claim moved to review.')}>
                <Eye size={14} /> Start Review
              </button>
            )}
            {['registered', 'under_review'].includes(claim.status) && canCreate && (
              <button className="btn btn-ghost" disabled={working} onClick={() => doPost('cancel', 'Claim cancelled.')}>
                Cancel Claim
              </button>
            )}
            {['registered', 'under_review'].includes(claim.status) && canDecide && (
              <>
                <button className="btn btn-danger" disabled={working} onClick={() => onAction(null, null, 'reject')}>
                  <XCircle size={14} /> Reject
                </button>
                <button className="btn btn-primary" disabled={working} onClick={() => onAction(null, null, 'approve')}>
                  <CheckCircle2 size={14} /> Approve
                </button>
              </>
            )}
            {claim.status === 'approved' && !claim.redo_appointment_id
              && claim.resolution_type !== 'no_action' && canResolve && (
              <button className="btn btn-primary" disabled={working} onClick={() => doPost('create-redo', 'Redo job created — see Appointments & Estimates.')}>
                <Wrench size={14} /> {working ? 'Creating…' : 'Create Redo Job'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Analytics panel ───────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ flex: '1 1 130px', background: 'var(--bg-soft, #f8fafc)', borderRadius: 10, padding: '12px 16px' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--text)' }}>{value ?? '—'}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function AnalyticsPanel() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/warranty-claims/stats')
      .then(setStats)
      .catch(err => setError(err.message || 'Failed to load analytics.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Loading analytics…</div>;
  if (error)   return <div className="card" style={{ padding: 24, textAlign: 'center', color: '#dc2626' }}>{error}</div>;
  if (!stats)  return null;

  const s = stats.summary || {};
  const maxMonthly = Math.max(1, ...(stats.monthly || []).map(m => m.claims));
  const fmtMonth = (ym) => new Date(`${ym}-01`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  const fmtMoney = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="Total claims" value={s.total} />
        <StatCard label="Open" value={s.open} color="#92400e" />
        <StatCard label="Resolved" value={s.resolved} color="#16a34a" />
        <StatCard label="Rejected" value={s.rejected} color="#dc2626" />
        <StatCard label="Approval rate" value={s.approval_rate != null ? `${s.approval_rate}%` : '—'} sub="of decided claims" />
        <StatCard label="Avg decision time" value={s.avg_decision_days != null ? `${s.avg_decision_days}d` : '—'} />
        <StatCard label="Goodwill approvals" value={s.goodwill_approvals} sub="expired but approved" color="#92400e" />
        <StatCard label="Cost bearer" value={`${s.borne_by_hub || 0} / ${s.borne_by_company || 0}`} sub="hub / company" />
      </div>

      {/* Monthly trend */}
      {(stats.monthly || []).length > 0 && (
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Claims per month (last 12 months)</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 110 }}>
            {stats.monthly.map(m => (
              <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}
                title={`${fmtMonth(m.month)}: ${m.claims} claim${m.claims !== 1 ? 's' : ''}, ${m.approved} approved`}>
                <span style={{ fontSize: 11, fontWeight: 600 }}>{m.claims}</span>
                <div style={{
                  width: '70%', maxWidth: 40, borderRadius: '4px 4px 0 0',
                  height: `${Math.max(4, m.claims / maxMonthly * 70)}px`,
                  background: 'var(--primary, #2563eb)', opacity: 0.85,
                }} />
                <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtMonth(m.month)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        {/* By service */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ fontSize: 13, fontWeight: 700, padding: '14px 18px 8px' }}>Claim rate by service</div>
          <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead><tr><th>Service</th><th style={{ textAlign: 'right' }}>Sold</th><th style={{ textAlign: 'right' }}>Claims</th><th style={{ textAlign: 'right' }}>Rate</th></tr></thead>
            <tbody>
              {(stats.by_service || []).length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No service claims yet.</td></tr>
              ) : stats.by_service.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 13, fontWeight: 500 }}>{r.service_name}</td>
                  <td style={{ textAlign: 'right', fontSize: 13 }}>{r.times_sold ?? '—'}</td>
                  <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{r.claims}</td>
                  <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 700,
                    color: r.claim_rate_pct != null && parseFloat(r.claim_rate_pct) >= 10 ? '#dc2626' : 'inherit' }}>
                    {r.claim_rate_pct != null ? `${r.claim_rate_pct}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        {/* By hub */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ fontSize: 13, fontWeight: 700, padding: '14px 18px 8px' }}>Claims by hub</div>
          <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead><tr><th>Hub</th><th style={{ textAlign: 'right' }}>Claims</th><th style={{ textAlign: 'right' }}>Resolved</th><th style={{ textAlign: 'right' }}>Hub / Co.</th><th style={{ textAlign: 'right' }}>Redo value</th></tr></thead>
            <tbody>
              {(stats.by_hub || []).length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>No claims yet.</td></tr>
              ) : stats.by_hub.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 13, fontWeight: 500 }}>{r.hub_name || '—'}</td>
                  <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{r.claims}</td>
                  <td style={{ textAlign: 'right', fontSize: 13 }}>{r.resolved}</td>
                  <td style={{ textAlign: 'right', fontSize: 13 }} title="Redo cost borne by hub / by company">
                    {r.borne_by_hub} / {r.borne_by_company}
                  </td>
                  <td style={{ textAlign: 'right', fontSize: 13 }} title="Full-price value of approved/resolved claimed items">
                    {fmtMoney(r.redo_value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ClaimsPage() {
  const navigate   = useNavigate();
  const canCreate  = useCan('CREATE_CLAIM',  'MANAGE_CLAIMS');
  const canDecide  = useCan('APPROVE_CLAIM', 'MANAGE_CLAIMS');
  const canResolve = useCan('RESOLVE_CLAIM', 'MANAGE_CLAIMS');

  const [items, setItems]     = useState([]);
  const [counts, setCounts]   = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [filterStatus, setFilterStatus]     = useState('');
  const [filterValidity, setFilterValidity] = useState('');

  const [modal, setModal] = useState(null); // { mode: 'register'|'detail'|'approve'|'reject', claim }
  const [toast, setToast] = useState(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const showToast = (msg, type = 'success') => setToast({ msg, type });

  // Deep links from CustomerInvoicesPage:
  //   ?register_mobile=98…  → open the register modal, mobile pre-filled
  //   ?claim=123            → open that claim's detail directly
  const location = useLocation();
  const [prefillMobile, setPrefillMobile] = useState(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const m = params.get('register_mobile');
    if (m && canCreate) {
      setPrefillMobile(m);
      setModal({ mode: 'register' });
      return;
    }
    const claimId = params.get('claim');
    if (claimId) {
      api(`/api/warranty-claims/${claimId}`)
        .then(r => { if (r.item) setModal({ mode: 'detail', claim: r.item }); })
        .catch(() => showToast('Claim not found.', 'error'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search)         params.set('search', search);
      if (filterStatus)   params.set('status', filterStatus);
      if (filterValidity) params.set('validation', filterValidity);
      const r = await api(`/api/warranty-claims?${params}`);
      setItems(r.items || []);
      setCounts(r.status_counts || {});
    } catch (err) {
      showToast(err.message || 'Failed to load claims.', 'error');
    } finally {
      setLoading(false);
    }
  }, [search, filterStatus, filterValidity]);

  useEffect(() => { load(); }, [load]);
  useSync('warranty_claims', load);

  function upsert(saved) {
    setItems(prev => {
      const exists = prev.find(x => x.id === saved.id);
      return exists ? prev.map(x => x.id === saved.id ? saved : x) : [saved, ...prev];
    });
  }

  // Callback shared by detail/approve/reject modals
  function handleAction(saved, msg, switchTo) {
    if (switchTo) {
      // Detail modal asked to open a decision modal for the same claim
      setModal(m => ({ mode: switchTo, claim: m.claim }));
      return;
    }
    if (saved) { upsert(saved); if (msg) showToast(msg); setModal({ mode: 'detail', claim: saved }); }
  }

  const openTotal = (counts.registered || 0) + (counts.under_review || 0) + (counts.approved || 0);

  return (
    <div className="discount-page">
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ShieldAlert size={22} style={{ color: 'var(--primary)' }} />
          <div>
            <h2 style={{ margin: 0 }}>Claims</h2>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-muted)' }}>
              Register warranty &amp; guarantee claims against paid invoices, validate them, and spin up redo jobs
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => setShowAnalytics(v => !v)}>
            <BarChart3 size={15} /> {showAnalytics ? 'Hide Analytics' : 'Analytics'}
          </button>
          {canCreate && (
            <button className="btn btn-primary" onClick={() => setModal({ mode: 'register' })}>
              <Plus size={16} /> Register Claim
            </button>
          )}
        </div>
      </div>

      {showAnalytics && <AnalyticsPanel />}

      {/* Filters */}
      <div className="card" style={{ padding: '14px 18px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 0 }}>
        <div style={{ position: 'relative', flex: '1 1 220px' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="form-input" style={{ paddingLeft: 32 }}
            placeholder="Search code / customer / vehicle / item…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="form-input" style={{ width: 170 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All statuses ({Object.values(counts).reduce((a, b) => a + b, 0)})</option>
          <option value="registered">Registered ({counts.registered || 0})</option>
          <option value="under_review">Under Review ({counts.under_review || 0})</option>
          <option value="approved">Approved ({counts.approved || 0})</option>
          <option value="resolved">Resolved ({counts.resolved || 0})</option>
          <option value="rejected">Rejected ({counts.rejected || 0})</option>
          <option value="cancelled">Cancelled ({counts.cancelled || 0})</option>
        </select>
        <select className="form-input" style={{ width: 150 }} value={filterValidity} onChange={e => setFilterValidity(e.target.value)}>
          <option value="">All validity</option>
          <option value="valid">Valid</option>
          <option value="expired">Expired</option>
          <option value="manual">Manual check</option>
        </select>
        <button className="btn btn-ghost" onClick={load} title="Refresh" style={{ flexShrink: 0 }}>
          <RefreshCw size={15} />
        </button>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Claim</th>
              <th>Customer</th>
              <th>Item</th>
              <th>Invoice</th>
              <th>Warranty</th>
              <th>Validity</th>
              <th>Status</th>
              <th>Hub</th>
              <th>Claimed</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                No claims found.{openTotal === 0 && ' Register the first one when a customer comes back with an issue.'}
              </td></tr>
            ) : items.map(c => (
              <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setModal({ mode: 'detail', claim: c })}>
                <td style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>
                  {(CLAIM_TYPE_META[c.claim_type] || CLAIM_TYPE_META.warranty).icon} {c.claim_code || `#${c.id}`}
                  <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-muted)' }}>
                    {(CLAIM_TYPE_META[c.claim_type] || CLAIM_TYPE_META.warranty).label}
                  </div>
                </td>
                <td style={{ fontSize: 13 }}>
                  <div style={{ fontWeight: 500 }}>{c.customer_name || '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.mobile} {c.vehicle_number ? `· ${c.vehicle_number}` : ''}</div>
                </td>
                <td style={{ fontSize: 13, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.item_description}>
                  {c.item_description || '—'}
                </td>
                <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {c.customer_invoice_id ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (c.ci_public_token) navigate(`/customer-invoices/${c.ci_public_token}`);
                      }}
                      title="Open the original customer invoice"
                      style={{
                        fontWeight: 700, fontSize: 11, padding: '2px 8px', borderRadius: 99,
                        background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe',
                        cursor: c.ci_public_token ? 'pointer' : 'default', whiteSpace: 'nowrap',
                      }}
                    >
                      CI-{String(c.customer_invoice_id).padStart(6, '0')}
                    </button>
                  ) : '—'}
                </td>
                <td style={{ fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={warrantyLabel(c)}>
                  {warrantyLabel(c)}
                </td>
                <td><Badge meta={VALIDITY_META[c.validation] || VALIDITY_META.manual} /></td>
                <td><Badge meta={STATUS_META[c.status] || STATUS_META.registered} /></td>
                <td style={{ fontSize: 13 }}>{c.hub_name || '—'}</td>
                <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{fmtDate(c.claim_date)}</td>
                <td><ChevronRight size={15} style={{ color: 'var(--text-muted)' }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* Modals */}
      {modal?.mode === 'register' && (
        <RegisterModal
          prefillMobile={prefillMobile}
          onClose={() => setModal(null)}
          onSaved={(results) => {
            const ok = results.filter(r => r.ok);
            ok.forEach(r => upsert(r.item));
            const failed = results.filter(r => !r.ok);
            if (ok.length === 0) {
              showToast(failed[0]?.error || 'Claim registration failed.', 'error');
              return; // keep the modal open so the user can retry
            }
            if (failed.length > 0) {
              showToast(`${ok.length} claim${ok.length !== 1 ? 's' : ''} registered, ${failed.length} failed (${failed.map(f => f.name).join(', ')}).`, 'error');
            } else if (ok.length === 1) {
              showToast(`Claim ${ok[0].item.claim_code} registered — verdict: ${ok[0].item.validation}.`);
            } else {
              showToast(`${ok.length} claims registered.`);
            }
            // Single claim → open its detail; batch → back to the list
            setModal(ok.length === 1 ? { mode: 'detail', claim: ok[0].item } : null);
          }}
        />
      )}
      {modal?.mode === 'detail' && (
        <DetailModal
          claim={modal.claim}
          onClose={() => setModal(null)}
          onAction={handleAction}
          canDecide={canDecide}
          canResolve={canResolve}
          canCreate={canCreate}
        />
      )}
      {modal?.mode === 'approve' && (
        <ApproveModal claim={modal.claim} onClose={() => setModal({ mode: 'detail', claim: modal.claim })} onDone={handleAction} />
      )}
      {modal?.mode === 'reject' && (
        <RejectModal claim={modal.claim} onClose={() => setModal({ mode: 'detail', claim: modal.claim })} onDone={handleAction} />
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
