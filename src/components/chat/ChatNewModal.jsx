import { useEffect, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { useEscapeClose } from '../../hooks/useEscapeClose.js';
import { useDebouncedSearch, useAbortController, isAbortError }
  from '../../hooks/useDebouncedSearch.js';
import '../../styles/chatShared.css';

/**
 * ChatNewModal — pick who to talk to.
 *
 * One person is a direct message and needs no name. Two or more is a group and
 * does, which is why the title field appears only at that point rather than
 * sitting there greyed out — and why the API refuses a named one-person
 * conversation instead of quietly dropping the name.
 *
 * Closes on X, Cancel and Escape, NOT on backdrop click. That is the house
 * convention and useEscapeClose's doc comment states it: a modal holding a
 * half-finished selection should not be dismissed by a stray click beside it.
 *
 * ══ TWO MODES, ONE PICKER ══════════════════════════════════════════════════
 *
 * mode="add" reuses everything above to add people to a group that already
 * exists: the same directory, the same search, the same chips. The differences
 * are that it POSTs to /participants instead of /conversations, that there is no
 * title to ask for, and that people already in the group are filtered out of the
 * list — offering them is offering a no-op, and the API treats a duplicate add as
 * one, so the list is where it should be said.
 *
 * A second modal copied from this one would have drifted from it by the second
 * change to the directory endpoint.
 */
export default function ChatNewModal({
  onClose, onCreated, mode = 'new', conversationId = null, existingIds = [],
}) {
  const [people, setPeople] = useState([]);
  const [picked, setPicked] = useState([]);       // [{id, name}]
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const { input, setInput, search, tooShort, minChars } = useDebouncedSearch('');
  const signal = useAbortController();

  useEscapeClose(onClose);

  useEffect(() => {
    (async () => {
      try {
        const q = search ? `?q=${encodeURIComponent(search)}` : '';
        const r = await api(`/api/chat/directory${q}`, { signal: signal() });
        setPeople(r.items);
      } catch (e) {
        // A superseded search rejects with AbortError. Swallow it — showing it
        // would put an error on screen for every fast typist.
        if (!isAbortError(e)) setErr(e?.message || 'Could not load the staff list.');
      }
    })();
  }, [search, signal]);

  const isPicked = (id) => picked.some((p) => p.id === id);
  const toggle = (p) => setPicked((prev) => (
    prev.some((x) => x.id === p.id) ? prev.filter((x) => x.id !== p.id) : [...prev, p]
  ));

  const isAdd = mode === 'add';
  /* Adding to a group never asks for a name, whatever the count. */
  const isGroup = !isAdd && picked.length > 1;

  /* Already in it is not a choice. The API is idempotent about it, so this is
     about not offering something that does nothing. */
  const shown = isAdd ? people.filter((p) => !existingIds.includes(p.id)) : people;

  async function create() {
    if (!picked.length || busy) return;
    setBusy(true);
    setErr('');
    try {
      if (isAdd) {
        await api(`/api/chat/conversations/${conversationId}/participants`, {
          method: 'POST', body: { user_ids: picked.map((p) => p.id) },
        });
        onCreated(conversationId);
        return;
      }
      const r = await api('/api/chat/conversations', {
        method: 'POST',
        body: {
          user_ids: picked.map((p) => p.id),
          // Only when it is a group. Sending it for one person is a 400.
          ...(isGroup ? { title: title.trim() } : {}),
        },
      });
      onCreated(r.id);
    } catch (e) {
      setErr(e?.message || (isAdd ? 'Could not add them.' : 'Could not start that conversation.'));
      setBusy(false);
    }
  }

  return (
    <div className="ch-modal-wrap" role="dialog" aria-modal="true"
         aria-label={isAdd ? 'Add people' : 'New conversation'}>
      <div className="ch-modal-backdrop" />
      <div className="ch-modal">
        <header className="ch-modal-head">
          <h3>{isAdd ? 'Add people' : 'New conversation'}</h3>
          <button type="button" className="ch-modal-x" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        {err && <div className="ch-alert" role="alert">{err}</div>}

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
        {tooShort && (
          <p className="ch-modal-hint">Type {minChars}+ characters to search, or pick from the list.</p>
        )}

        {picked.length > 0 && (
          <div className="ch-chips">
            {picked.map((p) => (
              <button key={p.id} type="button" className="ch-chip"
                      onClick={() => toggle(p)} title="Remove">
                {p.name}<X size={11} />
              </button>
            ))}
          </div>
        )}

        <ul className="ch-people">
          {shown.map((p) => (
            <li key={p.id}>
              <button type="button"
                      className={`ch-person${isPicked(p.id) ? ' ch-person--on' : ''}`}
                      onClick={() => toggle(p)}
                      aria-pressed={isPicked(p.id)}>
                <span>{p.name}</span>
                {isPicked(p.id) && <Check size={14} />}
              </button>
            </li>
          ))}
          {!shown.length && (
            <li className="ch-empty">
              {isAdd && people.length ? 'Everybody who matches is already in it.'
                : 'Nobody matches that.'}
            </li>
          )}
        </ul>

        {isGroup && (
          <div className="ch-modal-title">
            <label htmlFor="ch-group-title">Group name</label>
            <input
              id="ch-group-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Bay 3 rework"
              maxLength={120}
            />
          </div>
        )}

        <footer className="ch-modal-foot">
          <button type="button" className="ch-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="ch-btn ch-btn--primary"
                  onClick={create}
                  disabled={busy || !picked.length || (isGroup && !title.trim())}>
            {busy ? (isAdd ? 'Adding…' : 'Starting…')
              : isAdd ? `Add ${picked.length || ''}`.trim()
              : isGroup ? 'Create group' : 'Start conversation'}
          </button>
        </footer>
      </div>
    </div>
  );
}
