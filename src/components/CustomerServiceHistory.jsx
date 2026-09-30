import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Wrench, Car, X, Gauge, Calendar, Building2, Users, ChevronRight,
  AlertCircle, RefreshCw,
} from 'lucide-react';
import { api } from '../api/client.js';
import { useAppPaths } from '../lib/appPaths.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import useSync from '../hooks/useSync.js';

/**
 * Two views of the same question, both new, both on the customer profile.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * The profile had Appointments, Invoices, Estimates, Payments, Ledger and an
 * Activity Log. Every one of those is a DOCUMENT trail. None of them answered
 * the question a service advisor actually has with the customer on the phone:
 * what did we last DO to this car, and at what reading.
 *
 * Answering it meant opening the appointment, finding the estimate, reading the
 * lines, and guessing which of them were ever finished. Four screens for one
 * question, and the last step was a guess.
 *
 * ── THESE OWN NO ARITHMETIC ──────────────────────────────────────────────────
 * Both components render figures the API computed, from the same SQL the job
 * card itself uses. Nothing here adds anything up. A screen that does its own
 * totals is a screen that will one day disagree with the card it summarises,
 * and of the two numbers nobody can tell which is true.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
 * There is already a "Vehicle Service History" on the Customer Invoices screen.
 * That one is a global plate SEARCH over invoices: it answers "what have we
 * billed this registration", across customers and hubs, one row per invoice.
 *
 * This one is per visit, for one customer's one car: quoted vs approved vs
 * billed, the readings, the job card, and the lines that were actually
 * finished. A visit that was quoted and never invoiced appears here and cannot
 * appear there. They are different questions and neither replaces the other.
 */

const fmtINR = v =>
  '₹' + Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const fmtDate = d => {
  if (!d) return '—';
  // A plain 'YYYY-MM-DD' is parsed by `new Date()` as UTC midnight and renders
  // as the previous day anywhere behind Greenwich. Same guard the profile's own
  // formatter uses.
  const s = String(d);
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10))
    ? new Date(s.slice(0, 10) + 'T00:00:00')
    : new Date(s);
  return Number.isNaN(dt.getTime())
    ? '—'
    : dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const fmtKm = v =>
  v === null || v === undefined || v === '' || Number(v) === 0
    ? null
    : Number(v).toLocaleString('en-IN') + ' km';

/* Job card statuses, as job_cards.status stores them. Any status not listed
   falls through to the neutral grey rather than rendering unstyled — a new
   status added to the backend must not make this look broken. */
const JC_STATUS = {
  open:        { bg: '#dbeafe', color: '#1e40af', label: 'Open' },
  in_progress: { bg: '#fef3c7', color: '#92400e', label: 'In progress' },
  completed:   { bg: '#dcfce7', color: '#166534', label: 'Completed' },
  closed:      { bg: '#f1f5f9', color: '#475569', label: 'Closed' },
  cancelled:   { bg: '#fee2e2', color: '#b91c1c', label: 'Cancelled' },
};

function JcBadge({ status }) {
  if (!status) return null;
  const s = JC_STATUS[status] || { bg: 'var(--bg-soft)', color: 'var(--text-muted)' };
  return (
    <span className="csh-badge" style={{ backgroundColor: s.bg, color: s.color }}>
      {s.label || String(status).replace(/_/g, ' ')}
    </span>
  );
}

/* Quoted / approved / billed, in that order, always all three even when two of
   them are zero. A visit showing only "₹2,600" tells you nothing about whether
   that was asked for, agreed, or charged — which is the whole point. */
function MoneyRow({ quoted, approved, billed }) {
  return (
    <div className="csh-money">
      <span className="csh-money-cell">
        <em>Quoted</em><b>{fmtINR(quoted)}</b>
      </span>
      <span className="csh-money-cell csh-money-cell--ok">
        <em>Approved</em><b>{fmtINR(approved)}</b>
      </span>
      <span className="csh-money-cell">
        <em>Billed</em><b>{fmtINR(billed)}</b>
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The Job Cards tab
// ─────────────────────────────────────────────────────────────────────────────
/* Mounted only while the tab is open, on purpose. The same reasoning the
   WhatsApp tab carries: this fetch is not free, and a list nobody has looked at
   is a query nobody should have paid for. */
export function CustomerJobCardsTab({ mobile, onCount }) {
  const navigate = useNavigate();
  const P = useAppPaths();
  const [items,   setItems]   = useState(null);   // null = not loaded yet
  const [err,     setErr]     = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!mobile) return;
    setLoading(true); setErr('');
    try {
      const r = await api(`/api/customers/${encodeURIComponent(mobile)}/job-cards`);
      setItems(r.items || []);
      onCount?.(r.items?.length || 0);
    } catch (ex) {
      setErr(ex.message || 'Could not load job cards');
    } finally {
      setLoading(false);
    }
  }, [mobile]);

  useEffect(() => { load(); }, [load]);

  /* There is no 'job_cards' invalidation topic — nothing in the backend emits
     one — so subscribing to it would look like live refresh and never fire.
     These three are the topics that actually move the figures on this tab:
     a line approved or a rate edited changes `approved`, an invoice changes
     `billed`, and an appointment change is what creates the card at all. */
  useSync(['appointments', 'estimates', 'customer_invoices'], load);

  if (items === null && loading) {
    return <div className="cust-empty">Loading job cards…</div>;
  }
  if (err) {
    return (
      <div className="csh-err">
        <AlertCircle size={13}/> {err}
        <button type="button" className="csh-retry" onClick={load}>
          <RefreshCw size={11}/> Retry
        </button>
      </div>
    );
  }
  if (!items?.length) {
    return (
      <div className="cust-empty">
        No job cards for this customer yet. One is opened from the appointment
        when the car arrives.
      </div>
    );
  }

  return (
    <div className="csh-list">
      {items.map(jc => {
        const odo = fmtKm(jc.odometer_out) || fmtKm(jc.odometer_in);
        // P.jobCards is never null — the hub portal has a job cards screen too
        // — but appPaths says to check rather than trust that, because a null
        // would put the string "null/12" in the address bar.
        const canOpen = !!P.jobCards && !!jc.appointment_id;
        return (
          <div
            key={jc.id}
            className={`csh-card${canOpen ? ' csh-card--click' : ''}`}
            role={canOpen ? 'button' : undefined}
            tabIndex={canOpen ? 0 : undefined}
            onClick={canOpen ? () => navigate(`${P.jobCards}/${jc.appointment_id}`) : undefined}
            onKeyDown={canOpen ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate(`${P.jobCards}/${jc.appointment_id}`);
              }
            } : undefined}
          >
            <div className="csh-card-top">
              <span className="csh-card-no"><Wrench size={12}/> {jc.job_card_no || `#${jc.id}`}</span>
              <JcBadge status={jc.status}/>
              <span className="csh-card-date"><Calendar size={11}/> {fmtDate(jc.scheduled_date || jc.created_at)}</span>
              {canOpen && <ChevronRight size={14} className="csh-card-go"/>}
            </div>

            <div className="csh-card-meta">
              {jc.vehicle_number && <span className="csh-plate">{jc.vehicle_number}</span>}
              {jc.hub_name && <span className="csh-meta"><Building2 size={11}/> {jc.hub_name}</span>}
              {jc.technician_count > 0 && (
                <span className="csh-meta">
                  <Users size={11}/> {jc.technician_count} technician{jc.technician_count !== 1 ? 's' : ''}
                </span>
              )}
              {odo && <span className="csh-meta"><Gauge size={11}/> {odo}</span>}
            </div>

            <MoneyRow quoted={jc.quoted} approved={jc.approved} billed={jc.billed}/>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The per-vehicle service history
// ─────────────────────────────────────────────────────────────────────────────
/* Keyed on customer AND plate. Not on plate alone: a car changes hands, and the
   previous owner's spend is not this customer's business. The backend applies
   the same pair. */
export function VehicleServiceHistoryModal({ mobile, vehicleNumber, onClose }) {
  useEscapeClose(onClose);
  const navigate = useNavigate();
  const P = useAppPaths();
  const [data,    setData]    = useState(null);
  const [err,     setErr]     = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true); setErr('');
    api(`/api/customers/${encodeURIComponent(mobile)}/vehicle-history`
        + `?number=${encodeURIComponent(vehicleNumber)}`)
      .then(r => { if (live) setData(r); })
      .catch(ex => { if (live) setErr(ex.message || 'Could not load history'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [mobile, vehicleNumber]);

  const items   = data?.items || [];
  const summary = data?.summary;

  return (
    <div className="csh-backdrop" onClick={onClose}>
      <div className="csh-modal" onClick={e => e.stopPropagation()}>
        <div className="csh-hdr">
          <span className="csh-hdr-t">
            <Car size={14}/> Service history
            <span className="csh-hdr-plate">{vehicleNumber}</span>
          </span>
          <button className="cust-icon-btn" onClick={onClose} aria-label="Close"><X size={15}/></button>
        </div>

        {/* The running totals come from the API, across every visit it matched
            — not from the rows on screen. Adding up what is rendered would
            quietly under-report the moment the list is capped. */}
        {summary && (
          <div className="csh-summary">
            <span className="csh-sum-cell">
              <em>Visits</em><b>{summary.visits}</b>
            </span>
            <span className="csh-sum-cell">
              <em>Quoted</em><b>{fmtINR(summary.quoted)}</b>
            </span>
            <span className="csh-sum-cell csh-sum-cell--ok">
              <em>Approved</em><b>{fmtINR(summary.approved)}</b>
            </span>
            <span className="csh-sum-cell">
              <em>Billed</em><b>{fmtINR(summary.billed)}</b>
            </span>
            {/* Shown only when there is some. A "₹0 declined" cell on a
                customer who has said yes to everything is a column of noise. */}
            {Number(summary.declined) > 0 && (
              <span className="csh-sum-cell csh-sum-cell--no">
                <em>Declined</em><b>{fmtINR(summary.declined)}</b>
              </span>
            )}
            {summary.last_odometer && (
              <span className="csh-sum-cell">
                <em>Last reading</em><b>{fmtKm(summary.last_odometer)}</b>
              </span>
            )}
          </div>
        )}

        <div className="csh-modal-body">
          {loading && <div className="cust-empty">Loading…</div>}
          {!loading && err && <div className="csh-err"><AlertCircle size={13}/> {err}</div>}
          {!loading && !err && items.length === 0 && (
            <div className="cust-empty">
              No visits recorded for {vehicleNumber} under this customer.
            </div>
          )}

          {!loading && !err && items.map(v => {
            const canOpen = !!P.jobCards && !!v.job_card_id && !!v.appointment_id;
            const inKm  = fmtKm(v.odometer_in) || fmtKm(v.appointment_odometer);
            const outKm = fmtKm(v.odometer_out);
            const work     = Array.isArray(v.work_done) ? v.work_done : [];
            const declined = Array.isArray(v.work_declined) ? v.work_declined : [];
            return (
              <div key={v.appointment_id} className="csh-visit">
                <div className="csh-card-top">
                  <span className="csh-card-date"><Calendar size={11}/> {fmtDate(v.scheduled_date)}</span>
                  {/* The appointment's own status, and ONLY when there is no
                      job card. With a card, the card's status is the better
                      answer to "what happened on this visit", and showing both
                      puts two unlabelled pills side by side saying different
                      words about the same day. Without one — every visit that
                      predates the job card module — this is the only thing that
                      says how the visit ended. */}
                  {!v.job_card_id && v.appointment_status && (
                    <span className="csh-badge csh-badge--plain">{v.appointment_status}</span>
                  )}
                  {v.job_card_no && (
                    canOpen ? (
                      <button type="button" className="csh-jclink"
                        onClick={() => navigate(`${P.jobCards}/${v.appointment_id}`)}>
                        <Wrench size={11}/> {v.job_card_no}
                      </button>
                    ) : (
                      <span className="csh-meta"><Wrench size={11}/> {v.job_card_no}</span>
                    )
                  )}
                  <JcBadge status={v.job_card_status}/>
                </div>

                <div className="csh-card-meta">
                  {v.hub_name && <span className="csh-meta"><Building2 size={11}/> {v.hub_name}</span>}
                  {/* In and out shown separately when both exist: the pair is
                      how far the car moved on site, which is the number a
                      warranty query turns on. */}
                  {inKm && (
                    <span className="csh-meta">
                      <Gauge size={11}/> {inKm}{outKm && outKm !== inKm ? ` → ${outKm}` : ''}
                    </span>
                  )}
                  {!inKm && outKm && <span className="csh-meta"><Gauge size={11}/> {outKm}</span>}
                </div>

                <MoneyRow quoted={v.quoted} approved={v.approved} billed={v.billed}/>

                {/* Approved AND finished. A line the customer refused, or one
                    nobody got to, is not service history — that is the
                    difference between this and a list of past estimates. */}
                {work.length > 0 ? (
                  <ul className="csh-work">
                    {work.map((w, i) => (
                      <li key={i}>
                        <span className="csh-work-d">{w.description}</span>
                        {Number(w.quantity) > 1 && <span className="csh-work-q">×{w.quantity}</span>}
                        <span className="csh-work-t">{fmtINR(w.total)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="csh-nowork">
                    Nothing recorded as completed on this visit.
                  </div>
                )}

                {/* What was offered that day and turned down. The other half of
                    the visit, and the half that says what to raise next time.
                    Per visit and unfiltered — whether it was done LATER is the
                    job card's question, not this one's: here it is the record
                    of what happened on this date. */}
                {declined.length > 0 && (
                  <ul className="csh-work csh-work--declined">
                    {declined.map((w, i) => (
                      <li key={i}>
                        <span className="csh-work-d">{w.description}</span>
                        {Number(w.quantity) > 1 && <span className="csh-work-q">×{w.quantity}</span>}
                        <span className="csh-work-t">{fmtINR(w.total)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
