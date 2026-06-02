import '../styles/PaginationBar.css';
/**
 * PaginationBar — shared pagination component used across all list pages.
 * Matches the LeadsPage lp-pg-* design exactly.
 *
 * Props:
 *   page        {number}   current page (1-based)
 *   total       {number}   total record count
 *   pageSize    {number}   records per page
 *   onPage      {fn}       called with new page number
 *   onPageSize  {fn}       called with new pageSize value
 *   noun        {string}   singular label e.g. "customer", "appointment" (default "record")
 */
export default function PaginationBar({ page, total, pageSize, onPage, onPageSize, noun = 'record' }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end   = Math.min(page * pageSize, total);

  // Build page number list with ellipsis gaps
  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
    .reduce((acc, p, idx, arr) => {
      if (idx > 0 && p - arr[idx - 1] > 1) acc.push('…');
      acc.push(p);
      return acc;
    }, []);

  return (
    <div className="pgbar">
      {/* Left: record count */}
      <span className="pgbar-info">
        {total === 0
          ? `No ${noun}s`
          : <>Showing <strong>{start}–{end}</strong> of <strong>{total}</strong> {noun}{total !== 1 ? 's' : ''}</>
        }
      </span>

      {/* Right: page controls + size selector */}
      <div className="pgbar-right">
        {totalPages > 1 && (
          <div className="pgbar-controls">
            <button className="pgbar-btn" disabled={page === 1} onClick={() => onPage(1)} title="First">«</button>
            <button className="pgbar-btn" disabled={page === 1} onClick={() => onPage(page - 1)} title="Previous">‹</button>
            {pageNumbers.map((p, idx) =>
              p === '…'
                ? <span key={`e${idx}`} className="pgbar-ellipsis">…</span>
                : <button
                    key={p}
                    className={`pgbar-btn pgbar-btn--num${page === p ? ' pgbar-btn--active' : ''}`}
                    onClick={() => onPage(p)}
                  >{p}</button>
            )}
            <button className="pgbar-btn" disabled={page === totalPages} onClick={() => onPage(page + 1)} title="Next">›</button>
            <button className="pgbar-btn" disabled={page === totalPages} onClick={() => onPage(totalPages)} title="Last">»</button>
          </div>
        )}

        {/* Page size selector */}
        <div className="pgbar-size">
          <select
            className="pgbar-size-select"
            value={pageSize}
            onChange={e => { onPageSize(Number(e.target.value)); onPage(1); }}
          >
            {[10, 20, 50, 100].map(n => (
              <option key={n} value={n}>{n} / page</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

