import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * A search box that does not hammer the database.
 *
 * Splits what the user is typing (`input`, drives the <input>) from what the
 * list actually queries with (`search`, changes at most once per pause). The
 * Estimates page already did this by hand; the two invoice pages did not, and
 * fired a request on every single keystroke — typing "swift" was five list
 * queries plus five COUNT(*) queries, ten round trips for one search.
 *
 * On a serverless Postgres that is not just slow, it is the bill: each query
 * resets the idle timer that lets the compute suspend.
 *
 *   const { input, setInput, search, tooShort } = useDebouncedSearch(saved);
 *
 * MIN_CHARS matters as much as the delay. A single character matches most of
 * the table, so it is the most expensive possible query AND the least useful
 * result — and below 3 characters there is no complete trigram, so migration
 * 104's index cannot help either.
 */

export const SEARCH_DEBOUNCE_MS = 300;
export const MIN_SEARCH_CHARS = 2;   // must match MIN_SEARCH_LENGTH in backend utils/listSearch.js

export function useDebouncedSearch(initial = '', { delay = SEARCH_DEBOUNCE_MS, minChars = MIN_SEARCH_CHARS } = {}) {
  const [input, setInput] = useState(initial ?? '');
  const [search, setSearch] = useState(() => {
    const t = (initial ?? '').trim();
    return t.length >= minChars ? t : '';
  });

  useEffect(() => {
    const trimmed = input.trim();
    const next = trimmed.length >= minChars ? trimmed : '';
    // Skip the timer when nothing would change. Without this, every unrelated
    // re-render that recreates `input` would schedule a redundant state write.
    if (next === search) return;
    // Clearing is immediate — waiting 300ms to show the full list again reads
    // as lag, and an empty search is the cheapest query there is.
    if (next === '') { setSearch(''); return; }
    const t = setTimeout(() => setSearch(next), delay);
    return () => clearTimeout(t);
  }, [input, search, delay, minChars]);

  return {
    input,
    setInput,
    search,
    // For a hint under the box: they have typed something, but not enough yet.
    tooShort: input.trim().length > 0 && input.trim().length < minChars,
    minChars,
  };
}

/**
 * Cancels the previous request when a new one starts.
 *
 * Debouncing reduces how many requests are sent; this stops the ones already in
 * flight from finishing pointlessly — and, more importantly, from arriving out
 * of order. A slow response for "swi" landing after a fast one for "swift"
 * would repaint the list with the wrong rows, which looks exactly like a bug in
 * the search itself.
 *
 *   const signal = useAbortableFetch();
 *   const res = await api(url, { signal: signal() });
 */
export function useAbortController() {
  const ref = useRef(null);
  useEffect(() => () => ref.current?.abort(), []);   // abort on unmount

  // useCallback with an empty dep array is LOAD-BEARING, not a micro-
  // optimisation. Callers put this function in the dependency array of the
  // useCallback that fetches, which is in turn the dependency of the useEffect
  // that runs it. Returning a fresh closure each render therefore means: new
  // function → new fetcher → effect re-runs → setState → render → new function.
  // An infinite request loop, which is exactly what shipping this without the
  // wrapper produced — hundreds of GETs a second, every other one aborted.
  //
  // The ref is what makes this safe: identity never changes, but the controller
  // it reaches for is always the current one.
  return useCallback(() => {
    ref.current?.abort();
    ref.current = new AbortController();
    return ref.current.signal;
  }, []);
}

/** True for the error a cancelled fetch throws — never show this to the user. */
export function isAbortError(e) {
  return e?.name === 'AbortError' || e?.code === 20 || /aborted/i.test(e?.message || '');
}
