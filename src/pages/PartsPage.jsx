import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api/client.js';
import { useCan } from '../auth/AuthContext.jsx';
import {
  Plus, Pencil, Trash2, X, Search, RefreshCw,
  AlertCircle, CheckCircle2, Package,
} from 'lucide-react';
import '../styles/PartsPage.css';

// ── Vehicle type options ──────────────────────────────────────────────────────
const VT_OPTIONS = [
  { value: '',     label: 'All types'  },
  { value: '4W',   label: '4W'         },
  { value: '2W',   label: '2W'         },
  { value: 'both', label: 'Both'       },
];

const VT_BADGE = {
  '4W':  { bg: '#dbeafe', color: '#1e40af', label: '4W'   },
  '2W':  { bg: '#dcfce7', color: '#166534', label: '2W'   },
  'both':{ bg: '#fef3c7', color: '#92400e', label: 'Both' },
};

function VTypeBadge({ vt }) {
  if (!vt) return null;
  const m = VT_BADGE[vt] || { bg: '#f3f4f6', color: '#374151', label: vt };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 99,
      fontSize: 11, fontWeight: 700,
      background: m.bg, color: m.color,
    }}>{m.label}</span>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
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
      animation: 'fadeUp 0.2s ease',
    }}>
      {isErr ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
      {msg}
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', marginLeft: 4 }}>
        <X size={14} />
      </button>
    </div>
  );
}

// ── Delete confirm modal ──────────────────────────────────────────────────────
function DeleteModal({ item, onClose, onConfirm, loading }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h3>Delete Part</h3>
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
function PartModal({ item, onClose, onSave }) {
  const isEdit = !!item?.id;
  const [form, setForm] = useState({
    name:          item?.name          || '',
    category:      item?.category      || '',
    vehicle_type:  item?.vehicle_type  || '',
    customer_rate: item?.customer_rate ?? '',
    gst_percent:   item?.gst_percent   ?? '',
    hsn_code:      item?.hsn_code      || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);
  const nameRef = useRef(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const field = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Part name is required.'); return; }
    setSaving(true); setError(null);
    try {
      const payload = {
        name:          form.name.trim(),
        category:      form.category.trim()     || null,
        vehicle_type:  form.vehicle_type        || null,
        customer_rate: form.customer_rate !== '' ? parseFloat(form.customer_rate) : null,
        gst_percent:   form.gst_percent   !== '' ? parseFloat(form.gst_percent)   : null,
        hsn_code:      form.hsn_code.trim()     || null,
      };
      const res = isEdit
        ? await api(`/api/parts/${item.id}`, { method: 'PATCH', body: payload })
        : await api('/api/parts', { method: 'POST', body: payload });
      onSave(res.item);
    } catch (err) {
      setError(err.message || 'Something went wrong.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h3>{isEdit ? 'Edit Part' : 'Add Part'}</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit} style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div className="form-field">
            <label>Part Name <span style={{ color: '#dc2626' }}>*</span></label>
            <input
              ref={nameRef}
              className="form-input"
              value={form.name}
              onChange={field('name')}
              placeholder="e.g. Engine Oil Filter"
              maxLength={200}
            />
          </div>

          <div className="form-field">
            <label>Category <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
            <input
              className="form-input"
              value={form.category}
              onChange={field('category')}
              placeholder="e.g. Engine, Brakes, Filters…"
              maxLength={120}
            />
          </div>

          <div className="form-field">
            <label>Vehicle Type <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
            <select className="form-input" value={form.vehicle_type} onChange={field('vehicle_type')}>
              <option value="">— Not specified —</option>
              <option value="4W">4W (Four-Wheeler)</option>
              <option value="2W">2W (Two-Wheeler)</option>
              <option value="both">Both</option>
            </select>
          </div>

          <div className="form-field">
            <label>Customer Rate (inc. GST) <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
            <input
              className="form-input"
              type="number"
              min="0"
              step="0.01"
              value={form.customer_rate}
              onChange={field('customer_rate')}
              placeholder="e.g. 500.00"
            />
          </div>

          <div className="form-field">
            <label>GST % <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
            <input
              className="form-input"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.gst_percent}
              onChange={field('gst_percent')}
              placeholder="e.g. 28"
            />
          </div>

          <div className="form-field">
            <label>HSN Code <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
            <input
              className="form-input"
              value={form.hsn_code}
              onChange={field('hsn_code')}
              placeholder="e.g. 84099900"
              maxLength={20}
            />
          </div>

          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#fef2f2', border: '1px solid #fca5a5',
              borderRadius: 8, padding: '10px 14px',
              color: '#991b1b', fontSize: 13,
            }}>
              <AlertCircle size={15} /> {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? (isEdit ? 'Saving…' : 'Adding…') : (isEdit ? 'Save Changes' : 'Add Part')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Main page
// ═════════════════════════════════════════════════════════════════════════════
export default function PartsPage() {
  const canWrite = useCan('MANAGE_MASTER_DATA');

  const [parts,   setParts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [vtFilter, setVtFilter] = useState('');

  const [modal,       setModal]       = useState(null); // null | 'add' | { edit: item } | { delete: item }
  const [deleting,    setDeleting]    = useState(false);
  const [toast,       setToast]       = useState(null); // { msg, type }

  const showToast = useCallback((msg, type = 'success') => setToast({ msg, type }), []);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchParts = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (search.trim()) query.set('search', search.trim());
      if (vtFilter)      query.set('vehicle_type', vtFilter);
      const qs = query.toString() ? `?${query.toString()}` : '';
      const res = await api(`/api/parts${qs}`);
      setParts(res.items || []);
    } catch {
      showToast('Failed to load parts.', 'error');
    } finally {
      setLoading(false);
    }
  }, [search, vtFilter, showToast]);

  useEffect(() => { fetchParts(); }, [fetchParts]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  function onSaved(item) {
    setParts(prev => {
      const idx = prev.findIndex(p => p.id === item.id);
      if (idx >= 0) {
        const next = [...prev]; next[idx] = item; return next;
      }
      return [...prev, item].sort((a, b) => a.name.localeCompare(b.name));
    });
    setModal(null);
    showToast(modal?.edit ? 'Part updated.' : 'Part added.');
  }

  async function confirmDelete() {
    const item = modal?.delete;
    if (!item) return;
    setDeleting(true);
    try {
      await api(`/api/parts/${item.id}`, { method: 'DELETE' });
      setParts(prev => prev.filter(p => p.id !== item.id));
      setModal(null);
      showToast('Part deleted.');
    } catch (err) {
      showToast(err.message || 'Delete failed.', 'error');
    } finally {
      setDeleting(false);
    }
  }

  // ── Derived list ──────────────────────────────────────────────────────────
  // Client-side filter on top of server-side (server handles the real filtering)
  const visible = parts;

  // Unique categories for the category column hint
  const categories = [...new Set(parts.map(p => p.category).filter(Boolean))].sort();

  return (
    <div className="parts-page">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Package size={22} style={{ color: 'var(--primary)' }} />
            Parts
          </h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
            Manage spare parts and auto parts used in vehicle servicing.
          </p>
        </div>
        {canWrite && (
          <button className="btn btn-primary" onClick={() => setModal('add')}>
            <Plus size={16} /> Add Part
          </button>
        )}
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="parts-filters card" style={{ padding: '14px 18px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="form-input"
            style={{ paddingLeft: 32 }}
            placeholder="Search parts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="form-input"
          style={{ flex: '0 0 160px' }}
          value={vtFilter}
          onChange={e => setVtFilter(e.target.value)}
        >
          {VT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button className="btn btn-ghost" onClick={fetchParts} title="Refresh" style={{ flexShrink: 0 }}>
          <RefreshCw size={15} />
        </button>
        <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {visible.length} part{visible.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="card">
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading parts…
          </div>
        ) : visible.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <Package size={32} style={{ opacity: 0.3, marginBottom: 10 }} />
            <p style={{ margin: 0 }}>
              {search || vtFilter ? 'No parts match your filters.' : 'No parts yet. Add your first part above.'}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <table className="parts-table">
              <thead>
                <tr>
                  <th>Part Name</th>
                  <th>Category</th>
                  <th>Vehicle Type</th>
                  <th>HSN Code</th>
                  <th>Rate (inc. GST)</th>
                  <th>GST %</th>
                  <th>Status</th>
                  {canWrite && <th style={{ width: 80 }}></th>}
                </tr>
              </thead>
              <tbody>
                {visible.map(part => (
                  <tr key={part.id} className={part.is_active === false ? 'row-inactive' : ''}>
                    <td className="cell-name">
                      <span className="part-name">{part.name}</span>
                      {part.is_active === false && (
                        <span style={{
                          marginLeft: 8, fontSize: 10, fontWeight: 700,
                          background: '#f3f4f6', color: '#6b7280',
                          borderRadius: 4, padding: '1px 6px',
                        }}>inactive</span>
                      )}
                    </td>
                    <td>
                      {part.category
                        ? <span className="cat-badge">{part.category}</span>
                        : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                      }
                    </td>
                    <td>
                      <VTypeBadge vt={part.vehicle_type} />
                      {!part.vehicle_type && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>}
                    </td>
                    <td>
                      {part.hsn_code
                        ? <span style={{ fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-soft)', padding: '2px 6px', borderRadius: 4 }}>{part.hsn_code}</span>
                        : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                      }
                    </td>
                    <td>{part.customer_rate != null ? `₹${Number(part.customer_rate).toLocaleString('en-IN', {minimumFractionDigits:2})}` : <span style={{color:'var(--text-muted)',fontSize:12}}>—</span>}</td>
                    <td>{part.gst_percent != null ? `${part.gst_percent}%` : <span style={{color:'var(--text-muted)',fontSize:12}}>—</span>}</td>
                    <td>
                      <span style={{
                        fontSize: 11, fontWeight: 700,
                        padding: '2px 8px', borderRadius: 99,
                        background: part.is_active !== false ? '#dcfce7' : '#f3f4f6',
                        color:      part.is_active !== false ? '#166534' : '#6b7280',
                      }}>
                        {part.is_active !== false ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canWrite && (
                      <td>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button className="icon-action" title="Edit" onClick={() => setModal({ edit: part })}>
                            <Pencil size={14} />
                          </button>
                          <button className="icon-action icon-action--danger" title="Delete" onClick={() => setModal({ delete: part })}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile card list */}
            <div className="parts-mobile-cards">
              {visible.map(part => (
                <div key={part.id} className="parts-mobile-card" style={{ opacity: part.is_active === false ? 0.55 : 1 }}>
                  <div className="parts-mobile-card-main">
                    <div className="parts-mobile-card-name">
                      <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{part.name}</span>
                      {part.is_active === false && (
                        <span style={{ fontSize: 10, fontWeight: 700, background: '#f3f4f6', color: '#6b7280', borderRadius: 4, padding: '1px 6px' }}>inactive</span>
                      )}
                    </div>
                    <div className="parts-mobile-card-meta">
                      {part.category && <span className="cat-badge">{part.category}</span>}
                      <VTypeBadge vt={part.vehicle_type} />
                      {part.customer_rate != null && (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          ₹{Number(part.customer_rate).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      )}
                      {part.gst_percent != null && (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>GST {part.gst_percent}%</span>
                      )}
                    </div>
                  </div>
                  {canWrite && (
                    <div className="parts-mobile-card-actions">
                      <button className="icon-action" onClick={() => setModal({ edit: part })}><Pencil size={14} /></button>
                      <button className="icon-action icon-action--danger" onClick={() => setModal({ delete: part })}><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Category summary ─────────────────────────────────────────────── */}
      {categories.length > 0 && (
        <div className="card" style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Categories in use
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {categories.map(cat => (
              <button
                key={cat}
                className="cat-filter-chip"
                onClick={() => setSearch(cat)}
                title={`Filter by ${cat}`}
              >
                {cat}
                <span style={{ marginLeft: 6, opacity: 0.6, fontSize: 10 }}>
                  {parts.filter(p => p.category === cat).length}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {(modal === 'add' || modal?.edit) && (
        <PartModal
          item={modal?.edit || null}
          onClose={() => setModal(null)}
          onSave={onSaved}
        />
      )}

      {modal?.delete && (
        <DeleteModal
          item={modal.delete}
          onClose={() => setModal(null)}
          onConfirm={confirmDelete}
          loading={deleting}
        />
      )}

      {/* ── Toast ────────────────────────────────────────────────────────── */}
      {toast && (
        <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Styles
