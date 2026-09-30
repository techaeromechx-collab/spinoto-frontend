/**
 * ChatSkeleton — the shape of a thread that has not arrived yet.
 *
 * Not DetailSkeleton, which is shaped like an invoice: a header grid, a table
 * and a totals row. Putting that in a chat pane would flash a document and then
 * replace it with a conversation, which is a worse jump than a spinner.
 *
 * Alternating sides and deliberately uneven widths, because a column of
 * identical grey rectangles reads as a broken list rather than as loading.
 * aria-hidden with one live region above it: a screen reader should hear
 * "Loading messages", not eight empty bubbles.
 */
const SHAPE = [
  { mine: false, w: 62 },
  { mine: false, w: 38 },
  { mine: true,  w: 45 },
  { mine: false, w: 71 },
  { mine: true,  w: 30 },
  { mine: true,  w: 55 },
];

export default function ChatSkeleton() {
  return (
    <>
      <span className="ch-sr" role="status">Loading messages…</span>
      <div className="ch-skel" aria-hidden="true">
        {SHAPE.map((s, i) => (
          <div key={i} className={`ch-row ch-row--${s.mine ? 'out' : 'in'}`}>
            <div className="ch-skel-bubble" style={{ width: `${s.w}%` }} />
          </div>
        ))}
      </div>
    </>
  );
}
