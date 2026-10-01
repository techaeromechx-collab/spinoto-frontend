import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, Users, AtSign, FileText, X } from 'lucide-react';

/**
 * ChatToasts — the cards in the bottom-right corner for internal chat.
 *
 * ══ WHY THIS IS NOT WhatsAppToasts ═════════════════════════════════════════
 *
 * Both sit in the same corner, and that is deliberate: two notification stacks
 * in two different places is two things to learn. What separates them is the
 * SHAPE. A WhatsApp card is square-cornered with a hard green bar down its left
 * edge. This is a rounded bubble with a tail — it looks like a chat message,
 * because it is one. Colour alone would have been a weak signal: you would have
 * to look at it and think. A silhouette is recognised before it is read.
 *
 * ══ ONE DOT CARRIES THE WHOLE STATE ════════════════════════════════════════
 *
 *   INDIGO   a direct message. Somebody is talking to you and nobody else, so
 *            the card WAITS — for Open, or for the ✕. Nothing takes it away,
 *            because nothing else knows whether you have dealt with it.
 *
 *   AMBER    a group. It announces itself and goes in 8s, with a thin line
 *            draining along the bottom so the leaving does not look like a
 *            glitch. Without this a busy "Workshop floor" buries the corner of
 *            the screen by lunchtime and every card has to be swept away by
 *            hand — which is not a notification, it is a chore. The badge and
 *            the dropdown still hold it.
 *
 *   ROSE     you were named. Ready, and nothing triggers it yet: the chat has
 *            no @mentions today (no `mention` anywhere in chat.routes.js or the
 *            chat components). The card takes a `mention` flag so the day that
 *            lands, this file does not need reopening. It behaves like a direct
 *            message — being named makes it yours — and says so.
 *
 * An amber card is PAUSED while the pointer is on it. Otherwise it vanishes in
 * the half second between deciding to click Open and arriving there, which is
 * the single most irritating thing a toast can do.
 */

const AUTO_MS   = 8000;
const MAX_CARDS = 3;

function Card({ card, onOpen, onDismiss }) {
  const auto = card.tone === 'auto';
  const [paused, setPaused] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (!auto || paused) return undefined;
    timer.current = setTimeout(() => onDismiss(card), AUTO_MS);
    return () => clearTimeout(timer.current);
    /* `card.key` rather than `card`: the object identity changes on every list
       refetch, and depending on it would restart the countdown each time the
       poll ran — an auto card that never actually expires. Same trap the
       WhatsApp one documents on card.mobile. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.key, auto, paused]);

  const Icon = card.tone === 'ping' ? AtSign : card.group ? Users : MessageSquare;

  return (
    <div
      className={`cht${auto ? ' cht--auto' : ''}${card.tone === 'ping' ? ' cht--ping' : ''}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="cht-k">
        <span className="cht-dot" />
        <Icon size={11} className="cht-ic" />
        <b>{card.label}</b>
        <small>{card.time}</small>
        <button type="button" className="cht-x" onClick={() => onDismiss(card)}
                title={auto ? 'Dismiss' : 'Not now — this stays in the badge'}
                aria-label="Dismiss">
          <X size={12} />
        </button>
      </div>

      <div className="cht-row">
        <span className="cht-av">{card.initials}</span>
        <div className="cht-t">
          <b>{card.who}</b>
          <p>{card.msg}</p>
          {/* `has_ref` is a boolean on the conversation row — the list carries
              no label for what was shared, so the chip says what it honestly
              knows. Naming the record would mean widening LAST_MESSAGE_SQL. */}
          {card.hasRef && (
            <span className="cht-chip"><FileText size={11} /> Shared a record</span>
          )}
        </div>
      </div>

      <div className="cht-f">
        <span className="cht-meta">{card.meta}</span>
        <button type="button" className="cht-o" onClick={() => onOpen(card)}>Open</button>
      </div>

      {/* The draining line. Only on an auto card, and it is the only thing that
          says this one will leave by itself. Paused with the timer, so the bar
          and the behaviour can never disagree. */}
      {auto && (
        <span className="cht-bar"
              style={{ animationDuration: `${AUTO_MS}ms`,
                       animationPlayState: paused ? 'paused' : 'running' }} />
      )}
    </div>
  );
}

export default function ChatToasts({ cards, onOpen, onDismiss, onExpand }) {
  if (!cards.length) return null;

  const shown  = cards.slice(0, MAX_CARDS);
  const hidden = cards.length - shown.length;

  return createPortal(
    <div className="cht-stack" role="region" aria-label="New chat messages">
      {hidden > 0 && (
        <button type="button" className="cht-more" onClick={onExpand}>
          <MessageSquare size={12} /> +{hidden} more waiting
        </button>
      )}

      {/* Reversed so the newest sits at the BOTTOM, closest to the corner and
          nearest the pointer — stacking downward would push the newest card
          furthest from where the eye already is. */}
      {[...shown].reverse().map(card => (
        <Card key={card.key} card={card} onOpen={onOpen} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body
  );
}
