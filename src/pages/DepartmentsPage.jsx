import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client.js';
import useSync from '../hooks/useSync.js';
import { useCan } from '../auth/AuthContext.jsx';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import { Plus, Pencil, Trash2, X, AlertCircle, CheckCircle2, Building2 } from 'lucide-react';
import '../styles/DepartmentsPage.css';

// ── Add / Edit modal ──────────────────────────────────────────────────────────
function DeptModal({ item, onClose, onSaved }) {
  const isEdit = !!item?.id;
  useEscapeClose(onClose);
  const [name,    setName]    = useState(item?.name || '');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      const r = isEdit
        ? await api(`/api/departments/${item.id}`, { method: 'PATCH', body: { name } })
        : await api('/api/departments',             { method: 'POST',  body: { name } });
      onSaved(r.item);
    } catch (e) { setError(e.message); setSaving(false); }
  }

  return (
    <div className="dp-backdrop">
      <div className="dp-modal dp-modal--sm" onClick={e => e.stopPropagation()}>
        <div className="dp-modal-hdr">
          <h3>{isEdit ? 'Edit Department' : 'New Department'}</h3>
          <button className="dp-icon-btn" onClick={onClose}><X size={18}/></button>
        </div>
        <form className="dp-modal-body" onSubmit={handleSubmit}>
          {error && (
            <div className="dp-err"><AlertCircle size={13}/> {error}</div>
          )}
          <div className="dp-field">
            <label>Department Name <span className="dp-req">*</span></label>
            <input
              className="dp-input"
              value={name}
              required
              autoFocus
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Sales, Support, Operations…"
            />
          </div>
        </form>
        <div className="dp-modal-ftr">
          <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="button primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Department'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete confirm modal ──────────────────────────────────────────────────────
function DeleteModal({ item, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  useEscapeClose(onClose);
  async function go() {
    setBusy(true); setErr('');
    try { await onConfirm(); }
    catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="dp-backdrop">
      <div className="dp-modal dp-modal--sm" onClick={e => e.stopPropagation()}>
        <div className="dp-modal-hdr">
          <h3>Delete Department</h3>
          <button className="dp-icon-btn" onClick={onClose}><X size={18}/></button>
        </div>
        <div className="dp-modal-body">
          {err && <div className="dp-err"><AlertCircle size={13}/> {err}</div>}
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
            Delete <strong>"{item.name}"</strong>? This cannot be undone.
            Users already assigned to this department will keep their department label, but it will no longer appear in dropdowns.
          </p>
        </div>
        <div className="dp-modal-ftr">
          <button className="button secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="button danger" onClick={go} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function DepartmentsPage() {
  const canManage = useCan('MANAGE_MASTER_DATA');

  const [departments, setDepartments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [modal,       setModal]       = useState(null); // null | { mode:'add'|'edit', item? }
  const [delItem,     setDelItem]     = useState(null);
  const [toast,       setToast]       = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api('/api/departments');
      setDepartments(r.items);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useSync('departments', load);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  function handleSaved(item) {
    setDepartments(prev => {
      const idx = prev.findIndex(d => d.id === item.id);
      if (idx >= 0) return prev.map(d => d.id === item.id ? item : d);
      return [...prev, item].sort((a, b) => a.name.localeCompare(b.name));
    });
    setModal(null);
    showToast(modal?.mode === 'edit' ? 'Department updated.' : 'Department added.');
  }

  async function handleDelete(item) {
    await api(`/api/departments/${item.id}`, { method: 'DELETE' });
    setDepartments(prev => prev.filter(d => d.id !== item.id));
    setDelItem(null);
    showToast(`"${item.name}" deleted.`);
  }

  async function handleToggle(item) {
    try {
      const r = await api(`/api/departments/${item.id}`, {
        method: 'PATCH',
        body: { is_active: !item.is_active },
      });
      setDepartments(prev => prev.map(d => d.id === item.id ? r.item : d));
    } catch (e) { showToast(e.message, 'error'); }
  }

  const activeCount   = departments.filter(d => d.is_active).length;
  const inactiveCount = departments.filter(d => !d.is_active).length;

  return (
    <div className="dp-page">
      {/* Toast */}
      {toast && (
        <div className={`dp-toast dp-toast--${toast.type}`}>
          <CheckCircle2 size={14}/> {toast.msg}
        </div>
      )}

      {/* Page header */}
      <header className="page-header">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Building2 size={20}/> Departments
          </h2>
          <p>Manage the department options available in user profiles and creation forms.</p>
        </div>
        {canManage && (
          <button className="button primary" onClick={() => setModal({ mode: 'add' })}>
            <Plus size={16}/> Add Department
          </button>
        )}
      </header>

      {error && <div className="banner error">{error}</div>}

      <div className="card">
        {/* Desktop table */}
        <table className="data-table">
          <thead>
            <tr>
              <th>Department Name</th>
              <th>Status</th>
              <th>Created</th>
              {canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                  Loading…
                </td>
              </tr>
            ) : departments.length === 0 ? (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                  No departments yet. Add your first one.
                </td>
              </tr>
            ) : departments.map(d => (
              <tr key={d.id} style={{ opacity: d.is_active ? 1 : 0.5, transition: 'opacity .15s' }}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                      width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                      background: d.is_active ? 'rgba(37,99,235,.10)' : 'var(--bg-soft)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Building2 size={14} style={{ color: d.is_active ? '#2563eb' : 'var(--text-muted)' }}/>
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{d.name}</span>
                  </div>
                </td>
                <td>
                  <button
                    onClick={() => canManage && handleToggle(d)}
                    style={{
                      fontSize: 11, fontWeight: 700, padding: '3px 12px', borderRadius: 20,
                      border: 'none', cursor: canManage ? 'pointer' : 'default',
                      background: d.is_active ? '#dcfce7' : '#f3f4f6',
                      color:      d.is_active ? '#16a34a' : '#6b7280',
                    }}
                    title={canManage ? (d.is_active ? 'Click to deactivate' : 'Click to activate') : ''}
                  >
                    {d.is_active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {new Date(d.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </td>
                {canManage && (
                  <td>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button className="dp-icon-btn" title="Edit" onClick={() => setModal({ mode: 'edit', item: d })}>
                        <Pencil size={14}/>
                      </button>
                      <button className="dp-icon-btn dp-icon-btn--danger" title="Delete" onClick={() => setDelItem(d)}>
                        <Trash2 size={14}/>
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {/* Mobile card list */}
        <div className="dp-mobile-cards">
          {loading ? (
            <div className="dp-mobile-empty">Loading…</div>
          ) : departments.length === 0 ? (
            <div className="dp-mobile-empty">No departments yet. Add your first one.</div>
          ) : departments.map(d => (
            <div key={d.id} className="dp-mobile-card" style={{ opacity: d.is_active ? 1 : 0.55 }}>
              <div className="dp-mobile-card-main">
                <div className="dp-mobile-card-row">
                  <span style={{
                    width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                    background: d.is_active ? 'rgba(37,99,235,.10)' : 'var(--bg-soft)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Building2 size={13} style={{ color: d.is_active ? '#2563eb' : 'var(--text-muted)' }}/>
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{d.name}</span>
                </div>
                <div className="dp-mobile-card-meta">
                  <button
                    onClick={() => canManage && handleToggle(d)}
                    style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20,
                      border: 'none', cursor: canManage ? 'pointer' : 'default',
                      background: d.is_active ? '#dcfce7' : '#f3f4f6',
                      color:      d.is_active ? '#16a34a' : '#6b7280',
                    }}
                  >
                    {d.is_active ? 'Active' : 'Inactive'}
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {new Date(d.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
              </div>
              {canManage && (
                <div className="dp-mobile-card-actions">
                  <button className="dp-icon-btn" onClick={() => setModal({ mode: 'edit', item: d })}><Pencil size={14}/></button>
                  <button className="dp-icon-btn dp-icon-btn--danger" onClick={() => setDelItem(d)}><Trash2 size={14}/></button>
                </div>
              )}
            </div>
          ))}
        </div>

        {departments.length > 0 && (
          <div style={{ padding: '10px 20px', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
            {activeCount} active · {inactiveCount} inactive
          </div>
        )}
      </div>

      {/* Modals */}
      {modal && (
        <DeptModal
          item={modal.item}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
      {delItem && (
        <DeleteModal
          item={delItem}
          onClose={() => setDelItem(null)}
          onConfirm={() => handleDelete(delItem)}
        />
      )}
    </div>
  );
}
