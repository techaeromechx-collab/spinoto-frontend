import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Archive, ArrowLeft, Lock, MessageSquarePlus, Pin, PinOff, Search, Users, X,
} from 'lucide-react';
import { api } from '../api/client.js';
import useSync from '../hooks/useSync.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useMediaQuery, MOBILE_LIST_QUERY } from '../hooks/useMediaQuery.js';
import { listStamp } from '../lib/dayLabel.js';
import { systemPreview } from '../lib/systemLine.js';
import ChatThread from '../components/chat/ChatThread.jsx';
import ChatNewModal from '../components/chat/ChatNewModal.jsx';
import { ChatSourceSwitch, WhatsAppRail, WhatsAppPane } from '../components/chat/WhatsAppChat.jsx';
import '../styles/ChatPage.css';

/**
 * ChatPage — the conversation list and the open thread.
 *
 * ══ WHY THIS DOES NOT USE useDetailRail ════════════════════════════════════
 *
 * SplitPane's rail is driven by useDetailRail, which deliberately fetches
 * nothing until selectedId is truthy — its comment explains that a second
 * invisible request per keystroke is pure waste on a screen whose rail is
 * closed. A chat conversation list is the primary content and is visible with
 * nothing selected, so that hook's central assumption is inverted here. Passing
 * a fake selectedId to trick it would work until somebody read the hook.
 *
 * So: the sp-* CSS grid is reused for the layout, and the list owns its own
 * fetch. Nothing is duplicated except the word "rail".
 *
 * ══ ONE FETCH PATH, CALLED FROM THREE PLACES ═══════════════════════════════
 *
 * Mount, a socket nudge, and the thread saying it changed something all call the
 * same load(). The socket carries no data — `invalidate { topic: 'chat' }` and
 * nothing else — so learning that chat moved and asking what moved are two
 * separate steps by design. See backend/src/socket.js.
 */
/** Two letters for an avatar. Same rule as the thread's, so a person looks the
    same on both sides of the screen. */
function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0]).join('').toUpperCase() || '?';
}

export default function ChatPage() {
  const { conversationId, mobile: waMobile } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { can, user } = useAuth();
  const isMobile = useMediaQuery(MOBILE_LIST_QUERY);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);
  /* Archived is a SEPARATE LIST, not a flag on this one. The server pages them
     apart for the same reason: a filter applied here would mean asking for 60
     rows and being handed 60 of which some are hidden, so the page size would
     stop meaning anything. */
  const [archivedView, setArchivedView] = useState(false);
  /* All / Unread / Groups. A FILTER on rows already here, not a second fetch:
     the list is capped at 60 and all of it is in memory, so a round trip per tab
     would buy nothing and would make the tabs feel slower than the list. */
  const [tab, setTab] = useState('all');

  /* A counter, not a boolean. The thread re-fetches when this changes, and a
     boolean could not represent two nudges in a row — the second would set it to
     the value it already had and the thread would miss a message. */
  const [reloadSignal, setReloadSignal] = useState(0);

  const openId = conversationId ? Number(conversationId) : null;
  const canModerate = can('MANAGE_CHAT');

  /* ── Team ⇄ WhatsApp ──────────────────────────────────────────────────────
     Driven by the URL, not by state, so a thread stays linkable: /chat/41 is a
     colleague and /chat/wa/919824512345 is a customer. The route is declared in
     App.jsx; `wa` is a static segment so it wins over /chat/:conversationId.

     Everything below this block that concerns team chat is UNCHANGED. The
     WhatsApp side renders in its place, and the team fetch keeps running either
     way — which is deliberate, because the Team badge on the switch has to stay
     live while somebody is reading WhatsApp. */
  const canWhatsApp = can('SEND_WHATSAPP', 'VIEW_WHATSAPP_LOGS');
  const isWa = canWhatsApp && location.pathname.startsWith('/chat/wa');
  const [waRow, setWaRow] = useState(null);
  const [waUnread, setWaUnread] = useState(0);

  /* The WhatsApp unread count while the TEAM tab is showing. The rail reports
     its own number once it is mounted (see onCount below), but when it is not
     mounted nothing would — and a switch whose badge only appears after you
     press it is a badge that cannot do its job. */
  useEffect(() => {
    if (!canWhatsApp || isWa) return;
    let live = true;
    const pull = () => api('/api/whatsapp/inbox/unread-count')
      .then(r => { if (live) setWaUnread(r.count || 0); })
      .catch(() => {});
    pull();
    return () => { live = false; };
  }, [canWhatsApp, isWa, reloadSignal]);

  const load = useCallback(async () => {
    try {
      const r = await api('/api/chat/conversations?limit=60'
        + (archivedView ? '&archived=1' : ''));
      /* `pinned_count` is on the response and deliberately not stored: the rows
         carry `pinned` themselves, and a second copy of the same fact is a second
         thing to keep in step. The count is there for a client that pages. */
      setItems(r.items);
      setErr('');
    } catch (e) {
      setErr(e?.message || 'Could not load your conversations.');
    } finally {
      setLoading(false);
    }
  }, [archivedView]);

  useEffect(() => { load(); }, [load]);

  /* One topic, and the reload of both halves is deliberate: the list needs the
     new preview and unread flag, the open thread needs the message. The socket
     cannot tell us WHICH conversation moved, because the payload carries
     nothing — which is exactly what keeps an unauthenticated listener from
     learning anything from it. */
  useSync(['chat'], useCallback(() => {
    load();
    setReloadSignal((n) => n + 1);
  }, [load]));

  /* Refetch when the tab comes back to the front. The 120s poll below is a
     backstop for a dropped socket; this covers the much more common case of a
     laptop that was shut. */
  useEffect(() => {
    function onVis() { if (document.visibilityState === 'visible') load(); }
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  /* ── The rail's grouping is FROZEN between navigations ────────────────
     Unread pinned to the top is only useful if the list holds still. Regrouping
     the moment something is read moves the row out from under the cursor — you
     click a thread, it is marked read, and it jumps to a different group while
     your hand is still on the mouse. So the set of ids that count as unread is
     captured when the page is entered and when the open conversation changes,
     and nothing else disturbs it. The DOT on each row is live; only the
     ORDER is frozen. */
  const [frozenUnread, setFrozenUnread] = useState(null);
  useEffect(() => {
    if (loading) return;
    setFrozenUnread(new Set(items.filter((c) => c.is_unread).map((c) => c.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, loading]);

  const open = items.find((c) => c.id === openId) || null;

  /* A deep link to a conversation that is not in the first page of the list —
     an old thread somebody bookmarked, or one that was dismissed — still has to
     open. Fetched on its own rather than by paging the list until it appears. */
  const [orphan, setOrphan] = useState(null);
  useEffect(() => {
    if (!openId || open) { setOrphan(null); return; }
    let cancelled = false;
    api(`/api/chat/conversations/${openId}`)
      .then((r) => { if (!cancelled) setOrphan(r.item); })
      .catch(() => { if (!cancelled) navigate('/chat', { replace: true }); });
    return () => { cancelled = true; };
  }, [openId, open, navigate]);

  const active = open || orphan;

  /* Filtering is client-side and only the client-side. The list is capped at 60
     rows, all of them already here, so a round trip per keystroke would buy
     nothing — and a server search would need its own endpoint over message
     bodies, which is a different feature (search) wearing a filter's clothes. */
  const needle = q.trim().toLowerCase();
  const matchesText = (c) => {
    if (!needle) return true;
    const name = c.kind === 'group'
      ? (c.title || '')
      : (c.others?.map((o) => o.name).join(' ') || '');
    return name.toLowerCase().includes(needle);
  };
  const matchesTab = (c) => (
    tab === 'unread' ? c.is_unread
      : tab === 'groups' ? c.kind === 'group'
      : true
  );
  const shown = items.filter((c) => matchesText(c) && matchesTab(c));

  const unread = items.filter((c) => c.is_unread).length;
  const groupCount = items.filter((c) => c.kind === 'group').length;
  const TABS = [
    { key: 'all',    label: 'All',    count: items.length },
    { key: 'unread', label: 'Unread', count: unread },
    { key: 'groups', label: 'Groups', count: groupCount },
  ];

  /* ── Pinned sits above the unread/earlier split, not inside it ──────────
     A pinned thread is there because somebody put it there, and a group heading
     that moved it back down among the unread ones would undo the only thing
     pinning does. It is also why the server sends pinned rows as their own block
     rather than sorting them into the page — see PINNED_ONLY_SQL. */
  const groups = (() => {
    const pins = shown.filter((c) => c.pinned);
    const rest0 = shown.filter((c) => !c.pinned);
    const out = [];
    if (pins.length) out.push({ key: 'pinned', label: `Pinned · ${pins.length}`, rows: pins });

    if (tab !== 'all' || !frozenUnread || !frozenUnread.size) {
      if (rest0.length) out.push({ key: 'all', label: pins.length ? 'Everything else' : null, rows: rest0 });
      return out;
    }
    const top = rest0.filter((c) => frozenUnread.has(c.id));
    const rest = rest0.filter((c) => !frozenUnread.has(c.id));
    if (top.length) out.push({ key: 'unread', label: `Unread · ${top.length}`, rows: top });
    if (rest.length) out.push({ key: 'earlier', label: 'Earlier', rows: rest });
    return out;
  })();

  /* Pin and clear, from the row. Both are one person's own view of their own
     list, so neither needs to tell anybody else — but the list itself has to be
     re-read, because the ordering is the server's. */
  async function togglePin(c, e) {
    e.stopPropagation();          // the row underneath navigates
    e.preventDefault();
    try {
      await api(`/api/chat/conversations/${c.id}/pin`,
        { method: 'PATCH', body: { pinned: !c.pinned } });
      load();
    } catch (ex) {
      setErr(ex?.message || 'Could not pin that.');
    }
  }

  function pick(id) {
    navigate(`/chat/${id}`);
  }

  const railRef = useRef(null);

  /* A deep link straight to /chat/wa/919824512345 — a refresh, or a link from a
     colleague — arrives with no row in hand. The rail hands it over once its
     list lands; until then the pane opens on what the URL alone can say, which
     is enough for the thread to load and resolve the rest itself. */
  const waOpen = isWa && waMobile
    ? (waRow && waRow.mobile === `+${waMobile}`
        ? waRow
        : { mobile: `+${waMobile}`, display_name: `+${waMobile}`, lead_id: null })
    : null;

  /* On a phone the rail and the thread cannot share the width, so it is one or
     the other: the list, until something is open. */
  const anyOpen = isWa ? !!waOpen : !!active;
  const showRail = !isMobile || !anyOpen;
  const showDetail = !isMobile || anyOpen;

  return (
    <div className="ch-page">
      <div className={`ch-split${anyOpen ? ' ch-split--open' : ''}`}>
        {showRail && (
          <aside className="ch-rail" ref={railRef}>
            <div className="ch-rail-hd">
              <h2>
                {archivedView ? 'Archived' : 'Chat'}
                {!archivedView && !isWa && unread > 0 && (
                  <span className="ch-rail-count">{unread}</span>
                )}
              </h2>
              {/* Archive and New belong to team chat. You do not start a
                  WhatsApp conversation — the customer does — and there is
                  nothing to archive, so neither is rendered on that side.

                  NOT the `hidden` attribute, which this span's own
                  `display: flex` overrides — the buttons stayed on screen and
                  the browser test caught it. */}
              {!isWa && (
              <span className="ch-rail-hd-acts">
                {/* Its own class, NOT a second .ch-new. Two buttons sharing that
                    class made every existing `.ch-new` selector ambiguous — which
                    is exactly how shot17 found this, by failing on a click it had
                    been making for weeks. */}
                <button type="button"
                        className={`ch-archv${archivedView ? ' ch-archv--on' : ''}`}
                        onClick={() => { setLoading(true); setArchivedView((v) => !v); }}
                        title={archivedView ? 'Back to your conversations' : 'Archived groups'}
                        aria-pressed={archivedView}>
                  <Archive size={15} />
                </button>
                <button type="button" className="ch-new" onClick={() => setShowNew(true)}
                        title="New conversation" aria-label="New conversation">
                  <MessageSquarePlus size={16} />
                </button>
              </span>
              )}
            </div>

            {canWhatsApp && !archivedView && (
              <ChatSourceSwitch
                source={isWa ? 'wa' : 'team'}
                teamUnread={unread}
                waUnread={waUnread}
                onPick={(k) => navigate(k === 'wa' ? '/chat/wa' : '/chat')}
              />
            )}

            {isWa && (
              <WhatsAppRail
                selected={waMobile ? `+${waMobile}` : null}
                onPick={(row) => { setWaRow(row); navigate(`/chat/wa/${String(row.mobile).replace(/\D/g, '')}`); }}
                onResolve={setWaRow}
                onCount={setWaUnread}
              />
            )}

            {!isWa && !archivedView && (
              <div className="ch-tabs" role="tablist" aria-label="Filter conversations">
                {TABS.map((t) => (
                  <button key={t.key} type="button" role="tab"
                          aria-selected={tab === t.key}
                          className={`ch-tab${tab === t.key ? ' ch-tab--on' : ''}`}
                          onClick={() => setTab(t.key)}>
                    {t.label}
                    {t.count > 0 && (
                      <span className={`ch-tab-n${t.key === 'unread' ? ' ch-tab-n--alert' : ''}`}>
                        {t.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {!isWa && (<>
            <div className="ch-rail-search">
              <Search size={13} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter conversations"
                aria-label="Filter conversations"
              />
              {q && (
                <button type="button" className="ch-rail-clear"
                        onClick={() => setQ('')} aria-label="Clear filter">
                  <X size={12} />
                </button>
              )}
            </div>

            {err && <div className="ch-alert" role="alert">{err}</div>}

            <div className="ch-rail-list">
              {loading && <div className="ch-rail-loading">Loading…</div>}

              {!loading && !items.length && archivedView && (
                <div className="ch-empty">No archived groups.</div>
              )}

              {!loading && !items.length && !archivedView && (
                <div className="ch-empty">
                  No conversations yet.
                  <button type="button" className="ch-empty-cta"
                          onClick={() => setShowNew(true)}>Start one</button>
                </div>
              )}

              {!loading && items.length > 0 && !shown.length && (
                <div className="ch-empty">
                  {needle ? `Nothing matches “${q}”.`
                    : tab === 'unread' ? 'Nothing unread. '
                    : 'No group conversations yet.'}
                  {!needle && tab === 'unread' && (
                    <button type="button" className="ch-empty-cta"
                            onClick={() => setTab('all')}>Show everything</button>
                  )}
                </div>
              )}

              {/* ── THE DEAD SPACE, PUT TO WORK ─────────────────────────
                  Two conversations left two thirds of the panel empty with no
                  suggestion of what to do next. This is not an "empty state" —
                  the list is not empty — so it sits UNDER the rows and only when
                  there are few of them. Above about six, the list is the answer
                  and this would be in the way. */}
              {groups.map((g) => (
                <Fragment key={g.key}>
                  {g.label && <div className="ch-group">{g.label}</div>}
                  {g.rows.map((c) => {
                const name = c.kind === 'group'
                  ? c.title
                  : (c.others?.[0]?.name || 'Direct message');
                const lm = c.last_message;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`ch-conv${c.id === openId ? ' ch-conv--on' : ''}`
                      + `${c.is_unread ? ' ch-conv--unread' : ''}`}
                    onClick={() => pick(c.id)}
                  >
                    {/* An avatar, so the rail can be scanned by shape instead of
                        read name by name. A group gets the glyph rather than
                        initials — "CT" for Call team means nothing, and stacking
                        four faces at 34px is four illegible faces. */}
                    <span className={`ch-conv-av${c.kind === 'group' ? ' ch-conv-av--grp' : ''}`}
                          aria-hidden="true">
                      {c.kind === 'group' ? <Users size={14} /> : initials(name)}
                    </span>

                    <span className="ch-conv-top">
                      <span className="ch-conv-name">
                        {c.pinned && <Pin size={11} className="ch-conv-pin" aria-label="Pinned" />}
                        {c.archived && <Lock size={11} aria-label="Archived" />}
                        {name}
                      </span>
                      <span className="ch-conv-when">{listStamp(lm?.created_at || c.created_at)}</span>
                    </span>
                    <span className="ch-conv-prev">
                      {/* A system event is rendered through the SAME function the
                          thread uses, so the row and the thread cannot end up
                          describing one event differently. */}
                      {!lm ? <em>No messages yet</em>
                        : lm.system_event ? <em>{systemPreview(lm, user?.id)}</em>
                        : lm.deleted ? <em>Message deleted</em>
                        : lm.preview
                          ? <>{lm.mine && <span className="ch-conv-you">You: </span>}
                              {lm.preview}{lm.truncated ? '…' : ''}</>
                          : lm.has_ref ? <em>Shared a record</em> : <em>&nbsp;</em>}
                    </span>
                    {c.is_unread && <span className="ch-conv-dot" aria-label="Unread" />}
                    {/* A span, not a nested <button>: this row IS a button, and a
                        button inside a button is invalid HTML that React will
                        render and the browser will then re-parent, moving the
                        control out of the row. Keyboard access is the row itself
                        plus the same action in the details panel. */}
                    <span role="button" tabIndex={-1} className="ch-conv-pinbtn"
                          onClick={(e) => togglePin(c, e)}
                          title={c.pinned ? 'Unpin' : 'Pin to the top'}
                          aria-label={c.pinned ? 'Unpin this conversation' : 'Pin this conversation'}>
                      {c.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                    </span>
                  </button>
                );
                  })}
                </Fragment>
              ))}

              {!loading && !archivedView && !needle && shown.length > 0 && shown.length < 6 && (
                <div className="ch-starter">
                  <span className="ch-starter-ic" aria-hidden="true">💬</span>
                  <span className="ch-starter-t">That&rsquo;s everyone you&rsquo;re talking to</span>
                  <span className="ch-starter-s">
                    Start a conversation, or share a record straight from the record itself.
                  </span>
                  <button type="button" className="ch-starter-cta" onClick={() => setShowNew(true)}>
                    New conversation
                  </button>
                </div>
              )}
            </div>
            </>)}
          </aside>
        )}

        {showDetail && (
          <section className="ch-pane">
            {isMobile && anyOpen && (
              <button type="button" className="ch-back"
                      onClick={() => navigate(isWa ? '/chat/wa' : '/chat')}>
                <ArrowLeft size={14} /> All conversations
              </button>
            )}
            {isWa ? (
              /* Keyed on the number: switching customers remounts the pane, so
                 the lead id it resolved for the last one cannot linger on the
                 Open Lead button for the next. */
              <WhatsAppPane
                key={waOpen?.mobile || 'none'}
                row={waOpen}
                onNavigateLead={(id) => navigate('/leads', { state: { openLeadId: id } })}
              />
            ) : (
              <ChatThread
                conversation={active ? { ...active, reloadSignal } : null}
                onChanged={load}
                canModerate={canModerate}
                meId={user?.id}
              />
            )}
          </section>
        )}
      </div>

      {showNew && (
        <ChatNewModal
          onClose={() => setShowNew(false)}
          onCreated={(id) => { setShowNew(false); load(); navigate(`/chat/${id}`); }}
        />
      )}
    </div>
  );
}
