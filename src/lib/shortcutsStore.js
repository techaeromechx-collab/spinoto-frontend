import { useSyncExternalStore } from 'react';
import { api } from '../api/client.js';

/**
 * The one copy of this user's shortcut overrides.
 *
 * ══ WHY A STORE AND NOT TWO PIECES OF useState ═════════════════════════════
 *
 * Two components care: AppShell, which owns the keyboard listener, and
 * Settings → Keyboard, which changes the bindings. They are not parent and
 * child — the settings tab renders inside a page inside AppShell's outlet — so
 * neither can hand state to the other without threading it through everything
 * in between.
 *
 * The first version gave each of them its own useState and its own fetch. It
 * looked fine and shot22 caught what was wrong with it: changing a key in the
 * panel saved to the server, redrew the panel, and the LISTENER carried on with
 * the old map until the next full page load. So "change Leads to Alt+K" left the
 * user with a settings page that said Alt+K and an app that still answered to
 * Alt+L. Nothing in the UI admitted it.
 *
 * A socket invalidate does not fix that on its own, and it is worth writing down
 * why: emitInvalidateTo deliberately SKIPS the tab that made the request, via the
 * X-Socket-Id header. That is correct for its usual job and useless here, because
 * the panel and the listener are in the same tab. The invalidate is still sent
 * from the PUT, for this person's OTHER tabs and devices — see me.routes.js —
 * and this store is what fixes the tab that did the saving.
 *
 * Same shape and the same reasoning as pageSearchStore.js: an external store
 * rather than a context, so the snapshot identity only changes when the data
 * actually changes.
 */

const EMPTY = Object.freeze({});

let overrides = EMPTY;
let loaded = false;
let inflight = null;
const listeners = new Set();

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const getSnapshot = () => overrides;

/**
 * Replace the map. Called after a successful PUT, and by the socket refetch.
 *
 * The identity guard matters: useSyncExternalStore re-renders on identity, and
 * publishing an equal-but-new object on every socket nudge would rebuild the
 * catalogue and the binding map for nothing.
 */
export function setShortcutOverrides(next) {
  const value = next && typeof next === 'object' ? next : EMPTY;
  const a = Object.keys(overrides);
  const b = Object.keys(value);
  if (a.length === b.length && a.every((k) => overrides[k] === value[k])) return;
  overrides = value;
  for (const fn of listeners) fn();
}

/**
 * Fetch them, at most once per page load unless `force`.
 *
 * A failure is deliberately quiet. The defaults still work without the
 * overrides, and a banner about keyboard shortcuts on top of whatever the person
 * was actually doing is worse than the shortcut they changed last week being
 * temporarily back to its default.
 */
export function loadShortcutOverrides({ force = false } = {}) {
  if (inflight) return inflight;
  if (loaded && !force) return Promise.resolve(overrides);
  inflight = api('/api/me/shortcuts')
    .then((r) => { setShortcutOverrides(r?.shortcuts); loaded = true; return overrides; })
    .catch(() => overrides)
    .finally(() => { inflight = null; });
  return inflight;
}

/** For a test or a sign-out: forget everything without a reload. */
export function resetShortcutOverrides() {
  loaded = false;
  setShortcutOverrides(EMPTY);
}

/** What this user has changed, as {id: binding}. */
export function useShortcutOverrides() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
