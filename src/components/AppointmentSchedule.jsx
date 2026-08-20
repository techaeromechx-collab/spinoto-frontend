import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAppPaths } from '../lib/appPaths.js';
import { istToday, addDays, weekBounds, fmtDayLabel, fmtTimeShort } from '../lib/istDate.js';
import '../styles/appointmentSchedule.css';

/**
 * The appointment schedule: Today / Tomorrow / This Week / Custom, with the
 * selected range listed and every row opening that appointment.
 *
 * Shared by the hub portal and the staff dashboard. The only difference between
 * the two is the hub column — a hub login only ever sees its own hub, so the
 * column would be the same value on every row.
 *
 * It does NOT send a hub_id. For a hub session the backend pins the query to
 * their own hub (utils/hubScope.js) whatever the client asks for, and for staff
 * the absence of the filter is what makes it show every hub. One request shape,
 * correct in both.
 */

const RANGES = [
  { key: 'today',    label: 'Today'     },
  { key: 'tomorrow', label: 'Tomorrow'  },
  { key: 'week',     label: 'This Week' },
  { key: 'custom',   label: 'Custom'    },
];

const MAX_ROWS = 6;   // a preview; "View all" carries the rest

function StatusPill({ name, color, bg }) {
  if (!name) return null;
  return (
    <span
      className="apsch-pill"
      // title, because the pill truncates: a status long enough to be cut is
      // exactly the one worth being able to read.
      title={name}
      style={{ background: bg || 'var(--bg-soft)', color: color || 'var(--text-muted)' }}
    >
      {name}
    </span>
  );
}

export default function AppointmentSchedule() {
  const navigate = useNavigate();
  const P = useAppPaths();
  const { user } = useAuth();
  // Staff see every hub, so which hub a job belongs to is real information and
  // gets its own column. For a hub login it would repeat their own name down
  // the page, so it is dropped rather than shown greyed out.
  const showHub = !user?.hub_id;

  const today = istToday();
  const tomorrow = addDays(today, 1);
  const week = weekBounds(today);

  const [range, setRange]   = useState('today');
  const [from, setFrom]     = useState(today);
  const [to, setTo]         = useState(addDays(today, 7));
  const [rows, setRows]     = useState([]);      // the today/tomorrow/week window
  const [custom, setCustom] = useState([]);
  const [loading, setLoading]             = useState(true);
  const [customLoading, setCustomLoading] = useState(false);
  const [error, setError]   = useState('');

  // ONE request covers today, tomorrow and the whole week: the window runs from
  // the start of this week to whichever of {end of week, tomorrow} is later —
  // on a Sunday, tomorrow already belongs to next week. Three separate range
  // queries would return overlapping rows for the same appointments.
  const winFrom = week.from;
  const winTo   = week.to > tomorrow ? week.to : tomorrow;

  useEffect(() => {
    let dead = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const qs = new URLSearchParams({ date_from: winFrom, date_to: winTo, limit: '100' });
        const res = await api(`/api/appointments?${qs}`);
        if (!dead) setRows(res.items || []);
      } catch (e) {
        if (!dead) { setRows([]); setError(e.message || 'Could not load the schedule.'); }
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => { dead = true; };
  }, [winFrom, winTo]);

  // Custom range is its own request — it can point anywhere, including months
  // outside the window above.
  useEffect(() => {
    if (range !== 'custom' || !from || !to || from > to) return;
    let dead = false;
    (async () => {
      setCustomLoading(true); setError('');
      try {
        const qs = new URLSearchParams({ date_from: from, date_to: to, limit: '100' });
        const res = await api(`/api/appointments?${qs}`);
        if (!dead) setCustom(res.items || []);
      } catch (e) {
        if (!dead) { setCustom([]); setError(e.message || 'Could not load that range.'); }
      } finally {
        if (!dead) setCustomLoading(false);
      }
    })();
    return () => { dead = true; };
  }, [range, from, to]);

  // The list endpoint orders by created_at — booking order. A schedule has to
  // read in the order the day actually happens, so it is re-sorted here.
  const byDate = list => [...list].sort((a, b) =>
    (a.scheduled_date || '').localeCompare(b.scheduled_date || '') ||
    String(a.scheduled_time || '').localeCompare(String(b.scheduled_time || '')) ||
    a.id - b.id
  );

  const sets = {
    today:    byDate(rows.filter(a => a.scheduled_date === today)),
    tomorrow: byDate(rows.filter(a => a.scheduled_date === tomorrow)),
    week:     byDate(rows.filter(a => a.scheduled_date >= week.from && a.scheduled_date <= week.to)),
    custom:   byDate(custom),
  };

  const shown    = sets[range] || [];
  const busy     = range === 'custom' ? customLoading : loading;
  const badDates = range === 'custom' && from && to && from > to;

  const rangeDates = {
    today:    [today, today],
    tomorrow: [tomorrow, tomorrow],
    week:     [week.from, week.to],
    custom:   [from, to],
  }[range];

  function openAppointment(a) {
    // Token, not id — the same non-enumerable routing key the rest of the app
    // uses, and it survives a refresh.
    if (a.public_token) navigate(`${P.appointments}/${a.public_token}`);
    else navigate(P.appointments, { state: { openId: a.id } });
  }

  function viewAll() {
    const qs = new URLSearchParams({ date_from: rangeDates[0], date_to: rangeDates[1] });
    navigate(`${P.appointments}?${qs}`);
  }

  return (
    <div className="apsch">
      <div className="apsch-head">
        <div>
          <h3 className="apsch-title">Appointments</h3>
          <p className="apsch-sub">
            {range === 'custom'
              ? (badDates ? 'The end date is before the start date.' : `${fmtDayLabel(from)} — ${fmtDayLabel(to)}`)
              : range === 'week'
                ? `${fmtDayLabel(week.from)} — ${fmtDayLabel(week.to)}`
                : fmtDayLabel(rangeDates[0])}
          </p>
        </div>
        <div className="apsch-tabs">
          {RANGES.map(r => (
            <button
              key={r.key}
              type="button"
              className={`apsch-tab${range === r.key ? ' apsch-tab--on' : ''}`}
              onClick={() => setRange(r.key)}
            >
              {r.label}
              {/* Counts are only meaningful once the window has loaded, and the
                  custom range has no count until dates are chosen. */}
              {r.key !== 'custom' && !loading && (
                <span className="apsch-tab-count">{sets[r.key].length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="card apsch-body">
        {range === 'custom' && (
          <div className="apsch-range">
            <span>From</span>
            <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} />
            <span>To</span>
            <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} />
          </div>
        )}

        {busy ? (
          <div className="apsch-loading">
            <Loader2 size={22} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
          </div>
        ) : error ? (
          <div className="apsch-empty" style={{ color: '#b45309' }}>{error}</div>
        ) : badDates ? (
          <div className="apsch-empty">Pick an end date on or after the start date.</div>
        ) : shown.length === 0 ? (
          <div className="apsch-empty">
            {range === 'today'      ? 'Nothing booked for today.'
             : range === 'tomorrow' ? 'Nothing booked for tomorrow.'
             : range === 'week'     ? 'Nothing booked this week.'
             : 'No appointments in that range.'}
          </div>
        ) : (
          <>
            {shown.slice(0, MAX_ROWS).map(a => (
              <div
                key={a.id}
                className={`apsch-row${showHub ? ' apsch-row--hub' : ''}`}
                onClick={() => openAppointment(a)}
              >
                <div>
                  <div className="apsch-time">{fmtTimeShort(a.scheduled_time)}</div>
                  {/* The date is redundant on the single-day tabs and essential
                      on the multi-day ones. */}
                  {(range === 'week' || range === 'custom') && (
                    <div className="apsch-date">{fmtDayLabel(a.scheduled_date)}</div>
                  )}
                </div>
                <div>
                  <div className="apsch-name">{a.customer_name || '—'}</div>
                  <div className="apsch-sub-txt">{a.mobile || ''}</div>
                </div>
                <div>
                  <div className="apsch-veh">{a.vehicle_number || '—'}</div>
                  <div className="apsch-sub-txt">
                    {[a.make_name, a.model_name].filter(Boolean).join(' ') || a.vehicle_type_name || ''}
                  </div>
                </div>
                {showHub && (
                  <div>
                    <div className="apsch-hub">{a.hub_name || '—'}</div>
                  </div>
                )}
                <div className="apsch-status">
                  <StatusPill name={a.status_name} color={a.status_color} bg={a.status_bg} />
                </div>
              </div>
            ))}
            <div className="apsch-viewall">
              <button type="button" onClick={viewAll}>
                {shown.length > MAX_ROWS
                  ? `View all ${shown.length} appointments →`
                  : 'Open in Appointments →'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
