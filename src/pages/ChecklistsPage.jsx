import { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '../api/client.js';
import { useCan } from '../auth/AuthContext.jsx';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import {
  Plus, Pencil, Trash2, X, AlertCircle, CheckCircle2, ClipboardCheck,
  ChevronDown, ChevronRight, Copy, ArrowUp, ArrowDown, ArrowLeft,
} from 'lucide-react';
import '../styles/ChecklistsPage.css';

/* ═══════════════════════════════════════════════════════════════════════════
   Inspection checklists — the editable master.
   ─────────────────────────────────────────────────────────────────────────
   Two screens in one route: a list of templates, and a builder for one of
   them. Same shape as Payables, and for the same reason — the builder needs
   the whole width, and a modal cannot hold 44 rows.

   ── THE COLUMN HEADINGS ARE PER TEMPLATE ──
   A template stores what IT calls its three outcome columns. The 2W sheet
   prints "OK / Rectified / Not OK" because that sheet records what was DONE
   to the bike; the 4W sheet prints "OK / Needs attention / Critical" because
   it records the vehicle's CONDITION. Both store the same three values, so
   one results table serves both, and neither sheet has to lie about what its
   middle column means. Every heading below is read from the template.
   ═══════════════════════════════════════════════════════════════════════ */

const OUTCOMES = ['ok', 'attention', 'critical'];
const KIND_LABEL = { intake: 'Intake', pre_delivery: 'Pre-delivery' };

// ── Template add / edit ──────────────────────────────────────────────────────
function TemplateModal({ item, vehicleTypes, onClose, onSaved }) {
  const isEdit = !!item?.id;
  useEscapeClose(onClose);
  const [f, setF] = useState({
    name:            item?.name || '',
    kind:            item?.kind || 'intake',
    vehicle_type_id: item?.vehicle_type_id ?? '',
    label_ok:        item?.label_ok || 'OK',
    label_attention: item?.label_attention || 'Needs attention',
    label_critical:  item?.label_critical || 'Critical',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      const body = { ...f, vehicle_type_id: f.vehicle_type_id === '' ? null : Number(f.vehicle_type_id) };
      const r = isEdit
        ? await api(`/api/checklists/${item.id}`, { method: 'PATCH', body })
        : await api('/api/checklists',            { method: 'POST',  body });
      onSaved(r.item);
    } catch (e) { setError(e.message); setSaving(false); }
  }

  return (
    <div className="cl-backdrop">
      <div className="cl-modal" onClick={e => e.stopPropagation()}>
        <div className="cl-modal-hdr">
          <h3>{isEdit ? 'Edit checklist' : 'New checklist'}</h3>
          <button className="cl-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <form className="cl-modal-body" onSubmit={submit}>
          {error && <div className="cl-err"><AlertCircle size={13} /> {error}</div>}

          <div className="cl-field">
            <label>Name <span className="cl-req">*</span></label>
            <input className="cl-input" value={f.name} required autoFocus
                   onChange={e => set('name', e.target.value)}
                   placeholder="e.g. 4W Vehicle Inspection" />
          </div>

          <div className="cl-row2">
            <div className="cl-field">
              <label>When it runs <span className="cl-req">*</span></label>
              <select className="cl-input" value={f.kind} onChange={e => set('kind', e.target.value)}>
                <option value="intake">Intake — when the vehicle arrives</option>
                <option value="pre_delivery">Pre-delivery — before handover</option>
              </select>
            </div>
            <div className="cl-field">
              <label>Vehicle type</label>
              <select className="cl-input" value={f.vehicle_type_id}
                      onChange={e => set('vehicle_type_id', e.target.value)}>
                <option value="">All vehicle types</option>
                {vehicleTypes.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
          </div>

          {/* The three headings this sheet prints. Editable because the two
              real sheets disagree about them and both are right. */}
          <div className="cl-cols-note">
            Column headings on this sheet
          </div>
          <div className="cl-row3">
            <div className="cl-field">
              <label>Good</label>
              <input className="cl-input" value={f.label_ok}
                     onChange={e => set('label_ok', e.target.value)} />
            </div>
            <div className="cl-field">
              <label>Middle</label>
              <input className="cl-input" value={f.label_attention}
                     onChange={e => set('label_attention', e.target.value)} />
            </div>
            <div className="cl-field">
              <label>Bad</label>
              <input className="cl-input" value={f.label_critical}
                     onChange={e => set('label_critical', e.target.value)} />
            </div>
          </div>
        </form>
        <div className="cl-modal-ftr">
          <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="button primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create checklist'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Confirm ──────────────────────────────────────────────────────────────────
function ConfirmModal({ title, body, confirmLabel = 'Delete', onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  useEscapeClose(onCancel, !busy);
  return (
    <div className="cl-backdrop">
      <div className="cl-modal cl-modal--sm" onClick={e => e.stopPropagation()}>
        <div className="cl-modal-hdr">
          <h3>{title}</h3>
          <button className="cl-icon-btn" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="cl-modal-body">
          {err && <div className="cl-err"><AlertCircle size={13} /> {err}</div>}
          <p className="cl-confirm-text">{body}</p>
        </div>
        <div className="cl-modal-ftr">
          <button className="button secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="button danger" disabled={busy}
                  onClick={async () => {
                    setBusy(true); setErr('');
                    try { await onConfirm(); } catch (e) { setErr(e.message); setBusy(false); }
                  }}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Duplicate ────────────────────────────────────────────────────────────────
function DuplicateModal({ item, onClose, onSaved }) {
  useEscapeClose(onClose);
  const [name, setName] = useState(`${item.name} (copy)`);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api(`/api/checklists/${item.id}/duplicate`, { method: 'POST', body: { name } });
      onSaved(r.item);
    } catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="cl-backdrop">
      <div className="cl-modal cl-modal--sm" onClick={e => e.stopPropagation()}>
        <div className="cl-modal-hdr">
          <h3>Duplicate checklist</h3>
          <button className="cl-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <form className="cl-modal-body" onSubmit={submit}>
          {err && <div className="cl-err"><AlertCircle size={13} /> {err}</div>}
          <p className="cl-confirm-text">
            Copies every group, point and label from <strong>{item.name}</strong>.
            Useful for starting a sheet you do not have yet — duplicate, rename,
            then delete the rows that do not belong on it.
          </p>
          <div className="cl-field">
            <label>New name <span className="cl-req">*</span></label>
            <input className="cl-input" value={name} required autoFocus
                   onChange={e => setName(e.target.value)} />
          </div>
        </form>
        <div className="cl-modal-ftr">
          <button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="button primary" onClick={submit} disabled={busy}>
            {busy ? 'Copying…' : 'Duplicate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── One point row in the builder ─────────────────────────────────────────────
/* Edited in place rather than in a modal. A 44-point sheet is edited by
   sweeping down it fixing wording, and a modal per row turns that into 44
   open-type-save cycles. Saved on blur. */
function PointRow({ point, template, canManage, onSaved, onDelete, onMove, isFirst, isLast }) {
  const [draft, setDraft] = useState({
    label: point.label,
    ok: point.options.ok || '',
    attention: point.options.attention || '',
    critical: point.options.critical || '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft({
      label: point.label,
      ok: point.options.ok || '',
      attention: point.options.attention || '',
      critical: point.options.critical || '',
    });
  }, [point.id, point.label, point.options.ok, point.options.attention, point.options.critical]);

  const dirty =
    draft.label !== point.label ||
    draft.ok !== (point.options.ok || '') ||
    draft.attention !== (point.options.attention || '') ||
    draft.critical !== (point.options.critical || '');

  async function save() {
    if (!dirty || !draft.label.trim()) return;
    setBusy(true);
    try {
      /* Empty string is sent as null on purpose: clearing the box means "this
         column does not apply to this point", which is the "–" on the printed
         sheet, not a blank label nobody can press. */
      await api(`/api/checklists/points/${point.id}`, {
        method: 'PATCH',
        body: {
          label: draft.label.trim(),
          options: {
            ok:        draft.ok.trim()        || null,
            attention: draft.attention.trim() || null,
            critical:  draft.critical.trim()  || null,
          },
        },
      });
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <tr className={`cl-point${busy ? ' cl-point--busy' : ''}${point.is_active ? '' : ' cl-point--off'}`}>
      <td className="cl-c-label">
        <input className="cl-cell" value={draft.label} disabled={!canManage}
               onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
               onBlur={save} />
      </td>
      {OUTCOMES.map(o => (
        <td key={o} className="cl-c-opt">
          <input className={`cl-cell cl-cell--${o}`} value={draft[o]} disabled={!canManage}
                 placeholder="—" title={draft[o] ? '' : 'Empty means this column is not offered for this point'}
                 onChange={e => setDraft(d => ({ ...d, [o]: e.target.value }))}
                 onBlur={save} />
        </td>
      ))}
      <td className="cl-c-act">
        {canManage && (
          <div className="cl-row-acts">
            <button className="cl-icon-btn" title="Move up" disabled={isFirst}
                    onClick={() => onMove(-1)}><ArrowUp size={13} /></button>
            <button className="cl-icon-btn" title="Move down" disabled={isLast}
                    onClick={() => onMove(1)}><ArrowDown size={13} /></button>
            <button className="cl-icon-btn cl-icon-btn--danger" title="Delete point"
                    onClick={onDelete}><Trash2 size={13} /></button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ── Builder ──────────────────────────────────────────────────────────────────
function Builder({ templateId, canManage, onBack, showToast }) {
  const [tpl, setTpl]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen]   = useState({});      // group id -> collapsed?
  const [confirm, setConfirm] = useState(null);
  const [newGroup, setNewGroup] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api(`/api/checklists/${templateId}`);
      setTpl(r.item);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [templateId]);

  useEffect(() => { load(); }, [load]);

  async function addGroup(e) {
    e.preventDefault();
    if (!newGroup.trim()) return;
    try {
      await api(`/api/checklists/${templateId}/groups`, { method: 'POST', body: { name: newGroup.trim() } });
      setNewGroup('');
      await load();
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function addPoint(groupId) {
    try {
      /* Seeded with the template's own headings rather than left blank: on a
         real sheet most rows read Good / Adjusted / Replace, and starting from
         something is faster than starting from nothing. */
      await api(`/api/checklists/groups/${groupId}/points`, {
        method: 'POST',
        body: { label: 'New check point', options: { ok: tpl.label_ok, attention: null, critical: null } },
      });
      await load();
    } catch (e) { showToast(e.message, 'error'); }
  }

  /* One call for the whole group, not one per row: a half-applied reorder
     leaves the sheet in an order nobody chose. */
  async function movePoint(group, index, delta) {
    const pts = [...group.points];
    const to = index + delta;
    if (to < 0 || to >= pts.length) return;
    [pts[index], pts[to]] = [pts[to], pts[index]];
    setTpl(t => ({
      ...t,
      groups: t.groups.map(g => g.id === group.id ? { ...g, points: pts } : g),
    }));
    try {
      await api(`/api/checklists/${templateId}/reorder`, {
        method: 'PATCH',
        body: { points: pts.map((p, i) => ({ id: p.id, sort_order: i + 1 })) },
      });
    } catch (e) { showToast(e.message, 'error'); load(); }
  }

  async function moveGroup(index, delta) {
    const gs = [...tpl.groups];
    const to = index + delta;
    if (to < 0 || to >= gs.length) return;
    [gs[index], gs[to]] = [gs[to], gs[index]];
    setTpl(t => ({ ...t, groups: gs }));
    try {
      await api(`/api/checklists/${templateId}/reorder`, {
        method: 'PATCH',
        body: { groups: gs.map((g, i) => ({ id: g.id, sort_order: i + 1 })) },
      });
    } catch (e) { showToast(e.message, 'error'); load(); }
  }

  if (loading) return <div className="cl-page"><div className="cl-empty">Loading…</div></div>;
  if (error)   return <div className="cl-page"><div className="cl-err"><AlertCircle size={13} /> {error}</div></div>;
  if (!tpl)    return null;

  const totalPoints = tpl.groups.reduce((n, g) => n + g.points.length, 0);

  return (
    <div className="cl-page">
      <header className="cl-builder-hdr">
        <button className="cl-back" onClick={onBack}><ArrowLeft size={15} /> All checklists</button>
        <div className="cl-builder-title">
          <h2>{tpl.name}</h2>
          <span className="cl-meta">
            <span className={`cl-kind cl-kind--${tpl.kind}`}>{KIND_LABEL[tpl.kind]}</span>
            {tpl.vehicle_type_name || 'All vehicle types'} · {tpl.groups.length} groups · {totalPoints} points
          </span>
        </div>
      </header>

      {tpl.groups.length === 0 && (
        <div className="cl-empty">
          Nothing on this sheet yet. Add a group below, or go back and duplicate
          an existing checklist to start from.
        </div>
      )}

      {tpl.groups.map((g, gi) => {
        const collapsed = open[g.id];
        return (
          <section key={g.id} className="cl-group">
            <header className="cl-group-hdr">
              <button className="cl-group-toggle"
                      onClick={() => setOpen(o => ({ ...o, [g.id]: !o[g.id] }))}>
                {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                <span className="cl-group-name">{g.name}</span>
                <span className="cl-group-count">{g.points.length}</span>
              </button>
              {canManage && (
                <div className="cl-row-acts">
                  <button className="cl-icon-btn" title="Move group up" disabled={gi === 0}
                          onClick={() => moveGroup(gi, -1)}><ArrowUp size={13} /></button>
                  <button className="cl-icon-btn" title="Move group down" disabled={gi === tpl.groups.length - 1}
                          onClick={() => moveGroup(gi, 1)}><ArrowDown size={13} /></button>
                  <button className="cl-icon-btn" title="Rename group"
                          onClick={async () => {
                            const name = window.prompt('Group name', g.name);
                            if (!name || name === g.name) return;
                            try {
                              await api(`/api/checklists/groups/${g.id}`, { method: 'PATCH', body: { name } });
                              await load();
                            } catch (e) { showToast(e.message, 'error'); }
                          }}><Pencil size={13} /></button>
                  <button className="cl-icon-btn cl-icon-btn--danger" title="Delete group"
                          onClick={() => setConfirm({
                            title: 'Delete group',
                            body: `Delete "${g.name}" and its ${g.points.length} check point${g.points.length === 1 ? '' : 's'}? This cannot be undone.`,
                            run: async () => {
                              await api(`/api/checklists/groups/${g.id}`, { method: 'DELETE' });
                              setConfirm(null); await load();
                              showToast(`Group "${g.name}" deleted.`);
                            },
                          })}><Trash2 size={13} /></button>
                </div>
              )}
            </header>

            {!collapsed && (
              <div className="cl-table-wrap">
                <table className="cl-table">
                  <thead>
                    <tr>
                      <th className="cl-c-label">Check point</th>
                      <th className="cl-c-opt cl-th--ok">{tpl.label_ok}</th>
                      <th className="cl-c-opt cl-th--attention">{tpl.label_attention}</th>
                      <th className="cl-c-opt cl-th--critical">{tpl.label_critical}</th>
                      <th className="cl-c-act" />
                    </tr>
                  </thead>
                  <tbody>
                    {g.points.map((p, pi) => (
                      <PointRow key={p.id} point={p} template={tpl} canManage={canManage}
                                isFirst={pi === 0} isLast={pi === g.points.length - 1}
                                onMove={d => movePoint(g, pi, d)}
                                onSaved={load}
                                onDelete={() => setConfirm({
                                  title: 'Delete check point',
                                  body: `Delete "${p.label}"?`,
                                  run: async () => {
                                    await api(`/api/checklists/points/${p.id}`, { method: 'DELETE' });
                                    setConfirm(null); await load();
                                  },
                                })} />
                    ))}
                    {g.points.length === 0 && (
                      <tr><td colSpan={5} className="cl-none">No check points in this group yet.</td></tr>
                    )}
                  </tbody>
                </table>
                {canManage && (
                  <button className="cl-add-point" onClick={() => addPoint(g.id)}>
                    <Plus size={13} /> Add check point
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}

      {canManage && (
        <form className="cl-add-group" onSubmit={addGroup}>
          <input className="cl-input" value={newGroup} placeholder="New group — e.g. BRAKES"
                 onChange={e => setNewGroup(e.target.value)} />
          <button className="button primary" type="submit" disabled={!newGroup.trim()}>
            <Plus size={15} /> Add group
          </button>
        </form>
      )}

      {confirm && (
        <ConfirmModal title={confirm.title} body={confirm.body}
                      onCancel={() => setConfirm(null)} onConfirm={confirm.run} />
      )}
    </div>
  );
}

// ── Template list ────────────────────────────────────────────────────────────
export default function ChecklistsPage() {
  const canManage = useCan('MANAGE_MASTER_DATA');

  const [items, setItems]   = useState([]);
  const [vTypes, setVTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [modal, setModal]   = useState(null);
  const [dupe, setDupe]     = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [toast, setToast]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api('/api/checklists');
      setItems(r.items || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    /* The picker only; a failure here leaves "All vehicle types" as the choice,
       which is a working template rather than a blocked form. */
    api('/api/vehicles/types').then(r => setVTypes(r.items || [])).catch(() => {});
  }, []);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  const grouped = useMemo(() => ({
    intake:       items.filter(i => i.kind === 'intake'),
    pre_delivery: items.filter(i => i.kind === 'pre_delivery'),
  }), [items]);

  if (openId) {
    return (
      <>
        {toast && (
          <div className={`cl-toast cl-toast--${toast.type}`}><CheckCircle2 size={14} /> {toast.msg}</div>
        )}
        <Builder templateId={openId} canManage={canManage}
                 onBack={() => { setOpenId(null); load(); }} showToast={showToast} />
      </>
    );
  }

  return (
    <div className="cl-page">
      {toast && (
        <div className={`cl-toast cl-toast--${toast.type}`}><CheckCircle2 size={14} /> {toast.msg}</div>
      )}

      <header className="page-header">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClipboardCheck size={20} /> Inspection Checklists
          </h2>
          <p>
            The sheets a hub fills in on the job card. An <strong>intake</strong> checklist
            runs when the vehicle arrives; a <strong>pre-delivery</strong> one before handover.
          </p>
        </div>
        {canManage && (
          <button className="button primary" onClick={() => setModal({ mode: 'add' })}>
            <Plus size={16} /> New checklist
          </button>
        )}
      </header>

      {error && <div className="cl-err"><AlertCircle size={13} /> {error}</div>}
      {loading && <div className="cl-empty">Loading…</div>}

      {!loading && items.length === 0 && (
        <div className="cl-empty">No checklists yet.</div>
      )}

      {!loading && ['intake', 'pre_delivery'].map(kind => grouped[kind].length > 0 && (
        <section key={kind} className="cl-kind-section">
          <h3 className="cl-kind-head">
            {KIND_LABEL[kind]}
            <span className="cl-kind-sub">
              {kind === 'intake'
                ? 'Runs when the vehicle arrives — records its condition'
                : 'Runs before handover — records what was done'}
            </span>
          </h3>
          <div className="cl-cards">
            {grouped[kind].map(t => (
              <article key={t.id} className={`cl-card${t.is_active ? '' : ' cl-card--off'}`}>
                <button className="cl-card-main" onClick={() => setOpenId(t.id)}>
                  <span className="cl-card-name">{t.name}</span>
                  <span className="cl-card-meta">
                    {t.vehicle_type_name || 'All vehicle types'}
                  </span>
                  <span className="cl-card-counts">
                    {t.point_count === 0
                      ? <em className="cl-card-empty">Empty — nothing on this sheet yet</em>
                      : <>{t.group_count} groups · {t.point_count} points</>}
                  </span>
                  <span className="cl-card-cols">
                    {t.label_ok} · {t.label_attention} · {t.label_critical}
                  </span>
                </button>
                {canManage && (
                  <div className="cl-card-acts">
                    <button className="cl-icon-btn" title="Edit details"
                            onClick={() => setModal({ mode: 'edit', item: t })}><Pencil size={14} /></button>
                    <button className="cl-icon-btn" title="Duplicate"
                            onClick={() => setDupe(t)}><Copy size={14} /></button>
                    <button className="cl-icon-btn cl-icon-btn--danger" title="Delete"
                            onClick={() => setConfirm({
                              title: 'Delete checklist',
                              body: `Delete "${t.name}" with its ${t.group_count} groups and ${t.point_count} check points? This cannot be undone.`,
                              run: async () => {
                                await api(`/api/checklists/${t.id}`, { method: 'DELETE' });
                                setConfirm(null); await load();
                                showToast(`"${t.name}" deleted.`);
                              },
                            })}><Trash2 size={14} /></button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}

      {modal && (
        <TemplateModal item={modal.item} vehicleTypes={vTypes}
                       onClose={() => setModal(null)}
                       onSaved={() => { setModal(null); load(); showToast(modal.mode === 'edit' ? 'Checklist updated.' : 'Checklist created.'); }} />
      )}
      {dupe && (
        <DuplicateModal item={dupe} onClose={() => setDupe(null)}
                        onSaved={t => { setDupe(null); load(); showToast(`"${t.name}" created.`); }} />
      )}
      {confirm && (
        <ConfirmModal title={confirm.title} body={confirm.body}
                      onCancel={() => setConfirm(null)} onConfirm={confirm.run} />
      )}
    </div>
  );
}
