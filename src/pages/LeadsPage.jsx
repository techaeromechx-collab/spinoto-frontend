import { useEffect, useState, useCallback, useRef, useMemo, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useSearchParams, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useCan, useAuth } from '../auth/AuthContext.jsx';
import { useBodyLock } from '../hooks/useBodyLock.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import {
  PlusCircle, Search, User, Calendar, MapPin, Car, Bike,
  MoreVertical, Eye, Pencil, Trash2, X, CheckCircle2,
  AlertCircle, Phone, MessageCircle, Tag, FileText,
  IndianRupee, ChevronDown, UserCheck, Wrench, Plus, Info,
  SlidersHorizontal, Bell, Clock, Send, MessageSquare, Activity, Download, Lock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import '../styles/LeadsPage.css';

// ── Duration formatter ────────────────────────────────────────────────────────
function formatDuration(seconds) {
  if (!seconds || seconds < 60) return '< 1 min';
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) {
    const remH = h % 24;
    return remH > 0 ? `${d}d ${remH}h` : `${d}d`;
  }
  if (h >= 1) {
    const remM = m % 60;
    return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
  }
  return `${m}m`;
}

// ── Lost Reason options ───────────────────────────────────────────────────────
export const LOST_REASONS = [
  'Price too high',
  'Chose competitor',
  'Not interested',
  'Budget issue',
  'No response',
  'Wrong requirement',
  'Other',
];

// Mini modal shown when user changes status to "Lost"
function LostReasonModal({ statusName, onConfirm, onCancel }) {
  useBodyLock();
  useEscapeClose(onCancel);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  function handleConfirm() {
    if (!reason) { setError('Please select a reason.'); return; }
    onConfirm(reason);
  }

  return (
    <div className="lr-backdrop">
      <div className="lr-modal" onClick={e => e.stopPropagation()}>
        <div className="lr-header">
          <span className="lr-title">Why is this lead lost?</span>
          <button className="lr-close" onClick={onCancel}><X size={16} /></button>
        </div>
        <div className="lr-body">
          <p className="lr-sub">
            Status is being changed to <strong>{statusName}</strong>. Select a reason so you can track where leads drop off.
          </p>
          <div className="lr-reasons">
            {LOST_REASONS.map(r => (
              <button
                key={r} type="button"
                className={`lr-reason-btn${reason === r ? ' lr-reason-btn--active' : ''}`}
                onClick={() => { setReason(r); setError(''); }}
              >{r}</button>
            ))}
          </div>
          {error && <p className="lr-error"><AlertCircle size={12} /> {error}</p>}
        </div>
        <div className="lr-footer">
          <button className="lr-btn-cancel" onClick={onCancel}>Cancel</button>
          <button className="lr-btn-confirm" onClick={handleConfirm}>Mark as Lost</button>
        </div>
      </div>
    </div>
  );
}

// ── Avatar helpers ────────────────────────────────────────────────────────────
const AVATAR_STYLES = [
  { bg: '#ede9fe', color: '#6d28d9' }, // violet
  { bg: '#fce7f3', color: '#be185d' }, // pink
  { bg: '#dbeafe', color: '#1d4ed8' }, // blue
  { bg: '#dcfce7', color: '#15803d' }, // green
  { bg: '#ffedd5', color: '#c2410c' }, // orange
  { bg: '#cffafe', color: '#0e7490' }, // cyan
  { bg: '#fef9c3', color: '#a16207' }, // yellow
  { bg: '#fee2e2', color: '#b91c1c' }, // red
  { bg: '#e0e7ff', color: '#4338ca' }, // indigo
  { bg: '#ccfbf1', color: '#0f766e' }, // teal
  { bg: '#fdf4ff', color: '#a21caf' }, // fuchsia
  { bg: '#f0fdf4', color: '#166534' }, // dark green
];
function getAvatarStyle(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_STYLES[Math.abs(h) % AVATAR_STYLES.length];
}
function getAvatarInitials(name, mobile) {
  if (name && name.trim()) {
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }
  return (mobile || '').replace(/\D/g, '').slice(0, 2) || '?';
}

// ── Lead Source options & badge colours ──────────────────────────────────────
// Kept as fallback; real list is fetched from /api/lead-sources at runtime
export const LEAD_SOURCES = [
  'Walk-in', 'Phone Call', 'Website', 'Referral',
  'Social Media', 'Exhibition', 'Other',
];
const SOURCE_STYLE = {
  'Walk-in': { bg: '#dbeafe', color: '#1d4ed8' },
  'Phone Call': { bg: '#d1fae5', color: '#065f46' },
  'Website': { bg: '#ede9fe', color: '#6d28d9' },
  'Referral': { bg: '#fef3c7', color: '#92400e' },
  'Social Media': { bg: '#fce7f3', color: '#9d174d' },
  'Exhibition': { bg: '#ffedd5', color: '#9a3412' },
  'Other': { bg: '#f1f5f9', color: '#475569' },
};
function SourceBadge({ source }) {
  if (!source) return null;
  const s = SOURCE_STYLE[source] || SOURCE_STYLE['Other'];
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 20,
      fontSize: 11, fontWeight: 600, background: s.bg, color: s.color,
      whiteSpace: 'nowrap',
    }}>{source}</span>
  );
}

// ── Vehicle helpers ───────────────────────────────────────────────────────────
function is2WType(name = '') {
  const n = name.toLowerCase();
  return n.includes('two') || n.includes('2w') || n.includes('2-w')
    || n.includes('bike') || n.includes('scoot') || n.includes('motor');
}

// ── Searchable dropdown ───────────────────────────────────────────────────────
const SEGMENT_BADGE_COLORS = {
  P: { bg: '#fef3c7', color: '#92400e' }, // Petrol – amber
  D: { bg: '#dbeafe', color: '#1e40af' }, // Diesel – blue
  C: { bg: '#d1fae5', color: '#065f46' }, // CNG    – green
  E: { bg: '#ede9fe', color: '#5b21b6' }, // Electric – violet
};
function segBadgeStyle(letter) {
  return SEGMENT_BADGE_COLORS[letter?.toUpperCase()] || { bg: '#f1f5f9', color: '#475569' };
}

function SearchableSelect({
  value, onChange, options = [], placeholder = 'Select…',
  disabled = false, loading = false, emptyMsg = 'No options', clearable = false,
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const selected = options.find(o => String(o.id) === String(value));
  const filtered = query
    ? options.filter(o => o.name.toLowerCase().includes(query.toLowerCase()))
    : options;

  useEffect(() => {
    function onOut(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setQuery(''); } }
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, []);

  function handleOpen() {
    if (disabled || loading) return;
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  }
  function pick(id) { onChange(id); setOpen(false); setQuery(''); }

  return (
    <div ref={wrapRef} className="ess-wrap">
      <div
        className={`ess-trigger${open ? ' ess-open' : ''}${disabled || loading ? ' ess-disabled' : ''}`}
        onClick={handleOpen} tabIndex={disabled ? -1 : 0}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleOpen()}
      >
        <span className={selected ? 'ess-val' : 'ess-ph'} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          {loading ? 'Loading…' : selected ? (
            <>
              {selected.name}
              {selected.badge && (
                <span className="ess-seg-badge" style={{ background: segBadgeStyle(selected.badge).bg, color: segBadgeStyle(selected.badge).color }}>
                  {selected.badge}
                </span>
              )}
            </>
          ) : placeholder}
        </span>
        {clearable && selected && !disabled && (
          <span
            onMouseDown={e => { e.stopPropagation(); onChange(''); setOpen(false); setQuery(''); }}
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--text-muted)', marginRight: 2 }}
          ><X size={12} /></span>
        )}
        <ChevronDown size={13} className={`ess-caret${open ? ' ess-caret-up' : ''}`} />
      </div>
      <AnimatePresence>
        {open && (
          <motion.div className="ess-dropdown"
            initial={{ opacity: 0, y: -4, scale: .98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: .98 }}
            transition={{ duration: 0.13 }}>
            <div className="ess-search-row">
              <Search size={12} className="ess-si" />
              <input ref={inputRef} className="ess-si-input" value={query}
                onChange={e => setQuery(e.target.value)} placeholder="Search…" />
              {query && <button className="lp-clear-btn" onMouseDown={() => setQuery('')}><X size={11} /></button>}
            </div>
            <div className="ess-list">
              {filtered.length === 0
                ? <div className="ess-empty">{query ? `No match for "${query}"` : emptyMsg}</div>
                : filtered.map(o => (
                  <div key={o.id}
                    className={`ess-opt${String(o.id) === String(value) ? ' ess-opt-sel' : ''}`}
                    onMouseDown={() => pick(String(o.id))}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                      {o.name}
                      {o.badge && (
                        <span className="ess-seg-badge" style={{ background: segBadgeStyle(o.badge).bg, color: segBadgeStyle(o.badge).color }}>
                          {o.badge}
                        </span>
                      )}
                    </span>
                    {String(o.id) === String(value) && <CheckCircle2 size={12} />}
                  </div>
                ))
              }
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Status helpers (dynamic — loaded from API) ────────────────────────────────
// Fallback for any status not yet in the loaded list
function getStatusCfg(statusName, statusList) {
  const found = statusList.find(s => s.name === statusName);
  return found
    ? { color: found.color, bg: found.bg_color }
    : { color: '#6b7280', bg: '#f3f4f6' };
}

function StatusBadge({ status, statusList = [] }) {
  if (!status) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 10px', borderRadius: 20,
        fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
        color: '#0369a1', background: '#e0f2fe',
        border: '1.5px solid #0369a133',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#0ea5e9', display: 'inline-block' }} />
        New Lead
      </span>
    );
  }
  const cfg = getStatusCfg(status, statusList);
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
      color: cfg.color, background: cfg.bg,
    }}>
      {status}
    </span>
  );
}

// ── Row action dropdown ───────────────────────────────────────────────────────
function ActionMenu({ lead, canEdit, canDelete, onView, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onOut(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button className="lp-icon-btn" onClick={() => setOpen(o => !o)} title="Actions">
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="lp-dropdown">
          <button className="lp-dropdown-item" onClick={() => { setOpen(false); onView(lead); }}>
            <Eye size={14} /> View Details
          </button>
          {canEdit && !lead.is_converted && (
            <button className="lp-dropdown-item" onClick={() => { setOpen(false); onEdit(lead); }}>
              <Pencil size={14} /> Edit Lead
            </button>
          )}
          {canDelete && (
            <>
              <div className="lp-dropdown-divider" />
              <button className="lp-dropdown-item lp-dropdown-item--danger" onClick={() => { setOpen(false); onDelete(lead); }}>
                <Trash2 size={14} /> Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── View Lead Modal ───────────────────────────────────────────────────────────
function ViewLeadModal({ leadId, onClose, onEdit, canEdit, statusList = [], onLeadLoaded }) {
  useBodyLock();
  useEscapeClose(onClose);
  const { user: currentUser } = useAuth();
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ── Notes & Activity state ─────────────────────────────────────────────────
  const [notes, setNotes] = useState([]);
  const [activities, setActivities] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState('');
  const timelineEndRef = useRef(null);
  const [rescheduleId, setRescheduleId] = useState(null); // follow-up event id to reschedule

  useEffect(() => {
    setLoading(true);
    api(`/api/leads/${leadId}`)
      .then(r => { setLead(r.item); onLeadLoaded?.(r.item); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onLeadLoaded intentionally
    // not tracked: it's a stable callback used to sync the URL once, not a data
    // dependency; adding it would risk re-fetching on every parent re-render.
  }, [leadId]);

  // Load notes + activities + follow-ups once lead is fetched
  useEffect(() => {
    if (!leadId) return;
    Promise.all([
      api(`/api/lead-notes/${leadId}`).catch(() => ({ items: [] })),
      api(`/api/lead-activities/${leadId}`).catch(() => ({ items: [] })),
      api(`/api/lead-events?lead_id=${leadId}&all=true`).catch(() => ({ items: [] })),
    ]).then(([n, a, fu]) => {
      setNotes(n.items || []);
      setActivities(a.items || []);
      // Pending first (soonest at top), done ones at the bottom
      setFollowUps((fu.items || []).sort((a, b) => {
        if (a.is_done !== b.is_done) return a.is_done ? 1 : -1;
        return new Date(a.due_date) - new Date(b.due_date);
      }));
    });
  }, [leadId]);

  async function handleAddNote(e) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setNoteSaving(true);
    setNoteError('');
    try {
      await api(`/api/lead-notes/${leadId}`, { method: 'POST', body: { note: noteText.trim() } });
      setNoteText('');
      // Refresh both notes and activities
      const [n, a] = await Promise.all([
        api(`/api/lead-notes/${leadId}`).catch(() => ({ items: [] })),
        api(`/api/lead-activities/${leadId}`).catch(() => ({ items: [] })),
      ]);
      setNotes(n.items || []);
      setActivities(a.items || []);
      setTimeout(() => timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
    } catch (err) {
      setNoteError(err.message || 'Failed to save note');
    } finally {
      setNoteSaving(false);
    }
  }

  async function handleReschedule({ date, time, note }) {
    await api(`/api/lead-events/${rescheduleId}/done`, { method: 'PATCH' });
    await api(`/api/leads/${leadId}`, {
      method: 'PATCH',
      body: {
        status: lead?.status,
        follow_up_date: date,
        follow_up_time: time || null,
        follow_up_note: note || null,
      },
    });
    // Refresh follow-up list
    const fu = await api(`/api/lead-events?lead_id=${leadId}&all=true`).catch(() => ({ items: [] }));
    setFollowUps((fu.items || []).sort((a, b) => {
      if (a.is_done !== b.is_done) return a.is_done ? 1 : -1;
      return new Date(a.due_date) - new Date(b.due_date);
    }));
    setRescheduleId(null);
  }

  // Notes only, sorted oldest → newest
  const timeline = [...notes].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // Status history — only status_changed + created events, newest first
  const statusHistory = activities
    .filter(a => a.type === 'status_changed' || a.type === 'created')
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // Assignment history — newest first
  const assignHistory = activities
    .filter(a => a.type === 'assigned_changed')
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // Service history — newest first
  const serviceHistory = activities
    .filter(a => a.type === 'service_added' || a.type === 'service_removed')
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // Pre-compute time-spent for each status history item (chronological order → reverse of statusHistory)
  const stageDurations = (() => {
    const chron = [...statusHistory].reverse(); // oldest first
    const now = Date.now();
    return Object.fromEntries(chron.map((item, idx) => {
      const start = new Date(item.created_at).getTime();
      const end = idx < chron.length - 1
        ? new Date(chron[idx + 1].created_at).getTime()
        : now;
      return [item.id, Math.floor((end - start) / 1000)];
    }));
  })();

  const leadStatusObj = statusList.find(s => s.name === lead?.status);
  const isLeadLocked = !!leadStatusObj?.is_locked || !!lead?.is_converted;

  const statusObj = lead ? { color: '#6366f1' } : null; // fallback; real color comes from StatusBadge
  const initials = lead?.name
    ? lead.name.trim().split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
    : (lead?.mobile?.slice(-2) ?? '??');

  return (
    <div className="lp-modal-backdrop">
      <div className="lp-modal lp-modal--lg lp-view-modal" onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="lp-vm-header">
          <div className="lp-vm-header-left">
            <span className="lp-vm-title">Lead Details</span>
            {lead && <StatusBadge status={lead.status} />}
          </div>
          <div className="lp-vm-header-actions">
            {canEdit && lead && !lead.is_converted && (
              <button className="lp-vm-edit-btn" onClick={() => { onClose(); onEdit(lead); }}>
                <Pencil size={14} /> Edit
              </button>
            )}
            {lead?.is_converted && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: '#ecfdf5', color: '#059669', border: '1.5px solid #6ee7b7',
                borderRadius: 20, padding: '3px 12px', fontSize: 12, fontWeight: 700,
              }}>
                <CheckCircle2 size={13} /> Converted to Appointment
              </span>
            )}
            <button className="lp-modal-close" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        <div className="lp-modal-body lp-vm-body">
          {loading && <div className="lp-loading">Loading…</div>}
          {error && <div className="lp-error"><AlertCircle size={14} /> {error}</div>}
          {lead && (
            <div className="lp-vm-grid">

              {/* ── Customer card ── */}
              <div className="lp-vm-card lp-vm-card--customer">
                <div className="lp-vm-card-hd"><User size={13} /> Customer</div>
                <div className="lp-vm-customer-main">
                  <div className="lp-vm-avatar">{initials}</div>
                  <div className="lp-vm-customer-info">
                    <div className="lp-vm-customer-name">
                      {lead.name || <span className="lp-muted">No name</span>}
                    </div>
                    <div className="lp-vm-customer-mobile">
                      <Phone size={12} /> {lead.mobile}
                    </div>
                    {lead.whatsapp && lead.whatsapp !== lead.mobile && (
                      <div className="lp-vm-customer-mobile">
                        <MessageCircle size={12} /> {lead.whatsapp}
                        <span className="lp-vm-wa-label">WhatsApp</span>
                      </div>
                    )}
                    {(lead.area_name || lead.city_name) && (
                      <div className="lp-vm-customer-mobile">
                        <MapPin size={12} />
                        {[lead.area_name, lead.city_name, lead.state_name].filter(Boolean).join(', ')}
                      </div>
                    )}
                  </div>
                </div>
                {/* Action buttons */}
                <div className="lp-vm-contact-btns">
                  <a className="lp-vm-btn lp-vm-btn--call"
                    href={`tel:${lead.mobile}`}>
                    <Phone size={15} /> Call
                  </a>
                  <a className="lp-vm-btn lp-vm-btn--wa"
                    href={`https://wa.me/${(lead.whatsapp || lead.mobile).replace(/\D/g, '')}`}
                    target="_blank" rel="noreferrer">
                    <MessageCircle size={15} /> WhatsApp
                  </a>
                </div>
              </div>

              {/* ── Vehicle card ── */}
              <div className="lp-vm-card">
                <div className="lp-vm-card-hd"><Car size={13} /> Vehicle</div>
                {lead.vehicle_type_name || lead.make_name || lead.model_name || lead.body_type_name ? (
                  <div className="lp-vm-info-list">
                    {lead.vehicle_type_name && (
                      <div className="lp-vm-info-row">
                        <span className="lp-vm-info-label">Type</span>
                        <span className="lp-vm-info-val">{lead.vehicle_type_name}</span>
                      </div>
                    )}
                    {(lead.make_name || lead.model_name) && (
                      <div className="lp-vm-info-row">
                        <span className="lp-vm-info-label">Make / Model</span>
                        <span className="lp-vm-info-val">{[lead.make_name, lead.model_name].filter(Boolean).join(' ')}</span>
                      </div>
                    )}
                    {/* 4W: body type */}
                    {lead.body_type_name && (
                      <div className="lp-vm-info-row">
                        <span className="lp-vm-info-label">Body</span>
                        <span className="lp-vm-info-val">{lead.body_type_name}</span>
                      </div>
                    )}
                    {/* Segment / Fuel Type */}
                    {lead.segment_names?.length > 0 && (
                      <div className="lp-vm-info-row">
                        <span className="lp-vm-info-label">Fuel Type</span>
                        <span className="lp-vm-info-val">{lead.segment_names.join(', ')}</span>
                      </div>
                    )}
                    {/* 2W: engine CC */}
                    {lead.engine_cc && (
                      <div className="lp-vm-info-row">
                        <span className="lp-vm-info-label">Engine CC</span>
                        <span className="lp-vm-info-val">{lead.engine_cc} cc</span>
                      </div>
                    )}
                    {/* 2W: CC category */}
                    {lead.cc_category_name && (
                      <div className="lp-vm-info-row">
                        <span className="lp-vm-info-label">CC Category</span>
                        <span className="lp-vm-info-val">{lead.cc_category_name}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="lp-vm-empty-card">No vehicle info added</div>
                )}

                {/* ── Vehicle not in master at all (imported with note) ── */}
                {!lead.make_id && lead.notes?.includes('[Vehicle not in master:') && (() => {
                  const match = lead.notes.match(/\[Vehicle not in master: "([^"]+)"/);
                  const vehicleText = match ? match[1] : 'this vehicle';
                  return (
                    <div className="lp-vm-master-warn">
                      <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>
                        <strong>"{vehicleText}"</strong> is not in the Vehicle Master.
                        Please add this make &amp; model to the Vehicle Master so correct pricing and services can be matched.
                      </span>
                    </div>
                  );
                })()}

                {/* ── Vehicle Master warning — body type missing (4W only) ── */}
                {lead.vehicle_in_master === false && (
                  <div className="lp-vm-master-warn">
                    <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>
                      <strong>{[lead.make_name, lead.model_name].filter(Boolean).join(' ')}</strong> is not fully configured in the Vehicle Master — body type is missing.
                      Please update the Vehicle Master so pricing and services can be matched correctly.
                    </span>
                  </div>
                )}

                {/* ── Vehicle Master warning — CC category missing (2W only) ── */}
                {lead.cc_missing === true && (
                  <div className="lp-vm-master-warn">
                    <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>
                      <strong>{[lead.make_name, lead.model_name].filter(Boolean).join(' ')}</strong> is not fully configured in the Vehicle Master — engine CC category is missing.
                      Please update the Vehicle Master so the correct service pricing can be applied.
                    </span>
                  </div>
                )}

                {/* ── Segment missing warning (4W only) ── */}
                {lead.make_id && !is2WType(lead.vehicle_type_name || '') && (!lead.segment_ids || lead.segment_ids.length === 0) && (
                  <div className="lp-vm-master-warn">
                    <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>
                      <strong>Segment not set</strong> for this vehicle. Please add the segment (e.g. Petrol, Diesel, CNG) so the correct service pricing can be applied.
                    </span>
                  </div>
                )}
              </div>

              {/* ── Meta info card ── */}
              <div className="lp-vm-card lp-vm-card--meta">
                <div className="lp-vm-card-hd"><Tag size={13} /> Lead Info</div>
                <div className="lp-vm-info-list">
                  <div className="lp-vm-info-row">
                    <span className="lp-vm-info-label">Created</span>
                    <span className="lp-vm-info-val">
                      {new Date(lead.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      {' · '}
                      {new Date(lead.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {lead.created_by_name && (
                    <div className="lp-vm-info-row">
                      <span className="lp-vm-info-label">By</span>
                      <span className="lp-vm-info-val">{lead.created_by_name}</span>
                    </div>
                  )}
                  <div className="lp-vm-info-row">
                    <span className="lp-vm-info-label">Assigned</span>
                    <span className="lp-vm-info-val">
                      {lead.assigned_to_name
                        ? <span className="lp-assigned-badge"><UserCheck size={11} /> {lead.assigned_to_name}</span>
                        : <span className="lp-muted">Unassigned</span>}
                    </span>
                  </div>
                  {lead.lead_source && (
                    <div className="lp-vm-info-row">
                      <span className="lp-vm-info-label">Source</span>
                      <span className="lp-vm-info-val">{lead.lead_source}</span>
                    </div>
                  )}
                  {lead.lost_reason && (
                    <div className="lp-vm-info-row">
                      <span className="lp-vm-info-label">Lost Reason</span>
                      <span className="lp-vm-info-val lp-lost-pill">{lead.lost_reason}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Follow-ups — beside Lead Info ── */}
              <div className="lp-vm-card">
                <div className="lp-vm-card-hd"><Calendar size={13} /> Follow-ups</div>
                {followUps.length === 0 ? (
                  <div className="lp-vm-empty-row">No follow-ups scheduled.</div>
                ) : (
                  <div className="lp-fu-detail-wrap">
                    <div className="lp-fu-detail-list">
                      {followUps.map(fu => {
                        const d = new Date(fu.due_date);
                        const today = new Date(); today.setHours(0, 0, 0, 0);
                        const diff = Math.round((d - today) / 86400000);
                        const isOverdue = !fu.is_done && !isLeadLocked && diff < 0;
                        const isToday = !fu.is_done && !isLeadLocked && diff === 0;
                        const dateLabel = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
                        const timeLabel = fu.due_at
                          ? new Date(fu.due_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                          : null;
                        return (
                          <div key={fu.id} className={`lp-fu-detail-row${fu.is_done ? ' lp-fu-detail-row--done' : isOverdue ? ' lp-fu-detail-row--overdue' : ''}`}>
                            <div className="lp-fu-detail-dot" style={{
                              background: fu.is_done ? '#16a34a' : isOverdue ? '#dc2626' : isToday ? '#d97706' : '#2563eb'
                            }} />
                            <div className="lp-fu-detail-body">
                              <div className="lp-fu-detail-date">
                                {dateLabel}{timeLabel && ` · ${timeLabel}`}
                                {fu.is_done && <span className="lp-fu-detail-done-tag">✓ Done</span>}
                                {isOverdue && <span className="lp-fu-detail-overdue-tag">⚠ Overdue</span>}
                                {isToday && <span className="lp-fu-detail-today-tag">Today</span>}
                              </div>
                              {fu.note && <div className="lp-fu-detail-note">{fu.note}</div>}
                              <div className="lp-fu-detail-meta">Status: <strong>{fu.status_name || '—'}</strong></div>
                              {!fu.is_done && !isLeadLocked && (
                                <button
                                  style={{ marginTop: 6, fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '1.5px solid #2563eb', background: 'transparent', color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}
                                  onClick={() => setRescheduleId(fu.id)}
                                >
                                  Reschedule
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Services (includes category-only interests) ── */}
              {(lead.services?.length > 0 || lead.categories?.length > 0) && (
                <div className="lp-vm-card lp-vm-card--full">
                  <div className="lp-vm-card-hd"><FileText size={13} /> Services</div>
                  <table className="lp-svc-table">
                    <thead>
                      <tr><th>Category</th><th>Service</th><th className="text-right">Price</th></tr>
                    </thead>
                    <tbody>
                      {/* Category-only rows — skip if a specific service from same category exists */}
                      {lead.categories?.filter(c =>
                        !lead.services?.some(s => s.category_name === c.category_name)
                      ).map(c => (
                        <tr key={`cat-${c.id}`}>
                          <td className="lp-muted">{c.category_name}</td>
                          <td style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</td>
                          <td className="text-right" style={{ color: 'var(--text-muted)' }}>—</td>
                        </tr>
                      ))}
                      {/* Specific service rows */}
                      {lead.services?.map(s => (
                        <tr key={s.id}>
                          <td className="lp-muted">{s.category_name}</td>
                          <td>{s.service_name}</td>
                          <td className="text-right">₹{Number(s.price).toLocaleString('en-IN')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {lead.services?.length > 0 && (
                    <div className="lp-vm-total-row">
                      <span>Total</span>
                      <span className="lp-vm-total-val">₹{Number(lead.total_price).toLocaleString('en-IN')}</span>
                    </div>
                  )}
                </div>
              )}

              {/* ── Notes — strip internal [Vehicle not in master:...] tag before display ── */}
              {lead.notes && lead.notes.replace(/\[Vehicle not in master:[^\]]+\]/g, '').trim() && (
                <div className="lp-vm-card lp-vm-card--full">
                  <div className="lp-vm-card-hd"><FileText size={13} /> Notes</div>
                  <p className="lp-notes-text">{lead.notes.replace(/\[Vehicle not in master:[^\]]+\]/g, '').trim()}</p>
                </div>
              )}

              {/* ── Notes & Activity Timeline ── */}
              {/* ── Status History Timeline ── */}
              <div className="lp-vm-card lp-vm-card--full">
                <div className="lp-vm-card-hd"><Clock size={13} /> Status History</div>
                {statusHistory.length === 0 ? (
                  <div className="lp-vm-empty-card">No status changes recorded yet.</div>
                ) : (
                  <div className="lp-sh-list">
                    {statusHistory.map((item, idx) => {
                      const isFirst = idx === statusHistory.length - 1;
                      const isLatest = idx === 0;
                      const timeStr = new Date(item.created_at).toLocaleString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      });
                      return (
                        <div key={item.id} className="lp-sh-item">
                          <div className="lp-sh-left">
                            <div className={`lp-sh-dot ${isLatest ? 'lp-sh-dot--latest' : ''}`} />
                            {!isFirst && <div className="lp-sh-line" />}
                          </div>
                          <div className="lp-sh-body">
                            <div className="lp-sh-top">
                              {item.type === 'created' ? (
                                <span className="lp-sh-badge lp-sh-badge--created">Lead Created</span>
                              ) : (
                                <div className="lp-sh-change">
                                  {item.old_value
                                    ? <span className="lp-sh-badge lp-sh-badge--old">{item.old_value}</span>
                                    : <span className="lp-sh-badge lp-sh-badge--new-lead">New Lead</span>
                                  }
                                  <span className="lp-sh-arrow">→</span>
                                  <span className="lp-sh-badge lp-sh-badge--new">{item.new_value}</span>
                                </div>
                              )}
                              {isLatest && <span className="lp-sh-current">current</span>}
                            </div>
                            <div className="lp-sh-meta">
                              <span className="lp-sh-who">{item.created_by_name || 'System'}</span>
                              <span className="lp-sh-dot-sep">·</span>
                              <span className="lp-sh-time">{timeStr}</span>
                              {stageDurations[item.id] != null && (
                                <>
                                  <span className="lp-sh-dot-sep">·</span>
                                  <span className="lp-sh-duration">
                                    {isLatest ? '⏱ ' : ''}
                                    {formatDuration(stageDurations[item.id])}
                                    {isLatest ? ' so far' : ' here'}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── Assignment History ── */}
              <div className="lp-vm-card">
                <div className="lp-vm-card-hd"><UserCheck size={13} /> Assignment History</div>
                {assignHistory.length === 0 ? (
                  <div className="lp-vm-empty-card">No assignment changes recorded yet.</div>
                ) : (
                  <div className="lp-sh-list">
                    {assignHistory.map((item, idx) => {
                      const isFirst = idx === assignHistory.length - 1;
                      const isLatest = idx === 0;
                      const timeStr = new Date(item.created_at).toLocaleString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      });
                      return (
                        <div key={item.id} className="lp-sh-item">
                          <div className="lp-sh-left">
                            <div className={`lp-sh-dot lp-sh-dot--assign ${isLatest ? 'lp-sh-dot--latest' : ''}`} />
                            {!isFirst && <div className="lp-sh-line" />}
                          </div>
                          <div className="lp-sh-body">
                            <div className="lp-sh-top">
                              <div className="lp-sh-change">
                                {item.old_value
                                  ? <span className="lp-sh-badge lp-sh-badge--old">{item.old_value}</span>
                                  : <span className="lp-sh-badge lp-sh-badge--new-lead">Unassigned</span>
                                }
                                <span className="lp-sh-arrow">→</span>
                                {item.new_value
                                  ? <span className="lp-sh-badge lp-sh-badge--new">{item.new_value}</span>
                                  : <span className="lp-sh-badge lp-sh-badge--old">Unassigned</span>
                                }
                              </div>
                              {isLatest && <span className="lp-sh-current">current</span>}
                            </div>
                            <div className="lp-sh-meta">
                              <span className="lp-sh-who">{item.created_by_name || 'System'}</span>
                              <span className="lp-sh-dot-sep">·</span>
                              <span className="lp-sh-time">{timeStr}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── Service History ── */}
              <div className="lp-vm-card">
                <div className="lp-vm-card-hd"><Wrench size={13} /> Service History</div>
                {serviceHistory.length === 0 ? (
                  <div className="lp-vm-empty-card">No service changes recorded yet.</div>
                ) : (
                  <div className="lp-sh-list">
                    {serviceHistory.map((item, idx) => {
                      const isFirst = idx === serviceHistory.length - 1;
                      const isAdded = item.type === 'service_added';
                      const timeStr = new Date(item.created_at).toLocaleString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      });
                      return (
                        <div key={item.id} className="lp-sh-item">
                          <div className="lp-sh-left">
                            <div className={`lp-sh-dot ${isAdded ? 'lp-sh-dot--svc-add' : 'lp-sh-dot--svc-rem'}`} />
                            {!isFirst && <div className="lp-sh-line" />}
                          </div>
                          <div className="lp-sh-body">
                            <div className="lp-sh-top">
                              <div className="lp-sh-change">
                                <span className={`lp-sh-badge ${isAdded ? 'lp-sh-badge--svc-add' : 'lp-sh-badge--svc-rem'}`}>
                                  {isAdded ? '+ Added' : '− Removed'}
                                </span>
                                <span className="lp-sh-badge lp-sh-badge--new">
                                  {isAdded ? item.new_value : item.old_value}
                                </span>
                              </div>
                            </div>
                            <div className="lp-sh-meta">
                              <span className="lp-sh-who">{item.created_by_name || 'System'}</span>
                              <span className="lp-sh-dot-sep">·</span>
                              <span className="lp-sh-time">{timeStr}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="lp-vm-card lp-vm-card--full lp-timeline-card">
                <div className="lp-vm-card-hd"><MessageSquare size={13} /> Notes</div>

                {/* Notes list — chat bubble style */}
                <div className="lp-chat-list">
                  {timeline.length === 0 ? (
                    <div className="lp-timeline-empty">No notes added yet.</div>
                  ) : (
                    timeline.map((item) => {
                      const isMine = Number(item.created_by) === Number(currentUser?.id);
                      const timeStr = new Date(item.created_at).toLocaleString('en-IN', {
                        day: '2-digit', month: 'short',
                        hour: '2-digit', minute: '2-digit',
                      });
                      return (
                        <div key={item.id} style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: isMine ? 'flex-end' : 'flex-start',
                          marginBottom: 12,
                          padding: '0 4px',
                        }}>
                          {!isMine && (
                            <span style={{
                              fontSize: 11, fontWeight: 600,
                              color: 'var(--primary, #00b09b)',
                              marginBottom: 3, marginLeft: 6,
                            }}>
                              {item.created_by_name || 'Unknown'}
                            </span>
                          )}
                          <div style={{
                            maxWidth: '75%',
                            background: isMine ? 'var(--primary, #00b09b)' : '#f1f0f0',
                            color: isMine ? '#fff' : 'var(--text-main, #1a1a1a)',
                            borderRadius: isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                            padding: '8px 12px',
                            fontSize: 13,
                            lineHeight: 1.5,
                            wordBreak: 'break-word',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                          }}>
                            {item.note}
                          </div>
                          <span style={{
                            fontSize: 10, color: 'var(--text-muted)',
                            marginTop: 4,
                            marginLeft: isMine ? 0 : 6,
                            marginRight: isMine ? 6 : 0,
                          }}>
                            {timeStr}
                          </span>
                        </div>
                      );
                    })
                  )}
                  <div ref={timelineEndRef} />
                </div>

                {/* Add note form — only for users who can edit leads */}
                {canEdit && (
                  <form className="lp-add-note-form" onSubmit={handleAddNote}>
                    {noteError && <div className="lp-note-error"><AlertCircle size={12} /> {noteError}</div>}
                    <div className="lp-add-note-row">
                      <textarea
                        className="lp-add-note-input"
                        rows={2}
                        placeholder="Add a note…"
                        value={noteText}
                        onChange={e => setNoteText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddNote(e); }
                        }}
                        disabled={noteSaving}
                      />
                      <button type="submit" className="lp-add-note-btn" disabled={noteSaving || !noteText.trim()}>
                        {noteSaving ? <Clock size={14} /> : <Send size={14} />}
                      </button>
                    </div>
                    <span className="lp-add-note-hint">Enter to send · Shift+Enter for new line</span>
                  </form>
                )}
              </div>

            </div>
          )}
        </div>
      </div>
      {rescheduleId && (
        <RescheduleFollowUpModal
          onConfirm={handleReschedule}
          onCancel={() => setRescheduleId(null)}
        />
      )}
    </div>
  );
}

// ── Edit Lead Modal ───────────────────────────────────────────────────────────
function EditLeadModal({ lead, onClose, onSaved, statusList = [], leadSources = LEAD_SOURCES, onOpenConvert }) {
  useBodyLock();
  useEscapeClose(onClose);
  // ── core form ──────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    status: lead.status || '',
    notes: lead.notes || '',
    name: lead.name || '',
    mobile: lead.mobile || '',
    whatsapp: lead.whatsapp || '',
    lead_source: lead.lead_source || '',
    lost_reason: lead.lost_reason || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [priceRecalcNotice, setPriceRecalcNotice] = useState(false); // shown after vehicle-change recalc
  const [lostModal, setLostModal] = useState(null); // { statusName } when intercepting Lost
  const [actionModal, setActionModal] = useState(null); // { statusName, logsCall, needsFollowUp }
  const [actionData, setActionData] = useState(null); // call outcome, follow_up_date, etc.
  const [existingCustomer, setExistingCustomer] = useState(null);

  async function handleMobileBlur() {
    const mobile = form.mobile?.trim();
    if (!mobile || mobile.length < 10 || mobile === lead.mobile) { setExistingCustomer(null); return; }
    try {
      const r = await api(`/api/customers/${encodeURIComponent(mobile)}`);
      setExistingCustomer(r.item || null);
    } catch { setExistingCustomer(null); }
  }

  // ── assignment ─────────────────────────────────────────────────────────────
  const [assignedTo, setAssignedTo] = useState(lead.assigned_to || '');
  const [agents, setAgents] = useState([]);

  // ── location state ─────────────────────────────────────────────────────────
  const [locForm, setLocForm] = useState({
    state_id: String(lead.state_id || ''),
    city_id: String(lead.city_id || ''),
    area_id: String(lead.area_id || ''),
  });
  const [states, setStates] = useState([]);
  const [cities, setCities] = useState([]);
  const [areas, setAreas] = useState([]);

  // ── vehicle class ──────────────────────────────────────────────────────────
  const [vehicleClass, setVehicleClass] = useState(
    () => is2WType(lead.vehicle_type_name || '') ? '2W' : '4W'
  );

  // ── vehicle form ───────────────────────────────────────────────────────────
  const [vForm, setVForm] = useState({
    vehicle_type_id: String(lead.vehicle_type_id || ''),
    make_id: String(lead.make_id || ''),
    model_id: String(lead.model_id || ''),
    body_type_id: String(lead.body_type_id || ''),
    segment_ids: lead.segment_ids || [],
  });
  const [engineCc, setEngineCc] = useState('');
  const [ccCategoryId, setCcCategoryId] = useState(null);
  const [ccPreview, setCcPreview] = useState('');
  const [noCcWarning, setNoCcWarning] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);

  const [vMasters, setVMasters] = useState({
    vehicleTypes: [], makes: [], models: [],
    bodyTypes: [], segments: [], ccCategories: [],
  });

  // ── service state ──────────────────────────────────────────────────────────
  const [selectedServices, setSelectedServices] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]); // category-only interests
  const [categories, setCategories] = useState([]);
  const [services, setServices] = useState([]);
  const [selectedCatId, setSelectedCatId] = useState('');
  const [serviceSearch, setServiceSearch] = useState('');
  const [svcLoading, setSvcLoading] = useState(false);

  // ── load states on mount; cities/areas for pre-filled values ─────────────
  useEffect(() => {
    api('/api/locations/states').then(r => setStates(r.items || [])).catch(() => { });
    api('/api/users/assignable').then(r => setAgents(r.items || [])).catch(() => { });
    if (lead.state_id)
      api(`/api/locations/cities?state_id=${lead.state_id}`).then(r => setCities(r.items || [])).catch(() => { });
    if (lead.city_id)
      api(`/api/locations/areas?city_id=${lead.city_id}`).then(r => setAreas(r.items || [])).catch(() => { });
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!locForm.state_id) { setCities([]); setAreas([]); return; }
    api(`/api/locations/cities?state_id=${locForm.state_id}`)
      .then(r => setCities(r.items || [])).catch(() => setCities([]));
  }, [locForm.state_id]); // eslint-disable-line

  useEffect(() => {
    if (!locForm.city_id) { setAreas([]); return; }
    api(`/api/locations/areas?city_id=${locForm.city_id}`)
      .then(r => setAreas(r.items || [])).catch(() => setAreas([]));
  }, [locForm.city_id]); // eslint-disable-line

  // ── load vehicle masters + existing services on mount ─────────────────────
  useEffect(() => {
    Promise.all([
      api('/api/vehicles/types'),
      api('/api/vehicles/body-types'),
      api('/api/vehicles/segments'),
      api('/api/cc-categories'),
    ]).then(([t, b, sg, cc]) => {
      setVMasters(m => ({
        ...m,
        vehicleTypes: t.items || [],
        bodyTypes: b.items || [],
        segments: sg.items || [],
        ccCategories: cc.items || [],
      }));
    }).catch(() => { });

    api(`/api/leads/${lead.id}`).then(r => {
      setSelectedServices((r.item.services || []).map(s => ({
        service_id: s.service_id ?? s.id,
        name: s.service_name,
        category: s.category_name,
        price: Number(s.price),
      })));
      setSelectedCategories((r.item.categories || []).map(c => ({
        category_id: c.category_id,
        name: c.category_name,
      })));
    }).catch(() => { });
  }, []); // eslint-disable-line

  // ── load makes when vehicleClass / bodyType changes ──────────────────────
  useEffect(() => {
    const params = new URLSearchParams();
    if (vForm.vehicle_type_id) params.set('type_id', vForm.vehicle_type_id);
    else params.set('type_class', vehicleClass);
    if (vehicleClass === '4W' && vForm.body_type_id) {
      params.set('body_type_id', vForm.body_type_id);
    }
    api(`/api/vehicles/makes?${params.toString()}`)
      .then(r => {
        const items = r.items || [];
        setVMasters(m => ({ ...m, makes: items }));
        setVForm(f => {
          if (!f.make_id) return f;
          return items.some(mk => String(mk.id) === String(f.make_id))
            ? f : { ...f, make_id: '', model_id: '' };
        });
      })
      .catch(() => setVMasters(m => ({ ...m, makes: [] })));
  }, [vForm.vehicle_type_id, vehicleClass, vForm.body_type_id]); // eslint-disable-line

  // ── load models when make changes ─────────────────────────────────────────
  useEffect(() => {
    // For 2W: load all models (no make filter) so user can search model first
    // For 4W: require make selection first
    if (!vForm.make_id && vehicleClass !== '2W') { setVMasters(m => ({ ...m, models: [] })); return; }
    setModelsLoading(true);
    setVMasters(m => ({ ...m, models: [] }));
    const params = new URLSearchParams();
    if (vForm.make_id) params.set('make_id', vForm.make_id);
    if (vehicleClass === '4W' && vForm.body_type_id) {
      params.set('body_type_id', vForm.body_type_id);
    }
    // When no make selected on 2W, still restrict to 2W models only
    if (!vForm.make_id && vehicleClass === '2W') params.set('type_class', '2W');
    api(`/api/vehicles/models?${params.toString()}`)
      .then(r => setVMasters(m => ({ ...m, models: r.items || [] })))
      .catch(() => setVMasters(m => ({ ...m, models: [] })))
      .finally(() => setModelsLoading(false));
  }, [vForm.make_id, vehicleClass]); // eslint-disable-line

  // ── Auto-fill body_type + segment from selected model (4W) ──────────────
  useEffect(() => {
    if (!vForm.model_id || vehicleClass !== '4W') return;
    if (!vMasters.models.length) return; // wait for models to load
    const model = vMasters.models.find(m => String(m.id) === String(vForm.model_id));
    if (!model) return;
    setVForm(f => ({
      ...f,
      body_type_id: model.body_type_id ? String(model.body_type_id) : f.body_type_id,
      segment_ids: model.segment_id ? [model.segment_id] : f.segment_ids,
    }));
  }, [vForm.model_id, vMasters.models]); // eslint-disable-line

  // ── CC from model (2W) ────────────────────────────────────────────────────
  useEffect(() => {
    if (!vForm.model_id || vehicleClass !== '2W') { setNoCcWarning(false); return; }
    if (!vMasters.models.length) return; // wait for models to load
    const model = vMasters.models.find(m => String(m.id) === String(vForm.model_id));
    if (!model) return;
    const cc = model.engine_cc ? parseInt(model.engine_cc, 10) : null;
    if (cc && cc > 0) {
      setEngineCc(String(cc)); setCcCategoryId(null); setCcPreview(''); setNoCcWarning(false);
      api('/api/cc-categories/classify', { method: 'POST', body: { cc } })
        .then(r => { if (r.item) { setCcCategoryId(r.item.id); setCcPreview(`${r.item.name} · ${r.item.min_cc}–${r.item.max_cc} cc`); } })
        .catch(() => { });
    } else {
      setEngineCc(''); setCcCategoryId(null); setCcPreview(''); setNoCcWarning(true);
    }
  }, [vForm.model_id, vMasters.models]); // eslint-disable-line

  // ── load categories when vehicleClass changes ─────────────────────────────
  useEffect(() => {
    setSelectedCatId(''); setServiceSearch('');
    api(`/api/services/categories?vehicle_class=${vehicleClass}`)
      .then(r => setCategories(r.items || []))
      .catch(() => setCategories([]));
  }, [vehicleClass]);

  // ── load services when category changes ───────────────────────────────────
  useEffect(() => {
    setServiceSearch('');
    if (!selectedCatId) { setServices([]); return; }
    setSvcLoading(true);
    api(`/api/services/services?category_id=${selectedCatId}&vehicle_class=${vehicleClass}`)
      .then(r => setServices(r.items || []))
      .catch(() => setServices([]))
      .finally(() => setSvcLoading(false));
  }, [selectedCatId, vehicleClass]);

  // ── switch vehicle class ──────────────────────────────────────────────────
  function switchVehicleClass(cls) {
    setVehicleClass(cls);
    const filtered = vMasters.vehicleTypes.filter(t => cls === '2W' ? is2WType(t.name) : !is2WType(t.name));
    const autoType = filtered.length === 1 ? String(filtered[0].id) : '';
    setVForm(f => ({ ...f, vehicle_type_id: autoType, make_id: '', model_id: '', body_type_id: '', segment_ids: [] }));
    setEngineCc(''); setCcCategoryId(null); setCcPreview(''); setNoCcWarning(false);
    setVMasters(m => ({ ...m, makes: [], models: [] }));
  }

  async function handleEngineCcBlur() {
    const cc = parseInt(engineCc, 10);
    if (!cc || cc <= 0) { setCcCategoryId(null); setCcPreview(''); return; }
    try {
      const r = await api('/api/cc-categories/classify', { method: 'POST', body: { cc } });
      if (r.item) { setCcCategoryId(r.item.id); setCcPreview(`${r.item.name} · ${r.item.min_cc}–${r.item.max_cc} cc`); }
      else { setCcCategoryId(null); setCcPreview('No category matched'); }
    } catch { setCcCategoryId(null); setCcPreview(''); }
  }

  // ── add service (price lookup uses current vehicle) ───────────────────────
  async function addService(svc) {
    if (selectedServices.find(s => s.service_id === svc.id)) return;
    setSvcLoading(true);
    try {
      const r = await api('/api/leads/price-lookup', {
        method: 'POST',
        body: {
          service_id: svc.id,
          vehicle_type_id: vForm.vehicle_type_id ? Number(vForm.vehicle_type_id) : null,
          make_id: vForm.make_id ? Number(vForm.make_id) : null,
          model_id: vForm.model_id ? Number(vForm.model_id) : null,
          segment_id: vForm.segment_ids?.length ? Number(vForm.segment_ids[0]) : null,
          body_type_id: vehicleClass === '4W' && vForm.body_type_id ? Number(vForm.body_type_id) : null,
          cc_category_id: vehicleClass === '2W' && ccCategoryId ? ccCategoryId : null,
        },
      });
      const cat = categories.find(c => String(c.id) === String(selectedCatId));
      setSelectedServices(prev => [...prev, {
        service_id: svc.id, name: svc.name,
        category: cat?.name || '', price: r.price || 0,
      }]);
    } catch (e) { setError(e.message); }
    finally { setSvcLoading(false); }
  }

  function removeService(sid) {
    setSelectedServices(prev => prev.filter(s => s.service_id !== sid));
  }

  // ── submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.mobile.trim()) return setError('Mobile number is required');
    setError(''); setSaving(true);
    setPriceRecalcNotice(false);

    try {
      // ── Detect vehicle field changes ──────────────────────────────────────
      const vehicleChanged =
        String(vForm.vehicle_type_id || '') !== String(lead.vehicle_type_id || '') ||
        String(vForm.make_id || '') !== String(lead.make_id || '') ||
        String(vForm.model_id || '') !== String(lead.model_id || '') ||
        String(vForm.body_type_id || '') !== String(lead.body_type_id || '') ||
        (ccCategoryId || null) !== (lead.cc_category_id || null) ||
        JSON.stringify(vForm.segment_ids || []) !== JSON.stringify(lead.segment_ids || []);

      // ── Re-lookup prices if vehicle changed and there are services ─────────
      let finalServices = selectedServices.map(s => ({ service_id: s.service_id, price: s.price }));

      if (vehicleChanged && selectedServices.length > 0) {
        const dims = {
          vehicle_type_id: Number(vForm.vehicle_type_id) || null,
          make_id: Number(vForm.make_id) || null,
          model_id: Number(vForm.model_id) || null,
          body_type_id: vehicleClass === '4W' ? (Number(vForm.body_type_id) || null) : null,
          cc_category_id: vehicleClass === '2W' ? (ccCategoryId || null) : null,
          segment_id: vForm.segment_ids?.length ? Number(vForm.segment_ids[0]) : null,
        };

        const recalculated = await Promise.all(
          selectedServices.map(async s => {
            try {
              const r = await api('/api/leads/price-lookup', {
                method: 'POST',
                body: { service_id: s.service_id, ...dims },
              });
              // Keep old price if no rule found for new vehicle
              return { service_id: s.service_id, price: r.price != null ? r.price : s.price };
            } catch {
              return { service_id: s.service_id, price: s.price };
            }
          })
        );

        finalServices = recalculated;
        setPriceRecalcNotice(true);
      }

      // ── Call Log (if selected via modal) ──────────────────────────────────
      if (actionData?.call_outcome) {
        try {
          await api(`/api/leads/${lead.id}/calls`, {
            method: 'POST',
            body: { outcome: actionData.call_outcome, notes: actionData.call_notes || null },
          });
        } catch (callErr) {
          console.error('[EditLeadModal] call log failed:', callErr?.message);
        }
      }

      // ── Save ──────────────────────────────────────────────────────────────
      const r = await api(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        body: {
          status: form.status.trim() || undefined,
          notes: form.notes.trim() || null,
          name: form.name.trim() || null,
          mobile: form.mobile.trim(),
          whatsapp: form.whatsapp.trim() || null,
          lead_source: form.lead_source.trim() || null,
          lost_reason: form.status.toLowerCase().includes('lost') ? (form.lost_reason || null) : null,
          follow_up_date: actionData?.follow_up_date || undefined,
          follow_up_time: actionData?.follow_up_time || undefined,
          follow_up_note: actionData?.note || undefined,
          state_id: Number(locForm.state_id) || null,
          city_id: Number(locForm.city_id) || null,
          area_id: Number(locForm.area_id) || null,
          vehicle_type_id: Number(vForm.vehicle_type_id) || null,
          make_id: Number(vForm.make_id) || null,
          model_id: Number(vForm.model_id) || null,
          body_type_id: vehicleClass === '4W' ? (Number(vForm.body_type_id) || null) : null,
          cc_category_id: vehicleClass === '2W' ? (ccCategoryId || null) : null,
          segment_ids: vForm.segment_ids || [],
          assigned_to: Number(assignedTo) || null,
          services: finalServices,
          category_ids: selectedCategories.map(c => c.category_id),
        },
      });
      onSaved(r.item);
    } catch (e) { setError(e.message); setSaving(false); }
  }

  const filteredSvcs = serviceSearch
    ? services.filter(s => s.name.toLowerCase().includes(serviceSearch.toLowerCase()))
    : services;
  const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);
  const fw4wBodyTypes = vMasters.bodyTypes.filter(b => !is2WType(b.name));

  // Enrich models with segment badge (first letter of segment name)
  const modelsWithBadge = vMasters.models.map(m => {
    if (!m.segment_id) return m;
    const seg = vMasters.segments.find(s => s.id === m.segment_id);
    return seg ? { ...m, badge: seg.name.charAt(0).toUpperCase() } : m;
  });

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="lp-modal-backdrop">
      <div className="lp-modal lp-modal--xl" onClick={e => e.stopPropagation()}>
        <div className="lp-modal-header">
          <h3>Edit Lead</h3>
          <button className="lp-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form className="lp-modal-body" onSubmit={handleSubmit}>
          {error && <div className="lp-error"><AlertCircle size={14} /> {error}</div>}
          {priceRecalcNotice && (
            <div className="lp-recalc-notice">
              <CheckCircle2 size={13} /> Vehicle details changed — service prices updated to match new pricing rules.
            </div>
          )}

          {/* ── Customer ── */}
          <div className="elm-card">
            <div className="elm-card-hd" style={{ color: '#2563eb' }}><User size={14} /> Customer Information</div>
            <div className="lp-form-row">
              <div className="lp-form-group">
                <label>Customer Name</label>
                <input className="lp-input" value={form.name} placeholder="Enter name"
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="lp-form-group">
                <label>Mobile <span className="lp-req">*</span></label>
                <input className="lp-input" value={form.mobile}
                  onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 10); setExistingCustomer(null); setForm(f => ({ ...f, mobile: v })); }}
                  onBlur={handleMobileBlur}
                  required />
                {existingCustomer && (
                  <div style={{ marginTop: 6, background: '#eff6ff', border: '1.5px solid #93c5fd', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1e40af', marginBottom: 3 }}>👤 Returning customer</div>
                      <div style={{ fontSize: 12, color: '#1d4ed8' }}>
                        <strong>{existingCustomer.customer_name || existingCustomer.mobile}</strong>
                        {existingCustomer.total_appointments > 0 && (
                          <span style={{ color: '#3b82f6', marginLeft: 6 }}>· {existingCustomer.total_appointments} past visit{existingCustomer.total_appointments !== 1 ? 's' : ''}</span>
                        )}
                        {existingCustomer.last_appointment && (
                          <span style={{ color: '#3b82f6', marginLeft: 6 }}>· Last seen {new Date(existingCustomer.last_appointment).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                        )}
                      </div>
                    </div>
                    <a
                      href={`/customers/${existingCustomer.mobile}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', whiteSpace: 'nowrap', textDecoration: 'underline' }}
                    >
                      View Customer →
                    </a>
                  </div>
                )}
              </div>
            </div>
            <div className="lp-form-row">
              <div className="lp-form-group">
                <label>WhatsApp</label>
                <input className="lp-input" value={form.whatsapp}
                  onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))}
                  placeholder="If different from mobile" />
              </div>
              <div className="lp-form-group">
                <label>Lead Source</label>
                <select className="lp-input" value={form.lead_source}
                  onChange={e => setForm(f => ({ ...f, lead_source: e.target.value }))}>
                  <option value="">— Select source —</option>
                  {leadSources.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            {/* Status + Assign row */}
            <div className="lp-form-row">
              <div className="lp-form-group">
                <label>Status</label>
                <div className="lp-sel-wrap">
                  <select className="lp-input lp-status-select" value={form.status}
                    onChange={e => {
                      const newSt = e.target.value;
                      const statusObj = statusList.find(s => s.name === newSt);

                      if (newSt.toLowerCase().includes('lost') && !form.status.toLowerCase().includes('lost')) {
                        setLostModal({ statusName: newSt });
                      } else if (statusObj?.converts_to_appointment && onOpenConvert) {
                        onClose();
                        onOpenConvert({
                          statusName: newSt, leadId: lead.id, leadName: lead.name,
                          saveFn: async (st, reason, meta) => {
                            // Let leads page handle the save directly since edit modal is closing
                            const body = { status: st };
                            if (meta.follow_up_date) body.follow_up_date = meta.follow_up_date;
                            if (meta.follow_up_time) body.follow_up_time = meta.follow_up_time;
                            if (meta.note) body.follow_up_note = meta.note;
                            const r = await api(`/api/leads/${lead.id}`, { method: 'PATCH', body });
                            onSaved(r.item);
                          }
                        });
                      } else if (statusObj?.logs_call || statusObj?.needs_follow_up) {
                        setActionModal({
                          statusName: newSt,
                          logsCall: !!statusObj.logs_call,
                          needsFollowUp: !!statusObj.needs_follow_up,
                        });
                      } else {
                        setForm(f => ({ ...f, status: newSt, lost_reason: newSt.toLowerCase().includes('lost') ? f.lost_reason : '' }));
                        setActionData(null); // clear any previous action data
                      }
                    }}>
                    <option value="">Select status…</option>
                    {statusList.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                  <ChevronDown size={14} className="lp-sel-chevron" />
                </div>
              </div>
              <div className="lp-form-group">
                <label>Assign To <span className="lp-opt">(optional)</span></label>
                <div className="lp-sel-wrap">
                  <select className="lp-input lp-status-select" value={assignedTo}
                    onChange={e => setAssignedTo(e.target.value)}>
                    <option value="">— Unassigned —</option>
                    {agents.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="lp-sel-chevron" />
                </div>
              </div>
            </div>
          </div>

          {/* ── Location ── */}
          <div className="elm-card">
            <div className="elm-card-hd" style={{ color: '#16a34a' }}><MapPin size={14} /> Location Details</div>
            <div className="elm-grid-3">
              <div className="lp-form-group">
                <label>State</label>
                <div className="lp-sel-wrap">
                  <select className="lp-input lp-status-select" value={locForm.state_id}
                    onChange={e => setLocForm(f => ({ ...f, state_id: e.target.value, city_id: '', area_id: '' }))}>
                    <option value="">Select State</option>
                    {states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <ChevronDown size={14} className="lp-sel-chevron" />
                </div>
              </div>
              <div className="lp-form-group">
                <label>City</label>
                <div className="lp-sel-wrap">
                  <select className="lp-input lp-status-select" value={locForm.city_id}
                    disabled={!locForm.state_id}
                    onChange={e => setLocForm(f => ({ ...f, city_id: e.target.value, area_id: '' }))}>
                    <option value="">Select City</option>
                    {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <ChevronDown size={14} className="lp-sel-chevron" />
                </div>
              </div>
              <div className="lp-form-group">
                <label>Area <span className="elm-hint">(optional)</span></label>
                <div className="lp-sel-wrap">
                  <select className="lp-input lp-status-select" value={locForm.area_id}
                    disabled={!locForm.city_id}
                    onChange={e => setLocForm(f => ({ ...f, area_id: e.target.value }))}>
                    <option value="">Select Area</option>
                    {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <ChevronDown size={14} className="lp-sel-chevron" />
                </div>
              </div>
            </div>
          </div>

          {/* ── Vehicle ── */}
          <div className="elm-card">
            <div className="elm-card-hd" style={{ color: '#d97706' }}>
              {vehicleClass === '2W' ? <Bike size={14} /> : <Car size={14} />}
              Vehicle Specification
              <div className="lp-vc-toggle" style={{ marginLeft: 'auto' }}>
                <button type="button"
                  className={`lp-vc-btn${vehicleClass === '4W' ? ' lp-vc-btn--on' : ''}`}
                  onClick={() => switchVehicleClass('4W')}><Car size={11} /> 4W</button>
                <button type="button"
                  className={`lp-vc-btn${vehicleClass === '2W' ? ' lp-vc-btn--on' : ''}`}
                  onClick={() => switchVehicleClass('2W')}><Bike size={11} /> 2W</button>
              </div>
            </div>

            {/* 4-Wheeler */}
            {vehicleClass === '4W' && (
              <div className="elm-veh-grid">
                <div className="lp-form-group">
                  <label>Make</label>
                  <SearchableSelect
                    value={vForm.make_id}
                    onChange={v => setVForm(f => ({ ...f, make_id: v, model_id: '', body_type_id: '', segment_ids: [] }))}
                    options={vMasters.makes} placeholder="Select Make" clearable />
                </div>
                <div className="lp-form-group">
                  <label>Model</label>
                  <SearchableSelect
                    value={vForm.model_id}
                    onChange={v => {
                      if (!v) { setVForm(f => ({ ...f, model_id: '' })); return; }
                      const model = vMasters.models.find(m => String(m.id) === String(v));
                      setVForm(f => ({
                        ...f,
                        model_id: v,
                        // Auto-fill make from model if not already set
                        make_id: f.make_id || (model?.make_id ? String(model.make_id) : f.make_id),
                      }));
                    }}
                    options={modelsWithBadge}
                    placeholder={vehicleClass === '2W' ? 'Search Model' : (vForm.make_id ? 'Select Model' : 'Select a make first')}
                    disabled={vehicleClass !== '2W' && !vForm.make_id}
                    loading={modelsLoading}
                    clearable />
                </div>
                <div className="lp-form-group">
                  <label>Body Type <span className="elm-hint">auto-filled from model</span></label>
                  <SearchableSelect
                    value={vForm.body_type_id}
                    onChange={v => setVForm(f => ({ ...f, body_type_id: v }))}
                    options={fw4wBodyTypes} placeholder="Select Body Type" />
                </div>
                <div className="lp-form-group elm-span-full">
                  <label>Segment / Fuel Type</label>
                  <div className="elm-chips">
                    {vMasters.segments.map(s => {
                      const on = vForm.segment_ids.includes(s.id);
                      return (
                        <button key={s.id} type="button"
                          className={`elm-chip${on ? ' elm-chip--on' : ''}`}
                          onClick={() => setVForm(f => ({ ...f, segment_ids: on ? [] : [s.id] }))}>
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* 2-Wheeler */}
            {vehicleClass === '2W' && (
              <div className="elm-veh-grid">
                <div className="lp-form-group">
                  <label>Make</label>
                  <SearchableSelect
                    value={vForm.make_id}
                    onChange={v => setVForm(f => ({ ...f, make_id: v, model_id: '' }))}
                    options={vMasters.makes} placeholder="Select Make"
                    disabled={!vMasters.makes.length} />
                </div>
                <div className="lp-form-group">
                  <label>Model</label>
                  <SearchableSelect
                    value={vForm.model_id}
                    onChange={v => setVForm(f => ({ ...f, model_id: v }))}
                    options={modelsWithBadge}
                    placeholder={vForm.make_id ? 'Select Model' : 'Select a make first'}
                    disabled={!vForm.make_id} loading={modelsLoading} />
                </div>
                <div className="lp-form-group elm-span-full">
                  <label>Engine CC <span className="elm-hint">(auto-filled from model)</span></label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="number" min="1" max="9999" placeholder="e.g. 350"
                      value={engineCc}
                      className={`lp-input${noCcWarning ? ' elm-input-warn' : ''}`}
                      style={{ maxWidth: 160 }}
                      onChange={e => { setEngineCc(e.target.value); setCcCategoryId(null); setCcPreview(''); setNoCcWarning(false); }}
                      onBlur={handleEngineCcBlur} />
                    <AnimatePresence>
                      {ccPreview && !noCcWarning && (
                        <motion.span className="elm-cc-badge"
                          initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }}>
                          {ccPreview}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  {noCcWarning && (
                    <div className="elm-cc-warn"><Info size={12} /> No CC stored — enter manually for correct pricing.</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Services ── */}
          <div className="elm-card">
            <div className="elm-card-hd" style={{ color: '#9333ea' }}><Wrench size={14} /> Services &amp; Pricing</div>
            <div className="lp-svc-layout">
              {/* Left: category + service picker */}
              <div className="lp-svc-picker">
                <div className="lp-cat-list">
                  {categories.length === 0
                    ? <div className="lp-svc-empty-msg">No categories</div>
                    : categories.map(c => (
                      <button key={c.id} type="button"
                        className={`lp-cat-btn${selectedCatId === String(c.id) ? ' lp-cat-btn--on' : ''}`}
                        onClick={() => setSelectedCatId(String(c.id))}>
                        {c.name}
                      </button>
                    ))
                  }
                </div>
                <div className="lp-svc-list-col">
                  <div className="lp-svc-search-row">
                    <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <input className="lp-svc-search-input" placeholder="Search services…"
                      value={serviceSearch} disabled={!selectedCatId}
                      onChange={e => setServiceSearch(e.target.value)} />
                    {serviceSearch && <button type="button" className="lp-clear-btn" onClick={() => setServiceSearch('')}><X size={11} /></button>}
                  </div>
                  <div className="lp-svc-items">
                    {!selectedCatId && <div className="lp-svc-empty-msg">← Pick a category</div>}
                    {selectedCatId && svcLoading && <div className="lp-svc-empty-msg">Loading…</div>}
                    {selectedCatId && !svcLoading && filteredSvcs.length === 0 && <div className="lp-svc-empty-msg">No services</div>}
                    {filteredSvcs.map(s => {
                      const added = !!selectedServices.find(ss => ss.service_id === s.id);
                      return (
                        <button key={s.id} type="button"
                          className={`lp-svc-item${added ? ' lp-svc-item--added' : ''}`}
                          onClick={() => addService(s)}>
                          <span>{s.name}</span>
                          {added ? <CheckCircle2 size={13} /> : <Plus size={13} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Right: selected services + total */}
              <div className="lp-svc-summary">
                <div className="lp-svc-summary-hd">Selected Services</div>
                <div className="lp-svc-summary-scroll">
                  {selectedServices.length === 0
                    ? <div className="lp-svc-empty-msg" style={{ padding: '16px 0' }}>No services added</div>
                    : selectedServices.map(s => (
                      <div key={s.service_id} className="lp-svc-row-item">
                        <div className="lp-svc-row-info">
                          {s.category && <span className="lp-svc-cat">{s.category}</span>}
                          <span className="lp-svc-name">{s.name}</span>
                        </div>
                        <span className="lp-svc-price">₹{s.price.toLocaleString('en-IN')}</span>
                        <button type="button" className="lp-svc-del" onClick={() => removeService(s.service_id)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))
                  }
                </div>
                {selectedServices.length > 0 && (
                  <div className="lp-svc-total-row">
                    <span>Total</span>
                    <strong>₹{totalPrice.toLocaleString('en-IN')}</strong>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Notes ── */}
          <div className="lp-form-group">
            <label>Notes</label>
            <textarea className="lp-input lp-textarea" rows={3} value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Internal notes about this lead…" />
          </div>

          <div className="lp-modal-footer">
            <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="button primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
      {lostModal && (
        <LostReasonModal
          statusName={lostModal.statusName}
          onConfirm={reason => {
            setForm(f => ({ ...f, status: lostModal.statusName, lost_reason: reason }));
            setLostModal(null);
          }}
          onCancel={() => setLostModal(null)}
        />
      )}
      {actionModal && (
        <StatusActionModal
          statusName={actionModal.statusName}
          leadName={lead.name || lead.mobile}
          logsCall={actionModal.logsCall}
          needsFollowUp={actionModal.needsFollowUp}
          onConfirm={data => {
            setForm(f => ({ ...f, status: actionModal.statusName, lost_reason: '' }));
            setActionData(data);
            setActionModal(null);
          }}
          onCancel={() => setActionModal(null)}
        />
      )}
    </div>
  );
}

// ── Delete Confirmation ───────────────────────────────────────────────────────
function DeleteModal({ lead, onClose, onConfirm }) {
  useBodyLock();
  useEscapeClose(onClose);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function handleConfirm() {
    setLoading(true); setError('');
    try { await onConfirm(); }
    catch (e) { setError(e.message); setLoading(false); }
  }
  return (
    <div className="lp-modal-backdrop">
      <div className="lp-modal lp-modal--sm" onClick={e => e.stopPropagation()}>
        <div className="lp-modal-header">
          <h3>Delete Lead</h3>
          <button className="lp-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="lp-modal-body">
          {error && <div className="lp-error"><AlertCircle size={14} /> {error}</div>}
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text)', lineHeight: 1.6 }}>
            Permanently delete the lead for <strong>{lead.name || lead.mobile}</strong>?
            This cannot be undone.
          </p>
        </div>
        <div className="lp-modal-footer">
          <button className="button secondary" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="button danger" onClick={handleConfirm} disabled={loading}>
            {loading ? 'Deleting…' : 'Delete Lead'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Merged Status Action Modal (Call Log + Follow-up) ────────────────────────
// logsCall=true     → shows call outcome + notes section
// needsFollowUp=true → shows follow-up date/time/note section
// Both can be true → both sections shown in one modal
function StatusActionModal({ statusName, leadName, logsCall, needsFollowUp, onConfirm, onCancel }) {
  useBodyLock();
  useEscapeClose(onCancel);
  const [outcome, setOutcome] = useState('');
  const [callNotes, setCallNotes] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [outcomes, setOutcomes] = useState([]);

  // Outcome colors cycle — purely visual
  const OUTCOME_COLORS = [
    { color: '#16a34a', bg: '#dcfce7' },
    { color: '#d97706', bg: '#fef3c7' },
    { color: '#ea580c', bg: '#ffedd5' },
    { color: '#2563eb', bg: '#dbeafe' },
    { color: '#7c3aed', bg: '#ede9fe' },
    { color: '#0891b2', bg: '#cffafe' },
  ];

  useEffect(() => {
    if (!logsCall) return;
    api('/api/call-outcomes')
      .then(r => {
        const list = r.items || [];
        setOutcomes(list);
        if (list.length > 0) setOutcome(list[0].name);
      })
      .catch(() => { });
  }, [logsCall]);

  function handleConfirm() {
    if (needsFollowUp && !date) { setError('Please select a follow-up date.'); return; }
    onConfirm({
      ...(logsCall ? { call_outcome: outcome, call_notes: callNotes || null } : {}),
      ...(needsFollowUp ? { follow_up_date: date, follow_up_time: time, note } : {}),
    });
  }

  const fieldStyle = { width: '100%', padding: '8px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box', outline: 'none' };
  const labelStyle = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 };

  const title = logsCall && needsFollowUp ? 'Log Call & Schedule Follow-up'
    : logsCall ? 'Log Call'
      : 'Schedule Follow-up';

  return (
    <div className="lr-backdrop">
      <div className="lr-modal" onClick={e => e.stopPropagation()}>
        <div className="lr-header">
          <span className="lr-title">{title}</span>
          <button className="lr-close" onClick={onCancel}><X size={16} /></button>
        </div>
        <div className="lr-body">
          <p className="lr-sub">
            Status → <strong>{statusName}</strong> for <strong>{leadName || 'this lead'}</strong>
          </p>

          {/* ── Call Log Section ── */}
          {logsCall && (
            <div style={{ marginBottom: needsFollowUp ? 18 : 0 }}>
              {needsFollowUp && (
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                  📞 Call Log
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Call Outcome</label>
                  {outcomes.length === 0 ? (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</span>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {outcomes.map((o, idx) => {
                        const c = OUTCOME_COLORS[idx % OUTCOME_COLORS.length];
                        return (
                          <button key={o.id} type="button"
                            onClick={() => setOutcome(o.name)}
                            style={{
                              padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                              border: `2px solid ${outcome === o.name ? c.color : 'var(--border)'}`,
                              background: outcome === o.name ? c.bg : 'var(--bg)',
                              color: outcome === o.name ? c.color : 'var(--text-muted)',
                              transition: 'all 0.15s',
                            }}>
                            {o.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div>
                  <label style={labelStyle}>Notes (optional)</label>
                  <textarea value={callNotes} onChange={e => setCallNotes(e.target.value)}
                    placeholder="What happened on this call?"
                    rows={2}
                    style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Follow-up Section ── */}
          {needsFollowUp && (
            <div>
              {logsCall && (
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                  📅 Follow-up
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Follow-up Date <span style={{ color: '#dc2626' }}>*</span></label>
                  <input type="date" value={date} min={new Date().toISOString().split('T')[0]}
                    onChange={e => { setDate(e.target.value); setError(''); }}
                    style={fieldStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Follow-up Time</label>
                  <input type="time" value={time} onChange={e => setTime(e.target.value)} style={fieldStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Note (optional)</label>
                  <textarea value={note} onChange={e => setNote(e.target.value)}
                    placeholder="What should the agent follow up about?"
                    rows={2}
                    style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>
              </div>
            </div>
          )}

          {error && <p className="lr-error"><AlertCircle size={12} /> {error}</p>}
        </div>
        <div className="lr-footer">
          <button className="lr-btn-cancel" onClick={onCancel}>Cancel</button>
          <button className="lr-btn-confirm" onClick={handleConfirm}>
            {logsCall && needsFollowUp ? 'Save & Update Status'
              : logsCall ? 'Log Call & Update Status'
                : 'Save Follow-up'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reschedule Follow-up Modal ────────────────────────────────────────────────
function RescheduleFollowUpModal({ onConfirm, onCancel }) {
  useBodyLock();
  useEscapeClose(onCancel);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('10:00');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const fieldStyle = { width: '100%', padding: '8px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box', outline: 'none' };
  const labelStyle = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 };

  async function handleConfirm() {
    if (!date) { setError('Please select a new date.'); return; }
    setSaving(true);
    try { await onConfirm({ date, time, note }); }
    catch (e) { setError(e.message || 'Failed to reschedule.'); setSaving(false); }
  }

  return (
    <div className="lr-backdrop">
      <div className="lr-modal" onClick={e => e.stopPropagation()}>
        <div className="lr-header">
          <span className="lr-title">Reschedule Follow-up</span>
          <button className="lr-close" onClick={onCancel}><X size={16} /></button>
        </div>
        <div className="lr-body">
          <p className="lr-sub">The current follow-up will be marked as done and a new one will be created.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={labelStyle}>New Date <span style={{ color: '#dc2626' }}>*</span></label>
              <input type="date" value={date} min={new Date().toISOString().split('T')[0]}
                onChange={e => { setDate(e.target.value); setError(''); }}
                style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Time</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Note (optional)</label>
              <textarea value={note} onChange={e => setNote(e.target.value)}
                placeholder="What should be followed up about?"
                rows={2} style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'inherit' }} />
            </div>
          </div>
          {error && <p className="lr-error"><AlertCircle size={12} /> {error}</p>}
        </div>
        <div className="lr-footer">
          <button className="lr-btn-cancel" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="lr-btn-confirm" onClick={handleConfirm} disabled={saving}>
            {saving ? 'Saving…' : 'Reschedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Appointment Searchable Select ─────────────────────────────────────────────
function ApptSelect({ value, onChange, options, placeholder = 'Select…', disabled = false, loading = false, searchPlaceholder = 'Search…', error = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);
  const dropRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      const inTrigger = triggerRef.current && triggerRef.current.contains(e.target);
      const inDrop = dropRef.current && dropRef.current.contains(e.target);
      if (!inTrigger && !inDrop) { setOpen(false); setFocusedIndex(-1); }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Focus search input when opened; calculate fixed position from trigger rect
  useEffect(() => {
    if (open) {
      setQuery('');
      setFocusedIndex(-1);
      if (triggerRef.current) {
        const r = triggerRef.current.getBoundingClientRect();
        setDropPos({ top: r.bottom + 5, left: r.left, width: r.width });
      }
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Reset focused index when query changes
  useEffect(() => { setFocusedIndex(-1); }, [query]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex < 0 || !listRef.current) return;
    const item = listRef.current.children[focusedIndex];
    item?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex]);

  const filtered = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  const selected = options.find(o => String(o.value) === String(value));

  function pick(opt) { onChange(opt.value); setOpen(false); setFocusedIndex(-1); }

  function handleTriggerKeyDown(e) {
    if (disabled || loading) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
    }
  }

  function handleInputKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setFocusedIndex(-1); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex(i => (i <= 0 ? -1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (focusedIndex >= 0 && filtered[focusedIndex]) pick(filtered[focusedIndex]);
    }
  }

  return (
    <div ref={triggerRef}>
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => !disabled && !loading && setOpen(o => !o)}
        onKeyDown={handleTriggerKeyDown}
        className={`ss-trigger${open ? ' ss-trigger--open' : ''}${error ? ' ss-trigger--err' : ''}${disabled || loading ? ' ss-trigger--disabled' : ''}`}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={selected ? 'ss-value' : 'ss-placeholder'}>
          {loading ? 'Loading…' : (selected?.label || placeholder)}
        </span>
        <ChevronDown size={14} style={{ flexShrink: 0, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none', color: '#94a3b8' }} />
      </button>

      {open && createPortal(
        <div
          ref={dropRef}
          className="ss-dropdown"
          style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 99999 }}
        >
          <div className="ss-search-wrap">
            <Search size={13} className="ss-search-icon" />
            <input
              ref={inputRef}
              className="ss-search-inp"
              placeholder={searchPlaceholder}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              aria-autocomplete="list"
            />
            {query && <button className="ss-search-clear" onClick={() => setQuery('')}><X size={11} /></button>}
          </div>
          <div className="ss-list" ref={listRef} role="listbox">
            {filtered.length === 0
              ? <div className="ss-empty">No results found</div>
              : filtered.map((opt, idx) => (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={String(opt.value) === String(value)}
                  className={`ss-item${String(opt.value) === String(value) ? ' ss-item--active' : ''}${idx === focusedIndex ? ' ss-item--focused' : ''}`}
                  onClick={() => pick(opt)}
                  onMouseEnter={() => setFocusedIndex(idx)}
                >
                  <span>{opt.label}</span>
                  {String(opt.value) === String(value) && <CheckCircle2 size={13} style={{ color: '#6d28d9', flexShrink: 0 }} />}
                </button>
              ))
            }
          </div>
        </div>
        , document.body)}
    </div>
  );
}

// ── Convert to Appointment — full modal ───────────────────────────────────────
function ConvertToAppointmentModal({ statusName, leadId, leadName, onConfirm, onCancel }) {
  useBodyLock();
  useEscapeClose(onCancel);

  // ── Lead data ──
  const [lead, setLead] = useState(null);
  const [loadingLead, setLoadingLead] = useState(true);

  // ── Hubs ──
  const [hubs, setHubs] = useState([]);

  // ── Vehicle masters ──
  const [vehicleTypes, setVehicleTypes] = useState([]);
  const [makes, setMakes] = useState([]);
  const [models, setModels] = useState([]);
  const [ccCategories, setCcCategories] = useState([]);
  const [segments, setSegments] = useState([]);
  const [makesLoading, setMakesLoading] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [ccPreview, setCcPreview] = useState('');
  const [engineCcDisp, setEngineCcDisp] = useState(null); // raw engine CC from model (e.g. 125)
  const [noCcData, setNoCcData] = useState(false); // true when model has no engine_cc (e.g. EV)

  // ── Search for make/model dropdowns ──
  const [makeSearch, setMakeSearch] = useState('');
  const [modelSearch, setModelSearch] = useState('');

  // ── Selected model name (separate from model_id, to handle deduplication) ──
  const [modelName, setModelName] = useState('');

  // ── Services (two-panel picker) ──
  const [allCategories, setAllCategories] = useState([]);
  const [selectedCatId, setSelectedCatId] = useState(null);
  const [svcSearch, setSvcSearch] = useState('');
  const [svcLoading, setSvcLoading] = useState(false);
  const [selectedSvcs, setSelectedSvcs] = useState([]);

  // ── Customer form ──
  const [cust, setCust] = useState({ name: '', mobile: '', whatsapp: '' });

  // ── Vehicle form ──
  const [veh, setVeh] = useState({
    vehicle_type_id: '',
    make_id: '',
    model_id: '',
    cc_category_id: '',
    segment_ids: [],
    body_type_id: '',
  });

  // ── Appointment form ──
  const [form, setForm] = useState({
    vehicle_number: '',
    hub_id: '',
    scheduled_date: '',
    scheduled_time: '10:00',
    notes: '',
    pickup_required: false,
    pickup_address_line1: '',
    pickup_address_line2: '',
    pickup_city: '',
    pickup_pincode: '',
    pickup_maps_link: '',
    drop_required: false,
    drop_address_line1: '',
    drop_address_line2: '',
    drop_city: '',
    drop_pincode: '',
    drop_maps_link: '',
  });

  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [apiErr, setApiErr] = useState('');

  // ── Derived: is 2W? ──
  function is2WType(name) {
    return /two.?wheel|2.?w|bike|scooter|motorcycle/i.test(name || '');
  }
  const selectedType = vehicleTypes.find(t => String(t.id) === String(veh.vehicle_type_id));
  const is2W = selectedType ? is2WType(selectedType.name)
    : is2WType(lead?.vehicle_type_name || '');
  const vehicleTypeLabel = is2W ? '2W' : '4W';

  // ── Load lead + hubs + masters on mount ──
  useEffect(() => {
    async function init() {
      try {
        const [lRes, hRes, typesRes, ccRes, segRes] = await Promise.all([
          api(`/api/leads/${leadId}`),
          api('/api/hubs?is_active=true&limit=200'),
          api('/api/vehicles/types'),
          api('/api/cc-categories'),
          api('/api/vehicles/segments'),
        ]);
        const l = lRes.item;
        setLead(l);
        setHubs(hRes.items || []);
        setVehicleTypes(typesRes.items || []);
        setCcCategories(ccRes.items || []);
        setSegments(segRes.items || []);

        // Pre-fill customer
        setCust({
          name: l.name || '',
          mobile: l.mobile || '',
          whatsapp: l.whatsapp || l.mobile || '',
        });
        // Pre-fill vehicle
        setVeh({
          vehicle_type_id: l.vehicle_type_id ? String(l.vehicle_type_id) : '',
          make_id: l.make_id ? String(l.make_id) : '',
          model_id: l.model_id ? String(l.model_id) : '',
          cc_category_id: l.cc_category_id ? String(l.cc_category_id) : '',
          segment_ids: l.segment_ids || [],
          body_type_id: l.body_type_id ? String(l.body_type_id) : '',
        });
        if (l.cc_category_name) setCcPreview(l.cc_category_name);
      } catch (e) { setApiErr(e.message); }
      finally { setLoadingLead(false); }
    }
    if (leadId) init();
    else setLoadingLead(false);
  }, [leadId]);

  // ── Sync modelName when models load after lead pre-fill ──
  useEffect(() => {
    if (models.length > 0 && veh.model_id && !modelName) {
      const m = models.find(m => String(m.id) === String(veh.model_id));
      if (m) setModelName(m.name);
    }
  }, [models]); // eslint-disable-line

  // ── Load makes when vehicle_type_id changes ──
  useEffect(() => {
    if (!veh.vehicle_type_id) { setMakes([]); setModels([]); return; }
    setMakesLoading(true);
    setMakes([]); setModels([]);
    api(`/api/vehicles/makes?type_id=${veh.vehicle_type_id}`)
      .then(r => setMakes(r.items || []))
      .catch(() => setMakes([]))
      .finally(() => setMakesLoading(false));
  }, [veh.vehicle_type_id]);

  // ── Load models when make_id changes ──
  useEffect(() => {
    if (!veh.make_id) { setModels([]); return; }
    setModelsLoading(true); setModels([]);
    api(`/api/vehicles/models?make_id=${veh.make_id}`)
      .then(r => setModels(r.items || []))
      .catch(() => setModels([]))
      .finally(() => setModelsLoading(false));
  }, [veh.make_id]);

  // ── Auto-fill CC (2W) from model ──
  useEffect(() => {
    if (!veh.model_id || !is2W) { setNoCcData(false); return; }
    const model = models.find(m => String(m.id) === String(veh.model_id));
    if (!model) return;
    const cc = model.engine_cc ? parseInt(model.engine_cc, 10) : null;
    if (cc && cc > 0) {
      setEngineCcDisp(cc); setNoCcData(false);
      api('/api/cc-categories/classify', { method: 'POST', body: { cc } })
        .then(r => {
          if (r.item) {
            setVeh(v => ({ ...v, cc_category_id: String(r.item.id) }));
            setCcPreview(`${r.item.name} (${r.item.min_cc}–${r.item.max_cc} cc)`);
          }
        }).catch(() => { });
    } else {
      // No engine CC (e.g. electric vehicle) — let user pick manually
      setEngineCcDisp(null); setNoCcData(true);
      setVeh(v => ({ ...v, cc_category_id: '' }));
      setCcPreview('');
    }
  }, [veh.model_id, is2W, models]); // eslint-disable-line

  // (4W segment auto-fill is now handled inside handleModelNameChange)

  // ── Load hub services when hub or vehicle type changes ──
  useEffect(() => {
    if (!form.hub_id) { setAllCategories([]); setSelectedCatId(null); setSelectedSvcs([]); return; }
    api(`/api/hubs/${form.hub_id}/services`)
      .then(r => {
        const cats = (r.categories || [])
          // Bug 1 fix: only categories actually assigned to this hub
          .filter(c => c.category_mapped)
          // Bug 1 fix: within each category, only hub-assigned services
          // Bug 3 fix: also filter each service by its own vehicle_class
          .map(c => ({
            ...c,
            services: c.services.filter(s => {
              if (!s.service_mapped) return false;
              if (s.vehicle_class === 'both') return true;
              if (is2W && s.vehicle_class === '2W') return true;
              if (!is2W && s.vehicle_class === '4W') return true;
              return false;
            }),
          }))
          // Drop categories that have zero mapped+matching services after filtering
          .filter(c => c.services.length > 0)
          // Bug 2 fix: service_categories now use '2W'/'4W' consistently
          .filter(c => {
            if (c.vehicle_class === 'both') return true;
            if (is2W && c.vehicle_class === '2W') return true;
            if (!is2W && c.vehicle_class === '4W') return true;
            return false;
          });
        setAllCategories(cats);
        setSelectedCatId(cats[0]?.id || null);
        setSvcSearch('');
      })
      .catch(() => setAllCategories([]));
  }, [form.hub_id, is2W]); // eslint-disable-line

  function setC(field, val) { setCust(c => ({ ...c, [field]: val })); setErrors(e => ({ ...e, [field]: '' })); }
  function setV(field, val) {
    setVeh(v => {
      const next = { ...v, [field]: val };
      if (field === 'vehicle_type_id') {
        next.make_id = ''; next.model_id = ''; next.cc_category_id = '';
        next.segment_ids = []; next.body_type_id = '';
        setModelName(''); setMakeSearch(''); setModelSearch(''); setCcPreview(''); setEngineCcDisp(null); setNoCcData(false);
      }
      if (field === 'make_id') {
        next.model_id = ''; next.cc_category_id = '';
        next.segment_ids = []; next.body_type_id = '';
        setModelName(''); setModelSearch(''); setCcPreview(''); setEngineCcDisp(null); setNoCcData(false);
      }
      return next;
    });
    setErrors(e => ({ ...e, [field]: '' }));
  }

  // ── Handle model name selection (deduplication flow) ──
  function handleModelNameChange(name) {
    setModelName(name);
    setCcPreview(''); setEngineCcDisp(null); setNoCcData(false);
    const matchingModels = models.filter(m => m.name === name);
    const segIds = [...new Set(matchingModels.filter(m => m.segment_id).map(m => m.segment_id))];

    if (matchingModels.length === 1) {
      // Only one variant — auto-set everything
      const m = matchingModels[0];
      setVeh(v => ({
        ...v, model_id: String(m.id),
        segment_ids: m.segment_id ? [m.segment_id] : [],
        body_type_id: m.body_type_id ? String(m.body_type_id) : '',
        cc_category_id: '',
      }));
    } else if (segIds.length === 1) {
      // Multiple rows but same segment — auto-select
      const m = matchingModels.find(x => x.segment_id === segIds[0]);
      setVeh(v => ({
        ...v, model_id: String(m.id),
        segment_ids: [m.segment_id],
        body_type_id: m.body_type_id ? String(m.body_type_id) : '',
        cc_category_id: '',
      }));
    } else {
      // Multiple segments — reset, let user pick segment
      setVeh(v => ({ ...v, model_id: '', segment_ids: [], body_type_id: '', cc_category_id: '' }));
    }
  }

  // ── Handle segment selection → resolve exact model row ──
  function handleSegmentChange(segmentId) {
    const numId = segmentId ? Number(segmentId) : null;
    const exactModel = models.find(m => m.name === modelName && m.segment_id === numId);
    setVeh(v => ({
      ...v,
      segment_ids: numId ? [numId] : [],
      model_id: exactModel ? String(exactModel.id) : v.model_id,
      body_type_id: exactModel?.body_type_id ? String(exactModel.body_type_id) : v.body_type_id,
    }));
  }
  function setF(field, val) { setForm(f => ({ ...f, [field]: val })); setErrors(e => ({ ...e, [field]: '' })); }

  // Current category's services
  const activeCat = allCategories.find(c => c.id === selectedCatId);
  const displaySvcs = svcSearch
    ? (activeCat?.services || []).filter(s => s.name.toLowerCase().includes(svcSearch.toLowerCase()))
    : (activeCat?.services || []);

  // Deduplicate models by name for the dropdown
  const uniqueModels = useMemo(() => {
    const seen = new Map();
    for (const m of models) { if (!seen.has(m.name)) seen.set(m.name, m); }
    return [...seen.values()].filter(m =>
      !modelSearch || m.name.toLowerCase().includes(modelSearch.toLowerCase())
    );
  }, [models, modelSearch]);

  // Segments available for the selected model name
  const availableSegmentsForModel = useMemo(() => {
    if (!modelName) return segments;
    const segIds = new Set(
      models.filter(m => m.name === modelName && m.segment_id).map(m => m.segment_id)
    );
    return segIds.size > 0 ? segments.filter(s => segIds.has(s.id)) : segments;
  }, [modelName, models, segments]);

  // Filter hubs by vehicle type
  const filteredHubs = hubs.filter(h => {
    if (!veh.vehicle_type_id) return true;
    if (h.vehicle_class === 'both') return true;
    if (is2W && h.vehicle_class === '2W') return true;
    if (!is2W && h.vehicle_class === '4W') return true;
    return false;
  });

  // ── Add a service with price lookup ──
  async function addService(svc, catId) {
    if (selectedSvcs.find(s => s.service_id === svc.service_id)) return;
    setSvcLoading(true);
    try {
      const r = await api('/api/leads/price-lookup', {
        method: 'POST',
        body: {
          service_id: svc.service_id,
          vehicle_type_id: veh.vehicle_type_id || null,
          make_id: veh.make_id || null,
          model_id: veh.model_id || null,
          body_type_id: veh.body_type_id || null,
          segment_id: veh.segment_ids?.[0] || null,
          cc_category_id: veh.cc_category_id || null,
        },
      });
      const cat = allCategories.find(c => c.id === catId);
      setSelectedSvcs(prev => [...prev, {
        service_id: svc.service_id,
        name: svc.name,
        category: cat?.name || '',
        category_id: cat?.id || null,
        price: r.price || 0,
      }]);
      setErrors(e => ({ ...e, services: '' }));
    } catch (e) { setApiErr(e.message); }
    finally { setSvcLoading(false); }
  }

  function removeService(sid) { setSelectedSvcs(prev => prev.filter(s => s.service_id !== sid)); }
  const totalPrice = selectedSvcs.reduce((sum, s) => sum + Number(s.price), 0);

  // ── Vehicle number validation ──
  function validateVehicleNumber(val) {
    const clean = val.replace(/[\s-]/g, '').toUpperCase();
    if (!clean) return 'Vehicle number is required';
    const bhPattern = /^\d{2}BH\d{4}[A-Z]{2}$/;
    const stdPattern = /^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{1,4}$/;
    if (!stdPattern.test(clean) && !bhPattern.test(clean))
      return 'Enter a valid vehicle number (e.g. GJ01AB1234)';
    return '';
  }

  // ── Submit ──
  async function handleSubmit() {
    const errs = {};
    if (!cust.name.trim()) errs.name = 'Customer name is required';
    if (!cust.mobile.trim()) errs.mobile = 'Mobile number is required';
    const vnErr = validateVehicleNumber(form.vehicle_number);
    if (vnErr) errs.vehicle_number = vnErr;
    if (!form.hub_id) errs.hub_id = 'Hub is required';
    if (!form.scheduled_date) errs.scheduled_date = 'Date is required';
    if (selectedSvcs.length === 0) errs.services = 'Select at least one service';
    if (form.pickup_required && !form.pickup_address_line1.trim()) errs.pickup_address_line1 = 'Pickup address (line 1) is required';
    if (form.drop_required && !form.drop_address_line1.trim()) errs.drop_address_line1 = 'Drop address (line 1) is required';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true); setApiErr('');
    try {
      await api('/api/appointments', {
        method: 'POST',
        body: {
          lead_id: lead?.id || leadId,
          assigned_to: lead?.assigned_to || null,
          customer_name: cust.name.trim() || null,
          mobile: cust.mobile.trim() || '',
          whatsapp: cust.whatsapp.trim() || null,
          vehicle_number: form.vehicle_number.trim(),
          vehicle_type_id: veh.vehicle_type_id || null,
          make_id: veh.make_id || null,
          model_id: veh.model_id || null,
          body_type_id: veh.body_type_id || null,
          segment_ids: veh.segment_ids || [],
          cc_category_id: veh.cc_category_id || null,
          hub_id: Number(form.hub_id),
          scheduled_date: form.scheduled_date,
          scheduled_time: form.scheduled_time || null,
          notes: form.notes.trim() || null,
          pickup_required: form.pickup_required,
          pickup_address_line1: form.pickup_required ? (form.pickup_address_line1.trim() || null) : null,
          pickup_address_line2: form.pickup_required ? (form.pickup_address_line2.trim() || null) : null,
          pickup_city: form.pickup_required ? (form.pickup_city.trim() || null) : null,
          pickup_pincode: form.pickup_required ? (form.pickup_pincode.trim() || null) : null,
          pickup_maps_link: form.pickup_required ? (form.pickup_maps_link.trim() || null) : null,
          drop_required: form.drop_required,
          drop_address_line1: form.drop_required ? (form.drop_address_line1.trim() || null) : null,
          drop_address_line2: form.drop_required ? (form.drop_address_line2.trim() || null) : null,
          drop_city: form.drop_required ? (form.drop_city.trim() || null) : null,
          drop_pincode: form.drop_required ? (form.drop_pincode.trim() || null) : null,
          drop_maps_link: form.drop_required ? (form.drop_maps_link.trim() || null) : null,
          services: selectedSvcs.map(s => ({
            service_id: s.service_id,
            category_id: s.category_id,
            price: s.price,
          })),
        },
      });
      onConfirm({ appointment_date: form.scheduled_date, appointment_time: form.scheduled_time });
    } catch (e) { setApiErr(e.message); setSaving(false); }
  }

  return createPortal(
    <div className="ca-backdrop">
      <div className="ca-modal" onMouseDown={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="ca-hdr">
          <div className="ca-hdr-icon"><Calendar size={17} /></div>
          <div className="ca-hdr-text">
            <div className="ca-hdr-title">Convert to Appointment</div>
            <div className="ca-hdr-sub">Fill in details to book a service appointment</div>
          </div>
          <span className="ca-status-pill">{statusName}</span>
          <button className="ca-close" onClick={onCancel}><X size={16} /></button>
        </div>

        {loadingLead ? (
          <div className="ca-body ca-loading">Loading lead details…</div>
        ) : (
          <div className="ca-body">
            {apiErr && <div className="ca-api-err"><AlertCircle size={13} /> {apiErr}</div>}

            {/* ── Customer Details ── */}
            <div className="ca-section-block">
              <div className="ca-section-title"><User size={12} /> Customer Details</div>
              <div className="ca-row-3">
                <div className="ca-field">
                  <label className="ca-lbl">Name <span className="ca-req">*</span></label>
                  <input className={`ca-input${errors.name ? ' ca-input--err' : ''}`}
                    placeholder="Customer name"
                    value={cust.name}
                    onChange={e => setC('name', e.target.value)} />
                  {errors.name && <span className="ca-field-err"><AlertCircle size={10} /> {errors.name}</span>}
                </div>
                <div className="ca-field">
                  <label className="ca-lbl">Mobile <span className="ca-req">*</span></label>
                  <input className={`ca-input${errors.mobile ? ' ca-input--err' : ''}`}
                    placeholder="Mobile number"
                    value={cust.mobile}
                    onChange={e => setC('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} />
                  {errors.mobile && <span className="ca-field-err"><AlertCircle size={10} /> {errors.mobile}</span>}
                </div>
                <div className="ca-field">
                  <label className="ca-lbl">WhatsApp</label>
                  <input className="ca-input"
                    placeholder="WhatsApp number"
                    value={cust.whatsapp}
                    onChange={e => setC('whatsapp', e.target.value.replace(/\D/g, '').slice(0, 10))} />
                </div>
              </div>
            </div>

            {/* ── Vehicle Details ── */}
            <div className="ca-section-block">
              <div className="ca-section-title"><Car size={12} /> Vehicle Details</div>
              <div className="ca-row-3">
                <div className="ca-field">
                  <label className="ca-lbl">Vehicle Type</label>
                  <ApptSelect
                    value={veh.vehicle_type_id}
                    onChange={v => setV('vehicle_type_id', v)}
                    options={vehicleTypes.map(t => ({ value: t.id, label: t.name }))}
                    placeholder="Select type…"
                  />
                </div>
                <div className="ca-field">
                  <label className="ca-lbl">Make {makesLoading && <span className="ca-loading-dot">…</span>}</label>
                  <ApptSelect
                    value={veh.make_id}
                    onChange={v => setV('make_id', v)}
                    options={makes.map(m => ({ value: m.id, label: m.name }))}
                    placeholder="Select make…"
                    disabled={!veh.vehicle_type_id}
                    loading={makesLoading}
                    searchPlaceholder="Search make…"
                  />
                </div>
                <div className="ca-field">
                  <label className="ca-lbl">Model {modelsLoading && <span className="ca-loading-dot">…</span>}</label>
                  <ApptSelect
                    value={modelName}
                    onChange={v => handleModelNameChange(v)}
                    options={uniqueModels.map(m => ({ value: m.name, label: m.name }))}
                    placeholder="Select model…"
                    disabled={!veh.make_id}
                    loading={modelsLoading}
                    searchPlaceholder="Search model…"
                  />
                </div>
              </div>

              {/* CC / Segment + Body Type */}
              <div className="ca-row-3" style={{ marginTop: 10 }}>
                {is2W ? (
                  <div className="ca-field" style={{ gridColumn: '1 / span 2' }}>
                    <label className="ca-lbl">
                      CC Category
                      {ccPreview && <span className="ca-cc-auto-tag">auto-filled</span>}
                      {noCcData && <span className="ca-cc-auto-tag" style={{ background: '#fef3c7', color: '#92400e' }}>select manually</span>}
                    </label>
                    <ApptSelect
                      value={veh.cc_category_id}
                      onChange={v => { setVeh(x => ({ ...x, cc_category_id: v })); setCcPreview(''); setNoCcData(false); }}
                      options={ccCategories.map(c => ({ value: c.id, label: `${c.name} (${c.min_cc}–${c.max_cc} cc)` }))}
                      placeholder="Select CC category…"
                    />
                    {(engineCcDisp || ccPreview) && (
                      <span className="ca-field-hint">
                        {engineCcDisp ? `${engineCcDisp} cc` : ''}
                        {engineCcDisp && ccPreview ? ' → ' : ''}
                        {ccPreview}
                      </span>
                    )}
                    {noCcData && !veh.cc_category_id && (
                      <span className="ca-field-hint" style={{ color: '#b45309' }}>
                        No engine CC data for this model — please select a category manually
                      </span>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="ca-field">
                      <label className="ca-lbl">Fuel / Segment {veh.segment_ids?.length > 0 && <span className="ca-cc-auto-tag">auto-filled</span>}</label>
                      <ApptSelect
                        value={veh.segment_ids?.[0] || ''}
                        onChange={v => handleSegmentChange(v)}
                        options={availableSegmentsForModel.map(s => ({ value: s.id, label: s.name }))}
                        placeholder={modelName ? 'Select fuel…' : 'Select model first…'}
                        disabled={!modelName}
                      />
                    </div>
                    <div className="ca-field">
                      <label className="ca-lbl">Body Type</label>
                      <div className="ca-readonly-pill">
                        {models.find(m => String(m.id) === String(veh.model_id))?.body_type_name || models.find(m => m.name === modelName)?.body_type_name || lead?.body_type_name || '—'}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── Vehicle Number + Hub ── */}
            <div className="ca-section-block">
              <div className="ca-section-title"><Info size={12} /> Appointment Info</div>
              <div className="ca-row-2">
                <div className="ca-field">
                  <label className="ca-lbl">Vehicle Number <span className="ca-req">*</span></label>
                  <input
                    className={`ca-input${errors.vehicle_number ? ' ca-input--err' : ''}`}
                    placeholder="e.g. GJ01AB1234"
                    value={form.vehicle_number}
                    onChange={e => setF('vehicle_number', e.target.value.toUpperCase())}
                    onBlur={e => { const err = validateVehicleNumber(e.target.value); if (err) setErrors(prev => ({ ...prev, vehicle_number: err })); }}
                    maxLength={12}
                  />
                  {errors.vehicle_number
                    ? <span className="ca-field-err"><AlertCircle size={10} /> {errors.vehicle_number}</span>
                    : form.vehicle_number && !validateVehicleNumber(form.vehicle_number) && (
                      <span className="ca-field-ok"><CheckCircle2 size={10} /> Valid format</span>
                    )
                  }
                </div>
                <div className="ca-field">
                  <label className="ca-lbl">Hub <span className="ca-req">*</span></label>
                  <ApptSelect
                    value={form.hub_id}
                    onChange={v => setF('hub_id', v)}
                    options={filteredHubs.map(h => ({ value: h.id, label: `${h.hub_name} — ${h.city_name}` }))}
                    placeholder="Select hub…"
                    searchPlaceholder="Search hub…"
                    error={!!errors.hub_id}
                  />
                  {errors.hub_id && <span className="ca-field-err"><AlertCircle size={10} /> {errors.hub_id}</span>}
                </div>
              </div>
            </div>

            {/* ── Pickup ── */}
            <div className="ca-section-block">
              <div className="ca-section-title"><MapPin size={12} /> Pickup</div>

              {/* Pickup toggle — Visit ◯ Pickup Required */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: form.pickup_required ? 12 : 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted,#64748b)' }}>Visit</span>
                <button type="button"
                  onClick={() => setForm(f => ({ ...f, pickup_required: !f.pickup_required, pickup_address_line1: '', pickup_address_line2: '', pickup_city: '', pickup_pincode: '', pickup_maps_link: '' }))}
                  className={`ca-toggle${form.pickup_required ? ' ca-toggle--on' : ''}`}>
                  <span className="ca-toggle-knob" />
                </button>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text,#1e293b)' }}>Pickup Required</span>
              </div>
              {form.pickup_required && (
                <div className="ca-pd-fields">
                  <div className="ca-field">
                    <label className="ca-lbl">Address Line 1 <span className="ca-req">*</span></label>
                    <input className={`ca-input${errors.pickup_address_line1 ? ' ca-input--err' : ''}`}
                      placeholder="Flat / Building / Street"
                      autoComplete="address-line1"
                      value={form.pickup_address_line1}
                      onChange={e => setF('pickup_address_line1', e.target.value)} />
                    {errors.pickup_address_line1 && <span className="ca-field-err"><AlertCircle size={10} /> {errors.pickup_address_line1}</span>}
                  </div>
                  <div className="ca-field">
                    <label className="ca-lbl">Address Line 2</label>
                    <input className="ca-input" placeholder="Landmark / Area (optional)"
                      autoComplete="address-line2"
                      value={form.pickup_address_line2}
                      onChange={e => setF('pickup_address_line2', e.target.value)} />
                  </div>
                  <div className="ca-pd-row2">
                    <div className="ca-field">
                      <label className="ca-lbl">City</label>
                      <input className="ca-input" placeholder="City"
                        autoComplete="address-level2"
                        value={form.pickup_city}
                        onChange={e => setF('pickup_city', e.target.value)} />
                    </div>
                    <div className="ca-field">
                      <label className="ca-lbl">Pincode</label>
                      <input className="ca-input" placeholder="6-digit pincode" maxLength={6}
                        autoComplete="postal-code"
                        value={form.pickup_pincode}
                        onChange={e => setF('pickup_pincode', e.target.value.replace(/\D/g, ''))} />
                    </div>
                  </div>
                  <div className="ca-field">
                    <label className="ca-lbl">Google Maps Link</label>
                    <input className="ca-input" placeholder="https://maps.google.com/..."
                      autoComplete="off"
                      value={form.pickup_maps_link}
                      onChange={e => setF('pickup_maps_link', e.target.value)} />
                  </div>
                </div>
              )}

            </div>

            {/* ── Schedule ── */}
            <div className="ca-section-block">
              <div className="ca-section-title"><Clock size={12} /> Schedule</div>
              <div className="ca-row-2">
                <div className="ca-field">
                  <label className="ca-lbl">Date <span className="ca-req">*</span></label>
                  <input type="date" className={`ca-input${errors.scheduled_date ? ' ca-input--err' : ''}`}
                    value={form.scheduled_date}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={e => setF('scheduled_date', e.target.value)} />
                  {errors.scheduled_date && <span className="ca-field-err"><AlertCircle size={10} /> {errors.scheduled_date}</span>}
                </div>
                <div className="ca-field">
                  <label className="ca-lbl">Time</label>
                  <input type="time" className="ca-input"
                    value={form.scheduled_time}
                    onChange={e => setF('scheduled_time', e.target.value)} />
                </div>
              </div>
            </div>

            {/* ── Services ── two-panel picker ── */}
            <div className="ca-section-block">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div className="ca-section-title" style={{ margin: 0 }}>
                  <Wrench size={12} /> Services <span className="ca-req">*</span>
                </div>
                {form.hub_id && (
                  <span className="ca-vc-badge">{vehicleTypeLabel} services</span>
                )}
              </div>

              {/* Pricing accuracy warning — shown when hub is selected but vehicle details are incomplete */}
              {form.hub_id && (!veh.make_id || !veh.model_id || (!is2W && !veh.segment_ids?.length) || (is2W && !veh.cc_category_id)) && (
                <div className="ca-price-warn">
                  <AlertCircle size={13} style={{ flexShrink: 0 }} />
                  <span>
                    <strong>Pricing may be inaccurate</strong> — add{' '}
                    {!veh.make_id ? 'make' : !veh.model_id ? 'model' : is2W ? 'CC category' : 'fuel / segment'}{' '}
                    details above so services fetch the correct price for this vehicle.
                  </span>
                </div>
              )}

              {!form.hub_id ? (
                <div className="ca-no-svc">Select a hub above to see available services.</div>
              ) : allCategories.length === 0 ? (
                <div className="ca-no-svc">No services mapped to this hub yet.</div>
              ) : (
                <div className={`ca-svc-panel${errors.services ? ' ca-svc-panel--err' : ''}`}>
                  {/* Left: categories sidebar */}
                  <div className="ca-svc-cats">
                    <div className="ca-svc-cats-label">Categories</div>
                    {allCategories.map(cat => (
                      <button
                        key={cat.id}
                        className={`ca-svc-cat-item${selectedCatId === cat.id ? ' ca-svc-cat-item--active' : ''}`}
                        onClick={() => { setSelectedCatId(cat.id); setSvcSearch(''); }}
                      >
                        <span>{cat.name}</span>
                        <span className="ca-svc-cat-plus">+</span>
                      </button>
                    ))}
                  </div>

                  {/* Right: services grid */}
                  <div className="ca-svc-right">
                    <div className="ca-svc-search-bar">
                      <Search size={13} className="ca-svc-si" />
                      <input
                        className="ca-svc-search-inp"
                        placeholder="Search services…"
                        value={svcSearch}
                        onChange={e => setSvcSearch(e.target.value)}
                      />
                    </div>
                    <div className="ca-svc-grid">
                      {displaySvcs.length === 0 && (
                        <div className="ca-no-svc" style={{ gridColumn: '1/-1', padding: '20px 0' }}>
                          {svcSearch ? 'No matching services.' : 'No services in this category.'}
                        </div>
                      )}
                      {displaySvcs.map(svc => {
                        const already = selectedSvcs.find(s => s.service_id === svc.service_id);
                        return (
                          <button
                            key={svc.service_id}
                            className={`ca-svc-card${already ? ' ca-svc-card--added' : ''}`}
                            onClick={() => !already && !svcLoading && addService(svc, selectedCatId)}
                            disabled={!!already || svcLoading}
                          >
                            <span className="ca-svc-card-name">{svc.name}</span>
                            <span className="ca-svc-card-plus">{already ? '✓' : svcLoading ? '…' : '+'}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              {errors.services && <span className="ca-field-err" style={{ marginTop: 8, display: 'flex' }}><AlertCircle size={10} /> {errors.services}</span>}

              {/* Selected services summary */}
              {selectedSvcs.length > 0 && (
                <div className="ca-selected-svcs" style={{ marginTop: 12 }}>
                  {selectedSvcs.map(s => (
                    <div key={s.service_id} className="ca-sel-svc-row">
                      <div>
                        <span className="ca-sel-svc-name">{s.name}</span>
                        {s.category && <span className="ca-sel-svc-cat">{s.category}</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="ca-sel-svc-price">₹{s.price.toLocaleString('en-IN')}</span>
                        <button className="ca-sel-svc-rm" onClick={() => removeService(s.service_id)}>
                          <X size={11} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="ca-total-row">
                    <span>Total</span>
                    <span className="ca-total-val">₹{totalPrice.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              )}
            </div>

            {/* ── Notes ── */}
            <div className="ca-section-block" style={{ borderBottom: 'none' }}>
              <div className="ca-section-title"><FileText size={12} /> Notes</div>
              <div className="ca-field">
                <textarea className="ca-input ca-textarea" rows={2}
                  placeholder="Any details for the appointment…"
                  value={form.notes} onChange={e => setF('notes', e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="ca-footer">
          <button className="ca-btn-cancel" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="ca-btn-confirm" onClick={handleSubmit} disabled={saving || loadingLead}>
            {saving ? 'Creating…' : 'Create Appointment'}
          </button>
        </div>
      </div>
    </div>
    , document.body);
}

// ── Inline status select (EDIT_LEAD only) ─────────────────────────────────────
// Uses a fixed-position portal so the dropdown is never clipped by overflow:hidden parents.
function StatusInlineSelect({ leadId, leadName, current, onChange, statusList = [], onOpenConvert }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const [lostModal, setLostModal] = useState(null);   // { statusName }
  const [actionModal, setActionModal] = useState(null); // { statusName, logsCall, needsFollowUp }
  const btnRef = useRef(null);
  const dropRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onOut(e) {
      if (btnRef.current?.contains(e.target)) return;
      if (dropRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, [open]);

  // Close on scroll — but only if the scroll is outside the dropdown itself
  useEffect(() => {
    if (!open) return;
    function onScroll(e) {
      if (dropRef.current && dropRef.current.contains(e.target)) return;
      setOpen(false);
    }
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [open]);

  function toggle() {
    if (busy) return;
    if (!open) {
      const r = btnRef.current.getBoundingClientRect();
      const dropHeight = Math.min(statusList.length * 38 + 8, 300);
      const spaceBelow = window.innerHeight - r.bottom;
      const openUp = spaceBelow < dropHeight + 8 && r.top > dropHeight;
      setPos({
        left: r.left,
        width: Math.max(r.width, 220),
        top: openUp ? undefined : r.bottom + 4,
        bottom: openUp ? window.innerHeight - r.top + 4 : undefined,
      });
    }
    setOpen(o => !o);
  }

  async function pick(name) {
    if (name === current) { setOpen(false); return; }
    const statusObj = statusList.find(s => s.name === name);
    // 1. Intercept "Lost" status — require a reason first
    if (name.toLowerCase().includes('lost')) {
      setOpen(false);
      setLostModal({ statusName: name });
      return;
    }
    // 2. Intercept "converts_to_appointment" flag — open appointment form
    if (statusObj?.converts_to_appointment) {
      setOpen(false);
      onOpenConvert?.({ statusName: name, leadId, leadName, saveFn: save });
      return;
    }
    // 3. Intercept logs_call and/or needs_follow_up — open merged action modal
    if (statusObj?.logs_call || statusObj?.needs_follow_up) {
      setOpen(false);
      setActionModal({
        statusName: name,
        logsCall: !!statusObj.logs_call,
        needsFollowUp: !!statusObj.needs_follow_up,
      });
      return;
    }
    await save(name, null);
  }

  async function save(status, lostReason, meta = {}) {
    setBusy(true);
    try {
      // If a call outcome was selected, log the call first
      if (meta.call_outcome) {
        try {
          await api(`/api/leads/${leadId}/calls`, {
            method: 'POST',
            body: { outcome: meta.call_outcome, notes: meta.call_notes || null },
          });
        } catch (callErr) {
          console.error('[StatusInlineSelect] call log failed:', callErr?.message);
          // Non-fatal — continue with status update
        }
      }
      const body = { status };
      if (lostReason) body.lost_reason = lostReason;
      if (meta.follow_up_date) body.follow_up_date = meta.follow_up_date;
      if (meta.follow_up_time) body.follow_up_time = meta.follow_up_time;
      if (meta.note) body.follow_up_note = meta.note;
      const r = await api(`/api/leads/${leadId}`, { method: 'PATCH', body });
      onChange(r.item);
    } catch (err) {
      console.error('[StatusInlineSelect] save failed:', err?.message);
    }
    finally { setBusy(false); }
  }

  const cfg = current ? getStatusCfg(current, statusList) : { color: '#0369a1', bg: '#e0f2fe' };
  const currentStatus = statusList.find(s => s.name === current);
  const isLocked = !!currentStatus?.is_locked;

  return (
    <>
      {lostModal && (
        <LostReasonModal
          statusName={lostModal.statusName}
          onConfirm={reason => { setLostModal(null); save(lostModal.statusName, reason); }}
          onCancel={() => setLostModal(null)}
        />
      )}
      {actionModal && (
        <StatusActionModal
          statusName={actionModal.statusName}
          leadName={leadName}
          logsCall={actionModal.logsCall}
          needsFollowUp={actionModal.needsFollowUp}
          onConfirm={data => { const m = actionModal; setActionModal(null); save(m.statusName, null, data); }}
          onCancel={() => setActionModal(null)}
        />
      )}

      {/* ── Locked status — non-clickable badge ── */}
      {isLocked ? (
        <span
          title="This status is locked and cannot be changed"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
            letterSpacing: 0.3, border: `2px solid ${cfg.color}33`,
            background: cfg.bg, color: cfg.color,
            whiteSpace: 'nowrap', maxWidth: 200, cursor: 'not-allowed', opacity: 0.85,
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {current}
          </span>
          <Lock size={10} style={{ flexShrink: 0, opacity: 0.7 }} />
        </span>
      ) : (
        <button
          ref={btnRef}
          type="button"
          disabled={busy}
          onClick={toggle}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
            letterSpacing: 0.3, cursor: busy ? 'not-allowed' : 'pointer',
            border: `2px solid ${cfg.color}33`,
            background: cfg.bg, color: cfg.color,
            opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap', maxWidth: 200,
          }}
        >
          {!current && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#0ea5e9', flexShrink: 0 }} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {current || 'New Lead'}
          </span>
          <ChevronDown size={11} style={{ flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }} />
        </button>
      )}

      {open && typeof document !== 'undefined' && (
        <div
          ref={dropRef}
          className="lp-status-portal"
          style={{ top: pos.top, bottom: pos.bottom, left: pos.left, minWidth: pos.width }}
        >
          {statusList.map(s => (
            <button
              key={s.id}
              className={`lp-dropdown-item${s.name === current ? ' lp-dropdown-item--current' : ''}`}
              onClick={() => pick(s.name)}
            >
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{s.name}</span>
              {s.name === current && <CheckCircle2 size={13} style={{ color: s.color, flexShrink: 0 }} />}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function LeadsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  // Lifted here so the modal survives lead-list re-renders (e.g. Chrome autofill changing search)
  const [pageConvertModal, setPageConvertModal] = useState(null); // { statusName, leadId, leadName, saveFn }
  const canCreate = useCan('CREATE_LEAD');
  const canEdit = useCan('EDIT_LEAD');
  const canDelete = useCan('DELETE_LEAD');
  const canExport = useCan('EXPORT_LEADS');
  const canViewReports = useCan('VIEW_REPORTS');
  const canViewLead = useCan('VIEW_LEAD');
  const canViewTeam = useCan('VIEW_TEAM_LEADS');
  const canManageFollowUps = useCan('MANAGE_FOLLOW_UPS');

  // Stage Velocity: visible to anyone who can see beyond own leads (reporting/team/all)
  const showStageVelocity = canViewReports || canViewLead || canViewTeam;
  // Follow-up Compliance: visible to managers/admins or those managing follow-ups
  const showCompliancePanel = canViewReports || canManageFollowUps || canViewTeam;

  const [pageSize, setPageSize] = useState(10);

  const [leads, setLeads] = useState([]);
  const [leadsScope, setLeadsScope] = useState('all');
  const [statusList, setStatusList] = useState([]);
  const [leadSources, setLeadSources] = useState(LEAD_SOURCES); // default to const; overridden by API
  const [stageStats, setStageStats] = useState([]);
  const [showVelocity, setShowVelocity] = useState(false);
  const [compliance, setCompliance] = useState(null);  // { summary, by_agent }
  const [showCompliance, setShowCompliance] = useState(false);
  const [todayEvents, setTodayEvents] = useState([]);
  const [eventsDone, setEventsDone] = useState({});
  const [fuDrawerOpen, setFuDrawerOpen] = useState(false);
  const [rescheduleEvent, setRescheduleEvent] = useState(null); // { id, lead_id, lead_status }
  const [fuFilter, setFuFilter] = useState('today');
  const [fuLoading, setFuLoading] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);

  // Basic filters — seed from global search URL param (?search=)
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [statusFilters, setStatusFilters] = useState([]); // multi-select array
  const [createdByFilter, setCreatedByFilter] = useState('');
  const [creatorFilter, setCreatorFilter] = useState('');
  const [statusDDOpen, setStatusDDOpen] = useState(false);

  const statusDDRef = useRef(null);

  // Advanced filters panel
  const [showAdv, setShowAdv] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [fState, setFState] = useState('');
  const [fCity, setFCity] = useState('');
  const [fArea, setFArea] = useState('');
  const [fVType, setFVType] = useState('');
  const [fMake, setFMake] = useState('');
  const [fModel, setFModel] = useState('');
  const [fSource, setFSource] = useState('');

  // Reference data for advanced filters
  const [states, setStates] = useState([]);
  const [advCities, setAdvCities] = useState([]);
  const [advAreas, setAdvAreas] = useState([]);
  const [vTypes, setVTypes] = useState([]);
  const [advMakes, setAdvMakes] = useState([]);
  const [advModels, setAdvModels] = useState([]);

  // Multi-select + bulk assign + bulk delete
  const [selectedLeads, setSelectedLeads] = useState(new Set());
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [bulkAssignTarget, setBulkAssignTarget] = useState('');
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [agentsList, setAgentsList] = useState([]);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Modals
  const [viewId, setViewId] = useState(null);
  const [editLead, setEditLead] = useState(null);
  const [deleteLead, setDeleteLead] = useState(null);

  // ── Shareable /leads/:token URL support ──────────────────────────────────
  // resolvedTokenRef tracks which token the currently-open lead (if any)
  // already corresponds to, so we don't re-fetch or redundantly rewrite the
  // URL once it's in sync.
  const resolvedTokenRef = useRef(null);
  // Flips true the instant the user explicitly closes the modal. Guards
  // against a slow/late-resolving fetch (ViewLeadModal's own load, or the
  // by-token resolver below) firing onLeadLoaded/navigate AFTER the modal
  // has already been closed — without this, a stale response could silently
  // re-push the token URL back into the address bar even though the modal
  // is shut.
  const closedRef = useRef(false);

  // Opens a lead from a full row object we already have in hand (row click,
  // ActionMenu "View", mobile card) — we already know both the numeric id
  // and the token, so this opens instantly (no fetch) and pushes the
  // shareable URL (push, not replace: this is a real navigation the user
  // should be able to back out of).
  function openLead(l) {
    closedRef.current = false;
    resolvedTokenRef.current = l.public_token;
    setViewId(l.id);
    navigate(`/leads/${l.public_token}`);
  }

  function closeLead() {
    closedRef.current = true;
    resolvedTokenRef.current = null;
    navigate('/leads');
  }

  // Called once ViewLeadModal finishes loading a lead by numeric id (the
  // path used when we only had an id, not a token — global search,
  // notifications, the duplicate-lead-click event, follow-up drawer rows).
  // Syncs the URL to the shareable token form after the fact, via replace
  // so it doesn't add an extra back-button stop for what was really one
  // navigation.
  function handleLeadLoaded(lead) {
    if (closedRef.current) return;
    if (!lead?.public_token || resolvedTokenRef.current === lead.public_token) return;
    resolvedTokenRef.current = lead.public_token;
    navigate(`/leads/${lead.public_token}`, { replace: true });
  }

  // Landing directly on /leads/:token (typed/pasted/bookmarked link, page
  // refresh, or browser back/forward) — resolve the token to a numeric id
  // so ViewLeadModal can load it the same way it always has.
  useEffect(() => {
    if (!token) { setViewId(null); resolvedTokenRef.current = null; return; }
    if (resolvedTokenRef.current === token) return; // already opening/open
    closedRef.current = false;
    resolvedTokenRef.current = token;
    api(`/api/leads/by-token/${token}`)
      .then(r => { if (!closedRef.current) setViewId(r.item.id); })
      .catch(() => { resolvedTokenRef.current = null; }); // invalid/unknown token — leave modal closed
  }, [token]);

  // Open a specific lead when navigated from global search
  useEffect(() => {
    const id = location.state?.openLeadId;
    if (id) { closedRef.current = false; setViewId(id); }
  }, [location.state]);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  useEffect(() => {
    api('/api/lead-statuses').then(r => setStatusList(r.items)).catch(() => { });
    api('/api/users/assignable').then(r => setAgentsList(r.items || [])).catch(() => { });
    api('/api/lead-events?filter=today').then(r => setTodayEvents(r.items || [])).catch(() => { });
    api('/api/lead-sources').then(r => {
      if (r.items?.length) setLeadSources(r.items.map(s => s.name));
    }).catch(() => { }); // keep fallback LEAD_SOURCES if API fails
    api('/api/leads/stage-stats').then(r => setStageStats(r.items || [])).catch(() => { });
    api('/api/lead-events/compliance').then(r => setCompliance(r)).catch(() => { });
  }, []);

  // Open lead from duplicate detection click in NewLeadModal
  useEffect(() => {
    function handleOpenLeadView(e) { closedRef.current = false; setViewId(e.detail?.id); }
    window.addEventListener('open-lead-view', handleOpenLeadView);
    return () => window.removeEventListener('open-lead-view', handleOpenLeadView);
  }, []);

  // Re-fetch follow-ups when filter changes
  useEffect(() => {
    if (fuFilter === 'custom') return;
    setFuLoading(true);
    api(`/api/lead-events?filter=${fuFilter}`)
      .then(r => { setTodayEvents(r.items || []); setEventsDone({}); })
      .catch(() => { })
      .finally(() => setFuLoading(false));
  }, [fuFilter]);

  function applyCustomFilter() {
    if (!customFrom || !customTo) return;
    setFuLoading(true);
    api(`/api/lead-events?filter=custom&date_from=${customFrom}&date_to=${customTo}`)
      .then(r => { setTodayEvents(r.items || []); setEventsDone({}); })
      .catch(() => { })
      .finally(() => setFuLoading(false));
  }

  // Load states + vehicle types when advanced panel first opens
  useEffect(() => {
    if (!showAdv) return;
    if (!states.length) api('/api/locations/states').then(r => setStates(r.items || [])).catch(() => { });
    if (!vTypes.length) api('/api/vehicles/types').then(r => setVTypes(r.items || [])).catch(() => { });
  }, [showAdv]); // eslint-disable-line

  // Cascading: state → cities
  useEffect(() => {
    if (!fState) { setAdvCities([]); setFCity(''); setAdvAreas([]); setFArea(''); return; }
    api(`/api/locations/cities?state_id=${fState}`).then(r => setAdvCities(r.items || [])).catch(() => setAdvCities([]));
    setFCity(''); setAdvAreas([]); setFArea('');
  }, [fState]);

  // Cascading: city → areas
  useEffect(() => {
    if (!fCity) { setAdvAreas([]); setFArea(''); return; }
    api(`/api/locations/areas?city_id=${fCity}`).then(r => setAdvAreas(r.items || [])).catch(() => setAdvAreas([]));
    setFArea('');
  }, [fCity]);

  // Cascading: vehicle type → makes
  useEffect(() => {
    if (!fVType) { setAdvMakes([]); setFMake(''); setAdvModels([]); setFModel(''); return; }
    api(`/api/vehicles/makes?type_id=${fVType}`).then(r => setAdvMakes(r.items || [])).catch(() => setAdvMakes([]));
    setFMake(''); setAdvModels([]); setFModel('');
  }, [fVType]);

  // Cascading: make → models
  useEffect(() => {
    if (!fMake) { setAdvModels([]); setFModel(''); return; }
    api(`/api/vehicles/models?make_id=${fMake}`).then(r => setAdvModels(r.items || [])).catch(() => setAdvModels([]));
    setFModel('');
  }, [fMake]);

  // Close status dropdown on outside click
  useEffect(() => {
    function handler(e) {
      if (statusDDRef.current && !statusDDRef.current.contains(e.target)) setStatusDDOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api('/api/leads');
      setLeads(r.items);
      setLeadsScope(r.scope || 'all');
      setSelectedLeads(new Set());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadLeads(); }, [loadLeads]);
  useEffect(() => {
    window.addEventListener('lead-created', loadLeads);
    return () => window.removeEventListener('lead-created', loadLeads);
  }, [loadLeads]);

  // Unique assignees for dropdown
  const assignees = useMemo(() => {
    const map = {};
    for (const l of leads) {
      if (l.assigned_to && l.assigned_to_name) map[l.assigned_to] = l.assigned_to_name;
    }
    return Object.entries(map).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [leads]);

  const creators = useMemo(() => {
    const map = {};
    for (const l of leads) {
      if (l.created_by_id && l.created_by_name) map[l.created_by_id] = l.created_by_name;
    }
    return Object.entries(map).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [leads]);


  // Count active advanced filters
  const advCount = [dateFrom, dateTo, fState, fCity, fArea, fVType, fMake, fModel, fSource].filter(Boolean).length;

  function clearAdvanced() {
    setDateFrom(''); setDateTo('');
    setFState(''); setFCity(''); setFArea('');
    setFVType(''); setFMake(''); setFModel('');
    setFSource('');
  }

  // Client-side filter — all criteria combined
  const filtered = leads.filter(l => {
    const q = search.toLowerCase();
    if (!q || !(l.name || '').toLowerCase().includes(q) && !l.mobile.includes(q)) {
      if (q) return false;
    }
    if (statusFilters.length) {
      const isNew = !l.status;
      const matchesNew = statusFilters.includes('__new__') && isNew;
      const matchesStatus = l.status && statusFilters.includes(l.status);
      if (!matchesNew && !matchesStatus) return false;
    }
    if (createdByFilter) {
      if (createdByFilter === 'unassigned') {
        if (l.assigned_to) return false;
      } else {
        if (String(l.assigned_to) !== createdByFilter) return false;
      }
    }
    if (creatorFilter && String(l.created_by_id) !== creatorFilter) return false;

    // Date range
    if (dateFrom || dateTo) {
      const d = new Date(l.created_at);
      const from = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
      const to = dateTo ? new Date(dateTo + 'T23:59:59') : null;
      if (from && d < from) return false;
      if (to && d > to) return false;
    }

    // Location
    if (fState && String(l.state_id) !== fState) return false;
    if (fCity && String(l.city_id) !== fCity) return false;
    if (fArea && String(l.area_id) !== fArea) return false;

    // Vehicle
    if (fVType && String(l.vehicle_type_id) !== fVType) return false;
    if (fMake && String(l.make_id) !== fMake) return false;
    if (fModel && String(l.model_id) !== fModel) return false;

    // Source
    if (fSource && l.lead_source !== fSource) return false;

    return true;
  });

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [search, statusFilters, createdByFilter, creatorFilter, dateFrom, dateTo, fState, fCity, fArea, fVType, fMake, fModel, fSource]);

  // Status counts — scoped to selected assignee if one is active
  const leadsForCounts = createdByFilter
    ? leads.filter(l => String(l.assigned_to) === createdByFilter)
    : leads;
  const newLeadCount = leadsForCounts.filter(l => !l.status).length;
  const counts = leadsForCounts.reduce((acc, l) => { if (l.status) { acc[l.status] = (acc[l.status] || 0) + 1; } return acc; }, {});

  // Total value of filtered leads
  const totalValue = filtered.reduce((sum, l) => sum + Number(l.total_price || 0), 0);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Active filter tag helpers
  const stateName = states.find(s => String(s.id) === fState)?.name;
  const cityName = advCities.find(c => String(c.id) === fCity)?.name;
  const areaName = advAreas.find(a => String(a.id) === fArea)?.name;
  const vtypeName = vTypes.find(v => String(v.id) === fVType)?.name;
  const makeName = advMakes.find(m => String(m.id) === fMake)?.name;
  const modelName = advModels.find(m => String(m.id) === fModel)?.name;

  async function handleDelete(lead) {
    await api(`/api/leads/${lead.id}`, { method: 'DELETE' });
    setLeads(prev => prev.filter(l => l.id !== lead.id));
    setDeleteLead(null);
    showToast(`Lead for ${lead.name || lead.mobile} deleted.`);
  }

  async function handleExport() {
    try {
      const { getToken } = await import('../api/client.js');
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilters.length === 1) params.set('status', statusFilters[0]);
      const res = await fetch(`${API_URL}/api/leads/export?${params.toString()}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) { showToast('Export failed. Check your permissions.'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leads_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Leads exported successfully.');
    } catch {
      showToast('Export failed. Please try again.');
    }
  }

  function handleEditSaved(updated) {
    setLeads(prev => prev.map(l => l.id === updated.id ? { ...l, ...updated } : l));
    setEditLead(null);
    showToast('Lead updated successfully.');
  }

  async function markEventDone(eventId) {
    try {
      await api(`/api/lead-events/${eventId}/done`, { method: 'PATCH' });
      setEventsDone(prev => ({ ...prev, [eventId]: true }));
    } catch (e) { console.error(e); }
  }

  async function handleRescheduleDrawer({ date, time, note }) {
    const { id, lead_id, lead_status } = rescheduleEvent;
    await api(`/api/lead-events/${id}/done`, { method: 'PATCH' });
    await api(`/api/leads/${lead_id}`, {
      method: 'PATCH',
      body: {
        status: lead_status,
        follow_up_date: date,
        follow_up_time: time || null,
        follow_up_note: note || null,
      },
    });
    setEventsDone(prev => ({ ...prev, [id]: true }));
    setRescheduleEvent(null);
  }

  const visibleEvents = todayEvents.filter(e => !eventsDone[e.id]);

  function getStatusCfg(name) {
    const s = statusList.find(s => s.name === name);
    return s ? { color: s.color, bg: s.bg_color } : { color: '#6b7280', bg: '#f3f4f6' };
  }

  return (
    <div className="leads-page">

      {/* Convert-to-Appointment modal — lifted to page level so it survives lead-list re-renders */}
      {pageConvertModal && (
        <ConvertToAppointmentModal
          statusName={pageConvertModal.statusName}
          leadId={pageConvertModal.leadId}
          leadName={pageConvertModal.leadName}
          onConfirm={data => {
            const { saveFn, statusName } = pageConvertModal;
            setPageConvertModal(null);
            saveFn(statusName, null, data);
          }}
          onCancel={() => setPageConvertModal(null)}
        />
      )}

      {rescheduleEvent && (
        <RescheduleFollowUpModal
          onConfirm={handleRescheduleDrawer}
          onCancel={() => setRescheduleEvent(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`lp-toast lp-toast--${toast.type}`}>
          <CheckCircle2 size={15} /> {toast.msg}
        </div>
      )}

      {error && <div className="banner error">{error}</div>}

      {/* ── Page header row ── */}
      <div className="lp-page-header">
        <div className="lp-page-header-title">
          <h2>
            {leadsScope === 'own' ? 'My Leads' :
              leadsScope === 'team' ? 'Team Leads' :
                'Leads'}
          </h2>
          <p>
            {leadsScope === 'own' ? 'Leads you have created.' :
              leadsScope === 'team' ? 'Leads created by your team members.' :
                'Real-time overview of all customer inquiries.'}
          </p>
        </div>
        <div className="lp-page-header-actions">
          {canExport && (
            <button className="button secondary" onClick={handleExport} title="Export CSV">
              <Download size={15} /> Export CSV
            </button>
          )}
          {canCreate && (
            <button className="button primary"
              onClick={() => window.dispatchEvent(new Event('open-lead-modal'))}>
              <PlusCircle size={15} /> Capture New Lead
            </button>
          )}
        </div>
      </div>

      {/* ── Follow-ups bar ── */}
      <div className="lp-fu-bar">
        {/* Follow-ups label + count — acts as a "tab" with blue underline */}
        <button
          className="lp-fu-tab-item lp-fu-tab-item--label"
          onClick={() => setFuDrawerOpen(true)}
        >
          <Bell size={13} />
          <span>Follow-ups</span>
          {visibleEvents.length > 0 && (
            <span className="lp-fu-tab-badge">{visibleEvents.length}</span>
          )}
        </button>

        {/* Divider */}
        <span className="lp-fu-sep" />

        {/* Date filter tabs */}
        {[
          { key: 'today', label: 'Today' },
          { key: 'tomorrow', label: 'Tomorrow' },
          { key: 'week', label: 'This Week' },
          { key: 'custom', label: 'Custom' },
        ].map((tab, i, arr) => (
          <Fragment key={tab.key}>
            <button
              className={`lp-fu-tab-item${fuFilter === tab.key ? ' lp-fu-tab-item--active' : ''}`}
              onClick={e => {
                e.stopPropagation();
                setFuFilter(tab.key);
                setShowCustom(tab.key === 'custom');
                setEventsDone({});
                setFuDrawerOpen(true);
              }}
            >
              {tab.label}
            </button>
            {i < arr.length - 1 && <span className="lp-fu-sep" />}
          </Fragment>
        ))}

        {/* Right: View all */}
        <button className="lp-fu-viewall" onClick={() => setFuDrawerOpen(true)}>
          View all →
        </button>
      </div>

      {/* ── Follow-ups Drawer ── */}
      <AnimatePresence>
        {fuDrawerOpen && (
          <>
            <motion.div
              className="lp-fu-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setFuDrawerOpen(false)}
            />
            <motion.div
              className="lp-fu-drawer"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            >
              {/* Drawer header */}
              <div className="lp-fu-drawer-hdr">
                <div className="lp-fu-drawer-title">
                  <Bell size={16} style={{ color: '#ef4444' }} />
                  <span>
                    {fuFilter === 'today' && "Today's Follow-ups"}
                    {fuFilter === 'tomorrow' && "Tomorrow's Follow-ups"}
                    {fuFilter === 'week' && "This Week's Follow-ups"}
                    {fuFilter === 'custom' && "Custom Follow-ups"}
                  </span>
                  {visibleEvents.length > 0 && <span className="lp-fu-badge">{visibleEvents.length}</span>}
                </div>
                <button className="lp-modal-close" onClick={() => setFuDrawerOpen(false)}><X size={18} /></button>
              </div>

              {/* Date + filter tabs row */}
              <div className="lp-fu-drawer-meta">
                <span className="lp-fu-drawer-date-inline">
                  {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
                <div className="lp-fu-tabs">
                  {[
                    { key: 'today', label: 'Today' },
                    { key: 'tomorrow', label: 'Tomorrow' },
                    { key: 'week', label: 'This Week' },
                    { key: 'custom', label: '📅 Custom' },
                  ].map(tab => (
                    <button
                      key={tab.key}
                      className={`lp-fu-tab${fuFilter === tab.key ? ' lp-fu-tab--active' : ''}`}
                      onClick={() => { setFuFilter(tab.key); setShowCustom(tab.key === 'custom'); setEventsDone({}); }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom date picker */}
              {showCustom && (
                <div className="lp-fu-custom-row">
                  <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="lp-fu-date-input" />
                  <span className="lp-fu-date-sep">→</span>
                  <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="lp-fu-date-input" />
                  <button onClick={applyCustomFilter} className="lp-fu-apply-btn">Apply</button>
                </div>
              )}

              {/* Drawer list */}
              <div className="lp-fu-drawer-list">
                {fuLoading ? (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                    Loading follow-ups…
                  </div>
                ) : visibleEvents.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted)', fontSize: 13 }}>
                    {fuFilter === 'today' && 'All caught up — no pending follow-ups for today!'}
                    {fuFilter === 'tomorrow' && 'No follow-ups scheduled for tomorrow.'}
                    {fuFilter === 'week' && 'No follow-ups for this week.'}
                    {fuFilter === 'custom' && 'No follow-ups found for the selected date range.'}
                  </div>
                ) : null}
                {!fuLoading && visibleEvents.map(ev => {
                  const evStatusObj = statusList.find(s => s.name === ev.lead_current_status);
                  const isEvLocked = !!evStatusObj?.is_locked || ev.lead_current_status === 'Appointment Scheduled' || ev.lead_current_status === 'Appointment Completed';
                  const cfg = getStatusCfg(ev.lead_current_status);
                  const initials = (ev.lead_name || ev.lead_mobile || '?').charAt(0).toUpperCase();
                  const _today = new Date(); const _localToday = `${_today.getFullYear()}-${String(_today.getMonth() + 1).padStart(2, '0')}-${String(_today.getDate()).padStart(2, '0')}`;
                  const isOverdue = ev.due_date && ev.due_date < _localToday && !isEvLocked;

                  // Context message shown below the lead name
                  // is_team_followup  → manager seeing a team member's follow-up
                  // assigned_to_name  → lead is assigned to someone
                  const contextMsg = ev.is_team_followup
                    ? `Follow-up reminder for ${ev.assigned_to_name || 'a team member'}'s lead`
                    : ev.assigned_to_name
                      ? `Assigned to: ${ev.assigned_to_name} · Need to follow up this lead`
                      : null;

                  return (
                    <div key={ev.id} className="lp-fu-drawer-row"
                      onClick={() => { setFuDrawerOpen(false); closedRef.current = false; setViewId(ev.lead_id); }}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="lp-fu-avatar" style={{ background: cfg.bg, color: cfg.color, width: 38, height: 38, fontSize: 15 }}>
                        {initials}
                      </div>
                      <div className="lp-fu-info" style={{ flex: 1 }}>
                        <div className="lp-fu-name">{ev.lead_name || ev.lead_mobile}</div>
                        {ev.lead_name && <div className="lp-fu-meta" style={{ marginBottom: 4 }}>{ev.lead_mobile}</div>}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span className="lp-fu-status" style={{ background: cfg.bg, color: cfg.color }}>
                            {ev.lead_current_status}
                          </span>
                          {isOverdue && <span className="lp-fu-overdue">Overdue</span>}
                        </div>
                        {contextMsg && (
                          <div className="lp-fu-meta" style={{ marginTop: 4, fontStyle: 'italic', color: ev.is_team_followup ? '#7c3aed' : 'var(--text-muted)' }}>
                            {contextMsg}
                          </div>
                        )}
                        {ev.note && <div className="lp-fu-meta" style={{ marginTop: 2 }}>{ev.note}</div>}
                      </div>
                      {!isEvLocked && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <button className="lp-fu-done-btn" onClick={e => { e.stopPropagation(); markEventDone(ev.id); }}>
                            <CheckCircle2 size={13} /> Done
                          </button>
                          <button
                            style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1.5px solid #2563eb', background: 'transparent', color: '#2563eb', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                            onClick={e => { e.stopPropagation(); setRescheduleEvent({ id: ev.id, lead_id: ev.lead_id, lead_status: ev.lead_current_status }); }}
                          >
                            Reschedule
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Analytics Panels Row (side by side) ── */}
      {false && (showStageVelocity || showCompliancePanel) && (
        <div className="lp-panels-row">

          {/* ── Stage Velocity Panel ── */}
          {showStageVelocity && stageStats.length > 0 && (
            <div className="lp-velocity-wrap">
              <button className="lp-velocity-toggle" onClick={() => setShowVelocity(v => !v)}>
                <div className="lp-velocity-toggle-icon"><Clock size={13} /></div>
                <div className="lp-velocity-toggle-text">
                  <span className="lp-velocity-title">Stage Velocity</span>
                  <span className="lp-velocity-sub">{stageStats.length} stage{stageStats.length !== 1 ? 's' : ''} tracked</span>
                </div>
                <ChevronDown size={14} className={`lp-velocity-chevron${showVelocity ? ' lp-velocity-chevron--open' : ''}`} />
              </button>
              {showVelocity && (() => {
                const maxSec = Math.max(...stageStats.map(s => s.avg_seconds));
                return (
                  <div className="lp-velocity-body">
                    {stageStats.map(s => (
                      <div key={s.status} className="lp-velocity-row">
                        <div className="lp-velocity-label">{s.status}</div>
                        <div className="lp-velocity-bar-wrap">
                          <div className="lp-velocity-bar"
                            style={{ width: `${Math.max(4, (s.avg_seconds / maxSec) * 100)}%` }} />
                        </div>
                        <div className="lp-velocity-val">{formatDuration(s.avg_seconds)}</div>
                        <div className="lp-velocity-n">n={s.sample_count}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── Follow-up Compliance Panel ── */}
          {showCompliancePanel && compliance && compliance.summary.total_due > 0 && (() => {

            const { summary, by_agent } = compliance;
            const rate = summary.rate;
            const rateColor = rate === null ? '#64748b' : rate >= 80 ? '#16a34a' : rate >= 50 ? '#d97706' : '#dc2626';
            return (
              <div className="lp-velocity-wrap">
                <button className="lp-velocity-toggle" onClick={() => setShowCompliance(v => !v)}>
                  <div className="lp-velocity-toggle-icon" style={{ background: rateColor + '15', color: rateColor }}><Bell size={13} /></div>
                  <div className="lp-velocity-toggle-text">
                    <span className="lp-velocity-title">Follow-up Compliance</span>
                    <span className="lp-velocity-sub">{summary.total_due} follow-up{summary.total_due !== 1 ? 's' : ''} due</span>
                  </div>
                  {rate !== null && (
                    <span className="lp-comply-rate-pill" style={{ background: rateColor + '18', color: rateColor }}>
                      {rate}%
                    </span>
                  )}
                  <ChevronDown size={14} className={`lp-velocity-chevron${showCompliance ? ' lp-velocity-chevron--open' : ''}`} />
                </button>
                {showCompliance && (
                  <div className="lp-velocity-body">
                    {/* Summary row */}
                    <div className="lp-comply-summary">
                      <div className="lp-comply-kpi" style={{ color: '#16a34a' }}>
                        <span className="lp-comply-kpi-n">{summary.on_time}</span>
                        <span className="lp-comply-kpi-l">On-time</span>
                      </div>
                      <div className="lp-comply-kpi" style={{ color: '#d97706' }}>
                        <span className="lp-comply-kpi-n">{summary.late}</span>
                        <span className="lp-comply-kpi-l">Late</span>
                      </div>
                      <div className="lp-comply-kpi" style={{ color: '#dc2626' }}>
                        <span className="lp-comply-kpi-n">{summary.missed}</span>
                        <span className="lp-comply-kpi-l">Missed</span>
                      </div>
                      {/* Stacked bar */}
                      <div className="lp-comply-bar-wrap">
                        {summary.on_time > 0 && (
                          <div className="lp-comply-bar-seg" title={`On-time: ${summary.on_time}`}
                            style={{ flex: summary.on_time, background: '#16a34a' }} />
                        )}
                        {summary.late > 0 && (
                          <div className="lp-comply-bar-seg" title={`Late: ${summary.late}`}
                            style={{ flex: summary.late, background: '#d97706' }} />
                        )}
                        {summary.missed > 0 && (
                          <div className="lp-comply-bar-seg" title={`Missed: ${summary.missed}`}
                            style={{ flex: summary.missed, background: '#dc2626' }} />
                        )}
                      </div>
                    </div>

                    {/* Per-agent table */}
                    {by_agent.length > 1 && (
                      <table className="lp-comply-table">
                        <thead>
                          <tr>
                            <th>Agent</th>
                            <th className="lp-comply-th-r">On-time</th>
                            <th className="lp-comply-th-r">Late</th>
                            <th className="lp-comply-th-r">Missed</th>
                            <th className="lp-comply-th-r">Rate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {by_agent.map(a => {
                            const aColor = a.rate === null ? '#64748b' : a.rate >= 80 ? '#16a34a' : a.rate >= 50 ? '#d97706' : '#dc2626';
                            return (
                              <tr key={a.agent_name}>
                                <td className="lp-comply-agent">{a.agent_name}</td>
                                <td className="lp-comply-td-r" style={{ color: '#16a34a' }}>{a.on_time}</td>
                                <td className="lp-comply-td-r" style={{ color: '#d97706' }}>{a.late}</td>
                                <td className="lp-comply-td-r" style={{ color: '#dc2626' }}>{a.missed}</td>
                                <td className="lp-comply-td-r">
                                  {a.rate !== null
                                    ? <span className="lp-comply-rate-pill" style={{ background: aColor + '18', color: aColor }}>{a.rate}%</span>
                                    : <span className="lp-muted">—</span>
                                  }
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

        </div>
      )}

      <div className="card lp-table-card">

        {/* ── Filters ── */}
        <div className="lp-filters">
          {/* Row 1: search + creator + advanced toggle */}
          <div className="lp-filter-top">
            <div className="lp-search">
              <Search size={14} className="lp-search-icon" />
              <input placeholder="Search by name or mobile…"
                autoComplete="off"
                data-form-type="other"
                readOnly
                onFocus={e => e.target.removeAttribute('readonly')}
                value={search} onChange={e => setSearch(e.target.value)} />
              {search && <button className="lp-clear-btn" onClick={() => setSearch('')}><X size={12} /></button>}
            </div>

            {/* Status multi-select dropdown */}
            <div className="lp-status-dd-wrap" ref={statusDDRef}>
              <button
                className={`lp-status-dd-btn${statusFilters.length > 0 ? ' lp-status-dd-btn--active' : ''}`}
                onClick={() => setStatusDDOpen(v => !v)}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusFilters.length > 0 ? 'var(--primary)' : 'var(--text-muted)', display: 'inline-block', flexShrink: 0 }} />
                {statusFilters.length === 0
                  ? 'All Statuses'
                  : statusFilters.length === 1
                    ? statusFilters[0]
                    : `${statusFilters.length} statuses`}
                <ChevronDown size={13} style={{ marginLeft: 'auto', opacity: 0.5 }} />
              </button>
              {statusDDOpen && (
                <div className="lp-status-dd-menu">
                  <div className="lp-status-dd-header">
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Filter by Status</span>
                    {statusFilters.length > 0 && (
                      <button className="lp-status-dd-clear" onClick={() => setStatusFilters([])}>Clear all</button>
                    )}
                  </div>
                  {/* New Lead option (null status) */}
                  {(() => {
                    const checked = statusFilters.includes('__new__');
                    return (
                      <label className={`lp-status-dd-item${checked ? ' lp-status-dd-item--checked' : ''}`}>
                        <input type="checkbox" checked={checked} onChange={() =>
                          setStatusFilters(prev => checked ? prev.filter(x => x !== '__new__') : [...prev, '__new__'])
                        } />
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#0ea5e9', flexShrink: 0 }} />
                        <span className="lp-status-dd-name">New Lead</span>
                        {newLeadCount > 0 && <span className="lp-status-dd-count">{newLeadCount}</span>}
                      </label>
                    );
                  })()}
                  {statusList.map(s => {
                    const checked = statusFilters.includes(s.name);
                    return (
                      <label key={s.id} className={`lp-status-dd-item${checked ? ' lp-status-dd-item--checked' : ''}`}>
                        <input type="checkbox" checked={checked} onChange={() =>
                          setStatusFilters(prev => checked ? prev.filter(x => x !== s.name) : [...prev, s.name])
                        } />
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                        <span className="lp-status-dd-name">{s.name}</span>
                        {counts[s.name] ? <span className="lp-status-dd-count">{counts[s.name]}</span> : null}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Source filter */}
            <div className="lp-creator-wrap">
              <Tag size={13} className="lp-creator-icon" />
              <select className="lp-creator-select" value={fSource} onChange={e => setFSource(e.target.value)}>
                <option value="">All Sources</option>
                {leadSources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <ChevronDown size={13} className="lp-creator-caret" />
              {fSource && <button className="lp-creator-clear" onClick={() => setFSource('')}><X size={11} /></button>}
            </div>

            {assignees.length > 0 && (
              <div className="lp-creator-wrap">
                <UserCheck size={13} className="lp-creator-icon" />
                <select className="lp-creator-select" value={createdByFilter} onChange={e => setCreatedByFilter(e.target.value)}>
                  <option value="">All assignees</option>
                  <option value="unassigned">Unassigned</option>
                  {assignees.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <ChevronDown size={13} className="lp-creator-caret" />
                {createdByFilter && <button className="lp-creator-clear" onClick={() => setCreatedByFilter('')}><X size={11} /></button>}
              </div>
            )}

            {creators.length > 0 && (
              <div className="lp-creator-wrap">
                <User size={13} className="lp-creator-icon" />
                <select className="lp-creator-select" value={creatorFilter} onChange={e => setCreatorFilter(e.target.value)}>
                  <option value="">All creators</option>
                  {creators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ChevronDown size={13} className="lp-creator-caret" />
                {creatorFilter && <button className="lp-creator-clear" onClick={() => setCreatorFilter('')}><X size={11} /></button>}
              </div>
            )}

            <button
              className={`lp-adv-btn${showAdv ? ' lp-adv-btn--on' : ''}${advCount > 0 ? ' lp-adv-btn--active' : ''}`}
              onClick={() => setShowAdv(v => !v)}
            >
              <SlidersHorizontal size={14} />
              Filters
              {advCount > 0 && <span className="lp-adv-count">{advCount}</span>}
            </button>

            {advCount > 0 && (
              <button className="lp-clear-all-btn" onClick={clearAdvanced}>
                <X size={12} /> Clear filters
              </button>
            )}
          </div>

          {/* Advanced filter panel */}
          {showAdv && (
            <div className="lp-adv-panel">
              {/* Date */}
              <div className="lp-adv-section">
                <div className="lp-adv-section-label"><Calendar size={12} /> Date Range</div>
                <div className="lp-adv-row">
                  <div className="lp-adv-field">
                    <label>From</label>
                    <input type="date" className="lp-adv-input" value={dateFrom}
                      max={dateTo || undefined}
                      onChange={e => setDateFrom(e.target.value)} />
                  </div>
                  <div className="lp-adv-field">
                    <label>To</label>
                    <input type="date" className="lp-adv-input" value={dateTo}
                      min={dateFrom || undefined}
                      onChange={e => setDateTo(e.target.value)} />
                  </div>
                </div>
              </div>

              {/* Location */}
              <div className="lp-adv-section">
                <div className="lp-adv-section-label"><MapPin size={12} /> Location</div>
                <div className="lp-adv-row">
                  <div className="lp-adv-field">
                    <label>State</label>
                    <select className="lp-adv-input" value={fState} onChange={e => setFState(e.target.value)}>
                      <option value="">All states</option>
                      {states.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="lp-adv-field">
                    <label>City</label>
                    <select className="lp-adv-input" value={fCity} onChange={e => setFCity(e.target.value)} disabled={!fState}>
                      <option value="">All cities</option>
                      {advCities.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="lp-adv-field">
                    <label>Area</label>
                    <select className="lp-adv-input" value={fArea} onChange={e => setFArea(e.target.value)} disabled={!fCity}>
                      <option value="">All areas</option>
                      {advAreas.map(a => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Vehicle */}
              <div className="lp-adv-section">
                <div className="lp-adv-section-label"><Car size={12} /> Vehicle</div>
                <div className="lp-adv-row">
                  <div className="lp-adv-field">
                    <label>Type</label>
                    <select className="lp-adv-input" value={fVType} onChange={e => setFVType(e.target.value)}>
                      <option value="">All types</option>
                      {vTypes.map(v => <option key={v.id} value={String(v.id)}>{v.name}</option>)}
                    </select>
                  </div>
                  <div className="lp-adv-field">
                    <label>Make</label>
                    <select className="lp-adv-input" value={fMake} onChange={e => setFMake(e.target.value)} disabled={!fVType}>
                      <option value="">All makes</option>
                      {advMakes.map(m => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
                    </select>
                  </div>
                  <div className="lp-adv-field">
                    <label>Model</label>
                    <select className="lp-adv-input" value={fModel} onChange={e => setFModel(e.target.value)} disabled={!fMake}>
                      <option value="">All models</option>
                      {advModels.map(m => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Active filter tags */}
          {(advCount > 0 || statusFilters.length > 0) && (
            <div className="lp-active-tags">
              {statusFilters.map(name => {
                const isNew = name === '__new__';
                const s = isNew ? null : statusList.find(x => x.name === name);
                const color = isNew ? '#0369a1' : s?.color;
                return <span key={name} className="lp-active-tag" style={{ borderColor: color }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: isNew ? '#0ea5e9' : s?.color, display: 'inline-block', flexShrink: 0 }} />
                  {isNew ? 'New Lead' : name}
                  <button onClick={() => setStatusFilters(prev => prev.filter(x => x !== name))}><X size={10} /></button>
                </span>;
              })}
              {(dateFrom || dateTo) && <span className="lp-active-tag"><Calendar size={10} />{dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : dateFrom ? `From ${dateFrom}` : `Until ${dateTo}`}<button onClick={() => { setDateFrom(''); setDateTo(''); }}><X size={10} /></button></span>}
              {stateName && <span className="lp-active-tag"><MapPin size={10} />{stateName}<button onClick={() => setFState('')}><X size={10} /></button></span>}
              {cityName && <span className="lp-active-tag">{cityName}<button onClick={() => setFCity('')}><X size={10} /></button></span>}
              {areaName && <span className="lp-active-tag">{areaName}<button onClick={() => setFArea('')}><X size={10} /></button></span>}
              {vtypeName && <span className="lp-active-tag"><Car size={10} />{vtypeName}<button onClick={() => setFVType('')}><X size={10} /></button></span>}
              {makeName && <span className="lp-active-tag">{makeName}<button onClick={() => setFMake('')}><X size={10} /></button></span>}
              {modelName && <span className="lp-active-tag">{modelName}<button onClick={() => setFModel('')}><X size={10} /></button></span>}
              {fSource && <span className="lp-active-tag"><Tag size={10} />{fSource}<button onClick={() => setFSource('')}><X size={10} /></button></span>}
            </div>
          )}
        </div>

        {/* ── Bulk action bar ── */}
        {selectedLeads.size > 0 && (
          <div className="lp-bulk-bar">
            <span className="lp-bulk-count">
              {selectedLeads.size} selected
            </span>
            <div className="lp-bulk-actions">
              {/* Assign To */}
              <div style={{ position: 'relative' }}>
                <button className="lp-bulk-btn" onClick={() => setBulkAssignOpen(o => !o)}>
                  <UserCheck size={14} /> Assign To <ChevronDown size={12} />
                </button>
                {bulkAssignOpen && (
                  <div className="lp-bulk-dropdown">
                    {agentsList.map(a => (
                      <button key={a.id} className="lp-bulk-dd-opt"
                        onClick={async () => {
                          setBulkAssigning(true); setBulkAssignOpen(false);
                          try {
                            const result = await api('/api/leads/bulk-assign', {
                              method: 'POST',
                              body: { lead_ids: [...selectedLeads], assigned_to: a.id },
                            });
                            setLeads(prev => prev.map(l =>
                              selectedLeads.has(l.id) && !l.is_converted ? { ...l, assigned_to: a.id, assigned_to_name: a.name } : l
                            ));
                            setSelectedLeads(new Set());
                            if (result.skipped_converted > 0) {
                              showToast(`${result.updated} lead${result.updated !== 1 ? 's' : ''} assigned to ${a.name}. ${result.skipped_converted} converted lead${result.skipped_converted !== 1 ? 's' : ''} skipped (locked).`, 'warning');
                            } else {
                              showToast(`${result.updated} lead${result.updated !== 1 ? 's' : ''} assigned to ${a.name}`);
                            }
                          } catch (e) { showToast(e.message, 'error'); }
                          finally { setBulkAssigning(false); }
                        }}>
                        {(() => {
                          const av = getAvatarStyle(a.name); return (
                            <span className="lp-bulk-dd-avatar" style={{ background: av.bg, color: av.color }}>
                              {a.name.charAt(0).toUpperCase()}
                            </span>
                          );
                        })()}
                        {a.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {bulkAssigning && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Assigning…</span>}

              {/* Delete */}
              {!bulkDeleteConfirm ? (
                <button
                  className="lp-bulk-btn lp-bulk-btn--danger"
                  onClick={() => setBulkDeleteConfirm(true)}
                  disabled={bulkDeleting}
                >
                  <Trash2 size={14} /> Delete
                </button>
              ) : (
                <span className="lp-bulk-confirm">
                  <span style={{ fontSize: 12, color: 'var(--danger, #ef4444)' }}>
                    Delete {selectedLeads.size} lead{selectedLeads.size > 1 ? 's' : ''}?
                  </span>
                  <button
                    className="lp-bulk-btn lp-bulk-btn--danger"
                    disabled={bulkDeleting}
                    onClick={async () => {
                      setBulkDeleting(true);
                      try {
                        await api('/api/leads/bulk-delete', {
                          method: 'POST',
                          body: { lead_ids: [...selectedLeads] },
                        });
                        const count = selectedLeads.size;
                        setLeads(prev => prev.filter(l => !selectedLeads.has(l.id)));
                        setSelectedLeads(new Set());
                        setBulkDeleteConfirm(false);
                        showToast(`${count} lead${count > 1 ? 's' : ''} deleted`);
                      } catch (e) {
                        showToast(e.message, 'error');
                      } finally {
                        setBulkDeleting(false);
                      }
                    }}
                  >
                    {bulkDeleting ? 'Deleting…' : 'Yes, delete'}
                  </button>
                  <button
                    className="lp-bulk-btn"
                    onClick={() => setBulkDeleteConfirm(false)}
                    disabled={bulkDeleting}
                  >
                    Cancel
                  </button>
                </span>
              )}
            </div>
            <button className="lp-bulk-clear" onClick={() => { setSelectedLeads(new Set()); setBulkDeleteConfirm(false); }}>
              Clear selection
            </button>
          </div>
        )}

        {/* ── Desktop table ── */}
        <div className="lp-table-wrap">
          <table className="data-table lp-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox" className="lp-chk"
                    checked={selectedLeads.size > 0 && paginated.every(l => selectedLeads.has(l.id))}
                    ref={el => { if (el) el.indeterminate = selectedLeads.size > 0 && !paginated.every(l => selectedLeads.has(l.id)); }}
                    onChange={e => {
                      if (e.target.checked) setSelectedLeads(new Set(paginated.map(l => l.id)));
                      else setSelectedLeads(new Set());
                    }} />
                </th>
                <th style={{ fontWeight: 700, fontSize: '12px' }}><div className="th-cell">Date</div></th>
                <th style={{ fontWeight: 700, fontSize: '12px' }}><div className="th-cell">Customer</div></th>
                <th style={{ fontWeight: 700, fontSize: '12px' }}><div className="th-cell">Location</div></th>
                <th style={{ fontWeight: 700, fontSize: '12px' }}><div className="th-cell">Vehicle</div></th>
                <th style={{ fontWeight: 700, fontSize: '12px' }}><div className="th-cell">Service</div></th>
                <th style={{ fontWeight: 700, fontSize: '12px' }}>Status</th>
                <th style={{ fontWeight: 700, fontSize: '12px' }}><div className="th-cell">Assign To</div></th>
                <th style={{ fontWeight: 700, fontSize: '12px' }}><div className="th-cell">Next Follow-up</div></th>
                <th style={{ fontWeight: 700, fontSize: '12px' }}><div className="th-cell">Created By</div></th>
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {loading && leads.length === 0 ? (
                <tr><td colSpan="9" className="lp-empty">Loading leads…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan="9" className="lp-empty">
                  {leads.length === 0 ? 'No leads yet. Capture your first lead!' : 'No leads match your filters.'}
                </td></tr>
              ) : paginated.map(l => (
                <tr key={l.id} className={`lp-row${selectedLeads.has(l.id) ? ' lp-row--selected' : ''}`} onClick={() => openLead(l)}>
                  <td onClick={e => e.stopPropagation()}>
                    <input type="checkbox" className="lp-chk"
                      checked={selectedLeads.has(l.id)}
                      onChange={e => {
                        const next = new Set(selectedLeads);
                        e.target.checked ? next.add(l.id) : next.delete(l.id);
                        setSelectedLeads(next);
                      }} />
                  </td>
                  <td>
                    <div className="lp-date-cell">
                      <span className="lp-date-day">{new Date(l.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                      <span className="lp-date-time">{new Date(l.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </td>
                  <td>
                    <div className="lp-customer-row">
                      <div className="lp-customer">
                        <strong>{l.name || <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>—</span>}</strong>
                        <span>{l.mobile}</span>
                        <div className="lp-contact-btns" onClick={e => e.stopPropagation()}>
                          <a className="lp-contact-btn lp-contact-btn--call" href={`tel:${l.mobile}`} title="Call"><Phone size={12} /></a>
                          <a className="lp-contact-btn lp-contact-btn--wa"
                            href={`https://wa.me/${(l.whatsapp || l.mobile).replace(/\D/g, '')}`}
                            target="_blank" rel="noreferrer" title="WhatsApp"><MessageCircle size={12} /></a>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {l.area_name || l.city_name ? (
                      <div className="lp-meta">
                        <span>{l.area_name || l.city_name}</span>
                        {l.area_name && <span className="lp-sub">{l.city_name}</span>}
                      </div>
                    ) : <span className="lp-muted">—</span>}
                  </td>
                  <td>
                    {l.make_name || l.model_name ? (
                      <div className="lp-meta">
                        <span>{[l.make_name, l.model_name].filter(Boolean).join(' ')}</span>
                        {l.vehicle_type_name && <span className="lp-sub">{l.vehicle_type_name}</span>}
                      </div>
                    ) : l.vehicle_type_name ? (
                      <span className="lp-sub">{l.vehicle_type_name}</span>
                    ) : <span className="lp-muted">—</span>}
                  </td>
                  {/* Service column */}
                  <td>
                    {l.first_category_name ? (
                      <div className="lp-meta">
                        <span>{l.first_category_name}</span>
                        {l.first_service_name && <span className="lp-sub">{l.first_service_name}</span>}
                        {l.service_count > 1 && <span className="lp-svc-more">+{l.service_count - 1} more</span>}
                      </div>
                    ) : l.first_cat_interest_name ? (
                      <div className="lp-meta">
                        <span>{l.first_cat_interest_name}</span>
                      </div>
                    ) : <span className="lp-muted">—</span>}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    {canEdit && !l.is_converted
                      ? <StatusInlineSelect leadId={l.id} leadName={l.name || l.mobile} current={l.status} statusList={statusList}
                        onChange={updated => setLeads(prev => prev.map(x => x.id === l.id ? { ...x, ...updated } : x))}
                        onOpenConvert={setPageConvertModal} />
                      : <StatusBadge status={l.status} statusList={statusList} />
                    }
                    {l.is_converted && (
                      <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 3,
                        background: '#ecfdf5', color: '#059669', border: '1.5px solid #6ee7b7',
                        borderRadius: 20, padding: '2px 8px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap'
                      }}>
                        <CheckCircle2 size={10} /> Converted to Appt.
                      </div>
                    )}
                    {l.lost_reason && l.status?.toLowerCase().includes('lost') && (
                      <div className="lp-lost-reason-sub">{l.lost_reason}</div>
                    )}
                  </td>
                  {/* Assign To column */}
                  <td>
                    {l.assigned_to_name ? (
                      <div className="lp-created-by">
                        <span>{l.assigned_to_name}</span>
                      </div>
                    ) : <span className="lp-muted">—</span>}
                  </td>
                  {/* Next Follow-up column */}
                  <td>
                    {l.next_follow_up_date && !l.is_converted && !statusList.find(s => s.name === l.status)?.is_locked ? (() => {
                      const d = new Date(l.next_follow_up_date);
                      const today = new Date(); today.setHours(0, 0, 0, 0);
                      const diff = Math.round((d - today) / 86400000);
                      const isOverdue = diff < 0;
                      const isToday = diff === 0;
                      const isTomorrow = diff === 1;
                      const label = isOverdue ? 'Overdue'
                        : isToday ? 'Today'
                          : isTomorrow ? 'Tomorrow'
                            : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
                      const color = isOverdue ? '#dc2626' : isToday ? '#d97706' : '#16a34a';
                      const bg = isOverdue ? '#fee2e2' : isToday ? '#fef3c7' : '#dcfce7';
                      return (
                        <span className="lp-followup-badge" style={{ background: bg, color }}>
                          {isOverdue && '⚠ '}{label}
                        </span>
                      );
                    })() : <span className="lp-muted">—</span>}
                  </td>
                  {/* Created By column */}
                  <td>
                    {l.created_by_name ? (
                      <div className="lp-created-by">
                        <span>{l.created_by_name}</span>
                      </div>
                    ) : <span className="lp-muted">—</span>}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <ActionMenu lead={l} canEdit={canEdit} canDelete={canDelete}
                      onView={l => openLead(l)}
                      onEdit={l => setEditLead(l)}
                      onDelete={l => setDeleteLead(l)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Mobile card list ── */}
        <div className="lp-mobile-list">
          {loading && leads.length === 0 && (
            <div className="lp-empty">Loading leads…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="lp-empty">
              {leads.length === 0 ? 'No leads yet. Capture your first lead!' : 'No leads match your filters.'}
            </div>
          )}
          {paginated.map(l => (
            <div key={l.id} className="lp-mobile-card" onClick={() => openLead(l)}>
              <div className="lp-mc-top">
                <div className="lp-mc-customer">
                  <div className="lp-mc-name">{l.name || <span className="lp-muted">No name</span>}</div>
                  <div className="lp-mc-mobile">{l.mobile}</div>
                  <div className="lp-mc-actions" onClick={e => e.stopPropagation()}>
                    <a className="lp-mc-action-btn lp-mc-action-btn--call"
                      href={`tel:${l.mobile}`} title="Call">
                      <Phone size={13} /> Call
                    </a>
                    <a className="lp-mc-action-btn lp-mc-action-btn--wa"
                      href={`https://wa.me/${(l.whatsapp || l.mobile).replace(/\D/g, '')}`}
                      target="_blank" rel="noreferrer" title="WhatsApp">
                      <MessageCircle size={13} /> WhatsApp
                    </a>
                  </div>
                </div>
                <div className="lp-mc-right" onClick={e => e.stopPropagation()}>
                  {canEdit && !l.is_converted
                    ? <StatusInlineSelect leadId={l.id} leadName={l.name || l.mobile} current={l.status} statusList={statusList}
                      onChange={updated => setLeads(prev => prev.map(x => x.id === l.id ? { ...x, ...updated } : x))}
                      onOpenConvert={setPageConvertModal} />
                    : <StatusBadge status={l.status} statusList={statusList} />
                  }
                  {l.is_converted && (
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 3,
                      background: '#ecfdf5', color: '#059669', border: '1.5px solid #6ee7b7',
                      borderRadius: 20, padding: '2px 8px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap'
                    }}>
                      <CheckCircle2 size={10} /> Converted to Appt.
                    </div>
                  )}
                  {l.lost_reason && l.status?.toLowerCase().includes('lost') && (
                    <div className="lp-lost-reason-sub">{l.lost_reason}</div>
                  )}
                </div>
              </div>
              <div className="lp-mc-meta">
                {(l.area_name || l.city_name) && (
                  <span className="lp-mc-tag"><MapPin size={11} />{[l.area_name, l.city_name].filter(Boolean).join(', ')}</span>
                )}
                {(l.make_name || l.model_name) && (
                  <span className="lp-mc-tag"><Car size={11} />{[l.make_name, l.model_name].filter(Boolean).join(' ')}</span>
                )}
                {l.vehicle_type_name && !l.make_name && (
                  <span className="lp-mc-tag"><Car size={11} />{l.vehicle_type_name}</span>
                )}
              </div>
              <div className="lp-mc-footer">
                <span className="lp-mc-date">
                  <Calendar size={11} />
                  {new Date(l.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
                {Number(l.total_price) > 0 && (
                  <span className="lp-mc-value">₹{Number(l.total_price).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                )}
                <span className="lp-mc-by">{l.created_by_name || '—'}</span>
                {l.assigned_to_name && (
                  <span className="lp-mc-assigned"><UserCheck size={10} /> {l.assigned_to_name}</span>
                )}
                <div onClick={e => e.stopPropagation()}>
                  <ActionMenu lead={l} canEdit={canEdit} canDelete={canDelete}
                    onView={l => openLead(l)}
                    onEdit={l => setEditLead(l)}
                    onDelete={l => setDeleteLead(l)} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Pagination footer ── */}
        {filtered.length > 0 && (
          <div className="lp-pagination-bar">
            {/* Left: count info */}
            <span className="lp-pg-info">
              Showing <strong>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)}</strong> of <strong>{filtered.length}</strong> lead{filtered.length !== 1 ? 's' : ''}
              {totalValue > 0 && (
                <span className="lp-pg-value"><IndianRupee size={11} />{totalValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              )}
            </span>

            {/* Right: page controls + size selector */}
            <div className="lp-pg-right">
              {totalPages > 1 && (
                <div className="lp-pg-controls">
                  <button className="lp-pg-btn" disabled={page === 1} onClick={() => setPage(1)} title="First">«</button>
                  <button className="lp-pg-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)} title="Previous">‹</button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                    .reduce((acc, p, idx, arr) => {
                      if (idx > 0 && p - arr[idx - 1] > 1) acc.push('…');
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((p, idx) =>
                      p === '…'
                        ? <span key={`ellipsis-${idx}`} className="lp-pg-ellipsis">…</span>
                        : <button key={p} className={`lp-pg-btn lp-pg-btn--num${page === p ? ' lp-pg-btn--active' : ''}`}
                          onClick={() => setPage(p)}>{p}</button>
                    )}
                  <button className="lp-pg-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)} title="Next">›</button>
                  <button className="lp-pg-btn" disabled={page === totalPages} onClick={() => setPage(totalPages)} title="Last">»</button>
                </div>
              )}

              {/* Page size dropdown */}
              <div className="lp-pg-size">
                <select
                  className="lp-pg-size-select"
                  value={pageSize}
                  onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                >
                  {[10, 20, 50, 100].map(n => (
                    <option key={n} value={n}>{n} / page</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {viewId && (
        <ViewLeadModal leadId={viewId} canEdit={canEdit} statusList={statusList}
          onLeadLoaded={handleLeadLoaded}
          onClose={closeLead}
          onEdit={l => { closeLead(); setEditLead(l); }} />
      )}
      {editLead && (
        <EditLeadModal lead={editLead} statusList={statusList} leadSources={leadSources}
          onClose={() => setEditLead(null)}
          onSaved={handleEditSaved}
          onOpenConvert={setPageConvertModal} />
      )}
      {deleteLead && (
        <DeleteModal lead={deleteLead}
          onClose={() => setDeleteLead(null)}
          onConfirm={() => handleDelete(deleteLead)} />
      )}
    </div>
  );
}

