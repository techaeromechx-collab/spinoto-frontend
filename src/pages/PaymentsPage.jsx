import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  CreditCard, RefreshCw, Download, SlidersHorizontal, CheckCircle2,
  XCircle, Clock, RotateCcw, AlertTriangle, Loader2,
} from 'lucide-react';
import { api, API_URL, getToken } from '../api/client.js';
import { useAuth, useCan } from '../auth/AuthContext.jsx';
import { useAppPaths } from '../lib/appPaths.js';
import PaginationBar from '../components/PaginationBar.jsx';
import PaymentDrawer from '../components/PaymentDrawer.jsx';
import { SettlementsPanel, GatewayPanel, PaymentLinksPanel, HubCollectionsPanel, UnallocatedPanel, PayoutsPanel, RefundsPanel } from '../components/PaymentsAdminTabs.jsx';
import { useFlipPopup } from '../hooks/useFlipPopup.js';
import { useDebouncedSearch, useAbortController, isAbortError } from '../hooks/useDebouncedSearch.js';
import { usePageSearch } from '../lib/pageSearchStore.js';
import { usePageCrumb } from '../lib/pageCrumbStore.js';
import { readListState, writeListState } from '../lib/listStatePersist.js';
import { istToday, addDays } from '../lib/istDate.js';
import '../styles/listLayout.css';
import '../styles/PaymentsPage.css';

const KEY = 'payments';
const fmt = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

/**
 * One line per invoice, not one per allocation.
 *
 * Credit can reach the same invoice twice — money applied when the bill was
 * raised and more of it a week later are two rows in payment_allocations, both
 * dated separately and both correct. Rendered straight they became two lines
 * naming the same invoice, and React saw two children with the same key and
 * warned it may drop one. The same fix the customer Payments tab needed.
 *
 * Grouped here rather than in SQL: the ledger is right to keep the applications
 * apart, each with its own date and author. This cell answers the narrower
 * question — which invoices did this money reach — and there the invoice is the
 * unit.
 */
/**
 * An invoice number you can open.
 *
 * stopPropagation is the whole reason this is a component and not a span. The
 * ROW already has an onClick — a manual row opens the invoice it was taken
 * against, a gateway row opens the payment drawer — so a bare anchor inside it
 * fires both handlers and you land on whichever navigation ran last. On an
 * advance those are different invoices, which is the case this cell exists for.
 *
 * Falls back to a plain span with no token: the invoice page is addressed by
 * public_token, and a link that navigates to /customer-invoices/ with nothing
 * after it silently opens the list instead of the invoice named on screen.
 */
function InvoiceLink({ id, token, nav, to }) {
  const label = `CI-${String(id).padStart(6, '0')}`;
  if (!token) return <span className="pay-inv">{label}</span>;
  return (
    <button
      type="button"
      className="pay-inv pay-inv--link"
      title={`Open ${label}`}
      onClick={e => { e.stopPropagation(); nav(`${to}/${token}`); }}
    >
      {label}
    </button>
  );
}

function byInvoice(allocations) {
  const out = new Map();
  for (const a of (allocations || [])) {
    const amt = Number(a.amount) || 0;
    const row = out.get(a.invoice_id);
    if (row) row.amount += amt;
    // The token rides along so the rendered number can be opened. Taken from
    // the first allocation to name this invoice; they all point at the same one.
    else out.set(a.invoice_id, { invoice_id: a.invoice_id, amount: amt, token: a.token || null });
  }
  return [...out.values()];
}

/**
 * The Payments module.
 *
 * ── What "collected" means here ─────────────────────────────────────────────
 * Money the gateway confirmed it took, across the filters currently applied. It
 * is NOT money in the company's bank account: the gateway holds it for a couple
 * of days and then transfers a lump sum, minus its fees. That transfer is a
 * settlement and has its own screen. Conflating the two produces a
 * reconciliation that never balances and nobody can explain.
 *
 * ── The totals come from the database, not from this page ───────────────────
 * /summary aggregates over the whole filtered set. Adding up the visible rows
 * would understate every figure the moment there is a second page — the mistake
 * the staff dashboard's money cards already make, summing one 200-row page.
 *
 * ── Most rows here are not payments ─────────────────────────────────────────
 * A customer who opens checkout and closes the tab leaves a 'created' row.
 * Worth seeing — it distinguishes "the link never worked" from "they changed
 * their mind" — but it is not money, and nothing on this screen adds it to a
 * total.
 */

const STATUS_META = {
  created:            { label: 'Started',     icon: Clock,        cls: 'pay-st--idle' },
  attempted:          { label: 'Attempted',   icon: Clock,        cls: 'pay-st--idle' },
  captured:           { label: 'Paid',        icon: CheckCircle2, cls: 'pay-st--ok'   },
  failed:             { label: 'Failed',      icon: XCircle,      cls: 'pay-st--bad'  },
  expired:            { label: 'Expired',     icon: XCircle,      cls: 'pay-st--idle' },
  refunded:           { label: 'Refunded',    icon: RotateCcw,    cls: 'pay-st--warn' },
  partially_refunded: { label: 'Part refund', icon: RotateCcw,    cls: 'pay-st--warn' },
};

function StatusChip({ status }) {
  const m = STATUS_META[status] || { label: status, icon: Clock, cls: 'pay-st--idle' };
  const Icon = m.icon;
  return <span className={`pay-st ${m.cls}`}><Icon size={12} /> {m.label}</span>;
}

const EMPTY_FILTERS = { status: '', source: '', mode: '', date_from: '', date_to: '' };

export default function PaymentsPage() {
  const navigate = useNavigate();
  const { ref: routeRef } = useParams();
  const P = useAppPaths();
  const { user } = useAuth();

  usePageCrumb('Payments');

  const ls = readListState(KEY) || {};
  const { input: searchInput, setInput: setSearchInput, search, tooShort, minChars } =
    useDebouncedSearch(ls.search ?? '');

  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, ...(ls.filters || {}) });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(ls.pageSize ?? 50);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterPopRef, filterPopFlip] = useFlipPopup(showFilters);

  const abortRef = useAbortController();

  // Tabs, each gated on its own permission. A tab nobody may open is not
  // rendered at all rather than shown disabled — a permanently dead tab tells
  // someone their account is broken.
  const canSettlements = useCan('VIEW_SETTLEMENTS');
  const canGateway = useCan('MANAGE_GATEWAY_SETTINGS');
  const canLinks = useCan('CREATE_PAYMENT_LINK', 'VIEW_PAYMENTS');
  // Hidden from hub logins outright, not just permission-gated: this tab lists
  // every hub's payouts side by side, which is the one comparison a hub partner
  // must not be handed.
  const canPayouts = useCan('VIEW_HUB_PAYOUTS', 'MANAGE_HUBS', 'VIEW_PURCHASE_INVOICE') && !user?.hub_id;
  const TABS = [
    { key: 'transactions', label: 'Transactions', on: true },
    // "Collections by hub", not "By hub". This tab shows what each hub
    // COLLECTED — money in. Beside a Payouts tab meaning money out, the old
    // label was going to be misread every single time, and the two figures for
    // one hub are usually nothing like each other.
    //
    // Hidden for hub logins: a hub comparing itself against every other hub's
    // takings is not a view this system offers, and hubScopeSql would reduce it
    // to a single row anyway.
    { key: 'by-hub',       label: 'Collections by hub', on: !user?.hub_id },
    // Money OUT. A tab rather than rows in the Transactions list, because that
    // list is money in and every total above it sums those rows — a payout
    // among them would be subtracted from nothing and added to everything.
    { key: 'payouts',      label: 'Payouts',       on: canPayouts },
    // Money held against no invoice. Kept beside the transactions rather
    // than buried in settings: it is a working list, not a report.
    { key: 'unallocated',  label: 'Unallocated',   on: true },
    // Money sent back. Its own tab rather than a filter on Transactions: a
    // refund is not a payment, and the totals above that list would have to
    // subtract it — which is exactly the netting this module avoids everywhere
    // else. It is also the only screen from which a credit note can be opened.
    { key: 'refunds',      label: 'Refunds',       on: true },
    { key: 'links',        label: 'Payment links', on: canLinks },
    { key: 'settlements',  label: 'Settlements',  on: canSettlements },
    { key: 'gateway',      label: 'Gateway',      on: canGateway },
  ].filter(t => t.on);
  const [tab, setTab] = useState('transactions');

  const onSearchChange = useCallback(v => { setSearchInput(v); setPage(1); }, [setSearchInput]);
  usePageSearch({
    value: searchInput,
    onChange: onSearchChange,
    placeholder: 'Search reference, customer, vehicle or mobile',
    hint: tooShort ? `${minChars}+ characters` : '',
  });

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (search) p.set('search', search);
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    return p.toString();
  }, [search, filters]);

  const load = useCallback(async () => {
    // Only the Transactions tab reads these endpoints. Without this guard, every
    // filter change on another tab fires two requests whose results are thrown
    // away — and the summary query is the expensive one on this screen.
    if (tab !== 'transactions') return;
    setLoading(true); setError('');
    try {
      const signal = abortRef();
      const listQs = new URLSearchParams(qs);
      listQs.set('page', String(page));
      listQs.set('limit', String(pageSize));

      // Two requests, not one. The summary is not derived from the page being
      // displayed — it is aggregated server-side over every matching row.
      const [list, sum] = await Promise.all([
        api(`/api/payments?${listQs}`, { signal }),
        api(`/api/payments/summary${qs ? `?${qs}` : ''}`, { signal }),
      ]);
      setItems(list.items || []);
      setTotal(list.total || 0);
      setSummary(sum);
    } catch (e) {
      if (isAbortError(e)) return;     // a superseded search, not a failure
      setError(e.message || 'Could not load payments.');
      setItems([]); setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [qs, page, pageSize, abortRef, tab]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    writeListState(KEY, { search: searchInput, filters, pageSize });
  }, [searchInput, filters, pageSize]);

  const activeFilters =
    (filters.status ? 1 : 0) + (filters.mode ? 1 : 0) +
    // A date range is one thing to a person, not two.
    ((filters.date_from || filters.date_to) ? 1 : 0);

  async function exportCsv() {
    // The same filters as the list, so the file matches the screen. Fetched
    // with the bearer token rather than a plain <a href>, which carries no
    // Authorization header and would just 401.
    try {
      const res = await fetch(`${API_URL}/api/payments/export${qs ? `?${qs}` : ''}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('Export failed.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payments-${istToday()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message || 'Could not export.');
    }
  }

  return (
    <>
      {/* lb-page is the full-bleed opt-in: it drives
          `.content:has(.lb-page) { max-width:100%; padding:0 }` in
          listLayout.css, cancelling the app wrapper's 32px gutter and
          1400px cap so the table reaches the window edge like every
          other list screen. `lb` on its own was doing nothing at all —
          it is not defined in any stylesheet. pay-page is the hook the
          compensating insets hang off; it must not be on the panels
          themselves, because PaymentLinksPanel is also embedded in the
          customer invoice screen and must keep its compact treatment
          there. */}
      <div className="pay-page lb-page">
        {TABS.length > 1 && (
          <div className="pay-tabs">
            {TABS.map(t => (
              <button key={t.key} type="button"
                      className={`pay-tab${tab === t.key ? ' pay-tab--on' : ''}`}
                      onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Same qs as the list, so the date range and hub filter a person set
            on Transactions still apply when they switch here — a total that
            silently ignores the filter above it is how a screen lies. */}
        {tab === 'by-hub'      && <HubCollectionsPanel qs={qs} />}
        {/* Deliberately NOT given `qs`. The Transactions filters are about money
            coming in — status 'captured', source 'gateway', a customer search —
            and none of them mean anything against a payout. A tab that silently
            applied them would show an empty payouts list because someone had
            typed a customer name upstairs. */}
        {tab === 'payouts'     && <PayoutsPanel />}
        {tab === 'unallocated' && <UnallocatedPanel />}
        {tab === 'refunds'     && <RefundsPanel />}
        {tab === 'links'       && <PaymentLinksPanel />}
        {tab === 'settlements' && <SettlementsPanel />}
        {/* The only tab that is a form rather than a table. Its root
            carries an inline `padding: '14px 0'`, and an inline style
            cannot be overridden from a stylesheet without !important —
            so the inset goes on a wrapper instead of fighting it. */}
        {tab === 'gateway'     && <div className="pay-tabpad"><GatewayPanel /></div>}

        {tab === 'transactions' && <>
        {/* ── Overview ─────────────────────────────────────────────────────── */}
        <div className="pay-kpis">
          {/* Collected is now EVERYTHING — cash and online. It used to be
              gateway-only while calling itself "Collected", which for most
              workshops understated the day's takings by most of the day's
              takings. The split is in the hint so the headline stays one
              number and the question "how much of that was cash" is still
              answerable without changing a filter. */}
          <Kpi label="Collected" tone="ok" value={summary ? fmt(summary.collected) : '—'}
               hint={summary
                 ? `${fmt(summary.collected_manual)} by hand · ${fmt(summary.collected_online)} online`
                 : 'Cash and online together.'} />
          <Kpi label="Refunded" tone={Number(summary?.refunded) > 0 ? 'warn' : 'idle'}
               value={summary ? fmt(summary.refunded) : '—'} hint="Sent back to customers." />
          <Kpi label="Net" tone="ok" value={summary ? fmt(summary.net) : '—'}
               hint="Collected minus refunded." />
          <Kpi label="Payments" tone="idle" value={summary ? String(summary.captured_count) : '—'}
               hint={summary?.success_rate != null
                 ? `${summary.success_rate}% of online attempts succeeded`
                 : 'No online attempts yet'} />
          {/* Failed and Not finished stay GATEWAY-only, and say so. A cash
              payment cannot fail or be abandoned — there is no row until the
              money is in the drawer — so mixing them in would make both
              numbers describe nothing. */}
          <Kpi label="Failed online" tone={summary?.failed_count > 0 ? 'bad' : 'idle'}
               value={summary ? String(summary.failed_count) : '—'}
               hint="Declined, or could not be verified." />
          <Kpi label="Not finished" tone="idle" value={summary ? String(summary.pending_count) : '—'}
               hint="Checkout opened, never completed. No money involved." />
        </div>

        {/* ── Toolbar ──────────────────────────────────────────────────────── */}
        <div className="lb-toolbar">
          <div className="lb-count">
            {loading ? 'Loading…' : `${total} payment${total === 1 ? '' : 's'}`}
          </div>
          <div className="lb-toolbar-right">
            <div style={{ position: 'relative' }}>
              <button type="button" className="btn btn-ghost"
                      onClick={() => setShowFilters(v => !v)}>
                <SlidersHorizontal size={15} /> Filters
                {activeFilters > 0 && <span className="pay-fbadge">{activeFilters}</span>}
              </button>
              {showFilters && (
                <div ref={filterPopRef} className={`lb-pop${filterPopFlip ? ' lb-pop--flip' : ''}`}>
                  <FilterFields filters={filters} setFilters={setFilters} onChanged={() => setPage(1)} />
                  <div className="lb-pop-foot">
                    <button type="button" className="btn btn-ghost"
                            onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>Clear</button>
                    <button type="button" className="btn btn-primary"
                            onClick={() => setShowFilters(false)}>Done</button>
                  </div>
                </div>
              )}
            </div>
            <button type="button" className="btn btn-ghost" onClick={exportCsv}>
              <Download size={15} /> Export
            </button>
            <button type="button" className="btn btn-ghost" onClick={load} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </button>
          </div>
        </div>

        {/* ── List ─────────────────────────────────────────────────────────── */}
        {error ? (
          <div className="pay-empty" style={{ color: '#b45309' }}>
            <AlertTriangle size={18} /> {error}
          </div>
        ) : loading ? (
          <div className="pay-empty">
            <Loader2 size={20} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
          </div>
        ) : items.length === 0 ? (
          <div className="pay-empty">
            <CreditCard size={20} />
            <div>No payments {activeFilters || search ? 'match those filters' : 'yet'}.</div>
          </div>
        ) : (
          <div className="lb-list">
            <div className="lb-scroll-x">
              <table className="pay-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Customer</th>
                    <th>Invoice</th>
                    {!user?.hub_id && <th>Hub</th>}
                    <th className="pay-num">Amount</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(row => (
                    // A manual payment has no gateway transaction, so there is
                    // no drawer to open — its detail IS the invoice, where it
                    // can be dated, deleted and read in context. Sending it to
                    // /payments/<ref> would open an empty drawer on a null ref.
                    <tr key={row.id}
                        className={row.txn_ref && routeRef === row.txn_ref ? 'pay-row--on' : undefined}
                        onClick={() => navigate(
                          row.kind === 'manual'
                            ? `${P.customerInvoices}/${row.invoice_token || ''}`
                            : `${P.payments}/${row.txn_ref}`
                        )}>
                      <td>
                        {/* voucher_no sits between the two on purpose. An
                            advance has no txn_ref and usually no reference_no,
                            so this column was blank on exactly the rows whose
                            number matters most — ADV-2026-27-000003 is what is
                            printed on the receipt the customer is holding, and
                            it is now what the search box matches too. */}
                        <span className="pay-ref">{row.txn_ref || row.voucher_no || row.reference_no || '—'}</span>
                        {/* Test rows must be unmistakable. Without this, play
                            money silently joins the revenue figures the day
                            after go-live and nobody notices for a month. */}
                        {row.mode === 'test' && <span className="pay-testtag">TEST</span>}
                        {/* And so must the two sources. A list mixing cash with
                            gateway rows is only readable if each row says which
                            it is — otherwise "Paid" on a ₹2,000 line gives no
                            clue whether to look in the till or in Razorpay.
 
                            BOTH sources are tagged, not just one. Before this
                            only manual rows carried a mark, so a gateway row
                            was identified by the ABSENCE of one — which reads
                            as "no information" rather than "this came from the
                            gateway", and is invisible to anyone scanning the
                            column rather than reading it.
 
                            Short codes rather than words: this sits beside a
                            transaction reference that is already long, and MNL
                            / RZ stay one glance wide at any zoom. The full word
                            is in the title for anyone who has not met them. */}
                        <span
                          className={`pay-src pay-src--${row.kind === 'manual' ? 'mnl' : 'rz'}`}
                          title={row.kind === 'manual'
                            ? 'Manual — recorded by hand, look in the till or the bank'
                            : 'Razorpay — look it up in the gateway dashboard'}>
                          {row.kind === 'manual' ? 'MNL' : 'RZ'}
                        </span>
                      </td>
                      <td>
                        <div className="pay-name">{row.customer_name || '—'}</div>
                        <div className="pay-sub">{row.mobile || ''}</div>
                      </td>
                      <td>
                        {/* entity_id is checked as well as entity_type. An
                            advance is money with no invoice, and the union used
                            to label every manual row 'customer_invoice'
                            regardless — so this rendered String(null) and put
                            "CI-00null" on screen. The backend now says
                            'estimate' or 'customer' for those rows; the guard
                            stays because one NULL id should never be able to
                            print itself as an invoice number again. */}
                        {/* Two different questions, and the fallback order is
                            the point. entity_id is the invoice this payment was
                            TAKEN against; allocations are the invoices it
                            actually PAID. For an ordinary invoice payment they
                            are the same one. For an advance the first is NULL
                            and only the second has an answer — which is why this
                            column showed a dash on money that had already
                            settled two invoices. */}
                        {row.entity_type === 'customer_invoice' && row.entity_id ? (
                          <InvoiceLink id={row.entity_id} token={row.invoice_token} nav={navigate} to={P.customerInvoices} />
                        ) : byInvoice(row.allocations).length ? (
                          byInvoice(row.allocations).map(a => (
                            <div key={a.invoice_id} style={{ whiteSpace: 'nowrap' }}>
                              <InvoiceLink id={a.invoice_id} token={a.token} nav={navigate} to={P.customerInvoices} />
                              <span className="pay-sub"> · {fmt(a.amount)}</span>
                            </div>
                          ))
                        ) : '—'}
                      </td>
                      {!user?.hub_id && <td className="pay-sub">{row.hub_name || '—'}</td>}
                      <td className="pay-num">
                        <div className="pay-amt">{fmt(row.amount)}</div>
                        {Number(row.refunded) > 0 && (
                          <div className="pay-sub pay-refunded">−{fmt(row.refunded)} refunded</div>
                        )}
                        {/* WHERE THE MONEY WENT.
                            `allocated` has been coming back from the API since
                            the union was written and was never shown, which made
                            an advance unreadable on this screen: it said
                            ₹32,432.00 with nothing to say that ₹19,943 of it had
                            settled an invoice. People then looked for a separate
                            "credit applied" row that does not and should not
                            exist — applying credit writes an allocation, not a
                            payment, and a second row would be the same rupees
                            counted twice.

                            NULL means not applicable (a gateway transaction is
                            not a ledger row and carries no allocation of its
                            own), so it is checked against null rather than
                            falsiness — 0 is a real and interesting answer here,
                            and `!row.allocated` would hide exactly the rows
                            holding entirely unapplied money. */}
                        {row.allocated !== null && row.allocated !== undefined && (() => {
                          const used   = Number(row.allocated) || 0;
                          const unused = Number((Number(row.amount) - used).toFixed(2));
                          // Fully applied is the ordinary case for an invoice
                          // payment — every one of them is allocated in full the
                          // moment it is recorded. Saying so on every row would
                          // be noise on the many to be useful on the few.
                          if (unused <= 0.01) return null;
                          return (
                            <div className="pay-sub pay-alloc">
                              {used > 0.01 ? `${fmt(used)} applied · ` : ''}
                              <strong>{fmt(unused)} unused</strong>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="pay-sub">{row.method_detail || '—'}</td>
                      <td><StatusChip status={row.status} /></td>
                      <td className="pay-sub">{fmtWhen(row.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <PaginationBar
          page={page} total={total} pageSize={pageSize}
          onPage={setPage}
          onPageSize={n => { setPageSize(n); setPage(1); }}
          noun="payment"
        />
        </>}
      </div>

      {routeRef && (
        <PaymentDrawer
          txnRef={routeRef}
          onClose={() => navigate(P.payments)}
          onChanged={load}
        />
      )}
    </>
  );
}

function Kpi({ label, value, hint, tone }) {
  return (
    <div className={`pay-kpi pay-kpi--${tone}`}>
      <div className="pay-kpi-label">{label}</div>
      <div className="pay-kpi-value">{value}</div>
      <div className="pay-kpi-hint">{hint}</div>
    </div>
  );
}

function FilterFields({ filters, setFilters, onChanged }) {
  const set = k => e => { setFilters(f => ({ ...f, [k]: e.target.value })); onChanged?.(); };
  return (
    <div className="lb-pop-body">
      <label className="lb-pop-label" htmlFor="pay-f-status">Status</label>
      <select id="pay-f-status" className="form-input" value={filters.status} onChange={set('status')}>
        <option value="">Any</option>
        <option value="captured">Paid</option>
        <option value="failed">Failed</option>
        <option value="created,attempted">Not finished</option>
        <option value="refunded,partially_refunded">Refunded</option>
      </select>

      <label className="lb-pop-label" htmlFor="pay-f-source">Source</label>
      <select id="pay-f-source" className="form-input" value={filters.source} onChange={set('source')}>
        <option value="">Everything</option>
        <option value="manual">Recorded by hand</option>
        <option value="gateway">Taken online</option>
      </select>

      <label className="lb-pop-label" htmlFor="pay-f-mode">Mode</label>
      <select id="pay-f-mode" className="form-input" value={filters.mode} onChange={set('mode')}>
        <option value="">Any</option>
        <option value="live">Live</option>
        <option value="test">Test</option>
      </select>

      <label className="lb-pop-label">Date range</label>
      <div className="lb-pop-row">
        <input className="form-input" type="date" value={filters.date_from}
               max={filters.date_to || istToday()} onChange={set('date_from')} />
        <input className="form-input" type="date" value={filters.date_to}
               min={filters.date_from || undefined} max={istToday()} onChange={set('date_to')} />
      </div>

      <div className="pay-quickrange">
        {[['Today', 0], ['7 days', 6], ['30 days', 29]].map(([label, back]) => (
          <button key={label} type="button" className="btn btn-ghost"
            onClick={() => {
              setFilters(f => ({ ...f, date_from: addDays(istToday(), -back), date_to: istToday() }));
              onChanged?.();
            }}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function fmtWhen(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}
