import { useEffect, useRef } from 'react';
import { keyOf } from '../lib/shortcuts.js';

/**
 * useShortcuts — one keyboard listener for the whole app.
 *
 * Mounted once, in AppShell. Not per page: twenty pages each attaching their
 * own document listener is twenty chances for one of them to forget to detach,
 * and a shortcut that fires twice because two handlers are alive is the kind of
 * bug that only shows up after somebody has navigated a particular way.
 *
 * ══ THE TYPING GUARD, AND THE ONE EXCEPTION ════════════════════════════════
 *
 * A BARE key does nothing while focus is in an input, textarea or
 * contenteditable. Without that, typing "no" into a chat message fires "new
 * record" halfway through the word.
 *
 * A key with Alt is different, and this is the whole reason a chord beats a
 * bare letter: nobody types Alt+L into a sentence, so it can fire wherever the
 * cursor is. Somebody halfway through writing a note can still jump to Leads.
 *
 * Ctrl and ⌘ combinations are left entirely alone — those belong to the
 * browser, and the one exception the app already claimed (⌘K) is handled in
 * AppShell where the search box it focuses actually lives.
 */

const SEQ_MS = 1000;

export default function useShortcuts({ bindings, onFire, enabled = true }) {
  /* The map is read inside the handler rather than closed over, so rebinding a
     key in Settings takes effect on the next keystroke instead of on the next
     time this effect happens to re-run. */
  const map = useRef(bindings);
  const fire = useRef(onFire);
  map.current = bindings;
  fire.current = onFire;

  const buffer = useRef('');
  const timer = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;

    function clearSeq() {
      buffer.current = '';
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    }

    function onKey(e) {
      /* A modifier on its own is not a keystroke. Without this, holding Alt to
         reach Alt+L would first be read as a bare press of Alt. */
      if (['Alt', 'Control', 'Meta', 'Shift'].includes(e.key)) return;

      /* Never in the middle of composing CJK or an accented character: the IME
         sends keydown events that are not what the person is typing yet. */
      if (e.isComposing || e.keyCode === 229) return;

      const t = e.target;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

      /* The browser's own territory. ⌘K is AppShell's and is handled there. */
      if (e.ctrlKey || e.metaKey) return;

      const key = keyOf(e);

      /* ── A sequence in progress ──────────────────────────────────────── */
      if (buffer.current) {
        const combined = `${buffer.current} ${key}`;
        clearSeq();
        const hit = map.current[combined];
        if (hit) { e.preventDefault(); fire.current(hit, combined); }
        return;
      }

      /* ── A chord: fires anywhere, including while typing ─────────────── */
      if (e.altKey) {
        const hit = map.current[key];
        if (!hit) return;
        e.preventDefault();
        fire.current(hit, key);
        return;
      }

      /* ── Everything below is a bare key, so it waits for the cursor ──── */
      if (typing) return;

      /* A lone letter that starts a sequence somebody has bound. Nothing is
         armed unless a binding actually begins with it, so a stray press of a
         letter that leads nowhere is just a stray press. */
      const startsSeq = Object.keys(map.current).some((k) => k.startsWith(`${key} `));
      if (startsSeq) {
        buffer.current = key;
        /* The timeout is not decoration: without it a stray press leaves the
           app armed, and the next unrelated key silently navigates. */
        timer.current = setTimeout(clearSeq, SEQ_MS);
        e.preventDefault();
        fire.current({ type: 'arm', key }, key);
        return;
      }

      const hit = map.current[key];
      if (!hit) return;
      e.preventDefault();
      fire.current(hit, key);
    }

    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); clearSeq(); };
  }, [enabled]);
}
