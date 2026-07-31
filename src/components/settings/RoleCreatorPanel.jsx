import { useState, useEffect } from 'react';
import { api } from '../../api/client.js';
import { Shield, Loader, Edit2, X } from 'lucide-react';
import { SectionHeader } from './shared.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// ROLE CREATOR PANEL  (Super Admin only)
// ─────────────────────────────────────────────────────────────────────────────

// Preferred ORDER for the checklist's group tabs — deliberately not a
// whitelist. Any group the API returns that isn't listed here is appended
// rather than dropped (see orderGroups below).
//
// It used to be used as a filter, which silently hid whole groups: a
// permission with a group not on this list existed in the API and simply never
// appeared as a checkbox, so it could never be granted. 'Settings',
// 'Warranties' and 'Warranty Claims' were all invisible that way.
const PERM_GROUP_ORDER = [
  'Administration', 'Settings', 'Leads', 'Vehicles', 'Reference Data', 'Services', 'Pricing',
  'Hubs', 'Appointments', 'Customers', 'Estimates',
  'Invoices', 'Purchase Invoices', 'Parts', 'Discounts',
  'Warranties', 'Warranty Claims', 'Operations', 'Dashboard',
];

/**
 * Known groups first in the order above, then anything else the catalogue
 * returns — alphabetically, so a newly added group lands somewhere predictable
 * instead of vanishing.
 */
function orderGroups(grouped) {
  const known = PERM_GROUP_ORDER.filter(g => grouped[g]);
  const extra = Object.keys(grouped).filter(g => !PERM_GROUP_ORDER.includes(g)).sort();
  return [...known, ...extra];
}

// ── Group icon helper ─────────────────────────────────────────────────────────
function roleGroupIcon(group) {
  const g = (group || '').toLowerCase();

  if (g.includes('admin') || g === 'administration')
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>;

  if (g === 'leads' || g.startsWith('lead'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;

  if (g.includes('vehicle'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v9a2 2 0 0 1-2 2h-2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>;

  if (g === 'services' || g.includes('service'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>;

  if (g === 'pricing' || g.includes('pric'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>;

  if (g === 'hubs' || g.startsWith('hub'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;

  if (g === 'appointments' || g.includes('appoint'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;

  if (g === 'customers' || g.includes('customer'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;

  if (g === 'estimates' || g.includes('estimate'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;

  if (g === 'invoices' || (g.includes('invoice') && !g.includes('purchase')))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>;

  if (g.includes('purchase'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>;

  if (g.includes('reference') || g.includes('ref data'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>;

  if (g === 'parts' || g.includes('part'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>;

  if (g === 'discounts' || g.includes('discount'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="9" r="2"/><circle cx="15" cy="15" r="2"/><line x1="4" y1="20" x2="20" y2="4"/></svg>;

  if (g === 'operations' || g.includes('operat'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>;

  if (g === 'dashboard' || g.includes('dashboard'))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>;

  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>;
}

export default function RoleCreatorPanel() {
  const [roles,      setRoles]      = useState([]);
  const [catalog,    setCatalog]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [modalOpen,  setModalOpen]  = useState(false);
  const [editRole,   setEditRole]   = useState(null);
  const [deleting,   setDeleting]   = useState(null);
  const [err,        setErr]        = useState('');
  const [ok,         setOk]         = useState('');

  // Form state
  const EMPTY_FORM = { name: '', description: '', permissions: [], is_active: true };
  const [form,    setForm]    = useState(EMPTY_FORM);
  const [saving,  setSaving]  = useState(false);
  const [formErr, setFormErr] = useState('');

  // Active group in the two-column permission picker
  const [activeGroup, setActiveGroup] = useState('');

  useEffect(() => {
    Promise.all([
      api('/api/roles'),
      api('/api/users/permissions'),
    ]).then(([r, p]) => {
      setRoles(r.items || []);
      setCatalog(p.items || []);
    }).catch(() => setErr('Failed to load roles. Run the DB migration first.')).finally(() => setLoading(false));
  }, []);

  // Group permissions by group field, respecting PERM_GROUP_ORDER
  const grouped = {};
  for (const p of catalog) {
    if (!grouped[p.group]) grouped[p.group] = [];
    grouped[p.group].push(p);
  }
  const groupOrder = orderGroups(grouped);

  // Resolve active group — default to first
  const resolvedGroup = (activeGroup && grouped[activeGroup]) ? activeGroup : (groupOrder[0] || '');

  function openCreate() {
    setEditRole(null);
    setForm(EMPTY_FORM);
    setFormErr('');
    setActiveGroup(groupOrder[0] || '');
    setModalOpen(true);
  }

  function openEdit(role) {
    setEditRole(role);
    setForm({
      name:        role.name,
      description: role.description || '',
      permissions: role.permissions || [],
      is_active:   role.is_active,
    });
    setFormErr('');
    setActiveGroup(groupOrder[0] || '');
    setModalOpen(true);
  }

  function togglePerm(code) {
    setForm(f => ({
      ...f,
      permissions: f.permissions.includes(code)
        ? f.permissions.filter(c => c !== code)
        : [...f.permissions, code],
    }));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) { setFormErr('Role name is required.'); return; }
    setSaving(true); setFormErr('');
    try {
      const body = {
        name:        form.name.trim(),
        description: form.description.trim() || null,
        permissions: form.permissions,
        is_active:   form.is_active,
      };
      if (editRole) {
        const r = await api(`/api/roles/${editRole.id}`, { method: 'PUT', body });
        setRoles(prev => prev.map(x => x.id === editRole.id ? r.item : x));
        setOk(`Role "${r.item.name}" updated.`);
      } else {
        const r = await api('/api/roles', { method: 'POST', body });
        setRoles(prev => [...prev, r.item]);
        setOk(`Role "${r.item.name}" created.`);
      }
      setModalOpen(false);
      setTimeout(() => setOk(''), 3000);
    } catch (ex) {
      setFormErr(ex.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(role) {
    const userCount = role.user_count || 0;
    const warning = userCount > 0
      ? `⚠️ "${role.name}" is currently assigned to ${userCount} user${userCount > 1 ? 's' : ''}. Their role label will be removed.\n\n`
      : '';
    if (!window.confirm(`${warning}Delete role "${role.name}"? This cannot be undone.`)) return;
    setDeleting(role.id);
    try {
      await api(`/api/roles/${role.id}`, { method: 'DELETE' });
      setRoles(prev => prev.filter(r => r.id !== role.id));
      setOk(`Role "${role.name}" deleted.`);
      setTimeout(() => setOk(''), 3000);
    } catch (ex) {
      setErr(ex.message || 'Delete failed.');
    } finally {
      setDeleting(null);
    }
  }

  if (loading) return (
    <div className="prfl-card">
      <SectionHeader icon={<Shield size={15}/>} title="Custom Roles" />
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
        <Loader size={18} className="spin" />
      </div>
    </div>
  );

  return (
    <>
      <div className="prfl-card">
        {/* Card header */}
        <div className="rc-header">
          <div className="rc-header-left">
            <span className="rc-header-icon"><Shield size={15}/></span>
            <span className="rc-header-title">Custom Roles</span>
            <span className="rc-header-count">{roles.length}</span>
          </div>
          <button className="up-btn-primary rc-new-btn" onClick={openCreate}>
            + New Role
          </button>
        </div>

        {err && <div className="prfl-alert prfl-alert--error rc-alert">{err}</div>}
        {ok  && <div className="prfl-alert prfl-alert--success rc-alert">{ok}</div>}

        {/* Role list */}
        {roles.length === 0 ? (
          <div className="rc-empty">
            <Shield size={32} className="rc-empty-icon" />
            <p>No roles yet. Create your first role to bundle permissions.</p>
            <button className="up-btn-primary" onClick={openCreate}>+ Create first role</button>
          </div>
        ) : (
          <div className="rc-list">
            {roles.map(role => {
              const permCount = (role.permissions || []).length;
              return (
                <div key={role.id} className={`rc-row${role.is_active ? '' : ' rc-row--inactive'}`}>
                  {/* Shield icon */}
                  <div className="rc-row-icon">
                    <Shield size={17}/>
                  </div>
                  {/* Info */}
                  <div className="rc-row-info">
                    <div className="rc-row-name">
                      {role.name}
                      {!role.is_active && <span className="rc-row-badge rc-row-badge--inactive">Inactive</span>}
                    </div>
                    {role.description && <div className="rc-row-desc">{role.description}</div>}
                    <div className="rc-row-meta">
                      <span className="rc-row-perms">{permCount} permission{permCount !== 1 ? 's' : ''}</span>
                      {(role.user_count > 0) && (
                        <span className="rc-row-perms" style={{ color: '#0891b2' }}>{role.user_count} user{role.user_count !== 1 ? 's' : ''}</span>
                      )}
                      {permCount > 0 && (
                        <span className="rc-row-codes">
                          {(role.permissions || []).slice(0, 3).map(c => (
                            <span key={c} className="rc-row-code">{c.replace(/_/g, ' ')}</span>
                          ))}
                          {permCount > 3 && <span className="rc-row-code rc-row-code--more">+{permCount - 3} more</span>}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Actions */}
                  <div className="rc-row-actions">
                    <button className="up-btn-ghost rc-action-btn" onClick={() => openEdit(role)}>
                      <Edit2 size={13}/> Edit
                    </button>
                    <button
                      className="up-btn-ghost rc-action-btn rc-action-btn--danger"
                      onClick={() => handleDelete(role)}
                      disabled={deleting === role.id}
                    >
                      {deleting === role.id
                        ? <><Loader size={12} className="spin"/> Deleting…</>
                        : <><X size={13}/> Delete</>}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Create / Edit Modal ── */}
      {modalOpen && (
        <div className="up-pw-overlay rc-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModalOpen(false); }}>
          <div className="rc-modal" onClick={e => e.stopPropagation()}>

            {/* Modal header */}
            <div className="rc-modal-hd">
              <div className="rc-modal-title">
                <Shield size={16} style={{ color: 'var(--primary)', flexShrink: 0 }}/>
                {editRole ? `Edit Role: ${editRole.name}` : 'Create New Role'}
              </div>
              <button className="rc-modal-close" onClick={() => setModalOpen(false)} type="button">
                <X size={17}/>
              </button>
            </div>

            <form onSubmit={handleSave}>
              {/* Fields row */}
              <div className="rc-modal-fields">
                {formErr && <div className="prfl-alert prfl-alert--error" style={{ gridColumn: '1/-1' }}>{formErr}</div>}

                <div className="prfl-field">
                  <label>Role Name *</label>
                  <input
                    value={form.name} required
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Telecaller, Hub Manager, Field Agent"
                  />
                </div>

                <div className="prfl-field">
                  <label>Description</label>
                  <input
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="What this role is used for (optional)"
                  />
                </div>

                <div className="rc-active-toggle">
                  <input
                    type="checkbox" id="rc-is-active"
                    checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                    className="up-fg-checkbox"
                  />
                  <label htmlFor="rc-is-active">Active role</label>
                </div>
              </div>

              {/* Two-column permission picker — same as UsersPage */}
              <div className="rc-modal-perms-hd">
                Permissions
                <span className="rc-perms-count">{form.permissions.length} selected</span>
              </div>

              <div className="up-fg-perms rc-perms-picker">
                <div className="up-fg-header">Select permissions for this role</div>
                <div className="up-fg-body">
                  {/* Left: category sidebar */}
                  <div className="up-fg-sidebar">
                    {groupOrder.map(group => {
                      const enabledCount = (grouped[group] || []).filter(p => form.permissions.includes(p.code)).length;
                      const isActive = resolvedGroup === group;
                      return (
                        <button
                          key={group}
                          type="button"
                          className={`up-fg-cat${isActive ? ' up-fg-cat--active' : ''}`}
                          onClick={() => setActiveGroup(group)}
                        >
                          <span className="up-fg-cat-icon">{roleGroupIcon(group)}</span>
                          <span className="up-fg-cat-label">{group}</span>
                          {enabledCount > 0 && (
                            <span className="up-fg-cat-badge">{enabledCount}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Right: permissions for selected category */}
                  <div className="up-fg-perm-list">
                    {(grouped[resolvedGroup] || []).map(p => (
                      <label
                        key={p.code}
                        className={`up-fg-perm-row${form.permissions.includes(p.code) ? ' up-fg-perm-row--checked' : ''}`}
                      >
                        <input
                          type="checkbox"
                          className="up-fg-checkbox"
                          checked={form.permissions.includes(p.code)}
                          onChange={() => togglePerm(p.code)}
                        />
                        <div className="up-fg-perm-text">
                          <div className="up-fg-perm-label">{p.label}</div>
                          {p.description && <div className="up-fg-perm-desc">{p.description}</div>}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="rc-modal-footer">
                <button type="button" className="up-btn-ghost" onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="up-btn-primary" disabled={saving}>
                  {saving
                    ? <><Loader size={13} className="spin"/> Saving…</>
                    : (editRole ? '💾 Update Role' : '✓ Create Role')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
