/**
 * listStatePersist.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tiny sessionStorage helper so list pages (Leads, Appointments, Estimates,
 * Purchase Invoices, Customer Invoices, Customers) can remember their page
 * number, page size, and filters across a full navigation away and back
 * (e.g. following a link to a different page, then clicking back into this
 * one from the sidebar) — not just within the same mounted component.
 *
 * Scoped to sessionStorage (not localStorage) so it clears on tab close and
 * never leaks between different browser sessions/users on a shared machine.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export function readListState(key, fallback = {}) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

export function writeListState(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota/private-mode errors — persistence is a nicety, not critical
  }
}

// Merge a partial update (e.g. just scrollY) into whatever is already saved,
// instead of overwriting the whole entry — used for the scroll-position
// tracker, which fires far more often than the filter/pagination writes.
export function patchListState(key, partial) {
  const current = readListState(key);
  writeListState(key, { ...current, ...partial });
}
