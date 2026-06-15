import { useEffect, useState, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useBodyLock } from '../hooks/useBodyLock.js';

// ── Role badge helper ────────────────────────────────────────────────────────
function roleBadge(user) {
  if (user.is_super_admin) return { label: 'Super Admin', color: '#16a34a', bg: 'rgba(34,197,94,.10)', icon: '🏅' };
  if (user.role_name)      return { label: user.role_name, color: '#0891b2', bg: 'rgba(8,145,178,.10)', icon: '🛡️' };
  if ((user.permissions || []).length > 0) return { label: 'Custom', color: '#6b7280', bg: 'rgba(107,114,128,.10)', icon: '⚙️' };
  return { label: 'No Role', color: '#9ca3af', bg: 'rgba(156,163,175,.10)', icon: '—' };
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const location = useLocation();
  const [users, setUsers]             = useState([]);
  const [catalog, setCatalog]         = useState([]);
  const [departments, setDepartments] = useState([]);
  const [selectedId, setSelectedId]   = useState(null);
  const [search, setSearch]           = useState('');
  const [creating, setCreating]       = useState(false);
  const [error, setError]             = useState(null);
  const [activeTab, setActiveTab] = useState(
    me?.permissions?.includes('VIEW_TEAM_LEADS') && !me?.is_super_admin && !me?.permissions?.includes('MANAGE_USERS')
      ? 'my-team'
      : 'all'
  ); // 'all' | 'my-team' | 'hubs'
  const [hubLogins, setHubLogins]         = useState([]);
  const [hubLoginsLoaded, setHubLoginsLoaded] = useState(false);
  const [selectedHubLogin, setSelectedHubLogin] = useState(null);
  const [allRoles, setAllRoles]           = useState([]);

  const isManager          = me?.permissions?.includes('VIEW_TEAM_LEADS') && !me?.is_super_admin && !me?.permissions?.includes('MANAGE_USERS');
  const canManageTeamPerms = me?.permissions?.includes('MANAGE_TEAM_PERMISSIONS');
  const myTeam             = useMemo(() => users.filter(u => u.manager_id === me?.id), [users, me]);

  const load = useCallback(async () => {
    if (isManager) {
      // Managers get scoped team list. Also fetch catalog if they can manage team permissions.
      if (canManageTeamPerms) {
        const [u, p, d] = await Promise.all([api('/api/users'), api('/api/users/permissions'), api('/api/departments')]);
        setUsers(u.items);
        setCatalog(p.items);
        setDepartments(d.items);
      } else {
        const [u, d] = await Promise.all([api('/api/users'), api('/api/departments')]);
        setUsers(u.items);
        setDepartments(d.items);
      }
    } else {
      const [u, p, d] = await Promise.all([
        api('/api/users'),
        api('/api/users/permissions'),
        api('/api/departments'),
      ]);
      setUsers(u.items);
      setCatalog(p.items);
      setDepartments(d.items);
    }
  }, [isManager, canManageTeamPerms]);

  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  // Fetch roles once at page level — passed down to avoid re-fetching per user
  useEffect(() => {
    api('/api/roles').then(r => setAllRoles((r.items || []).filter(x => x.is_active))).catch(() => {});
  }, []);

  // Open a specific user when navigated from global search
  useEffect(() => {
    const id = location.state?.openUserId;
    if (id) { setSelectedId(id); setCreating(false); }
  }, [location.state]);

  // Super Admins are site-level owners — exclude them from the regular user list
  const nonSuperAdmins = useMemo(() => users.filter(u => !u.is_super_admin), [users]);

  const filtered = useMemo(() => {
    const base = activeTab === 'my-team' ? myTeam : nonSuperAdmins;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((u) =>
      u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }, [nonSuperAdmins, myTeam, search, activeTab]);

  const selected = users.find((u) => u.id === selectedId) || null;
  const activeCount = nonSuperAdmins.filter(u => u.is_active).length;

  // Load hub logins when the Hubs tab is first opened
  useEffect(() => {
    if (activeTab === 'hubs' && !hubLoginsLoaded) {
      api('/api/hubs/logins')
        .then(r => { setHubLogins(r.items || []); setHubLoginsLoaded(true); })
        .catch(() => setHubLoginsLoaded(true));
    }
  }, [activeTab, hubLoginsLoaded]);

  function selectUser(id) {
    setSelectedId(id);
    setCreating(false);
  }

  function openNew() {
    setCreating(true);
    setSelectedId(null);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Users &amp; Permissions</h2>
          <p>Manage team access and grant per-user permissions.</p>
        </div>
        {!isManager && activeTab !== 'hubs' && (
          <button className="up-btn-primary" onClick={openNew}>
            + New User
          </button>
        )}
      </div>

      {error && <div className="banner error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="up-layout">
        {/* ── Left: user list ── */}
        <aside className="up-sidebar">
          <div className="up-sidebar-head">
            {/* Tab bar — only shown for full admins with MANAGE_USERS */}
            {!isManager && (
              <div className="up-tab-bar">
                <button
                  className={`up-tab ${activeTab === 'all' ? 'up-tab--active' : ''}`}
                  onClick={() => { setActiveTab('all'); setSelectedId(null); setCreating(false); setSelectedHubLogin(null); }}>
                  All Users
                </button>
                <button
                  className={`up-tab ${activeTab === 'hubs' ? 'up-tab--active' : ''}`}
                  onClick={() => { setActiveTab('hubs'); setSelectedId(null); setCreating(false); setSelectedHubLogin(null); }}>
                  Hubs
                  {hubLoginsLoaded && hubLogins.length > 0 && (
                    <span className="up-tab-badge">{hubLogins.length}</span>
                  )}
                </button>
              </div>
            )}
            {/* Managers see a simple "My Team" heading instead */}
            {isManager && (
              <div className="up-tab-bar">
                <span className="up-tab up-tab--active">
                  My Team
                  {users.length > 0 && <span className="up-tab-badge">{users.length}</span>}
                </span>
              </div>
            )}
            {activeTab !== 'hubs' && (
              <div className="up-search-wrap">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  placeholder={activeTab === 'my-team' ? 'Search my team…' : 'Search users…'}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            )}
            <div className="up-sidebar-stats">
              {activeTab === 'my-team' ? (
                <>
                  <span>{myTeam.length} member{myTeam.length !== 1 ? 's' : ''}</span>
                  <span className="up-dot" />
                  <span>{myTeam.filter(u => u.is_active).length} active</span>
                </>
              ) : activeTab === 'hubs' ? (
                <>
                  <span>{hubLogins.length} hub login{hubLogins.length !== 1 ? 's' : ''}</span>
                  <span className="up-dot" />
                  <span>{hubLogins.filter(u => u.is_active).length} active</span>
                </>
              ) : (
                <>
                  <span>{nonSuperAdmins.length} total</span>
                  <span className="up-dot" />
                  <span>{activeCount} active</span>
                </>
              )}
            </div>
          </div>

          {/* ── Hubs tab list ─────────────────────────────────────── */}
          {activeTab === 'hubs' && (
            <ul className="up-user-list">
              {!hubLoginsLoaded && (
                <li className="up-empty">Loading…</li>
              )}
              {hubLoginsLoaded && hubLogins.length === 0 && (
                <li className="up-empty">No hub logins created yet. Open a hub and use the "Hub Login" section to create one.</li>
              )}
              {hubLogins.map((u) => (
                <li
                  key={u.id}
                  className={['up-user-row', !u.is_active ? 'inactive' : '', selectedHubLogin?.id === u.id ? 'selected' : ''].filter(Boolean).join(' ')}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedHubLogin(u)}
                >
                  <div className={`up-avatar ${!u.is_active ? 'dim' : ''}`} style={{ background: '#0891b2', color: '#fff' }}>
                    {u.hub_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="up-user-info">
                    <div className="up-user-name">
                      {u.hub_name}
                      {!u.is_active && <span className="up-pill">inactive</span>}
                    </div>
                    <div className="up-user-row-meta">
                      <span className="up-role-badge" style={{ color: '#0891b2', background: 'rgba(8,145,178,.10)' }}>
                        🏪 Hub Login
                      </span>
                      <span className="up-user-manager-tag">{u.email}</span>
                      <span style={{
                        fontSize: 11, fontWeight: 600, borderRadius: 10,
                        padding: '1px 7px',
                        background: u.permissions?.length > 0 ? 'rgba(16,185,129,.12)' : 'rgba(156,163,175,.12)',
                        color:      u.permissions?.length > 0 ? '#059669' : '#9ca3af',
                      }}>
                        {u.permissions?.length || 0} permission{(u.permissions?.length || 0) !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                  <svg className="up-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </li>
              ))}
            </ul>
          )}

          {/* ── All Users / My Team list ───────────────────────── */}
          {activeTab !== 'hubs' && <ul className="up-user-list">
            {filtered.length === 0 && (
              <li className="up-empty">
                {activeTab === 'my-team' && myTeam.length === 0
                  ? 'No users are assigned to you yet. Ask an admin to set your name as manager on a user.'
                  : 'No users match.'}
              </li>
            )}
            {filtered.map((u) => (
              <li
                key={u.id}
                className={[
                  'up-user-row',
                  u.id === selectedId ? 'selected' : '',
                  !u.is_active ? 'inactive' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => selectUser(u.id)}
              >
                <div className={`up-avatar ${u.is_super_admin ? 'super' : ''} ${!u.is_active ? 'dim' : ''}`}>
                  {u.name.charAt(0).toUpperCase()}
                </div>
                <div className="up-user-info">
                  <div className="up-user-name">
                    {u.name}
                    {u.id === me.id && <span className="up-pill self">you</span>}
                    {!u.is_active && <span className="up-pill">inactive</span>}
                    {activeTab === 'all' && u.manager_id === me.id && <span className="up-pill team">my team</span>}
                  </div>
                  <div className="up-user-row-meta">
                    {(() => { const r = roleBadge(u); return (
                      <span className="up-role-badge" style={{ color: r.color, background: r.bg }}>
                        {r.icon} {r.label}
                      </span>
                    ); })()}
                    {u.manager_name && (
                      <span className="up-user-manager-tag">under {u.manager_name}</span>
                    )}
                  </div>
                </div>
                <svg className="up-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </li>
            ))}
          </ul>}
        </aside>

        {/* ── Right: detail / form ── */}
        <section className="up-detail">
          {activeTab === 'hubs' && selectedHubLogin ? (
            <HubLoginDetail
              key={selectedHubLogin.id}
              hubLogin={selectedHubLogin}
              catalog={catalog}
              onSaved={(updated) => {
                setHubLogins(prev => prev.map(h => h.id === updated.id ? { ...h, permissions: updated.permissions } : h));
                setSelectedHubLogin(prev => ({ ...prev, permissions: updated.permissions }));
              }}
            />
          ) : creating && !isManager ? (
            <NewUserForm
              catalog={catalog}
              users={users}
              departments={departments}
              allRoles={allRoles}
              onCancel={() => setCreating(false)}
              onCreated={async (newUser) => {
                await load();
                setCreating(false);
                setSelectedId(newUser.id);
              }}
              onError={setError}
            />
          ) : selected ? (
            <UserDetail
              key={selected.id}
              user={selected}
              me={me}
              catalog={catalog}
              users={users}
              departments={departments}
              allRoles={allRoles}
              readOnly={isManager && !canManageTeamPerms}
              canManageTeamPerms={isManager && canManageTeamPerms}
              onChange={async () => { await load(); }}
              onDeleted={async () => { await load(); setSelectedId(null); }}
              onError={setError}
            />
          ) : (
            <div className="up-empty-state">
              <div className="up-empty-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </div>
              <p>{activeTab === 'hubs' ? 'Select a hub to manage its permissions' : 'Select a user to view details'}</p>
              {!isManager && activeTab !== 'hubs' && (
                <button className="up-btn-ghost" onClick={openNew}>+ Create new user</button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// =====================================================================
// New user form
// =====================================================================
function NewUserForm({ catalog, users, departments, allRoles = [], onCancel, onCreated, onError }) {
  const [form, setForm] = useState({
    name: '', email: '', password: '',
    is_super_admin: false, is_active: true,
    manager_id: '',
  });
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [perms, setPerms]                   = useState(new Set());
  const [submitting, setSubmitting]         = useState(false);

  const dbRoles = allRoles; // use roles passed from parent — no extra fetch needed

  // Default to first role when allRoles loads
  useEffect(() => {
    if (allRoles.length > 0 && selectedRoleId === null) {
      setSelectedRoleId(allRoles[0].id);
      setPerms(new Set(allRoles[0].permissions || []));
    }
  }, [allRoles]);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  function pickRole(role) {
    setSelectedRoleId(role.id);
    setPerms(new Set(role.permissions || []));
  }

  function togglePerm(code) {
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
    // Do NOT reset selectedRole here — the role card shows which base role
    // was chosen; fine-tuning permissions on top of it is expected and
    // should not wipe the Manager / Admin label from the card.
  }

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const data = await api('/api/users', {
        method: 'POST',
        body: {
          ...form,
          manager_id: form.manager_id ? Number(form.manager_id) : null,
          role_id: selectedRoleId ?? null,
          permissions: Array.from(perms),
        },
      });
      onCreated(data.item);
    } catch (err) {
      onError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const selectedDbRole = dbRoles.find(r => r.id === selectedRoleId);
  const isManager = selectedDbRole
    ? (selectedDbRole.permissions || []).includes('VIEW_TEAM_LEADS') || (selectedDbRole.permissions || []).includes('MANAGE_USERS')
    : false;
  const managersOnly = users.filter(u => u.is_active && (u.is_super_admin || (u.permissions || []).includes('VIEW_TEAM_LEADS')));

  return (
    <form className="up-form" onSubmit={submit}>
      <div className="up-form-header">
        <div className="up-form-title">
          <div className="up-avatar new">N</div>
          <div>
            <h3>New User</h3>
            <p className="up-form-sub">Fill in the details to create an account.</p>
          </div>
        </div>
        <button type="button" className="up-btn-ghost" onClick={onCancel}>Cancel</button>
      </div>

      {/* ── Step 1: Role ── */}
      <div className="up-section">
        <div className="up-section-label">1 · Role</div>

        {dbRoles.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No custom roles found. Create roles from the Custom Roles page first.</p>
        ) : (
          <div className="up-role-grid">
            {dbRoles.map(role => {
              const active = selectedRoleId === role.id;
              return (
                <button
                  key={role.id} type="button"
                  className={`up-role-card ${active ? 'up-role-card--active' : ''}`}
                  style={active ? { borderColor: 'var(--primary)', background: 'rgba(22,185,148,0.08)' } : {}}
                  onClick={() => pickRole(role)}
                >
                  <span className="up-role-card-icon">🛡️</span>
                  <span className="up-role-card-label" style={active ? { color: 'var(--primary)' } : {}}>{role.name}</span>
                  <span className="up-role-card-desc">{role.description || `${(role.permissions || []).length} permissions`}</span>
                  {active && <span className="up-role-card-check" style={{ background: 'var(--primary)' }}>✓</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Step 2: Reporting structure ── */}
      <div className="up-section">
        <div className="up-section-label">2 · Reporting Structure</div>
        {isManager ? (
          <div className="up-reporting-banner up-reporting-banner--manager">
            <span style={{ fontSize: 20 }}>👤</span>
            <div>
              <div className="up-reporting-title">This user is a Manager</div>
              <div className="up-reporting-desc">They will be able to see leads from callers assigned under them. Assign callers to this manager after creation.</div>
            </div>
          </div>
        ) : (
          <>
            <div className="up-reporting-banner up-reporting-banner--caller">
              <span style={{ fontSize: 20 }}>📞</span>
              <div>
                <div className="up-reporting-title">This user reports to a manager</div>
                <div className="up-reporting-desc">Assign a manager so they can monitor this user's leads.</div>
              </div>
            </div>
            <div className="up-field" style={{ marginTop: 10 }}>
              <label>Assigned Manager <span className="up-optional">optional</span></label>
              <select value={form.manager_id} onChange={(e) => set('manager_id', e.target.value)}>
                <option value="">No manager assigned</option>
                {managersOnly.map(u => (
                  <option key={u.id} value={u.id}>{u.name}{u.is_super_admin ? ' (Super Admin)' : ' (Manager)'}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {/* ── Step 3: Account details ── */}
      <div className="up-section">
        <div className="up-section-label">3 · Account Details</div>
        <div className="up-form-grid">
          <div className="up-field">
            <label>Full Name</label>
            <input required placeholder="e.g. Priya Sharma" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="up-field">
            <label>Email Address</label>
            <input required type="email" placeholder="priya@example.com" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div className="up-field">
            <label>Password</label>
            <input required type="password" minLength={6} placeholder="Min. 6 characters" value={form.password} onChange={(e) => set('password', e.target.value)} />
          </div>
          <div className="up-field">
            <label>Mobile <span className="up-optional">optional</span></label>
            <input type="tel" placeholder="+91 98765 43210" value={form.mobile || ''} onChange={(e) => set('mobile', e.target.value)} />
          </div>
          <div className="up-field">
            <label>Department <span className="up-optional">optional</span></label>
            <select value={form.department || ''} onChange={(e) => set('department', e.target.value)}>
              <option value="">— Select department —</option>
              {(departments || []).filter(d => d.is_active).map(d => (
                <option key={d.id} value={d.name}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className="up-field">
            <label>Joining Date <span className="up-optional">optional</span></label>
            <input type="date" value={form.joining_date || ''} onChange={(e) => set('joining_date', e.target.value)} />
          </div>
        </div>
      </div>

      {/* ── Step 4: Permissions (collapsible detail) ── */}
      {!form.is_super_admin && (
        <div className="up-section">
          <div className="up-section-label">4 · Permissions <span className="up-optional">auto-set by role · adjust if needed</span></div>
          <PermissionPicker
            catalog={catalog}
            selected={perms}
            onToggle={togglePerm}
          />
        </div>
      )}

      <div className="up-form-footer">
        <button type="button" className="up-btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="up-btn-primary" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create User'}
        </button>
      </div>
    </form>
  );
}

// =====================================================================
// User detail (edit)
// =====================================================================
const ADMIN_PERMISSIONS = ['MANAGE_USERS', 'MANAGE_TEAM_PERMISSIONS', 'MANAGE_PRICING', 'MANAGE_MASTER_DATA'];

function UserDetail({ user, me, catalog, users, departments, allRoles = [], readOnly, canManageTeamPerms, onChange, onDeleted, onError }) {
  const isSelf = user.id === me.id;
  const [perms, setPerms]           = useState(new Set(user.permissions));
  const [managerId, setManagerId]   = useState(user.manager_id ? String(user.manager_id) : '');
  const [busy, setBusy]             = useState(false);
  const [pwModal, setPwModal]       = useState(false);
  const [newPw, setNewPw]           = useState('');
  const [editModal, setEditModal]   = useState(false);
  const [editName, setEditName]     = useState(user.name);
  const [editEmail, setEditEmail]   = useState(user.email);
  const [editDept, setEditDept]     = useState(user.department || '');
  const [editRoleId, setEditRoleId] = useState(user.role_id ?? null);
  useBodyLock(pwModal);
  useBodyLock(editModal);

  useEffect(() => {
    setPerms(new Set(user.permissions));
    setManagerId(user.manager_id ? String(user.manager_id) : '');
    setEditRoleId(user.role_id ?? null);
  }, [user]);

  function togglePerm(code) {
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }

  async function patchUser(body) {
    setBusy(true);
    try {
      await api(`/api/users/${user.id}`, { method: 'PATCH', body });
      await onChange();
    } catch (err) { onError(err.message); }
    finally { setBusy(false); }
  }

  async function savePermissions() {
    setBusy(true);
    try {
      await api(`/api/users/${user.id}/permissions`, {
        method: 'PUT',
        body: { permissions: Array.from(perms) },
      });
      await onChange();
    } catch (err) { onError(err.message); }
    finally { setBusy(false); }
  }

  async function submitPassword(e) {
    e.preventDefault();
    await patchUser({ password: newPw });
    setPwModal(false);
    setNewPw('');
  }

  async function remove() {
    if (!window.confirm(`Delete ${user.name}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api(`/api/users/${user.id}`, { method: 'DELETE' });
      await onDeleted();
    } catch (err) { onError(err.message); }
    finally { setBusy(false); }
  }

  const granted = new Set(user.permissions);
  const dirty   = perms.size !== granted.size || [...perms].some((p) => !granted.has(p));
  const managerDirty = String(user.manager_id ?? '') !== managerId;

  return (
    <div className="up-detail-inner">
      {/* ── User header ── */}
      <div className="up-detail-header">
        <div className={`up-avatar lg ${user.is_super_admin ? 'super' : ''} ${!user.is_active ? 'dim' : ''}`}>
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="up-detail-title">
          <div className="up-detail-name">
            {user.name}
            {user.id === me.id  && <span className="up-pill self">you</span>}
            {!user.is_active    && <span className="up-pill">inactive</span>}
          </div>
          <div className="up-detail-email">{user.email}</div>
          <div className="up-detail-role-row">
            {(() => { const r = roleBadge(user); return (
              <span className="up-role-badge up-role-badge--lg" style={{ color: r.color, background: r.bg, borderColor: r.color + '40' }}>
                {r.icon} {r.label}
              </span>
            ); })()}
            {user.manager_name && (
              <span className="up-reports-to">
                reports to <strong>{user.manager_name}</strong>
              </span>
            )}
          </div>
        </div>
        {/* ── Joining date (right side) — uses joining_date if set, falls back to account created_at ── */}
        {(user.joining_date || user.created_at) && (
          <div className="up-detail-joined">
            <div className="up-detail-joined-label">{user.joining_date ? 'Joining Date' : 'Account Created'}</div>
            <div className="up-detail-joined-value">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              {new Date(user.joining_date || user.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          </div>
        )}
      </div>

      {/* ── Actions / Manager / Permissions — hidden for read-only (manager) viewers ── */}
      {!readOnly && <div className="up-section">
        <div className="up-section-label">Actions</div>
        <div className="up-action-row">
          <button
            className="up-action-btn"
            onClick={() => { setEditName(user.name); setEditEmail(user.email); setEditDept(user.department || ''); setEditRoleId(user.role_id ?? null); setEditModal(true); }}
            disabled={busy}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit
          </button>
          <button
            className={`up-action-btn ${!user.is_active ? 'success' : ''}`}
            onClick={() => patchUser({ is_active: !user.is_active })}
            disabled={busy || isSelf}
          >
            {user.is_active ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                Deactivate
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                Reactivate
              </>
            )}
          </button>

          {me?.is_super_admin && (
          <button
            className={`up-action-btn ${user.is_super_admin ? 'warning' : ''}`}
            onClick={() => patchUser({ is_super_admin: !user.is_super_admin })}
            disabled={busy || isSelf}
          >
            {user.is_super_admin ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                Remove Super Admin
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                Make Super Admin
              </>
            )}
          </button>
          )}

          <button
            className="up-action-btn"
            onClick={() => { setPwModal(true); setNewPw(''); }}
            disabled={busy}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Reset Password
          </button>

          <button
            className="up-action-btn danger"
            onClick={remove}
            disabled={busy || isSelf}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            Delete
          </button>
        </div>
        {isSelf && <p className="up-hint" style={{ marginTop: 6 }}>Some actions are disabled because this is your own account.</p>}
      </div>}

      {/* ── Assigned Manager / Admin ── */}
      {!readOnly && (() => {
        // Determine role level of the user being viewed
        const userPerms = new Set(user.permissions || []);
        const viewedIsManager = userPerms.has('VIEW_TEAM_LEADS') && !userPerms.has('MANAGE_USERS') && !user.is_super_admin;
        const viewedIsAdmin   = userPerms.has('MANAGE_USERS') && !user.is_super_admin;

        // If user is a manager → their superior must be an admin or super admin
        // If user is a caller  → their superior must be a manager (VIEW_TEAM_LEADS)
        // If user is an admin  → their superior must be a super admin only
        let superiors;
        let assignLabel;
        let emptyMsg;
        let hint;

        if (viewedIsAdmin) {
          superiors  = users.filter(u => u.is_active && u.id !== user.id && u.is_super_admin);
          assignLabel = 'Assigned Super Admin';
          emptyMsg   = 'No Super Admins found.';
          hint       = 'Gives the Super Admin oversight over this admin.';
        } else if (viewedIsManager) {
          superiors  = users.filter(u => u.is_active && u.id !== user.id && (u.is_super_admin || (u.permissions || []).includes('MANAGE_USERS')));
          assignLabel = 'Assigned Admin';
          emptyMsg   = 'No admins found — create an admin first.';
          hint       = 'Gives the admin visibility over this manager\'s team.';
        } else {
          superiors  = users.filter(u => u.is_active && u.id !== user.id && !u.is_super_admin && (u.permissions || []).includes('VIEW_TEAM_LEADS'));
          assignLabel = 'Assigned Manager';
          emptyMsg   = 'No managers found — create a manager first.';
          hint       = 'Gives the manager visibility over this user\'s leads.';
        }

        const roleLabel = u => {
          if (u.is_super_admin) return ' (Super Admin)';
          if ((u.permissions || []).includes('MANAGE_USERS')) return ' (Admin)';
          if ((u.permissions || []).includes('VIEW_TEAM_LEADS')) return ' (Manager)';
          return '';
        };

        return (
          <div className="up-section">
            <div className="up-section-label">{assignLabel}</div>
            {superiors.length === 0 ? (
              <div className="up-no-superiors-banner">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {emptyMsg}
              </div>
            ) : (
              <div className="up-manager-row">
                <select
                  className="up-select"
                  value={managerId}
                  onChange={(e) => setManagerId(e.target.value)}
                  disabled={busy}
                >
                  <option value="">No {assignLabel.replace('Assigned ', '').toLowerCase()}</option>
                  {superiors.map((u) => (
                    <option key={u.id} value={String(u.id)}>
                      {u.name}{roleLabel(u)}
                    </option>
                  ))}
                </select>
                <button
                  className="up-btn-primary"
                  onClick={() => patchUser({ manager_id: managerId ? Number(managerId) : null })}
                  disabled={busy || !managerDirty}
                >
                  Save
                </button>
              </div>
            )}
            <p className="up-hint">{hint}</p>
          </div>
        );
      })()}

      {/* ── Permissions ── */}
      {!readOnly && (
        <div className="up-section">
          <div className="up-section-label">Permissions</div>
          {user.is_super_admin ? (
            <div className="up-super-banner">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              <span>Super Admin — all permissions granted automatically. Remove the Super Admin flag to manage individual permissions.</span>
            </div>
          ) : (
            <>
              <PermissionPicker
                catalog={catalog}
                selected={perms}
                onToggle={togglePerm}
              />
              <div className="up-form-footer" style={{ marginTop: 16, paddingTop: 0, borderTop: 'none' }}>
                <button
                  className="up-btn-primary"
                  onClick={savePermissions}
                  disabled={busy || !dirty}
                >
                  {dirty ? 'Save Permissions' : 'No Changes'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Read-only permissions showcase (manager view) ── */}
      {readOnly && (
        <div className="up-section">
          <div className="up-section-label">Permissions</div>
          {user.is_super_admin ? (
            <div className="up-super-banner">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              <span>Super Admin — has full access to everything.</span>
            </div>
          ) : user.permissions.length === 0 ? (
            <p className="up-hint">No permissions assigned.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
              {user.permissions.map((code) => (
                <span key={code} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  padding: '4px 10px', borderRadius: '6px',
                  background: 'var(--bg-subtle, #f3f4f6)',
                  border: '1px solid var(--border, #e5e7eb)',
                  fontSize: '12px', fontWeight: 500,
                  color: 'var(--text, #374151)',
                }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  {code.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Team permissions editor (manager with MANAGE_TEAM_PERMISSIONS) ── */}
      {canManageTeamPerms && (
        <div className="up-section">
          <div className="up-section-label">
            Permissions
            <span className="up-optional" style={{ marginLeft: 6 }}>team member · admin permissions excluded</span>
          </div>
          {catalog.filter(p => !ADMIN_PERMISSIONS.includes(p.code)).length === 0 ? (
            <p className="up-hint">No assignable permissions available.</p>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                {Object.entries(
                  catalog
                    .filter(p => !ADMIN_PERMISSIONS.includes(p.code))
                    .reduce((acc, p) => { (acc[p.group] = acc[p.group] || []).push(p); return acc; }, {})
                ).map(([group, items]) => (
                  <div key={group}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-muted)', margin: '10px 0 6px' }}>{group}</div>
                    {items.map(p => (
                      <label key={p.code} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                        <input
                          type="checkbox"
                          checked={perms.has(p.code)}
                          onChange={() => {
                            const next = new Set(perms);
                            next.has(p.code) ? next.delete(p.code) : next.add(p.code);
                            setPerms(next);
                          }}
                          style={{ marginTop: 2, accentColor: 'var(--primary)', flexShrink: 0 }}
                        />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{p.label}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>{p.description}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 14 }}>
                <button
                  className="up-btn-primary"
                  onClick={savePermissions}
                  disabled={busy || !dirty}
                >
                  {dirty ? 'Save Permissions' : 'No Changes'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Edit user inline modal ── */}
      {editModal && (
        <div className="up-pw-overlay" onClick={() => setEditModal(false)}>
          <form className="up-pw-modal" onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const patch = {
                name:       editName.trim(),
                email:      editEmail.trim().toLowerCase(),
                department: editDept || null,
                role_id:    editRoleId ?? null,
              };
              // If role changed, also replace permissions with the new role's permissions
              if (editRoleId !== (user.role_id ?? null)) {
                const newRole = allRoles.find(r => r.id === editRoleId);
                patch.permissions = newRole ? (newRole.permissions || []) : [];
              }
              await patchUser(patch);
              setEditModal(false);
            } catch (err) { onError(err.message); }
            finally { setBusy(false); }
          }} onClick={(e) => e.stopPropagation()}>
            <h4>Edit User</h4>
            <p className="up-hint" style={{ marginBottom: 12 }}>Update details for <strong>{user.name}</strong>.</p>
            <div className="up-field">
              <label>Name</label>
              <input
                type="text"
                autoFocus
                required
                minLength={1}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)' }}
              />
            </div>
            <div className="up-field" style={{ marginTop: 10 }}>
              <label>Email</label>
              <input
                type="email"
                required
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)' }}
              />
            </div>
            <div className="up-field" style={{ marginTop: 10 }}>
              <label>Department <span className="up-optional">optional</span></label>
              <select
                value={editDept}
                onChange={(e) => setEditDept(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)' }}
              >
                <option value="">— Select department —</option>
                {(departments || []).filter(d => d.is_active).map(d => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
              </select>
            </div>
            {!user.is_super_admin && allRoles.length > 0 && (
              <div className="up-field" style={{ marginTop: 10 }}>
                <label>Role</label>
                <select
                  value={editRoleId ?? ''}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : null;
                    setEditRoleId(id);
                  }}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, background: 'var(--bg)', color: 'var(--text)' }}
                >
                  <option value="">— No role —</option>
                  {allRoles.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button type="button" className="up-btn-ghost" onClick={() => setEditModal(false)}>Cancel</button>
              <button type="submit" className="up-btn-primary" disabled={busy}>Save Changes</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Reset password inline modal ── */}
      {pwModal && (
        <div className="up-pw-overlay" onClick={() => setPwModal(false)}>
          <form className="up-pw-modal" onSubmit={submitPassword} onClick={(e) => e.stopPropagation()}>
            <h4>Reset Password</h4>
            <p className="up-hint" style={{ marginBottom: 12 }}>Set a new password for <strong>{user.name}</strong>.</p>
            <div className="up-field">
              <label>New Password</label>
              <input
                type="password"
                autoFocus
                minLength={6}
                required
                placeholder="Min. 6 characters"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
              />
            </div>
            <div className="up-form-footer" style={{ marginTop: 16, paddingTop: 0, borderTop: 'none' }}>
              <button type="button" className="up-btn-ghost" onClick={() => setPwModal(false)}>Cancel</button>
              <button type="submit" className="up-btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Update Password'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Permission checklist (grouped) with role presets
// =====================================================================
function getGroupIcon(group) {
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

// =====================================================================
// Hub Login Detail — permission editor for hub login accounts
// =====================================================================
function HubLoginDetail({ hubLogin, catalog, onSaved }) {
  const [perms, setPerms] = useState(new Set(hubLogin.permissions || []));
  const [busy, setBusy]   = useState(false);
  const [msg, setMsg]     = useState('');

  useEffect(() => {
    setPerms(new Set(hubLogin.permissions || []));
    setMsg('');
  }, [hubLogin.id]);

  function togglePerm(code) {
    setPerms(prev => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  const granted = new Set(hubLogin.permissions || []);
  const dirty   = perms.size !== granted.size || [...perms].some(p => !granted.has(p));

  async function savePermissions() {
    setBusy(true); setMsg('');
    try {
      await api(`/api/users/${hubLogin.id}/permissions`, {
        method: 'PUT',
        body: { permissions: Array.from(perms) },
      });
      setMsg('Permissions saved');
      onSaved({ ...hubLogin, permissions: Array.from(perms) });
    } catch (err) {
      setMsg(err.message || 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="up-detail-inner">
      {/* Header */}
      <div className="up-detail-header">
        <div className="up-avatar lg" style={{ background: '#0891b2', color: '#fff' }}>
          {hubLogin.hub_name.charAt(0).toUpperCase()}
        </div>
        <div className="up-detail-title">
          <div className="up-detail-name">{hubLogin.hub_name}</div>
          <div className="up-detail-email">{hubLogin.email}</div>
          <div className="up-detail-role-row">
            <span className="up-role-badge up-role-badge--lg" style={{ color: '#0891b2', background: 'rgba(8,145,178,.10)', borderColor: '#0891b240' }}>
              🏪 Hub Login
            </span>
            <span style={{ fontSize: 12, color: hubLogin.is_active ? '#059669' : '#9ca3af', fontWeight: 500 }}>
              {hubLogin.is_active ? '● Active' : '○ Inactive'}
            </span>
          </div>
        </div>
      </div>

      {/* Hub Portal Access — toggleable feature switches */}
      <div className="up-section">
        <div className="up-section-label">
          Hub Portal Access
        </div>

        {/* Open access banner — shown when hub has zero permissions */}
        {perms.size === 0 && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 8,
            background: 'rgba(16,185,129,.07)', border: '1px solid rgba(16,185,129,.25)', marginBottom: 12 }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>🟢</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#065f46' }}>Full Portal Access (Open)</div>
              <div style={{ fontSize: 12, color: '#047857', marginTop: 2 }}>
                No restrictions set — hub can use all portal features. Enable specific features below to restrict access.
              </div>
            </div>
          </div>
        )}

        {/* Feature toggles */}
        {(() => {
          const HUB_FEATURES = [
            { label: 'View Estimates',            desc: 'See estimate list and details',                codes: ['VIEW_ESTIMATE'],                        staffOnly: false },
            { label: 'Create Estimates',           desc: 'Create new estimates for customers',           codes: ['CREATE_ESTIMATE'],                      staffOnly: false },
            { label: 'Edit & Submit Estimates',    desc: 'Update items, submit, manage work status',     codes: ['EDIT_ESTIMATE','SUBMIT_ESTIMATE'],       staffOnly: false },
            { label: 'Generate Spinoto Invoice',   desc: 'Generate purchase invoice after work done',    codes: ['CREATE_INVOICE'],                       staffOnly: false },
            { label: 'View Purchase Invoices',     desc: 'See Spinoto invoices and payout history',      codes: ['VIEW_INVOICE'],                         staffOnly: false },
            { label: 'View Appointments',          desc: 'See appointment list and details',             codes: ['VIEW_APPOINTMENT'],                     staffOnly: false },
            { label: 'View Pricing',               desc: 'See service pricing rules',                    codes: ['VIEW_PRICING_RULE'],                    staffOnly: false },
            { label: 'Approve Invoice',            desc: 'Approve & manage purchase invoices',           codes: ['APPROVE_PURCHASE_INVOICE'],             staffOnly: false },
            { label: 'Manage Hub Settings',        desc: 'Edit hub details, services and documents',     codes: ['EDIT_HUB'],                             staffOnly: false },
          ];
          const ALL_HUB_CODES = HUB_FEATURES.flatMap(f => f.codes);
          return HUB_FEATURES.map(({ label, desc, codes, staffOnly }) => {
          const isEnabled = staffOnly ? false : (perms.size === 0 ? true : codes.some(c => perms.has(c)));
          const isRestricted = perms.size > 0 && !staffOnly && !codes.some(c => perms.has(c));

          function toggleFeature() {
            if (staffOnly) return;
            setPerms(prev => {
              const next = new Set(prev);
              if (prev.size === 0) {
                // Full Portal Access → switch to restricted mode:
                // enable all codes EXCEPT the ones being toggled off
                ALL_HUB_CODES.forEach(c => next.add(c));
                codes.forEach(c => next.delete(c));
              } else {
                const currentlyOn = codes.some(c => next.has(c));
                codes.forEach(c => currentlyOn ? next.delete(c) : next.add(c));
              }
              return next;
            });
          }

          return (
            <div key={label}
              onClick={!staffOnly ? toggleFeature : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px', borderRadius: 8, marginBottom: 6,
                cursor: staffOnly ? 'default' : 'pointer',
                background: staffOnly ? 'rgba(156,163,175,.05)' : isEnabled ? 'rgba(16,185,129,.06)' : 'rgba(239,68,68,.05)',
                border: `1px solid ${staffOnly ? 'rgba(156,163,175,.2)' : isEnabled ? 'rgba(16,185,129,.25)' : 'rgba(239,68,68,.2)'}`,
                transition: 'all .15s',
              }}
            >
              {/* Toggle switch */}
              <div style={{
                width: 36, height: 20, borderRadius: 10, flexShrink: 0, transition: 'background .2s',
                background: isEnabled ? '#10b981' : '#d1d5db',
                position: 'relative',
              }}>
                <div style={{
                  position: 'absolute', top: 2, left: isEnabled ? 18 : 2,
                  width: 16, height: 16, borderRadius: '50%', background: '#fff',
                  boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'left .2s',
                }} />
              </div>

              {/* Label + desc */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600,
                  color: isEnabled ? 'var(--text)' : '#6b7280' }}>
                  {label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{desc}</div>
              </div>

              {/* Status label */}
              <span style={{ fontSize: 11, fontWeight: 600, flexShrink: 0,
                color: isEnabled ? '#059669' : '#ef4444' }}>
                {perms.size === 0 ? 'On (open)' : isEnabled ? 'On' : 'Off'}
              </span>
            </div>
          );
        });
        })()}

        {msg && (
          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 8,
            color: msg === 'Permissions saved' ? '#059669' : '#ef4444' }}>
            {msg}
          </div>
        )}
        <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="up-btn-primary" onClick={savePermissions} disabled={busy || !dirty}>
            {busy ? 'Saving…' : dirty ? 'Save Changes' : 'No Changes'}
          </button>
          {perms.size > 0 && (
            <button
              style={{ fontSize: 12, color: '#6b7280', background: 'none', border: '1px solid var(--border)',
                borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}
              onClick={() => setPerms(new Set())}
            >
              Reset to Open Access
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PermissionPicker({ catalog, selected, onToggle }) {
  const grouped = useMemo(() => {
    const map = {};
    for (const p of catalog) {
      if (!map[p.group]) map[p.group] = [];
      map[p.group].push(p);
    }
    return map;
  }, [catalog]);

  const groups = useMemo(() => Object.keys(grouped), [grouped]);
  const [activeGroup, setActiveGroup] = useState('');

  // Always resolve to a valid group
  const resolvedGroup = (activeGroup && groups.includes(activeGroup)) ? activeGroup : (groups[0] || '');

  return (
    <div className="up-perm-picker">

      {/* ── Fine-grained Permissions — two-column layout ── */}
      {groups.length > 0 && (
        <div className="up-fg-perms">
          <div className="up-fg-header">Fine-grained Permissions</div>
          <div className="up-fg-body">

            {/* Left: category nav */}
            <div className="up-fg-sidebar">
              {groups.map(group => {
                const enabledCount = grouped[group].filter(p => selected.has(p.code)).length;
                const isActive = resolvedGroup === group;
                return (
                  <button
                    key={group}
                    type="button"
                    className={`up-fg-cat${isActive ? ' up-fg-cat--active' : ''}`}
                    onClick={() => setActiveGroup(group)}
                  >
                    <span className="up-fg-cat-icon">{getGroupIcon(group)}</span>
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
              {(grouped[resolvedGroup] || []).map((p) => (
                <label
                  key={p.code}
                  className={`up-fg-perm-row${selected.has(p.code) ? ' up-fg-perm-row--checked' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="up-fg-checkbox"
                    checked={selected.has(p.code)}
                    onChange={() => onToggle(p.code)}
                  />
                  <div className="up-fg-perm-text">
                    <div className="up-fg-perm-label">{p.label}</div>
                    <div className="up-fg-perm-desc">{p.description}</div>
                  </div>
                </label>
              ))}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
