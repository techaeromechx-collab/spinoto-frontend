import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client.js';
import {
  Loader2, Save, Plus, Trash2, Info, AlertTriangle, Check, Users,
} from 'lucide-react';

/**
 * Settings → WhatsApp → Routing.
 *
 * Who receives an inbound WhatsApp lead.
 *
 * ── The rule this screen configures ─────────────────────────────────────────
 *
 * A customer taps an option in the Interakt flow — Bike/Scooter, Car,
 * Support/Help. The CRM takes everyone who has that ticked AND is on duty, and
 * gives the lead to whichever of them was assigned one longest ago. Category
 * first, round-robin second: one rule, not two competing ones.
 *
 * ── Why the whole grid saves at once ────────────────────────────────────────
 *
 * A rota is a single decision — "this is who is on today" — and a per-checkbox
 * PATCH would let two people editing at the same time produce a rota neither of
 * them chose. One Save, one request, one state.
 *
 * ── What this screen deliberately cannot do ─────────────────────────────────
 *
 * It cannot reset the round-robin position. last_assigned_at is never sent from
 * here: if saving restarted the rotation, one person would take every lead
 * after each edit, and the more carefully somebody tended the rota the more
 * lopsided it would get.
 */
export default function WhatsAppRoutingTab() {
  const [categories, setCategories] = useState([]);
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');
  const [ok, setOk]           = useState('');
  const [newCat, setNewCat]   = useState('');
  const [dirty, setDirty]     = useState(false);
  // The one-person mode. Kept apart from `rows` on purpose: it saves on change
  // rather than on Save, because it is a switch, not part of the grid's edit.
  const [allOwner, setAllOwner] = useState(null);
  // Who takes the leads the rota cannot sort. Same treatment, same reason, and
  // separate state rather than one "special owner" value — they are two jobs
  // and the same person is allowed to hold both.
  const [fbOwner, setFbOwner] = useState(null);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api('/api/whatsapp/routing');
      setCategories(r.categories || []);
      const users = (r.users || []).map(u => ({
        ...u,
        handles: Array.isArray(u.handles) ? u.handles : [],
      }));
      setRows(users);
      setAllOwner(users.find(u => u.takes_all)?.id ?? null);
      setFbOwner(users.find(u => u.takes_unrouted)?.id ?? null);
      setErr('');
      setDirty(false);
    } catch (e) {
      setErr(e.message || 'Could not load the rota.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Compared case-insensitively and trimmed, the same way the server matches an
  // incoming answer — Interakt's own payload sends "Car " with a trailing
  // space, so an exact comparison would tick the wrong box.
  const has = (row, cat) =>
    row.handles.some(h => String(h).trim().toLowerCase() === cat.name.trim().toLowerCase());

  function toggle(userId, cat) {
    setDirty(true);
    setOk('');
    setRows(rs => rs.map(r => {
      if (r.id !== userId) return r;
      const on = has(r, cat);
      return {
        ...r,
        handles: on
          ? r.handles.filter(h => String(h).trim().toLowerCase() !== cat.name.trim().toLowerCase())
          : [...r.handles, cat.name],
        // Ticking a category for somebody who is not on duty is almost always a
        // mistake — the rota would list them and skip them. Put them on.
        on_duty: on ? r.on_duty : true,
      };
    }));
  }

  function toggleDuty(userId) {
    setDirty(true);
    setOk('');
    setRows(rs => rs.map(r => (r.id === userId ? { ...r, on_duty: !r.on_duty } : r)));
  }

  async function save() {
    setSaving(true); setErr(''); setOk('');
    try {
      await api('/api/whatsapp/routing', {
        method: 'PUT',
        body: { rows: rows.map(r => ({ user_id: r.id, handles: r.handles, on_duty: r.on_duty })) },
      });
      setOk('Rota saved.');
      setDirty(false);
      await load();
    } catch (e) {
      setErr(e.message || 'Could not save the rota.');
    }
    setSaving(false);
  }

  async function chooseAllOwner(userId) {
    setSwitching(true); setErr(''); setOk('');
    try {
      await api('/api/whatsapp/routing/all-owner', {
        method: 'PUT',
        body: { user_id: userId },
      });
      // Reloaded rather than patched locally: the server also switches that
      // person on duty, and guessing at what it did would let this screen show
      // a rota the server does not have.
      await load();
      setOk(userId ? 'That user now receives every WhatsApp lead.' : 'Back to the normal rota.');
    } catch (e) {
      setErr(e.message || 'Could not change who handles all leads.');
    }
    setSwitching(false);
  }

  async function chooseFallbackOwner(userId) {
    setSwitching(true); setErr(''); setOk('');
    try {
      await api('/api/whatsapp/routing/unrouted-owner', {
        method: 'PUT',
        body: { user_id: userId },
      });
      await load();
      setOk(userId
        ? 'That user now receives leads that never chose an option.'
        : 'Those leads will wait in the Unassigned queue again.');
    } catch (e) {
      setErr(e.message || 'Could not change who takes unsorted leads.');
    }
    setSwitching(false);
  }

  async function addCategory() {
    const name = newCat.trim();
    if (!name) return;
    setErr(''); setOk('');
    try {
      await api('/api/whatsapp/routing/categories', { method: 'POST', body: { name } });
      setNewCat('');
      await load();
    } catch (e) {
      setErr(e.message || 'Could not add that category.');
    }
  }

  async function removeCategory(id) {
    setErr(''); setOk('');
    try {
      await api(`/api/whatsapp/routing/categories/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setErr(e.message || 'Could not remove that category.');
    }
  }

  if (loading) {
    return <div className="war-loading"><Loader2 size={15} className="spin" /> Loading the rota…</div>;
  }

  // Which categories nobody on duty covers. This is the one thing on the screen
  // worth interrupting somebody about: a category with no on-duty owner means
  // those leads land in the unassigned queue and stay there until a human
  // notices. Better said out loud here than discovered on Monday.
  const uncovered = categories.filter(c =>
    !rows.some(r => r.on_duty && has(r, c)));

  /* ── On the rota, but locked out of WhatsApp ───────────────────────────────
     The failure this catches: an advisor was routed customer after customer and
     could not open a single one — no badge, no thread, a red "you don't have
     permission" where the conversation should be. Nothing connected the rota to
     the permission, so the rota could name somebody structurally unable to do
     the job, and the only symptom was a customer waiting for a reply.

     Anyone the rules can reach counts, not just those with a category ticked:
     the all-leads owner and the fallback owner receive conversations without
     handling anything at all, and they are the two most likely to be missed. */
  const reachable = rows.filter(r =>
    r.can_read_whatsapp === false &&
    (r.takes_all || r.takes_unrouted || (r.on_duty && categories.some(c => has(r, c)))));

  return (
    <div className="war">
      <div className="wa-banner wa-banner--info">
        <Info size={15} />
        <div>
          <strong>How a WhatsApp lead finds its owner.</strong> The customer taps an option in your
          Interakt flow. Everyone who has that option ticked <em>and</em> is on duty goes into the
          draw, and it goes to whoever was given a lead longest ago — so they take turns.
          A customer this number has spoken to before goes back to the same advisor instead.
          If none of that applies — someone who just types a message and taps nothing — it goes
          to the person named below as taking unsorted leads, and if nobody is named it waits in
          the <strong>Unassigned</strong> queue on the Leads page.
        </div>
      </div>

      {/* ── One person takes everything ─────────────────────────────────────
          A dropdown, not a column of checkboxes, because it is a single choice
          about the whole business. A column would let two people be ticked —
          the one thing this mode exists to prevent — and the conflict would
          only surface as a database error. */}
      <div className={`war-all${allOwner ? ' war-all--on' : ''}`}>
        <div className="war-all-txt">
          <strong>One person handles every WhatsApp lead</strong>
          <em>
            {allOwner
              ? 'The options and the rota below are switched off while this is on. Turn it off and they come back exactly as they were.'
              : 'Use this when one person is covering. Everything below is ignored while it is on.'}
          </em>
        </div>
        <select
          value={allOwner ?? ''}
          disabled={switching}
          onChange={e => chooseAllOwner(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Off — use the rota below</option>
          {rows.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>

      {/* ── Who takes what the rota cannot sort ─────────────────────────────
          Below the all-leads switch and above the categories, because that is
          its place in the rules: it is consulted last, and only when everything
          between here and there has found nobody.

          Switched off with the rest of the screen while one person is taking
          everything — not because it would misbehave, but because it would be
          the only live control on a greyed-out page, which reads as though it
          still applies. It does not: takes_all catches every lead first. */}
      <div className={`war-all war-all--fb${fbOwner ? ' war-all--on' : ''}${allOwner ? ' war-off' : ''}`}>
        <div className="war-all-txt">
          <strong>Leads that never chose an option</strong>
          <em>
            {fbOwner
              ? 'Someone who just types a message goes to this person. If they tap an option later and somebody else handles it, the lead moves across and both are told.'
              : 'A customer who types “Interested” and taps nothing gives the rota nothing to sort on. Pick who triages those, or they wait in the Unassigned queue.'}
          </em>
        </div>
        <select
          value={fbOwner ?? ''}
          disabled={switching}
          onChange={e => chooseFallbackOwner(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Off — leave them unassigned</option>
          {rows.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>

      {!allOwner && uncovered.length > 0 && (
        <div className="wa-banner wa-banner--warn">
          <AlertTriangle size={15} />
          <div>
            Nobody on duty is handling <strong>{uncovered.map(c => c.name).join(', ')}</strong>.
            {fbOwner
              ? ' Those leads go to whoever is set above for unsorted leads, and move across if the customer taps again once somebody is on duty for it.'
              : ' Those leads will sit unassigned until somebody picks them up.'}
          </div>
        </div>
      )}

      {reachable.length > 0 && (
        <div className="wa-banner wa-banner--error">
          <AlertTriangle size={15} />
          <div>
            <strong>{reachable.map(r => r.name).join(', ')}</strong>
            {reachable.length === 1 ? ' is' : ' are'} set to receive WhatsApp leads but
            cannot open a WhatsApp conversation — they will be given customers and see
            “You don't have permission”. Give them <strong>Send WhatsApp Messages</strong> in
            Settings → Manage Users, or take them off the rota.
          </div>
        </div>
      )}

      {err && <div className="wa-banner wa-banner--error"><AlertTriangle size={15} /><div>{err}</div></div>}
      {ok  && <div className="wa-banner war-banner--ok"><Check size={15} /><div>{ok}</div></div>}

      {/* ── The categories ── */}
      <div className={`war-cats${allOwner ? ' war-off' : ''}`}>
        <div className="war-cats-hd">
          <span>Options in your flow</span>
          {/* These strings live in Interakt, not in this codebase. Adding a
              button to the flow must be a thing you can route without waiting
              for a deploy. */}
          <em>Must match the button text in Interakt exactly — spelling and all.</em>
        </div>
        <div className="war-cats-row">
          {categories.map(c => (
            <span key={c.id} className="war-cat">
              {c.name}
              <button type="button" onClick={() => removeCategory(c.id)} title={`Stop routing on "${c.name}"`}>
                <Trash2 size={11} />
              </button>
            </span>
          ))}
          <span className="war-cat-add">
            <input
              value={newCat}
              onChange={e => setNewCat(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }}
              placeholder="Add an option…"
              maxLength={80}
            />
            <button type="button" onClick={addCategory} disabled={!newCat.trim()}>
              <Plus size={12} /> Add
            </button>
          </span>
        </div>
      </div>

      {/* ── The grid ── */}
      <div className={`war-grid-wrap${allOwner ? ' war-off' : ''}`}>
        <table className="war-grid">
          <thead>
            <tr>
              <th className="war-th-user"><Users size={12} /> User</th>
              {categories.map(c => <th key={c.id}>{c.name}</th>)}
              <th className="war-th-duty">On duty</th>
              <th className="war-th-last">Last given a lead</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className={r.on_duty ? '' : 'war-row--off'}>
                <td className="war-user">
                  <strong>{r.name}</strong>
                  <em>{r.department || r.email}</em>
                </td>

                {categories.map(c => (
                  <td key={c.id} className="war-cell">
                    <label>
                      <input
                        type="checkbox"
                        checked={has(r, c)}
                        onChange={() => toggle(r.id, c)}
                      />
                      <span className="war-box" />
                    </label>
                  </td>
                ))}

                <td className="war-cell war-cell--duty">
                  <button
                    type="button"
                    className={`war-duty${r.on_duty ? ' war-duty--on' : ''}`}
                    onClick={() => toggleDuty(r.id)}
                    aria-pressed={r.on_duty}
                  >
                    <span />
                  </button>
                </td>

                {/* The round-robin's actual position, shown rather than hidden.
                    It is the only way to answer "why did Amit get that one?"
                    without reading the database. */}
                <td className="war-last">
                  {r.last_assigned_at
                    ? new Date(r.last_assigned_at).toLocaleString('en-IN',
                        { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                    : <span className="war-never">never — next in line</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!rows.length && (
          <div className="war-empty">No active users. Add them in Settings → Manage Users first.</div>
        )}
      </div>

      <div className="war-actions">
        <button className="btn btn-primary" onClick={save} disabled={saving || !dirty || !!allOwner}>
          {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
          {saving ? 'Saving…' : dirty ? 'Save rota' : 'Saved'}
        </button>
        {dirty && <span className="war-dirty">Unsaved changes</span>}
      </div>
    </div>
  );
}
