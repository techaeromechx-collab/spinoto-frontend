import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { api } from '../api/client.js';
import { useCan, useAuth } from '../auth/AuthContext.jsx';
import {
  Send, Loader2, RefreshCw, Check, CheckCheck, Clock, AlertTriangle, MessageCircle,
  // CheckCircle2 / AlertCircle, not the newer CircleCheck / CircleAlert names —
  // LeadsPage already imports these two, so they exist in the lucide version
  // this project is pinned to. The new names would build and then blow up at
  // runtime as undefined components.
  BookOpen, Smile, CheckCircle2, AlertCircle, Bot, User,
} from 'lucide-react';
import WhatsAppSendMenu from './WhatsAppSendMenu.jsx';
import '../styles/WhatsAppThread.css';

/**
 * WhatsAppThread — the conversation with one phone number.
 *
 * ── Why this is not WhatsAppMessages.jsx ─────────────────────────────────────
 *
 * That component answers "what did we send about THIS record" — a list of
 * template sends for one invoice or one appointment, with a preview-then-send
 * flow. Correct for a document.
 *
 * A conversation is a different thing. It is keyed by the PERSON, not the
 * record: one continuous exchange that happens to touch a lead, then an
 * estimate, then an invoice. Rendering it per-entity would show three unrelated
 * fragments, none of which is the conversation. So this is keyed by `mobile`
 * and reads /messages/thread.
 *
 * It also solves the customer case for free. customer_profiles has no integer
 * id — it is keyed by mobile — so ('customer', id) was never expressible in
 * wa_messages' polymorphic columns. A number is the key that always exists.
 *
 *   <WhatsAppThread mobile={lead.whatsapp || lead.mobile} />
 *
 * ── The 24-hour window is the whole reason the composer has two states ───────
 *
 * WhatsApp permits a free-typed message only within 24 hours of the customer's
 * last one. Outside it, only approved templates may be sent. The server owns
 * that rule (wa_conversations.window_expires_at) and returns window_open; this
 * component only renders what it is told, because a second implementation of
 * that rule in the browser would be a second rule.
 */

/**
 * Can this number actually receive WhatsApp?
 *
 * The same rule as backend utils/phone.js toNational — strip everything that is
 * not a digit, drop a 91 country code or a 0 trunk prefix, and require a real
 * Indian mobile.
 *
 * Checked HERE, before fetching, because leads.mobile is free text with no
 * validation: '0971230157', 'NA', a landline and an 8-digit typo are all in
 * there. Without this the panel fires a request the server answers 400 to and
 * then shows a red "Could not load the conversation" on a lead whose only
 * problem is a bad number typed months ago — an error where the honest answer
 * is "this number cannot be messaged".
 */
function messageable(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

/** Just the clock. The day now lives in the separator above the bubble. */
function when(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

/** Local calendar day, as a key two timestamps can be compared on. */
function dayKey(v) {
  const d = new Date(v);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * The label on a day separator.
 *
 * The year appears ONLY when it is not the current one. A thread that jumps
 * March → August is exactly what the closed-lead rule creates, and "18 March"
 * with no year is ambiguous the moment a customer has messaged in two different
 * years — which for a service business is most of them.
 *
 * Today/Yesterday because that is what the advisor's own WhatsApp says, and a
 * date where they expect a word makes them do arithmetic.
 */
function dayLabel(v) {
  const d = new Date(v);
  if (isNaN(d)) return '';

  const now = new Date();
  const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(d)) / 86400000);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';

  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/**
 * How much of the 24-hour window is left, as a person would say it.
 *
 * The panel already said "Can reply" / "Reply window closed", which answers
 * whether but not how long. "Expires in 20h 15m" is the difference between
 * knowing you may reply and knowing you should reply now — and the whole reason
 * the window matters is that it runs out while nobody is looking at it.
 *
 * Deliberately NOT recomputed from a stored countdown: the server sends an
 * absolute window_expires_at and this reads the clock. A ticking number held in
 * state drifts when the tab is backgrounded, and drifts in the direction that
 * makes a closed window look open.
 */
function timeLeft(expiresAt, now) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now;
  if (isNaN(ms)) return null;
  if (ms <= 0) return { expired: true, text: 'Reply window closed' };

  const mins  = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  // Under an hour, minutes alone. "0h 43m" reads like a bug.
  const text  = hours > 0 ? `${hours}h ${mins % 60}m` : `${mins}m`;
  return { expired: false, text, urgent: mins <= 60 };
}

/* A small, fixed set rather than a picker library. An advisor typing a reply
   wants a thumbs up and a smile, not a searchable index of 3,600 glyphs — and
   the library that provides the index is heavier than this whole panel. */
const EMOJI = [
  '🙏', '👍', '👌', '🙂', '😊', '😀', '😅', '🤝',
  '✅', '❌', '⏰', '📅', '📞', '🚗', '🔧', '🧾',
  '💰', '📍', '🎉', '❤️', '🙌', '😢', '😐', '🤔',
];

/**
 * The WhatsApp glyph.
 *
 * Inline rather than from lucide, which carries no brand marks — its
 * MessageCircle was standing in for this, and a generic speech bubble on a panel
 * whose entire purpose is one specific channel makes the advisor read the label
 * to know what they are looking at.
 *
 * currentColor so it inherits whatever it sits on.
 */
function WaMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

/* +919712301573 is a string to parse; +91 97123 01573 is a phone number to
   read aloud, which is what someone about to dial it is doing. */
function prettyNumber(national) {
  return national ? `+91 ${national.slice(0, 5)} ${national.slice(5)}` : '';
}

/** WhatsApp's own vocabulary — one tick, two ticks, blue ticks. */
function Ticks({ status }) {
  if (status === 'queued')    return <Clock size={12} className="wat-tick" />;
  if (status === 'sent')      return <Check size={12} className="wat-tick" />;
  if (status === 'delivered') return <CheckCheck size={12} className="wat-tick" />;
  if (status === 'read')      return <CheckCheck size={12} className="wat-tick wat-tick--read" />;
  if (status === 'failed')    return <AlertTriangle size={12} className="wat-tick wat-tick--bad" />;
  return null;
}

/**
 * @param entityType/entityId  Which record the "Send a template" button in the
 *   closed bar should send AGAINST. The Lead page passes its own lead, because
 *   it has one in hand and should not wait on a round trip to learn it. The
 *   Customer page passes nothing: customer_profiles has no integer id, so there
 *   is no ('customer', id) to pass — the conversation's resolved lead is used
 *   instead, which is the same lead the Lead page would have passed anyway.
 */
export default function WhatsAppThread({ mobile, onLeadResolved, entityType = 'lead', entityId = null }) {
  const canSend = useCan('SEND_WHATSAPP');
  // The read bookmark is behind the same permission as the thread itself
  // (canRead in routes/whatsapp.routes.js). Someone who can only SEND still
  // counts — they can open the panel, so they can have seen it.
  const canReadWa = useCan('SEND_WHATSAPP', 'VIEW_WHATSAPP_LOGS');
  const { user: me } = useAuth();

  const [items, setItems] = useState([]);
  const [conv, setConv] = useState(null);
  const [windowOpen, setWindowOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // A template was just queued from the closed bar. Purely a UI acknowledgement:
  // it does NOT mean the window reopened, because sending a template does not
  // reopen it — only the customer answering does. Saying otherwise would be the
  // one lie this panel must not tell, since the next thing the advisor does is
  // try to type.
  const [templateSent, setTemplateSent] = useState(false);

  // Which half of the composer is showing. Templates is a permanent tab now,
  // not something that only appears once the window has shut — you send an
  // invoice or an appointment confirmation mid-conversation all the time, and
  // having to wait 24 hours for the control to appear was backwards.
  const [tab, setTab] = useState('reply');
  const [emojiOpen, setEmojiOpen] = useState(false);

  // Drives the countdown. A clock, not a decrementing number: see timeLeft().
  const [now, setNow] = useState(() => Date.now());

  const inputRef = useRef(null);

  const scroller = useRef(null);
  // Only auto-scroll when the user is already at the bottom. Yanking them down
  // while they are reading an older message is worse than not scrolling.
  const pinned = useRef(true);

  // Normalised once. null means "not a number WhatsApp can reach", and every
  // fetch below is gated on it.
  const national = messageable(mobile);

  // The record the template button sends against: what the page handed us, else
  // the lead this conversation already resolved to. Null on both counts means no
  // button — a template send needs a record to pull its values from, and
  // offering one that cannot work is worse than not offering it.
  const tplEntityId = entityId ?? conv?.lead_id ?? null;

  const owner     = conv?.assigned_user_name || null;
  const ownerIsMe = owner != null && Number(conv?.assigned_user_id) === Number(me?.id);

  // Recomputed on every render against `now`, which ticks every 30s.
  const left = timeLeft(conv?.window_expires_at, now);

  /**
   * Is the window open RIGHT NOW — not "was it open when the server answered".
   *
   * windowOpen is a snapshot taken at fetch time. Leave a lead detail open over
   * lunch and it stays true long after the window shut: the badge would still
   * say "Can reply", the composer would still accept typing, and the send would
   * fail at Interakt with nothing on screen having warned anybody.
   *
   * The countdown already reads the clock. Everything that depends on open/shut
   * reads the same answer, so the badge, the tabs and the composer cannot
   * disagree with the number sitting between them.
   */
  const open = windowOpen && !(left && left.expired);

  const load = useCallback(async () => {
    if (!national) { setLoading(false); return; }
    try {
      const r = await api(`/api/whatsapp/messages/thread?mobile=${encodeURIComponent(national)}`);
      setItems(r.items || []);
      setConv(r.conversation || null);
      setWindowOpen(r.window_open === true);
      setErr(null);
      if (r.conversation?.lead_id && onLeadResolved) onLeadResolved(r.conversation.lead_id);
    } catch (e) {
      setErr(e.message || 'Could not load the conversation.');
    }
    setLoading(false);
  }, [national, onLeadResolved]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // ── The conversation has been seen ───────────────────────────────────────
  //
  // This panel is the ONLY place a WhatsApp conversation is read, so this is
  // the only honest place to clear its unread mark. Doing it from the topbar
  // dropdown alone would mean a conversation opened from the lead itself — the
  // usual way — stayed bold forever.
  //
  // Per-user (migration 163), so an admin reading somebody else's thread does
  // not clear the advisor's badge.
  //
  // Fire-and-forget, and errors swallowed on purpose: the thread is loaded and
  // readable, and an error banner over a failed bookmark would be alarming
  // about nothing. It also does not refire on every poll — `national` is the
  // only dependency, so it runs when the panel opens on a new number.
  //
  // Gated on the permission, not merely wrapped in a catch. A user without it
  // gets a 403 here on every lead they open — invisible to them, a console full
  // of red to whoever is debugging, and pointing at the wrong thing entirely.
  useEffect(() => {
    if (!national || !canReadWa) return;
    api('/api/whatsapp/inbox/read', { method: 'POST', body: { mobile: national } })
      .catch(() => {});

    // ── …and tell this tab ─────────────────────────────────────────────────
    //
    // The line above tells the SERVER. Nothing told the topbar sitting six
    // inches up the same page, so the badge stayed stale until its next poll —
    // up to two minutes of watching a counter insist a customer is waiting
    // whose message you are reading.
    //
    // Fired unconditionally, not only when it was unread: this component does
    // not know whether it was, and the listener treats it as idempotent.
    window.dispatchEvent(new CustomEvent('wa-conversation-read', {
      detail: { mobile: national },
    }));
  }, [national, canReadWa]);

  // Once they answer, the acknowledgement has done its job and the composer is
  // back — leaving "waiting for their reply" above a working reply box would be
  // stale text contradicting the thing next to it.
  useEffect(() => { if (open) setTemplateSent(false); }, [open]);

  // 30s, not 1s. The label is "20h 15m" — it changes once a minute at most, and
  // a per-second timer on a panel that is open all day is a wasted wakeup every
  // second for a number that did not move.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // Land on the tab that can actually do something. Arriving on a dead reply
  // box when the only way to reach this customer is a template is one wasted
  // click every single time.
  useEffect(() => {
    if (!loading) setTab(open ? 'reply' : 'templates');
  }, [open, loading]);

  useEffect(() => {
    if (pinned.current && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [items]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await api('/api/whatsapp/messages/reply', {
        method: 'POST',
        body: { mobile: national, message: text },
      });
      // Cleared only after the server accepted it. Clearing optimistically
      // loses what the advisor typed on the one path where they most need it
      // back — a rejected send.
      setDraft('');
      pinned.current = true;
      await load();
    } catch (e) {
      setErr(e.message || 'Could not send the reply.');
    }
    setSending(false);
  }

  /**
   * At the caret, not appended.
   *
   * Appending is only right when the caret happens to be at the end — which it
   * is not the moment somebody goes back to fix a word, and then the emoji
   * lands in a place they were not looking at.
   */
  function insertEmoji(ch) {
    const el = inputRef.current;
    if (!el) { setDraft(d => d + ch); setEmojiOpen(false); return; }

    const a = el.selectionStart ?? draft.length;
    const b = el.selectionEnd   ?? a;
    setDraft(draft.slice(0, a) + ch + draft.slice(b));
    setEmojiOpen(false);

    // After React has written the new value, or setSelectionRange runs against
    // the old text and the caret jumps.
    requestAnimationFrame(() => {
      el.focus();
      const at = a + ch.length;
      el.setSelectionRange(at, at);
    });
  }

  // Two different situations, two different sentences. "No number" is a blank
  // field; "not messageable" is a number that exists and cannot be used — and
  // telling someone their customer has no phone number when the record plainly
  // shows one is how a screen loses trust.
  if (!mobile) {
    return <div className="wat-empty">This record has no phone number.</div>;
  }
  if (!national) {
    return (
      <div className="wat-empty wat-empty--bad">
        <span><strong>{mobile}</strong> is not a WhatsApp-capable mobile number.</span>
        <span>Correct it on the record to start a conversation.</span>
      </div>
    );
  }

  return (
    <div className="wat">
      {/* ── Header ───────────────────────────────────────────────────────────
          Who, on which channel, and whether you may type — in that order,
          because that is the order the questions are asked. The number moves
          under the name instead of replacing it: an advisor about to phone
          someone should not have to open the Edit dialog to see it. */}
      <div className="wat-head">
        <span className="wat-head-who">
          <span className="wat-avatar" title="WhatsApp"><WaMark size={15} /></span>
          <span className="wat-head-id">
            <strong>{conv?.customer_name || prettyNumber(national)}</strong>
            {conv?.customer_name && <em>{prettyNumber(national)}</em>}
          </span>
        </span>
        <span className="wat-head-right">
          {/* Whose customer this is.
              Named rather than implied: an advisor who cannot see that Ramesh
              already has this conversation will answer it too, and the customer
              gets two different replies from the same business. Highlighted
              when it is you, because "mine" and "somebody else's" are different
              decisions. */}
          {owner && (
            <span className={`wat-owner${ownerIsMe ? ' wat-owner--me' : ''}`} title={`Assigned to ${owner}`}>
              <User size={11} /> {ownerIsMe ? 'You' : owner}
            </span>
          )}
          {conv?.last_inbound_at && (
            <span className={`wat-win ${open ? 'wat-win--open' : 'wat-win--shut'}`}>
              {open ? 'Can reply' : 'Reply window closed'}
            </span>
          )}
          {/* Spins while it is actually loading. Pressing refresh and seeing
              nothing move is how people press it four more times. */}
          <button className="wat-icon" onClick={load} title="Refresh" disabled={loading}>
            {loading ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
          </button>
        </span>
      </div>

      <div className="wat-scroll" ref={scroller} onScroll={onScroll}>
        {loading && <div className="wat-empty"><Loader2 size={14} className="spin" /> Loading…</div>}

        {!loading && !items.length && (
          <div className="wat-empty">No WhatsApp messages with this number yet.</div>
        )}

        {items.map((m, i) => {
          // A separator whenever the calendar day changes — and before the
          // first message, so the top of the thread is dated too.
          const stamp = m.sent_at || m.created_at;
          const prev  = i > 0 ? (items[i - 1].sent_at || items[i - 1].created_at) : null;
          const newDay = dayKey(stamp) && dayKey(stamp) !== dayKey(prev);

          return (
          <Fragment key={m.id}>
          {newDay && (
            <div className="wat-daysep"><span>{dayLabel(stamp)}</span></div>
          )}
          <div className={`wat-row wat-row--${m.direction === 'in' ? 'in' : 'out'}`}>
            <div className={`wat-bubble${m.origin === 'bot' ? ' wat-bubble--bot' : ''}`}>
              {/* Three kinds of outbound message, three different things worth
                  saying about them. A workflow message must be labelled hardest:
                  it is on the right-hand side in green like everything a human
                  colleague sent, and mistaking "What do you need help with?" for
                  something an advisor typed changes how you read every answer
                  underneath it. */}
              {m.origin === 'bot' && (
                <span className="wat-tpl wat-tpl--bot"><Bot size={10} /> Interakt flow</span>
              )}

              {/* An outbound TEMPLATE says which one it was. A typed reply has
                  no template_key and needs no label. */}
              {m.direction === 'out' && m.origin !== 'bot' && m.template_key && (
                <span className="wat-tpl">{m.template_key}</span>
              )}

              <span className="wat-body">
                {m.body_rendered || <em className="wat-nobody">(no text)</em>}
              </span>

              <span className="wat-meta">
                {when(m.sent_at || m.created_at)}
                {m.direction === 'out' && <Ticks status={m.status} />}
              </span>

              {m.direction === 'out' && m.status === 'failed' && (
                <span className="wat-err">{m.error_message || m.error_code || 'Failed'}</span>
              )}
            </div>
          </div>
          </Fragment>
          );
        })}
      </div>

      {err && <div className="wat-alert">{err}</div>}

      {/* ── The window, as a countdown ───────────────────────────────────────
          The badge in the header says whether. This says how long, which is the
          part that decides what you do next: 20 hours is "reply when you have
          the answer", 20 minutes is "reply now or it costs a template".

          Sits on the wallpaper rather than in the white composer, so it reads
          as a fact about the conversation and not a control. */}
      {canSend && conv?.window_expires_at && left && (
        <div className="wat-status">
          <span className={`wat-status-pill${left.expired ? ' wat-status-pill--shut' : ''}${left.urgent ? ' wat-status-pill--soon' : ''}`}>
            {left.expired
              ? <><AlertCircle size={12} /> Conversation closed · they must message again</>
              : <><CheckCircle2 size={12} /> Conversation open · Expires in {left.text}</>}
          </span>
        </div>
      )}

      {/* ── Composer ─────────────────────────────────────────────────────────
          Two tabs, both always present. Templates used to appear only once the
          24 hours had run out, which had it backwards: sending an invoice or an
          appointment confirmation mid-conversation is the common case, and
          waiting a day for the control to show up is not a feature. */}
      {canSend && (
        <div className="wat-panel">
          <div className="wat-tabs">
            <button
              className={tab === 'reply' ? 'on' : ''}
              onClick={() => setTab('reply')}
            >
              <MessageCircle size={13} /> Reply
            </button>
            <button
              className={tab === 'templates' ? 'on' : ''}
              onClick={() => setTab('templates')}
            >
              <BookOpen size={13} /> Templates
            </button>
          </div>

          {tab === 'reply' && open && (
            <div className="wat-reply">
              <div className="wat-inputwrap">
                <textarea
                  ref={inputRef}
                  className="wat-input"
                  rows={2}
                  placeholder="Type a reply…"
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    // Enter sends, Shift+Enter is a newline — the convention
                    // every messaging app uses, and the one an advisor's hands
                    // expect.
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                  }}
                  disabled={sending}
                />

                <div className="wat-tools">
                  <button
                    type="button"
                    className={emojiOpen ? 'wat-tool wat-tool--on' : 'wat-tool'}
                    onClick={() => setEmojiOpen(v => !v)}
                    title="Emoji"
                    aria-expanded={emojiOpen}
                  >
                    <Smile size={15} />
                  </button>

                  <button
                    className="wat-send"
                    onClick={send}
                    disabled={sending || !draft.trim()}
                    title="Send"
                  >
                    {sending ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
                  </button>
                </div>

                {emojiOpen && (
                  <>
                    {/* Catches the dismissing click so it cannot also press
                        whatever is underneath. */}
                    <div className="wat-emoji-backdrop" onClick={() => setEmojiOpen(false)} />
                    <div className="wat-emoji" role="menu">
                      {EMOJI.map(e => (
                        <button key={e} type="button" onClick={() => insertEmoji(e)}>{e}</button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="wat-hint">Press Enter to send · Shift + Enter for new line</div>
            </div>
          )}

          {/* The reply tab with the window shut. Not a disabled textarea: a box
              you can type into and never send from is worse than no box. */}
          {tab === 'reply' && !open && (
            <div className="wat-closed">
              <div className="wat-closed-txt">
                WhatsApp only allows a free-typed message within <strong>24 hours</strong> of the
                customer’s last message.
                {tplEntityId
                  ? ' Use the Templates tab to reach them.'
                  : ' Only an approved template can reach them now.'}
              </div>
              {tplEntityId && (
                <button type="button" className="wat-golink" onClick={() => setTab('templates')}>
                  <BookOpen size={13} /> Open Templates
                </button>
              )}
            </div>
          )}

          {tab === 'templates' && (
            <div className="wat-tplpane">
              {tplEntityId ? (
                <>
                  <WhatsAppSendMenu
                    entityType={entityType}
                    entityId={tplEntityId}
                    inline
                    onSent={() => { setTemplateSent(true); load(); }}
                  />
                  {templateSent && (
                    <div className="wat-waiting">
                      <Clock size={11} /> Template queued.
                      {!open && ' The reply box returns as soon as they answer — press refresh to check.'}
                    </div>
                  )}
                </>
              ) : (
                <div className="wat-tplpane-empty">
                  No lead is linked to this number yet, so there is no record to build a
                  template from. It appears as soon as they send a message.
                </div>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
