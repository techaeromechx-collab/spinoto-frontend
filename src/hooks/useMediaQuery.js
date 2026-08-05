import { useSyncExternalStore, useMemo } from 'react';

/**
 * Subscribe to a CSS media query.
 *
 * Used to swap a wide table for a card list below a breakpoint. Doing that in
 * CSS alone would mean rendering both and hiding one — every row twice in the
 * DOM, on the device least able to afford it.
 *
 * useSyncExternalStore rather than useState + an effect: the first paint gets
 * the real answer instead of rendering the desktop table and then swapping,
 * which on a phone is a visible flash of a horizontally-scrolling table.
 */
export function useMediaQuery(query) {
  const mql = useMemo(
    () => (typeof window === 'undefined' ? null : window.matchMedia(query)),
    [query]
  );

  const subscribe = useMemo(() => (onChange) => {
    if (!mql) return () => {};
    // addEventListener over the deprecated addListener, with a fallback:
    // Safari only gained the modern form in 14.
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [mql]);

  return useSyncExternalStore(
    subscribe,
    () => (mql ? mql.matches : false),
    () => false,   // server/prerender: assume desktop, the wider layout
  );
}

/**
 * The width at which the invoice/estimate tables stop being readable.
 *
 * 760px, not 768: it must sit BELOW the split pane's 1100px rail breakpoint and
 * above a large phone in landscape, and matching a common device width exactly
 * puts the boundary right where a device sits.
 */
export const MOBILE_LIST_QUERY = '(max-width: 760px)';
