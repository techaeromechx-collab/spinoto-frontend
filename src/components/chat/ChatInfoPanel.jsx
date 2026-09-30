import { useCallback, useEffect, useState } from 'react';
import {
  Archive, ArchiveRestore, Check, Eraser, LogOut, Pencil, Pin, PinOff,
  Trash2, UserMinus, UserPlus, X,
} from 'lucide-react';
import { api } from '../../api/client.js';
import { useEscapeClose } from '../../hooks/useEscapeClose.js';
import ChatNewModal from './ChatNewModal.jsx';
import '../../styles/chatShared.css';

/**
 * ChatInfoPanel — everything you can do to a conversation, in one place.
 *
 * Rename, who is in it, add, remove, leave, pin, archive, delete. It opens from
 * the thread header, which is where somebody looks when they want to know who can
 * read what they are about to type.
 *
 * ══ IT SHOWS WHAT YOU MAY DO, AND THE SERVER DECIDES ═══════════════════════
 *
 * `can_manage` comes back from /participants and hides the controls somebody
 * cannot use, because a Rename button that 403s is worse than no button. It is
 * NOT the check — every one of these routes re-checks, and must, since a client
 * deciding what it may do is not a rule. If the two ever disagree the server
 * wins and the error lands in the strip at the top of this panel.
 *
 * ══ THE TWO DESTRUCTIVE ONES ARE NOT THE SAME ══════════════════════════════
 *
 * Archive is the normal end of a group: it leaves everybody's list, goes
 * read-only, and comes back if it was a mistake. That is one click.
 *
 * Delete destroys every message anybody ever wrote in it, with no undo, and it
 * asks for the group's exact name typed out — not because typing is a security
 * measure, but because it is the difference between meaning to delete THIS group
 * and clicking the wrong row.
 *
 * ══ A DIRECT CONVERSATION IS NOT A SMALL GROUP ═════════════════════════════
 *
 * No rename, no members, no archive. A DM belongs equally to two people and
 * neither may put the other's messages beyond reach.
 *
 * It does now have two ways to be emptied, and they are deliberately different
 * powers rather than one button with a warning:
 *
 *   "Delete my messages"     anybody, their OWN words only. The other person
 *                            sees "Message deleted" where yours were and keeps
 *                            everything they wrote. No permission needed — the
 *                            author could already do this one message at a time,
 *                            so this changes the effort, not the authority.
 *
 *   "Delete permanently"     MANAGE_CHAT only, confirmed by typing the other
 *                            person's name, and it destroys BOTH sides. An
 *                            administrator's power, not a participant's: a
 *                            colleague must not be able to erase what you said
 *                            to them because they would rather it had not been
 *                            said.
 */
export default function ChatInfoPanel({ conversation, meId, onClose, onChanged }) {
  const id = conversation?.id;
  const isGroup = conversation?.kind === 'group';

  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(conversation?.title || '');
  const [adding, setAdding] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [askDelete, setAskDelete] = useState(false);
  const [askMine, setAskMine] = useState(false);
  const [done, setDone] = useState('');

  useEscapeClose(onClose);

  const load = useCallback(() => {
    if (!id) return;
    api(`/api/chat/conversations/${id}/participants`)
      .then(setData)
      .catch((e) => setErr(e?.message || 'Could not load who is in this conversation.'));
  }, [id]);

  useEffect(load, [load]);
  useEffect(() => { setTitle(conversation?.title || ''); }, [conversation?.title]);

  /* One place where a failed action turns into a message, so no call site has to
     remember to do it — and `busy` cannot be left true by a throw. */
  const act = async (fn, { reloadPanel = true } = {}) => {
    setBusy(true); setErr('');
    try {
      await fn();
      if (reloadPanel) load();
      onChanged?.();
    } catch (e) {
      setErr(e?.message || 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const canManage = !!data?.can_manage;
  /* MANAGE_CHAT, which canManage does not imply — see the block on the delete
     button below. */
  const canDestroy = !!data?.can_destroy;
  const archived = !!conversation?.archived;
  const pinned = !!conversation?.pinned;

  /* The other person in a direct conversation: the label everywhere on screen,
     and the string that has to be typed to destroy it, since a DM has no title
     of its own for chat_conversations_title_shape to hold. */
  const other = conversation?.others?.[0]?.name || null;
  const confirmTarget = isGroup ? conversation?.title : other;

  const rename = () => act(async () => {
    const next = title.trim();
    if (!next) throw new Error('A group needs a name');
    await api(`/api/chat/conversations/${id}`, { method: 'PATCH', body: { title: next } });
    setRenaming(false);
  });

  const members = data?.items || [];
  const here = members.filter((m) => !m.has_left);
  const gone = members.filter((m) => m.has_left);

  return (
    <aside className="ch-info" role="dialog" aria-label="Conversation details">
      <div className="ch-info-hd">
        <span>{isGroup ? 'Group details' : 'Conversation'}</span>
        <button type="button" className="ch-modal-x" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>

      {err && <div className="ch-alert" role="alert">{err}</div>}
      {archived && (
        <div className="ch-info-note">
          This conversation is archived — nobody can write in it until it is restored.
        </div>
      )}

      {/* ── The name ───────────────────────────────────────────────────── */}
      <div className="ch-info-sec">
        <div className="ch-info-label">Name</div>
        {isGroup && renaming ? (
          <div className="ch-info-rename">
            <input value={title} onChange={(e) => setTitle(e.target.value)}
                   maxLength={120} aria-label="Group name" autoFocus
                   onKeyDown={(e) => {
                     if (e.key === 'Enter') rename();
                     if (e.key === 'Escape') {
                       e.stopPropagation();   // the panel's own Escape would close it
                       setRenaming(false); setTitle(conversation.title || '');
                     }
                   }} />
            <button type="button" className="ch-btn ch-btn--go" onClick={rename} disabled={busy}
                    aria-label="Save name"><Check size={13} /></button>
            <button type="button" className="ch-btn" aria-label="Cancel"
                    onClick={() => { setRenaming(false); setTitle(conversation.title || ''); }}>
              <X size={13} />
            </button>
          </div>
        ) : (
          <div className="ch-info-name">
            <strong>{isGroup ? conversation.title
              : (conversation?.others?.[0]?.name || 'Direct message')}</strong>
            {isGroup && canManage && !archived && (
              <button type="button" className="ch-btn" onClick={() => setRenaming(true)}
                      title="Rename group" aria-label="Rename group">
                <Pencil size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Who is in it ───────────────────────────────────────────────── */}
      {isGroup && (
        <div className="ch-info-sec">
          <div className="ch-info-label">
            {here.length} {here.length === 1 ? 'person' : 'people'}
            {canManage && !archived && (
              <button type="button" className="ch-btn ch-btn--inline"
                      onClick={() => setAdding(true)}>
                <UserPlus size={12} /> Add
              </button>
            )}
          </div>

          <ul className="ch-mem">
            {here.map((m) => (
              <li key={m.id} className="ch-mem-row">
                <span className="ch-mem-main">
                  <span className="ch-mem-name">
                    {m.is_me ? 'You' : m.name}
                    {m.is_creator && <span className="ch-mem-tag">created it</span>}
                  </span>
                  {/* Who let this person in. The panel is the only place that can
                      answer it, and in a thread about a customer's car it is the
                      first question when somebody unexpected is in the list. */}
                  {m.added_by_name && !m.is_creator && (
                    <span className="ch-mem-sub">added by {m.added_by_name}</span>
                  )}
                </span>
                {m.is_me ? (
                  <button type="button" className="ch-btn ch-btn--warn" disabled={busy}
                          onClick={() => act(async () => {
                            await api(`/api/chat/conversations/${id}/participants/${meId}`,
                                      { method: 'DELETE' });
                            onClose?.();
                          }, { reloadPanel: false })}
                          title="Leave this group">
                    <LogOut size={12} /> Leave
                  </button>
                ) : canManage && !archived ? (
                  <button type="button" className="ch-btn ch-btn--warn" disabled={busy}
                          onClick={() => act(() => api(
                            `/api/chat/conversations/${id}/participants/${m.id}`,
                            { method: 'DELETE' }))}
                          title={`Remove ${m.name}`} aria-label={`Remove ${m.name}`}>
                    <UserMinus size={12} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>

          {/* People who left are shown, greyed. A group six people were in and
              two left is not a group of four as far as its history goes, and
              their messages are still in the thread. */}
          {gone.length > 0 && (
            <>
              <div className="ch-info-label ch-info-label--quiet">No longer in it</div>
              <ul className="ch-mem ch-mem--gone">
                {gone.map((m) => (
                  <li key={m.id} className="ch-mem-row">
                    <span className="ch-mem-name">{m.is_me ? 'You' : m.name}</span>
                    {canManage && !archived && (
                      <button type="button" className="ch-btn" disabled={busy}
                              onClick={() => act(() => api(
                                `/api/chat/conversations/${id}/participants`,
                                { method: 'POST', body: { user_ids: [m.id] } }))}
                              title={`Add ${m.name} back`}>
                        <UserPlus size={12} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {/* ── Mine only: pin, mute, clear ────────────────────────────────── */}
      <div className="ch-info-sec">
        <div className="ch-info-label">Just for you</div>
        <button type="button" className="ch-info-act" disabled={busy}
                onClick={() => act(() => api(`/api/chat/conversations/${id}/pin`,
                  { method: 'PATCH', body: { pinned: !pinned } }), { reloadPanel: false })}>
          {pinned ? <PinOff size={13} /> : <Pin size={13} />}
          {pinned ? 'Unpin from the top' : 'Pin to the top of my list'}
        </button>
        <button type="button" className="ch-info-act" disabled={busy}
                onClick={() => act(async () => {
                  await api(`/api/chat/conversations/${id}/dismiss`, { method: 'POST' });
                  onClose?.();
                }, { reloadPanel: false })}>
          <X size={13} />
          Clear from my list
        </button>
        <p className="ch-info-hint">
          Clearing hides it for you only. It comes back when somebody writes.
        </p>
      </div>

      {/* ── Withdrawing your own words ─────────────────────────────────────
          Its own section, between "just for you" and the destructive block,
          because it is neither: it changes what OTHER people see, and it
          destroys nothing of theirs. */}
      <div className="ch-info-sec">
        <div className="ch-info-label">Your messages</div>
        {!askMine ? (
          <button type="button" className="ch-info-act" disabled={busy || archived}
                  onClick={() => setAskMine(true)}>
            <Eraser size={13} />
            Delete my messages in this conversation
          </button>
        ) : (
          <div className="ch-info-danger">
            <p>
              Every message <strong>you</strong> have sent here will be withdrawn.
              {' '}{other ? `${other} keeps` : 'They keep'} everything they wrote, and
              will see &ldquo;Message deleted&rdquo; where yours were. This cannot be undone.
            </p>
            <div className="ch-info-danger-acts">
              <button type="button" className="ch-btn" onClick={() => setAskMine(false)}>
                Cancel
              </button>
              <button type="button" className="ch-btn ch-btn--danger" disabled={busy}
                      onClick={() => act(async () => {
                        const r = await api(`/api/chat/conversations/${id}/my-messages`,
                          { method: 'DELETE' });
                        setAskMine(false);
                        setDone(r?.deleted
                          ? `${r.deleted} message${r.deleted === 1 ? '' : 's'} withdrawn`
                          : 'You had nothing to withdraw here');
                      }, { reloadPanel: false })}>
                Delete my messages
              </button>
            </div>
          </div>
        )}
        {done && <p className="ch-info-hint">{done}</p>}
        <p className="ch-info-hint">
          Only yours. Nobody else&rsquo;s messages are touched.
        </p>
      </div>

      {/* ── Ending it ──────────────────────────────────────────────────── */}
      {isGroup && canManage && (
        <div className="ch-info-sec ch-info-sec--danger">
          <div className="ch-info-label">Ending this group</div>

          <button type="button" className="ch-info-act" disabled={busy}
                  onClick={() => act(() => api(`/api/chat/conversations/${id}/archive`,
                    { method: 'PATCH', body: { archived: !archived } }), { reloadPanel: false })}>
            {archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
            {archived ? 'Restore this group' : 'Archive this group'}
          </button>
          <p className="ch-info-hint">
            Archiving takes it out of everybody&rsquo;s list and stops new messages.
            Nothing is deleted and it can be restored.
          </p>

          {/* Permanent deletion needs MANAGE_CHAT, which can_manage does NOT
              imply: the creator of a group may archive it and may not destroy
              other people's messages in it. `can_destroy` is the server saying
              which — this used to be offered to any creator and the 403
              explained it afterwards, which is a button that exists to
              disappoint. */}
          {!canDestroy ? null : !askDelete ? (
            <button type="button" className="ch-info-act ch-info-act--danger"
                    onClick={() => setAskDelete(true)}>
              <Trash2 size={13} /> Delete permanently
            </button>
          ) : (
            <div className="ch-info-danger">
              <p>
                This deletes <strong>every message</strong> anybody has written in
                {' '}&ldquo;{conversation.title}&rdquo;. It cannot be undone.
                Type the group&rsquo;s name to confirm.
              </p>
              <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)}
                     placeholder={conversation.title} aria-label="Type the group name to confirm" />
              <div className="ch-info-danger-acts">
                <button type="button" className="ch-btn"
                        onClick={() => { setAskDelete(false); setConfirmName(''); }}>
                  Cancel
                </button>
                <button type="button" className="ch-btn ch-btn--danger"
                        disabled={busy || confirmName.trim() !== conversation.title}
                        onClick={() => act(async () => {
                          await api(`/api/chat/conversations/${id}`
                            + `?confirm=${encodeURIComponent(confirmName.trim())}`,
                            { method: 'DELETE' });
                          onClose?.();
                        }, { reloadPanel: false })}>
                  Delete for everyone
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Ending a DIRECT conversation ──────────────────────────────────
          No archive here — archiving is a group state and the CHECK constraint
          in migration 201 refuses it on a direct row. Only the permanent
          delete, and only for MANAGE_CHAT. */}
      {!isGroup && canDestroy && (
        <div className="ch-info-sec ch-info-sec--danger">
          <div className="ch-info-label">Ending this conversation</div>
          {!askDelete ? (
            <button type="button" className="ch-info-act ch-info-act--danger"
                    onClick={() => setAskDelete(true)}>
              <Trash2 size={13} /> Delete permanently
            </button>
          ) : (
            <div className="ch-info-danger">
              <p>
                This deletes <strong>every message</strong> in this conversation —
                yours and {other || 'theirs'} — for both of you. It cannot be undone.
                Type <strong>{confirmTarget}</strong> to confirm.
              </p>
              <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)}
                     placeholder={confirmTarget || ''}
                     aria-label="Type the other person's name to confirm" />
              <div className="ch-info-danger-acts">
                <button type="button" className="ch-btn"
                        onClick={() => { setAskDelete(false); setConfirmName(''); }}>
                  Cancel
                </button>
                <button type="button" className="ch-btn ch-btn--danger"
                        disabled={busy || confirmName.trim() !== confirmTarget}
                        onClick={() => act(async () => {
                          await api(`/api/chat/conversations/${id}`
                            + `?confirm=${encodeURIComponent(confirmName.trim())}`,
                            { method: 'DELETE' });
                          onClose?.();
                        }, { reloadPanel: false })}>
                  Delete for both of us
                </button>
              </div>
            </div>
          )}
          <p className="ch-info-hint">
            Deleting removes what {other || 'the other person'} wrote as well. To withdraw
            only your own messages, use the section above.
          </p>
        </div>
      )}

      {adding && (
        <ChatNewModal
          mode="add"
          conversationId={id}
          existingIds={here.map((m) => m.id)}
          onClose={() => setAdding(false)}
          onCreated={() => { setAdding(false); load(); onChanged?.(); }}
        />
      )}
    </aside>
  );
}
