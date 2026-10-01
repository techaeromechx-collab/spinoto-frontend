// The WhatsApp half of the Chat page.
//
// ══ WHY IT IS A SEPARATE FILE ═══════════════════════════════════════════════
//
// ChatPage.jsx is the team chat and works. Everything WhatsApp needs lives
// here so that adding it costs ChatPage a switch and one branch rather than a
// second set of state, a second fetch and a second rail interleaved through its
// existing one. If this feature is ever removed, deleting this file and six
// lines of ChatPage takes it out cleanly.
//
// ══ WHAT IS DELIBERATELY NOT HERE ═══════════════════════════════════════════
//
// The thread. WhatsAppThread already renders a customer conversation — bubbles,
// photos, the 24-hour window, templates once it has closed — and it is already
// on the lead page and the customer page. This pane WRAPS it and adds a header;
// it does not reimplement any of it. That is the whole reason the thread you
// see here and the thread inside a lead can never drift apart: they are one
// component reading one endpoint.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, ExternalLink, MessageCircle, Search, Users, X } from 'lucide-react';
import { api } from '../../api/client.js';
import useSync from '../../hooks/useSync.js';
import { listStamp } from '../../lib/dayLabel.js';
import { toNational } from '../../lib/phone.js';
import WhatsAppThread from '../WhatsAppThread.jsx';

/* One screen and a bit. Small enough that the first paint is quick on a phone,
   big enough that a desktop rail is not fetching again before you have moved. */
const PAGE = 30;

/**
 * How long this customer has been waiting for a reply — or null when they are
 * not waiting at all.
 *
 * ── Why this is the most useful thing on the row ────────────────────────────
 *
 * An unread count says how much they wrote. It does not say how long ago. Three
 * messages from somebody you answered two minutes ago is a conversation going
 * well; ONE message from somebody who wrote at nine this morning is a customer
 * being lost, and before this the two looked the same in the list.
 *
 * Only when the last message is THEIRS. If the last one is ours, the ball is in
 * their court and nobody is waiting on us — which is also why this reads
 * last_direction rather than the unread flag: a colleague may have read the
 * message without answering it, and the customer is still waiting either way.
 *
 * The tiers are a workshop's own clock, not a generic one: under a quarter of
 * an hour is simply "being handled", an hour is the point at which somebody
 * rings a competitor instead.
 */
function waitingFor(row) {
  if (!row || row.last_direction !== 'in' || !row.last_message_at) return null;
  const ms = Date.now() - new Date(row.last_message_at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;

  const mins = Math.floor(ms / 60000);
  if (mins < 2) return null;            // answered-in-a-moment is not "waiting"

  const h = Math.floor(mins / 60);
  const d = Math.floor(h / 24);
  const label = d >= 1 ? `${d}d` : h >= 1 ? `${h}h ${mins % 60}m` : `${mins}m`;
  const tone = mins >= 60 ? 'bad' : mins >= 15 ? 'warn' : 'ok';
  return { label, tone, mins };
}

/** Two letters, same rule the team rail uses, so both sides scan alike. */
function initials(name) {
  const s = String(name || '').trim();
  // A row with no name at all shows the number, and "+9" from "+91 98…" is
  // noise. The bubble glyph says "this is a conversation" without pretending
  // to be a person's initials.
  if (!s || /^[+\d\s()-]+$/.test(s)) return null;
  return s.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

/**
 * Team ⇄ WhatsApp.
 *
 * ── Why this is not another .ch-tab ─────────────────────────────────────────
 *
 * The rail already has All / Unread / Groups, and those FILTER one list. This
 * picks WHICH LIST. Putting a fourth button beside three filters would make
 * "WhatsApp" look like a filter of team chat, which is the one thing it is not.
 * So it is a segmented control, visually a different kind of control, sitting
 * above them.
 *
 * Each side carries its own unread count, because "who needs me" is the only
 * question somebody opens this page to ask and the answer is usually on one
 * side and not the other.
 */
export function ChatSourceSwitch({ source, onPick, teamUnread, waUnread }) {
  return (
    <div className="ch-src" role="tablist" aria-label="Team or WhatsApp">
      <button type="button" role="tab" aria-selected={source === 'team'}
              className={`ch-src-btn${source === 'team' ? ' ch-src-btn--on' : ''}`}
              onClick={() => onPick('team')}>
        <Users size={13} /> Team
        {teamUnread > 0 && <span className="ch-src-n">{teamUnread > 99 ? '99+' : teamUnread}</span>}
      </button>
      <button type="button" role="tab" aria-selected={source === 'wa'}
              className={`ch-src-btn${source === 'wa' ? ' ch-src-btn--on' : ''}`}
              onClick={() => onPick('wa')}>
        <MessageCircle size={13} /> WhatsApp
        {waUnread > 0 && <span className="ch-src-n">{waUnread > 99 ? '99+' : waUnread}</span>}
      </button>
    </div>
  );
}

/**
 * The customer conversation list.
 *
 * Fed by GET /api/whatsapp/inbox, which already returns every field shown here
 * and already applies the same visibility scope the WhatsApp dropdown in the
 * topbar uses. No new endpoint, and no second definition of who may see whom.
 *
 * ── Filtering is client side, and only client side ──────────────────────────
 * Same call the team rail makes, for the same reason: the list is capped at 50
 * rows and all of them are already here, so a round trip per keystroke would
 * buy nothing. Searching the whole history is a different feature.
 */
export function WhatsAppRail({ selected, onPick, onResolve, onCount }) {
  const [items, setItems]   = useState([]);
  const [counts, setCounts] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [more, setMore]     = useState(false);
  const [err, setErr]       = useState('');
  const [q, setQ]           = useState('');
  const [query, setQuery]   = useState('');   // q, after the debounce
  const [tab, setTab]       = useState('all');
  const listRef = useRef(null);
  /* Guards the scroll handler against firing a second page while the first is
     still in flight. State would be a render behind and let two fire. */
  const busy = useRef(false);

  /* 300ms. Long enough that typing a name is one request rather than nine,
     short enough that it still feels like the list is following you. */
  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  const url = useCallback((offset) => {
    const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (query) p.set('q', query);
    // Searching ignores the tab. Somebody typing a customer's name wants that
    // customer, not that customer if they also happen to be unread.
    else if (tab !== 'all') p.set('filter', tab);
    return `/api/whatsapp/inbox?${p}`;
  }, [query, tab]);

  const load = useCallback(async () => {
    busy.current = true;
    setLoading(true);
    try {
      const r = await api(url(0));
      setItems(r.items || []);
      setHasMore(!!r.has_more);
      // null while searching — the tabs describe the inbox, not the search, so
      // the previous numbers are kept rather than blanked.
      if (r.counts) setCounts(r.counts);
      setErr('');
    } catch (e) {
      setErr(e?.message || 'Could not load WhatsApp conversations.');
    } finally {
      setLoading(false); busy.current = false;
    }
  }, [url]);

  useEffect(() => { load(); }, [load]);

  /* ── The rest of the list, as it is scrolled to ───────────────────────────
     The 50-row ceiling this replaces was not a page: it was the end. On a day
     taking fifty customers an hour the list showed the last forty-five minutes
     and everything older was simply absent — not further down, GONE, and
     unsearchable with it. */
  const loadMore = useCallback(async () => {
    if (busy.current || !hasMore) return;
    busy.current = true;
    setMore(true);
    try {
      const r = await api(url(items.length));
      /* Concatenated by MOBILE rather than blindly: a message arriving between
         two pages shifts every row by one, and the same conversation would
         otherwise appear in both. */
      setItems(prev => {
        const seen = new Set(prev.map(x => x.mobile));
        return [...prev, ...(r.items || []).filter(x => !seen.has(x.mobile))];
      });
      setHasMore(!!r.has_more);
    } catch { /* the rows already on screen are still good */ }
    finally { setMore(false); busy.current = false; }
  }, [url, items.length, hasMore]);

  function onScroll(e) {
    const el = e.currentTarget;
    // 240px of runway, so the next page is usually there before the bottom is.
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) loadMore();
  }

  /* The socket topic the topbar dropdown uses. A customer message lands here
     without a refresh, and without this page inventing a second signal for an
     event that already has one.

     It reloads page ONE only. Re-fetching eight pages because somebody said
     hello would be a lot of database for one new row, and the new row belongs
     at the top anyway. */
  useSync(['wa_inbox'], load);

  useEffect(() => {
    function onVis() { if (document.visibilityState === 'visible') load(); }
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  /* ── Clearing the badge the moment it is read ─────────────────────────────
     WhatsAppThread tells the SERVER it has been read, then fires a
     `wa-conversation-read` event for anything on the page showing a count. The
     topbar dropdown has listened for it since it was added; this rail did not,
     so the number sat there over a conversation you were looking at until the
     next socket nudge or tab switch.

     ── The comparison is on the last ten digits, and it has to be ────────────
     The event carries what WhatsAppThread calls `national` — ten digits,
     9726316878 — while every row here carries E.164, +919726316878. A `===`
     between those two is false forever, which is a badge that never clears and
     no error anywhere to say why. */
  const clearUnreadFor = useCallback((mobileLike) => {
    const d = String(mobileLike || '').replace(/\D/g, '').slice(-10);
    if (d.length !== 10) return;
    let hit = false;
    setItems(prev => prev.map(x => {
      if (String(x.mobile || '').replace(/\D/g, '').slice(-10) !== d) return x;
      if (x.is_unread) hit = true;
      return { ...x, is_unread: false, unread_n: 0 };
    }));
    // The tab number has to come down with the row, or "Unread 3" sits above a
    // list with two unread rows in it.
    if (hit) setCounts(c => (c ? { ...c, unread: Math.max(0, c.unread - 1) } : c));
  }, []);

  useEffect(() => {
    const onRead = (e) => clearUnreadFor(e.detail?.mobile);
    window.addEventListener('wa-conversation-read', onRead);
    return () => window.removeEventListener('wa-conversation-read', onRead);
  }, [clearUnreadFor]);

  /* Reported upward so the switch's badge is this list's own number. Taken from
     the server's whole-inbox count, not from the rows loaded — a badge that
     grew as you scrolled would be describing your scrolling. */
  useEffect(() => { if (counts) onCount?.(counts.unread); }, [counts, onCount]);

  /* A deep link arrived with a number and nothing else — a refresh, or a link
     from a colleague. Once the list lands, hand the full row up so the header
     can show a name, a status and an owner instead of the number twice.

     Lost in the rewrite that added paging, and the browser test caught it: the
     header sat on the bare number forever. Restored, and now also covering the
     case where the conversation turns up on a LATER page, since `items` grows
     as the rail is scrolled. */
  useEffect(() => {
    if (!selected || !items.length) return;
    const hit = items.find(c => c.mobile === selected);
    if (hit) onResolve?.(hit);
  }, [items, selected, onResolve]);

  const TABS = [
    { key: 'all',        label: 'All',        count: counts?.all },
    { key: 'unread',     label: 'Unread',     count: counts?.unread },
    { key: 'unassigned', label: 'Unassigned', count: counts?.unassigned },
    { key: 'mine',       label: 'Mine',       count: counts?.mine },
  ];

  return (
    <>
      {/* Hidden while searching: a tab is a filter on the inbox and the search
          already replaced that filter, so leaving them lit would claim a
          narrowing that is not being applied. */}
      {!query && (
        <div className="ch-tabs" role="tablist" aria-label="Filter conversations">
          {TABS.map(t => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
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

      <div className="ch-rail-search">
        <Search size={13} />
        <input value={q} onChange={e => setQ(e.target.value)}
               placeholder="Search every conversation"
               aria-label="Search WhatsApp conversations" />
        {q && (
          <button type="button" className="ch-rail-clear" onClick={() => setQ('')}
                  aria-label="Clear search"><X size={12} /></button>
        )}
      </div>

      {err && <div className="ch-alert" role="alert">{err}</div>}

      <div className="ch-rail-list" ref={listRef} onScroll={onScroll}>
        {loading && <div className="ch-rail-loading">Loading…</div>}

        {!loading && !items.length && (
          <div className="ch-empty">
            {query ? `Nothing matches \u201c${query}\u201d.`
              : tab === 'unread' ? 'Nothing unread.'
              : tab === 'unassigned' ? 'Everything has an owner.'
              : tab === 'mine' ? 'Nothing is assigned to you.'
              : 'No WhatsApp conversations yet. They appear here when a customer messages you.'}
            {!query && tab !== 'all' && (
              <button type="button" className="ch-empty-cta" onClick={() => setTab('all')}>
                Show everything
              </button>
            )}
          </div>
        )}

        {items.map((c) => {
          const ini = initials(c.display_name);
          const waiting = waitingFor(c);
          return (
            <button key={c.mobile} type="button"
                    className={`ch-conv${c.mobile === selected ? ' ch-conv--on' : ''}`
                      + `${c.is_unread ? ' ch-conv--unread' : ''}`}
                    /* Cleared here as well as on the event. The event arrives
                       once the thread has mounted and its effect has run; the
                       click is now, and a count that lingers for even half a
                       second on the row you just pressed reads as not having
                       registered the press. */
                    onClick={() => { clearUnreadFor(c.mobile); onPick(c); }}>
              <span className="ch-conv-av ch-conv-av--wa" aria-hidden="true">
                {ini || <MessageCircle size={14} />}
              </span>

              <span className="ch-conv-top">
                <span className="ch-conv-name">{c.display_name}</span>
                <span className="ch-conv-when">{listStamp(c.last_message_at)}</span>
              </span>

              <span className="ch-conv-prev">
                {c.last_direction === 'out' && <span className="ch-conv-you">You: </span>}
                {c.last_message || <em>&nbsp;</em>}
              </span>

              {/* Its own line, above the chips. The chips say what this lead IS;
                  this says what is happening to it right now, and the two should
                  not have to be told apart by reading. */}
              {waiting && (
                <span className={`chw-wait chw-wait--${waiting.tone}`}>
                  <Clock size={10} /> waiting {waiting.label}
                </span>
              )}

              {/* The two facts an advisor needs before opening it: where the
                  lead stands, and whose it is. A number with NO lead is the
                  one worth marking — that is a customer who messaged and is
                  in nobody's pipeline, and it is invisible everywhere else. */}
              <span className="chw-chips">
                {c.lead_id
                  ? (c.lead_status && <span className="chw-chip chw-chip--st">{c.lead_status}</span>)
                  : <span className="chw-chip chw-chip--none">No lead yet</span>}
                {c.assigned_to_name
                  ? <span className="chw-chip chw-chip--who">{c.assigned_to_name}</span>
                  : <span className="chw-chip chw-chip--who">Unassigned</span>}
              </span>

              {/* A number, not a dot. One message and eleven messages are
                  different amounts of trouble and used to look identical.
                  Falls back to the dot if the server has not been updated —
                  unread_n is new, and an old response must not blank the
                  marker out entirely. */}
              {c.is_unread && (
                c.unread_n > 0
                  ? <span className="chw-n" aria-label={`${c.unread_n} unread`}>
                      {c.unread_n > 99 ? '99+' : c.unread_n}
                    </span>
                  : <span className="ch-conv-dot" aria-label="Unread" />
              )}
            </button>
          );
        })}

        {more && <div className="ch-rail-loading">Loading more…</div>}
        {!loading && !more && !hasMore && items.length > PAGE && (
          <div className="chw-end">That is all {items.length} of them.</div>
        )}
      </div>
    </>
  );
}

/**
 * The open conversation: a header, then the existing thread.
 *
 * ── Open Lead ───────────────────────────────────────────────────────────────
 *
 * Navigates to /leads with the id in router state, which is exactly what the
 * topbar WhatsApp dropdown already does. Deliberately not a second way of
 * opening a lead: the panel that appears is the one everybody already knows,
 * and if it changes, it changes in one place.
 *
 * A number with no lead gets a disabled button saying so rather than no button
 * at all. The absence IS the information — somebody messaged and nothing was
 * created for them — and a missing control says nothing.
 */
export function WhatsAppPane({ row, onNavigateLead }) {
  /* The lead can appear while the pane is open: the webhook creates one the
     moment the customer's message is processed, which may be seconds after the
     conversation first shows up. WhatsAppThread resolves it and reports it
     back, so the button goes live without a refresh.

     This holds one conversation's answer only. ChatPage keys this component on
     the number, so switching conversations remounts it and the state goes with
     it — rather than being cleared by hand during render, which is the kind of
     thing that works until somebody adds a second piece of state beside it. */
  const [resolvedLeadId, setResolvedLeadId] = useState(null);

  const leadId = row?.lead_id || resolvedLeadId || null;

  if (!row) {
    return (
      <div className="chw-blank">
        <MessageCircle size={26} />
        <p>Pick a conversation to read it.</p>
      </div>
    );
  }

  const ini = initials(row.display_name);

  return (
    <div className="chw-pane">
      <div className="chw-head">
        <span className="chw-head-l">
          <span className="ch-conv-av ch-conv-av--wa" aria-hidden="true">
            {ini || <MessageCircle size={14} />}
          </span>
          <span className="chw-head-id">
            <strong>{row.display_name}</strong>
            <span>
              {toNational(row.mobile) || row.mobile}
              {row.lead_status && <> · {row.lead_status}</>}
              {row.assigned_to_name && <> · {row.assigned_to_name}</>}
            </span>
          </span>
        </span>

        {leadId ? (
          <button type="button" className="chw-lead"
                  onClick={() => onNavigateLead(leadId)}>
            Open Lead <ExternalLink size={13} />
          </button>
        ) : (
          <span className="chw-lead chw-lead--none" aria-disabled="true"
                title="No lead was created for this number">
            No lead yet
          </span>
        )}
      </div>

      {/* The thread, unchanged — the same component the lead page renders. */}
      <div className="chw-thread">
        <WhatsAppThread
          mobile={row.mobile}
          entityType="lead"
          entityId={row.lead_id || null}
          onLeadResolved={setResolvedLeadId}
        />
      </div>
    </div>
  );
}
