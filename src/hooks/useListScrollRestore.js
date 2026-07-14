import { useEffect, useRef } from 'react';
import { readListState, patchListState } from '../lib/listStatePersist.js';

/**
 * useListScrollRestore.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Remembers how far a list page was scrolled, alongside its page/pageSize/
 * filters (see lib/listStatePersist.js), so navigating away to a different
 * page and back restores the exact scroll position instead of snapping back
 * to the top.
 *
 * Scrolling happens on the shared `.page-scroll` container rendered once by
 * AppShell (not per-page), so this reads it via a DOM query rather than a
 * prop/ref handed down from the page. In the Hub Portal, these list pages
 * are reused as plain tabs with no `.page-scroll` wrapper — the query simply
 * returns null there and this hook becomes a safe no-op.
 *
 * @param {string} storageKey — same key used with readListState/writeListState for this page
 * @param {boolean} ready — true once the page's first data load has finished;
 *   restoring before rows exist would restore against the wrong (empty) height
 */
export function useListScrollRestore(storageKey, ready) {
  const restoredRef = useRef(false);

  // Restore once, after the list has rendered its first real page of rows
  useEffect(() => {
    if (!ready || restoredRef.current) return;
    restoredRef.current = true;
    const saved = readListState(storageKey).scrollY;
    if (!saved) return;
    const el = document.querySelector('.page-scroll');
    if (!el) return;
    // Next frame, so the just-rendered rows have their real height first
    requestAnimationFrame(() => { el.scrollTop = saved; });
  }, [ready, storageKey]);

  // Continuously save scroll position (rAF-throttled) while this page is mounted
  useEffect(() => {
    const el = document.querySelector('.page-scroll');
    if (!el) return undefined;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        patchListState(storageKey, { scrollY: el.scrollTop });
        ticking = false;
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [storageKey]);
}
