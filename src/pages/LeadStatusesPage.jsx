import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api/client.js';
import useSync from '../hooks/useSync.js';
import { useCan } from '../auth/AuthContext.jsx';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import {
  Plus, Pencil, Trash2, X, AlertCircle, CheckCircle2,
  GripVertical, Tag, Calendar, FileText, RefreshCw, Phone, Ban, Building2,
} from 'lucide-react';
import '../styles/LeadStatusesPage.css';

// ── Preset colour palette ─────────────────────────────────────────────────────
const PRESETS = [
  { color: '#2563eb', bg: '#dbeafe' },
  { color: '#0891b2', bg: '#cffafe' },
  { color: '#0369a1', bg: '#e0f2fe' },
  { color: '#0f766e', bg: '#ccfbf1' },
  { color: '#16a34a', bg: '#dcfce7' },
  { color: '#4f46e5', bg: '#e0e7ff' },
  { color: '#7c3aed', bg: '#ede9fe' },
  { color: '#d97706', bg: '#fef3c7' },
  { color: '#ea580c', bg: '#ffedd5' },
  { color: '#dc2626', bg: '#fee2e2' },
  { color: '#991b1b', bg: '#fef2f2' },
  { color: '#6b7280', bg: '#f3f4f6' },
];

function StatusChip({ name, color, bg_color }) {
  return (
    <span style={{
      display: 'inline-block', padding: '3px 12px', borderRadius: 20,
      fontSize: 12, fontWeight: 700, color, background: bg_color,
      border: `1.5px solid ${color}22`,
    }}>{name}</span>
  );
}

// ── Shared colour picker section ──────────────────────────────────────────────
function ColourPicker({ form, setForm }) {
  return (
    <div className="ls-field">
      <label>Colour</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {PRESETS.map((p, i) => (
          <button key={i} type="button" title={p.color}
            onClick={() => setForm(f => ({ ...f, color: p.color, bg_color: p.bg }))}
            style={{
              width: 28, height: 28, borderRadius: '50%',
              background: p.bg, border: `3px solid ${p.color}`,
              cursor: 'pointer',
              outline: form.color === p.color ? `3px solid ${p.color}` : 'none',
              outlineOffset: 2,
            }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Text colour</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="color" value={form.color}
              onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
              style={{ width: 36, height: 32, border: 'none', padding: 0, cursor: 'pointer', borderRadius: 6 }} />
            <input className="ls-input" value={form.color} style={{ fontFamily: 'monospace', fontSize: 13 }}
              onChange={e => setForm(f => ({ ...f, color: e.target.value }))} />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Background colour</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="color" value={form.bg_color}
              onChange={e => setForm(f => ({ ...f, bg_color: e.target.value }))}
              style={{ width: 36, height: 32, border: 'none', padding: 0, cursor: 'pointer', borderRadius: 6 }} />
            <input className="ls-input" value={form.bg_color} style={{ fontFamily: 'monospace', fontSize: 13 }}
              onChange={e => setForm(f => ({ ...f, bg_color: e.target.value }))} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Delete modal ──────────────────────────────────────────────────────────────
function DeleteModal({ item, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEscapeClose(onClose);
  async function go() {
    setBusy(true); setErr('');
    try { await onConfirm(); }
    catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="ls-backdrop">
      <div className="ls-modal ls-modal--sm" onClick={e => e.stopPropagation()}>
        <div className="ls-modal-hdr">
          <h3>Delete Status</h3>
          <button className="ls-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="ls-modal-body">
          {err && <div className="ls-err"><AlertCircle size={13} /> {err}</div>}
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
            Delete <StatusChip name={item.name} color={item.color} bg_color={item.bg_color} />?
            {' '}This cannot be undone.
          </p>
        </div>
        <div className="ls-modal-ftr">
          <button className="button secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="button danger" onClick={go} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1 — LEAD STATUS
// ══════════════════════════════════════════════════════════════════════════════

function LeadStatusModal({ item, maxOrder, onClose, onSaved }) {
  const isEdit = !!item?.id;
  useEscapeClose(onClose);
  const [form, setForm] = useState({
    name: item?.name || '',
    color: item?.color || '#2563eb',
    bg_color: item?.bg_color || '#dbeafe',
    sort_order: item?.sort_order ?? maxOrder,
    is_active: item?.is_active ?? true,
    is_default: item?.is_default ?? false,
    needs_follow_up: item?.needs_follow_up ?? false,
    converts_to_appointment: item?.converts_to_appointment ?? false,
    is_pipeline: item?.is_pipeline ?? true,
    logs_call:   item?.logs_call   ?? false,
    is_locked:   item?.is_locked   ?? false,
    is_closed:   item?.is_closed   ?? false,
    is_reenquiry:       item?.is_reenquiry       ?? false,
    is_repeat_customer: item?.is_repeat_customer ?? false,
    needs_lost_reason:  item?.needs_lost_reason  ?? false,
    is_retarget_target: item?.is_retarget_target ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault(); setError(''); setSaving(true);
    try {
      const body = { ...form, sort_order: Number(form.sort_order) };
      const r = isEdit
        ? await api(`/api/lead-statuses/${item.id}`, { method: 'PATCH', body })
        : await api('/api/lead-statuses', { method: 'POST', body });
      onSaved(r.item);
    } catch (e) { setError(e.message); setSaving(false); }
  }

  return (
    <div className="ls-backdrop">
      <div className="ls-modal" onClick={e => e.stopPropagation()}>
        <div className="ls-modal-hdr">
          <h3>{isEdit ? 'Edit Lead Status' : 'New Lead Status'}</h3>
          <button className="ls-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <form className="ls-modal-body" onSubmit={handleSubmit}>
          {error && <div className="ls-err"><AlertCircle size={13} /> {error}</div>}

          <div className="ls-field">
            <label>Status Name <span className="ls-req">*</span></label>
            <input className="ls-input" value={form.name} required
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Follow-Up, Appointment Scheduled…" />
          </div>

          <ColourPicker form={form} setForm={setForm} />

          <div className="ls-field">
            <label>Preview</label>
            <StatusChip name={form.name || 'Status Preview'} color={form.color} bg_color={form.bg_color} />
          </div>

          <div className="ls-field">
            <label>Sort Order</label>
            <input className="ls-input" type="number" min="0" value={form.sort_order}
              onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))}
              style={{ width: 100 }} />
          </div>

          {/* ── Behaviour flags ─────────────────────────────────────────── */}
          <div className="ls-behaviour-box">
            <div className="ls-behaviour-title">Status Behaviour</div>

            <label className="ls-behaviour-row">
              <input type="checkbox" checked={form.needs_follow_up}
                onChange={e => setForm(f => ({ ...f, needs_follow_up: e.target.checked }))} />
              <div>
                <span className="ls-behaviour-label">This status needs a follow-up</span>
                <span className="ls-behaviour-hint">
                  When a lead is set to this status a form will open to schedule the next follow-up date and assign it to an agent.
                </span>
              </div>
            </label>

            <label className="ls-behaviour-row">
              <input type="checkbox" checked={form.converts_to_appointment}
                onChange={e => setForm(f => ({ ...f, converts_to_appointment: e.target.checked }))} />
              <div>
                <span className="ls-behaviour-label">This status converts the lead to an Appointment</span>
                <span className="ls-behaviour-hint">
                  When a lead is set to this status it will automatically be converted into an Appointment record.
                </span>
              </div>
            </label>

            <label className="ls-behaviour-row">
              <input type="checkbox" checked={form.is_pipeline}
                onChange={e => setForm(f => ({ ...f, is_pipeline: e.target.checked }))} />
              <div>
                <span className="ls-behaviour-label">Count in Pipeline Value</span>
                <span className="ls-behaviour-hint">
                  Leads with this status will be included in the Pipeline Value on the dashboard.
                  Turn OFF for closed statuses like Lost or Cancelled.
                </span>
              </div>
            </label>

            {/* Deliberately NOT the same checkbox as "Count in Pipeline Value"
                above. That one is about money on the dashboard; this one is
                about where a customer's next message lands. They agree today
                and will not always, and one box controlling both would change
                WhatsApp routing the day someone adjusted a report. */}
            <label className="ls-behaviour-row">
              <input type="checkbox" checked={form.is_closed}
                onChange={e => setForm(f => ({ ...f, is_closed: e.target.checked }))} />
              <div>
                <span className="ls-behaviour-label">Treat this status as closed</span>
                <span className="ls-behaviour-hint">
                  A new WhatsApp message from this customer will create a FRESH lead instead of
                  landing on this one. Turn ON for finished statuses like Lost, Junk or Not Interested —
                  otherwise a new enquiry gets filed on a dead lead where nobody will see it.
                </span>
              </div>
            </label>

            {/* ── Where a RETURNING customer lands (migration 161) ──────────
                Two boxes, not one, because they are two different people: one
                said no and changed their mind, the other has already paid you.
                Each can only be ticked on one status — ticking it here clears
                it wherever it was, the same way "Default status" behaves. */}
            <label className="ls-behaviour-row">
              <input type="checkbox" checked={form.is_reenquiry}
                onChange={e => setForm(f => ({ ...f, is_reenquiry: e.target.checked }))} />
              <div>
                <span className="ls-behaviour-label">Start re-enquiries on this status</span>
                <span className="ls-behaviour-hint">
                  When someone whose old lead was closed — Lost, Junk, Not Interested — messages
                  again, their new lead starts here instead of blank “New Lead”. Only one status
                  can hold this.
                </span>
              </div>
            </label>

            <label className="ls-behaviour-row">
              <input type="checkbox" checked={form.is_repeat_customer}
                onChange={e => setForm(f => ({ ...f, is_repeat_customer: e.target.checked }))} />
              <div>
                <span className="ls-behaviour-label">Start repeat customers on this status</span>
                <span className="ls-behaviour-hint">
                  For somebody who has already had a job done — a past appointment, or an existing
                  customer record — coming back for the next one. Takes priority over re-enquiry
                  when both would apply. Only one status can hold this.
                </span>
              </div>
            </label>

            {/* Deliberately next to "Treat this status as closed" rather than
                next to the lock: a reason is about WHY the lead ended, which is
                the same conversation as whether it is finished. */}
            <label className="ls-behaviour-row">
              <input type="checkbox" checked={form.needs_lost_reason}
                onChange={e => setForm(f => ({ ...f, needs_lost_reason: e.target.checked }))} />
              <div>
                <span className="ls-behaviour-label">Ask for a lost reason</span>
                <span className="ls-behaviour-hint">
                  When a lead is set to this status, a popup asks which reason from
                  Master Data → Lost Reasons, and the lead cannot be saved without one.
                  The reason shows under the lead's name and in its timeline.
                </span>
              </div>
            </label>

            <label className="ls-behaviour-row">
              <input type="checkbox" checked={form.is_retarget_target}
                onChange={e => setForm(f => ({ ...f, is_retarget_target: e.target.checked }))} />
              <div>
                <span className="ls-behaviour-label">Retargeted leads land here</span>
                <span className="ls-behaviour-hint">
                  A lead lost to a competitor moves here by itself once the vehicle is due
                  for service again, and appears in that day's follow-up list. Only one status
                  can hold this — ticking it here clears it wherever it was.
                </span>
              </div>
            </label>

            <label className="ls-behaviour-row">
              <input type="checkbox" checked={form.logs_call}
                onChange={e => setForm(f => ({ ...f, logs_call: e.target.checked }))} />
              <div>
                <span className="ls-behaviour-label">Log a call when this status is set</span>
                <span className="ls-behaviour-hint">
                  When a lead is moved to this status, a call-log popup will appear so the caller
                  can record the outcome (Connected, Busy, etc.) and optional notes.
                </span>
              </div>
            </label>

            <label className="ls-behaviour-row">
              <input type="checkbox" checked={form.is_locked}
                onChange={e => setForm(f => ({ ...f, is_locked: e.target.checked }))} />
              <div>
                <span className="ls-behaviour-label">Lock this status (terminal)</span>
                <span className="ls-behaviour-hint">
                  Once a lead is set to this status it cannot be changed further.
                  The status dropdown will be disabled with a 🔒 lock indicator.
                  Use for final states like Lost, Junk, Cancelled.
                </span>
              </div>
            </label>
          </div>

          <div className="ls-field ls-field--row">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_active}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
              Active (shown in lead status list)
            </label>
          </div>

          <div className="ls-field ls-field--row">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_default}
                onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))} />
              <span>
                Default for new leads
                <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                  Auto-assigned when a lead is created. Only one status can be default.
                </span>
              </span>
            </label>
          </div>

          <div className="ls-modal-ftr">
            <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="button primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Status'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LeadStatusPanel({ canManage }) {
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [delItem, setDelItem] = useState(null);
  const [toast, setToast] = useState(null);
  const dragIdx = useRef(null);
  const [dragOver, setDragOver] = useState(null);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api('/api/lead-statuses?all=true');
      setStatuses(r.items);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useSync('lead_statuses', load);

  function handleSaved(item) {
    setStatuses(prev => {
      const idx = prev.findIndex(s => s.id === item.id);
      return idx >= 0 ? prev.map(s => s.id === item.id ? item : s) : [...prev, item];
    });
    setModal(null);
    showToast(modal?.mode === 'edit' ? 'Status updated.' : 'Status added.');
  }

  async function handleDelete(item) {
    await api(`/api/lead-statuses/${item.id}`, { method: 'DELETE' });
    setStatuses(prev => prev.filter(s => s.id !== item.id));
    setDelItem(null);
    showToast(`"${item.name}" deleted.`);
  }

  async function onDrop(dropIdx) {
    setDragOver(null);
    const from = dragIdx.current;
    dragIdx.current = null;
    if (from === null || from === dropIdx) return;
    const reordered = [...statuses];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(dropIdx, 0, moved);
    setStatuses(reordered);
    try {
      await api('/api/lead-statuses/reorder', { method: 'POST', body: { ids: reordered.map(s => s.id) } });
      setStatuses(reordered.map((s, i) => ({ ...s, sort_order: i + 1 })));
    } catch { showToast('Failed to save order.', 'error'); load(); }
  }

  const maxOrder = statuses.length ? Math.max(...statuses.map(s => s.sort_order)) + 1 : 0;

  return (
    <div style={{ position: 'relative' }}>
      {toast && (
        <div className={`ls-toast ls-toast--${toast.type}`}>
          <CheckCircle2 size={14} /> {toast.msg}
        </div>
      )}

      <header className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Lead Status</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
            Configure statuses available on lead records. Set behaviour flags to trigger follow-ups or appointment conversion.
          </p>
        </div>
        {canManage && (
          <button className="button primary" onClick={() => setModal({ mode: 'add' })}>
            <Plus size={16} /> Add Status
          </button>
        )}
      </header>

      {error && <div className="banner error">{error}</div>}

      <div className="card">
        <div className="ls-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              <th>Status</th>
              <th>Text</th>
              <th>Background</th>
              <th>Order</th>
              <th>Follow-up</th>
              <th>→ Appt</th>
              <th>Pipeline</th>
              <th>Logs Call</th>
              <th>Locked</th>
              <th>Lost Reason</th>
              <th>↺ Retarget</th>
              <th>Closed</th>
              <th>Returning</th>
              <th>Active</th>
              {canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="16" style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>Loading…</td></tr>
            ) : statuses.length === 0 ? (
              <tr><td colSpan="16" style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>No statuses yet.</td></tr>
            ) : statuses.map((s, idx) => (
              <tr key={s.id}
                draggable={canManage}
                onDragStart={() => { dragIdx.current = idx; }}
                onDragOver={e => { e.preventDefault(); setDragOver(idx); }}
                onDrop={() => onDrop(idx)}
                onDragLeave={() => setDragOver(null)}
                style={{
                  opacity: s.is_active ? 1 : 0.45,
                  transition: 'background 0.15s',
                  background: dragOver === idx ? 'var(--bg-soft)' : '',
                  borderTop: dragOver === idx ? '2px solid var(--primary)' : '',
                  cursor: canManage ? 'grab' : 'default',
                }}
              >
                <td><GripVertical size={14} style={{ color: canManage ? 'var(--text-muted)' : 'transparent', cursor: 'grab' }} /></td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <StatusChip name={s.name} color={s.color} bg_color={s.bg_color} />
                    {s.is_default && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', background: '#dcfce7', borderRadius: 6, padding: '1px 6px', letterSpacing: 0.3 }}>
                        default
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: s.color, display: 'inline-block', flexShrink: 0, border: '1px solid rgba(0,0,0,.1)' }} />
                    <span className="ls-hex-label" style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{s.color}</span>
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 18, height: 18, borderRadius: 4, background: s.bg_color, display: 'inline-block', flexShrink: 0, border: '1px solid rgba(0,0,0,.1)' }} />
                    <span className="ls-hex-label" style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{s.bg_color}</span>
                  </div>
                </td>
                <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>{s.sort_order}</td>
                <td>
                  {s.needs_follow_up
                    ? <span className="ls-flag-badge ls-flag-badge--blue">✓ Follow-up</span>
                    : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td>
                  {s.converts_to_appointment
                    ? <span className="ls-flag-badge ls-flag-badge--cyan">✓ Appt</span>
                    : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td>
                  {s.is_pipeline
                    ? <span className="ls-flag-badge ls-flag-badge--amber">✓ Pipeline</span>
                    : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td>
                  {s.logs_call
                    ? <span className="ls-flag-badge ls-flag-badge--purple">✓ Call Log</span>
                    : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td>
                  {s.is_locked
                    ? <span className="ls-flag-badge ls-flag-badge--red">🔒 Locked</span>
                    : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td>
                  {s.needs_lost_reason
                    ? <span className="ls-flag-badge ls-flag-badge--red">Lost Reason</span>
                    : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td>
                  {s.is_retarget_target
                    ? <span className="ls-flag-badge ls-flag-badge--amber">↺ Retarget</span>
                    : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td>
                  {s.is_closed
                    ? <span className="ls-flag-badge ls-flag-badge--slate">Closed</span>
                    : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                {/* Both flags share one column: at most one status holds
                    each, so this cell is empty on almost every row and two
                    columns of dashes would be two columns of nothing. */}
                <td>
                  {s.is_repeat_customer || s.is_reenquiry
                    ? <>
                        {s.is_repeat_customer && <span className="ls-flag-badge ls-flag-badge--amber">Repeat</span>}
                        {s.is_reenquiry && <span className="ls-flag-badge ls-flag-badge--purple">Re-Enquiry</span>}
                      </>
                    : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20,
                    background: s.is_active ? '#dcfce7' : '#f3f4f6',
                    color: s.is_active ? '#16a34a' : '#6b7280',
                  }}>
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                {canManage && (
                  <td>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button className="ls-icon-btn" title="Edit" onClick={() => setModal({ mode: 'edit', item: s })}>
                        <Pencil size={14} />
                      </button>
                      <button className="ls-icon-btn ls-icon-btn--danger" title="Delete" onClick={() => setDelItem(s)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>{/* end ls-table-scroll */}

        {/* ── Mobile card list ── */}
        <div className="ls-mobile-cards">
          {loading ? (
            <div className="ls-mobile-empty">Loading…</div>
          ) : statuses.length === 0 ? (
            <div className="ls-mobile-empty">No statuses yet.</div>
          ) : statuses.map(s => (
            <div key={s.id} className="ls-mobile-card" style={{ opacity: s.is_active ? 1 : 0.55 }}>
              <div className="ls-mobile-card-main">
                <div className="ls-mobile-card-row">
                  <StatusChip name={s.name} color={s.color} bg_color={s.bg_color} />
                  {s.is_default && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', background: '#dcfce7', borderRadius: 6, padding: '1px 6px' }}>default</span>
                  )}
                </div>
                <div className="ls-mobile-card-badges">
                  {s.needs_follow_up && <span className="ls-flag-badge ls-flag-badge--blue">Follow-up</span>}
                  {s.converts_to_appointment && <span className="ls-flag-badge ls-flag-badge--cyan">→ Appt</span>}
                  {s.is_pipeline && <span className="ls-flag-badge ls-flag-badge--amber">Pipeline</span>}
                  {s.logs_call && <span className="ls-flag-badge ls-flag-badge--purple">Call Log</span>}
                  {s.is_locked && <span className="ls-flag-badge ls-flag-badge--red">🔒 Locked</span>}
                  {s.is_closed && <span className="ls-flag-badge ls-flag-badge--slate">Closed</span>}
                  {s.needs_lost_reason && <span className="ls-flag-badge ls-flag-badge--red">Lost Reason</span>}
                  {s.is_retarget_target && <span className="ls-flag-badge ls-flag-badge--amber">↺ Retarget</span>}
                  {s.is_repeat_customer && <span className="ls-flag-badge ls-flag-badge--amber">Repeat</span>}
                  {s.is_reenquiry && <span className="ls-flag-badge ls-flag-badge--purple">Re-Enquiry</span>}
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: s.is_active ? '#dcfce7' : '#f3f4f6', color: s.is_active ? '#16a34a' : '#6b7280' }}>
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
              {canManage && (
                <div className="ls-mobile-card-actions">
                  <button className="ls-icon-btn" onClick={() => setModal({ mode: 'edit', item: s })}><Pencil size={14} /></button>
                  <button className="ls-icon-btn ls-icon-btn--danger" onClick={() => setDelItem(s)}><Trash2 size={14} /></button>
                </div>
              )}
            </div>
          ))}
        </div>

        {statuses.length > 0 && (
          <div style={{ padding: '10px 20px', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
            {statuses.filter(s => s.is_active).length} active · {statuses.filter(s => !s.is_active).length} inactive
            {' · '}{statuses.filter(s => s.needs_follow_up).length} trigger follow-up
            {' · '}{statuses.filter(s => s.converts_to_appointment).length} convert to appointment
            {' · '}{statuses.filter(s => s.is_pipeline).length} count in pipeline
            {' · '}{statuses.filter(s => s.logs_call).length} log calls
            {' · '}{statuses.filter(s => s.is_locked).length} locked
            {' · '}{statuses.filter(s => s.needs_lost_reason).length} ask a reason
          </div>
        )}
      </div>

      {modal && (
        <LeadStatusModal
          item={modal.item}
          maxOrder={maxOrder}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
      {delItem && (
        <DeleteModal item={delItem} onClose={() => setDelItem(null)} onConfirm={() => handleDelete(delItem)} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SHARED — Generic Status Panel (used by Appointment + Invoice tabs)
// ══════════════════════════════════════════════════════════════════════════════

function GenericStatusModal({ title, apiBase, item, maxOrder, onClose, onSaved }) {
  const isEdit = !!item?.id;
  useEscapeClose(onClose);
  const [form, setForm] = useState({
    name: item?.name || '',
    color: item?.color || '#2563eb',
    bg_color: item?.bg_color || '#dbeafe',
    sort_order: item?.sort_order ?? maxOrder,
    is_active: item?.is_active ?? true,
    is_default: item?.is_default ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault(); setError(''); setSaving(true);
    try {
      const body = { ...form, sort_order: Number(form.sort_order) };
      const r = isEdit
        ? await api(`${apiBase}/${item.id}`, { method: 'PATCH', body })
        : await api(apiBase, { method: 'POST', body });
      onSaved(r.item);
    } catch (e) { setError(e.message); setSaving(false); }
  }

  return (
    <div className="ls-backdrop">
      <div className="ls-modal" onClick={e => e.stopPropagation()}>
        <div className="ls-modal-hdr">
          <h3>{isEdit ? `Edit ${title}` : `New ${title}`}</h3>
          <button className="ls-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <form className="ls-modal-body" onSubmit={handleSubmit}>
          {error && <div className="ls-err"><AlertCircle size={13} /> {error}</div>}

          <div className="ls-field">
            <label>Status Name <span className="ls-req">*</span></label>
            <input className="ls-input" value={form.name} required
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Confirmed, Paid…" />
          </div>

          <ColourPicker form={form} setForm={setForm} />

          <div className="ls-field">
            <label>Preview</label>
            <StatusChip name={form.name || 'Status Preview'} color={form.color} bg_color={form.bg_color} />
          </div>

          <div className="ls-field">
            <label>Sort Order</label>
            <input className="ls-input" type="number" min="0" value={form.sort_order}
              onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))}
              style={{ width: 100 }} />
          </div>

          <div className="ls-field ls-field--row">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_active}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
              Active
            </label>
          </div>

          <div className="ls-field ls-field--row">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_default}
                onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))} />
              <span>
                Default for new records
                <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                  Only one status can be default at a time.
                </span>
              </span>
            </label>
          </div>

          <div className="ls-modal-ftr">
            <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="button primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Status'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function GenericStatusPanel({ canManage, apiBase, title, description, addLabel }) {
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [delItem, setDelItem] = useState(null);
  const [toast, setToast] = useState(null);
  const dragIdx = useRef(null);
  const [dragOver, setDragOver] = useState(null);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api(`${apiBase}?all=true`);
      setStatuses(r.items);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [apiBase]);

  useEffect(() => { load(); }, [load]);
  useSync(['appointment_statuses', 'invoice_statuses'], load);

  function handleSaved(item) {
    setStatuses(prev => {
      const idx = prev.findIndex(s => s.id === item.id);
      return idx >= 0 ? prev.map(s => s.id === item.id ? item : s) : [...prev, item];
    });
    setModal(null);
    showToast(modal?.mode === 'edit' ? 'Status updated.' : 'Status added.');
  }

  async function handleDelete(item) {
    await api(`${apiBase}/${item.id}`, { method: 'DELETE' });
    setStatuses(prev => prev.filter(s => s.id !== item.id));
    setDelItem(null);
    showToast(`"${item.name}" deleted.`);
  }

  async function onDrop(dropIdx) {
    setDragOver(null);
    const from = dragIdx.current;
    dragIdx.current = null;
    if (from === null || from === dropIdx) return;
    const reordered = [...statuses];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(dropIdx, 0, moved);
    setStatuses(reordered);
    try {
      await api(`${apiBase}/reorder`, { method: 'POST', body: { ids: reordered.map(s => s.id) } });
      setStatuses(reordered.map((s, i) => ({ ...s, sort_order: i + 1 })));
    } catch { showToast('Failed to save order.', 'error'); load(); }
  }

  const maxOrder = statuses.length ? Math.max(...statuses.map(s => s.sort_order)) + 1 : 0;

  return (
    <div style={{ position: 'relative' }}>
      {toast && (
        <div className={`ls-toast ls-toast--${toast.type}`}>
          <CheckCircle2 size={14} /> {toast.msg}
        </div>
      )}

      <header className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>{description}</p>
        </div>
        {canManage && (
          <button className="button primary" onClick={() => setModal({ mode: 'add' })}>
            <Plus size={16} /> {addLabel}
          </button>
        )}
      </header>

      {error && <div className="banner error">{error}</div>}

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              <th>Status</th>
              <th>Text</th>
              <th>Background</th>
              <th>Order</th>
              <th>Active</th>
              {canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="7" style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>Loading…</td></tr>
            ) : statuses.length === 0 ? (
              <tr><td colSpan="7" style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>No statuses yet. Add your first one.</td></tr>
            ) : statuses.map((s, idx) => (
              <tr key={s.id}
                draggable={canManage}
                onDragStart={() => { dragIdx.current = idx; }}
                onDragOver={e => { e.preventDefault(); setDragOver(idx); }}
                onDrop={() => onDrop(idx)}
                onDragLeave={() => setDragOver(null)}
                style={{
                  opacity: s.is_active ? 1 : 0.45,
                  transition: 'background 0.15s',
                  background: dragOver === idx ? 'var(--bg-soft)' : '',
                  borderTop: dragOver === idx ? '2px solid var(--primary)' : '',
                  cursor: canManage ? 'grab' : 'default',
                }}
              >
                <td><GripVertical size={14} style={{ color: canManage ? 'var(--text-muted)' : 'transparent', cursor: 'grab' }} /></td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <StatusChip name={s.name} color={s.color} bg_color={s.bg_color} />
                    {s.is_default && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', background: '#dcfce7', borderRadius: 6, padding: '1px 6px', letterSpacing: 0.3 }}>
                        default
                      </span>
                    )}
                    {s.is_system && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#6366f1', background: '#eef2ff', borderRadius: 6, padding: '1px 6px', letterSpacing: 0.3 }}>
                        🔒 system
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: s.color, display: 'inline-block', flexShrink: 0, border: '1px solid rgba(0,0,0,.1)' }} />
                    <span className="ls-hex-label" style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{s.color}</span>
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 18, height: 18, borderRadius: 4, background: s.bg_color, display: 'inline-block', flexShrink: 0, border: '1px solid rgba(0,0,0,.1)' }} />
                    <span className="ls-hex-label" style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{s.bg_color}</span>
                  </div>
                </td>
                <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>{s.sort_order}</td>
                <td>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20,
                    background: s.is_active ? '#dcfce7' : '#f3f4f6',
                    color: s.is_active ? '#16a34a' : '#6b7280',
                  }}>
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                {canManage && (
                  <td>
                    {s.is_system ? (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', padding: '0 8px' }} title="System statuses cannot be deleted or renamed">🔒 locked</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button className="ls-icon-btn" title="Edit" onClick={() => setModal({ mode: 'edit', item: s })}>
                          <Pencil size={14} />
                        </button>
                        <button className="ls-icon-btn ls-icon-btn--danger" title="Delete" onClick={() => setDelItem(s)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── Mobile card list ── */}
        <div className="ls-mobile-cards">
          {loading ? (
            <div className="ls-mobile-empty">Loading…</div>
          ) : statuses.length === 0 ? (
            <div className="ls-mobile-empty">No statuses yet. Add your first one.</div>
          ) : statuses.map(s => (
            <div key={s.id} className="ls-mobile-card" style={{ opacity: s.is_active ? 1 : 0.55 }}>
              <div className="ls-mobile-card-main">
                <div className="ls-mobile-card-row">
                  <StatusChip name={s.name} color={s.color} bg_color={s.bg_color} />
                  {s.is_default && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', background: '#dcfce7', borderRadius: 6, padding: '1px 6px' }}>default</span>
                  )}
                  {s.is_system && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#6366f1', background: '#eef2ff', borderRadius: 6, padding: '1px 6px' }}>🔒 system</span>
                  )}
                </div>
                <div className="ls-mobile-card-badges">
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: s.is_active ? '#dcfce7' : '#f3f4f6', color: s.is_active ? '#16a34a' : '#6b7280' }}>
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
              {canManage && (
                <div className="ls-mobile-card-actions">
                  {s.is_system ? (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>🔒 locked</span>
                  ) : (
                    <>
                      <button className="ls-icon-btn" onClick={() => setModal({ mode: 'edit', item: s })}><Pencil size={14} /></button>
                      <button className="ls-icon-btn ls-icon-btn--danger" onClick={() => setDelItem(s)}><Trash2 size={14} /></button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {statuses.length > 0 && (
          <div style={{ padding: '10px 20px', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
            {statuses.filter(s => s.is_active).length} active · {statuses.filter(s => !s.is_active).length} inactive
          </div>
        )}
      </div>

      {modal && (
        <GenericStatusModal
          title={title.replace(' Statuses', ' Status')}
          apiBase={apiBase}
          item={modal.item}
          maxOrder={maxOrder}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
      {delItem && (
        <DeleteModal item={delItem} onClose={() => setDelItem(null)} onConfirm={() => handleDelete(delItem)} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LEAD SOURCES PANEL (unchanged, kept at bottom of Lead Status tab)
// ══════════════════════════════════════════════════════════════════════════════

function SourceModal({ item, onClose, onSaved }) {
  const isEdit = !!item?.id;
  useEscapeClose(onClose);
  const [name, setName] = useState(item?.name || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault(); setError(''); setSaving(true);
    try {
      const r = isEdit
        ? await api(`/api/lead-sources/${item.id}`, { method: 'PATCH', body: { name } })
        : await api('/api/lead-sources', { method: 'POST', body: { name } });
      onSaved(r.item);
    } catch (e) { setError(e.message); setSaving(false); }
  }

  return (
    <div className="ls-backdrop">
      <div className="ls-modal ls-modal--sm" onClick={e => e.stopPropagation()}>
        <div className="ls-modal-hdr">
          <h3>{isEdit ? 'Edit Source' : 'New Source'}</h3>
          <button className="ls-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <form className="ls-modal-body" onSubmit={handleSubmit}>
          {error && <div className="ls-err"><AlertCircle size={13} /> {error}</div>}
          <div className="ls-field">
            <label>Source Name <span className="ls-req">*</span></label>
            <input className="ls-input" value={name} required autoFocus
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Walk-in, Website, Referral…" />
          </div>
        </form>
        <div className="ls-modal-ftr">
          <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="button primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Source'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LeadSourcesPanel({ canManage }) {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [delItem, setDelItem] = useState(null);
  const [toast, setToast] = useState(null);
  const dragIdx = useRef(null);
  const [dragOver, setDragOver] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api('/api/lead-sources?all=true');
      setSources(r.items);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useSync('lead_sources', load);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  function handleSaved(item) {
    setSources(prev => {
      const idx = prev.findIndex(s => s.id === item.id);
      return idx >= 0 ? prev.map(s => s.id === item.id ? item : s) : [...prev, item];
    });
    setModal(null);
    showToast(modal?.mode === 'edit' ? 'Source updated.' : 'Source added.');
  }

  async function handleDelete(item) {
    try {
      await api(`/api/lead-sources/${item.id}`, { method: 'DELETE' });
      setSources(prev => prev.filter(s => s.id !== item.id));
      setDelItem(null);
      showToast(`"${item.name}" deleted.`);
    } catch (e) { showToast(e.message, 'error'); setDelItem(null); }
  }

  async function handleToggle(item) {
    try {
      const r = await api(`/api/lead-sources/${item.id}`, { method: 'PATCH', body: { is_active: !item.is_active } });
      setSources(prev => prev.map(s => s.id === item.id ? r.item : s));
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function onDrop(dropIdx) {
    setDragOver(null);
    const from = dragIdx.current;
    dragIdx.current = null;
    if (from === null || from === dropIdx) return;
    const reordered = [...sources];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(dropIdx, 0, moved);
    setSources(reordered);
    try {
      await api('/api/lead-sources/reorder', { method: 'POST', body: { ids: reordered.map(s => s.id) } });
      setSources(reordered.map((s, i) => ({ ...s, sort_order: i + 1 })));
    } catch { showToast('Failed to save order.', 'error'); load(); }
  }

  return (
    <div style={{ marginTop: 36, position: 'relative' }}>
      {toast && (
        <div className={`ls-toast ls-toast--${toast.type}`}>
          <CheckCircle2 size={14} /> {toast.msg}
        </div>
      )}

      <header className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <Tag size={18} /> Lead Sources
          </h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
            Configure the lead source options available when creating or editing leads.
          </p>
        </div>
        {canManage && (
          <button className="button primary" onClick={() => setModal({ mode: 'add' })}>
            <Plus size={16} /> Add Source
          </button>
        )}
      </header>

      {error && <div className="banner error">{error}</div>}

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              <th>Source Name</th>
              <th>Active</th>
              <th>Order</th>
              {canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="5" style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>Loading…</td></tr>
            ) : sources.length === 0 ? (
              <tr><td colSpan="5" style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>No sources yet. Add your first one.</td></tr>
            ) : sources.map((s, idx) => (
              <tr key={s.id}
                draggable={canManage}
                onDragStart={() => { dragIdx.current = idx; }}
                onDragOver={e => { e.preventDefault(); setDragOver(idx); }}
                onDrop={() => onDrop(idx)}
                onDragLeave={() => setDragOver(null)}
                style={{
                  opacity: s.is_active ? 1 : 0.45,
                  background: dragOver === idx ? 'var(--bg-soft)' : '',
                  borderTop: dragOver === idx ? '2px solid var(--primary)' : '',
                  cursor: canManage ? 'grab' : 'default',
                  transition: 'background 0.15s',
                }}
              >
                <td><GripVertical size={14} style={{ color: canManage ? 'var(--text-muted)' : 'transparent', cursor: 'grab' }} /></td>
                <td>
                  <span style={{
                    display: 'inline-block', padding: '3px 12px', borderRadius: 20,
                    fontSize: 12, fontWeight: 700,
                    background: s.is_active ? '#dbeafe' : '#f3f4f6',
                    color: s.is_active ? '#1d4ed8' : '#6b7280',
                  }}>{s.name}</span>
                </td>
                <td>
                  <button
                    onClick={() => canManage && handleToggle(s)}
                    style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20,
                      border: 'none', cursor: canManage ? 'pointer' : 'default',
                      background: s.is_active ? '#dcfce7' : '#f3f4f6',
                      color: s.is_active ? '#16a34a' : '#6b7280',
                    }}
                  >
                    {s.is_active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>{s.sort_order}</td>
                {canManage && (
                  <td>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button className="ls-icon-btn" title="Edit" onClick={() => setModal({ mode: 'edit', item: s })}>
                        <Pencil size={14} />
                      </button>
                      <button className="ls-icon-btn ls-icon-btn--danger" title="Delete" onClick={() => setDelItem(s)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── Mobile card list ── */}
        <div className="ls-mobile-cards">
          {loading ? (
            <div className="ls-mobile-empty">Loading…</div>
          ) : sources.length === 0 ? (
            <div className="ls-mobile-empty">No sources yet. Add your first one.</div>
          ) : sources.map(s => (
            <div key={s.id} className="ls-mobile-card" style={{ opacity: s.is_active ? 1 : 0.55 }}>
              <div className="ls-mobile-card-main">
                <div className="ls-mobile-card-row">
                  <span style={{ display: 'inline-block', padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: s.is_active ? '#dbeafe' : '#f3f4f6', color: s.is_active ? '#1d4ed8' : '#6b7280' }}>
                    {s.name}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>#{s.sort_order}</span>
                </div>
                <div className="ls-mobile-card-badges">
                  <button
                    onClick={() => canManage && handleToggle(s)}
                    style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20, border: 'none', cursor: canManage ? 'pointer' : 'default', background: s.is_active ? '#dcfce7' : '#f3f4f6', color: s.is_active ? '#16a34a' : '#6b7280' }}
                  >
                    {s.is_active ? 'Active' : 'Inactive'}
                  </button>
                </div>
              </div>
              {canManage && (
                <div className="ls-mobile-card-actions">
                  <button className="ls-icon-btn" onClick={() => setModal({ mode: 'edit', item: s })}><Pencil size={14} /></button>
                  <button className="ls-icon-btn ls-icon-btn--danger" onClick={() => setDelItem(s)}><Trash2 size={14} /></button>
                </div>
              )}
            </div>
          ))}
        </div>

        {sources.length > 0 && (
          <div style={{ padding: '10px 20px', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
            {sources.filter(s => s.is_active).length} active · {sources.filter(s => !s.is_active).length} inactive
          </div>
        )}
      </div>

      {modal && <SourceModal item={modal.item} onClose={() => setModal(null)} onSaved={handleSaved} />}
      {delItem && (
        <DeleteModal item={delItem} onClose={() => setDelItem(null)} onConfirm={() => handleDelete(delItem)} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// CALL OUTCOMES PANEL
// ══════════════════════════════════════════════════════════════════════════════

function CallOutcomeForm({ item, onClose, onSaved, canManage }) {
  const isEdit = !!item?.id;
  useEscapeClose(onClose);
  const [form, setForm] = useState({ name: item?.name || '', is_active: item?.is_active ?? true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault(); setError(''); setSaving(true);
    try {
      const r = isEdit
        ? await api(`/api/call-outcomes/${item.id}`, { method: 'PATCH', body: form })
        : await api('/api/call-outcomes', { method: 'POST', body: form });
      onSaved(r.item);
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally { setSaving(false); }
  }

  return (
    <div className="ls-backdrop">
      <div className="ls-modal ls-modal--sm" onClick={e => e.stopPropagation()}>
        <div className="ls-modal-hdr">
          <h3>{isEdit ? 'Edit Outcome' : 'Add Outcome'}</h3>
          <button className="ls-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="ls-modal-body">
            {error && <div className="ls-err"><AlertCircle size={13} /> {error}</div>}
            <div className="ls-field">
              <label className="ls-label">Outcome Name *</label>
              <input className="ls-input" value={form.name} required
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Connected, Busy…" />
            </div>
            <div className="ls-field ls-field--row">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_active}
                  onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                Active (shown in call log popup)
              </label>
            </div>
          </div>
          <div className="ls-modal-ftr">
            <button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="button primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Outcome'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CallOutcomesPanel({ canManage }) {
  const [outcomes, setOutcomes]   = useState([]);
  const [loading,  setLoading]    = useState(true);
  const [modal,    setModal]      = useState(null); // { mode: 'add'|'edit', item }
  const [delItem,  setDelItem]    = useState(null);
  const [delErr,   setDelErr]     = useState('');
  const [delBusy,  setDelBusy]    = useState(false);
  const [dragOver, setDragOver]   = useState(null);
  const dragIdx                   = useRef(null);

  useEscapeClose(() => setDelItem(null), !!delItem);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api('/api/call-outcomes?all=true');
      setOutcomes(r.items || []);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onDrop(toIdx) {
    setDragOver(null);
    const fromIdx = dragIdx.current;
    if (fromIdx === null || fromIdx === toIdx) return;
    const reordered = [...outcomes];
    const [moved]   = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setOutcomes(reordered);
    dragIdx.current = null;
    try {
      await api('/api/call-outcomes/reorder', { method: 'POST', body: { ids: reordered.map(o => o.id) } });
    } catch { load(); }
  }

  async function handleDelete() {
    if (!delItem) return;
    setDelBusy(true); setDelErr('');
    try {
      await api(`/api/call-outcomes/${delItem.id}`, { method: 'DELETE' });
      setDelItem(null);
      load();
    } catch (err) { setDelErr(err.message || 'Failed to delete'); }
    finally { setDelBusy(false); }
  }

  return (
    <div className="ls-panel">
      <div className="ls-panel-hd">
        <div>
          <div className="ls-panel-title">Call Outcomes</div>
          <div className="ls-panel-desc">Options shown in the call log popup when a caller logs a call. Drag to reorder.</div>
        </div>
        {canManage && (
          <button className="button primary sm" onClick={() => setModal({ mode: 'add', item: null })}>
            <Plus size={14} /> Add Outcome
          </button>
        )}
      </div>

      <table className="data-table">
        <thead>
          <tr>
            {canManage && <th style={{ width: 28 }} />}
            <th>Name</th>
            <th>Active</th>
            {canManage && <th />}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan="4" style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>Loading…</td></tr>
          ) : outcomes.length === 0 ? (
            <tr><td colSpan="4" style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>No outcomes yet.</td></tr>
          ) : outcomes.map((o, idx) => (
            <tr key={o.id}
              draggable={canManage}
              onDragStart={() => { dragIdx.current = idx; }}
              onDragOver={e => { e.preventDefault(); setDragOver(idx); }}
              onDrop={() => onDrop(idx)}
              onDragLeave={() => setDragOver(null)}
              style={{
                opacity: o.is_active ? 1 : 0.45,
                background: dragOver === idx ? 'var(--bg-soft)' : '',
                borderTop: dragOver === idx ? '2px solid var(--primary)' : '',
                cursor: canManage ? 'grab' : 'default',
              }}
            >
              {canManage && (
                <td><GripVertical size={14} style={{ color: 'var(--text-muted)', cursor: 'grab' }} /></td>
              )}
              <td style={{ fontWeight: 500, fontSize: 14 }}>{o.name}</td>
              <td>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20,
                  background: o.is_active ? '#dcfce7' : '#f3f4f6',
                  color: o.is_active ? '#16a34a' : '#6b7280',
                }}>
                  {o.is_active ? 'Active' : 'Inactive'}
                </span>
              </td>
              {canManage && (
                <td>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <button className="ls-icon-btn" title="Edit" onClick={() => setModal({ mode: 'edit', item: o })}>
                      <Pencil size={14} />
                    </button>
                    <button className="ls-icon-btn ls-icon-btn--danger" title="Delete" onClick={() => { setDelItem(o); setDelErr(''); }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {outcomes.length > 0 && (
        <div style={{ padding: '10px 20px', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
          {outcomes.filter(o => o.is_active).length} active · {outcomes.filter(o => !o.is_active).length} inactive
        </div>
      )}

      {modal && (
        <CallOutcomeForm
          item={modal.item}
          canManage={canManage}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}

      {delItem && (
        <div className="ls-backdrop">
          <div className="ls-modal ls-modal--sm" onClick={e => e.stopPropagation()}>
            <div className="ls-modal-hdr">
              <h3>Delete Outcome</h3>
              <button className="ls-icon-btn" onClick={() => setDelItem(null)}><X size={18} /></button>
            </div>
            <div className="ls-modal-body">
              {delErr && <div className="ls-err"><AlertCircle size={13} /> {delErr}</div>}
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
                Delete outcome <strong>{delItem.name}</strong>? This cannot be undone.
              </p>
            </div>
            <div className="ls-modal-ftr">
              <button className="button secondary" onClick={() => setDelItem(null)} disabled={delBusy}>Cancel</button>
              <button className="button danger" onClick={handleDelete} disabled={delBusy}>
                {delBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── One panel, two lists ────────────────────────────────────────────────────
 *
 * Lost Reasons and Competitors are the same screen: a short ordered list of
 * names an admin owns, with an active toggle, drag-to-reorder, and a count of
 * how many leads point at each row. Only the extra columns and the extra form
 * fields differ, so those are the only things passed in.
 *
 * Written as one component rather than two copies because the two copies would
 * be identical on the day they were written and would not stay that way — the
 * drag handler, the delete-error handling and the empty state have all been
 * fixed once already in CallOutcomesPanel and would each need fixing twice
 * more. (That panel is left alone deliberately: it works, and folding it in
 * would be a change to a screen nobody asked about.)
 *
 * The DELETE ERROR is rendered rather than swallowed, and that is the whole
 * reason the dialog has an error slot: both APIs refuse a delete while leads
 * still point at the row, and the message they return names the number. A
 * silent failure here reads as a broken button.
 */
function MasterListPanel({
  canManage, apiBase, topic, title, description, addLabel, nounSingular,
  nameLabel, namePlaceholder, activeHint,
  countLabel, columns = [], FormExtra = null, makeForm,
}) {
  const [items,    setItems]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(null);   // { item }
  const [delItem,  setDelItem]  = useState(null);
  const [delErr,   setDelErr]   = useState('');
  const [delBusy,  setDelBusy]  = useState(false);
  const [dragOver, setDragOver] = useState(null);
  const dragIdx = useRef(null);

  useEscapeClose(() => setDelItem(null), !!delItem);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api(`${apiBase}?all=true`);
      setItems(r.items || []);
    } catch { /* the empty state says it better than a toast would */ }
    finally { setLoading(false); }
  }, [apiBase]);

  useEffect(() => { load(); }, [load]);
  /* Two admins on this screen at once see each other's edits. CallOutcomesPanel
     has no useSync and they do not, which is a small thing until one of them
     deletes a row the other is editing. */
  useSync(topic, load);

  async function onDrop(toIdx) {
    setDragOver(null);
    const fromIdx = dragIdx.current;
    if (fromIdx === null || fromIdx === toIdx) return;
    const reordered = [...items];
    const [moved]   = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setItems(reordered);            // optimistic: dragging should feel instant
    dragIdx.current = null;
    try {
      await api(`${apiBase}/reorder`, { method: 'POST', body: { ids: reordered.map(o => o.id) } });
    } catch { load(); }             // and snap back if the server disagreed
  }

  async function handleDelete() {
    if (!delItem) return;
    setDelBusy(true); setDelErr('');
    try {
      await api(`${apiBase}/${delItem.id}`, { method: 'DELETE' });
      setDelItem(null);
      load();
    } catch (err) { setDelErr(err.message || 'Failed to delete'); }
    finally { setDelBusy(false); }
  }

  const colSpan = 3 + columns.length + (canManage ? 2 : 0);

  return (
    <div className="ls-panel">
      <div className="ls-panel-hd">
        <div>
          <div className="ls-panel-title">{title}</div>
          <div className="ls-panel-desc">{description}</div>
        </div>
        {canManage && (
          <button className="button primary sm" onClick={() => setModal({ item: null })}>
            <Plus size={14} /> {addLabel}
          </button>
        )}
      </div>

      <table className="data-table">
        <thead>
          <tr>
            {canManage && <th style={{ width: 28 }} />}
            <th>Name</th>
            {columns.map(c => <th key={c.key}>{c.header}</th>)}
            <th>{countLabel}</th>
            <th>Active</th>
            {canManage && <th />}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={colSpan} style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>Loading…</td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan={colSpan} style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
              Nothing here yet. {canManage ? `Use "${addLabel}" to start the list.` : ''}
            </td></tr>
          ) : items.map((o, idx) => (
            <tr key={o.id}
              draggable={canManage}
              onDragStart={() => { dragIdx.current = idx; }}
              onDragOver={e => { e.preventDefault(); setDragOver(idx); }}
              onDrop={() => onDrop(idx)}
              onDragLeave={() => setDragOver(null)}
              style={{
                opacity: o.is_active ? 1 : 0.45,
                background: dragOver === idx ? 'var(--bg-soft)' : '',
                borderTop: dragOver === idx ? '2px solid var(--primary)' : '',
                cursor: canManage ? 'grab' : 'default',
              }}
            >
              {canManage && (
                <td><GripVertical size={14} style={{ color: 'var(--text-muted)', cursor: 'grab' }} /></td>
              )}
              <td style={{ fontWeight: 500, fontSize: 14 }}>{o.name}</td>
              {columns.map(c => <td key={c.key}>{c.render(o)}</td>)}
              <td style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {o.lead_count ?? 0}
              </td>
              <td>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20,
                  background: o.is_active ? '#dcfce7' : '#f3f4f6',
                  color: o.is_active ? '#16a34a' : '#6b7280',
                }}>
                  {o.is_active ? 'Active' : 'Inactive'}
                </span>
              </td>
              {canManage && (
                <td>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <button className="ls-icon-btn" title="Edit" onClick={() => setModal({ item: o })}>
                      <Pencil size={14} />
                    </button>
                    <button className="ls-icon-btn ls-icon-btn--danger" title="Delete" onClick={() => { setDelItem(o); setDelErr(''); }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {items.length > 0 && (
        <div style={{ padding: '10px 20px', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
          {items.filter(o => o.is_active).length} active · {items.filter(o => !o.is_active).length} inactive
          {' · '}{items.reduce((n, o) => n + (o.lead_count || 0), 0)} lead(s) accounted for
        </div>
      )}

      {modal && (
        <MasterListForm
          item={modal.item}
          apiBase={apiBase}
          nounSingular={nounSingular}
          nameLabel={nameLabel}
          namePlaceholder={namePlaceholder}
          activeHint={activeHint}
          makeForm={makeForm}
          FormExtra={FormExtra}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}

      {delItem && (
        <div className="ls-backdrop">
          <div className="ls-modal ls-modal--sm" onClick={e => e.stopPropagation()}>
            <div className="ls-modal-hdr">
              <h3>Delete {nounSingular}</h3>
              <button className="ls-icon-btn" onClick={() => setDelItem(null)}><X size={18} /></button>
            </div>
            <div className="ls-modal-body">
              {delErr && <div className="ls-err"><AlertCircle size={13} /> {delErr}</div>}
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
                Delete <strong>{delItem.name}</strong>? This cannot be undone.
                {delItem.lead_count > 0 && (
                  <>
                    {' '}
                    <span style={{ color: 'var(--danger)' }}>
                      {delItem.lead_count} lead(s) point at it — deactivating keeps their history and
                      stops it being offered on new ones.
                    </span>
                  </>
                )}
              </p>
            </div>
            <div className="ls-modal-ftr">
              <button className="button secondary" onClick={() => setDelItem(null)} disabled={delBusy}>Cancel</button>
              <button className="button danger" onClick={handleDelete} disabled={delBusy}>
                {delBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MasterListForm({ item, apiBase, nounSingular, nameLabel, namePlaceholder, activeHint, makeForm, FormExtra, onClose, onSaved }) {
  const isEdit = !!item?.id;
  useEscapeClose(onClose);
  const [form, setForm]     = useState(() => makeForm(item));
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [note, setNote]     = useState('');

  async function handleSubmit(e) {
    e.preventDefault(); setError(''); setSaving(true);
    try {
      const r = isEdit
        ? await api(`${apiBase}/${item.id}`, { method: 'PATCH', body: form })
        : await api(apiBase, { method: 'POST', body: form });
      /* The rename cascade reports how many leads came with it. Saying so is
         the difference between "did my leads move?" and knowing they did —
         lead_statuses does the same thing for the same reason. */
      if (r.leads_relabelled) {
        setNote(`Renamed — ${r.leads_relabelled} lead(s) updated.`);
        setTimeout(() => onSaved(r.item), 900);
        return;
      }
      onSaved(r.item);
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally { setSaving(false); }
  }

  return (
    <div className="ls-backdrop">
      <div className="ls-modal ls-modal--sm" onClick={e => e.stopPropagation()}>
        <div className="ls-modal-hdr">
          <h3>{isEdit ? `Edit ${nounSingular}` : `Add ${nounSingular}`}</h3>
          <button className="ls-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="ls-modal-body">
            {error && <div className="ls-err"><AlertCircle size={13} /> {error}</div>}
            {note && <div className="ls-ok"><CheckCircle2 size={13} /> {note}</div>}
            <div className="ls-field">
              <label className="ls-label">{nameLabel} *</label>
              <input className="ls-input" value={form.name} required
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder={namePlaceholder} />
            </div>
            {FormExtra && <FormExtra form={form} setForm={setForm} />}
            <div className="ls-field ls-field--row">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_active}
                  onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                {activeHint}
              </label>
            </div>
          </div>
          <div className="ls-modal-ftr">
            <button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="button primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : `Add ${nounSingular}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── The two behaviour fields on a reason ────────────────────────────────────
 * Both optional, and both off by default: a reason that does nothing but label
 * a lost lead is the normal case, and the two that do more should look like
 * the exception they are.
 */
function LostReasonExtra({ form, setForm }) {
  return (
    <div className="ls-behaviour-box">
      <div className="ls-behaviour-title">What this reason does</div>

      <label className="ls-behaviour-row">
        <input type="checkbox" checked={form.requires_competitor}
          onChange={e => setForm(f => ({ ...f, requires_competitor: e.target.checked }))} />
        <div>
          <span className="ls-behaviour-label">Ask which competitor took the job</span>
          <span className="ls-behaviour-hint">
            Picking this reason also asks for a competitor and the date they did the service.
            Both are needed before the lead can be saved.
          </span>
        </div>
      </label>

      <div className="ls-field" style={{ marginBottom: 0 }}>
        <label className="ls-label">Bring the lead back after</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input className="ls-input" type="number" min="1" max="60" style={{ width: 90 }}
            value={form.retarget_after_months ?? ''}
            placeholder="—"
            onChange={e => setForm(f => ({
              ...f,
              // '' means never, and must reach the API as null rather than 0 —
              // zero months would schedule the retarget for the same day.
              retarget_after_months: e.target.value === '' ? null : Number(e.target.value),
            }))} />
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>months</span>
        </div>
        <span className="ls-behaviour-hint" style={{ marginTop: 6, display: 'block' }}>
          Counted from the competitor's service date, or from the day the lead was marked lost
          when no date was captured. The lead moves to the retarget status by itself and appears
          in that day's follow-up list. <strong>Leave blank for a reason that is never chased
          again</strong> — a wrong number is not worth a call in three months.
        </span>
      </div>
    </div>
  );
}

function CompetitorExtra({ form, setForm }) {
  return (
    <div className="ls-field">
      <label className="ls-label">Notes</label>
      <textarea className="ls-input" rows={2} value={form.notes ?? ''}
        placeholder="Where they are, what they undercut us on…"
        style={{ resize: 'vertical', fontFamily: 'inherit' }}
        onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
    </div>
  );
}

function LostReasonsPanel({ canManage }) {
  return (
    <MasterListPanel
      canManage={canManage}
      apiBase="/api/lost-reasons"
      topic="lost_reasons"
      title="Lost Reasons"
      description={'Offered when a lead is set to a status with "Ask for a lost reason" ticked. Drag to reorder — the first ones are the ones people reach for.'}
      addLabel="Add Reason"
      nounSingular="Reason"
      nameLabel="Reason"
      namePlaceholder="e.g. Price Too High, Competitor Service…"
      activeHint="Active (offered when marking a lead lost)"
      countLabel="Leads"
      makeForm={item => ({
        name: item?.name || '',
        is_active: item?.is_active ?? true,
        requires_competitor: item?.requires_competitor ?? false,
        retarget_after_months: item?.retarget_after_months ?? null,
      })}
      FormExtra={LostReasonExtra}
      columns={[{
        key: 'behaviour',
        header: 'Behaviour',
        render: o => (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {o.requires_competitor && <span className="ls-flag-badge ls-flag-badge--red">Asks competitor</span>}
            {o.retarget_after_months
              ? <span className="ls-flag-badge ls-flag-badge--amber">↺ {o.retarget_after_months} months</span>
              : null}
            {!o.requires_competitor && !o.retarget_after_months && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
            )}
          </div>
        ),
      }]}
    />
  );
}

function CompetitorsPanel({ canManage }) {
  return (
    <MasterListPanel
      canManage={canManage}
      apiBase="/api/competitors"
      topic="competitors"
      title="Competitors"
      description="The workshops you lose jobs to. Offered by any lost reason that asks who took the job — and the count on the right is how much work each of them has taken."
      addLabel="Add Competitor"
      nounSingular="Competitor"
      nameLabel="Workshop Name"
      namePlaceholder="e.g. AutoZone Motors"
      activeHint="Active (offered when marking a lead lost)"
      countLabel="Jobs Lost"
      makeForm={item => ({
        name: item?.name || '',
        notes: item?.notes || '',
        is_active: item?.is_active ?? true,
      })}
      FormExtra={CompetitorExtra}
      columns={[{
        key: 'notes',
        header: 'Notes',
        render: o => o.notes
          ? <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{o.notes}</span>
          : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>,
      }]}
    />
  );
}

// MAIN PAGE — tabbed layout
// ══════════════════════════════════════════════════════════════════════════════

const TABS = [
  { key: 'lead', label: 'Lead Status', icon: Tag },
  { key: 'appointment', label: 'Appointment Status', icon: Calendar },
  { key: 'invoice', label: 'Invoice Status', icon: FileText },
  { key: 'call_outcomes', label: 'Call Outcomes', icon: Phone },
  { key: 'lost_reasons',  label: 'Lost Reasons',  icon: Ban },
  { key: 'competitors',   label: 'Competitors',   icon: Building2 },
];

export default function LeadStatusesPage() {
  const canManage = useCan('MANAGE_MASTER_DATA');
  const [activeTab, setActiveTab] = useState('lead');

  return (
    <div className="ls-page">
      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <div className="ls-tab-bar">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              className={`ls-tab${activeTab === t.key ? ' ls-tab--active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              <Icon size={15} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Tab content ───────────────────────────────────────────────────── */}
      <div style={{ marginTop: 24 }}>
        {activeTab === 'lead' && (
          <>
            <LeadStatusPanel canManage={canManage} />
            <LeadSourcesPanel canManage={canManage} />
          </>
        )}
        {activeTab === 'appointment' && (
          <GenericStatusPanel
            canManage={canManage}
            apiBase="/api/appointment-statuses"
            title="Appointment Statuses"
            description="Configure the statuses available on Appointment records."
            addLabel="Add Status"
          />
        )}
        {activeTab === 'invoice' && (
          <GenericStatusPanel
            canManage={canManage}
            apiBase="/api/invoice-statuses"
            title="Invoice Statuses"
            description="Configure the statuses available on Invoice records."
            addLabel="Add Status"
          />
        )}
        {activeTab === 'call_outcomes' && (
          <CallOutcomesPanel canManage={canManage} />
        )}
        {activeTab === 'lost_reasons' && (
          <LostReasonsPanel canManage={canManage} />
        )}
        {activeTab === 'competitors' && (
          <CompetitorsPanel canManage={canManage} />
        )}
      </div>
    </div>
  );
}
