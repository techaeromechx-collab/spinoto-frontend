import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client.js';
import {
  Loader2, Plus, Trash2, Info, AlertTriangle, Check, X, Pencil, Save, Zap,
} from 'lucide-react';

/**
 * Settings → WhatsApp → Quick Replies.
 *
 * Canned messages an advisor drops into the WhatsApp composer.
 *
 * ── Why these are not templates ─────────────────────────────────────────────
 *
 * A template is approved by Meta, lives on Interakt's side, and is the only
 * thing that may be sent to somebody who has not written to us in 24 hours.
 * These are none of that. They are ordinary typed messages that happen to be
 * typed in advance, legal only inside the 24-hour window, and invented here
 * with nobody's approval. Nothing on this screen needs to wait for Meta.
 *
 * ── Why picking one does not send it ────────────────────────────────────────
 *
 * The message is INSERTED into the composer and the advisor presses Send
 * themselves. That is the whole safety of the feature: a stock answer is only
 * correct once a person has confirmed it answers the question that was
 * actually asked, and a one-tap send would put the opening hours in front of
 * somebody who asked what a clutch job costs.
 */
export default function WhatsAppQuickRepliesTab() {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState('');
  const [ok, setOk]           = useState('');
  const [busy, setBusy]       = useState(false);

  const BLANK = { title: '', shortcut: '', message: '' };
  const [draft, setDraft] = useState(BLANK);
  const [adding, setAdding] = useState(false);

  const [editId, setEditId] = useState(null);
  const [edit, setEdit]     = useState(BLANK);

  const [confirmId, setConfirmId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api('/api/whatsapp/quick-replies?all=1');
      setItems(r.items || []);
      setErr('');
    } catch (e) {
      setErr(e.message || 'Could not load the quick replies.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!ok) return;
    const t = setTimeout(() => setOk(''), 4000);
    return () => clearTimeout(t);
  }, [ok]);

  async function add() {
    if (!draft.title.trim() || !draft.message.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await api('/api/whatsapp/quick-replies', {
        method: 'POST',
        body: {
          title: draft.title.trim(),
          // '' rather than the field being absent would fail the max(40)
          // check on some inputs and store an empty string on others. null is
          // the one value the column and the partial unique index both mean
          // by "no shortcut".
          shortcut: draft.shortcut.trim() || null,
          message: draft.message.trim(),
        },
      });
      setItems(list => [...list, r.item].sort(byTitle));
      setDraft(BLANK);
      setAdding(false);
      setOk(`“${r.item.title}” is ready to use in the chat.`);
    } catch (e) {
      setErr(e.message || 'Could not add that quick reply.');
    }
    setBusy(false);
  }

  async function patch(id, body, okMsg) {
    setBusy(true); setErr('');
    try {
      const r = await api(`/api/whatsapp/quick-replies/${id}`, { method: 'PATCH', body });
      setItems(list => list.map(i => (i.id === id ? r.item : i)).sort(byTitle));
      if (okMsg) setOk(okMsg);
      return true;
    } catch (e) {
      setErr(e.message || 'Could not save that change.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    setBusy(true); setErr('');
    try {
      await api(`/api/whatsapp/quick-replies/${id}`, { method: 'DELETE' });
      setItems(list => list.filter(i => i.id !== id));
      setConfirmId(null);
      setOk('Quick reply removed.');
    } catch (e) {
      setErr(e.message || 'Could not remove that quick reply.');
    }
    setBusy(false);
  }

  function startEdit(it) {
    setConfirmId(null);
    setAdding(false);
    setEditId(it.id);
    setEdit({ title: it.title, shortcut: it.shortcut || '', message: it.message });
  }

  async function saveEdit() {
    if (!edit.title.trim() || !edit.message.trim()) return;
    const done = await patch(editId, {
      title: edit.title.trim(),
      shortcut: edit.shortcut.trim() || null,
      message: edit.message.trim(),
    }, 'Quick reply updated.');
    if (done) setEditId(null);
  }

  const active = items.filter(i => i.is_active).length;

  if (loading) {
    return <div className="waq-loading"><Loader2 size={16} className="spin" /> Loading quick replies…</div>;
  }

  return (
    <div className="waq">
      <div className="wa-banner wa-banner--info">
        <Info size={15} />
        <div>
          <strong>Answers your advisors type over and over.</strong> Opening hours, the
          workshop address, what a service includes. Picking one puts the text in the
          reply box — <em>it is not sent</em>. The advisor reads it, edits it if the
          customer asked something slightly different, and presses Send.
        </div>
      </div>

      {err && <div className="wa-banner wa-banner--error"><AlertTriangle size={15} /><div>{err}</div></div>}
      {ok  && <div className="wa-banner waq-banner--ok"><Check size={15} /><div>{ok}</div></div>}

      {/* ── Add ──────────────────────────────────────────────────────────────
          Behind a button rather than always open. The message box is three
          rows tall, and a permanently open form pushes the list — the thing
          somebody came here to read — below the fold on every visit. */}
      {adding ? (
        <div className="waq-form">
          <div className="waq-form-row">
            <div className="waq-f">
              <label>Title</label>
              <input
                value={draft.title}
                onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                placeholder="Opening hours"
                maxLength={120}
                autoFocus
              />
              <em>What the advisor sees in the list.</em>
            </div>
            <div className="waq-f waq-f--short">
              <label>Shortcut <span>optional</span></label>
              <input
                value={draft.shortcut}
                onChange={e => setDraft(d => ({ ...d, shortcut: e.target.value }))}
                placeholder="/hours"
                maxLength={40}
                spellCheck={false}
              />
              <em>A short label to search by. The slash is added for you.</em>
            </div>
          </div>

          <div className="waq-f">
            <label>Message</label>
            <textarea
              rows={4}
              value={draft.message}
              onChange={e => setDraft(d => ({ ...d, message: e.target.value }))}
              placeholder={'We are open Monday to Saturday, 9:30 am to 7 pm.\nSunday closed.'}
              maxLength={4096}
            />
            {/* No variable syntax here, and that is deliberate: nothing on this
                screen fills in a customer's name. A '{{name}}' typed in hope
                would be delivered to the customer exactly as written. */}
            <em>
              Typed exactly as the customer will read it — {draft.message.length}/4096 characters.
              Line breaks are kept.
            </em>
          </div>

          <div className="waq-form-acts">
            <button className="btn btn-primary" onClick={add}
                    disabled={busy || !draft.title.trim() || !draft.message.trim()}>
              {busy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} Add quick reply
            </button>
            <button className="waq-ghost" onClick={() => { setAdding(false); setDraft(BLANK); }} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="waq-addbar">
          <button className="btn btn-primary" onClick={() => { setAdding(true); setEditId(null); }}>
            <Plus size={14} /> New quick reply
          </button>
          {items.length > 0 && (
            <span className="waq-count">
              {active} available to advisors
              {items.length !== active && ` · ${items.length - active} switched off`}
            </span>
          )}
        </div>
      )}

      {/* ── The list ─────────────────────────────────────────────────────── */}
      {items.length === 0 ? (
        <div className="waq-empty">
          <Zap size={22} />
          <strong>No quick replies yet</strong>
          <span>
            Start with the three questions you answer most — opening hours, where you
            are, and how long a service takes. They appear behind the ⚡ button in every
            WhatsApp conversation.
          </span>
        </div>
      ) : (
        <div className="waq-list">
          {items.map(it => (
            <div key={it.id} className={`waq-card${it.is_active ? '' : ' waq-card--off'}`}>
              {editId === it.id ? (
                <div className="waq-form waq-form--inline">
                  <div className="waq-form-row">
                    <div className="waq-f">
                      <label>Title</label>
                      <input
                        value={edit.title}
                        onChange={e => setEdit(d => ({ ...d, title: e.target.value }))}
                        maxLength={120}
                        autoFocus
                      />
                    </div>
                    <div className="waq-f waq-f--short">
                      <label>Shortcut <span>optional</span></label>
                      <input
                        value={edit.shortcut}
                        onChange={e => setEdit(d => ({ ...d, shortcut: e.target.value }))}
                        maxLength={40}
                        placeholder="/hours"
                        spellCheck={false}
                      />
                    </div>
                  </div>
                  <div className="waq-f">
                    <label>Message</label>
                    <textarea
                      rows={4}
                      value={edit.message}
                      onChange={e => setEdit(d => ({ ...d, message: e.target.value }))}
                      maxLength={4096}
                    />
                  </div>
                  <div className="waq-form-acts">
                    <button className="btn btn-primary" onClick={saveEdit}
                            disabled={busy || !edit.title.trim() || !edit.message.trim()}>
                      <Save size={13} /> Save
                    </button>
                    <button className="waq-ghost" onClick={() => setEditId(null)} disabled={busy}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="waq-head">
                    <strong>{it.title}</strong>
                    {it.shortcut && <code>{it.shortcut}</code>}

                    <div className="waq-acts">
                      <label className="waq-sw" title={it.is_active
                        ? 'Advisors can use this'
                        : 'Hidden from the chat'}>
                        <input
                          type="checkbox"
                          checked={it.is_active}
                          disabled={busy}
                          onChange={() => patch(it.id, { is_active: !it.is_active },
                            it.is_active
                              ? `“${it.title}” is hidden from the chat.`
                              : `“${it.title}” is available in the chat again.`)}
                        />
                        <span />
                        <em>{it.is_active ? 'On' : 'Off'}</em>
                      </label>

                      <button className="waq-icon" onClick={() => startEdit(it)} title="Edit">
                        <Pencil size={13} />
                      </button>

                      {confirmId === it.id ? (
                        <span className="waq-confirm">
                          <button className="waq-del" onClick={() => remove(it.id)} disabled={busy}>
                            Remove
                          </button>
                          <button className="waq-icon" onClick={() => setConfirmId(null)} title="Keep">
                            <X size={13} />
                          </button>
                        </span>
                      ) : (
                        <button className="waq-icon waq-icon--danger"
                                onClick={() => setConfirmId(it.id)} title="Remove">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* pre-wrap, not a collapsed single line: the line breaks an
                      admin typed are part of the message the customer reads,
                      and a preview that flattens them hides a formatting
                      mistake until it has already been sent. */}
                  <div className="waq-msg">{it.message}</div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function byTitle(a, b) {
  return String(a.title).toLowerCase().localeCompare(String(b.title).toLowerCase());
}
