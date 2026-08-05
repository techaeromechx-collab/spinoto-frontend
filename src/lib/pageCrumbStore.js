import { useEffect } from 'react';
import { useSyncExternalStore } from 'react';

/**
 * Lets the page that is currently open name the last breadcrumb.
 *
 * The breadcrumb is built in AppShell from the URL alone, so a detail route
 * renders its raw token — "Home > Customer Invoices > zuOAVWTsZ1vqUw". Only the
 * page knows that token means invoice #48, and only after it has resolved it.
 * So the page publishes a label and AppShell renders it.
 *
 * An external store rather than context, for the same reason pageSearchStore is
 * one: the provider would live in AppShell and the consumer several levels
 * down, so every page render would make a new context value, re-render
 * AppShell, re-render the page, and loop. That bug has already shipped here
 * once (useAbortController) and is not worth writing twice.
 *
 * Display only. The URL keeps the token — shareable links and bookmarks are
 * unaffected, and nothing about routing or the API changes.
 *
 * Contract:
 *   - a detail page calls usePageCrumb('CI-000048') once it knows the record
 *   - AppShell calls useCrumbLabel() and falls back to the raw token
 *   - a page that publishes nothing gets the token, exactly as before
 */

const EMPTY = Object.freeze({ token: null, label: null });

let state = EMPTY;
const listeners = new Set();

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot() {
  return state;
}

// useSyncExternalStore re-renders whenever the snapshot IDENTITY changes, so
// publishing an equal-but-new object would loop forever. Both fields are
// strings, so a value comparison is enough.
function publish(next) {
  if (state.token === next.token && state.label === next.label) return;
  state = next;
  for (const fn of listeners) fn();
}

/**
 * Name the token crumb for as long as this component is mounted.
 *
 * @param {string} token the URL segment being labelled
 * @param {string} label what to show instead, e.g. "CI-000048"
 *
 * Both are required. The token is stored alongside the label so AppShell can
 * check they still refer to the same record — otherwise, clicking from one
 * invoice to the next would briefly show the PREVIOUS invoice's number against
 * the new URL, which is worse than showing the token.
 */
export function usePageCrumb(token, label) {
  useEffect(() => {
    if (!token || !label) return;
    publish({ token, label });
    // Cleared on unmount so a page that does not publish never inherits the
    // last one's label.
    return () => publish(EMPTY);
  }, [token, label]);
}

/** AppShell: the published label, or null. */
export function useCrumbLabel(token) {
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  return snap.token === token ? snap.label : null;
}
