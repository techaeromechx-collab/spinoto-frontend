import { useEffect, useSyncExternalStore } from 'react';

/**
 * Lets the page that is currently open own the search box in the top bar.
 *
 * The alternative — a React context whose value is an object — is a trap here.
 * The provider sits in AppShell and the consumer is a page several levels down,
 * so every page render would produce a new context value, re-render AppShell,
 * re-render the page, and loop. That is precisely the bug that shipped in
 * useAbortController, and it is worth not writing twice. An external store with
 * useSyncExternalStore sidesteps it: the snapshot identity only changes when a
 * field actually changes.
 *
 * Contract:
 *   - a list page calls usePageSearch(...) and owns the state
 *   - AppShell calls useTopbarSearch() and just renders what it is handed
 *   - a page that does not call usePageSearch gets no search box at all,
 *     rather than a box that silently does nothing
 */

const EMPTY = Object.freeze({
  active: false,
  value: '',
  placeholder: '',
  hint: '',
  onChange: null,
});

let state = EMPTY;
const listeners = new Set();

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot() {
  return state;
}

// useSyncExternalStore re-renders whenever the snapshot's IDENTITY changes, so
// replacing the object with an equal one would loop forever. Everything here is
// a primitive except onChange, which callers must keep stable (a useState
// setter already is).
function publish(next) {
  const same =
    state.active === next.active &&
    state.value === next.value &&
    state.placeholder === next.placeholder &&
    state.hint === next.hint &&
    state.onChange === next.onChange;
  if (same) return;
  state = next;
  for (const fn of listeners) fn();
}

/**
 * Claim the top bar's search box for this page.
 *
 * @param {string}   value        current text (the raw input, not debounced)
 * @param {function} onChange     receives the new string — MUST be stable
 * @param {string}   placeholder
 * @param {string}   hint         shown in place of the ⌘K badge, e.g. "2+ chars"
 * @param {boolean}  enabled      pass false to release the box (detail views)
 */
export function usePageSearch({ value, onChange, placeholder = 'Search…', hint = '', enabled = true }) {
  useEffect(() => {
    if (!enabled) { publish(EMPTY); return; }
    publish({ active: true, value: value ?? '', placeholder, hint, onChange });
  }, [value, onChange, placeholder, hint, enabled]);

  // Release on unmount so navigating to a page without a search leaves no
  // stale box behind, still holding the last page's text.
  useEffect(() => () => publish(EMPTY), []);
}

/** AppShell side: what should the top bar show right now? */
export function useTopbarSearch() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Escape / clearing from the shell. */
export function clearPageSearch() {
  state.onChange?.('');
}
