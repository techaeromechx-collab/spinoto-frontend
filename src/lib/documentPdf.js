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

  const res = await fetch(`${API_URL}/api/${path}/${id}/pdf${q ? `?${q}` : ''}`, {
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
    const name = filenameFromResponse(res) || `${docType}-${id}.pdf`;
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
