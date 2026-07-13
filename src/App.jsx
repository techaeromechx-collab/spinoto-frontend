import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth, useCan } from './auth/AuthContext.jsx';
import PWAInstallBanner from './components/PWAInstallBanner.jsx';
import LoginPage from './auth/LoginPage.jsx';
import LandingPage from './pages/LandingPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import LocationsPage from './pages/LocationsPage.jsx';
import VehiclesPage from './pages/VehiclesPage.jsx';
import ServicesPage from './pages/ServicesPage.jsx';
import LeadsPage from './pages/LeadsPage.jsx';
import LeadStatusesPage from './pages/LeadStatusesPage.jsx';
import DepartmentsPage  from './pages/DepartmentsPage.jsx';
import HubsPage              from './pages/HubsPage.jsx';
import AppointmentsPage      from './pages/AppointmentsPage.jsx';
import CustomersPage         from './pages/CustomersPage.jsx';
import PartsPage from './pages/PartsPage.jsx';
import DiscountMasterPage from './pages/DiscountMasterPage.jsx';
import EstimatesPage from './pages/EstimatesPage.jsx';
import PurchaseInvoicesPage from './pages/PurchaseInvoicesPage.jsx';
import CustomerInvoicesPage from './pages/CustomerInvoicesPage.jsx';
import PayoutsPage from './pages/PayoutsPage.jsx';
import BulkUploadPage from './pages/BulkUploadPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import SuperAdminsPage from './pages/SuperAdminsPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import AppShell from './components/AppShell.jsx';
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

/** Blocks hub-linked users from admin routes — sends them to /hub */
function RequireAdmin({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="centered">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.hub_id) return <Navigate to="/hub" replace />;
  return children;
}

export default function App() {
  const { user } = useAuth();

  return (
    <>
    {/* PWA install banner — rendered outside Routes, zero layout impact */}
    <PWAInstallBanner />
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Hub portal — standalone, no AppShell */}
      <Route
        path="/hub"
        element={
          <RequireAuth>
            <HubDashboardPage />
          </RequireAuth>
        }
      />

      {/* Show Landing Page at root only if NOT authenticated */}
      {!user && <Route path="/" element={<LandingPage />} />}

      <Route
        path="/*"
        element={
          <RequireAdmin>
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

                {/* Pricing is now embedded in ServicesPage — redirect old URL */}
                <Route path="/master/pricing"   element={<Navigate to="/master/services" replace />} />

                {/* HUBs (Aggregators) */}
                <Route path="/hubs" element={<RequirePermission codes={['VIEW_HUB','MANAGE_HUBS','CREATE_HUB','EDIT_HUB']}><HubsPage /></RequirePermission>} />

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

                {/* Leads */}
                <Route path="/leads"            element={<RequirePermission codes={['VIEW_LEAD','CREATE_LEAD']}><LeadsPage /></RequirePermission>} />
                <Route path="/leads/:token"     element={<RequirePermission codes={['VIEW_LEAD','CREATE_LEAD']}><LeadsPage /></RequirePermission>} />

                {/* Appointments */}
                <Route path="/appointments"     element={<RequirePermission codes={['VIEW_APPOINTMENT','CREATE_APPOINTMENT','EDIT_APPOINTMENT']}><AppointmentsPage /></RequirePermission>} />
                <Route path="/appointments/:token" element={<RequirePermission codes={['VIEW_APPOINTMENT','CREATE_APPOINTMENT','EDIT_APPOINTMENT']}><AppointmentsPage /></RequirePermission>} />

                {/* Customers */}
                <Route path="/customers"        element={<RequirePermission codes={['VIEW_CUSTOMER','VIEW_LEAD']}><CustomersPage /></RequirePermission>} />
                <Route path="/customers/:token" element={<RequirePermission codes={['VIEW_CUSTOMER','VIEW_LEAD']}><CustomersPage /></RequirePermission>} />

                {/* Estimates */}
                <Route path="/estimates"        element={<RequirePermission codes={['VIEW_ESTIMATE','CREATE_ESTIMATE','EDIT_ESTIMATE']}><EstimatesPage /></RequirePermission>} />
                <Route path="/estimates/:token" element={<RequirePermission codes={['VIEW_ESTIMATE','CREATE_ESTIMATE','EDIT_ESTIMATE']}><EstimatesPage /></RequirePermission>} />

                {/* Purchase Invoices */}
                <Route path="/purchase-invoices" element={<RequirePermission codes={['VIEW_INVOICE','VIEW_HUB','MANAGE_HUBS']}><PurchaseInvoicesPage /></RequirePermission>} />
                <Route path="/purchase-invoices/:token" element={<RequirePermission codes={['VIEW_INVOICE','VIEW_HUB','MANAGE_HUBS']}><PurchaseInvoicesPage /></RequirePermission>} />

                {/* Customer Invoices */}
                <Route path="/customer-invoices" element={<RequirePermission codes={['VIEW_INVOICE','CREATE_INVOICE','EDIT_INVOICE','ADD_INVOICE_PAYMENT']}><CustomerInvoicesPage /></RequirePermission>} />
                <Route path="/customer-invoices/:token" element={<RequirePermission codes={['VIEW_INVOICE','CREATE_INVOICE','EDIT_INVOICE','ADD_INVOICE_PAYMENT']}><CustomerInvoicesPage /></RequirePermission>} />

                {/* Hub Payouts Dashboard — no detail view of its own (per the
                    shareable-urls audit: every Payouts link targets Purchase
                    Invoices or Customer Invoices), so no :token route here. */}
                <Route path="/payouts" element={<RequirePermission codes={['VIEW_HUB','MANAGE_HUBS','VIEW_INVOICE']}><PayoutsPage /></RequirePermission>} />

                {/* Legacy invoices page — redirect to customer invoices */}
                <Route path="/invoices"     element={<Navigate to="/customer-invoices" replace />} />
                <Route path="/invoices/:id" element={<Navigate to="/customer-invoices" replace />} />

                {/* Operations */}
                <Route path="/bulk-upload"      element={<RequirePermission codes={['BULK_UPLOAD']}><BulkUploadPage /></RequirePermission>} />
                <Route path="/reports"          element={<RequirePermission codes={['VIEW_REPORTS']}><ReportsPage /></RequirePermission>} />

                {/* User & permission management */}
                <Route path="/users"            element={<RequirePermission codes={['MANAGE_USERS', 'VIEW_TEAM_LEADS']}><UsersPage /></RequirePermission>} />
                <Route path="/super-admins"    element={<RequireSuperAdmin><SuperAdminsPage /></RequireSuperAdmin>} />

                {/* Profile — available to every logged-in user */}
                <Route path="/profile" element={<ProfilePage />} />

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppShell>
          </RequireAdmin>
        }
      />
    </Routes>
    </>
  );
}
