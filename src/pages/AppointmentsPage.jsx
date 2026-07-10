import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth, useCan } from '../auth/AuthContext.jsx';
import PaginationBar from '../components/PaginationBar.jsx';
import {
  Calendar, Search, Eye, X, AlertCircle, CheckCircle2,
  ChevronLeft, ChevronRight, Clock, Car, Bike, Network,
  User, Phone, MapPin, Wrench, IndianRupee, ChevronDown,
  FileText, MessageCircle, Plus, Pencil, Filter,
} from 'lucide-react';
import '../styles/AppointmentsPage.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtTime(v) {
  if (!v) return '';
  const t = String(v).slice(0, 5);
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function getScheduleTag(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  const target = new Date(dateStr);
  const d1 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const d2 = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const diffTime = d2.getTime() - d1.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return { text: 'Today', bg: '#ecfdf4', color: '#166534' };
  if (diffDays === 1) return { text: 'Tomorrow', bg: '#eff6ff', color: '#1e40af' };
  return null;
}

function StatusBadge({ name, color, bg }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
      background: bg || '#f3f4f6', color: color || '#6b7280', whiteSpace: 'nowrap',
    }}>{name || '—'}</span>
  );
}

function getStatusCfg(statusId, statusList) {
  return statusList.find(s => s.id === statusId) || null;
}

// ── Status inline selector ────────────────────────────────────────────────────
// Fix #16: separate chip selection from free-text details so they don't clobber each other
function CancelReasonModal({ statusName, onConfirm, onCancel }) {
  const [chip, setChip] = useState('');   // one of REASONS or ''
  const [details, setDetails] = useState('');   // optional extra text
  const [err, setErr] = useState('');
  const REASONS = ['Customer no-show', 'Customer request', 'Vehicle issue', 'Hub unavailable', 'Rescheduled', 'Other'];

  function handleConfirm() {
    const base = chip;
    if (!base) { setErr('Please select a reason'); return; }
    if (base === 'Other' && !details.trim()) { setErr('Please describe the reason'); return; }
    const final = base === 'Other'
      ? details.trim()
      : details.trim() ? `${base}: ${details.trim()}` : base;
    onConfirm(final);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}>
      <div style={{ background: 'var(--bg)', borderRadius: 14, padding: 24, width: '100%', maxWidth: 380, boxShadow: '0 16px 48px rgba(0,0,0,.2)' }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Cancellation Reason</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>Why is this appointment being cancelled?</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
          {REASONS.map(r => (
            <button key={r} type="button"
              onClick={() => { setChip(r); setErr(''); }}
              style={{ padding: '5px 12px', borderRadius: 20, border: `1.5px solid ${chip === r ? '#dc2626' : 'var(--border)'}`, background: chip === r ? '#fef2f2' : 'var(--bg)', color: chip === r ? '#dc2626' : 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {r}
            </button>
          ))}
        </div>
        <textarea
          rows={2}
          placeholder={chip === 'Other' ? 'Describe the reason…' : 'Add details (optional)…'}
          value={details}
          onChange={e => { setDetails(e.target.value); setErr(''); }}
          style={{ width: '100%', padding: '8px 10px', border: `1.5px solid ${err ? '#dc2626' : 'var(--border)'}`, borderRadius: 8, fontSize: 13, resize: 'vertical', fontFamily: 'inherit', color: 'var(--text)', background: 'var(--bg)', boxSizing: 'border-box' }}
        />
        {err && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onCancel} style={{ padding: '8px 16px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Back</button>
          <button onClick={handleConfirm}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Confirm Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ApptStatusSelect({
  apptId, current, statusList, onChange, pickupRequired,
  pickupTimestamp, estimateStatus, invoiceStatus, invoiceId,
  showToast,
}) {
  const canEdit = useCan('EDIT_APPOINTMENT');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const [pendingStatus, setPendingStatus] = useState(null);
  const [blockMsg, setBlockMsg] = useState('');   // inline error message
  const btnRef = useRef(null);
  const dropRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function close(e) {
      if (dropRef.current && !dropRef.current.contains(e.target) &&
        btnRef.current && !btnRef.current.contains(e.target)) {
        setOpen(false); setBlockMsg('');
      }
    }
    function closeOnScroll(e) {
      if (dropRef.current && dropRef.current.contains(e.target)) return;
      setOpen(false); setBlockMsg('');
    }
    document.addEventListener('mousedown', close);
    document.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [open]);

  function openDrop() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const itemCount = statusList.filter(s => !['vehicle-picked', 'at-workshop'].includes(s.slug) || pickupRequired).length;
      const dropHeight = itemCount * 36 + 12; // approx height
      const spaceBelow = window.innerHeight - r.bottom;
      const openUpward = spaceBelow < dropHeight + 8 && r.top > dropHeight;
      const width = Math.max(r.width, 220);
      // Clamp so the panel never overflows the right/left edge of the screen
      // (on mobile the status button sits near the right edge of the card).
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      setPos({
        left,
        width,
        top: openUpward ? undefined : r.bottom + 4,
        bottom: openUpward ? window.innerHeight - r.top + 4 : undefined,
      });
    }
    setBlockMsg('');
    setOpen(o => !o);
  }

  // ── Prerequisite checker ─────────────────────────────────────────────────
  // Returns: { ok: true } | { ok: false, message } | { ok: false, redirect, state }
  function checkPrerequisite(slug) {
    // estimate helper flags
    const estExists = !!estimateStatus;
    const estSubmitted = estExists && ['pending_company_review', 'approved', 'customer_approved', 'revision_requested', 'work_in_progress', 'work_completed'].includes(estimateStatus);
    const estApproved = estExists && ['approved', 'customer_approved', 'work_in_progress', 'work_completed'].includes(estimateStatus);
    // invoice helper flags
    const invExists = !!invoiceId;
    const invApproved = invExists && ['approved', 'partially_paid', 'paid'].includes(invoiceStatus);
    const invPaid = invExists && ['paid'].includes(invoiceStatus);

    switch (slug) {
      // ── Pickup flow ──
      case 'at-workshop':
        if (!pickupTimestamp)
          return { ok: false, message: 'Mark the vehicle as picked up first before moving to At Workshop.' };
        break;

      // ── Estimate flow ──
      case 'estimate-created':
        if (!estExists)
          return { ok: false, redirect: '/estimates', state: { createForAppointmentId: apptId } };
        break;

      case 'estimate-submitted':
        if (!estExists)
          return { ok: false, message: 'No estimate exists yet. Create and submit the estimate first.' };
        if (!estSubmitted)
          return { ok: false, message: 'Estimate exists but has not been submitted yet. Submit the estimate first.' };
        break;

      case 'estimate-approved':
        if (!estExists)
          return { ok: false, message: 'No estimate exists yet. Create, submit, and get it approved first.' };
        if (!estSubmitted)
          return { ok: false, message: 'Estimate has not been submitted yet. Submit it for approval first.' };
        if (!estApproved)
          return { ok: false, message: 'Estimate is submitted but not yet approved. Get it approved first.' };
        break;

      // ── Work flow ──
      case 'work-in-progress':
        if (!estApproved && !['work_in_progress', 'work_completed'].includes(estimateStatus))
          return { ok: false, message: 'Estimate must be approved before work can begin.' };
        if (!estimateStatus || !['fully_approved', 'partially_approved', 'work_in_progress', 'work_completed'].includes(estimateStatus))
          return { ok: false, message: 'Estimate must be approved before work can begin.' };
        if (estimateStatus === 'work_completed')
          return { ok: false, message: 'All work items are already completed.' };
        break;

      case 'work-completed':
        if (!estimateStatus || estimateStatus !== 'work_completed')
          return { ok: false, message: 'Work is not fully completed yet. Mark all work items as completed in the estimate first.' };
        break;

      // ── Invoice flow ──
      case 'invoice-generated':
        if (!invExists)
          return { ok: false, message: 'No invoice exists yet. Generate an invoice from the estimate first.' };
        break;

      case 'invoice-approved':
        if (!invExists)
          return { ok: false, message: 'No invoice exists yet. Generate and approve the invoice first.' };
        if (!invApproved)
          return { ok: false, message: 'Invoice exists but has not been approved yet. Approve the invoice first.' };
        break;

      case 'invoice-paid':
        if (!invPaid)
          return { ok: false, message: 'Please pay the invoice first.' };
        break;

      case 'ready-for-delivery':
        if (!invPaid)
          return { ok: false, message: 'Please pay the invoice first before marking the vehicle as Ready for Delivery.' };
        break;

      case 'closed':
        if (!invPaid)
          return { ok: false, message: 'Please pay the invoice first before closing the appointment.' };
        break;

      default:
        break;
    }
    return { ok: true };
  }

  async function applyStatus(status, cancellationReason) {
    setBusy(true);
    try {
      const body = { status_id: status.id };
      if (cancellationReason) body.cancellation_reason = cancellationReason;
      const r = await api(`/api/appointments/${apptId}`, { method: 'PATCH', body });
      onChange(r.item);
    } catch (e) {
      console.error('[ApptStatusSelect]', e.message);
      if (showToast) {
        showToast(e.message, 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  function pick(status) {
    if (status.id === current?.id) { setOpen(false); return; }

    // Cancellation — intercept for reason modal
    if (status.name?.toLowerCase().includes('cancel')) {
      setOpen(false); setBlockMsg('');
      setPendingStatus(status);
      return;
    }

    // Prerequisite check
    const check = checkPrerequisite(status.slug);
    if (!check.ok) {
      if (check.redirect) {
        setOpen(false); setBlockMsg('');
        navigate(check.redirect, { state: check.state });
      } else {
        setOpen(false);
        setBlockMsg('');
        if (showToast) {
          showToast(check.message, 'error');
        }
      }
      return;
    }

    setOpen(false); setBlockMsg('');
    applyStatus(status, null);
  }

  const cfg = current || { name: 'Unknown', color: '#6b7280', bg_color: '#f3f4f6' };

  return (
    <>
      {pendingStatus && (
        <CancelReasonModal
          statusName={pendingStatus.name}
          onConfirm={reason => { applyStatus(pendingStatus, reason); setPendingStatus(null); }}
          onCancel={() => setPendingStatus(null)}
        />
      )}
      <button
        ref={btnRef}
        className="appt-status-btn"
        style={{ background: cfg.bg_color, color: cfg.color, opacity: (busy || !canEdit) ? .6 : 1, cursor: canEdit ? 'pointer' : 'default' }}
        onClick={canEdit ? openDrop : undefined}
        disabled={busy || !canEdit}
      >
        {busy ? '…' : cfg.name || '—'}
        <ChevronDown size={10} />
      </button>
      {open && (
        <div ref={dropRef} className="appt-status-drop"
          style={{ top: pos.top, bottom: pos.bottom, left: pos.left, minWidth: pos.width }}>
          {blockMsg && (
            <div style={{
              padding: '8px 12px', fontSize: 12, color: '#dc2626',
              background: '#fef2f2', borderBottom: '1px solid #fecaca',
              display: 'flex', alignItems: 'flex-start', gap: 6,
            }}>
              <span style={{ flexShrink: 0, marginTop: 1 }}>⚠️</span>
              <span>{blockMsg}</span>
            </div>
          )}
          {statusList
            .filter(s => !['vehicle-picked', 'at-workshop'].includes(s.slug) || pickupRequired)
            .map(s => (
              <div key={s.id}
                className={`appt-status-opt${s.id === current?.id ? ' appt-status-opt--active' : ''}`}
                onClick={() => pick(s)}>
                <span className="appt-status-dot" style={{ background: s.color }} />
                {s.name}
              </div>
            ))}
        </div>
      )}
    </>
  );
}

// ── Reschedule Modal ──────────────────────────────────────────────────────────
const RESCHEDULE_REASONS = [
  'Customer Requested Reschedule',
  'Customer Did Not Answer the Phone',
  'Workshop Unavailable',
  'Price Negotiation Pending',
  'Customer Approval Pending',
  'Resource Unavailable',
  'Parts Availability Issue',
  'Scheduling Conflict',
  'Operational Delay',
  'Other Reason',
];

function RescheduleModal({ appt, onConfirm, onCancel }) {
  const [form, setForm] = useState({
    scheduled_date: appt.scheduled_date?.slice(0, 10) || '',
    scheduled_time: appt.scheduled_time?.slice(0, 5) || '',
    reschedule_reason: '',
    reschedule_notes: '',
  });
  const [err, setErr] = useState('');

  function handleSubmit() {
    if (!form.scheduled_date) { setErr('Please select a new date.'); return; }
    if (!form.reschedule_reason) { setErr('Please select a reason.'); return; }
    setErr('');
    onConfirm(form);
  }

  return createPortal(
    <div className="appt-backdrop" style={{ zIndex: 1200 }} onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="appt-view-modal" style={{ maxWidth: 480 }} onMouseDown={e => e.stopPropagation()}>
        <div className="apptv-hdr" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="apptv-hdr-title" style={{ fontSize: 15 }}>Reschedule Appointment #{appt.id}</span>
          <button className="apptv-close-btn" onClick={onCancel}>✕</button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Date + Time row */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                New Date <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <input type="date" className="apptv-input" style={{ width: '100%' }}
                value={form.scheduled_date}
                onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                New Time
              </label>
              <input type="time" className="apptv-input" style={{ width: '100%' }}
                value={form.scheduled_time}
                onChange={e => setForm(f => ({ ...f, scheduled_time: e.target.value }))} />
            </div>
          </div>

          {/* Reason dropdown */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
              Reason for Rescheduling <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <select className="apptv-input" style={{ width: '100%' }}
              value={form.reschedule_reason}
              onChange={e => setForm(f => ({ ...f, reschedule_reason: e.target.value }))}>
              <option value="">— Select a reason —</option>
              {RESCHEDULE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
              Notes <span style={{ fontSize: 11, fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea className="apptv-input" style={{ width: '100%', minHeight: 80, resize: 'vertical' }}
              placeholder="Any additional context…"
              value={form.reschedule_notes}
              onChange={e => setForm(f => ({ ...f, reschedule_notes: e.target.value }))} />
          </div>

          {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button className="apptv-cancel-btn" onClick={onCancel}>Cancel</button>
            <button className="apptv-save-btn" onClick={handleSubmit}>Confirm Reschedule</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── View Modal ────────────────────────────────────────────────────────────────
function ViewModal({ appt: apptProp, statusList, onClose, onUpdated, onEdit }) {
  const navigate = useNavigate();
  const canEditAppt = useCan('EDIT_APPOINTMENT');
  const canCreateInv = useCan('CREATE_INVOICE');

  // Full record with services — fetched on open so services always show
  const [appt, setAppt] = useState(apptProp);
  const [svcLoading, setSvcLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setSvcLoading(true);
    api(`/api/appointments/${apptProp.id}`)
      .then(r => {
        if (!cancelled) {
          setAppt(r.item);
          setSvcLoading(false);
        }
      })
      .catch(() => { if (!cancelled) setSvcLoading(false); });
    return () => { cancelled = true; };
  }, [apptProp.id]);

  // When parent pushes an update (e.g. status change), merge it in
  useEffect(() => { setAppt(apptProp); }, [apptProp]);

  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [pickupBusy, setPickupBusy] = useState(false);

  const currentSlug = statusList.find(s => s.id === appt.status_id)?.slug || '';

  async function doPickupAction(endpoint) {
    setPickupBusy(true);
    try {
      const r = await api(`/api/appointments/${appt.id}/${endpoint}`, { method: 'POST' });
      setAppt(r.item);
      onUpdated(r.item);
    } catch (e) {
      setErr(e.message || 'Action failed');
    } finally {
      setPickupBusy(false);
    }
  }

  const status = statusList.find(s => s.id === appt.status_id);

  async function saveReschedule(formData) {
    setSaving(true); setErr('');
    try {
      const r = await api(`/api/appointments/${appt.id}`, {
        method: 'PATCH',
        body: {
          scheduled_date: formData.scheduled_date,
          scheduled_time: formData.scheduled_time || null,
          reschedule_reason: formData.reschedule_reason,
          reschedule_notes: formData.reschedule_notes || null,
        },
      });
      setAppt(r.item);
      onUpdated(r.item);
      setShowRescheduleModal(false);
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  const is2W = appt.vehicle_type_name?.toLowerCase().includes('two') || appt.vehicle_type_name?.toLowerCase().includes('2');

  return (
    <div className="appt-backdrop" onClick={onClose}>
      <div className="appt-view-modal" onClick={e => e.stopPropagation()}>

        {/* ── Minimal Header ── */}
        <div className="apptv-hdr">
          <div className="apptv-hdr-left">
            <span className="apptv-hdr-title">Appointment #{appt.id}</span>
            {appt.lead_id && <span className="apptv-lead-chip">Lead #{appt.lead_id}</span>}
            {status && <StatusBadge name={status.name} color={status.color} bg={status.bg_color} />}
          </div>
          <div className="apptv-hdr-right">
            <a href={`https://wa.me/91${(appt.whatsapp || appt.mobile || '').replace(/\D/g, '')}`}
              target="_blank" rel="noreferrer" className="apptv-wa-btn" title="WhatsApp customer">
              <MessageCircle size={13} />
            </a>
            <button className="appt-icon-btn" onClick={onClose}><X size={15} /></button>
          </div>
        </div>

        <div className="apptv-body">

          {/* ── Customer ── */}
          <div className="apptv-row apptv-row--border">
            <div className="apptv-cust-avatar">
              {(appt.customer_name || appt.mobile || '?')[0].toUpperCase()}
            </div>
            <div className="apptv-cust-info">
              <div className="apptv-cust-name">{appt.customer_name || 'Unknown'}</div>
              <div className="apptv-cust-sub">
                <Phone size={10} /> {appt.mobile}
                {appt.whatsapp && appt.whatsapp !== appt.mobile && (
                  <span style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <MessageCircle size={10} /> {appt.whatsapp}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ── Vehicle ── */}
          <div className="apptv-row apptv-row--border">
            <div className="apptv-row-icon"><Car size={13} /></div>
            <div style={{ flex: 1 }}>
              {appt.vehicle_number && (
                <div className="apptv-plate">{appt.vehicle_number}</div>
              )}
              <div className="apptv-chips-row">
                {appt.vehicle_type_name && <span className="apptv-chip apptv-chip--type">{appt.vehicle_type_name}</span>}
                {(appt.make_name || appt.model_name) && (
                  <span className="apptv-chip apptv-chip--model">
                    {[appt.make_name, appt.model_name].filter(Boolean).join(' ')}
                  </span>
                )}
                {is2W
                  ? appt.cc_category_name && <span className="apptv-chip apptv-chip--cc">{appt.cc_category_name}</span>
                  : <>
                    {appt.body_type_name && <span className="apptv-chip apptv-chip--body">{appt.body_type_name}</span>}
                    {appt.segment_names?.length > 0 && appt.segment_names.map(s => (
                      <span key={s} className="apptv-chip apptv-chip--seg">{s}</span>
                    ))}
                  </>
                }
              </div>
            </div>
          </div>

          {/* ── Scheduled section ── */}
          <div className="apptv-sched-section">
            <div className="apptv-sched-top">
              <div className="apptv-sched-header">
                <span className="apptv-meta-lbl"><Clock size={10} /> {appt.reschedule_reason ? 'Appointment' : 'Scheduled'}</span>
                {canEditAppt && (
                  <button className="apptv-resch-btn" onClick={() => setShowRescheduleModal(true)}>
                    <Calendar size={11} /> Reschedule
                  </button>
                )}
              </div>

              {/* Rescheduled: show original vs new in 2 columns */}
              {appt.reschedule_reason ? (
                <>
                  <div className="apptv-resch-dates">
                    <div className="apptv-resch-date-box apptv-resch-date-box--original">
                      <div className="apptv-resch-date-lbl"><Calendar size={11} /> Original Appointment</div>
                      <div className="apptv-resch-date-val">{fmtDate(appt.original_scheduled_date) || '—'}</div>
                      {appt.original_scheduled_time && (
                        <div className="apptv-resch-date-time">{fmtTime(appt.original_scheduled_time)}</div>
                      )}
                    </div>
                    <div className="apptv-resch-dates-divider" />
                    <div className="apptv-resch-date-box">
                      <div className="apptv-resch-date-lbl"><Calendar size={11} /> New Appointment</div>
                      <div className="apptv-resch-date-val apptv-resch-date-val--new">{fmtDate(appt.scheduled_date)}</div>
                      {appt.scheduled_time && (
                        <div className="apptv-resch-date-time">{fmtTime(appt.scheduled_time)}</div>
                      )}
                    </div>
                  </div>
                  <div className="apptv-resch-meta">
                    <div className="apptv-resch-meta-box">
                      <div className="apptv-resch-date-lbl"><Calendar size={11} /> Reschedule Reason</div>
                      <div className="apptv-resch-reason">{appt.reschedule_reason}</div>
                      {appt.reschedule_notes && (
                        <div className="apptv-resch-notes">"{appt.reschedule_notes}"</div>
                      )}
                    </div>
                    <div className="apptv-resch-meta-box">
                      <div className="apptv-resch-date-lbl"><User size={11} /> Rescheduled By</div>
                      <div className="apptv-resch-by-name">{appt.rescheduled_by_name || '—'}</div>
                      {appt.rescheduled_at && (
                        <div className="apptv-resch-by-time">
                          <Clock size={10} /> {fmtDate(appt.rescheduled_at)} · {fmtTime(appt.rescheduled_at)}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                /* Not rescheduled: simple date + time */
                <div className="apptv-sched-datetime">
                  <span className="apptv-sched-date">{fmtDate(appt.scheduled_date)}</span>
                  {appt.scheduled_time && (
                    <>
                      <span className="apptv-sched-divider" />
                      <span className="apptv-sched-time">{fmtTime(appt.scheduled_time)}</span>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="apptv-sched-sub">
              <div className="apptv-sched-sub-item">
                <div className="apptv-sched-sub-lbl"><Network size={10} /> Hub</div>
                <div className="apptv-sched-sub-val">{appt.hub_name || '—'}</div>
              </div>
              <div className="apptv-sched-sub-item">
                <div className="apptv-sched-sub-lbl"><User size={10} /> Assigned to</div>
                <div className="apptv-sched-sub-val" style={!appt.assigned_to_name ? { color: 'var(--text-muted)', fontWeight: 400 } : {}}>
                  {appt.assigned_to_name || '—'}
                </div>
              </div>
            </div>
          </div>

          {/* ── Reschedule modal ── */}
          {showRescheduleModal && (
            <RescheduleModal
              appt={appt}
              onConfirm={saveReschedule}
              onCancel={() => setShowRescheduleModal(false)}
            />
          )}

          {/* ── Services ── */}
          {(svcLoading || appt.services?.length > 0 || Number(appt.total_price) > 0) && (
            <div className="apptv-svc-section">
              <div className="apptv-svc-header">
                <Wrench size={12} />
                <span>Services</span>
                {!svcLoading && appt.services?.length > 0 && (
                  <span className="apptv-svc-count">{appt.services.length}</span>
                )}
              </div>
              {svcLoading ? (
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {[1, 2].map(i => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                      <div className="appt-skel" style={{ height: 13, borderRadius: 5, flex: 1 }} />
                      <div className="appt-skel" style={{ height: 13, borderRadius: 5, width: 60 }} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="apptv-svc-list">
                  {(appt.services || []).map((s, i) => (
                    <div key={s.id || i} className="apptv-svc-row">
                      <div className="apptv-svc-num">{i + 1}</div>
                      <div className="apptv-svc-left">
                        <span className="apptv-svc-name">{s.service_name}</span>
                        {s.category_name && (
                          <span className="apptv-svc-cat">{s.category_name}</span>
                        )}
                      </div>
                      <span className="apptv-svc-price">₹{Number(s.price).toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                  <div className="apptv-total-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <IndianRupee size={13} />
                      <span>Total Estimate</span>
                    </div>
                    <span>₹{Number(appt.total_price).toLocaleString('en-IN')}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Pickup & Drop ── */}
          {(appt.pickup_required || appt.drop_required) && (
            <div className="apptv-row apptv-row--border" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
              {appt.pickup_required && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="apptv-pickup-badge"><MapPin size={10} /> Pickup Required</span>
                    {appt.pickup_scheduled_date && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
                        Scheduled: {fmtDate(appt.pickup_scheduled_date)}{appt.pickup_scheduled_time ? ` at ${fmtTime(appt.pickup_scheduled_time)}` : ''}
                      </span>
                    )}
                  </div>
                  {(appt.pickup_address_line1 || appt.pickup_city) && (
                    <p className="apptv-notes" style={{ margin: 0 }}>
                      {[appt.pickup_address_line1, appt.pickup_address_line2, appt.pickup_city, appt.pickup_pincode].filter(Boolean).join(', ')}
                    </p>
                  )}
                  {appt.pickup_maps_link && (
                    <a href={appt.pickup_maps_link} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 12, color: '#0891b2', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <MapPin size={11} /> View on Google Maps
                    </a>
                  )}
                  {appt.pickup_timestamp && (
                    <div style={{ fontSize: 12, color: '#0f766e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <CheckCircle2 size={12} /> Picked up · {new Date(appt.pickup_timestamp).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                  {canEditAppt && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {currentSlug === 'scheduled' && (
                        <button className="btn btn-primary" disabled={pickupBusy} onClick={() => doPickupAction('vehicle-picked')} style={{ fontSize: 12, padding: '6px 14px' }}>
                          🚗 {pickupBusy ? 'Saving…' : 'Mark Vehicle Picked Up'}
                        </button>
                      )}
                      {currentSlug === 'vehicle-picked' && (
                        <button className="btn btn-primary" disabled={pickupBusy} onClick={() => doPickupAction('at-workshop')} style={{ fontSize: 12, padding: '6px 14px' }}>
                          🔧 {pickupBusy ? 'Saving…' : 'Mark Arrived at Workshop'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {appt.drop_required && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="apptv-pickup-badge" style={{ background: '#ede9fe', color: '#6b21a8' }}><MapPin size={10} /> Drop Required</span>
                  {(appt.drop_address_line1 || appt.drop_city) && (
                    <p className="apptv-notes" style={{ margin: 0 }}>
                      {[appt.drop_address_line1, appt.drop_address_line2, appt.drop_city, appt.drop_pincode].filter(Boolean).join(', ')}
                    </p>
                  )}
                  {appt.drop_maps_link && (
                    <a href={appt.drop_maps_link} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 12, color: '#7c3aed', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <MapPin size={11} /> View on Google Maps
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Cancellation reason ── */}
          {appt.cancellation_reason && (
            <div className="apptv-row apptv-row--cancel">
              <span style={{ fontSize: 12, color: '#991b1b', fontWeight: 600 }}>⛔ {appt.cancellation_reason}</span>
            </div>
          )}

          {/* ── Notes ── */}
          {appt.notes && (
            <div className="apptv-row apptv-row--border" style={{ flexDirection: 'column', gap: 4 }}>
              <span className="apptv-meta-lbl">Notes</span>
              <p className="apptv-notes" style={{ margin: 0 }}>{appt.notes}</p>
            </div>
          )}

          <div className="apptv-created">
            Created {fmtDate(appt.created_at)}{appt.created_by_name && ` · ${appt.created_by_name}`}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="apptv-ftr">
          <button className="apptv-close-btn" onClick={onClose}>Close</button>
          <div style={{ display: 'flex', gap: 8 }}>
            {canEditAppt && (
              <button className="apptv-edit-btn" onClick={() => onEdit(appt)}>
                Edit
              </button>
            )}
            {appt.estimate_id ? (
              <button
                className="apptv-inv-btn"
                onClick={() => { onClose(); navigate('/estimates', { state: { highlightId: appt.estimate_id } }); }}
              >
                <FileText size={13} /> View Estimate #{appt.estimate_id}
              </button>
            ) : (
              <button
                className="apptv-inv-btn"
                onClick={() => { onClose(); navigate('/estimates', { state: { createForAppointmentId: appt.id } }); }}
              >
                <FileText size={13} /> Create Estimate
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Mini searchable select (for vehicle form dropdowns) ───────────────────────
// ── LocSelect: searchable dropdown (select only, no add new) ─────────────────
function LocSelect({ value, onChange, options, placeholder = 'Select…', disabled = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  const selected = options.find(o => String(o.id) === String(value));
  const filtered = options.filter(o => o.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" disabled={disabled}
        className="ca-input"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'left', opacity: disabled ? 0.6 : 1 }}
        onClick={() => { if (!disabled) { setOpen(o => !o); setQuery(''); } }}>
        <span style={{ color: selected ? 'var(--text)' : 'var(--text-muted)', fontSize: 13 }}>{selected ? selected.name : placeholder}</span>
        <ChevronDown size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      </button>
      {open && (
        <div style={{ position: 'absolute', zIndex: 200, top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--bg)', border: '1.5px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 6 }}>
          <input autoFocus className="ca-input" style={{ marginBottom: 6, fontSize: 12 }}
            placeholder="Search…" value={query}
            onChange={e => setQuery(e.target.value)} />
          <div style={{ maxHeight: 160, overflowY: 'auto' }}>
            {value && (
              <button type="button" style={{ width: '100%', textAlign: 'left', padding: '6px 10px', fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6 }}
                onClick={() => { onChange(''); setOpen(false); setQuery(''); }}>
                ✕ Clear
              </button>
            )}
            {filtered.map(o => (
              <button type="button" key={o.id}
                style={{ width: '100%', textAlign: 'left', padding: '7px 10px', fontSize: 13, borderRadius: 6, background: String(o.id) === String(value) ? 'rgba(22,185,148,0.12)' : 'none', border: 'none', cursor: 'pointer', color: String(o.id) === String(value) ? 'var(--primary)' : 'var(--text)', fontWeight: String(o.id) === String(value) ? 600 : 400 }}
                onClick={() => { onChange(o.id); setOpen(false); setQuery(''); }}>
                {o.name}
              </button>
            ))}
            {filtered.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '7px 10px' }}>No results</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniSearchSelect({ value, onChange, options, placeholder = 'Select…', disabled = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    function h(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const filtered = options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()));
  const selected = options.find(o => String(o.value) === String(value));

  function pick(o) { onChange(o.value); setOpen(false); setQuery(''); }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" disabled={disabled}
        onClick={() => !disabled && setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', borderRadius: 8, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
          background: disabled ? 'var(--bg-soft,#f8fafc)' : 'var(--bg)',
          border: open ? '1.5px solid var(--primary)' : '1.5px solid var(--border)',
          color: selected ? 'var(--text)' : 'var(--text-muted)', outline: 'none',
          opacity: disabled ? 0.6 : 1,
        }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.label : placeholder}
        </span>
        <svg width="11" height="11" viewBox="0 0 12 12" style={{ flexShrink: 0, marginLeft: 6, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0, zIndex: 9999, background: 'var(--bg)', border: '1.5px solid var(--border)', borderRadius: 9, boxShadow: '0 6px 20px rgba(0,0,0,.12)', overflow: 'hidden' }}>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search…"
              style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12, width: '100%', color: 'var(--text)' }} />
          </div>
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            {filtered.length === 0
              ? <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>No results</div>
              : filtered.map((o, i) => (
                <button key={o.value !== null && o.value !== undefined ? String(o.value) : `fallback-${i}`} type="button" onClick={() => pick(o)}
                  style={{ width: '100%', textAlign: 'left', padding: '8px 12px', background: String(o.value) === String(value) ? 'rgba(22,185,148,0.10)' : 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, color: String(o.value) === String(value) ? 'var(--primary)' : 'var(--text)', fontWeight: String(o.value) === String(value) ? 700 : 400 }}
                  onMouseEnter={e => { if (String(o.value) !== String(value)) e.currentTarget.style.background = 'var(--bg-soft,#f8fafc)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = String(o.value) === String(value) ? 'rgba(22,185,148,0.10)' : 'transparent'; }}>
                  {o.label}
                </button>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Edit Appointment Modal  (single-page form, pre-filled)
// ═════════════════════════════════════════════════════════════════════════════
function EditAppointmentModal({ appt, hubs, onClose, onSaved }) {
  // ── Form state, pre-filled from appt ─────────────────────────────────────
  const [form, setForm] = useState({
    customer_name: appt.customer_name || '',
    mobile: appt.mobile || '',
    whatsapp: appt.whatsapp || '',
    vehicle_number: appt.vehicle_number || '',
    vehicle_type_id: appt.vehicle_type_id ? String(appt.vehicle_type_id) : '',
    make_id: appt.make_id ? String(appt.make_id) : '',
    model_id: appt.model_id ? String(appt.model_id) : '',
    body_type_id: appt.body_type_id ? String(appt.body_type_id) : '',
    segment_ids: appt.segment_ids || [],
    cc_category_id: appt.cc_category_id ? String(appt.cc_category_id) : '',
    hub_id: appt.hub_id ? String(appt.hub_id) : '',
    scheduled_date: appt.scheduled_date?.slice(0, 10) || '',
    scheduled_time: appt.scheduled_time?.slice(0, 5) || '',
    notes: appt.notes || '',
    pickup_required: appt.pickup_required || false,
    pickup_address_line1: appt.pickup_address_line1 || '',
    pickup_address_line2: appt.pickup_address_line2 || '',
    pickup_city: appt.pickup_city || '',
    pickup_pincode: appt.pickup_pincode || '',
    pickup_maps_link: appt.pickup_maps_link || '',
    pickup_scheduled_date: appt.pickup_scheduled_date || '',
    pickup_scheduled_time: appt.pickup_scheduled_time?.slice(0, 5) || '',
    drop_required: appt.drop_required || false,
    drop_address_line1: appt.drop_address_line1 || '',
    drop_address_line2: appt.drop_address_line2 || '',
    drop_city: appt.drop_city || '',
    drop_pincode: appt.drop_pincode || '',
    drop_maps_link: appt.drop_maps_link || '',
  });
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  // ── Lock: customer / vehicle / services are read-only once an estimate exists
  const locked = !!appt.has_estimate;

  // ── Vehicle master data ───────────────────────────────────────────────────
  const [vTypes, setVTypes] = useState([]);
  const [makes, setMakes] = useState([]);
  const [models, setModels] = useState([]);
  const [modelGroups, setModelGroups] = useState([]);
  const [bodyTypes, setBodyTypes] = useState([]);
  const [segments, setSegments] = useState([]);
  const [ccCats, setCcCats] = useState([]);
  const [availableSegs, setAvailableSegs] = useState([]);
  const [availableBodyTypes, setAvailableBodyTypes] = useState([]);
  const [selectedModelName, setSelectedModelName] = useState('');

  // ── Services ──────────────────────────────────────────────────────────────
  const [hubCategories, setHubCategories] = useState([]);
  const [selectedCatId, setSelectedCatId] = useState(null);
  const [svcSearch, setSvcSearch] = useState('');
  const [apptServices, setApptServices] = useState(() =>
    (appt.services || []).map(s => ({
      id: s.service_id, name: s.service_name, price: s.price, category_id: s.category_id,
    }))
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [priceRecalcNotice, setPriceRecalcNotice] = useState(false);

  // ── Load master data + pre-warm cascaded dropdowns on mount ──────────────
  useEffect(() => {
    Promise.all([
      api('/api/vehicles/types'),
      api('/api/vehicles/body-types'),
      api('/api/vehicles/segments'),
      api('/api/cc-categories?limit=100'),
    ]).then(([vt, bt, sg, cc]) => {
      const btItems = bt.items || [];
      const sgItems = sg.items || [];
      setVTypes(vt.items || []);
      setBodyTypes(btItems);
      setSegments(sgItems);
      setCcCats(cc.items || []);

      if (appt.vehicle_type_id) {
        api(`/api/vehicles/makes?type_id=${appt.vehicle_type_id}&limit=500`)
          .then(r => setMakes(r.items || [])).catch(() => { });
      }
      if (appt.make_id) {
        api(`/api/vehicles/models?make_id=${appt.make_id}&limit=500`)
          .then(r => {
            const allRows = r.items || [];
            setModels(allRows);
            const groupMap = new Map();
            for (const m of allRows) {
              if (!groupMap.has(m.name)) groupMap.set(m.name, { name: m.name, firstId: m.id, segmentIds: [], bodyTypeIds: [], ccCategoryIds: [] });
              const g = groupMap.get(m.name);
              if (m.segment_id && !g.segmentIds.includes(m.segment_id)) g.segmentIds.push(m.segment_id);
              if (m.body_type_id && !g.bodyTypeIds.includes(m.body_type_id)) g.bodyTypeIds.push(m.body_type_id);
              if (m.cc_category_id && !g.ccCategoryIds.includes(m.cc_category_id)) g.ccCategoryIds.push(m.cc_category_id);
            }
            const groups = [...groupMap.values()];
            setModelGroups(groups);
            if (appt.model_id) {
              const row = allRows.find(m => m.id === appt.model_id);
              if (row) {
                setSelectedModelName(row.name);
                const grp = groups.find(g => g.name === row.name);
                if (grp) {
                  const filtBT = btItems.filter(b => grp.bodyTypeIds.includes(b.id));
                  const filtSg = sgItems.filter(s => grp.segmentIds.includes(s.id));
                  setAvailableBodyTypes(filtBT);
                  setAvailableSegs(filtSg);
                  // Auto-fill body_type_id if not saved on the appointment and only 1 option
                  if (!appt.body_type_id && filtBT.length === 1) {
                    setForm(p => ({ ...p, body_type_id: String(filtBT[0].id) }));
                  }
                  // Auto-fill cc_category_id if not saved on the appointment and only 1 option
                  if (!appt.cc_category_id && grp.ccCategoryIds?.length === 1) {
                    setForm(p => ({ ...p, cc_category_id: String(grp.ccCategoryIds[0]) }));
                  }
                  // Auto-fill segment_ids: if not saved, try fetching from the customer vehicle record
                  if (!appt.segment_ids || appt.segment_ids.length === 0) {
                    if (filtSg.length === 1) {
                      setForm(p => ({ ...p, segment_ids: [filtSg[0].id] }));
                    } else if (appt.mobile && appt.vehicle_number) {
                      // Fetch customer vehicle to get its stored segment_id
                      api(`/api/customers/${encodeURIComponent(appt.mobile)}/vehicles`)
                        .then(r => {
                          const veh = (r.items || []).find(
                            v => v.vehicle_number?.toUpperCase() === appt.vehicle_number?.toUpperCase()
                          );
                          if (veh?.segment_id) {
                            setForm(p => ({ ...p, segment_ids: [veh.segment_id] }));
                          }
                        }).catch(() => { });
                    }
                  }
                }
              }
            }
          }).catch(() => { });
      }
    }).catch(() => { });

    if (appt.hub_id) loadHubServices(String(appt.hub_id));
  }, []); // eslint-disable-line

  async function loadHubServices(hubId) {
    if (!hubId) { setHubCategories([]); setSelectedCatId(null); return; }
    try {
      const r = await api(`/api/hubs/${hubId}/services`);
      const cats = (r.categories || []).filter(c => c.services.some(s => s.service_mapped));
      const isVeh2W = (form.vehicle_type_id
        ? vTypes.find(t => String(t.id) === String(form.vehicle_type_id))?.name
        : appt.vehicle_type_name
      )?.toLowerCase().match(/two|2w/);
      const vc = isVeh2W ? '2W' : '4W';
      const filtered = cats.map(c => ({
        ...c,
        services: c.services
          .filter(s => s.service_mapped && (s.vehicle_class === vc || s.vehicle_class === 'both'))
          .map(s => ({ ...s, category_id: c.id })),
      })).filter(c => c.services.length > 0);
      setHubCategories(filtered);
      if (filtered.length > 0) setSelectedCatId(filtered[0].id);
    } catch { setHubCategories([]); }
  }

  // ── Vehicle type change ───────────────────────────────────────────────────
  async function onVtChange(vtId) {
    setForm(p => ({ ...p, vehicle_type_id: vtId, make_id: '', model_id: '', body_type_id: '', segment_ids: [], cc_category_id: '' }));
    setMakes([]); setModelGroups([]); setSelectedModelName('');
    setAvailableSegs([]); setAvailableBodyTypes([]);
    if (!vtId) return;
    const r = await api(`/api/vehicles/makes?type_id=${vtId}&limit=500`);
    setMakes(r.items || []);
  }

  async function onMkChange(mkId) {
    setForm(p => ({ ...p, make_id: mkId, model_id: '', body_type_id: '', segment_ids: [] }));
    setModelGroups([]); setSelectedModelName('');
    setAvailableSegs([]); setAvailableBodyTypes([]);
    if (!mkId) return;
    const r = await api(`/api/vehicles/models?make_id=${mkId}&limit=500`);
    const allRows = r.items || [];
    setModels(allRows);
    const groupMap = new Map();
    for (const m of allRows) {
      if (!groupMap.has(m.name)) groupMap.set(m.name, { name: m.name, firstId: m.id, segmentIds: [], bodyTypeIds: [], ccCategoryIds: [] });
      const g = groupMap.get(m.name);
      if (m.segment_id && !g.segmentIds.includes(m.segment_id)) g.segmentIds.push(m.segment_id);
      if (m.body_type_id && !g.bodyTypeIds.includes(m.body_type_id)) g.bodyTypeIds.push(m.body_type_id);
      if (m.cc_category_id && !g.ccCategoryIds.includes(m.cc_category_id)) g.ccCategoryIds.push(m.cc_category_id);
    }
    setModelGroups([...groupMap.values()]);
  }

  function onMdChange(modelName) {
    setSelectedModelName(modelName);
    const grp = modelGroups.find(g => g.name === modelName);
    if (!grp) {
      setForm(p => ({ ...p, model_id: '', body_type_id: '', segment_ids: [] }));
      setAvailableSegs([]); setAvailableBodyTypes([]);
      return;
    }
    const filtBT = bodyTypes.filter(b => grp.bodyTypeIds.includes(b.id));
    const filtSg = segments.filter(s => grp.segmentIds.includes(s.id));
    setAvailableBodyTypes(filtBT);
    setAvailableSegs(filtSg);
    setForm(p => ({
      ...p,
      model_id: String(grp.firstId),
      body_type_id: filtBT.length === 1 ? String(filtBT[0].id) : '',
      segment_ids: [],
      cc_category_id: grp.ccCategoryIds?.length === 1 ? String(grp.ccCategoryIds[0]) : '',
    }));
  }

  const is2W = (() => {
    const vt = vTypes.find(t => String(t.id) === String(form.vehicle_type_id));
    return vt ? /two|2w/i.test(vt.name) : false;
  })();

  // ── Hub change ────────────────────────────────────────────────────────────
  async function onHubChange(hubId) {
    setForm(p => ({ ...p, hub_id: hubId }));
    setApptServices([]);
    await loadHubServices(hubId);
  }

  // ── Pricing lookup ────────────────────────────────────────────────────────
  async function lookupPrice(serviceId, categoryId) {
    const p = new URLSearchParams();
    if (form.vehicle_type_id) p.set('vehicle_type_id', form.vehicle_type_id);
    if (form.make_id) p.set('make_id', form.make_id);
    if (form.model_id) p.set('model_id', form.model_id);
    if (form.body_type_id) p.set('body_type_id', form.body_type_id);
    if (form.cc_category_id) p.set('cc_category_id', form.cc_category_id);
    const seg = form.segment_ids?.[0];
    if (seg) p.set('segment_id', seg);
    try {
      p.set('service_id', serviceId);
      const sr = await api(`/api/pricing/lookup?${p}`);
      if (sr.matched) return parseFloat(sr.price);
      if (categoryId) {
        p.delete('service_id'); p.set('category_id', categoryId);
        const cr = await api(`/api/pricing/lookup?${p}`);
        if (cr.matched) return parseFloat(cr.price);
      }
    } catch { /* silent */ }
    return 0;
  }

  async function toggleService(svc) {
    if (apptServices.some(s => s.id === svc.service_id)) {
      setApptServices(prev => prev.filter(s => s.id !== svc.service_id));
      return;
    }
    const price = await lookupPrice(svc.service_id, svc.category_id);
    setApptServices(prev => [...prev, { id: svc.service_id, name: svc.name, price, category_id: svc.category_id || null }]);
  }

  const pickerServices = (() => {
    if (svcSearch.trim()) {
      const q = svcSearch.toLowerCase();
      return hubCategories.flatMap(c => c.services).filter(s => s.name.toLowerCase().includes(q));
    }
    return hubCategories.find(c => c.id === selectedCatId)?.services || [];
  })();

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!form.customer_name.trim()) { setError('Customer name is required'); return; }
    if (!form.mobile.trim()) { setError('Mobile is required'); return; }
    if (!form.scheduled_date) { setError('Scheduled date is required'); return; }
    if (form.pickup_required && !form.pickup_address_line1.trim()) { setError('Pickup address line 1 is required'); return; }
    if (form.drop_required && !form.drop_address_line1.trim()) { setError('Drop address line 1 is required'); return; }
    setSaving(true); setError(''); setPriceRecalcNotice(false);

    try {
      // ── Detect vehicle field changes ──────────────────────────────────────
      const vehicleChanged = !locked && (
        String(form.vehicle_type_id || '') !== String(appt.vehicle_type_id || '') ||
        String(form.make_id || '') !== String(appt.make_id || '') ||
        String(form.model_id || '') !== String(appt.model_id || '') ||
        String(form.body_type_id || '') !== String(appt.body_type_id || '') ||
        String(form.cc_category_id || '') !== String(appt.cc_category_id || '') ||
        JSON.stringify(form.segment_ids || []) !== JSON.stringify(appt.segment_ids || [])
      );

      // ── Re-lookup prices if vehicle changed and services exist ────────────
      let finalServices = apptServices;
      if (vehicleChanged && apptServices.length > 0) {
        const recalculated = await Promise.all(
          apptServices.map(async s => {
            const newPrice = await lookupPrice(s.id, s.category_id);
            // Keep old price if lookup returns 0 (no rule found)
            return { ...s, price: newPrice > 0 ? newPrice : s.price };
          })
        );
        finalServices = recalculated;
        setPriceRecalcNotice(true);
      }

      // Only send scheduled_date/time if they actually changed — prevents
      // auto-Rescheduled status trigger when only other fields were edited
      const origDate = appt.scheduled_date?.slice(0, 10) || '';
      const origTime = appt.scheduled_time?.slice(0, 5) || '';
      const dateChanged = form.scheduled_date !== origDate;
      const timeChanged = (form.scheduled_time || '') !== origTime;

      const r = await api(`/api/appointments/${appt.id}`, {
        method: 'PATCH',
        body: {
          customer_name: form.customer_name.trim(),
          mobile: form.mobile.trim(),
          whatsapp: form.whatsapp.trim() || null,
          vehicle_number: form.vehicle_number.trim() || null,
          vehicle_type_id: form.vehicle_type_id ? Number(form.vehicle_type_id) : null,
          make_id: form.make_id ? Number(form.make_id) : null,
          model_id: form.model_id ? Number(form.model_id) : null,
          body_type_id: form.body_type_id ? Number(form.body_type_id) : null,
          cc_category_id: form.cc_category_id ? Number(form.cc_category_id) : null,
          segment_ids: form.segment_ids || [],
          hub_id: form.hub_id ? Number(form.hub_id) : null,
          ...(dateChanged ? { scheduled_date: form.scheduled_date } : {}),
          ...(timeChanged ? { scheduled_time: form.scheduled_time || null } : {}),
          notes: form.notes.trim() || null,
          pickup_required: form.pickup_required,
          pickup_address_line1: form.pickup_required ? (form.pickup_address_line1.trim() || null) : null,
          pickup_address_line2: form.pickup_required ? (form.pickup_address_line2.trim() || null) : null,
          pickup_city: form.pickup_required ? (form.pickup_city.trim() || null) : null,
          pickup_pincode: form.pickup_required ? (form.pickup_pincode.trim() || null) : null,
          pickup_maps_link: form.pickup_required ? (form.pickup_maps_link.trim() || null) : null,
          pickup_scheduled_date: form.pickup_required ? (form.pickup_scheduled_date || null) : null,
          pickup_scheduled_time: form.pickup_required ? (form.pickup_scheduled_time || null) : null,
          drop_required: form.drop_required,
          drop_address_line1: form.drop_required ? (form.drop_address_line1.trim() || null) : null,
          drop_address_line2: form.drop_required ? (form.drop_address_line2.trim() || null) : null,
          drop_city: form.drop_required ? (form.drop_city.trim() || null) : null,
          drop_pincode: form.drop_required ? (form.drop_pincode.trim() || null) : null,
          drop_maps_link: form.drop_required ? (form.drop_maps_link.trim() || null) : null,
          services: finalServices.map(s => ({ service_id: s.id, category_id: s.category_id, price: s.price })),
        },
      });
      onSaved(r.item);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="appt-backdrop" onClick={onClose}>
      <div className="ea-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="ea-hdr">
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>Edit Appointment #{appt.id}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Update any appointment details below</div>
          </div>
          <button className="appt-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="ea-body">

          {/* ── Lock banner ── */}
          {locked && (
            <div className="ea-lock-banner">
              <AlertCircle size={14} style={{ flexShrink: 0 }} />
              <div>
                <strong>Estimate linked</strong> — Customer, vehicle and service details are locked.
                Only scheduling details (hub, date, time, notes, pickup) can be changed.{' '}
                <button
                  type="button"
                  onClick={() => { onClose(); }}
                  style={{ background: 'none', border: 'none', padding: 0, color: '#92400e', fontWeight: 700, cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}
                >
                  View Estimate #{appt.estimate_id}
                </button>
              </div>
            </div>
          )}

          {/* ── Customer ── */}
          <div className={`ea-section${locked ? ' ea-section--locked' : ''}`}>
            <div className="ea-sec-title">
              <User size={11} /> Customer
              {locked && <span className="ea-lock-chip">🔒 Locked</span>}
            </div>
            <div className="ea-grid">
              <div className="ea-field">
                <label>Name</label>
                <input className="ea-input" value={form.customer_name} onChange={f('customer_name')} placeholder="Customer name" disabled={locked} />
              </div>
              <div className="ea-field">
                <label>Mobile</label>
                <input className="ea-input" value={form.mobile} onChange={f('mobile')} placeholder="Mobile" disabled={locked} />
              </div>
              <div className="ea-field">
                <label>WhatsApp</label>
                <input className="ea-input" value={form.whatsapp} onChange={f('whatsapp')} placeholder="If different from mobile" disabled={locked} />
              </div>
            </div>
          </div>

          {/* ── Vehicle ── */}
          <div className="ea-section">
            <div className="ea-sec-title">
              <Car size={11} /> Vehicle
              {locked && <span className="ea-lock-chip">🔒 Locked</span>}
            </div>
            <div className="ea-grid">
              <div className="ea-field">
                <label>Reg. Number</label>
                <input className="ea-input ea-mono" value={form.vehicle_number}
                  onChange={e => setForm(p => ({ ...p, vehicle_number: e.target.value.toUpperCase() }))}
                  placeholder="MH01AB1234" disabled={locked} />
              </div>
              <div className="ea-field">
                <label>Type</label>
                <MiniSearchSelect value={form.vehicle_type_id} onChange={onVtChange}
                  options={vTypes.map(t => ({ value: String(t.id), label: t.name }))}
                  placeholder="Vehicle type" disabled={locked} />
              </div>
              <div className="ea-field">
                <label>Make</label>
                <MiniSearchSelect value={form.make_id} onChange={onMkChange}
                  options={makes.map(m => ({ value: String(m.id), label: m.name }))}
                  placeholder={form.vehicle_type_id ? 'Select make…' : 'Select type first'}
                  disabled={locked || !form.vehicle_type_id} />
              </div>
              <div className="ea-field">
                <label>Model</label>
                <MiniSearchSelect value={selectedModelName} onChange={onMdChange}
                  options={modelGroups.map(g => ({ value: g.name, label: g.name }))}
                  placeholder={form.make_id ? 'Select model…' : 'Select make first'}
                  disabled={locked || !form.make_id} />
              </div>
              {is2W ? (
                <div className="ea-field">
                  <label>CC Category</label>
                  <MiniSearchSelect value={form.cc_category_id}
                    onChange={v => setForm(p => ({ ...p, cc_category_id: v }))}
                    options={ccCats.map((c, _i) => ({ value: c.id != null ? String(c.id) : `fallback-${_i}`, label: c.name }))}
                    placeholder="CC category" disabled={locked || !form.model_id} />
                </div>
              ) : (
                <>
                  {availableBodyTypes.length > 0 && (
                    <div className="ea-field">
                      <label>Body Type</label>
                      <MiniSearchSelect value={form.body_type_id}
                        onChange={v => setForm(p => ({ ...p, body_type_id: v }))}
                        options={availableBodyTypes.map(b => ({ value: String(b.id), label: b.name }))}
                        placeholder="Body type" disabled={locked} />
                    </div>
                  )}
                  {availableSegs.length > 0 && (
                    <div className="ea-field ea-full">
                      <label>Segments</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {availableSegs.map((s, _i) => {
                          const on = form.segment_ids.includes(s.id);
                          return (
                            <button key={s.id || _i} type="button"
                              disabled={locked}
                              onClick={() => !locked && setForm(p => ({
                                ...p,
                                segment_ids: on ? [] : [s.id],
                              }))}
                              style={{ padding: '4px 12px', borderRadius: 20, border: `1.5px solid ${on ? 'var(--primary)' : 'var(--border)'}`, background: on ? 'rgba(22,185,148,0.12)' : 'var(--bg)', color: on ? 'var(--primary)' : 'var(--text)', fontSize: 12, fontWeight: 600, cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.6 : 1 }}>
                              {s.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ── Appointment Details ── */}
          <div className="ea-section">
            <div className="ea-sec-title"><Calendar size={11} /> Appointment Details</div>
            <div className="ea-grid">
              <div className="ea-field">
                <label>Hub</label>
                <select className="ea-input" value={form.hub_id} onChange={e => onHubChange(e.target.value)}>
                  <option value="">No hub</option>
                  {hubs.map(h => <option key={h.id} value={String(h.id)}>{h.hub_name}</option>)}
                </select>
              </div>
              <div className="ea-field">
                <label>Date *</label>
                <input type="date" className="ea-input" value={form.scheduled_date} onChange={f('scheduled_date')} />
              </div>
              <div className="ea-field">
                <label>Time</label>
                <input type="time" className="ea-input" value={form.scheduled_time} onChange={f('scheduled_time')} />
              </div>
            </div>
            <div className="ea-field" style={{ marginTop: 10 }}>
              <label>Notes</label>
              <textarea className="ea-input" rows={2} value={form.notes} onChange={f('notes')}
                placeholder="Any additional notes…" style={{ resize: 'vertical' }} />
            </div>
          </div>

          {/* ── Pickup ── */}
          <div className="ea-section">
            <div className="ea-sec-title"><MapPin size={11} /> Pickup</div>

            {/* Visit ——[toggle]—— Pickup Required */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: form.pickup_required ? 10 : 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: !form.pickup_required ? 'var(--text)' : 'var(--text-muted)' }}>Visit</span>
              <button type="button"
                onClick={() => setForm(p => ({ ...p, pickup_required: !p.pickup_required, pickup_address_line1: '', pickup_address_line2: '', pickup_city: '', pickup_pincode: '', pickup_maps_link: '', pickup_scheduled_date: '', pickup_scheduled_time: '' }))}
                className={`ea-toggle${form.pickup_required ? ' ea-toggle--on' : ''}`}>
                <span className="ea-toggle-knob" />
              </button>
              <span style={{ fontSize: 13, fontWeight: 600, color: form.pickup_required ? 'var(--text)' : 'var(--text-muted)' }}>Pickup Required</span>
            </div>
            {form.pickup_required && (
              <div className="ea-grid" style={{ marginBottom: 14 }}>
                <div className="ea-field">
                  <label>Pickup Date</label>
                  <input type="date" className="ea-input" value={form.pickup_scheduled_date} onChange={f('pickup_scheduled_date')} />
                </div>
                <div className="ea-field">
                  <label>Pickup Time</label>
                  <input type="time" className="ea-input" value={form.pickup_scheduled_time} onChange={f('pickup_scheduled_time')} />
                </div>
                <div className="ea-field ea-full">
                  <label>Address Line 1 *</label>
                  <input className="ea-input" placeholder="Flat / Building / Street" value={form.pickup_address_line1} onChange={f('pickup_address_line1')} />
                </div>
                <div className="ea-field ea-full">
                  <label>Address Line 2</label>
                  <input className="ea-input" placeholder="Landmark / Area (optional)" value={form.pickup_address_line2} onChange={f('pickup_address_line2')} />
                </div>
                <div className="ea-field">
                  <label>City</label>
                  <input className="ea-input" placeholder="City" value={form.pickup_city} onChange={f('pickup_city')} />
                </div>
                <div className="ea-field">
                  <label>Pincode</label>
                  <input className="ea-input" placeholder="6-digit pincode" maxLength={6} value={form.pickup_pincode}
                    onChange={e => setForm(p => ({ ...p, pickup_pincode: e.target.value.replace(/\D/g, '') }))} />
                </div>
                <div className="ea-field ea-full">
                  <label>Google Maps Link</label>
                  <input className="ea-input" placeholder="https://maps.google.com/..." value={form.pickup_maps_link} onChange={f('pickup_maps_link')} />
                </div>
              </div>
            )}
          </div>

          {/* ── Services ── */}
          {form.hub_id && !locked && (
            <div className="ea-section">
              <div className="ea-sec-title"><Wrench size={11} /> Services</div>

              {/* Selected services list */}
              {apptServices.length > 0 && (
                <div style={{ marginBottom: 10, border: '1px solid var(--border)', borderRadius: 9, overflow: 'hidden' }}>
                  {apptServices.map((s, _idx) => (
                    <div key={s.id || _idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 13 }}>{s.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#0f766e' }}>₹{Number(s.price).toLocaleString('en-IN')}</span>
                        <button type="button" onClick={() => setApptServices(prev => prev.filter(x => x.id !== s.id))}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#dc2626', padding: 2, display: 'flex' }}>
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', fontWeight: 700, fontSize: 13, color: '#0f766e', background: 'var(--bg-soft,#f8fafc)' }}>
                    <span>Total</span>
                    <span>₹{apptServices.reduce((s, x) => s + Number(x.price), 0).toLocaleString('en-IN')}</span>
                  </div>
                </div>
              )}

              {/* Hub service picker */}
              {hubCategories.length > 0 && (
                <div className="ca-svc-picker">
                  <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {!svcSearch.trim() && hubCategories.map((c, _idx) => (
                      <button key={c.id || _idx} type="button" onClick={() => setSelectedCatId(c.id)}
                        style={{ padding: '3px 10px', borderRadius: 20, border: `1.5px solid ${selectedCatId === c.id ? 'var(--primary)' : 'var(--border)'}`, background: selectedCatId === c.id ? 'rgba(22,185,148,0.12)' : 'var(--bg)', color: selectedCatId === c.id ? 'var(--primary)' : 'var(--text)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                        {c.name}
                      </button>
                    ))}
                    <div style={{ position: 'relative', marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
                      <Search size={12} style={{ position: 'absolute', left: 7, color: 'var(--text-muted)', pointerEvents: 'none' }} />
                      <input value={svcSearch} onChange={e => setSvcSearch(e.target.value)} placeholder="Search…"
                        style={{ paddingLeft: 24, paddingRight: 8, paddingTop: 4, paddingBottom: 4, border: '1.5px solid var(--border)', borderRadius: 20, fontSize: 12, outline: 'none', background: 'var(--bg)', width: 110, color: 'var(--text)' }} />
                    </div>
                  </div>
                  <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                    {pickerServices.map((svc, _idx) => {
                      const on = apptServices.some(s => s.id === svc.service_id);
                      return (
                        <div key={svc.service_id || _idx} onClick={() => toggleService(svc)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', background: on ? '#f0f9ff' : 'transparent', borderBottom: '1px solid var(--border)', transition: 'background .1s' }}>
                          <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${on ? 'var(--primary)' : 'var(--border)'}`, background: on ? 'var(--primary)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {on && <CheckCircle2 size={10} style={{ color: '#fff' }} />}
                          </div>
                          <span style={{ fontSize: 13, flex: 1 }}>{svc.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div style={{ margin: '0 18px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 13px', fontSize: 13, color: '#dc2626', fontWeight: 600 }}>
              {error}
            </div>
          )}
          {priceRecalcNotice && (
            <div style={{ margin: '0 18px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '9px 13px', fontSize: 13, color: '#15803d', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 7 }}>
              ✓ Vehicle details changed — service prices updated to match new pricing rules.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="ea-ftr">
          <button className="apptv-close-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="apptv-inv-btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Create Appointment Wizard  (3-step modal)
// ═════════════════════════════════════════════════════════════════════════════
// standaloneMode: used when this wizard is reused to pick a customer +
// vehicle WITHOUT creating a real appointment row (e.g. standalone estimate
// creation from EstimatesPage). In that mode, step 3 (schedule/hub/services,
// which is appointment-specific) is skipped entirely — as soon as a vehicle
// is picked/saved in step 2, onComplete({ customer, vehicle }) fires instead
// of advancing to step 3 or POSTing to /api/appointments.
export function CreateAppointmentModal({ hubs, statusList, onClose, onCreated, standaloneMode = false, onComplete, title = 'New Appointment' }) {
  // ── Step tracker ──────────────────────────────────────────────────────────
  const [step, setStep] = useState(1); // 1 customer · 2 vehicle · 3 details

  // ── Step 1: Customer search ───────────────────────────────────────────────
  const [custQuery, setCustQuery] = useState('');
  const [custResults, setCustResults] = useState([]);
  const [custLoading, setCustLoading] = useState(false);
  const [selectedCust, setSelectedCust] = useState(null); // {mobile, customer_name, whatsapp}
  const [showAddCust, setShowAddCust] = useState(false);
  const [newCust, setNewCust] = useState({ name: '', mobile: '', whatsapp: '', state_id: '', city_id: '', area_id: '' });
  const [waSameAsMobile, setWaSameAsMobile] = useState(false);
  const [locStates, setLocStates] = useState([]);
  const [locCities, setLocCities] = useState([]);
  const [locAreas, setLocAreas] = useState([]);

  // ── Step 2: Vehicle ───────────────────────────────────────────────────────
  const [custVehicles, setCustVehicles] = useState([]);
  const [vehLoading, setVehLoading] = useState(false);
  const [selectedVeh, setSelectedVeh] = useState(null);
  const [showAddVeh, setShowAddVeh] = useState(false);
  const [newVeh, setNewVeh] = useState({
    vehicle_number: '', vehicle_type_id: '', make_id: '', model_id: '',
    body_type_id: '', segment_ids: [], cc_category_id: '',
  });
  const [vTypes, setVTypes] = useState([]);
  const [makes, setMakes] = useState([]);
  const [models, setModels] = useState([]); // raw rows (with segment_id/body_type_id per row)
  const [modelGroups, setModelGroups] = useState([]); // deduplicated by name
  const [bodyTypes, setBodyTypes] = useState([]);
  const [segments, setSegments] = useState([]);
  const [ccCats, setCcCats] = useState([]);
  const [availableSegs, setAvailableSegs] = useState([]); // filtered to selected model's variants
  const [availableBodyTypes, setAvailableBodyTypes] = useState([]); // filtered to selected model's variants
  const [selectedModelName, setSelectedModelName] = useState('');
  const [makesLoading, setMakesLoading] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);

  // ── Step 3: Appointment details ───────────────────────────────────────────
  const [apptForm, setApptForm] = useState({
    hub_id: '', scheduled_date: '', scheduled_time: '',
    notes: '',
    pickup_required: false, pickup_address_line1: '', pickup_address_line2: '', pickup_city: '', pickup_pincode: '', pickup_maps_link: '',
    pickup_scheduled_date: '', pickup_scheduled_time: '',
    drop_required: false, drop_address_line1: '', drop_address_line2: '', drop_city: '', drop_pincode: '', drop_maps_link: '',
  });
  const [hubCategories, setHubCategories] = useState([]);
  const [selectedCatId, setSelectedCatId] = useState(null);
  const [svcSearch, setSvcSearch] = useState('');
  const [hubSvcLoading, setHubSvcLoading] = useState(false);
  const [apptServices, setApptServices] = useState([]); // selected services [{id,name,price,category_id}]

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // ── Load vehicle master data once ─────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      api('/api/vehicles/types'),
      api('/api/vehicles/body-types'),
      api('/api/vehicles/segments'),
      api('/api/cc-categories?limit=100'),
      api('/api/locations/states'),
    ]).then(([vt, bt, sg, cc, st]) => {
      setVTypes(vt.items || []);
      setBodyTypes(bt.items || []);
      setSegments(sg.items || []);
      setCcCats(cc.items || []);
      setLocStates(st.items || []);
    }).catch(() => { });
  }, []);

  // ── Customer search (debounced) ───────────────────────────────────────────
  const searchTimer = useRef(null);
  function onCustQueryChange(v) {
    setCustQuery(v);
    clearTimeout(searchTimer.current);
    if (!v.trim()) { setCustResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setCustLoading(true);
      try {
        const r = await api(`/api/customers?search=${encodeURIComponent(v)}&limit=8`);
        setCustResults(r.items || []);
      } catch { setCustResults([]); }
      finally { setCustLoading(false); }
    }, 300);
  }

  // ── Select existing customer → go step 2 ─────────────────────────────────
  // ── Location cascade handlers ─────────────────────────────────────────────
  async function onLocStateChange(stateId) {
    setNewCust(v => ({ ...v, state_id: stateId, city_id: '', area_id: '' }));
    setLocCities([]); setLocAreas([]);
    if (!stateId) return;
    try { const r = await api(`/api/locations/cities?state_id=${stateId}`); setLocCities(r.items || []); } catch { setLocCities([]); }
  }
  async function onLocCityChange(cityId) {
    setNewCust(v => ({ ...v, city_id: cityId, area_id: '' }));
    setLocAreas([]);
    if (!cityId) return;
    try { const r = await api(`/api/locations/areas?city_id=${cityId}`); setLocAreas(r.items || []); } catch { setLocAreas([]); }
  }
  async function pickCustomer(cust) {
    setSelectedCust({ mobile: cust.mobile, customer_name: cust.customer_name, whatsapp: cust.whatsapp });
    await loadVehicles(cust.mobile);
    setStep(2);
  }

  // ── Create new customer ───────────────────────────────────────────────────
  async function saveNewCustomer() {
    const name = newCust.name.trim();
    const mobile = newCust.mobile.trim().replace(/\s/g, '');
    const wa = newCust.whatsapp.trim().replace(/\s/g, '');
    if (!name) { setError('Full name is required'); return; }
    if (name.length < 2) { setError('Name must be at least 2 characters'); return; }
    if (!/^[a-zA-Z\s.'-]{2,80}$/.test(name)) { setError('Name can only contain letters, spaces, or . \' -'); return; }
    if (!mobile) { setError('Mobile number is required'); return; }
    if (!/^\d{10}$/.test(mobile)) { setError('Mobile must be exactly 10 digits'); return; }
    if (wa && !/^\d{10}$/.test(wa)) { setError('WhatsApp must be exactly 10 digits'); return; }
    setError('');
    try {
      await api(`/api/customers/${encodeURIComponent(mobile)}`, {
        method: 'PUT',
        body: {
          display_name: name,
          whatsapp: wa || null,
          state_id: newCust.state_id || null,
          city_id: newCust.city_id || null,
          area_id: newCust.area_id || null,
        },
      });
      const cust = { mobile, customer_name: name, whatsapp: wa || null };
      setSelectedCust(cust);
      await loadVehicles(cust.mobile);
      setStep(2);
    } catch (e) { setError(e.message); }
  }

  // ── Load customer vehicles ────────────────────────────────────────────────
  async function loadVehicles(mobile) {
    setVehLoading(true);
    try {
      const r = await api(`/api/customers/${encodeURIComponent(mobile)}/vehicles`);
      // Deduplicate by vehicle id (or vehicle_number as fallback) — the API can
      // return one row per appointment when joining, producing duplicate vehicles.
      const seen = new Set();
      const unique = (r.items || []).filter(v => {
        const key = v.id ?? v.vehicle_number;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setCustVehicles(unique);
    } catch { setCustVehicles([]); }
    finally { setVehLoading(false); }
  }

  // ── Load makes when vehicle type changes ──────────────────────────────────
  async function onVehicleTypeChange(vtId) {
    setNewVeh(v => ({ ...v, vehicle_type_id: vtId, make_id: '', model_id: '', body_type_id: '', segment_ids: [] }));
    setMakes([]); setModels([]); setModelGroups([]); setSelectedModelName('');
    setAvailableSegs([]); setAvailableBodyTypes([]);
    if (!vtId) return;
    setMakesLoading(true);
    try {
      // API uses 'type_id' (not vehicle_type_id)
      const r = await api(`/api/vehicles/makes?type_id=${vtId}&limit=500`);
      setMakes(r.items || []);
    } catch { setMakes([]); }
    finally { setMakesLoading(false); }
  }

  // ── Load models when make changes, group by name to deduplicate ───────────
  async function onMakeChange(mkId) {
    setNewVeh(v => ({ ...v, make_id: mkId, model_id: '', body_type_id: '', segment_ids: [] }));
    setModels([]); setModelGroups([]); setSelectedModelName('');
    setAvailableSegs([]); setAvailableBodyTypes([]);
    if (!mkId) return;
    setModelsLoading(true);
    try {
      const r = await api(`/api/vehicles/models?make_id=${mkId}&limit=500`);
      const allRows = r.items || [];
      setModels(allRows);
      // Deduplicate by name — each group collects its segment_ids and body_type_ids
      const groupMap = new Map();
      for (const m of allRows) {
        if (!groupMap.has(m.name)) {
          groupMap.set(m.name, { name: m.name, firstId: m.id, segmentIds: [], bodyTypeIds: [], ccCategoryIds: [] });
        }
        const g = groupMap.get(m.name);
        if (m.segment_id && !g.segmentIds.includes(m.segment_id)) g.segmentIds.push(m.segment_id);
        if (m.body_type_id && !g.bodyTypeIds.includes(m.body_type_id)) g.bodyTypeIds.push(m.body_type_id);
        if (m.cc_category_id && !g.ccCategoryIds.includes(m.cc_category_id)) g.ccCategoryIds.push(m.cc_category_id);
      }
      setModelGroups([...groupMap.values()]);
    } catch { setModelGroups([]); }
    finally { setModelsLoading(false); }
  }

  // ── When model name is picked → filter segments & body types to that model ─
  function onModelChange(modelName) {
    setSelectedModelName(modelName);
    const group = modelGroups.find(g => g.name === modelName);
    if (!group) {
      setNewVeh(v => ({ ...v, model_id: '', body_type_id: '', segment_ids: [], cc_category_id: '' }));
      setAvailableSegs([]); setAvailableBodyTypes([]);
      return;
    }
    // Auto-set body_type if only one option
    const filteredBT = bodyTypes.filter(bt => group.bodyTypeIds.includes(bt.id));
    const filteredSg = segments.filter(s => group.segmentIds.includes(s.id));
    setAvailableBodyTypes(filteredBT);
    setAvailableSegs(filteredSg);
    setNewVeh(v => ({
      ...v,
      model_id: group.firstId,
      body_type_id: filteredBT.length === 1 ? filteredBT[0].id : '',
      segment_ids: [],
      cc_category_id: group.ccCategoryIds?.length === 1 ? group.ccCategoryIds[0] : '',
    }));
  }

  // ── Is the new vehicle type a 2W? ─────────────────────────────────────────
  const newVehIs2W = (() => {
    const vt = vTypes.find(t => String(t.id) === String(newVeh.vehicle_type_id));
    return vt ? (vt.name?.toLowerCase().includes('two') || vt.name?.toLowerCase().includes('2')) : false;
  })();

  // After a vehicle is picked/saved: normal mode advances to step 3
  // (schedule/hub/services); standaloneMode instead hands the picked
  // customer + vehicle straight back to the caller — no appointment row.
  function proceedAfterVehicle(vehObj) {
    if (standaloneMode) {
      onComplete && onComplete({ customer: selectedCust, vehicle: vehObj });
      return;
    }
    setStep(3);
  }

  // ── Select existing vehicle → go step 3 (or complete, in standaloneMode) ──
  function pickVehicle(veh) {
    // API returns segment_id (scalar) — normalize to segment_ids array for appointment creation
    const normalized = {
      ...veh,
      segment_ids: veh.segment_ids?.length ? veh.segment_ids
        : veh.segment_id ? [veh.segment_id]
          : [],
    };
    setSelectedVeh(normalized);
    proceedAfterVehicle(normalized);
  }

  // ── Save new vehicle → go step 3 (or complete, in standaloneMode) ────────
  async function saveNewVehicle() {
    if (!newVeh.vehicle_number.trim()) { setError('Vehicle number is required'); return; }
    if (!newVeh.make_id) { setError('Make is required'); return; }
    if (!newVeh.model_id) { setError('Model is required'); return; }
    if (!newVehIs2W && !newVeh.segment_ids?.length) { setError('Segment is required'); return; }
    setError('');
    try {
      const r = await api(`/api/customers/${encodeURIComponent(selectedCust.mobile)}/vehicles`, {
        method: 'POST',
        body: {
          vehicle_number: newVeh.vehicle_number.trim().toUpperCase(),
          vehicle_type_id: newVeh.vehicle_type_id || null,
          make_id: newVeh.make_id || null,
          model_id: newVeh.model_id || null,
          body_type_id: newVeh.body_type_id || null,
          segment_id: newVeh.segment_ids?.[0] || null,
          segment_ids: newVeh.segment_ids,
          cc_category_id: newVeh.cc_category_id || null,
        },
      });
      // The vehicles endpoint returns a single `segment_id` — carry forward
      // the full `segment_ids` array from the local form (already known
      // client-side) rather than losing it.
      const savedVeh = { ...r.item, segment_ids: newVeh.segment_ids };
      setSelectedVeh(savedVeh);
      proceedAfterVehicle(savedVeh);
    } catch (e) {
      // If vehicle already registered (409), still pick the vehicle data from the form
      if (e.message?.includes('already registered')) {
        const vehObj = {
          vehicle_number: newVeh.vehicle_number.trim().toUpperCase(),
          vehicle_type_id: newVeh.vehicle_type_id || null,
          vehicle_type_name: vTypes.find(t => String(t.id) === String(newVeh.vehicle_type_id))?.name,
          make_id: newVeh.make_id || null,
          make_name: makes.find(m => String(m.id) === String(newVeh.make_id))?.name,
          model_id: newVeh.model_id || null,
          model_name: selectedModelName || models.find(m => String(m.id) === String(newVeh.model_id))?.name,
          body_type_id: newVeh.body_type_id || null,
          segment_ids: newVeh.segment_ids,
          cc_category_id: newVeh.cc_category_id || null,
        };
        setSelectedVeh(vehObj);
        proceedAfterVehicle(vehObj);
      } else { setError(e.message); }
    }
  }

  // ── Load hub services when hub changes ────────────────────────────────────
  async function onHubChange(hubId) {
    setApptForm(f => ({ ...f, hub_id: hubId }));
    setHubCategories([]); setSelectedCatId(null); setApptServices([]);
    if (!hubId) return;
    setHubSvcLoading(true);
    try {
      const r = await api(`/api/hubs/${hubId}/services`);
      const cats = (r.categories || []).filter(c => c.services.some(s => s.service_mapped));
      // Filter by vehicle type
      const isVeh2W = selectedVeh?.vehicle_type_name?.toLowerCase().includes('two') ||
        selectedVeh?.vehicle_type_name?.toLowerCase().includes('2');
      const vcFilter = isVeh2W ? '2W' : '4W';
      const filteredCats = cats.map(c => ({
        ...c,
        services: c.services
          .filter(s => s.service_mapped && (s.vehicle_class === vcFilter || s.vehicle_class === 'both'))
          .map(s => ({ ...s, category_id: c.id })), // stamp category_id on each service for pricing fallback
      })).filter(c => c.services.length > 0);
      setHubCategories(filteredCats);
      if (filteredCats.length > 0) setSelectedCatId(filteredCats[0].id);
    } catch { setHubCategories([]); }
    finally { setHubSvcLoading(false); }
  }

  // ── Pricing lookup (service-level → category fallback, same rules as EstimatesPage) ──
  async function lookupSvcPrice(serviceId, categoryId) {
    if (!selectedVeh) return 0;
    function buildParams(target) {
      const p = new URLSearchParams(target);
      if (selectedVeh.vehicle_type_id) p.set('vehicle_type_id', selectedVeh.vehicle_type_id);
      if (selectedVeh.make_id) p.set('make_id', selectedVeh.make_id);
      if (selectedVeh.model_id) p.set('model_id', selectedVeh.model_id);
      if (selectedVeh.body_type_id) p.set('body_type_id', selectedVeh.body_type_id);
      if (selectedVeh.cc_category_id) p.set('cc_category_id', selectedVeh.cc_category_id);
      // segment_ids is array — send first segment for pricing lookup
      const seg = Array.isArray(selectedVeh.segment_ids) ? selectedVeh.segment_ids[0] : null;
      if (seg) p.set('segment_id', seg);
      return p;
    }
    try {
      // Step 1: service-level rule
      const svcRes = await api(`/api/pricing/lookup?${buildParams({ service_id: serviceId })}`);
      if (svcRes.matched) return parseFloat(svcRes.price);
      // Step 2: category-level fallback
      if (categoryId) {
        const catRes = await api(`/api/pricing/lookup?${buildParams({ category_id: categoryId })}`);
        if (catRes.matched) return parseFloat(catRes.price);
      }
    } catch { /* silent */ }
    return 0;
  }

  // ── Toggle service in/out (looks up price from pricing rules) ─────────────
  async function toggleService(svc) {
    const alreadyOn = apptServices.some(s => s.id === svc.service_id);
    if (alreadyOn) {
      setApptServices(prev => prev.filter(s => s.id !== svc.service_id));
      return;
    }
    const price = await lookupSvcPrice(svc.service_id, svc.category_id);
    setApptServices(prev => [...prev, { id: svc.service_id, name: svc.name, price, category_id: svc.category_id || null }]);
  }

  // ── Picker services (filtered by search) ─────────────────────────────────
  const pickerServices = (() => {
    if (svcSearch.trim()) {
      const q = svcSearch.toLowerCase();
      return hubCategories.flatMap(c => c.services).filter(s => s.name.toLowerCase().includes(q));
    }
    const cat = hubCategories.find(c => c.id === selectedCatId);
    return cat ? cat.services : [];
  })();

  // ── Submit appointment ────────────────────────────────────────────────────
  async function submitAppointment() {
    if (!apptForm.scheduled_date) { setError('Scheduled date is required'); return; }
    if (apptForm.pickup_required && !apptForm.pickup_address_line1.trim()) {
      setError('Pickup address line 1 is required'); return;
    }
    if (apptForm.drop_required && !apptForm.drop_address_line1.trim()) {
      setError('Drop address line 1 is required'); return;
    }
    setSaving(true); setError('');
    try {
      const payload = {
        customer_name: selectedCust.customer_name,
        mobile: selectedCust.mobile,
        whatsapp: selectedCust.whatsapp || null,
        vehicle_number: selectedVeh?.vehicle_number || null,
        vehicle_type_id: selectedVeh?.vehicle_type_id || null,
        make_id: selectedVeh?.make_id || null,
        model_id: selectedVeh?.model_id || null,
        body_type_id: selectedVeh?.body_type_id || null,
        segment_ids: selectedVeh?.segment_ids || [],
        cc_category_id: selectedVeh?.cc_category_id || null,
        hub_id: apptForm.hub_id || null,
        scheduled_date: apptForm.scheduled_date,
        scheduled_time: apptForm.scheduled_time || null,
        notes: apptForm.notes.trim() || null,
        pickup_required: apptForm.pickup_required,
        pickup_address_line1: apptForm.pickup_required ? apptForm.pickup_address_line1.trim() : null,
        pickup_address_line2: apptForm.pickup_required ? (apptForm.pickup_address_line2.trim() || null) : null,
        pickup_city: apptForm.pickup_required ? (apptForm.pickup_city.trim() || null) : null,
        pickup_pincode: apptForm.pickup_required ? (apptForm.pickup_pincode.trim() || null) : null,
        pickup_maps_link: apptForm.pickup_required ? (apptForm.pickup_maps_link.trim() || null) : null,
        pickup_scheduled_date: apptForm.pickup_required ? (apptForm.pickup_scheduled_date || null) : null,
        pickup_scheduled_time: apptForm.pickup_required ? (apptForm.pickup_scheduled_time || null) : null,
        drop_required: apptForm.drop_required,
        drop_address_line1: apptForm.drop_required ? apptForm.drop_address_line1.trim() : null,
        drop_address_line2: apptForm.drop_required ? (apptForm.drop_address_line2.trim() || null) : null,
        drop_city: apptForm.drop_required ? (apptForm.drop_city.trim() || null) : null,
        drop_pincode: apptForm.drop_required ? (apptForm.drop_pincode.trim() || null) : null,
        drop_maps_link: apptForm.drop_required ? (apptForm.drop_maps_link.trim() || null) : null,
        services: apptServices.map(s => ({ service_id: s.id, category_id: s.category_id, price: s.price })),
      };
      const r = await api('/api/appointments', { method: 'POST', body: payload });
      onCreated(r.item);
      onClose();
    } catch (e) { setError(e.message); setSaving(false); }
  }

  // ── Derived vehicle info (for step 3 header) ──────────────────────────────
  const vehLabel = selectedVeh
    ? [selectedVeh.vehicle_number, selectedVeh.make_name, selectedVeh.model_name].filter(Boolean).join(' · ')
    : '—';

  const isVeh2W = selectedVeh?.vehicle_type_name?.toLowerCase().includes('two') ||
    selectedVeh?.vehicle_type_name?.toLowerCase().includes('2') || false;

  // ── Step labels ───────────────────────────────────────────────────────────
  const STEPS = standaloneMode ? ['Customer', 'Vehicle'] : ['Customer', 'Vehicle', 'Details'];

  return (
    <div className="appt-backdrop" onClick={onClose}>
      <div className="ca-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="ca-hdr">
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Step {step} of {STEPS.length} — {STEPS[step - 1]}
            </div>
          </div>
          <button className="appt-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Step indicator */}
        <div className="ca-steps">
          {STEPS.map((lbl, i) => {
            const n = i + 1;
            const done = step > n;
            const active = step === n;
            return (
              <div key={n} className="ca-step-item">
                <div className={`ca-step-circle ${done ? 'done' : active ? 'active' : ''}`}>
                  {done ? <CheckCircle2 size={13} /> : n}
                </div>
                <span className={`ca-step-lbl ${active ? 'active' : ''}`}>{lbl}</span>
                {i < STEPS.length - 1 && <div className={`ca-step-line ${done ? 'done' : ''}`} />}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="ca-body">
          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '9px 13px', color: '#991b1b', fontSize: 13, marginBottom: 14 }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {/* ── STEP 1: CUSTOMER ── */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {!showAddCust ? (
                <>
                  <div>
                    <label className="ca-lbl">Search Customer (name or mobile)</label>
                    <div style={{ position: 'relative' }}>
                      <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                      <input
                        autoFocus
                        className="ca-input"
                        style={{ paddingLeft: 32 }}
                        placeholder="Type name or mobile number…"
                        value={custQuery}
                        onChange={e => { onCustQueryChange(e.target.value); setError(''); }}
                      />
                    </div>
                  </div>

                  {/* Search results */}
                  {custLoading && <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>Searching…</div>}
                  {!custLoading && custQuery.trim() && custResults.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '16px 0' }}>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>No customer found for "{custQuery}"</div>
                      <button className="ca-btn-outline" onClick={() => { setNewCust({ name: custQuery, mobile: '', whatsapp: '', state_id: '', city_id: '', area_id: '' }); setWaSameAsMobile(false); setLocCities([]); setLocAreas([]); setShowAddCust(true); setError(''); }}>
                        <Plus size={13} /> Add New Customer
                      </button>
                    </div>
                  )}
                  {custResults.length > 0 && (
                    <div className="ca-results">
                      {custResults.map(c => (
                        <button key={c.mobile || c.customer_name || String(Math.random())} className="ca-result-row" onClick={() => { setError(''); pickCustomer(c); }}>
                          <div className="ca-result-avatar">{(c.customer_name || c.mobile)[0].toUpperCase()}</div>
                          <div className="ca-result-info">
                            <div className="ca-result-name">{c.customer_name || '—'}</div>
                            <div className="ca-result-sub">{c.mobile}{c.total_appointments > 0 ? ` · ${c.total_appointments} appt${c.total_appointments !== 1 ? 's' : ''}` : ''}</div>
                          </div>
                          <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        </button>
                      ))}
                      <button className="ca-btn-outline" style={{ margin: '8px 0 0' }} onClick={() => { setNewCust({ name: '', mobile: '', whatsapp: '' }); setWaSameAsMobile(false); setShowAddCust(true); setError(''); }}>
                        <Plus size={13} /> Add New Customer Instead
                      </button>
                    </div>
                  )}
                </>
              ) : (
                /* Add new customer form */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <User size={15} /> New Customer
                  </div>
                  <div>
                    <label className="ca-lbl">Full Name <span style={{ color: '#dc2626' }}>*</span></label>
                    <input className="ca-input" placeholder="e.g. Ramesh Patel" maxLength={80}
                      value={newCust.name}
                      onChange={e => { setNewCust(v => ({ ...v, name: e.target.value })); setError(''); }} />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, display: 'block' }}>Letters only · Min 2 chars</span>
                  </div>
                  <div>
                    <label className="ca-lbl">Mobile <span style={{ color: '#dc2626' }}>*</span></label>
                    <input className="ca-input" placeholder="10-digit mobile number" maxLength={10}
                      inputMode="numeric" pattern="\d*"
                      value={newCust.mobile}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                        setNewCust(v => ({
                          ...v,
                          mobile: val,
                          whatsapp: waSameAsMobile ? val : v.whatsapp,
                        }));
                        setError('');
                      }} />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, display: 'block' }}>10 digits, no spaces</span>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <label className="ca-lbl" style={{ margin: 0 }}>WhatsApp <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: waSameAsMobile ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                        <input type="checkbox" checked={waSameAsMobile}
                          style={{ accentColor: 'var(--primary)', width: 13, height: 13 }}
                          onChange={e => {
                            const checked = e.target.checked;
                            setWaSameAsMobile(checked);
                            if (checked) setNewCust(v => ({ ...v, whatsapp: v.mobile }));
                            else setNewCust(v => ({ ...v, whatsapp: '' }));
                          }} />
                        Same as mobile
                      </label>
                    </div>
                    <input className="ca-input" placeholder="10-digit WhatsApp number"
                      maxLength={10} inputMode="numeric" pattern="\d*"
                      value={newCust.whatsapp}
                      disabled={waSameAsMobile}
                      style={waSameAsMobile ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                        setNewCust(v => ({ ...v, whatsapp: val }));
                      }} />
                  </div>
                  {/* ── Location (optional) ── */}
                  <div style={{ borderTop: '1.5px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
                    <label className="ca-lbl">Location <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                    {/* State */}
                    <div style={{ marginBottom: 8 }}>
                      <label className="ca-lbl">State</label>
                      <LocSelect
                        value={newCust.state_id}
                        options={locStates}
                        placeholder="Select state…"
                        onChange={v => onLocStateChange(v)}
                      />
                    </div>
                    {/* City */}
                    <div style={{ marginBottom: 8 }}>
                      <label className="ca-lbl">City</label>
                      <LocSelect
                        value={newCust.city_id}
                        options={locCities}
                        placeholder={newCust.state_id ? 'Select city…' : 'Select state first'}
                        disabled={!newCust.state_id}
                        onChange={v => onLocCityChange(v)}
                      />
                    </div>
                    {/* Area */}
                    <div>
                      <label className="ca-lbl">Area</label>
                      <LocSelect
                        value={newCust.area_id}
                        options={locAreas}
                        placeholder={newCust.city_id ? 'Select area…' : 'Select city first'}
                        disabled={!newCust.city_id}
                        onChange={v => setNewCust(p => ({ ...p, area_id: v }))}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="ca-btn-outline" onClick={() => { setShowAddCust(false); setError(''); }}>Back</button>
                    <button className="ca-btn-primary" style={{ flex: 1 }} onClick={saveNewCustomer}>Save & Continue</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: VEHICLE ── */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Customer info strip */}
              <div className="ca-info-strip">
                <User size={12} /> {selectedCust?.customer_name} · {selectedCust?.mobile}
              </div>

              {!showAddVeh ? (
                <>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>Select Vehicle</div>
                  {vehLoading && <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>Loading vehicles…</div>}
                  {!vehLoading && custVehicles.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 13, color: 'var(--text-muted)' }}>No vehicles on record</div>
                  )}
                  {custVehicles.map((v, _idx) => (
                    <button key={v.id || _idx} className="ca-veh-card" onClick={() => { setError(''); pickVehicle(v); }}>
                      <div className="ca-veh-plate">{v.vehicle_number}</div>
                      <div className="ca-veh-details">
                        {[v.vehicle_type_name, v.make_name, v.model_name].filter(Boolean).join(' · ') || 'Vehicle'}
                      </div>
                      <ChevronRight size={14} style={{ color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }} />
                    </button>
                  ))}
                  <button className="ca-btn-outline" onClick={() => { setShowAddVeh(true); setError(''); }}>
                    <Plus size={13} /> Add New Vehicle
                  </button>
                </>
              ) : (
                /* Add vehicle form */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Car size={15} /> New Vehicle
                  </div>
                  <div>
                    <label className="ca-lbl">Vehicle Number <span style={{ color: '#dc2626' }}>*</span></label>
                    <input className="ca-input" placeholder="e.g. GJ09BN8989" value={newVeh.vehicle_number}
                      onChange={e => setNewVeh(v => ({ ...v, vehicle_number: e.target.value.toUpperCase() }))} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label className="ca-lbl">Vehicle Type</label>
                      <MiniSearchSelect
                        value={newVeh.vehicle_type_id}
                        onChange={onVehicleTypeChange}
                        placeholder="Select type…"
                        options={vTypes.map(t => ({ value: t.id, label: t.name }))}
                      />
                    </div>
                    <div>
                      <label className="ca-lbl">Make <span style={{ color: '#dc2626' }}>*</span>{makesLoading && <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 10 }}> loading…</span>}</label>
                      <MiniSearchSelect
                        value={newVeh.make_id}
                        onChange={onMakeChange}
                        placeholder="Select make…"
                        disabled={!makes.length}
                        options={makes.map(m => ({ value: m.id, label: m.name }))}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="ca-lbl">Model <span style={{ color: '#dc2626' }}>*</span>{modelsLoading && <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 10 }}> loading…</span>}</label>
                    <MiniSearchSelect
                      value={selectedModelName}
                      onChange={onModelChange}
                      placeholder="Select model…"
                      disabled={!modelGroups.length}
                      options={modelGroups.map(g => ({ value: g.name, label: g.name }))}
                    />
                  </div>

                  {/* 4W specific: body type + segments — shown only after model selected, filtered to that model */}
                  {!newVehIs2W && newVeh.vehicle_type_id && selectedModelName && (
                    <>
                      {availableBodyTypes.length > 0 && (
                        <div>
                          <label className="ca-lbl">Body Type</label>
                          <MiniSearchSelect
                            value={newVeh.body_type_id}
                            onChange={v => setNewVeh(x => ({ ...x, body_type_id: v }))}
                            placeholder="Select body type…"
                            options={availableBodyTypes.map(b => ({ value: b.id, label: b.name }))}
                          />
                        </div>
                      )}
                      {availableSegs.length > 0 && (
                        <div>
                          <label className="ca-lbl">Fuel Type <span style={{ color: '#dc2626' }}>*</span></label>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {availableSegs.map((s, _i) => {
                              const on = newVeh.segment_ids.includes(s.id);
                              return (
                                <button key={s.id || _i} type="button"
                                  onClick={() => setNewVeh(v => ({
                                    ...v,
                                    segment_ids: on ? v.segment_ids.filter(x => x !== s.id) : [...v.segment_ids, s.id],
                                  }))}
                                  style={{ padding: '5px 14px', borderRadius: 20, border: `1.5px solid ${on ? 'var(--primary)' : 'var(--border)'}`, background: on ? 'rgba(22,185,148,0.12)' : 'var(--bg)', color: on ? 'var(--primary)' : 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                                  {s.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* 2W specific: CC Category */}
                  {newVehIs2W && (
                    <div>
                      <label className="ca-lbl">CC Category</label>
                      <MiniSearchSelect
                        value={newVeh.cc_category_id}
                        onChange={v => setNewVeh(x => ({ ...x, cc_category_id: v }))}
                        placeholder="Select CC category…"
                        options={ccCats.map((c, _i) => ({ value: c.id ?? `fallback-${_i}`, label: c.name }))}
                      />
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="ca-btn-outline" onClick={() => { setShowAddVeh(false); setError(''); }}>Back</button>
                    <button className="ca-btn-primary" style={{ flex: 1 }} onClick={saveNewVehicle}>Save & Continue</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: APPOINTMENT DETAILS ── */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Context strip */}
              <div className="ca-info-strip" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <User size={12} /> {selectedCust?.customer_name} · {selectedCust?.mobile}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Car size={12} /> {vehLabel}
                  {isVeh2W
                    ? <span className="apptv-chip apptv-chip--cc" style={{ fontSize: 10 }}>2W</span>
                    : <span className="apptv-chip apptv-chip--type" style={{ fontSize: 10 }}>4W</span>}
                </div>
              </div>

              {/* Hub */}
              <div>
                <label className="ca-lbl">Hub</label>
                <select className="ca-select" value={apptForm.hub_id} onChange={e => onHubChange(e.target.value)}>
                  <option value="">— Select hub —</option>
                  {hubs
                    .filter(h => {
                      const is2W = selectedVeh?.vehicle_type_name?.toLowerCase().includes('two') || selectedVeh?.vehicle_type_name?.toLowerCase().includes('2');
                      const vc = h.vehicle_class;
                      if (!vc || vc === 'both') return true;
                      return is2W ? vc === '2W' : vc === '4W';
                    })
                    .map(h => <option key={h.id} value={h.id}>{h.hub_name}{h.city_name ? ` — ${h.city_name}` : ''}</option>)}
                </select>
              </div>

              {/* Date + Time */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label className="ca-lbl">Date <span style={{ color: '#dc2626' }}>*</span></label>
                  <input type="date" className="ca-input" value={apptForm.scheduled_date}
                    onChange={e => setApptForm(f => ({ ...f, scheduled_date: e.target.value }))} />
                </div>
                <div>
                  <label className="ca-lbl">Time (optional)</label>
                  <input type="time" className="ca-input" value={apptForm.scheduled_time}
                    onChange={e => setApptForm(f => ({ ...f, scheduled_time: e.target.value }))} />
                </div>
              </div>

              {/* ── Pickup ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--bg-soft,#f8fafc)', border: '1.5px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <MapPin size={11} /> Pickup
                </div>

                {/* Visit ——[toggle]—— Pickup Required */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: !apptForm.pickup_required ? 'var(--text)' : 'var(--text-muted)' }}>Visit</span>
                  <button type="button"
                    onClick={() => setApptForm(f => ({ ...f, pickup_required: !f.pickup_required, pickup_address_line1: '', pickup_address_line2: '', pickup_city: '', pickup_pincode: '', pickup_maps_link: '', pickup_scheduled_date: '', pickup_scheduled_time: '' }))}
                    className={`ea-toggle${apptForm.pickup_required ? ' ea-toggle--on' : ''}`}>
                    <span className="ea-toggle-knob" />
                  </button>
                  <span style={{ fontSize: 13, fontWeight: 600, color: apptForm.pickup_required ? 'var(--text)' : 'var(--text-muted)' }}>Pickup Required</span>
                </div>

                {apptForm.pickup_required && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 4 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <label className="ca-lbl">Pickup Date</label>
                        <input type="date" className="ca-input"
                          value={apptForm.pickup_scheduled_date}
                          onChange={e => setApptForm(f => ({ ...f, pickup_scheduled_date: e.target.value }))} />
                      </div>
                      <div>
                        <label className="ca-lbl">Pickup Time</label>
                        <input type="time" className="ca-input"
                          value={apptForm.pickup_scheduled_time}
                          onChange={e => setApptForm(f => ({ ...f, pickup_scheduled_time: e.target.value }))} />
                      </div>
                    </div>
                    <div>
                      <label className="ca-lbl">Address Line 1 <span style={{ color: '#dc2626' }}>*</span></label>
                      <input className="ca-input" placeholder="Flat / Building / Street"
                        value={apptForm.pickup_address_line1}
                        onChange={e => setApptForm(f => ({ ...f, pickup_address_line1: e.target.value }))} />
                    </div>
                    <div>
                      <label className="ca-lbl">Address Line 2</label>
                      <input className="ca-input" placeholder="Landmark / Area (optional)"
                        value={apptForm.pickup_address_line2}
                        onChange={e => setApptForm(f => ({ ...f, pickup_address_line2: e.target.value }))} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <label className="ca-lbl">City</label>
                        <input className="ca-input" placeholder="City"
                          value={apptForm.pickup_city}
                          onChange={e => setApptForm(f => ({ ...f, pickup_city: e.target.value }))} />
                      </div>
                      <div>
                        <label className="ca-lbl">Pincode</label>
                        <input className="ca-input" placeholder="6-digit pincode" maxLength={6}
                          value={apptForm.pickup_pincode}
                          onChange={e => setApptForm(f => ({ ...f, pickup_pincode: e.target.value.replace(/\D/g, '') }))} />
                      </div>
                    </div>
                    <div>
                      <label className="ca-lbl">Google Maps Link</label>
                      <input className="ca-input" placeholder="https://maps.google.com/..."
                        value={apptForm.pickup_maps_link}
                        onChange={e => setApptForm(f => ({ ...f, pickup_maps_link: e.target.value }))} />
                    </div>
                  </div>
                )}
              </div>

              {/* Services picker */}
              {apptForm.hub_id && (
                <div>
                  <label className="ca-lbl">Services</label>
                  <div className="ca-svc-picker">
                    {/* Selected services */}
                    {apptServices.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
                        {apptServices.map((s, _idx) => (
                          <span key={s.id || _idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, background: 'rgba(22,185,148,0.12)', color: 'var(--primary)', fontSize: 12, fontWeight: 600 }}>
                            {s.name}
                            {s.price > 0 && <span style={{ fontWeight: 700, color: 'var(--primary-hover)' }}>₹{Number(s.price).toLocaleString('en-IN')}</span>}
                            <button type="button" onClick={() => setApptServices(prev => prev.filter(x => x.id !== s.id))}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', padding: 0, lineHeight: 1, display: 'flex' }}>
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Search */}
                    <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      <input
                        value={svcSearch}
                        onChange={e => setSvcSearch(e.target.value)}
                        placeholder="Search services…"
                        style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13, width: '100%', color: 'var(--text)' }}
                      />
                    </div>
                    <div style={{ display: 'flex', minHeight: 120 }}>
                      {/* Categories */}
                      {!svcSearch && (
                        <div style={{ width: 130, borderRight: '1px solid var(--border)', overflowY: 'auto', flexShrink: 0 }}>
                          {hubSvcLoading
                            ? <div style={{ padding: '10px', fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>
                            : hubCategories.map((cat, _idx) => (
                              <button key={cat.id || _idx} type="button" onClick={() => setSelectedCatId(cat.id)}
                                style={{ width: '100%', textAlign: 'left', padding: '8px 10px', background: selectedCatId === cat.id ? 'var(--primary-light,rgba(22,185,148,0.10))' : 'transparent', border: 'none', borderLeft: selectedCatId === cat.id ? '3px solid var(--primary)' : '3px solid transparent', cursor: 'pointer', fontSize: 12, fontWeight: selectedCatId === cat.id ? 700 : 400, color: selectedCatId === cat.id ? 'var(--primary)' : 'var(--text)' }}>
                                {cat.name}
                              </button>
                            ))}
                        </div>
                      )}
                      {/* Services list */}
                      <div style={{ flex: 1, overflowY: 'auto' }}>
                        {hubSvcLoading ? (
                          <div style={{ padding: '20px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>Loading services…</div>
                        ) : pickerServices.length === 0 ? (
                          <div style={{ padding: '20px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                            {svcSearch ? 'No services found' : hubCategories.length === 0 ? 'No services assigned to this hub' : '← Select a category'}
                          </div>
                        ) : pickerServices.map((svc, _idx) => {
                          const isOn = apptServices.some(s => s.id === svc.service_id);
                          return (
                            <button key={svc.service_id || _idx} type="button"
                              onClick={() => toggleService(svc)}
                              style={{ width: '100%', textAlign: 'left', padding: '8px 12px', background: isOn ? '#f0fdf4' : 'transparent', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, color: 'var(--text)' }}>
                              <span>{svc.name}</span>
                              {isOn
                                ? <CheckCircle2 size={14} style={{ color: '#16a34a', flexShrink: 0 }} />
                                : <Plus size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="ca-lbl">Notes (optional)</label>
                <textarea className="ca-input" rows={2} style={{ resize: 'vertical' }}
                  placeholder="Any notes for this appointment…"
                  value={apptForm.notes}
                  onChange={e => setApptForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="ca-ftr">
          {step > 1 && (
            <button className="ca-btn-outline" onClick={() => { setStep(s => s - 1); setError(''); }}>
              ← Back
            </button>
          )}
          <button className="ca-btn-outline" onClick={onClose} style={{ marginLeft: step === 1 ? 'auto' : 0 }}>
            Cancel
          </button>
          {step === 3 && (
            <button className="ca-btn-primary" onClick={submitAppointment} disabled={saving}>
              {saving ? 'Saving…' : '✓ Create Appointment'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AppointmentsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const isHubUser = !!user?.hub_id;          // hub portal user
  const canEdit = useCan('EDIT_APPOINTMENT');
  // Fix #20: split into two separate permission checks — they gate unrelated actions
  // canCreate is kept for future "New Appointment" button; canCreateInv is used in ViewModal
  const canCreate = useCan('CREATE_APPOINTMENT');
  const [appts, setAppts] = useState([]);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState({}); // { status_id: count } for mobile tabs
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusList, setStatusList] = useState([]);
  const [hubs, setHubs] = useState([]);
  const [usersList, setUsersList] = useState([]);

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  // Hub users are locked to their own hub — pre-fill from user object.
  // Multi-select like the Estimates page's hub filter — array of hub-id strings.
  const [filterHub, setFilterHub] = useState(() => user?.hub_id ? [String(user.hub_id)] : []);
  const [showHubDropdown, setShowHubDropdown] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterCreatedBy, setFilterCreatedBy] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [showFilters, setShowFilters] = useState(true); // mobile funnel toggle
  const [modal, setModal] = useState(null); // null | { mode: 'view', appt }
  const [createModal, setCreateModal] = useState(false);
  const [editAppt, setEditAppt] = useState(null); // appt being edited
  const [toast, setToast] = useState(null);
  const searchTimer = useRef(null);

  // Load statuses + hubs + users once
  useEffect(() => {
    Promise.all([
      api('/api/appointment-statuses'),
      api('/api/hubs?is_active=true&limit=200'),
      api('/api/users/assignable'),
    ])
      .then(([sr, hr, ur]) => {
        setStatusList(sr.items || []);
        setHubs(hr.items || []);
        setUsersList(ur.items || []);
      })
      .catch(() => { });
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ page, limit: pageSize });
      if (search) qs.set('search', search);
      if (filterStatus) qs.set('status_id', filterStatus);
      if (filterHub.length > 0) qs.set('hub_ids', filterHub.join(','));
      if (dateFrom) qs.set('date_from', dateFrom);
      if (dateTo) qs.set('date_to', dateTo);
      if (filterCreatedBy) qs.set('created_by_id', filterCreatedBy);
      const r = await api(`/api/appointments?${qs}`);
      setAppts(r.items || []);
      setTotal(r.total || 0);
      const counts = {};
      for (const sc of r.status_counts || []) counts[sc.status_id] = sc.count;
      setStatusCounts(counts);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [search, filterStatus, filterHub, dateFrom, dateTo, filterCreatedBy, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  // Open a specific appointment modal when navigated from Customer Profile
  useEffect(() => {
    const openApptId = location.state?.openApptId;
    if (!openApptId) return;
    // Clear state so refresh doesn't re-open
    window.history.replaceState({}, '');
    api(`/api/appointments/${openApptId}`)
      .then(r => { if (r.item) setModal({ mode: 'view', appt: r.item }); })
      .catch(() => { });
  }, [location.state?.openApptId]);

  function handleSearchChange(v) {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setSearch(v); setPage(1); }, 350);
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  function handleUpdated(item) {
    setAppts(prev => prev.map(a => a.id === item.id ? item : a));
    if (modal?.mode === 'view') setModal({ mode: 'view', appt: item });
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="appt-page">
      {toast && (
        <div className={`appt-toast appt-toast--${toast.type}`}>
          <CheckCircle2 size={14} /> {toast.msg}
        </div>
      )}

      <header className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={20} /> Appointments
          </h2>
          <p>Track and manage all customer appointments.</p>
        </div>
        {canCreate && !isHubUser && (
          <button
            onClick={() => setCreateModal(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 20px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(8,145,178,.3)', transition: 'background .12s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--primary-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--primary)'}
          >
            <Plus size={15} /> New Appointment
          </button>
        )}
      </header>

      {error && <div className="banner error">{error}</div>}

      {/* Filters — wrappers use display:contents on desktop so the layout
          there is unchanged; on mobile they become rows per the design. */}
      <div className="appt-filters">
        <div className="appt-search-row">
          <div className="appt-search-wrap">
            <Search size={14} className="appt-search-icon" />
            <input className="appt-search" placeholder="Search customer, vehicle, mobile no…"
              onChange={e => handleSearchChange(e.target.value)} />
          </div>
          <button
            type="button"
            className={`appt-filter-toggle ${showFilters ? 'appt-filter-toggle--on' : ''}`}
            onClick={() => setShowFilters(v => !v)}
            title="Show / hide filters"
          >
            <Filter size={15} />
          </button>
        </div>
        <div className={`appt-filter-row ${showFilters ? '' : 'appt-filter-row--collapsed'}`}>
          <select className="appt-filter-sel" value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value); setPage(1); }}>
            <option value="">All Status</option>
            {statusList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {!isHubUser && (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="appt-filter-sel"
                style={{ textAlign: 'left', background: 'var(--bg)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, minWidth: 140 }}
                onClick={() => setShowHubDropdown(p => !p)}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {filterHub.length === 0
                    ? 'All Hubs'
                    : `${filterHub.length} Hubs Selected`}
                </span>
                <ChevronDown size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
              </button>

              {showHubDropdown && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setShowHubDropdown(false)} />
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
                    background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
                    boxShadow: '0 8px 16px rgba(0,0,0,0.1)', zIndex: 1000, maxHeight: 250,
                    overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200,
                  }}>
                    {filterHub.length > 0 && (
                      <button
                        type="button"
                        style={{
                          width: '100%', padding: '6px 8px', fontSize: 12, fontWeight: 600,
                          color: 'var(--text-danger, #dc2626)', background: 'none', border: 'none',
                          textAlign: 'left', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                          paddingBottom: 8, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4,
                        }}
                        onClick={() => { setFilterHub([]); setPage(1); }}
                      >
                        <X size={12} /> Clear Selection
                      </button>
                    )}
                    {hubs.map(h => {
                      const isChecked = filterHub.includes(String(h.id));
                      return (
                        <label
                          key={h.id}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer', borderRadius: 4, userSelect: 'none' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-soft)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              const newIds = isChecked
                                ? filterHub.filter(id => id !== String(h.id))
                                : [...filterHub, String(h.id)];
                              setFilterHub(newIds);
                              setPage(1);
                            }}
                          />
                          <span style={{ fontSize: 13, color: 'var(--text)' }}>{h.hub_name}</span>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
          <select className="appt-filter-sel" value={filterCreatedBy}
            onChange={e => { setFilterCreatedBy(e.target.value); setPage(1); }}>
            <option value="">All Created By</option>
            {usersList.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <div className="appt-date-range">
            <input type="date" className="appt-filter-sel" value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setPage(1); }}
              title="From date" style={{ minWidth: 140 }} />
            <span className="appt-date-dash">–</span>
            <input type="date" className="appt-filter-sel" value={dateTo}
              onChange={e => { setDateTo(e.target.value); setPage(1); }}
              title="To date" style={{ minWidth: 140 }} />
          </div>
        </div>
      </div>

      {/* Status tabs — mobile only (hidden on desktop via CSS) */}
      <div className="appt-tabs">
        <button
          className={`appt-tab ${!filterStatus ? 'appt-tab--active' : ''}`}
          onClick={() => { setFilterStatus(''); setPage(1); }}
        >
          All
          <span className="appt-tab-count">
            {Object.values(statusCounts).reduce((s, n) => s + n, 0)}
          </span>
        </button>
        {statusList.filter(s => (statusCounts[s.id] || 0) > 0).map(s => (
          <button
            key={s.id}
            className={`appt-tab ${String(filterStatus) === String(s.id) ? 'appt-tab--active' : ''}`}
            onClick={() => { setFilterStatus(String(s.id)); setPage(1); }}
          >
            {s.name}
            <span className="appt-tab-count">{statusCounts[s.id]}</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card" style={{ overflowX: 'auto' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table appt-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Customer</th>
                <th>Vehicle</th>
                <th>Hub</th>
                <th>Schedule</th>
                <th>Totals</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j}><div className="appt-skel" /></td>
                    ))}
                  </tr>
                ))
              ) : appts.length === 0 ? (
                <tr>
                  <td colSpan="7">
                    <div className="appt-empty">
                      <Calendar size={36} style={{ opacity: .2, marginBottom: 10 }} />
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>No appointments found</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {search || filterStatus || filterHub.length > 0 || dateFrom || dateTo || filterCreatedBy
                          ? 'Try adjusting your filters.'
                          : 'Appointments appear here when leads are converted.'}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : appts.map(a => {
                const statusCfg = statusList.find(s => s.id === a.status_id);
                return (
                  <tr key={a.id} className="appt-row-clickable"
                    onClick={() => setModal({ mode: 'view', appt: a })}>
                    <td>
                      <span className="appt-id-badge">{a.id}</span>
                      {a.lead_id && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Lead #{a.lead_id}</div>}
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{fmtDate(a.created_at)}</div>
                    </td>
                    <td>
                      <div
                        className="appt-cust-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate('/customers', { state: { openMobile: a.mobile } });
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }} className="appt-cust-name">{a.customer_name || '—'}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{a.mobile}</div>
                          {(() => {
                            const tag = getScheduleTag(a.scheduled_date);
                            return tag ? (
                              <div style={{ marginTop: 4 }}>
                                <span style={{
                                  fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                                  background: tag.bg, color: tag.color, textTransform: 'uppercase',
                                  lineHeight: 1, display: 'inline-block'
                                }}>{tag.text}</span>
                              </div>
                            ) : null;
                          })()}
                        </div>
                        <span className="appt-cust-arrow">→</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {a.vehicle_number || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontWeight: 400 }}>No number</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                        {[a.make_name, a.model_name].filter(Boolean).join(' ') || '—'}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: 13, fontWeight: 400 }}>{a.hub_name || '—'}</div>
                      {a.created_by_name && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          By: {a.created_by_name}
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtDate(a.scheduled_date)}</div>
                      {a.scheduled_time && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Clock size={10} /> {fmtTime(a.scheduled_time)}
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, minWidth: 100 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                          <span style={{ color: 'var(--text-muted)' }}>Booking:</span>
                          <span style={{ fontWeight: 600 }}>₹{Number(a.total_price || 0).toLocaleString('en-IN')}</span>
                        </div>
                        {a.estimate_id && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                            <span
                              style={{ color: '#4f46e5', cursor: 'pointer', textDecoration: 'underline' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate('/estimates', { state: { openId: a.estimate_id } });
                              }}
                            >
                              Estimate:
                            </span>
                            <span style={{ fontWeight: 600 }}>₹{Number(a.estimate_total || 0).toLocaleString('en-IN')}</span>
                          </div>
                        )}
                        {a.invoice_id && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                            <span
                              style={{ color: '#0f766e', cursor: 'pointer', textDecoration: 'underline' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate('/customer-invoices', { state: { openId: a.invoice_id } });
                              }}
                            >
                              Invoice:
                            </span>
                            <span style={{ fontWeight: 700, color: '#0f766e' }}>₹{Number(a.invoice_total || 0).toLocaleString('en-IN')}</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td onClick={e => e.stopPropagation()} style={{ position: 'relative', paddingRight: 36 }}>
                      <ApptStatusSelect
                        apptId={a.id}
                        current={statusCfg}
                        statusList={statusList}
                        onChange={handleUpdated}
                        pickupRequired={a.pickup_required}
                        pickupTimestamp={a.pickup_timestamp}
                        estimateStatus={a.estimate_status}
                        invoiceId={a.invoice_id}
                        invoiceStatus={a.invoice_status}
                        showToast={showToast}
                      />
                      {canEdit && statusCfg?.name !== 'Invoice Approved' && (
                        <button className="appt-icon-btn appt-icon-btn--edit appt-row-action-hover" title="Edit"
                          onClick={async () => {
                            try {
                              const r = await api(`/api/appointments/${a.id}`);
                              setEditAppt(r.item);
                            } catch {
                              setEditAppt(a);
                            }
                          }}
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                    </td>

                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Card list — mobile only (hidden on desktop via CSS) */}
        <div className="appt-cards">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="appt-card"><div className="appt-skel" style={{ width: '100%', height: 56 }} /></div>
            ))
          ) : appts.length === 0 ? (
            <div className="appt-empty">
              <Calendar size={36} style={{ opacity: .2, marginBottom: 10 }} />
              <div style={{ fontWeight: 600, marginBottom: 4 }}>No appointments found</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {search || filterStatus || filterHub.length > 0 || dateFrom || dateTo
                  ? 'Try adjusting your filters.'
                  : 'Appointments appear here when leads are converted.'}
              </div>
            </div>
          ) : appts.map(a => {
            const statusCfg = statusList.find(s => s.id === a.status_id);
            const created = a.created_at
              ? new Date(a.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
              : '';
            return (
              <div key={a.id} className="appt-card" onClick={() => setModal({ mode: 'view', appt: a })}>
                <div className="appt-card-left">
                  {(() => {
                    const tag = getScheduleTag(a.scheduled_date);
                    return tag ? (
                      <span style={{
                        fontSize: 8, fontWeight: 850, padding: '2px 4px', borderRadius: 4,
                        background: tag.bg, color: tag.color, textTransform: 'uppercase',
                        lineHeight: 1, display: 'inline-block', marginBottom: 2
                      }}>{tag.text}</span>
                    ) : null;
                  })()}
                  <span className="appt-id-badge">{a.id}</span>
                  <span className="appt-card-created">{created}</span>
                </div>
                <div className="appt-card-main">
                  <div className="appt-card-name">{a.customer_name || 'Unknown'}</div>
                  <div className="appt-card-vehline">
                    <span className="appt-card-vehno">{a.vehicle_number || 'No number'}</span>
                    <span className="appt-card-model">
                      {[a.make_name, a.model_name].filter(Boolean).join(' ')}
                    </span>
                  </div>
                  <div className="appt-card-meta">
                    <div className="appt-card-meta-row"><MapPin size={11} /> {a.hub_name || '—'}</div>
                    <div className="appt-card-meta-row">
                      <Calendar size={11} /> {fmtDate(a.scheduled_date) || '—'}
                      {a.scheduled_time && (
                        <span className="appt-card-time"><Clock size={11} /> {fmtTime(a.scheduled_time)}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="appt-card-right" onClick={e => e.stopPropagation()}>
                  <div className="appt-card-price" onClick={() => setModal({ mode: 'view', appt: a })}>
                    ₹{Number(a.invoice_id ? a.invoice_total : (a.estimate_id ? a.estimate_total : a.total_price) || 0).toLocaleString('en-IN')}
                  </div>
                  <ApptStatusSelect
                    apptId={a.id}
                    current={statusCfg}
                    statusList={statusList}
                    onChange={handleUpdated}
                    pickupRequired={a.pickup_required}
                    pickupTimestamp={a.pickup_timestamp}
                    estimateStatus={a.estimate_status}
                    invoiceId={a.invoice_id}
                    invoiceStatus={a.invoice_status}
                    showToast={showToast}
                  />
                </div>
                <ChevronRight size={16} className="appt-card-chev" />
              </div>
            );
          })}
        </div>

        <PaginationBar
          page={page} total={total} pageSize={pageSize}
          onPage={setPage}
          onPageSize={n => { setPageSize(n); setPage(1); }}
          noun="appointment"
        />
      </div>

      {createModal && (
        <CreateAppointmentModal
          hubs={hubs}
          statusList={statusList}
          onClose={() => setCreateModal(false)}
          onCreated={newAppt => {
            showToast('Appointment created!');
            setAppts(prev => [newAppt, ...prev]);
            setTotal(t => t + 1);
          }}
        />
      )}

      {modal?.mode === 'view' && !editAppt && (
        <ViewModal
          appt={modal.appt}
          statusList={statusList}
          onClose={() => setModal(null)}
          onUpdated={handleUpdated}
          onEdit={appt => setEditAppt(appt)}
        />
      )}

      {editAppt && (
        <EditAppointmentModal
          appt={editAppt}
          hubs={hubs}
          onClose={() => setEditAppt(null)}
          onSaved={item => {
            handleUpdated(item);
            setEditAppt(null);
            showToast('Appointment updated!');
          }}
        />
      )}
    </div>
  );
}
