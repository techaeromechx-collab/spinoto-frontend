import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api/client.js';
import useSync from '../hooks/useSync.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import { useCan } from '../auth/AuthContext.jsx';
import {
  Plus, Pencil, Trash2, X, Search, RefreshCw,
  AlertCircle, CheckCircle2, ToggleLeft, ToggleRight, ShieldCheck,
} from 'lucide-react';
import '../styles/DiscountMasterPage.css';

// ── Helpers ───────────────────────────────────────────────────────────────────
const APPLIES_OPTIONS = [
  { value: '',         label: 'All levels'       },
  { value: 'category', label: 'Service Category' },
  { value: 'service',  label: 'Service'          },
  { value: 'part',     label: 'Part'             },
];

const APPLIES_BADGE = {
  category: { bg: '#ede9fe', color: '#5b21b6', label: 'Category' },
  service:  { bg: '#dbeafe', color: '#1e40af', label: 'Service'  },
  part:     { bg: '#dcfce7', color: '#166534', label: 'Part'     },
};

function AppliesBadge({ v }) {
  const m = APPLIES_BADGE[v] || { bg: '#f3f4f6', color: '#374151', label: v };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 99,
      fontSize: 11, fontWeight: 700, background: m.bg, color: m.color,
    }}>{m.label}</span>
  );
}

const TYPE_META = {
  warranty:  { bg: '#d1fae5', color: '#065f46', label: '🛡 Warranty'  },
  guarantee: { bg: '#e0e7ff', color: '#3730a3', label: '✔ Guarantee' },
};

function TypeBadge({ v }) {
  const m = TYPE_META[v] || TYPE_META.warranty;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 99,
      fontSize: 11, fontWeight: 700, background: m.bg, color: m.color, whiteSpace: 'nowrap',
    }}>{m.label}</span>
  );
}

// Build the customer-facing label from the duration fields.
// Mirrors warrantyLabel() in warranty_master.controller.js.
function warrantyLabel(w) {
  if (w.is_exclusion) return '🚫 No coverage (excluded)';
  if (w.custom_text) return w.custom_text;
  const parts = [];
  if (w.duration_months) parts.push(`${w.duration_months} Month${w.duration_months > 1 ? 's' : ''}`);
  if (w.duration_days)   parts.push(`${w.duration_days} Day${w.duration_days > 1 ? 's' : ''}`);
  if (w.duration_km)     parts.push(`${Number(w.duration_km).toLocaleString('en-IN')} KM`);
  if (parts.length === 0) return '—';
  return parts.length > 1 ? `${parts.join(' / ')} (whichever is earlier)` : parts[0];
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isExpired(d) {
  if (!d) return false;
  return new Date(d) < new Date(new Date().toDateString());
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [msg, onClose]);
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

// ── Delete confirm ────────────────────────────────────────────────────────────
function DeleteModal({ item, onClose, onConfirm, loading }) {
  useEscapeClose(onClose);
  return (
    <div className="modal-backdrop">
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h3>Delete Warranty</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ padding: '20px 24px' }}>
          <p style={{ margin: '0 0 8px', fontSize: 14 }}>
            Are you sure you want to delete <strong>"{item.name}"</strong>? This cannot be undone.
          </p>
          <p style={{ margin: '0 0 20px', fontSize: 12, color: 'var(--text-muted)' }}>
            Warranties already stamped on existing estimates and invoices are not affected.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
            <button className="btn btn-danger" onClick={onConfirm} disabled={loading}>
              {loading ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Add / Edit modal ──────────────────────────────────────────────────────────
function WarrantyModal({ item, vehicleTypes, onClose, onSave }) {
  useEscapeClose(onClose);
  const isEdit = !!item?.id;

  const [form, setForm] = useState({
    name:            item?.name            || '',
    promise_type:    item?.promise_type    || 'warranty',
    applies_to:      item?.applies_to      || 'service',
    ref_id:          item?.ref_id          ?? '',
    vehicle_type_id: item?.vehicle_type_id ?? '',
    duration_months: item?.duration_months ?? '',
    duration_days:   item?.duration_days   ?? '',
    duration_km:     item?.duration_km     ?? '',
    custom_text:     item?.custom_text     || '',
    is_exclusion:    item?.is_exclusion    ?? false,
    valid_from:      item?.valid_from      ? item.valid_from.slice(0, 10)  : new Date().toISOString().slice(0, 10),
    valid_until:     item?.valid_until     ? item.valid_until.slice(0, 10) : '',
    is_active:       item?.is_active       ?? true,
  });

  const [refOptions,  setRefOptions]  = useState([]);
  const [refSearch,   setRefSearch]   = useState(item?.ref_name || '');
  const [refDropOpen, setRefDropOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);
  const nameRef    = useRef(null);
  const refWrapRef = useRef(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  // Load ref options whenever applies_to changes
  useEffect(() => {
    async function loadOptions() {
      try {
        if (form.applies_to === 'category') {
          const r = await api('/api/services/categories');
          setRefOptions((r.items || r.categories || []).map(x => ({ id: x.id, label: x.name })));
        } else if (form.applies_to === 'service') {
          const r = await api('/api/services/services');
          setRefOptions((r.items || r.services || []).map(x => ({ id: x.id, label: `${x.name}${x.category_name ? ' — ' + x.category_name : ''}` })));
        } else if (form.applies_to === 'part') {
          const r = await api('/api/parts');
          setRefOptions((r.items || r.parts || []).map(x => ({ id: x.id, label: x.name })));
        }
      } catch {
        setRefOptions([]);
      }
    }
    loadOptions();
  }, [form.applies_to]);

  const field = (key) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm(f => ({ ...f, [key]: val }));
  };

  // Close ref dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (refWrapRef.current && !refWrapRef.current.contains(e.target)) setRefDropOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const changeAppliesTo = (e) => {
    setForm(f => ({ ...f, applies_to: e.target.value, ref_id: '' }));
    setRefSearch('');
    setRefDropOpen(false);
  };

  const selectRef = (opt) => {
    setForm(f => ({ ...f, ref_id: opt.id }));
    setRefSearch(opt.label);
    setRefDropOpen(false);
  };

  const filteredRefOptions = refOptions.filter(o =>
    o.label.toLowerCase().includes(refSearch.toLowerCase())
  );

  // Live preview of what the customer will see
  const preview = warrantyLabel({
    duration_months: form.duration_months ? parseInt(form.duration_months, 10) : null,
    duration_days:   form.duration_days   ? parseInt(form.duration_days,   10) : null,
    duration_km:     form.duration_km     ? parseInt(form.duration_km,     10) : null,
    custom_text:     form.custom_text.trim() || null,
  });

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (!form.ref_id)      { setError('Please select a target item.'); return; }
    if (!form.is_exclusion && !form.duration_months && !form.duration_days && !form.duration_km && !form.custom_text.trim()) {
      setError('Set at least one of months, days, KM, or custom text — or mark it as an exclusion.'); return;
    }

    setSaving(true); setError(null);
    try {
      const payload = {
        name:            form.name.trim(),
        promise_type:    form.promise_type,
        applies_to:      form.applies_to,
        ref_id:          parseInt(form.ref_id, 10),
        vehicle_type_id: form.vehicle_type_id ? parseInt(form.vehicle_type_id, 10) : null,
        is_exclusion:    form.is_exclusion,
        duration_months: !form.is_exclusion && form.duration_months ? parseInt(form.duration_months, 10) : null,
        duration_days:   !form.is_exclusion && form.duration_days   ? parseInt(form.duration_days,   10) : null,
        duration_km:     !form.is_exclusion && form.duration_km     ? parseInt(form.duration_km,     10) : null,
        custom_text:     !form.is_exclusion ? (form.custom_text.trim() || null) : null,
        valid_from:      form.valid_from  || null,
        valid_until:     form.valid_until || null,
        is_active:       form.is_active,
      };
      const res = isEdit
        ? await api(`/api/warranty-master/${item.id}`, { method: 'PATCH', body: payload })
        : await api('/api/warranty-master', { method: 'POST', body: payload });
      onSave(res.item);
    } catch (err) {
      setError(err.message || 'Something went wrong.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 540, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header" style={{ flexShrink: 0 }}>
          <h3>{isEdit ? 'Edit' : 'Add'} {form.promise_type === 'guarantee' ? 'Guarantee' : 'Warranty'}</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', flex: 1 }}>

          {/* Promise type */}
          <div className="form-field">
            <label>Type <span style={{ color: '#dc2626' }}>*</span></label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { v: 'warranty',  l: '🛡 Warranty',  d: 'Repair promise' },
                { v: 'guarantee', l: '✔ Guarantee', d: 'Replacement promise' },
              ].map(o => (
                <button key={o.v} type="button"
                  onClick={() => setForm(f => ({ ...f, promise_type: o.v }))}
                  style={{
                    flex: 1, padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
                    border: `1.5px solid ${form.promise_type === o.v ? 'var(--primary)' : 'var(--border)'}`,
                    background: form.promise_type === o.v ? 'var(--primary-light, #eff6ff)' : 'transparent',
                    fontSize: 13, fontWeight: 600, textAlign: 'center',
                  }}>
                  {o.l}
                  <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', marginTop: 2 }}>{o.d}</div>
                </button>
              ))}
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              An item can carry one warranty AND one guarantee at the same time — both print on the invoice
            </span>
          </div>

          {/* Name */}
          <div className="form-field">
            <label>{form.promise_type === 'guarantee' ? 'Guarantee' : 'Warranty'} Name <span style={{ color: '#dc2626' }}>*</span></label>
            <input
              ref={nameRef}
              className="form-input"
              value={form.name}
              onChange={field('name')}
              placeholder="e.g. Standard Service Warranty, Brake Pad Warranty"
              maxLength={200}
            />
          </div>

          {/* Applies To + Ref */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 12 }}>
            <div className="form-field">
              <label>Applies To <span style={{ color: '#dc2626' }}>*</span></label>
              <select className="form-input" value={form.applies_to} onChange={changeAppliesTo}>
                <option value="category">Service Category</option>
                <option value="service">Service</option>
                <option value="part">Part</option>
              </select>
            </div>
            <div className="form-field" ref={refWrapRef} style={{ position: 'relative' }}>
              <label>
                {form.applies_to === 'category' ? 'Category' : form.applies_to === 'service' ? 'Service' : 'Part'}
                {' '}<span style={{ color: '#dc2626' }}>*</span>
              </label>
              <div style={{ position: 'relative' }}>
                <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <input
                  className="form-input"
                  style={{ paddingLeft: 30 }}
                  placeholder={`Search ${form.applies_to === 'category' ? 'category' : form.applies_to === 'service' ? 'service' : 'part'}…`}
                  value={refSearch}
                  onChange={e => { setRefSearch(e.target.value); setRefDropOpen(true); setForm(f => ({ ...f, ref_id: '' })); }}
                  onFocus={() => setRefDropOpen(true)}
                  autoComplete="off"
                />
                {refSearch && (
                  <button type="button" onClick={() => { setRefSearch(''); setForm(f => ({ ...f, ref_id: '' })); }}
                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 2 }}>
                    <X size={13} />
                  </button>
                )}
              </div>
              {refDropOpen && (
                <div className="dm-search-drop">
                  {filteredRefOptions.length === 0 ? (
                    <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--text-muted)' }}>
                      {refOptions.length === 0 ? 'Loading…' : 'No results found'}
                    </div>
                  ) : (
                    filteredRefOptions.map(o => (
                      <button key={o.id} type="button" className="dm-search-item"
                        onMouseDown={() => selectRef(o)}
                        style={{ background: form.ref_id === o.id ? '#eff6ff' : undefined }}
                      >
                        {o.label}
                        {form.ref_id === o.id && <CheckCircle2 size={13} style={{ color: '#2563eb', flexShrink: 0 }} />}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Vehicle type */}
          <div className="form-field">
            <label>
              Vehicle Type
              <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 4 }}>
                (a type-specific warranty overrides an "All types" one)
              </span>
            </label>
            <select className="form-input" value={form.vehicle_type_id} onChange={field('vehicle_type_id')}>
              <option value="">All vehicle types</option>
              {vehicleTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          {/* Exclusion toggle */}
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px',
            background: form.is_exclusion ? '#fef2f2' : 'var(--bg-soft, #f8fafc)',
            border: `1px solid ${form.is_exclusion ? '#fca5a5' : 'var(--border)'}`, borderRadius: 8,
          }}>
            <input
              type="checkbox" id="wm-exclusion"
              checked={form.is_exclusion}
              onChange={e => setForm(f => ({ ...f, is_exclusion: e.target.checked }))}
              style={{ width: 16, height: 16, cursor: 'pointer', marginTop: 2 }}
            />
            <label htmlFor="wm-exclusion" style={{ cursor: 'pointer', fontSize: 13 }}>
              <strong>🚫 Exclusion — no {form.promise_type} for this item</strong>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                Blocks a broader category-level {form.promise_type} from applying to this specific item.
                Nothing prints on the invoice and the item is not claimable under this promise.
              </div>
            </label>
          </div>

          {!form.is_exclusion && (<>
          {/* Duration */}
          <div className="form-field">
            <label>
              Warranty Duration
              <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 4 }}>
                (fill any — combined as "whichever is earlier")
              </span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <input className="form-input" type="number" min="1" step="1" placeholder="Months"
                value={form.duration_months} onChange={field('duration_months')} />
              <input className="form-input" type="number" min="1" step="1" placeholder="Days"
                value={form.duration_days} onChange={field('duration_days')} />
              <input className="form-input" type="number" min="1" step="1" placeholder="KM"
                value={form.duration_km} onChange={field('duration_km')} />
            </div>
          </div>

          {/* Custom text */}
          <div className="form-field">
            <label>
              Custom Text
              <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 4 }}>
                (optional — shown to the customer instead of the auto label)
              </span>
            </label>
            <input
              className="form-input"
              value={form.custom_text}
              onChange={field('custom_text')}
              placeholder='e.g. "1 free redo within 15 days"'
              maxLength={300}
            />
          </div>

          {/* Preview */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8,
            padding: '10px 14px', fontSize: 13,
          }}>
            <ShieldCheck size={15} style={{ color: '#16a34a', flexShrink: 0 }} />
            <span style={{ color: '#166534' }}>
              Customer sees: <strong>{preview === '—' ? 'nothing yet — set a duration above' : `${form.promise_type === 'guarantee' ? 'Guarantee' : 'Warranty'}: ${preview}`}</strong>
            </span>
          </div>
          </>)}

          {form.is_exclusion && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
              padding: '10px 14px', fontSize: 13, color: '#991b1b',
            }}>
              🚫 Customer sees: <strong>no {form.promise_type} on this item</strong> — even if its category has one
            </div>
          )}

          {/* Valid From / Until */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-field">
              <label>Valid From</label>
              <input className="form-input" type="date" value={form.valid_from} onChange={field('valid_from')} />
            </div>
            <div className="form-field">
              <label>Valid Until <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(leave blank = no expiry)</span></label>
              <input className="form-input" type="date" value={form.valid_until} onChange={field('valid_until')} />
            </div>
          </div>

          {/* Active toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={field('is_active')}
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />
              Active
            </label>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Inactive warranties won't auto-apply to new estimates
            </span>
          </div>

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#dc2626', fontSize: 13, background: '#fef2f2', padding: '10px 14px', borderRadius: 8 }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Warranty'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function WarrantyMasterPage() {
  const canCreate = useCan('CREATE_WARRANTY', 'MANAGE_WARRANTIES', 'MANAGE_MASTER_DATA');
  const canEdit   = useCan('EDIT_WARRANTY',   'MANAGE_WARRANTIES', 'MANAGE_MASTER_DATA');
  const canDelete = useCan('DELETE_WARRANTY', 'MANAGE_WARRANTIES', 'MANAGE_MASTER_DATA');
  const canWrite  = canCreate || canEdit || canDelete;

  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [filterApplies, setFilterApplies] = useState('');
  const [filterActive,  setFilterActive]  = useState('true');
  const [filterType,    setFilterType]    = useState('');
  const [vehicleTypes,  setVehicleTypes]  = useState([]);

  const [modal,    setModal]    = useState(null); // null | { mode: 'add'|'edit'|'delete', item }
  const [toast,    setToast]    = useState(null);
  const [deleting, setDeleting] = useState(false);

  const showToast = (msg, type = 'success') => setToast({ msg, type });

  useEffect(() => {
    api('/api/vehicles/types')
      .then(r => setVehicleTypes(r.items || r.types || []))
      .catch(() => setVehicleTypes([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search)        params.set('search',       search);
      if (filterApplies) params.set('applies_to',   filterApplies);
      if (filterActive)  params.set('is_active',    filterActive);
      if (filterType)    params.set('promise_type', filterType);
      const r = await api(`/api/warranty-master?${params}`);
      setItems(r.items || []);
    } catch (err) {
      showToast(err.message || 'Failed to load warranties.', 'error');
    } finally {
      setLoading(false);
    }
  }, [search, filterApplies, filterActive, filterType]);

  useEffect(() => { load(); }, [load]);
  useSync('warranties', load);

  // Optimistic delete: row disappears and the modal closes immediately;
  // on failure the row comes back with a visible rollback message.
  async function handleDelete() {
    const snapshot = items;
    const target = modal.item;
    setItems(prev => prev.filter(x => x.id !== target.id));
    setModal(null);
    setDeleting(true);
    try {
      await api(`/api/warranty-master/${target.id}`, { method: 'DELETE' });
      showToast('Warranty deleted.');
    } catch (err) {
      setItems(snapshot);
      showToast(`${err.message || 'Delete failed'} — "${target.name}" restored.`, 'error');
    } finally {
      setDeleting(false);
    }
  }

  function handleSaved(saved) {
    setItems(prev => {
      const exists = prev.find(x => x.id === saved.id);
      return exists ? prev.map(x => x.id === saved.id ? saved : x) : [saved, ...prev];
    });
    showToast(modal.mode === 'edit' ? 'Warranty updated.' : 'Warranty added.');
    setModal(null);
  }

  // Optimistic: flip instantly, reconcile with the server row on success,
  // roll back to the snapshot (with a visible message) on failure.
  async function toggleActive(item) {
    if (!canEdit) return;
    const snapshot = items;
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, is_active: !x.is_active } : x));
    try {
      const r = await api(`/api/warranty-master/${item.id}`, { method: 'PATCH', body: { is_active: !item.is_active } });
      setItems(prev => prev.map(x => x.id === item.id ? r.item : x));
    } catch (err) {
      setItems(snapshot);
      showToast(`${err.message || 'Update failed'} — change reverted.`, 'error');
    }
  }

  return (
    <div className="discount-page">
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ShieldCheck size={22} style={{ color: 'var(--primary)' }} />
          <div>
            <h2 style={{ margin: 0 }}>Warranty &amp; Guarantee Master</h2>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-muted)' }}>
              Configure warranties and guarantees by category, service or part — service overrides category, 2W/4W-specific overrides "All types"
            </p>
          </div>
        </div>
        {canCreate && (
          <button className="btn btn-primary" onClick={() => setModal({ mode: 'add', item: null })}>
            <Plus size={16} /> Add Warranty
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: '14px 18px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 0 }}>
        <div style={{ position: 'relative', flex: '1 1 220px' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="form-input"
            style={{ paddingLeft: 32 }}
            placeholder="Search warranties…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="form-input" style={{ width: 140 }} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All types</option>
          <option value="warranty">Warranty</option>
          <option value="guarantee">Guarantee</option>
        </select>
        <select className="form-input" style={{ width: 160 }} value={filterApplies} onChange={e => setFilterApplies(e.target.value)}>
          {APPLIES_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="form-input" style={{ width: 140 }} value={filterActive} onChange={e => setFilterActive(e.target.value)}>
          <option value="">All status</option>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
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
              <th>Name</th>
              <th>Type</th>
              <th>Applies To</th>
              <th>Target</th>
              <th>Vehicle Type</th>
              <th>Coverage</th>
              <th>Valid From</th>
              <th>Valid Until</th>
              <th>Status</th>
              {canWrite && <th style={{ textAlign: 'center' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={canWrite ? 10 : 9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={canWrite ? 10 : 9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No warranties found.</td></tr>
            ) : items.map(item => {
              const expired  = isExpired(item.valid_until);
              const inactive = !item.is_active;
              return (
                <tr key={item.id} style={{ opacity: (inactive || expired) ? 0.6 : 1 }}>
                  <td style={{ fontWeight: 500 }}>{item.name}</td>
                  <td><TypeBadge v={item.promise_type} /></td>
                  <td><AppliesBadge v={item.applies_to} /></td>
                  <td style={{ color: 'var(--text)', fontSize: 13 }}>{item.ref_name || `#${item.ref_id}`}</td>
                  <td style={{ fontSize: 13 }}>
                    {item.vehicle_type_name
                      ? item.vehicle_type_name
                      : <span style={{ color: 'var(--text-muted)' }}>All types</span>}
                  </td>
                  <td style={{ fontWeight: 600, fontSize: 13, color: item.is_exclusion ? '#991b1b' : 'inherit' }}>
                    {item.is_exclusion ? '🚫 Excluded — no coverage' : (item.label || warrantyLabel(item))}
                  </td>
                  <td style={{ fontSize: 13 }}>{fmtDate(item.valid_from)}</td>
                  <td style={{ fontSize: 13 }}>
                    {item.valid_until
                      ? <span style={{ color: expired ? '#dc2626' : 'inherit' }}>{fmtDate(item.valid_until)}{expired ? ' (Expired)' : ''}</span>
                      : <span style={{ color: 'var(--text-muted)' }}>No expiry</span>}
                  </td>
                  <td>
                    {expired ? (
                      <span style={{ fontSize: 13, fontWeight: 500, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <ToggleLeft size={18} style={{ color: '#dc2626' }} />Expired
                      </span>
                    ) : canEdit ? (
                      <button
                        onClick={() => toggleActive(item)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 500 }}
                        title={item.is_active ? 'Click to deactivate' : 'Click to activate'}
                      >
                        {item.is_active
                          ? <><ToggleRight size={18} style={{ color: '#16a34a' }} /><span style={{ color: '#16a34a' }}>Active</span></>
                          : <><ToggleLeft  size={18} style={{ color: '#9ca3af' }} /><span style={{ color: '#9ca3af' }}>Inactive</span></>}
                      </button>
                    ) : (
                      <span style={{ fontSize: 13, fontWeight: 500, color: item.is_active ? '#16a34a' : '#9ca3af' }}>
                        {item.is_active ? 'Active' : 'Inactive'}
                      </span>
                    )}
                  </td>
                  {canWrite && (
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                        {canEdit && (
                          <button
                            className="icon-action"
                            onClick={() => setModal({ mode: 'edit', item })}
                            title="Edit"
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            className="icon-action icon-action--danger"
                            onClick={() => setModal({ mode: 'delete', item })}
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* Summary row */}
      {!loading && items.length > 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
          {items.length} warrant{items.length !== 1 ? 'ies' : 'y'} shown
          {' · '}{items.filter(x => x.is_active && !isExpired(x.valid_until)).length} currently active
        </p>
      )}

      {/* Modals */}
      {(modal?.mode === 'add' || modal?.mode === 'edit') && (
        <WarrantyModal
          item={modal.item}
          vehicleTypes={vehicleTypes}
          onClose={() => setModal(null)}
          onSave={handleSaved}
        />
      )}
      {modal?.mode === 'delete' && (
        <DeleteModal
          item={modal.item}
          onClose={() => setModal(null)}
          onConfirm={handleDelete}
          loading={deleting}
        />
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
