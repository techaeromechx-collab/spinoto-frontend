/**
 * useSync — subscribe to a real-time invalidation topic.
 *
 * Usage:
 *   useSync('locations', () => reloadLocations());
 *   useSync(['locations', 'vehicles'], () => reloadAll());
 *
 * When the backend emits  invalidate { topic: 'locations' }  the callback
 * fires, which should trigger a re-fetch (e.g. call your load function or
 * set a query-key invalidation).
 *
 * The hook is safe to call multiple times — each call registers exactly one
 * listener and cleans it up on unmount.
 */

import { useEffect, useRef } from 'react';
import socket from '../lib/socket';

/**
 * @param {string|string[]} topics  One or more topic strings to watch.
 * @param {() => void}      callback  Called whenever any of the watched topics are invalidated.
 */
function useSync(topics, callback) {
  /* ── The callback goes through a ref, and it has to ──────────────────────
     The effect below is keyed on the TOPIC alone, so it subscribes once and
     never re-runs while the topic is unchanged — which means the `callback`
     captured in its closure is the one from the FIRST render, for the life of
     the component.

     That is invisible for a caller whose callback is stable
     (`useCallback(..., [])`, which is what the master-data screens pass) and
     silently wrong for anyone else. A list page's re-fetch closes over its
     filters, its page number and its abort controller: fire the first-render
     copy and it re-queries page 1 with no filters and writes THAT over the
     rows the user is looking at. The screen would refresh, so nothing would
     look broken — it would just show the wrong page.

     Adding `callback` to the deps instead would resubscribe on every render
     for any inline arrow (VehiclesPage passes one), churning socket listeners.
     A ref updated every render gives one stable subscription that always calls
     the current function. */
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    const watched = Array.isArray(topics) ? topics : [topics];

    function onInvalidate({ topic }) {
      if (watched.includes(topic)) {
        cbRef.current();
      }
    }

    socket.on('invalidate', onInvalidate);
    return () => socket.off('invalidate', onInvalidate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topics.toString ? topics.toString() : topics]);
}

export default useSync;
