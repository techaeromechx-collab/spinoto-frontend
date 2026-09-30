import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import {
  X, Send, ChevronLeft, ChevronRight, AlertTriangle, CircleCheck, CircleX,
  ArrowRight, Package, Timer, ClipboardCheck, PenLine, Camera, Wrench,
  KeyRound, FileText, MessageSquareWarning, Clock,
} from 'lucide-react';
import '../styles/ActivityDrawer.css';

/* ═══════════════════════════════════════════════════════════════════════════
   The job card's history, as a drawer.

   ══ WHY IT IS NOT A SECTION ANY MORE ═════════════════════════════════════

   It used to be a full card in the right-hand column, holding open a panel's
   worth of height for something people look at when something has gone wrong
   and never otherwise. It also cost 200 rows on every single load of the job
   card — the biggest thing in that response — to fill a panel most people
   scrolled past.

   One icon in the header now, and the rows are fetched when somebody asks.

   ══ PAGED, WHICH IT NEVER WAS ════════════════════════════════════════════

   The old panel had a hard LIMIT 200 and no way past it, so a card worked for
   three weeks silently lost its own beginning — including the row that says
   what condition the vehicle arrived in. Page 2 exists now.

   ══ EVERY TYPE GETS A SENTENCE ═══════════════════════════════════════════

   `describe` is carried over intact from the panel and extended with the parts
   and labour events. A raw `gate:force` on a history a customer's lawyer might
   read is not a sentence, and a type nobody wrote a line for falls through to
   something readable rather than to a database string.
   ═══════════════════════════════════════════════════════════════════════ */

const STATUS_LABELS = {
  open: 'Open', inspection: 'Inspection', awaiting_estimate: 'Awaiting estimate',
  awaiting_approval: 'Awaiting approval', in_progress: 'Work in progress',
  on_hold: 'On hold', work_done: 'Work done', qc: 'Quality check',
  ready: 'Ready', delivered: 'Delivered', closed: 'Closed', cancelled: 'Cancelled',
};

/* Icon and tone per event. Three tones only: something was overridden or put
   on hold (warn), something was undone or refused (bad), everything else is
   just work happening. Colour here means "look at this", not "this is a
   different category of thing". */
const META = {
  status:               { Icon: ArrowRight,            tone: '' },
  opened:               { Icon: ClipboardCheck,        tone: '' },
  note:                 { Icon: MessageSquareWarning,  tone: '' },
  finding:              { Icon: MessageSquareWarning,  tone: '' },
  'complaint:add':      { Icon: MessageSquareWarning,  tone: '' },
  'complaint:remove':   { Icon: MessageSquareWarning,  tone: 'bad' },
  'technician:add':     { Icon: Wrench,                tone: '' },
  'technician:remove':  { Icon: Wrench,                tone: 'bad' },
  'item:absent':        { Icon: AlertTriangle,         tone: 'warn' },
  'media:add':          { Icon: Camera,                tone: '' },
  'media:remove':       { Icon: Camera,                tone: 'bad' },
  'inspection:start':   { Icon: ClipboardCheck,        tone: '' },
  'inspection:complete':{ Icon: CircleCheck,           tone: '' },
  'inspection:reopen':  { Icon: ClipboardCheck,        tone: 'warn' },
  'inspection:delete':  { Icon: CircleX,               tone: 'bad' },
  signature:            { Icon: PenLine,               tone: '' },
  'signature:remove':   { Icon: PenLine,               tone: 'bad' },
  'qc:override':        { Icon: AlertTriangle,         tone: 'warn' },
  damage:               { Icon: AlertTriangle,         tone: '' },
  'gate:pass':          { Icon: CircleCheck,           tone: '' },
  'gate:override':      { Icon: AlertTriangle,         tone: 'warn' },
  'gate:clear':         { Icon: CircleX,               tone: 'bad' },
  'gate:force':         { Icon: AlertTriangle,         tone: 'warn' },
  'invoice:override':   { Icon: FileText,              tone: 'warn' },
  gate_pass:            { Icon: KeyRound,              tone: '' },
  'gate_pass:revoke':   { Icon: KeyRound,              tone: 'bad' },
  'part:issued':        { Icon: Package,               tone: '' },
  'part:returned':      { Icon: Package,               tone: 'warn' },
  'part:billed':        { Icon: Package,               tone: '' },
  'part:removed':       { Icon: Package,               tone: 'bad' },
  'labour:logged':      { Icon: Timer,                 tone: '' },
  'labour:removed':     { Icon: Timer,                 tone: 'bad' },
};
const metaFor = t => META[t] || (String(t).startsWith('field:')
  ? { Icon: PenLine, tone: '' }
  : { Icon: Clock, tone: '' });

function describe(a) {
  const t = a.type;
  if (t === 'status')            return <>Status <b>{STATUS_LABELS[a.old_value] || a.old_value}</b> → <b>{STATUS_LABELS[a.new_value] || a.new_value}</b></>;
  if (t === 'opened')            return <>Job card opened</>;
  if (t === 'note')              return <>Note</>;
  if (t === 'finding')           return <>Finding recorded{a.note ? <> for “{a.note}”</> : null}</>;
  if (t === 'complaint:add')     return <>Complaint added</>;
  if (t === 'complaint:remove')  return <>Complaint removed</>;
  if (t === 'technician:add')    return <>{a.new_value} assigned</>;
  if (t === 'technician:remove') return <>{a.old_value} removed</>;
  if (t === 'item:absent')       return <><b>{a.new_value}</b> marked absent</>;
  if (t === 'media:add')         return <>Photo added</>;
  if (t === 'media:remove')      return <>Photo removed</>;
  if (t === 'inspection:start')    return <>{a.new_value === 'intake' ? 'Intake inspection' : 'Pre-delivery check'} started</>;
  if (t === 'inspection:complete') return <>{a.new_value === 'intake' ? 'Intake inspection' : 'Pre-delivery check'} completed</>;
  if (t === 'inspection:reopen')   return <>Inspection reopened</>;
  if (t === 'inspection:delete')   return <>Inspection deleted</>;
  if (t === 'signature')           return <>Signed</>;
  if (t === 'signature:remove')    return <>Signature removed: {a.old_value}</>;
  if (t === 'qc:override')         return <>QC signer rule overridden for <b>{a.new_value}</b></>;
  if (t === 'damage')              return <>Damage marks on {a.note}: {a.old_value} → <b>{a.new_value}</b></>;
  if (t === 'gate:pass')           return <><b>{a.new_value}</b> confirmed</>;
  if (t === 'gate:override')       return <><b>{a.new_value}</b> overridden</>;
  if (t === 'gate:clear')          return <><b>{a.old_value}</b> withdrawn</>;
  if (t === 'gate:force')          return <>Moved to <b>{STATUS_LABELS[a.new_value] || a.new_value}</b> past the compliance checks</>;
  if (t === 'invoice:override')    return <>A <b>{a.new_value}</b> was raised at {STATUS_LABELS[a.old_value] || a.old_value}, before Ready</>;
  if (t === 'gate_pass')           return <>Gate pass <b>{a.new_value}</b> issued</>;
  if (t === 'gate_pass:revoke')    return <>Gate pass <b>{a.old_value}</b> revoked</>;
  /* Phase 7. */
  if (t === 'part:issued')         return <>Part issued — <b>{a.new_value}</b></>;
  if (t === 'part:returned')       return <>Booked back into the store — <b>{a.new_value}</b></>;
  if (t === 'part:billed')         return <><b>{a.new_value}</b> attached to an estimate line</>;
  if (t === 'part:removed')        return <>Part row removed — {a.old_value}</>;
  if (t === 'labour:logged')       return <>Time logged — <b>{a.new_value}</b></>;
  if (t === 'labour:removed')      return <>Time entry removed — {a.old_value}</>;
  if (t.startsWith('field:'))      return <>{t.slice(6).replace(/_/g, ' ')} {a.old_value || '—'} → <b>{a.new_value || '—'}</b></>;
  return <>{t}</>;
}

const fmt = v => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
};

const PAGE = 25;

/**
 * @param jobCardId  the card whose history this is
 * @param code       its number, for the drawer's own header
 * @param canPost    may this user add a note — the same permission that lets
 *                   them edit the card
 * @param onClose    close it
 * @param onPosted   called after a note lands, so the card's badge count can
 *                   catch up without the drawer reaching into the card
 */
export default function ActivityDrawer({ jobCardId, code, canPost = true, onClose, onPosted }) {
  const [items, setItems]   = useState([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [note, setNote]     = useState('');
  const [busy, setBusy]     = useState(false);

  useEscapeClose(onClose);

  const load = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const r = await api(`/api/job-cards/${jobCardId}/activities?page=${p}&limit=${PAGE}`);
      setItems(r.items || []);
      setTotal(r.total || 0);
      setPage(p);
      setError('');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [jobCardId]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(1); }, [load]);

  /* The body scrolls, the page behind it must not. Restored on unmount rather
     than on close, so an unmount from any cause puts it back. */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  async function post(e) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api(`/api/job-cards/${jobCardId}/notes`, { method: 'POST', body: { note: note.trim() } });
      setNote('');
      /* Back to page 1: the note just written is the newest row, and leaving
         somebody on page 3 after writing one looks like it did not save. */
      await load(1);
      onPosted?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const start = total === 0 ? 0 : (page - 1) * PAGE + 1;
  const end   = Math.min(page * PAGE, total);

  /* A portal, so the drawer is positioned against the window rather than
     against whichever pane it was rendered inside — the detail pane is a
     scrolling box, and a fixed element inside a transformed ancestor is
     positioned against that ancestor, not the viewport. */
  return createPortal(
    <div className="ad-root" role="dialog" aria-modal="true" aria-label={`Activity for ${code || 'this job card'}`}>
      <div className="ad-scrim" onClick={onClose} />

      <aside className="ad-drawer">
        <header className="ad-hd">
          <div className="ad-hd-t">
            <strong>{code || 'Job card'}</strong>
            <span>Activity{total ? ` · ${total} ${total === 1 ? 'entry' : 'entries'}` : ''}</span>
          </div>
          <button type="button" className="ad-x" onClick={onClose}
                  title="Close" aria-label="Close activity">
            <X size={15} />
          </button>
        </header>

        {canPost && (
          <form className="ad-note" onSubmit={post}>
            <input value={note} placeholder="Add a note…" onChange={e => setNote(e.target.value)} />
            <button className="button secondary" disabled={busy || !note.trim()}>
              <Send size={13} /> Post
            </button>
          </form>
        )}

        {error && <div className="ad-err">{error}</div>}

        <div className="ad-body">
          {loading && items.length === 0 && <div className="ad-note-empty">Loading…</div>}
          {!loading && items.length === 0 && !error && (
            <div className="ad-note-empty">Nothing has happened on this card yet.</div>
          )}

          {items.map(a => {
            const { Icon, tone } = metaFor(a.type);
            return (
              <div className="ad-ev" key={a.id}>
                <span className={`ad-ev-i${tone ? ` ad-ev-i--${tone}` : ''}`}><Icon size={13} /></span>
                <div className="ad-ev-t">
                  <strong>{describe(a)}</strong>
                  {/* A finding's note IS its description, already printed above. */}
                  {a.note && a.type !== 'finding' && <em>{a.note}</em>}
                  <u>{a.created_by_name || 'System'} · {fmt(a.created_at)}</u>
                </div>
              </div>
            );
          })}
        </div>

        {total > PAGE && (
          <footer className="ad-ft">
            <span>{start}–{end} of {total}</span>
            <div className="ad-pg">
              <button type="button" onClick={() => load(page - 1)}
                      disabled={page <= 1 || loading} aria-label="Newer">
                <ChevronLeft size={14} />
              </button>
              <button type="button" onClick={() => load(page + 1)}
                      disabled={page >= pages || loading} aria-label="Older">
                <ChevronRight size={14} />
              </button>
            </div>
          </footer>
        )}
      </aside>
    </div>,
    document.body
  );
}
