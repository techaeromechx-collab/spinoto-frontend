// Settings > Print Settings tab. Deliberately minimal for now — the Invoice
// Theme tab already controls the printed/PDF layout; this is a placeholder
// for finer-grained print toggles (e.g. company-wide defaults for
// "include B2B details" / "include notes", which today are per-session
// checkboxes on the invoice's own print view) once that's scoped out.
import { Printer } from 'lucide-react';
import { SectionHeader } from './shared.jsx';

export default function PrintSettings() {
  return (
    <div className="prfl-card">
      <SectionHeader icon={<Printer size={15} />} title="Print Settings" />
      <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Invoice layout and branding are controlled from the <strong>Invoice Settings</strong> tab.
        Fine-grained print toggles (default B2B/notes visibility, per-document overrides) are coming soon here.
      </div>
    </div>
  );
}
