/**
 * phone.js — number formatting for links and display.
 *
 * Mirrors backend/src/utils/phone.js. Two copies rather than a shared package
 * because the frontend needs this at render time and the backend needs it at
 * send time, and neither should reach across the boundary for a string helper.
 * They must agree; the backend one is the authority if they ever drift.
 *
 * ── The bug this replaces ────────────────────────────────────────────────────
 *
 * The wa.me links were built inline at each call site and had already diverged:
 *
 *   AppointmentsPage.jsx:623   `https://wa.me/91${digits}`   ← prefixes 91
 *   LeadsPage.jsx:537          `https://wa.me/${digits}`     ← does not
 *
 * So every lead WhatsApp button was opening wa.me/9876543210 — a number with
 * no country code, which WhatsApp cannot resolve. And the appointments version
 * double-prefixes any number already stored with its 91, producing
 * wa.me/919919876543210.
 *
 * Neither is fixable by editing one line, because the next person to add a
 * WhatsApp button writes a third variant. Hence one function.
 */

const CC = '91';
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/**
 * Reduce anything typed by an operator to a bare 10-digit national number,
 * or null when it is not a valid Indian mobile.
 */
export function toNational(raw) {
  if (raw === null || raw === undefined) return null;

  let digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;

  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 12 && digits.startsWith(CC)) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);

  return INDIAN_MOBILE.test(digits) ? digits : null;
}

/**
 * Click-to-chat URL, or null when the number cannot be messaged.
 *
 * Returning null rather than a best-effort URL is the point: a disabled button
 * tells the user the number is unusable, where a broken link tells them
 * WhatsApp is broken.
 */
export function waMeUrl(raw) {
  const national = toNational(raw);
  return national ? `https://wa.me/${CC}${national}` : null;
}

/**
 * The number to message for a record carrying both, preferring the dedicated
 * WhatsApp field and falling back to the mobile — which is what the UI has
 * always done, now in one place.
 */
export function waTarget({ whatsapp, mobile } = {}) {
  return waMeUrl(whatsapp) || waMeUrl(mobile);
}

/** '98765 43210' for display. Falls back to the raw string if unparseable. */
export function formatNational(raw) {
  const n = toNational(raw);
  return n ? `${n.slice(0, 5)} ${n.slice(5)}` : (raw ?? '');
}
