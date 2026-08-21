import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
// API_URL and getToken, because api() hard-sets Content-Type: application/json
// and JSON.stringify's the body — it cannot post a file. Same raw-fetch escape
// hatch InvoiceThemeSettings already uses for the company logo.
import { api, API_URL, getToken } from '../api/client.js';
import { useCan, useAuth } from '../auth/AuthContext.jsx';
import {
  Send, Loader2, RefreshCw, Check, CheckCheck, Clock, AlertTriangle, MessageCircle,
  // CheckCircle2 / AlertCircle, not the newer CircleCheck / CircleAlert names —
  // LeadsPage already imports these two, so they exist in the lucide version
  // this project is pinned to. The new names would build and then blow up at
  // runtime as undefined components.
  BookOpen, Smile, CheckCircle2, AlertCircle, Bot, User,
  // Both long-standing lucide names, same vintage as the ones above.
  Paperclip, X, Image as ImageIcon, Zap,
} from 'lucide-react';
import WhatsAppSendMenu from './WhatsAppSendMenu.jsx';
// The '/' matcher lives in its own module so it can be tested against the
// inputs nobody types on purpose — a pasted URL, a slash mid-word, a caret
// moved back into finished text. See waShortcut.js.
import { matchShortcut, applyShortcut } from '../utils/waShortcut.js';
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

  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  // Under an hour, minutes alone. "0h 43m" reads like a bug.
  const text = hours > 0 ? `${hours}h ${mins % 60}m` : `${mins}m`;
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
  if (status === 'queued') return <Clock size={12} className="wat-tick" />;
  if (status === 'sent') return <Check size={12} className="wat-tick" />;
  if (status === 'delivered') return <CheckCheck size={12} className="wat-tick" />;
  if (status === 'read') return <CheckCheck size={12} className="wat-tick wat-tick--read" />;
  if (status === 'failed') return <AlertTriangle size={12} className="wat-tick wat-tick--bad" />;
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

  const owner = conv?.assigned_user_name || null;
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
      .catch(() => { });

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

  /* ══ PHOTO REPLIES ═══════════════════════════════════════════════════════
   *
   * The checks below duplicate the server's — 5 MB, JPEG or PNG. That is on
   * purpose and it is not belt-and-braces: without them the advisor waits
   * through the upload of a 12 MB photo to be told it was too big, having
   * spent their patience and the office's bandwidth on a refusal that was
   * knowable before the first byte moved. The server's copy is the RULE; this
   * one is the courtesy.
   */
  /* ══ THE LIBRARY ═════════════════════════════════════════════════════════
   *
   * Images and quick replies an admin configured in Settings. Fetched once per
   * mount rather than on every open: they change when somebody edits Settings,
   * which is rare, and re-fetching on each click would put a spinner between
   * an agent and a canned reply — the one thing a canned reply exists to avoid.
   *
   * Both endpoints return ACTIVE rows only. The server enforces that; this is
   * not filtering a longer list it was given.
   */
  const [library, setLibrary] = useState({ images: [], replies: [], allowUpload: true });
  const [libErr, setLibErr] = useState('');
  const [panel, setPanel] = useState(null);   // 'images' | 'replies' | null

  useEffect(() => {
    if (!canSend) return;
    let alive = true;
    // Each call is caught on its own so one failing does not blank the other
    // two — a broken images endpoint should not also cost the agent their
    // quick replies. `failed` is what makes that visible instead of silent:
    // an empty picker and an unreachable picker look identical otherwise, and
    // only one of them is worth waiting a minute and reopening.
    let failed = false;
    const soft = fallback => e => { failed = true; console.error('[wa-library]', e); return fallback; };
    Promise.all([
      api('/api/whatsapp/images').catch(soft({ items: [] })),
      api('/api/whatsapp/quick-replies').catch(soft({ items: [] })),
      // Whether the paperclip is offered at all. Defaults to ON if the call
      // fails — the button has always been there, and a settings endpoint
      // being briefly unreachable is not a reason to take a working tool away.
      api('/api/whatsapp/library-settings').catch(soft({ allow_local_upload: true })),
    ]).then(([img, qr, cfg]) => {
      if (!alive) return;
      setLibrary({
        images: img.items || [],
        replies: qr.items || [],
        allowUpload: cfg.allow_local_upload !== false,
      });
      if (failed) setLibErr('Some saved items could not be loaded. Reopen the chat to try again.');
    });
    return () => { alive = false; };
  }, [canSend]);

  const [libQ, setLibQ] = useState('');

  /* libErr is deliberately NOT cleared here. It describes the load, not the
     panel — the items are still missing after a close, and wiping the only
     notice of that would leave a short list looking complete. */
  const closePanel = useCallback(() => { setPanel(null); setLibQ(''); }, []);

  /* What the open panel is showing, and what survives the filter.
     A quick reply matches on its title, its shortcut OR its text — somebody
     who remembers the wording but not the name still finds it, and typing the
     '/slug' they know works without a second box to type it in. */
  const libList  = panel === 'images' ? library.images : panel === 'replies' ? library.replies : [];
  const libNeedle = libQ.trim().toLowerCase();
  const libShown = !libNeedle ? libList : libList.filter(it => (
    panel === 'images'
      ? String(it.name || '').toLowerCase().includes(libNeedle)
      : [it.title, it.shortcut, it.message]
          .some(f => String(f || '').toLowerCase().includes(libNeedle))
  ));

  /**
   * A quick reply is INSERTED, never sent.
   *
   * That is the whole safety of the feature. A stock answer is only correct
   * once somebody has confirmed it answers the question that was actually
   * asked — "/location" fired straight at a customer asking about a price is
   * worse than no canned replies at all.
   *
   * Appended to whatever is already typed rather than replacing it: an agent
   * part-way through a sentence who reaches for a stock paragraph means to
   * have both.
   */
  function useQuickReply(qr) {
    setDraft(d => (d.trim() ? `${d.trim()}\n${qr.message}` : qr.message));
    closePanel();
    // Focus and put the caret at the end, so the next keystroke continues the
    // message instead of landing wherever the caret happened to be.
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  /* ══ TYPING '/' IN THE BOX ═══════════════════════════════════════════════
   *
   * The shortcut has to work where an advisor's hands already are. Opening a
   * panel to search for '/test' when they have just typed '/test' is the long
   * way round to the thing they already named.
   *
   * WHICH replies a token offers, and which tokens count at all — the pasted
   * URL, the slash mid-word — is matchShortcut's decision, in waShortcut.js
   * with the tests. What lives here is only what a component owns: what is
   * currently open, which row is highlighted, and what Escape did.
   */
  const [sugg, setSugg] = useState(null);   // { start, end, items, idx }
  // The token they pressed Escape on. Cleared as soon as the token changes, so
  // dismissing '/te' does not also suppress '/test'.
  const dismissed = useRef('');

  const refreshSuggest = useCallback((value, caret) => {
    const r = matchShortcut(library.replies, value, caret);
    if (!r) { setSugg(null); dismissed.current = ''; return; }
    const token = value.slice(r.start, r.end);
    if (dismissed.current === token) { setSugg(null); return; }
    dismissed.current = '';
    setSugg({ ...r, idx: 0 });
  }, [library.replies]);

  /**
   * Accepting replaces the '/token' — it does not append.
   *
   * The slash was an instruction, not part of the message. Leaving it in place
   * and adding the text below would send the customer "/test" followed by the
   * reply, which is the mistake this whole affordance exists to remove.
   */
  function acceptSuggest(qr) {
    if (!sugg) return;
    const { value, caret } = applyShortcut(draft, sugg, qr.message);
    setDraft(value);
    setSugg(null);
    dismissed.current = '';
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  /**
   * Picking a library image reuses the SAME preview sheet as an upload.
   *
   * `pending` carries a `libraryId` instead of a `file`, and sendPhoto branches
   * on which. One preview step, one caption box, one set of states — rather
   * than a second sheet that looks the same and drifts.
   */
  function useLibraryImage(img) {
    setPhotoErr('');
    setPhotoCap('');
    setPending({ libraryId: img.id, url: img.imagekit_url, name: img.name, size: null });
    closePanel();
  }

  const fileInput = useRef(null);
  const [pending, setPending] = useState(null);   // { file, url, name, size }
  const [photoCap, setPhotoCap] = useState('');
  const [photoErr, setPhotoErr] = useState('');
  const [uploading, setUploading] = useState(false);

  const MAX_PHOTO = 5 * 1024 * 1024;
  const OK_PHOTO  = ['image/jpeg', 'image/png'];

  function pickPhoto(e) {
    const f = e.target.files?.[0];
    // Cleared immediately so choosing the SAME file twice still fires a change
    // event. Without this, cancelling a photo and re-picking it does nothing.
    e.target.value = '';
    if (!f) return;

    setPhotoErr('');
    setPhotoCap('');

    if (!OK_PHOTO.includes(f.type)) {
      setPending(null);
      setPhotoErr(`WhatsApp accepts JPG and PNG photos only — that one is ${f.type || 'an unknown type'}.`);
      return;
    }
    if (f.size > MAX_PHOTO) {
      setPending(null);
      setPhotoErr(`That photo is ${(f.size / 1048576).toFixed(1)} MB. The limit is 5 MB.`);
      return;
    }

    // An object URL, not a FileReader data URL: it does not copy the file into
    // a string, so a 5 MB photo costs a handle rather than ~7 MB of base64 in
    // memory. Revoked in closePhoto and when the composer unmounts.
    setPending({ file: f, url: URL.createObjectURL(f), name: f.name, size: f.size });
  }

  /* Only an uploaded file has an object URL to release. A library image's URL
     belongs to ImageKit and revoking it would be meaningless — the `blob:`
     test is what tells the two apart, and it reads the same in both places
     that need to know. */
  const isBlob = u => typeof u === 'string' && u.startsWith('blob:');

  function closePhoto() {
    if (isBlob(pending?.url)) URL.revokeObjectURL(pending.url);
    setPending(null);
    setPhotoCap('');
    setPhotoErr('');
  }

  /**
   * One button, two requests.
   *
   * An UPLOADED photo has to travel as multipart — the bytes exist only in the
   * browser, and the server puts them on ImageKit before WhatsApp can fetch
   * them.
   *
   * A LIBRARY photo is already on ImageKit, so nothing needs uploading and only
   * its row id is sent. The URL is deliberately NOT sent even though the
   * composer knows it: a client that names the address to send is a client that
   * can send any address, which would turn this endpoint into an open relay for
   * arbitrary images over the workshop's number. The server looks the id up in
   * wa_images and refuses anything inactive — so an image an admin switched off
   * a moment ago cannot be sent by a picker that loaded before they did.
   */
  async function sendPhoto() {
    if (!pending || uploading) return;
    setUploading(true);
    setPhotoErr('');
    try {
      const caption = photoCap.trim();

      if (pending.libraryId) {
        await api('/api/whatsapp/messages/reply-image', {
          method: 'POST',
          body: {
            mobile: national,
            image_id: pending.libraryId,
            ...(caption ? { caption } : {}),
          },
        });
      } else {
        const fd = new FormData();
        fd.append('photo', pending.file);
        fd.append('mobile', national);
        if (caption) fd.append('caption', caption);

        const res = await fetch(`${API_URL}/api/whatsapp/messages/reply-media`, {
          method: 'POST',
          // No Content-Type — the browser must set it, including the multipart
          // boundary. Setting it by hand is the classic way this silently fails.
          headers: { Authorization: `Bearer ${getToken()}` },
          body: fd,
        });

        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || 'The photo could not be sent.');
      }

      closePhoto();
      pinned.current = true;
      await load();
    } catch (e) {
      // Kept open with the error showing. Closing would throw away the photo
      // they chose and make them find it again to retry.
      setPhotoErr(e.message || 'The photo could not be sent.');
    }
    setUploading(false);
  }

  // A composer that unmounts mid-preview would leak the object URL.
  useEffect(() => () => { if (isBlob(pending?.url)) URL.revokeObjectURL(pending.url); },
    [pending?.url]);   // eslint-disable-line react-hooks/exhaustive-deps

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
    const b = el.selectionEnd ?? a;
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
          const prev = i > 0 ? (items[i - 1].sent_at || items[i - 1].created_at) : null;
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
                    <span className="wat-tpl wat-tpl--bot"><Bot size={10} /> Interakt Bot flow</span>
                  )}

                  {/* An outbound TEMPLATE says which one it was. A typed reply has
                  no template_key and needs no label. */}
                  {m.direction === 'out' && m.origin !== 'bot' && m.template_key && (
                    <span className="wat-tpl">{m.template_key}</span>
                  )}

                  {/* ── A photo ────────────────────────────────────────
                      The first type branch this thread has ever had; until
                      now every message rendered as text and body_rendered was
                      the whole of it.

                      Guarded on media_url as well as message_type because a
                      row can legitimately be 'image' with the URL not yet
                      written — the send endpoint inserts the row before the
                      upload finishes, so a poll landing in that window would
                      otherwise draw a broken image. It falls through to the
                      text line below, which reads "📷 Photo": true, and what
                      the customer's phone shows a moment later anyway. */}
                  {m.message_type === 'image' && m.media_url && (
                    <a
                      className="wat-photo"
                      href={m.media_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      title="Open the full-size photo"
                    >
                      <img src={m.media_url} alt={m.caption || 'Photo'} loading="lazy" />
                    </a>
                  )}

                  {/* A caption belongs to the photo above it, so it replaces
                      body_rendered rather than joining it — body_rendered on a
                      photo row is the "📷 Photo" fallback written for readers
                      that know nothing about media, and showing both would
                      print the caption twice with an emoji before one copy. */}
                  {m.message_type === 'image' && m.media_url ? (
                    m.caption ? <span className="wat-body wat-cap">{m.caption}</span> : null
                  ) : (
                    <span className="wat-body">
                      {m.body_rendered || <em className="wat-nobody">(no text)</em>}
                    </span>
                  )}

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
                  onChange={e => {
                    setDraft(e.target.value);
                    refreshSuggest(e.target.value, e.target.selectionStart);
                  }}
                  // A click moves the caret without changing the text, so the
                  // token under it changes with no onChange to notice.
                  onClick={e => refreshSuggest(e.target.value, e.target.selectionStart)}
                  onKeyDown={e => {
                    /* The shortcut list owns these keys while it is open, and
                       that includes Enter. An advisor looking at a highlighted
                       suggestion who presses Enter means "that one" — sending
                       the literal "/test" there would be obeying the keyboard
                       and ignoring the person. Escape gets them out, and then
                       Enter sends the slash text as typed. */
                    if (sugg && !panel) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setSugg(s => ({ ...s, idx: (s.idx + 1) % s.items.length }));
                        return;
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setSugg(s => ({ ...s, idx: (s.idx - 1 + s.items.length) % s.items.length }));
                        return;
                      }
                      if (e.key === 'Enter' || e.key === 'Tab') {
                        e.preventDefault();
                        acceptSuggest(sugg.items[sugg.idx]);
                        return;
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        dismissed.current = draft.slice(sugg.start, sugg.end);
                        setSugg(null);
                        return;
                      }
                    }
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

                  {/* Library images. Present even when empty — it opens and
                      says where they come from, which is how somebody finds
                      out the feature exists. A button that appears only once
                      an admin has already used the screen teaches nobody. */}
                  <button
                    type="button"
                    className={panel === 'images' ? 'wat-tool wat-tool--on' : 'wat-tool'}
                    onClick={() => setPanel(p => (p === 'images' ? null : 'images'))}
                    title="Send a saved image"
                    aria-expanded={panel === 'images'}
                    disabled={sending || uploading}
                  >
                    <ImageIcon size={15} />
                  </button>

                  <button
                    type="button"
                    className={panel === 'replies' ? 'wat-tool wat-tool--on' : 'wat-tool'}
                    onClick={() => setPanel(p => (p === 'replies' ? null : 'replies'))}
                    title="Quick replies"
                    aria-expanded={panel === 'replies'}
                    disabled={sending || uploading}
                  >
                    <Zap size={15} />
                  </button>

                  {/* The attach control — a photo from this computer.
                      Hidden entirely, not disabled, when an admin has turned
                      local uploads off: a greyed-out paperclip invites a click
                      and then explains nothing, and the agent cannot fix it
                      anyway. The saved-image button remains, which is the
                      route that setting is steering them to. The server
                      refuses the upload route independently — this only stops
                      offering it. */}
                  {library.allowUpload && (
                    <>
                      <button
                        type="button"
                        className={pending && !pending.libraryId ? 'wat-tool wat-tool--on' : 'wat-tool'}
                        onClick={() => fileInput.current?.click()}
                        title="Attach a photo"
                        disabled={sending || uploading}
                      >
                        <Paperclip size={15} />
                      </button>
                      <input
                        ref={fileInput}
                        type="file"
                        accept="image/jpeg,image/png"
                        hidden
                        onChange={pickPhoto}
                      />
                    </>
                  )}

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

                {/* ── The '/' shortcut list ────────────────────────────────
                    No backdrop, unlike the pickers below. This one is not a
                    mode the advisor entered — they are still typing, and a
                    backdrop that swallowed the next click would make the box
                    they are looking at unclickable. It closes when the token
                    stops matching, which is what carrying on typing does. */}
                {sugg && !panel && (
                  <div className="wat-sugg" role="listbox">
                    {sugg.items.map((qr, i) => (
                      <button
                        key={qr.id}
                        type="button"
                        role="option"
                        aria-selected={i === sugg.idx}
                        className={i === sugg.idx ? 'wat-sugg-i wat-sugg-i--on' : 'wat-sugg-i'}
                        // The textarea must keep focus, or the caret position
                        // acceptSuggest splices at is gone by the time the
                        // click lands.
                        onMouseDown={e => e.preventDefault()}
                        onMouseEnter={() => setSugg(s => ({ ...s, idx: i }))}
                        onClick={() => acceptSuggest(qr)}
                      >
                        <span className="wat-sugg-top">
                          <code>{qr.shortcut}</code>
                          <strong>{qr.title}</strong>
                        </span>
                        <span className="wat-sugg-msg">{qr.message}</span>
                      </button>
                    ))}
                    <div className="wat-sugg-foot">
                      ↑↓ to choose · Enter to insert · Esc to type it as text
                    </div>
                  </div>
                )}

                {/* ── Library pickers ──────────────────────────────────────
                    Same backdrop-and-popover shape as the emoji menu, because
                    they are the same kind of thing: a short list you open,
                    take one item from, and close. */}
                {panel && (
                  <>
                    <div className="wat-emoji-backdrop" onClick={closePanel} />
                    <div className="wat-lib" role="dialog" aria-label={
                      panel === 'images' ? 'Saved images' : 'Quick replies'
                    }>
                      <div className="wat-lib-head">
                        <strong>{panel === 'images' ? 'Saved images' : 'Quick replies'}</strong>
                        <button type="button" className="wat-lib-x" onClick={closePanel} title="Close">
                          <X size={14} />
                        </button>
                      </div>

                      {/* Only once the list is long enough that scanning it
                          costs something. A filter box above four items is
                          furniture. */}
                      {libList.length > 6 && (
                        <input
                          className="wat-lib-find"
                          placeholder={panel === 'images' ? 'Find an image…' : 'Find a reply, or type /shortcut…'}
                          value={libQ}
                          onChange={e => setLibQ(e.target.value)}
                          autoFocus
                        />
                      )}

                      {libErr && (
                        <div className="wat-photo-err">
                          <AlertTriangle size={13} /> <span>{libErr}</span>
                        </div>
                      )}

                      {panel === 'images' ? (
                        libShown.length ? (
                          <div className="wat-lib-grid">
                            {libShown.map(img => (
                              <button
                                key={img.id}
                                type="button"
                                className="wat-lib-img"
                                onClick={() => useLibraryImage(img)}
                                title={img.name}
                              >
                                {/* An image whose URL has stopped resolving
                                    still shows its name and stays pickable —
                                    the send does not depend on this thumbnail
                                    loading, and hiding the row would make a
                                    broken ImageKit link look like a deleted
                                    image. */}
                                <img src={img.imagekit_url} alt="" loading="lazy" />
                                <span>{img.name}</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="wat-lib-empty">
                            {library.images.length
                              ? 'No image matches that.'
                              : 'No images saved yet. An admin adds them in Settings → WhatsApp → Image Library.'}
                          </div>
                        )
                      ) : (
                        libShown.length ? (
                          <div className="wat-lib-list">
                            {libShown.map(qr => (
                              <button
                                key={qr.id}
                                type="button"
                                className="wat-lib-qr"
                                onClick={() => useQuickReply(qr)}
                              >
                                <span className="wat-lib-qr-top">
                                  <strong>{qr.title}</strong>
                                  {qr.shortcut && <code>{qr.shortcut}</code>}
                                </span>
                                <span className="wat-lib-qr-msg">{qr.message}</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="wat-lib-empty">
                            {library.replies.length
                              ? 'No reply matches that.'
                              : 'No quick replies saved yet. An admin adds them in Settings → WhatsApp → Quick Replies.'}
                          </div>
                        )
                      )}

                      {panel === 'replies' && libShown.length > 0 && (
                        <div className="wat-lib-foot">
                          Picking one puts it in the box — nothing is sent until you press Send.
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* A rejected file never opens the sheet — there is nothing to
                  preview — so its reason shows here, by the paperclip that was
                  just pressed. */}
              {photoErr && !pending && (
                <div className="wat-photo-err">
                  <AlertTriangle size={13} /> <span>{photoErr}</span>
                </div>
              )}

              {/* The slash is only mentioned when something would answer it.
                  Advertising a shortcut on an install with none configured
                  teaches an advisor that the feature is broken. */}
              <div className="wat-hint">
                Press Enter to send · Shift + Enter for new line
                {library.replies.some(q => q.shortcut) && ' · Type / for a saved reply'}
              </div>

              {/* ── Preview and caption ───────────────────────────────────
                  The last look before it reaches a customer, and the reason
                  the paperclip does not send immediately. A photo is the one
                  thing in this panel that cannot be unsent or edited, and the
                  cost of picking the wrong one out of a camera roll is a
                  customer seeing somebody else's car.

                  Covers the composer rather than the thread, so the
                  conversation it belongs to stays readable behind it. */}
              {pending && (
                <div className="wat-sheet" role="dialog" aria-modal="true" aria-label="Send photo">
                  <div className="wat-sheet-head">
                    <strong>Send photo</strong>
                    {/* Size only for an upload. A library image's file lives on
                        ImageKit and was never measured here — printing
                        "0.0 MB" beside it would be a made-up number. */}
                    <span className="wat-sheet-file">
                      {pending.name.length > 24 ? pending.name.slice(0, 22) + '…' : pending.name}
                      {pending.libraryId
                        ? ' · from library'
                        : ` · ${(pending.size / 1048576).toFixed(1)} MB`}
                    </span>
                    <button type="button" className="wat-sheet-x" onClick={closePhoto}
                            disabled={uploading} title="Cancel">
                      <X size={15} />
                    </button>
                  </div>

                  {photoErr && (
                    <div className="wat-photo-err">
                      <AlertTriangle size={13} /> <span>{photoErr}</span>
                    </div>
                  )}

                  <div className="wat-sheet-img">
                    <img src={pending.url} alt="Photo to send" />
                  </div>

                  <input
                    className="wat-input wat-sheet-cap"
                    placeholder="Add a caption (optional)"
                    value={photoCap}
                    onChange={e => setPhotoCap(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sendPhoto(); } }}
                    maxLength={1024}
                    disabled={uploading}
                    autoFocus
                  />

                  <div className="wat-sheet-acts">
                    <button type="button" className="wat-sheet-cancel" onClick={closePhoto} disabled={uploading}>
                      Cancel
                    </button>
                    <button type="button" className="wat-sheet-send" onClick={sendPhoto} disabled={uploading}>
                      {uploading
                        ? <><Loader2 size={13} className="spin" /> Sending…</>
                        : <><Send size={13} /> Send photo</>}
                    </button>
                  </div>
                </div>
              )}
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
