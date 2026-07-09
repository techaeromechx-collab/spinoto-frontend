import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api/client.js';
import {
  Users, Search, X, ChevronLeft, ChevronRight, ChevronDown,
  Phone, Calendar, Eye, Pencil, Mail, StickyNote, Check,
  Car, Network, MessageCircle, Plus, Trash2, FileText, Building2,
} from 'lucide-react';
import PaginationBar from '../components/PaginationBar.jsx';
import { isValidGSTIN } from '../lib/gst.js';
import '../styles/CustomersPage.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtTime(v) {
  if (!v) return '';
  const t = String(v).slice(0, 5);
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function fmtINR(v) {
  return `₹${Number(v || 0).toLocaleString('en-IN')}`;
}

const AVATAR_COLORS = [
  { bg: '#ede9fe', color: '#6d28d9' },
  { bg: '#dbeafe', color: '#1d4ed8' },
  { bg: '#dcfce7', color: '#15803d' },
  { bg: '#ffedd5', color: '#c2410c' },
  { bg: '#fce7f3', color: '#be185d' },
  { bg: '#cffafe', color: '#0e7490' },
];
function avatarStyle(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function ciStatusStyle(status) {
  switch (status) {
    case 'paid':      return { bg: '#dcfce7', color: '#166534' };
    case 'partial':   return { bg: '#fef3c7', color: '#92400e' };
    case 'sent':      return { bg: '#dbeafe', color: '#1d4ed8' };
    case 'cancelled': return { bg: '#fee2e2', color: '#991b1b' };
    default:          return { bg: '#f3f4f6', color: '#6b7280' }; // draft
  }
}

// ── Searchable Select ─────────────────────────────────────────────────────────
function SearchableSelect({ value, onChange, options, placeholder = 'Select…', disabled = false,
  getLabel = o => o.label, getValue = o => String(o.value) }) {
  const [open, setOpen] = useState(false);
  const [q,    setQ]    = useState('');
  const ref    = useRef(null);
  const inpRef = useRef(null);

  useEffect(() => {
    function close(e) { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQ(''); } }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => { if (open && inpRef.current) inpRef.current.focus(); }, [open]);

  const filtered = q
    ? options.filter(o => getLabel(o).toLowerCase().includes(q.toLowerCase()))
    : options;
  const selected = options.find(o => String(getValue(o)) === String(value));

  function pick(o) { onChange(getValue(o)); setOpen(false); setQ(''); }

  return (
    <div ref={ref} className="ss-wrap">
      <div
        className={`ss-box${open && !disabled ? ' ss-box--open' : ''}${disabled ? ' ss-box--disabled' : ''}`}
        onClick={() => { if (!disabled) setOpen(v => !v); }}
      >
        <span className={`ss-val${!selected ? ' ss-val--ph' : ''}`}>
          {selected ? getLabel(selected) : placeholder}
        </span>
        <ChevronDown size={12} className={`ss-chev${open ? ' ss-chev--up' : ''}`}/>
      </div>
      {open && !disabled && (
        <div className="ss-dropdown">
          <div className="ss-search-row">
            <Search size={11} className="ss-search-icon"/>
            <input ref={inpRef} className="ss-search-input" placeholder="Search…"
              value={q} onChange={e => setQ(e.target.value)}
              onClick={e => e.stopPropagation()}/>
            {q && (
              <button className="ss-clear-q" onClick={e => { e.stopPropagation(); setQ(''); }}>
                <X size={10}/>
              </button>
            )}
          </div>
          <div className="ss-list">
            {filtered.length === 0
              ? <div className="ss-empty">No results for "{q}"</div>
              : filtered.map(o => (
                <div key={getValue(o)}
                  className={`ss-item${String(getValue(o)) === String(value) ? ' ss-item--on' : ''}`}
                  onClick={() => pick(o)}>
                  {getLabel(o)}
                </div>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}

function buildModelLabel(model, allModels, bodyTypes, segments) {
  const dupes = allModels.filter(m => m.name.toLowerCase() === model.name.toLowerCase());
  if (dupes.length <= 1) return model.name;
  const extras = [];
  if (model.segment_id) {
    const seg = segments.find(s => s.id === model.segment_id);
    if (seg) extras.push(seg.name);
  }
  if (model.body_type_id) {
    const bt = bodyTypes.find(b => b.id === model.body_type_id);
    if (bt) extras.push(bt.name);
  }
  if (model.engine_cc) extras.push(`${model.engine_cc}cc`);
  return extras.length ? `${model.name} — ${extras.join(' · ')}` : model.name;
}

// ── Add Vehicle Modal ─────────────────────────────────────────────────────────
const TW_KW = ['two', '2w', 'bike', 'scoot', 'motor', 'moped'];
function isTwo(name = '') { const n = name.toLowerCase(); return TW_KW.some(k => n.includes(k)); }

function AddVehicleModal({ mobile, onClose, onSaved }) {
  const [form, setForm] = useState({
    vehicle_number: '', vehicle_type_id: '', make_id: '', model_id: '',
    color: '', year: '', notes: '',
  });
  const [types,     setTypes]     = useState([]);
  const [makes,     setMakes]     = useState([]);
  const [models,    setModels]    = useState([]);
  const [bodyTypes, setBodyTypes] = useState([]);
  const [segments,  setSegments]  = useState([]);
  const [saving,    setSaving]    = useState(false);
  const [err,       setErr]       = useState('');

  useEffect(() => {
    api('/api/vehicles/types').then(r => setTypes(r.items || [])).catch(() => {});
    api('/api/vehicles/body-types').then(r => setBodyTypes(r.items || [])).catch(() => {});
    api('/api/vehicles/segments').then(r => setSegments(r.items || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setMakes([]); setModels([]);
    setForm(f => ({ ...f, make_id: '', model_id: '' }));
    if (!form.vehicle_type_id) return;
    api(`/api/vehicles/makes?type_id=${form.vehicle_type_id}`)
      .then(r => setMakes(r.items || [])).catch(() => {});
  }, [form.vehicle_type_id]);

  useEffect(() => {
    setModels([]);
    setForm(f => ({ ...f, model_id: '' }));
    if (!form.make_id) return;
    api(`/api/vehicles/models?make_id=${form.make_id}`)
      .then(r => setModels(r.items || [])).catch(() => {});
  }, [form.make_id]);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  const selectedModel = models.find(m => String(m.id) === String(form.model_id)) || null;
  const selectedType  = types.find(t => String(t.id) === String(form.vehicle_type_id)) || null;
  const isTwoWheeler  = selectedType ? isTwo(selectedType.name) : false;
  const bodyTypeName  = selectedModel?.body_type_id ? (bodyTypes.find(b => b.id === selectedModel.body_type_id)?.name || null) : null;
  const segmentName   = selectedModel?.segment_id   ? (segments.find(s => s.id === selectedModel.segment_id)?.name   || null) : null;
  const engineCC      = selectedModel?.engine_cc || null;

  async function handleSave() {
    if (!form.vehicle_number.trim()) { setErr('Vehicle number is required'); return; }
    setSaving(true); setErr('');
    try {
      await api(`/api/customers/${encodeURIComponent(mobile)}/vehicles`, {
        method: 'POST',
        body: {
          vehicle_number:  form.vehicle_number.trim().toUpperCase(),
          vehicle_type_id: form.vehicle_type_id || null,
          make_id:         form.make_id         || null,
          model_id:        form.model_id        || null,
          color:           form.color           || null,
          year:            form.year ? parseInt(form.year, 10) : null,
          notes:           form.notes           || null,
        },
      });
      onSaved();
    } catch (e) {
      setErr(e.message || 'Failed to save vehicle');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="aveh-backdrop" onClick={onClose}>
      <div className="aveh-modal" onClick={e => e.stopPropagation()}>
        <div className="aveh-hdr">
          <span className="aveh-title"><Car size={14}/> Add Vehicle</span>
          <button className="cust-icon-btn" onClick={onClose}><X size={15}/></button>
        </div>
        <div className="aveh-body">
          {err && <div className="aveh-err">{err}</div>}

          <div className="aveh-field aveh-field--full">
            <label>Vehicle Number *</label>
            <input className="aveh-input" placeholder="e.g. GJ07BA9034" autoFocus
              value={form.vehicle_number}
              onChange={e => set('vehicle_number', e.target.value.toUpperCase())}/>
          </div>

          <div className="aveh-field aveh-field--full">
            <label>Vehicle Type</label>
            <select className="aveh-input" value={form.vehicle_type_id}
              onChange={e => set('vehicle_type_id', e.target.value)}>
              <option value="">Select vehicle type</option>
              {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <div className="aveh-row">
            <div className="aveh-field">
              <label>Make</label>
              <SearchableSelect
                value={form.make_id}
                onChange={v => set('make_id', v)}
                options={makes}
                getLabel={m => m.name}
                getValue={m => String(m.id)}
                placeholder={form.vehicle_type_id ? (makes.length ? 'Search make…' : 'No makes') : 'Select type first'}
                disabled={!form.vehicle_type_id || makes.length === 0}
              />
            </div>
            <div className="aveh-field">
              <label>Model</label>
              <SearchableSelect
                value={form.model_id}
                onChange={v => set('model_id', v)}
                options={models}
                getLabel={m => buildModelLabel(m, models, bodyTypes, segments)}
                getValue={m => String(m.id)}
                placeholder={form.make_id ? (models.length ? 'Search model…' : 'No models') : 'Select make first'}
                disabled={!form.make_id || models.length === 0}
              />
            </div>
          </div>

          {selectedModel && (
            <div className="aveh-autoinfo">
              {!isTwoWheeler && (
                <>
                  <div className="aveh-autoinfo-item">
                    <span className="aveh-autoinfo-lbl">Body Type</span>
                    <span className="aveh-autoinfo-val">{bodyTypeName || '—'}</span>
                  </div>
                  <div className="aveh-autoinfo-item">
                    <span className="aveh-autoinfo-lbl">Segment</span>
                    <span className="aveh-autoinfo-val">{segmentName || '—'}</span>
                  </div>
                </>
              )}
              {isTwoWheeler && (
                <>
                  <div className="aveh-autoinfo-item">
                    <span className="aveh-autoinfo-lbl">Engine CC</span>
                    <span className="aveh-autoinfo-val">{engineCC ? `${engineCC} cc` : '—'}</span>
                  </div>
                  <div className="aveh-autoinfo-item">
                    <span className="aveh-autoinfo-lbl">Category</span>
                    <span className="aveh-autoinfo-val">{segmentName || '—'}</span>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="aveh-row">
            <div className="aveh-field">
              <label>Year</label>
              <input className="aveh-input" type="number" placeholder="e.g. 2022"
                min="1990" max={new Date().getFullYear() + 1}
                value={form.year} onChange={e => set('year', e.target.value)}/>
            </div>
            <div className="aveh-field">
              <label>Color</label>
              <input className="aveh-input" placeholder="e.g. White"
                value={form.color} onChange={e => set('color', e.target.value)}/>
            </div>
          </div>

          <div className="aveh-field aveh-field--full">
            <label>Notes</label>
            <textarea className="aveh-input aveh-textarea" placeholder="Any notes about this vehicle…"
              value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}/>
          </div>
        </div>
        <div className="aveh-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Vehicle'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Vehicle Modal ────────────────────────────────────────────────────────
function EditVehicleModal({ mobile, vehicle, onClose, onSaved }) {
  const [form, setForm] = useState({
    vehicle_type_id: String(vehicle.vehicle_type_id || ''),
    make_id:         String(vehicle.make_id         || ''),
    model_id:        String(vehicle.model_id        || ''),
    color:           vehicle.color || '',
    year:            vehicle.year  || '',
    notes:           vehicle.notes || '',
  });
  const [types,     setTypes]     = useState([]);
  const [makes,     setMakes]     = useState([]);
  const [models,    setModels]    = useState([]);
  const [bodyTypes, setBodyTypes] = useState([]);
  const [segments,  setSegments]  = useState([]);
  const [saving,    setSaving]    = useState(false);
  const [err,       setErr]       = useState('');

  useEffect(() => {
    api('/api/vehicles/types').then(r => setTypes(r.items || [])).catch(() => {});
    api('/api/vehicles/body-types').then(r => setBodyTypes(r.items || [])).catch(() => {});
    api('/api/vehicles/segments').then(r => setSegments(r.items || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setMakes([]); setModels([]);
    if (!form.vehicle_type_id) return;
    api(`/api/vehicles/makes?type_id=${form.vehicle_type_id}`)
      .then(r => setMakes(r.items || [])).catch(() => {});
  }, [form.vehicle_type_id]);

  useEffect(() => {
    setModels([]);
    if (!form.make_id) return;
    api(`/api/vehicles/models?make_id=${form.make_id}`)
      .then(r => setModels(r.items || [])).catch(() => {});
  }, [form.make_id]);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  const selectedModel  = models.find(m => String(m.id) === String(form.model_id)) || null;
  const selectedType   = types.find(t => String(t.id) === String(form.vehicle_type_id)) || null;
  const isTwoWheeler   = selectedType ? isTwo(selectedType.name) : false;
  const bodyTypeName   = selectedModel?.body_type_id ? (bodyTypes.find(b => b.id === selectedModel.body_type_id)?.name || null) : null;
  const segmentName    = selectedModel?.segment_id   ? (segments.find(s => s.id === selectedModel.segment_id)?.name   || null) : null;
  const engineCC       = selectedModel?.engine_cc || null;

  async function handleSave() {
    setSaving(true); setErr('');
    try {
      await api(`/api/customers/${encodeURIComponent(mobile)}/vehicles/${vehicle.cv_id}`, {
        method: 'PUT',
        body: {
          vehicle_type_id: form.vehicle_type_id || null,
          make_id:         form.make_id         || null,
          model_id:        form.model_id        || null,
          color:           form.color           || null,
          year:            form.year ? parseInt(form.year, 10) : null,
          notes:           form.notes           || null,
        },
      });
      onSaved();
    } catch (e) {
      setErr(e.message || 'Failed to update vehicle');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="aveh-backdrop" onClick={onClose}>
      <div className="aveh-modal" onClick={e => e.stopPropagation()}>
        <div className="aveh-hdr">
          <span className="aveh-title"><Pencil size={14}/> Edit Vehicle</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="cust-veh-plate" style={{ fontSize: 13, fontWeight: 800, fontFamily: 'monospace', letterSpacing: '.5px', color: 'var(--text-muted)' }}>
              {vehicle.vehicle_number}
            </span>
            <button className="cust-icon-btn" onClick={onClose}><X size={15}/></button>
          </div>
        </div>
        <div className="aveh-body">
          {err && <div className="aveh-err">{err}</div>}

          <div className="aveh-field aveh-field--full">
            <label>Vehicle Type</label>
            <select className="aveh-input" value={form.vehicle_type_id}
              onChange={e => { set('vehicle_type_id', e.target.value); set('make_id', ''); set('model_id', ''); }}>
              <option value="">Select vehicle type</option>
              {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <div className="aveh-row">
            <div className="aveh-field">
              <label>Make</label>
              <SearchableSelect
                value={form.make_id}
                onChange={v => { set('make_id', v); set('model_id', ''); }}
                options={makes}
                getLabel={m => m.name}
                getValue={m => String(m.id)}
                placeholder={form.vehicle_type_id ? (makes.length ? 'Search make…' : 'No makes') : 'Select type first'}
                disabled={!form.vehicle_type_id || makes.length === 0}
              />
            </div>
            <div className="aveh-field">
              <label>Model</label>
              <SearchableSelect
                value={form.model_id}
                onChange={v => set('model_id', v)}
                options={models}
                getLabel={m => buildModelLabel(m, models, bodyTypes, segments)}
                getValue={m => String(m.id)}
                placeholder={form.make_id ? (models.length ? 'Search model…' : 'No models') : 'Select make first'}
                disabled={!form.make_id || models.length === 0}
              />
            </div>
          </div>

          {selectedModel && (
            <div className="aveh-autoinfo">
              {!isTwoWheeler ? (
                <>
                  <div className="aveh-autoinfo-item">
                    <span className="aveh-autoinfo-lbl">Body Type</span>
                    <span className="aveh-autoinfo-val">{bodyTypeName || '—'}</span>
                  </div>
                  <div className="aveh-autoinfo-item">
                    <span className="aveh-autoinfo-lbl">Fuel</span>
                    <span className="aveh-autoinfo-val">{segmentName || '—'}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="aveh-autoinfo-item">
                    <span className="aveh-autoinfo-lbl">Engine CC</span>
                    <span className="aveh-autoinfo-val">{engineCC ? `${engineCC} cc` : '—'}</span>
                  </div>
                  <div className="aveh-autoinfo-item">
                    <span className="aveh-autoinfo-lbl">Category</span>
                    <span className="aveh-autoinfo-val">{segmentName || '—'}</span>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="aveh-row">
            <div className="aveh-field">
              <label>Year</label>
              <input className="aveh-input" type="number" placeholder="e.g. 2022"
                min="1990" max={new Date().getFullYear() + 1}
                value={form.year} onChange={e => set('year', e.target.value)}/>
            </div>
            <div className="aveh-field">
              <label>Color</label>
              <input className="aveh-input" placeholder="e.g. White"
                value={form.color} onChange={e => set('color', e.target.value)}/>
            </div>
          </div>

          <div className="aveh-field aveh-field--full">
            <label>Notes</label>
            <textarea className="aveh-input aveh-textarea" placeholder="Any notes about this vehicle…"
              value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}/>
          </div>
        </div>
        <div className="aveh-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Customer Detail (full-page) ────────────────────────────────────────────────
function CustomerDetail({ mobile, onBack, onRefresh, startEditing = false }) {
  const navigate = useNavigate();

  const [data,        setData]       = useState(null);
  const [loading,     setLoading]    = useState(true);
  const [err,         setErr]        = useState('');
  const [tab,         setTab]        = useState('appointments');
  const [timeline,    setTimeline]   = useState([]);
  const [tlLoading,   setTlLoading]  = useState(false);
  const [addVehOpen,  setAddVehOpen] = useState(false);
  const [editVeh,     setEditVeh]    = useState(null); // vehicle object being edited
  const [deleting,    setDeleting]   = useState(null);

  const [editing,     setEditing]    = useState(startEditing);
  const [editForm,    setEditForm]   = useState({
    display_name: '', whatsapp: '', email: '', notes: '',
    is_b2b: false, b2b_company_name: '', b2b_gst_number: '', b2b_address: '',
  });
  const [editSaving,  setEditSaving] = useState(false);
  const [editErr,     setEditErr]    = useState('');
  const [showB2bConfirm, setShowB2bConfirm] = useState(false);

  const [delConfirm, setDelConfirm]  = useState(false);
  const [delBusy,    setDelBusy]     = useState(false);

  function loadData() {
    setLoading(true); setErr('');
    api(`/api/customers/${encodeURIComponent(mobile)}`)
      .then(r => {
        setData(r.item);
        setLoading(false);
        setEditForm({
          display_name: r.item.customer_name || '',
          whatsapp:     r.item.whatsapp      || '',
          email:        r.item.email         || '',
          notes:        r.item.profile_notes || '',
          is_b2b:            !!r.item.default_is_b2b,
          b2b_company_name:  r.item.default_b2b_company_name || '',
          b2b_gst_number:    r.item.default_b2b_gst_number   || '',
          b2b_address:       r.item.default_b2b_address      || '',
        });
      })
      .catch(e => { setErr(e.message); setLoading(false); });
  }

  useEffect(() => {
    setTab('appointments');
    setEditing(false);
    loadData();
  }, [mobile]);

  function loadTimeline() {
    if (tlLoading) return;
    setTlLoading(true);
    api(`/api/customers/${encodeURIComponent(mobile)}/timeline`)
      .then(r => setTimeline(r.items || []))
      .catch(() => setTimeline([]))
      .finally(() => setTlLoading(false));
  }

  useEffect(() => {
    if (tab === 'timeline') loadTimeline();
  }, [tab, mobile]);

  // Validates, then — if B2B details are involved (being set, changed, or
  // cleared) — shows a confirmation popup with the current saved details
  // before actually saving. Non-B2B edits (name/whatsapp/email/notes only)
  // save immediately with no extra step.
  function handleEditSave() {
    if (editForm.is_b2b) {
      if (!editForm.b2b_company_name.trim()) { setEditErr('Please enter the company name for the B2B invoice.'); return; }
      if (!editForm.b2b_address.trim())      { setEditErr('Please enter the billing address for the B2B invoice.'); return; }
      if (!isValidGSTIN(editForm.b2b_gst_number)) { setEditErr('Please enter a valid 15-character GSTIN.'); return; }
    }
    setEditErr('');
    const b2bRelevant = editForm.is_b2b || data?.default_is_b2b;
    if (b2bRelevant) {
      setShowB2bConfirm(true);
    } else {
      doSaveEdit();
    }
  }

  async function doSaveEdit() {
    setShowB2bConfirm(false);
    setEditSaving(true); setEditErr('');
    try {
      await api(`/api/customers/${encodeURIComponent(mobile)}`, {
        method: 'PUT',
        body: editForm,
      });
      setEditing(false);
      loadData();
      if (onRefresh) onRefresh();
    } catch (e) {
      setEditErr(e.message || 'Failed to save');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete() {
    setDelBusy(true);
    try {
      await api(`/api/customers/${encodeURIComponent(mobile)}`, { method: 'DELETE' });
      onBack();
      if (onRefresh) onRefresh();
    } catch (e) {
      alert(e.message || 'Failed to delete customer');
      setDelBusy(false);
      setDelConfirm(false);
    }
  }

  async function handleDeleteVehicle(cvId) {
    if (!window.confirm('Remove this manually added vehicle?')) return;
    setDeleting(cvId);
    try {
      await api(`/api/customers/${encodeURIComponent(mobile)}/vehicles/${cvId}`, { method: 'DELETE' });
      loadData();
    } catch (e) {
      alert(e.message || 'Failed to delete vehicle');
    } finally {
      setDeleting(null);
    }
  }

  const avStyle = avatarStyle(data?.customer_name || mobile);
  const initial = (data?.customer_name || mobile || '?')[0].toUpperCase();

  function daysSince(dateStr) {
    if (!dateStr) return null;
    const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 30)  return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  }

  return (
    <div className="cust-detail-page">

      {/* ── Top header bar ── */}
      <div className="cust-detail-hdr">
        <button className="cust-back-btn" onClick={onBack}>
          <ChevronLeft size={15}/> All Customers
        </button>

        <span className="cust-detail-title">Customer Profile</span>

        {data && !editing && (
          <div className="cust-hdr-actions">
            <a href={`https://wa.me/91${(data.whatsapp || data.mobile).replace(/\D/g,'')}`}
              target="_blank" rel="noreferrer" className="cust-hdr-btn cust-hdr-btn--wa" title="Open WhatsApp">
              <MessageCircle size={13}/>
              <span>WhatsApp</span>
            </a>
            <button className="cust-hdr-btn cust-hdr-btn--edit" title="Edit details"
              onClick={() => { setEditing(true); setEditErr(''); setDelConfirm(false); }}>
              <Pencil size={13}/>
              <span>Edit</span>
            </button>
            {!delConfirm ? (
              <button className="cust-hdr-btn cust-hdr-btn--del" title="Delete customer"
                onClick={() => setDelConfirm(true)}>
                <Trash2 size={13}/>
              </button>
            ) : (
              <div className="cust-del-confirm">
                <span>Remove customer?</span>
                <button className="cust-del-yes" onClick={handleDelete} disabled={delBusy}>
                  {delBusy ? '…' : 'Delete'}
                </button>
                <button className="cust-del-no" onClick={() => setDelConfirm(false)}>Cancel</button>
              </div>
            )}
          </div>
        )}

        {editing && (
          <div className="cust-hdr-actions">
            <button className="cust-hdr-btn cust-hdr-btn--save" onClick={handleEditSave} disabled={editSaving}>
              <Check size={13}/>
              <span>{editSaving ? 'Saving…' : 'Save'}</span>
            </button>
            <button className="cust-hdr-btn cust-hdr-btn--cancel"
              onClick={() => { setEditing(false); setEditErr(''); }} disabled={editSaving}>
              <X size={13}/>
              <span>Cancel</span>
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="cust-detail-loading">Loading…</div>
      ) : err ? (
        <div className="cust-detail-err">{err}</div>
      ) : (
        <div className="cust-detail-body">

          {/* ── Identity banner / Edit form ── */}
          {editing ? (
            <div className="cust-edit-form">
              {editErr && <div className="cust-edit-err"><X size={12}/> {editErr}</div>}
              <div className="cust-edit-grid">
                <div className="cust-edit-field">
                  <label>Full Name</label>
                  <input className="cust-edit-input" placeholder="Customer name" autoFocus
                    value={editForm.display_name}
                    onChange={e => setEditForm(f => ({ ...f, display_name: e.target.value }))}/>
                </div>
                <div className="cust-edit-field">
                  <label>WhatsApp</label>
                  <input className="cust-edit-input" placeholder="WhatsApp number"
                    value={editForm.whatsapp}
                    onChange={e => setEditForm(f => ({ ...f, whatsapp: e.target.value }))}/>
                </div>
                <div className="cust-edit-field cust-edit-field--full">
                  <label>Email</label>
                  <input className="cust-edit-input" placeholder="Email address (optional)"
                    autoComplete="off" value={editForm.email}
                    onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}/>
                </div>
                <div className="cust-edit-field cust-edit-field--full">
                  <label>Notes</label>
                  <textarea className="cust-edit-input cust-edit-textarea"
                    placeholder="Internal notes about this customer…" rows={2}
                    value={editForm.notes}
                    onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}/>
                </div>

                <div className="cust-edit-field cust-edit-field--full" style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 2 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={editForm.is_b2b}
                      onChange={e => {
                        const checked = e.target.checked;
                        setEditForm(f => ({
                          ...f, is_b2b: checked,
                          ...(checked ? {} : { b2b_company_name: '', b2b_gst_number: '', b2b_address: '' }),
                        }));
                      }}
                      style={{ width: 15, height: 15 }}
                    />
                    <Building2 size={13} style={{ color: 'var(--primary)' }} />
                    <span style={{ fontWeight: 700 }}>B2B Customer (GST Registered)</span>
                  </label>
                </div>

                {editForm.is_b2b && (
                  <>
                    <div className="cust-edit-field">
                      <label>Company Name</label>
                      <input className="cust-edit-input" placeholder="GST-registered company name"
                        value={editForm.b2b_company_name}
                        onChange={e => setEditForm(f => ({ ...f, b2b_company_name: e.target.value }))}/>
                    </div>
                    <div className="cust-edit-field">
                      <label>GST Number</label>
                      <input className="cust-edit-input" placeholder="15-character GSTIN" maxLength={15}
                        value={editForm.b2b_gst_number}
                        onChange={e => setEditForm(f => ({ ...f, b2b_gst_number: e.target.value.toUpperCase() }))}
                        style={editForm.b2b_gst_number && !isValidGSTIN(editForm.b2b_gst_number) ? { borderColor: '#dc2626' } : undefined}/>
                      {editForm.b2b_gst_number && !isValidGSTIN(editForm.b2b_gst_number) && (
                        <p style={{ margin: '4px 0 0', fontSize: 11, color: '#dc2626' }}>Enter a valid 15-character GSTIN.</p>
                      )}
                    </div>
                    <div className="cust-edit-field cust-edit-field--full">
                      <label>Billing Address</label>
                      <textarea className="cust-edit-input cust-edit-textarea"
                        placeholder="Registered billing address" rows={2}
                        value={editForm.b2b_address}
                        onChange={e => setEditForm(f => ({ ...f, b2b_address: e.target.value }))}/>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="cust-profile-banner">
              <div className="cust-avatar cust-avatar--lg" style={{ background: avStyle.bg, color: avStyle.color }}>
                {initial}
              </div>
              <div className="cust-profile-info">
                <div className="cust-profile-name">{data.customer_name || 'Unknown'}</div>
                <div className="cust-profile-contact">
                  <span><Phone size={11}/> {data.mobile}</span>
                  {data.whatsapp && data.whatsapp !== data.mobile && (
                    <span><MessageCircle size={11}/> {data.whatsapp}</span>
                  )}
                  {data.email && (
                    <span><Mail size={11}/> {data.email}</span>
                  )}
                </div>
                {data.profile_notes && (
                  <div className="cust-profile-note">{data.profile_notes}</div>
                )}
                {data.last_visit && (
                  <div className="cust-last-visit">
                    Last visit: <strong>{daysSince(data.last_visit)}</strong> · {fmtDate(data.last_visit)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Stats bar ── */}
          <div className="cust-stats-bar cust-stats-bar--4">
            <div className="cust-stat">
              <span className="cust-stat-val">{data.total_appointments}</span>
              <span className="cust-stat-lbl">Visits</span>
            </div>
            <div className="cust-stat">
              <span className="cust-stat-val" style={{ color: '#0f766e' }}>{fmtINR(data.total_spend)}</span>
              <span className="cust-stat-lbl">Total Spend</span>
            </div>
            <div className="cust-stat">
              <span className="cust-stat-val" style={{ fontSize: 13 }}>{fmtINR(data.avg_spend)}</span>
              <span className="cust-stat-lbl">Avg/Visit</span>
            </div>
            <div className="cust-stat">
              <span className="cust-stat-val" style={{ fontSize: 13, color: Number(data.total_outstanding) > 0 ? '#dc2626' : '#16a34a' }}>
                {Number(data.total_outstanding) > 0 ? fmtINR(data.total_outstanding) : '✓ Nil'}
              </span>
              <span className="cust-stat-lbl">Due</span>
            </div>
          </div>

          {/* ── Vehicles ── */}
          <div className="cust-section">
            <div className="cust-section-title">
              <Car size={11}/> Vehicles ({data.vehicles?.length || 0})
              <button className="cust-add-veh-btn" onClick={() => setAddVehOpen(true)}>
                <Plus size={11}/> Add
              </button>
            </div>
            {data.vehicles?.length > 0 ? (
              <div className="cust-vehicles-wrap">
                {data.vehicles.map((v, i) => (
                  <div key={v.cv_id || i} className="cust-vehicle-card">
                    {/* Left: plate + info */}
                    <div className="cust-veh-left">
                      <div className="cust-veh-plate">
                        {v.vehicle_number}
                        {v.source === 'manual' && (
                          <span className="cust-veh-manual-tag">manual</span>
                        )}
                      </div>
                      {(v.make_name || v.model_name) && (
                        <div className="cust-veh-makemodel">
                          {[v.make_name, v.model_name].filter(Boolean).join(' ')}
                        </div>
                      )}
                      <div className="cust-veh-chips">
                        {v.vehicle_type_name && (
                          <span className="cust-veh-chip cust-veh-chip--type">{v.vehicle_type_name}</span>
                        )}
                        {v.body_type_name && (
                          <span className="cust-veh-chip cust-veh-chip--body">{v.body_type_name}</span>
                        )}
                        {v.segment_name && (
                          <span className="cust-veh-chip cust-veh-chip--fuel">{v.segment_name}</span>
                        )}
                        {v.color && (
                          <span className="cust-veh-chip cust-veh-chip--color">● {v.color}</span>
                        )}
                        {v.year && (
                          <span className="cust-veh-chip cust-veh-chip--year">{v.year}</span>
                        )}
                      </div>
                      {v.notes && <div className="cust-veh-notes">{v.notes}</div>}
                    </div>

                    {/* Right: stats + actions */}
                    <div className="cust-veh-right">
                      <div className="cust-veh-stats">
                        {v.visit_count > 0 && (
                          <div className="cust-veh-visits">{v.visit_count} visit{v.visit_count !== 1 ? 's' : ''}</div>
                        )}
                        {v.last_seen && <div className="cust-veh-lastseen">Last: {fmtDate(v.last_seen)}</div>}
                      </div>
                      {v.source === 'manual' && v.cv_id && (
                        <div className="cust-veh-actions">
                          <button
                            className="cust-veh-act-btn cust-veh-act-btn--edit"
                            title="Edit vehicle"
                            onClick={() => setEditVeh(v)}
                          >
                            <Pencil size={11}/>
                          </button>
                          <button
                            className="cust-veh-act-btn cust-veh-act-btn--del"
                            title="Remove vehicle"
                            disabled={deleting === v.cv_id}
                            onClick={() => handleDeleteVehicle(v.cv_id)}
                          >
                            {deleting === v.cv_id ? '…' : <Trash2 size={11}/>}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="cust-vehicles-wrap">
                <div className="cust-veh-empty">
                  No vehicles on record. Click <strong>+ Add</strong> to register one.
                </div>
              </div>
            )}
          </div>

          {/* ── B2B / GST Details ── */}
          <div className="cust-section">
            <div className="cust-section-title">
              <Building2 size={11}/> B2B / GST Details
              <button className="cust-add-veh-btn" onClick={() => { setEditing(true); setEditErr(''); setDelConfirm(false); }}>
                <Pencil size={11}/> Edit
              </button>
            </div>
            {data.default_is_b2b ? (
              <div className="cust-vehicles-wrap">
                <div className="cust-vehicle-card">
                  <div className="cust-veh-left">
                    <div className="cust-veh-plate">{data.default_b2b_company_name || '—'}</div>
                    <div className="cust-veh-makemodel">GSTIN: {data.default_b2b_gst_number || '—'}</div>
                    {data.default_b2b_address && (
                      <div className="cust-veh-notes">{data.default_b2b_address}</div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="cust-vehicles-wrap">
                <div className="cust-veh-empty">
                  No B2B billing details saved. Click <strong>Edit</strong> to add a GST-registered company profile — it'll auto-fill on this customer's future estimates.
                </div>
              </div>
            )}
          </div>

          {showB2bConfirm && (
            <div className="aveh-backdrop" onClick={() => setShowB2bConfirm(false)}>
              <div className="aveh-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
                <div className="aveh-hdr">
                  <span className="aveh-title"><Building2 size={14}/> Confirm B2B Details Update</span>
                  <button className="cust-icon-btn" onClick={() => setShowB2bConfirm(false)}><X size={15}/></button>
                </div>
                <div className="aveh-body">
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                    Currently Saved
                  </div>
                  <div style={{ fontSize: 13, background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
                    {data?.default_is_b2b ? (
                      <>
                        <div><strong>{data.default_b2b_company_name || '—'}</strong></div>
                        <div style={{ color: 'var(--text-muted)' }}>GSTIN: {data.default_b2b_gst_number || '—'}</div>
                        {data.default_b2b_address && <div style={{ color: 'var(--text-muted)' }}>{data.default_b2b_address}</div>}
                      </>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>No B2B details currently saved.</span>
                    )}
                  </div>

                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                    Will Be Updated To
                  </div>
                  <div style={{ fontSize: 13, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
                    {editForm.is_b2b ? (
                      <>
                        <div><strong>{editForm.b2b_company_name || '—'}</strong></div>
                        <div style={{ color: 'var(--text-muted)' }}>GSTIN: {editForm.b2b_gst_number || '—'}</div>
                        {editForm.b2b_address && <div style={{ color: 'var(--text-muted)' }}>{editForm.b2b_address}</div>}
                      </>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>B2B will be turned off — details cleared.</span>
                    )}
                  </div>

                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px' }}>
                    This only updates this customer's saved default. Estimates and invoices already created won't change.
                  </p>

                  {editErr && <div className="aveh-err">{editErr}</div>}

                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button className="cust-hdr-btn cust-hdr-btn--cancel" onClick={() => setShowB2bConfirm(false)} disabled={editSaving}>
                      <X size={13}/> <span>Cancel</span>
                    </button>
                    <button className="cust-hdr-btn cust-hdr-btn--save" onClick={doSaveEdit} disabled={editSaving}>
                      <Check size={13}/> <span>{editSaving ? 'Updating…' : 'Update'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {addVehOpen && (
            <AddVehicleModal
              mobile={mobile}
              onClose={() => setAddVehOpen(false)}
              onSaved={() => { setAddVehOpen(false); loadData(); }}
            />
          )}

          {editVeh && (
            <EditVehicleModal
              mobile={mobile}
              vehicle={editVeh}
              onClose={() => setEditVeh(null)}
              onSaved={() => { setEditVeh(null); loadData(); }}
            />
          )}

          {/* ── Tabs ── */}
          <div className="cust-tabs">
            <button className={`cust-tab${tab === 'appointments' ? ' cust-tab--on' : ''}`} onClick={() => setTab('appointments')}>
              <Calendar size={11}/> Appointments <span className="cust-tab-count">{data.appointments.length}</span>
            </button>
            <button className={`cust-tab${tab === 'invoices' ? ' cust-tab--on' : ''}`} onClick={() => setTab('invoices')}>
              🧾 Invoices <span className="cust-tab-count">{data.invoices?.length || 0}</span>
            </button>
            <button className={`cust-tab${tab === 'timeline' ? ' cust-tab--on' : ''}`} onClick={() => setTab('timeline')}>
              🕐 Timeline
            </button>
          </div>

          {/* ── Tab content ── */}
          <div className="cust-tab-content">

            {/* Appointments */}
            {tab === 'appointments' && (
              data.appointments.length === 0
                ? <div className="cust-empty">No appointments yet.</div>
                : data.appointments.map(a => (
                    <div
                      key={a.id}
                      className="cust-history-card"
                      onClick={() => navigate('/appointments', { state: { openApptId: a.id } })}
                      style={{ cursor: 'pointer' }}
                      title={`Open Appointment #${a.id}`}
                    >
                      <div className="cust-hc-top">
                        <span className="cust-hc-id">Appt #{a.id}</span>
                        {a.status_name && (
                          <span className="cust-hc-badge" style={{ background: a.status_bg || '#f3f4f6', color: a.status_color || '#6b7280' }}>
                            {a.status_name}
                          </span>
                        )}
                        <span className="cust-hc-price">{fmtINR(a.total_price)}</span>
                      </div>
                      <div className="cust-hc-meta">
                        <span><Calendar size={10}/> {fmtDate(a.scheduled_date)}{a.scheduled_time ? ` · ${fmtTime(a.scheduled_time)}` : ''}</span>
                        {a.hub_name     && <span><Network size={10}/> {a.hub_name}</span>}
                        {a.vehicle_number && <span>🚗 {a.vehicle_number}</span>}
                        {(a.make_name || a.model_name) && (
                          <span><Car size={10}/> {[a.make_name, a.model_name].filter(Boolean).join(' ')}</span>
                        )}
                      </div>
                      {a.services?.length > 0 && (
                        <div className="cust-hc-services">
                          {a.services.map((s, si) => (
                            <span key={si} className="cust-svc-pill">
                              {s.name} · ₹{Number(s.price || 0).toLocaleString('en-IN')}
                            </span>
                          ))}
                        </div>
                      )}
                      {a.cancellation_reason && (
                        <div className="cust-hc-cancel">⛔ {a.cancellation_reason}</div>
                      )}
                      {a.notes && <div className="cust-hc-notes">{a.notes}</div>}
                    </div>
                  ))
            )}

            {/* Customer Invoices */}
            {tab === 'invoices' && (
              !data.invoices?.length
                ? <div className="cust-empty">No invoices yet.</div>
                : data.invoices.map(inv => {
                    const outstanding = Number(inv.outstanding || 0);
                    const paid        = Number(inv.amount_paid || 0);
                    const stStyle     = ciStatusStyle(inv.status);
                    return (
                      <div key={inv.id} className="cust-history-card">
                        <div className="cust-hc-top">
                          <span className="cust-hc-id cust-hc-id--inv">CI #{inv.id}</span>
                          {inv.is_b2b && (
                            <span title={inv.b2b_company_name || 'B2B Invoice'} style={{
                              fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 4,
                              background: 'transparent', color: '#7c3aed', border: '1px solid #ddd6fe',
                            }}>
                              B2B
                            </span>
                          )}
                          {inv.status && (
                            <span className="cust-hc-badge" style={{ background: stStyle.bg, color: stStyle.color }}>
                              {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                            </span>
                          )}
                          <span className="cust-hc-price">{fmtINR(inv.total)}</span>
                        </div>
                        <div className="cust-hc-meta">
                          <span><Calendar size={10}/> {fmtDate(inv.created_at)}</span>
                          {inv.hub_name       && <span><Network size={10}/> {inv.hub_name}</span>}
                          {inv.vehicle_number && <span>🚗 {inv.vehicle_number}</span>}
                          {inv.is_b2b && inv.b2b_gst_number && <span>GSTIN: {inv.b2b_gst_number}</span>}
                        </div>
                        {inv.services?.length > 0 && (
                          <div className="cust-hc-services">
                            {inv.services.map((s, si) => (
                              <span key={si} className="cust-svc-pill">
                                {s.name} · ₹{Number(s.total || 0).toLocaleString('en-IN')}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="cust-inv-pay-row">
                          {paid > 0 && <span className="cust-inv-paid">✓ Paid {fmtINR(paid)}</span>}
                          {outstanding > 0
                            ? <span className="cust-inv-due">⚠ Due {fmtINR(outstanding)}</span>
                            : <span className="cust-inv-clear">✓ Fully Paid</span>}
                        </div>
                        {/* Navigation links */}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
                          <button
                            onClick={() => navigate('/customer-invoices', { state: { openId: inv.id } })}
                            style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:11, fontWeight:700, padding:'4px 10px', borderRadius:7, border:'1.5px solid #7dd3fc', background:'#f0f9ff', color:'#0369a1', cursor:'pointer' }}>
                            <FileText size={11}/> View Invoice
                          </button>
                          {inv.estimate_id && (
                            <button
                              onClick={() => navigate('/estimates', { state: { openId: inv.estimate_id } })}
                              style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:11, fontWeight:700, padding:'4px 10px', borderRadius:7, border:'1.5px solid #86efac', background:'#f0fdf4', color:'#166534', cursor:'pointer' }}>
                              View Estimate #EST-{String(inv.estimate_id).padStart(6, '0')}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
            )}

            {/* ── Timeline ── */}
            {tab === 'timeline' && (
              tlLoading ? (
                <div className="cust-empty">Loading timeline…</div>
              ) : timeline.length === 0 ? (
                <div className="cust-empty">No activity recorded yet.</div>
              ) : (
                <div className="cust-timeline">
                  {timeline.map((item, idx) => {
                    const cfg = TL_CONFIGS[item.type] || TL_CONFIGS.default;
                    const dateStr = item.event_date
                      ? new Date(item.event_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                      : new Date(item.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
                    return (
                      <div key={`${item.type}-${item.id}-${idx}`} className="cust-tl-row">
                        {/* Left: icon + line */}
                        <div className="cust-tl-left">
                          <div className="cust-tl-dot" style={{ background: cfg.color + '20', border: `2px solid ${cfg.color}` }}>
                            <span style={{ fontSize: 14 }}>{cfg.icon}</span>
                          </div>
                          {idx < timeline.length - 1 && <div className="cust-tl-line" />}
                        </div>
                        {/* Right: card */}
                        <div className="cust-tl-card">
                          <div className="cust-tl-card-top">
                            <span className="cust-tl-type" style={{ color: cfg.color, background: cfg.color + '12' }}>{cfg.label}</span>
                            <span className="cust-tl-id">#{item.id}</span>
                            {item.status && (
                              <span className="cust-tl-status" style={{ background: item.status_color ? item.status_color + '20' : '#f3f4f6', color: item.status_color || '#6b7280' }}>
                                {item.status}
                              </span>
                            )}
                            {item.amount && Number(item.amount) > 0 && (
                              <span className="cust-tl-amount">{fmtINR(item.amount)}</span>
                            )}
                            <span className="cust-tl-date">{dateStr}</span>
                          </div>
                          <div className="cust-tl-meta">
                            {item.hub_name     && <span>🏢 {item.hub_name}</span>}
                            {item.vehicle_number && <span>🚗 {item.vehicle_number}</span>}
                            {(item.make_name || item.model_name) && (
                              <span>{[item.vehicle_type_name, item.make_name, item.model_name].filter(Boolean).join(' ')}</span>
                            )}
                          </div>
                          {item.notes && <div className="cust-tl-notes">{item.notes}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}

          </div>
        </div>
      )}
    </div>
  );
}

// Timeline config per event type
const TL_CONFIGS = {
  appointment:      { icon: '📅', label: 'Appointment',       color: '#3b82f6' },
  estimate:         { icon: '📋', label: 'Estimate',          color: '#f59e0b' },
  purchase_invoice: { icon: '🧾', label: 'Sell Invoice',      color: '#10b981' },
  customer_invoice: { icon: '💳', label: 'Customer Invoice',  color: '#8b5cf6' },
  vehicle_added:    { icon: '🚗', label: 'Vehicle Added',     color: '#0ea5e9' },
  default:          { icon: '📌', label: 'Activity',          color: '#6b7280' },
};

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CustomersPage() {
  const [customers,     setCustomers]     = useState([]);
  const [total,         setTotal]         = useState(0);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');
  const [search,        setSearch]        = useState('');
  const [page,          setPage]          = useState(1);
  const [pageSize,      setPageSize]      = useState(10);

  const location = useLocation();
  const [selectedMobile, setSelectedMobile] = useState(() => location.state?.openMobile ?? null);
  const [detailEdit,     setDetailEdit]     = useState(false);
  const searchTimer = useRef(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ page, limit: pageSize });
      if (search) qs.set('search', search);
      const r = await api(`/api/customers?${qs}`);
      setCustomers(r.items || []);
      setTotal(r.total || 0);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [search, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  function handleSearchChange(v) {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setSearch(v); setPage(1); }, 350);
  }

  // ── Full-page detail view ──
  if (selectedMobile) {
    return (
      <>
        <CustomerDetail
          mobile={selectedMobile}
          startEditing={detailEdit}
          onBack={() => { setSelectedMobile(null); setDetailEdit(false); }}
          onRefresh={load}
        />
      </>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end   = Math.min(page * pageSize, total);

  return (
    <div className="cust-page">
      <header className="page-header">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={20}/> Customers
          </h2>
          <p>Unified view of all customers — their leads, appointments, and spend.</p>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      {/* Search */}
      <div className="cust-filters">
        <div className="cust-search-wrap">
          <Search size={14} className="cust-search-icon"/>
          <input className="cust-search" placeholder="Search by name or mobile…"
            onChange={e => handleSearchChange(e.target.value)} />
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ overflowX: 'auto' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table cust-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Contact</th>
                <th style={{ textAlign: 'center' }}>Appointments</th>
                <th style={{ textAlign: 'right' }}>Total Spend</th>
                <th>Last Appointment</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j}><div className="cust-skel"/></td>
                    ))}
                  </tr>
                ))
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan="6">
                    <div className="cust-empty-state">
                      <Users size={36} style={{ opacity: .2, marginBottom: 10 }}/>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>No customers yet</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {search ? 'Try a different search.' : 'Customers appear here once a lead is converted to an appointment.'}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : customers.map(c => {
                const avStyle = avatarStyle(c.customer_name || c.mobile);
                const initial = (c.customer_name || c.mobile || '?')[0].toUpperCase();
                return (
                  <tr key={c.mobile} style={{ cursor: 'pointer' }}
                    onClick={() => { setDetailEdit(false); setSelectedMobile(c.mobile); }}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="cust-avatar"
                          style={{ background: avStyle.bg, color: avStyle.color }}>
                          {initial}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{c.customer_name || 'Unknown'}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{c.mobile}</div>
                      {c.whatsapp && c.whatsapp !== c.mobile && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 3 }}>
                          <MessageCircle size={10}/> {c.whatsapp}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className="cust-count-chip cust-count-chip--appt">
                        {c.total_appointments}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: '#0f766e' }}>
                        {fmtINR(c.total_spend)}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {fmtDate(c.last_appointment)}
                      </div>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="cust-row-actions">
                        <a href={`https://wa.me/91${(c.whatsapp || c.mobile).replace(/\D/g,'')}`}
                          target="_blank" rel="noreferrer"
                          className="cust-row-btn cust-row-btn--wa" title="WhatsApp">
                          <MessageCircle size={13}/>
                        </a>
                        <button className="cust-row-btn cust-row-btn--edit" title="Edit customer"
                          onClick={() => { setDetailEdit(true); setSelectedMobile(c.mobile); }}>
                          <Pencil size={13}/>
                        </button>
                        <button className="cust-row-btn cust-row-btn--view" title="View profile"
                          onClick={() => { setDetailEdit(false); setSelectedMobile(c.mobile); }}>
                          <Eye size={13}/>
                          <span>View</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <PaginationBar
          page={page} total={total} pageSize={pageSize}
          onPage={setPage}
          onPageSize={n => { setPageSize(n); setPage(1); }}
          noun="customer"
        />
      </div>
    </div>
  );
}



