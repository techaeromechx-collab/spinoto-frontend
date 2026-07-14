import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import {
  Users, Search, X, ChevronLeft, ChevronRight, ChevronDown,
  Phone, Calendar, Eye, Pencil, Mail, StickyNote, Check,
  Car, Network, MessageCircle, Plus, Trash2, FileText, Building2,
  IndianRupee, BarChart3, Wallet, AlertCircle,
} from 'lucide-react';
import PaginationBar from '../components/PaginationBar.jsx';
import { readListState, writeListState } from '../lib/listStatePersist.js';
import { useListScrollRestore } from '../hooks/useListScrollRestore.js';
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

function AddVehicleModal({ mobile, onClose, onSaved, initial = null }) {
  useEscapeClose(onClose);
  const [form, setForm] = useState({
    vehicle_number:  initial?.vehicle_number  || '',
    vehicle_type_id: initial?.vehicle_type_id ? String(initial.vehicle_type_id) : '',
    make_id:         initial?.make_id         ? String(initial.make_id)         : '',
    model_id:        initial?.model_id        ? String(initial.model_id)        : '',
    color:           initial?.color           || '',
    year:            initial?.year            || '',
    notes:           initial?.notes           || '',
  });
  const [types,       setTypes]       = useState([]);
  const [makes,       setMakes]       = useState([]);
  const [models,      setModels]      = useState([]);
  const [bodyTypes,   setBodyTypes]   = useState([]);
  const [segments,    setSegments]    = useState([]);
  const [ccCategories, setCcCategories] = useState([]);
  const [saving,      setSaving]      = useState(false);
  const [err,         setErr]         = useState('');

  useEffect(() => {
    api('/api/vehicles/types').then(r => setTypes(r.items || [])).catch(() => {});
    api('/api/vehicles/body-types').then(r => setBodyTypes(r.items || [])).catch(() => {});
    api('/api/vehicles/segments').then(r => setSegments(r.items || [])).catch(() => {});
    api('/api/cc-categories').then(r => setCcCategories(r.items || [])).catch(() => {});
  }, []);

  const isFirstType = useRef(true);
  useEffect(() => {
    setMakes([]); setModels([]);
    if (isFirstType.current) { isFirstType.current = false; }
    else { setForm(f => ({ ...f, make_id: '', model_id: '' })); }
    if (!form.vehicle_type_id) return;
    api(`/api/vehicles/makes?type_id=${form.vehicle_type_id}`)
      .then(r => setMakes(r.items || [])).catch(() => {});
  }, [form.vehicle_type_id]);

  const isFirstMake = useRef(true);
  useEffect(() => {
    setModels([]);
    if (isFirstMake.current) { isFirstMake.current = false; }
    else { setForm(f => ({ ...f, model_id: '' })); }
    if (!form.make_id) return;
    api(`/api/vehicles/models?make_id=${form.make_id}`)
      .then(r => setModels(r.items || [])).catch(() => {});
  }, [form.make_id]);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  const selectedModel  = models.find(m => String(m.id) === String(form.model_id)) || null;
  const selectedType   = types.find(t => String(t.id) === String(form.vehicle_type_id)) || null;
  const isTwoWheeler   = selectedType ? isTwo(selectedType.name) : false;
  const bodyTypeName   = selectedModel?.body_type_id   ? (bodyTypes.find(b => b.id === selectedModel.body_type_id)?.name || null) : null;
  const segmentName    = selectedModel?.segment_id     ? (segments.find(s => s.id === selectedModel.segment_id)?.name   || null) : null;
  const ccCategoryName = selectedModel?.cc_category_id ? (ccCategories.find(c => c.id === selectedModel.cc_category_id)?.name || null) : null;
  const engineCC       = selectedModel?.engine_cc || null;

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
    <div className="aveh-backdrop">
      <div className="aveh-modal" onClick={e => e.stopPropagation()}>
        <div className="aveh-hdr">
          <span className="aveh-title">
            {initial ? <><Pencil size={14}/> Save Vehicle</> : <><Car size={14}/> Add Vehicle</>}
          </span>
          <button className="cust-icon-btn" onClick={onClose}><X size={15}/></button>
        </div>
        <div className="aveh-body">
          {err && <div className="aveh-err">{err}</div>}
          {initial && !err && (
            <div className="aveh-hint">
              Seen on a past appointment/invoice — save it to make it editable.
            </div>
          )}

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
                    <span className="aveh-autoinfo-val">{ccCategoryName || '—'}</span>
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
  useEscapeClose(onClose);
  const originalPlate = (vehicle.vehicle_number || '').toUpperCase();
  const [form, setForm] = useState({
    vehicle_number:  vehicle.vehicle_number || '',
    vehicle_type_id: String(vehicle.vehicle_type_id || ''),
    make_id:         String(vehicle.make_id         || ''),
    model_id:        String(vehicle.model_id        || ''),
    color:           vehicle.color || '',
    year:            vehicle.year  || '',
    notes:           vehicle.notes || '',
  });
  const [types,        setTypes]        = useState([]);
  const [makes,        setMakes]        = useState([]);
  const [models,       setModels]       = useState([]);
  const [bodyTypes,    setBodyTypes]    = useState([]);
  const [segments,     setSegments]     = useState([]);
  const [ccCategories, setCcCategories] = useState([]);
  const [saving,       setSaving]       = useState(false);
  const [err,          setErr]          = useState('');
  const [propagateNumber, setPropagateNumber] = useState(false);
  const [usage, setUsage] = useState(null); // { appointments, estimates, invoices } for the ORIGINAL plate

  const plateChanged = form.vehicle_number.trim().toUpperCase() !== originalPlate;

  useEffect(() => {
    api(`/api/customers/${encodeURIComponent(mobile)}/vehicle-usage?number=${encodeURIComponent(originalPlate)}`)
      .then(setUsage).catch(() => setUsage({ appointments: 0, estimates: 0, invoices: 0 }));
  }, []);

  const usageParts = usage ? [
    usage.appointments > 0 && `${usage.appointments} appointment${usage.appointments !== 1 ? 's' : ''}`,
    usage.estimates    > 0 && `${usage.estimates} estimate${usage.estimates !== 1 ? 's' : ''}`,
    usage.invoices     > 0 && `${usage.invoices} invoice${usage.invoices !== 1 ? 's' : ''}`,
  ].filter(Boolean) : [];

  useEffect(() => {
    api('/api/vehicles/types').then(r => setTypes(r.items || [])).catch(() => {});
    api('/api/vehicles/body-types').then(r => setBodyTypes(r.items || [])).catch(() => {});
    api('/api/vehicles/segments').then(r => setSegments(r.items || [])).catch(() => {});
    api('/api/cc-categories').then(r => setCcCategories(r.items || [])).catch(() => {});
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
  const bodyTypeName   = selectedModel?.body_type_id   ? (bodyTypes.find(b => b.id === selectedModel.body_type_id)?.name || null) : null;
  const segmentName    = selectedModel?.segment_id     ? (segments.find(s => s.id === selectedModel.segment_id)?.name   || null) : null;
  const ccCategoryName = selectedModel?.cc_category_id ? (ccCategories.find(c => c.id === selectedModel.cc_category_id)?.name || null) : null;
  const engineCC       = selectedModel?.engine_cc || null;

  async function handleSave() {
    if (!form.vehicle_number.trim()) { setErr('Vehicle number is required'); return; }
    setSaving(true); setErr('');
    try {
      await api(`/api/customers/${encodeURIComponent(mobile)}/vehicles/${vehicle.cv_id}`, {
        method: 'PUT',
        body: {
          vehicle_number:  form.vehicle_number.trim().toUpperCase(),
          vehicle_type_id: form.vehicle_type_id || null,
          make_id:         form.make_id         || null,
          model_id:        form.model_id        || null,
          color:           form.color           || null,
          year:            form.year ? parseInt(form.year, 10) : null,
          notes:           form.notes           || null,
          propagate_vehicle_number: plateChanged && propagateNumber,
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
    <div className="aveh-backdrop">
      <div className="aveh-modal" onClick={e => e.stopPropagation()}>
        <div className="aveh-hdr">
          <span className="aveh-title"><Pencil size={14}/> Edit Vehicle</span>
          <button className="cust-icon-btn" onClick={onClose}><X size={15}/></button>
        </div>
        <div className="aveh-body">
          {err && <div className="aveh-err">{err}</div>}

          <div className="aveh-field aveh-field--full">
            <label>Vehicle Number *</label>
            <input className="aveh-input" placeholder="e.g. GJ07BA9034"
              value={form.vehicle_number}
              onChange={e => set('vehicle_number', e.target.value.toUpperCase())}/>
          </div>

          {plateChanged && usage && usageParts.length > 0 && (
            <label className="aveh-checkbox-row">
              <input type="checkbox" checked={propagateNumber}
                onChange={e => setPropagateNumber(e.target.checked)}/>
              <span>Also update this number on {usageParts.join(', ')} for this customer</span>
            </label>
          )}
          {plateChanged && usage && usageParts.length === 0 && (
            <div className="aveh-hint">
              No past appointments, estimates or invoices found for {originalPlate} — nothing else to update.
            </div>
          )}

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
                    <span className="aveh-autoinfo-val">{ccCategoryName || '—'}</span>
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
function CustomerDetail({ mobile, onBack, onRefresh, startEditing = false, onLoaded }) {
  const navigate = useNavigate();

  const [data,        setData]       = useState(null);
  const [loading,     setLoading]    = useState(true);
  const [err,         setErr]        = useState('');
  const [tab,         setTab]        = useState('appointments');
  const [timeline,    setTimeline]   = useState([]);
  const [tlLoading,   setTlLoading]  = useState(false);
  const [addVehOpen,  setAddVehOpen] = useState(false);
  const [editVeh,     setEditVeh]    = useState(null); // vehicle object being edited
  const [promoteVeh,  setPromoteVeh] = useState(null); // non-manual vehicle being saved for the first time
  const [deleting,    setDeleting]   = useState(null);

  const [editing,     setEditing]    = useState(startEditing);
  const [editForm,    setEditForm]   = useState({
    display_name: '', whatsapp: '', email: '', notes: '',
    is_b2b: false, b2b_company_name: '', b2b_gst_number: '', b2b_address: '',
  });
  const [editSaving,  setEditSaving] = useState(false);
  const [editErr,     setEditErr]    = useState('');
  const [showB2bConfirm, setShowB2bConfirm] = useState(false);

  // Scoped B2B-only edit — opens a small modal instead of the full profile
  // edit form. Still writes through the same editForm/handleEditSave/
  // doSaveEdit path (so the existing "confirm B2B change" step and the PUT
  // call are unchanged), just entered differently and with a narrower UI.
  const [editingB2b, setEditingB2b] = useState(false);

  const [delConfirm, setDelConfirm]  = useState(false);
  const [delBusy,    setDelBusy]     = useState(false);

  // ── Appointments tab: client-side search/filter/pagination (same data
  // already fetched by loadData — data.appointments — no extra API calls) ──
  const [apptSearch,       setApptSearch]       = useState('');
  const [apptStatusFilter, setApptStatusFilter] = useState('');
  const [apptDateFrom,     setApptDateFrom]     = useState('');
  const [apptDateTo,       setApptDateTo]       = useState('');
  const [apptPage,         setApptPage]         = useState(1);
  const [apptPageSize,     setApptPageSize]     = useState(10);

  function loadData() {
    setLoading(true); setErr('');
    api(`/api/customers/${encodeURIComponent(mobile)}`)
      .then(r => {
        setData(r.item);
        onLoaded?.(r.item);
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
    setApptSearch(''); setApptStatusFilter(''); setApptDateFrom(''); setApptDateTo(''); setApptPage(1);
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

  // Validates, then — only if B2B details actually changed vs what's
  // currently saved — shows a confirmation popup before saving. Editing just
  // the Customer Information modal (name/whatsapp/email/notes) never
  // triggers this, even for an existing B2B customer, since editForm's B2B
  // fields are carried through unchanged from that flow.
  function handleEditSave() {
    if (editForm.is_b2b) {
      if (!editForm.b2b_company_name.trim()) { setEditErr('Please enter the company name for the B2B invoice.'); return; }
      if (!editForm.b2b_address.trim())      { setEditErr('Please enter the billing address for the B2B invoice.'); return; }
      if (!editForm.b2b_gst_number.trim()) { setEditErr('Please enter a GST number.'); return; }
    }
    setEditErr('');
    const b2bChanged =
      !!editForm.is_b2b !== !!data?.default_is_b2b ||
      (editForm.is_b2b && (
        editForm.b2b_company_name !== (data?.default_b2b_company_name || '') ||
        editForm.b2b_gst_number   !== (data?.default_b2b_gst_number   || '') ||
        editForm.b2b_address      !== (data?.default_b2b_address      || '')
      ));
    if (b2bChanged) {
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
      setEditingB2b(false);
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

  // "Customer Since" — earliest date across appointments/invoices/estimates
  // already in `data` (no dedicated created-date field exists for a customer
  // that never had its profile edited, so this is the best available proxy).
  const customerSince = (() => {
    if (!data) return null;
    const ts = [
      ...(data.appointments || []).map(a => a.created_at),
      ...(data.invoices     || []).map(i => i.created_at),
      ...(data.estimates    || []).map(e => e.created_at),
    ].filter(Boolean).map(d => new Date(d).getTime());
    return ts.length ? new Date(Math.min(...ts)) : null;
  })();

  // ── Appointments tab: filtered + paginated view of data.appointments ──
  const filteredAppts = (data?.appointments || []).filter(a => {
    if (apptStatusFilter && a.status_name !== apptStatusFilter) return false;
    if (apptDateFrom && (a.scheduled_date || '') < apptDateFrom) return false;
    if (apptDateTo   && (a.scheduled_date || '') > apptDateTo)   return false;
    if (apptSearch) {
      const q = apptSearch.toLowerCase();
      const hay = `${a.id} ${a.vehicle_number || ''} ${a.hub_name || ''} ${a.make_name || ''} ${a.model_name || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const apptStatusOptions = [...new Set((data?.appointments || []).map(a => a.status_name).filter(Boolean))];
  const pagedAppts = filteredAppts.slice((apptPage - 1) * apptPageSize, apptPage * apptPageSize);

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

        {data && (
          <div className="cust-hdr-actions">
            <a href={`https://wa.me/91${(data.whatsapp || data.mobile).replace(/\D/g,'')}`}
              target="_blank" rel="noreferrer" className="cust-hdr-btn cust-hdr-btn--wa" title="Open WhatsApp">
              <MessageCircle size={13}/>
              <span>WhatsApp</span>
            </a>
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

      </div>

      {loading ? (
        <div className="cust-detail-loading">Loading…</div>
      ) : err ? (
        <div className="cust-detail-err">{err}</div>
      ) : (
        <div className="cust-detail-body">

          {/* ── Identity banner ── */}
          <div className="cdh-card">
              <div className="cdh-identity">
                <div className="cust-avatar cust-avatar--lg" style={{ background: avStyle.bg, color: avStyle.color }}>
                  {initial}
                </div>
                <div className="cust-profile-info">
                  <div className="cdh-name-row">
                    <span className="cust-profile-name">{data.customer_name || 'Unknown'}</span>
                    <span className="cdh-badge">Active</span>
                  </div>
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

              {/* ── Stats ── */}
              <div className="cdh-stats">
                <div className="cdh-stat">
                  <div className="cdh-stat-icon" style={{ background: '#e0f2fe', color: '#0369a1' }}><Users size={15}/></div>
                  <div>
                    <div className="cdh-stat-val">{data.total_appointments}</div>
                    <div className="cdh-stat-lbl">Total Visits</div>
                  </div>
                </div>
                <div className="cdh-stat">
                  <div className="cdh-stat-icon" style={{ background: '#dcfce7', color: '#166534' }}><IndianRupee size={15}/></div>
                  <div>
                    <div className="cdh-stat-val">{fmtINR(data.total_spend)}</div>
                    <div className="cdh-stat-lbl">Total Spend</div>
                  </div>
                </div>
                <div className="cdh-stat">
                  <div className="cdh-stat-icon" style={{ background: '#ede9fe', color: '#6d28d9' }}><BarChart3 size={15}/></div>
                  <div>
                    <div className="cdh-stat-val">{fmtINR(data.avg_spend)}</div>
                    <div className="cdh-stat-lbl">Avg/Visit</div>
                  </div>
                </div>
                <div className="cdh-stat">
                  <div className="cdh-stat-icon" style={{ background: '#fef3c7', color: '#92400e' }}><Wallet size={15}/></div>
                  <div>
                    <div className="cdh-stat-val" style={{ color: Number(data.total_outstanding) > 0 ? '#dc2626' : undefined }}>
                      {Number(data.total_outstanding) > 0 ? fmtINR(data.total_outstanding) : 'Nil'}
                    </div>
                    <div className="cdh-stat-lbl">Due Amount</div>
                  </div>
                </div>
              </div>
            </div>

          {/* ── Two-column layout ── */}
          <div className="cust-detail-grid">
          <div className="cdg-left">

          {/* ── Customer Information ── */}
          <div className="cust-section cds-card">
            <div className="cust-section-title">
              <StickyNote size={11}/> Customer Information
              <button className="cust-add-veh-btn" onClick={() => {
                setEditForm({
                  display_name: data.customer_name || '',
                  whatsapp:     data.whatsapp      || '',
                  email:        data.email         || '',
                  notes:        data.profile_notes || '',
                  is_b2b:            !!data.default_is_b2b,
                  b2b_company_name:  data.default_b2b_company_name || '',
                  b2b_gst_number:    data.default_b2b_gst_number   || '',
                  b2b_address:       data.default_b2b_address      || '',
                });
                setEditErr(''); setDelConfirm(false); setEditing(true);
              }}>
                <Pencil size={11}/> Edit
              </button>
            </div>
            <div className="cds-info-list">
              <div className="cds-info-row"><Phone size={12}/><span className="cds-info-lbl">Phone</span><span className="cds-info-val">{data.mobile}</span></div>
              {data.email && (
                <div className="cds-info-row"><Mail size={12}/><span className="cds-info-lbl">Email</span><span className="cds-info-val">{data.email}</span></div>
              )}
              {data.default_is_b2b && data.default_b2b_gst_number && (
                <div className="cds-info-row"><FileText size={12}/><span className="cds-info-lbl">GSTIN</span><span className="cds-info-val">{data.default_b2b_gst_number}</span></div>
              )}
              {customerSince && (
                <div className="cds-info-row"><Calendar size={12}/><span className="cds-info-lbl">Customer Since</span><span className="cds-info-val">{fmtDate(customerSince)}</span></div>
              )}
              {data.profile_notes && (
                <div className="cds-info-row"><StickyNote size={12}/><span className="cds-info-lbl">Notes</span><span className="cds-info-val">{data.profile_notes}</span></div>
              )}
            </div>
          </div>

          {/* ── B2B / GST Details ── */}
          <div className="cust-section cds-card">
            <div className="cust-section-title">
              <Building2 size={11}/> B2B / GST Details
              <button className="cust-add-veh-btn" onClick={() => {
                setEditForm({
                  display_name: data.customer_name || '',
                  whatsapp:     data.whatsapp      || '',
                  email:        data.email         || '',
                  notes:        data.profile_notes || '',
                  is_b2b:            !!data.default_is_b2b,
                  b2b_company_name:  data.default_b2b_company_name || '',
                  b2b_gst_number:    data.default_b2b_gst_number   || '',
                  b2b_address:       data.default_b2b_address      || '',
                });
                setEditErr('');
                setEditingB2b(true);
              }}>
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

          {editing && !showB2bConfirm && (
            <div className="aveh-backdrop" onClick={() => { setEditing(false); setEditErr(''); }}>
              <div className="aveh-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
                <div className="aveh-hdr">
                  <span className="aveh-title"><StickyNote size={14}/> Edit Customer Information</span>
                  <button className="cust-icon-btn" onClick={() => { setEditing(false); setEditErr(''); }}><X size={15}/></button>
                </div>
                <div className="aveh-body">
                  {editErr && <div className="aveh-err">{editErr}</div>}
                  <div className="aveh-field">
                    <label>Full Name</label>
                    <input className="aveh-input" placeholder="Customer name" autoFocus
                      value={editForm.display_name}
                      onChange={e => setEditForm(f => ({ ...f, display_name: e.target.value }))}/>
                  </div>
                  <div className="aveh-field">
                    <label>WhatsApp</label>
                    <input className="aveh-input" placeholder="WhatsApp number"
                      value={editForm.whatsapp}
                      onChange={e => setEditForm(f => ({ ...f, whatsapp: e.target.value }))}/>
                  </div>
                  <div className="aveh-field">
                    <label>Email</label>
                    <input className="aveh-input" placeholder="Email address (optional)" autoComplete="off"
                      value={editForm.email}
                      onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}/>
                  </div>
                  <div className="aveh-field">
                    <label>Notes</label>
                    <textarea className="aveh-input aveh-textarea" rows={2}
                      placeholder="Internal notes about this customer…"
                      value={editForm.notes}
                      onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}/>
                  </div>
                </div>
                <div className="aveh-footer">
                  <button className="cust-hdr-btn cust-hdr-btn--cancel" onClick={() => { setEditing(false); setEditErr(''); }} disabled={editSaving}>
                    <X size={13}/> <span>Cancel</span>
                  </button>
                  <button className="cust-hdr-btn cust-hdr-btn--save" onClick={handleEditSave} disabled={editSaving}>
                    <Check size={13}/> <span>{editSaving ? 'Saving…' : 'Save'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {editingB2b && !showB2bConfirm && (
            <div className="aveh-backdrop" onClick={() => { setEditingB2b(false); setEditErr(''); }}>
              <div className="aveh-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
                <div className="aveh-hdr">
                  <span className="aveh-title"><Building2 size={14}/> Edit B2B / GST Details</span>
                  <button className="cust-icon-btn" onClick={() => { setEditingB2b(false); setEditErr(''); }}><X size={15}/></button>
                </div>
                <div className="aveh-body">
                  {editErr && <div className="aveh-err">{editErr}</div>}
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
                    <span style={{ fontWeight: 700, fontSize: 13 }}>B2B Customer (GST Registered)</span>
                  </label>

                  {editForm.is_b2b && (
                    <div className="aveh-row">
                      <div className="aveh-field">
                        <label>Company Name</label>
                        <input className="aveh-input" placeholder="GST-registered company name"
                          value={editForm.b2b_company_name}
                          onChange={e => setEditForm(f => ({ ...f, b2b_company_name: e.target.value }))}/>
                      </div>
                      <div className="aveh-field">
                        <label>GST Number</label>
                        <input className="aveh-input" placeholder="GST Number" maxLength={15}
                          value={editForm.b2b_gst_number}
                          onChange={e => setEditForm(f => ({ ...f, b2b_gst_number: e.target.value.toUpperCase() }))}/>
                      </div>
                      <div className="aveh-field aveh-field--full">
                        <label>Billing Address</label>
                        <textarea className="aveh-input aveh-textarea" rows={2}
                          placeholder="Registered billing address"
                          value={editForm.b2b_address}
                          onChange={e => setEditForm(f => ({ ...f, b2b_address: e.target.value }))}/>
                      </div>
                    </div>
                  )}
                </div>
                <div className="aveh-footer">
                  <button className="cust-hdr-btn cust-hdr-btn--cancel" onClick={() => { setEditingB2b(false); setEditErr(''); }} disabled={editSaving}>
                    <X size={13}/> <span>Cancel</span>
                  </button>
                  <button className="cust-hdr-btn cust-hdr-btn--save" onClick={handleEditSave} disabled={editSaving}>
                    <Check size={13}/> <span>Save</span>
                  </button>
                </div>
              </div>
            </div>
          )}

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

          {promoteVeh && (
            <AddVehicleModal
              mobile={mobile}
              initial={promoteVeh}
              onClose={() => setPromoteVeh(null)}
              onSaved={() => { setPromoteVeh(null); loadData(); }}
            />
          )}

          </div>{/* /cdg-left */}
          <div className="cdg-right">

          {/* ── Vehicles ── */}
          <div className="cust-section cds-card cust-veh-wide">
            <div className="cust-section-title">
              <Car size={11}/> Vehicles ({data.vehicles?.length || 0})
              <button className="cust-add-veh-btn" onClick={() => setAddVehOpen(true)}>
                <Plus size={11}/> Add
              </button>
            </div>
            {data.vehicles?.length > 0 ? (
              <div className="cust-vehicles-wrap cust-vehicles-wrap--grid">
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
                      <div className="cust-veh-actions">
                        <button
                          className="cust-veh-act-btn cust-veh-act-btn--edit"
                          title={v.cv_id ? 'Edit vehicle' : 'Save vehicle to make it editable'}
                          onClick={() => v.cv_id ? setEditVeh(v) : setPromoteVeh(v)}
                        >
                          <Pencil size={11}/>
                        </button>
                        {v.source === 'manual' && v.cv_id && (
                          <button
                            className="cust-veh-act-btn cust-veh-act-btn--del"
                            title="Remove vehicle"
                            disabled={deleting === v.cv_id}
                            onClick={() => handleDeleteVehicle(v.cv_id)}
                          >
                            {deleting === v.cv_id ? '…' : <Trash2 size={11}/>}
                          </button>
                        )}
                      </div>
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

          {/* ── Tabs ── */}
          <div className="cust-section cds-card" style={{ padding: 0 }}>
          <div className="cust-tabs">
            <button className={`cust-tab${tab === 'appointments' ? ' cust-tab--on' : ''}`} onClick={() => setTab('appointments')}>
              <Calendar size={11}/> Appointments <span className="cust-tab-count">{data.appointments.length}</span>
            </button>
            <button className={`cust-tab${tab === 'invoices' ? ' cust-tab--on' : ''}`} onClick={() => setTab('invoices')}>
              🧾 Invoices <span className="cust-tab-count">{data.invoices?.length || 0}</span>
            </button>
            <button className={`cust-tab${tab === 'estimates' ? ' cust-tab--on' : ''}`} onClick={() => setTab('estimates')}>
              📋 Estimates <span className="cust-tab-count">{data.estimates?.length || 0}</span>
            </button>
            <button className={`cust-tab${tab === 'timeline' ? ' cust-tab--on' : ''}`} onClick={() => setTab('timeline')}>
              🕐 Timeline
            </button>
          </div>

          {/* ── Tab content ── */}
          <div className="cust-tab-content">

            {/* Appointments — searchable/filterable/paginated table */}
            {tab === 'appointments' && (
              data.appointments.length === 0 ? (
                <div className="cust-empty">No appointments yet.</div>
              ) : (
                <>
                  <div className="cds-toolbar">
                    <div className="cust-search-wrap" style={{ maxWidth: 220 }}>
                      <Search size={13} className="cust-search-icon"/>
                      <input className="cust-search" placeholder="Search appointments…"
                        value={apptSearch}
                        onChange={e => { setApptSearch(e.target.value); setApptPage(1); }}/>
                    </div>
                    <select className="cds-filter-select" value={apptStatusFilter}
                      onChange={e => { setApptStatusFilter(e.target.value); setApptPage(1); }}>
                      <option value="">All statuses</option>
                      {apptStatusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <input type="date" className="cds-filter-select" value={apptDateFrom}
                      onChange={e => { setApptDateFrom(e.target.value); setApptPage(1); }}/>
                    <input type="date" className="cds-filter-select" value={apptDateTo}
                      onChange={e => { setApptDateTo(e.target.value); setApptPage(1); }}/>
                    <button className="cust-hdr-btn cust-hdr-btn--edit" style={{ marginLeft: 'auto' }}
                      onClick={() => navigate('/appointments', { state: { prefillCustomer: {
                        mobile: data.mobile, customer_name: data.customer_name, whatsapp: data.whatsapp,
                      } } })}>
                      <Plus size={13}/> <span>New Appointment</span>
                    </button>
                  </div>

                  {filteredAppts.length === 0 ? (
                    <div className="cust-empty">No appointments match these filters.</div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="cust-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                            <th style={{ padding: '8px 10px' }}>Appointment</th>
                            <th style={{ padding: '8px 10px' }}>Date &amp; Time</th>
                            <th style={{ padding: '8px 10px' }}>Vehicle</th>
                            <th style={{ padding: '8px 10px' }}>Status</th>
                            <th style={{ padding: '8px 10px', textAlign: 'right' }}>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pagedAppts.map(a => (
                            <tr key={a.id} onClick={() => navigate(a.public_token ? `/appointments/${a.public_token}` : '/appointments', a.public_token ? undefined : { state: { openApptId: a.id } })}
                              style={{ cursor: 'pointer', borderTop: '1px solid var(--border)' }}>
                              <td style={{ padding: '9px 10px' }}>
                                <div style={{ fontWeight: 700, fontSize: 13 }}>Appt #{a.id}</div>
                                {a.hub_name && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.hub_name}</div>}
                              </td>
                              <td style={{ padding: '9px 10px', fontSize: 12 }}>
                                {fmtDate(a.scheduled_date)}{a.scheduled_time ? ` · ${fmtTime(a.scheduled_time)}` : ''}
                              </td>
                              <td style={{ padding: '9px 10px', fontSize: 12 }}>{a.vehicle_number || '—'}</td>
                              <td style={{ padding: '9px 10px' }}>
                                {a.status_name && (
                                  <span className="cust-hc-badge" style={{ background: a.status_bg || '#f3f4f6', color: a.status_color || '#6b7280' }}>
                                    {a.status_name}
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, fontSize: 13 }}>{fmtINR(a.total_price)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <PaginationBar page={apptPage} total={filteredAppts.length} pageSize={apptPageSize}
                    onPage={setApptPage} onPageSize={setApptPageSize} noun="appointment"/>
                </>
              )
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
                        <div className="cust-inv-footer">
                          <div className="cust-inv-status-row">
                            {paid > 0 && (
                              <span className="cust-inv-chip cust-inv-chip--paid"><Check size={11}/> Paid {fmtINR(paid)}</span>
                            )}
                            {outstanding > 0
                              ? <span className="cust-inv-chip cust-inv-chip--due"><AlertCircle size={11}/> Due {fmtINR(outstanding)}</span>
                              : <span className="cust-inv-chip cust-inv-chip--clear"><Check size={11}/> Fully Paid</span>}
                          </div>
                          <div className="cust-inv-actions">
                            <button
                              className="cust-inv-action cust-inv-action--invoice"
                              onClick={() => navigate(inv.public_token ? `/customer-invoices/${inv.public_token}` : '/customer-invoices', inv.public_token ? undefined : { state: { openId: inv.id } })}>
                              <FileText size={11}/> View Invoice
                            </button>
                            {inv.estimate_id && (
                              <button
                                className="cust-inv-action cust-inv-action--estimate"
                                onClick={() => navigate(inv.estimate_token ? `/estimates/${inv.estimate_token}` : '/estimates', inv.estimate_token ? undefined : { state: { openId: inv.estimate_id } })}>
                                View Estimate #EST-{String(inv.estimate_id).padStart(6, '0')}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
            )}

            {/* ── Estimates (standalone only — appointment-linked estimates aren't
                 included in this response) ── */}
            {tab === 'estimates' && (
              !data.estimates?.length
                ? <div className="cust-empty">No standalone estimates yet.</div>
                : data.estimates.map(e => (
                    <div
                      key={e.id}
                      className="cust-history-card"
                      onClick={() => navigate(e.public_token ? `/estimates/${e.public_token}` : '/estimates', e.public_token ? undefined : { state: { openId: e.id } })}
                      style={{ cursor: 'pointer' }}
                      title={`Open Estimate #${e.id}`}
                    >
                      <div className="cust-hc-top">
                        <span className="cust-hc-id">EST-{String(e.id).padStart(6, '0')}</span>
                        {e.status && (
                          <span className="cust-hc-badge" style={{ background: '#f3f4f6', color: '#6b7280' }}>
                            {e.status.charAt(0).toUpperCase() + e.status.slice(1)}
                          </span>
                        )}
                        <span className="cust-hc-price">{fmtINR(e.grand_total)}</span>
                      </div>
                      <div className="cust-hc-meta">
                        <span><Calendar size={10}/> {fmtDate(e.created_at)}</span>
                        {e.hub_name       && <span><Network size={10}/> {e.hub_name}</span>}
                        {e.vehicle_number && <span>🚗 {e.vehicle_number}</span>}
                        {(e.make_name || e.model_name) && (
                          <span><Car size={10}/> {[e.make_name, e.model_name].filter(Boolean).join(' ')}</span>
                        )}
                      </div>
                      {e.notes && <div className="cust-hc-notes">{e.notes}</div>}
                    </div>
                  ))
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
          </div>{/* /cust-tabs card */}

          </div>{/* /cdg-right */}
          </div>{/* /cust-detail-grid */}
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

  // Remember page/pageSize/search across a full navigation away and back —
  // sessionStorage survives the unmount a route change to a different page
  // causes; plain useState does not.
  const listStateRef = useRef(readListState('sp_customers_list_v1'));
  const ls = listStateRef.current;

  const [search,        setSearch]        = useState(ls.search ?? '');
  const [page,          setPage]          = useState(ls.page ?? 1);
  const [pageSize,      setPageSize]      = useState(ls.pageSize ?? 10);

  // Persist whenever any of these change
  useEffect(() => {
    writeListState('sp_customers_list_v1', { page, pageSize, search });
  }, [page, pageSize, search]);

  useListScrollRestore('sp_customers_list_v1', !loading);

  const navigate = useNavigate();
  const location = useLocation();
  const { token } = useParams();
  const [selectedMobile, setSelectedMobile] = useState(() => location.state?.openMobile ?? null);
  const [detailEdit,     setDetailEdit]     = useState(false);
  const searchTimer = useRef(null);

  const resolvedTokenRef = useRef(null);
  // Flips true the instant the user explicitly closes the detail view.
  // Guards against a slow/late-resolving fetch (CustomerDetail's own load,
  // or the by-token resolver below) firing onLoaded/navigate AFTER the user
  // has already navigated back to the list — without this, a stale response
  // could silently re-push the token URL back into the address bar even
  // though the list is showing.
  const closedRef = useRef(false);

  function openCustomer(c, edit = false) {
    closedRef.current = false;
    resolvedTokenRef.current = c.public_token;
    setDetailEdit(edit);
    setSelectedMobile(c.mobile);
    if (c.public_token) navigate(`/customers/${c.public_token}`);
  }

  function closeCustomer() {
    closedRef.current = true;
    resolvedTokenRef.current = null;
    navigate('/customers');
  }

  function handleCustomerLoaded(item) {
    if (closedRef.current) return;
    if (!item?.public_token || resolvedTokenRef.current === item.public_token) return;
    resolvedTokenRef.current = item.public_token;
    navigate(`/customers/${item.public_token}`, { replace: true });
  }

  useEffect(() => {
    if (!token) {
      // Only clear if we were previously showing a token-resolved customer —
      // don't stomp on a `selectedMobile` that came from location.state
      // (e.g. an inbound deep link) before it's had a chance to resolve its
      // own token via handleCustomerLoaded.
      if (resolvedTokenRef.current) setSelectedMobile(null);
      resolvedTokenRef.current = null;
      return;
    }
    closedRef.current = false;
    if (resolvedTokenRef.current === token) return;
    resolvedTokenRef.current = token;
    api(`/api/customers/by-token/${token}`)
      .then(r => { if (!closedRef.current) setSelectedMobile(r.item.mobile); })
      .catch(() => { resolvedTokenRef.current = null; });
  }, [token]);

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
          onBack={() => { closeCustomer(); setDetailEdit(false); }}
          onRefresh={load}
          onLoaded={handleCustomerLoaded}
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
            defaultValue={search}
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
                    onClick={() => openCustomer(c)}>
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
                          onClick={() => openCustomer(c, true)}>
                          <Pencil size={13}/>
                        </button>
                        <button className="cust-row-btn cust-row-btn--view" title="View profile"
                          onClick={() => openCustomer(c)}>
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



