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

import { useEffect } from 'react';
import socket from '../lib/socket';

/**
 * @param {string|string[]} topics  One or more topic strings to watch.
 * @param {() => void}      callback  Called whenever any of the watched topics are invalidated.
 */
function useSync(topics, callback) {
  useEffect(() => {
    const watched = Array.isArray(topics) ? topics : [topics];

    function onInvalidate({ topic }) {
      if (watched.includes(topic)) {
        callback();
      }
    }

    socket.on('invalidate', onInvalidate);
    return () => socket.off('invalidate', onInvalidate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topics.toString ? topics.toString() : topics]);
}

export default useSync;
