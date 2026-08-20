import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useAuth, useCan } from './auth/AuthContext.jsx';
import PWAInstallBanner from './components/PWAInstallBanner.jsx';
import LoginPage from './auth/LoginPage.jsx';
import LandingPage from './pages/LandingPage.jsx';
import PublicInvoicePage from './pages/PublicInvoicePage.jsx';
import PublicPayPage from './pages/PublicPayPage.jsx';
import PublicEstimatePage from './pages/PublicEstimatePage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import LocationsPage from './pages/LocationsPage.jsx';
import VehiclesPage from './pages/VehiclesPage.jsx';
import ServicesPage from './pages/ServicesPage.jsx';
import LeadsPage from './pages/LeadsPage.jsx';
import LeadStatusesPage from './pages/LeadStatusesPage.jsx';
import DepartmentsPage  from './pages/DepartmentsPage.jsx';
import HubsPage              from './pages/HubsPage.jsx';
import WorkshopsPage         from './pages/WorkshopsPage.jsx';
import AppointmentsPage      from './pages/AppointmentsPage.jsx';
import CustomersPage         from './pages/CustomersPage.jsx';
import PartsPage from './pages/PartsPage.jsx';
import DiscountMasterPage from './pages/DiscountMasterPage.jsx';
import WarrantyMasterPage from './pages/WarrantyMasterPage.jsx';
import ClaimsPage from './pages/ClaimsPage.jsx';
import EstimatesPage from './pages/EstimatesPage.jsx';
import PurchaseInvoicesPage from './pages/PurchaseInvoicesPage.jsx';
import CustomerInvoicesPage from './pages/CustomerInvoicesPage.jsx';
import PayoutsPage from './pages/PayoutsPage.jsx';
import PaymentsPage from './pages/PaymentsPage.jsx';
import BulkUploadPage from './pages/BulkUploadPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
// UsersPage/SuperAdminsPage are no longer routed to directly — they're
// rendered as tabs inside SettingsPage.jsx now (/users and /super-admins
// below just redirect there).
import ProfilePage from './pages/ProfilePage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import AppShell from './components/AppShell.jsx';
import { UnsavedChangesProvider } from './components/UnsavedChangesGuard.jsx';
import HubDashboardPage from './pages/HubDashboardPage.jsx';

/**
 * Permission gate. Allows the page if the user has any of the given
 * permission codes (or is super admin). When `allowReadOnly` is true,
 * the gate also passes for any authenticated user — used for master-data
 * pages where reads are open and writes are gated inside the page.
 */
function RequirePermission({ codes = [], allowReadOnly = false, children }) {
  const { user } = useAuth();
  const hasOne = useCan(...codes);
  if (!user) return <Navigate to="/login" replace />;
  if (allowReadOnly) return children;
  if (codes.length === 0 || hasOne) return children;
  return <Navigate to="/" replace />;
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="centered">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function RequireSuperAdmin({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="centered">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.is_super_admin) return <Navigate to="/" replace />;
  return children;
}

/**
 * Redirects an older document address onto its stable public one.
 *
 *   /customer-invoices/<token>  →  /invoice/<token>
 *   /estimates/<token>          →  /estimate/<token>
 *
 * Both old paths are printed on paper QR codes and sitting in customers'
 * WhatsApp history, so they can never simply be removed. Redirecting — rather
 * than mounting the public pages at two addresses — keeps one implementation of
 * each page and one place to change if either ever gains a step.
 *
 * `replace`, not push: the customer arrived from a WhatsApp message, and Back
 * should return them to the chat rather than to this redirect, which would
 * immediately fire again and trap them.
 */
function LegacyDocRedirect({ to }) {
  const { token } = useParams();
  return <Navigate to={`/${to}/${encodeURIComponent(token || '')}`} replace />;
}

/** Blocks hub-linked users from admin routes — sends them to /hub */
function RequireAdmin({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="centered">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.hub_id) return <Navigate to="/hub" replace />;
  return children;
}

export default function App() {
  // `loading` matters here, not just `user`. During the initial token check
  // `user` is null, so a `{!user && …}` route is mounted for that first tick —
  // harmless for the landing page below, but the public invoice route performs
  // a location.replace(), which would hijack a logged-in staff member's
  // /customer-invoices/:token deep link on every page refresh.
  const { user, loading } = useAuth();

  return (
    <>
    {/* PWA install banner — rendered outside Routes, zero layout impact */}
    <PWAInstallBanner />
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Hub portal — standalone, no AppShell.
          A splat, not a bare '/hub': HubDashboardPage mounts its own nested
          <Routes> for the tabs, exactly as AppShell does for the admin branch
          below. That is what gives each tab a real URL, so a refresh, the Back
          button and a bookmark all land where the hub user actually was
          instead of resetting to the dashboard. */}
      <Route
        path="/hub/*"
        element={
          <RequireAuth>
            <HubDashboardPage />
          </RequireAuth>
        }
      />

      {/* Show Landing Page at root only if NOT authenticated */}
      {!user && <Route path="/" element={<LandingPage />} />}

      {/* ── The customer-facing document pages ────────────────────────────────

          /invoice/:token and /estimate/:token are UNCONDITIONALLY public. No
          `!user` gate, because nothing else lives at those paths — so they
          behave identically for a customer, a staff member checking a link they
          just sent, and a hub user.

          That is the whole point of these two routes existing. The older
          addresses below share a path with a staff deep link, which means their
          meaning depends on who is looking: signed out you get the public page,
          signed in you fall through to the CRM — and a hub session is bounced
          to /hub, landing on a dashboard instead of the document it asked for.

          One address, one meaning. */}
      <Route path="/invoice/:token"  element={<PublicInvoicePage />} />
      <Route path="/estimate/:token" element={<PublicEstimatePage />} />

      {/* The advance receipt voucher — and the refund voucher; the token says
          which. Public on the same terms and for the same reason: it is a
          numbered tax document the customer is entitled to hold, and it reaches
          them by WhatsApp link and by the QR printed on the voucher itself.

          Same component as the invoice, differing only in which endpoint it
          opens and the word shown while it loads. */}
      <Route path="/advance/:token"
             element={<PublicInvoicePage endpoint="advance" noun="receipt" />} />

      {/* ── The older addresses, kept as aliases ──────────────────────────────

          QR codes carrying /customer-invoices/<token> and /estimates/<token>
          are already printed on paper in customers' hands, and links already
          sent over WhatsApp are already in people's chat history. Those URLs
          have to keep resolving, forever.

          They redirect rather than mounting the public pages a second time, so
          there is exactly one implementation of each.

          The `!user` gate STAYS on these two. Removing it would hijack the
          staff deep link into the CRM — signed-in staff opening
          /customer-invoices/<token> must still land on CustomerInvoicesPage.

          `!loading` is load-bearing — see the note on useAuth() above. While the
          session is still being checked this route stays unmounted, `/*` matches
          instead and RequireAdmin shows its spinner; once the check settles the
          right one of the two takes over. */}
      {!loading && !user && (
        <Route path="/customer-invoices/:token" element={<LegacyDocRedirect to="invoice" />} />
      )}

      {/* The customer's pay-by-link page. Unconditionally public, unlike the
          invoice route above: that one is mounted only for anonymous visitors
          because it SHARES its path with a staff deep link, and there is no
          staff screen at /pay. A logged-in staff member following a link they
          just sent should see exactly what the customer sees. */}
      <Route path="/pay/:token" element={<PublicPayPage />} />

      {!loading && !user && (
        <Route path="/estimates/:token" element={<LegacyDocRedirect to="estimate" />} />
      )}

      <Route
        path="/*"
        element={
          <RequireAdmin>
            {/* Above AppShell on purpose. Scoped to SettingsPage it only covered
                the two links inside that page — the sidebar, breadcrumbs, user
                menu and mobile nav all sit here and silently discarded unsaved
                work. Guarding at this level means any screen that registers a
                dirty flag is protected from every in-app navigation. */}
            <UnsavedChangesProvider>
            <AppShell>
              <Routes>
                <Route path="/" element={<DashboardPage />} />

                {/* Master data — readable by anyone authenticated; writes are gated inside pages */}
                <Route path="/master/locations" element={<RequirePermission allowReadOnly><LocationsPage /></RequirePermission>} />
                <Route path="/master/vehicles"  element={<RequirePermission codes={['VIEW_VEHICLE','MANAGE_MASTER_DATA','VIEW_ESTIMATE','CREATE_ESTIMATE','EDIT_ESTIMATE']}><VehiclesPage /></RequirePermission>} />
                <Route path="/master/services"  element={<RequirePermission codes={['VIEW_SERVICE','MANAGE_MASTER_DATA','MANAGE_PRICING','VIEW_ESTIMATE','CREATE_ESTIMATE','EDIT_ESTIMATE']}><ServicesPage /></RequirePermission>} />
                <Route path="/master/lead-statuses" element={<RequirePermission codes={['VIEW_LEAD','CREATE_LEAD','EDIT_LEAD','MANAGE_MASTER_DATA']}><LeadStatusesPage /></RequirePermission>} />
                <Route path="/master/departments"   element={<RequirePermission codes={['CREATE_LEAD','VIEW_LEAD','VIEW_TEAM_LEADS','VIEW_OWN_LEADS','VIEW_APPOINTMENT','CREATE_APPOINTMENT','EDIT_APPOINTMENT','MANAGE_MASTER_DATA']}><DepartmentsPage /></RequirePermission>} />
                <Route path="/master/parts"        element={<RequirePermission codes={['MANAGE_MASTER_DATA','VIEW_ESTIMATE','CREATE_ESTIMATE','EDIT_ESTIMATE','VIEW_INVOICE','CREATE_INVOICE','EDIT_INVOICE']}><PartsPage /></RequirePermission>} />
                <Route path="/master/discounts"    element={<RequirePermission codes={['MANAGE_MASTER_DATA','VIEW_ESTIMATE','CREATE_ESTIMATE','EDIT_ESTIMATE','VIEW_INVOICE','CREATE_INVOICE','EDIT_INVOICE','VIEW_LEAD','CREATE_LEAD']}><DiscountMasterPage /></RequirePermission>} />
                <Route path="/master/warranties"   element={<RequirePermission codes={['MANAGE_WARRANTIES','CREATE_WARRANTY','EDIT_WARRANTY','DELETE_WARRANTY','MANAGE_MASTER_DATA','VIEW_ESTIMATE','CREATE_ESTIMATE','EDIT_ESTIMATE','VIEW_INVOICE','CREATE_INVOICE','EDIT_INVOICE','VIEW_LEAD','CREATE_LEAD']}><WarrantyMasterPage /></RequirePermission>} />

                {/* Pricing is now embedded in ServicesPage — redirect old URL */}
                <Route path="/master/pricing"   element={<Navigate to="/master/services" replace />} />

                {/* HUBs (Aggregators) */}
                <Route path="/hubs" element={<RequirePermission codes={['VIEW_HUB','MANAGE_HUBS','CREATE_HUB','EDIT_HUB']}><HubsPage /></RequirePermission>} />
                <Route path="/workshops" element={<RequirePermission codes={['VIEW_WORKSHOP','CREATE_WORKSHOP','EDIT_WORKSHOP','MANAGE_HUBS']}><WorkshopsPage /></RequirePermission>} />

                {/*
                  Shareable detail URLs (":token" routes below) — shared convention:

                  Each list page (LeadsPage, AppointmentsPage, etc.) already renders
                  both its list AND its detail view internally, so the ":token" route
                  just points at the SAME page component — no new page components
                  needed. Inside that page component:

                    - Read the token via `useParams().token` to know a detail view
                      should be open on mount.
                    - Opening a detail view from a list row: `navigate(`/leads/${token}`)`
                      (PUSH — leaves a history entry, so the back button returns to
                      the list, same as clicking away from any other page).
                    - Closing a detail view / returning to the list:
                      `navigate('/leads')` (PUSH).
                    - Auto-opening a detail view as the *target* of an inbound deep
                      link (e.g. a cross-page link passing a token forward) should use
                      `navigate(path, { replace: true })` instead, so the redirect hop
                      itself doesn't leave an extra back-button stop — mirrors the
                      existing `window.history.replaceState({}, '')` pattern already
                      used after consuming `location.state` on a few pages today.

                  Until a given page is migrated (Phase 3 of the shareable-urls plan),
                  its ":token" route below simply renders the list view unchanged —
                  adding the route now is harmless and lets routing/permissions be
                  wired up ahead of each page's own migration.
                */}

                {/* Leads — single route with an optional :token segment so that
                    opening/closing a lead's detail view (or switching from
                    viewing to editing it) only changes the route param, never
                    which Route matches — switching between two separate sibling
                    Routes for the same component would unmount/remount LeadsPage
                    on every open/close, wiping any state set in the same tick
                    (this was the cause of the "Edit doesn't open" bug). */}
                <Route path="/leads/:token?"     element={<RequirePermission codes={['VIEW_LEAD','CREATE_LEAD']}><LeadsPage /></RequirePermission>} />

                {/* Appointments */}
                <Route path="/appointments/:token?" element={<RequirePermission codes={['VIEW_APPOINTMENT','CREATE_APPOINTMENT','EDIT_APPOINTMENT']}><AppointmentsPage /></RequirePermission>} />

                {/* Customers */}
                <Route path="/customers/:token?" element={<RequirePermission codes={['VIEW_CUSTOMER','VIEW_LEAD']}><CustomersPage /></RequirePermission>} />

                {/* Estimates */}
                <Route path="/estimates/:token?" element={<RequirePermission codes={['VIEW_ESTIMATE','CREATE_ESTIMATE','EDIT_ESTIMATE']}><EstimatesPage /></RequirePermission>} />

                {/* Purchase Invoices */}
                <Route path="/purchase-invoices/:token?" element={<RequirePermission codes={['VIEW_INVOICE','VIEW_HUB','MANAGE_HUBS']}><PurchaseInvoicesPage /></RequirePermission>} />

                {/* Customer Invoices */}
                <Route path="/customer-invoices/:token?" element={<RequirePermission codes={['VIEW_INVOICE','CREATE_INVOICE','EDIT_INVOICE','ADD_INVOICE_PAYMENT']}><CustomerInvoicesPage /></RequirePermission>} />

                {/* Hub Payouts Dashboard — no detail view of its own (per the
                    shareable-urls audit: every Payouts link targets Purchase
                    Invoices or Customer Invoices), so no :token route here. */}
                <Route path="/payouts" element={<RequirePermission codes={['VIEW_HUB','MANAGE_HUBS','VIEW_INVOICE']}><PayoutsPage /></RequirePermission>} />
                {/* Payments. The optional :ref opens the detail drawer, so a
                    payment is linkable, survives a refresh and works with the
                    Back button — the same pattern the other detail views use,
                    with our own txn_ref as the key rather than a database id. */}
                <Route path="/payments/:ref?" element={<RequirePermission codes={['VIEW_PAYMENTS']}><PaymentsPage /></RequirePermission>} />
                <Route path="/warranty-claims" element={<RequirePermission codes={['VIEW_CLAIM','CREATE_CLAIM','APPROVE_CLAIM','RESOLVE_CLAIM','MANAGE_CLAIMS']}><ClaimsPage /></RequirePermission>} />

                {/* Legacy invoices page — redirect to customer invoices */}
                <Route path="/invoices"     element={<Navigate to="/customer-invoices" replace />} />
                <Route path="/invoices/:id" element={<Navigate to="/customer-invoices" replace />} />

                {/* Operations */}
                <Route path="/bulk-upload"      element={<RequirePermission codes={['BULK_UPLOAD']}><BulkUploadPage /></RequirePermission>} />
                <Route path="/reports"          element={<RequirePermission codes={['VIEW_REPORTS']}><ReportsPage /></RequirePermission>} />

                {/* User & permission management — folded into the Settings
                    module (see /settings below). Old links/bookmarks keep
                    working via redirect. The one caller that passed
                    navigation state through this route (AppShell's global
                    search → openUserId) was updated to navigate straight to
                    /settings, since <Navigate> here can't forward state. */}
                <Route path="/users"         element={<Navigate to="/settings?tab=manage-users" replace />} />
                <Route path="/super-admins" element={<Navigate to="/settings?tab=super-admins" replace />} />

                {/* Settings — available to every logged-in user; each tab
                    gates itself internally (mirrors /profile below), since
                    the module mixes tabs open to everyone (Account) with
                    ones restricted to super admins or MANAGE_USERS/
                    VIEW_TEAM_LEADS holders (Manage Users, Manage Business,
                    Invoice/Print Settings, Reminders, Super Admins). */}
                <Route path="/settings" element={<SettingsPage />} />

                {/* Profile — available to every logged-in user */}
                <Route path="/profile" element={<ProfilePage />} />

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppShell>
            </UnsavedChangesProvider>
          </RequireAdmin>
        }
      />
    </Routes>
    </>
  );
}
