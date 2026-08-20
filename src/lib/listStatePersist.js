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
 *
 * ⚠ "clears on tab close" is NOT "clears on logout". Logging out and back in as
 * a different user in the same tab keeps every saved filter — which is how an
 * admin's unfiltered hub selection ended up applied to a hub partner's session.
 * clearAllListState() below is called from logout for exactly that reason. It
 * is defence in depth: hub scoping is enforced server-side now, so no client
 * filter can widen a result set, but a hub partner should not open the app to
 * somebody else's saved view either.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Every key this module owns starts with this. A prefix sweep rather than a
// hardcoded list, so a list page added later cannot be forgotten here.
const LIST_STATE_PREFIX = 'sp_';

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

/**
 * Drops every persisted list view. Called on logout so the next person to sign
 * in on this tab starts from the default filters rather than inheriting the
 * previous session's.
 *
 * Keys are collected before removing: mutating sessionStorage while iterating
 * it by index shifts the remaining entries and silently skips half of them.
 */
export function clearAllListState() {
  try {
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(LIST_STATE_PREFIX)) keys.push(k);
    }
    keys.forEach(k => sessionStorage.removeItem(k));
  } catch {
    // Private mode / disabled storage — nothing was persisted either way.
  }
}
