/**
 * PublicPayPage — what a customer sees when they open a payment link.
 *
 * ── Who is reading this page ────────────────────────────────────────────────
 * Someone whose car was just serviced, on their phone, from a WhatsApp message.
 * The only question in their head is "is this real, and is it safe to put my
 * card in?" Every element here either answers that or gets out of the way.
 *
 * That is why there is no marketing copy. A line like "trusted by 1000+
 * workshops" is written for a workshop owner deciding whether to sign up — the
 * wrong reader — and it would sit in the most valuable space on the page while
 * the sentence that actually reassures a payer (the Razorpay attribution) got
 * pushed to the bottom.
 *
 * ── The workshop is named by the shared helper, not by this page ────────────
 * hub_label comes from hubLabel() on the server, the same function the invoice
 * PDF uses. So the page and the document in the customer's hand always name the
 * same business, and hub_name_mode: 'hidden' is respected rather than bypassed.
 *
 * ── What the link exposes ───────────────────────────────────────────────────
 * A payment URL gets forwarded. The summary here is amount, tax total and a
 * masked mobile — enough to recognise your own bill. The full itemised invoice
 * is one deliberate tap away, using the token that is ALREADY public: the same
 * one printed as a QR on the paper invoice and already sent over WhatsApp.
 *
 * ── Why it never says "paid" on its own ─────────────────────────────────────
 * The gateway's success handler runs in this browser and proves nothing. The
 * page stays in a "confirming" state until the backend verifies the signature,
 * and if that call fails it says so plainly — including "do not pay again",
 * because at that point the money may well have been taken and the webhook is
 * about to record it.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { openCheckout } from '../lib/razorpayCheckout.js';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const fmt = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

/**
 * Spinoto's brand colour, as a literal.
 *
 * The app's --primary holds the same value, but this page renders OUTSIDE the
 * authenticated shell that defines it — a customer opening a link on their
 * phone never mounts AppShell, so var(--primary) would resolve to nothing.
 *
 * If the brand green changes it changes in three places: this constant,
 * --primary in the app stylesheet, and BRAND_COLOR in lib/razorpayCheckout.js.
 */
const BRAND = '#16b994';

/**
 * The same green, ~30% darker, for the Pay button only.
 *
 * White on #16b994 scores 2.5:1; WCAG AA wants 4.5:1 for text this size, and
 * #0f8268 gives 4.8:1. Not box-ticking — this button is tapped on a phone held
 * at arm's length, often outdoors next to a car. Deliberately NOT applied to
 * the wordmark or the gateway's checkout window: a logo is not body text, and
 * the point was readability on one control, not a new brand colour.
 */
const BRAND_BUTTON = '#0f8268';

/**
 * The customer's own invoice.
 *
 * /invoice/<token> — the SAME address the WhatsApp message sends and the QR on
 * the printed invoice encodes. One document, one link, wherever the customer
 * meets it.
 *
 * Relative, because this page is served from that same site. And safe to use
 * from here, unlike the older /customer-invoices/<token>: that path doubles as
 * a staff deep link, so opening it while signed in falls through to the CRM and
 * a hub session gets redirected to /hub — a dashboard instead of an invoice.
 * /invoice/<token> is public unconditionally and means the same thing to
 * everyone.
 *
 * It resolves to the same PDF the API serves, via a page that also offers a
 * manual tap link — which matters on the Android browsers that decline to open
 * a PDF automatically and would otherwise show a blank screen.
 */
function invoiceUrl(token) {
  return token ? `/invoice/${encodeURIComponent(token)}` : null;
}

async function publicApi(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw new Error(data?.error || 'Something went wrong. Please try again.');
  return data;
}

export default function PublicPayPage() {
  const { token } = useParams();

  const [invoice, setInvoice] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  // loading → ready → paying → confirming → done | dead
  const [phase, setPhase] = useState('loading');
  const [err, setErr] = useState('');
  const [receipt, setReceipt] = useState(null);

  const load = useCallback(async () => {
    try {
      setInvoice(await publicApi(`/api/public/pay/${encodeURIComponent(token)}`));
      setPhase(p => (p === 'loading' ? 'ready' : p));
    } catch (e) {
      setLoadErr(e.message);
      setPhase('dead');
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function pay() {
    setErr(''); setPhase('paying');
    try {
      const order = await publicApi(`/api/public/pay/${encodeURIComponent(token)}/order`, { method: 'POST' });
      await openCheckout({
        order,
        customer: { name: invoice.customer_name },
        // 'Spinoto' in the checkout window too, so the brand does not change
        // between our page and the gateway's. See the note in the delivery
        // summary about the CARD STATEMENT descriptor, which is a separate
        // thing set on the Razorpay account, not here.
        company: { name: 'Spinoto', description: invoice.invoice_number },
        // Dismissed is not failed. Nothing was charged and there is nothing to
        // apologise for — calling this an error is the most common lie a
        // payment page tells.
        onClose: () => setPhase('ready'),
        onError: (message) => { setErr(message); setPhase('ready'); },
        onDone: async (resp) => {
          setPhase('confirming');
          try {
            const out = await publicApi(`/api/public/pay/${encodeURIComponent(token)}/verify`, {
              method: 'POST',
              body: {
                gateway_order_id: resp.gateway_order_id,
                gateway_payment_id: resp.gateway_payment_id,
                signature: resp.signature,
              },
            });
            setReceipt(out);
            setPhase('done');
          } catch (e) {
            setErr(
              'We could not confirm your payment straight away. If money has left your '
              + 'account it is safe and will be applied within a few minutes — please do '
              + 'NOT pay again. Contact us if you need it confirmed.'
            );
            setPhase('ready');
            load();     // the webhook may already have recorded it
          }
        },
      });
    } catch (e) {
      setErr(e.message);
      setPhase('ready');
    }
  }

  const S = styles;

  if (phase === 'loading') {
    return <Shell><p style={S.muted}>Loading…</p></Shell>;
  }

  if (phase === 'dead') {
    return (
      <Shell>
        <h1 style={S.h1}>This link isn't valid</h1>
        <p style={S.muted}>{loadErr}</p>
      </Shell>
    );
  }

  if (phase === 'done') {
    return (
      <Shell invoice={invoice}>
        <div style={{ ...S.badge, background: '#dcfce7', color: '#166534' }}>Payment received</div>
        <div style={S.amount}>{fmt(receipt.amount)}</div>
        <p style={S.muted}>
          Reference <strong>{receipt.reference}</strong><br />
          {receipt.fully_paid
            ? `${invoice.invoice_number} is now fully paid. Thank you.`
            : `Applied to ${invoice.invoice_number}. A balance is still outstanding.`}
        </p>
        {invoiceUrl(invoice.invoice_token) && (
          <a href={invoiceUrl(invoice.invoice_token)} target="_blank" rel="noopener noreferrer" style={S.linkBtn}>
            View invoice
          </a>
        )}
        <Support invoice={invoice} />
      </Shell>
    );
  }

  if (invoice.already_paid) {
    return (
      <Shell invoice={invoice}>
        <div style={{ ...S.badge, background: '#dcfce7', color: '#166534' }}>Already paid</div>
        <p style={S.muted}>
          {invoice.kind === 'advance'
            ? 'The full amount for this job has already been received. Nothing is due.'
            : `${invoice.invoice_number} has been paid in full. Nothing is due.`}
        </p>
        {invoiceUrl(invoice.invoice_token) && (
          <a href={invoiceUrl(invoice.invoice_token)} target="_blank" rel="noopener noreferrer" style={S.linkBtn}>
            View invoice
          </a>
        )}
        <Support invoice={invoice} />
      </Shell>
    );
  }

  const busy = phase === 'paying' || phase === 'confirming';

  // An ADVANCE is not a bill.
  //
  // The customer has not been invoiced yet — the workshop has quoted a job and
  // is asking for part of it up front. Calling it "Amount due" over an invoice
  // number that does not exist would be wrong on the one page where the person
  // is deciding whether this is genuine, and "why am I being invoiced for work
  // that hasn't happened?" is exactly the phone call this page exists to avoid.
  const isAdvance = invoice.kind === 'advance';
  // What THIS link asks for. On an invoice that is the balance; on an advance
  // it is the figure the workshop chose, which is deliberately less than the
  // job total.
  const askAmount = isAdvance ? Number(invoice.link_amount || 0) : invoice.balance;

  return (
    <Shell invoice={invoice}>
      <p style={S.forLine}>
        {isAdvance
          ? `Advance payment${invoice.vehicle_number ? ` for ${invoice.vehicle_number}` : ''}`
          : `Payment for ${invoice.invoice_number}`}
      </p>
      <div style={S.amount}>{fmt(askAmount)}</div>
      <p style={S.fine}>{isAdvance ? 'Advance amount' : 'Amount due'}</p>

      {/* Identity: enough for the customer to be sure this is their own bill. */}
      <div style={S.rows}>
        <Row label="Name" value={invoice.customer_name || '—'} />
        <Row label="Mobile" value={invoice.mobile || '—'} />
        {invoice.vehicle_number && <Row label="Vehicle" value={invoice.vehicle_number} />}
        {!isAdvance && <Row label="Invoice number" value={invoice.invoice_number} last />}
      </div>

      {/* What the money is for. Answers "why am I paying this?" without a tap,
          which is the question that otherwise becomes a phone call. */}
      {invoice.total != null && (
        <>
          <div style={S.sectionTitle}>{isAdvance ? 'Job summary' : 'Invoice summary'}</div>
          <div style={S.rows}>
            {invoice.subtotal_ex_gst != null && (
              <Row label="Services & parts" value={fmt(invoice.subtotal_ex_gst)} />
            )}
            {invoice.total_gst != null && Number(invoice.total_gst) > 0 && (
              // No percentage. GST is stored per line item and one job can mix
              // rates — printing a single "18%" here would be a wrong tax
              // figure on a page taking money.
              <Row label="GST" value={fmt(invoice.total_gst)} />
            )}
            <Row label={isAdvance ? 'Job total' : 'Invoice total'} value={fmt(invoice.total)} strong />
            {Number(invoice.amount_paid) > 0 && (
              <Row label={isAdvance ? 'Already advanced' : 'Already paid'}
                   value={`− ${fmt(invoice.amount_paid)}`} />
            )}
            <Row label={isAdvance ? 'Paying now' : 'Amount due'} value={fmt(askAmount)} accent last />
            {/* Said plainly. An advance leaves a balance, and a customer who
                thinks they have settled the job is a difficult conversation at
                collection time. */}
            {isAdvance && Number(invoice.total) > askAmount && (
              <Row label="Balance after this"
                   value={fmt(Number(invoice.total) - Number(invoice.amount_paid || 0) - askAmount)} last />
            )}
          </div>

          {invoiceUrl(invoice.invoice_token) && (
            <a href={invoiceUrl(invoice.invoice_token)} target="_blank" rel="noopener noreferrer" style={S.invoiceLink}>
              View full invoice →
            </a>
          )}
        </>
      )}

      {invoice.expires_at && <Expiry at={invoice.expires_at} />}

      {err && <div style={S.error}>{err}</div>}

      {phase === 'confirming' && (
        <div style={S.info}>
          {/* Named as a security step, not a slow network, so nobody closes the
              tab halfway through. */}
          Confirming your payment with the bank. Please don't close this page.
        </div>
      )}

      <button type="button" onClick={pay} disabled={busy}
              style={{ ...S.btn, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}>
        {phase === 'paying' ? 'Opening payment…'
          : phase === 'confirming' ? 'Confirming…'
          : `Pay ${fmt(askAmount)} securely`}
      </button>

      <div style={S.methods}>
        {/* Named in text rather than shown as brand marks. The card-network and
            UPI logos are trademarks with usage rules, and listing a method the
            gateway account may not have enabled promises something that will
            not appear at checkout. Words carry the same reassurance with
            neither problem. */}
        UPI · Cards · Net banking · Wallets
      </div>

      <div style={S.secure}>Secure payment powered by Razorpay</div>
      {/* "Spinoto", not the legal entity. Interpolating company_name here
          produced "…never reach Aeromechx Automotive Pvt. Ltd.." — the name
          already ends in a full stop and the sentence added a second one. */}
      <p style={S.fine}>
        Your card details are handled by the payment provider and never reach Spinoto.
      </p>

      <Support invoice={invoice} />
    </Shell>
  );
}

/** Card, logo and workshop header — shared by every state of the page. */
function Shell({ invoice, children }) {
  const S = styles;
  return (
    <div style={S.page}>
      <div style={S.card}>
        {/* The Spinoto mark, not company_settings.company_name.
            The company row holds the legal entity ("… Automotive Pvt. Ltd.") —
            correct on a tax invoice, wrong at the top of a payment page, where
            it reads as a business the customer has never heard of.
            /logo.svg is the same asset AppShell, LoginPage and LandingPage use,
            served as a static file so it needs no session to load. */}
        <img
          src="/logo.svg"
          alt="Spinoto"
          style={S.logo}
          // If the asset is ever missing, fall back to the wordmark rather than
          // a broken-image icon at the top of a page asking for money.
          onError={e => { e.currentTarget.style.display = 'none';
                          e.currentTarget.nextSibling.style.display = 'block'; }}
        />
        <div style={{ ...S.brand, display: 'none' }}>Spinoto</div>

        {/* hub_label is null when hub_name_mode is 'hidden' — the block
            disappears rather than falling back to a name the invoice would not
            print. */}
        {invoice?.hub_label && (
          <div style={S.hub}>
            <div style={S.hubName}>{invoice.hub_label}</div>
            {invoice.hub_location && <div style={S.hubLoc}>{invoice.hub_location}</div>}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}

function Row({ label, value, strong, accent, last }) {
  const S = styles;
  return (
    <div style={{ ...S.row, ...(last ? S.rowLast : null) }}>
      <span style={S.rowLabel}>{label}</span>
      <span style={{
        fontWeight: strong || accent ? 800 : 600,
        color: accent ? BRAND_BUTTON : 'inherit',
      }}>{value}</span>
    </div>
  );
}

/**
 * When the link stops working — the real timestamp, not an assumed end of day.
 *
 * Links expire seven days from the moment they are created, so one made at
 * 3:42 pm dies at 3:42 pm. Rounding that up to "11:59 PM" would leave someone
 * trying at 8 pm on the last day with a dead link and no explanation.
 */
function Expiry({ at }) {
  const d = new Date(at);
  const hoursLeft = (d - Date.now()) / 3600000;
  const soon = hoursLeft < 24;
  return (
    <div style={{ ...styles.expiry, ...(soon ? styles.expirySoon : null) }}>
      {soon ? 'This link expires soon — ' : 'Link valid until '}
      <strong>
        {d.toLocaleString('en-IN', {
          day: 'numeric', month: 'short', year: 'numeric',
          hour: 'numeric', minute: '2-digit', hour12: true,
        })}
      </strong>
    </div>
  );
}

/**
 * Who to call. Spinoto, never the workshop.
 *
 * Spinoto is the merchant of record — the money is in Spinoto's gateway
 * account, only Spinoto can refund it, and the workshop cannot see the
 * transaction in any system. Sending a payment problem to the hub means the hub
 * telling the customer to ring Spinoto anyway, one frustrated call later.
 */
function Support({ invoice }) {
  if (!invoice?.support_phone) return null;
  const S = styles;
  return (
    <div style={S.support}>
      <div style={S.supportLabel}>Need help with this payment?</div>
      <a href={`tel:${String(invoice.support_phone).replace(/\s+/g, '')}`} style={S.supportPhone}>
        {invoice.support_phone}
      </a>
    </div>
  );
}

// Inline styles on purpose: this page renders for people who are not logged in,
// on their own phones, and must not depend on the app's CSS variables — those
// are set by the authenticated shell this page never mounts inside.
const styles = {
  page: {
    minHeight: '100vh', display: 'grid', placeItems: 'center',
    background: '#f8fafc', padding: 16,
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', color: '#0f172a',
  },
  card: {
    width: '100%', maxWidth: 430, background: '#fff', borderRadius: 16,
    border: '1px solid #e2e8f0', padding: '24px 22px 20px', textAlign: 'center',
    boxShadow: '0 10px 34px rgba(15,23,42,.07)',
    // Without this, width:100% is the CONTENT box and the 22px side padding is
    // added on top — 44px wider than its container. Measured at 390px: the page
    // scrolled sideways by 7px. There is no app stylesheet resetting box-sizing
    // here, because this page renders outside the authenticated shell.
    boxSizing: 'border-box',
  },
  logo: { height: 30, width: 'auto', display: 'block', margin: '0 auto' },
  // Fallback only — hidden unless the logo asset fails to load.
  brand: { fontWeight: 800, fontSize: 19, letterSpacing: '-.01em', color: BRAND },

  hub: {
    marginTop: 14, paddingTop: 14, borderTop: '1px solid #e2e8f0',
  },
  hubName: { fontWeight: 700, fontSize: 15 },
  hubLoc: { fontSize: 12.5, color: '#64748b', marginTop: 2 },

  forLine: { fontSize: 13.5, fontWeight: 600, color: '#64748b', margin: '18px 0 0' },
  amount: { fontSize: 36, fontWeight: 800, margin: '6px 0 2px', letterSpacing: '-.02em' },
  h1: { fontSize: 18, margin: '14px 0 8px' },
  badge: {
    display: 'inline-block', padding: '4px 12px', borderRadius: 999,
    fontSize: 12, fontWeight: 800, marginTop: 16,
  },
  muted: { color: '#64748b', fontSize: 13.5, margin: '6px 0', lineHeight: 1.55 },
  fine: { color: '#94a3b8', fontSize: 11.5, margin: '8px 0 0', lineHeight: 1.5 },

  sectionTitle: {
    textAlign: 'left', fontSize: 11, fontWeight: 800, letterSpacing: '.05em',
    textTransform: 'uppercase', color: '#94a3b8', margin: '18px 0 6px',
  },
  rows: {
    textAlign: 'left', background: '#f8fafc', border: '1px solid #e2e8f0',
    borderRadius: 10, padding: '4px 14px', margin: '16px 0 0',
  },
  row: {
    display: 'flex', justifyContent: 'space-between', gap: 12,
    fontSize: 13, padding: '9px 0', borderBottom: '1px solid #e9eef4',
  },
  rowLast: { borderBottom: 'none' },
  rowLabel: { color: '#64748b', flexShrink: 0 },

  invoiceLink: {
    display: 'inline-block', marginTop: 10, fontSize: 12.5, fontWeight: 700,
    color: BRAND_BUTTON, textDecoration: 'none',
  },
  linkBtn: {
    display: 'inline-block', marginTop: 16, padding: '10px 18px', borderRadius: 9,
    border: `1px solid ${BRAND}55`, color: BRAND_BUTTON, background: '#e9faf5',
    fontSize: 13.5, fontWeight: 700, textDecoration: 'none',
  },

  expiry: {
    marginTop: 16, padding: '9px 12px', borderRadius: 8, fontSize: 12,
    background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569',
  },
  expirySoon: { background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' },

  btn: {
    width: '100%', padding: '14px 16px', borderRadius: 10, border: 'none',
    background: BRAND_BUTTON, color: '#fff', fontSize: 15, fontWeight: 700,
    marginTop: 16, boxSizing: 'border-box',   // same reason as .card
  },
  methods: { fontSize: 11.5, color: '#94a3b8', marginTop: 10, letterSpacing: '.01em' },
  secure: {
    marginTop: 16, paddingTop: 14, borderTop: '1px solid #e2e8f0',
    fontSize: 12.5, fontWeight: 600, color: '#475569',
  },

  support: {
    marginTop: 16, paddingTop: 14, borderTop: '1px solid #e2e8f0',
  },
  supportLabel: { fontSize: 12, color: '#64748b' },
  supportPhone: {
    display: 'inline-block', marginTop: 3, fontSize: 14, fontWeight: 700,
    color: BRAND_BUTTON, textDecoration: 'none',
  },

  error: {
    background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
    borderRadius: 8, padding: '10px 12px', fontSize: 12.5, textAlign: 'left',
    margin: '16px 0 0', lineHeight: 1.55,
  },
  info: {
    background: '#e9faf5', border: `1px solid ${BRAND}33`, color: '#0b6b57',
    borderRadius: 8, padding: '10px 12px', fontSize: 12.5, margin: '16px 0 0',
    lineHeight: 1.55, textAlign: 'left',
  },
};
