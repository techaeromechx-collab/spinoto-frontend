// Extracted from ProfilePage.jsx's "push" tab — was the "Alert Thresholds"
// card (previously read/wrote the parent's `alertCfg` state and called its
// `saveAlertCfg()`, fetched only when activeTab === 'push'). Now fully
// self-contained: owns its own state, fetches on mount, saves independently.
// Same fields, same /api/settings/alert GET/PUT contract, same layout.
import { useState, useEffect } from 'react';
import { Settings } from 'lucide-react';
import { api } from '../../api/client.js';
import { SectionHeader } from './shared.jsx';

const FIELDS = [
  { key: 'no_activity_hours',              label: 'No Activity Alert',              unit: 'hours',       desc: 'Alert if no CRM activity for X hours' },
  { key: 'inactive_lead_days',             label: 'Inactive Lead Alert',            unit: 'days',        desc: 'Alert if lead has no activity for X days' },
  { key: 'daily_target_hour',              label: 'Daily Target Check Time',        unit: 'hour (24h)',  desc: 'Check target after this hour (18 = 6 PM)' },
  { key: 'escalation_overdue_days',        label: 'Escalation — Overdue Days',      unit: 'days',        desc: 'Escalate if lead overdue by X days' },
  { key: 'escalation_missed_count',        label: 'Escalation — Missed Follow-ups', unit: 'count',       desc: 'Escalate if X or more follow-ups missed' },
  { key: 'work_start_hour',                label: 'Working Hours Start',            unit: 'hour (24h)',  desc: 'No Activity alert starts at this hour' },
  { key: 'work_end_hour',                  label: 'Working Hours End',              unit: 'hour (24h)',  desc: 'No Activity alert stops at this hour' },
];

export default function RemindersSettings() {
  const [alertCfg,     setAlertCfg]     = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [busy,         setBusy]         = useState(false);
  const [ok,           setOk]           = useState(false);
  const [err,          setErr]          = useState(null);

  useEffect(() => {
    api('/api/settings/alert')
      .then(r => setAlertCfg(r))
      .catch(() => setErr('Failed to load alert thresholds.'))
      .finally(() => setLoading(false));
  }, []);

  async function saveAlertCfg() {
    setBusy(true); setErr(null); setOk(false);
    try {
      const r = await api('/api/settings/alert', { method: 'PUT', body: alertCfg });
      setAlertCfg(r.alert_settings);
      setOk(true);
      setTimeout(() => setOk(false), 3000);
    } catch (e) {
      setErr(e.message || 'Failed to save thresholds.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="prfl-card">
      <SectionHeader icon={<Settings size={15}/>} title="Alert Thresholds" />
      <p className="prfl-card-desc">Configure when each automatic alert fires. Changes take effect on the next scheduler run (every 10 min).</p>

      {ok  && <div className="prfl-alert prfl-alert--success" style={{ margin: '14px 0 0' }}>Alert thresholds saved successfully!</div>}
      {err && <div className="prfl-alert prfl-alert--error"   style={{ margin: '14px 0 0' }}>{err}</div>}

      {loading && <div style={{ padding: '16px 0', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>}

      {alertCfg && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
          {FIELDS.map(({ key, label, unit, desc }) => (
            <div key={key} className="prfl-field" style={{ margin: 0 }}>
              <label style={{ fontSize: 12 }}>{label} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({unit})</span></label>
              <input
                type="number"
                min={1}
                value={alertCfg[key] ?? ''}
                onChange={e => setAlertCfg(prev => ({ ...prev, [key]: parseInt(e.target.value, 10) || 1 }))}
                title={desc}
              />
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <button className="prfl-btn-primary" onClick={saveAlertCfg} disabled={busy || !alertCfg}>
          {busy ? 'Saving…' : 'Save Thresholds'}
        </button>
      </div>
    </div>
  );
}
