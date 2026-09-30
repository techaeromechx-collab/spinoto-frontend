import { useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { api } from '../../api/client.js';

/**
 * ChatReactions — the pills under a bubble, and the picker that adds one.
 *
 * ══ KEY → CHARACTER HAPPENS HERE, NOT IN THE DATABASE ══════════════════════
 *
 * The server stores 'up', 'heart', 'haha' — short ASCII keys with a CHECK
 * constraint. The map below is the only place they become emoji. Migration 199
 * says why at length; the short version is that a TEXT column holding emoji is a
 * free-text column, and two visually identical hearts can be different byte
 * strings, which would defeat the primary key that stops one person reacting
 * twice with the same thing.
 *
 * Adding a seventh reaction is one line here and one in the CHECK.
 */
const EMOJI = {
  up: '👍',
  heart: '❤️',
  haha: '😂',
  wow: '😮',
  sad: '😢',
  thanks: '🙏',
};
const ORDER = ['up', 'heart', 'haha', 'wow', 'sad', 'thanks'];

const NAMES = {
  up: 'Thumbs up', heart: 'Love', haha: 'Haha',
  wow: 'Wow', sad: 'Sad', thanks: 'Thanks',
};

export default function ChatReactions({ messageId, reactions, disabled, onChanged }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /* Who reacted, fetched on hover rather than shipped with every page — fifty
     messages times six reactions times every name is most of the payload and
     nobody reads it until they point at one. */
  const [who, setWho] = useState(null);

  const list = Array.isArray(reactions) ? reactions : [];

  async function toggle(reaction) {
    if (busy || disabled) return;
    setBusy(true);
    setOpen(false);
    try {
      const r = await api(`/api/chat/messages/${messageId}/reactions`, {
        method: 'POST', body: { reaction },
      });
      /* The server returns the whole new set, so the bubble updates from the
         answer rather than from a guess about what the click did. Two people
         reacting at the same moment both end up showing the real count. */
      onChanged?.(messageId, r.reactions);
      setWho(null);
    } catch {
      /* Silent on purpose. A failed reaction is not worth an error band across
         somebody's conversation — the pill simply does not change, and the next
         socket nudge brings the truth. */
    } finally {
      setBusy(false);
    }
  }

  async function loadWho() {
    if (who || !list.length) return;
    try {
      const r = await api(`/api/chat/messages/${messageId}/reactions`);
      const by = {};
      for (const it of r.items) (by[it.reaction] ||= []).push(it.name);
      setWho(by);
    } catch { /* the pill just keeps its count as the tooltip */ }
  }

  return (
    <span className="ch-rx">
      {list.map((r) => (
        <button
          key={r.reaction}
          type="button"
          className={`ch-rx-pill${r.mine ? ' ch-rx-pill--mine' : ''}`}
          onClick={() => toggle(r.reaction)}
          onMouseEnter={loadWho}
          onFocus={loadWho}
          disabled={disabled}
          title={who?.[r.reaction]?.join(', ') || `${r.count} ${NAMES[r.reaction] || r.reaction}`}
          aria-label={`${NAMES[r.reaction] || r.reaction}, ${r.count}${r.mine ? ', including you' : ''}`}
          aria-pressed={!!r.mine}
        >
          <span className="ch-rx-emoji">{EMOJI[r.reaction] || '•'}</span>
          {/* The count is hidden at one: "👍 1" is noise, the pill itself says
              one person did it. It appears from two. */}
          {r.count > 1 && <span className="ch-rx-n">{r.count}</span>}
        </button>
      ))}

      {!disabled && (
        <span className="ch-rx-add-wrap">
          <button
            type="button"
            className="ch-rx-add"
            onClick={() => setOpen((o) => !o)}
            title="React"
            aria-label="Add a reaction"
            aria-expanded={open}
          >
            <SmilePlus size={13} />
          </button>
          {open && (
            <>
              {/* An invisible full-screen sheet, so the next click anywhere
                  closes the picker. Cheaper and more reliable than a document
                  listener that has to be torn down, and it cannot leak. */}
              <span className="ch-rx-sheet" onClick={() => setOpen(false)} />
              <span className="ch-rx-pop" role="menu">
                {ORDER.map((k) => (
                  <button key={k} type="button" className="ch-rx-opt"
                          onClick={() => toggle(k)} title={NAMES[k]} aria-label={NAMES[k]}>
                    {EMOJI[k]}
                  </button>
                ))}
              </span>
            </>
          )}
        </span>
      )}
    </span>
  );
}

export { EMOJI as REACTION_EMOJI, ORDER as REACTION_ORDER };
