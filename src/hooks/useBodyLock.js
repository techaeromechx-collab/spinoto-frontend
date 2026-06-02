import { useEffect } from 'react';

/**
 * Locks body scroll while the component is mounted (or while `active` is true).
 * Adds `modal-open` class to document.body on mount, removes on unmount.
 * Safe to call from multiple modals simultaneously — uses a counter so the
 * last modal to close is the one that removes the lock.
 */
let lockCount = 0;

export function useBodyLock(active = true) {
  useEffect(() => {
    if (!active) return;
    lockCount += 1;
    document.body.classList.add('modal-open');
    return () => {
      lockCount -= 1;
      if (lockCount <= 0) {
        lockCount = 0;
        document.body.classList.remove('modal-open');
      }
    };
  }, [active]);
}
