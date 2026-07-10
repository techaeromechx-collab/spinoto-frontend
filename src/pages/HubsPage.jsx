import { useEffect, useState, useCallback, useRef } from 'react';
import { api, getToken } from '../api/client.js';
import { useAuth, useCan } from '../auth/AuthContext.jsx';
import {
  Plus, Pencil, Eye, X, AlertCircle, CheckCircle2,
  Network, Search, ChevronLeft, ChevronRight, ToggleLeft, ToggleRight,
  Layers, ChevronDown, ChevronUp, Clock, FileText, Upload, Trash2, Percent, Lock,
  Image, CreditCard, Car, Ruler, Wrench,
} from 'lucide-react';
import '../styles/HubsPage.css';

// ── Day options ───────────────────────────────────────────────────────────────
const DAY_OPTS = [
  { value: 'Mon', label: 'Mon' },
  { value: 'Tue', label: 'Tue' },
  { value: 'Wed', label: 'Wed' },
  { value: 'Thu', label: 'Thu' },
  { value: 'Fri', label: 'Fri' },
  { value: 'Sat', label: 'Sat' },
  { value: 'Sun', label: 'Sun' },
];

// ── Document type config ──────────────────────────────────────────────────────
const DOC_TYPES = [
  { key: 'hub_image',       label: 'Hub Image',         accept: 'image/*' },
  { key: 'aadhaar',         label: 'Aadhaar Card' },
  { key: 'pan',             label: 'PAN Card' },
  { key: 'driving_license', label: 'Driving License' },
  { key: 'agreement',       label: 'Agreement Copy' },
  { key: 'gst_certificate', label: 'GST Certificate' },
  { key: 'bank_proof',      label: 'Bank Proof (Cancelled Cheque)', accept: 'image/*,.pdf' },
];

const EMPTY_DOCS = () => ({
  hub_image: [], aadhaar: null, pan: null, driving_license: null,
  agreement: null, gst_certificate: null, bank_proof: null,
});

// ── API base URL (for building file links) ────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// If file_url is already a full URL (ImageKit CDN), use as-is.
// Otherwise prepend API_BASE (local /uploads/... path).
function fileHref(fileUrl) {
  if (!fileUrl) return '#';
  if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) return fileUrl;
  return `${API_BASE}${fileUrl}`;
}

// ── File upload helper (uses FormData, bypasses JSON api()) ──────────────────
async function apiUpload(path, formData) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

// ── Client-side image compression ────────────────────────────────────────────
// Compresses JPG/PNG to targetMB using Canvas. PDFs pass through unchanged.
// Rejects with a user-friendly error if the image is too large to process
// (> 15 MB) or if the browser canvas times out after 20 seconds.
async function compressImage(file, targetMB = 1.4) {
  if (file.type === 'application/pdf') return file;

  const MAX_INPUT_MB = 15;
  if (file.size > MAX_INPUT_MB * 1024 * 1024) {
    throw new Error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed is ${MAX_INPUT_MB} MB.`);
  }

  const targetBytes = targetMB * 1024 * 1024;
  if (file.size <= targetBytes) return file; // already small enough

  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);

    // Safety: if canvas hangs for any reason, reject after 20s
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error('Image took too long to compress. Try a smaller file.'));
    }, 20000);

    img.onload = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);

      // Cap max dimension to 1920px
      const MAX_DIM = 1920;
      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);

      // Try descending quality levels until under targetBytes
      const qualities = [0.85, 0.75, 0.65, 0.5, 0.4];
      function tryNext(i) {
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error('Compression failed — try a different image.')); return; }
          if (blob.size <= targetBytes || i >= qualities.length - 1) {
            resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
          } else {
            tryNext(i + 1);
          }
        }, 'image/jpeg', qualities[i]);
      }
      tryNext(0);
    };

    img.onerror = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image file. Please try a different file.'));
    };

    img.src = url;
  });
}

// ── Time helpers ──────────────────────────────────────────────────────────────
function toTimeInput(v) {
  if (!v) return '';
  return String(v).slice(0, 5);
}
function fmtTime(v) {
  if (!v) return '—';
  const t = String(v).slice(0, 5);
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const PAYOUT_TERMS_OPTS = [
  { value: 'weekly',    label: 'Weekly (7 days)' },
  { value: 'fortnightly', label: 'Fortnightly (14 days)' },
  { value: 'net_30',    label: 'Net 30 (30 days)' },
  { value: 'net_60',    label: 'Net 60 (60 days)' },
  { value: 'net_90',    label: 'Net 90 (90 days)' },
  { value: 'net_180',   label: 'Net 180 (6 months)' },
  { value: 'net_365',   label: 'Net 365 (1 year)' },
  { value: 'custom',    label: 'Custom (specify days)' },
];

const VEHICLE_OPTS = [
  { value: '2W',   label: '2-Wheeler',      short: '2W',    color: '#7c3aed', bg: '#f5f3ff' },
  { value: '4W',   label: '4-Wheeler',      short: '4W',    color: '#0369a1', bg: '#e0f2fe' },
  { value: 'both', label: 'Both (2W + 4W)', short: '2W+4W', color: '#059669', bg: '#ecfdf5' },
];
function vehicleOpt(v) { return VEHICLE_OPTS.find(o => o.value === v) || VEHICLE_OPTS[2]; }

// ── Shared UI helpers ─────────────────────────────────────────────────────────
function VehicleBadge({ value }) {
  const opt = vehicleOpt(value);
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
      background: opt.bg, color: opt.color, whiteSpace: 'nowrap' }}>
      {opt.short}
    </span>
  );
}
function StatusBadge({ active }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
      background: active ? '#dcfce7' : '#f3f4f6',
      color: active ? '#16a34a' : '#6b7280',
      whiteSpace: 'nowrap', width: 'fit-content',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}
const VSTATUS_CONFIG = {
  pending:  { bg: '#fef9c3', color: '#854d0e', label: 'Pending',  labelFull: 'Pending Verification', dot: '#f59e0b' },
  verified: { bg: '#dcfce7', color: '#15803d', label: 'Verified', labelFull: 'Verified',              dot: '#22c55e' },
  rejected: { bg: '#fee2e2', color: '#b91c1c', label: 'Rejected', labelFull: 'Rejected',              dot: '#ef4444' },
};
function VerificationBadge({ status, compact = false }) {
  const cfg = VSTATUS_CONFIG[status] || VSTATUS_CONFIG.pending;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
      background: cfg.bg, color: cfg.color,
      whiteSpace: 'nowrap', width: 'fit-content',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.dot, flexShrink: 0 }} />
      {compact ? cfg.label : cfg.labelFull}
    </span>
  );
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Field wrapper ─────────────────────────────────────────────────────────────
function Field({ label, req, error, children }) {
  return (
    <div className="hb-field">
      <label>{label}{req && <span className="hb-req"> *</span>}</label>
      {children}
      {error && <span className="hb-field-err"><AlertCircle size={11} /> {error}</span>}
    </div>
  );
}

// ── Image preview helpers ─────────────────────────────────────────────────────
function isImgFile(name) {
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(name || '');
}

// Wrapper that shows a thumbnail popup when hovering over an image doc link
function ImgPreviewWrap({ href, fileName, blockStyle, children }) {
  const [hov, setHov] = useState(false);
  const isImg = isImgFile(fileName);
  return (
    <div
      style={{ position: 'relative', ...blockStyle }}
      onMouseEnter={() => isImg && setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {children}
      {isImg && hov && (
        <div className="doc-img-preview-popup">
          <img src={href} alt={fileName} loading="lazy" />
        </div>
      )}
    </div>
  );
}

// ── Document upload slot ──────────────────────────────────────────────────────
function DocSlot({ label, existing, selected, onSelect, onClearSelected, onRemoveExisting, removing }) {
  const inputRef = useRef(null);
  const [imgHov, setImgHov] = useState(false);
  const [sizeErr, setSizeErr] = useState('');
  const existingIsImg = isImgFile(existing?.file_name);
  return (
    <div className="hb-doc-slot">
      <div className="hb-doc-slot-label">{label}</div>
      {selected ? (
        <div className="hb-doc-chosen hb-doc-chosen--new">
          <FileText size={12} />
          <span className="hb-doc-fname" title={selected.name}>{selected.name}</span>
          <button type="button" className="hb-doc-rm-btn" onClick={onClearSelected} title="Remove selection">
            <X size={11} />
          </button>
        </div>
      ) : existing ? (
        <div className="hb-doc-chosen hb-doc-chosen--saved" style={{ position: 'relative' }}
          onMouseEnter={() => existingIsImg && setImgHov(true)}
          onMouseLeave={() => setImgHov(false)}>
          <FileText size={12} />
          <a className="hb-doc-fname"
            href={fileHref(existing.file_url)}
            target="_blank" rel="noreferrer"
            title={existing.file_name}>
            {existing.file_name}
          </a>
          <button type="button" className="hb-doc-change-btn"
            onClick={() => inputRef.current?.click()}>
            Change
          </button>
          <button type="button" className="hb-doc-rm-btn" onClick={onRemoveExisting}
            title="Remove document" disabled={removing}>
            <Trash2 size={11} />
          </button>
          {existingIsImg && imgHov && (
            <div className="doc-img-preview-popup">
              <img src={fileHref(existing.file_url)} alt={existing.file_name} loading="lazy" />
            </div>
          )}
        </div>
      ) : (
        <button type="button" className="hb-doc-upload-btn"
          onClick={() => inputRef.current?.click()}>
          <Upload size={12} /> Choose file
        </button>
      )}
      {sizeErr && <span className="hb-field-err"><AlertCircle size={11} /> {sizeErr}</span>}
      <input ref={inputRef} type="file" style={{ display: 'none' }}
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={e => {
          const f = e.target.files?.[0];
          if (!f) return;
          setSizeErr('');
          if (f.size > 15 * 1024 * 1024) {
            setSizeErr(`File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max 15 MB.`);
            e.target.value = '';
            return;
          }
          onSelect(f);
          e.target.value = '';
        }} />
    </div>
  );
}

// ── Hub Form Modal (Add / Edit) ───────────────────────────────────────────────
function HubModal({ hub, onClose, onSaved }) {
  const isEdit = !!hub?.id;

  const [form, setForm] = useState({
    hub_name:          hub?.hub_name         || '',
    company_name:      hub?.company_name     || '',
    person_name:       hub?.person_name      || '',
    contact_number:    hub?.contact_number   || '',
    owner_name:        hub?.owner_name       || '',
    owner_mobile:      hub?.owner_mobile     || '',
    vehicle_class:     hub?.vehicle_class    || '',
    state_id:          hub?.state_id         || '',
    city_id:           hub?.city_id          || '',
    area_id:           hub?.area_id          || '',
    rm_user_id:        hub?.rm_user_id       || '',
    is_active:         hub?.is_active        ?? false,
    notes:             hub?.notes            || '',
    open_time:         toTimeInput(hub?.open_time)  || '',
    close_time:        toTimeInput(hub?.close_time) || '',
    working_days:      hub?.working_days     || '',
    has_gst:           hub?.has_gst          ?? false,
    gst_number:        hub?.gst_number       || '',
    tech_rate_service:  hub?.tech_rate_service  != null ? String(hub.tech_rate_service)  : '',
    tech_rate_parts:    hub?.tech_rate_parts    != null ? String(hub.tech_rate_parts)    : '',
    commission_percent: hub?.commission_percent  != null ? String(hub.commission_percent) : '',
    payout_terms:        hub?.payout_terms        || 'net_30',
    payout_cycle_days:   hub?.payout_cycle_days   != null ? String(hub.payout_cycle_days)  : '',
    bank_account_number: hub?.bank_account_number || '',
    bank_ifsc:           hub?.bank_ifsc           || '',
    bank_name:           hub?.bank_name           || '',
    account_holder_name: hub?.account_holder_name || '',
    vehicle_capacity:    hub?.vehicle_capacity    != null ? String(hub.vehicle_capacity)   : '',
    workshop_area_sqft:  hub?.workshop_area_sqft  != null ? String(hub.workshop_area_sqft) : '',
    no_of_mechanics:     hub?.no_of_mechanics     != null ? String(hub.no_of_mechanics)    : '',
  });

  const [selectedDays, setSelectedDays] = useState(() => {
    const d = hub?.working_days || '';
    return new Set(d ? d.split(',').map(s => s.trim()).filter(Boolean) : []);
  });

  const [docFiles, setDocFiles]         = useState(EMPTY_DOCS);
  const [existingDocs, setExistingDocs] = useState({});
  const [removingDoc, setRemovingDoc]   = useState(null);
  const hubImgRef = useRef(null);

  const [errors, setErrors]         = useState({});
  const [saving, setSaving]         = useState(false);
  const [apiErr, setApiErr]         = useState('');
  const [states, setStates]         = useState([]);
  const [cities, setCities]         = useState([]);
  const [areas, setAreas]           = useState([]);
  const [rmUsers, setRmUsers]       = useState([]);
  const [loadingLoc, setLoadingLoc] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        const [sRes, uRes] = await Promise.all([
          api('/api/locations/states'),
          api('/api/users/assignable'),
        ]);
        setStates(sRes.items.filter(s => s.is_active));
        setRmUsers(uRes.items); // assignable already filters is_active = true
        if (isEdit && hub.id) {
          try {
            const dRes = await api(`/api/hubs/${hub.id}/documents`);
            const map  = {};
            dRes.items.forEach(d => {
              if (d.doc_type === 'hub_image') {
                if (!map['hub_image']) map['hub_image'] = [];
                map['hub_image'].push(d);
              } else {
                map[d.doc_type] = d;
              }
            });
            setExistingDocs(map);
          } catch {}
        }
      } catch (e) { setApiErr(e.message); }
      finally { setLoadingLoc(false); }
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isEdit && hub.state_id) {
      api(`/api/locations/cities?state_id=${hub.state_id}`)
        .then(r => setCities(r.items.filter(c => c.is_active)));
    }
    if (isEdit && hub.city_id) {
      api(`/api/locations/areas?city_id=${hub.city_id}`)
        .then(r => setAreas(r.items.filter(a => a.is_active)));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!form.state_id) { setCities([]); setAreas([]); return; }
    api(`/api/locations/cities?state_id=${form.state_id}`)
      .then(r => setCities(r.items.filter(c => c.is_active)))
      .catch(() => setCities([]));
    if (!hub || String(hub.state_id) !== String(form.state_id)) {
      setForm(f => ({ ...f, city_id: '', area_id: '' }));
    }
  }, [form.state_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!form.city_id) { setAreas([]); return; }
    api(`/api/locations/areas?city_id=${form.city_id}`)
      .then(r => setAreas(r.items.filter(a => a.is_active)))
      .catch(() => setAreas([]));
    if (!hub || String(hub.city_id) !== String(form.city_id)) {
      setForm(f => ({ ...f, area_id: '' }));
    }
  }, [form.city_id]); // eslint-disable-line react-hooks/exhaustive-deps

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }));
    setErrors(e => ({ ...e, [field]: '' }));
  }

  function toggleDay(day) {
    setSelectedDays(prev => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day); else next.add(day);
      const ordered = DAY_OPTS.map(d => d.value).filter(d => next.has(d));
      setForm(f => ({ ...f, working_days: ordered.join(',') }));
      return next;
    });
  }

  async function handleRemoveExisting(docType) {
    const doc = existingDocs[docType];
    if (!doc) return;
    setRemovingDoc(docType);
    try {
      await api(`/api/hubs/${hub.id}/documents/${doc.id}`, { method: 'DELETE' });
      setExistingDocs(d => { const n = { ...d }; delete n[docType]; return n; });
    } catch (err) {
      setApiErr(`Could not remove document: ${err.message}`);
    } finally {
      setRemovingDoc(null);
    }
  }

  async function handleRemoveHubImage(docId) {
    setRemovingDoc(docId);
    try {
      await api(`/api/hubs/${hub.id}/documents/${docId}`, { method: 'DELETE' });
      setExistingDocs(d => ({ ...d, hub_image: (d.hub_image || []).filter(img => img.id !== docId) }));
    } catch (err) {
      setApiErr(`Could not remove image: ${err.message}`);
    } finally {
      setRemovingDoc(null);
    }
  }

  const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

  function validate() {
    const e = {};
    if (!form.hub_name.trim())    e.hub_name        = 'HUB Name is required';
    if (!form.person_name.trim()) e.person_name     = 'Point of Person name is required';
    if (!/^\d{10}$/.test(form.contact_number.trim())) e.contact_number = 'Must be exactly 10 digits';
    if (form.owner_mobile.trim() && !/^\d{10}$/.test(form.owner_mobile.trim())) e.owner_mobile = 'Must be exactly 10 digits';
    if (!form.vehicle_class) e.vehicle_class = 'Vehicle Type is required';
    if (!form.state_id)      e.state_id      = 'State is required';
    if (!form.city_id)       e.city_id       = 'City is required';
    if (!form.area_id)       e.area_id       = 'Area is required';
    if (!form.rm_user_id)    e.rm_user_id    = 'Relationship Manager is required';
    if (form.has_gst && form.gst_number.trim() && !GST_REGEX.test(form.gst_number.trim().toUpperCase())) {
      e.gst_number = 'Invalid GST number (e.g. 27AAPFU0939F1ZV)';
    }
    const svc = parseFloat(form.tech_rate_service);
    if (form.tech_rate_service !== '' && (isNaN(svc) || svc < 0 || svc > 100)) e.tech_rate_service = 'Must be 0–100';
    const pts = parseFloat(form.tech_rate_parts);
    if (form.tech_rate_parts   !== '' && (isNaN(pts) || pts < 0 || pts > 100)) e.tech_rate_parts   = 'Must be 0–100';
    const com = parseFloat(form.commission_percent);
    if (form.commission_percent !== '' && (isNaN(com) || com < 0 || com > 100)) e.commission_percent = 'Must be 0–100';
    const cap = parseInt(form.vehicle_capacity, 10);
    if (form.vehicle_capacity !== '' && (isNaN(cap) || cap < 0)) e.vehicle_capacity = 'Must be 0 or more';
    const area = parseFloat(form.workshop_area_sqft);
    if (form.workshop_area_sqft !== '' && (isNaN(area) || area < 0)) e.workshop_area_sqft = 'Must be 0 or more';
    const mech = parseInt(form.no_of_mechanics, 10);
    if (form.no_of_mechanics !== '' && (isNaN(mech) || mech < 0)) e.no_of_mechanics = 'Must be 0 or more';
    if (form.bank_ifsc.trim() && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.bank_ifsc.trim().toUpperCase())) {
      e.bank_ifsc = 'Invalid IFSC (e.g. HDFC0001234)';
    }
    return e;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setApiErr('');
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    try {
      const payload = {
        hub_name:          form.hub_name.trim(),
        company_name:      form.company_name.trim() || null,
        person_name:       form.person_name.trim(),
        contact_number:    form.contact_number.trim(),
        owner_name:        form.owner_name.trim()   || null,
        owner_mobile:      form.owner_mobile.trim() || null,
        vehicle_class:     form.vehicle_class,
        state_id:          Number(form.state_id),
        city_id:           Number(form.city_id),
        area_id:           Number(form.area_id),
        rm_user_id:        Number(form.rm_user_id),
        is_active:         form.is_active,
        notes:             form.notes.trim() || null,
        open_time:         form.open_time   || null,
        close_time:        form.close_time  || null,
        working_days:      form.working_days || null,
        has_gst:           form.has_gst,
        gst_number:        form.has_gst ? (form.gst_number.trim().toUpperCase() || null) : null,
        tech_rate_service:  form.tech_rate_service  !== '' ? parseFloat(form.tech_rate_service)  : null,
        tech_rate_parts:    form.tech_rate_parts    !== '' ? parseFloat(form.tech_rate_parts)    : null,
        commission_percent: form.commission_percent !== '' ? parseFloat(form.commission_percent) : null,
        payout_terms:        form.payout_terms || 'net_30',
        payout_cycle_days:   form.payout_terms === 'custom' && form.payout_cycle_days !== ''
                               ? parseInt(form.payout_cycle_days, 10) : null,
        bank_account_number: form.bank_account_number.trim() || null,
        bank_ifsc:           form.bank_ifsc.trim().toUpperCase() || null,
        bank_name:           form.bank_name.trim() || null,
        account_holder_name: form.account_holder_name.trim() || null,
        vehicle_capacity:    form.vehicle_capacity    !== '' ? parseInt(form.vehicle_capacity, 10)      : null,
        workshop_area_sqft:  form.workshop_area_sqft  !== '' ? parseFloat(form.workshop_area_sqft)      : null,
        no_of_mechanics:     form.no_of_mechanics     !== '' ? parseInt(form.no_of_mechanics, 10)       : null,
      };

      const r = isEdit
        ? await api(`/api/hubs/${hub.id}`, { method: 'PATCH', body: payload })
        : await api('/api/hubs',           { method: 'POST',  body: payload });

      const hubId = r.item.id;

      // Upload hub images (multiple, up to 5) — compress before sending
      const uploadErrors = [];
      for (const file of (docFiles['hub_image'] || [])) {
        try {
          const compressed = await compressImage(file);
          const fd = new FormData();
          fd.append('doc_type', 'hub_image');
          fd.append('document', compressed);
          await apiUpload(`/api/hubs/${hubId}/documents`, fd);
        } catch (err) {
          uploadErrors.push(`Hub image "${file.name}": ${err.message}`);
        }
      }
      // Upload other documents — compress images, pass PDFs through
      for (const dt of DOC_TYPES.filter(d => d.key !== 'hub_image')) {
        const file = docFiles[dt.key];
        if (!file) continue;
        try {
          const compressed = await compressImage(file);
          const fd = new FormData();
          fd.append('doc_type', dt.key);
          fd.append('document', compressed);
          await apiUpload(`/api/hubs/${hubId}/documents`, fd);
        } catch (err) {
          uploadErrors.push(`${dt.label} "${file.name}": ${err.message}`);
        }
      }

      if (uploadErrors.length) {
        // Hub was saved but some files failed — surface the errors
        setApiErr(`Hub saved, but some files failed to upload:\n${uploadErrors.join('\n')}`);
        setSaving(false);
        return;
      }

      onSaved(r.item);
    } catch (err) {
      setApiErr(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="hb-backdrop" onClick={onClose}>
      <div className="hb-modal" onClick={e => e.stopPropagation()}>
        <div className="hb-modal-hdr">
          <h3>{isEdit ? 'Edit HUB' : 'Add New HUB'}</h3>
          <button className="hb-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <form className="hb-modal-body" onSubmit={handleSubmit} noValidate>
          {loadingLoc && <div className="hb-loading-hint">Loading form data…</div>}

          {/* ── Basic Info ── */}
          <div className="hb-row-2">
            <Field label="HUB Name" req error={errors.hub_name}>
              <input className={`hb-input${errors.hub_name ? ' hb-input--err' : ''}`}
                value={form.hub_name} onChange={e => set('hub_name', e.target.value)}
                placeholder="e.g. Mumbai Central HUB" autoFocus />
            </Field>
            <Field label="Company Name" error={errors.company_name}>
              <input className={`hb-input${errors.company_name ? ' hb-input--err' : ''}`}
                value={form.company_name} onChange={e => set('company_name', e.target.value)}
                placeholder="e.g. ABC Auto Works Pvt. Ltd." />
            </Field>
          </div>

          <div className="hb-row-2">
            <Field label="Owner Name" error={errors.owner_name}>
              <input className={`hb-input${errors.owner_name ? ' hb-input--err' : ''}`}
                value={form.owner_name} onChange={e => set('owner_name', e.target.value)}
                placeholder="Hub owner full name" />
            </Field>
            <Field label="Owner Mobile Number" error={errors.owner_mobile}>
              <input className={`hb-input${errors.owner_mobile ? ' hb-input--err' : ''}`}
                value={form.owner_mobile}
                onChange={e => set('owner_mobile', e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="10-digit mobile number" inputMode="numeric" maxLength={10} />
            </Field>
          </div>

          <div className="hb-row-2">
            <Field label="Point of Person Name" req error={errors.person_name}>
              <input className={`hb-input${errors.person_name ? ' hb-input--err' : ''}`}
                value={form.person_name} onChange={e => set('person_name', e.target.value)}
                placeholder="Full name" />
            </Field>
            <Field label="Point of Contact Number" req error={errors.contact_number}>
              <input className={`hb-input${errors.contact_number ? ' hb-input--err' : ''}`}
                value={form.contact_number}
                onChange={e => set('contact_number', e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="10-digit mobile number" inputMode="numeric" maxLength={10} />
            </Field>
          </div>

          <div className="hb-row-2">
            <Field label="Vehicle Type" req error={errors.vehicle_class}>
              <select className={`hb-input${errors.vehicle_class ? ' hb-input--err' : ''}`}
                value={form.vehicle_class} onChange={e => set('vehicle_class', e.target.value)}>
                <option value="">Select Vehicle Type…</option>
                {VEHICLE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Relationship Manager (RM)" req error={errors.rm_user_id}>
              <select className={`hb-input${errors.rm_user_id ? ' hb-input--err' : ''}`}
                value={form.rm_user_id} onChange={e => set('rm_user_id', e.target.value)}>
                <option value="">Select RM…</option>
                {rmUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
          </div>

          <div className="hb-row-3">
            <Field label="State" req error={errors.state_id}>
              <select className={`hb-input${errors.state_id ? ' hb-input--err' : ''}`}
                value={form.state_id} onChange={e => set('state_id', e.target.value)}>
                <option value="">Select State…</option>
                {states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="City" req error={errors.city_id}>
              <select className={`hb-input${errors.city_id ? ' hb-input--err' : ''}`}
                value={form.city_id} onChange={e => set('city_id', e.target.value)}
                disabled={!form.state_id}>
                <option value="">Select City…</option>
                {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Area" req error={errors.area_id}>
              <select className={`hb-input${errors.area_id ? ' hb-input--err' : ''}`}
                value={form.area_id} onChange={e => set('area_id', e.target.value)}
                disabled={!form.city_id}>
                <option value="">Select Area…</option>
                {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          </div>

          <div className="hb-row-2">
            <Field label="Status">
              <select className="hb-input" value={form.is_active ? 'true' : 'false'}
                onChange={e => set('is_active', e.target.value === 'true')}>
                <option value="true" disabled={isEdit && hub?.verification_status !== 'verified'}>
                  Active{isEdit && hub?.verification_status !== 'verified' ? ' (verify first)' : ''}
                </option>
                <option value="false">Inactive</option>
              </select>
            </Field>
          </div>

          <Field label="Notes">
            <textarea className="hb-input hb-textarea" value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Optional notes…" rows={2} />
          </Field>

          {/* ── Operating Hours ── */}
          <div className="hb-section-sep"><Clock size={12} /> Operating Hours</div>
          <div className="hb-row-2">
            <Field label="Open Time">
              <input type="time" className="hb-input" value={form.open_time}
                onChange={e => set('open_time', e.target.value)} />
            </Field>
            <Field label="Close Time">
              <input type="time" className="hb-input" value={form.close_time}
                onChange={e => set('close_time', e.target.value)} />
            </Field>
          </div>
          <Field label="Working Days">
            <div className="hb-days-wrap">
              {DAY_OPTS.map(d => (
                <label key={d.value}
                  className={`hb-day-chip${selectedDays.has(d.value) ? ' hb-day-chip--on' : ''}`}>
                  <input type="checkbox" style={{ display: 'none' }}
                    checked={selectedDays.has(d.value)}
                    onChange={() => toggleDay(d.value)} />
                  {d.label}
                </label>
              ))}
            </div>
          </Field>

          {/* ── Hub Image ── */}
          {(() => {
            const existingImgs = existingDocs['hub_image'] || [];
            const newImgs = docFiles['hub_image'] || [];
            const totalCount = existingImgs.length + newImgs.length;
            const canAdd = totalCount < 5;
            return (
              <>
                <div className="hb-section-sep"><Image size={12} /> Hub Image <span className="hb-section-opt">(Max 5 images)</span></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 4 }}>
                  {existingImgs.map(img => (
                    <ImgPreviewWrap key={img.id} href={fileHref(img.file_url)} fileName={img.file_name}>
                      <div className="hb-doc-chosen hb-doc-chosen--saved">
                        <FileText size={12} />
                        <a className="hb-doc-fname" href={fileHref(img.file_url)} target="_blank" rel="noreferrer" title={img.file_name}>{img.file_name}</a>
                        <button type="button" className="hb-doc-rm-btn" onClick={() => handleRemoveHubImage(img.id)} disabled={removingDoc === img.id} title="Remove">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </ImgPreviewWrap>
                  ))}
                  {newImgs.map((file, idx) => (
                    <div key={idx} className="hb-doc-chosen hb-doc-chosen--new">
                      <FileText size={12} />
                      <span className="hb-doc-fname">{file.name}</span>
                      <button type="button" className="hb-doc-rm-btn" onClick={() => setDocFiles(d => ({ ...d, hub_image: d.hub_image.filter((_, i) => i !== idx) }))}>
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                  {canAdd ? (
                    <button type="button" className="hb-doc-upload-btn" onClick={() => hubImgRef.current?.click()}>
                      <Upload size={12} /> Add Image ({totalCount}/5)
                    </button>
                  ) : (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Maximum 5 images reached</div>
                  )}
                  <input ref={hubImgRef} type="file" style={{ display: 'none' }} accept="image/*,.pdf"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 15 * 1024 * 1024) {
                        setApiErr(`Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 15 MB.`);
                        e.target.value = '';
                        return;
                      }
                      setApiErr('');
                      setDocFiles(d => {
                        const current = d.hub_image || [];
                        const existCount = (existingDocs['hub_image'] || []).length;
                        if (current.length + existCount >= 5) return d;
                        return { ...d, hub_image: [...current, file] };
                      });
                      e.target.value = '';
                    }} />
                </div>
              </>
            );
          })()}

          {/* ── Operational Details ── */}
          <div className="hb-section-sep">
            <Wrench size={12} /> Workshop &amp; Capacity
            <span className="hb-section-opt">(Optional)</span>
          </div>
          <div className="hb-row-3">
            <Field label="Vehicle Capacity" error={errors.vehicle_capacity}>
              <input type="number" className={`hb-input${errors.vehicle_capacity ? ' hb-input--err' : ''}`}
                value={form.vehicle_capacity}
                onChange={e => set('vehicle_capacity', e.target.value)}
                placeholder="e.g. 5" min="0" step="1" />
            </Field>
            <Field label="Workshop Area (sq ft)" error={errors.workshop_area_sqft}>
              <div className="hb-pct-wrap">
                <input type="number" className={`hb-input${errors.workshop_area_sqft ? ' hb-input--err' : ''}`}
                  value={form.workshop_area_sqft}
                  onChange={e => set('workshop_area_sqft', e.target.value)}
                  placeholder="e.g. 1200" min="0" step="0.01" />
                <span className="hb-pct-symbol">ft²</span>
              </div>
            </Field>
            <Field label="No. of Mechanics" error={errors.no_of_mechanics}>
              <input type="number" className={`hb-input${errors.no_of_mechanics ? ' hb-input--err' : ''}`}
                value={form.no_of_mechanics}
                onChange={e => set('no_of_mechanics', e.target.value)}
                placeholder="e.g. 8" min="0" step="1" />
            </Field>
          </div>

          {/* ── Bank Details ── */}
          <div className="hb-section-sep">
            <CreditCard size={12} /> Bank Details
            <span className="hb-section-opt">(Optional — for payouts)</span>
          </div>
          <div className="hb-row-2">
            <Field label="Account Holder Name" error={errors.account_holder_name}>
              <input className={`hb-input${errors.account_holder_name ? ' hb-input--err' : ''}`}
                value={form.account_holder_name}
                onChange={e => set('account_holder_name', e.target.value)}
                placeholder="Name as on bank account" />
            </Field>
            <Field label="Bank Name / Branch" error={errors.bank_name}>
              <input className={`hb-input${errors.bank_name ? ' hb-input--err' : ''}`}
                value={form.bank_name}
                onChange={e => set('bank_name', e.target.value)}
                placeholder="e.g. HDFC Bank, Andheri Branch" />
            </Field>
          </div>
          <div className="hb-row-2">
            <Field label="Account Number" error={errors.bank_account_number}>
              <input className={`hb-input${errors.bank_account_number ? ' hb-input--err' : ''}`}
                value={form.bank_account_number}
                onChange={e => set('bank_account_number', e.target.value.replace(/\D/g, '').slice(0, 20))}
                placeholder="e.g. 0012345678901" inputMode="numeric" />
            </Field>
            <Field label="IFSC Code" error={errors.bank_ifsc}>
              <input className={`hb-input${errors.bank_ifsc ? ' hb-input--err' : ''}`}
                value={form.bank_ifsc}
                onChange={e => set('bank_ifsc', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))}
                placeholder="e.g. HDFC0001234" maxLength={11} />
            </Field>
          </div>
          <div className="hb-doc-grid" style={{ marginTop: 6 }}>
            <DocSlot
              label="Bank Proof (Cancelled Cheque / Passbook)"
              existing={existingDocs['bank_proof'] || null}
              selected={docFiles['bank_proof']}
              removing={removingDoc === 'bank_proof'}
              onSelect={file => setDocFiles(d => ({ ...d, bank_proof: file }))}
              onClearSelected={() => setDocFiles(d => ({ ...d, bank_proof: null }))}
              onRemoveExisting={() => handleRemoveExisting('bank_proof')}
            />
          </div>

          {/* ── GST ── */}
          <div className="hb-section-sep"><FileText size={12} /> GST Details</div>
          <div className="hb-gst-toggle-row">
            <div>
              <div className="hb-toggle-title">Has GST Registration?</div>
              <div className="hb-toggle-hint">Enable if this hub is GST registered</div>
            </div>
            <button
              type="button"
              className={`hb-gst-toggle${form.has_gst ? ' hb-gst-toggle--on' : ''}`}
              onClick={() => {
                const next = !form.has_gst;
                setForm(f => ({ ...f, has_gst: next, gst_number: next ? f.gst_number : '' }));
                setErrors(e => ({ ...e, gst_number: '' }));
              }}
            >
              {form.has_gst
                ? <><ToggleRight size={20} /> Registered</>
                : <><ToggleLeft  size={20} /> Not Registered</>}
            </button>
          </div>

          {form.has_gst && (
            <Field label="GST Number" error={errors.gst_number}>
              <input className={`hb-input${errors.gst_number ? ' hb-input--err' : ''}`}
                value={form.gst_number}
                onChange={e => set('gst_number', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15))}
                placeholder="e.g. 27AAPFU0939F1ZV"
                maxLength={15} />
            </Field>
          )}

          {/* ── Tech Commission Rate ── */}
          <div className="hb-section-sep">
            <Percent size={12} /> Tech Commission Rate
            <span className="hb-section-opt">(Optional — your % on this hub)</span>
          </div>
          <div className="hb-row-2">
            <Field label="Service Commission %" error={errors.tech_rate_service}>
              <div className="hb-pct-wrap">
                <input type="number" className={`hb-input${errors.tech_rate_service ? ' hb-input--err' : ''}`}
                  value={form.tech_rate_service}
                  onChange={e => set('tech_rate_service', e.target.value)}
                  placeholder="e.g. 10.5" min="0" max="100" step="0.01" />
                <span className="hb-pct-symbol">%</span>
              </div>
            </Field>
            <Field label="Parts Commission %" error={errors.tech_rate_parts}>
              <div className="hb-pct-wrap">
                <input type="number" className={`hb-input${errors.tech_rate_parts ? ' hb-input--err' : ''}`}
                  value={form.tech_rate_parts}
                  onChange={e => set('tech_rate_parts', e.target.value)}
                  placeholder="e.g. 8" min="0" max="100" step="0.01" />
                <span className="hb-pct-symbol">%</span>
              </div>
            </Field>
          </div>

          {/* ── Spinoto Commission Rate ── */}
          <div className="hb-section-sep">
            <Percent size={12} /> Spinoto Commission
            <span className="hb-section-opt">(Optional — Spinoto's % take on invoices)</span>
          </div>
          <div className="hb-row-2">
            <Field label="Commission %" error={errors.commission_percent}>
              <div className="hb-pct-wrap">
                <input type="number" className={`hb-input${errors.commission_percent ? ' hb-input--err' : ''}`}
                  value={form.commission_percent}
                  onChange={e => set('commission_percent', e.target.value)}
                  placeholder="e.g. 15" min="0" max="100" step="0.01" />
                <span className="hb-pct-symbol">%</span>
              </div>
            </Field>
          </div>

          {/* ── Payout Terms ── */}
          <div className="hb-section-sep">
            <Clock size={12} /> Payout Terms
            <span className="hb-section-opt">(When does this hub get paid?)</span>
          </div>
          <div className="hb-row-2">
            <Field label="Payout Schedule" req error={errors.payout_terms}>
              <select className="hb-input" value={form.payout_terms}
                onChange={e => set('payout_terms', e.target.value)}>
                {PAYOUT_TERMS_OPTS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            {form.payout_terms === 'custom' && (
              <Field label="Custom Days" req error={errors.payout_cycle_days}>
                <input type="number" className={`hb-input${errors.payout_cycle_days ? ' hb-input--err' : ''}`}
                  value={form.payout_cycle_days}
                  onChange={e => set('payout_cycle_days', e.target.value)}
                  placeholder="e.g. 45" min="1" max="3650" />
              </Field>
            )}
          </div>

          {/* ── KYC Documents ── */}
          <div className="hb-section-sep">
            <Upload size={12} /> KYC Documents
            <span className="hb-section-opt">(All optional · PDF, JPG, PNG · max 2 MB · images auto-compressed)</span>
          </div>
          <div className="hb-doc-grid">
            {DOC_TYPES
              .filter(dt => !['hub_image','bank_proof'].includes(dt.key))
              .map(dt => (
                <DocSlot
                  key={dt.key}
                  label={dt.label}
                  existing={existingDocs[dt.key] || null}
                  selected={docFiles[dt.key]}
                  removing={removingDoc === dt.key}
                  onSelect={file => setDocFiles(d => ({ ...d, [dt.key]: file }))}
                  onClearSelected={() => setDocFiles(d => ({ ...d, [dt.key]: null }))}
                  onRemoveExisting={() => handleRemoveExisting(dt.key)}
                />
              ))}
          </div>
        </form>

        {apiErr && (
          <div className="hb-err" style={{ margin: '0 20px 8px', borderRadius: 8 }}>
            <AlertCircle size={13} /> {apiErr}
          </div>
        )}
        <div className="hb-modal-ftr">
          <button className="button secondary" type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="button primary" onClick={handleSubmit} disabled={saving || loadingLoc}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add HUB'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── View Modal ────────────────────────────────────────────────────────────────
function ViewModal({ hub: initialHub, onClose, onEdit, canManage, canVerify, onHubUpdated }) {
  const { user: me } = useAuth();
  const isSuperAdmin = me?.is_super_admin;

  const [hub, setHub]           = useState(initialHub);
  const [verifyErr, setVerifyErr] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason]     = useState('');

  async function handleVerify() {
    setVerifyErr(''); setVerifyBusy(true);
    try {
      await api(`/api/hubs/${hub.id}/verify`, { method: 'PATCH' });
      const updated = { ...hub, verification_status: 'verified', rejection_reason: null };
      setHub(updated);
      onHubUpdated?.(updated);
    } catch (e) { setVerifyErr(e.message); }
    finally { setVerifyBusy(false); }
  }

  async function handleReject(e) {
    e.preventDefault();
    if (!rejectReason.trim()) { setVerifyErr('Please enter a rejection reason'); return; }
    setVerifyErr(''); setVerifyBusy(true);
    try {
      await api(`/api/hubs/${hub.id}/reject`, { method: 'PATCH', body: { reason: rejectReason.trim() } });
      const updated = { ...hub, verification_status: 'rejected', rejection_reason: rejectReason.trim(), is_active: false };
      setHub(updated);
      onHubUpdated?.(updated);
      setShowRejectForm(false);
      setRejectReason('');
    } catch (e) { setVerifyErr(e.message); }
    finally { setVerifyBusy(false); }
  }

  const cats = hub.category_names_preview ? hub.category_names_preview.split(', ').filter(Boolean) : [];
  const svcs = hub.service_names_preview  ? hub.service_names_preview.split(', ').filter(Boolean)  : [];

  const [docs, setDocs] = useState([]);
  useEffect(() => {
    api(`/api/hubs/${hub.id}/documents`)
      .then(r => setDocs(r.items))
      .catch(() => {});
  }, [hub.id]);

  // Hub login state
  const [hubLogin, setHubLogin]             = useState(null);   // null = loading, false = no login
  const [loginLoading, setLoginLoading]     = useState(true);
  const [showLoginForm, setShowLoginForm]   = useState(false);
  const [loginForm, setLoginForm]           = useState({ name: '', email: '', password: '' });
  const [loginSaving, setLoginSaving]       = useState(false);
  const [loginMsg, setLoginMsg]             = useState('');
  const [loginErr, setLoginErr]             = useState('');

  useEffect(() => {
    if (!isSuperAdmin) return;
    api(`/api/hubs/${hub.id}/login`)
      .then(r => setHubLogin(r.login || false))
      .catch(() => setHubLogin(false))
      .finally(() => setLoginLoading(false));
  }, [hub.id, isSuperAdmin]);

  async function handleCreateLogin(e) {
    e.preventDefault();
    setLoginErr(''); setLoginMsg('');
    if (!loginForm.name || !loginForm.email || !loginForm.password) {
      setLoginErr('All fields are required'); return;
    }
    setLoginSaving(true);
    try {
      const r = await api(`/api/hubs/${hub.id}/login`, { method: 'POST', body: loginForm });
      setHubLogin(r.user);
      setShowLoginForm(false);
      setLoginMsg('Login created successfully');
      setLoginForm({ name: '', email: '', password: '' });
    } catch (err) {
      setLoginErr(err.message || 'Failed to create login');
    } finally {
      setLoginSaving(false);
    }
  }

  async function handleDeleteLogin() {
    if (!window.confirm('Remove this hub login? The hub owner will no longer be able to log in.')) return;
    setLoginSaving(true);
    try {
      await api(`/api/hubs/${hub.id}/login`, { method: 'DELETE' });
      setHubLogin(false);
      setLoginMsg('Hub login removed');
    } catch (err) {
      setLoginErr(err.message || 'Failed to remove login');
    } finally {
      setLoginSaving(false);
    }
  }

  return (
    <div className="hb-backdrop" onClick={onClose}>
      <div className="hb-modal hb-modal--view" onClick={e => e.stopPropagation()}>

        <div className="hbv-hdr">
          <div className="hbv-hdr-icon"><Network size={20} /></div>
          <div className="hbv-hdr-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="hbv-hdr-name">{hub.hub_name}</div>
              {hub.hub_code && (
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', background: 'color-mix(in srgb, var(--primary) 10%, var(--bg))', padding: '2px 8px', borderRadius: 99 }}>{hub.hub_code}</span>
              )}
            </div>
            <div className="hbv-hdr-badges">
              <VehicleBadge value={hub.vehicle_class} />
              <StatusBadge active={hub.is_active} />
              <VerificationBadge status={hub.verification_status} />
              {hub.has_gst && <span className="hbv-gst-badge">GST Registered</span>}
            </div>
          </div>
          <button className="hb-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="hbv-body">

          {/* ── Verification Panel ── */}
          {hub.verification_status === 'rejected' && hub.rejection_reason && (
            <div className="hbv-rejection-banner">
              <AlertCircle size={14} />
              <div>
                <strong>Rejected:</strong> {hub.rejection_reason}
                {canManage && <span style={{ marginLeft: 8, fontSize: 11, color: '#6b7280' }}>Edit the hub to resubmit for review.</span>}
              </div>
            </div>
          )}

          {canVerify && hub.verification_status !== 'verified' && (
            <div className="hbv-verify-panel">
              <div className="hbv-verify-info">
                <strong>Hub requires verification</strong>
                <span>Review the details below and approve or reject this hub.</span>
              </div>
              <div className="hbv-verify-actions">
                {verifyErr && <span className="hbv-verify-err"><AlertCircle size={12}/> {verifyErr}</span>}
                {!showRejectForm ? (
                  <>
                    <button className="hbv-btn-verify" onClick={handleVerify} disabled={verifyBusy}>
                      {verifyBusy ? 'Verifying…' : '✓ Verify Hub'}
                    </button>
                    <button className="hbv-btn-reject" onClick={() => { setShowRejectForm(true); setVerifyErr(''); }} disabled={verifyBusy}>
                      ✕ Reject
                    </button>
                  </>
                ) : (
                  <form className="hbv-reject-form" onSubmit={handleReject}>
                    <textarea
                      className="hb-input hb-textarea"
                      rows={2}
                      placeholder="Enter reason for rejection…"
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      autoFocus
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <button type="submit" className="hbv-btn-reject" disabled={verifyBusy}>
                        {verifyBusy ? 'Rejecting…' : 'Confirm Rejection'}
                      </button>
                      <button type="button" className="button secondary" style={{ fontSize: 12, padding: '5px 12px' }}
                        onClick={() => { setShowRejectForm(false); setRejectReason(''); setVerifyErr(''); }}>
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}

          {canVerify && hub.verification_status === 'verified' && (
            <div className="hbv-verified-banner">
              <CheckCircle2 size={14} />
              <span>Verified{hub.verified_by_name ? ` by ${hub.verified_by_name}` : ''}{hub.verified_at ? ` on ${fmtDate(hub.verified_at)}` : ''}</span>
              {hub.verification_status === 'verified' && (
                <button className="hbv-btn-re-reject" onClick={() => { setShowRejectForm(true); setVerifyErr(''); }}>
                  Re-reject
                </button>
              )}
              {showRejectForm && (
                <form className="hbv-reject-form" style={{ marginTop: 8, width: '100%' }} onSubmit={handleReject}>
                  <textarea className="hb-input hb-textarea" rows={2} placeholder="Enter reason for rejection…"
                    value={rejectReason} onChange={e => setRejectReason(e.target.value)} autoFocus />
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <button type="submit" className="hbv-btn-reject" disabled={verifyBusy}>{verifyBusy ? 'Rejecting…' : 'Confirm Rejection'}</button>
                    <button type="button" className="button secondary" style={{ fontSize: 12, padding: '5px 12px' }}
                      onClick={() => { setShowRejectForm(false); setRejectReason(''); setVerifyErr(''); }}>Cancel</button>
                  </div>
                </form>
              )}
            </div>
          )}

          <div className="hbv-section">
            <div className="hbv-section-title">Ownership &amp; Contact</div>
            <div className="hbv-grid2">
              {hub.company_name && (
                <div className="hbv-field" style={{ gridColumn: '1 / -1' }}>
                  <span className="hbv-lbl">Company Name</span>
                  <span className="hbv-val">{hub.company_name}</span>
                </div>
              )}
              <div className="hbv-field"><span className="hbv-lbl">Owner Name</span><span className="hbv-val">{hub.owner_name || <span className="hbv-nil">—</span>}</span></div>
              <div className="hbv-field"><span className="hbv-lbl">Owner Mobile</span><span className="hbv-val">{hub.owner_mobile || <span className="hbv-nil">—</span>}</span></div>
              <div className="hbv-field"><span className="hbv-lbl">Point of Person</span><span className="hbv-val">{hub.person_name}</span></div>
              <div className="hbv-field"><span className="hbv-lbl">Point of Contact</span><span className="hbv-val">{hub.contact_number}</span></div>
            </div>
          </div>

          <div className="hbv-section">
            <div className="hbv-section-title">Location</div>
            <div className="hbv-grid3">
              <div className="hbv-field"><span className="hbv-lbl">State</span><span className="hbv-val">{hub.state_name}</span></div>
              <div className="hbv-field"><span className="hbv-lbl">City</span><span className="hbv-val">{hub.city_name}</span></div>
              <div className="hbv-field"><span className="hbv-lbl">Area</span><span className="hbv-val">{hub.area_name}</span></div>
            </div>
          </div>

          <div className="hbv-section">
            <div className="hbv-section-title">Relationship Manager</div>
            <div className="hbv-rm-card">
              <div className="hbv-rm-av">{(hub.rm_name || 'R')[0].toUpperCase()}</div>
              <div>
                <div className="hbv-rm-name">{hub.rm_name}</div>
                {hub.rm_mobile && <div className="hbv-rm-mobile">{hub.rm_mobile}</div>}
              </div>
            </div>
          </div>

          {/* GST & Take Rates */}
          {(hub.has_gst || hub.tech_rate_service != null || hub.tech_rate_parts != null || hub.commission_percent != null) && (
            <div className="hbv-section">
              <div className="hbv-section-title"><FileText size={11} /> Business Details</div>
              <div className="hbv-grid2">
                {hub.has_gst && (
                  <div className="hbv-field">
                    <span className="hbv-lbl">GST Number</span>
                    <span className="hbv-val">{hub.gst_number || <span className="hbv-nil">—</span>}</span>
                  </div>
                )}
                {hub.tech_rate_service != null && (
                  <div className="hbv-field">
                    <span className="hbv-lbl">Service Commission</span>
                    <span className="hbv-val hbv-rate">{hub.tech_rate_service}%</span>
                  </div>
                )}
                {hub.tech_rate_parts != null && (
                  <div className="hbv-field">
                    <span className="hbv-lbl">Parts Commission</span>
                    <span className="hbv-val hbv-rate">{hub.tech_rate_parts}%</span>
                  </div>
                )}
                {hub.commission_percent != null && (
                  <div className="hbv-field">
                    <span className="hbv-lbl">Spinoto Commission</span>
                    <span className="hbv-val hbv-rate">{hub.commission_percent}%</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {(hub.bank_name || hub.bank_account_number || hub.bank_ifsc || hub.account_holder_name) && (
            <div className="hbv-section">
              <div className="hbv-section-title"><CreditCard size={11} /> Bank Details</div>
              <div className="hbv-grid2">
                {hub.account_holder_name && (
                  <div className="hbv-field"><span className="hbv-lbl">Account Holder</span><span className="hbv-val">{hub.account_holder_name}</span></div>
                )}
                {hub.bank_name && (
                  <div className="hbv-field"><span className="hbv-lbl">Bank / Branch</span><span className="hbv-val">{hub.bank_name}</span></div>
                )}
                {hub.bank_account_number && (
                  <div className="hbv-field"><span className="hbv-lbl">Account Number</span><span className="hbv-val">{hub.bank_account_number}</span></div>
                )}
                {hub.bank_ifsc && (
                  <div className="hbv-field"><span className="hbv-lbl">IFSC Code</span><span className="hbv-val">{hub.bank_ifsc}</span></div>
                )}
                {hub.payout_terms && (
                  <div className="hbv-field"><span className="hbv-lbl">Payout Terms</span><span className="hbv-val">{PAYOUT_TERMS_OPTS.find(o => o.value === hub.payout_terms)?.label || hub.payout_terms}{hub.payout_terms === 'custom' && hub.payout_cycle_days ? ` (${hub.payout_cycle_days} days)` : ''}</span></div>
                )}
              </div>
            </div>
          )}

          <div className="hbv-section">
            <div className="hbv-section-title">
              Services Assigned
              {hub.total_categories > 0 && (
                <span className="hbv-svc-pills">
                  <span className="hbv-pill hbv-pill--cat">{hub.total_categories} {hub.total_categories === 1 ? 'category' : 'categories'}</span>
                  <span className="hbv-pill hbv-pill--svc">{hub.total_services} {hub.total_services === 1 ? 'service' : 'services'}</span>
                </span>
              )}
            </div>
            {hub.total_categories > 0 ? (
              <>
                {cats.length > 0 && <div className="hbv-cat-chips">{cats.map(c => <span key={c} className="hbv-cat-chip">{c}</span>)}</div>}
                {svcs.length > 0 && <div className="hbv-svc-tags">{svcs.map(s => <span key={s} className="hbv-svc-tag">{s}</span>)}</div>}
              </>
            ) : (
              <div className="hbv-no-svc">No services assigned yet</div>
            )}
          </div>

          {(hub.open_time || hub.close_time || hub.working_days) && (
            <div className="hbv-section">
              <div className="hbv-section-title"><Clock size={11} /> Operating Hours</div>
              <div className="hbv-grid2" style={{ marginBottom: hub.working_days ? 14 : 0 }}>
                <div className="hbv-field"><span className="hbv-lbl">Open Time</span><span className="hbv-val">{fmtTime(hub.open_time)}</span></div>
                <div className="hbv-field"><span className="hbv-lbl">Close Time</span><span className="hbv-val">{fmtTime(hub.close_time)}</span></div>
              </div>
              {hub.working_days && (
                <div className="hbv-field">
                  <span className="hbv-lbl" style={{ marginBottom: 6 }}>Working Days</span>
                  <div className="hbv-days-chips">
                    {hub.working_days.split(',').map(d => <span key={d} className="hbv-day-chip">{d.trim()}</span>)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Hub Image */}
          {docs.filter(d => d.doc_type === 'hub_image').length > 0 && (
            <div className="hbv-section">
              <div className="hbv-section-title"><Image size={11} /> Hub Image</div>
              <div className="hbv-docs-list">
                {docs.filter(d => d.doc_type === 'hub_image').map(doc => (
                  <ImgPreviewWrap key={doc.id} href={fileHref(doc.file_url)} fileName={doc.file_name}>
                    <a className="hbv-doc-item"
                      href={fileHref(doc.file_url)}
                      target="_blank" rel="noreferrer">
                      <Image size={13} />
                      <div>
                        <div className="hbv-doc-type">Hub Image</div>
                        <div className="hbv-doc-name">{doc.file_name}</div>
                      </div>
                    </a>
                  </ImgPreviewWrap>
                ))}
              </div>
            </div>
          )}

          {/* KYC Documents */}
          {docs.filter(d => d.doc_type !== 'hub_image').length > 0 && (
            <div className="hbv-section">
              <div className="hbv-section-title"><FileText size={11} /> Documents</div>
              <div className="hbv-docs-list">
                {docs.filter(d => d.doc_type !== 'hub_image').map(doc => {
                  const dtConf = DOC_TYPES.find(dt => dt.key === doc.doc_type);
                  return (
                    <ImgPreviewWrap key={doc.id} href={fileHref(doc.file_url)} fileName={doc.file_name}>
                      <a className="hbv-doc-item"
                        href={fileHref(doc.file_url)}
                        target="_blank" rel="noreferrer">
                        <FileText size={13} />
                        <div>
                          <div className="hbv-doc-type">{dtConf?.label || doc.doc_type}</div>
                          <div className="hbv-doc-name">{doc.file_name}</div>
                        </div>
                      </a>
                    </ImgPreviewWrap>
                  );
                })}
              </div>
            </div>
          )}

          {hub.notes && (
            <div className="hbv-section">
              <div className="hbv-section-title">Notes</div>
              <p className="hbv-notes-text">{hub.notes}</p>
            </div>
          )}

          {/* Hub Login (super admin only) */}
          {isSuperAdmin && (
            <div className="hbv-section" style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 4 }}>
              <div className="hbv-section-title" style={{ marginBottom: 10 }}>
                <Lock size={11} /> Hub Login
              </div>

              {loginMsg && <div style={{ fontSize: 12, color: '#10b981', marginBottom: 8, fontWeight: 500 }}>{loginMsg}</div>}
              {loginErr && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{loginErr}</div>}

              {loginLoading ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Checking…</div>
              ) : hubLogin ? (
                /* Login exists — show info + remove button */
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#065f46', marginBottom: 2 }}>Login active</div>
                  <div style={{ fontSize: 12, color: '#047857' }}>{hubLogin.email}</div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                    Created {fmtDate(hubLogin.created_at)} · {hubLogin.is_active ? 'Active' : 'Disabled'}
                  </div>
                  <button
                    onClick={handleDeleteLogin}
                    disabled={loginSaving}
                    style={{ marginTop: 10, fontSize: 12, color: '#ef4444', background: 'none', border: '1px solid #fca5a5', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 500 }}
                  >
                    {loginSaving ? 'Removing…' : 'Remove Login'}
                  </button>
                </div>
              ) : showLoginForm ? (
                /* Create form */
                <form onSubmit={handleCreateLogin} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { key: 'name',     label: 'Contact Name',  type: 'text',     placeholder: hub.person_name || 'Hub owner name' },
                    { key: 'email',    label: 'Login Email',   type: 'email',    placeholder: 'hub@example.com' },
                    { key: 'password', label: 'Password',      type: 'password', placeholder: 'Min. 6 characters' },
                  ].map(f => (
                    <div key={f.key}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>{f.label}</label>
                      <input
                        type={f.type}
                        placeholder={f.placeholder}
                        value={loginForm[f.key]}
                        onChange={e => setLoginForm(v => ({ ...v, [f.key]: e.target.value }))}
                        style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }}
                      />
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button type="submit" disabled={loginSaving} style={{ flex: 1, padding: '7px', borderRadius: 6, border: 'none', background: '#0891b2', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      {loginSaving ? 'Creating…' : 'Create Login'}
                    </button>
                    <button type="button" onClick={() => { setShowLoginForm(false); setLoginErr(''); }} style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                /* No login yet */
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>No login set up for this hub yet.</div>
                  <button
                    onClick={() => { setShowLoginForm(true); setLoginErr(''); setLoginMsg(''); }}
                    style={{ fontSize: 13, fontWeight: 600, color: '#fff', background: '#0891b2', border: 'none', borderRadius: 7, padding: '7px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    + Create Login
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="hbv-meta">
            Created {fmtDate(hub.created_at)}
            {hub.created_by_name && <> · {hub.created_by_name}</>}
          </div>
        </div>

        <div className="hb-modal-ftr">
          <button className="button secondary" onClick={onClose}>Close</button>
          {canManage && (
            <button className="button primary" onClick={onEdit}>
              <Pencil size={14} /> Edit HUB
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DR({ label, value, full }) {
  return (
    <div className={`hb-detail-row${full ? ' hb-detail-row--full' : ''}`}>
      <span className="hb-detail-label">{label}</span>
      <span className="hb-detail-value">{value}</span>
    </div>
  );
}

// ── Hub Services Modal ────────────────────────────────────────────────────────
function HubServicesModal({ hub, onClose, onSaved }) {
  const [data, setData]                   = useState(null);
  const [selectedCatIds, setSelectedCatIds] = useState(new Set());
  const [selectedSvcIds, setSelectedSvcIds] = useState(new Set());
  const [svcCatMap, setSvcCatMap]         = useState({});
  const [search, setSearch]               = useState('');
  const [collapsed, setCollapsed]         = useState({});
  const [saving, setSaving]               = useState(false);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState('');
  const [saveErr, setSaveErr]             = useState('');

  useEffect(() => {
    setLoading(true);
    api(`/api/hubs/${hub.id}/services`)
      .then(res => {
        setData(res);
        const catIds = new Set(res.categories.filter(c => c.category_mapped).map(c => c.id));
        const svcIds = new Set();
        const map = {};
        for (const cat of res.categories) {
          for (const svc of cat.services) {
            if (svc.service_mapped) svcIds.add(svc.service_id);
            map[svc.service_id] = cat.id;
          }
        }
        setSelectedCatIds(catIds);
        setSelectedSvcIds(svcIds);
        setSvcCatMap(map);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [hub.id]);

  function toggleCat(catId) {
    const cat = data?.categories.find(c => c.id === catId);
    setSelectedCatIds(prev => {
      const next = new Set(prev);
      if (next.has(catId)) {
        next.delete(catId);
        if (cat) {
          setSelectedSvcIds(s => {
            const ns = new Set(s);
            cat.services.forEach(svc => ns.delete(svc.service_id));
            return ns;
          });
        }
      } else { next.add(catId); }
      return next;
    });
  }

  function toggleSvc(svcId, catId) {
    setSvcCatMap(m => ({ ...m, [svcId]: catId }));
    setSelectedSvcIds(prev => {
      const next = new Set(prev);
      if (next.has(svcId)) next.delete(svcId); else next.add(svcId);
      return next;
    });
  }

  function catSelectAll(cat) {
    const visible = cat.services.filter(s => matchesSearch(s.name));
    setSvcCatMap(m => { const nm = { ...m }; visible.forEach(s => { nm[s.service_id] = cat.id; }); return nm; });
    setSelectedCatIds(prev => { const n = new Set(prev); n.add(cat.id); return n; });
    setSelectedSvcIds(prev => { const n = new Set(prev); visible.forEach(s => n.add(s.service_id)); return n; });
  }

  function catClearAll(cat) {
    const visible = cat.services.filter(s => matchesSearch(s.name));
    setSelectedSvcIds(prev => { const n = new Set(prev); visible.forEach(s => n.delete(s.service_id)); return n; });
  }

  function globalSelectAll() {
    if (!data) return;
    const map = {}; const svcIds = new Set(); const catIds = new Set();
    for (const cat of data.categories) {
      for (const svc of cat.services) {
        if (!matchesSearch(svc.name)) continue;
        catIds.add(cat.id); svcIds.add(svc.service_id); map[svc.service_id] = cat.id;
      }
    }
    setSelectedCatIds(prev => new Set([...prev, ...catIds]));
    setSelectedSvcIds(svcIds);
    setSvcCatMap(m => ({ ...m, ...map }));
  }

  function globalClearAll() { setSelectedCatIds(new Set()); setSelectedSvcIds(new Set()); }

  function matchesSearch(name) {
    if (!search.trim()) return true;
    return name.toLowerCase().includes(search.toLowerCase().trim());
  }

  const activeCats    = data?.categories.filter(c => selectedCatIds.has(c.id)) || [];
  const selectedCount = selectedSvcIds.size;

  async function handleSave() {
    setSaveErr('');
    if (selectedCatIds.size === 0) { setSaveErr('Please select at least one category.'); return; }
    if (selectedSvcIds.size  === 0) { setSaveErr('Please select at least one service.');  return; }
    setSaving(true);
    try {
      const category_ids = [...selectedCatIds];
      const services = [...selectedSvcIds].map(svcId => ({
        service_id:  Number(svcId),
        category_id: svcCatMap[svcId],
      }));
      const r = await api(`/api/hubs/${hub.id}/services`, { method: 'PUT', body: { category_ids, services } });
      onSaved(r);
    } catch (e) { setSaveErr(e.message); setSaving(false); }
  }

  return (
    <div className="hb-backdrop" onClick={onClose}>
      <div className="hb-modal hb-modal--services" onClick={e => e.stopPropagation()}>
        <div className="hb-modal-hdr">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="hb-avatar"><Layers size={18} /></div>
            <div>
              <h3 style={{ margin: 0, fontSize: 15 }}>Manage Services</h3>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                {hub.hub_name} · <VehicleBadge value={hub.vehicle_class} />
              </div>
            </div>
          </div>
          <button className="hb-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        {loading ? (
          <div className="hb-modal-body" style={{ gap: 10 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="hb-skel" style={{ height: 18, borderRadius: 6, width: `${55 + (i % 4) * 10}%` }} />
            ))}
          </div>
        ) : error ? (
          <div className="hb-modal-body">
            <div className="hb-err"><AlertCircle size={13} /> {error}</div>
          </div>
        ) : (
          <>
            <div className="hsm-cat-panel">
              <div className="hsm-panel-hdr">
                <div className="hsm-step-row">
                  <span className="hsm-step-num">1</span>
                  <div>
                    <div className="hsm-step-ttl">Select Categories <span className="hsm-panel-badge">{selectedCatIds.size} selected</span></div>
                    <div className="hsm-panel-hint">Choose the service categories this HUB handles</div>
                  </div>
                </div>
              </div>
              {data.categories.length === 0 ? (
                <div style={{ padding: '12px 20px', fontSize: 12, color: 'var(--text-muted)' }}>No categories available for this vehicle type.</div>
              ) : (
                <div className="hsm-cat-chips-wrap">
                  {data.categories.map(cat => (
                    <label key={cat.id} className={`hsm-cat-chip${selectedCatIds.has(cat.id) ? ' hsm-cat-chip--on' : ''}`}>
                      <input type="checkbox" style={{ display: 'none' }} checked={selectedCatIds.has(cat.id)} onChange={() => toggleCat(cat.id)} />
                      <div className={`hsm-chk hsm-chk--sm${selectedCatIds.has(cat.id) ? ' hsm-chk--on' : ''}`} />
                      <span>{cat.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="hsm-toolbar">
              <div className="hsm-step-row">
                <span className="hsm-step-num">2</span>
                <span className="hsm-step-ttl">Assign Services</span>
              </div>
              <div className="hb-search-wrap" style={{ flex: 1, maxWidth: 260 }}>
                <Search size={13} className="hb-search-icon" />
                <input className="hb-search" placeholder="Search services…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                <button className="hsm-global-btn hsm-global-btn--select" onClick={globalSelectAll}>Select All</button>
                <button className="hsm-global-btn hsm-global-btn--clear"  onClick={globalClearAll}>Clear All</button>
              </div>
            </div>

            <div className="hb-modal-body hsm-body">
              {saveErr && <div className="hb-err"><AlertCircle size={13} /> {saveErr}</div>}
              {activeCats.length === 0 ? (
                <div className="hsm-empty">
                  <Layers size={36} style={{ opacity: .2, marginBottom: 10 }} />
                  <div style={{ fontWeight: 600 }}>No categories selected</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Select one or more categories above to assign services.</div>
                </div>
              ) : (
                activeCats.map(cat => {
                  const allSvcs   = cat.services;
                  const visible   = search.trim() ? allSvcs.filter(s => matchesSearch(s.name)) : allSvcs;
                  const selInCat  = allSvcs.filter(s => selectedSvcIds.has(s.service_id)).length;
                  const allSelVis = visible.length > 0 && visible.every(s => selectedSvcIds.has(s.service_id));
                  const anySelVis = visible.some(s => selectedSvcIds.has(s.service_id));
                  const isOpen    = !collapsed[cat.id];
                  if (visible.length === 0 && search.trim()) return null;
                  return (
                    <div key={cat.id} className="hsm-cat">
                      <div className="hsm-cat-hdr">
                        <div className={`hsm-chk${allSelVis ? ' hsm-chk--on' : anySelVis ? ' hsm-chk--partial' : ''}`}
                          onClick={() => allSelVis ? catClearAll(cat) : catSelectAll(cat)} />
                        <span className="hsm-cat-name"
                          onClick={() => setCollapsed(c => ({ ...c, [cat.id]: !c[cat.id] }))}>{cat.name}</span>
                        <span className="hsm-cat-count">
                          <span className={selInCat === allSvcs.length && allSvcs.length > 0 ? 'hsm-count-full' : ''}>{selInCat}</span>
                          <span className="hsm-count-sep">/</span>{allSvcs.length}
                        </span>
                        <button className="hsm-sel-all-btn" onClick={() => catSelectAll(cat)}>All</button>
                        <button className="hsm-sel-all-btn hsm-sel-all-btn--clear" onClick={() => catClearAll(cat)}>Clear</button>
                        <button className="hb-icon-btn" style={{ padding: 4 }}
                          onClick={() => setCollapsed(c => ({ ...c, [cat.id]: !c[cat.id] }))}>
                          {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </div>
                      {isOpen && (
                        <div className="hsm-svc-list">
                          {visible.map(svc => {
                            const isOn = selectedSvcIds.has(svc.service_id);
                            return (
                              <div key={svc.service_id}
                                className={`hsm-svc-row${isOn ? ' hsm-svc-row--on' : ''}`}
                                onClick={() => toggleSvc(svc.service_id, cat.id)}>
                                <div className={`hsm-chk${isOn ? ' hsm-chk--on' : ''}`} />
                                <span className="hsm-svc-name">{svc.name}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        <div className="hb-modal-ftr" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--text)' }}>{selectedCount}</strong> service{selectedCount !== 1 ? 's' : ''}
            {selectedCatIds.size > 0 && (
              <> across <strong style={{ color: 'var(--text)' }}>{selectedCatIds.size}</strong> categor{selectedCatIds.size !== 1 ? 'ies' : 'y'}</>
            )}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="button primary" onClick={handleSave} disabled={saving || loading}>
              {saving ? 'Saving…' : 'Save Services'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function HubsPage() {
  const { user: currentUser } = useAuth();
  const canCreate  = useCan('CREATE_HUB',  'MANAGE_HUBS');
  const canEdit    = useCan('EDIT_HUB',    'MANAGE_HUBS');
  const canVerify  = useCan('VERIFY_HUB',  'MANAGE_HUBS') || currentUser?.is_super_admin;

  const [hubs, setHubs]                   = useState([]);
  const [total, setTotal]                 = useState(0);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState('');
  const [search, setSearch]               = useState('');
  const [filterActive, setFilterActive]   = useState('');
  const [filterVc, setFilterVc]           = useState('');
  const [stateFilter, setStateFilter]     = useState('');
  const [page, setPage]                   = useState(1);
  const LIMIT = 20;

  const [allStates, setAllStates] = useState([]);
  const [modal, setModal]         = useState(null);
  const [toast, setToast]         = useState(null);
  const searchTimer               = useRef(null);

  useEffect(() => {
    api('/api/locations/states')
      .then(r => setAllStates(r.items.filter(s => s.is_active)))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ page, limit: LIMIT });
      if (search)       qs.set('search',       search);
      if (filterActive) qs.set('is_active',     filterActive);
      if (filterVc)     qs.set('vehicle_class', filterVc);
      if (stateFilter)  qs.set('state_id',      stateFilter);
      const r = await api(`/api/hubs?${qs}`);
      setHubs(r.items); setTotal(r.total);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [search, filterActive, filterVc, stateFilter, page]);

  useEffect(() => { load(); }, [load]);

  function handleSearchChange(v) {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setSearch(v); setPage(1); }, 350);
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  function handleSaved() {
    const isNew = !modal?.hub?.id;
    setModal(null);
    showToast(isNew ? 'HUB created successfully.' : 'HUB updated successfully.');
    load();
  }

  function handleServicesSaved(counts) {
    setModal(null);
    showToast(`Services saved — ${counts.total_services} service${counts.total_services !== 1 ? 's' : ''} across ${counts.total_categories} categor${counts.total_categories !== 1 ? 'ies' : 'y'}.`);
    load();
  }

  async function handleToggle(hub) {
    if (!hub.is_active && hub.verification_status !== 'verified') {
      showToast(`Cannot activate — hub is "${hub.verification_status}". Verify it first.`, 'error');
      return;
    }
    try {
      const r = await api(`/api/hubs/${hub.id}/toggle`, { method: 'PATCH' });
      setHubs(prev => prev.map(h => h.id === hub.id ? { ...h, is_active: r.is_active } : h));
      showToast(`HUB ${r.is_active ? 'activated' : 'deactivated'}.`);
    } catch (e) { showToast(e.message, 'error'); }
  }

  const totalPages = Math.ceil(total / LIMIT);
  const start = (page - 1) * LIMIT + 1;
  const end   = Math.min(page * LIMIT, total);

  return (
    <div className="hb-page">
      {toast && (
        <div className={`hb-toast hb-toast--${toast.type}`}>
          <CheckCircle2 size={14} /> {toast.msg}
        </div>
      )}

      <header className="page-header">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Network size={20} /> HUBs</h2>
          <p>Manage HUB (Aggregator) records, vehicle types, and service mappings.</p>
        </div>
        {canCreate && (
          <button className="button primary" onClick={() => setModal({ mode: 'add' })}>
            <Plus size={16} /> Add HUB
          </button>
        )}
      </header>

      {error && <div className="banner error">{error}</div>}

      <div className="hb-filters">
        <div className="hb-search-wrap">
          <Search size={14} className="hb-search-icon" />
          <input className="hb-search" placeholder="Search by name, person, or number…"
            onChange={e => handleSearchChange(e.target.value)} />
        </div>
        <select className="hb-filter-select" value={filterVc}
          onChange={e => { setFilterVc(e.target.value); setPage(1); }}>
          <option value="">All Vehicle Types</option>
          {VEHICLE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="hb-filter-select" value={stateFilter}
          onChange={e => { setStateFilter(e.target.value); setPage(1); }}>
          <option value="">All States</option>
          {allStates.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="hb-filter-select" value={filterActive}
          onChange={e => { setFilterActive(e.target.value); setPage(1); }}>
          <option value="">All Status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table hb-table">
            <thead>
              <tr>
                <th>HUB Name</th><th>Vehicle Type</th><th>Point of Contact</th>
                <th>RM</th><th>Location</th><th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 7 }).map((_, j) => <td key={j}><div className="hb-skel" /></td>)}</tr>
                ))
              ) : hubs.length === 0 ? (
                <tr><td colSpan="7">
                  <div className="hb-empty">
                    <Network size={36} style={{ opacity: .25, marginBottom: 10 }} />
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>No HUBs found</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {search || filterActive || filterVc || stateFilter
                        ? 'Try adjusting your filters.'
                        : canCreate ? 'Add your first HUB to get started.' : 'No HUBs have been created yet.'}
                    </div>
                  </div>
                </td></tr>
              ) : hubs.map(h => (
                <tr key={h.id} style={{ opacity: h.is_active ? 1 : 0.55 }}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span className={`hb-avatar hb-avatar--sm${h.is_active ? '' : ' hb-avatar--inactive'}`}>
                        <Network size={13} />
                      </span>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{h.hub_name}</span>
                          {h.hub_code && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary)', background: 'color-mix(in srgb, var(--primary) 10%, var(--bg))', padding: '1px 6px', borderRadius: 99 }}>{h.hub_code}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.owner_name}</div>
                        {(h.open_time || h.close_time) && (
                          <div className="hb-timing-badge"><Clock size={9} />{fmtTime(h.open_time)} – {fmtTime(h.close_time)}</div>
                        )}
                        {h.has_gst && <span className="hb-gst-tag">GST</span>}
                      </div>
                    </div>
                  </td>
                  <td><VehicleBadge value={h.vehicle_class} /></td>
                  <td>
                    {h.person_name
                      ? <div><div style={{ fontWeight: 600, fontSize: 13 }}>{h.person_name}</div>{h.contact_number && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{h.contact_number}</div>}</div>
                      : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td>
                    <span className="hb-rm-chip">{h.rm_name}</span>
                    {h.rm_mobile && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{h.rm_mobile}</div>}
                  </td>
                  <td>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{h.area_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{h.city_name} · {h.state_name}</div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-start' }}>
                      <StatusBadge active={h.is_active} />
                      <VerificationBadge status={h.verification_status} compact />
                    </div>
                  </td>
                  <td>
                    <div className="hb-actions">
                      <button className="hb-icon-btn" title="View" onClick={() => setModal({ mode: 'view', hub: h })}><Eye size={14} /></button>
                      {canEdit && (
                        <>
                          <button className="hb-icon-btn" title="Edit" onClick={() => setModal({ mode: 'edit', hub: h })}><Pencil size={14} /></button>
                          <button className="hb-icon-btn hb-icon-btn--services" title="Manage Services" onClick={() => setModal({ mode: 'services', hub: h })}><Layers size={14} /></button>
                          <button
                            className={`hb-icon-btn${h.is_active ? ' hb-icon-btn--warn' : (h.verification_status === 'verified' ? ' hb-icon-btn--ok' : ' hb-icon-btn--disabled')}`}
                            title={h.is_active ? 'Deactivate' : (h.verification_status !== 'verified' ? 'Verify hub before activating' : 'Activate')}
                            onClick={() => handleToggle(h)}>
                            {h.is_active ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="hb-pagination">
            <span className="hb-pag-info">{start}–{end} of {total} HUB{total !== 1 ? 's' : ''}</span>
            <div className="hb-pag-btns">
              <button className="hb-pag-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={15} /></button>
              <span className="hb-pag-page">{page} / {totalPages}</span>
              <button className="hb-pag-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight size={15} /></button>
            </div>
          </div>
        )}
      </div>

      {modal?.mode === 'add'      && <HubModal onClose={() => setModal(null)} onSaved={handleSaved} />}
      {modal?.mode === 'edit'     && <HubModal hub={modal.hub} onClose={() => setModal(null)} onSaved={handleSaved} />}
      {modal?.mode === 'view'     && <ViewModal hub={modal.hub} canManage={canEdit} canVerify={canVerify} onClose={() => setModal(null)} onEdit={() => setModal({ mode: 'edit', hub: modal.hub })} onHubUpdated={updatedHub => { setHubs(prev => prev.map(h => h.id === updatedHub.id ? { ...h, ...updatedHub } : h)); setModal(m => ({ ...m, hub: updatedHub })); }} />}
      {modal?.mode === 'services' && <HubServicesModal hub={modal.hub} onClose={() => setModal(null)} onSaved={handleServicesSaved} />}
    </div>
  );
}
