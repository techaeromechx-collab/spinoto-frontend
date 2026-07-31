// Moved out of ProfilePage.jsx's "Super Admin" tab (formerly module-scoped
// as `CompanyDetailsCard`) into the new Settings module's "Manage Business"
// tab. Logic is unchanged — same /api/settings/company GET/PUT calls, same
// fields. (Invoice theme/logo/accent-color fields live in the separate
// InvoiceThemeSettings.jsx tab, not here — this card only ever touched the
// plain business-info columns.)
import { useState, useEffect } from 'react';
import { Building2, Hash, MapPin, Globe, Phone, Mail, Edit2, X, Save, Loader } from 'lucide-react';
import { api } from '../../api/client.js';
import { SectionHeader } from './shared.jsx';

const EMPTY_CO = {
  company_name: '', address_line1: '', address_line2: '',
  city: '', state: '', pincode: '', phone: '', email: '', gstin: '',
};

export default function CompanyDetailsCard() {
  const [form,    setForm]    = useState(EMPTY_CO);
  const [saved,   setSaved]   = useState(EMPTY_CO);   // last saved snapshot
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [ok,      setOk]      = useState(false);
  const [err,     setErr]     = useState(null);

  useEffect(() => {
    api('/api/settings/company')
      .then(d => { setForm(d); setSaved(d); })
      .catch(() => setErr('Failed to load company details.'))
      .finally(() => setLoading(false));
  }, []);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  }

  function cancelEdit() {
    setForm(saved);
    setEditing(false);
    setErr(null);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true); setErr(null); setOk(false);
    try {
      const res = await api('/api/settings/company', { method: 'PUT', body: form });
      const updated = res.item || res;
      setForm(updated); setSaved(updated);
      setEditing(false); setOk(true);
      setTimeout(() => setOk(false), 3000);
    } catch (ex) {
      setErr(ex.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="prfl-card">
        <SectionHeader icon={<Building2 size={15} />} title="Company Details" />
        <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          <Loader size={18} style={{ animation: 'spin 1s linear infinite', marginBottom: 6 }} /><br />Loading…
        </div>
      </div>
    );
  }

  const coFields = [
    { icon: <Building2 size={13}/>, label: 'Company Name',  val: saved.company_name  },
    { icon: <Hash      size={13}/>, label: 'GST / Tax No.',  val: saved.gstin         },
    { icon: <MapPin    size={13}/>, label: 'Address Line 1', val: saved.address_line1 },
    { icon: <MapPin    size={13}/>, label: 'Address Line 2', val: saved.address_line2 },
    { icon: <Globe     size={13}/>, label: 'City',           val: saved.city          },
    { icon: <Globe     size={13}/>, label: 'State',          val: saved.state         },
    { icon: <Globe     size={13}/>, label: 'Pincode',        val: saved.pincode       },
    { icon: <Phone     size={13}/>, label: 'Phone',          val: saved.phone         },
    { icon: <Mail      size={13}/>, label: 'Email',          val: saved.email         },
  ];

  return (
    <div className="prfl-card">
      <div className="prfl-card-hd" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="prfl-card-title">
          <span className="prfl-card-title-icon"><Building2 size={15} /></span>
          Company Details
        </span>
        {!editing && (
          <button
            className="prfl-btn-ghost prfl-btn-ghost--sm"
            onClick={() => { setEditing(true); setOk(false); setErr(null); }}
          >
            <Edit2 size={13} /> Edit
          </button>
        )}
      </div>

      {ok  && <div className="prfl-alert prfl-alert--success" style={{ margin: '0 0 14px' }}>Company details saved successfully!</div>}
      {err && <div className="prfl-alert prfl-alert--error"   style={{ margin: '0 0 14px' }}>{err}</div>}

      {!editing ? (
        <div className="prfl-co-grid">
          {coFields.map(({ icon, label, val }) => (
            <div key={label} className="prfl-co-field">
              <div className="prfl-co-field-icon">{icon}</div>
              <div>
                <div className="prfl-co-field-label">{label}</div>
                <div className="prfl-co-field-val" style={{ color: val ? 'var(--text)' : 'var(--text-muted)' }}>{val || '—'}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {[
              { name: 'company_name',  label: 'Company Name *',  placeholder: 'Aeromechx Automotive Pvt. Ltd.', full: true },
              { name: 'address_line1', label: 'Address Line 1',  placeholder: '919, Shilp Epitome, Sindhuabhavan Road' },
              { name: 'address_line2', label: 'Address Line 2',  placeholder: 'Ahmedabad' },
              { name: 'city',          label: 'City',             placeholder: 'Ahmedabad' },
              { name: 'state',         label: 'State',            placeholder: 'Gujarat' },
              { name: 'pincode',       label: 'Pincode',          placeholder: '380054' },
              { name: 'phone',         label: 'Phone / Mobile',   placeholder: '7480033800' },
              { name: 'email',         label: 'Email',            placeholder: 'info@company.com' },
              { name: 'gstin',         label: 'GST / Tax Number', placeholder: '24ABBCA0719K1ZY' },
            ].map(({ name, label, placeholder, full }) => (
              <div key={name} className="prfl-field" style={full ? { gridColumn: '1 / -1' } : {}}>
                <label>{label}</label>
                <input
                  name={name}
                  value={form[name]}
                  onChange={handleChange}
                  placeholder={placeholder}
                  required={name === 'company_name'}
                />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button type="button" className="prfl-btn-ghost" onClick={cancelEdit} disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <X size={14} /> Cancel
            </button>
            <button type="submit" className="prfl-btn-primary" disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Save size={14} /> {saving ? 'Saving…' : 'Save Company Details'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
