import { useState, useCallback, useEffect } from 'react';
import { MessageCircle, ChevronDown, Loader2, X, Pencil } from 'lucide-react';
import { api } from '../api/client.js';
import { useCan } from '../auth/AuthContext.jsx';
import '../styles/WhatsAppSendMenu.css';

/**
 * "Send on WhatsApp" — a header control, not a panel.
 *
 * WHY THIS EXISTS ALONGSIDE WhatsAppMessages.jsx
 * ──────────────────────────────────────────────
 * That component is a full tab: a picker, an always-visible preview block, the
 * whole message history and a Refresh button, laid out to fill a column. It is
 * the right thing on a record's WhatsApp tab and the wrong thing in a header
 * row, where the act is "send this to the customer" and everything else is
 * furniture. Putting it behind a button would attach a history log to a
 * one-click action.
 *
 * What is shared is the part that matters: the server contract. Both use
 * GET  /api/whatsapp/messages          (history + which templates apply)
 * GET  /api/whatsapp/messages/preview  (resolved values, before anything sends)
 * POST /api/whatsapp/messages/send
 *
 * WHY PREVIEW ALWAYS RUNS FIRST
 * ─────────────────────────────
 * wa_templates stores the variable ORDER by hand. Meta owns the body text and
 * this system owns only the list of values to slot into it, so a template
 * edited in Interakt without the order being re-transcribed sends the vehicle
 * where the amount should be, to a real customer, with no way to recall it.
 * The preview is the only place that mismatch is visible — so the button opens
 * it rather than firing.
 *
 * ONE TEMPLATE OR SEVERAL
 * ───────────────────────
 * The caller does not say. The server returns the templates mapped to this
 * entity type (wa_templates.entity_types, migration 147); with one the button
 * sends it directly, with several it opens a menu first. A page gaining a
 * second template therefore grows a dropdown on its own, with no edit here.
 */

/* Display names. Falls back to the template_key prettified, so a template added
   in Settings shows something readable before anyone updates this map. */
const TEMPLATE_LABELS = {
  call_not_received:      'Call Not Received',
  appointment_created:    'Appointment Generated',
  appointment_reschedule: 'Appointment Rescheduled',
  pickup_received:        'Pickup Done & Received',
  service_completed:      'Service Completed',
  invoice_ready:          'Invoice / Bill',
  advance_receipt:        'Advance Receipt',
  estimate_approval:      'Estimate — ask for approval',
  estimate_approve:       'Estimate — confirm approval',
};

function labelFor(key) {
  return TEMPLATE_LABELS[key]
    || String(key || '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

export default function WhatsAppSendMenu({
  entityType,
  entityId,
  /* Hub logins are excluded by the caller, not here: whether a hub may message
     a customer is a question about the page, not about this control. */
  disabled = false,
  showToast,
  onSent,
  /* ── The two props below exist for one caller: WhatsAppThread's closed bar ──
     In a header row this is an icon in a line of icons and needs no words. At
     the bottom of a chat panel, where the reply box normally is, an unlabelled
     icon is a mystery button in the one place a user is looking for an action —
     so `label` turns it into a stated one.

     `dropUp` matters more than it looks. The menu opens at top:100% by default;
     a button sitting on the bottom edge of a panel with overflow:hidden would
     open its menu straight into the clip and show nothing at all. */
  label = null,
  dropUp = false,
  /* Renders the template list flat, with no trigger button and no dropdown —
     for WhatsAppThread's Templates tab, where the tab IS the disclosure and a
     button that opens a menu inside an already-opened pane is one click of
     pure ceremony. Everything after the click is unchanged: the same preview,
     the same number check, the same send. */
  inline = false,
}) {
  const canSend = useCan('SEND_WHATSAPP');

  const [templates, setTemplates] = useState(null); // null = not loaded yet
  const [menuOpen, setMenuOpen]   = useState(false);
  const [picked, setPicked]       = useState('');

  const [open, setOpen]       = useState(false);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError]     = useState('');
  /* Confirms the send inside the dialog rather than relying on a toast.
     Two of the four host pages have no showToast to hand down, and threading
     one through their detail components would be a bigger edit than this
     feature — a silent close after pressing Send reads as nothing happened. */
  const [sentOk, setSentOk]   = useState(false);

  // The number the message will actually go to, and whether it is being edited.
  //
  // Seeded from the PREVIEW, not from the record's mobile: the dispatcher picks
  // the target (whatsapp number, else mobile) and typing the mobile in here by
  // hand would quietly override a customer's separate WhatsApp number.
  const [to, setTo]         = useState('');
  const [editTo, setEditTo] = useState(false);

  /* Which templates apply to this record. Loaded once when the control mounts
     rather than on click, so the button can render as a plain button or a
     split button without a flash of the wrong shape.

     A failure here is deliberately silent: a header button that renders an
     error banner because a list request failed is worse than a button that
     does nothing until pressed, and pressing it surfaces the real error. */
  useEffect(() => {
    if (!canSend || !entityId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api(`/api/whatsapp/messages?entity_type=${entityType}&entity_id=${entityId}`);
        if (!cancelled) setTemplates(r.available_templates || []);
      } catch {
        if (!cancelled) setTemplates([]);
      }
    })();
    return () => { cancelled = true; };
  }, [canSend, entityType, entityId]);

  const openPreview = useCallback(async (templateKey) => {
    setMenuOpen(false);
    setPicked(templateKey);
    setOpen(true); setPreview(null); setError(''); setLoading(true);
    setTo(''); setEditTo(false); setSentOk(false);
    try {
      const r = await api(
        `/api/whatsapp/messages/preview?entity_type=${entityType}&entity_id=${entityId}` +
        `&template_key=${encodeURIComponent(templateKey)}`
      );
      setPreview(r);
      setTo(r?.to || '');
      /* The server refuses a template that does not belong to this record type.
         It answers 200 in the preview's own shape rather than a 4xx, so a stale
         dropdown reads as an explained refusal rather than a broken screen. */
      if (r && r.ok === false && r.error) setError(r.error);
    } catch (e) {
      setError(e.message || 'Could not build the message preview.');
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  const send = useCallback(async () => {
    setSending(true); setError('');
    try {
      const typed = to.trim();
      /* `to` is sent ONLY when it differs from what the dispatcher resolved.
         Echoing the resolved number back would record every send as an override
         in wa_messages, and the log would stop being able to answer "did we
         message the number on file, or one somebody typed?". */
      const overridden = typed && typed !== (preview?.to || '');
      await api('/api/whatsapp/messages/send', {
        method: 'POST',
        body: {
          entity_type: entityType,
          entity_id: entityId,
          template_key: picked,
          ...(overridden ? { to: typed } : {}),
        },
      });
      setSentOk(true);
      showToast?.(overridden ? `Queued for ${typed}.` : 'Queued for WhatsApp.', 'success');
      onSent?.();
      /* Long enough to read, short enough not to be a step. The dialog is
         modal, so leaving it open would block the page on an acknowledgement
         nobody needs to give. */
      setTimeout(() => setOpen(false), 1500);
    } catch (e) {
      setError(e.message || 'Could not send.');
    } finally {
      setSending(false);
    }
  }, [entityType, entityId, picked, to, preview, showToast, onSent]);

  if (!canSend) return null;

  const list = templates || [];
  const only = list.length === 1 ? list[0].template_key : null;

  /* No enabled template for this record type is not an error state worth
     showing. It means nothing has been switched on in Settings → WhatsApp yet,
     and a disabled button with a tooltip nobody reads is just clutter. */
  /* …except inline, where this control IS the pane's content. Returning null
     there leaves the Templates tab looking broken rather than empty, so it says
     so instead. */
  if (templates !== null && list.length === 0) {
    return inline ? (
      <div className="wa-inline-empty">
        No WhatsApp template is enabled for this record type yet.
        <span>Settings → WhatsApp is where they are switched on.</span>
      </div>
    ) : null;
  }

  return (
    <>
      {inline ? (
        <div className="wa-inline">
          {templates === null
            ? <div className="wa-inline-empty">Loading templates…</div>
            : list.map(t => (
                <button
                  key={t.template_key}
                  type="button"
                  className="wa-menu-item"
                  onClick={() => openPreview(t.template_key)}
                >
                  <span>{labelFor(t.template_key)}</span>
                  {t.body_preview && <em>{t.body_preview}</em>}
                </button>
              ))}
        </div>
      ) : (
      <>
      {/* One template → a plain button. Several → the same button with a caret,
          because choosing which message goes to a customer should be a
          deliberate step and not a thing that happens on the way to a click. */}
      <span className={label ? 'wa-send wa-send--wide' : 'wa-send'}>
        <button
          type="button"
          className={label ? 'btn btn-ghost wa-send-btn wa-send-btn--wide' : 'btn btn-ghost wa-send-btn'}
          disabled={disabled || templates === null}
          onClick={() => (only ? openPreview(only) : setMenuOpen(v => !v))}
          title={only ? `Send "${labelFor(only)}" on WhatsApp` : 'Send on WhatsApp'}
          aria-label="Send on WhatsApp"
          aria-haspopup={only ? undefined : 'menu'}
          aria-expanded={only ? undefined : menuOpen}
        >
          <MessageCircle size={16} />
          {label && <span className="wa-send-label">{label}</span>}
          {!only && <ChevronDown size={12} className={menuOpen ? 'wa-chev wa-chev--on' : 'wa-chev'} />}
        </button>

        {menuOpen && (
          <>
            {/* Full-screen and under the menu: it catches the dismissing click
                so that click cannot also press what is beneath it. */}
            <div className="wa-menu-backdrop" onClick={() => setMenuOpen(false)} />
            <div className={dropUp ? 'wa-menu wa-menu--up' : 'wa-menu'} role="menu">
              {list.map(t => (
                <button
                  key={t.template_key}
                  type="button"
                  role="menuitem"
                  className="wa-menu-item"
                  onClick={() => openPreview(t.template_key)}
                >
                  <span>{labelFor(t.template_key)}</span>
                  {/* The registry's copy of the body. Stale the moment somebody
                      edits the template in Interakt, which is why it is a hint
                      here and the preview is the thing you check. */}
                  {t.body_preview && <em>{t.body_preview}</em>}
                </button>
              ))}
            </div>
          </>
        )}
      </span>
      </>
      )}

      {/* Outside the inline/trigger branch on purpose — the preview dialog is
          the same dialog either way, and duplicating it would be two dialogs
          to keep in step. */}
      {open && (
        <div className="modal-backdrop wsm-modal" onClick={() => !sending && setOpen(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <MessageCircle size={16} style={{ color: '#0f766e' }} /> Send on WhatsApp
              </h3>
              <button className="modal-close" disabled={sending} onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="wa-modal-body">
              <div className="wa-tpl">{labelFor(picked)}</div>

              {sentOk && (
                <div className="wa-ok">
                  Queued. It leaves within a minute — delivery shows on the record's WhatsApp history.
                </div>
              )}

              {loading && (
                <div className="wa-loading">
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Building the preview…
                </div>
              )}

              {error && <div className="wa-bad">{error}</div>}

              {!sentOk && preview && preview.ok !== false && (
                <>
                  {/* The destination, editable.
                      Read-only until you ask for it: the number on file is right
                      almost every time, and an open input box invites a typo into
                      the one field where a typo means the document goes to a
                      stranger. */}
                  <div className="wa-to">
                    <span className="wa-cap">Sending to</span>
                    {editTo ? (
                      <>
                        <input
                          className="form-input wa-num"
                          value={to}
                          maxLength={20}
                          inputMode="tel"
                          autoFocus
                          placeholder="+919812345678"
                          onChange={e => setTo(e.target.value)}
                        />
                        <span className="wa-note">
                          Include the country code. The server normalises it before sending, and
                          rejects a number it cannot read rather than guessing.
                          {to.trim() !== (preview.to || '') && (
                            <>
                              {' '}
                              <button type="button" className="wa-link" onClick={() => setTo(preview.to || '')}>
                                Use the number on file
                              </button>
                            </>
                          )}
                        </span>
                      </>
                    ) : (
                      <>
                        <div className="wa-torow">
                          <strong>{to || preview.to || '—'}</strong>
                          <button type="button" className="wa-link" onClick={() => setEditTo(true)}>
                            <Pencil size={11} /> Change
                          </button>
                        </div>
                        {preview.fell_back_to_mobile && (
                          <span className="wa-note">No separate WhatsApp number on file — using the mobile.</span>
                        )}
                      </>
                    )}
                    {/* Loud, because this is the case where the message reaches
                        somebody who is not the customer. */}
                    {to.trim() && to.trim() !== (preview.to || '') && (
                      <span className="wa-warn">
                        Not the number on this record — {preview.to || 'none on file'}.
                      </span>
                    )}
                  </div>

                  {/* Position order, because position IS the contract with the
                      approved template. Reading them top to bottom is how a
                      wrong mapping becomes visible. */}
                  <div className="wsm-vars">
                    {(preview.positions || []).map(p => (
                      <div key={p.position} className="wsm-var">
                        <span>{p.key.replace(/_/g, ' ')}</span>
                        <b>{p.value || '—'}</b>
                      </div>
                    ))}
                  </div>

                  {preview.missing?.length > 0 && (
                    <div className="wa-bad">
                      Cannot send — no value for {preview.missing.join(', ')}.
                      {preview.missing.some(k => k.endsWith('_link'))
                        ? ' PUBLIC_APP_URL is not set on the server, so there is no address to send.'
                        : ''}
                    </div>
                  )}
                </>
              )}

              <div className="wsm-actions">
                <button className="btn btn-ghost" disabled={sending} onClick={() => setOpen(false)}>
                  {sentOk ? 'Close' : 'Cancel'}
                </button>
                <button
                  className="btn btn-primary"
                  disabled={sentOk || sending || loading || !preview?.ok
                            || preview?.missing?.length > 0
                            /* Blanking the field is not "send to the number on
                               file" — it is an unfinished edit. */
                            || !to.trim()}
                  onClick={send}
                >
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
