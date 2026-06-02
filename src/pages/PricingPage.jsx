import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client.js';
import { useCan } from '../auth/AuthContext.jsx';
import {
  IndianRupee,
  PlusCircle,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Filter,
  ArrowRight,
  Download,
} from 'lucide-react';
import '../styles/PricingPage.css';

export default function PricingPage() {
  // Anyone can view pricing; only users with MANAGE_PRICING (or super admin) can edit.
  const isAdmin = useCan('MANAGE_PRICING');

  const [pricing, setPricing] = useState([]);
  const [services, setServices] = useState([]);
  const [bodyTypes, setBodyTypes] = useState([]);
  const [makes, setMakes] = useState([]);
  const [models, setModels] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [form, setForm] = useState({
    service_id: '',
    body_type_id: '',
    make_id: '',
    model_id: '',
    price: '',
  });

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [p, s, b, m] = await Promise.all([
        api('/api/pricing'),
        api('/api/services/services'),
        api('/api/vehicles/body-types'),
        api('/api/vehicles/makes'),
      ]);
      setPricing(p.items);
      setServices(s.items);
      setBodyTypes(b.items);
      setMakes(m.items);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (form.make_id) {
      api(`/api/vehicles/models?make_id=${form.make_id}`)
        .then((r) => setModels(r.items))
        .catch((e) => setError(e.message));
    } else {
      setModels([]);
      setForm((f) => ({ ...f, model_id: '' }));
    }
  }, [form.make_id]);

  // Reset make + model when service changes (vehicle class may differ)
  useEffect(() => {
    setForm((f) => ({ ...f, make_id: '', model_id: '' }));
  }, [form.service_id]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.service_id || !form.price) return;
    try {
      await api('/api/pricing', {
        method: 'POST',
        body: {
          service_id: Number(form.service_id),
          body_type_id: form.body_type_id ? Number(form.body_type_id) : null,
          make_id: form.make_id ? Number(form.make_id) : null,
          model_id: form.model_id ? Number(form.model_id) : null,
          price: Number(form.price),
        },
      });
      setForm({ service_id: '', body_type_id: '', make_id: '', model_id: '', price: '' });
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this pricing rule?')) return;
    try {
      await api(`/api/pricing/${id}`, { method: 'DELETE' });
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  async function toggleActive(item) {
    try {
      await api(`/api/pricing/${item.id}`, {
        method: 'PATCH',
        body: { is_active: !item.is_active },
      });
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  function exportPricing() {
    if (!pricing.length) { alert('No pricing rules to export.'); return; }
    const rows = pricing.map(p => ({
      Service:      p.service_name  || '',
      'Body Type':  p.body_type_name || 'All Types',
      Make:         p.make_name      || 'Universal',
      Model:        p.model_name     || 'All Models',
      'Price (₹)':  p.price          || 0,
      Active:       p.is_active ? 'Yes' : 'No',
    }));
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => {
        const v = String(r[h] ?? '');
        return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(',')),
    ].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'pricing-rules.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // Filter makes by the selected service's vehicle class (frontend-only, no API change)
  const TW_PATTERN = /two|2w|bike|scoot|motor/i;
  const selectedService = services.find(s => String(s.id) === String(form.service_id));
  const filteredMakes = !selectedService || selectedService.vehicle_class === 'both'
    ? makes
    : selectedService.vehicle_class === '2W'
      ? makes.filter(m => TW_PATTERN.test(m.vehicle_type_name))
      : makes.filter(m => !TW_PATTERN.test(m.vehicle_type_name));

  return (
    <div className="pricing-page">
      <header className="page-header">
        <div>
          <h2>Pricing Engine</h2>
          <p>Define dynamic prices based on service and vehicle specifics.</p>
        </div>
        <button className="button secondary" onClick={exportPricing} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Download size={15} /> Export Pricing
        </button>
      </header>

      {error && <div className="banner error">{error}</div>}

      <div className="pos-layout">
        <div className="pos-main">
          <div className="card table-container">
            <div className="table-header-minimal">
              <Filter size={16} />
              <span>Active Pricing Rules</span>
            </div>
            <div className="table-responsive-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Specs</th>
                    <th className="text-right">Price</th>
                    <th>Status</th>
                    {isAdmin && <th />}
                  </tr>
                </thead>
                <tbody>
                  {pricing.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-4 muted">No rules defined.</td></tr>
                  ) : (
                    pricing.map((p) => (
                      <tr key={p.id} className={!p.is_active ? 'inactive' : ''}>
                        <td><strong>{p.service_name}</strong></td>
                        <td>
                          <div className="meta-cell">
                            <span>{p.body_type_name || 'All Types'}</span>
                            <span className="sub">
                              {p.make_name ? `${p.make_name} ${p.model_name || 'All Models'}` : 'Universal Match'}
                            </span>
                          </div>
                        </td>
                        <td className="text-right font-semibold">
                          {Number(p.price).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </td>
                        <td>
                          <button className="icon-btn" onClick={() => toggleActive(p)} disabled={!isAdmin}>
                            {p.is_active ? <ToggleRight size={20} color="var(--ok)" /> : <ToggleLeft size={20} />}
                          </button>
                        </td>
                        {isAdmin && (
                          <td className="text-right">
                            <button className="icon-btn danger" onClick={() => remove(p.id)}><Trash2 size={16} /></button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {isAdmin && (
          <aside className="sticky-sidebar">
            <form className="card" onSubmit={handleSubmit}>
              <h3 style={{ margin: '0 0 20px', fontSize: '16px' }}>New Rule</h3>
              <div className="field">
                <label>Service</label>
                <select value={form.service_id} onChange={e => setForm({...form, service_id: e.target.value})} required>
                  <option value="">Select Service</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Body Type</label>
                <select value={form.body_type_id} onChange={e => setForm({...form, body_type_id: e.target.value})}>
                  <option value="">Universal</option>
                  {bodyTypes.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Make</label>
                <select value={form.make_id} onChange={e => setForm({...form, make_id: e.target.value})}>
                  <option value="">Universal</option>
                  {filteredMakes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Model</label>
                <select value={form.model_id} onChange={e => setForm({...form, model_id: e.target.value})} disabled={!form.make_id}>
                  <option value="">Universal</option>
                  {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Price (INR)</label>
                <div className="input-with-icon">
                  <IndianRupee size={14} className="input-icon" />
                  <input type="number" placeholder="0" value={form.price} onChange={e => setForm({...form, price: e.target.value})} required />
                </div>
              </div>
              <button type="submit" className="button primary" style={{ width: '100%', marginTop: 8 }}>
                Create Rule
                <ArrowRight size={16} />
              </button>
            </form>
          </aside>
        )}
      </div>
    </div>
  );
}
