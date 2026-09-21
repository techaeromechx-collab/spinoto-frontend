import { useEffect, useState, useCallback } from 'react';
import { api } from '../../api/client.js';
import { useCan } from '../../auth/AuthContext.jsx';
import { Scale, Check, X, Undo2, Info, History } from 'lucide-react';

/**
 * Opening balances — what a party owed before Spinoto started recording.
 *
 * ── WHY THIS IS A WORKLIST, NOT A FIELD ON EVERY PROFILE ───────────────────
 *
 * Every customer could have one. Almost none do: 220 of 232 have a single
 * invoice, and a walk-in who paid at the counter carried nothing in. So this
 * shows the parties where the question is real — B2B customers, and hubs with
 * money outstanding — which on the current data is four and nine.
 *
 * A field on 232 profiles would be a field nobody fills in. Thirteen rows on
 * one screen is a job somebody finishes in an afternoon.
 */

const inr = n => Number(n || 0).toLocaleString('en-IN',
  { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const todayIso = () => {
  const d = new Date(); const p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const dmy = v => {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

export default function OpeningBalancesSettings() {
  const canManage = useCan('MANAGE_OPENING_BALANCE');
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [editing, setEditing] = useState(null);   // `${type}:${key}`
  const [form, setForm]       = useState({ amount: '', direction: 'dr', as_of_date: todayIso(), note: '' });
  const [busy, setBusy]       = useState(false);
  const [history, setHistory] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await api('/api/opening-balances/candidates')); }
    catch (e) { setError(e.message || 'Could not load'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function startEdit(partyType, row) {
    setEditing(`${partyType}:${row.party_key}`);
    setForm({
      amount: row.opening_amount != null ? String(Number(row.opening_amount)) : '',
      direction: row.opening_direction || (partyType === 'customer' ? 'dr' : 'cr'),
      as_of_date: row.as_of_date ? String(row.as_of_date).slice(0, 10) : todayIso(),
      note: '',
    });
    setHistory(null);
  }

  async function save(partyType, partyKey) {
    setBusy(true); setError('');
    try {
      await api('/api/opening-balances', { method: 'PUT', body: {
        party_type: partyType, party_key: String(partyKey),
        amount: Number(form.amount || 0), direction: form.direction,
        as_of_date: form.as_of_date, note: form.note.trim() || null,
      } });
      setEditing(null);
      await load();
    } catch (e) { setError(e.message || 'Could not save'); }
    finally { setBusy(false); }
  }

  async function clear(partyType, partyKey) {
    setBusy(true); setError('');
    try {
      await api(`/api/opening-balances/${partyType}/${encodeURIComponent(partyKey)}`, { method: 'DELETE' });
      setEditing(null);
      await load();
    } catch (e) { setError(e.message || 'Could not clear'); }
    finally { setBusy(false); }
  }

  async function showHistory(partyType, partyKey) {
    try {
      const r = await api(`/api/opening-balances?party_type=${partyType}&party_key=${encodeURIComponent(partyKey)}`);
      setHistory({ key: `${partyType}:${partyKey}`, rows: r.history || [] });
    } catch { /* a missing history is not worth an error banner */ }
  }

  const renderGroup = (title, partyType, rows, sub) => (
    <div className="ob-group">
      <h3>{title} <span className="ob-count">{rows.length}</span></h3>
      <p className="ob-groupsub">{sub}</p>
      <div className="ob-table">
        {rows.length === 0 && <p className="ob-empty">Nothing here.</p>}
        {rows.map(row => {
          const key = `${partyType}:${row.party_key}`;
          const isEditing = editing === key;
          const hasOpening = row.opening_amount != null;
          return (
            <div key={key} className={`ob-row${isEditing ? ' ob-row--editing' : ''}`}>
              <div className="ob-row__party">
                <strong>{row.name || row.party_key}</strong>
                <span>
                  {row.gstin ? `${row.gstin} · ` : ''}{row.invoices} invoice{row.invoices === 1 ? '' : 's'}
                  {row.outstanding > 0 && ` · ${inr(row.outstanding)} outstanding`}
                </span>
              </div>

              {!isEditing && (
                <>
                  <div className="ob-row__val">
                    {hasOpening ? (
                      <>
                        <strong>{inr(row.opening_amount)}</strong>
                        <em className={`ob-dir ob-dir--${row.opening_direction}`}>
                          {row.opening_direction === 'dr' ? 'owed us' : 'we owed'}
                        </em>
                        <span className="ob-asof">as at {dmy(row.as_of_date)}</span>
                      </>
                    ) : <em className="ob-none">not set</em>}
                  </div>
                  <div className="ob-row__actions">
                    {hasOpening && (
                      <button className="btn btn-sm" onClick={() => showHistory(partyType, row.party_key)}
                        title="What this figure replaced">
                        <History size={13} />
                      </button>
                    )}
                    {canManage && (
                      <button className="btn btn-sm" onClick={() => startEdit(partyType, row)}>
                        {hasOpening ? 'Change' : 'Set'}
                      </button>
                    )}
                  </div>
                </>
              )}

              {isEditing && (
                <div className="ob-edit">
                  <label><span>Amount</span>
                    <input type="number" min="0" step="any" value={form.amount} autoFocus
                      onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></label>
                  <label><span>Direction</span>
                    <select value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value }))}>
                      <option value="dr">They owed us</option>
                      <option value="cr">We owed them</option>
                    </select></label>
                  <label><span>As at</span>
                    <input type="date" value={form.as_of_date}
                      onChange={e => setForm(f => ({ ...f, as_of_date: e.target.value }))} /></label>
                  <label className="ob-edit__note"><span>Where this figure came from</span>
                    <input value={form.note} placeholder="e.g. closing balance in the old book, 30/06/2026"
                      onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></label>
                  <div className="ob-edit__actions">
                    <button className="btn btn-primary btn-sm" disabled={busy || !form.amount}
                      onClick={() => save(partyType, row.party_key)}>
                      <Check size={14} /> Save
                    </button>
                    <button className="btn btn-sm" disabled={busy} onClick={() => setEditing(null)}>
                      <X size={14} /> Cancel
                    </button>
                    {hasOpening && (
                      <button className="btn btn-sm ob-clear" disabled={busy}
                        onClick={() => clear(partyType, row.party_key)}>
                        <Undo2 size={14} /> Remove
                      </button>
                    )}
                  </div>
                </div>
              )}

              {history?.key === key && (
                <div className="ob-history">
                  <strong>What this replaced</strong>
                  {history.rows.length === 0 && <p>Nothing — this is the first figure set.</p>}
                  {history.rows.map(h => (
                    <p key={h.id}>
                      {inr(h.amount)} {h.direction === 'dr' ? 'owed us' : 'we owed'} as at {dmy(h.as_of_date)}
                      {h.note ? ` — ${h.note}` : ''}
                      {h.created_by_name ? ` · set by ${h.created_by_name}` : ''}
                    </p>
                  ))}
                  <button className="btn btn-sm" onClick={() => setHistory(null)}>Close</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="ob-wrap">
      <header className="ob-head">
        <Scale size={20} />
        <div>
          <h2>Opening balances</h2>
          <p>What a customer or hub owed before Spinoto started recording. The ledger begins here.</p>
        </div>
      </header>

      <p className="ob-explain">
        <Info size={14} />
        <span>
          Corrections never overwrite. Changing a figure keeps the old one behind it,
          so &ldquo;it said something different last week&rdquo; is always answerable.
        </span>
      </p>

      {!canManage && (
        <p className="ob-explain ob-explain--warn">
          <Info size={14} />
          <span>You can see these but not change them. Setting an opening balance needs
          the <strong>MANAGE_OPENING_BALANCE</strong> permission.</span>
        </p>
      )}

      {error && <p className="ob-error">{error}</p>}
      {loading && <p className="ob-empty">Loading…</p>}

      {data && (
        <>
          {renderGroup('B2B customers', 'customer', data.customers,
            'Registered businesses you invoice. Walk-in customers are left out — a one-invoice customer carried nothing in.')}
          {renderGroup('Hubs with money outstanding', 'hub', data.hubs,
            'Hubs with unpaid purchase invoices. Set a balance only where you owed them before Spinoto.')}
        </>
      )}
    </div>
  );
}
