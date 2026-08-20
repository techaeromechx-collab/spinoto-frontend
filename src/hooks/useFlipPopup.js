import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Flips a right-anchored popup to open leftward when it would otherwise spill
 * out of the page.
 *
 * THE BUG THIS EXISTS FOR
 * ───────────────────────
 * `.lb-pop` is `position: absolute; right: 0` on a wrapper the width of a 36px
 * icon button, so it hangs ~300px to the LEFT of that button. On staff pages
 * the funnel sits after a 150px hub picker, so there is room. In the hub portal
 * that picker is hidden — hub users only ever see their own hub — which shifts
 * the funnel left, and the panel then runs past the edge of the content.
 *
 * It does not merely look wrong, it is unusable: `.main` is `overflow: hidden`,
 * so the overhanging part is CLIPPED. The "Created by" label reads "l By", the
 * from-date shows a single digit, and there is nothing to scroll to reach it.
 *
 * Measured rather than assumed. Keying this off `isHubUser` would fix the
 * screenshot and still leave a staff member on a narrow window with the same
 * clipped panel — the real condition is "does it fit", which only the browser
 * can answer.
 *
 * Usage:
 *   const [popRef, flip] = useFlipPopup(showFilters);
 *   <div ref={popRef} className={`lb-pop${flip ? ' lb-pop--flip' : ''}`}>
 */
export function useFlipPopup(open) {
  const ref = useRef(null);
  const [flip, setFlip] = useState(false);

  // Layout effect, not effect: this runs before paint, so the popup is never
  // shown in the wrong place first.
  useLayoutEffect(() => {
    // Reset on close so the next open measures its natural position rather
    // than the flipped one, which would always look like it fits.
    if (!open) { setFlip(false); return; }

    const el = ref.current;
    if (!el) return;

    // Against `.content`, not the viewport: the clipping edge is the content
    // column, which starts after the sidebar.
    const host = el.closest('.content') || document.documentElement;
    const popBox = el.getBoundingClientRect();
    const hostBox = host.getBoundingClientRect();

    // 4px of tolerance so a sub-pixel rounding difference does not flip a
    // panel that actually fits.
    setFlip(popBox.left < hostBox.left + 4);
  }, [open]);

  return [ref, flip];
}
