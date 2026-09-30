import { NAV_ITEMS } from './navItems.js';

/**
 * shortcuts.js — what the keys do, and what to call them on this machine.
 *
 * ══ WHY Alt AND NOT Ctrl / ⌘ ═══════════════════════════════════════════════
 *
 * Nearly every easy Ctrl/⌘ combination is already taken by the browser, and not
 * all of them can even be intercepted: ⌘T and ⌘N never reach the page in
 * Chrome. ⌘L — the obvious key for Leads — is the address bar. ⌘1…9 switch
 * tabs. Ctrl+Shift+letter is mostly free and is three keys, which defeats the
 * point of a chord.
 *
 * Alt is almost entirely free. Chrome takes D, E and F (address bar and its own
 * menu) plus the arrows, Home, Space and F4; the rest of the alphabet is ours.
 * That is why Estimates is Alt+Q for "quote" rather than Alt+E, and Dashboard
 * is Alt+H for "home" rather than Alt+D.
 *
 * ══ THE CATALOGUE IS NAV_ITEMS, NOT A LIST KEPT HERE ═══════════════════════
 *
 * Navigation targets are derived from the sidebar. A second list would drift
 * the first time somebody adds a page and forgets this file — see the header on
 * lib/navItems.js. Only the KEY for each destination lives here, addressed by
 * route, so a renamed screen keeps its shortcut and a removed one loses it
 * automatically.
 */

/* ── Platform ──────────────────────────────────────────────────────────────
 * The same physical key is called Alt on Windows and Option on a Mac, and the
 * glyph on the keycap differs too. A settings page that tells a Mac user to
 * press "Alt" is a settings page they try once.
 *
 * navigator.platform is deprecated but still the most reliable signal here, so
 * userAgentData comes first and it is the fallback rather than the source. */
export const IS_MAC = (() => {
  const p = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(p);
})();

/** What each modifier is CALLED on this machine. */
export const MOD_LABEL = {
  alt:   IS_MAC ? 'Option' : 'Alt',
  ctrl:  IS_MAC ? 'Control' : 'Ctrl',
  meta:  IS_MAC ? 'Command' : 'Win',
  shift: 'Shift',
};

/** What each modifier is DRAWN as. Mac keycaps carry glyphs; Windows does not. */
export const MOD_GLYPH = {
  alt:   IS_MAC ? '⌥' : 'Alt',
  ctrl:  IS_MAC ? '⌃' : 'Ctrl',
  meta:  IS_MAC ? '⌘' : 'Win',
  shift: IS_MAC ? '⇧' : 'Shift',
};

/* ── The defaults ──────────────────────────────────────────────────────────
 * Keyed by ROUTE, so the binding follows the screen rather than a position in
 * a list. A route absent from here simply has no default, which is the right
 * behaviour for a page added later: it appears in the settings with no key and
 * somebody can give it one. */
const NAV_KEYS = {
  '/':                  'alt+h',   // home — alt+d is Chrome's address bar
  '/chat':              'alt+m',   // messages
  '/leads':             'alt+l',
  '/appointments':      'alt+a',
  '/job-cards':         'alt+j',
  '/estimates':         'alt+q',   // quote — alt+e is Chrome's menu
  '/customer-invoices': 'alt+i',
  '/customers':         'alt+c',
  '/hubs':              'alt+u',
  '/payments':          'alt+p',
  '/reports':           'alt+r',
  '/settings':          'alt+s',
};

/**
 * Actions are not navigation: they act on the page you are already on, so they
 * are not in NAV_ITEMS and are listed here in full.
 *
 * These are BARE KEYS, deliberately. A bare key cannot carry navigation — it
 * would fire while somebody types — but the listener stands them down whenever
 * a field has focus, and in exchange they are the fastest thing on the page.
 */
export const ACTIONS = [
  { id: 'action:search', label: 'Focus search',     keys: '/',
    hint: IS_MAC ? '⌘K also works' : 'Ctrl+K also works' },
  { id: 'action:new',    label: 'New on this page', keys: 'n' },
  { id: 'action:help',   label: 'Show shortcuts',   keys: '?' },
  { id: 'action:close',  label: 'Close or cancel',  keys: 'Escape', fixed: true },
];

/* ── What may not be bound ─────────────────────────────────────────────────
 * Two different reasons, kept in one list because the answer to the user is the
 * same: the browser or the operating system already owns it.
 *
 * Some of these the page could technically intercept. Ctrl+W is interceptable
 * and binding it would still be wrong — somebody eventually loses work to a
 * shortcut that used to close the tab.
 */
export const RESERVED = new Set([
  // Cannot be intercepted at all in Chrome.
  'ctrl+t', 'meta+t', 'ctrl+n', 'meta+n', 'ctrl+w', 'meta+w', 'ctrl+q', 'meta+q',
  // Interceptable, and taking them would be hostile.
  'ctrl+l', 'meta+l', 'ctrl+p', 'meta+p', 'ctrl+s', 'meta+s', 'ctrl+f', 'meta+f',
  // Chrome, on Windows and Linux.
  'alt+d',                       // jump to the address bar
  'alt+e', 'alt+f',              // the Chrome menu
  'alt+Home', 'alt+ArrowLeft', 'alt+ArrowRight', 'alt+ArrowUp', 'alt+ArrowDown',
  'alt+ ', 'alt+Tab', 'alt+F4',  // window and OS level
  // Ours, and not negotiable: the search box has had this since before the
  // feature existed and people already rely on it.
  'ctrl+k', 'meta+k',
]);

/** A route's default, or '' when it has none. */
export const defaultFor = (to) => NAV_KEYS[to] || '';

/**
 * Every bindable thing this user can actually reach, with its current key.
 *
 * `can` is the permission check from AuthContext, so a person without VIEW_HUB
 * never sees a HUBs row — let alone binds one. A settings page listing screens
 * you cannot open is a directory of things to ask for.
 */
export function buildCatalogue(can, overrides = {}) {
  const nav = NAV_ITEMS
    .filter((it) => can(...(it.permissions || [])))
    .map((it) => {
      const id = `nav:${it.to}`;
      const def = defaultFor(it.to);
      return {
        id, label: it.label, to: it.to, section: it.section, kind: 'nav',
        def,
        keys: id in overrides ? overrides[id] : def,
      };
    });

  const actions = ACTIONS.map((a) => ({
    ...a, kind: 'action', def: a.keys,
    keys: a.id in overrides ? overrides[a.id] : a.keys,
  }));

  return { nav, actions, all: [...nav, ...actions] };
}

/* ── Reading a key event ───────────────────────────────────────────────────
 *
 * THE ONE THAT DECIDES WHETHER THIS WORKS ON A MAC AT ALL.
 *
 * Option+L does not produce "l" on a Mac — it produces "¬". Option+A gives "å",
 * Option+C gives "ç". So matching a binding against `event.key` works perfectly
 * on Windows and silently does nothing on every Mac in the building, which is
 * the worst shape a bug can have: correct on the machine the developer used.
 *
 * `event.code` is the physical key — 'KeyL' whatever Option turns it into.
 *
 * It does NOT survive a different LAYOUT: e.code names keys by their US
 * position, so on AZERTY the key labelled A reports 'KeyQ'. That is a real
 * limitation and the fix would be navigator.keyboard.getLayoutMap(), which is
 * Chromium-only. Not worth it for a QWERTY workshop; written down so the next
 * person does not rediscover it as a bug.
 *
 * Punctuation deliberately falls through to event.key: "?" IS Shift and Slash,
 * and the physical code cannot tell it from "/".
 */
export function keyOf(e) {
  const mods = [];
  if (e.ctrlKey)  mods.push('ctrl');
  if (e.metaKey)  mods.push('meta');
  if (e.altKey)   mods.push('alt');
  if (e.shiftKey && e.key.length > 1) mods.push('shift');

  let base;
  if (mods.length && /^Key[A-Z]$/.test(e.code))        base = e.code.slice(3).toLowerCase();
  else if (mods.length && /^Digit[0-9]$/.test(e.code)) base = e.code.slice(5);
  else base = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  return mods.length ? [...mods, base].join('+') : base;
}

/** The pieces to draw, e.g. 'alt+l' → ['Alt', 'L'] or ['⌥', 'L'] on a Mac. */
export function keyParts(keys) {
  if (!keys) return [];
  if (keys === 'Escape') return ['Esc'];
  if (keys.includes(' ')) return keys.split(' ');          // a two-key sequence
  return keys.split('+').map((k) => MOD_GLYPH[k] || (k.length === 1 ? k.toUpperCase() : k));
}

/** The same thing in words, for a title attribute and for screen readers. */
export function keyLabel(keys) {
  if (!keys) return 'Not set';
  if (keys === 'Escape') return 'Escape';
  if (keys.includes(' ')) return keys.split(' ').join(', then ');
  return keys.split('+').map((k) => MOD_LABEL[k] || k.toUpperCase()).join(' + ');
}

/**
 * Is this a shape we are willing to store?
 *
 * Checked on the client so the message is immediate, and again on the server,
 * because a client deciding what it may save is not a rule.
 */
const ONE = '[a-z0-9/?,.;\'\\[\\]\\\\`=-]';
const BINDING = new RegExp(
  `^(?:`
  + `(?:(?:ctrl|meta|alt|shift)\\+)+(?:${ONE}|F\\d{1,2}|Home|End|Enter|Tab|Escape| )`  // a chord
  + `|${ONE}`                                                                          // one bare key
  + `|[a-z] ${ONE}`                                                                    // g-style sequence
  + `|Escape`
  + `)$`
);

export function validate(keys, { id, catalogue }) {
  if (keys === '') return null;                      // unbound is allowed
  if (!BINDING.test(keys)) return 'That key cannot be used.';
  if (RESERVED.has(keys)) return 'browser';          // the panel words this one
  const taken = catalogue.find((s) => s.id !== id && s.keys === keys);
  if (taken) return `taken:${taken.label}`;
  return null;
}
