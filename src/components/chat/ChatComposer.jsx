import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Paperclip, Send, X } from 'lucide-react';
import socket from '../../lib/socket.js';
import { api } from '../../api/client.js';
import ChatRecordPicker from './ChatRecordPicker.jsx';

/**
 * ChatComposer — the box you type in.
 *
 * ══ THE DRAFT IS CLEARED ONLY AFTER THE SERVER ACCEPTS IT ══════════════════
 *
 * Copied deliberately from WhatsAppThread.jsx, whose comment says why: a
 * rejected send must not lose what was typed. onSend returns a promise; this
 * clears on resolve and leaves the text alone on reject. It is the difference
 * between "try again" and "type it again".
 */
export default function ChatComposer({
  onSend, disabled, placeholder, conversationId,
  replyTo, onCancelReply, onEditLast,
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [attached, setAttached] = useState(null);   // a record chip, pre-send
  const [picking, setPicking] = useState(false);
  const [pickKind, setPickKind] = useState(null);   // which tab to open on
  /* ── The quick-share row ──────────────────────────────────────────────────
     Sharing a record is the reason this chat exists, and it was two clicks
     behind a paperclip that looks like a file attachment — which is the one
     thing this feature deliberately does NOT do. The kinds are fetched once per
     thread and passed down to the picker, so opening it costs no second request.
     An empty list (somebody with USE_CHAT and no record permissions) renders no
     row at all rather than buttons that open an empty picker. */
  const [kinds, setKinds] = useState([]);

  useEffect(() => {
    let cancelled = false;
    api('/api/chat/records/kinds')
      .then((r) => { if (!cancelled) setKinds(r.items || []); })
      .catch(() => { /* no quick row; the paperclip still works */ });
    return () => { cancelled = true; };
  }, []);
  const ref = useRef(null);
  const lastTyped = useRef(0);

  /* Auto-grow. Reset to auto first or the height only ratchets upward —
     scrollHeight of an element already tall enough never shrinks. The ceiling is
     in the CSS, with the rest of the layout. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';

    /* ── THE PHANTOM SCROLLBAR ────────────────────────────────────────────
       `height = scrollHeight` is the standard auto-grow line and it is off by
       the border under `box-sizing: border-box`: scrollHeight measures the
       CONTENT box, the height property then sets the BORDER box, so the content
       area ends up 2px shorter than its own content. The textarea overflows by
       those 2px and Chrome draws a scrollbar down an EMPTY box, permanently.
       Adding the border delta (offsetHeight − clientHeight) is the fix. */
    const chrome = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + chrome}px`;

    /* And a belt: no scrollbar at all until the box actually hits its ceiling.
       Below the cap there is nothing to scroll to, so the bar is never right —
       CSS alone cannot express "only once you have grown past max-height". */
    const cap = parseFloat(getComputedStyle(el).maxHeight) || Infinity;
    el.style.overflowY = el.scrollHeight > cap ? 'auto' : 'hidden';
  }, [draft, replyTo, attached]);

  // A reply or an attachment should put the cursor where you type.
  useEffect(() => { if (replyTo || attached) ref.current?.focus(); }, [replyTo, attached]);

  /* Typing, throttled to one ping every three seconds.
     The cost of a keystroke must not be a socket event, let alone the query the
     server runs to check membership before relaying it. */
  function ping() {
    if (!conversationId) return;
    const now = Date.now();
    if (now - lastTyped.current < 3000) return;
    lastTyped.current = now;
    try { socket.emit('chat:typing', { conversation_id: conversationId }); }
    catch { /* a socket that is not up is not worth an error */ }
  }

  async function send() {
    const text = draft.trim();
    if ((!text && !attached) || sending || disabled) return;
    setSending(true);
    setErr('');
    try {
      await onSend({
        body: text || undefined,
        ...(attached ? { ref_type: attached.ref_type, ref_id: attached.ref_id } : {}),
        ...(replyTo ? { reply_to_id: replyTo.id } : {}),
      });
      setDraft('');
      setAttached(null);
      onCancelReply?.();
      requestAnimationFrame(() => ref.current?.focus());
    } catch (e) {
      setErr(e?.message || 'Could not send that message.');
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e) {
    /* Enter sends, Shift+Enter is a newline — the convention already in the
       WhatsApp thread, and the one every chat app has trained people into. */
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
      return;
    }
    /* ↑ on an EMPTY box edits your last message. Guarded on empty, because in a
       half-written message ↑ means "move the cursor" and stealing that would be
       maddening. Escape backs out of a reply. */
    if (e.key === 'ArrowUp' && !draft && onEditLast) {
      const prev = onEditLast();
      if (prev) { e.preventDefault(); setDraft(prev); }
      return;
    }
    if (e.key === 'Escape' && replyTo) { e.preventDefault(); onCancelReply?.(); }
  }

  return (
    <div className="ch-composer">
      {err && <div className="ch-composer-err" role="alert">{err}</div>}

      {/* What you are answering. Its own strip above the box, so the quote is
          visible while you write rather than only after you send. */}
      {replyTo && (
        <div className="ch-reply-strip">
          <div className="ch-reply-body">
            <span className="ch-reply-who">{replyTo.sender_name}</span>
            <span className="ch-reply-txt">
              {replyTo.deleted ? <em>Message deleted</em>
                : replyTo.body ? replyTo.body.slice(0, 120)
                : <em>Shared a record</em>}
            </span>
          </div>
          <button type="button" className="ch-modal-x" onClick={onCancelReply}
                  aria-label="Cancel reply"><X size={13} /></button>
        </div>
      )}

      {/* The record already attached, before it is sent. */}
      {attached && (
        <div className="ch-reply-strip ch-reply-strip--ref">
          <div className="ch-reply-body">
            <span className="ch-ref-kind">{attached.noun}</span>
            <span className="ch-reply-txt"><b>{attached.label}</b>{attached.sub ? ` · ${attached.sub}` : ''}</span>
          </div>
          <button type="button" className="ch-modal-x" onClick={() => setAttached(null)}
                  aria-label="Remove the attached record"><X size={13} /></button>
        </div>
      )}

      <div className="ch-composer-row">
        <span className="ch-attach-wrap">
          <button type="button" className="ch-attach"
                  onClick={() => setPicking((p) => !p)}
                  disabled={disabled || sending}
                  title="Attach a record" aria-label="Attach a record"
                  aria-expanded={picking}>
            <Paperclip size={15} />
          </button>
          {picking && (
            <>
              <span className="ch-rx-sheet" onClick={() => setPicking(false)} />
              <ChatRecordPicker
                kinds={kinds.length ? kinds : undefined}
                initialKind={pickKind}
                onClose={() => setPicking(false)}
                onPick={(it) => { setAttached(it); setPicking(false); }}
              />
            </>
          )}
        </span>

        <textarea
          ref={ref}
          className="ch-input"
          rows={1}
          value={draft}
          disabled={disabled || sending}
          placeholder={placeholder || 'Write a message…'}
          onChange={(e) => { setDraft(e.target.value); ping(); }}
          onKeyDown={onKeyDown}
          aria-label="Message"
        />

        <button
          type="button"
          className="ch-send"
          onClick={send}
          disabled={disabled || sending || (!draft.trim() && !attached)}
          title="Send (Enter)"
          aria-label="Send message"
        >
          <Send size={16} />
        </button>
      </div>

      {/* Hidden once something IS attached: the row's whole job is to get you
          there, and leaving it under a chip you have already picked invites a
          second one that would replace the first without saying so. */}
      {kinds.length > 0 && !attached && (
        <div className="ch-quick">
          {kinds.slice(0, 3).map((k) => (
            <button key={k.ref_type} type="button" className="ch-quick-btn"
                    disabled={disabled || sending}
                    onClick={() => { setPickKind(k.ref_type); setPicking(true); }}>
              Share {k.noun}
            </button>
          ))}
          {kinds.length > 3 && (
            <button type="button" className="ch-quick-btn ch-quick-btn--more"
                    disabled={disabled || sending}
                    onClick={() => { setPickKind(null); setPicking(true); }}>
              More <ChevronDown size={11} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
