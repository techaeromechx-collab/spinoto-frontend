// Moved out of ProfilePage.jsx's "Settings" tab (Notifications + Password
// pill sub-tabs, formerly around lines 1759-1841) into the new Settings
// module's "Account" tab. Logic is unchanged — same /api/me/profile PATCH
// for notification toggles, same /api/me/password PATCH for password change.
// All state that used to live at ProfilePage-component scope (notifSettings,
// curPw/newPw/confPw/pwBusy/pwErr/pwOk, settingsSubTab) is now local to this
// component.
import { useState, useEffect } from 'react';
import { Bell, Lock } from 'lucide-react';
import { api } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { SectionHeader } from './shared.jsx';

const DEFAULT_NOTIF_SETTINGS = {
  overdue_lead: true, missed_followup: true, high_priority_lead: true,
  daily_target: true, inactive_lead: true,   lead_escalation: true,
  duplicate_lead: true, lead_assigned: true, lead_converted: true, no_activity: true,
  follow_up_scheduled: true, appointment_reminder: true, note_added: true,
  pricing_changed: true, reference_data_changed: true,
};

const NOTIF_ITEMS = [
  { key: 'overdue_lead',       label: 'Overdue Lead Alerts',       desc: 'When a lead follow-up is overdue',               color: '#dc2626' },
  { key: 'missed_followup',    label: 'Missed Follow-up Alerts',   desc: 'When a scheduled follow-up is missed',           color: '#d97706' },
  { key: 'high_priority_lead', label: 'High Priority Lead Alerts', desc: 'When a high priority lead is assigned',          color: '#7c3aed' },
  { key: 'daily_target',       label: 'Daily Target Alerts',       desc: 'When daily call target is not met by 6 PM',      color: '#2563eb' },
  { key: 'inactive_lead',      label: 'Inactive Lead Alerts',      desc: 'When a lead has no activity for 7+ days',        color: '#0891b2' },
  { key: 'lead_escalation',    label: 'Escalation Alerts',         desc: 'When a lead is escalated to manager',            color: '#9333ea' },
  { key: 'duplicate_lead',     label: 'Duplicate Lead Alerts',     desc: 'When a duplicate lead is detected',              color: '#16a34a' },
  { key: 'lead_assigned',      label: 'New Lead Assignment',       desc: 'When a lead is assigned to you',                 color: '#2563eb' },
  { key: 'lead_converted',     label: 'Lead Conversion',           desc: 'When a lead is won/converted',                   color: '#16a34a' },
  { key: 'no_activity',        label: 'No Activity Warning',       desc: 'When no CRM activity for 2+ hours during work hours', color: '#d97706' },
  { key: 'follow_up_scheduled',label: 'Follow-up Scheduled',       desc: 'When a follow-up is scheduled on your lead',     color: '#0891b2' },
  { key: 'appointment_reminder',label: 'Appointment Reminder',     desc: '30 min / 2 hr / 24 hr before an appointment',   color: '#7c3aed' },
  { key: 'note_added',         label: 'Note Added',                desc: 'When a note is added on your lead',              color: '#d97706' },
  { key: 'pricing_changed',    label: 'Pricing Changed',           desc: 'When pricing changes for a service/category your hub handles', color: '#15803d' },
  { key: 'reference_data_changed', label: 'Reference Data Changed', desc: 'When CC category ranges affecting 2W pricing change', color: '#4338ca' },
];

export default function AccountSettings() {
  const { user } = useAuth();

  // ── Settings sub-tab pill selector ───────────────────────────────────────
  const [settingsSubTab, setSettingsSubTab] = useState('notifications');

  // ── Notification settings ────────────────────────────────────────────────
  const [notifSettings, setNotifSettings] = useState(DEFAULT_NOTIF_SETTINGS);

  useEffect(() => {
    if (user?.notification_settings && Object.keys(user.notification_settings).length) {
      setNotifSettings(prev => ({ ...prev, ...user.notification_settings }));
    }
  }, [user]);

  async function saveNotifSettings(updated) {
    const next = { ...notifSettings, ...updated };
    setNotifSettings(next);
    api('/api/me/profile', { method: 'PATCH', body: { notification_settings: next } }).catch(() => {});
  }

  // ── Password change ──────────────────────────────────────────────────────
  const [curPw,  setCurPw]  = useState('');
  const [newPw,  setNewPw]  = useState('');
  const [confPw, setConfPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr,  setPwErr]  = useState('');
  const [pwOk,   setPwOk]   = useState(false);

  async function handleChangePw(e) {
    e.preventDefault();
    setPwErr(''); setPwOk(false);
    if (newPw !== confPw) { setPwErr('New passwords do not match.'); return; }
    setPwBusy(true);
    try {
      await api('/api/me/password', { method: 'PATCH', body: { current_password: curPw, new_password: newPw } });
      setPwOk(true); setCurPw(''); setNewPw(''); setConfPw('');
      setTimeout(() => setPwOk(false), 3000);
    } catch (e) { setPwErr(e.message); }
    finally { setPwBusy(false); }
  }

  return (
    <div className="prfl-tab-body">
      {/* Settings sub-tabs */}
      <div className="act-subtabs">
        <button className={`act-subtab${settingsSubTab === 'notifications' ? ' act-subtab--active' : ''}`} onClick={() => setSettingsSubTab('notifications')}>
          🔔 Notifications
        </button>
        <button className={`act-subtab${settingsSubTab === 'password' ? ' act-subtab--active' : ''}`} onClick={() => setSettingsSubTab('password')}>
          🔒 Password
        </button>
      </div>

      {/* Notifications sub-tab */}
      {settingsSubTab === 'notifications' && (
        <div className="prfl-card">
          <SectionHeader icon={<Bell size={15}/>} title="Notification Preferences" />
          <div className="prfl-notif-list">
            {NOTIF_ITEMS.map(item => (
              <div key={item.key} className="prfl-notif-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, flex: 1 }}>
                  <div className="prfl-notif-dot" style={{ background: notifSettings[item.key] ? item.color : 'var(--border)' }} />
                  <div>
                    <div className="prfl-notif-label">{item.label}</div>
                    <div className="prfl-notif-desc">{item.desc}</div>
                  </div>
                </div>
                <button
                  className={`prfl-toggle${notifSettings[item.key] ? ' prfl-toggle--on' : ''}`}
                  style={notifSettings[item.key] ? { background: item.color } : {}}
                  onClick={() => saveNotifSettings({ [item.key]: !notifSettings[item.key] })}
                >
                  <span className="prfl-toggle-knob" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Password sub-tab */}
      {settingsSubTab === 'password' && (
        <div className="prfl-card">
          <SectionHeader icon={<Lock size={15}/>} title="Change Password" />
          <p className="prfl-card-desc">Choose a strong password with at least 6 characters.</p>
          {pwErr && <div className="prfl-alert prfl-alert--error">{pwErr}</div>}
          {pwOk  && <div className="prfl-alert prfl-alert--success">Password updated successfully!</div>}
          <form onSubmit={handleChangePw} className="prfl-pw-form">
            <div className="prfl-field">
              <label>Current Password</label>
              <input type="password" required value={curPw} onChange={e => setCurPw(e.target.value)} placeholder="Enter current password" />
            </div>
            <div className="prfl-field">
              <label>New Password</label>
              <input type="password" required minLength={6} value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min. 6 characters" />
            </div>
            <div className="prfl-field">
              <label>Confirm New Password</label>
              <input type="password" required minLength={6} value={confPw} onChange={e => setConfPw(e.target.value)} placeholder="Repeat new password" />
            </div>
            <button type="submit" className="prfl-btn-primary" disabled={pwBusy}>
              {pwBusy ? 'Updating…' : 'Update Password'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
