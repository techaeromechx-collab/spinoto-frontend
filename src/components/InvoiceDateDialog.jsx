// Change the date of a customer invoice OR an estimate.
//
// One component for both because the flow is identical — pick a date, see the
// consequences from the server's own preflight, give a reason, confirm. Two
// copies would diverge the first time either got a fix.
//
// The design principle here: nothing surprising happens after you click Save.
// Every consequence — rules broken, warranties shortened, whether the purchase
// invoice moves — is fetched from the server's own preflight and shown while
// the user is still choosing, so the confirm is a confirmation of something
// already understood rather than a leap.
//
// The preflight endpoint runs the exact same validator the PATCH does, so the
// two can never disagree about what is allowed.
import { useState, useEffect, useCallback, useRef } from 'react';
import { CalendarClock, AlertTriangle, Info, ShieldAlert, X } from 'lucide-react';
import { api } from '../api/client.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';

const DOC_NOUN = {
  purchase_invoice: 'the purchase invoice',
  customer_invoice: 'the customer invoice',
};

function istToday() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function fmt(d) {
  if (!d) return '—';
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day)
    .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Everything that differs between the two documents, in one place.
const DOCS = {
  customer_invoice: {
    title: 'Change invoice date',
    noun: 'invoice',
    dateField: 'invoice_date',
    originalField: 'original_invoice_date',
    base: id => `/api/customer-invoices/${id}`,
    preflight: (id, d) => `/api/customer-invoices/${id}/date-preflight?invoice_date=${d}`,
    patch: id => `/api/customer-invoices/${id}/invoice-date`,
    payloadDate: 'invoice_date',
  },
  estimate: {
    title: 'Change estimate date',
    noun: 'estimate',
    dateField: 'estimate_date',
    originalField: 'original_estimate_date',
    base: id => `/api/estimates/${id}`,
    preflight: (id, d) => `/api/estimates/${id}/date-preflight?estimate_date=${d}`,
    patch: id => `/api/estimates/${id}/estimate-date`,
    payloadDate: 'estimate_date',
  },
};

export default function InvoiceDateDialog({
  invoice, canOverride, onClose, onSaved, documentType = 'customer_invoice',
}) {
  const DOC = DOCS[documentType] || DOCS.customer_invoice;
  // created_at fallback matches both call sites — a pre-migration row would
  // otherwise open the dialog reading "Currently dated —".
  const current = (invoice?.[DOC.dateField] || invoice?.created_at || '').slice(0, 10);
  const [date, setDate]       = useState(current);
  const [reason, setReason]   = useState('');
  const [movePi, setMovePi]   = useState(true);   // decision 5: default on, always visible
  const [pre, setPre]         = useState(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState(null);

  useEscapeClose(onClose, !saving);

  // Debounced, and race-guarded: typing a date fires several requests and the
  // slowest must not overwrite the newest.
  const seq = useRef(0);
  const runPreflight = useCallback(async (d) => {
    // Bump FIRST. Returning early without it left an in-flight request for the
    // previous date still "current", so reverting to the original date cleared
    // the panel and then had it repopulated by the stale response.
    const mine = ++seq.current;
    if (!d || d === current) { setPre(null); return; }
    setChecking(true);
    try {
      const r = await api(DOC.preflight(invoice.id, d));
      if (mine === seq.current) setPre(r);
    } catch (e) {
      if (mine === seq.current) { setPre(null); setErr(e.message || 'Could not check that date.'); }
    } finally {
      if (mine === seq.current) setChecking(false);
    }
  }, [invoice?.id, current, DOC]);

  useEffect(() => {
    setErr(null);
    const t = setTimeout(() => runPreflight(date), 250);
    return () => clearTimeout(t);
  }, [date, runPreflight]);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const r = await api(DOC.patch(invoice.id), {
        method: 'PATCH',
        body: {
          [DOC.payloadDate]: date,
          reason: reason.trim(),
          override: needsOverride && canOverride,
          // The CI moves one document with it (its PI); an estimate moves
          // both of its downstream documents, so the flags differ in name.
          // Both branches gate on can_follow. The estimate branch didn't, and
          // because the checkbox renders `disabled` when nothing can follow it
          // never fires onChange — so `movePi` stayed true and the request
          // asked to cascade onto frozen documents, producing red error toasts
          // for a box the user was shown as unchecked.
          ...(documentType === 'estimate'
            ? { cascade: movePi && cascade.some(c => c.can_follow) }
            : { move_purchase_invoice: movePi && !!pre?.purchase_invoice?.can_follow }),
        },
      });
      onSaved?.(r);
      onClose?.();
    } catch (e) {
      setErr(e.message || `Could not change the ${DOC.noun} date.`);
    } finally {
      setSaving(false);
    }
  }

  const changed        = date && date !== current;
  const blocked        = pre && !pre.ok && !pre.requires_override;
  const needsOverride  = !!pre?.requires_override;
  const locked         = !!pre?.locked;
  const reasonOk       = reason.trim().length >= 10;
  const canSave        = changed && !checking && !saving && !locked && reasonOk &&
                         pre && (pre.ok || (needsOverride && canOverride));

  // A disabled button with no explanation is a dead end. This is surfaced both
  // as the title and as visible text below.
  const disabledReason =
    !changed        ? 'Pick a different date first'
    : checking      ? 'Checking that date…'
    : locked        ? (pre?.lock_reason || 'This document can no longer be re-dated')
    : !reasonOk     ? 'A reason of at least 10 characters is required'
    : (pre && !pre.ok && !(needsOverride && canOverride)) ? 'This date is not allowed'
    : null;

  const warranty = pre?.warranty;
  const expiring = warranty?.expiring || [];
  const shifting = warranty?.shifting || [];

  // The CI preflight reports a single `purchase_invoice`; the estimate
  // preflight reports a `cascade` array. Normalise to the array.
  const cascade = pre?.cascade
    || (pre?.purchase_invoice ? [{ type: 'purchase_invoice', ...pre.purchase_invoice }] : []);

  return (
    <div className="idd-overlay" role="dialog" aria-modal="true" aria-labelledby="idd-title">
      <div className="idd-modal">
        <div className="idd-hd">
          <span className="idd-title" id="idd-title">
            <CalendarClock size={16} /> {DOC.title}
          </span>
          <button className="idd-close" onClick={onClose} disabled={saving} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="idd-body">
          <div className="idd-current">
            Currently dated <strong>{fmt(current)}</strong>
            {invoice?.[DOC.originalField] && (
              <span className="idd-muted"> · originally {fmt(invoice[DOC.originalField])}</span>
            )}
          </div>

          {locked && (
            <div className="idd-note idd-note--block">
              <ShieldAlert size={15} />
              <div>{pre.lock_reason} The date can no longer be changed.</div>
            </div>
          )}

          <div className="idd-field">
            <label htmlFor="idd-date">New date</label>
            {/* Deliberately NOT disabled on `locked`. Disabling it trapped the
                user at the offending date with Cancel as the only exit — the
                opposite of letting them correct course. Save is what's gated. */}
            <input
              id="idd-date" type="date" value={date} max={istToday()}
              disabled={saving}
              onChange={e => setDate(e.target.value)}
            />
            {checking && <span className="idd-checking">Checking…</span>}
          </div>

          {/* Hard failures — nothing the user can do but pick another date. */}
          {pre?.errors?.filter(e => !e.overridable).map((e, i) => (
            <div key={`${e.code}-${i}`} className="idd-note idd-note--block">
              <AlertTriangle size={15} /><div>{e.message}</div>
            </div>
          ))}

          {/* Soft failures — allowed, with the override permission. */}
          {pre?.errors?.filter(e => e.overridable).map((e, i) => (
            <div key={`${e.code}-${i}`} className={`idd-note ${canOverride ? 'idd-note--warn' : 'idd-note--block'}`}>
              <AlertTriangle size={15} />
              <div>
                {e.message}
                {!canOverride && <div className="idd-muted">You do not have permission to override this.</div>}
              </div>
            </div>
          ))}

          {/* Warranty is the consequence people don't anticipate, so it gets
              its own block with the actual dates rather than a generic note. */}
          {expiring.length > 0 && (
            <div className="idd-note idd-note--block">
              <AlertTriangle size={15} />
              <div>
                <strong>{expiring.length} warranty item(s) would already be expired at this date.</strong>
                <ul className="idd-list">
                  {expiring.slice(0, 5).map((i, n) => (
                    <li key={n}>{i.description}: expiry {fmt(i.old_expiry)} → {fmt(i.new_expiry)}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {expiring.length === 0 && shifting.length > 0 && (
            <div className="idd-note idd-note--info">
              <Info size={15} />
              <div>
                Warranty cover on {shifting.length} item(s) starts earlier and ends sooner.
                <ul className="idd-list">
                  {shifting.slice(0, 3).map((i, n) => (
                    <li key={n}>{i.description}: {fmt(i.old_expiry)} → {fmt(i.new_expiry)}</li>
                  ))}
                  {shifting.length > 3 && <li>…and {shifting.length - 3} more</li>}
                </ul>
              </div>
            </div>
          )}

          {/* Informational warnings that never block. */}
          {pre?.warnings?.filter(w => !w.code?.startsWith('OVERRIDDEN_') && w.code !== 'WARRANTY_SHORTENED').map((w, i) => (
            <div key={`${w.code || 'warn'}-${i}`} className="idd-note idd-note--info">
              <Info size={15} /><div>{w.message}</div>
            </div>
          ))}

          {/* Downstream documents follow only when asked, and never once the
              money has moved. A CI has one (its PI); an estimate has two. */}
          {cascade.length > 0 && (
            <label className={`idd-check ${cascade.some(c => c.can_follow) ? '' : 'idd-check--disabled'}`}>
              <input
                type="checkbox"
                checked={movePi && cascade.some(c => c.can_follow)}
                disabled={!cascade.some(c => c.can_follow) || locked || saving}
                onChange={e => setMovePi(e.target.checked)}
              />
              <span>
                Also move {cascade.map(c => `${DOC_NOUN[c.type] || 'the linked document'} (currently ${fmt(c.invoice_date)})`).join(' and ')}
                {cascade.filter(c => !c.can_follow).map(c => (
                  <div key={c.type} className="idd-muted">{c.blocked_reason}</div>
                ))}
              </span>
            </label>
          )}

          <div className="idd-field">
            <label htmlFor="idd-reason">
              Reason <span className="idd-muted">(required, recorded in the audit log)</span>
            </label>
            <textarea
              id="idd-reason" rows={2} value={reason} disabled={locked || saving}
              placeholder="e.g. Job completed 25 July; invoice raised late."
              onChange={e => setReason(e.target.value)}
            />
            {changed && reason.length > 0 && !reasonOk && (
              <span className="idd-muted">At least 10 characters.</span>
            )}
          </div>

          {needsOverride && canOverride && (
            <div className="idd-note idd-note--warn">
              <ShieldAlert size={15} />
              <div>Saving will use your override permission. This is recorded against your name.</div>
            </div>
          )}

          {err && <div className="idd-note idd-note--block"><AlertTriangle size={15} /><div>{err}</div></div>}
        </div>

        <div className="idd-actions">
          {disabledReason && changed && (
            <span className="idd-muted" style={{ marginRight: 'auto', alignSelf: 'center' }}>
              {disabledReason}
            </span>
          )}
          <button className="prfl-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="prfl-btn-primary"
            onClick={save}
            disabled={!canSave}
            title={disabledReason || undefined}
          >
            {saving ? 'Saving…' : (needsOverride && canOverride ? 'Override and save' : 'Change date')}
          </button>
        </div>
      </div>
    </div>
  );
}
