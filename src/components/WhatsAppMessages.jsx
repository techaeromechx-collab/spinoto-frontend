import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';
import { useCan } from '../auth/AuthContext.jsx';
import {
  MessageCircle, Send, Loader2, AlertTriangle, RefreshCw, Check, CheckCheck, Clock, X,
} from 'lucide-react';

/**
 * WhatsAppMessages — the Messages tab for one record.
 *
 * Drops into the detail rail of any page that has an entity WhatsApp knows
 * about. One component rather than a copy per page, so the status vocabulary
 * and the send flow cannot drift between Appointments and Invoices.
 *
 *   <WhatsAppMessages entityType="appointment" entityId={appt.id} />
 *
 * ── The preview is the point of the send flow ────────────────────────────────
 *
 * Interakt cannot tell us the order of variables in an approved template, so
 * the mapping is transcribed by hand and a wrong one does not error. The
 * preview is the last moment a human can notice that position 4 is about to
 * carry a registration number where the customer expects a date. It is
 * therefore not skippable, and the send button does not appear until it has
 * loaded.
 */

const TEMPLATE_LABELS = {
  call_not_received:   'Call Not Received',
  appointment_created: 'Appointment Generated',
  pickup_received:     'Pickup Done & Received',
  service_completed:   'Service Completed',
  invoice_ready:       'Invoice / Bill',
};

const VAR_LABELS = {
  customer_name: 'Customer name', vehicle: 'Vehicle', reg_number: 'Registration',
  date: 'Date', time: 'Time', service_type: 'Service type',
  workshop_link: 'Workshop location', invoice_link: 'Invoice link', amount: 'Amount',
};

/**
 * Status is shown with WhatsApp's own vocabulary — one tick, two ticks, blue
 * ticks — because that is what the advisor sees on their own phone. A bespoke
 * set of words here would make them translate.
 */
function StatusChip({ m }) {
  const map = {
    queued:    { Icon: Clock,      color: '#6b7280', bg: '#f3f4f6', label: 'Queued' },
    sent:      { Icon: Check,      color: '#0891b2', bg: '#cffafe', label: 'Sent' },
    delivered: { Icon: CheckCheck, color: '#0f766e', bg: '#ccfbf1', label: 'Delivered' },
    read:      { Icon: CheckCheck, color: '#2563eb', bg: '#dbeafe', label: 'Read' },
    failed:    { Icon: X,          color: '#b91c1c', bg: '#fee2e2', label: 'Failed' },
    received:  { Icon: MessageCircle, color: '#7c3aed', bg: '#ede9fe', label: 'Reply' },
  };
  const s = map[m.status] || map.queued;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
      color: s.color, background: s.bg, whiteSpace: 'nowrap',
    }}>
      <s.Icon size={11} /> {s.label}
    </span>
  );
}

function when(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export default function WhatsAppMessages({ entityType, entityId }) {
  const canSend = useCan('SEND_WHATSAPP');

  const [items, setItems] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [picked, setPicked] = useState('');
  const [prev, setPrev] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!entityId) return;
    setLoading(true);
    try {
      const r = await api(`/api/whatsapp/messages?entity_type=${entityType}&entity_id=${entityId}`);
      setItems(r.items || []);
      setTemplates(r.available_templates || []);
      setErr(null);
    } catch (e) {
      setErr(e.message || 'Could not load messages');
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => { load(); }, [load]);

  // Picking a template immediately loads its preview. Deliberately not a
  // separate "Preview" button — an extra click before the safety check is an
  // extra click people learn to resent and then route around.
  useEffect(() => {
    if (!picked) { setPrev(null); return; }
    let cancelled = false;
    setPreviewing(true);
    api(`/api/whatsapp/messages/preview?entity_type=${entityType}&entity_id=${entityId}&template_key=${picked}`)
      .then(r => { if (!cancelled) setPrev(r); })
      .catch(e => { if (!cancelled) setPrev({ ok: false, reason: e.message }); })
      .finally(() => { if (!cancelled) setPreviewing(false); });
    return () => { cancelled = true; };
  }, [picked, entityType, entityId]);

  async function doSend() {
    setSending(true);
    try {
      await api('/api/whatsapp/messages/send', {
        method: 'POST',
        body: { entity_type: entityType, entity_id: entityId, template_key: picked },
      });
      setPicked('');
      setPrev(null);
      await load();
    } catch (e) {
      setErr(e.message || 'Could not send');
    } finally {
      setSending(false);
    }
  }

  async function doRetry(id) {
    try {
      await api(`/api/whatsapp/messages/${id}/retry`, { method: 'POST' });
      await load();
    } catch (e) {
      setErr(e.message || 'Retry failed');
    }
  }

  if (loading) {
    return <div style={{ padding: 14, color: '#6b7280', fontSize: 13 }}>
      <Loader2 size={14} className="spin" /> Loading messages…
    </div>;
  }

  const canActuallySend = prev?.ok && !prev.missing?.length && !previewing;

  return (
    <div style={{ padding: '4px 0' }}>
      {err && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
          borderRadius: 8, padding: '8px 10px', fontSize: 13, marginBottom: 10,
        }}>{err}</div>
      )}

      {/* ── Send ── */}
      {canSend && templates.length > 0 && (
        <div style={{
          border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 14,
        }}>
          <select
            value={picked}
            onChange={e => setPicked(e.target.value)}
            style={{
              fontSize: 13, padding: '6px 9px', borderRadius: 6,
              border: '1px solid #d1d5db', width: '100%',
            }}
          >
            <option value="">Send a message…</option>
            {templates.map(t => (
              <option key={t.template_key} value={t.template_key}>
                {TEMPLATE_LABELS[t.template_key] || t.template_key}
              </option>
            ))}
          </select>

          {previewing && (
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
              <Loader2 size={12} className="spin" /> Checking…
            </div>
          )}

          {prev && !previewing && !prev.ok && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#991b1b' }}>
              <AlertTriangle size={12} /> Cannot send: {prev.reason}
            </div>
          )}

          {prev?.ok && !previewing && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 5 }}>
                To {prev.to}
                {prev.fell_back_to_mobile && ' (mobile — no WhatsApp number saved)'}
              </div>
              {/* Read this before sending. It is the only check on the
                  hand-transcribed variable order. */}
              <div style={{
                background: '#f9fafb', border: '1px solid #f0f0f0',
                borderRadius: 8, padding: '8px 10px', fontSize: 12,
              }}>
                {prev.positions.map(p => (
                  <div key={p.position} style={{
                    display: 'flex', gap: 8, padding: '2px 0',
                    color: p.value == null ? '#b91c1c' : '#374151',
                  }}>
                    <span style={{ color: '#4338ca', fontWeight: 700, minWidth: 30 }}>
                      {`{{${p.position}}}`}
                    </span>
                    <span style={{ minWidth: 110, color: '#6b7280' }}>
                      {VAR_LABELS[p.key] || p.key}
                    </span>
                    <span style={{ fontWeight: 600 }}>
                      {p.value == null ? '— missing —' : String(p.value)}
                    </span>
                  </div>
                ))}
              </div>

              {prev.missing?.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#991b1b' }}>
                  <AlertTriangle size={12} /> {prev.missing.join(', ')} not available for this
                  record — sending would leave a blank line in the customer's message.
                </div>
              )}

              <button
                onClick={doSend}
                disabled={!canActuallySend || sending}
                style={{
                  marginTop: 10, display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 13, fontWeight: 600, padding: '7px 12px', borderRadius: 6,
                  border: '1px solid #0f766e', background: '#0f766e', color: '#fff',
                  cursor: canActuallySend ? 'pointer' : 'not-allowed',
                  opacity: canActuallySend && !sending ? 1 : 0.5,
                }}
              >
                {sending ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
                Send to customer
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── History ── */}
      {items.length === 0 && (
        <div style={{ fontSize: 13, color: '#9ca3af', padding: '6px 0' }}>
          No messages yet.
        </div>
      )}

      {items.map(m => (
        <div key={m.id} style={{
          borderBottom: '1px solid #f3f4f6', padding: '9px 0', fontSize: 13,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 13 }}>
              {m.direction === 'in'
                ? 'Customer reply'
                : (TEMPLATE_LABELS[m.template_key] || m.template_key)}
            </strong>
            <StatusChip m={m} />
            <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 'auto' }}>
              {when(m.read_at || m.delivered_at || m.sent_at || m.created_at)}
            </span>
          </div>

          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
            {m.to_number}
            {/* sent_by is NULL for automatic sends — that distinction is the
                first question anyone asks of a message log. */}
            {m.direction === 'out' && (m.sent_by_name ? ` · sent by ${m.sent_by_name}` : ' · automatic')}
          </div>

          {m.status === 'failed' && (
            <div style={{
              marginTop: 6, background: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: 6, padding: '6px 8px', fontSize: 12, color: '#991b1b',
            }}>
              <strong>{m.error_code}</strong> {m.error_message}
              {canSend && (
                <button
                  onClick={() => doRetry(m.id)}
                  style={{
                    marginLeft: 8, fontSize: 11, padding: '2px 8px', borderRadius: 5,
                    border: '1px solid #b91c1c', background: '#fff', color: '#b91c1c',
                    cursor: 'pointer',
                  }}
                >
                  <RefreshCw size={10} /> Retry
                </button>
              )}
            </div>
          )}

          {m.body_rendered && m.direction === 'in' && (
            <div style={{
              marginTop: 5, padding: '6px 9px', background: '#f5f3ff',
              borderRadius: 6, fontSize: 13, whiteSpace: 'pre-wrap',
            }}>{m.body_rendered}</div>
          )}
        </div>
      ))}

      <button
        onClick={load}
        style={{
          marginTop: 10, display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 12, padding: '5px 10px', borderRadius: 6,
          border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer',
        }}
      >
        <RefreshCw size={12} /> Refresh
      </button>
    </div>
  );
}
