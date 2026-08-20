import { useMemo } from 'react';
import {
  Calendar, Car, FileText, Receipt, Wallet, Network, Plus, ChevronRight,
} from 'lucide-react';

/**
 * The customer profile's landing view.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The profile used to open on the Appointments table: fourteen rows of history
 * behind a search box, with everything else — what they drive, what is booked
 * next, what was quoted, what they owe — one tab away or squeezed into the
 * rail. The first screen answered a question nobody had walked up with.
 *
 * This answers the questions people actually arrive with, three or four rows at
 * a time, and every card hands off to the tab that holds the rest. The tables
 * did not go away. They stopped being the front door.
 *
 * ── IT OWNS NO DATA ─────────────────────────────────────────────────────────
 * Every figure here is passed in from the profile the page already loaded, and
 * nothing is recomputed. A summary that does its own arithmetic is a summary
 * that will one day disagree with the tab it summarises — and of the two
 * numbers on screen, nobody can tell which is the true one.
 */

const fmtINR = v =>
  '₹' + Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const fmtDate = d => {
  if (!d) return '—';
  // A plain 'YYYY-MM-DD' is parsed as UTC and would shift a day west of
  // Greenwich; the same guard the page's own formatter uses.
  const s = String(d);
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s);
  return Number.isNaN(dt.getTime())
    ? '—'
    : dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const fmtKm = v =>
  v === null || v === undefined || v === '' ? null : Number(v).toLocaleString('en-IN') + ' km';

/** Midnight today, so an appointment later TODAY still counts as upcoming. */
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function Card({ title, icon, onViewAll, viewAllLabel = 'View All', children, wide = false }) {
  return (
    <div className={`cust-ov-card${wide ? ' cust-ov-card--wide' : ''}`}>
      <div className="cust-ov-hd">
        <span className="cust-ov-hd-t">{icon} {title}</span>
        {onViewAll && (
          <button type="button" className="cust-ov-more" onClick={onViewAll}>
            {viewAllLabel} <ChevronRight size={12} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return <div className="cust-ov-empty">{children}</div>;
}

export default function CustomerOverviewTab({
  data,
  // The Customer Details and B2B cards, built by the page because they close
  // over its edit state. Rendered first so the profile still opens on who this
  // person is, which is what the left rail used to guarantee.
  detailsSlot = null,
  payments = [],
  timeline = [],
  tlConfigs = {},
  onTab,
  onNewAppointment,
  onAddVehicle,
  onOpenInvoice,
  onOpenEstimate,
}) {
  const vehicles = data?.vehicles || [];

  // ── Upcoming vs history ───────────────────────────────────────────────────
  // The appointments array already carries future rows — the tab just renders
  // every one of them newest-first, so a booking three days out sits below six
  // months of history. Split on the date rather than fetching again: the same
  // list, read forwards instead of backwards.
  const upcoming = useMemo(() => {
    const floor = startOfToday();
    return (data?.appointments || [])
      .filter(a => {
        const d = a.scheduled_date ? new Date(String(a.scheduled_date).slice(0, 10) + 'T00:00:00') : null;
        return d && !Number.isNaN(d.getTime()) && d >= floor;
      })
      .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)))
      .slice(0, 3);
  }, [data]);

  const recentEstimates = (data?.estimates || []).slice(0, 3);
  const recentInvoices  = (data?.invoices  || []).slice(0, 3);
  const recentPayments  = payments.slice(0, 4);
  const recentActivity  = timeline.slice(0, 5);

  return (
    <div className="cust-ov">
      <div className="cust-ov-grid">

        {detailsSlot}

        {/* ── Upcoming ─────────────────────────────────────────────────────
            First card, because it is the only one about the future. Everything
            else on this screen is a record of what already happened. */}
        <Card title="Upcoming Appointments" icon={<Calendar size={13} />}
              onViewAll={() => onTab('appointments')}>
          {upcoming.length === 0
            ? <Empty>Nothing booked.</Empty>
            : upcoming.map(a => (
                <div key={a.id} className="cust-ov-appt">
                  <div className="cust-ov-appt-date">
                    <span className="cust-ov-appt-d">
                      {new Date(String(a.scheduled_date).slice(0, 10) + 'T00:00:00').getDate()}
                    </span>
                    <span className="cust-ov-appt-m">
                      {new Date(String(a.scheduled_date).slice(0, 10) + 'T00:00:00')
                        .toLocaleDateString('en-IN', { month: 'short' })}
                    </span>
                  </div>
                  <div className="cust-ov-appt-body">
                    <div className="cust-ov-appt-top">
                      <strong>Appt #{a.id}</strong>
                      {a.status_name && (
                        <span className="cust-ov-pill"
                              style={{ background: (a.status_color || '#64748b') + '18',
                                       color: a.status_color || '#475569' }}>
                          {a.status_name}
                        </span>
                      )}
                    </div>
                    <div className="cust-ov-sub">
                      {[a.scheduled_time, a.hub_name].filter(Boolean).join(' · ') || '—'}
                    </div>
                    {a.vehicle_number && <div className="cust-ov-sub">{a.vehicle_number}</div>}
                  </div>
                </div>
              ))}
          {onNewAppointment && (
            <button type="button" className="cust-ov-foot" onClick={onNewAppointment}>
              <Plus size={13} /> New Appointment
            </button>
          )}
        </Card>

        {/* ── Vehicles ─────────────────────────────────────────────────────
            Odometer is the reading off the customer's own most recent job —
            derived in getCustomer, not stored on the vehicle. A stored copy has
            to be written by every path that records one, and the day a path
            forgets, this shows a lower number than the invoice printed last
            week. Absent where nobody has ever entered a reading, which is
            honest: an odometer of 0 would be a claim. */}
        <Card title={`Vehicles (${vehicles.length})`} icon={<Car size={13} />}
              onViewAll={vehicles.length ? undefined : undefined}>
          {vehicles.length === 0
            ? <Empty>No vehicles on record.</Empty>
            : vehicles.slice(0, 4).map(v => (
                <div key={v.vehicle_number} className="cust-ov-veh">
                  <div>
                    <div className="cust-ov-veh-plate">{v.vehicle_number}</div>
                    <div className="cust-ov-sub">
                      {[v.make_name, v.model_name].filter(Boolean).join(' ') || 'Unknown model'}
                    </div>
                  </div>
                  <div className="cust-ov-veh-right">
                    {fmtKm(v.last_odometer_km) && (
                      <div className="cust-ov-veh-km">{fmtKm(v.last_odometer_km)}</div>
                    )}
                    <div className="cust-ov-sub">
                      {v.visit_count} visit{v.visit_count === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
              ))}
          {onAddVehicle && (
            <button type="button" className="cust-ov-foot" onClick={onAddVehicle}>
              <Plus size={13} /> Add Vehicle
            </button>
          )}
        </Card>

        {/* ── Payments ─────────────────────────────────────────────────────
            Read from the same endpoint the Payments tab uses, so this card and
            that tab cannot disagree. Credit is deliberately NOT repeated here —
            it is already stated once, in the header money row, and a figure
            about money stated twice on one screen is a figure people stop
            trusting. */}
        <Card title="Recent Payments" icon={<Wallet size={13} />}
              onViewAll={() => onTab('payments')}>
          {recentPayments.length === 0
            ? <Empty>Nothing paid yet.</Empty>
            : (
              <table className="cust-ov-mini">
                <thead>
                  <tr><th>Date</th><th>Method</th><th className="num">Amount</th></tr>
                </thead>
                <tbody>
                  {recentPayments.map(p => (
                    <tr key={p.id}>
                      <td>{fmtDate(p.paid_at)}</td>
                      <td className="cust-ov-sub">{p.method || '—'}</td>
                      <td className="num"><strong>{fmtINR(p.amount)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </Card>

        {/* ── Estimates ────────────────────────────────────────────────────── */}
        <Card title="Recent Estimates" icon={<FileText size={13} />}
              onViewAll={() => onTab('estimates')}>
          {recentEstimates.length === 0
            ? <Empty>No estimates yet.</Empty>
            : (
              <table className="cust-ov-mini">
                <thead>
                  <tr><th>Estimate</th><th>Date</th><th className="num">Amount</th></tr>
                </thead>
                <tbody>
                  {recentEstimates.map(e => (
                    <tr key={e.id} onClick={() => onOpenEstimate?.(e)} className="clickable">
                      <td><span className="cust-ov-ref">EST-{String(e.id).padStart(6, '0')}</span></td>
                      <td className="cust-ov-sub">{fmtDate(e.estimate_date || e.created_at)}</td>
                      <td className="num"><strong>{fmtINR(e.grand_total)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </Card>

        {/* ── Invoices ─────────────────────────────────────────────────────── */}
        <Card title="Recent Invoices" icon={<Receipt size={13} />}
              onViewAll={() => onTab('invoices')}>
          {recentInvoices.length === 0
            ? <Empty>No invoices yet.</Empty>
            : (
              <table className="cust-ov-mini">
                <thead>
                  <tr><th>Invoice</th><th>Date</th><th className="num">Amount</th></tr>
                </thead>
                <tbody>
                  {recentInvoices.map(i => (
                    <tr key={i.id} onClick={() => onOpenInvoice?.(i)} className="clickable">
                      <td><span className="cust-ov-ref">CI-{String(i.id).padStart(6, '0')}</span></td>
                      <td className="cust-ov-sub">{fmtDate(i.invoice_date || i.created_at)}</td>
                      <td className="num">
                        <strong>{fmtINR(i.grand_total)}</strong>
                        {Number(i.outstanding) > 0 && (
                          <div className="cust-ov-due">{fmtINR(i.outstanding)} due</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </Card>

        {/* ── Where the money stands ───────────────────────────────────────
            The four header cards report lifetime totals. This one reports the
            gap that needs acting on, which is a different question and the
            reason people open a profile at all. */}
        <Card title="Account" icon={<Network size={13} />}>
          <div className="cust-ov-kv"><span>Total invoiced</span><strong>{fmtINR(data?.total_invoiced)}</strong></div>
          <div className="cust-ov-kv"><span>Total paid</span>
            <strong>{fmtINR(Number(data?.total_invoiced || 0) - Number(data?.total_outstanding || 0))}</strong>
          </div>
          <div className="cust-ov-kv cust-ov-kv--strong">
            <span>Outstanding</span>
            <strong style={{ color: Number(data?.total_outstanding) > 0 ? '#dc2626' : '#16a34a' }}>
              {Number(data?.total_outstanding) > 0 ? fmtINR(data.total_outstanding) : 'Nil'}
            </strong>
          </div>
          <div className="cust-ov-kv"><span>Last visit</span><strong>{fmtDate(data?.last_visit)}</strong></div>
        </Card>

      </div>

      {/* ── Recent activity ────────────────────────────────────────────────
          The newest five, laid across rather than down. The Timeline tab is the
          same data with no limit and the vertical treatment that makes a long
          history readable — this is the glance. */}
      <div className="cust-ov-card cust-ov-card--wide">
        <div className="cust-ov-hd">
          <span className="cust-ov-hd-t">Recent Activity</span>
          <button type="button" className="cust-ov-more" onClick={() => onTab('timeline')}>
            View Full Timeline <ChevronRight size={12} />
          </button>
        </div>
        {recentActivity.length === 0
          ? <Empty>Nothing recorded yet.</Empty>
          : (
            <div className="cust-ov-acts">
              {recentActivity.map((item, idx) => {
                const cfg = tlConfigs[item.type] || tlConfigs.default || { icon: '•', color: '#64748b', label: item.type };
                return (
                  <div key={`${item.type}-${item.id}-${idx}`} className="cust-ov-act">
                    <span className="cust-ov-act-icon"
                          style={{ background: cfg.color + '18', border: `1.5px solid ${cfg.color}` }}>
                      {cfg.icon}
                    </span>
                    <div className="cust-ov-act-body">
                      <div className="cust-ov-act-t">{cfg.label} #{item.id}</div>
                      <div className="cust-ov-sub">
                        {[item.vehicle_number, item.amount && Number(item.amount) > 0 ? fmtINR(item.amount) : null]
                          .filter(Boolean).join(' · ') || item.hub_name || '—'}
                      </div>
                      <div className="cust-ov-act-d">{fmtDate(item.event_date || item.created_at)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </div>
  );
}
