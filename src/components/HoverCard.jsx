import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * A hover/focus card that cannot be clipped by an ancestor's overflow.
 *
 * ── Why a portal and not `position: absolute` ────────────────────────────
 * The obvious version — a relatively-positioned wrapper with an absolute child
 * — is clipped the moment any ancestor scrolls or hides its overflow. On the
 * Payouts invoice table there are two such ancestors: the table's own
 * `overflow-x: auto` wrapper (which forces `overflow-y: auto` too, because CSS
 * will not pair `auto` with `visible`), and `.po-panel { overflow: hidden }`,
 * which exists to clip the panel's rounded corners.
 *
 * `position: fixed` would escape both — until some ancestor grows a `transform`
 * or `filter`, either of which makes it the containing block for fixed
 * descendants and silently re-clips everything. A portal to document.body has
 * no such failure mode.
 *
 * Coordinates come from the trigger's own rect, measured on open, and the card
 * flips below the trigger when there is not room above.
 */
export default function HoverCard({ children, card, width = 200 }) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);

  const open = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Rough height guess only decides the flip; the real card is measured by
    // the browser once painted, and being a few pixels out is invisible.
    const ESTIMATED_H = 150;
    const above = r.top > ESTIMATED_H + 12;
    setPos({
      top: above ? r.top - 8 : r.bottom + 8,
      left: Math.min(r.left, window.innerWidth - width - 12),
      above,
    });
  }, [width]);

  const close = useCallback(() => setPos(null), []);

  return (
    <>
      <span
        ref={ref}
        style={{ display: 'inline-block' }}
        onMouseEnter={open}
        onMouseLeave={close}
        /* Focus/blur as well as hover: the trigger here is a button, and a
           keyboard user tabbing to it should see what a mouse user sees. */
        onFocus={open}
        onBlur={close}
      >
        {children}
      </span>

      {pos && createPortal(
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            transform: pos.above ? 'translateY(-100%)' : 'none',
            zIndex: 3000,
            width,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            boxShadow: '0 10px 26px rgba(0,0,0,0.16)',
            fontSize: 12,
            fontWeight: 400,
            // The card is inert — it exists to be read, and letting the pointer
            // enter it would mean handling the mouse leaving the trigger to
            // reach it, for no benefit.
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            textAlign: 'left',
          }}
        >
          {card}
        </div>,
        document.body
      )}
    </>
  );
}
