// Consolidated Settings module — replaces the old scattered locations for
// this content: ProfilePage.jsx's "Super Admin"/"Push Alerts"/"Settings"
// tabs, plus the standalone /users and /super-admins pages. Tab state is
// driven by a ?tab= query param, mirroring the pattern ProfilePage.jsx
// already used for its own tabs.
import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import {
  User, Building2, Palette, Printer, UserCog, Bell, Shield, ArrowLeft, Lock,
} from 'lucide-react';
import { useAuth, useCan } from '../auth/AuthContext.jsx';
import { useUnsavedGuard } from '../components/UnsavedChangesGuard.jsx';
import '../styles/ProfilePage.css';
import '../styles/SettingsPage.css';

import AccountSettings from '../components/settings/AccountSettings.jsx';
import CompanyDetailsCard from '../components/settings/CompanyDetailsCard.jsx';
import InvoiceThemeSettings from '../components/settings/InvoiceThemeSettings.jsx';
import PrintSettings from '../components/settings/PrintSettings.jsx';
import RemindersSettings from '../components/settings/RemindersSettings.jsx';
import AccountingPeriodSettings from '../components/settings/AccountingPeriodSettings.jsx';
import RoleCreatorPanel from '../components/settings/RoleCreatorPanel.jsx';
import UsersPage from './UsersPage.jsx';
import SuperAdminsPage from './SuperAdminsPage.jsx';

// The provider now lives in App.jsx, above AppShell, so the sidebar and every
// other in-app link are guarded too — not just the two exits on this page.
export default function SettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  // Every way out of a settings tab routes through this. If the open tab has
  // no unsaved work it's a straight pass-through.
  const guard = useUnsavedGuard();
  const canManageUsers = useCan('MANAGE_USERS', 'VIEW_TEAM_LEADS');
  // Reminders is the one Settings tab that can be delegated to a custom role:
  // its contents are operational thresholds, not company identity or bank
  // details. Super admins still pass — is_super_admin bypasses every check.
  const canManageReminders = useCan('MANAGE_REMINDERS');
  // Invoice Settings covers themes, logo, signature, terms and bank details.
  // Deliberately NOT company identity — that stays on the Manage Business tab
  // behind the super-admin check, and saves through a different endpoint.
  const canManageDocSettings = useCan('MANAGE_DOCUMENT_SETTINGS');
  // Closing the books is an accounting decision, not a system-admin one, so
  // it gets its own delegable permission rather than riding on super-admin.
  const canManageBooksLock  = useCan('MANAGE_BOOKS_LOCK');
  const isSuperAdmin = !!user?.is_super_admin;

  const TABS = [
    { key: 'account',       label: 'Account',        Icon: User,     show: true },
    { key: 'business',      label: 'Manage Business', Icon: Building2, show: isSuperAdmin },
    { key: 'invoice',       label: 'Invoice Settings', Icon: Palette,  show: canManageDocSettings },
    { key: 'print',         label: 'Print Settings',  Icon: Printer,  show: isSuperAdmin },
    { key: 'manage-users',  label: 'Manage Users',    Icon: UserCog,  show: canManageUsers },
    { key: 'reminders',     label: 'Reminders',       Icon: Bell,     show: canManageReminders },
    { key: 'accounting',    label: 'Accounting Period', Icon: Lock,   show: canManageBooksLock },
    { key: 'super-admins',  label: 'Super Admins',    Icon: Shield,   show: isSuperAdmin },
  ].filter(t => t.show);

  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const [activeTab, setActiveTab] = useState(requested || TABS[0]?.key || 'account');

  // ── URL → state ──────────────────────────────────────────────────────────
  // This direction was missing entirely. activeTab was seeded from ?tab= once,
  // so navigating to /settings?tab=manage-users while ALREADY on Settings did
  // nothing — and the sync effect below then rewrote the URL back, erasing the
  // param. Every cross-page link into a specific tab was silently broken.
  useEffect(() => {
    if (requested && requested !== activeTab && TABS.some(t => t.key === requested)) {
      setActiveTab(requested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  // ── state → URL ──────────────────────────────────────────────────────────
  // Only once the tab list is populated. Permissions arrive asynchronously, so
  // on the first render TABS can be just ['account'] — writing the URL then
  // would clobber a bookmarked ?tab= before its tab had appeared.
  useEffect(() => {
    if (TABS.length <= 1) return;
    if (params.get('tab') !== activeTab) {
      setParams(prev => {
        const next = new URLSearchParams(prev);
        next.set('tab', activeTab);
        return next;
      }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, TABS.length]);

  // If the active tab isn't valid (permissions changed, stale bookmark, or the
  // tab list hadn't loaded when it was seeded), fall back to the first visible
  // one — but only once there is a real list to fall back to.
  useEffect(() => {
    if (TABS.length > 0 && !TABS.some(t => t.key === activeTab)) {
      setActiveTab(TABS[0].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [TABS.map(t => t.key).join(','), activeTab]);

  return (
    <div className="settings-page">
      <div className="settings-sidebar">
        {/* Kept as a <Link> rather than a button so middle-click and
            "open in new tab" still work — those don't fire onClick, and a
            new tab leaves the dirty one untouched anyway. */}
        <Link to="/" className="settings-back-link"
          onClick={e => { if (!guard(() => navigate('/'))) e.preventDefault(); }}>
          <ArrowLeft size={15} /> Back to Dashboard
        </Link>
        <div className="settings-sidebar-title">Settings</div>
        <nav className="settings-nav">
          {TABS.map(t => (
            <button
              key={t.key}
              className={`settings-nav-item ${activeTab === t.key ? 'settings-nav-item--active' : ''}`}
              onClick={() => guard(() => setActiveTab(t.key))}
            >
              <t.Icon size={16} /> {t.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="settings-content">
        {activeTab === 'account'      && <AccountSettings />}
        {activeTab === 'business'     && isSuperAdmin && <CompanyDetailsCard />}
        {activeTab === 'invoice'      && canManageDocSettings && <InvoiceThemeSettings />}
        {activeTab === 'print'        && isSuperAdmin && <PrintSettings />}
        {activeTab === 'manage-users' && canManageUsers && <UsersPage />}
        {activeTab === 'reminders'    && canManageReminders && <RemindersSettings />}
        {activeTab === 'accounting'   && canManageBooksLock && <AccountingPeriodSettings />}
        {activeTab === 'super-admins' && isSuperAdmin && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <SuperAdminsPage />
            <RoleCreatorPanel />
          </div>
        )}
      </div>
    </div>
  );
}
