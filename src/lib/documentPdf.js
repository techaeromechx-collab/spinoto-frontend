// Opens a server-rendered themed PDF for any of the three document types.
//
// Replaces window.print() of the on-screen layout. window.print() rendered
// whatever the browser had on screen, which meant three separately-maintained
// print stylesheets that ignored the company's theme, logo and colour
// entirely. The server renders the same templates for every document, so what
// you see in Document Settings is what actually comes out.
//
// Uses an authenticated fetch rather than window.open(url) because the
// endpoint requires a Bearer token, which a plain navigation can't send.
import { API_URL, getToken } from '../api/client.js';
import { isDesktop } from '../utils/isDesktop.js';

const PATHS = {
  estimate: 'estimates',
  customer_invoice: 'customer-invoices',
  purchase_invoice: 'purchase-invoices',
};

/**
 * The server's filename, out of the Content-Disposition header.
 *
 * Reads `filename*` first: that's the RFC 5987 form, percent-encoded UTF-8, and
 * the only one that survives a non-ASCII vehicle model. The plain `filename` is
 * the transliterated fallback for older clients.
 *
 * Returns null when the header is missing or unreadable — most likely because
 * `Content-Disposition` isn't in the API's CORS exposedHeaders, since the
 * frontend and API sit on different origins in development.
 */
function filenameFromResponse(res) {
  const cd = res.headers.get('Content-Disposition');
  if (!cd) return null;

  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star) {
    try { return decodeURIComponent(star[1].trim()); } catch { /* fall through */ }
  }
  const plain = /filename="([^"]+)"/i.exec(cd) || /filename=([^;]+)/i.exec(cd);
  return plain ? plain[1].trim() : null;
}

/**
 * A filename Windows will actually accept.
 *
 * The browser never needed this — `<a download>` sanitises for you. Writing to
 * a real filesystem does not. Windows rejects \ / : * ? " < > | outright, and
 * the server's name is built from customer and vehicle data, so a registration
 * like "GJ-01/AB 1234" is not hypothetical.
 */
function safeFileName(name) {
  return (name || 'document.pdf')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * Open a PDF the way a DESKTOP app should: save it, then hand it to Windows.
 *
 * The browser path below opens a blob URL in a new tab. A Tauri webview has no
 * tabs — `window.open` returns null — so without this every Print/View button
 * in the CRM would show "Pop-up blocked", which is both wrong and unactionable
 * on a desktop app.
 *
 * Writing to $TEMP and calling openPath is better than a tab, not just a
 * substitute for one: the file opens in whatever the user already prints from
 * (Edge, Adobe, Foxit), with that program's real print dialog and printer
 * selection.
 *
 * The imports are dynamic on purpose. These specifiers must never be pulled
 * into the WEB bundle — Vite splits them into a chunk the browser build never
 * requests, so crm.spinoto.ai ships exactly what it shipped before.
 */
async function openPdfNatively(blob, fileName) {
  const { writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
  const { openPath }                 = await import('@tauri-apps/plugin-opener');
  const { tempDir, join }            = await import('@tauri-apps/api/path');

  const name = safeFileName(fileName);
  const bytes = new Uint8Array(await blob.arrayBuffer());

  // baseDir keeps the write inside the capability's $TEMP scope
  // (src-tauri/capabilities/default.json). Anywhere else is denied by design.
  await writeFile(name, bytes, { baseDir: BaseDirectory.Temp });
  await openPath(await join(await tempDir(), name));
}

/**
 * @param {'estimate'|'customer_invoice'|'purchase_invoice'} docType
 * @param {number|string} id
 * @param {{ theme?: string, share?: boolean, download?: boolean }} [opts]
 *   download — save the file instead of opening it in a tab. Only this path can
 *   honour the server's filename; see the note where the blob URL is built.
 * @returns {Promise<void>} resolves once the PDF has been opened or saved
 */
export async function openDocumentPdf(docType, id, opts = {}) {
  const path = PATHS[docType];
  if (!path) throw new Error(`Unknown document type: ${docType}`);

  const qs = new URLSearchParams();
  if (opts.theme) qs.set('theme', opts.theme);
  if (opts.share) qs.set('share', '1');
  const q = qs.toString();

  return openPdfPath(`/api/${path}/${id}/pdf${q ? `?${q}` : ''}`, opts, `${docType}-${id}.pdf`);
}

/**
 * The same, for any authenticated endpoint that returns a PDF.
 *
 * The advance receipt and refund vouchers do not live under one of the three
 * document paths above — they are addressed by payment id, not document id. So
 * the URL is passed in rather than composed from a type.
 *
 * Everything that makes the function above worth having is here: the Bearer
 * header a plain window.open() cannot send, the %PDF- sniff that turns a
 * silently-broken blob into a message saying so, the pop-up check, and the
 * server's filename on the download path.
 *
 * @param {string} apiPath  path after the API origin, starting with '/'
 * @param {{download?: boolean}} [opts]
 * @param {string} [fallbackName]  used only if the server sends no filename
 */
export async function openPdfPath(apiPath, opts = {}, fallbackName = 'document.pdf') {
  const res = await fetch(`${API_URL}${apiPath}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!res.ok) {
    // The endpoint returns JSON on error, HTML/PDF on success.
    const msg = await res.json().then(d => d.error).catch(() => null);
    throw new Error(msg || `Failed to generate PDF (HTTP ${res.status})`);
  }

  const blob = await res.blob();

  // A 200 doesn't guarantee PDF bytes. This exact failure has happened once:
  // Puppeteer v23 returns a Uint8Array rather than a Buffer, and Express
  // JSON-serialises that into {"0":37,...} while still sending
  // Content-Type: application/pdf — so the tab opened on a blob that the
  // viewer could only report as "Failed to load PDF document", with nothing
  // in the server log. Sniffing the magic number turns that class of bug into
  // a message that says what actually went wrong.
  const magic = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer());
  if (magic !== '%PDF-') {
    throw new Error('The server returned something that is not a PDF. Check the backend log for a rendering error.');
  }
  // ── Desktop ──────────────────────────────────────────────────────────────
  // Handled before the blob URL is created, because neither branch below works
  // in a webview: there is no tab to open one in, and the OS wants a real file.
  // Both "view" and "download" collapse to the same thing here — the PDF lands
  // in $TEMP under the server's name and opens in the system viewer, which is
  // what a user means by both words on a desktop app.
  if (isDesktop()) {
    await openPdfNatively(blob, filenameFromResponse(res) || fallbackName);
    return;
  }

  const url = URL.createObjectURL(blob);

  // ⚠ A blob URL has no filename — it's `blob:http://host/<uuid>` and that uuid
  // is ALL the browser knows. Content-Disposition applies to the response we
  // just consumed, not to a blob the page created afterwards, so a PDF viewed
  // in a tab and then saved from the viewer lands as "42a2b2b8-de63-…" no
  // matter what the server called it. There is no way to attach a name to a
  // blob URL.
  //
  // The download path is different: an <a download="..."> names the file
  // explicitly, so that one does get the server's name.
  if (opts.download) {
    const name = filenameFromResponse(res) || fallbackName;
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    // Must be in the document for the click to count as user-initiated in
    // Firefox; Chrome is happy with a detached node but this is harmless.
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Longer than the open() case isn't needed — the save starts synchronously.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return;
  }

  const win = window.open(url, '_blank');
  if (!win) {
    URL.revokeObjectURL(url);
    throw new Error('Pop-up blocked — allow pop-ups for this site to open the PDF.');
  }
  // Give the new tab time to load before releasing the object URL; revoking
  // immediately can leave the tab blank in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Save the PDF under the server's name (number_vehicle_model.pdf).
 *
 * A thin alias so call sites read as what they do. Use this rather than the
 * viewer's own save button, which can only ever produce the blob uuid.
 */
export function downloadDocumentPdf(docType, id, opts = {}) {
  return openDocumentPdf(docType, id, { ...opts, download: true });
}

/**
 * The advance RECEIPT voucher for a ledger payment.
 *
 * 404 means the payment has no voucher number — money that was never captured,
 * i.e. a payment link nobody paid. There is no document for that, and the
 * message says so rather than reporting a missing file.
 */
export function openAdvanceVoucher(paymentId, opts = {}) {
  return openPdfPath(`/api/payments/advance/${paymentId}/voucher`, opts, `advance-${paymentId}.pdf`);
}

/**
 * The REFUND voucher for a refund.
 *
 * 404 until the refund is processed: a gateway refund has no number while the
 * money is still in flight, because a tax document saying it has gone back
 * would not be true yet.
 */
export function openRefundVoucher(refundId, opts = {}) {
  return openPdfPath(`/api/payments/refund/${refundId}/voucher`, opts, `refund-${refundId}.pdf`);
}
