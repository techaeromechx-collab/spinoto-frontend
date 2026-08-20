import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, X, Clock, Lock } from 'lucide-react';

/**
 * The cards in the bottom-right corner.
 *
 * ── Why these exist when there is already an OS notification ────────────────
 *
 * Because the operating system owns how long ITS notification lives, and it
 * will not be told. Windows shows a toast for about five seconds and sweeps it
 * into the Action Center; macOS keeps it or does not depending on whether the
 * user picked Banners or Alerts. The Web Notification API has
 * `requireInteraction: true` for exactly this and it is Chrome-desktop only —
 * ignored on macOS, ignored by Firefox, ignored by the Tauri shim in the .exe.
 *
 * So "make the notification wait for me" cannot be asked of the OS. It can be
 * done here, because this is our own element on our own page.
 *
 * ── Two behaviours, and the difference is whose job it is ───────────────────
 *
 *   STICKY        the conversation is yours to answer. The card waits — for
 *                 Open, or for the ✕. Nothing takes it away, because nothing
 *                 else knows whether you have dealt with it.
 *
 *   AUTO (8s)     you are seeing it because you can see everything. A card that
 *                 waited forever for somebody who is not going to answer it is
 *                 not a notification, it is a chore: every conversation in the
 *                 business would queue up in the corner of the owner's screen
 *                 and have to be swept away by hand. It announces itself and
 *                 goes. The badge and the dropdown still hold it.
 *
 * An auto card is PAUSED while the pointer is on it. Otherwise it vanishes in
 * the half second between deciding to click Open and arriving there, which is
 * the single most irritating thing a toast can do.
 *
 * ── And why the OS one is still sent ────────────────────────────────────────
 *
 * A card in the corner of a page you are not looking at is not a notification.
 * The two cover different moments: the OS toast reaches you in Excel, the card
 * waits for you in the CRM. See lib/notify.js — the OS one is raised only when
 * the document is hidden, so a message arriving while you are looking at this
 * screen does not announce itself twice.
 *
 * ── A portal, not a child of the topbar ─────────────────────────────────────
 *
 * The topbar is `overflow: hidden` in places and creates its own stacking
 * context; a fixed-position card inside it gets clipped or sits under the page.
 * Rendered into document.body it is nobody's child and cannot be.
 *
 * Presentational only. WHICH cards exist, and whether each is sticky, is
 * decided by WhatsAppInbox — which already owns the count and the socket. Two
 * components with two ideas about what is unread is how a badge and a card
 * start disagreeing.
 */

/** Same three tones as the dropdown, deliberately: one idea, one look. */
function windowState(expiresAt) {
  if (!expiresAt) return { tone: 'shut', label: 'no reply window' };
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return { tone: 'shut', label: 'window closed' };
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h < 2) return { tone: 'urgent', label: h > 0 ? `${h}h ${m}m left` : `${m}m left` };
  return { tone: 'calm', label: `${h}h left` };
}

// Long enough to read a name and one line, short enough not to be in the way.
const AUTO_MS = 8000;

// Three, then a strip. Eight messages over lunch would otherwise be eight
// stacked cards covering the screen — and a notification that hides the work is
// worse than no notification. Nothing is dropped: the rest are counted on the
// strip, which opens the full list.
const MAX_CARDS = 3;

function Toast({ card, onOpen, onDismiss }) {
  const w = windowState(card.window_expires_at);
  // Paused on hover. A card that disappears as the pointer reaches it is worse
  // than one that never appeared.
  const [paused, setPaused] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (card.sticky || paused) return undefined;
    timer.current = setTimeout(() => onDismiss(card), AUTO_MS);
    return () => clearTimeout(timer.current);
    // `card.mobile` rather than `card`: the object identity changes on every
    // list refetch, and depending on it would restart the countdown each time
    // the poll ran — an auto card that never actually expires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.mobile, card.sticky, paused]);

  return (
    <div
      className={`wat-toast${card.sticky ? '' : ' wat-toast--auto'}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="wat-toast-head">
        <span className="wat-toast-kind"><MessageCircle size={12} /> New WhatsApp message</span>
        <button
          className="wat-toast-x"
          onClick={() => onDismiss(card)}
          title={card.sticky ? 'Not now — this stays in the badge' : 'Dismiss'}
          aria-label="Dismiss"
        >
          <X size={13} />
        </button>
      </div>

      <div className="wat-toast-who">{card.display_name}</div>
      <div className="wat-toast-msg">{card.last_message || <em>(no text)</em>}</div>

      <div className="wat-toast-foot">
        <span className={`wat-toast-win wat-toast-win--${w.tone}`}>
          {w.tone === 'shut' ? <Lock size={9} /> : <Clock size={9} />} {w.label}
        </span>

        <span className="wat-toast-foot-r">
          {/* Whose it is, but only on a card that is NOT yours. On your own
              conversation it would be your own name on every card. */}
          {!card.sticky && (
            <span className="wat-toast-owner">
              {card.assigned_to_name || 'Unassigned'}
            </span>
          )}
          <button className="wat-toast-open" onClick={() => onOpen(card)}>Open</button>
        </span>
      </div>

      {/* The draining line. Only on an auto card, and it is the only thing that
          says this one will leave by itself — without it, a card that vanishes
          looks like a glitch. Paused with the timer, so the bar and the
          behaviour never disagree. */}
      {!card.sticky && (
        <span
          className="wat-toast-bar"
          style={{ animationDuration: `${AUTO_MS}ms`, animationPlayState: paused ? 'paused' : 'running' }}
        />
      )}
    </div>
  );
}

export default function WhatsAppToasts({ cards, onOpen, onDismiss, onExpand }) {
  if (!cards.length) return null;

  const shown  = cards.slice(0, MAX_CARDS);
  const hidden = cards.length - shown.length;

  return createPortal(
    <div className="wat-toasts" role="region" aria-label="New WhatsApp messages">
      {hidden > 0 && (
        <button className="wat-toast-more" onClick={onExpand}>
          <MessageCircle size={12} /> +{hidden} more waiting
        </button>
      )}

      {/* Reversed so the newest sits at the BOTTOM, closest to the corner and
          nearest the pointer. Stacking downward would push the newest card
          furthest from where you are looking. */}
      {[...shown].reverse().map(card => (
        <Toast key={card.mobile} card={card} onOpen={onOpen} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body
  );
}
