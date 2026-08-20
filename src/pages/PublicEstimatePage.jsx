import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

/**
 * PublicEstimatePage — what a customer sees when they open the estimate link
 * from their WhatsApp message.
 *
 * Mounted at /estimates/:token, the same path as the staff deep link and gated
 * on `!loading && !user` — see App.jsx, next to the invoice page. Staff logged
 * in get EstimatesPage; a customer with no session gets this.
 *
 * ── Designed for a phone, one-handed, on mobile data ─────────────────────────
 *
 * Nearly every visit arrives by tapping a WhatsApp link. So: one column, large
 * touch targets, no framework chrome, and the total visible without scrolling
 * past the line items — the price is what they came for.
 *
 * ── The decision is deliberately a two-step ──────────────────────────────────
 *
 * Tapping Approve does not approve. It reveals a 4-digit field, and only then a
 * confirm button. That is not friction for its own sake: this link can be
 * forwarded, and a single tap committing someone else's household to ₹15,000 of
 * work is the failure this page exists to prevent. Viewing asks for nothing.
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const money = (v) =>
  v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

const BLOCKED_MSG = {
  already_decided: 'You have already answered this estimate.',
  expired: 'This estimate has expired. Please contact us for an updated one.',
  not_pending: 'This estimate is no longer awaiting your approval.',
};

/**
 * What a non-pending estimate actually means, in the customer's words.
 *
 * Reached when someone opens their link after the decision was already made —
 * most often because staff recorded it over the phone. The old copy said only
 * that it was "no longer awaiting your approval", which tells them nothing
 * about what was agreed or what happens next.
 */
const APPROVED_STATUSES = {
  fully_approved:     'This estimate has been approved and the work is booked in. You can download a copy below.',
  partially_approved: 'Part of this estimate has been approved. The lines we are carrying out are ticked above.',
  work_in_progress:   'Work on your vehicle is under way.',
  work_completed:     'The work on this estimate has been completed.',
  revision_requested: 'This estimate was declined and our team is preparing a revised one.',
  pending_company_review: 'This estimate is being reviewed by our team. We will send it to you shortly.',
  draft:              'This estimate is not ready yet. Our team will send it to you shortly.',
};

export default function PublicEstimatePage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  // null = neither pressed. Pressing one reveals the confirm step.
  const [intent, setIntent] = useState(null);
  /**
   * Per-item choice, keyed by item id.
   *
   * PRE-TICKED as approved, deliberately. The customer asked for this estimate;
   * "do all of it" is the expected answer and declining is the exception.
   * Making them tick four boxes to agree to work they requested is friction
   * that costs approvals.
   *
   * That is only safe because the state is VISIBLE and priced: every line shows
   * its tick, the total below recalculates as lines are dropped, and the
   * confirm button carries the amount. A silent default nobody can see would be
   * a different thing entirely.
   */
  const [picked, setPicked] = useState(null);
  const [last4, setLast4] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [formErr, setFormErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/public/documents/estimate/${encodeURIComponent(token)}`)
      .then(async r => {
        if (!r.ok) throw new Error(r.status === 404 ? 'not_found' : 'load_failed');
        return r.json();
      })
      .then(d => {
        if (cancelled) return;
        setData(d);
        // Seeded once, from the server's own item list. An item already decided
        // keeps that decision rather than being silently re-ticked.
        setPicked(Object.fromEntries((d.items || []).map(it => [
          it.id, it.customer_approved === false ? false : true,
        ])));
      })
      .catch(e => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  async function submit() {
    setBusy(true);
    setFormErr(null);
    try {
      const r = await fetch(`${API_URL}/api/public/documents/estimate/${encodeURIComponent(token)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Every line, every time. The server refuses a partial payload — an
        // item left out would stay NULL, and a NULL reads as "still waiting on
        // the customer", so the estimate would look unanswered.
        body: JSON.stringify({
          approvals: (data.items || []).map(it => ({
            item_id: it.id,
            approved: intent === 'rejected' ? false : !!picked[it.id],
          })),
          last4,
          comment: comment || null,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || 'Could not submit');
      setDone(body.decision || intent);
    } catch (e) {
      setFormErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Shell><p style={S.muted}>Loading your estimate…</p></Shell>;

  if (err) {
    return (
      <Shell>
        <p style={{ ...S.muted, color: '#b91c1c' }}>
          {err === 'not_found'
            ? 'This estimate link is not valid. Please check the link in your message.'
            : 'Could not load the estimate. Please try again in a moment.'}
        </p>
      </Shell>
    );
  }

  const { estimate: e, items = [], decision } = data;

  // Success replaces the decision block, not the estimate — the customer will
  // want to re-read what they just agreed to.
  const decided = done || decision.source;
  // Lines are only interactive while a decision is still open. Once answered —
  // by the customer or by staff in the CRM — they become a record of what was
  // agreed, not a form.
  const selectable = !decided && decision.can_decide && picked;
  const pickedTotal = (items || []).reduce(
    (sum, it) => sum + (picked?.[it.id] ? Number(it.total_inc_gst || 0) : 0), 0);
  const pickedCount = (items || []).filter(it => picked?.[it.id]).length;

  return (
    <Shell>
      <div style={S.card}>
        <div style={S.rowBetween}>
          <div>
            <div style={S.label}>Estimate</div>
            <div style={S.big}>#{e.number}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={S.label}>Total</div>
            <div style={{ ...S.big, color: '#0f766e' }}>{money(e.grand_total)}</div>
          </div>
        </div>

        <div style={S.sep} />

        <Row k="Customer" v={e.customer_name} />
        <Row k="Vehicle" v={[e.vehicle, e.vehicle_number].filter(Boolean).join(' · ')} />
        <Row k="Workshop" v={e.hub_name} />
        <Row k="Date" v={e.date ? new Date(e.date).toLocaleDateString('en-IN', {
          day: 'numeric', month: 'long', year: 'numeric',
        }) : null} />
      </div>

      <div style={S.card}>
        <div style={S.cardTitle}>Services & parts</div>
        {selectable && (
          <p style={{ ...S.muted, marginTop: -4, marginBottom: 10, fontSize: 13 }}>
            Everything is selected. Untick anything you don't want and the total updates.
          </p>
        )}
        {items.map(it => {
          const on = selectable ? !!picked?.[it.id] : it.customer_approved !== false;
          return (
            <label
              key={it.id}
              style={{
                ...S.item,
                ...(selectable ? { cursor: 'pointer' } : null),
                // A dropped line stays readable rather than vanishing — the
                // customer needs to see what they declined, and be able to put
                // it back.
                opacity: on ? 1 : 0.5,
              }}
            >
              {selectable && (
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy}
                  onChange={ev => setPicked(pk => ({ ...pk, [it.id]: ev.target.checked }))}
                  style={{ width: 18, height: 18, flexShrink: 0, marginRight: 12, accentColor: '#0f766e' }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...S.itemName, textDecoration: on ? 'none' : 'line-through' }}>
                  {it.description}
                </div>
                {Number(it.quantity) !== 1 && (
                  <div style={S.itemQty}>Qty {it.quantity}</div>
                )}
                {!selectable && it.customer_approved === false && (
                  <div style={{ ...S.itemQty, color: '#b91c1c' }}>Not approved</div>
                )}
              </div>
              <div style={{ ...S.itemAmt, textDecoration: on ? 'none' : 'line-through' }}>
                {money(it.total_inc_gst)}
              </div>
            </label>
          );
        })}

        <div style={S.sep} />
        <Row k="Subtotal" v={money(e.subtotal_ex_gst)} />
        <Row k="GST" v={money(e.total_gst)} />
        <div style={{ ...S.rowBetween, marginTop: 8, fontWeight: 700, fontSize: 16 }}>
          <span>Total</span><span style={{ color: '#0f766e' }}>{money(e.grand_total)}</span>
        </div>

        {/* The number they are actually agreeing to. Shown only when it differs
            from the estimate total, so an untouched estimate is not cluttered
            with two identical figures — and impossible to miss when it does
            differ, which is the moment it matters. */}
        {selectable && pickedTotal !== Number(e.grand_total) && (
          <div style={{
            ...S.rowBetween, marginTop: 10, paddingTop: 10,
            borderTop: '1px dashed #d1d5db', fontWeight: 800, fontSize: 16,
          }}>
            <span>You are approving</span>
            <span style={{ color: '#0f766e' }}>{money(pickedTotal)}</span>
          </div>
        )}

        <a
          href={`${API_URL}/api/public/documents/estimate-pdf/${encodeURIComponent(token)}`}
          style={S.pdfLink}
        >
          Download PDF
        </a>
      </div>

      {e.notes && (
        <div style={S.card}>
          <div style={S.cardTitle}>Notes</div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: '#374151' }}>{e.notes}</p>
        </div>
      )}

      {/* ── Decision ── */}
      {decided ? (
        <div style={{
          ...S.card,
          background: decided === 'rejected' ? '#fef2f2' : '#f0fdf4',
          borderColor: decided === 'rejected' ? '#fecaca' : '#bbf7d0',
          textAlign: 'center',
        }}>
          <div style={{
            fontSize: 17, fontWeight: 700,
            color: decided === 'rejected' ? '#991b1b' : '#166534',
          }}>
            {decided === 'rejected' ? 'Estimate rejected' : 'Estimate approved'}
          </div>
          <p style={{ ...S.muted, marginTop: 6 }}>
            {decided === 'rejected'
              ? 'Thank you — our team will call you to discuss it.'
              : 'Thank you! We will begin work on your vehicle.'}
          </p>
          {decision.decided_at && !done && (
            <p style={{ ...S.muted, fontSize: 12 }}>
              on {new Date(decision.decided_at).toLocaleString('en-IN', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
              })}
            </p>
          )}
        </div>
      ) : !decision.can_decide ? (
        <div style={{ ...S.card, background: '#fffbeb', borderColor: '#fde68a' }}>
          {/* "No longer awaiting your approval" told the customer nothing. The
              status says what actually happened — most often that staff
              approved it over the phone — and the estimate above already shows
              which lines were taken. The PDF stays downloadable either way. */}
          <p style={{ margin: 0, fontSize: 14, color: '#92400e' }}>
            {decision.blocked_reason === 'not_pending' && APPROVED_STATUSES[e.status]
              ? APPROVED_STATUSES[e.status]
              : BLOCKED_MSG[decision.blocked_reason] || 'This estimate cannot be answered online.'}
          </p>
        </div>
      ) : (
        <div style={S.card}>
          <div style={S.cardTitle}>Your decision</div>

          {!intent ? (
            <div style={{ display: 'grid', gap: 9 }}>
              {/* The amount is IN the label, not only in the summary above.
                  Whatever they tap, the number they agreed to is on the button
                  they tapped — which is the sentence that settles a dispute
                  months later. */}
              <button
                style={{ ...S.approve, ...(pickedCount === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : null) }}
                disabled={pickedCount === 0}
                onClick={() => setIntent('approved')}
              >
                {pickedCount === 0
                  ? 'Nothing selected'
                  : pickedCount === items.length
                    ? `Approve everything — ${money(pickedTotal)}`
                    : `Approve ${pickedCount} of ${items.length} — ${money(pickedTotal)}`}
              </button>
              {/* One tap, rather than unticking every line and then confirming.
                  Refusing the whole estimate is a clear decision and deserves a
                  clear control. */}
              <button style={S.reject} onClick={() => setIntent('rejected')}>
                I don't want any of this
              </button>
            </div>
          ) : (
            <>
              <p style={{ ...S.muted, marginTop: 0 }}>
                {intent === 'rejected' ? (
                  <>You are about to <strong>decline this estimate</strong>. Your booking will be
                  cancelled and our team will call you. Please confirm it is you.</>
                ) : pickedCount === items.length ? (
                  <>You are about to approve <strong>all {items.length} items</strong> — {' '}
                  <strong>{money(pickedTotal)}</strong>. Please confirm it is you.</>
                ) : (
                  <>You are about to approve <strong>{pickedCount} of {items.length} items</strong> — {' '}
                  <strong>{money(pickedTotal)}</strong>. We will not carry out the rest.
                  Please confirm it is you.</>
                )}
              </p>

              <label style={S.fieldLabel}>Last 4 digits of your mobile number</label>
              <input
                inputMode="numeric"
                maxLength={4}
                value={last4}
                onChange={ev => setLast4(ev.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                style={S.otpInput}
              />

              <label style={S.fieldLabel}>
                {intent === 'rejected' ? 'What is the reason?' : 'Anything to add? (optional)'}
              </label>
              <textarea
                rows={3}
                value={comment}
                onChange={ev => setComment(ev.target.value)}
                maxLength={1000}
                style={S.textarea}
              />

              {formErr && (
                <p style={{ color: '#b91c1c', fontSize: 13, margin: '8px 0 0' }}>{formErr}</p>
              )}

              <button
                onClick={submit}
                disabled={busy || last4.length !== 4}
                style={{
                  ...(intent === 'approved' ? S.approve : S.reject),
                  marginTop: 12,
                  opacity: busy || last4.length !== 4 ? 0.5 : 1,
                }}
              >
                {busy ? 'Sending…'
                  : intent === 'rejected'
                    ? 'Confirm — decline everything'
                    /* The amount again, on the button that actually commits. */
                    : `Confirm approval — ${money(pickedTotal)}`}
              </button>
              <button
                onClick={() => { setIntent(null); setFormErr(null); }}
                style={S.cancel}
              >
                Back
              </button>
            </>
          )}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.01em' }}>Spinoto</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Mechanic in Minutes</div>
        </div>
        {children}
        <p style={{ ...S.muted, textAlign: 'center', marginTop: 20, fontSize: 12 }}>
          Questions? Call us on <a href="tel:7480033800" style={{ color: '#0f766e' }}>7480033800</a>
        </p>
      </div>
    </div>
  );
}

function Row({ k, v }) {
  if (!v) return null;
  return (
    <div style={S.rowBetween}>
      <span style={S.muted}>{k}</span>
      <span style={{ fontSize: 14, fontWeight: 500, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

const S = {
  page: {
    minHeight: '100vh', background: '#f6f7f9', padding: '22px 14px 40px',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    color: '#111827',
  },
  wrap: { maxWidth: 480, margin: '0 auto' },
  card: {
    background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
    padding: 16, marginBottom: 12,
  },
  cardTitle: {
    fontSize: 11, fontWeight: 700, color: '#6b7280',
    textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10,
  },
  rowBetween: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    gap: 12, padding: '4px 0', fontSize: 14,
  },
  label: { fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em' },
  big: { fontSize: 19, fontWeight: 700, marginTop: 2 },
  sep: { height: 1, background: '#f0f0f0', margin: '12px 0' },
  muted: { color: '#6b7280', fontSize: 13, lineHeight: 1.55, margin: 0 },
  item: { display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid #f7f7f8' },
  itemName: { fontSize: 14, lineHeight: 1.4 },
  itemQty: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  itemAmt: { fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' },
  pdfLink: {
    display: 'block', textAlign: 'center', marginTop: 14, padding: '9px',
    border: '1px solid #e5e7eb', borderRadius: 9, fontSize: 13,
    fontWeight: 600, color: '#374151', textDecoration: 'none',
  },
  fieldLabel: {
    display: 'block', fontSize: 12, fontWeight: 600,
    color: '#374151', margin: '12px 0 5px',
  },
  otpInput: {
    width: '100%', boxSizing: 'border-box', fontSize: 22, letterSpacing: '.4em',
    textAlign: 'center', padding: '11px', borderRadius: 10,
    border: '1px solid #d1d5db', fontFamily: 'inherit',
  },
  textarea: {
    width: '100%', boxSizing: 'border-box', fontSize: 14, padding: '10px',
    borderRadius: 10, border: '1px solid #d1d5db', fontFamily: 'inherit', resize: 'vertical',
  },
  // 46px tall: a comfortable thumb target, which matters more here than
  // anywhere else in the product.
  approve: {
    width: '100%', height: 46, borderRadius: 10, border: 'none',
    background: '#0f766e', color: '#fff', fontSize: 15, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  reject: {
    width: '100%', height: 46, borderRadius: 10,
    border: '1px solid #d1d5db', background: '#fff', color: '#b91c1c',
    fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  cancel: {
    width: '100%', marginTop: 8, padding: '9px', border: 'none',
    background: 'none', color: '#6b7280', fontSize: 13, cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
