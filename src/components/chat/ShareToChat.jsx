import { useEffect, useState } from 'react';
import { Check, Search, Send, Share2, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useEscapeClose } from '../../hooks/useEscapeClose.js';
import { useDebouncedSearch, useAbortController, isAbortError }
  from '../../hooks/useDebouncedSearch.js';
import '../../styles/chatShared.css';

/**
 * ShareToChat — "send this record to a colleague", droppable into any record
 * header.
 *
 * Usage:
 *   <ShareToChat refType="job_card" refId={card.id} label={card.job_card_no} />
 *
 * ══ WHAT IT SENDS ══════════════════════════════════════════════════════════
 *
 * (ref_type, ref_id) and whatever the sender typed. NOT the record: no label, no
 * customer name, no amount, no plate, no phone number crosses into the message.
 * `label` is used only for the confirmation text on this screen, so the sender
 * can see what they are about to share — it is never transmitted.
 *
 * That is why the recipient seeing it is a separate decision, made per viewer
 * when the chip renders (chatRefs.service.js). Sharing a record with somebody
 * who cannot open it is allowed and harmless: they get "you don't have access",
 * which is a useful thing for them to learn.
 *
 * ══ IT RENDERS NOTHING WITHOUT USE_CHAT ════════════════════════════════════
 *
 * A button that opens a dialog and then 403s is worse than no button. Same
 * single code the route, the nav item and the badge use.
 */
export default function ShareToChat({ refType, refId, label, compact = false }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);

  if (!can('USE_CHAT') || !refType || !refId) return null;

  return (
    <>
      <button
        type="button"
        className={`ch-share-btn${compact ? ' ch-share-btn--compact' : ''}`}
        onClick={() => setOpen(true)}
        title="Send to a colleague on chat"
      >
        <Share2 size={compact ? 13 : 14} />
        {!compact && <span>Share</span>}
      </button>
      {open && (
        <ShareDialog
          refType={refType}
          refId={refId}
          label={label}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ShareDialog({ refType, refId, label, onClose }) {
  const [people, setPeople] = useState([]);
  const [picked, setPicked] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  const { input, setInput, search } = useDebouncedSearch('');
  const signal = useAbortController();

  useEscapeClose(onClose);

  useEffect(() => {
    (async () => {
      try {
        const q = search ? `?q=${encodeURIComponent(search)}` : '';
        const r = await api(`/api/chat/directory${q}`, { signal: signal() });
        setPeople(r.items);
      } catch (e) {
        if (!isAbortError(e)) setErr(e?.message || 'Could not load the staff list.');
      }
    })();
  }, [search, signal]);

  const noun = String(refType).replace(/_/g, ' ');

  async function send() {
    if (!picked || busy) return;
    setBusy(true);
    setErr('');
    try {
      /* Two calls, and the first is idempotent: creating a direct conversation
         with somebody you already have one with returns the existing id (dm_key),
         so sharing twice does not make a second thread. */
      const conv = await api('/api/chat/conversations', {
        method: 'POST', body: { user_ids: [picked.id] },
      });
      await api(`/api/chat/conversations/${conv.id}/messages`, {
        method: 'POST',
        body: {
          ...(note.trim() ? { body: note.trim() } : {}),
          ref_type: refType,
          ref_id: refId,
        },
      });
      setDone(true);
      // Long enough to read the confirmation, short enough not to be in the way.
      setTimeout(onClose, 1400);
    } catch (e) {
      setErr(e?.message || 'Could not share that.');
      setBusy(false);
    }
  }

  return (
    <div className="ch-modal-wrap" role="dialog" aria-modal="true" aria-label={`Share this ${noun}`}>
      <div className="ch-modal-backdrop" />
      <div className="ch-modal ch-modal--share">
        <header className="ch-modal-head">
          <h3>Share this {noun}</h3>
          <button type="button" className="ch-modal-x" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        {done ? (
          <div className="ch-share-done">
            <Check size={18} />
            <span>Sent to {picked.name}</span>
          </div>
        ) : (
          <>
            {err && <div className="ch-alert" role="alert">{err}</div>}

            {/* What the sender is about to share. `label` never leaves this
                screen — the message carries the pointer only. */}
            <p className="ch-share-what">
              {label
                ? <>Sending <strong>{label}</strong> as a link. Only the record it points at is sent — whether they can open it depends on their own permissions.</>
                : <>Sending a link to this {noun}. Whether they can open it depends on their own permissions.</>}
            </p>

            <div className="ch-modal-search">
              <Search size={14} />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Search colleagues…"
                aria-label="Search colleagues"
                autoFocus
              />
            </div>

            <ul className="ch-people">
              {people.map((p) => (
                <li key={p.id}>
                  <button type="button"
                          className={`ch-person${picked?.id === p.id ? ' ch-person--on' : ''}`}
                          onClick={() => setPicked(p)}
                          aria-pressed={picked?.id === p.id}>
                    <span>{p.name}</span>
                    {picked?.id === p.id && <Check size={14} />}
                  </button>
                </li>
              ))}
              {!people.length && <li className="ch-empty">Nobody matches that.</li>}
            </ul>

            <div className="ch-modal-title">
              <label htmlFor="ch-share-note">Add a note (optional)</label>
              <input
                id="ch-share-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. can you check the labour line?"
                maxLength={4000}
              />
            </div>

            <footer className="ch-modal-foot">
              <button type="button" className="ch-btn" onClick={onClose}>Cancel</button>
              <button type="button" className="ch-btn ch-btn--primary"
                      onClick={send} disabled={busy || !picked}>
                <Send size={13} />
                {busy ? 'Sending…' : picked ? `Send to ${picked.name}` : 'Pick somebody'}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
