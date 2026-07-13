import { useEffect } from 'react';

/**
 * Closes a modal when the user presses Escape. Pass the modal's own close
 * handler (e.g. onClose or onCancel).
 *
 * Modals in this app close via the X button / Cancel button / Escape key
 * only — NOT by clicking the backdrop. This hook is the Escape half of that;
 * the backdrop's onClick/onMouseDown close-on-click-outside handler should
 * be removed wherever this hook is added.
 *
 * Pass `active = false` to temporarily disable (e.g. a modal that renders a
 * nested confirm dialog on top of itself may want to let the nested one
 * handle Escape first, or suppress its own listener while busy).
 */
export function useEscapeClose(onClose, active = true) {
  useEffect(() => {
    if (!active || typeof onClose !== 'function') return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, active]);
}
