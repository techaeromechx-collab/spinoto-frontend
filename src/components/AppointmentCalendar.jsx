import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Info, X } from 'lucide-react';
import { api } from '../api/client.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import { istToday, monthGrid, fmtMonthLabel, addMonths } from '../lib/istDate.js';
import '../styles/appointmentCalendar.css';

/**
 * Month view for the Appointments page.
 *
 * Reads from /api/appointments/calendar, which is bounded by a date range
 * rather than a page size — the list endpoint caps at 100 rows, and a month
 * grid that silently drops the 101st appointment is worse than no grid.
 *
 * The month is owned by the caller (and therefore by the URL), so a refresh,
 * the Back button and a pasted link all show the same month.
 *
 * @param month     'YYYY-MM'
 * @param onMonth   (ym) => void — paging
 * @param statuses  from /api/appointment-statuses; drives the legend, so it
 *                  follows renames and colour changes instead of drifting
 * @param filters   { hub_ids, status_id, search } — the page's own filters,
 *                  applied server-side exactly as the list applies them
 * @param onOpen    (appointment) => void
 * @param onPickDay (YYYY-MM-DD) => void — "+N more"
 */
const WEEK_START = 0;                                     // Sunday, per the header
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_CHIPS = 2;                                      // then "+N more"

export default function AppointmentCalendar({
  month, onMonth, statuses = [], filters = {}, onOpen, onPickDay,
}) {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const today = istToday();
  const grid = useMemo(() => monthGrid(month, WEEK_START), [month]);

  // The grid shows the tail of the previous month and the head of the next, so
  // the request covers the whole 42-cell span — not just the calendar month.
  // Fetching only the month would leave those cells wrongly empty.
  const { from, to } = grid;
  const { hub_ids: hubIds = '', status_id: statusId = '', search = '' } = filters;

  useEffect(() => {
    let dead = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const qs = new URLSearchParams({ date_from: from, date_to: to });
        if (hubIds)   qs.set('hub_ids', hubIds);
        if (statusId) qs.set('status_id', statusId);
        if (search)   qs.set('search', search);
        const res = await api(`/api/appointments/calendar?${qs}`);
        if (!dead) setItems(res.items || []);
      } catch (e) {
        if (!dead) { setItems([]); setError(e.message || 'Could not load the calendar.'); }
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => { dead = true; };
  }, [from, to, hubIds, statusId, search]);

  // One pass into date → rows. The endpoint already orders by date then time,
  // so each bucket comes out in the order the day runs.
  const byDate = useMemo(() => {
    const map = new Map();
    for (const a of items) {
      if (!map.has(a.scheduled_date)) map.set(a.scheduled_date, []);
      map.get(a.scheduled_date).push(a);
    }
    return map;
  }, [items]);

  // Only the calendar month counts. The visible grid includes neighbouring
  // days, and counting those would make the total disagree with the heading.
  const monthTotal = items.filter(a => a.scheduled_date.slice(0, 7) === month).length;

  return (
    <div className="apcal">
      <div className="apcal-bar">
        <button type="button" className="apcal-nav" onClick={() => onMonth(monthOfToday())}>Today</button>
        <button type="button" className="apcal-nav apcal-nav--icon" aria-label="Previous month"
          onClick={() => onMonth(addMonths(month, -1))}><ChevronLeft size={16} /></button>
        <button type="button" className="apcal-nav apcal-nav--icon" aria-label="Next month"
          onClick={() => onMonth(addMonths(month, 1))}><ChevronRight size={16} /></button>
        <div className="apcal-month">{fmtMonthLabel(month)}</div>
      </div>

      <div className="card apcal-card">
        <div className="apcal-dow">
          {DOW.map((d, i) => <div key={d}>{DOW[(i + WEEK_START) % 7]}</div>)}
        </div>

        {loading ? (
          <div className="apcal-loading">
            <Loader2 size={22} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
          </div>
        ) : error ? (
          <div className="apcal-error">{error}</div>
        ) : (
          <div className="apcal-grid">
            {grid.days.map(({ date, inMonth }) => {
              const rows = byDate.get(date) || [];
              const isToday = date === today;
              return (
                <div key={date} className={`apcal-cell${inMonth ? '' : ' apcal-cell--out'}`}>
                  <div className="apcal-daynum">
                    <span className={isToday ? 'apcal-today' : undefined}>
                      {/* The 1st carries its month, so paging is legible at a
                          glance without reading the heading. */}
                      {date.endsWith('-01') ? fmtCellFirst(date) : Number(date.slice(-2))}
                    </span>
                  </div>

                  {rows.slice(0, MAX_CHIPS).map(a => (
                    <button
                      key={a.id}
                      type="button"
                      className="apcal-chip"
                      style={{ background: a.status_bg || 'var(--bg-soft)' }}
                      onClick={() => onOpen?.(a)}
                      title={`${a.customer_name || '—'} · ${a.vehicle_number || '—'} · ${a.status_name || ''}`}
                    >
                      <span className="apcal-chip-top">
                        <span className="apcal-dot" style={{ background: a.status_color || 'var(--text-muted)' }} />
                        <span className="apcal-chip-name">{a.customer_name || '—'}</span>
                      </span>
                      <span className="apcal-chip-meta">{fmtChipTime(a.scheduled_time)}</span>
                      <span className="apcal-chip-meta">{a.vehicle_number || ''}</span>
                    </button>
                  ))}

                  {rows.length > MAX_CHIPS && (
                    <button type="button" className="apcal-more" onClick={() => onPickDay?.(date)}>
                      +{rows.length - MAX_CHIPS} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="apcal-foot">
          {/* Behind a button, not laid out flat. There are 18 active statuses —
              spelled out they wrapped onto two full rows and took more vertical
              space than a week of the grid, for a key most people read once.
              Still built from the statuses table, never a literal: these are
              editable master data, and a hardcoded legend drifts the first time
              someone renames or recolours one. */}
          <LegendButton statuses={statuses} />
          <div className="apcal-total">
            Total Appointments: <strong>{loading ? '—' : monthTotal}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendButton({ statuses }) {
  const [open, setOpen] = useState(false);
  useEscapeClose(() => setOpen(false), open);

  const active = statuses.filter(s => s.is_active !== false);
  if (active.length === 0) return <span />;   // keeps the footer's space-between

  return (
    <div className="apcal-legend-wrap">
      <button
        type="button"
        className="apcal-legend-btn"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        title="What the colours mean"
      >
        <Info size={13} /> Status colours
      </button>

      {open && (
        <>
          {/* A click anywhere else closes it — the same backdrop pattern the
              filter popups use. */}
          <div className="apcal-legend-backdrop" onClick={() => setOpen(false)} />
          <div className="apcal-legend-pop">
            <div className="apcal-legend-hd">
              <span>Status colours</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close">
                <X size={13} />
              </button>
            </div>
            {/* Columns, not one long list: 18 statuses in a single column would
                be taller than the popup can be without scrolling. */}
            <div className="apcal-legend-grid">
              {active.map(s => (
                <span key={s.id} className="apcal-legend-item">
                  <span className="apcal-dot" style={{ background: s.color || 'var(--text-muted)' }} />
                  {s.name}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function monthOfToday() {
  return istToday().slice(0, 7);
}

function fmtCellFirst(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// Compact for a narrow cell: '9:30 AM'. Shares the rules of lib/istDate's
// fmtTimeShort but drops the em dash — an empty cell reads better than '—'
// stacked under a name.
function fmtChipTime(t) {
  if (!t) return '';
  const [hRaw, mRaw] = String(t).split(':');
  const h = Number(hRaw);
  if (Number.isNaN(h)) return '';
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mRaw ?? '00'} ${ampm}`;
}
