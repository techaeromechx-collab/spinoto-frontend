import { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '../api/client.js';
import { useAuth, useCan } from '../auth/AuthContext.jsx';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import {
  Plus, Pencil, Trash2, X, AlertCircle, CheckCircle2, Users, Search, Power,
} from 'lucide-react';
import '../styles/TechniciansPage.css';

/* ═══════════════════════════════════════════════════════════════════════════
   Technicians — the people on a hub's floor.
   ─────────────────────────────────────────────────────────────────────────
   NOT Spinoto logins. A technician never signs in; this list exists so a job
   card can carry a real id instead of a typed name, which is the only thing
   that makes "warranty claims per technician" a question with an answer.

   A hub login manages its own staff and sees nothing else — enforced in SQL
   on the server, not by hiding the filter here. The filter is hidden for hubs
   because it would do nothing, not because it is the protection.
   ═══════════════════════════════════════════════════════════════════════ */

function TechModal({ item, hubs, lockedHubId, onClose, onSaved }) {
  const isEdit = !!item?.id;
  useEscapeClose(onClose);
  const [f, setF] = useState({
    hub_id:        item?.hub_id ?? lockedHubId ?? '',
    name:          item?.name || '',
    mobile:        item?.mobile || '',
    skill:         item?.skill || '',
    employee_code: item?.employee_code || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      /* hub_id is left out of an edit entirely — the API refuses to move a
         technician between hubs, because doing so would silently re-attribute
         every job card they already appear on. */
      const body = isEdit
        ? { name: f.name, mobile: f.mobile, skill: f.skill, employee_code: f.employee_code }
        : { ...f, hub_id: Number(f.hub_id) };
      const r = isEdit
        ? await api(`/api/technicians/${item.id}`, { method: 'PATCH', body })
        : await api('/api/technicians',            { method: 'POST',  body });
      onSaved(r.item);
    } catch (e) { setError(e.message); setSaving(false); }
  }

  return (
    <div className="tc-backdrop">
      <div className="tc-modal" onClick={e => e.stopPropagation()}>
        <div className="tc-modal-hdr">
          <h3>{isEdit ? 'Edit technician' : 'New technician'}</h3>
          <button className="tc-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <form className="tc-modal-body" onSubmit={submit}>
          {error && <div className="tc-err"><AlertCircle size={13} /> {error}</div>}

          {!isEdit && !lockedHubId && (
            <div className="tc-field">
              <label>Hub <span className="tc-req">*</span></label>
              <select className="tc-input" value={f.hub_id} required
                      onChange={e => set('hub_id', e.target.value)}>
                <option value="">Select a hub…</option>
                {hubs.map(h => <option key={h.id} value={h.id}>{h.hub_name}</option>)}
              </select>
            </div>
          )}
          {isEdit && (
            <div className="tc-locked">
              Hub: <strong>{item.hub_name}</strong>
              <span>A technician cannot be moved between hubs — deactivate here, add at the new hub.</span>
            </div>
          )}

          <div className="tc-field">
            <label>Name <span className="tc-req">*</span></label>
            <input className="tc-input" value={f.name} required autoFocus
                   onChange={e => set('name', e.target.value)} placeholder="e.g. Amit Kumar" />
          </div>

          <div className="tc-row2">
            <div className="tc-field">
              <label>Mobile</label>
              <input className="tc-input" value={f.mobile}
                     onChange={e => set('mobile', e.target.value)} placeholder="Optional" />
            </div>
            <div className="tc-field">
              <label>Employee code</label>
              <input className="tc-input" value={f.employee_code}
                     onChange={e => set('employee_code', e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <div className="tc-field">
            <label>Skill / trade</label>
            <input className="tc-input" value={f.skill}
                   onChange={e => set('skill', e.target.value)}
                   placeholder="e.g. Engine, AC, Denting & painting" />
          </div>
        </form>
        <div className="tc-modal-ftr">
          <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="button primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add technician'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ item, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  useEscapeClose(onCancel, !busy);
  return (
    <div className="tc-backdrop">
      <div className="tc-modal tc-modal--sm" onClick={e => e.stopPropagation()}>
        <div className="tc-modal-hdr">
          <h3>Delete technician</h3>
          <button className="tc-icon-btn" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="tc-modal-body">
          {err && <div className="tc-err"><AlertCircle size={13} /> {err}</div>}
          <p className="tc-confirm">
            Delete <strong>{item.name}</strong> from {item.hub_name}?
          </p>
          {/* Said plainly because it will matter from phase 3 onward, when job
              cards start referencing technicians and deleting stops being safe. */}
          <p className="tc-hint">
            If they have simply left, <strong>deactivate</strong> instead — that keeps
            them off the job-card dropdown while preserving the record of their work.
          </p>
        </div>
        <div className="tc-modal-ftr">
          <button className="button secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="button danger" disabled={busy}
                  onClick={async () => {
                    setBusy(true); setErr('');
                    try { await onConfirm(); } catch (e) { setErr(e.message); setBusy(false); }
                  }}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TechniciansPage() {
  const { user } = useAuth();
  const isHubUser = Boolean(user?.hub_id);
  const canManage = useCan('MANAGE_MASTER_DATA') || useCan('MANAGE_HUBS') || useCan('EDIT_HUB') || isHubUser;

  const [items, setItems]     = useState([]);
  const [hubs, setHubs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [hubFilter, setHubFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch]   = useState('');
  const [modal, setModal]     = useState(null);
  const [delItem, setDelItem] = useState(null);
  const [toast, setToast]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (hubFilter) qs.set('hub_id', hubFilter);
      if (showInactive) qs.set('include_inactive', 'true');
      const r = await api(`/api/technicians${qs.toString() ? `?${qs}` : ''}`);
      setItems(r.items || []);
      setError('');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [hubFilter, showInactive]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    /* Hubs are only needed to populate a picker a hub login never sees. */
    if (isHubUser) return;
    api('/api/hubs?is_active=true&limit=200')
      .then(r => setHubs(r.items || []))
      .catch(() => {});
  }, [isHubUser]);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function toggleActive(t) {
    try {
      await api(`/api/technicians/${t.id}`, { method: 'PATCH', body: { is_active: !t.is_active } });
      await load();
      showToast(`${t.name} ${t.is_active ? 'deactivated' : 'reactivated'}.`);
    } catch (e) { showToast(e.message, 'error'); }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(t =>
      (t.name || '').toLowerCase().includes(q) ||
      (t.skill || '').toLowerCase().includes(q) ||
      (t.employee_code || '').toLowerCase().includes(q) ||
      (t.mobile || '').includes(q));
  }, [items, search]);

  /* Grouped by hub for staff, flat for a hub login — grouping a list that can
     only ever hold one hub is a heading that says the same thing every time. */
  const byHub = useMemo(() => {
    if (isHubUser) return null;
    const m = new Map();
    for (const t of filtered) {
      if (!m.has(t.hub_id)) m.set(t.hub_id, { name: t.hub_name, rows: [] });
      m.get(t.hub_id).rows.push(t);
    }
    return [...m.values()];
  }, [filtered, isHubUser]);

  const rowsFor = list => list.map(t => (
    <tr key={t.id} className={t.is_active ? '' : 'tc-row--off'}>
      <td className="tc-c-name">
        <span className="tc-name">{t.name}</span>
        {!t.is_active && <span className="tc-badge">Inactive</span>}
      </td>
      <td>{t.skill || <span className="tc-dash">—</span>}</td>
      <td>{t.employee_code || <span className="tc-dash">—</span>}</td>
      <td>{t.mobile || <span className="tc-dash">—</span>}</td>
      <td className="tc-c-act">
        {canManage && (
          <div className="tc-acts">
            <button className="tc-icon-btn" title={t.is_active ? 'Deactivate' : 'Reactivate'}
                    onClick={() => toggleActive(t)}><Power size={14} /></button>
            <button className="tc-icon-btn" title="Edit"
                    onClick={() => setModal({ mode: 'edit', item: t })}><Pencil size={14} /></button>
            <button className="tc-icon-btn tc-icon-btn--danger" title="Delete"
                    onClick={() => setDelItem(t)}><Trash2 size={14} /></button>
          </div>
        )}
      </td>
    </tr>
  ));

  return (
    <div className="tc-page">
      {toast && (
        <div className={`tc-toast tc-toast--${toast.type}`}><CheckCircle2 size={14} /> {toast.msg}</div>
      )}

      <header className="page-header">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={20} /> Technicians
          </h2>
          <p>
            The people who do the work at each hub. They appear on the job card —
            they are not Spinoto logins and never sign in.
          </p>
        </div>
        {canManage && (
          <button className="button primary" onClick={() => setModal({ mode: 'add' })}>
            <Plus size={16} /> Add technician
          </button>
        )}
      </header>

      <div className="tc-toolbar">
        <div className="tc-search">
          <Search size={14} />
          <input value={search} placeholder="Search name, skill, code or mobile"
                 onChange={e => setSearch(e.target.value)} />
        </div>
        {!isHubUser && (
          <select className="tc-input tc-hub-filter" value={hubFilter}
                  onChange={e => setHubFilter(e.target.value)}>
            <option value="">All hubs</option>
            {hubs.map(h => <option key={h.id} value={h.id}>{h.hub_name}</option>)}
          </select>
        )}
        <label className="tc-check">
          <input type="checkbox" checked={showInactive}
                 onChange={e => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
        <span className="tc-count">{filtered.length} technician{filtered.length === 1 ? '' : 's'}</span>
      </div>

      {error && <div className="tc-err"><AlertCircle size={13} /> {error}</div>}
      {loading && <div className="tc-empty">Loading…</div>}

      {!loading && filtered.length === 0 && (
        <div className="tc-empty">
          {search ? 'No technician matches that search.' : 'No technicians yet.'}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        isHubUser ? (
          <div className="tc-card">
            <table className="tc-table">
              <thead><tr><th>Name</th><th>Skill</th><th>Code</th><th>Mobile</th><th /></tr></thead>
              <tbody>{rowsFor(filtered)}</tbody>
            </table>
          </div>
        ) : byHub.map(g => (
          <section key={g.name} className="tc-card">
            <header className="tc-card-hdr">
              {g.name}<span className="tc-card-count">{g.rows.length}</span>
            </header>
            <table className="tc-table">
              <thead><tr><th>Name</th><th>Skill</th><th>Code</th><th>Mobile</th><th /></tr></thead>
              <tbody>{rowsFor(g.rows)}</tbody>
            </table>
          </section>
        ))
      )}

      {modal && (
        <TechModal item={modal.item} hubs={hubs} lockedHubId={isHubUser ? user.hub_id : null}
                   onClose={() => setModal(null)}
                   onSaved={() => { setModal(null); load();
                     showToast(modal.mode === 'edit' ? 'Technician updated.' : 'Technician added.'); }} />
      )}
      {delItem && (
        <ConfirmModal item={delItem} onCancel={() => setDelItem(null)}
                      onConfirm={async () => {
                        await api(`/api/technicians/${delItem.id}`, { method: 'DELETE' });
                        setDelItem(null); await load();
                        showToast(`"${delItem.name}" deleted.`);
                      }} />
      )}
    </div>
  );
}
