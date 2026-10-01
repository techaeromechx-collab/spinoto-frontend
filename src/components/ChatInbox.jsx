import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { MessagesSquare } from 'lucide-react';
import { api } from '../api/client.js';
import useSync from '../hooks/useSync.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import { NOTIF_POLL_MS } from '../config/polling.js';
import { listStamp } from '../lib/dayLabel.js';
import ChatToasts from './ChatToasts.jsx';
// The chime and the OS notification, both. One helper, already used by the
// WhatsApp side — see lib/notify.js for why there is only one code path.
import { announce } from '../lib/notify.js';

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
/* ── What announces itself, and what does not ────────────────────────────────

   Six rules, and every one of them is a message somebody would otherwise have
   been told about twice or told about pointlessly:

     · my own message           `mine` — the badge does not tell you what you
                                just typed, and neither does this
     · a muted conversation     `muted` is a decision already made; a card on
                                top of it would make the mute a lie
     · a system line            "Ana added Cai" is a record, not a message
     · a deleted message        there is nothing left to show
     · nothing unread           a re-fetch of a thread you have already read
   Being IN the thread is deliberately NOT one of them. That decision belongs to
   the caller, because it silences the CARD and not the chime — see scan().

   Keyed on the MESSAGE id, not the conversation: two messages in one thread are
   two events, and the 120s backstop poll re-reads the same rows constantly. The
   id is what stops it announcing them again. */
function toCard(c) {
  const lm = c.last_message;
  if (!lm) return null;
  if (lm.mine || lm.deleted || lm.system_event) return null;
  if (c.muted || !c.is_unread) return null;

  const group = c.kind === 'group';
  /* No @mentions exist in the chat yet — there is no `mention` anywhere in
     chat.routes.js or the chat components. The rose card is built and styled;
     this is the one line that turns it on when they land. */
  const mention = Boolean(lm.mentions_me);

  const who = lm.sender_name || 'Someone';
  const initials = who.trim().split(/\s+/).slice(0, 2)
    .map(w => w[0]).join('').toUpperCase() || '?';

  const body = lm.preview
    ? lm.preview + (lm.truncated ? '…' : '')
    : lm.has_ref ? 'Shared a record' : '';

  return {
    key:  `m${lm.id}`,           // the message, not the conversation
    id:   c.id,
    /* A group announces the GROUP and names the speaker inside; a direct
       message has no group to name. Same card, read correctly both ways. */
    label: mention ? (group ? `Mentioned you · ${c.title}` : 'Mentioned you')
         : group   ? (c.title || 'Group')
         : 'Direct message',
    group,
    tone: mention ? 'ping' : group ? 'auto' : 'sticky',
    who, initials,
    msg: body,
    hasRef: Boolean(lm.has_ref),
    time: listStamp(lm.created_at),
    meta: mention ? 'Waits for you'
        : group   ? 'Goes by itself'
        : 'Waits for you',
    /* For the OS notification, which has no room for a label row. */
    osTitle: group ? `${c.title || 'Group'} · ${who}` : who,
    osBody:  body || 'New message',
  };
}

export default function ChatInbox() {
  const navigate = useNavigate();
  const location = useLocation();
  const [count, setCount] = useState(0);
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState([]);
  const wrap = useRef(null);

  /* Which conversation is on screen right now. Read from the route rather than
     passed down, because ChatInbox lives in the topbar and ChatPage is a
     sibling — there is no prop to thread between them. `/chat/41` → '41'. */
  const openId = (location.pathname.match(/^\/chat\/(\d+)/) || [])[1] || null;
  const openIdRef = useRef(openId);
  useEffect(() => { openIdRef.current = openId; }, [openId]);

  /* Every message id this tab has already announced, plus whether the FIRST
     read has happened. Without the prime, every reload would announce every
     unread conversation at once — a full corner of cards for messages that
     arrived while the laptop was shut. The WhatsApp side calls this the same
     thing and for the same reason. */
  const seen   = useRef(new Set());
  const primed = useRef(false);

  /* A card the person dismissed must not come back on the next poll. Separate
     from `seen` only so the intent reads: one is "already announced", the other
     is "they said no". */
  const killed = useRef(new Set());

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

  /* ── The toast pass ───────────────────────────────────────────────────────
     Six rows, not the dropdown's twelve, and it is a different question: the
     dropdown wants a readable list, this wants only what is new enough to still
     be worth announcing. Six is more than three cards plus the overflow count.

     The comment below on fetchItems says a list refetch into a closed dropdown
     is waste, and that is still true — this is not that. The socket only nudges
     on real chat activity, so this is one small query per message that actually
     arrived, which is what a toast costs. The 120s backstop poll stays on the
     count alone and still does not touch this. */
  const scan = useCallback(async () => {
    try {
      const r = await api('/api/chat/conversations?limit=6');
      const rows = r.items || [];

      /* The FIRST scan announces nothing. It records what is already unread so
         that opening the app is silent, and only what arrives after this moment
         makes a sound. */
      if (!primed.current) {
        rows.forEach(c => { if (c.last_message) seen.current.add(`m${c.last_message.id}`); });
        primed.current = true;
        return;
      }

      const fresh = rows
        .map(toCard)
        .filter(Boolean)
        .filter(card => !seen.current.has(card.key) && !killed.current.has(card.key));

      if (!fresh.length) return;
      fresh.forEach(card => seen.current.add(card.key));

      /* ── The thread you are looking at gets the SOUND and not the card ────
         A card would cover the very message it is announcing, and you can
         already see it land. The chime still plays, because the eye may be on
         the other half of the screen, or on the parts shelf.

         This is the one rule that separates the two channels, which is why it
         lives here and not in toCard: that function answers "is this worth
         announcing at all", this answers "how". */
      const here = openIdRef.current;
      const carded = here
        ? fresh.filter(card => String(card.id) !== String(here))
        : fresh;

      /* Newest last, so the stack's own reverse puts it nearest the corner. */
      if (carded.length) setCards(prev => [...prev, ...carded]);

      /* Sound once per batch, not once per card — three messages landing
         together is one arrival, and three chimes on top of each other is a
         fault noise. The system toast is suppressed while the window is
         focused: our own card has already said it, and Windows saying it again
         is the same message announced twice to somebody looking straight at it.
         The chime plays either way, because the eye may be elsewhere. */
      const lead = fresh[fresh.length - 1];
      announce({
        title: lead.osTitle,
        body:  lead.osBody,
        onClick: () => { window.focus(); navigate(`/chat/${lead.id}`); },
        /* Suppressed while the window has focus: our own card has already said
           it, and the OS saying it again is one message announced twice to
           somebody looking straight at it. Unfocused, it fires even for the
           thread that happens to be routed on screen behind them — a tab you
           are not looking at is not a thread you are reading. */
        silentSystem: document.hasFocus(),
      });
    } catch { /* a toast is not worth an error on screen */ }
  }, [navigate]);

  useEffect(() => { fetchCount(); scan(); }, [fetchCount, scan]);

  /* The count always; the list only when the dropdown is actually open. A
     refetch of twelve conversation rows with their previews, on every message
     anybody sends, into a closed dropdown nobody is looking at, is the kind of
     waste that is invisible until the database bill arrives. */
  useSync(['chat'], useCallback(() => {
    fetchCount();
    scan();
    if (open) fetchItems();
  }, [fetchCount, fetchItems, scan, open]));

  /* Walking into a conversation clears its card. Otherwise you open the thread
     from the badge, read the message, and the card is still sitting in the
     corner announcing something you are looking at. */
  useEffect(() => {
    if (!openId) return;
    setCards(prev => prev.filter(c => String(c.id) !== String(openId)));
  }, [openId]);

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

  const openCard = useCallback((card) => {
    setCards(prev => prev.filter(c => c.key !== card.key));
    navigate(`/chat/${card.id}`);
  }, [navigate]);

  const dropCard = useCallback((card) => {
    killed.current.add(card.key);
    setCards(prev => prev.filter(c => c.key !== card.key));
  }, []);

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

      {/* Portalled to <body>, so nothing the topbar does to overflow or
          stacking can clip a card in the opposite corner of the screen. */}
      <ChatToasts
        cards={cards}
        onOpen={openCard}
        onDismiss={dropCard}
        onExpand={() => { setCards([]); setOpen(true); }}
      />
    </div>
  );
}
