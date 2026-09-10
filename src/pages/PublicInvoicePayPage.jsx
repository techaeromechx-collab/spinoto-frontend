/**
 * PublicInvoicePayPage — where the "Scan to Pay" code on a printed invoice lands.
 *
 * ── Why this page exists rather than a direct link to /pay ──────────────────
 *
 * A payment link expires in days and can be cancelled. A QR printed on an
 * invoice is in a glovebox for months. Those two facts cannot be reconciled by
 * printing a link, so the printed code carries the INVOICE's own permanent
 * token instead, and this page exchanges it for a live payment link at the
 * moment somebody actually scans.
 *
 * The exchange is a POST, not a GET: it can create a payment_links row. That
 * also keeps it out of a browser's prefetch, which would otherwise mint links
 * for invoices nobody opened.
 *
 * ── Why it renders anything at all ──────────────────────────────────────────
 *
 * It could redirect silently, and on the happy path it effectively does — the
 * spinner is on screen for one round trip. What it must not do is fail
 * silently: "already paid" and "cancelled" are the two answers a customer
 * standing at the counter most needs to read, and a blank page or a bounce to
 * the PDF would leave them unsure whether they owe money.
 *
 * Deliberately not styled with the app's CSS variables — a customer opening
 * this from a camera app never mounts AppShell, so var(--primary) resolves to
 * nothing. Same reason PublicPayPage carries its own literal.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const BRAND = '#16b994';

export default function PublicInvoicePayPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) return;
    // Guards against React 18 StrictMode's double-invoke in development, which
    // would otherwise fire two exchanges for one scan. Harmless on the server
    // (the second call reuses the same active link) but it makes the network
    // tab lie about what a real customer does.
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/public/pay/invoice/${encodeURIComponent(token)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' } }
        );
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error || 'This invoice cannot be paid online right now.');
          return;
        }
        // replace(), not push(): Back should return the customer to whatever
        // they came from, not to this page, which would immediately forward
        // them again and trap them.
        navigate(body.path || `/pay/${body.token}`, { replace: true });
      } catch {
        if (!cancelled) setError('Could not reach the server. Please check your connection and try again.');
      }
    })();

    return () => { cancelled = true; };
  }, [token, navigate]);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, background: '#f6f8f9',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{
        maxWidth: 380, width: '100%', background: '#fff', borderRadius: 14,
        padding: '28px 24px', textAlign: 'center',
        boxShadow: '0 1px 3px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.06)',
      }}>
        {error ? (
          <>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Nothing to pay here</div>
            <div style={{ fontSize: 14, color: '#555', lineHeight: 1.5 }}>{error}</div>
            {/* The invoice itself is always reachable, even when paying is not
                — a customer refused at this page still wants to see the bill. */}
            <a
              href={`/invoice/${encodeURIComponent(token || '')}`}
              style={{ display: 'inline-block', marginTop: 16, fontSize: 14, color: BRAND, fontWeight: 600 }}
            >
              View the invoice
            </a>
          </>
        ) : (
          <>
            <div style={{
              width: 28, height: 28, margin: '0 auto 14px', borderRadius: '50%',
              border: `3px solid ${BRAND}33`, borderTopColor: BRAND,
              animation: 'sp-pay-spin .8s linear infinite',
            }} />
            <div style={{ fontSize: 15, fontWeight: 600 }}>Opening secure payment…</div>
            <style>{'@keyframes sp-pay-spin{to{transform:rotate(360deg)}}'}</style>
          </>
        )}
      </div>
    </div>
  );
}
