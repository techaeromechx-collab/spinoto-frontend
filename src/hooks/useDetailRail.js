import { useState, useCallback, useEffect, useRef } from 'react';
import { api } from '../api/client.js';
import { useAbortController, isAbortError } from './useDebouncedSearch.js';

/**
 * Page sizes offered by a split-pane rail.
 *
 * Larger than a table's default 10 because a rail card is roughly a third the
 * height of a table row, so 10 leaves the rail half empty on a tall screen.
 */
export const RAIL_PAGE_SIZES = [15, 25, 50, 100];

/**
 * The list rail beside a detail view — fetching, paging and collapse.
 *
 * Estimates, Purchase Invoices and Customer Invoices all have the same shape:
 * a filtered, paged list whose row opens a full detail. Written once here
 * rather than three times, because the behaviour has already changed twice
 * (infinite scroll, then a pager) and three copies would have drifted apart on
 * the first of those.
 *
 * @param endpoint    e.g. '/api/customer-invoices'
 * @param selectedId  the open record, or null when the list is showing
 * @param buildQuery  () => URLSearchParams of the CURRENT filters, memoised by
 *                    the caller. Its identity is the reset trigger, so it must
 *                    change when a filter value changes and not otherwise.
 */
export function useDetailRail({ endpoint, selectedId, buildQuery }) {
  const [items, setItems]       = useState([]);
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(RAIL_PAGE_SIZES[0]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef(null);

  // The rail's OWN abort controller. Sharing the list's would make the two
  // fetches cancel each other — the hook aborts its previous request every
  // time it is called, and both would be calling the same instance.
  const abort = useAbortController();

  const load = useCallback(async (pageNo) => {
    setLoading(true);
    try {
      const q = buildQuery();
      q.set('page', String(pageNo));
      q.set('limit', String(pageSize));
      const res = await api(`${endpoint}?${q.toString()}`, { signal: abort() });
      setItems(res.items || []);
      setTotal(res.total ?? (res.items || []).length);
      setPage(pageNo);
      setLoading(false);
    } catch (e) {
      // Superseded, not failed — the newer request owns the spinner now.
      if (isAbortError(e)) return;
      setLoading(false);
    }
  }, [endpoint, buildQuery, pageSize, abort]);

  // Two separate triggers, because they want different behaviour:
  //
  //   1. OPENING the pane seeds the rail — but only the first time. Clicking a
  //      different card also changes selectedId, and reloading there would
  //      throw away the page you are on, which is the thing this layout exists
  //      to preserve.
  //   2. Changing a FILTER (or the page size) resets it, because the rail is
  //      now showing rows the filters exclude, or a page number that no longer
  //      exists.
  //
  // Neither fires while the pane is closed: the table already fetches those,
  // and a second invisible request per keystroke is pure waste.
  const seededRef = useRef(false);

  useEffect(() => {
    if (!selectedId) { seededRef.current = false; return; }
    if (seededRef.current) return;
    seededRef.current = true;
    load(1);
  }, [selectedId, load]);

  useEffect(() => {
    if (!selectedId || !seededRef.current) return;
    load(1);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    // buildQuery's identity changes only when a filter VALUE changes, so this
    // cannot fire on an unrelated re-render.
  }, [buildQuery, pageSize]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end   = Math.min(page * pageSize, total);

  const goPage = useCallback(next => {
    const clamped = Math.min(Math.max(1, next), Math.max(1, Math.ceil(total / pageSize)));
    if (clamped === page) return;
    load(clamped);
    // Back to the top: page 2 opening halfway down reads as a rendering fault.
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [page, total, pageSize, load]);

  return {
    items, page, pageSize, setPageSize, total, loading,
    pages, start, end, goPage,
    collapsed, setCollapsed, scrollRef,
  };
}
