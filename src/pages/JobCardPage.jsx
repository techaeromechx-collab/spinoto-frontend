import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
/* Staff live at /job-cards/…, a hub login at /hub/job-cards/… — the same
   components under two route trees. Every navigation on this page goes through
   this map, or half its links are dead for half its users. */
import { useAppPaths } from '../lib/appPaths.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import BodyDiagram from '../components/BodyDiagram.jsx';
// Sends a POINTER to this card to a colleague on internal chat. Renders nothing
// without USE_CHAT, and brings its own stylesheet.
import ShareToChat from '../components/chat/ShareToChat.jsx';
import {
  ClipboardList, ArrowLeft, Plus, Trash2, X, AlertCircle, CheckCircle2,
  Gauge, Fuel, Wrench, MessageSquareWarning, Camera,
  PauseCircle, Check, Minus, Ban, ClipboardCheck, ShieldCheck, Car,
  ShieldAlert, CircleDashed, CircleCheck, CircleX, KeyRound, Unlock, FileText,
  Package, Timer, Undo2, PhoneCall, IndianRupee,
  // Work offered on an earlier visit and refused — come back round to it.
  RotateCcw,
  // The trail of readings behind the odometer boxes.
  History,
  // The step arrow on the status line, and the fold triangles on Compliance.
  ChevronRight,
  // The row list: stepping between sections in the popup, folding a group open
  // and shut, and the two rows that had no icon of their own before.
  ChevronLeft, ChevronDown, Users, Briefcase, PenLine,
} from 'lucide-react';
import '../styles/JobCardPage.css';
/* The runner's stylesheet also carries `bd-` (body diagram) and `sig-`
   (signature pad), both of which render on this page. Imported here rather
   than duplicated so there is one definition of each. */
import '../styles/InspectionPage.css';

/* ═══════════════════════════════════════════════════════════════════════════
   The job card — one vehicle visit, from arrival to handover.

   A PAGE OF ITS OWN, not a tab inside AppointmentsPage. That file is already
   4,600 lines and carries the list, the calendar, the create drawer and the
   edit drawer; adding a second full document to it would make every future
   change to either one riskier than it needs to be. The appointment drawer
   gets one button, and the button comes here.

   Addressed by APPOINTMENT id, not job card id. The caller — the appointment
   drawer, a link in a message, someone typing — knows which visit it means;
   whether a card has been opened for it yet is this page's problem, not the
   caller's. That is also why /by-appointment answers 200 with item:null
   instead of 404.
   ═══════════════════════════════════════════════════════════════════════ */

/* What produced a reading, in the words the trail prints. The keys are
   job_card_readings.source (migration 196); anything not listed falls through
   to the raw value rather than rendering blank. */
const READING_SOURCE = {
  open:          'On arrival',
  status_change: 'Status change',
  gate_pass:     'Gate pass',
  correction:    'Entered by hand',
};

const STATUS_LABELS = {
  open:              'Open',
  inspection:        'Inspection',
  awaiting_estimate: 'Awaiting estimate',
  awaiting_approval: 'Awaiting approval',
  in_progress:       'Work in progress',
  on_hold:           'On hold',
  work_done:         'Work done',
  qc:                'Quality check',
  ready:             'Ready',
  delivered:         'Delivered',
  closed:            'Closed',
  cancelled:         'Cancelled',
};

/* The flow, in the order the floor walks it. `cancelled` sits apart at the end
   because it is an exit, not a step. */
const STATUS_ORDER = [
  'open', 'inspection', 'awaiting_estimate', 'awaiting_approval', 'in_progress',
  'on_hold', 'work_done', 'qc', 'ready', 'delivered', 'closed', 'cancelled',
];

/* ── The line a job travels, for the stepper ────────────────────────────────
   STATUS_ORDER above is the DROPDOWN's list and must stay exactly as it is —
   every status this card can hold, in the order somebody picks from. This is a
   different question: which of them are points on a line.

   on_hold and cancelled are not. A car on hold has not moved backwards, it has
   stopped where it was; drawing it as a step would put a pause in the middle of
   the route. Both are shown as the current state instead, with the line left
   alone. Nothing here changes what any status DOES — it decides what gets a
   tick mark. */
const STATUS_FLOW = [
  'open', 'inspection', 'awaiting_estimate', 'awaiting_approval', 'in_progress',
  'work_done', 'qc', 'ready', 'delivered', 'closed',
];

/* Short enough for a step in a narrow rail. The full names in STATUS_LABELS
   are what the dropdown and the move button still say. */
const STATUS_SHORT = {
  open: 'Open', inspection: 'Inspection', awaiting_estimate: 'Estimate',
  awaiting_approval: 'Approval', in_progress: 'Work', work_done: 'Work done',
  qc: 'QC', ready: 'Ready', delivered: 'Delivered', closed: 'Closed',
};

/* What still stands in the way, written once.
   The header pill and the Compliance panel both ask this, and two copies of the
   rule is how a screen comes to say "2 to clear" above a list showing three. */
function countOpenGates(gates, blocks) {
  return (gates || []).filter(g =>
    g.blocks === blocks && !['pass', 'overridden', 'not_required'].includes(g.state)
  ).length;
}

const FUEL_LABELS = ['Empty', '¼', '½', '¾', 'Full'];

const ITEM_STATES = [
  { key: 'present', label: 'Present', Icon: Check },
  { key: 'absent',  label: 'Absent',  Icon: Ban },
  { key: 'na',      label: 'N/A',     Icon: Minus },
];

function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

/* A plain 'YYYY-MM-DD' — a visit date, not a timestamp. `new Date()` reads one
   as UTC midnight and would render it as the previous day anywhere behind
   Greenwich, so it is built from its parts instead. fmt() above is for
   timestamps and prints a time, which a visit date does not have. */
function fmtDate(d) {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/* ───────────────────────────────────────────────────────────────────────────
   Opening a card
   ─────────────────────────────────────────────────────────────────────── */
function OpenPanel({ appointment, onOpened }) {
  const [f, setF] = useState({ odometer_in: '', fuel_in: '', service_package: '' });
  const [complaints, setComplaints] = useState(['']);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  /* Pre-filled from the appointment so the number is not retyped. Retyping is
     how two different odometer readings for one visit come to exist. */
  useEffect(() => {
    if (appointment?.odometer_km != null) set('odometer_in', String(appointment.odometer_km));
  }, [appointment?.odometer_km]);

  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const body = { appointment_id: Number(appointment.id) };
      if (f.odometer_in !== '')     body.odometer_in     = Number(f.odometer_in);
      if (f.fuel_in !== '')         body.fuel_in         = Number(f.fuel_in);
      if (f.service_package.trim()) body.service_package = f.service_package.trim();
      const clean = complaints.map(c => c.trim()).filter(Boolean);
      if (clean.length) body.complaints = clean;
      const r = await api('/api/job-cards', { method: 'POST', body });
      onOpened(r.item);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <form className="jc-open" onSubmit={submit}>
      <div className="jc-open-hdr">
        <ClipboardList size={18} />
        <div>
          <h3>Open a job card</h3>
          <p>The card opens when the vehicle arrives — before anything is priced.</p>
        </div>
      </div>

      {error && <div className="jc-err"><AlertCircle size={13} /> {error}</div>}

      <div className="jc-open-grid">
        <div className="jc-field">
          <label><Gauge size={13} /> Odometer in (km)</label>
          <input className="jc-input" type="number" min="0" value={f.odometer_in}
                 onChange={e => set('odometer_in', e.target.value)} placeholder="e.g. 41200" />
        </div>
        <div className="jc-field">
          <label><Fuel size={13} /> Fuel in</label>
          <select className="jc-input" value={f.fuel_in} onChange={e => set('fuel_in', e.target.value)}>
            <option value="">Not recorded</option>
            {FUEL_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
          </select>
        </div>
        <div className="jc-field jc-field--wide">
          <label>Service package</label>
          <input className="jc-input" value={f.service_package}
                 onChange={e => set('service_package', e.target.value)}
                 placeholder="e.g. Periodic service — 40,000 km" />
        </div>
      </div>

      <div className="jc-field">
        <label><MessageSquareWarning size={13} /> What did the customer say?</label>
        <p className="jc-hint">
          Their words, not a diagnosis. What was actually found goes in later, beside it.
        </p>
        {complaints.map((c, i) => (
          <div className="jc-complaint-row" key={i}>
            <input className="jc-input" value={c} placeholder="e.g. Noise from front left when braking"
                   onChange={e => setComplaints(p => p.map((x, j) => j === i ? e.target.value : x))} />
            {complaints.length > 1 && (
              <button type="button" className="jc-icon-btn"
                      onClick={() => setComplaints(p => p.filter((_, j) => j !== i))}>
                <X size={14} />
              </button>
            )}
          </div>
        ))}
        <button type="button" className="jc-link-btn" onClick={() => setComplaints(p => [...p, ''])}>
          <Plus size={13} /> Add another
        </button>
      </div>

      <button className="button primary" disabled={busy}>
        {busy ? 'Opening…' : 'Open job card'}
      </button>
    </form>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   Putting a card on hold — a reason is not optional
   ─────────────────────────────────────────────────────────────────────── */
/* ── The prompt that turns two readings a job into a reading a move ─────────
   job_cards has carried odometer_in/out since migration 189 and nothing in
   between. Between those two numbers a car is road-tested, moved to another
   bay, driven to an alignment shop and parked overnight — every one of those a
   status change on this card, and not one of them recorded a reading.

   So the reading is asked for HERE, at the moment the car actually moves,
   rather than remembered at handover by somebody reconstructing the day.

   ── IT CAN ALWAYS BE SKIPPED ──────────────────────────────────────────────
   Deliberately. The floor puts a card on hold at four in the afternoon with a
   customer waiting; a status change that will not happen until somebody walks
   out to the car and reads a dial is a status change that stops being recorded
   at all — and then the card lies about where the job is. A missing reading is
   a gap in the trail. A missing status change is a gap in the truth.

   ── THE BOX STARTS EMPTY ──────────────────────────────────────────────────
   Prefilling it with the last reading would mean one press of Enter records a
   number nobody looked at, which is worse than no number: it is a false one,
   indistinguishable afterwards from a real reading. The last reading is shown
   as a placeholder and as the comparison below, never as the value. */
function StatusChangeModal({ from, to, lastOdometer, requireReason, onClose, onConfirm }) {
  useEscapeClose(onClose);
  const [reason, setReason] = useState('');
  const [odo, setOdo]   = useState('');
  const [fuel, setFuel] = useState('');

  const typed  = odo !== '' && Number.isFinite(Number(odo)) ? Number(odo) : null;
  const moved  = typed !== null && lastOdometer != null ? typed - Number(lastOdometer) : null;
  const blocked = requireReason && !reason.trim();

  const submit = withReading => onConfirm({
    reason: reason.trim() || undefined,
    odometer: withReading && typed !== null ? typed : undefined,
    fuel:     withReading && fuel !== ''    ? Number(fuel) : undefined,
  });

  return (
    <div className="jc-backdrop" onClick={onClose}>
      <div className="jc-modal" onClick={e => e.stopPropagation()}>
        <div className="jc-modal-hdr">
          <h3>
            {requireReason ? <PauseCircle size={16} /> : <Gauge size={16} />}
            {requireReason ? 'Put this job card on hold' : `Moving to ${STATUS_LABELS[to] || to}`}
          </h3>
          <button className="jc-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="jc-modal-body">
          {requireReason && (
            <>
              <p className="jc-hint">
                Three days from now nobody will remember what this car was waiting for.
                Write it down.
              </p>
              <textarea className="jc-input" rows={3} autoFocus value={reason}
                        onChange={e => setReason(e.target.value)}
                        placeholder="e.g. Brake pads on order from Rajkot, ETA Thursday" />
            </>
          )}

          <div className="jc-sc-read">
            <div className="jc-field">
              <label>Odometer now</label>
              <input className="jc-input" type="number" min="0" inputMode="numeric"
                     autoFocus={!requireReason}
                     value={odo} onChange={e => setOdo(e.target.value)}
                     placeholder={lastOdometer != null
                       ? `last ${Number(lastOdometer).toLocaleString('en-IN')}`
                       : 'not taken yet'} />
            </div>
            <div className="jc-field">
              <label>Fuel now</label>
              <select className="jc-input" value={fuel} onChange={e => setFuel(e.target.value)}>
                <option value="">—</option>
                {FUEL_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
              </select>
            </div>
          </div>

          {/* The distance since the last reading, as it is typed. This is the
              number a customer asks about, so it is shown to the person
              entering it rather than discovered by somebody else later. */}
          {moved !== null && moved >= 0 && (
            <p className="jc-hint">
              {moved === 0
                ? 'Same reading as last time — the car has not moved.'
                : `${moved.toLocaleString('en-IN')} km since the last reading.`}
            </p>
          )}
          {moved !== null && moved < 0 && (
            <div className="jc-warn">
              <AlertCircle size={13} /> Lower than the last reading
              ({Number(lastOdometer).toLocaleString('en-IN')}). Check the dial — it
              will be saved as typed and flagged on the trail.
            </div>
          )}
        </div>
        <div className="jc-modal-foot">
          <button className="button secondary" onClick={onClose}>Cancel</button>
          {/* Skipping is a button, not a closed dialog, so the status change
              still happens and the trail records honestly that no reading was
              taken at this move. */}
          <button className="button secondary" disabled={blocked}
                  onClick={() => submit(false)}>
            {requireReason ? 'Hold, no reading' : 'Skip the reading'}
          </button>
          <button className="button primary" disabled={blocked || (typed === null && fuel === '')}
                  onClick={() => submit(true)}>
            {requireReason ? 'Put on hold' : 'Save & move'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   Sections
   ─────────────────────────────────────────────────────────────────────── */
function Section({ icon: Icon, title, sub, right, children }) {
  return (
    <section className="jc-card">
      <header className="jc-card-hdr">
        <div className="jc-card-title">
          <Icon size={15} />
          <div>
            <strong>{title}</strong>
            {sub && <span>{sub}</span>}
          </div>
        </div>
        {right}
      </header>
      <div className="jc-card-body">{children}</div>
    </section>
  );
}

function Complaints({ card, reload, toast }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy]   = useState(false);

  async function add(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await api(`/api/job-cards/${card.id}/complaints`, { method: 'POST', body: { complaint: draft.trim() } });
      setDraft(''); await reload();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function saveFinding(c, finding) {
    if ((c.finding || '') === finding) return;          // nothing changed
    try {
      await api(`/api/job-cards/${card.id}/complaints/${c.id}`, { method: 'PATCH', body: { finding } });
      await reload();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function remove(c) {
    try {
      await api(`/api/job-cards/${card.id}/complaints/${c.id}`, { method: 'DELETE' });
      await reload();
    } catch (e) { toast(e.message, 'error'); }
  }

  return (
    <Section icon={MessageSquareWarning} title="Complaints & findings"
             sub="Left is what the customer said. Right is what was found.">
      {card.complaints.length === 0 && <div className="jc-empty">Nothing recorded yet.</div>}
      {card.complaints.map(c => (
        <div className="jc-cf" key={c.id}>
          <div className="jc-cf-said">{c.complaint}</div>
          {/* Saved on blur, not on every keystroke — the floor types this on a
              phone with one hand and a save per character is a save per bump. */}
          <textarea className="jc-input jc-cf-found" rows={2} defaultValue={c.finding || ''}
                    placeholder="What was actually found…"
                    onBlur={e => saveFinding(c, e.target.value.trim())} />
          <button className="jc-icon-btn jc-icon-btn--danger" title="Remove"
                  onClick={() => remove(c)}><Trash2 size={14} /></button>
        </div>
      ))}
      <form className="jc-addrow" onSubmit={add}>
        <input className="jc-input" value={draft} disabled={busy}
               onChange={e => setDraft(e.target.value)}
               placeholder="Add what the customer said…" />
        <button className="button secondary" disabled={busy || !draft.trim()}>
          <Plus size={14} /> Add
        </button>
      </form>
    </Section>
  );
}

function Technicians({ card, reload, toast }) {
  const [pool, setPool] = useState([]);
  const [pick, setPick] = useState('');
  const [role, setRole] = useState('');

  useEffect(() => {
    api(`/api/technicians?hub_id=${card.hub_id}`)
      .then(r => setPool(r.items || []))
      .catch(() => {});
  }, [card.hub_id]);

  async function add(e) {
    e.preventDefault();
    if (!pick) return;
    try {
      await api(`/api/job-cards/${card.id}/technicians`, {
        method: 'POST', body: { technician_id: Number(pick), role: role.trim() || null },
      });
      setPick(''); setRole(''); await reload();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function remove(row) {
    try {
      await api(`/api/job-cards/${card.id}/technicians/${row.id}`, { method: 'DELETE' });
      await reload();
    } catch (e) { toast(e.message, 'error'); }
  }

  return (
    <Section icon={Wrench} title="Who worked on it"
             sub="A name from the hub's list, not typed text — so 'claims per technician' has an answer.">
      {card.technicians.length === 0 && <div className="jc-empty">Nobody assigned yet.</div>}
      {card.technicians.length > 0 && (
        <div className="jc-chips">
          {card.technicians.map(t => (
            <span className="jc-chip" key={t.id}>
              <strong>{t.technician_name}</strong>
              {t.role && <em>{t.role}</em>}
              <button className="jc-chip-x" title="Remove" onClick={() => remove(t)}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <form className="jc-addrow" onSubmit={add}>
        <select className="jc-input" value={pick} onChange={e => setPick(e.target.value)}>
          <option value="">Choose a technician…</option>
          {pool.map(t => (
            <option key={t.id} value={t.id}>
              {t.name}{t.skill ? ` — ${t.skill}` : ''}
            </option>
          ))}
        </select>
        <input className="jc-input jc-role" value={role} placeholder="Role (optional)"
               onChange={e => setRole(e.target.value)} />
        <button className="button secondary" disabled={!pick}><Plus size={14} /> Add</button>
      </form>
      {pool.length === 0 && (
        <p className="jc-hint">
          No technicians on this hub's list yet — add them under Master data → Technicians.
        </p>
      )}
    </Section>
  );
}

function ItemsInVehicle({ card, reload, toast }) {
  const [rows, setRows] = useState(card.items);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setRows(card.items); setDirty(false); }, [card.items]);

  const setState = (i, state) => {
    setRows(p => p.map((r, j) => j === i ? { ...r, state } : r));
    setDirty(true);
  };

  async function save() {
    setBusy(true);
    try {
      /* The whole list in one write. The floor ticks fifteen boxes in one pass;
         fifteen requests would be fifteen chances for half of them to land. */
      await api(`/api/job-cards/${card.id}/items`, {
        method: 'PUT',
        body: { items: rows.map((r, i) => ({
          label: r.label, state: r.state, note: r.note || null, sort_order: i,
        })) },
      });
      setDirty(false); await reload();
      toast('Items saved.');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  const absent = rows.filter(r => r.state === 'absent').length;

  return (
    <Section icon={ClipboardList} title="What's in the vehicle"
             sub={absent ? `${absent} item${absent === 1 ? '' : 's'} marked absent` : 'Checked at intake'}
             right={dirty && (
               <button className="button primary jc-sm" onClick={save} disabled={busy}>
                 {busy ? 'Saving…' : 'Save'}
               </button>
             )}>
      <div className="jc-items">
        {rows.map((r, i) => (
          <div className={`jc-item jc-item--${r.state}`} key={r.id ?? i}>
            <span className="jc-item-label">{r.label}</span>
            <div className="jc-tri">
              {ITEM_STATES.map(({ key, label, Icon }) => (
                <button key={key} title={label}
                        className={`jc-tri-btn ${r.state === key ? `is-on is-${key}` : ''}`}
                        onClick={() => setState(i, key)}>
                  <Icon size={13} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Readings({ card, onSave, toast }) {
  const [f, setF] = useState({
    odometer_in:  card.odometer_in  ?? '',
    odometer_out: card.odometer_out ?? '',
    fuel_in:      card.fuel_in      ?? '',
    fuel_out:     card.fuel_out     ?? '',
  });
  useEffect(() => setF({
    odometer_in:  card.odometer_in  ?? '',
    odometer_out: card.odometer_out ?? '',
    fuel_in:      card.fuel_in      ?? '',
    fuel_out:     card.fuel_out     ?? '',
  }), [card.odometer_in, card.odometer_out, card.fuel_in, card.fuel_out]);

  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  async function commit(k) {
    const raw = f[k];
    const value = raw === '' ? null : Number(raw);
    if ((card[k] ?? null) === value) return;
    try { await onSave({ [k]: value }); }
    catch (e) { toast(e.message, 'error'); }
  }

  const driven = (f.odometer_out !== '' && f.odometer_in !== '')
    ? Number(f.odometer_out) - Number(f.odometer_in) : null;

  /* ── The reading leads, the boxes follow ──────────────────────────────────
     Three of the four boxes are empty on most open cards, and the one fact
     they hold was printed twice — once as a field value and once on the trail.
     So the latest reading is the headline now and the form is one click away.

     Nothing about saving changed: the same four inputs, the same onBlur commit,
     the same PATCH. This decides what is on screen before you ask for it. */
  const trail   = card.readings || [];
  const withOdo = trail.filter(r => r.odometer !== null && r.odometer !== undefined);
  const latest  = withOdo.length ? withOdo[withOdo.length - 1] : null;
  const heroKm  = latest ? Number(latest.odometer)
                : (card.odometer_out ?? card.odometer_in ?? null);
  /* Open by default when there is nothing to show — a collapsed form above an
     empty panel is a dead end, and the first reading has to be typeable. */
  const [editing, setEditing] = useState(heroKm === null);

  return (
    <Section icon={Gauge} title="Odometer & fuel"
             sub={driven !== null
               ? (driven >= 0 ? `${driven} km driven in the workshop` : 'Odometer out is LOWER than in — check the readings')
               : (trail.length
                   ? `${trail.length} reading${trail.length === 1 ? '' : 's'} taken`
                   : 'In on arrival, out at handover')}
             right={
               <button type="button" className="button secondary jc-sm"
                       aria-expanded={editing}
                       onClick={() => setEditing(v => !v)}>
                 {editing ? 'Done' : 'Edit readings'}
               </button>
             }>

      {/* The number somebody rings up about, at the size it is asked about. */}
      {heroKm !== null && (
        <div className="jc-read-hero">
          <b>{heroKm.toLocaleString('en-IN')}</b>
          <span>
            km
            {latest ? ` · ${READING_SOURCE[latest.source] || latest.source} · ${fmt(latest.recorded_at)}` : ''}
          </span>
          {f.fuel_in === '' && f.fuel_out === '' && (
            <span className="jc-pill is-muted">fuel not taken</span>
          )}
        </div>
      )}

      <div className="jc-readings" hidden={!editing}>
        <div className="jc-field">
          <label>Odometer in</label>
          <input className="jc-input" type="number" min="0" value={f.odometer_in}
                 onChange={e => set('odometer_in', e.target.value)} onBlur={() => commit('odometer_in')} />
        </div>
        <div className="jc-field">
          <label>Odometer out</label>
          <input className="jc-input" type="number" min="0" value={f.odometer_out}
                 onChange={e => set('odometer_out', e.target.value)} onBlur={() => commit('odometer_out')} />
        </div>
        <div className="jc-field">
          <label>Fuel in</label>
          <select className="jc-input" value={f.fuel_in}
                  onChange={e => { set('fuel_in', e.target.value); }}
                  onBlur={() => commit('fuel_in')}>
            <option value="">—</option>
            {FUEL_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
          </select>
        </div>
        <div className="jc-field">
          <label>Fuel out</label>
          <select className="jc-input" value={f.fuel_out}
                  onChange={e => { set('fuel_out', e.target.value); }}
                  onBlur={() => commit('fuel_out')}>
            <option value="">—</option>
            {FUEL_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
          </select>
        </div>
      </div>
      {/* Two numbers, so this is a comparison rather than a reading of two
          English words — which is the whole reason fuel is stored 0-4. */}
      {editing && f.fuel_out !== '' && f.fuel_in !== '' && Number(f.fuel_out) < Number(f.fuel_in) && (
        <div className="jc-warn">
          <AlertCircle size={13} /> Less fuel came back than went in.
        </div>
      )}

      {/* ── The trail (migration 196) ────────────────────────────────────────
          The four boxes above say the car did 18 km somewhere between arrival
          and handover. They cannot say when, or under whose name — and those
          are the two things asked when a customer rings about mileage they did
          not expect. This is every reading taken, in order, with the distance
          between each one.

          Under the boxes rather than in a section of its own: it is the history
          of those same four numbers, and separating them would make somebody
          read two panels to answer one question. */}
      {(card.readings || []).length > 0 && (
        <div className="jc-trail">
          <div className="jc-trail-hd">
            <History size={12} /> {card.readings.length} reading{card.readings.length !== 1 ? 's' : ''} taken
          </div>
          {card.readings.map(r => (
            <div key={r.id} className={`jc-tr${r.below_previous ? ' is-back' : ''}`}>
              <span className="jc-tr-when">{fmt(r.recorded_at)}</span>
              <span className="jc-tr-what">
                {READING_SOURCE[r.source] || r.source}
                {r.status_to && (
                  <em>
                    {r.status_from ? `${STATUS_LABELS[r.status_from] || r.status_from} → ` : ''}
                    {STATUS_LABELS[r.status_to] || r.status_to}
                  </em>
                )}
              </span>
              <span className="jc-tr-num">
                {r.odometer !== null && r.odometer !== undefined
                  ? `${Number(r.odometer).toLocaleString('en-IN')} km`
                  : '—'}
                {/* Distance since the previous reading, computed by the API so
                    this panel and any later report cannot disagree about a
                    subtraction. */}
                {r.moved !== null && r.moved !== undefined && (
                  <em className={r.moved < 0 ? 'is-back' : ''}>
                    {r.moved < 0 ? '' : '+'}{Number(r.moved).toLocaleString('en-IN')}
                  </em>
                )}
              </span>
              <span className="jc-tr-fuel">
                {r.fuel !== null && r.fuel !== undefined ? FUEL_LABELS[r.fuel] : ''}
              </span>
              <span className="jc-tr-who">{r.recorded_by_name || '—'}</span>
            </div>
          ))}
          {card.readings.some(r => r.below_previous) && (
            <div className="jc-warn">
              <AlertCircle size={13} /> A reading is lower than the one before it.
              Almost always a typo — the figure is kept as it was entered rather
              than quietly corrected.
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function Photos({ card, reload, toast }) {
  const [url, setUrl]     = useState('');
  const [stage, setStage] = useState('intake');

  async function add(e) {
    e.preventDefault();
    try {
      await api(`/api/job-cards/${card.id}/media`, { method: 'POST', body: { url: url.trim(), stage } });
      setUrl(''); await reload();
    } catch (e) { toast(e.message, 'error'); }
  }
  async function remove(m) {
    try { await api(`/api/job-cards/${card.id}/media/${m.id}`, { method: 'DELETE' }); await reload(); }
    catch (e) { toast(e.message, 'error'); }
  }

  const groups = ['intake', 'during', 'delivery'];
  const label  = { intake: 'On arrival', during: 'During work', delivery: 'At handover' };

  return (
    <Section icon={Camera} title="Photos"
             sub="When a photo was taken is what makes it evidence.">
      {groups.map(g => {
        const rows = card.media.filter(m => m.stage === g);
        if (!rows.length) return null;
        return (
          <div className="jc-mediagrp" key={g}>
            <h5>{label[g]}</h5>
            <div className="jc-media">
              {rows.map(m => (
                <figure className="jc-shot" key={m.id}>
                  <img src={m.thumb_url || m.url} alt={m.caption || label[g]} loading="lazy" />
                  <button className="jc-chip-x jc-shot-x" onClick={() => remove(m)}><X size={12} /></button>
                </figure>
              ))}
            </div>
          </div>
        );
      })}
      {card.media.length === 0 && <div className="jc-empty">No photos yet.</div>}
      <form className="jc-addrow" onSubmit={add}>
        <select className="jc-input jc-stage" value={stage} onChange={e => setStage(e.target.value)}>
          {groups.map(g => <option key={g} value={g}>{label[g]}</option>)}
        </select>
        <input className="jc-input" value={url} placeholder="Paste an image URL…"
               onChange={e => setUrl(e.target.value)} />
        <button className="button secondary" disabled={!url.trim()}><Plus size={14} /> Add</button>
      </form>
      <p className="jc-hint">
        Direct upload from the phone comes with the inspection sheet — for now this takes
        the same ImageKit links the rest of the CRM uses.
      </p>
    </Section>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   Inspections — a summary here, the sheet itself on its own screen
   ─────────────────────────────────────────────────────────────────────── */
function Inspections({ card, appointmentId, reload, toast }) {
  const navigate = useNavigate();
  const P = useAppPaths();
  const [busy, setBusy] = useState('');

  async function start(kind) {
    setBusy(kind);
    try {
      const r = await api(`/api/job-cards/${card.id}/inspections`, { method: 'POST', body: { kind } });
      navigate(`${P.jobCards}/${appointmentId}/inspection/${r.item.id}`);
    } catch (e) {
      /* The "no sheet set up yet" refusal names the template and where to
         fill it in. Shown as a toast rather than swallowed, because the fix
         is somebody's job, not a retry. */
      toast(e.message, 'error');
      setBusy('');
    }
  }

  const rows = card.inspections || [];

  return (
    <Section icon={ClipboardCheck} title="Inspections"
             sub="The evidence behind Quality Check and Ready.">
      {rows.length === 0 && <div className="jc-empty">No inspection run yet.</div>}

      {rows.map(i => (
        <button key={i.id} type="button" className="jc-insp"
                onClick={() => navigate(`${P.jobCards}/${appointmentId}/inspection/${i.id}`)}>
          <div className="jc-insp-main">
            <strong>{i.kind === 'intake' ? 'Intake inspection' : 'Pre-delivery check'}</strong>
            <span>{i.template_name}</span>
          </div>
          <div className="jc-insp-side">
            <span className={`jc-insp-state is-${i.status}`}>
              {i.status === 'completed' ? 'Completed' : `${i.answered_count}/${i.point_count}`}
            </span>
            {/* The run's OWN column headings, never hardcoded ones — a 2W
                sheet says "Rectified", a 4W sheet says "Needs attention". */}
            {i.attention_count > 0 && <span className="jc-pill is-attention">{i.attention_count} {i.label_attention}</span>}
            {i.critical_count  > 0 && <span className="jc-pill is-critical">{i.critical_count} {i.label_critical}</span>}
          </div>
        </button>
      ))}

      <div className="jc-addrow">
        <button className="button secondary" disabled={busy === 'intake'}
                onClick={() => start('intake')}>
          <Plus size={14} /> {busy === 'intake' ? 'Starting…' : 'Intake inspection'}
        </button>
        <button className="button secondary" disabled={busy === 'pre_delivery'}
                onClick={() => start('pre_delivery')}>
          <Plus size={14} /> {busy === 'pre_delivery' ? 'Starting…' : 'Pre-delivery check'}
        </button>
      </div>
    </Section>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   Body diagram
   ─────────────────────────────────────────────────────────────────────── */
function Damage({ card, reload, toast }) {
  const [stage, setStage] = useState('intake');
  const [marks, setMarks] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy]   = useState(false);

  /* Re-seeded from the card whenever the card reloads OR the stage tab
     changes — the two pictures are separate and switching between them must
     not carry one's pins into the other. */
  useEffect(() => {
    setMarks((card.damage || []).filter(m => m.stage === stage));
    setDirty(false);
  }, [card.damage, stage]);

  const shape = /2\s*w|two\s*wheel|bike|motor\s*cycle|scooter/i
    .test(card.vehicle_type_name || '') ? 'bike' : 'car';

  async function save() {
    setBusy(true);
    try {
      await api(`/api/job-cards/${card.id}/damage`, {
        method: 'PUT',
        body: { stage, marks: marks.map(m => ({
          x_pct: Number(m.x_pct), y_pct: Number(m.y_pct), kind: m.kind, note: m.note || null,
        })) },
      });
      setDirty(false); await reload(); toast('Damage marks saved.');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  const otherCount = (card.damage || []).filter(m => m.stage !== stage).length;

  return (
    <Section icon={Car} title="Body diagram"
             sub="Tap where the damage is. A pin beats a sentence."
             right={dirty && (
               <button className="button primary jc-sm" onClick={save} disabled={busy}>
                 {busy ? 'Saving…' : 'Save'}
               </button>
             )}>
      <div className="jc-stagetabs">
        {['intake', 'delivery'].map(s => (
          <button key={s} type="button" className={stage === s ? 'is-on' : ''}
                  onClick={() => setStage(s)}>
            {s === 'intake' ? 'On arrival' : 'At handover'}
            <em>{(card.damage || []).filter(m => m.stage === s).length}</em>
          </button>
        ))}
      </div>

      <BodyDiagram shape={shape} marks={marks} stage={stage}
                   onChange={m => { setMarks(m); setDirty(true); }} />

      {otherCount > 0 && stage === 'delivery' && (
        <p className="jc-hint">
          {otherCount} mark{otherCount === 1 ? '' : 's'} recorded on arrival. Comparing the two
          is what answers "that was already there".
        </p>
      )}
    </Section>
  );
}

/* Why a status change was refused. Stays on screen — the person has to leave
   this panel, go and fix something, and come back. */
function GateBlock({ block, isSuper, onClose, onForce }) {
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <div className="jc-block">
      <div className="jc-block-hdr">
        <ShieldAlert size={16} />
        <strong>{block.error}</strong>
        <button className="jc-icon-btn" onClick={onClose}><X size={15} /></button>
      </div>
      <ul>
        {block.blockers.map(b => (
          <li key={b.key}><strong>{b.label}</strong> — {b.detail}</li>
        ))}
      </ul>
      {isSuper && !open && (
        <button className="jc-link-btn jc-link-btn--warn" onClick={() => setOpen(true)}>
          <Unlock size={12} /> Move it anyway
        </button>
      )}
      {isSuper && open && (
        <form className="jc-block-force" onSubmit={e => { e.preventDefault(); onForce(reason.trim()); }}>
          <input className="jc-input" autoFocus value={reason}
                 onChange={e => setReason(e.target.value)}
                 placeholder="Why? This goes on the job card timeline." />
          <button className="button primary jc-sm" disabled={!reason.trim()}>Move anyway</button>
        </form>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   Estimates for this visit
   ───────────────────────────────────────────────────────────────────────
   The original and every supplementary, with what the visit actually comes to.

   A supplementary exists because work found once the wheel is off has to go
   somewhere, and the alternative — editing the estimate the customer already
   approved — silently rewrites the document they agreed to. So this section
   shows them side by side rather than one number that quietly grew.
   ─────────────────────────────────────────────────────────────────────── */
/* ─── Quoted, approved, and who is still waiting on an answer ────────────────
   Two things this card could not say before.

   The first is how much of the quote the customer actually agreed to. The card
   showed ₹5,600 whether or not ₹300 of it had been refused, because it read
   estimates.grand_total and that total does not know about per-line decisions.
   Quoted and Approved are now two numbers, and the gap between them is visible.

   The second is the decision itself. `customer_approved` has always been a real,
   fully wired column — the customer's own WhatsApp link writes it with IP, user
   agent and timestamp, and an advisor can tick the boxes from the estimate
   drawer. Neither of those is where the advisor is standing when the customer
   rings back, which is next to the car, on this card.

   ── A HUB LOGIN CANNOT RECORD THIS ────────────────────────────────────────
   The endpoint refuses hub users by role, not by permission, and says why. That
   is deliberate: a decision recorded from the hub portal would be
   indistinguishable from one the customer actually made, on the document that
   authorises both the work and the bill. So a hub sees every line and every
   figure here, and no buttons. */
const APPROVAL_VIEW = {
  true:  { label: 'Approved', cls: 'is-done' },
  false: { label: 'Declined', cls: 'is-fail' },
  null:  { label: 'Waiting',  cls: 'is-wait' },
};

/* ─── Adding work found on the ramp ──────────────────────────────────────────
   The advisor is next to the car. Until now, putting the seized caliper they
   have just found onto the bill meant leaving this screen, finding the
   estimate, and adding it there.

   ── WHY THIS DOES NO ARITHMETIC ───────────────────────────────────────────
   The line maths lives in estimates.controller.js :: computeItem, server-side:
   it derives the discount, back-calculates ex-GST from the discounted total and
   takes GST as the difference, then recalcTotals re-adds the estimate. The
   estimate form's own copy of that maths exists only to show figures while
   somebody types; nothing it computes is ever saved.

   So this form READS the estimate, appends one line, and PATCHes it back
   through the same endpoint the estimate form uses. Every existing line goes
   back exactly as it came — same row id, same warranty snapshot, same discount
   — and the server does the money. A third implementation of computeItem is the
   one thing step 3 was ordered not to produce.

   The single conversion here is inc-GST → ex-GST on the rate being typed,
   because the API takes customer_rate ex-GST and people quote inc-GST. It is
   the same expression EstimatesPage uses, and the server recomputes the totals
   from it regardless.

   ── WHY THE TARGET IS CHOSEN, NOT GUESSED ─────────────────────────────────
   A visit can have an original and several supplementaries. Picking one for the
   advisor would be this screen quietly deciding which document a customer is
   asked to approve. It is a select, and it says which one. */
/* ── Putting a line on an estimate, written once ────────────────────────────
   Two things on this card now add work: the Add work form, and Offer again on
   a previously declined line. They must write identically — this is a
   read-modify-write over an estimate's whole item array, and the failure mode
   of a second copy is not a wrong total, it is silently WIPED columns on every
   existing line. Warranty promises would disappear and nothing would say so.

   So the three risky parts live here and nowhere else: the payload mapping,
   the one inc→ex conversion, and the PATCH. */

/* Every field the API accepts, sent back exactly as it arrived. Dropping one
   here does not fail — it wipes that column on every existing line. */
const toPayload = it => ({
  id: it.id,
  item_type: it.item_type,
  item_id: it.service_id || it.part_id || null,
  description: it.description,
  quantity: Number(it.quantity) || 1,
  customer_rate: Number(it.customer_rate) || 0,
  gst_percent: Number(it.gst_percent) || 0,
  is_from_appointment: !!it.is_from_appointment,
  booked_price: it.booked_price ?? null,
  discount_type: it.discount_type || null,
  discount_value: Number(it.discount_value) || 0,
  discount_amount: Number(it.discount_amount) || 0,
  discount_source: it.discount_source || null,
  warranty_months: it.warranty_months ?? null,
  warranty_days: it.warranty_days ?? null,
  warranty_km: it.warranty_km ?? null,
  warranty_text: it.warranty_text || null,
  warranty_source: it.warranty_source || null,
  guarantee_months: it.guarantee_months ?? null,
  guarantee_days: it.guarantee_days ?? null,
  guarantee_km: it.guarantee_km ?? null,
  guarantee_text: it.guarantee_text || null,
  guarantee_source: it.guarantee_source || null,
});

/* The SAME endpoint the estimate form asks, with the same vehicle context. Not
   a second pricing implementation — one HTTP call to the one place that scores
   pricing rules by specificity. Returns null when no rule matched. */
async function lookupRuleRate(card, serviceId) {
  const p = new URLSearchParams({ service_id: serviceId });
  for (const k of ['vehicle_type_id', 'make_id', 'model_id',
                   'body_type_id', 'cc_category_id', 'segment_id']) {
    if (card[k]) p.set(k, card[k]);
  }
  try {
    const r = await api(`/api/pricing/lookup?${p}`);
    if (r.matched) return parseFloat(r.price);
  } catch { /* fall through — the caller has a fallback */ }
  return null;
}

/**
 * Append one line to an estimate and save it.
 *
 * @param targetId  the estimate to write to
 * @param line      { item_type, item_id, description, quantity, incRate, gst_percent }
 *                  incRate is what a CUSTOMER is quoted; the ex-GST figure the
 *                  column stores is derived here, in the one place it happens.
 */
async function addLineToEstimate(targetId, line) {
  /* Read first. The lines on the card are a summary — they do not carry the
     warranty or discount columns — so they cannot be the basis of a write. The
     estimate itself is. */
  const est = await api(`/api/estimates/${targetId}`);
  const items = (est.item?.items || []).map(toPayload);

  const g = Number(line.gst_percent) || 0;
  const inc = Number(line.incRate) || 0;
  const exRate = g > 0 ? inc / (1 + g / 100) : inc;

  items.push({
    item_type: line.item_type,
    item_id: line.item_id ? Number(line.item_id) : null,
    description: String(line.description || '').trim(),
    quantity: Number(line.quantity) || 1,
    customer_rate: parseFloat(exRate.toFixed(4)),
    gst_percent: g,
  });

  /* The server recomputes every figure from these five inputs — see
     computeItem in estimates.controller.js. Nothing here does money. */
  await api(`/api/estimates/${targetId}`, { method: 'PATCH', body: { items } });
}

function AddWork({ card, lines, reload, toast }) {
  const [open, setOpen]   = useState(false);
  const [kind, setKind]   = useState('service');
  const [services, setServices] = useState([]);
  const [parts, setParts] = useState([]);
  const [itemId, setItemId] = useState('');
  const [desc, setDesc]   = useState('');
  const [qty, setQty]     = useState('1');
  const [rate, setRate]   = useState('');       // inc-GST, what a customer is quoted
  const [gst, setGst]     = useState('18');
  const [target, setTarget] = useState('');
  const [busy, setBusy]   = useState(false);

  /* Only estimates that still exist. A cancelled one authorises nothing and
     must not be offered as somewhere to put new work. */
  const targets = useMemo(
    () => (card.estimates || []).filter(e => e.status !== 'cancelled'),
    [card.estimates]);

  useEffect(() => {
    if (!open) return;
    if (!target && targets.length) setTarget(String(targets[targets.length - 1].id));
    api('/api/services').then(r => setServices(r.items || [])).catch(() => {});
    api('/api/parts').then(r => setParts(r.items || [])).catch(() => {});
  }, [open]);       // eslint-disable-line react-hooks/exhaustive-deps

  async function pick(id) {
    setItemId(id);
    if (!id) { setDesc(''); setRate(''); return; }
    const list = kind === 'service' ? services : parts;
    const found = list.find(x => String(x.id) === String(id));
    if (!found) return;
    setDesc(found.name || '');
    setGst(String(parseFloat(found.gst_percent) || 18));
    /* A service is priced by rule first, master rate second. A part has no
       rules — its master customer_rate IS the inc-GST price. */
    const ruled = kind === 'service' ? await lookupRuleRate(card, id) : null;
    const fallback = parseFloat(found.customer_rate) || 0;
    const chosen = ruled ?? (fallback > 0 ? fallback : null);
    setRate(chosen != null ? String(chosen) : '');
  }

  async function save(e) {
    e.preventDefault();
    const incRate = parseFloat(rate);
    const g = parseFloat(gst) || 0;
    if (!desc.trim())            return toast('Give the line a description.', 'error');
    if (!(incRate >= 0))         return toast('Give a rate.', 'error');
    if (!target)                 return toast('Choose which estimate this goes on.', 'error');

    setBusy(true);
    try {
      await addLineToEstimate(target, {
        item_type: kind,
        item_id: itemId || null,
        description: desc.trim(),
        quantity: qty,
        incRate,
        gst_percent: g,
      });

      setOpen(false); setItemId(''); setDesc(''); setQty('1'); setRate('');
      await reload();
      toast(`Added to estimate #${target}`);
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  }

  if (targets.length === 0) return null;   // nothing to add to yet — Estimates has the button

  if (!open) {
    return (
      <button type="button" className="button secondary" onClick={() => setOpen(true)}>
        <Plus size={14} /> Add work
      </button>
    );
  }

  const list = kind === 'service' ? services : parts;
  return (
    <form className="jc-addwork" onSubmit={save}>
      <div className="jc-aw-row">
        <div className="jc-tri" role="group" aria-label="Service or part">
          {['service', 'part'].map(k => (
            <button key={k} type="button"
                    className={`jc-tri-btn${kind === k ? ' is-on is-na' : ''}`}
                    style={{ width: 'auto', padding: '0 10px', fontSize: 12, fontWeight: 600 }}
                    onClick={() => { setKind(k); setItemId(''); setDesc(''); setRate(''); }}>
              {k === 'service' ? 'Service' : 'Part'}
            </button>
          ))}
        </div>
        <select className="form-input" value={itemId} onChange={e => pick(e.target.value)}>
          <option value="">— pick from the master, or just type below —</option>
          {list.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>

      <div className="jc-aw-row">
        <input className="form-input" placeholder="What was done"
               value={desc} onChange={e => setDesc(e.target.value)} />
      </div>

      <div className="jc-aw-row">
        <label className="jc-aw-f">
          <span>Qty</span>
          <input className="form-input" type="number" min="0.01" step="0.01"
                 value={qty} onChange={e => setQty(e.target.value)} />
        </label>
        <label className="jc-aw-f">
          <span>Rate (inc-GST)</span>
          <input className="form-input" type="number" min="0" step="0.01"
                 value={rate} onChange={e => setRate(e.target.value)} />
        </label>
        <label className="jc-aw-f">
          <span>GST %</span>
          <input className="form-input" type="number" min="0" max="100" step="0.01"
                 value={gst} onChange={e => setGst(e.target.value)} />
        </label>
      </div>

      <div className="jc-aw-row">
        <label className="jc-aw-f" style={{ flex: 1 }}>
          <span>Goes on</span>
          <select className="form-input" value={target} onChange={e => setTarget(e.target.value)}>
            {targets.map(e => (
              <option key={e.id} value={e.id}>
                {e.parent_estimate_id ? 'Supplementary' : 'Original'} #{e.id} · {String(e.status).replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Adding to a document the customer has already agreed to is allowed —
          the system permits editing an estimate at any status — but it must not
          be silent. A supplementary is usually the honest answer. */}
      {(() => {
        const t = targets.find(e => String(e.id) === String(target));
        if (!t) return null;
        const decided = ['fully_approved', 'partially_approved', 'work_in_progress', 'work_completed']
          .includes(t.status);
        if (!decided) return null;
        return (
          <p className="jc-hint jc-aw-warn">
            Estimate #{t.id} has already been answered by the customer. Adding to it changes
            what they agreed to — a supplementary estimate keeps the original as they approved it.
          </p>
        );
      })()}

      <div className="jc-aw-row jc-aw-actions">
        <button className="button" type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add line'}
        </button>
        <button className="button secondary" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Authorisation({ card, reload, toast }) {
  const { user } = useAuth();
  const isHub = Boolean(user?.hub_id);
  const [busy, setBusy] = useState(0);

  const lines = card.lines || [];
  const m = card.money || {};
  /* Hidden only when there is nothing to authorise AND nowhere to add work.
     An estimate raised but still empty still needs the Add work button, or the
     advisor is sent back to the estimates screen for the first line. */
  const anyEstimate = (card.estimates || []).some(e => e.status !== 'cancelled');
  if (lines.length === 0 && !anyEstimate) return null;

  const money = n => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  async function decide(line, approved) {
    setBusy(line.id);
    try {
      /* The SAME endpoint the estimate drawer and the customer's own link use.
         A second way of writing this decision is how two screens come to
         disagree about what was authorised. */
      await api(`/api/estimates/${line.estimate_id}/customer-approval`, {
        method: 'POST',
        body: { approvals: [{ item_id: line.id, approved }] },
      });
      await reload();
      toast(approved ? 'Recorded as approved' : 'Recorded as declined');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(0); }
  }

  const waiting = m.pending_count || 0;

  return (
    <Section
      icon={IndianRupee}
      title="Authorisation"
      sub={m.declined
        ? `Quoted ${money(m.quoted)} · Approved ${money(m.approved)} · Declined ${money(m.declined)}`
        : `Quoted ${money(m.quoted)} · Approved ${money(m.approved)}`}
      right={waiting
        ? <span className="jc-pill is-attention">{waiting} waiting</span>
        : <span className="jc-pill is-done">All answered</span>}
    >
      {/* The two figures again, large. An advisor deciding whether to release a
          car reads the approved number, not the quoted one, and it should not
          have to be found inside a sentence. */}
      <div className="jc-auth-tot">
        <div className="jc-auth-fig">
          <span>Quoted</span>
          <strong>{money(m.quoted)}</strong>
        </div>
        <div className={`jc-auth-fig${m.approved < m.quoted ? ' is-short' : ''}`}>
          <span>Approved</span>
          <strong>{money(m.approved)}</strong>
        </div>
        {m.pending > 0 && (
          <div className="jc-auth-fig is-wait">
            <span>Not answered</span>
            <strong>{money(m.pending)}</strong>
          </div>
        )}
      </div>

      {lines.map(l => {
        const view = APPROVAL_VIEW[String(l.customer_approved)];
        return (
          <div key={l.id} className={`jc-auth${l.customer_approved === false ? ' is-declined' : ''}`}>
            <div className="jc-auth-main">
              <strong>{l.description}</strong>
              <span>
                {l.estimate_parent_id ? 'Supplementary' : 'Original'} #{l.estimate_id}
                {Number(l.quantity) !== 1 && ` · ×${Number(l.quantity)}`}
                {l.work_status === 'completed' && ' · fitted'}
              </span>
            </div>
            <div className="jc-auth-side">
              <span className="jc-auth-amt">{money(l.total_inc_gst)}</span>
              <span className={`jc-pill ${view.cls}`}>{view.label}</span>
              {!isHub && (
                <span className="jc-auth-act">
                  <button type="button" className="jc-mini"
                          disabled={busy === l.id || l.customer_approved === true}
                          onClick={() => decide(l, true)}>
                    <Check size={13} /> Approve
                  </button>
                  <button type="button" className="jc-mini is-bad"
                          disabled={busy === l.id || l.customer_approved === false}
                          onClick={() => decide(l, false)}>
                    <X size={13} /> Decline
                  </button>
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* Work found on the ramp goes on from here, rather than from another
          screen. Available to a hub as well — finding extra work is exactly
          what a hub does, and the estimate edit route already allows it. */}
      <AddWork card={card} lines={lines} reload={reload} toast={toast} />

      <p className="jc-hint">
        {isHub
          ? 'The customer’s decision is recorded by Spinoto, not from the hub portal — send them the estimate link, or ask Spinoto to record what they said.'
          : 'This writes the customer’s decision, not the workshop’s. A declined line stays on the estimate as a record of the refusal and drops off the invoice — deleting it instead would leave no trace that anyone ever said no.'}
      </p>
    </Section>
  );
}

/* ─── The bill, and what is left on it ───────────────────────────────────────
   The card could say whether an estimate had been invoiced. It could not say
   for how much, or whether anybody had paid — so the question "can this car go
   out" was answered by the gate checks and then stopped short of the money,
   which is the last thing anyone checks before handing over the keys.

   Read-only on purpose. Raising and editing invoices stays on the invoice
   screen; this exists so the answer does not have to be looked up there. The
   figures come from readInvoiceBalance, the one function in the system that
   decides what an invoice has been paid. */
function Billing({ card }) {
  const navigate = useNavigate();
  const P = useAppPaths();
  const b = card.billing || {};
  const rows = card.invoices_billing || [];
  if (!rows.length) return null;

  const money = n => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const settled = Number(b.due || 0) <= 0;

  return (
    <Section
      icon={IndianRupee}
      title="Billed and paid"
      sub={settled
        ? `${money(b.billed)} billed, nothing outstanding`
        : `${money(b.due)} still to collect`}
      right={settled
        ? <span className="jc-pill is-done">Settled</span>
        : <span className="jc-pill is-attention">{money(b.due)} due</span>}
    >
      <div className="jc-auth-tot">
        <div className="jc-auth-fig">
          <span>Billed</span>
          <strong>{money(b.billed)}</strong>
        </div>
        {/* Only when there is one. A credit note is unusual enough that a
            permanent ₹0 row would read as an error rather than as "none". */}
        {Number(b.credited) > 0 && (
          <div className="jc-auth-fig">
            <span>Credited</span>
            <strong>{money(b.credited)}</strong>
          </div>
        )}
        <div className="jc-auth-fig">
          <span>Paid</span>
          <strong>{money(b.paid)}</strong>
        </div>
        <div className={`jc-auth-fig${settled ? '' : ' is-short'}`}>
          <span>Still owed</span>
          <strong>{money(b.due)}</strong>
        </div>
      </div>

      {rows.map(i => (
        /* `.jc-inv`, not `.jc-est`. Same geometry, different thing: an invoice
           is not an estimate, and a shared class means anything counting the
           estimates on this card silently counts invoices too — which is
           exactly what a phase-8 test caught the moment this section landed. */
        <button key={i.id} type="button" className="jc-inv"
                onClick={() => navigate(i.public_token
                  ? `${P.customerInvoices}/${i.public_token}`
                  : P.customerInvoices, i.public_token ? undefined : { state: { openId: i.id } })}>
          <div className="jc-inv-main">
            <strong>CI-{String(i.id).padStart(6, '0')}</strong>
            <span>{String(i.status || '').replace(/_/g, ' ')}</span>
          </div>
          <div className="jc-inv-side">
            <span className="jc-inv-amt">{money(i.grand_total)}</span>
            <span className={`jc-pill ${i.balance <= 0 ? 'is-done' : 'is-attention'}`}>
              {i.balance <= 0 ? 'Paid' : `${money(i.balance)} due`}
            </span>
          </div>
        </button>
      ))}
    </Section>
  );
}

/* ─── What the customer booked ───────────────────────────────────────────────
   The advisor chose these services when the customer rang, and
   appointment_services has held them ever since. Nothing on this card ever read
   that table, so the one list the customer had actually agreed to was the one
   list the workshop floor could not see.

   Read-only, deliberately. Pricing and billing happen on the estimate; this
   panel exists so the list the customer agreed to and the list being charged
   for can be read side by side, which is why it sits directly above Estimates.

   Hidden entirely when there is no booking. A walk-in has none, and a permanent
   "nothing booked" panel on every walk-in is worse than its absence. */
/* ── Offered before, refused, and still not done ────────────────────────────
   A declined line has always survived — applyItemApprovals writes FALSE and
   leaves the row where it is, and the Authorisation panel says so on screen.
   What never happened is anyone being told about it on the NEXT visit. The car
   comes back four months later, the same pads are still worn, and the advisor
   standing at this card has no idea they were offered at ₹2,000 in March.

   THIS visit is not in here. Its own declines are in Authorisation above, with
   buttons; repeating them under history would read as a second refusal.

   "Offer again" writes a NEW line on a CURRENT estimate. It does not touch the
   old one — that row is the record of a refusal and stays exactly as it is. */
function PreviouslyDeclined({ card, reload, toast }) {
  const rows = card.declined_before || [];
  const [openKey, setOpenKey] = useState(null);
  const [rate,  setRate]  = useState('');
  const [qty,   setQty]   = useState('1');
  const [target, setTarget] = useState('');
  const [busy,  setBusy]  = useState(false);

  const targets = useMemo(
    () => (card.estimates || []).filter(e => e.status !== 'cancelled'),
    [card.estimates]);

  if (rows.length === 0) return null;

  const total = Number(card.declined_before_total || 0);
  const money = v => `₹${Number(v || 0).toLocaleString('en-IN')}`;

  /* Opening the form re-prices. The figure beside the line is what it was
     quoted at ON THE DAY — a historical fact, and not a rate to bill today.
     A live pricing rule wins; the old price is the fallback, per unit, because
     quoted_at is the line total. */
  async function offer(d) {
    setOpenKey(d.item_key);
    setQty(String(Number(d.quantity) || 1));
    setTarget(String(targets[targets.length - 1]?.id || ''));
    const perUnit = Number(d.quoted_at || 0) / (Number(d.quantity) || 1);
    setRate(perUnit ? String(Number(perUnit.toFixed(2))) : '');
    if (d.service_id) {
      const ruled = await lookupRuleRate(card, d.service_id);
      if (ruled != null) setRate(String(ruled));
    }
  }

  async function commit(d) {
    const incRate = parseFloat(rate);
    if (!(incRate >= 0)) return toast('Give a rate.', 'error');
    if (!target)         return toast('Choose which estimate this goes on.', 'error');
    setBusy(true);
    try {
      await addLineToEstimate(target, {
        item_type: d.item_type,
        item_id: d.service_id || d.part_id || null,
        description: d.description,
        quantity: qty,
        incRate,
        gst_percent: Number(d.gst_percent) || 18,
      });
      setOpenKey(null);
      await reload();
      toast(`Added to estimate #${target}`);
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  }

  return (
    <Section
      icon={RotateCcw}
      title="Offered before, declined"
      sub={`${money(total)} this customer said no to and has not had done`}
      right={<span className="jc-pill is-attention">{rows.length}</span>}
    >
      {rows.map(d => (
        <div key={d.item_key} className="jc-dec">
          <div className="jc-dec-row">
            <div className="jc-dec-main">
              <strong>{d.description}</strong>
              <span>
                Declined {fmtDate(d.declined_on)}
                {d.hub_name ? ` · ${d.hub_name}` : ''}
                {d.service_id && d.service_is_active === false ? ' · no longer on the price list' : ''}
              </span>
            </div>
            <div className="jc-dec-side">
              {d.times_declined > 1 && (
                <span className="jc-pill is-attention">{d.times_declined}× declined</span>
              )}
              <span className="jc-dec-amt">{money(d.quoted_at)}</span>
              {targets.length > 0 && openKey !== d.item_key && (
                <button type="button" className="button secondary jc-dec-btn"
                        onClick={() => offer(d)}>
                  <RotateCcw size={12}/> Offer again
                </button>
              )}
            </div>
          </div>

          {openKey === d.item_key && (
            <div className="jc-dec-form">
              <label className="jc-aw-f">
                <span>Qty</span>
                <input className="form-input" type="number" min="0.01" step="0.01"
                       value={qty} onChange={e => setQty(e.target.value)} />
              </label>
              <label className="jc-aw-f">
                <span>Rate today (inc-GST)</span>
                <input className="form-input" type="number" min="0" step="0.01"
                       value={rate} onChange={e => setRate(e.target.value)} />
              </label>
              <label className="jc-aw-f" style={{ flex: 1 }}>
                <span>Goes on</span>
                <select className="form-input" value={target}
                        onChange={e => setTarget(e.target.value)}>
                  {targets.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.parent_estimate_id ? 'Supplementary' : 'Original'} #{e.id} · {String(e.status).replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <div className="jc-dec-actions">
                <button type="button" className="button" disabled={busy}
                        onClick={() => commit(d)}>
                  {busy ? 'Adding…' : 'Add line'}
                </button>
                <button type="button" className="button secondary"
                        onClick={() => setOpenKey(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}

      <p className="jc-hint">
        Matched by service, part, or the wording of the line — there is no other
        identity on an estimate line. Anything the customer has since agreed to
        drops off this list. Offering again writes a new line on a current
        estimate; the old refusal stays on its own estimate as the record that
        it happened.
      </p>
    </Section>
  );
}

function Booked({ card }) {
  const rows = card.booked_services || [];
  const s = card.booked_summary || { count: 0, not_on_estimate: 0, total: 0 };
  if (rows.length === 0) return null;

  const missing = s.not_on_estimate || 0;
  const money   = `₹${Number(s.total || 0).toLocaleString('en-IN')}`;

  return (
    <Section
      icon={PhoneCall}
      title="Booked on the phone"
      sub={missing
        ? `${money} agreed — ${missing} of ${s.count} not on an estimate yet`
        : `${money} agreed, all of it quoted`}
      right={missing
        ? <span className="jc-pill is-attention">{missing} missing</span>
        : <span className="jc-pill is-done">All quoted</span>}
    >
      {rows.map(b => (
        <div key={b.id} className="jc-bk">
          <div className="jc-bk-main">
            <strong>{b.service_name}</strong>
            {b.category_name && <span>{b.category_name}</span>}
          </div>
          <div className="jc-bk-side">
            <span className="jc-bk-amt">₹{Number(b.booked_price || 0).toLocaleString('en-IN')}</span>
            <span className={`jc-pill ${b.on_estimate ? 'is-done' : 'is-attention'}`}>
              {b.on_estimate ? 'On estimate' : 'Not on estimate'}
            </span>
          </div>
        </div>
      ))}

      <p className="jc-hint">
        {missing > 0
          ? 'A service booked but never quoted is the mistake that costs the most and shows the least — the work gets done and nobody bills for it.'
          : 'Every booked service appears on an estimate for this visit.'}
        {' '}Matched by service, not by line, so the same service quoted twice still reads as covered.
        Prices are what the customer was quoted at booking; the estimate re-prices at today&apos;s rate.
      </p>
    </Section>
  );
}

function Estimates({ card, appointmentId }) {
  const navigate = useNavigate();
  const P = useAppPaths();
  const rows = card.estimates || [];
  const original = rows.find(e => e.parent_estimate_id === null);
  const supps = rows.filter(e => e.parent_estimate_id !== null);

  /* Cancelled documents do not count towards what is owed. */
  const total = rows
    .filter(e => e.status !== 'cancelled')
    .reduce((s, e) => s + Number(e.grand_total || 0), 0);

  const open = e => navigate(e.public_token ? `${P.estimates}/${e.public_token}` : P.estimates,
                             e.public_token ? undefined : { state: { openId: e.id } });

  return (
    <Section icon={FileText} title="Estimates"
             sub={supps.length
               ? `Original plus ${supps.length} supplementary — ₹${total.toLocaleString('en-IN')} for the visit`
               : 'What the customer has agreed to.'}>
      {rows.length === 0 && <div className="jc-empty">No estimate raised yet.</div>}

      {rows.map(e => (
        <button key={e.id} type="button" className="jc-est" onClick={() => open(e)}>
          <div className="jc-est-main">
            <strong>
              {e.parent_estimate_id ? 'Supplementary' : 'Original'} #{e.id}
              {e.status === 'cancelled' && <em className="jc-est-void">cancelled</em>}
            </strong>
            <span>{e.status.replace(/_/g, ' ')}</span>
          </div>
          <div className="jc-est-side">
            <span className="jc-est-amt">₹{Number(e.grand_total || 0).toLocaleString('en-IN')}</span>
            {/* Whether it has been billed, because that is what the Billing
                check is looking at and the answer should be in one place. */}
            <span className={`jc-pill ${e.invoiced ? 'is-done' : 'is-attention'}`}>
              {e.invoiced ? 'Invoiced' : 'Not invoiced'}
            </span>
          </div>
        </button>
      ))}

      {original ? (
        <button className="button secondary"
                onClick={() => navigate(
                  `${P.estimates}?createForAppointmentId=${appointmentId}&parentEstimateId=${original.id}`)}>
          <Plus size={14} /> Supplementary estimate
        </button>
      ) : (
        <button className="button secondary"
                onClick={() => navigate(`${P.estimates}?createForAppointmentId=${appointmentId}`)}>
          <Plus size={14} /> Create estimate
        </button>
      )}

      {supps.length > 0 && (
        <p className="jc-hint">
          The original stays exactly as the customer approved it. Extra work is its own
          document, with its own approval.
        </p>
      )}
    </Section>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   Parts issued from the store
   ───────────────────────────────────────────────────────────────────────
   Two ledgers side by side: what left the shelf, and what the customer is
   being charged for. The gap between them is the point of the section — a
   part issued with no estimate line behind it is work the hub has paid for
   and will not be paid for, and until issuing was recorded separately from
   billing there was no way to see it.

   The counts come from the server's own reconciliation rather than being
   re-derived here. The Parts billed check reads exactly the same numbers, and
   a screen that worked them out for itself would be free to disagree with the
   thing that actually blocks the car.
   ─────────────────────────────────────────────────────────────────────── */
const SOURCE_LABEL = { store: 'Store', purchased: 'Bought in', customer: "Customer's own" };

/* NUMERIC(10,2) arrives from pg as the string "2.00". Number() drops the
   trailing zeros without touching a genuine 1.5. */
const qty = n => String(Number(n || 0));

function lineLabel(l) {
  return `${l.parent_estimate_id ? 'Supp' : 'Est'} #${l.estimate_id} — ${l.description}`;
}

function Parts({ card, reload, toast }) {
  const [lines,  setLines]  = useState([]);
  const [master, setMaster] = useState([]);
  const [recon,  setRecon]  = useState(null);
  const [adding, setAdding] = useState(false);
  const [busy,   setBusy]   = useState(false);
  const [back,   setBack]   = useState(null);          // the row being returned
  const [backQty, setBackQty] = useState('');
  const blank = { name: '', number: '', quantity: '1', unit: 'nos', source: 'store', line: '', tech: '' };
  const [f, setF] = useState(blank);

  const rows = card.parts || [];

  /* Re-read when the rows change: `lines` carries how much has been issued
     against each estimate line, and that moves with every issue and return. */
  useEffect(() => {
    let live = true;
    api(`/api/job-cards/${card.id}/parts`)
      .then(r => { if (live) { setLines(r.lines || []); setRecon(r.reconciliation || null); } })
      .catch(() => {});
    return () => { live = false; };
  }, [card.id, rows.length, rows.map(r => r.returned_quantity + '|' + r.estimate_item_id).join(',')]);

  /* Master data is a convenience, not a requirement — a part can always be
     typed. If the list cannot be read the field simply has no suggestions. */
  useEffect(() => {
    api('/api/parts').then(r => setMaster((r.items || []).filter(p => p.is_active !== false)))
      .catch(() => {});
  }, []);

  async function add(e) {
    e.preventDefault();
    if (!f.name.trim() || !Number(f.quantity)) return;
    setBusy(true);
    try {
      /* If what was typed is exactly a master part, send its id too, so the
         card can still be traced back to the catalogue. The NAME is what the
         server stores either way. */
      const hit = master.find(p => p.name.toLowerCase() === f.name.trim().toLowerCase());
      await api(`/api/job-cards/${card.id}/parts`, {
        method: 'POST',
        body: {
          part_id: hit?.id ?? null,
          part_name: f.name.trim(),
          part_number: f.number.trim() || null,
          quantity: Number(f.quantity),
          unit: f.unit.trim() || 'nos',
          source: f.source,
          estimate_item_id: f.line ? Number(f.line) : null,
          issued_to: f.tech ? Number(f.tech) : null,
        },
      });
      setF(blank); setAdding(false); await reload();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function linkTo(row, estimateItemId) {
    try {
      await api(`/api/job-cards/${card.id}/parts/${row.id}`, {
        method: 'PATCH', body: { estimate_item_id: estimateItemId ? Number(estimateItemId) : null },
      });
      await reload();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function doReturn(e) {
    e.preventDefault();
    if (!Number(backQty)) return;
    try {
      await api(`/api/job-cards/${card.id}/parts/${back.id}/return`, {
        method: 'POST', body: { quantity: Number(backQty) },
      });
      setBack(null); setBackQty(''); await reload();
      toast('Booked back into the store.');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function remove(row) {
    try {
      await api(`/api/job-cards/${card.id}/parts/${row.id}`, { method: 'DELETE' });
      await reload();
    } catch (e) { toast(e.message, 'error'); }
  }

  const unbilled = recon?.unbilled ?? 0;

  return (
    <Section icon={Package} title="Parts issued"
             sub={rows.length === 0
               ? 'What actually left the store for this car.'
               : unbilled > 0
                 ? `${rows.length} issued · ${unbilled} on no estimate line`
                 : `${rows.length} issued · all on an estimate line`}
             right={rows.length > 0 && unbilled > 0
               ? <span className="jc-pill is-attention">{unbilled} unbilled</span>
               : null}>

      {rows.length === 0 && <div className="jc-empty">No parts issued from the store yet.</div>}

      {rows.map(r => {
        const out = Number(r.net_quantity);
        const returned = Number(r.returned_quantity);
        const leak = !r.estimate_item_id && r.source !== 'customer' && out > 0;
        return (
          <div className={`jc-part${leak ? ' is-leak' : ''}`} key={r.id}>
            <div className="jc-part-main">
              <strong>{r.part_name}</strong>
              <span>
                {qty(r.quantity)} {r.unit}
                {returned > 0 && <em className="jc-part-back"> · {qty(returned)} returned</em>}
                {' · '}{SOURCE_LABEL[r.source] || r.source}
                {r.issued_to_name && ` · to ${r.issued_to_name}`}
                {r.part_number && ` · ${r.part_number}`}
              </span>
            </div>

            <div className="jc-part-side">
              {/* The billing link is a control, not a label: the fix for an
                  unbilled part is to attach it to a line, and that should be
                  possible where the problem is shown. */}
              <select className="jc-input jc-part-line"
                      value={r.estimate_item_id || ''}
                      onChange={e => linkTo(r, e.target.value)}>
                <option value="">
                  {r.source === 'customer' ? "Customer's own — not billed" : 'Not on an estimate'}
                </option>
                {lines.map(l => <option key={l.id} value={l.id}>{lineLabel(l)}</option>)}
              </select>
              <button className="jc-icon-btn" title="Book some back into the store"
                      disabled={out <= 0}
                      onClick={() => { setBack(r); setBackQty(String(out)); }}>
                <Undo2 size={14} />
              </button>
              <button className="jc-icon-btn" title="Remove this row" onClick={() => remove(r)}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        );
      })}

      {back && (
        <form className="jc-addrow jc-part-return" onSubmit={doReturn}>
          <span className="jc-part-return-lbl">Return “{back.part_name}”</span>
          <input className="jc-input jc-qty" type="number" step="0.01" min="0.01"
                 max={Number(back.net_quantity)} value={backQty}
                 onChange={e => setBackQty(e.target.value)} autoFocus />
          <button className="button secondary" disabled={!Number(backQty)}>Book back</button>
          <button type="button" className="button ghost" onClick={() => setBack(null)}>Cancel</button>
        </form>
      )}

      {!adding ? (
        <button className="button secondary" onClick={() => setAdding(true)}>
          <Plus size={14} /> Issue a part
        </button>
      ) : (
        <form className="jc-partform" onSubmit={add}>
          <input className="jc-input" list="jc-parts-master" value={f.name} autoFocus
                 placeholder="Part name" onChange={e => setF({ ...f, name: e.target.value })} />
          <datalist id="jc-parts-master">
            {master.map(p => <option key={p.id} value={p.name} />)}
          </datalist>
          <input className="jc-input jc-qty" type="number" step="0.01" min="0.01" value={f.quantity}
                 onChange={e => setF({ ...f, quantity: e.target.value })} />
          <input className="jc-input jc-unit" value={f.unit} placeholder="nos"
                 onChange={e => setF({ ...f, unit: e.target.value })} />
          <select className="jc-input" value={f.source} onChange={e => setF({ ...f, source: e.target.value })}>
            <option value="store">From the store</option>
            <option value="purchased">Bought in for this job</option>
            <option value="customer">Customer brought it</option>
          </select>
          <select className="jc-input jc-part-line" value={f.line}
                  onChange={e => setF({ ...f, line: e.target.value })}>
            <option value="">Not on an estimate yet</option>
            {lines.map(l => <option key={l.id} value={l.id}>{lineLabel(l)}</option>)}
          </select>
          <input className="jc-input" value={f.number} placeholder="Part number (optional)"
                 onChange={e => setF({ ...f, number: e.target.value })} />
          <div className="jc-partform-act">
            <button className="button" disabled={busy || !f.name.trim()}>
              <Plus size={14} /> Issue
            </button>
            <button type="button" className="button ghost"
                    onClick={() => { setAdding(false); setF(blank); }}>Cancel</button>
          </div>
        </form>
      )}

      {unbilled > 0 && (
        <p className="jc-hint">
          A part with no estimate line will not appear on any invoice. Attach it to a line,
          or book it back into the store.
        </p>
      )}
    </Section>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   The time log
   ───────────────────────────────────────────────────────────────────────
   "Who worked on it" above is the roster — the names on the board. This is the
   work: one row per technician, per task, per day. Kept apart because a car on
   the floor for three days needs "2h Tuesday, 3h Wednesday" rather than a
   single number nobody can account for.

   Hours in, minutes stored. The server converts once, at the door, so there is
   never a column holding 1.5 and 1.30 meaning different things.
   ─────────────────────────────────────────────────────────────────────── */
const fmtMins = m => {
  const n = Number(m || 0);
  const h = Math.floor(n / 60), r = n % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
};

function Labour({ card, reload, toast }) {
  const [pool,  setPool]  = useState([]);
  const [lines, setLines] = useState([]);
  const [busy,  setBusy]  = useState(false);
  const blank = { tech: '', hours: '', task: '', line: '' };
  const [f, setF] = useState(blank);

  const rows = card.labour || [];
  const s = card.labour_summary || { minutes: 0, entries: 0, technicians: 0, by_technician: [] };

  useEffect(() => {
    api(`/api/technicians?hub_id=${card.hub_id}`).then(r => setPool(r.items || [])).catch(() => {});
  }, [card.hub_id]);

  useEffect(() => {
    let live = true;
    api(`/api/job-cards/${card.id}/labour`)
      .then(r => { if (live) setLines(r.lines || []); })
      .catch(() => {});
    return () => { live = false; };
  }, [card.id, rows.length]);

  async function add(e) {
    e.preventDefault();
    if (!f.tech || !Number(f.hours)) return;
    setBusy(true);
    try {
      await api(`/api/job-cards/${card.id}/labour`, {
        method: 'POST',
        body: {
          technician_id: Number(f.tech),
          hours: Number(f.hours),
          task: f.task.trim() || undefined,
          estimate_item_id: f.line ? Number(f.line) : null,
        },
      });
      setF({ ...blank, tech: f.tech });      // same person, next task
      await reload();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function remove(row) {
    try {
      await api(`/api/job-cards/${card.id}/labour/${row.id}`, { method: 'DELETE' });
      await reload();
    } catch (e) { toast(e.message, 'error'); }
  }

  return (
    <Section icon={Timer} title="Time on the job"
             sub={s.entries === 0
               ? 'How long the work actually took.'
               : `${fmtMins(s.minutes)} across ${s.technicians} ${s.technicians === 1 ? 'person' : 'people'}`}>

      {s.by_technician.length > 0 && (
        <div className="jc-chips">
          {s.by_technician.map(t => (
            <span className="jc-chip" key={t.technician_id}>
              <strong>{t.technician_name}</strong><em>{fmtMins(t.minutes)}</em>
            </span>
          ))}
        </div>
      )}

      {rows.length === 0 && <div className="jc-empty">No time logged yet.</div>}

      {rows.map(r => (
        <div className="jc-lab" key={r.id}>
          <div className="jc-lab-main">
            <strong>{r.task}</strong>
            <span>
              {r.technician_name} · {String(r.worked_on).slice(0, 10)}
              {/* Only when it adds something. The task is copied FROM the line
                  when nothing was typed, so repeating it reads as a stutter. */}
              {r.line_description && r.line_description !== r.task &&
                ` · on “${r.line_description}”`}
            </span>
          </div>
          <div className="jc-lab-side">
            <span className="jc-lab-mins">{fmtMins(r.minutes)}</span>
            <button className="jc-icon-btn" title="Remove this entry" onClick={() => remove(r)}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}

      <form className="jc-labform" onSubmit={add}>
        <select className="jc-input" value={f.tech} onChange={e => setF({ ...f, tech: e.target.value })}>
          <option value="">Who…</option>
          {pool.map(t => (
            <option key={t.id} value={t.id}>{t.name}{t.skill ? ` — ${t.skill}` : ''}</option>
          ))}
        </select>
        <input className="jc-input jc-qty" type="number" step="0.25" min="0.25" max="24"
               value={f.hours} placeholder="Hrs"
               onChange={e => setF({ ...f, hours: e.target.value })} />
        <select className="jc-input jc-part-line" value={f.line}
                onChange={e => setF({ ...f, line: e.target.value })}>
          <option value="">Not against a line</option>
          {lines.map(l => <option key={l.id} value={l.id}>{lineLabel(l)}</option>)}
        </select>
        <input className="jc-input" value={f.task} placeholder="What was done (optional)"
               onChange={e => setF({ ...f, task: e.target.value })} />
        <button className="button secondary" disabled={busy || !f.tech || !Number(f.hours)}>
          <Plus size={14} /> Log
        </button>
      </form>

      {pool.length === 0 && (
        <p className="jc-hint">
          No technicians on this hub's list yet — add them under Master data → Technicians.
        </p>
      )}
    </Section>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   Compliance gates
   ───────────────────────────────────────────────────────────────────────
   Renders `detail` and nothing else. The server works out WHY a gate is red —
   "3 of 4 complaints have no finding recorded" — and this screen shows that
   sentence. Re-deriving the reason here would be a second implementation of
   the rule, free to disagree with the one that actually blocks the car.
   ─────────────────────────────────────────────────────────────────────── */
const GATE_ICON = {
  pass:         { Icon: CircleCheck,  cls: 'is-pass' },
  overridden:   { Icon: ShieldAlert,  cls: 'is-over' },
  not_required: { Icon: CircleDashed, cls: 'is-off'  },
  pending:      { Icon: CircleDashed, cls: 'is-wait' },
  fail:         { Icon: CircleX,      cls: 'is-fail' },
};

function Gates({ card, reload, toast }) {
  const { user } = useAuth();
  const isSuper = Boolean(user?.is_super_admin);
  const [busy, setBusy]   = useState('');
  const [open, setOpen]   = useState(null);   // gate key whose form is open
  const [form, setForm]   = useState({ reason: '', photo_url: '' });

  /* Which groups have had their cleared gates opened up. Keyed by group, so
     opening one does not open the other. */
  const [shown, setShown] = useState({});

  const gates = card.gates || [];
  const redReady = countOpenGates(gates, 'ready');
  /* What stays on screen. NOT the same question as "is this blocking" — a gate
     a hub has switched off can still be reporting an unbilled part, and that is
     a warning wearing a green state. The backend sets `quiet` because it is the
     only place that knows the difference; the fallback keeps this working
     against a card fetched before that field existed. */
  const isLoud = g => (g.quiet === undefined
    ? !['pass', 'overridden', 'not_required'].includes(g.state)
    : !g.quiet);

  async function act(key, path, body, label) {
    setBusy(key);
    try {
      await api(`/api/job-cards/${card.id}/gates/${key}${path}`, { method: 'POST', body });
      setOpen(null); setForm({ reason: '', photo_url: '' });
      await reload(); toast(label);
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  }
  async function clear(key) {
    setBusy(key);
    try {
      await api(`/api/job-cards/${card.id}/gates/${key}`, { method: 'DELETE' });
      await reload(); toast('Withdrawn.');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  }

  /* One gate row, lifted out of the map so the open ones and the cleared ones
     can be rendered in two places WITHOUT two copies of the row. Every control
     below is exactly the one that was here before, doing exactly what it did.

     What left: the per-row "blocks Ready" label. It was printed on five of six
     rows, and a label on nearly every row has stopped being information — it is
     the group heading now, said once where it separates things. */
  function renderGate(g) {
    const { Icon, cls } = GATE_ICON[g.state] || GATE_ICON.fail;
    const red = !['pass', 'overridden', 'not_required'].includes(g.state);
    return (
          <div className={`jc-gate ${cls}`} key={g.key}>
            <Icon size={16} className="jc-gate-icon" />
            <div className="jc-gate-body">
              <strong>{g.label}</strong>
              <p>{g.detail}</p>

              {open === g.key && (
                <form className="jc-gate-form" onSubmit={e => {
                  e.preventDefault();
                  if (g.manual && g.state !== 'overridden') {
                    act(g.key, '', { reason: form.reason || null, photo_url: form.photo_url || null },
                        'Confirmed.');
                  } else {
                    act(g.key, '/override', { reason: form.reason }, 'Overridden.');
                  }
                }}>
                  <input className="jc-input" autoFocus value={form.reason}
                         onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                         placeholder={g.manual
                           ? 'What was shown to the customer? (optional)'
                           : 'Why is this being overridden? (required)'} />
                  {g.manual && (
                    <input className="jc-input" value={form.photo_url}
                           onChange={e => setForm(f => ({ ...f, photo_url: e.target.value }))}
                           placeholder="Photo of old vs new part (optional)" />
                  )}
                  <div className="jc-gate-actions">
                    <button type="button" className="button secondary jc-sm"
                            onClick={() => setOpen(null)}>Cancel</button>
                    <button className="button primary jc-sm"
                            disabled={busy === g.key || (!g.manual && !form.reason.trim())}>
                      {g.manual ? 'Confirm' : 'Override'}
                    </button>
                  </div>
                </form>
              )}
            </div>

            {open !== g.key && (
              <div className="jc-gate-side">
                {/* The ONE gate a person may tick. Everything else is worked
                    out from the card, and offering a button here would be the
                    checkbox-anyone-can-tick the whole design avoids. */}
                {g.manual && g.state === 'pending' && (
                  <button className="button secondary jc-sm" disabled={busy === g.key}
                          onClick={() => { setForm({ reason: '', photo_url: '' }); setOpen(g.key); }}>
                    Confirm
                  </button>
                )}
                {g.state === 'overridden' && isSuper && (
                  <button className="jc-link-btn" onClick={() => clear(g.key)}>Withdraw</button>
                )}
                {g.manual && g.state === 'pass' && (
                  <button className="jc-link-btn" onClick={() => clear(g.key)}>Undo</button>
                )}
                {red && isSuper && g.state !== 'overridden' && (
                  <button className="jc-link-btn jc-link-btn--warn"
                          onClick={() => { setForm({ reason: '', photo_url: '' }); setOpen(g.key); }}>
                    <Unlock size={11} /> Override
                  </button>
                )}
              </div>
            )}
          </div>
    );
  }

  /* Two groups, in the order a car meets them. A gate that blocks Delivery is
     not in the way of Ready, and mixing them made six rows that all looked
     equally urgent. */
  const GROUPS = [
    ['ready',    'Before Ready',    gates.filter(g => g.blocks === 'ready')],
    ['delivery', 'Before Delivery', gates.filter(g => g.blocks !== 'ready')],
  ];

  return (
    <Section icon={ShieldCheck} title="Compliance"
             sub={redReady
               ? `${redReady} thing${redReady === 1 ? '' : 's'} still in the way of Ready`
               : 'Nothing stands in the way of Ready.'}
             right={redReady
               ? <span className="jc-pill is-fail">{redReady} to clear</span>
               : <span className="jc-pill is-done">All clear</span>}>
      {GROUPS.map(([key, label, list]) => {
        if (!list.length) return null;
        const blocking = list.filter(isLoud);
        const cleared  = list.filter(g => !isLoud(g));
        /* Opened by the user, OR forced open because a form is showing inside
           it — a cleared gate being undone must not have its own form hidden. */
        const isShown = shown[key] || cleared.some(g => g.key === open);
        return (
          <div className="jc-gate-group" key={key}>
            <div className="jc-group-hd">{label}</div>

            {/* What somebody has to go and do, in full. */}
            {blocking.map(renderGate)}
            {blocking.length === 0 && (
              <p className="jc-group-none">Nothing outstanding here.</p>
            )}

            {/* What is already settled, out of the way but one click from it.
                Four passing gates took eight lines and needed none. */}
            {cleared.length > 0 && (
              <>
                <button type="button" className="jc-fold" aria-expanded={isShown}
                        onClick={() => setShown(v => ({ ...v, [key]: !isShown }))}>
                  <ChevronRight size={13} className="jc-fold-cv" />
                  <span>
                    <b>{cleared.length} other{cleared.length === 1 ? '' : 's'}</b>
                    {' — '}{cleared.map(g => g.label.toLowerCase()).join(', ')}. All clear.
                  </span>
                </button>
                {isShown && (
                  <div className="jc-fold-body">{cleared.map(renderGate)}</div>
                )}
              </>
            )}
          </div>
        );
      })}

      {!isSuper && gates.some(g => !['pass', 'overridden', 'not_required'].includes(g.state)) && (
        <p className="jc-hint">
          A red check can only be set aside by a super admin, and the reason is recorded on this card.
        </p>
      )}
    </Section>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   Gate pass
   ─────────────────────────────────────────────────────────────────────── */
function GatePass({ card, reload, toast }) {
  const { user } = useAuth();
  const isSuper = Boolean(user?.is_super_admin);
  const [f, setF]   = useState({ odometer_out: '', fuel_out: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const pass = card.gate_pass;

  useEffect(() => {
    if (card.odometer_out != null) setF(p => ({ ...p, odometer_out: String(card.odometer_out) }));
    if (card.fuel_out != null)     setF(p => ({ ...p, fuel_out: String(card.fuel_out) }));
  }, [card.odometer_out, card.fuel_out]);

  async function issue(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { notes: f.notes.trim() || null };
      if (f.odometer_out !== '') body.odometer_out = Number(f.odometer_out);
      if (f.fuel_out !== '')     body.fuel_out     = Number(f.fuel_out);
      await api(`/api/job-cards/${card.id}/gate-pass`, { method: 'POST', body });
      await reload(); toast('Gate pass issued.');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function revoke() {
    const reason = window.prompt('Why is this gate pass being revoked? It goes on the timeline.');
    if (!reason?.trim()) return;
    try {
      await api(`/api/job-cards/${card.id}/gate-pass`, { method: 'DELETE', body: { reason: reason.trim() } });
      await reload(); toast('Gate pass revoked.');
    } catch (e) { toast(e.message, 'error'); }
  }

  if (pass) {
    return (
      <Section icon={KeyRound} title="Gate pass" sub="The vehicle may leave.">
        <div className="jc-pass">
          <div className="jc-pass-no">{pass.pass_no}</div>
          <dl>
            <div><dt>Odometer out</dt><dd>{pass.odometer_out ?? '—'} km</dd></div>
            <div><dt>Fuel out</dt><dd>{FUEL_LABELS[pass.fuel_out] ?? '—'}</dd></div>
            <div><dt>Items returned</dt><dd>{pass.items_returned} of {pass.items_total}</dd></div>
            <div><dt>Issued</dt><dd>{fmt(pass.issued_at)}</dd></div>
          </dl>
          {pass.notes && <p className="jc-pass-note">{pass.notes}</p>}
          <span className="jc-pass-meta">
            Issued by {pass.issued_by_name || 'system'}. These readings are frozen — correcting the
            card afterwards does not change what this pass said.
          </span>
          {isSuper && <button className="jc-link-btn jc-link-btn--warn" onClick={revoke}>Revoke</button>}
        </div>
      </Section>
    );
  }

  const custSigned = (card.signatures || [])
    .some(s => s.role === 'customer' && s.stage === 'delivery');

  return (
    <Section icon={KeyRound} title="Gate pass" sub="Issued when the vehicle leaves.">
      {/* Said up front rather than discovered by pressing the button. The API
          refuses without it, and being told why in advance is the difference
          between a form and an argument. */}
      {!custSigned && (
        <div className="jc-warn">
          <AlertCircle size={13} /> The customer has to sign for the vehicle before a pass can be issued.
        </div>
      )}
      <form className="jc-passform" onSubmit={issue}>
        <div className="jc-readings">
          <div className="jc-field">
            <label><Gauge size={13} /> Odometer out</label>
            <input className="jc-input" type="number" min="0" value={f.odometer_out}
                   onChange={e => setF(p => ({ ...p, odometer_out: e.target.value }))} />
          </div>
          <div className="jc-field">
            <label><Fuel size={13} /> Fuel out</label>
            <select className="jc-input" value={f.fuel_out}
                    onChange={e => setF(p => ({ ...p, fuel_out: e.target.value }))}>
              <option value="">—</option>
              {FUEL_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
            </select>
          </div>
        </div>
        <input className="jc-input" value={f.notes} placeholder="Notes (required if anything is still missing)"
               onChange={e => setF(p => ({ ...p, notes: e.target.value }))} />
        <button className="button primary" disabled={busy || !custSigned}>
          {busy ? 'Issuing…' : 'Issue gate pass'}
        </button>
      </form>
    </Section>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   Signatures recorded on the card
   ─────────────────────────────────────────────────────────────────────── */
function Signatures({ card }) {
  const rows = card.signatures || [];
  const ROLE = { customer: 'Customer', technician: 'Technician', qc: 'Quality check', advisor: 'Service advisor' };
  const STAGE = { intake: 'on arrival', qc: 'at quality check', delivery: 'at handover' };

  return (
    <Section icon={ShieldCheck} title="Signatures"
             sub="Signed on the inspection sheets and at handover.">
      {rows.length === 0 && <div className="jc-empty">Nothing signed yet.</div>}
      {rows.map(s => (
        <div className="jc-sigrow" key={s.id}>
          {s.image_url
            ? <img src={s.image_url} alt={`${ROLE[s.role]} signature`} />
            : <span className="jc-sigtyped">{s.signer_name}</span>}
          <div>
            <strong>{ROLE[s.role] || s.role}</strong> {STAGE[s.stage] || s.stage}
            <span>{s.signer_name} · {fmt(s.signed_at)}</span>
            {s.override_reason && (
              <span className="jc-sigoverride">
                <AlertCircle size={11} /> QC rule overridden: {s.override_reason}
              </span>
            )}
          </div>
        </div>
      ))}
    </Section>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   The History section used to live here.
   ───────────────────────────────────────────────────────────────────────
   It was a full card in the right-hand column, holding open a panel's worth of
   height for something people read when something has gone wrong and never
   otherwise — and it cost 200 activity rows on every single load of this page
   to fill it.

   It is components/ActivityDrawer.jsx now, opened from one icon in the detail
   header, fetching its rows only when somebody asks and paging past the 200
   the old panel silently truncated at. `describe` moved with it, unchanged.
   ─────────────────────────────────────────────────────────────────────── */

/* ═══════════════════════════════════════════════════════════════════════════
   The card as a list of rows, not a wall of panels
   ═══════════════════════════════════════════════════════════════════════════
   Seventeen sections stacked in two columns is seventeen open drawers. Every
   one of them was the same size and the same weight, so the card that has
   nothing wrong with it looked exactly like the card that cannot go out, and
   finding either meant scrolling past the other sixteen.

   Same seventeen sections. Same components, same props, same API calls — not
   one of them is touched below; each `render` hands back the component that was
   already there. What changes is the frame around them:

     · each section is ONE 44px row carrying its own answer on the right, so the
       state of the whole card is readable without opening anything;
     · the rows are grouped by the part of the visit they belong to, and only
       the group the car is actually in is open;
     · clicking a row opens that section in a popup, which is the same thing the
       panel showed, at the size it needs, with nothing else competing.

   `stages` is which part of STATUS_FLOW a group covers, and decides which group
   starts open. `gate` is the existing per-hub sections.X switch, read exactly as
   the old render read it. `hide` is a COPY of the component's own early return,
   so a section that used to render nothing now has no row either rather than a
   row that opens an empty box.
   ═══════════════════════════════════════════════════════════════════════ */

const inr = n => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/* The four states a row can be in. `bad` is reserved for something that stops
   the car leaving; if everything were red nothing would be. */
const OK = v => ({ v, s: 'ok' });
const WARN = v => ({ v, s: 'warn' });
const BAD = v => ({ v, s: 'bad' });
const DIM = v => ({ v, s: 'dim' });

const SECTION_GROUPS = [
  {
    key: 'intake', label: 'Intake', stages: [0, 1],
    rows: [
      {
        key: 'complaints', icon: MessageSquareWarning,
        title: 'Complaints & findings',
        gate: s => s.complaints !== false,
        state: c => {
          const n = (c.complaints || []).length;
          return n ? OK(`${n} recorded`) : DIM('None recorded');
        },
        render: p => <Complaints card={p.card} reload={p.reload} toast={p.toast} />,
      },
      {
        key: 'inspections', icon: ClipboardCheck,
        title: 'Inspections',
        gate: s => s.inspection !== false,
        state: c => {
          const rows = c.inspections || [];
          if (!rows.length) return WARN('Not run');
          const done = rows.filter(i => i.status === 'completed').length;
          const crit = rows.reduce((t, i) => t + Number(i.critical_count || 0), 0);
          if (crit) return BAD(`${crit} critical`);
          return done === rows.length ? OK(`${done} completed`) : WARN(`${done} of ${rows.length} done`);
        },
        render: p => <Inspections card={p.card} appointmentId={p.appointmentId}
                                  reload={p.reload} toast={p.toast} />,
      },
      {
        key: 'items', icon: Briefcase,
        title: 'Items in the vehicle',
        gate: s => s.items_in_vehicle !== false,
        state: c => {
          const rows = c.items || [];
          if (!rows.length) return DIM('None listed');
          const absent = rows.filter(r => r.state === 'absent').length;
          return absent ? WARN(`${absent} absent`) : OK(`${rows.length} listed`);
        },
        render: p => <ItemsInVehicle card={p.card} reload={p.reload} toast={p.toast} />,
      },
      {
        key: 'damage', icon: Car,
        title: 'Body diagram',
        gate: s => s.body_diagram !== false,
        state: c => {
          const n = (c.damage || []).length;
          return n ? WARN(`${n} mark${n === 1 ? '' : 's'}`) : DIM('No marks');
        },
        render: p => <Damage card={p.card} reload={p.reload} toast={p.toast} />,
      },
      {
        key: 'photos', icon: Camera,
        title: 'Photos',
        gate: s => s.photos !== false,
        state: c => {
          const n = (c.media || []).length;
          return n ? OK(`${n} photo${n === 1 ? '' : 's'}`) : DIM('None');
        },
        render: p => <Photos card={p.card} reload={p.reload} toast={p.toast} />,
      },
      {
        key: 'readings', icon: Gauge,
        title: 'Odometer & fuel',
        /* Two switches, one panel — exactly the condition the old render used. */
        gate: s => s.odometer !== false || s.fuel !== false,
        state: c => {
          const odo = c.odometer_out ?? c.odometer_in;
          return odo == null
            ? WARN('Not taken')
            : OK(`${Number(odo).toLocaleString('en-IN')} km`);
        },
        render: p => <Readings card={p.card} onSave={p.patchCard} toast={p.toast} />,
      },
    ],
  },
  {
    key: 'work', label: 'Work', stages: [2, 3, 4, 5, 6],
    rows: [
      {
        key: 'booked', icon: PhoneCall,
        title: 'Booked on the phone',
        /* Booked() returns null with no booking — a walk-in has none. */
        hide: c => (c.booked_services || []).length === 0,
        state: c => {
          const b = c.booked_summary || {};
          if (!b.count) return DIM('Nothing booked');
          return b.not_on_estimate
            ? WARN(`${b.not_on_estimate} not quoted`)
            : OK(`${b.count} booked`);
        },
        render: p => <Booked card={p.card} />,
      },
      {
        key: 'declined', icon: RotateCcw,
        title: 'Refused before',
        hide: c => (c.declined_before || []).length === 0,
        state: c => {
          const n = (c.declined_before || []).length;
          return n ? WARN(`${n} · ${inr(c.declined_before_total)}`) : DIM('None');
        },
        render: p => <PreviouslyDeclined card={p.card} reload={p.reload} toast={p.toast} />,
      },
      {
        key: 'techs', icon: Users,
        title: 'Technicians',
        gate: s => s.technicians !== false,
        state: c => {
          const n = (c.technicians || []).length;
          return n ? OK(`${n} assigned`) : WARN('Nobody assigned');
        },
        render: p => <Technicians card={p.card} reload={p.reload} toast={p.toast} />,
      },
      {
        key: 'labour', icon: Timer,
        title: 'Time logged',
        gate: s => s.labour !== false,
        state: c => {
          const m = Number((c.labour_summary || {}).minutes || 0);
          if (!m) return DIM('No time logged');
          const h = Math.floor(m / 60);
          return OK(h ? `${h}h ${m % 60}m` : `${m}m`);
        },
        render: p => <Labour card={p.card} reload={p.reload} toast={p.toast} />,
      },
      {
        key: 'parts', icon: Package,
        title: 'Parts issued',
        gate: s => s.parts !== false,
        state: c => {
          const n = (c.parts || []).length;
          return n ? OK(`${n} issued`) : DIM('None issued');
        },
        render: p => <Parts card={p.card} reload={p.reload} toast={p.toast} />,
      },
    ],
  },
  {
    key: 'handover', label: 'Handover', stages: [7, 8, 9],
    rows: [
      {
        key: 'estimates', icon: FileText,
        title: 'Estimates',
        state: c => {
          const rows = (c.estimates || []).filter(e => e.status !== 'cancelled');
          if (!rows.length) return WARN('Not raised');
          const total = rows.reduce((s, e) => s + Number(e.grand_total || 0), 0);
          const billed = rows.every(e => e.invoiced);
          return billed ? OK(`${inr(total)} · invoiced`) : WARN(`${inr(total)} · not invoiced`);
        },
        render: p => <Estimates card={p.card} appointmentId={p.appointmentId} />,
      },
      {
        key: 'auth', icon: CircleCheck,
        title: 'Authorisation',
        /* Authorisation() returns null on both of these together. */
        hide: c => (c.lines || []).length === 0
          && !(c.estimates || []).some(e => e.status !== 'cancelled'),
        state: c => {
          const m = c.money || {};
          if (m.pending_count) return WARN(`${m.pending_count} awaiting`);
          if (Number(m.declined)) return WARN(`${inr(m.declined)} declined`);
          if (Number(m.approved)) return OK(`${inr(m.approved)} approved`);
          return DIM('Nothing to authorise');
        },
        render: p => <Authorisation card={p.card} reload={p.reload} toast={p.toast} />,
      },
      {
        key: 'billing', icon: IndianRupee,
        title: 'Billed and paid',
        /* Billing() returns null with no invoice. */
        hide: c => (c.invoices_billing || []).length === 0,
        state: c => {
          const b = c.billing || {};
          return Number(b.due || 0) > 0 ? WARN(`${inr(b.due)} owed`) : OK('Settled');
        },
        render: p => <Billing card={p.card} />,
      },
      {
        key: 'gates', icon: ShieldAlert,
        title: 'Compliance',
        gate: s => s.gates !== false,
        state: c => {
          const open = countOpenGates(c.gates, 'ready');
          return open ? BAD(`${open} to clear`) : OK('All clear');
        },
        render: p => <Gates card={p.card} reload={p.reload} toast={p.toast} />,
      },
      {
        key: 'signatures', icon: PenLine,
        title: 'Signatures',
        gate: s => s.signatures !== false,
        state: c => {
          const n = (c.signatures || []).length;
          return n ? OK(`${n} signed`) : WARN('None');
        },
        render: p => <Signatures card={p.card} />,
      },
      {
        key: 'gatepass', icon: KeyRound,
        title: 'Gate pass',
        gate: s => s.gate_pass !== false,
        state: c => (c.gate_pass ? OK('Issued') : DIM('Not issued')),
        render: p => <GatePass card={p.card} reload={p.reload} toast={p.toast} />,
      },
    ],
  },
];

/* Which rows this card actually shows, group by group: the hub's own section
   switches first, then each component's own "nothing to show" rule. */
function visibleRows(group, card, sections) {
  return group.rows.filter(r =>
    (!r.gate || r.gate(sections)) && !(r.hide && r.hide(card)));
}

/* One section, one line. The answer is on the right because that is the column
   somebody scans down; the icon is on the left because that is what they aim
   at once they know which line they want. */
function JcRow({ row, card, onOpen }) {
  const st = row.state ? row.state(card) : DIM('');
  const Icon = row.icon;
  return (
    <button type="button" className="jcx-row" data-s={st.s} onClick={onOpen}>
      <Icon size={16} className="jcx-row-ic" />
      <span className="jcx-row-t">{row.title}</span>
      <span className="jcx-row-v">{st.v}</span>
      <ChevronRight size={15} className="jcx-row-go" />
    </button>
  );
}

/* A group folds. The heading keeps saying what is inside it while it is shut,
   so folding hides the detail and never the problem. */
function JcGroup({ group, rows, card, open, onToggle, onOpenRow, isCurrent }) {
  const states = rows.map(r => (r.state ? r.state(card) : DIM('')).s);
  const bad = states.filter(s => s === 'bad').length;
  const warn = states.filter(s => s === 'warn').length;
  const note = [
    bad && `${bad} blocking`,
    warn && `${warn} to complete`,
  ].filter(Boolean).join(', ');

  return (
    <section className="jcx-group">
      <button type="button" className="jcx-ghdr" onClick={onToggle}
              aria-expanded={open}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <strong>{group.label}</strong>
        {isCurrent && <em className="jcx-now">Current</em>}
        <span className="jcx-gnote">{note || 'All done'}</span>
      </button>
      {open && (
        <div className="jcx-rows">
          {rows.map(r => (
            <JcRow key={r.key} row={r} card={card} onOpen={() => onOpenRow(r.key)} />
          ))}
        </div>
      )}
    </section>
  );
}

/* The section itself, at the size it needs. Prev/next walk every visible row on
   the card in order, so working through a card never means closing this and
   hunting for the next line. */
function SectionModal({ row, order, onClose, onGo, ctx }) {
  useEscapeClose(onClose);
  const i = order.findIndex(r => r.key === row.key);
  const Icon = row.icon;
  return (
    <div className="jc-backdrop" onClick={onClose}>
      <div className="jc-modal jc-modal--sec" onClick={e => e.stopPropagation()}>
        <div className="jc-modal-hdr">
          <h3><Icon size={16} /> {row.title}</h3>
          <div className="jcx-mnav">
            <button type="button" className="jc-icon-btn" title="Previous section"
                    disabled={i <= 0} onClick={() => onGo(order[i - 1].key)}>
              <ChevronLeft size={16} />
            </button>
            <button type="button" className="jc-icon-btn" title="Next section"
                    disabled={i < 0 || i >= order.length - 1}
                    onClick={() => onGo(order[i + 1].key)}>
              <ChevronRight size={16} />
            </button>
            <button type="button" className="jc-icon-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="jc-modal-body jcx-mbody">{row.render(ctx)}</div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   The page
   ─────────────────────────────────────────────────────────────────────── */
/**
 * @param {object}  props
 * @param {number}  [props.appointmentId]  when rendered INSIDE the job card
 *   list, the id comes from the list's selection rather than the URL. The
 *   route parameter is still the fallback, so /job-cards/:appointmentId works
 *   exactly as it did before this prop existed and the appointment drawer's
 *   link is unchanged.
 * @param {boolean} [props.embedded]  drop the Back button and the page's own
 *   outer padding. The list is the frame when embedded, and a second Back
 *   button inside it would take the person out of a screen they can see.
 */
export default function JobCardPage({ appointmentId: propAppointmentId, embedded = false }) {
  const params = useParams();
  const appointmentId = propAppointmentId ?? params.appointmentId;
  const navigate = useNavigate();
  const P = useAppPaths();

  const [card, setCard]       = useState(null);
  const [appt, setAppt]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [toastMsg, setToastMsg] = useState(null);
  /* The status the user has picked but not yet confirmed. Every change goes
     through the prompt now, not only a hold — that is the whole of step 6. */
  const [pendingStatus, setPendingStatus] = useState(null);
  const [gateBlock, setGateBlock] = useState(null);
  /* Which section is open in the popup, by row key, and which groups are
     folded open. `null` on openGroups means "not decided yet" — the effect
     below opens the group the car is actually in, once, and after that the
     person's own folding is what decides. */
  const [openRow, setOpenRow] = useState(null);
  const [openGroups, setOpenGroups] = useState(null);
  const { user } = useAuth();

  const toast = (msg, type = 'success') => {
    setToastMsg({ msg, type });
    setTimeout(() => setToastMsg(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api(`/api/job-cards/by-appointment/${appointmentId}`);
      setCard(r.item);
      /* Only fetched when there is no card — once one exists its own payload
         carries the customer, vehicle and hub, and a second request for the
         same facts is a second chance for them to disagree. */
      if (!r.item) {
        const a = await api(`/api/appointments/${appointmentId}`);
        setAppt(a.item || a);
      }
      setError('');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [appointmentId]);

  useEffect(() => { load(); }, [load]);

  /* Memoised, not because working it out is expensive but because the row list
     below is keyed on it: a fresh `{}` on every render would rebuild the
     groups on every render, for a value that only changes when the card does. */
  const sections = useMemo(() => card?.sections || {}, [card?.sections]);

  async function patchCard(body) {
    const r = await api(`/api/job-cards/${card.id}`, { method: 'PATCH', body });
    /* Merge rather than reload, so the box the person is tabbing out of does
       not have the ground moved under it. */
    setCard(c => ({ ...c, ...r.item }));
    /* Except for a reading. Editing odometer or fuel writes a `correction` row
       (migration 196), and that row is on the trail — which the PATCH response
       does not carry, because it returns the job_cards row and nothing hanging
       off it. Without this the figure updates and the trail silently does not,
       which is the one thing a trail must never do. */
    if (['odometer_in', 'odometer_out', 'fuel_in', 'fuel_out']
          .some(k => body[k] !== undefined)) {
      await load();
    }
    return r.item;
  }

  async function changeStatus(status, hold_reason, override_reason, reading = {}) {
    try {
      const res = await api(`/api/job-cards/${card.id}/status`, {
        method: 'PATCH',
        body: {
          status, hold_reason, override_reason,
          /* Left out entirely when not taken, rather than sent as null. The
             schema treats both the same, but a body that only carries what was
             actually read is the one that reads correctly in a request log. */
          ...(reading.odometer !== undefined ? { odometer: reading.odometer } : {}),
          ...(reading.fuel     !== undefined ? { fuel:     reading.fuel }     : {}),
        },
      });
      setGateBlock(null);
      await load();
      toast(res?.reading
        ? `Moved to ${STATUS_LABELS[status]}, reading saved.`
        : `Moved to ${STATUS_LABELS[status]}.`);
    } catch (e) {
      /* A compliance refusal is not a toast. It lists what is in the way, it
         stays on screen while the person goes and fixes it, and for a super
         admin it offers the way through — all of which a message that fades
         after three seconds cannot do. */
      if (e.data?.blockers) setGateBlock({ status, ...e.data });
      else toast(e.message, 'error');
    }
  }

  const header = card || appt;

  const vehicleLine = useMemo(() => {
    if (!header) return '';
    return [header.make_name, header.model_name].filter(Boolean).join(' ');
  }, [header]);

  /* Where the card sits on the line, and what the next move would be. -1 for a
     status that is not on it (on_hold, cancelled) — the stepper hides and the
     dropdown carries the whole job, exactly as it did before. */
  const flowIndex  = card ? STATUS_FLOW.indexOf(card.status) : -1;
  const nextStatus = flowIndex >= 0 && flowIndex < STATUS_FLOW.length - 1
    ? STATUS_FLOW[flowIndex + 1] : null;
  /* The same count the Compliance panel prints, from the same function. */
  const readyBlockers = countOpenGates(card?.gates, 'ready');

  /* The last odometer anybody actually took on this card. The trail is the
     authority — it is every reading in order — and the two columns are the
     fallback for a card opened before migration 196, or one whose trail is
     still empty because no reading has been taken yet. */
  const lastOdometer = useMemo(() => {
    const withOdo = (card?.readings || []).filter(r => r.odometer !== null && r.odometer !== undefined);
    if (withOdo.length) return Number(withOdo[withOdo.length - 1].odometer);
    return card?.odometer_out ?? card?.odometer_in ?? null;
  }, [card?.readings, card?.odometer_in, card?.odometer_out]);

  /* ── The rows this card shows ───────────────────────────────────────────
     Every section switch the hub has turned off, and every section that would
     have rendered nothing, is resolved once here rather than at seventeen
     render sites. `order` is the same list flattened, which is what prev/next
     in the popup walks. */
  const groups = useMemo(() => {
    if (!card) return [];
    return SECTION_GROUPS
      .map(g => ({ group: g, rows: visibleRows(g, card, sections) }))
      .filter(g => g.rows.length > 0);
  }, [card, sections]);

  const order = useMemo(() => groups.flatMap(g => g.rows), [groups]);

  /* Which group the car is actually in. -1 — on hold, cancelled — belongs to
     no group, and then nothing is folded away: a stopped car is exactly when
     somebody needs to see the whole card at once. */
  const currentGroupKey = useMemo(() => {
    if (flowIndex < 0) return null;
    return (SECTION_GROUPS.find(g => g.stages.includes(flowIndex)) || {}).key || null;
  }, [flowIndex]);

  /* Opened once, when the card first arrives or the stage moves it on. After
     that `openGroups` holds whatever the person has folded, and this leaves it
     alone — re-deciding on every reload would shut a group somebody had just
     opened, on every save. */
  useEffect(() => {
    if (!card) return;
    setOpenGroups(currentGroupKey
      ? { [currentGroupKey]: true }
      : Object.fromEntries(SECTION_GROUPS.map(g => [g.key, true])));
  }, [card?.id, currentGroupKey]);

  const openSection = openRow ? order.find(r => r.key === openRow) : null;

  /* A row whose section has stopped being visible — the last part returned, the
     last estimate cancelled — must not leave a popup open over nothing. */
  useEffect(() => {
    if (openRow && !order.some(r => r.key === openRow)) setOpenRow(null);
  }, [openRow, order]);

  /* What the fuel gauge read, in the same words the Readings panel uses. The
     word "tank" is on it because "½" on its own under an odometer reads as
     half a kilometre. */
  const fuelLine = (() => {
    const f = card?.fuel_out ?? card?.fuel_in;
    if (f == null) return 'fuel not taken';
    return FUEL_LABELS[f] ? `${FUEL_LABELS[f]} tank` : '—';
  })();

  /* ONLY on the first load. `if (loading)` on every reload tore the whole page
     down and built it again after each save, which threw away every section's
     open form, its half-typed input and the scroll position — so logging three
     tasks for the same mechanic meant picking their name three times. A reload
     that already has a card to show simply swaps the data underneath it. */
  if (loading && !card && !appt) {
    return (
      <div className={`jc-page${embedded ? ' jc-page--embedded' : ''}`}>
        <div className="jc-empty">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`jc-page${embedded ? ' jc-page--embedded' : ''}`}>
        {!embedded && (
          <button className="jc-back" onClick={() => navigate(-1)}><ArrowLeft size={15} /> Back</button>
        )}
        <div className="jc-err"><AlertCircle size={13} /> {error}</div>
      </div>
    );
  }

  return (
    <div className={`jc-page${embedded ? ' jc-page--embedded' : ''}`}>
      {toastMsg && (
        <div className={`jc-toast jc-toast--${toastMsg.type}`}>
          <CheckCircle2 size={14} /> {toastMsg.msg}
        </div>
      )}

      {!embedded && (
        <button className="jc-back" onClick={() => navigate(-1)}>
          <ArrowLeft size={15} /> Back
        </button>
      )}

      {/* ── The header ───────────────────────────────────────────────────────
          Same facts, same one control that moves this card. What changed is
          weight: the question people open a job card to ask — can it go out —
          now sits beside the number instead of 11.5px grey inside a panel, and
          the status is drawn as the line it travels rather than a form field.

          The dropdown is untouched and still carries every status in
          STATUS_ORDER. The move button beside it is a shortcut to the same
          setPendingStatus call, not a second way of doing it. */}
      <header className="jc-hdr">
        <div className="jc-hdr-top">
          {/* Dropped when embedded: the list's detail bar directly above
              already carries the card number, and the same string twice in two
              stacked bars is the kind of thing that makes a screen feel
              assembled rather than designed. */}
          {!embedded && (
            <h2>
              <ClipboardList size={20} />
              {card ? card.job_card_no : 'Job card'}
            </h2>
          )}
          {card && (
            <span className={`jc-pill jc-pill--status is-${card.status}`}>
              {STATUS_LABELS[card.status]}
            </span>
          )}
          {/* Only when something is actually in the way. A green "0 to clear"
              is a line of chrome on every card that is fine. */}
          {card && readyBlockers > 0 && (
            <span className="jc-pill is-fail">
              {readyBlockers} block{readyBlockers === 1 ? 's' : ''} Ready
            </span>
          )}
          {/* "Can you look at this card?" is the commonest thing anybody says
              about a job card, so the share sits on the card rather than making
              somebody go and find it from chat.

              Additive only. It renders nothing without USE_CHAT, it sends a
              POINTER and never the card, and it changes no existing control —
              shot16 §7 exists to keep that true. */}
          {card && (
            <ShareToChat
              refType="job_card"
              refId={card.id}
              label={card.job_card_no}
              compact={embedded}
            />
          )}
        </div>

        {/* The customer and the vehicle, which the list's bar does not show.
            Chips rather than a dotted run-on: at rail width the separators
            wrapped onto their own line and left dangling dots. */}
        <div className="jc-hdr-facts">
          <span className="is-lead">{header?.customer_name || '—'}</span>
          <span className="is-lead">{header?.vehicle_number || '—'}</span>
          {vehicleLine && <span>{vehicleLine}</span>}
          <span>{header?.hub_name || '—'}</span>
          {header?.appointment_code && (
            /* The appointments page opens a drawer from the token in the URL
               (route /appointments/:token?), so the link carries the token
               rather than the id — without it this lands on the bare list. */
            <Link className="jc-appt-link"
                  to={`${P.appointments}/${header.appointment_token || header.public_token || ''}`}>
              {header.appointment_code}
            </Link>
          )}
        </div>

        {card && (
          <>
            {/* Where the job is, without reading anything. Off-flow statuses —
                on_hold, cancelled — have no step; the line stays as it was and
                the pill above says what happened instead. */}
            {flowIndex >= 0 && (
              <ol className="jcx-rail">
                {STATUS_FLOW.map((s, i) => (
                  <li key={s}
                      className={`jcx-st${i < flowIndex ? ' is-done' : ''}${i === flowIndex ? ' is-now' : ''}`}>
                    <b>{i + 1}</b>{STATUS_SHORT[s]}
                  </li>
                ))}
              </ol>
            )}

            {/* The four facts somebody reads before they read anything else.
                Every one of them is already on the card — this is where they
                are, not a new thing to keep up to date. */}
            <div className="jcx-sum">
              <div className="jcx-tile">
                <span><Car size={13} /> Vehicle</span>
                <strong>{header?.vehicle_number || '—'}</strong>
                <em>{vehicleLine || '—'}</em>
              </div>
              <div className="jcx-tile">
                <span><Gauge size={13} /> Odometer</span>
                <strong className="jcx-num">
                  {lastOdometer != null
                    ? `${Number(lastOdometer).toLocaleString('en-IN')} km`
                    : '—'}
                </strong>
                <em>{fuelLine}</em>
              </div>
              <div className="jcx-tile">
                <span><IndianRupee size={13} /> Outstanding</span>
                <strong className={`jcx-num${Number(card.billing?.due || 0) > 0 ? ' is-due' : ''}`}>
                  {inr(card.billing?.due)}
                </strong>
                <em>{inr(card.billing?.billed)} billed · {inr(card.billing?.paid)} paid</em>
              </div>
              <div className="jcx-tile">
                <span><Users size={13} /> Technician</span>
                <strong>{(card.technicians || [])[0]?.name || 'Nobody assigned'}</strong>
                <em>
                  {Number((card.labour_summary || {}).minutes || 0)
                    ? `${Math.floor(card.labour_summary.minutes / 60)}h ${card.labour_summary.minutes % 60}m logged`
                    : 'no time logged'}
                </em>
              </div>
            </div>

            <div className="jc-hdr-act">
              {nextStatus && (
                <button type="button" className="button primary jc-next"
                        onClick={() => setPendingStatus(nextStatus)}>
                  Move to {STATUS_LABELS[nextStatus]}
                  <ChevronRight size={15} />
                </button>
              )}
              {/* Unchanged. Every status, same handler, same prompt behind it. */}
              <select className="jc-input jc-status-sel" value={card.status}
                      aria-label="Status"
                      onChange={e => setPendingStatus(e.target.value)}>
                {STATUS_ORDER.map(s => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
              <span className="jc-appt-status">
                Appointment shows <b>{card.appointment_status_name || '—'}</b>
              </span>
            </div>

            {card.status === 'on_hold' && card.hold_reason && (
              <div className="jc-hold"><PauseCircle size={13} /> {card.hold_reason}</div>
            )}
          </>
        )}
      </header>

      {gateBlock && (
        <GateBlock block={gateBlock} isSuper={Boolean(user?.is_super_admin)}
                   onClose={() => setGateBlock(null)}
                   onForce={reason => changeStatus(gateBlock.status, undefined, reason)} />
      )}

      {!card && header && <OpenPanel appointment={header} onOpened={c => { setCard(c); toast('Job card opened.'); }} />}

      {/* ── The card itself ───────────────────────────────────────────────
          One row per section, grouped by the part of the visit they belong to.
          The same seventeen components as before — they are in the popup now,
          with exactly the props they always had. Nothing about what any of them
          DOES has changed; only where you click to see it. */}
      {card && (
        <div className="jcx-body">
          {/* Said once, at the top, because it is the one thing that stops a car
              leaving and the Compliance row further down is where it gets
              fixed. Nothing is said at all when nothing is in the way. */}
          {readyBlockers > 0 && (
            <div className="jcx-block">
              <AlertCircle size={15} />
              <strong>
                {readyBlockers} item{readyBlockers === 1 ? '' : 's'} block handover
              </strong>
              {(sections.gates !== false) && (
                <button type="button" className="jcx-blink"
                        onClick={() => setOpenRow('gates')}>
                  Open compliance
                </button>
              )}
            </div>
          )}

          {groups.map(({ group, rows }) => (
            <JcGroup
              key={group.key}
              group={group}
              rows={rows}
              card={card}
              isCurrent={group.key === currentGroupKey}
              open={Boolean((openGroups || {})[group.key])}
              onToggle={() => setOpenGroups(o => ({ ...o, [group.key]: !(o || {})[group.key] }))}
              onOpenRow={setOpenRow}
            />
          ))}
        </div>
      )}

      {card && openSection && (
        <SectionModal
          row={openSection}
          order={order}
          onClose={() => setOpenRow(null)}
          onGo={setOpenRow}
          /* Every prop the section had in the old two-column layout, by the
             same names, from the same places. */
          ctx={{ card, reload: load, toast, appointmentId, patchCard }}
        />
      )}

      {pendingStatus && (
        <StatusChangeModal
          from={card?.status}
          to={pendingStatus}
          /* The last reading anybody actually took, whatever produced it — the
             trail first, falling back to the two columns for a card whose trail
             has not started. Used only for the comparison; never as the value. */
          lastOdometer={lastOdometer}
          requireReason={pendingStatus === 'on_hold'}
          onClose={() => setPendingStatus(null)}
          onConfirm={({ reason, odometer, fuel }) => {
            const to = pendingStatus;
            setPendingStatus(null);
            changeStatus(to, reason, undefined, { odometer, fuel });
          }}
        />
      )}
    </div>
  );
}
