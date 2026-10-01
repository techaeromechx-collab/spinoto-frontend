// Settings → System Health. Super admin only.
//
// ── WHY THIS SCREEN EXISTS ──────────────────────────────────────────────────
//
// The database runs on AWS and nobody here has console access to it. So the two
// questions that come up whenever something looks wrong —
//
//     "did the last deploy actually run its migrations?"
//     "thirty-five people messaged us today, why are there twenty-seven leads?"
//
// — could only be answered by somebody with a database client and the
// production credentials. Both answers were already being recorded. Neither had
// anywhere to appear.
//
// Read only. There is deliberately no "run migrations" button: a migration is a
// deliberate act with a deploy around it, not something to fire from a settings
// screen at six o'clock on a Friday.
import { useCallback, useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, CheckCircle2, Database, Server,
  MessageCircle, RefreshCw, Clock,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { SectionHeader, Spinner } from './shared.jsx';

/** "4d 2h", "3h 20m", "6m" — uptime nobody has to divide by 3600. */
function uptime(sec) {
  if (!Number.isFinite(sec)) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function stamp(v) {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d) ? '—' : d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/* One number with a word under it. tone colours the number, never the tile —
   a tile that turns red reads as "this panel is broken" rather than "this
   figure is the problem". */
function Stat({ n, label, tone }) {
  return (
    <div className="sh-stat">
      <div className={`sh-stat-n${tone ? ` sh-stat-n--${tone}` : ''}`}>{n}</div>
      <div className="sh-stat-l">{label}</div>
    </div>
  );
}

export default function SystemHealth() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setBusy(true); else setLoading(true);
    try {
      setData(await api('/api/system/health'));
      setErr(null);
    } catch (e) {
      // Surfaced rather than swallowed. On THIS page an error is itself the
      // answer to "is something wrong", so hiding it would be perverse.
      setErr(e?.message || 'Could not read the system health.');
    } finally {
      setLoading(false); setBusy(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="prfl-card"><Spinner /></div>;

  const m  = data?.migrations;
  const wa = data?.whatsapp;
  const pending = m?.pending || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* ── Migrations ─────────────────────────────────────────────────── */}
      <div className="prfl-card">
        <SectionHeader icon={<Database size={15} />} title="Database migrations" />
        <p className="prfl-card-desc">
          Whether the database schema on the server has caught up with the code that is
          deployed. Read straight from the server's own record of what it has run.
        </p>

        {err && <div className="prfl-alert prfl-alert--error" style={{ margin: '14px 0 0' }}>{err}</div>}

        {m?.files_error && (
          <div className="prfl-alert prfl-alert--error" style={{ margin: '14px 0 0' }}>
            {m.files_error} The pending list below cannot be trusted until that is fixed.
          </div>
        )}

        {/* The table itself missing is NOT the same as nothing pending, and the
            difference matters enormously — it means this database has never
            been migrated at all. */}
        {m?.table_missing && (
          <div className="prfl-alert prfl-alert--error" style={{ margin: '14px 0 0' }}>
            This database has no migration record at all — it has never been migrated.
            Every one of the {m.total} migrations is outstanding.
          </div>
        )}

        {pending.length > 0 ? (
          <div className="sh-pending">
            <div className="sh-pending-hd">
              <AlertTriangle size={15} />
              {pending.length} migration{pending.length === 1 ? '' : 's'} pending
            </div>
            <ul className="sh-pending-list">
              {pending.map(f => <li key={f}>{f}</li>)}
            </ul>
            <div className="sh-pending-foot">
              Run <code>npm run db:migrate</code> on the server. Until it is run, anything
              the newest code expects to find in the database will not be there.
            </div>
          </div>
        ) : (
          <div className="sh-ok">
            <CheckCircle2 size={15} />
            Up to date — all {m?.total ?? 0} migrations have been applied.
          </div>
        )}

        <div className="sh-rows">
          <div className="sh-row">
            <span>Applied</span>
            <strong>{m?.applied ?? 0} of {m?.total ?? 0}</strong>
          </div>
          <div className="sh-row">
            <span>Last migration run</span>
            <strong>
              {m?.last_applied
                ? <>{stamp(m.last_applied.applied_at)} <span className="sh-dim">· {m.last_applied.filename}</span></>
                : 'never'}
            </strong>
          </div>
        </div>
      </div>

      {/* ── Database and server ────────────────────────────────────────── */}
      <div className="prfl-card">
        <SectionHeader icon={<Server size={15} />} title="Database and server" />
        <div className="sh-rows" style={{ marginTop: 14 }}>
          <div className="sh-row">
            <span><Database size={13} /> Database</span>
            <strong className="sh-good">
              <CheckCircle2 size={13} /> connected
              <span className="sh-dim"> · {data?.database?.version}</span>
            </strong>
          </div>
          <div className="sh-row">
            <span><Clock size={13} /> Database time</span>
            <strong>{stamp(data?.database?.time)}</strong>
          </div>
          <div className="sh-row">
            <span><Activity size={13} /> Server</span>
            <strong>
              up {uptime(data?.server?.uptime_seconds)}
              <span className="sh-dim"> · {data?.server?.env} · node {data?.server?.node}</span>
            </strong>
          </div>
        </div>
      </div>

      {/* ── WhatsApp today ─────────────────────────────────────────────── */}
      <div className="prfl-card">
        <SectionHeader icon={<MessageCircle size={15} />} title="WhatsApp today" />
        <p className="prfl-card-desc">
          Every inbound message since midnight, and what became of it. More messages than
          new leads is normal — one person sending three messages is one lead, and somebody
          who already has an open lead does not get a second one.
        </p>

        {!wa?.available ? (
          <div className="prfl-alert prfl-alert--error" style={{ margin: '14px 0 0' }}>
            {wa?.reason || 'The WhatsApp log is not readable.'}
          </div>
        ) : (
          <>
            <div className="sh-stats">
              <Stat n={wa.received}           label="messages received" />
              <Stat n={wa.distinct_numbers}   label="different people" />
              <Stat n={wa.new_leads}          label="new leads" tone="good" />
              <Stat n={wa.landed_on_existing} label="on an existing lead" />
              <Stat n={wa.dropped}            label="dropped"  tone={wa.dropped ? 'bad'  : null} />
              <Stat n={wa.failed}             label="failed"   tone={wa.failed  ? 'warn' : null} />
            </div>

            {wa.problems?.length > 0 && (
              <div className="sh-problems">
                <div className="sh-problems-hd">
                  <AlertTriangle size={14} /> Messages that produced nothing
                </div>
                {/* The numbers are shown in full, on purpose. A count of two
                    that nobody can act on is barely better than a count of
                    zero — these are customers who wrote to you and got no
                    reply, and somebody should ring them. */}
                <table className="sh-problems-tbl">
                  <tbody>
                    {wa.problems.map((p, i) => (
                      <tr key={i}>
                        <td className="sh-p-time">{stamp(p.at).split(', ')[1] || stamp(p.at)}</td>
                        <td className="sh-p-num">{p.number || '(no number in the payload)'}</td>
                        <td className="sh-p-why">
                          {p.reason === 'unparseable_sender_number'
                            ? 'Not an Indian mobile — no lead was created'
                            : p.reason === 'duplicate_inbound'
                              ? 'Repeat of a message already stored (harmless)'
                              : p.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      <div className="sh-foot">
        <span>Checked {stamp(data?.checked_at)}</span>
        <button type="button" className="sh-refresh" onClick={() => load({ quiet: true })} disabled={busy}>
          <RefreshCw size={13} className={busy ? 'sh-spin' : undefined} />
          {busy ? 'Checking…' : 'Check again'}
        </button>
      </div>
    </div>
  );
}
