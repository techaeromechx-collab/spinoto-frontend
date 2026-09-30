import { useRef, useState } from 'react';
import { X, Undo2 } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════════
   The body diagram — where the damage is, not a sentence about it.

   "Scratch on the left rear door" is four words two people read differently.
   A pin at 22.5% / 61.3% on the outline is not, and at delivery you put the
   intake picture beside the delivery picture and the argument is over.

   PERCENTAGES, NEVER PIXELS. The same outline renders at 340px on a phone at
   the ramp and at 720px on a laptop, and a mark stored in pixels would sit in
   a different place on each. The SVG has a fixed viewBox and the pin positions
   are percentages of it, so the picture is identical everywhere. The database
   stores the same percentages (migration 190).
   ═══════════════════════════════════════════════════════════════════════ */

export const DAMAGE_KINDS = [
  { key: 'scratch', label: 'Scratch', color: '#f59e0b' },
  { key: 'dent',    label: 'Dent',    color: '#dc2626' },
  { key: 'crack',   label: 'Crack',   color: '#7c3aed' },
  { key: 'chip',    label: 'Chip',    color: '#0891b2' },
  { key: 'rust',    label: 'Rust',    color: '#b45309' },
  { key: 'missing', label: 'Missing', color: '#111827' },
  { key: 'other',   label: 'Other',   color: '#64748b' },
];
const colourOf = k => (DAMAGE_KINDS.find(d => d.key === k) || DAMAGE_KINDS[6]).color;

/* Two outlines, drawn as plain paths rather than pulled from a sprite or an
   image file: they have to recolour with the theme and scale to any width, and
   an <img> does neither. A car is seen from above — the view every insurance
   form uses, because all four sides and the roof are reachable in one picture.
   A bike is seen from the side, because from above a bike is a line. */
function CarOutline() {
  return (
    <g className="bd-art">
      {/* wheels, drawn first so the body sits over them */}
      <rect x="12" y="72"  width="20" height="46" rx="7" className="bd-tyre" />
      <rect x="168" y="72" width="20" height="46" rx="7" className="bd-tyre" />
      <rect x="12" y="282" width="20" height="46" rx="7" className="bd-tyre" />
      <rect x="168" y="282" width="20" height="46" rx="7" className="bd-tyre" />

      {/* body */}
      <path className="bd-body" d="
        M100 10
        C 74 10 50 24 44 52
        L 34 112 C 30 150 30 250 34 288
        L 44 348 C 50 376 74 390 100 390
        C 126 390 150 376 156 348
        L 166 288 C 170 250 170 150 166 112
        L 156 52 C 150 24 126 10 100 10 Z" />

      {/* windscreen, roof, rear screen */}
      <path className="bd-glass" d="M58 116 L142 116 L133 158 L67 158 Z" />
      <rect className="bd-roof" x="60" y="158" width="80" height="118" rx="6" />
      <path className="bd-glass" d="M67 276 L133 276 L142 316 L58 316 Z" />

      {/* doors */}
      <line className="bd-line" x1="38" y1="196" x2="60" y2="196" />
      <line className="bd-line" x1="162" y1="196" x2="140" y2="196" />
      <line className="bd-line" x1="38" y1="240" x2="60" y2="240" />
      <line className="bd-line" x1="162" y1="240" x2="140" y2="240" />

      {/* mirrors */}
      <path className="bd-body" d="M34 128 L22 133 L24 142 L36 138 Z" />
      <path className="bd-body" d="M166 128 L178 133 L176 142 L164 138 Z" />

      {/* bonnet and boot creases */}
      <line className="bd-line" x1="56" y1="60"  x2="144" y2="60" />
      <line className="bd-line" x1="56" y1="356" x2="144" y2="356" />

      <text className="bd-label" x="100" y="36" textAnchor="middle">FRONT</text>
      <text className="bd-label" x="100" y="378" textAnchor="middle">REAR</text>
    </g>
  );
}

function BikeOutline() {
  return (
    <g className="bd-art">
      <circle className="bd-tyre" cx="86"  cy="158" r="52" />
      <circle className="bd-rim"  cx="86"  cy="158" r="24" />
      <circle className="bd-tyre" cx="316" cy="158" r="52" />
      <circle className="bd-rim"  cx="316" cy="158" r="24" />

      {/* front forks and handlebar */}
      <path className="bd-frame" d="M316 158 L292 74" />
      <path className="bd-frame" d="M326 158 L302 74" />
      <path className="bd-frame" d="M268 62 L322 58" />
      <path className="bd-frame" d="M297 74 L297 58" />

      {/* frame */}
      <path className="bd-frame" d="M86 158 L152 104 L238 104 L292 82" />
      <path className="bd-frame" d="M86 158 L186 150 L238 104" />
      <path className="bd-frame" d="M186 150 L152 104" />

      {/* tank, seat, engine, exhaust */}
      <path className="bd-body" d="M198 102 C 214 74 258 72 276 88 L 278 104 L 200 108 Z" />
      <path className="bd-body" d="M128 106 L200 100 L202 116 L136 128 Z" />
      <rect className="bd-body" x="190" y="116" width="62" height="48" rx="9" />
      <path className="bd-body" d="M118 170 L196 162 L200 176 L120 184 Z" />

      {/* mudguards */}
      <path className="bd-frame" d="M44 132 C 58 96 118 96 132 128" />
      <path className="bd-frame" d="M276 122 C 292 92 344 92 358 124" />

      <text className="bd-label" x="330" y="228" textAnchor="middle">FRONT</text>
      <text className="bd-label" x="70"  y="228" textAnchor="middle">REAR</text>
    </g>
  );
}

const VIEWBOX = { car: '0 0 200 400', bike: '0 0 400 240' };

export default function BodyDiagram({
  shape = 'car',              // 'car' | 'bike'
  marks = [],
  readOnly = false,
  stage = 'intake',
  onChange,                   // (nextMarks) => void
}) {
  const svgRef = useRef(null);
  const [kind, setKind] = useState('scratch');
  const [open, setOpen] = useState(null);   // index of the mark whose note is open

  /* The tap position as a percentage of the SVG's own box, taken from
     getBoundingClientRect rather than the event's offset — offsetX on an SVG
     child reports against that child, so a tap on the roof would be measured
     against the roof. */
  function place(e) {
    if (readOnly) return;
    const r = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width)  * 100;
    const y = ((e.clientY - r.top)  / r.height) * 100;
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    const next = [...marks, {
      x_pct: Math.round(x * 1000) / 1000,
      y_pct: Math.round(y * 1000) / 1000,
      kind, note: '',
    }];
    onChange(next);
    setOpen(next.length - 1);
  }

  const remove = i => { onChange(marks.filter((_, j) => j !== i)); setOpen(null); };
  const setNote = (i, note) => onChange(marks.map((m, j) => j === i ? { ...m, note } : m));

  return (
    <div className="bd">
      {!readOnly && (
        <div className="bd-tools">
          {DAMAGE_KINDS.map(d => (
            <button key={d.key} type="button"
                    className={`bd-kind ${kind === d.key ? 'is-on' : ''}`}
                    onClick={() => setKind(d.key)}>
              <i style={{ backgroundColor: d.color }} /> {d.label}
            </button>
          ))}
          {marks.length > 0 && (
            <button type="button" className="bd-undo" onClick={() => remove(marks.length - 1)}>
              <Undo2 size={13} /> Undo
            </button>
          )}
        </div>
      )}

      <div className={`bd-canvas ${readOnly ? 'is-ro' : ''}`}>
        <svg ref={svgRef} viewBox={VIEWBOX[shape]} onClick={place}
             role="img" aria-label={`${shape} outline, ${marks.length} mark${marks.length === 1 ? '' : 's'}`}>
          {shape === 'bike' ? <BikeOutline /> : <CarOutline />}

          {/* Pins are drawn in the SAME viewBox coordinate space, from the
              stored percentages — never positioned with CSS over the top,
              which would drift the moment the box changed aspect ratio. */}
          {marks.map((m, i) => {
            const [, , vw, vh] = VIEWBOX[shape].split(' ').map(Number);
            const cx = (Number(m.x_pct) / 100) * vw;
            const cy = (Number(m.y_pct) / 100) * vh;
            const r  = shape === 'bike' ? 11 : 8;
            return (
              <g key={i} className="bd-pin"
                 onClick={e => { e.stopPropagation(); setOpen(open === i ? null : i); }}>
                <circle cx={cx} cy={cy} r={r} fill={colourOf(m.kind)} />
                <text x={cx} y={cy + r * 0.38} textAnchor="middle"
                      fontSize={r * 1.05} fill="#fff" fontWeight="700">{i + 1}</text>
              </g>
            );
          })}
        </svg>

        {marks.length === 0 && (
          <p className="bd-empty">
            {readOnly ? 'No damage marked.' : 'Tap the outline where the damage is.'}
          </p>
        )}
      </div>

      {marks.length > 0 && (
        <ol className="bd-list">
          {marks.map((m, i) => (
            <li key={i} className={open === i ? 'is-open' : ''}>
              <span className="bd-dot" style={{ backgroundColor: colourOf(m.kind) }}>{i + 1}</span>
              <span className="bd-kindname">{DAMAGE_KINDS.find(d => d.key === m.kind)?.label}</span>
              {readOnly
                ? <span className="bd-note-ro">{m.note || <em>no note</em>}</span>
                : <input className="bd-note" value={m.note || ''} placeholder="Note (optional)"
                         onChange={e => setNote(i, e.target.value)} />}
              {!readOnly && (
                <button type="button" className="bd-x" onClick={() => remove(i)} title="Remove">
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      {!readOnly && (
        <p className="bd-stage">
          Marking the <strong>{stage === 'delivery' ? 'handover' : 'arrival'}</strong> condition.
        </p>
      )}
    </div>
  );
}
