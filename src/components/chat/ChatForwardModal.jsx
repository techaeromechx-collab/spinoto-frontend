import { useEffect, useState } from 'react';
import { Search, Users, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { useEscapeClose } from '../../hooks/useEscapeClose.js';
import '../../styles/chatShared.css';

/**
 * ChatForwardModal — send this message somewhere else.
 *
 * ══ IT LISTS CONVERSATIONS, NOT PEOPLE ═════════════════════════════════════
 *
 * Deliberately the conversation list and not the staff directory. Forwarding into
 * a person implies creating a thread with them if none exists, which is a
 * different action wearing the same button — and it would mean a stray click
 * could open a new conversation with somebody by accident. Somewhere you are
 * already talking, or nowhere.
 *
 * ══ WHAT IS SHOWN, AND WHAT IS NOT ═════════════════════════════════════════
 *
 * The source conversation is filtered out: forwarding a message into the thread
 * it is already in is a copy of itself, which the API would happily accept.
 * Archived threads are filtered out too — they are read-only, the API returns 409,
 * and offering a destination that always fails is worse than not offering it.
 * The list endpoint already excludes archived ones, so that second filter is the
 * list's default rather than work done here.
 */
export default function ChatForwardModal({ message, fromId, onClose, onDone }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(null);      // the id being sent to
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');

  useEscapeClose(onClose);

  useEffect(() => {
    api('/api/chat/conversations?limit=60')
      .then((r) => setItems(r.items))
      .catch((e) => setErr(e?.message || 'Could not load your conversations.'));
  }, []);

  const label = (c) => (c.kind === 'group'
    ? c.title
    : (c.others?.[0]?.name || 'Direct message'));

  const needle = q.trim().toLowerCase();
  const shown = items
    .filter((c) => c.id !== fromId)
    .filter((c) => !needle || label(c).toLowerCase().includes(needle));

  async function forward(c) {
    setBusy(c.id); setErr('');
    try {
      await api(`/api/chat/messages/${message.id}/forward`, {
        method: 'POST', body: { conversation_id: c.id },
      });
      onDone?.(c);
    } catch (e) {
      setErr(e?.message || 'Could not forward that.');
      setBusy(null);
    }
  }

  return (
    <div className="ch-modal-wrap" role="dialog" aria-modal="true" aria-label="Forward message">
      <div className="ch-modal-backdrop" />
      <div className="ch-modal">
        <header className="ch-modal-head">
          <h3>Forward to…</h3>
          <button type="button" className="ch-modal-x" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        {err && <div className="ch-alert" role="alert">{err}</div>}

        {/* What is being forwarded, so nobody has to remember which bubble they
            clicked while they scroll a list of sixty threads. */}
        <div className="ch-fwd-preview">
          {message?.body
            ? <span className="ch-fwd-text">{message.body}</span>
            : <em className="ch-fwd-text">A shared record</em>}
        </div>

        <div className="ch-modal-search">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Filter conversations…" aria-label="Filter conversations" autoFocus />
        </div>

        <ul className="ch-people">
          {shown.map((c) => (
            <li key={c.id}>
              <button type="button" className="ch-person" disabled={busy !== null}
                      onClick={() => forward(c)}>
                <span>
                  {c.kind === 'group' && <Users size={12} />} {label(c)}
                </span>
                {busy === c.id && <span className="ch-fwd-going">Sending…</span>}
              </button>
            </li>
          ))}
          {!shown.length && <li className="ch-empty">Nowhere else to send it.</li>}
        </ul>

        <footer className="ch-modal-foot">
          <button type="button" className="ch-btn" onClick={onClose}>Cancel</button>
        </footer>
      </div>
    </div>
  );
}
