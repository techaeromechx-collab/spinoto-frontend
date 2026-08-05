import { memo } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { RAIL_PAGE_SIZES } from '../hooks/useDetailRail.js';
import '../styles/splitPane.css';

/**
 * One record in the list rail.
 *
 * A table's ten columns cannot survive a 320px rail, so this is a genuinely
 * different rendering of the same row rather than a squeezed one. Every page
 * feeds it the same shape via its own `mapCard`, so Estimates, Purchase
 * Invoices and Customer Invoices all look alike in the rail even though their
 * tables do not.
 *
 * Memoised because selecting a different record re-renders the whole rail.
 *
 * Exported because the LIST view reuses it below ~760px: a ten-column table on
 * a 390px screen is a horizontal scrollbar with two columns visible, and the
 * card that already works in a 320px rail is the answer. One component, so the
 * two never drift apart.
 */
export const RecordCard = memo(function RecordCard({ card, selected, onSelect }) {
  return (
    <button
      type="button"
      className={`sp-card${selected ? ' sp-card--on' : ''}`}
      onClick={() => onSelect(card.raw)}
      /* aria-current, not just a colour: the selected card is the only thing
         telling a screen reader which record the detail pane is showing. */
      aria-current={selected ? 'true' : undefined}
    >
      <div className="sp-card-row">
        <span className="sp-card-code">{card.code}</span>
        <span className="sp-card-date">{card.date}</span>
      </div>

      <div className="sp-card-row">
        {/* Name and its badges share a shrinking box, so a long company name
            truncates rather than pushing the status off the card. */}
        <span className="sp-card-who">
          <span className="sp-card-name">{card.name || '—'}</span>
          {card.badges?.map(b => (
            <span
              key={b.label}
              className={`sp-card-badge${b.tone ? ` sp-card-badge--${b.tone}` : ''}`}
              title={b.title || b.label}
            >
              {b.label}
            </span>
          ))}
        </span>
        {card.status && (
          <span className="sp-card-status" style={{ color: card.statusColor }}>{card.status}</span>
        )}
      </div>

      {card.sub && <div className="sp-card-sub">{card.sub}</div>}

      {card.figures?.length > 0 && (
        <div className="sp-card-figs">
          {card.figures.map(f => (
            <span key={f.label} className={f.tone ? `sp-fig--${f.tone}` : undefined}>
              <em>{f.label}</em>{f.value}
            </span>
          ))}
        </div>
      )}
    </button>
  );
});

/**
 * Master–detail split pane: a paged list rail beside an open record.
 *
 * The rail can be collapsed so the detail runs full width — the detail views
 * here are print-style A4 layouts and want the room for reading and printing.
 *
 * Below 1100px the rail is dropped entirely by CSS and the detail runs full
 * width: two panes in 900px leave neither usable. Each page must therefore
 * keep another way back at that size (a close button in the detail's own
 * header, and the breadcrumb).
 *
 * @param rail       the object returned by useDetailRail
 * @param selectedId the open record's id
 * @param onSelect   called with the raw row when a card is clicked
 * @param mapCard    row => { id, code, date, name, sub, status, statusColor,
 *                   figures, badges? } — badges are small pills beside the
 *                   name; each may carry a `tone` (e.g. 'warn') that must match
 *                   the colour its own page's table already uses for the same
 *                   marker, or the two views disagree about what a colour means
 * @param noun       singular, used in the empty state and aria labels
 * @param search     the page's raw search box value
 * @param onSearch   called with the new value; must be the page's own handler,
 *                   so the rail and the table can never disagree about what is
 *                   filtered
 * @param searchHint e.g. "2+ characters" while the term is too short to send
 * @param children   the detail view
 */
export default function SplitPane({
  rail, selectedId, onSelect, mapCard, noun = 'record',
  search = '', onSearch, searchHint = '', children,
}) {
  const {
    items, page, pageSize, setPageSize, total, loading,
    pages, start, end, goPage, collapsed, setCollapsed, scrollRef,
  } = rail;

  return (
    <div className={`sp-split${collapsed ? ' sp-split--collapsed' : ''}`}>
      <aside className="sp-rail" aria-label={`${noun} list`}>
        {/* The record count used to live here. It moved out rather than being
            duplicated: the pager below already reads "1–15 of 48", and the
            header row is only wide enough for one thing. */}
        <div className="sp-rail-hd">
          {onSearch ? (
            <div className="sp-rail-search">
              <Search size={13} className="sp-rail-search-icon" />
              <input
                type="search"
                value={search}
                onChange={e => onSearch(e.target.value)}
                placeholder={`Search ${noun}s`}
                aria-label={`Search ${noun}s`}
              />
              {/* An explicit clear: type="search" gives one in Chrome and
                  Safari but not Firefox, and the native one is invisible until
                  hover. */}
              {search && (
                <button
                  type="button"
                  className="sp-rail-search-clear"
                  onClick={() => onSearch('')}
                  title="Clear search"
                  aria-label="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ) : (
            <span className="sp-rail-count">{total} {noun}{total !== 1 ? 's' : ''}</span>
          )}

          <button
            type="button"
            className="sp-rail-toggle"
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Show the list' : 'Hide the list and use the full width'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        </div>

        {/* Sits under the box rather than inside it, so it cannot push the
            input around as it appears and disappears. */}
        {searchHint && <div className="sp-rail-hint">{searchHint}</div>}

        <div className="sp-rail-list" ref={scrollRef}>
          {items.map(row => {
            const card = mapCard(row);
            return (
              <RecordCard
                key={card.id}
                card={{ ...card, raw: row }}
                selected={card.id === selectedId}
                onSelect={onSelect}
              />
            );
          })}
          {loading && <div className="sp-rail-note">Loading…</div>}
          {!loading && items.length === 0 && (
            <div className="sp-rail-note">
              {search ? `No ${noun}s match “${search}”` : `No ${noun}s match these filters`}
            </div>
          )}
        </div>

        {/* Not PaginationBar: that renders a numbered button per page and needs
            a few hundred pixels — in 320px it wraps into three rows. Same
            information at a third the width. */}
        <div className="sp-rail-pager">
          <label className="sp-rail-pgsize">
            Rows
            <select
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))}
              aria-label={`${noun}s per page`}
            >
              {RAIL_PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>

          <span className="sp-rail-range">
            {total === 0 ? '0' : `${start}–${end}`} of {total}
          </span>

          <div className="sp-rail-pgbtns">
            <button type="button" onClick={() => goPage(page - 1)}
              disabled={page <= 1 || loading} aria-label="Previous page">
              <ChevronLeft size={14} />
            </button>
            <button type="button" onClick={() => goPage(page + 1)}
              disabled={page >= pages || loading} aria-label="Next page">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* When collapsed the aside is zero-width, so the control that brings it
          back has to live outside it. */}
      {collapsed && (
        <button
          type="button"
          className="sp-rail-restore"
          onClick={() => setCollapsed(false)}
          title="Show the list"
        >
          <ChevronRight size={15} />
        </button>
      )}

      <div className="sp-detail">{children}</div>
    </div>
  );
}
