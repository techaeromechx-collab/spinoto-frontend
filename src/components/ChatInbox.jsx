import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessagesSquare } from 'lucide-react';
import { api } from '../api/client.js';
import useSync from '../hooks/useSync.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import { NOTIF_POLL_MS } from '../config/polling.js';
import { listStamp } from '../lib/dayLabel.js';

/**
 * ChatInbox — the unread badge in the topbar, and what is behind it.
 *
 * Modelled on WhatsAppInbox, with two deliberate differences:
 *
 *   It uses useSync instead of a hand-rolled socket.on('invalidate'). Both do
 *   the same thing; the hook is the house convention and holds the callback in a
 *   ref so an inline arrow cannot churn socket listeners.
 *
 *   It uses useEscapeClose instead of a hand-rolled Escape listener. The
 *   outside-click close stays, because a topbar dropdown is not a modal — the
 *   convention in that hook's comment is about dialogs holding unsaved work, and
 *   a read-only list of conversations is neither.
 *
 * ══ WHY THERE IS STILL A POLL ══════════════════════════════════════════════
 *
 * The socket is the real-time path. The 120s interval is a backstop for a
 * connection that dropped without the client noticing, and it is gated on
 * document.visibilityState for the reason config/polling.js spells out: the
 * database is serverless and suspends after five minutes idle, so an ungated
 * poll from one tab left open overnight keeps it awake and billing all night.
 */
export default function ChatInbox() {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  const fetchCount = useCallback(async () => {
    try {
      const r = await api('/api/chat/unread-count');
      setCount(r.count || 0);
    } catch { /* a badge is not worth an error on screen */ }
  }, []);

  const fetchItems = useCallback(async () => {
    try {
      const r = await api('/api/chat/conversations?limit=12');
      setItems(r.items || []);
    } catch { /* same */ }
  }, []);

  useEffect(() => { fetchCount(); }, [fetchCount]);

  /* The count always; the list only when the dropdown is actually open. A
     refetch of twelve conversation rows with their previews, on every message
     anybody sends, into a closed dropdown nobody is looking at, is the kind of
     waste that is invisible until the database bill arrives. */
  useSync(['chat'], useCallback(() => {
    fetchCount();
    if (open) fetchItems();
  }, [fetchCount, fetchItems, open]));

  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') fetchCount(); };
    const id = setInterval(tick, NOTIF_POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [fetchCount]);

  useEffect(() => { if (open) fetchItems(); }, [open, fetchItems]);

  useEscapeClose(() => setOpen(false), open);

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function go(id) {
    setOpen(false);
    navigate(`/chat/${id}`);
  }

  return (
    <div className="chi-wrap" ref={wrap}>
      <button
        type="button"
        className={`chi-btn${count > 0 ? ' chi-btn--live' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Internal chat"
        aria-label={count > 0 ? `${count} unread conversations` : 'Internal chat'}
        aria-expanded={open}
      >
        <MessagesSquare size={18} />
        {count > 0 && <span className="chi-badge">{count > 99 ? '99+' : count}</span>}
      </button>

      {open && (
        <div className="chi-dropdown" role="dialog" aria-label="Internal chat">
          <div className="chi-dd-head">
            <span className="chi-dd-title">Chat</span>
            <button type="button" className="chi-dd-all" onClick={() => { setOpen(false); navigate('/chat'); }}>
              Open chat
            </button>
          </div>

          <div className="chi-dd-list">
            {!items.length && (
              <div className="chi-dd-empty">
                No conversations yet. Messages from colleagues appear here.
              </div>
            )}
            {items.map((c) => {
              const name = c.kind === 'group'
                ? c.title
                : (c.others?.[0]?.name || 'Direct message');
              const lm = c.last_message;
              return (
                <button key={c.id} type="button"
                        className={`chi-row${c.is_unread ? ' chi-row--unread' : ''}`}
                        onClick={() => go(c.id)}>
                  <span className="chi-row-top">
                    <span className="chi-who">{name}</span>
                    <span className="chi-when">{listStamp(lm?.created_at || c.created_at)}</span>
                  </span>
                  <span className="chi-msg">
                    {!lm ? <em>No messages yet</em>
                      : lm.deleted ? <em>Message deleted</em>
                      : lm.preview
                        ? <>{lm.mine && 'You: '}{lm.preview}{lm.truncated ? '…' : ''}</>
                        : lm.has_ref ? <em>Shared a record</em> : <em>&nbsp;</em>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
