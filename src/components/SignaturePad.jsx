import { useRef, useEffect, useState, useCallback } from 'react';
import { Eraser, PenLine, Type } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════════
   A signature: a typed name, always, and a drawn mark beside it when the
   device allows one.

   BOTH, not either. The drawing is the customer's own hand and it is what
   settles an argument; the typed name is what makes the drawing readable six
   months later, and it is the reason a phone that will not take a finger
   cannot stop a car being handed over. The API enforces the same thing —
   signer_name is NOT NULL, image_url is not.

   POINTER EVENTS, not mouse or touch. One set of handlers covers a finger at
   the ramp, a stylus and a mouse; mouse-only would make this useless on the
   device it is actually for, and handling both separately means a stylus fires
   two strokes for one line.
   ═══════════════════════════════════════════════════════════════════════ */

export default function SignaturePad({
  label = 'Signature',
  hint,
  nameLabel = 'Name',
  defaultName = '',
  busy = false,
  onSign,
}) {
  const canvasRef = useRef(null);
  const drawing   = useRef(false);
  const dirty     = useRef(false);
  const [name, setName]   = useState(defaultName);
  const [hasInk, setHasInk] = useState(false);
  const [error, setError] = useState('');

  /* The canvas is sized in CSS pixels but drawn in device pixels, or a
     signature on a phone is a blurry smear. Re-measured on resize because the
     card it sits in reflows at 640px. */
  const fit = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const rect  = c.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    // Preserve what is already drawn across a resize.
    const prev = dirty.current ? c.toDataURL() : null;
    c.width  = Math.round(rect.width  * ratio);
    c.height = Math.round(rect.height * ratio);
    const ctx = c.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    /* currentColor, read off the element, so the ink follows the theme
       instead of being invisible black-on-black in dark mode. */
    ctx.strokeStyle = getComputedStyle(c).color || '#111';
    if (prev) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = prev;
    }
  }, []);

  useEffect(() => {
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);

  const posOf = e => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function down(e) {
    e.preventDefault();
    // Keeps the stroke coming even when the finger leaves the canvas.
    canvasRef.current.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = posOf(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
  function move(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const { x, y } = posOf(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!dirty.current) { dirty.current = true; setHasInk(true); }
  }
  function up(e) {
    if (!drawing.current) return;
    drawing.current = false;
    try { canvasRef.current.releasePointerCapture(e.pointerId); } catch {}
  }

  function clear() {
    const c = canvasRef.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    setHasInk(false);
  }

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('A name is required.'); return; }
    setError('');
    /* The drawing goes up as an inline PNG. The API accepts that or an https
       link, so when uploading is wired to ImageKit this call does not change. */
    const image = dirty.current ? canvasRef.current.toDataURL('image/png') : null;
    try {
      await onSign({ signer_name: name.trim(), image_url: image });
      clear();
    } catch (err) { setError(err.message); }
  }

  return (
    <form className="sig" onSubmit={submit}>
      <div className="sig-hdr">
        <strong>{label}</strong>
        {hint && <span>{hint}</span>}
      </div>

      <div className="sig-padwrap">
        <canvas
          ref={canvasRef}
          className="sig-pad"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
        {!hasInk && (
          <span className="sig-placeholder"><PenLine size={13} /> Sign here</span>
        )}
        {hasInk && (
          <button type="button" className="sig-clear" onClick={clear} title="Clear">
            <Eraser size={13} />
          </button>
        )}
      </div>

      <div className="sig-row">
        <label className="sig-name">
          <Type size={13} />
          <input value={name} placeholder={nameLabel} onChange={e => setName(e.target.value)} />
        </label>
        <button className="button primary jc-sm" disabled={busy || !name.trim()}>
          {busy ? 'Saving…' : 'Sign'}
        </button>
      </div>

      {/* Said plainly rather than left for someone to discover: drawing is
          better evidence, but the name alone is a valid signature here. */}
      {!hasInk && name.trim() && (
        <p className="sig-note">No drawing — this will be saved as a typed signature.</p>
      )}
      {error && <p className="sig-err">{error}</p>}
    </form>
  );
}
