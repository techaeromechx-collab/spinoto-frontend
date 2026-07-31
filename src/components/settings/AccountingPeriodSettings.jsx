// Settings → Accounting Period.
//
// Two controls, both feeding the invoice-date rules in
// backend/src/utils/invoiceDate.js:
//
//   Books locked through — the hard stop. Nothing can be dated on or before
//   this day without the override permission. This is what protects a GST
//   period you have already filed.
//   Backdating window   — the everyday guard rail, in days.
//
// Behind MANAGE_BOOKS_LOCK, deliberately separate from Invoice Settings: the
// person who closes the books is usually not the person who picks a theme.
import { useState, useEffect, useRef } from 'react';
import { Lock, CalendarClock, AlertTriangle } from 'lucide-react';
import { api } from '../../api/client.js';
import { SectionHeader } from './shared.jsx';
import { useRegisterUnsavedChanges } from '../UnsavedChangesGuard.jsx';

// Today in IST, as YYYY-MM-DD — matches how the backend decides "today", so
// the date picker's max and the server's rule can't disagree by a day.
function istToday() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function fmt(d) {
  if (!d) return null;
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day)
    .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function AccountingPeriodSettings() {
  const [cfg, setCfg]         = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [dirty, setDirty]     = useState(false);
  const [ok, setOk]           = useState(false);
  const [err, setErr]         = useState(null);
  const [confirming, setConfirming] = useState(false);

  useRegisterUnsavedChanges(dirty, save);

  useEffect(() => {
    api('/api/settings/books-lock')
      .then(r => setCfg({
        books_locked_through: r.books_locked_through || '',
        backdate_max_days: r.backdate_max_days ?? 30,
        books_locked_at: r.books_locked_at || null,
        books_locked_by_name: r.books_locked_by_name || null,
      }))
      // Surface the server's own message. It distinguishes "migration not
      // applied yet" from a genuine fault, and swallowing it turns a
      // one-line fix into a debugging session.
      .catch(e => setErr(e?.message || 'Failed to load accounting period settings.'))
      .finally(() => setLoading(false));
  }, []);

  function set(patch) {
    setCfg(c => ({ ...c, ...patch }));
    setDirty(true);
    setOk(false);
    // Re-arm: without this you could reach the confirm state, then change the
    // date, and the next click would commit the NEW value unconfirmed.
    setConfirming(false);
  }

  // Is this move CLOSING more of the calendar than before? That is the one
  // action here that can't simply be undone — invoices dated inside the newly
  // locked range become uneditable for anyone without the override.
  function isClosingFurther() {
    if (!cfg?.books_locked_through) return false;              // clearing, or no lock
    if (!original.current) return true;                        // nothing was locked before
    return cfg.books_locked_through > original.current;        // extending the lock forward
  }

  // The confirmation lives INSIDE save(), not in a wrapper.
  //
  // It used to be in attemptSave(), which only the Save button called — the
  // unsaved-changes dialog registered `save` directly, so switching tabs and
  // clicking "Save Changes" closed the books with no confirmation at all. Any
  // future caller would have had the same hole. Putting the gate in the
  // function everything already calls means it cannot be routed around.
  async function save() {
    if (!cfg) return false;
    if (isClosingFurther() && !confirming) {
      setConfirming(true);
      // Not an error, but not done either: the unsaved-changes dialog must
      // stay open and NOT navigate away while the confirm is pending.
      return false;
    }
    setBusy(true); setErr(null); setOk(false);
    try {
      const r = await api('/api/settings/books-lock', {
        method: 'PUT',
        body: {
          // '' means "no lock" in the input; the API wants an explicit null so
          // it can tell "clear it" from "leave it alone".
          books_locked_through: cfg.books_locked_through || null,
          // '' would become 0 and silently switch backdating off. An empty
          // field means "leave it alone", not "set it to zero".
          backdate_max_days: cfg.backdate_max_days === '' || cfg.backdate_max_days == null
            ? undefined : Number(cfg.backdate_max_days),
        },
      });
      setCfg(c => ({ ...c, ...r.item, books_locked_by_name: r.item?.books_locked_by_name ?? c.books_locked_by_name }));
      // Re-baseline, or "am I closing further?" keeps comparing against the
      // value from page load and fires the confirm on a move BACKWARD.
      original.current = r.item?.books_locked_through || '';
      setDirty(false); setOk(true); setConfirming(false);
      setTimeout(() => setOk(false), 3000);
      return true;
    } catch (e) {
      setErr(e.message || 'Failed to save.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Remember what was loaded, to tell "moving the lock forward" from "just
  // changing the window".
  const original = useOriginal(cfg?.books_locked_through, loading);

  if (loading) {
    return (
      <div className="prfl-card">
        <SectionHeader icon={<Lock size={15} />} title="Accounting Period" />
        <div style={{ padding: '16px 0', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      </div>
    );
  }

  // The load can finish WITHOUT a config — the request failed. Every field
  // below dereferences cfg, so without this the error path renders a crash
  // instead of the error message it was supposed to show.
  if (!cfg) {
    return (
      <div className="prfl-card">
        <SectionHeader icon={<Lock size={15} />} title="Accounting Period" />
        <div className="prfl-alert prfl-alert--error" style={{ margin: '14px 0 0' }}>
          {err || 'Could not load accounting period settings.'}
        </div>
        <button className="prfl-btn-ghost" style={{ marginTop: 12 }} onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }

  const locked = !!cfg.books_locked_through;

  return (
    <div className="prfl-card">
      <SectionHeader icon={<Lock size={15} />} title="Accounting Period" />
      <p className="prfl-card-desc">
        Controls how far back an invoice may be dated. Closing the books stops backdated
        entries landing in a period you have already filed.
      </p>

      {ok  && <div className="prfl-alert prfl-alert--success" style={{ margin: '14px 0 0' }}>Accounting period settings saved.</div>}
      {err && <div className="prfl-alert prfl-alert--error"   style={{ margin: '14px 0 0' }}>{err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div className="prfl-field" style={{ margin: 0 }}>
          <label htmlFor="ap-lock-date" style={{ fontSize: 12 }}>
            Books closed through
            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> (leave empty for none)</span>
          </label>
          <input
            id="ap-lock-date"
            type="date"
            max={istToday()}
            value={cfg.books_locked_through || ''}
            onChange={e => set({ books_locked_through: e.target.value })}
          />
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.45 }}>
            {locked
              ? <>No invoice may be dated on or before <strong>{fmt(cfg.books_locked_through)}</strong>.</>
              : 'Nothing is locked. Any date within the window below is allowed.'}
            {cfg.books_locked_at && (
              <> Set by {cfg.books_locked_by_name || 'someone'} on {new Date(cfg.books_locked_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}.</>
            )}
          </div>
        </div>

        <div className="prfl-field" style={{ margin: 0 }}>
          <label htmlFor="ap-window-days" style={{ fontSize: 12 }}>
            Backdating window <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(days)</span>
          </label>
          <input
            id="ap-window-days"
            type="number" min={0} max={3650}
            value={cfg.backdate_max_days}
            onChange={e => set({ backdate_max_days: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0) })}
          />
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.45 }}>
            {Number(cfg.backdate_max_days) === 0
              ? 'Backdating is effectively off — only today’s date is allowed.'
              : <>Invoices may be dated up to <strong>{cfg.backdate_max_days} days</strong> back. Beyond that needs the override permission.</>}
          </div>
        </div>
      </div>

      {confirming && (
        <div className="prfl-alert prfl-alert--error" style={{ margin: '16px 0 0', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 700, marginBottom: 3 }}>Close the books through {fmt(cfg.books_locked_through)}?</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              Invoices dated on or before this day will no longer be editable by anyone
              without the override permission. You can move the lock back later, but any
              corrections needed in that period will have to go through an override in the meantime.
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
        <button className="prfl-btn-primary" onClick={save} disabled={busy || !dirty}>
          <CalendarClock size={14} /> {busy ? 'Saving…' : (confirming ? 'Yes, close the books' : 'Save')}
        </button>
        {confirming && (
          <button className="prfl-btn-ghost" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
        )}
      </div>
    </div>
  );
}

// Holds the value as first loaded, so a later comparison can tell what changed.
// Captured once, on the first render after loading finishes.
function useOriginal(value, loading) {
  const ref = useRef(null);
  if (!loading && ref.current === null && value !== undefined) ref.current = value || '';
  return ref;
}
