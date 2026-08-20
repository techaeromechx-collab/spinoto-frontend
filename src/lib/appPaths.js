/**
 * Where does a given screen live for the current user?
 *
 * The same page components are mounted under two different route trees:
 *
 *   staff  →  /estimates, /purchase-invoices, …   (App.jsx's admin branch)
 *   hub    →  /hub/estimates, /hub/sales-invoices, …  (HubDashboardPage)
 *
 * A hub-linked user is bounced off every admin route by App.jsx's
 * RequireAdmin, so a hardcoded `/estimates` inside a shared page is a dead
 * link for half its callers. This module is the single place that knows the
 * mapping — the same job hubScope.js does on the backend.
 *
 * `null` means the destination does not exist in that shell at all. The hub
 * portal has no Customers, Leads, Payouts, Reports or Warranty Claims screen.
 * Callers must HIDE those links rather than navigate to them:
 *
 *     {P.customers && <button onClick={() => navigate(`${P.customers}/…`)}>…}
 *
 * A dead link a hub can click and watch do nothing is worse than no link, and
 * `navigate(null + '/abc')` would put the string "null/abc" in the address bar.
 */
import { useAuth } from '../auth/AuthContext.jsx';

const STAFF_PATHS = {
  dashboard:        '/',
  appointments:     '/appointments',
  estimates:        '/estimates',
  salesInvoices:    '/purchase-invoices',
  customerInvoices: '/customer-invoices',
  customers:        '/customers',
  leads:            '/leads',
  payouts:          '/payouts',
  payments:         '/payments',
  warrantyClaims:   '/warranty-claims',
  services:         '/master/services',
  profile:          '/profile',
};

// Keys are identical to STAFF_PATHS so a caller can read P.<key> without
// knowing which shell it is in. Anything the hub portal has no tab for is
// null, never a guessed path.
const HUB_PATHS = {
  dashboard:        '/hub',
  appointments:     '/hub/appointments',
  estimates:        '/hub/estimates',
  // 'sales-invoices', not 'purchase-invoices': the hub portal calls this
  // document a Sales Invoice, because from the hub's side that is what it is.
  salesInvoices:    '/hub/sales-invoices',
  customerInvoices: '/hub/customer-invoices',
  services:         '/hub/services',
  // The hub portal's own account screen. Staff have /profile inside AppShell;
  // hubs are bounced off it by RequireAdmin, so they get their own.
  profile:          '/hub/profile',
  customers:        null,
  leads:            null,
  payouts:          null,
  // No Payments screen in the hub portal — a deliberate decision, not an
  // oversight. The backend scopes every payments query by hub anyway
  // (utils/hubScope.js), so switching this on later is a path plus a nav entry,
  // not a security review.
  payments:         null,
  warrantyClaims:   null,
};

/**
 * The path map for whichever shell the caller is rendered in.
 * Keyed off hub_id, the same signal every other hub check uses.
 */
export function useAppPaths() {
  const { user } = useAuth();
  return user?.hub_id ? HUB_PATHS : STAFF_PATHS;
}

export { STAFF_PATHS, HUB_PATHS };
