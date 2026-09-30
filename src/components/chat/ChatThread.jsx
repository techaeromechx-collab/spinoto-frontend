import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ChevronUp, CornerUpLeft, Forward, Info, Lock, RotateCcw, Search, Trash2,
  Users, X,
} from 'lucide-react';
import socket from '../../lib/socket.js';
import { api } from '../../api/client.js';
import { when, dayKey, dayLabel } from '../../lib/dayLabel.js';
import ChatComposer from './ChatComposer.jsx';
import ChatSkeleton from './ChatSkeleton.jsx';
import ChatRefChip from './ChatRefChip.jsx';
import ChatReactions from './ChatReactions.jsx';
import ChatTicks, { tickState } from './ChatTicks.jsx';
import ChatLinkText from './ChatLinkText.jsx';
import ChatInfoPanel from './ChatInfoPanel.jsx';
import ChatForwardModal from './ChatForwardModal.jsx';
import { systemLine } from '../../lib/systemLine.js';

const PAGE = 50;

/** Two letters, for an avatar. */
function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0]).join('').toUpperCase() || '?';
}

/**
 * Should this message start a new visual run?
 *
 * A run is the same sender, within five minutes, on the same day. Inside a run
 * the avatar and the name appear once and the clock only on the last — three
 * messages from one person in one minute are one event, and drawing them as
 * three wastes about a third of the height of a busy group.
 */
function startsRun(m, prev) {
  if (!prev) return true;
  /* A system line is not part of anybody's run. Without this, "Ana added Ben"
     sitting between two of Ana's messages would be folded into her run, and the
     message after it would lose its avatar and name. */
  if (m.system_event || prev.system_event) return true;
  if (prev.sender_id !== m.sender_id) return true;
  if (dayKey(prev.created_at) !== dayKey(m.created_at)) return true;
  return new Date(m.created_at) - new Date(prev.created_at) > 5 * 60 * 1000;
}

function tickTitle(m, peers, conversation) {
  const st = tickState({
    mine: m.mine, createdAt: m.created_at,
    peerReadAt: peers.read_at, peerDeliveredAt: peers.delivered_at, peerCount: peers.count,
  });
  const base = st === 'read' ? 'Read' : st === 'delivered' ? 'Delivered' : 'Sent';
  if (conversation?.kind !== 'group') return base;
  if (st === 'read') return 'Read by everyone';
  return `${base} · not everyone has read it yet`;
}

export default function ChatThread({ conversation, onChanged, canModerate, meId }) {
  const convId = conversation?.id;

  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [err, setErr] = useState('');
  const [newCount, setNewCount] = useState(0);
  const [refs, setRefs] = useState({});
  const [peers, setPeers] = useState({ read_at: null, delivered_at: null, count: 0 });
  const [replyTo, setReplyTo] = useState(null);
  const [typing, setTyping] = useState([]);          // [{user_id, name}]
  const [failed, setFailed] = useState([]);          // sends that did not land
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [forwarding, setForwarding] = useState(null);   // the message being forwarded
  const [flash, setFlash] = useState('');               // 'Forwarded to Bay 3'
  /* The find box is CLOSED by default. A permanently-open input ate a third of
     the header and competed with the group's own name, for a control used
     occasionally — sized as if it were used constantly. */
  const [finding, setFinding] = useState(false);

  const scroller = useRef(null);
  const pinned = useRef(true);
  const seenTop = useRef(null);
  const typers = useRef(new Map());

  /* Where the unread divider goes: the read cursor AS IT WAS when this
     conversation was opened. Captured once, because it moves the moment the
     thread is fetched — recomputing it would make the line vanish while
     somebody is still looking for it. */
  const unreadFrom = useRef(null);

  const toBottom = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    setNewCount(0);
  }, []);

  const loadLatest = useCallback(async (opts = {}) => {
    if (!convId) return;
    try {
      const r = await api(`/api/chat/conversations/${convId}/messages?limit=${PAGE}`);
      setItems((prev) => {
        if (!opts.initial && !pinned.current) {
          const known = new Set(prev.map((m) => m.id));
          const fresh = r.items.filter((m) => !known.has(m.id)).length;
          if (fresh) setNewCount((n) => n + fresh);
        }
        return r.items;
      });
      setHasMore(r.has_more);
      setPeers({
        read_at: r.peer_read_at || null,
        delivered_at: r.peer_delivered_at || null,
        count: r.peer_count || 0,
      });
      setErr('');
      if (document.visibilityState === 'visible') {
        api(`/api/chat/conversations/${convId}/read`, { method: 'POST' })
          .then(() => onChanged?.())
          .catch(() => { /* a failed read cursor is not worth a visible error */ });
      }
    } catch (e) {
      setErr(e?.message || 'Could not load this conversation.');
    } finally {
      setLoading(false);
    }
  }, [convId, onChanged]);

  useEffect(() => {
    setItems([]); setHasMore(false); setLoading(true); setNewCount(0); setRefs({});
    setPeers({ read_at: null, delivered_at: null, count: 0 });
    setReplyTo(null); setFailed([]); setQ(''); setTyping([]);
    setShowInfo(false); setForwarding(null); setFlash(''); setFinding(false);
    typers.current.clear();
    unreadFrom.current = conversation?.my_read_at || null;
    pinned.current = true;
    loadLatest({ initial: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId, loadLatest]);

  useEffect(() => {
    if (!conversation?.reloadSignal) return;
    loadLatest();
  }, [conversation?.reloadSignal, loadLatest]);

  /* Somebody is typing. Each ping refreshes a per-person expiry; a sweep drops
     anybody who has gone quiet for four seconds. No "stopped typing" event to
     miss — a name that stops being refreshed simply expires, which is the only
     version of this that cannot get stuck on screen. */
  useEffect(() => {
    if (!convId) return;
    function onTyping({ conversation_id: cid, user_id, name }) {
      if (Number(cid) !== Number(convId) || user_id === meId) return;
      typers.current.set(user_id, { name, at: Date.now() });
      setTyping([...typers.current.entries()].map(([id, v]) => ({ user_id: id, name: v.name })));
    }
    socket.on('chat:typing', onTyping);
    const sweep = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, v] of typers.current) {
        if (now - v.at > 4000) { typers.current.delete(id); changed = true; }
      }
      if (changed) {
        setTyping([...typers.current.entries()].map(([id, v]) => ({ user_id: id, name: v.name })));
      }
    }, 1500);
    return () => { socket.off('chat:typing', onTyping); clearInterval(sweep); };
  }, [convId, meId]);

  // Search within the conversation.
  useEffect(() => {
    if (!convId) return;
    const term = q.trim();
    if (term.length < 2) {
      if (searching) { setSearching(false); pinned.current = true; loadLatest(); }
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api(`/api/chat/conversations/${convId}/messages?limit=${PAGE}&q=${encodeURIComponent(term)}`)
        .then((r) => {
          if (cancelled) return;
          setItems(r.items); setHasMore(false); setSearching(true);
        })
        .catch(() => { /* an empty search result is not an error */ });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, convId]);

  const unresolvedKey = items
    .filter((m) => m.ref_type && !m.deleted && !refs[`${m.ref_type}:${m.ref_id}`])
    .map((m) => `${m.ref_type}:${m.ref_id}`)
    .sort().join(',');

  useEffect(() => {
    if (!unresolvedKey) return;
    let cancelled = false;
    const pairs = [...new Set(unresolvedKey.split(','))].map((k) => {
      const i = k.lastIndexOf(':');
      return { ref_type: k.slice(0, i), ref_id: Number(k.slice(i + 1)) };
    });
    api('/api/chat/refs/resolve', { method: 'POST', body: { refs: pairs } })
      .then((r) => {
        if (cancelled) return;
        setRefs((prev) => {
          const next = { ...prev };
          for (const it of r.items) next[`${it.ref_type}:${it.ref_id}`] = it;
          return next;
        });
      })
      .catch(() => {
        /* Silent, and NOT cached as a refusal: a failed resolve leaves the chips
           pending, which is honest about not knowing. Writing allowed:false here
           would send somebody to ask for a permission they already hold. */
      });
    return () => { cancelled = true; };
  }, [unresolvedKey]);

  useEffect(() => {
    if (loading) return;
    const el = scroller.current;
    if (!el) return;
    if (seenTop.current != null) {
      el.scrollTop += el.scrollHeight - seenTop.current;
      seenTop.current = null;
      return;
    }
    if (pinned.current) el.scrollTop = el.scrollHeight;
  }, [items, loading]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (pinned.current && newCount) setNewCount(0);
  }

  async function loadOlder() {
    const el = scroller.current;
    if (!el || loadingOlder || !items.length) return;
    setLoadingOlder(true);
    seenTop.current = el.scrollHeight;
    try {
      const r = await api(
        `/api/chat/conversations/${convId}/messages?limit=${PAGE}&before=${items[0].id}`
      );
      setItems((prev) => [...r.items, ...prev]);
      setHasMore(r.has_more);
    } catch (e) {
      seenTop.current = null;
      setErr(e?.message || 'Could not load older messages.');
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send(payload) {
    const r = await api(`/api/chat/conversations/${convId}/messages`, {
      method: 'POST', body: payload,
    });
    pinned.current = true;
    setItems((prev) => [...prev, r.item]);
    onChanged?.();
  }

  /* A send that did not land stays IN THE THREAD as a failed bubble with Retry,
     rather than only as an error above the box. For a long message the text is
     the valuable thing and it should be where you can see it. */
  async function sendOrKeep(payload) {
    try {
      await send(payload);
    } catch (e) {
      setFailed((f) => [...f, { key: `f${Date.now()}`, payload, error: e?.message || 'Send failed' }]);
      pinned.current = true;
      setItems((x) => [...x]);   // nudge the scroll effect
      throw e;                   // the composer keeps the draft too
    }
  }

  async function retry(f) {
    try {
      await send(f.payload);
      setFailed((list) => list.filter((x) => x.key !== f.key));
    } catch { /* it stays in the list, with its Retry */ }
  }

  const onReacted = useCallback((id, reactions) => {
    setItems((prev) => prev.map((m) => (m.id === id ? { ...m, reactions } : m)));
  }, []);

  async function remove(id) {
    try {
      await api(`/api/chat/messages/${id}`, { method: 'DELETE' });
      setItems((prev) => prev.map((m) => (
        m.id === id ? { ...m, deleted: true, body: null, ref_type: null } : m
      )));
      onChanged?.();
    } catch (e) {
      setErr(e?.message || 'Could not delete that message.');
    }
  }

  /* ↑ on an empty box. Returns the text so the composer can put it in the box;
     returns null when the last message is not yours or is too old to edit, and
     the key then does what it normally does. */
  const editLast = useCallback(() => {
    const mine = [...items].reverse().find((m) => m.mine && !m.deleted && m.body);
    if (!mine) return null;
    const ageMin = (Date.now() - new Date(mine.created_at).getTime()) / 60000;
    if (ageMin > 15) return null;
    return mine.body;
  }, [items]);

  const rendered = useMemo(() => items, [items]);

  if (!convId) {
    return (
      <div className="ch-detail ch-detail--empty">
        <div className="ch-nothing">
          <div className="ch-nothing-icon" aria-hidden="true">💬</div>
          <div className="ch-nothing-title">No conversation open</div>
          <p className="ch-nothing-sub">
            Message a colleague, or share a record straight from the record itself.
          </p>
        </div>
      </div>
    );
  }

  const title = conversation.kind === 'group'
    ? conversation.title
    : (conversation.others?.[0]?.name || 'Direct message');
  const people = conversation.others || [];
  const archived = !!conversation.archived;

  let dividerDrawn = false;

  return (
    <div className="ch-detail">
      <header className="ch-head">
        {/* Faces, then names. "4 people" does not tell you which four. */}
        <div className="ch-faces" aria-hidden="true">
          {people.slice(0, 3).map((o) => (
            <span key={o.id} className="ch-face">{initials(o.name)}</span>
          ))}
        </div>
        {/* The whole title is the way in, because that is where somebody points
            when they want to know who is in the room — and the icon is there as
            well, so it is discoverable without having to guess that a heading is
            clickable. */}
        <button type="button" className="ch-head-main ch-head-main--btn"
                onClick={() => setShowInfo(true)}
                title={conversation.kind === 'group' ? 'Group details' : 'Conversation details'}>
          <h3 className="ch-head-title">
            {archived && <Lock size={12} aria-label="Archived" />}
            {title}
          </h3>
          <span className="ch-head-sub">
            {conversation.kind === 'group'
              ? `${people.map((o) => o.name.split(' ')[0]).join(', ')}${people.length ? ' and you' : 'Just you'}`
              : 'Direct message'}
          </span>
        </button>
        <div className="ch-head-actions">
          {/* "4 members" rather than an icon: the count is the thing somebody
              wants to know before they type, and it makes the way into the panel
              say what is behind it. A DM has no count worth printing. */}
          <button type="button" className="ch-members" onClick={() => setShowInfo(true)}
                  title="Details" aria-label="Conversation details">
            {conversation.kind === 'group' ? (
              <>
                <Users size={13} />
                {people.length + 1} member{people.length === 0 ? '' : 's'}
              </>
            ) : <Info size={14} />}
          </button>
          {/* Closed, it is an icon. Open, it is the same .ch-find it always was —
              so one set of styles, and the search itself is untouched. Closing
              CLEARS the term: leaving a filter running behind a collapsed
              control is how somebody ends up staring at three messages
              wondering where the rest went. */}
          {finding ? (
            <span className="ch-find">
              <Search size={13} />
              <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus
                     placeholder="Find in conversation" aria-label="Find in conversation"
                     onKeyDown={(e) => {
                       if (e.key === 'Escape') { e.stopPropagation(); setQ(''); setFinding(false); }
                     }} />
              <button type="button" className="ch-modal-x"
                      onClick={() => { setQ(''); setFinding(false); }}
                      aria-label="Close search"><X size={12} /></button>
            </span>
          ) : (
            <button type="button" className="ch-act ch-head-find" onClick={() => setFinding(true)}
                    title="Find in conversation" aria-label="Find in conversation">
              <Search size={14} />
            </button>
          )}
        </div>
      </header>

      {err && <div className="ch-alert" role="alert">{err}</div>}
      {searching && (
        <div className="ch-searching">
          {rendered.length} match{rendered.length === 1 ? '' : 'es'} — showing results only
        </div>
      )}

      <div className="ch-scroll" ref={scroller} onScroll={onScroll}>
        {loading ? <ChatSkeleton /> : (
          <>
            {hasMore && !searching && (
              <div className="ch-older">
                <button type="button" className="ch-older-btn"
                        onClick={loadOlder} disabled={loadingOlder}>
                  <ChevronUp size={13} />
                  {loadingOlder ? 'Loading…' : 'Load older messages'}
                </button>
              </div>
            )}
            {!rendered.length && (
              <div className="ch-empty">
                {searching ? 'Nothing matches that.' : 'No messages yet. Say something.'}
              </div>
            )}

            {rendered.map((m, i) => {
              const prev = i > 0 ? rendered[i - 1] : null;
              const next = i < rendered.length - 1 ? rendered[i + 1] : null;
              const k = dayKey(m.created_at);
              const newDay = k && (!prev || k !== dayKey(prev.created_at));
              const runStart = searching || newDay || startsRun(m, prev);
              const runEnd = searching || !next || startsRun(next, m);

              /* The unread line, once, before the first message that arrived
                 after this reader last looked — and never on their own. */
              let divider = false;
              /* ...and never on a system line: "New messages" above "Ana
                 renamed this" promises a message that is not there, and the line
                 can only be drawn once. */
              if (!searching && !dividerDrawn && unreadFrom.current && !m.mine
                  && !m.system_event
                  && new Date(m.created_at) > new Date(unreadFrom.current)) {
                divider = true; dividerDrawn = true;
              }

              /* ── A system line is not a message ────────────────────────
                 No bubble, no avatar, no reply, no reactions, no ticks — a
                 centred sentence between the messages it explains. Rendering it
                 as a bubble from whoever did the thing would read as them SAYING
                 "Ana added Ben", and it would be the only bubble in the thread
                 nobody could reply to, which looks like a bug rather than a
                 different kind of thing.
                 An event this bundle does not know returns null and is skipped,
                 so a cached old bundle meeting a newer event draws nothing at all
                 instead of an empty line. */
              if (m.system_event) {
                const words = systemLine({
                  event: m.system_event,
                  actor: m.sender_name,
                  mine: m.mine,
                  target: m.system_target,
                  targetIsMe: m.system_target_id === meId,
                  title: m.body,
                });
                if (!words) return null;
                return (
                  <Fragment key={m.id}>
                    {newDay && (
                      <div className="ch-daysep"><span>{dayLabel(m.created_at)}</span></div>
                    )}
                    <div className="ch-sys">
                      <span className="ch-sys-txt">{words}</span>
                      <span className="ch-sys-when">{when(m.created_at)}</span>
                    </div>
                  </Fragment>
                );
              }

              return (
                <Fragment key={m.id}>
                  {newDay && (
                    <div className="ch-daysep"><span>{dayLabel(m.created_at)}</span></div>
                  )}
                  {divider && (
                    <div className="ch-unreadline"><span>New messages</span></div>
                  )}

                  <div className={`ch-row ch-row--${m.mine ? 'out' : 'in'}`
                    + `${runStart ? ' ch-row--start' : ''}${runEnd ? ' ch-row--end' : ''}`}>
                    {!m.mine && (
                      <span className={`ch-av${runStart ? '' : ' ch-av--ghost'}`} aria-hidden={!runStart}>
                        {runStart ? initials(m.sender_name) : ''}
                      </span>
                    )}

                    <div className={`ch-bubble${m.deleted ? ' ch-bubble--gone' : ''}`}>
                      {/* Only in a group, and only at the top of a run. */}
                      {!m.mine && runStart && conversation.kind === 'group' && (
                        <span className="ch-who">{m.sender_name}</span>
                      )}

                      {/* What this message answers. Clicking jumps back to it. */}
                      {m.reply_to && (
                        <button type="button" className="ch-quote"
                                onClick={() => {
                                  const el = document.getElementById(`chm-${m.reply_to.id}`);
                                  if (el) {
                                    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                                    el.classList.add('ch-flash');
                                    setTimeout(() => el.classList.remove('ch-flash'), 1200);
                                  }
                                }}>
                          <span className="ch-quote-who">{m.reply_to.sender}</span>
                          <span className="ch-quote-txt">
                            {m.reply_to.deleted ? <em>Message deleted</em>
                              : m.reply_to.preview || <em>Shared a record</em>}
                          </span>
                        </button>
                      )}

                      <span id={`chm-${m.id}`} />

                      {m.deleted ? (
                        <em className="ch-gone">Message deleted</em>
                      ) : (
                        <>
                          {m.body && (
                            <span className="ch-body"><ChatLinkText text={m.body} /></span>
                          )}
                          {m.ref_type && (
                            <ChatRefChip refType={m.ref_type} refId={m.ref_id}
                                         resolved={refs[`${m.ref_type}:${m.ref_id}`]} />
                          )}
                        </>
                      )}

                      {!m.deleted && (
                        <ChatReactions messageId={m.id} reactions={m.reactions}
                                       onChanged={onReacted} />
                      )}

                      {/* The clock only at the end of a run — three timestamps
                          one minute apart is three copies of the same fact. */}
                      {(runEnd || m.edited_at) && (
                        <span className="ch-meta">
                          {when(m.created_at)}
                          {m.edited_at && !m.deleted && (
                            <span className="ch-edited" title="Edited">edited</span>
                          )}
                          {m.mine && !m.deleted && (
                            <ChatTicks
                              state={tickState({
                                mine: m.mine, createdAt: m.created_at,
                                peerReadAt: peers.read_at,
                                peerDeliveredAt: peers.delivered_at,
                                peerCount: peers.count,
                              })}
                              title={tickTitle(m, peers, conversation)}
                            />
                          )}
                        </span>
                      )}

                      {!m.deleted && (
                        <span className="ch-acts">
                          <button type="button" className="ch-act"
                                  onClick={() => setReplyTo({
                                    id: m.id, sender_name: m.sender_name,
                                    body: m.body, deleted: m.deleted,
                                  })}
                                  title="Reply" aria-label="Reply to this message">
                            <CornerUpLeft size={11} />
                          </button>
                          <button type="button" className="ch-act"
                                  onClick={() => setForwarding(m)}
                                  title="Forward" aria-label="Forward this message">
                            <Forward size={11} />
                          </button>
                          {(m.mine || canModerate) && (
                            <button type="button" className="ch-act ch-act--del"
                                    onClick={() => remove(m.id)}
                                    title="Delete message" aria-label="Delete message">
                              <Trash2 size={11} />
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </Fragment>
              );
            })}

            {/* Sends that did not land. In the thread, with the text visible. */}
            {failed.map((f) => (
              <div key={f.key} className="ch-row ch-row--out ch-row--start ch-row--end">
                <div className="ch-bubble ch-bubble--failed">
                  <span className="ch-body">{f.payload.body || <em>Shared a record</em>}</span>
                  <span className="ch-fail">
                    {f.error}
                    <button type="button" className="ch-retry" onClick={() => retry(f)}>
                      <RotateCcw size={11} /> Retry
                    </button>
                    <button type="button" className="ch-modal-x"
                            onClick={() => setFailed((l) => l.filter((x) => x.key !== f.key))}
                            aria-label="Discard"><X size={12} /></button>
                  </span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {typing.length > 0 && (
        <div className="ch-typing" aria-live="polite">
          <span className="ch-typing-dots"><i /><i /><i /></span>
          {typing.length === 1
            ? `${typing[0].name.split(' ')[0]} is typing…`
            : `${typing.length} people are typing…`}
        </div>
      )}

      {newCount > 0 && (
        <button type="button" className="ch-newstrip" onClick={toBottom}>
          <ArrowDown size={13} />
          {newCount} new {newCount === 1 ? 'message' : 'messages'}
        </button>
      )}

      {flash && (
        <div className="ch-flashbar" role="status">
          {flash}
          <button type="button" className="ch-modal-x" onClick={() => setFlash('')}
                  aria-label="Dismiss"><X size={12} /></button>
        </div>
      )}

      {/* An archived thread shows WHY there is no box, rather than a disabled one.
          A greyed-out composer invites people to click it and work out for
          themselves that nothing happens. */}
      {archived ? (
        <div className="ch-locked">
          <Lock size={13} />
          <span>
            This conversation is archived. Restore it from
            {' '}
            <button type="button" className="ch-linkbtn" onClick={() => setShowInfo(true)}>
              group details
            </button>
            {' '}to write in it again.
          </span>
        </div>
      ) : (
        <ChatComposer
          onSend={sendOrKeep}
          placeholder={`Message ${title}`}
          conversationId={convId}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onEditLast={editLast}
        />
      )}

      {showInfo && (
        <ChatInfoPanel
          conversation={conversation}
          meId={meId}
          onClose={() => setShowInfo(false)}
          /* BOTH halves, and it took a browser test to notice the second one.
             The panel changes membership, the name and the archived state. The
             HEADER renders those from the conversation row the PAGE owns, so the
             page has to reload — that much was here. But every one of those
             changes also writes a SYSTEM LINE into this thread, and the thread's
             own messages are fetched here. Telling only the page meant renaming a
             group updated the title and left "Ana renamed this" out of the thread
             until a socket nudge or a new message happened to arrive.
             The server does emit to everybody including the actor, so it would
             have corrected itself — eventually, and only with a live socket. Your
             own action should not need one. */
          onChanged={() => { onChanged?.(); loadLatest(); }}
        />
      )}

      {forwarding && (
        <ChatForwardModal
          message={forwarding}
          fromId={convId}
          onClose={() => setForwarding(null)}
          onDone={(c) => {
            setForwarding(null);
            setFlash(`Forwarded to ${c.kind === 'group' ? c.title
              : (c.others?.[0]?.name || 'that conversation')}`);
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
