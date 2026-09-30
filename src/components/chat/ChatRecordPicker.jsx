import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { useEscapeClose } from '../../hooks/useEscapeClose.js';
import { useDebouncedSearch, useAbortController, isAbortError }
  from '../../hooks/useDebouncedSearch.js';
import '../../styles/chatShared.css';

/**
 * ChatRecordPicker — the "+" in the composer.
 *
 * Pick a kind, search, attach. The chip goes into the message you are already
 * writing, so "can you check the labour line on this [EST-000412]" is one
 * message rather than a link pasted under a sentence.
 *
 * ══ THE TABS ARE WHAT YOU CAN SEE ══════════════════════════════════════════
 *
 * /records/kinds returns only the kinds this user's own permissions allow, so
 * somebody with four of them gets four tabs rather than six with two that always
 * come back empty. The search behind each one re-checks anyway — the tab list is
 * a convenience, never the gate.
 *
 * ══ AN EMPTY BOX LISTS THE RECENT ONES ═════════════════════════════════════
 *
 * Every tab used to open on "Nothing matches that.", which reads as a broken
 * feature rather than an invitation to type. A blank box is now a browse: the
 * most recent records of that kind, which is very often the one you want. The
 * response says which it did (`browse`), so the empty state can tell "you have
 * none of these yet" apart from "your search found none".
 */
export default function ChatRecordPicker({ onPick, onClose, kinds: given, initialKind }) {
  const [kinds, setKinds] = useState(given || []);
  /* Opened from a "Share Lead" button, this starts on that tab. If the caller
     names a kind this user cannot see, it falls back to the first they CAN —
     the tab list is the authority, not the button that opened it. */
  const [kind, setKind] = useState(() => {
    if (!given?.length) return null;
    return given.some((k) => k.ref_type === initialKind) ? initialKind : given[0].ref_type;
  });
  const [items, setItems] = useState([]);
  const [tooShort, setTooShort] = useState(false);
  const [browse, setBrowse] = useState(true);
  /* Starts true: the first list is already on its way when this renders, and
     without it the tab flashes an empty state that is not true yet. */
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const { input, setInput, search } = useDebouncedSearch('');
  const signal = useAbortController();

  useEscapeClose(onClose);

  useEffect(() => {
    /* The composer already asked for these to decide which quick-share buttons
       to draw, so it passes them down. Asking again on every open would be a
       second request for an answer that cannot have changed — it is computed
       from the caller's permissions and touches no table. */
    if (given?.length) return;
    api('/api/chat/records/kinds')
      .then((r) => {
        setKinds(r.items);
        const want = r.items.some((k) => k.ref_type === initialKind) ? initialKind : null;
        setKind(want || r.items[0]?.ref_type || null);
      })
      .catch((e) => setErr(e?.message || 'Could not load the record kinds.'));
  }, [given, initialKind]);

  useEffect(() => {
    if (!kind) return;
    let cancelled = false;
    setLoading(true);
    const q = search ? `&q=${encodeURIComponent(search)}` : '';
    api(`/api/chat/records/search?type=${kind}${q}`, { signal: signal() })
      .then((r) => {
        if (cancelled) return;
        setItems(r.items || []);
        setTooShort(!!r.too_short);
        setBrowse(!!r.browse);
        setLoading(false);
      })
      .catch((e) => {
        if (isAbortError(e)) return;   // superseded, and its replacement owns `loading`
        if (cancelled) return;
        setLoading(false);
        setErr(e?.message || 'Search failed.');
      });
    return () => { cancelled = true; };
  }, [kind, search, signal]);

  if (!kinds.length && !err) return null;

  return (
    <div className="ch-pick" role="dialog" aria-label="Attach a record">
      <div className="ch-pick-head">
        <span>Attach a record</span>
        <button type="button" className="ch-modal-x" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>

      {err && <div className="ch-alert" role="alert">{err}</div>}

      <div className="ch-pick-tabs">
        {kinds.map((k) => (
          <button key={k.ref_type} type="button"
                  className={`ch-pill${kind === k.ref_type ? ' ch-pill--on' : ''}`}
                  onClick={() => { setKind(k.ref_type); setItems([]); setLoading(true); }}
                  aria-pressed={kind === k.ref_type}>
            {k.noun}
          </button>
        ))}
      </div>

      <div className="ch-modal-search">
        <Search size={13} />
        <input value={input} onChange={(e) => setInput(e.target.value)}
               placeholder="Code, plate, name or number…"
               aria-label="Search records" autoFocus />
      </div>

      <div className="ch-pick-list">
        {loading && !items.length && <div className="ch-empty">Loading…</div>}
        {!loading && tooShort && <div className="ch-empty">Type 2+ characters to search.</div>}
        {!loading && !tooShort && !items.length && (
          <div className="ch-empty">
            {browse ? 'Nothing here yet.' : 'Nothing matches that.'}
          </div>
        )}
        {items.map((it) => (
          <button key={`${it.ref_type}:${it.ref_id}`} type="button" className="ch-pick-row"
                  onClick={() => onPick(it)}>
            <span className="ch-pick-top">
              <span className="ch-pick-label">{it.label}</span>
              <span className="ch-ref-kind">{it.noun}</span>
            </span>
            {it.sub && <span className="ch-pick-sub">{it.sub}</span>}
          </button>
        ))}
      </div>

      <p className="ch-pick-foot">
        Only records you can already open appear here.
      </p>
    </div>
  );
}
