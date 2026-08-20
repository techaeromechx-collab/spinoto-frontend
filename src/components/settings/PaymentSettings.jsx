import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Percent, PowerOff } from 'lucide-react';
import { api } from '../../api/client.js';

/**
 * The GST rate on advance receipts — and the switch that turns
 * taking-payment-with-no-job on and off.
 *
 * ── WHY THIS SCREEN EXISTS ──────────────────────────────────────────────────
 * `company_settings.advance_default_gst_rate` was added by migration 141 and set
 * to 18 by 142. It is read in two places and written by nothing: changing it
 * meant an UPDATE statement, and the day an accountant says "that should be 5%
 * for this category" the answer was "I need a developer".
 *
 * ── AND WHY IT IS ITS OWN TAB, BEHIND ITS OWN PERMISSION ────────────────────
 * MANAGE_GATEWAY_SETTINGS, not the MANAGE_MASTER_DATA that guards the rest of
 * company settings. This number prints on a tax document a customer keeps.
 *
 * ── THE OFF STATE IS THE POINT, NOT AN ERROR ────────────────────────────────
 * NULL is a real, deliberate setting: with no rate configured, an advance taken
 * against no job cannot state its tax, so the endpoint refuses and the Take
 * Payment button stops rendering. That is correct behaviour and a useful kill
 * switch — so it is offered as an action with its consequence spelled out,
 * rather than being something you reach by clearing a text box.
 */
export default function PaymentSettings() {
  const [rate, setRate] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [confirmOff, setConfirmOff] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      // No new read endpoint: this is the same value the payments module already
      // serves, so the settings screen and the feature cannot disagree.
      const r = await api('/api/payments/account-credit/rate');
      setRate(r.gst_rate);
      setEnabled(Boolean(r.enabled));
      setInput(r.gst_rate === null || r.gst_rate === undefined ? '' : String(r.gst_rate));
    } catch (e) {
      setErr(e.message || 'Could not load the current rate.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(value) {
    setSaving(true); setErr(''); setNote('');
    try {
      const r = await api('/api/settings/advance-rate', {
        method: 'PUT',
        body: { advance_default_gst_rate: value },
      });
      setRate(r.gst_rate);
      setEnabled(Boolean(r.enabled));
      setInput(r.gst_rate === null || r.gst_rate === undefined ? '' : String(r.gst_rate));
      setConfirmOff(false);
      setNote(r.enabled
        ? `Saved. New advance receipts will state ${r.gst_rate}% GST.`
        : 'Switched off. Taking a payment with no job is no longer possible.');
    } catch (e) {
      setErr(e.message || 'Could not save the rate.');
    } finally { setSaving(false); }
  }

  function submit(e) {
    e.preventDefault();
    const n = Number(input);
    // Checked here as well as in Zod and in the database CHECK. Three layers,
    // because the two below this one produce a 422 that reads like a bug.
    if (input.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100) {
      setErr('Enter a rate between 0 and 100. To switch the feature off, use Switch off below.');
      return;
    }
    save(n);
  }

  if (loading) {
    return (
      <div className="set-card">
        <Loader2 size={18} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  return (
    <div className="set-card">
      <div className="set-card-hd">
        <span className="set-card-t"><Percent size={14} /> Advance receipt GST rate</span>
      </div>

      <p className="set-card-lede">
        The tax rate stated on a receipt for money taken <strong>before there is a job</strong> —
        an advance against an estimate carries the estimate's own rate instead, so this
        applies only to payments on account.
      </p>

      {/* The current state, said plainly. "Not set" is the state people will
          arrive at this screen confused by, so it explains itself. */}
      <div className={`set-state ${enabled ? 'set-state--on' : 'set-state--off'}`}>
        {enabled
          ? <><CheckCircle2 size={15} /> <span>Currently <strong>{rate}%</strong>.</span></>
          : <><PowerOff size={15} /> <span><strong>Not set</strong> — taking payment with no job is switched off.</span></>}
      </div>

      {err && <div className="set-alert set-alert--bad"><AlertTriangle size={14} /> <span>{err}</span></div>}
      {note && <div className="set-alert set-alert--ok"><CheckCircle2 size={14} /> <span>{note}</span></div>}

      <form onSubmit={submit} className="set-row">
        <input
          className="form-input"
          type="number" min="0" max="100" step="0.01" inputMode="decimal"
          value={input} onChange={e => setInput(e.target.value)}
          placeholder="18" style={{ width: 120 }} disabled={saving}
          aria-label="Advance receipt GST rate, percent"
        />
        <span className="set-suffix">%</span>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save rate'}
        </button>
      </form>

      {/* This is the sentence everyone asks about, and it is true: the rate is
          snapshotted onto each payment at capture, so changing it here cannot
          alter a document already in a customer's hands. */}
      <p className="set-card-note">
        Changing this affects future receipts only. Vouchers already issued keep the
        rate they were captured with.
      </p>

      {enabled && (
        <div className="set-danger">
          {!confirmOff ? (
            <button type="button" className="btn btn-ghost set-danger-btn"
                    onClick={() => { setConfirmOff(true); setErr(''); setNote(''); }}>
              <PowerOff size={14} /> Switch off payments with no job
            </button>
          ) : (
            <div className="set-confirm">
              <div>
                <strong>Switch this off?</strong>
                <div className="set-card-note" style={{ marginTop: 3 }}>
                  The <em>Take Payment</em> button disappears from every customer profile and the
                  endpoint refuses. Advances against an estimate are unaffected, and nothing
                  already taken changes. You can turn it back on by saving a rate.
                </div>
              </div>
              <div className="set-confirm-acts">
                <button type="button" className="btn btn-ghost" disabled={saving}
                        onClick={() => setConfirmOff(false)}>Cancel</button>
                <button type="button" className="btn set-btn--danger" disabled={saving}
                        onClick={() => save(null)}>
                  {saving ? 'Switching off…' : 'Switch off'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
