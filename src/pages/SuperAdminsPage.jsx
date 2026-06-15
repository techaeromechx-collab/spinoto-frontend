import { useEffect, useState, useCallback } from 'react';
import { Shield, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import '../styles/SuperAdminsPage.css';

export default function SuperAdminsPage() {
  const { user: me } = useAuth();
  const [superAdmins, setSuperAdmins] = useState([]);
  const [allUsers, setAllUsers]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [busy, setBusy]               = useState(false);
  const [grantModal, setGrantModal]   = useState(false);
  const [grantUserId, setGrantUserId] = useState('');
  const [toast, setToast]             = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [saRes, uRes] = await Promise.all([
        api('/api/users/super-admins'),
        api('/api/users/assignable'),
      ]);
      setSuperAdmins(saRes.items || []);
      setAllUsers(uRes.items || []);
    } catch (err) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleGrant() {
    if (!grantUserId) return;
    setBusy(true);
    try {
      await api(`/api/users/${grantUserId}`, {
        method: 'PATCH',
        body: { is_super_admin: true },
      });
      showToast('Super Admin granted successfully');
      setGrantModal(false);
      setGrantUserId('');
      load();
    } catch (err) {
      showToast(err.message || 'Failed to grant Super Admin', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(u) {
    if (!window.confirm(`Remove Super Admin from ${u.name}?\n\nThey will lose all elevated access and revert to a normal user.`)) return;
    setBusy(true);
    try {
      await api(`/api/users/${u.id}`, {
        method: 'PATCH',
        body: { is_super_admin: false },
      });
      showToast(`Super Admin removed from ${u.name}`);
      load();
    } catch (err) {
      showToast(err.message || 'Failed to revoke Super Admin', 'error');
    } finally {
      setBusy(false);
    }
  }

  const isSelf = (u) => u.id === me?.id;

  return (
    <div className="sa-page">
      {/* Toast */}
      {toast && (
        <div className={`sa-toast sa-toast--${toast.type}`}>
          <CheckCircle2 size={14} /> {toast.msg}
        </div>
      )}

      {/* Header */}
      <header className="page-header">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Shield size={20} /> Super Admins
          </h2>
          <p>
            {loading ? 'Loading…' : `${superAdmins.length} Super Admin${superAdmins.length !== 1 ? 's' : ''} — visible only to Super Admins`}
          </p>
        </div>
        <button
          className="button primary"
          onClick={() => { setGrantModal(true); setGrantUserId(''); }}
          disabled={busy}
        >
          + Grant Super Admin
        </button>
      </header>

      {error && <div className="banner error">{error}</div>}

      <div className="card">
        {loading ? (
          <div className="sa-empty">Loading…</div>
        ) : superAdmins.length === 0 ? (
          <div className="sa-empty">No Super Admins found.</div>
        ) : (
          <div className="sa-list">
            {superAdmins.map(u => (
              <div key={u.id} className="sa-row">
                {/* Avatar */}
                <div className="sa-avatar">
                  {u.profile_photo
                    ? <img src={u.profile_photo} alt={u.name} />
                    : u.name?.charAt(0).toUpperCase()
                  }
                </div>

                {/* Info */}
                <div className="sa-info">
                  <div className="sa-name">
                    {u.name}
                    {isSelf(u) && <span className="sa-self-pill">you</span>}
                    <span className="sa-badge">🏅 Super Admin</span>
                  </div>
                  <div className="sa-meta">
                    <span>{u.email}</span>
                    {u.mobile && <span>· {u.mobile}</span>}
                    {u.department && <span>· {u.department}</span>}
                  </div>
                </div>

                {/* Actions */}
                <div className="sa-actions">
                  {u.last_login && (
                    <span className="sa-last-login">
                      Last login: {new Date(u.last_login).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  )}
                  <button
                    className="sa-revoke-btn"
                    onClick={() => handleRevoke(u)}
                    disabled={busy || isSelf(u)}
                    title={isSelf(u) ? "You can't remove your own Super Admin flag" : 'Remove Super Admin'}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z"/>
                    </svg>
                    <span>{isSelf(u) ? 'Cannot remove own' : 'Remove Super Admin'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Grant Modal */}
      {grantModal && (
        <div className="sa-backdrop" onClick={() => setGrantModal(false)}>
          <div className="sa-modal" onClick={e => e.stopPropagation()}>
            <div className="sa-modal-hdr">
              <h3>Grant Super Admin</h3>
              <button className="sa-icon-btn" onClick={() => setGrantModal(false)}><X size={18} /></button>
            </div>
            <div className="sa-modal-body">
              <div className="sa-warn">
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>Super Admin has full unrestricted access to all features including this page. Grant with caution.</span>
              </div>
              <div className="sa-field">
                <label>Select User</label>
                <select
                  className="sa-select"
                  value={grantUserId}
                  onChange={e => setGrantUserId(e.target.value)}
                  autoFocus
                >
                  <option value="">— choose a user —</option>
                  {allUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="sa-modal-ftr">
              <button className="button secondary" onClick={() => setGrantModal(false)} disabled={busy}>Cancel</button>
              <button className="button primary" onClick={handleGrant} disabled={busy || !grantUserId}>
                {busy ? 'Granting…' : 'Grant Super Admin'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
