import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api/client.js';
import useSync from '../hooks/useSync.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import { useCan } from '../auth/AuthContext.jsx';
import {
  Plus, Pencil, Trash2, X, Search, RefreshCw,
  AlertCircle, CheckCircle2, Tag, ToggleLeft, ToggleRight, Percent,
} from 'lucide-react';
import '../styles/DiscountMasterPage.css';

// ── Helpers ───────────────────────────────────────────────────────────────────
const APPLIES_OPTIONS = [
  { value: '',         label: 'All levels'      },
  { value: 'category', label: 'Service Category' },
  { value: 'service',  label: 'Service'           },
  { value: 'part',     label: 'Part'              },
];

const APPLIES_BADGE = {
  category: { bg: '#ede9fe', color: '#5b21b6', label: 'Category' },
  service:  { bg: '#dbeafe', color: '#1e40af', label: 'Service'  },
  part:     { bg: '#dcfce7', color: '#166534', label: 'Part'     },
};

const TYPE_BADGE = {
  percent: { bg: '#fef3c7', color: '#92400e', label: '%'  },
  flat:    { bg: '#fee2e2', color: '#991b1b', label: '₹'  },
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

function TypeBadge({ v }) {
  const m = TYPE_BADGE[v] || { bg: '#f3f4f6', color: '#374151', label: v };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 99,
      fontSize: 11, fontWeight: 700, background: m.bg, color: m.color,
    }}>{m.label}</span>
  );
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
          <h3>Delete Discount</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ padding: '20px 24px' }}>
          <p style={{ margin: '0 0 20px', fontSize: 14 }}>
            Are you sure you want to delete <strong>"{item.name}"</strong>? This cannot be undone.
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
function DiscountModal({ item, onClose, onSave }) {
  useEscapeClose(onClose);
  const isEdit = !!item?.id;

  const [form, setForm] = useState({
    name:           item?.name           || '',
    discount_type:  item?.discount_type  || 'percent',
    discount_value: item?.discount_value ?? '',
    applies_to:     item?.applies_to     || 'service',
    ref_id:         item?.ref_id         ?? '',
    valid_from:     item?.valid_from     ? item.valid_from.slice(0, 10)    : new Date().toISOString().slice(0, 10),
    valid_until:    item?.valid_until    ? item.valid_until.slice(0, 10)   : '',
    is_active:      item?.is_active      ?? true,
  });

  const [refOptions,   setRefOptions]   = useState([]);
  const [refSearch,    setRefSearch]    = useState(item?.ref_name || '');
  const [refDropOpen,  setRefDropOpen]  = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error,  setError]    = useState(null);
  const nameRef   = useRef(null);
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

  // Reset ref when applies_to changes
  const changeAppliesTo = (e) => {
    setForm(f => ({ ...f, applies_to: e.target.value, ref_id: '' }));
    setRefSearch('');
    setRefDropOpen(false);
  };

  // Select a ref option
  const selectRef = (opt) => {
    setForm(f => ({ ...f, ref_id: opt.id }));
    setRefSearch(opt.label);
    setRefDropOpen(false);
  };

  // Filtered options based on search
  const filteredRefOptions = refOptions.filter(o =>
    o.label.toLowerCase().includes(refSearch.toLowerCase())
  );

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim())       { setError('Discount name is required.'); return; }
    if (!form.ref_id)            { setError('Please select a target item.'); return; }
    if (form.discount_value === '') { setError('Discount value is required.'); return; }
    if (form.discount_type === 'percent' && parseFloat(form.discount_value) > 100) {
      setError('Percentage discount cannot exceed 100%.'); return;
    }

    setSaving(true); setError(null);
    try {
      const payload = {
        name:           form.name.trim(),
        discount_type:  form.discount_type,
        discount_value: parseFloat(form.discount_value),
        applies_to:     form.applies_to,
        ref_id:         parseInt(form.ref_id, 10),
        valid_from:     form.valid_from  || null,
        valid_until:    form.valid_until || null,
        is_active:      form.is_active,
      };
      const res = isEdit
        ? await api(`/api/discount-master/${item.id}`, { method: 'PATCH', body: payload })
        : await api('/api/discount-master', { method: 'POST', body: payload });
      onSave(res.item);
    } catch (err) {
      setError(err.message || 'Something went wrong.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <h3>{isEdit ? 'Edit Discount' : 'Add Discount'}</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Name */}
          <div className="form-field">
            <label>Discount Name <span style={{ color: '#dc2626' }}>*</span></label>
            <input
              ref={nameRef}
              className="form-input"
              value={form.name}
              onChange={field('name')}
              placeholder="e.g. Monsoon Offer, Festival Discount"
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

          {/* Discount Type + Value */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-field">
              <label>Discount Type <span style={{ color: '#dc2626' }}>*</span></label>
              <select className="form-input" value={form.discount_type} onChange={field('discount_type')}>
                <option value="percent">Percentage (%)</option>
                <option value="flat">Flat Amount (₹)</option>
              </select>
            </div>
            <div className="form-field">
              <label>
                Value <span style={{ color: '#dc2626' }}>*</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 4 }}>
                  {form.discount_type === 'percent' ? '(e.g. 10 = 10%)' : '(₹ amount)'}
                </span>
              </label>
              <input
                className="form-input"
                type="number"
                min="0"
                max={form.discount_type === 'percent' ? 100 : undefined}
                step="0.01"
                value={form.discount_value}
                onChange={field('discount_value')}
                placeholder={form.discount_type === 'percent' ? '10' : '500'}
              />
            </div>
          </div>

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
              Inactive discounts won't auto-apply to new estimates/invoices
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
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Discount'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function DiscountMasterPage() {
  const canWrite = useCan('MANAGE_MASTER_DATA');

  const [items,     setItems]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [filterApplies, setFilterApplies] = useState('');
  const [filterActive,  setFilterActive]  = useState('true');

  const [modal,     setModal]     = useState(null); // null | { mode: 'add'|'edit'|'delete', item }
  const [toast,     setToast]     = useState(null);
  const [deleting,  setDeleting]  = useState(false);

  const showToast = (msg, type = 'success') => setToast({ msg, type });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search)        params.set('search',     search);
      if (filterApplies) params.set('applies_to', filterApplies);
      if (filterActive)  params.set('is_active',  filterActive);
      const r = await api(`/api/discount-master?${params}`);
      setItems(r.items || []);
    } catch (err) {
      showToast(err.message || 'Failed to load discounts.', 'error');
    } finally {
      setLoading(false);
    }
  }, [search, filterApplies, filterActive]);

  useEffect(() => { load(); }, [load]);
  useSync('discounts', load);

  async function handleDelete() {
    setDeleting(true);
    try {
      await api(`/api/discount-master/${modal.item.id}`, { method: 'DELETE' });
      setItems(prev => prev.filter(x => x.id !== modal.item.id));
      showToast('Discount deleted.');
      setModal(null);
    } catch (err) {
      showToast(err.message || 'Delete failed.', 'error');
    } finally {
      setDeleting(false);
    }
  }

  function handleSaved(saved) {
    setItems(prev => {
      const exists = prev.find(x => x.id === saved.id);
      return exists ? prev.map(x => x.id === saved.id ? saved : x) : [saved, ...prev];
    });
    showToast(modal.mode === 'edit' ? 'Discount updated.' : 'Discount added.');
    setModal(null);
  }

  // Quick toggle active
  async function toggleActive(item) {
    if (!canWrite) return;
    try {
      const r = await api(`/api/discount-master/${item.id}`, { method: 'PATCH', body: { is_active: !item.is_active } });
      setItems(prev => prev.map(x => x.id === item.id ? r.item : x));
      showToast(r.item.is_active ? 'Discount activated.' : 'Discount deactivated.');
    } catch (err) {
      showToast(err.message || 'Failed.', 'error');
    }
  }

  return (
    <div className="discount-page">
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Percent size={22} style={{ color: 'var(--primary)' }} />
          <div>
            <h2 style={{ margin: 0 }}>Discount Master</h2>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-muted)' }}>Configure discounts by category, service or part — auto-applied on estimates &amp; invoices</p>
          </div>
        </div>
        {canWrite && (
          <button className="btn btn-primary" onClick={() => setModal({ mode: 'add', item: null })}>
            <Plus size={16} /> Add Discount
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
            placeholder="Search discounts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
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
              <th>Applies To</th>
              <th>Target</th>
              <th>Type</th>
              <th>Value</th>
              <th>Valid From</th>
              <th>Valid Until</th>
              <th>Status</th>
              {canWrite && <th style={{ textAlign: 'center' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={canWrite ? 9 : 8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={canWrite ? 9 : 8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No discounts found.</td></tr>
            ) : items.map(item => {
              const expired  = isExpired(item.valid_until);
              const inactive = !item.is_active;
              return (
                <tr key={item.id} style={{ opacity: (inactive || expired) ? 0.6 : 1 }}>
                  <td style={{ fontWeight: 500 }}>{item.name}</td>
                  <td><AppliesBadge v={item.applies_to} /></td>
                  <td style={{ color: 'var(--text)', fontSize: 13 }}>{item.ref_name || `#${item.ref_id}`}</td>
                  <td><TypeBadge v={item.discount_type} /></td>
                  <td style={{ fontWeight: 600 }}>
                    {item.discount_type === 'percent'
                      ? `${item.discount_value}%`
                      : `₹${parseFloat(item.discount_value).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`}
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
                    ) : canWrite ? (
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
                        <button
                          className="icon-action"
                          onClick={() => setModal({ mode: 'edit', item })}
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="icon-action icon-action--danger"
                          onClick={() => setModal({ mode: 'delete', item })}
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
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
          {items.length} discount{items.length !== 1 ? 's' : ''} shown
          {' · '}{items.filter(x => x.is_active && !isExpired(x.valid_until)).length} currently active
        </p>
      )}

      {/* Modals */}
      {(modal?.mode === 'add' || modal?.mode === 'edit') && (
        <DiscountModal
          item={modal.item}
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

