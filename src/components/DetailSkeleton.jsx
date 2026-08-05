import '../styles/splitPane.css';

/**
 * Placeholder shaped like a record detail, shown while one loads.
 *
 * Replaces a centred spinner. The point is not decoration: a spinner in the
 * middle of an empty pane collapses the layout to nothing and then throws the
 * real content in at a different height, so the page jumps. Blocks roughly the
 * size of what is coming hold the space, and the eye has somewhere to rest.
 *
 * Deliberately NOT a pixel-perfect copy of the invoice. A skeleton that tries
 * to match every row has to be updated every time the real layout changes, and
 * it will silently fall out of step. This is the coarse shape — a two-column
 * header block, a few table rows, a totals block — which is stable across all
 * three record types and does not need maintaining.
 *
 * @param rows how many line-item rows to suggest (default 3)
 */
export default function DetailSkeleton({ rows = 3 }) {
  return (
    <div className="sk" role="status" aria-live="polite" aria-busy="true">
      {/* One announcement for assistive tech. The blocks themselves are
          decorative and hidden, or a screen reader would read out a dozen
          meaningless elements. */}
      <span className="sk-sr">Loading…</span>

      <div className="sk-grid" aria-hidden="true">
        <div className="sk-col">
          <div className="sk-line sk-line--label" />
          {[68, 82, 54, 74].map((w, i) => <div key={i} className="sk-line" style={{ width: `${w}%` }} />)}
        </div>
        <div className="sk-col">
          <div className="sk-line sk-line--label" />
          {[60, 76, 48, 66].map((w, i) => <div key={i} className="sk-line" style={{ width: `${w}%` }} />)}
        </div>
      </div>

      <div className="sk-table" aria-hidden="true">
        <div className="sk-thead" />
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="sk-tr">
            <div className="sk-line" style={{ width: '38%' }} />
            <div className="sk-line" style={{ width: '14%' }} />
            <div className="sk-line" style={{ width: '18%' }} />
          </div>
        ))}
      </div>

      <div className="sk-foot" aria-hidden="true">
        <div className="sk-line" style={{ width: '44%' }} />
        <div className="sk-totals">
          {[70, 55, 85].map((w, i) => <div key={i} className="sk-line" style={{ width: `${w}%` }} />)}
        </div>
      </div>
    </div>
  );
}
