// Small shared building blocks reused across the Settings module's tabs.
// Mirrors the equivalent local components that used to live inside
// ProfilePage.jsx (SectionHeader, Spinner) — pulled out here so the tabs
// that were extracted from ProfilePage (CompanyDetailsCard, RoleCreatorPanel,
// RemindersSettings, AccountSettings) don't each need their own copy.
import { Loader } from 'lucide-react';

export function SectionHeader({ icon, title, count }) {
  return (
    <div className="prfl-card-hd">
      <span className="prfl-card-title">
        {icon && <span className="prfl-card-title-icon">{icon}</span>}
        {title}
      </span>
      {count !== undefined && (
        <span className="prfl-card-count">{count}</span>
      )}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="prfl-spinner"><Loader size={22} /></div>
  );
}
