import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Check, Lock, Clock, X, Trash2 } from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import socket from '../lib/socket.js';
import { announce } from '../lib/notify.js';
import WhatsAppToasts from './WhatsAppToasts.jsx';

/**
 * The WhatsApp badge in the topbar.
 *
 * ── Why it is not the bell ──────────────────────────────────────────────────
 *
 * It could have been another notification type. It is separate because of one
 * thing the bell cannot express: the 24-HOUR WINDOW.
 *
 * WhatsApp only allows a free-text reply within 24 hours of the customer's last
 * message. After that you are down to approved templates. So a WhatsApp message
 * is the only thing in this CRM that expires — "you have 40 minutes left to
 * answer this person" is real, and a bell that shows fifteen kinds of alert
 * sorted by age has nowhere to put it.
 *
 * ── Conversations, not messages ─────────────────────────────────────────────
 *
 * "4" means four people are waiting. A message count reads "17" when one
 * customer sent seventeen lines about a bumper, which is one job.
 *
 * ── Read and Clear are two different verbs ──────────────────────────────────
 *
 *   Mark read  "I have seen this." The badge drops, the row stays — a list that
 *              empties as you look at it cannot be used to find the message you
 *              just read.
 *   Clear      "I am done with this." The row goes, and comes back by itself
 *              the moment that customer writes again. Nothing is deleted: the
 *              thread on the lead is untouched, as is everybody else's view.
 *
 * ── How it learns something arrived ─────────────────────────────────────────
 *
 *   socket   the server emits a contentless invalidate on every inbound
 *            message. Instant, and it carries nothing — the socket is not
 *            authenticated, so the count is refetched over the API instead.
 *   poll     a slow backstop for a dropped socket. Gated on tab visibility for
 *            the same reason the bell's poll is: this database bills per hour
 *            of uptime and an always-on poller kept it awake overnight.
 */

// Matches the bell. A backstop behind the socket, not the primary path.
const POLL_MS = 120_000;

/**
 * Time left in WhatsApp's 24-hour free-text window.
 *
 * Three states, not two, and the middle one is why this is worth rendering at
 * all. "22h left" is information; "48m left" is an instruction. They should not
 * look the same, and the first version made every row shout in green whether
 * there were twenty hours left or twenty minutes.
 */
function windowState(expiresAt) {
  if (!expiresAt) return { tone: 'shut', label: 'no reply window' };
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return { tone: 'shut', label: 'window closed' };

  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  // Under two hours is the case worth interrupting somebody about. Above it,
  // hours alone — the minutes are noise on a number nobody will act on in the
  // next sixty seconds.
  if (h < 2) return { tone: 'urgent', label: h > 0 ? `${h}h ${m}m left` : `${m}m left` };
  return { tone: 'calm', label: `${h}h left` };
}

function timeAgo(v) {
  const m = Math.floor((Date.now() - new Date(v).getTime()) / 60000);
  if (m < 1)  return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d` : new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/**
 * Initials for the avatar.
 *
 * The avatar replaced a 7px dot, and it is not decoration: a list of names all
 * in the same weight is read one row at a time, and a list with a coloured
 * anchor per row is scanned. Two letters where there are two words, otherwise
 * two characters of the one there is.
 *
 * A conversation with no name at all shows the number, and slicing digits gives
 * "+9" for everybody — so those get the glyph instead.
 */
function initials(name) {
  const s = String(name || '').trim();
  if (!s || s.startsWith('+') || /^\d/.test(s)) return null;
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

export default function WhatsAppInbox() {
  const navigate = useNavigate();
  // `can` already answers TRUE for a super admin, so one check covers both.
  const { user: me, can } = useAuth();
  const seesEverything = can('VIEW_LEAD');
  const [open,  setOpen]  = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState([]);
  const [busy,  setBusy]  = useState(false);
  // The sticky cards in the corner. Kept HERE rather than in the toast
  // component, because the badge, the socket and the cards are three views of
  // one fact — two components with two ideas about what is unread is how a
  // badge and a card start disagreeing.
  const [cards, setCards] = useState([]);
  const wrapRef = useRef(null);

  /* What we have already raised a card for: mobile -> that message's timestamp.
     Keyed on the timestamp rather than a Set of numbers, so a SECOND message
     from the same customer raises a second card. A plain "already shown" set
     would go quiet on the follow-up, which is usually the urgent one. */
  const carded = useRef(new Map());

  // What the count was last time we looked. The sound fires on an INCREASE, not
  // on a non-zero value — otherwise every poll would chime while a backlog sat
  // there unread, which is how somebody ends up muting the tab.
  const lastCount = useRef(null);
  // Suppressed for the very first fetch after loading the page. Arriving at
  // work to eleven unread conversations should not set off a chime and a toast
  // for messages that came in overnight.
  const primed = useRef(false);

  /**
   * Does this card WAIT, or announce itself and go?
   *
   * The difference is whether answering it is your job.
   *
   *   yours            sticky. Nothing else knows whether you have dealt with
   *                    it, so nothing else may take it away.
   *   the shared queue  sticky for an advisor — an unassigned conversation is
   *                    nobody's until somebody grabs it, and a card that
   *                    flashed past would leave it exactly as unnoticed as it
   *                    was before any of the routing work.
   *   anything else     8 seconds. You are seeing it because you can see
   *                    EVERYTHING, and a card that waited forever for somebody
   *                    who is not going to answer it is not a notification, it
   *                    is a chore: every conversation in the business queuing
   *                    up in the corner of the owner's screen to be swept away
   *                    by hand.
   *
   * Being assigned it beats seeing everything — a super admin who owns a
   * conversation owns it, and that card waits like anyone else's.
   */
  const isSticky = useCallback((row) => {
    if (me?.id && row.assigned_user_id === me.id) return true;
    if (!row.assigned_user_id && !seesEverything) return true;
    return false;
  }, [me?.id, seesEverything]);

  /**
   * Record what is already unread WITHOUT raising anything.
   *
   * Run once, on the first fetch after the page loads. Without it, opening the
   * CRM in the morning would stack cards for every conversation that came in
   * overnight — all of them already visible in the badge and the dropdown, none
   * of them news.
   */
  const primeCards = useCallback(async () => {
    try {
      const r = await api('/api/whatsapp/inbox');
      for (const row of r.items || []) {
        if (row.is_unread) carded.current.set(row.mobile, row.last_message_at);
      }
      setItems(r.items || []);
    } catch { /* silent */ }
  }, []);

  /**
   * Something arrived. Work out WHO, and raise a card for each.
   *
   * The socket cannot tell us — it is unauthenticated and carries no message
   * text on purpose — so the list is fetched over the API and compared against
   * what we have already carded. `howMany` is only a fallback for the
   * announcement text when the list and the count disagree, which they can for
   * a moment: the count query and the list query run a few milliseconds apart.
   */
  const raiseCards = useCallback(async (howMany) => {
    let fresh = [];
    try {
      const r = await api('/api/whatsapp/inbox');
      setItems(r.items || []);

      fresh = (r.items || []).filter(row => {
        if (!row.is_unread) return false;
        const already = carded.current.get(row.mobile);
        // Strictly newer, so a re-fetch of the same state raises nothing, but a
        // SECOND message from the same customer does.
        return !already || new Date(row.last_message_at) > new Date(already);
      });

      for (const row of fresh) carded.current.set(row.mobile, row.last_message_at);

      if (fresh.length) {
        fresh = fresh.map(row => ({ ...row, sticky: isSticky(row) }));
        setCards(prev => [
          ...fresh,
          // Anything already on screen for the same number is replaced rather
          // than stacked — two cards for one customer is one conversation
          // pretending to be two.
          ...prev.filter(p => !fresh.some(f => f.mobile === p.mobile)),
        ]);
      }
    } catch { /* the card is a nicety; the badge already moved */ }

    // ── The chime, and the OS notification ────────────────────────────────
    //
    // The sound always. The OS toast ONLY when this document is hidden: a
    // message arriving while somebody is looking at this very screen would
    // otherwise announce itself twice, once in the corner and once from the
    // operating system.
    const who = fresh.length === 1 ? fresh[0].display_name : null;
    announce({
      title: 'New WhatsApp message',
      body: who
        ? `${who} is waiting for a reply.`
        : `${fresh.length || howMany} conversations are waiting for a reply.`,
      onClick: () => setOpen(true),
      silentSystem: document.visibilityState === 'visible',
    });
  }, [isSticky]);

  const fetchCount = useCallback(async () => {
    try {
      const r = await api('/api/whatsapp/inbox/unread-count');
      const next = r.count || 0;
      setCount(next);

      const prev = lastCount.current;
      lastCount.current = next;

      // The first fetch after a page load PRIMES rather than announces —
      // arriving at work to eleven unread conversations must not set off eleven
      // cards and a chime for messages that came in overnight. It still records
      // what it saw, so those conversations never raise a card retroactively.
      if (!primed.current) {
        primed.current = true;
        await primeCards();
        return;
      }
      if (prev === null || next <= prev) return;

      await raiseCards(next - prev);
    } catch { /* silent — a badge is not worth an error banner */ }
  }, [primeCards, raiseCards]);

  const fetchItems = useCallback(async () => {
    try {
      const r = await api('/api/whatsapp/inbox');
      setItems(r.items || []);
    } catch { /* silent */ }
  }, []);

  // ── The socket: instant, and the reason the poll can stay slow ───────────
  useEffect(() => {
    const onInvalidate = ({ topic }) => {
      if (topic !== 'wa_inbox') return;
      fetchCount();
      // Only while somebody is looking at the list — refetching a dropdown
      // nobody has open is a query for nothing.
      if (open) fetchItems();
    };
    socket.on('invalidate', onInvalidate);
    return () => socket.off('invalidate', onInvalidate);
  }, [fetchCount, fetchItems, open]);

  // ── The poll: a backstop for a dropped socket ────────────────────────────
  useEffect(() => {
    fetchCount();
    const iv = setInterval(() => {
      if (document.visibilityState === 'visible') fetchCount();
    }, POLL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') fetchCount(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [fetchCount]);

  useEffect(() => { if (open) fetchItems(); }, [open, fetchItems]);

  useEffect(() => {
    function onOut(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onOut);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOut);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  /**
   * Open the conversation.
   *
   * Marked read first and optimistically, because the navigation unmounts this
   * dropdown — waiting for the round trip would mean updating state on a
   * component that has gone.
   *
   * A conversation with no lead still marks read but has nowhere to navigate.
   * That is a customer whose lead was deleted; the messages are still theirs
   * and the badge should still clear.
   */
  /**
   * Everything that happens locally when a conversation becomes read.
   *
   * One function, called from three places — the dropdown row, the card's Open,
   * and the event the lead's thread fires when it is opened. Three copies of
   * "decrement the count, drop the card, unbold the row" is how they start
   * disagreeing.
   */
  const markReadLocally = useCallback((mobile) => {
    setCards(prev => prev.filter(c => c.mobile !== mobile));
    setItems(prev => prev.map(x => (x.mobile === mobile ? { ...x, is_unread: false } : x)));
    setCount(c => Math.max(0, c - 1));
    lastCount.current = Math.max(0, (lastCount.current ?? 1) - 1);
  }, []);

  function openConversation(row) {
    setOpen(false);
    if (row.is_unread) markReadLocally(row.mobile);
    api('/api/whatsapp/inbox/read', { method: 'POST', body: { mobile: row.mobile } })
      .catch(() => {});
    // No tab to ask for: the lead view carries the WhatsApp thread as a rail
    // that is always on screen, so opening the lead IS opening the conversation.
    if (row.lead_id) navigate('/leads', { state: { openLeadId: row.lead_id } });
  }

  async function markAllRead() {
    setItems(prev => prev.map(x => ({ ...x, is_unread: false })));
    setCount(0);
    lastCount.current = 0;
    try { await api('/api/whatsapp/inbox/read-all', { method: 'POST' }); }
    catch { fetchCount(); }
  }

  /**
   * Clear one row.
   *
   * Removed from the list immediately rather than after the round trip: this is
   * a dismissal, the user has already decided, and a row that sits there for
   * 200ms before vanishing reads as a button that did not work.
   */
  async function clearOne(row) {
    setItems(prev => prev.filter(x => x.mobile !== row.mobile));
    if (row.is_unread) {
      setCount(c => Math.max(0, c - 1));
      lastCount.current = Math.max(0, (lastCount.current ?? 1) - 1);
    }
    try { await api('/api/whatsapp/inbox/dismiss', { method: 'POST', body: { mobile: row.mobile } }); }
    catch { fetchItems(); fetchCount(); }
  }

  async function clearAll() {
    setBusy(true);
    setItems([]);
    setCount(0);
    lastCount.current = 0;
    try { await api('/api/whatsapp/inbox/dismiss-all', { method: 'POST' }); }
    catch { fetchItems(); fetchCount(); }
    setBusy(false);
  }

  /**
   * ✕ on a card. NOT the same as reading it.
   *
   * The card goes; the badge keeps it. Somebody swatting a popup away while
   * they are on the phone has not read the customer's message, and a dismiss
   * that silently cleared the count would lose that customer with no trace.
   * "Not now" is what the ✕ means, and the badge is what remembers.
   *
   * It is recorded in `carded` on the way out, so the same message does not
   * raise the same card again on the next poll — but a NEWER message from that
   * customer still will.
   */
  function dismissCard(card) {
    setCards(prev => prev.filter(c => c.mobile !== card.mobile));
  }

  function openFromCard(card) {
    setCards(prev => prev.filter(c => c.mobile !== card.mobile));
    openConversation(card);
  }

  /**
   * ── Reading the thread from the LEAD ──────────────────────────────────────
   *
   * WhatsAppThread already tells the server. What it could not do was tell this
   * component, sitting in the same tab: the badge stayed stale until the next
   * poll, up to two minutes later. So you would read a customer's message and
   * watch the counter go on claiming they were waiting — read on the server,
   * unread on your screen, which is the worst of both.
   *
   * A window event rather than shared state or a refetch: these two components
   * have no relationship in the tree, the fact is one word long, and a round
   * trip to learn something we already know is a round trip.
   */
  useEffect(() => {
    function onRead(e) {
      const mobile = e.detail?.mobile;
      if (mobile) markReadLocally(mobile);
    }
    window.addEventListener('wa-conversation-read', onRead);
    return () => window.removeEventListener('wa-conversation-read', onRead);
  }, [markReadLocally]);

  const unread = items.filter(r => r.is_unread).length;

  return (
    <>
    <WhatsAppToasts
      cards={cards}
      onOpen={openFromCard}
      onDismiss={dismissCard}
      onExpand={() => { setCards([]); setOpen(true); }}
    />

    <div className="wai-wrap" ref={wrapRef}>
      <button
        className={`wai-btn${count > 0 ? ' wai-btn--live' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="WhatsApp messages"
        aria-label={count > 0 ? `${count} unread WhatsApp conversations` : 'WhatsApp messages'}
      >
        <MessageCircle size={18} />
        {count > 0 && <span className="wai-badge">{count > 99 ? '99+' : count}</span>}
      </button>

      {open && (
        <div className="wai-dropdown" role="dialog" aria-label="WhatsApp conversations">
          <div className="wai-dd-header">
            <span className="wai-dd-title">
              <MessageCircle size={14} /> WhatsApp
              {unread > 0 && <span className="wai-dd-count">{unread}</span>}
            </span>

            {/* Two verbs, presented as two. Read clears the badge and keeps the
                list; Clear empties the list. Both are hidden when there is
                nothing to act on, so the header is not a row of buttons that
                do nothing. */}
            <span className="wai-dd-actions">
              {unread > 0 && (
                <button className="wai-dd-action" onClick={markAllRead} title="Mark every conversation as read">
                  <Check size={12} /> Read all
                </button>
              )}
              {items.length > 0 && (
                <button
                  className="wai-dd-action wai-dd-action--danger"
                  onClick={clearAll}
                  disabled={busy}
                  title="Remove them from this list — nothing is deleted, and they come back if the customer writes again"
                >
                  <Trash2 size={12} /> Clear all
                </button>
              )}
            </span>
          </div>

          <div className="wai-dd-list">
            {items.length === 0 ? (
              <div className="wai-dd-empty">
                <MessageCircle size={22} />
                <strong>Nothing waiting</strong>
                <span>New WhatsApp messages appear here, newest first.</span>
              </div>
            ) : items.map(row => {
              const w = windowState(row.window_expires_at);
              const ini = initials(row.display_name);
              return (
                /* A div, not a button. The Clear control is a real button and a
                   button inside a button is invalid HTML that browsers resolve
                   by dropping one of them — so the row carries the role and the
                   keyboard handling itself. */
                <div
                  key={row.mobile}
                  className={`wai-row${row.is_unread ? ' wai-row--unread' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => openConversation(row)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openConversation(row); }
                  }}
                >
                  <span className={`wai-av${row.is_unread ? ' wai-av--unread' : ''}`}>
                    {ini || <MessageCircle size={13} />}
                  </span>

                  <div className="wai-row-body">
                    <div className="wai-row-top">
                      <span className="wai-who">{row.display_name}</span>
                      <span className="wai-when">{timeAgo(row.last_message_at)}</span>
                    </div>

                    <div className="wai-msg">
                      {/* Whose words these are. Without it a reply an advisor
                          already sent reads as the customer still waiting. */}
                      {row.last_direction === 'out' && <span className="wai-you">You: </span>}
                      {row.last_message || <em>(no text)</em>}
                    </div>

                    <div className="wai-row-foot">
                      <span className={`wai-win wai-win--${w.tone}`}>
                        {w.tone === 'shut' ? <Lock size={9} /> : <Clock size={9} />} {w.label}
                      </span>
                      {/* The unassigned queue, named. These are the leads
                          routing could not place, and they are the whole reason
                          this list is not filtered to "mine". */}
                      {!row.assigned_user_id
                        ? <span className="wai-owner wai-owner--none">Unassigned</span>
                        : <span className="wai-owner">{row.assigned_to_name}</span>}
                    </div>
                  </div>

                  {/* Appears on hover and on keyboard focus — always-on ✕ marks
                      make a list look like a form, and the row's own job is to
                      be clicked. */}
                  <button
                    className="wai-clear"
                    onClick={e => { e.stopPropagation(); clearOne(row); }}
                    title="Clear from this list"
                    aria-label={`Clear ${row.display_name} from this list`}
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>

          {items.length > 0 && (
            <div className="wai-dd-foot">
              Clearing only hides a conversation here. It returns if they message again.
            </div>
          )}
        </div>
      )}
    </div>
    </>
  );
}
