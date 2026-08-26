import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useSearchParams, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useCan, useAuth } from '../auth/AuthContext.jsx';
import { useBodyLock } from '../hooks/useBodyLock.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import { readListState, writeListState } from '../lib/listStatePersist.js';
import { waTarget, toNational } from '../lib/phone.js';
import { usePageCrumb } from '../lib/pageCrumbStore.js';
import WhatsAppThread from '../components/WhatsAppThread.jsx';

/**
 * The source chips, and the grouping behind them.
 *
 * ⚠️ MUST STAY IN STEP WITH leads.controller.js's `source` filter. The server
 * groups the same way for /api/leads?source=… and the CSV export; if the two
 * drift, a chip and an export of "the same" filter return different leads and
 * nobody can tell which is right.
 *
 * lead_source is free text (VARCHAR(80), no FK) with years of typed values in
 * it, so these are GROUPS rather than exact names:
 *
 *   Manual   — no source at all, or a walk-up channel. A lead typed by an
 *              advisor has no campaign behind it; that absence IS the value.
 *   Meta Ads — every spelling Facebook/Instagram traffic has arrived under.
 *   Other    — the complement, defined so a source nobody anticipated still
 *              shows up SOMEWHERE instead of being invisible under every chip.
 */
/* Website and Meta Ads are deliberately NOT chips.
   They are still first-class everywhere else — the backend still partitions on
   them, matchesSourceChip below still knows them, and both remain selectable in
   the "All Sources" dropdown in Advanced filters. What changed is only which
   ones earn a permanent seat in the strip: Website has sat at 0 since launch,
   and Meta traffic is looked at by campaign rather than as one lump.

   The consequence is worth stating because it is not obvious from the strip:
   the visible chips no longer add up to All. A Meta lead now falls under All
   and under nothing else, because `other` is defined as the complement of ALL
   FIVE original buckets, not of the three still shown. That is the honest
   behaviour — folding Meta into "Other" would silently redefine a filter people
   already use — but it does mean Meta leads are one dropdown away, not one
   click. Change `other` in leads.controller.js (sourceChipSql) if that trade
   ever stops being the right one. */
const SOURCE_CHIPS = [
  { key: 'all',      label: 'All' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'manual',   label: 'Manual' },
  { key: 'other',    label: 'Other' },
];

/* ── Who owns it — a SEPARATE axis from where it came from ───────────────────
   Not folded into SOURCE_CHIPS. Source answers "where did this come from" and
   owner answers "whose is it"; a customer can be a WhatsApp lead AND mine AND
   unassigned, and one strip of chips that mixes the two can only express one of
   those at a time. They combine instead: WhatsApp + Unassigned is the queue. */
/* ── "What happened to this lead last" ────────────────────────────────────────
   The six types leads.controller.js and appointments.controller.js actually
   write, plus note_added which the query synthesises from lead_notes. Anything
   unrecognised falls back to the raw type with underscores stripped rather than
   rendering blank — a new activity type added next year should look untidy, not
   invisible. */
function activityLabel(row) {
  const to = (row.last_activity_new || '').trim();
  switch (row.last_activity_type) {
    case 'status_changed':      return to ? `Status → ${to}` : 'Status changed';
    case 'assigned_changed':    return to ? `Assigned to ${to}` : 'Unassigned';
    case 'appointment_created': return 'Converted to appointment';
    case 'service_added':       return to ? `Service added: ${to}` : 'Service added';
    case 'service_removed':     return to ? `Service removed: ${to}` : 'Service removed';
    case 'note_added':          return to ? `Note: ${to}` : 'Note added';
    case 'created':             return 'Lead created';
    default:
      return String(row.last_activity_type || '').replace(/_/g, ' ') || '';
  }
}

/* Recent enough to be useful, old enough to be a date.
   "2h ago" answers "is this live?" without arithmetic; past two days that
   question stops mattering and the actual date is what people want. */
function timeAgo(v) {
  if (!v) return '';
  const then = new Date(v);
  if (isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then.getTime()) / 60000);

  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  if (mins < 2880) return 'yesterday';

  return then.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    ...(then.getFullYear() === new Date().getFullYear() ? {} : { year: '2-digit' }),
  });
}

const OWNER_CHIPS = [
  { key: 'all',        label: 'Everyone' },
  { key: 'mine',       label: 'Mine' },
  { key: 'unassigned', label: 'Unassigned' },
];

export function matchesOwnerChip(lead, chip, userId) {
  if (!chip || chip === 'all') return true;
  if (chip === 'unassigned')   return !lead.assigned_to;
  if (chip === 'mine')         return userId != null && Number(lead.assigned_to) === Number(userId);
  return true;
}

const META_SOURCES   = ['meta ads', 'meta', 'facebook', 'instagram', 'facebook ads', 'instagram ads', 'social media'];
const MANUAL_SOURCES = ['manual', 'walk-in', 'walk in', 'phone call', 'referral'];

export function matchesSourceChip(leadSource, chip) {
  if (!chip || chip === 'all') return true;
  const s = (leadSource || '').trim().toLowerCase();
  if (chip === 'whatsapp') return s === 'whatsapp';
  if (chip === 'website')  return s === 'website';
  if (chip === 'meta ads') return META_SOURCES.includes(s);
  if (chip === 'manual')   return s === '' || MANUAL_SOURCES.includes(s);
  if (chip === 'other')    return s !== '' && !META_SOURCES.includes(s) && !MANUAL_SOURCES.includes(s) && s !== 'whatsapp' && s !== 'website';
  return s === chip;
}
import { useListScrollRestore } from '../hooks/useListScrollRestore.js';
import { useDebouncedSearch } from '../hooks/useDebouncedSearch.js';
import { usePageSearch } from '../lib/pageSearchStore.js';
import WhatsAppSendMenu from '../components/WhatsAppSendMenu.jsx';
import '../styles/listLayout.css';
import {
  ArrowLeft,
  PlusCircle, Search, User, Calendar, MapPin, Car, Bike,
  MoreVertical, Eye, Pencil, Trash2, X, CheckCircle2,
  AlertCircle, Phone, MessageCircle, Tag, FileText,
  IndianRupee, ChevronDown, UserCheck, Wrench, Plus, Info,
  SlidersHorizontal, Bell, Clock, Send, MessageSquare, Activity, Download, Lock,
  Copy, Check, RefreshCw,
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

/* ── Lost no longer asks for a reason ──────────────────────────────────────
   LOST_REASONS and LostReasonModal lived here. Setting a lead to Lost now
   applies immediately from all three places it can be set — the edit form, the
   inline dropdown on a row, and the bulk bar — because being stopped by a
   dialog on the one status you set most often, most often in batches, cost
   more than the reason was worth.

   leads.lost_reason is NOT dropped and nothing clears it: reasons recorded
   before this still show under the lead's name and in its timeline, and a lead
   that already has one keeps it when it is edited. There is simply no longer a
   way to enter a new one, so treat the field as historical. */

/**
 * The waiting state.
 *
 * "Loading leads…" in the middle of an empty table told you a request was in
 * flight and nothing else — the header collapsed, the page jumped when rows
 * arrived, and on a slow connection it read as a broken screen rather than a
 * busy one.
 *
 * Rows of the right height and roughly the right column widths keep the layout
 * exactly where it will be, so arriving data replaces the placeholder instead
 * of shoving the page around. That is the entire point of a skeleton: not
 * decoration, but a promise about where things are going to be.
 *
 * The count matches the page size, so ten rows do not appear where three were
 * being waited for.
 */
function LeadRowsSkeleton({ rows = 10 }) {
  return Array.from({ length: rows }, (_, i) => (
    <tr key={`sk${i}`} className="lp-sk-row" aria-hidden="true">
      <td><span className="lp-sk lp-sk--chk" /></td>
      <td><span className="lp-sk" style={{ width: '70%' }} /></td>
      <td>
        <span className="lp-sk" style={{ width: '80%' }} />
        <span className="lp-sk lp-sk--sm" style={{ width: '55%' }} />
      </td>
      <td><span className="lp-sk" style={{ width: '60%' }} /></td>
      <td><span className="lp-sk" style={{ width: '75%' }} /></td>
      <td><span className="lp-sk" style={{ width: '65%' }} /></td>
      <td><span className="lp-sk lp-sk--pill" /></td>
      <td><span className="lp-sk" style={{ width: '70%' }} /></td>
      <td><span className="lp-sk" style={{ width: '55%' }} /></td>
      <td><span className="lp-sk" style={{ width: '80%' }} /></td>
      <td><span className="lp-sk" style={{ width: '60%' }} /></td>
      <td><span className="lp-sk lp-sk--chk" /></td>
    </tr>
  ));
}

/** The same idea for the phone layout, where the rows are cards. */
function LeadCardsSkeleton({ rows = 6 }) {
  return Array.from({ length: rows }, (_, i) => (
    <div key={`skc${i}`} className="lp-mobile-card lp-sk-card" aria-hidden="true">
      <span className="lp-sk" style={{ width: '45%' }} />
      <span className="lp-sk lp-sk--sm" style={{ width: '35%' }} />
      <span className="lp-sk lp-sk--pill" style={{ marginTop: 8 }} />
    </div>
  ));
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
/* Is this lead sitting on a status that records a lost reason?
 *
 * Replaces `status.toLowerCase().includes('lost')`, which was doing this job
 * in three places and getting it wrong in a fourth. That test breaks the day
 * somebody renames Lost on the Master Data screen — and it breaks silently,
 * because a reason that stops rendering looks identical to a lead that never
 * had one. */
function isLostStatus(statusName, statusList = []) {
  return !!statusList.find(s => s.name === statusName)?.needs_lost_reason;
}

/* Waiting to be called back because the car is due again — as opposed to
 * waiting because a person promised to ring. Derived from an open retarget
 * task rather than a stored flag, so it clears itself the moment somebody
 * works the lead. The API computes it; this is just the read. */
function isRetargetDue(lead) {
  return !!lead?.has_open_retarget;
}

/* Where a lead's next follow-up stands, or null when it does not have one.
 *
 * Extracted from the Next Follow-up cell, which computed it inline and was the
 * only thing that knew. Three callers now — that cell, the mobile card, and the
 * row rail — and three copies of a date comparison is three chances for the
 * badge to say Today while the rail says Overdue.
 *
 * The two guards are the cell's own and are load-bearing:
 *   is_converted  the lead became an appointment; the follow-up belongs to that
 *   is_locked     a Lost lead's retarget task is dated months out, and calling
 *                 it a pending follow-up would put a green badge on every
 *                 closed lead in the list
 */
function followUpState(lead, statusList = []) {
  if (!lead?.next_follow_up_date || lead.is_converted) return null;
  if (statusList.find(s => s.name === lead.status)?.is_locked) return null;
  const d = new Date(lead.next_follow_up_date);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  return { diff, isOverdue: diff < 0, isToday: diff === 0, isTomorrow: diff === 1, date: d };
}

/* The 3px rail down the left edge of a row.
 *
 * ── Why not one tone per condition ──────────────────────────────────────────
 *
 * There is one rail and a lead can satisfy several conditions at once, so this
 * is a priority list rather than a set of independent flags. The order is the
 * order somebody should deal with them:
 *
 *   overdue   a promise that has already been broken
 *   today     a promise about to be
 *   retarget  an opportunity, and one that keeps until somebody gets to it
 *
 * ── Why a future follow-up gets NO rail ─────────────────────────────────────
 *
 * Most leads in a worked pipeline have a follow-up scheduled for some future
 * date. Railing those means most rows are striped, and a marker that appears on
 * most rows marks nothing — it becomes background texture and the overdue ones
 * stop standing out, which is the entire job. The green badge in the Next
 * Follow-up column already says "this is in hand".
 */
function rowRailTone(lead, statusList = []) {
  const fu = followUpState(lead, statusList);
  if (fu?.isOverdue) return 'overdue';
  if (fu?.isToday)   return 'today';
  if (isRetargetDue(lead)) return 'retarget';
  return null;
}

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
function ViewLeadModal({ leadId, onClose, onEdit, canEdit, canAssign, statusList = [], onLeadLoaded, onOpenConvert, crumbToken }) {
  // useBodyLock STAYS, but it is no longer what holds this still. The detail is
  // a layer over the LIST inside .content — not over the viewport — so the
  // thing that actually had to be stopped was .page-scroll, which is this
  // layer's containing block: let it scroll and the whole detail slides off the
  // top. That is done in CSS (.page-scroll:has(.lp-vp)). This call remains as
  // the outermost belt: on a browser without :has(), body scroll is still
  // pinned.
  useBodyLock();
  useEscapeClose(onClose);
  // Phone only — ignored above the breakpoint, where both panes are visible.
  const [paneTab, setPaneTab] = useState('details');
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

  // Pulled out of the effect so the header's status control can call it after a
  // change. Re-reading rather than patching `lead` locally is deliberate: a
  // status change can also write a lost reason, a follow-up or an appointment,
  // and a local patch would show the new badge above stale everything-else.
  const reloadLead = useCallback(() => {
    return api(`/api/leads/${leadId}`)
      .then(r => { setLead(r.item); onLeadLoaded?.(r.item); })
      .catch(e => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onLeadLoaded is a
    // stable URL-sync callback, not a data dependency.
  }, [leadId]);

  useEffect(() => {
    setLoading(true);
    reloadLead().finally(() => setLoading(false));
  }, [leadId, reloadLead]);

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

  /* The topbar crumb would otherwise print the raw route token
     ("Home › Leads › iiz1678qZI9yrA"), which identifies nothing to a human.
     Publish the customer's mobile instead — the field this team actually
     recognises a lead by. Same mechanism the invoice, estimate and customer
     pages already use, so the crumb behaves identically across the app
     (lib/pageCrumbStore.js).

     toNational() strips whatever shape the number was stored in — 91-prefixed,
     0-prefixed, spaced — so the crumb reads the same for every lead. An
     unparseable number falls through to the raw string rather than showing
     nothing, and a missing one leaves the token in place. */
  /* The people this lead can be handed to. Fetched only when the viewer can
     actually reassign — a caller without ASSIGN_LEAD would be asking the
     server for a staff list it will never show. */
  const [agents, setAgents] = useState([]);
  useEffect(() => {
    if (!canAssign) return;
    let alive = true;
    api('/api/users/assignable')
      .then(r => { if (alive) setAgents(r.items || []); })
      .catch(() => { /* the badge still renders; only the dropdown is empty */ });
    return () => { alive = false; };
  }, [canAssign]);

  const crumbMobile = (() => {
    const national = toNational(lead?.mobile);
    if (national) return `+91 ${national}`;
    return lead?.mobile || null;
  })();
  usePageCrumb(crumbToken, crumbMobile);

  return (
    <div className="lp-vp">
      <div className="lp-vp-inner">

        {/* ── Page header ──────────────────────────────────────────────────
            No breadcrumb here any more. It had one — "Leads › <token>" — from
            when this layer covered the entire viewport and the app's own
            topbar was hidden behind it. The topbar is visible again and
            already renders "Home › Leads › <token>" for exactly this route, so
            an identical trail one line below it is the same sentence twice.

            What stays is what the topbar does NOT say: the way back, and the
            status. */}
        {/* The split now starts ABOVE the header, not below it. The WhatsApp
            rail is a full-height sidebar: it runs from the very top of the
            panel down, and the header, tabs and cards are stacked inside the
            left column beside it.

            It used to be the other way round — header across the full width,
            split underneath — which cost the conversation the header's height
            and made the chat start lower than everything else on screen. */}
        <div className={`lp-vp-split lp-vp-split--${paneTab}`}>
        <div className="lp-vp-left">

        <div className="lp-vm-header lp-vp-header">
          <div className="lp-vm-header-left">
            <button className="lp-vp-back" onClick={onClose} title="Back to Leads">
              <ArrowLeft size={15} />
            </button>
            <span className="lp-vp-title">{lead?.name || (lead ? lead.mobile : 'Lead')}</span>
            {/* The status, changeable in place.
                StatusInlineSelect, not a second dropdown written for this
                header — it is the same control the leads LIST uses, and it
                already carries everything a status change actually involves:
                asking for a Lost reason, opening the appointment form for a
                converts_to_appointment status, logging a call, scheduling a
                follow-up. A plain <select> here would look identical and
                silently skip all four.

                Only the CONVERTED case is guarded here. A locked status is
                already handled inside the component — it renders its own
                padlocked badge with the reason — and duplicating that check
                would mean two places to keep in step. Converted is different:
                the component has no way to know a lead became an appointment,
                because that is a fact about the lead, not about its status. */}
            {lead && (lead.is_converted
              ? <StatusBadge status={lead.status} statusList={statusList} />
              : (
                <StatusInlineSelect
                  leadId={lead.id}
                  leadName={lead.name || lead.mobile}
                  current={lead.status}
                  statusList={statusList}
                  onOpenConvert={onOpenConvert}
                  onChange={reloadLead}
                />
              ))}
          </div>
          <div className="lp-vm-header-actions">
            {canEdit && lead && !lead.is_converted && (
              <button className="lp-vm-edit-btn" onClick={() => onEdit(lead)}>
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
            {/* Distinct from the wa.me button in the contact card below. That
                one opens YOUR WhatsApp with this person's chat and logs
                nothing; this one queues an approved template through the
                business account and records what was sent and whether it
                arrived — the difference between chasing a lead and being able
                to show you chased it.

                Which templates it offers is the server's answer: the ones
                mapped to entity_type 'lead' and enabled in Settings. */}
            {lead?.id && <WhatsAppSendMenu entityType="lead" entityId={lead.id} />}
            <button className="lp-modal-close" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        {/* Two columns cannot stack on a phone — the chat would end up far
            below the notes and nobody would scroll to it. Tabs instead, and
            only below the breakpoint (the bar is display:none on desktop). */}
        <div className="lp-vp-tabs">
          <button className={paneTab === 'details' ? 'on' : ''} onClick={() => setPaneTab('details')}>
            Details
          </button>
          <button className={paneTab === 'chat' ? 'on' : ''} onClick={() => setPaneTab('chat')}>
            <MessageCircle size={13} /> WhatsApp
          </button>
        </div>

        <div className="lp-modal-body lp-vm-body lp-vp-main">
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
                  {/* waTarget adds the country code, which this link was
                      missing entirely — wa.me/9876543210 resolves to nothing.
                      Returns null for numbers WhatsApp cannot reach, and the
                      button is then hidden rather than rendered broken. */}
                  {waTarget(lead) && (
                    <a className="lp-vm-btn lp-vm-btn--wa"
                      href={waTarget(lead)}
                      target="_blank" rel="noreferrer">
                      <MessageCircle size={15} /> WhatsApp
                    </a>
                  )}
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
                      {/* Reassign in place for anyone holding ASSIGN_LEAD.
                          Everyone else — including people who can edit the
                          lead — keeps the read-only badge. */}
                      {canAssign ? (
                        <AssigneeInlineSelect
                          leadId={lead.id}
                          current={lead.assigned_to ?? null}
                          currentName={lead.assigned_to_name}
                          agents={agents}
                          onChange={reloadLead}
                        />
                      ) : lead.assigned_to_name
                        ? <span className="lp-assigned-badge"><UserCheck size={11} /><span className="lp-assigned-name">{lead.assigned_to_name}</span></span>
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
                  {lead.lost_competitor_name && (
                    <div className="lp-vm-info-row">
                      <span className="lp-vm-info-label">Lost To</span>
                      <span className="lp-vm-info-val">
                        {lead.lost_competitor_name}
                        {lead.competitor_service_date && (
                          <span className="lp-muted">
                            {' · serviced '}{new Date(lead.competitor_service_date).toLocaleDateString()}
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                  {/* The consequence, stated where somebody looking at the lead
                      will see it. A status that quietly schedules something
                      three months out is the kind of thing people find by
                      accident. */}
                  {lead.retarget_due_date && (
                    <div className="lp-vm-info-row">
                      <span className="lp-vm-info-label">Comes Back</span>
                      <span className="lp-vm-info-val lp-retarget-pill">
                        <RefreshCw size={11} /> {new Date(lead.retarget_due_date).toLocaleDateString()}
                      </span>
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
        </div>{/* /.lp-vp-left */}

        {/* ── WhatsApp rail ────────────────────────────────────────────────
            Beside the detail, not inside it. Keyed by the NUMBER rather than
            the lead id: the thread is one continuous exchange with a person
            that happens to touch this lead. whatsapp first, mobile as the
            fallback — the same precedence utils/phone.js resolveTarget uses.

            It stays put while the left column scrolls, and stays visible while
            the Edit modal is open on top, which is the whole reason this is a
            page: you can read what the customer asked for while you fill the
            form in. */}
        {lead && (
          <aside className="lp-vp-rail">
            <WhatsAppThread
              mobile={lead.whatsapp || lead.mobile}
              /* This page already knows the lead, so the template button in the
                 closed bar does not have to wait for the thread request to tell
                 it. The Customer page has no such id and falls back to the
                 conversation's resolved lead. */
              entityType="lead"
              entityId={lead.id}
            />
          </aside>
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
          /* Flag, not name match — see the status onChange above. */
          lost_reason: statusList.find(s => s.name === form.status)?.needs_lost_reason
            ? (form.lost_reason || null) : null,
          lost_competitor_id:      actionData?.lost_competitor_id ?? undefined,
          competitor_service_date: actionData?.competitor_service_date ?? undefined,
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

                      /* No Lost branch any more — it falls through to the
                         same flags every other status obeys. If somebody has
                         ticked "logs call" or "needs follow-up" on Lost in
                         Settings, it opens that modal like any other status
                         would; untick them there to make it fully instant. */
                      if (statusObj?.converts_to_appointment && onOpenConvert) {
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
                      } else if (statusObj?.logs_call || statusObj?.needs_follow_up || statusObj?.needs_lost_reason) {
                        setActionModal({
                          statusName: newSt,
                          logsCall: !!statusObj.logs_call,
                          needsFollowUp: !!statusObj.needs_follow_up,
                          needsLostReason: !!statusObj.needs_lost_reason,
                        });
                      } else {
                        /* Keeping or clearing the reason is decided by the
                           FLAG, not by whether the status name happens to
                           contain the word "lost". The old test cleared the
                           field the moment somebody renamed Lost — silently,
                           and it was destroying data rather than just
                           displaying it wrong. */
                        setForm(f => ({ ...f, status: newSt, lost_reason: statusObj?.needs_lost_reason ? f.lost_reason : '' }));
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
                        /* The column is 160px with ellipsis truncation, so a
                           long name like "Denting and Painting" is still cut
                           horizontally. The tooltip is how you read the rest. */
                        title={c.name}
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
      {actionModal && (
        <StatusActionModal
          statusName={actionModal.statusName}
          leadName={lead.name || lead.mobile}
          logsCall={actionModal.logsCall}
          needsFollowUp={actionModal.needsFollowUp}
          needsLostReason={actionModal.needsLostReason}
          onConfirm={data => {
            // The reason now comes back FROM the dialog rather than being
            // blanked here — blanking it was correct while nothing could
            // supply one, and is data loss now that something can.
            setForm(f => ({ ...f, status: actionModal.statusName, lost_reason: data.lost_reason || '' }));
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
/* ── The one dialog every status behaviour opens ─────────────────────────────
 *
 * Three optional sections — call log, lost reason, follow-up — composed from
 * the flags on the status being set. One dialog rather than three because a
 * status can carry more than one flag, and being asked three times in a row is
 * how people learn to click through without reading.
 *
 * ── Why nothing is pre-selected in the reason list ──────────────────────────
 *
 * The call-outcome chips default to the first item, which is fine: "Connected"
 * is the common case and being wrong about it costs nothing. A lost reason
 * defaulted the same way means every rushed Lost inherits whatever happens to
 * sit at the top of the list — and that is worse than a blank, because a blank
 * is visibly missing while a wrong reason looks like somebody chose it. The
 * marketing spend is tuned on these.
 */
function StatusActionModal({
  statusName, leadName, logsCall, needsFollowUp, needsLostReason,
  /* false in bulk. One competitor can honestly describe fifty leads lost to
     the workshop down the road; one service DATE cannot — those fifty cars
     were not all done on the same Tuesday. Bulk therefore asks who and lets
     the API count the retarget from today. */
  allowServiceDate = true,
  onConfirm, onCancel,
}) {
  useBodyLock();
  useEscapeClose(onCancel);
  const [outcome, setOutcome]     = useState('');
  const [callNotes, setCallNotes] = useState('');
  const [date, setDate]           = useState('');
  const [time, setTime]           = useState('09:00');
  const [note, setNote]           = useState('');
  const [error, setError]         = useState('');
  const [outcomes, setOutcomes]   = useState([]);

  // Lost reason
  const [reasons, setReasons]         = useState([]);
  const [reason, setReason]           = useState('');   // deliberately blank — see above
  const [competitors, setCompetitors] = useState([]);
  const [competitorId, setCompetitorId] = useState('');
  const [serviceDate, setServiceDate] = useState('');

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

  /* Both lists in one effect and both guarded on the same flag: the competitor
     list is only ever needed by a reason that requires one, and fetching it
     for every follow-up dialog would be a request per status change. */
  useEffect(() => {
    if (!needsLostReason) return;
    api('/api/lost-reasons').then(r => setReasons(r.items || [])).catch(() => { });
    api('/api/competitors').then(r => setCompetitors(r.items || [])).catch(() => { });
  }, [needsLostReason]);

  const reasonObj  = reasons.find(r => r.name === reason) || null;
  const wantsComp  = !!reasonObj?.requires_competitor;
  const wantsDate  = wantsComp && allowServiceDate;
  const today      = new Date().toISOString().split('T')[0];

  /* What the agent is about to cause, in words, before they cause it.
     Month arithmetic done by hand because `setMonth` turns 30 November into
     2 March — the same trap the API avoids by doing it in Postgres, which
     clamps. Display only: the real date is stamped server-side, and this is
     just here so nobody is surprised in three months. */
  const retargetPreview = (() => {
    const months = reasonObj?.retarget_after_months;
    if (!months) return null;
    const anchor = (wantsDate && serviceDate) ? new Date(`${serviceDate}T00:00:00`)
                 : allowServiceDate ? null : new Date();
    if (!anchor || isNaN(anchor)) return null;
    const y = anchor.getFullYear(), m = anchor.getMonth(), d = anchor.getDate();
    const lastOfTarget = new Date(y, m + months + 1, 0).getDate();
    const due = new Date(y, m + months, Math.min(d, lastOfTarget));
    return due.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  })();

  function handleConfirm() {
    if (needsLostReason && !reason) { setError('Please pick a reason.'); return; }
    if (wantsComp && !competitorId)  { setError('Please choose which competitor took the job.'); return; }
    if (wantsDate && !serviceDate)   { setError('Please add the date they did the service — the retarget is counted from it.'); return; }
    if (serviceDate && serviceDate > today) { setError('The service date cannot be in the future.'); return; }
    if (needsFollowUp && !date) { setError('Please select a follow-up date.'); return; }
    onConfirm({
      ...(logsCall ? { call_outcome: outcome, call_notes: callNotes || null } : {}),
      ...(needsLostReason ? {
        lost_reason: reason,
        lost_competitor_id: wantsComp ? Number(competitorId) : null,
        ...(wantsDate ? { competitor_service_date: serviceDate } : {}),
      } : {}),
      ...(needsFollowUp ? { follow_up_date: date, follow_up_time: time, note } : {}),
    });
  }

  const fieldStyle = { width: '100%', padding: '8px 12px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 13, background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box', outline: 'none' };
  const labelStyle = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 };
  const dividerStyle = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' };

  /* Section headers only earn their space when there is more than one section
     to tell apart. With a single section the dialog title already says what
     this is. */
  const multi = [logsCall, needsLostReason, needsFollowUp].filter(Boolean).length > 1;

  const title = [
    logsCall        && 'Log Call',
    needsLostReason && 'Mark as Lost',
    needsFollowUp   && 'Schedule Follow-up',
  ].filter(Boolean).join(' & ') || 'Update Status';

  const confirmLabel = needsLostReason ? 'Save & Update Status'
    : logsCall && needsFollowUp ? 'Save & Update Status'
      : logsCall ? 'Log Call & Update Status'
        : 'Save Follow-up';

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
            <div style={{ marginBottom: multi ? 18 : 0 }}>
              {multi && <div style={dividerStyle}>📞 Call Log</div>}
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

          {/* ── Lost Reason Section ──
              The chips reuse .lr-reason-btn, which never left LeadsPage.css
              when the old LostReasonModal was deleted. Same control, same
              red — this is the same question being asked again, better. */}
          {needsLostReason && (
            <div style={{ marginBottom: needsFollowUp ? 18 : 0 }}>
              {multi && <div style={{ ...dividerStyle, color: '#b91c1c' }}>🚫 Lost Reason</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Reason <span style={{ color: '#dc2626' }}>*</span></label>
                  {reasons.length === 0 ? (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      No reasons configured. Add them in Settings → Master Data → Lost Reasons.
                    </span>
                  ) : (
                    <div className="lr-reasons">
                      {reasons.map(r => (
                        <button key={r.id} type="button"
                          className={`lr-reason-btn${reason === r.name ? ' lr-reason-btn--active' : ''}`}
                          onClick={() => { setReason(r.name); setError(''); }}>
                          {r.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Only for a reason that says it needs them, so the common
                    case stays two clicks. */}
                {wantsComp && (
                  <>
                    <div>
                      <label style={labelStyle}>Which competitor <span style={{ color: '#dc2626' }}>*</span></label>
                      {competitors.length === 0 ? (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          No competitors on the list yet. Add them in Settings → Master Data → Competitors.
                        </span>
                      ) : (
                        <select className="lp-input" value={competitorId} style={fieldStyle}
                          onChange={e => { setCompetitorId(e.target.value); setError(''); }}>
                          <option value="">Select…</option>
                          {competitors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      )}
                    </div>
                    {allowServiceDate && (
                      <div>
                        <label style={labelStyle}>Date they did the service <span style={{ color: '#dc2626' }}>*</span></label>
                        <input type="date" value={serviceDate} max={today}
                          onChange={e => { setServiceDate(e.target.value); setError(''); }}
                          style={fieldStyle} />
                      </div>
                    )}
                  </>
                )}

                {/* Says the consequence out loud. A status change that quietly
                    schedules something three months out is the kind of thing
                    people discover by accident. */}
                {retargetPreview && (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                    ⟳ This lead comes back automatically on <strong style={{ color: 'var(--text)' }}>{retargetPreview}</strong>
                    {allowServiceDate ? '' : ' — counted from today, because a bulk change has no single service date'}.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── Follow-up Section ── */}
          {needsFollowUp && (
            <div>
              {multi && <div style={dividerStyle}>📅 Follow-up</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Follow-up Date <span style={{ color: '#dc2626' }}>*</span></label>
                  <input type="date" value={date} min={today}
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
          <button className="lr-btn-confirm" onClick={handleConfirm}>{confirmLabel}</button>
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
    // Lost is no longer intercepted — it takes the same path as any other
    // status and saves straight away.
    // 1. Intercept "converts_to_appointment" flag — open appointment form
    if (statusObj?.converts_to_appointment) {
      setOpen(false);
      onOpenConvert?.({ statusName: name, leadId, leadName, saveFn: save });
      return;
    }
    // 2. Intercept logs_call / needs_follow_up / needs_lost_reason — one modal
    if (statusObj?.logs_call || statusObj?.needs_follow_up || statusObj?.needs_lost_reason) {
      setOpen(false);
      setActionModal({
        statusName: name,
        logsCall: !!statusObj.logs_call,
        needsFollowUp: !!statusObj.needs_follow_up,
        needsLostReason: !!statusObj.needs_lost_reason,
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
      /* From the dialog. `lostReason` is the older positional argument and is
         still honoured — the convert-to-appointment path passes null through
         it — so the dialog's value wins when both are present. */
      if (meta.lost_reason) body.lost_reason = meta.lost_reason;
      if (meta.lost_competitor_id) body.lost_competitor_id = meta.lost_competitor_id;
      if (meta.competitor_service_date) body.competitor_service_date = meta.competitor_service_date;
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
      {actionModal && (
        <StatusActionModal
          statusName={actionModal.statusName}
          leadName={leadName}
          logsCall={actionModal.logsCall}
          needsFollowUp={actionModal.needsFollowUp}
          needsLostReason={actionModal.needsLostReason}
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

/* ── Reassign a lead from the detail view, without opening the Edit form ─────
   The Edit form does far more than this — every field on the lead — and
   reassigning is the one change a caller makes constantly. Making them open a
   full form, change one dropdown and save is three interactions and a chance
   to bump something else on the way past.

   Deliberately NOT gated on EDIT_LEAD. Reassignment has its own permission
   (ASSIGN_LEAD) precisely because "may correct a customer's phone number" and
   "may move this lead to another caller" are different authorities — a team
   lead usually holds the second without the first. The caller passes canAssign
   from useCan('ASSIGN_LEAD') alone; without it this renders the plain badge
   the page has always shown and nothing is clickable.

   Same shape as StatusInlineSelect above — portal dropdown, outside-click and
   scroll to close, position flipped upward when the row sits low on screen —
   so the two controls on this card behave identically. */
function AssigneeInlineSelect({ leadId, current, currentName, agents = [], onChange }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef(null);
  const dropRef = useRef(null);

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
      /* +1 for the Unassigned row. Same 38px-per-row estimate the status
         dropdown uses, so both flip upward at the same point on a short
         window. */
      const dropHeight = Math.min((agents.length + 1) * 38 + 8, 300);
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

  async function pick(userId) {
    // Picking the person already assigned is a no-op, not a write — it would
    // otherwise post an assigned_changed activity row saying nothing changed.
    if (userId === (current ?? null)) { setOpen(false); return; }
    setBusy(true);
    setOpen(false);
    try {
      await api(`/api/leads/${leadId}`, {
        method: 'PATCH',
        body: { assigned_to: userId },
      });
      onChange?.();
    } catch (e) {
      alert(e.message || 'Could not reassign this lead.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={busy}
        onClick={toggle}
        className="lp-assign-trigger"
        title="Reassign this lead"
      >
        {currentName
          ? <span className="lp-assigned-badge"><UserCheck size={11} /><span className="lp-assigned-name">{currentName}</span></span>
          : <span className="lp-muted">Unassigned</span>}
        <ChevronDown
          size={11}
          style={{ flexShrink: 0, opacity: 0.6, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropRef}
          className="lp-status-portal"
          style={{ top: pos.top, bottom: pos.bottom, left: pos.left, minWidth: pos.width }}
        >
          <button
            className={`lp-dropdown-item${!current ? ' lp-dropdown-item--current' : ''}`}
            onClick={() => pick(null)}
          >
            <span style={{ flex: 1, opacity: 0.7 }}>Unassigned</span>
            {!current && <CheckCircle2 size={13} style={{ flexShrink: 0 }} />}
          </button>
          {agents.map(a => (
            <button
              key={a.id}
              className={`lp-dropdown-item${a.id === current ? ' lp-dropdown-item--current' : ''}`}
              onClick={() => pick(a.id)}
            >
              <UserCheck size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
              <span style={{ flex: 1 }}>{a.name}</span>
              {a.id === current && <CheckCircle2 size={13} style={{ flexShrink: 0 }} />}
            </button>
          ))}
        </div>,
        document.body,
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
  /* Its own permission, checked on its own. Reassigning is not a subset of
     editing — see AssigneeInlineSelect. */
  const canAssign = useCan('ASSIGN_LEAD');
  const canDelete = useCan('DELETE_LEAD');
  const canExport = useCan('EXPORT_LEADS');
  const canViewReports = useCan('VIEW_REPORTS');
  const canViewLead = useCan('VIEW_LEAD');
  // The Mine chip needs to know who "me" is.
  const { user: currentUser } = useAuth();
  const canViewTeam = useCan('VIEW_TEAM_LEADS');

  // Stage Velocity: visible to anyone who can see beyond own leads (reporting/team/all)
  const showStageVelocity = canViewReports || canViewLead || canViewTeam;

  // Remember page/pageSize/filters across a full navigation away and back
  // (e.g. opening a linked appointment/estimate, then clicking "Leads" in
  // the sidebar) — sessionStorage survives the unmount a route change to a
  // different page causes; plain useState does not.
  const listStateRef = useRef(readListState('sp_leads_list_v1'));
  const ls = listStateRef.current;

  const [pageSize, setPageSize] = useState(ls.pageSize ?? 10);

  const [leads, setLeads] = useState([]);
  const [leadsScope, setLeadsScope] = useState('all');
  /* What the server says about the WHOLE result, not the page in `leads`.
     Held separately because that is exactly the distinction the old code did
     not have to make — `leads` was everything, so a count over it was a count
     over everything. It is now ten rows, and a chip counting those would read
     "Follow-Up 3" on a pipeline of four hundred. */
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ status: {}, assignee: {}, source: {} });
  const [totalValue, setTotalValue] = useState(0);
  const [statusList, setStatusList] = useState([]);
  const [leadSources, setLeadSources] = useState(LEAD_SOURCES); // default to const; overridden by API
  const [stageStats, setStageStats] = useState([]);
  const [showVelocity, setShowVelocity] = useState(false);
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
  const [page, setPage] = useState(ls.page ?? 1);

  // Basic filters — seed from global search URL param (?search=) first, then
  // fall back to the last-persisted value for this page.
  // Seeded from ?search= first (the old global header search navigated here
  // with it) then from the last-persisted value.
  //
  // NOTE: this list filters and paginates CLIENT-side, so unlike the invoice
  // lists the debounce saves no queries — it only stops a re-render per
  // keystroke over the full lead array. The minimum-length guard is skipped for
  // the same reason: there is no expensive query to protect, and a one-letter
  // filter over already-loaded rows is instant.
  const { input: searchInput, setInput: setSearchInput, search } =
    useDebouncedSearch(searchParams.get('search') || ls.search || '', { minChars: 1 });
  const setSearch = setSearchInput;
  const [statusFilters, setStatusFilters] = useState(ls.statusFilters ?? []); // multi-select array
  // Assignee filter — multi-select array, same pattern as statusFilters.
  // 'unassigned' is a pseudo-value alongside real assignee ids (as strings).
  const [assigneeFilters, setAssigneeFilters] = useState(ls.assigneeFilters ?? []);
  const [creatorFilter, setCreatorFilter] = useState(ls.creatorFilter ?? '');
  const [statusDDOpen, setStatusDDOpen] = useState(false);
  const [assigneeDDOpen, setAssigneeDDOpen] = useState(false);

  const statusDDRef = useRef(null);
  const assigneeDDRef = useRef(null);

  // Advanced filters panel
  const [showAdv, setShowAdv] = useState(false);
  const [dateFrom, setDateFrom] = useState(ls.dateFrom ?? '');
  const [dateTo, setDateTo] = useState(ls.dateTo ?? '');
  const [fState, setFState] = useState(ls.fState ?? '');
  const [fCity, setFCity] = useState(ls.fCity ?? '');
  const [fArea, setFArea] = useState(ls.fArea ?? '');
  const [fVType, setFVType] = useState(ls.fVType ?? '');
  const [fMake, setFMake] = useState(ls.fMake ?? '');
  const [fModel, setFModel] = useState(ls.fModel ?? '');
  const [fSource, setFSource] = useState(ls.fSource ?? '');
  // The broad source chips. Separate from fSource, which is an EXACT source
  // name from the Advanced dropdown — the two answer different questions and
  // combining them into one control would lose the narrow one.
  const [sourceChip, setSourceChip] = useState(ls.sourceChip ?? 'all');
  const [ownerChip, setOwnerChip]   = useState(ls.ownerChip ?? 'all');

  // Persist whenever any of these change
  useEffect(() => {
    writeListState('sp_leads_list_v1', {
      page, pageSize, search, statusFilters, assigneeFilters, creatorFilter,
      dateFrom, dateTo, fState, fCity, fArea, fVType, fMake, fModel, fSource, sourceChip, ownerChip,
    });
  }, [page, pageSize, search, statusFilters, assigneeFilters, creatorFilter,
      dateFrom, dateTo, fState, fCity, fArea, fVType, fMake, fModel, fSource, sourceChip, ownerChip]);

  useListScrollRestore('sp_leads_list_v1', !loading);

  // Copy-to-clipboard for the mobile column. Holds the lead id, not a boolean,
  // so the tick appears on the row that was actually clicked.
  //
  // navigator.clipboard needs a secure context — it is simply absent on a plain
  // http:// origin, which is how the API-keys Copy button ended up doing
  // nothing visible. The execCommand fallback is deprecated but still works
  // everywhere and covers exactly that case.
  const [copiedMobile, setCopiedMobile] = useState(null);
  const copyMobile = useCallback(async (mobile, id) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(mobile);
      } else {
        const ta = document.createElement('textarea');
        ta.value = mobile;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setCopiedMobile(id);
      setTimeout(() => setCopiedMobile(c => (c === id ? null : c)), 1200);
    } catch {
      /* Nothing to show but the number itself, which is already on screen. */
    }
  }, []);

  // Claim the top bar's search box. Leads open in a modal rather than an in-page
  // detail view, so there is no state in which the box should be released.
  usePageSearch({
    value: searchInput,
    onChange: setSearchInput,
    placeholder: 'Search leads by name or mobile',
  });

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
  // Bulk status change. bulkFollow holds the chosen status while the ONE
  // follow-up for the whole selection is being filled in — a status flagged
  // needs_follow_up in Settings asks for a date here exactly as it does on a
  // single lead. Every other status applies straight away.
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatusBusy, setBulkStatusBusy] = useState(false);
  const [bulkFollow, setBulkFollow] = useState(null);   // { statusName }

  // Modals
  const [viewId, setViewId] = useState(null);
  // Bumped after an edit saves. Used as part of the detail page's key so it
  // remounts and refetches — as a modal it was unmounted on Edit and
  // reloaded on reopen, which is the staleness guard that disappears the
  // moment the page stays open behind the dialog.
  const [leadRefresh, setLeadRefresh] = useState(0);
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
    // ── Only route by token when there IS one ───────────────────────────────
    //
    // Template literals stringify null, so `/leads/${null}` is the four
    // characters "null" — a perfectly valid-looking URL that renders "null" in
    // the breadcrumb and 404s on /api/leads/by-token/null. Two populations of
    // rows still hit this: anything created before migration 085 (which added
    // the column and never backfilled) and every lead ever created by Bulk
    // Upload (which never set it). Migration 165 repairs both, and this guard
    // is what stops a future null becoming a broken URL again.
    //
    // With no token the record still opens — setViewId above does that — the
    // URL simply stays put rather than becoming a link that goes nowhere.
    if (l.public_token) navigate(`/leads/${l.public_token}`);
  }

  function closeLead() {
    closedRef.current = true;
    resolvedTokenRef.current = null;
    // Cleared HERE, not left to the `[token]` effect — that effect only clears
    // when `resolvedTokenRef.current` is still set, and the line above has just
    // nulled it. Without this the lead stays open with the URL already back at
    // /leads. See the same comment in CustomersPage.
    setViewId(null);
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
    // "null" and "undefined" are the STRINGS a template literal makes from a
    // missing token. They are truthy, so `!token` never caught them, and the
    // effect happily asked the API for a lead whose token is "null". Treated
    // as no token at all — which is what they are — so an old bookmarked
    // /leads/null stops producing a 404 in the console.
    const real = token && token !== 'null' && token !== 'undefined' ? token : null;
    if (!real) { setViewId(null); resolvedTokenRef.current = null; return; }
    if (resolvedTokenRef.current === real) return; // already opening/open
    closedRef.current = false;
    resolvedTokenRef.current = real;
    api(`/api/leads/by-token/${real}`)
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

  /* Escape closes the filters modal.
     It stopped being a dropdown, and a dropdown is dismissed by clicking
     anywhere — a modal covers the page, so the only ways out are the ones we
     provide. The backdrop and the two buttons are two of them; this is the
     third, and it is the one people reach for without thinking. */
  useEffect(() => {
    if (!showAdv) return;
    const onKey = e => { if (e.key === 'Escape') setShowAdv(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showAdv]);

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

  // Close status/assignee dropdowns on outside click
  useEffect(() => {
    function handler(e) {
      if (statusDDRef.current && !statusDDRef.current.contains(e.target)) setStatusDDOpen(false);
      if (assigneeDDRef.current && !assigneeDDRef.current.contains(e.target)) setAssigneeDDOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /**
   * One page, from the server.
   *
   * This used to be `api('/api/leads')` — every lead the user could see, in one
   * response, with the browser doing the filtering, the counting and the paging
   * on the array it was handed. At four thousand leads that is six to ten
   * megabytes on every visit and every refresh, to show ten rows.
   *
   * So the filters travel INSTEAD of the leads. Every piece of state below is
   * something the browser used to compare in JavaScript and now sends as a
   * query parameter; the response carries the page, the total, and the chip
   * counts — which have to come from the server because a count taken from ten
   * rows is a number out of ten, rendered with total confidence.
   *
   * Arrays are joined rather than repeated as `status=a&status=b`: Express
   * hands a repeated key back as an array only SOMETIMES (once for one value,
   * an array for two), and a server that has to check which it got is a server
   * that will one day get it wrong.
   */
  /* ── Pages already seen ─────────────────────────────────────────────────────
     Keyed by the exact query string that produced them, so a key covers the
     page number AND every filter — two different filter sets can never collide
     on the same page number.

     This is a cache of what to SHOW WHILE WAITING, not a substitute for
     fetching. Every visit still issues the request; the cached rows just fill
     the screen instantly instead of a skeleton, and are replaced the moment
     the response lands. That distinction is why there is no invalidation logic
     anywhere below: nothing can go permanently stale when every view is
     revalidated as it is opened.

     It matters here more than it would elsewhere, because the server never
     broadcasts lead changes — there is no 'leads' socket topic — so this
     request is the ONLY thing that ever refreshes the list. A plain cache
     would have left rows stale until the user changed a filter. */
  const leadsCache = useRef(new Map());
  const LEADS_CACHE_LIMIT = 20;

  /* Which request is allowed to write to state. Clicking through pages faster
     than the network answers means several are in flight at once, and they can
     come back out of order — without this, page 2's rows can land after page
     3's and leave the table showing the wrong page. */
  const leadsReq = useRef(0);

  /* Every mutation on this page patches the visible `leads` array in place
     rather than refetching — which is right, it is instant — but it leaves the
     cached copy of that page holding the pre-change rows.

     Revalidation would correct it within a moment either way. The reason to
     drop the cache explicitly is what that moment looks like: navigate away
     from a lead you just deleted and back, and the deleted row reappears for
     an instant. Self-correcting or not, that reads as "the delete failed".

     Cheap enough to be unsubtle about — clear everything, not just the page
     that changed. A bulk status change can move rows across page boundaries,
     so working out which entries are still valid costs more than refetching. */
  const invalidateLeadsCache = useCallback(() => {
    leadsCache.current.clear();
  }, []);

  const applyLeadsResponse = useCallback((r) => {
    setLeads(r.items || []);
    setTotal(r.total ?? 0);
    setCounts(r.counts || { status: {}, assignee: {}, source: {}, owner: {} });
    setAssignees(r.assignees || []);
    setCreators(r.creators || []);
    setTotalValue(r.total_value ?? 0);
    setLeadsScope(r.scope || 'all');
  }, []);

  const loadLeads = useCallback(async () => {
    {
      const qs = new URLSearchParams();
      qs.set('page', String(page));
      qs.set('page_size', String(pageSize));

      if (search)                 qs.set('search', search);
      if (statusFilters.length)   qs.set('status', statusFilters.join(','));
      if (assigneeFilters.length) qs.set('assignee', assigneeFilters.join(','));
      if (creatorFilter)          qs.set('creator', creatorFilter);
      if (dateFrom)               qs.set('date_from', dateFrom);
      if (dateTo)                 qs.set('date_to', dateTo);
      if (fState)                 qs.set('state', fState);
      if (fCity)                  qs.set('city', fCity);
      if (fArea)                  qs.set('area', fArea);
      if (fVType)                 qs.set('vehicle_type', fVType);
      if (fMake)                  qs.set('make', fMake);
      if (fModel)                 qs.set('model', fModel);
      // The dropdown is an exact stored name; the chip is a GROUP of names.
      // Two parameters because they are two different questions and can both
      // be asked at once.
      if (fSource)                qs.set('source_exact', fSource);
      if (sourceChip && sourceChip !== 'all') qs.set('source', sourceChip);
      if (ownerChip && ownerChip !== 'all')   qs.set('owner', ownerChip);

      const key = qs.toString();
      const cached = leadsCache.current.get(key);

      /* Seen before: paint it now. The skeleton is for a view we genuinely
         have nothing for — showing it over rows we already hold is the flicker
         this whole change exists to remove. */
      if (cached) {
        applyLeadsResponse(cached);
        setLoading(false);
      } else {
        setLoading(true);
      }

      // Selection is per page. Carrying ids across a page change would let a
      // bulk action hit rows nobody can currently see. Cleared here, on the
      // key change — NOT when a response arrives, or the background refresh
      // would silently drop a selection the user just made.
      setSelectedLeads(new Set());

      const seq = ++leadsReq.current;
      try {
        const r = await api(`/api/leads?${key}`);
        if (seq !== leadsReq.current) return;   // a newer request owns the table

        // delete-then-set moves the entry to the end, so the eviction below
        // drops the least recently USED page rather than the oldest fetched.
        leadsCache.current.delete(key);
        leadsCache.current.set(key, r);
        if (leadsCache.current.size > LEADS_CACHE_LIMIT) {
          leadsCache.current.delete(leadsCache.current.keys().next().value);
        }

        applyLeadsResponse(r);
        setError('');
      } catch (e) {
        if (seq !== leadsReq.current) return;
        /* A failed refresh over rows that are already on screen is not worth
           blanking the table for — the user keeps what they had. Only a view
           with nothing behind it reports the error. */
        if (!cached) setError(e.message);
      } finally {
        if (seq === leadsReq.current) setLoading(false);
      }
    }
    /* Every filter is a dependency, which is what makes the effect below the
       ONLY place a refetch is triggered. The alternative — calling loadLeads()
       from each filter's onChange — is fifteen call sites to keep in step, and
       the one that gets forgotten is a filter that silently does nothing. */
  }, [page, pageSize, search, statusFilters, assigneeFilters, creatorFilter,
      dateFrom, dateTo, fState, fCity, fArea, fVType, fMake, fModel, fSource,
      sourceChip, ownerChip, applyLeadsResponse]);

  useEffect(() => { loadLeads(); }, [loadLeads]);
  /* A new lead invalidates every cached page — it shifts every row after it by
     one. Drop the cache before refetching so the list cannot flash its
     pre-creation self on the way. */
  useEffect(() => {
    const onCreated = () => { invalidateLeadsCache(); loadLeads(); };
    window.addEventListener('lead-created', onCreated);
    return () => window.removeEventListener('lead-created', onCreated);
  }, [loadLeads, invalidateLeadsCache]);

  /* The assignee dropdown's options come from the server now.
     Derived from `leads` they were derived from ONE PAGE — the dropdown would
     offer whoever happened to appear on page one and silently hide everybody
     else, so filtering by an agent stopped being possible the moment they had
     no recent lead. */
  const [assignees, setAssignees] = useState([]);
  const [creators, setCreators] = useState([]);

  /* Was derived from `leads` — the rows currently on screen. That made the
     dropdown's contents depend on the page you happened to be looking at, and
     the control itself appear and vanish as you filtered, because it was only
     rendered when the derived list was non-empty. Worse, a creator filter
     could stay APPLIED after the control disappeared, leaving the list
     narrowed by something with no visible way to switch it off.

     The server sends the list now, exactly as it already did for assignees,
     and for the same reason. See `creators` in leads.controller.js. */


  // Count active advanced filters
  const advCount = [dateFrom, dateTo, fState, fCity, fArea, fVType, fMake, fModel, fSource, creatorFilter].filter(Boolean).length;

  function clearAdvanced() {
    setDateFrom(''); setDateTo('');
    setFState(''); setFCity(''); setFArea('');
    setFVType(''); setFMake(''); setFModel('');
    setFSource('');
    // Counted in advCount, so it has to be cleared by the same button — or
    // "Clear filters" leaves the badge showing 1 and the list still narrowed.
    setCreatorFilter('');
  }

  // Multi-select assignee match — 'unassigned' is a pseudo-value alongside
  // real assignee ids (as strings), same shape as statusFilters above.
  function matchesAssigneeFilter(l) {
    if (!assigneeFilters.length) return true;
    if (!l.assigned_to) return assigneeFilters.includes('unassigned');
    return assigneeFilters.includes(String(l.assigned_to));
  }

  /* ── The filtering used to happen HERE ──────────────────────────────────
     A fifteen-condition `leads.filter(...)` ran on every render over the whole
     array. It is gone: the same fifteen conditions are now query parameters,
     and `leads` IS the page the server chose.

     Keeping a client-side pass "just in case" would be worse than either
     option alone — two implementations of one rule, disagreeing on the day
     somebody edits one of them, with the browser silently hiding rows the
     server counted. */
  const paginated = leads;

  // Reset to page 1 whenever filters change — but not on the initial mount,
  // otherwise this would immediately stomp on a page number just restored
  // from sessionStorage (see listStateRef above).
  const skipFirstPageReset = useRef(true);
  useEffect(() => {
    if (skipFirstPageReset.current) { skipFirstPageReset.current = false; return; }
    setPage(1);
  }, [search, statusFilters, assigneeFilters, creatorFilter, dateFrom, dateTo, fState, fCity, fArea, fVType, fMake, fModel, fSource, sourceChip]);

  /* Counts come from the response. All three sets, plus the value.

     They deliberately have different bases, mirroring what this page always
     did: the status counts follow the assignee filter (picking an agent
     re-counts their statuses — that is the point of the combination), while
     the source and assignee counts ignore the current filter entirely, because
     they are the way IN to a filter and would otherwise show zero on every
     chip you have not already clicked. */
  /* "No leads yet" and "nothing matches" are different sentences, and the old
     code told them apart with `leads.length === 0` — which was the whole set.
     It is now the page, so an empty page would always claim the business has no
     leads at all. The filters themselves are the honest test. */
  const hasAnyFilter = Boolean(
    search || statusFilters.length || assigneeFilters.length || creatorFilter ||
    dateFrom || dateTo || fState || fCity || fArea || fVType || fMake || fModel ||
    fSource || (sourceChip && sourceChip !== 'all') || (ownerChip && ownerChip !== 'all')
  );

  const newLeadCount = counts.status?.__new__ || 0;
  const statusCounts = counts.status || {};
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
    invalidateLeadsCache();
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
    invalidateLeadsCache();
    setEditLead(null);
    // Refetch the open detail page. Without this the page sitting behind the
    // dialog keeps showing the values from before the save.
    setLeadRefresh(n => n + 1);
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

  /* ── Bulk status change ────────────────────────────────────────────────────
     What the selection bar's Status control offers, and what it deliberately
     leaves out.

     A status that CONVERTS TO AN APPOINTMENT is not offered. Choosing it for
     one lead opens the appointment form — vehicle, service, date — and there is
     no sane way to fill that in once for a selection of twenty. The server
     refuses it too; this list is what stops anybody getting that far.

     A status that NEEDS A FOLLOW-UP is offered and asks for one — a single
     date, time and note, written to every lead that moved. "Chase all of
     these on Tuesday" is one decision, so one answer is the honest shape of
     it, and skipping the question (which is what this used to do) meant the
     flag was quietly ignored on exactly the batches where a chased list
     matters most.

     A status that LOGS A CALL is offered and does NOT ask. A call outcome
     describes one conversation; there is no answer that is true of twenty. The
     status still moves and the timeline still records it — you add the call
     notes per lead as you make the calls, which is the only place they mean
     anything. A status with both flags asks for the follow-up only.

     A LOST status DOES ask, and is the exception the paragraph above is not.
     A reason genuinely can be true of a whole selection — "we lost this batch
     to the workshop that opened down the road" is one fact about twenty leads,
     which is exactly what a call outcome is not. The competitor comes with it
     when the reason wants one; the service DATE does not, because twenty cars
     were not all serviced on the same Tuesday, and the API counts the retarget
     from today instead. */
  const bulkStatusOptions = statusList.filter(s => !s.converts_to_appointment);

  /* The second argument is whatever StatusActionModal collected — a follow-up,
     a lost reason and competitor, or both. One bag rather than two positional
     parameters, because the dialog decides what it asked for and this function
     should not have to know. */
  async function applyBulkStatus(statusName, extra = null) {
    const followUp = extra;
    setBulkStatusBusy(true);
    setBulkStatusOpen(false);
    try {
      const body = { lead_ids: [...selectedLeads], status: statusName };
      if (followUp?.follow_up_date) {
        body.follow_up_date = followUp.follow_up_date;
        body.follow_up_time = followUp.follow_up_time || '09:00';
        // `note` is what StatusActionModal calls it; the API calls it
        // follow_up_note. Renamed here rather than in either of them, because
        // the modal is shared with the single-lead path that sends `note`.
        if (followUp.note) body.follow_up_note = followUp.note;
      }
      /* No competitor_service_date, deliberately — see the comment above
         bulkStatusOptions. The API anchors the retarget on today when none
         arrives, and says so in its own comment. */
      if (extra?.lost_reason) {
        body.lost_reason = extra.lost_reason;
        if (extra.lost_competitor_id) body.lost_competitor_id = extra.lost_competitor_id;
      }
      const r = await api('/api/leads/bulk-status', { method: 'POST', body });

      // Reflect it locally rather than refetching the list: the server told us
      // exactly which ids moved, so patching those is both faster and honest —
      // a lead it skipped keeps the status it actually has.
      const moved = new Set(r.ids || []);
      if (moved.size) {
        setLeads(prev => prev.map(l => (moved.has(l.id) ? { ...l, status: r.status } : l)));
        invalidateLeadsCache();
      }
      setSelectedLeads(new Set());

      // Say what was skipped. "10 selected" followed by "8 updated" with no
      // explanation is the thing that makes people stop trusting bulk actions.
      const bits = [];
      bits.push(`${r.updated} lead${r.updated !== 1 ? 's' : ''} moved to ${r.status}`);
      if (r.unchanged)         bits.push(`${r.unchanged} already there`);
      if (r.skipped_locked)    bits.push(`${r.skipped_locked} locked`);
      if (r.skipped_converted) bits.push(`${r.skipped_converted} already converted`);
      // Counted from the RESPONSE, not from what was asked for. A follow-up is
      // only written for leads that actually moved, so saying "12 scheduled"
      // because twelve were ticked would be a number nobody could reconcile.
      if (r.follow_ups)        bits.push(`follow-up set for ${r.follow_up_date}`);
      // Same rule as the follow-up count: read from the RESPONSE, so the
      // number is what was written rather than what was ticked.
      if (r.retargets)         bits.push(`back for retargeting on ${r.retarget_date}`);
      showToast(bits.join(' · '), r.updated ? 'success' : 'warning');
    } catch (e) {
      showToast(e.message || 'Could not change the status.', 'error');
    } finally {
      setBulkStatusBusy(false);
    }
  }

  return (
    /* lb-page cancels the app wrapper's padding and max-width. This page
       already set .content padding to 0 for its locked-scroll layout, so the
       only thing lb-page adds here is max-width — which is what removes the
       grey gutter on a window wider than 1400px. */
    <div className="leads-page lb-page">

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

      {/* One answer for the whole selection.

          The SAME modal the single-lead path opens, with the call half
          switched off — a call outcome describes one conversation and cannot
          describe twenty. Reusing it means the date picker, the default 09:00,
          the reason chips and every "you have not filled this in" message
          cannot drift between the two places.

          allowServiceDate={false} is the one real difference, and it is a
          statement about the data rather than the screen: twenty customers did
          not have their cars serviced on the same day, so bulk does not
          pretend to know when.

          At page level, like the convert modal, so re-rendering the list
          underneath cannot close it half-filled. */}
      {bulkFollow && (
        <StatusActionModal
          statusName={bulkFollow.statusName}
          leadName={`${selectedLeads.size} selected lead${selectedLeads.size !== 1 ? 's' : ''}`}
          logsCall={false}
          needsFollowUp={!!bulkFollow.needsFollowUp}
          needsLostReason={!!bulkFollow.needsLostReason}
          allowServiceDate={false}
          onConfirm={data => { const m = bulkFollow; setBulkFollow(null); applyBulkStatus(m.statusName, data); }}
          onCancel={() => setBulkFollow(null)}
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
      {/* No title block: the top bar's breadcrumb already names the screen, and
          Export CSV / Capture New Lead have moved into the toolbar row.

          One thing genuinely lost here: the subtitle used to say WHICH leads
          you were looking at — "Leads you have created" vs "Leads created by
          your team members". The scope now shows only in the breadcrumb, so it
          is carried on the count instead (see lb-count below). */}

      {/* ── Follow-ups ──────────────────────────────────────────────────────
          The bar that used to live here — a full-width card carrying the label,
          four date tabs and a "View all" link — is gone. It is now the single
          "Follow-up (n)" button in the chip strip below.

          Nothing was lost with it. Today / Tomorrow / This Week / Custom still
          exist, inside the drawer, which is where they were always the more
          useful control: on the bar, pressing one of them OPENED the drawer
          anyway (see the old onClick — every tab called setFuDrawerOpen(true)),
          so the bar was a second copy of a switch you could only see the result
          of somewhere else. "View all" went the same way: it opened the drawer,
          which is exactly what the label already did.

          The count on the button is today's outstanding follow-ups — fuFilter
          still defaults to 'today' — so the number means the same thing it did
          on the old badge. */}

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
                  /* "Locked" here means: this follow-up cannot go overdue,
                     because the lead is no longer waiting on anybody.

                     It used to test the two status NAMES 'Appointment
                     Scheduled' and 'Appointment Completed' — master data an
                     admin renames on a screen, at which point every converted
                     lead's follow-up starts glowing red for a chase nobody
                     owes. The flags carry the same meaning and survive a
                     rename: converts_to_appointment (it became a booking) and
                     is_closed (it is finished, however it finished). */
                  const isEvLocked = !!evStatusObj?.is_locked
                    || !!evStatusObj?.converts_to_appointment
                    || !!evStatusObj?.is_closed;
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

      {/* ── Advanced filters modal ──────────────────────────────────────────
          Rendered HERE rather than next to the button that opens it. The
          button lives inside .lb-list > .lp-filters, and a position:fixed
          child is only fixed to the viewport while no ancestor creates a
          containing block — one transform, filter or will-change anywhere up
          that chain and the overlay is positioned against the card instead,
          which looks like a layout bug and is very hard to trace back. The
          follow-ups drawer above already proves this spot works, so the modal
          shares it.

          Modal, not the panel that used to expand inline: with nine fields
          across three groups the panel pushed the table off screen on a
          laptop, so choosing a filter meant losing sight of the thing you
          were filtering. */}
      <AnimatePresence>
        {showAdv && (
          <>
            <motion.div
              className="lp-adv-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setShowAdv(false)}
            />
            <motion.div
              className="lp-adv-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Filters"
              initial={{ opacity: 0, scale: 0.97, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 10 }}
              transition={{ duration: 0.16 }}
            >
              <div className="lp-adv-modal-hdr">
                <div className="lp-adv-modal-title">
                  <SlidersHorizontal size={15} />
                  Filters
                  {advCount > 0 && <span className="lp-adv-count">{advCount}</span>}
                </div>
                <button
                  type="button"
                  className="lp-adv-modal-x"
                  onClick={() => setShowAdv(false)}
                  aria-label="Close filters"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="lp-adv-modal-body">
                {/* Date and Created By share a column. The body is an auto-fit
                    grid that lands on three columns at this width, so a fourth
                    top-level section wrapped onto a second row and left two
                    thirds of it as bare gap-coloured background.

                    Pairing them also balances the columns: Date (2 fields) plus
                    Creator (1) matches Location's three and Vehicle's three, so
                    no column is mostly empty. */}
                <div className="lp-adv-col">
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

                {/* Created by — moved here from the toolbar. Options come from
                    the server, so the list is every creator in scope rather
                    than whoever happens to be on the current page. */}
                <div className="lp-adv-section">
                  <div className="lp-adv-section-label"><User size={12} /> Created By</div>
                  <div className="lp-adv-row">
                    <div className="lp-adv-field">
                      <label>Creator</label>
                      <select className="lp-adv-input" value={creatorFilter}
                        onChange={e => setCreatorFilter(e.target.value)}>
                        <option value="">All creators</option>
                        {creators.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name}{c.count ? ` (${c.count})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                </div>{/* /.lp-adv-col */}

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

              {/* Every field applies the moment it changes — there is no Apply
                  button and there was not one before, so "Done" only dismisses.
                  Clear stays disabled at zero rather than hidden: a control
                  that appears and disappears under the cursor is worse than
                  one that is visibly unavailable. */}
              <div className="lp-adv-modal-ftr">
                <button
                  type="button"
                  className="lp-adv-modal-clear"
                  onClick={clearAdvanced}
                  disabled={advCount === 0}
                >
                  <X size={13} /> Clear filters
                </button>
                <button
                  type="button"
                  className="lp-adv-modal-done"
                  onClick={() => setShowAdv(false)}
                >
                  Done
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Analytics Panels Row ──
          Follow-up Compliance was REMOVED from this page. Not disabled behind a
          flag, not commented out: the panel, its state, its fetch and its
          permission check are all gone, so the page no longer asks
          /api/lead-events/compliance on every load. The endpoint itself is
          untouched — nothing else calls it today, but deleting an API because
          one screen stopped using it is a separate decision.

          Stage Velocity stays, and stays off behind its own `false &&`. I still
          do not know why it was disabled, and switching a panel back on without
          knowing what was wrong with it is how somebody ends up acting on a
          number that was hidden for a reason. */}
      {false && showStageVelocity && stageStats.length > 0 && (
        <div className="lp-panels-row">
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
        </div>
      )}

      {/* ── Table ──
          Full bleed: no card, no outer border or radius, horizontal dividers
          only. Plain .lb-list — the page scrolls, same as the other four. */}
      <div className="lb-list lp-table-card">

        {/* ── Where leads came from ────────────────────────────────────────
            Chips rather than another dropdown: this is the one filter people
            reach for constantly now that leads arrive on their own from
            WhatsApp, and "is this ours or did it walk in?" should be one click.

            The exact-source <select> in Advanced filters stays — it answers a
            narrower question ("only Exhibition"). These answer the broad one. */}
        <div className="lp-src-chips">
          {SOURCE_CHIPS.map(c => (
            <button
              key={c.key}
              className={`lp-src-chip${sourceChip === c.key ? ' lp-src-chip--on' : ''}`}
              onClick={() => setSourceChip(c.key)}
            >
              {c.label}
              <span className="lp-src-chip-n">
                {counts.source?.[c.key] ?? 0}
              </span>
            </button>
          ))}

          {/* ── Whose is it ───────────────────────────────────────────────
              Same strip, its own group, because it combines with the one on
              the left rather than replacing it: WhatsApp + Unassigned is the
              shared queue, which is the view somebody starting their shift
              actually wants.

              The counts respect the source chip already chosen, so the number
              on Unassigned is the number you would see if you pressed it —
              not a global total that changes the moment you do. */}
          <span className="lp-src-sep" aria-hidden="true" />
          {OWNER_CHIPS.map(c => (
            <button
              key={c.key}
              className={`lp-src-chip lp-src-chip--own${ownerChip === c.key ? ' lp-src-chip--on' : ''}`}
              onClick={() => setOwnerChip(c.key)}
            >
              {c.label}
              <span className="lp-src-chip-n">
                {counts.owner?.[c.key] ?? 0}
              </span>
            </button>
          ))}

          {/* ── Follow-up ────────────────────────────────────────────────
              Pushed to the far right by margin-left:auto, and deliberately
              NOT styled as one more chip. The chips filter the list you are
              looking at; this opens a different view entirely. Same row
              because it is the same altitude of decision — "which slice of
              leads am I working right now" — but a filled button rather than
              an outlined pill, so nothing suggests it toggles alongside them.

              It also must not read as a chip in the ON state: two of these
              lit at once, one blue-filled chip and one blue-filled button,
              would look like a single filter selection. */}
          <button
            type="button"
            className="lp-fu-pill"
            onClick={() => setFuDrawerOpen(true)}
          >
            <Bell size={13} />
            Follow-up ({visibleEvents.length})
          </button>
        </div>

        {/* ── Filters ── */}
        <div className="lp-filters">
          {/* ── Toolbar ──
              No card: controls sit directly on the page background, one row,
              actions pushed right. Shared with the four other list screens —
              see styles/listLayout.css.

              The search box moved to the top bar (usePageSearch). Unlike the
              other lists this one filters CLIENT-side, so nothing here is about
              query load — it is purely so the same control sits in the same
              place on every screen. */}
          <div className="lb-toolbar">
            {/* Status multi-select dropdown */}
            <div className="lp-status-dd-wrap" ref={statusDDRef}>
              <button
                className={`lp-status-dd-btn${statusFilters.length > 0 ? ' lp-status-dd-btn--active' : ''}`}
                style={{ minWidth: 150 }}
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
                        {statusCounts[s.name] ? <span className="lp-status-dd-count">{statusCounts[s.name]}</span> : null}
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
              <div className="lp-status-dd-wrap" ref={assigneeDDRef}>
                <button
                  className={`lp-status-dd-btn${assigneeFilters.length > 0 ? ' lp-status-dd-btn--active' : ''}`}
                  style={{ minWidth: 150 }}
                  onClick={() => setAssigneeDDOpen(v => !v)}
                >
                  <UserCheck size={13} />
                  {assigneeFilters.length === 0
                    ? 'All assignees'
                    : assigneeFilters.length === 1
                      ? (assigneeFilters[0] === 'unassigned' ? 'Unassigned' : (assignees.find(a => a.id === assigneeFilters[0])?.name || '1 assignee'))
                      : `${assigneeFilters.length} assignees`}
                  <ChevronDown size={13} style={{ marginLeft: 'auto', opacity: 0.5 }} />
                </button>
                {assigneeDDOpen && (
                  <div className="lp-status-dd-menu">
                    <div className="lp-status-dd-header">
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Filter by Assignee</span>
                      {assigneeFilters.length > 0 && (
                        <button className="lp-status-dd-clear" onClick={() => setAssigneeFilters([])}>Clear all</button>
                      )}
                    </div>
                    {(() => {
                      const checked = assigneeFilters.includes('unassigned');
                      const unassignedCount = counts.assignee?.unassigned || 0;
                      return (
                        <label className={`lp-status-dd-item${checked ? ' lp-status-dd-item--checked' : ''}`}>
                          <input type="checkbox" checked={checked} onChange={() =>
                            setAssigneeFilters(prev => checked ? prev.filter(x => x !== 'unassigned') : [...prev, 'unassigned'])
                          } />
                          <span className="lp-status-dd-name">Unassigned</span>
                          {unassignedCount > 0 && <span className="lp-status-dd-count">{unassignedCount}</span>}
                        </label>
                      );
                    })()}
                    {assignees.map(a => {
                      const checked = assigneeFilters.includes(String(a.id));
                      const count = a.count || 0;
                      return (
                        <label key={a.id} className={`lp-status-dd-item${checked ? ' lp-status-dd-item--checked' : ''}`}>
                          <input type="checkbox" checked={checked} onChange={() =>
                            setAssigneeFilters(prev => checked ? prev.filter(x => x !== String(a.id)) : [...prev, String(a.id)])
                          } />
                          <span className="lp-status-dd-name">{a.name}</span>
                          {count > 0 && <span className="lp-status-dd-count">{count}</span>}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Created by used to sit here as a toolbar dropdown that rendered
                only when the current page happened to contain creators. It
                lives in the Filters panel now — always present, never
                flickering. */}

            {/* This page already had the funnel-plus-panel pattern before the
                other lists did; it keeps its own panel and its own count. */}
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

            {/* Moved down from the page header, which is gone. */}
            <div className="lb-toolbar-right">
              {/* Carries the scope the deleted subtitle used to state — "12 of
                  my leads" reads as clearly as a heading did, and in less room. */}
              <span className="lb-count">
                {total}{' '}
                {leadsScope === 'own' ? 'of my leads' : leadsScope === 'team' ? 'team leads' : `lead${total !== 1 ? 's' : ''}`}
              </span>
              {canExport && (
                <button type="button" className="lb-control" onClick={handleExport} title="Export CSV">
                  <Download size={15} /> Export CSV
                </button>
              )}
              {canCreate && (
                <button
                  type="button"
                  className="lb-control lb-primary"
                  onClick={() => window.dispatchEvent(new Event('open-lead-modal'))}
                >
                  <PlusCircle size={15} /> Capture New Lead
                </button>
              )}
            </div>
          </div>

          {/* The advanced filters used to expand here, in the flow, pushing the
              whole table down. They are a modal now — see lp-adv-modal near the
              follow-ups drawer, rendered at the top of the tree so it shares a
              containing block with the other overlays rather than inheriting
              one from the card. */}

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
                            invalidateLeadsCache();
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

              {/* ── Change Status ──────────────────────────────────────────
                  Next to Assign To because they are the same kind of act:
                  the two things you decide about a batch of leads without
                  opening any of them. Delete is deliberately last and red —
                  it is not in that family. */}
              <div style={{ position: 'relative' }}>
                <button
                  className="lp-bulk-btn"
                  onClick={() => setBulkStatusOpen(o => !o)}
                  disabled={bulkStatusBusy}
                >
                  <Tag size={14} /> {bulkStatusBusy ? 'Updating…' : 'Change Status'} <ChevronDown size={12} />
                </button>
                {bulkStatusOpen && (
                  <div className="lp-bulk-dropdown lp-bulk-dropdown--status">
                    <div className="lp-bulk-dd-head">
                      Set status on {selectedLeads.size} lead{selectedLeads.size !== 1 ? 's' : ''}
                    </div>
                    {bulkStatusOptions.map(s => (
                      <button
                        key={s.id}
                        className="lp-bulk-dd-opt"
                        onClick={() => {
                          /* Two interceptions, both the flags' own rules
                             rather than special cases for a status name:
                             needs_follow_up means "not finished until somebody
                             says when to chase it", needs_lost_reason means
                             "not finished until somebody says why". */
                          if (s.needs_follow_up || s.needs_lost_reason) {
                            setBulkStatusOpen(false);
                            setBulkFollow({
                              statusName: s.name,
                              needsFollowUp: !!s.needs_follow_up,
                              needsLostReason: !!s.needs_lost_reason,
                            });
                            return;
                          }
                          applyBulkStatus(s.name);
                        }}
                      >
                        <span
                          className="lp-bulk-dd-dot"
                          style={{ background: s.color || '#6b7280' }}
                        />
                        {s.name}
                      </button>
                    ))}
                    {!bulkStatusOptions.length && (
                      <div className="lp-bulk-dd-empty">No statuses available.</div>
                    )}
                  </div>
                )}
              </div>

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
                        invalidateLeadsCache();
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
            <button className="lp-bulk-clear" onClick={() => { setSelectedLeads(new Set()); setBulkDeleteConfirm(false); setBulkStatusOpen(false); }}>
              Clear selection
            </button>
          </div>
        )}

        {/* ── Desktop table ── */}
        <div className="lp-table-wrap lb-scroll-x">
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
                <th><div className="th-cell">Date</div></th>
                <th><div className="th-cell">Customer</div></th>
                <th><div className="th-cell">Location</div></th>
                <th><div className="th-cell">Vehicle</div></th>
                <th><div className="th-cell">Service</div></th>
                <th>Status</th>
                <th><div className="th-cell">Assign To</div></th>
                <th><div className="th-cell">Next Follow-up</div></th>
                <th><div className="th-cell">Recent Activity</div></th>
                <th><div className="th-cell">Created By</div></th>
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {/* `loading` alone, not `loading && leads.length === 0`.
                  Every page change is now a request, so the old condition
                  showed the skeleton once on first load and then left the
                  PREVIOUS page on screen while the next one fetched — pressing
                  "next" appeared to do nothing for a second, and the row you
                  clicked was still the row you were looking at. */}
              {loading ? (
                <LeadRowsSkeleton rows={Math.min(pageSize, 10)} />
              ) : total === 0 ? (
                <tr><td colSpan="12" className="lp-empty">
                  {hasAnyFilter ? 'No leads match your filters.' : 'No leads yet. Capture your first lead!'}
                </td></tr>
              ) : paginated.map(l => (
                /* The rail is a modifier on the ordinary row rather than a
                   sort or a filter: the lead stays exactly where it belongs
                   chronologically and is simply impossible to scroll past. Each
                   tone clears itself — a follow-up marked done, a retarget task
                   closed — so nothing has to be un-set by hand. */
                <tr key={l.id}
                    className={`lp-row${selectedLeads.has(l.id) ? ' lp-row--selected' : ''}${rowRailTone(l, statusList) ? ` lp-row--rail lp-row--rail-${rowRailTone(l, statusList)}` : ''}`}
                    onClick={() => openLead(l)}>
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
                        {/* stopPropagation: the whole row opens the lead, and
                            copying a number should not also open it. */}
                        <span className="lp-mobile-line" onClick={e => e.stopPropagation()}>
                          {l.mobile}
                          {l.mobile && (
                            <button
                              type="button"
                              className="lp-copy-btn"
                              data-copied={copiedMobile === l.id ? 'true' : 'false'}
                              title={copiedMobile === l.id ? 'Copied' : 'Copy number'}
                              aria-label={`Copy ${l.mobile}`}
                              onClick={() => copyMobile(l.mobile, l.id)}
                            >
                              {copiedMobile === l.id ? <Check size={11} /> : <Copy size={11} />}
                            </button>
                          )}
                        </span>
                        <div className="lp-contact-btns" onClick={e => e.stopPropagation()}>
                          <a className="lp-contact-btn lp-contact-btn--call" href={`tel:${l.mobile}`} title="Call"><Phone size={12} /></a>
                          {/* waTarget, not a hand-built wa.me URL — the inline
                              version had no country code, so wa.me/9876543210
                              resolved to nothing. Hidden when the number is not
                              messageable, same as the detail pane. */}
                          {waTarget(l) && (
                            <a className="lp-contact-btn lp-contact-btn--wa"
                              href={waTarget(l)}
                              target="_blank" rel="noreferrer" title="WhatsApp"><MessageCircle size={12} /></a>
                          )}
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
                    {l.lost_reason && isLostStatus(l.status, statusList) && (
                      <div className="lp-lost-reason-sub">
                        {l.lost_reason}
                        {l.lost_competitor_name && <> · {l.lost_competitor_name}</>}
                      </div>
                    )}
                    {isRetargetDue(l) && (
                      <div className="lp-retarget-sub" title="This vehicle is due for service again">
                        <RefreshCw size={10} /> Due for retargeting
                      </div>
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
                    {(() => {
                      const fu = followUpState(l, statusList);
                      if (!fu) return <span className="lp-muted">—</span>;
                      const label = fu.isOverdue ? 'Overdue'
                        : fu.isToday ? 'Today'
                          : fu.isTomorrow ? 'Tomorrow'
                            : fu.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
                      const color = fu.isOverdue ? '#dc2626' : fu.isToday ? '#d97706' : '#16a34a';
                      const bg = fu.isOverdue ? '#fee2e2' : fu.isToday ? '#fef3c7' : '#dcfce7';
                      return (
                        <span className="lp-followup-badge" style={{ background: bg, color }}>
                          {fu.isOverdue && '⚠ '}{label}
                        </span>
                      );
                    })()}
                  </td>
                  {/* ── Recent Activity ──────────────────────────────────
                      The last thing that happened, from the server's LATERAL
                      over lead_activities AND lead_notes. Two lines: what, then
                      when and by whom — because "Status → Junk" without a time
                      is not an answer to "is anyone working this?". */}
                  <td>
                    {l.last_activity_at ? (
                      <div className="lp-act-cell">
                        <span className="lp-act-what" title={activityLabel(l)}>{activityLabel(l)}</span>
                        <span className="lp-act-when">
                          {timeAgo(l.last_activity_at)}
                          {l.last_activity_by && <span className="lp-act-who"> · {l.last_activity_by}</span>}
                        </span>
                      </div>
                    ) : <span className="lp-muted">—</span>}
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
          {loading && <LeadCardsSkeleton rows={Math.min(pageSize, 6)} />}
          {!loading && total === 0 && (
            <div className="lp-empty">
              {hasAnyFilter ? 'No leads match your filters.' : 'No leads yet. Capture your first lead!'}
            </div>
          )}
          {!loading && paginated.map(l => (
            <div key={l.id}
                 className={`lp-mobile-card${rowRailTone(l, statusList) ? ` lp-mobile-card--rail lp-mobile-card--rail-${rowRailTone(l, statusList)}` : ''}`}
                 onClick={() => openLead(l)}>
              {/* ── Row 1: who, and where they are in the pipeline ──
                  Name and status on ONE line, which they were not: .lp-mc-top
                  was switched to a column at 768px so a long name could not
                  squeeze the badge, and the cost was that the status ended up
                  below the Call and WhatsApp buttons — three rows down from the
                  name it describes, and in a different place on every card
                  depending on whether the WhatsApp button was there.

                  A wrapping name and a non-shrinking badge do the same job
                  without moving anything: the name takes the width it needs and
                  the badge stays in the corner where the eye goes for it. */}
              <div className="lp-mc-top">
                <div className="lp-mc-customer">
                  <div className="lp-mc-name">{l.name || <span className="lp-muted">No name</span>}</div>
                </div>
                <div className="lp-mc-right" onClick={e => e.stopPropagation()}>
                  {canEdit && !l.is_converted
                    ? <StatusInlineSelect leadId={l.id} leadName={l.name || l.mobile} current={l.status} statusList={statusList}
                      onChange={updated => setLeads(prev => prev.map(x => x.id === l.id ? { ...x, ...updated } : x))}
                      onOpenConvert={setPageConvertModal} />
                    : <StatusBadge status={l.status} statusList={statusList} />
                  }
                </div>
              </div>

              {/* ── Row 2: the three facts worth a glance ──
                  Number, date and value on one line instead of the number at
                  the top and the date stranded at the bottom of the card next
                  to a dash. Separated by dots rather than spread across the
                  full width — three short values pushed to the edges read as
                  three unrelated things. */}
              <div className="lp-mc-line">
                <span className="lp-mc-mobile">{l.mobile}</span>
                <span className="lp-mc-dot" aria-hidden="true">·</span>
                <span className="lp-mc-date">
                  {new Date(l.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                </span>
                {Number(l.total_price) > 0 && (
                  <>
                    <span className="lp-mc-dot" aria-hidden="true">·</span>
                    <span className="lp-mc-value">₹{Number(l.total_price).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                  </>
                )}
                {/* The card had NO follow-up indicator of any kind — the badge
                    lives in a table column that does not exist on a phone. So
                    the one question a list is for, "who have I not called
                    back", could not be answered here at all. */}
                {(() => {
                  const fu = followUpState(l, statusList);
                  if (!fu) return null;
                  const label = fu.isOverdue ? '⚠ Overdue'
                    : fu.isToday ? 'Today'
                      : fu.isTomorrow ? 'Tomorrow'
                        : fu.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
                  const color = fu.isOverdue ? '#dc2626' : fu.isToday ? '#d97706' : '#16a34a';
                  const bg = fu.isOverdue ? '#fee2e2' : fu.isToday ? '#fef3c7' : '#dcfce7';
                  return (
                    <>
                      <span className="lp-mc-dot" aria-hidden="true">·</span>
                      <span className="lp-mc-fu" style={{ background: bg, color }}>{label}</span>
                    </>
                  );
                })()}
              </div>

              {/* created_by is deliberately NOT here. On the desktop table it
                  is a column somebody occasionally sorts by; on a phone it was
                  rendering as a bare "—" on most cards, which is a character
                  of noise per row buying nothing. It is still on the row in the
                  table and in the lead's own panel. */}

              {(l.is_converted || (l.lost_reason && isLostStatus(l.status, statusList)) || isRetargetDue(l)) && (
                <div className="lp-mc-flags">
                  {l.is_converted && (
                    <span className="lp-mc-conv"><CheckCircle2 size={10} /> Converted to Appt.</span>
                  )}
                  {l.lost_reason && isLostStatus(l.status, statusList) && (
                    <span className="lp-lost-reason-sub">
                      {l.lost_reason}
                      {l.lost_competitor_name && <> · {l.lost_competitor_name}</>}
                    </span>
                  )}
                  {isRetargetDue(l) && (
                    <span className="lp-retarget-sub">
                      <RefreshCw size={10} /> Due for retargeting
                    </span>
                  )}
                </div>
              )}

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
                {/* Moved up from the footer to sit with the other facts about
                    the lead. Who it belongs to is the same kind of thing as
                    where it is and what it drives. */}
                {l.assigned_to_name && (
                  <span className="lp-mc-assigned"><UserCheck size={10} /> {l.assigned_to_name}</span>
                )}
              </div>

              {/* ── Row 4: everything you can DO, in one place ──
                  Call, WhatsApp and the overflow menu on the last line, at the
                  bottom of the card, in the same position on every card. They
                  were split across two rows — the two green buttons up beside
                  the name and the kebab alone at the foot — so acting on a lead
                  meant looking in two places, and the pair moved down the card
                  whenever the name wrapped.

                  The two buttons share the width rather than hugging their
                  labels: an equal half each is a bigger thumb target than a
                  90px pill, and they line up down the list. */}
              <div className="lp-mc-bottom" onClick={e => e.stopPropagation()}>
                <div className="lp-mc-actions">
                  <a className="lp-mc-action-btn lp-mc-action-btn--call"
                    href={`tel:${l.mobile}`} title="Call">
                    <Phone size={13} /> Call
                  </a>
                  {/* waTarget adds the missing country code and hides the
                      button when the number cannot be messaged. */}
                  {waTarget(l) && (
                    <a className="lp-mc-action-btn lp-mc-action-btn--wa"
                      href={waTarget(l)}
                      target="_blank" rel="noreferrer" title="WhatsApp">
                      <MessageCircle size={13} /> WhatsApp
                    </a>
                  )}
                </div>
                <ActionMenu lead={l} canEdit={canEdit} canDelete={canDelete}
                  onView={l => openLead(l)}
                  onEdit={l => setEditLead(l)}
                  onDelete={l => setDeleteLead(l)} />
              </div>
            </div>
          ))}
        </div>

        {/* ── Pagination footer ── */}
        {total > 0 && (
          <div className="lp-pagination-bar">
            {/* Left: count info */}
            <span className="lp-pg-info">
              Showing <strong>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}</strong> of <strong>{total}</strong> lead{total !== 1 ? 's' : ''}
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
      {/* The detail is a PAGE now, rendered over the list rather than in a
          modal. onEdit no longer clears viewId: the Edit dialog opens ON TOP
          and the conversation stays visible behind it, which is the point of
          the layout. Clearing it here would drop you back to the list the
          moment you clicked Edit. */}
      {viewId && (
        <ViewLeadModal key={`${viewId}:${leadRefresh}`} leadId={viewId} canEdit={canEdit} canAssign={canAssign} statusList={statusList}
          /* The route token, so the detail can publish the topbar breadcrumb
             label once it knows the lead. Passed down rather than read with
             useParams() inside, because the crumb store pairs the label WITH
             the token it belongs to — that pairing is what stops the previous
             lead's mobile flashing against the next lead's URL. */
          crumbToken={token}
          onLeadLoaded={handleLeadLoaded}
          onClose={closeLead}
          /* Same handler the list passes, so a converts_to_appointment status
             opens the same appointment form from either screen. */
          onOpenConvert={setPageConvertModal}
          onEdit={l => setEditLead(l)} />
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

