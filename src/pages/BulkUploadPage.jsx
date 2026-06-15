import { useState, useRef, useCallback, useEffect } from 'react';
import { useUpload } from '../context/UploadContext.jsx';
import {
  UploadCloud, FileText, CheckCircle2, AlertCircle,
  Info, Download, X, ChevronDown, ChevronUp, AlertTriangle,
  FileSpreadsheet, File,
} from 'lucide-react';
import '../styles/BulkUploadPage.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// ─── Import type configuration ────────────────────────────────────────────────
const UPLOAD_TYPES = [
  {
    id:          'leads',
    uploadUrl:   '/api/import/leads',
    templateId:  'leads',
    icon:        '👥',
    title:       'Leads',
    desc:        'Import customer leads in bulk. Only mobile number is required — all other fields are optional.',
    required:    ['mobile'],
    softRequired: [],
    optional:    ['name','whatsapp','state','city','area','vehicle_type','make','model','lead_source','status','assigned_to','notes','services','categories'],
    notes: [
      'Only mobile is required — every other column is optional',
      'Each row creates a NEW lead (no duplicate-check on mobile)',
      'status must match an existing status name exactly (e.g. "Follow-Up")',
      'vehicle_type must match exactly: use 4W or 2W (exactly as stored in your reference data)',
      'make / model must exist in the system under the given vehicle_type',
      'state / city / area must exist in master data',
      'assigned_to: enter the agent\'s email address or full name',
      'services: semicolon-separated service names (e.g. "AC Service;Foam Wash")',
      'categories: semicolon-separated category interests (e.g. "AC;Wash") — for category-only interest without a specific service',
      'If any referenced value does not exist, the entire upload is rejected — fix all errors and re-upload',
    ],
    sample: [
      { mobile: '9712301573', name: 'Raj Patel',   whatsapp: '',           state: 'Gujarat', city: 'Ahmedabad', area: 'Navrangpura', vehicle_type: '4W', make: 'Maruti', model: 'Swift',  lead_source: 'Walk-in',  status: 'Follow-Up',            assigned_to: '',                  notes: 'Interested in full service', services: 'AC Service',  categories: ''     },
      { mobile: '9898123456', name: 'Priya Shah',  whatsapp: '9898123456', state: 'Gujarat', city: 'Surat',     area: 'Adajan',      vehicle_type: '2W',  make: 'Honda',  model: 'Activa', lead_source: 'Website',  status: 'Call No Ans. (Day 1)', assigned_to: 'agent@example.com', notes: '',                           services: '',            categories: 'AC;Wash' },
      { mobile: '9876543210', name: 'Amit Kumar',  whatsapp: '',           state: '',        city: '',          area: '',            vehicle_type: '',    make: '',       model: '',       lead_source: 'Referral', status: '',                     assigned_to: '',                  notes: '',                           services: '',            categories: ''     },
    ],
  },
  {
    id:            'vehicles_tw',
    uploadUrl:     '/api/import/vehicles?class=2W',
    templateId:    'vehicles',
    templateClass: '2W',
    icon:          '🏍️',
    title:         '2W Vehicles',
    desc:          'Import Two-Wheeler vehicles — bikes, scooters. Engine CC is the key pricing dimension.',
    required:      ['make', 'model'],
    softRequired:  ['engine_cc'],
    optional:      [],
    notes: [
      'engine_cc is strongly recommended — rows without CC cannot match CC-based pricing rules',
      'engine_cc auto-assigns CC category (C1–C6) used in pricing',
      'Vehicle type is auto-set to Two-Wheeler — no type column needed',
      'Identity key = make + model',
      'Rows with missing engine_cc are still imported but generate a per-row pricing warning',
    ],
    sample: [
      { make: 'Honda',         model: 'Activa 6G',      engine_cc: '110' },
      { make: 'Royal Enfield', model: 'Classic 350',    engine_cc: '349' },
      { make: 'Bajaj',         model: 'Pulsar 220',     engine_cc: '220' },
      { make: 'TVS',           model: 'Apache RTR 160', engine_cc: '160' },
    ],
  },
  {
    id:            'vehicles_fw',
    uploadUrl:     '/api/import/vehicles?class=4W',
    templateId:    'vehicles',
    templateClass: '4W',
    icon:          '🚗',
    title:         '4W Vehicles',
    desc:          'Import Four-Wheeler vehicles — cars, SUVs. Segment and body type are key pricing dimensions.',
    required:      ['make', 'model'],
    softRequired:  ['segment', 'body_type'],
    optional:      [],
    notes: [
      'segment and body_type are strongly recommended — rows without them cannot match segment/body-type pricing rules',
      'Vehicle type is auto-set to Four-Wheeler — no type column needed',
      'Identity key = make + model',
      'segment values: Petrol, Diesel, CNG, Electric, Hybrid',
      'body_type values: Hatchback, Sedan, SUV, MUV, Coupe, etc.',
      'Rows with missing segment/body_type are still imported but generate a per-row pricing warning',
    ],
    sample: [
      { make: 'Maruti',   model: 'Swift',    segment: 'Petrol', body_type: 'Hatchback' },
      { make: 'Hyundai',  model: 'Creta',    segment: 'Diesel', body_type: 'SUV'       },
      { make: 'Tata',     model: 'Nexon',    segment: 'Petrol', body_type: 'SUV'       },
      { make: 'Toyota',   model: 'Fortuner', segment: 'Diesel', body_type: 'SUV'       },
    ],
  },
  {
    id:       'parts',
    icon:     '🔧',
    title:    'Parts',
    desc:     'Import spare parts and auto parts used in vehicle servicing. Only part name is required.',
    required: ['name'],
    softRequired: [],
    optional: ['category', 'vehicle_type', 'customer_rate', 'gst_percent', 'hsn_code'],
    notes: [
      'Only name is required — all other columns are optional',
      'vehicle_type must be exactly: 2W, 4W, or both (case-insensitive). Leave blank if not applicable.',
      'customer_rate: selling price to customer inclusive of GST e.g. 500.00. Leave blank to skip.',
      'gst_percent: numeric GST rate e.g. 18 or 28. Leave blank to skip.',
      'hsn_code: HSN (Harmonized System of Nomenclature) code for the part e.g. 84099900. Leave blank to skip.',
      'Identity key = name (case-insensitive). Re-uploading the same name updates all other columns.',
      'If vehicle_type is invalid the entire upload is rejected — fix all errors and re-upload',
    ],
    sample: [
      { name: 'Engine Oil Filter', category: 'Engine',  vehicle_type: 'both', customer_rate: '450.00', gst_percent: '28', hsn_code: '84099900' },
      { name: 'Brake Pad Set',     category: 'Brakes',  vehicle_type: '4W',   customer_rate: '1200.00', gst_percent: '28', hsn_code: '87083000' },
      { name: 'Brake Shoe',        category: 'Brakes',  vehicle_type: '2W',   customer_rate: '350.00', gst_percent: '28', hsn_code: '87083000' },
      { name: 'Air Filter',        category: 'Engine',  vehicle_type: '',     customer_rate: '',       gst_percent: '18', hsn_code: '84212300' },
      { name: 'Wiper Blade',       category: '',        vehicle_type: '4W',   customer_rate: '250.00', gst_percent: '18', hsn_code: ''         },
    ],
  },
  {
    id:      'locations',
    title:   'Locations',
    desc:    'Import states, cities, and areas',
    required: ['state', 'city', 'area'],
    optional: ['pincode'],
    notes:   [],
    sample: [
      { state: 'Maharashtra', city: 'Mumbai',    area: 'Andheri',     pincode: '400053' },
      { state: 'Maharashtra', city: 'Pune',      area: 'Kothrud',     pincode: '411038' },
      { state: 'Karnataka',   city: 'Bengaluru', area: 'Koramangala', pincode: '560034' },
    ],
  },
  {
    id:      'services',
    title:   'Services',
    desc:    'Import service categories and items',
    required: ['category', 'service'],
    optional: ['description', 'vehicle_class', 'gst_percent', 'sac_code'],
    notes:   [
      'vehicle_class controls which vehicles can use this service in a lead',
      'vehicle_class values: 4W (Four-Wheeler only), 2W (Two-Wheeler only), both (default — shown for all vehicles)',
      'Leave vehicle_class blank to use the default "both"',
      'gst_percent: numeric GST rate e.g. 18. Leave blank to skip.',
      'sac_code: SAC (Services Accounting Code) for the service e.g. 998714. Leave blank to skip.',
      'If vehicle_class does not match exactly (4W, 2W, or both), the entire upload is rejected',
    ],
    sample: [
      { category: 'Wash',        service: 'Exterior Wash',       description: 'Full exterior hand wash',          vehicle_class: 'both', gst_percent: '18', sac_code: '998714' },
      { category: 'Wash',        service: 'Interior Vacuuming',  description: 'Complete interior vacuum cleaning', vehicle_class: 'both', gst_percent: '18', sac_code: '998714' },
      { category: 'AC',          service: 'AC Gas Refill',       description: 'Refrigerant top-up',               vehicle_class: '4W',   gst_percent: '18', sac_code: '998714' },
      { category: 'Two-Wheeler', service: 'Chain Lubrication',   description: 'Chain cleaning and lubrication',   vehicle_class: '2W',   gst_percent: '18', sac_code: ''       },
      { category: 'Detailing',   service: 'Engine Bay Cleaning', description: 'Professional engine degreasing',   vehicle_class: 'both', gst_percent: '18', sac_code: ''       },
    ],
  },
  {
    id:      'pricing',
    title:   'Pricing Rules',
    desc:    'Import pricing rules for a service or an entire category, with optional vehicle dimension targeting',
    required: ['price', 'rule_type'],
    optional: ['category', 'service', 'vehicle_type', 'body_type', 'segment', 'make', 'model', 'cc_category', 'is_active'],
    // Two-mode info rendered specially in the preview popover
    ruleModes: [
      {
        label:    'Category + Service',
        badge:    'Service-level rule',
        badgeCls: 'badge--service',
        desc:     'Price applies to that specific service only. The service must exist inside the given category — mismatches are rejected.',
        eg:       'category="Wash", service="Exterior Wash"',
      },
      {
        label:    'Category only (leave service blank)',
        badge:    'Category-level rule',
        badgeCls: 'badge--category',
        desc:     'Price applies to ALL services inside that category. Leave the service column empty.',
        eg:       'category="Wash", service=""',
      },
    ],
    notes:   [
      'category is required on every row — the upload is rejected if it is missing',
      'All referenced data (category, service, vehicle_type, make, model, etc.) must already exist in the database',
      'vehicle_type must match exactly what is stored in your reference data (e.g. "4W" or "2W")',
      'rule_type values: Universal, Body Type, Segment, Make, Model, CC Category',
      'cc_category values: C1–C6 (Two-Wheeler only)',
      'is_active defaults to true if left blank',
    ],
    sample: [
      // category-level rules
      { category: 'Wash',        service: '',                  price: '399', rule_type: 'Universal',   vehicle_type: '',   body_type: '',    segment: '',    make: '',       model: '',      cc_category: '',   is_active: 'true' },
      { category: 'AC',          service: '',                  price: '999', rule_type: 'Body Type',   vehicle_type: '4W', body_type: 'SUV', segment: '',    make: '',       model: '',      cc_category: '',   is_active: 'true' },
      // service-level rules (service validated inside category)
      { category: 'Wash',        service: 'Exterior Wash',     price: '499', rule_type: 'Universal',   vehicle_type: '',   body_type: '',    segment: '',    make: '',       model: '',      cc_category: '',   is_active: 'true' },
      { category: 'Wash',        service: 'Exterior Wash',     price: '699', rule_type: 'Segment',     vehicle_type: '4W', body_type: '',    segment: 'SUV', make: '',       model: '',      cc_category: '',   is_active: 'true' },
      { category: 'Wash',        service: 'Exterior Wash',     price: '349', rule_type: 'Model',       vehicle_type: '4W', body_type: '',    segment: '',    make: 'Maruti', model: 'Swift', cc_category: '',   is_active: 'true' },
      { category: 'Two-Wheeler', service: 'Chain Lubrication', price: '249', rule_type: 'CC Category', vehicle_type: '2W', body_type: '',    segment: '',    make: '',       model: '',      cc_category: 'C1', is_active: 'true' },
    ],
  },
];

// ─── Status states ────────────────────────────────────────────────────────────
// idle | uploading | validating | success | error

// ═════════════════════════════════════════════════════════════════════════════
// Main page
// ═════════════════════════════════════════════════════════════════════════════
export default function BulkUploadPage() {
  // Use global context so uploads continue even if user navigates away
  const { states, setTypeState, resetTypeState } = useUpload();

  async function handleUpload(type, file) {
    const typeId = type.id;
    if (!file) return;

    // Client-side format check
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'xlsx'].includes(ext)) {
      setTypeState(typeId, {
        status: 'error',
        data: {
          error: `Invalid file format. Only .csv and .xlsx files are accepted. You selected: .${ext}`,
          code:  'INVALID_FILE_FORMAT',
        },
      });
      return;
    }

    // Client-side size check (25 MB)
    if (file.size > 25 * 1024 * 1024) {
      setTypeState(typeId, {
        status: 'error',
        data: {
          error: 'File size exceeds the 25 MB limit. Please reduce your file size and try again.',
          code:  'FILE_TOO_LARGE',
        },
      });
      return;
    }

    setTypeState(typeId, { status: 'uploading', data: null, progress: 0 });

    const formData = new FormData();
    formData.append('file', file);

    try {
      const token = localStorage.getItem('spinoto.token');
      // Use custom uploadUrl if provided (e.g. for class-specific vehicle upload)
      const uploadUrl = type.uploadUrl
        ? `${API_URL}${type.uploadUrl}`
        : `${API_URL}/api/import/${typeId}`;

      // Use XHR for upload progress tracking
      const result = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setTypeState(typeId, { status: 'uploading', progress: pct });
          }
        });

        xhr.upload.addEventListener('load', () => {
          setTypeState(typeId, { status: 'validating', progress: 100 });
        });

        xhr.addEventListener('load', () => {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data });
          } catch {
            reject(new Error('Invalid server response'));
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Network error. Please try again.')));
        xhr.addEventListener('timeout', () => reject(new Error('Request timed out. Please try again.')));

        xhr.open('POST', uploadUrl);
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.timeout = 120_000; // 2 min
        xhr.send(formData);
      });

      if (result.ok) {
        setTypeState(typeId, { status: 'success', data: result.data });
      } else {
        setTypeState(typeId, { status: 'error', data: result.data });
      }
    } catch (e) {
      setTypeState(typeId, {
        status: 'error',
        data:   { error: e.message, code: 'NETWORK_ERROR' },
      });
    }
  }

  function handleReset(typeId) {
    resetTypeState(typeId);
  }

  return (
    <div className="bulk-upload-page">
      <header className="page-header">
        <div>
          <h2>Data Import Centre</h2>
          <p>Bulk-upload structured data using CSV or Excel files.</p>
        </div>
      </header>

      <div className="upload-grid">
        {UPLOAD_TYPES.map((t) => (
          <UploadCard
            key={t.id}
            type={t}
            state={states[t.id] || { status: 'idle' }}
            onUpload={(file) => handleUpload(t, file)}
            onReset={() => handleReset(t.id)}
          />
        ))}
      </div>

      <ImportGuidelines />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Upload Card
// ═════════════════════════════════════════════════════════════════════════════
function UploadCard({ type, state, onUpload, onReset }) {
  const inputRef      = useRef(null);
  const triggerRef    = useRef(null);
  const [dragging, setDragging]       = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showErrors, setShowErrors]   = useState(false);
  const [popoverPos, setPopoverPos]   = useState({ top: 0, right: 0 });

  // Recalculate popover position on scroll so it stays anchored to the button
  useEffect(() => {
    if (!showPreview) return;
    function updatePos() {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setPopoverPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
      }
    }
    window.addEventListener('scroll', updatePos, true);
    return () => window.removeEventListener('scroll', updatePos, true);
  }, [showPreview]);

  const { status = 'idle', data, progress = 0 } = state;
  const isActive = status === 'uploading' || status === 'validating';

  const softRequired = type.softRequired || [];
  const cols = [...type.required, ...softRequired, ...type.optional];

  // ── Drag handlers ──────────────────────────────────────────────────────────
  function onDragOver(e) { e.preventDefault(); setDragging(true); }
  function onDragLeave()  { setDragging(false); }
  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onUpload(file);
  }

  // ── Template download ──────────────────────────────────────────────────────
  function downloadTemplate(fmt) {
    const token = localStorage.getItem('spinoto.token');
    const tplId = type.templateId || type.id;
    const classParam = type.templateClass ? `&class=${type.templateClass}` : '';
    const url   = `${API_URL}/api/import/template/${tplId}?format=${fmt}${classParam}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const bUrl = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href     = bUrl;
        a.download = `${tplId}${type.templateClass ? `_${type.templateClass}` : ''}_template.${fmt}`;
        a.click();
        URL.revokeObjectURL(bUrl);
      });
  }

  return (
    <div className={`upload-card card ${status === 'error' ? 'card--error' : ''} ${status === 'success' ? 'card--success' : ''}`}>

      {/* ── Card header ──────────────────────────────────────────────────── */}
      <div className="uc-header">
        <div>
          <h3 className="uc-title">
            {type.icon && <span className="uc-icon">{type.icon}</span>}
            {type.title}
          </h3>
          <p className="uc-desc">{type.desc}</p>
        </div>

        {/* Help / preview icon */}
        <div className="preview-trigger-wrap">
          <button
            ref={triggerRef}
            className="icon-btn"
            title="View sample format"
            onClick={() => {
              if (!showPreview && triggerRef.current) {
                const rect = triggerRef.current.getBoundingClientRect();
                setPopoverPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
              }
              setShowPreview(v => !v);
            }}
            aria-expanded={showPreview}
          >
            <Info size={16} />
          </button>

          {showPreview && (
            <div className="preview-popover" style={{ top: popoverPos.top, right: popoverPos.right }}>
              <div className="preview-popover-header">
                <span>Sample Format — {type.title}</span>
                <button className="icon-btn small" onClick={() => setShowPreview(false)}>
                  <X size={14} />
                </button>
              </div>
              <div className="preview-popover-body">
                <p className="preview-note">
                  Required: {type.required.map(c => <code key={c}>{c}</code>).reduce((a, b) => [a, ', ', b])}
                  {softRequired.length > 0 && (
                    <> &nbsp;·&nbsp; <span style={{color:'#d97706',fontWeight:600}}>Soft-required:</span> {softRequired.map(c => <code key={c} style={{background:'#fef3c7',color:'#92400e',borderColor:'#fde68a'}}>{c}</code>).reduce((a, b) => [a, ', ', b])}</>
                  )}
                  {type.optional.length > 0 && (
                    <> &nbsp;·&nbsp; Optional: {type.optional.map(c => <code key={c}>{c}</code>).reduce((a, b) => [a, ', ', b])}</>
                  )}
                </p>

                {/* ── Pricing rule-mode info ─────────────────────────────── */}
                {type.ruleModes && (
                  <div className="rule-modes">
                    <div className="rule-modes-title">Two upload modes:</div>
                    {type.ruleModes.map((m, i) => (
                      <div key={i} className="rule-mode-row">
                        <div className="rule-mode-top">
                          <span className={`rule-badge ${m.badgeCls}`}>{m.badge}</span>
                          <span className="rule-mode-label">{m.label}</span>
                        </div>
                        <p className="rule-mode-desc">{m.desc}</p>
                        <code className="rule-mode-eg">{m.eg}</code>
                      </div>
                    ))}
                  </div>
                )}

                {type.notes?.length > 0 && (
                  <ul className="preview-notes-list">
                    {type.notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                )}
                <div className="preview-table-wrap">
                  <table className="preview-table">
                    <thead>
                      <tr>{cols.map(c => <th key={c}>{c}</th>)}</tr>
                    </thead>
                    <tbody>
                      {type.sample.map((row, i) => (
                        <tr key={i} className={type.ruleModes ? (row.service ? 'sample-row--service' : 'sample-row--category') : ''}>
                          {cols.map(c => <td key={c}>{row[c] ?? ''}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {type.ruleModes && (
                  <p className="preview-note" style={{ gap: '8px' }}>
                    <span className="sample-legend sample-legend--category" /> Category-level rule &nbsp;
                    <span className="sample-legend sample-legend--service"  /> Service-level rule
                  </p>
                )}
                <p className="preview-note muted">Column names are case-insensitive. Extra columns are ignored.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Column tags ──────────────────────────────────────────────────── */}
      <div className="col-tags">
        {type.required.map(c => (
          <span key={c} className="col-tag required" title="Required column">{c}</span>
        ))}
        {softRequired.map(c => (
          <span key={c} className="col-tag soft-required" title="Strongly recommended — rows without this column are uploaded but generate a pricing warning">
            {c} <em>(soft)</em>
          </span>
        ))}
        {type.optional.map(c => {
          // For pricing: 'category' is always required in practice; 'service' is conditionally required
          const isPricingCategory = type.id === 'pricing' && c === 'category';
          const isPricingService  = type.id === 'pricing' && c === 'service';
          if (isPricingCategory) {
            return (
              <span key={c} className="col-tag required" title="Required — every pricing row must have a category">
                {c} <em style={{ fontStyle: 'normal', fontSize: '10px', opacity: 0.75 }}>*</em>
              </span>
            );
          }
          if (isPricingService) {
            return (
              <span key={c} className="col-tag conditional" title="Conditional — fill for service-level rule, leave blank for category-level rule">
                {c} <em>(cond)</em>
              </span>
            );
          }
          return (
            <span key={c} className="col-tag optional" title="Optional column">{c} <em>(opt)</em></span>
          );
        })}
      </div>

      {/* ── Drop zone (only when idle or after reset) ─────────────────────── */}
      {(status === 'idle' || status === 'error') && (
        <div
          className={`drop-zone ${dragging ? 'drop-zone--active' : ''} ${status === 'error' ? 'drop-zone--error-mode' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => !isActive && inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx"
            style={{ display: 'none' }}
            onChange={e => { onUpload(e.target.files[0]); e.target.value = ''; }}
          />
          <UploadCloud size={28} className="dz-icon" />
          <div className="dz-text">
            {status === 'error' ? 'Try again — choose a new file' : 'Drop file here, or click to browse'}
          </div>
          <div className="dz-sub">Accepts .csv and .xlsx · Max 25 MB</div>
        </div>
      )}

      {/* ── Progress (uploading) ─────────────────────────────────────────── */}
      {status === 'uploading' && (
        <div className="progress-block">
          <div className="progress-label">
            <span>Uploading…</span>
            <span>{progress}%</span>
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {/* ── Validating spinner ───────────────────────────────────────────── */}
      {status === 'validating' && (
        <div className="validating-block">
          <span className="spinner" />
          <span>Validating your data…</span>
        </div>
      )}

      {/* ── Success ──────────────────────────────────────────────────────── */}
      {status === 'success' && data && (
        <div className="result-block result-block--success">
          <div className="result-main">
            <CheckCircle2 size={20} className="result-icon" />
            <div style={{ flex: 1 }}>
              <div className="result-title">Upload Complete</div>
              <div className="result-detail">{data.message}</div>
            </div>
          </div>

          {/* Upsert breakdown chips */}
          {(data.inserted > 0 || data.updated > 0 || data.unchanged > 0) && (
            <div className="upsert-chips">
              {data.inserted  > 0 && (
                <span className="upsert-chip chip--inserted">
                  ＋ {data.inserted} inserted
                </span>
              )}
              {data.updated   > 0 && (
                <span className="upsert-chip chip--updated">
                  ✎ {data.updated} updated
                </span>
              )}
              {data.unchanged > 0 && (
                <span className="upsert-chip chip--unchanged">
                  ● {data.unchanged} unchanged
                </span>
              )}
              {data.skippedBlanks > 0 && (
                <span className="upsert-chip chip--skipped">
                  ○ {data.skippedBlanks} blank rows skipped
                </span>
              )}
            </div>
          )}

          {data.warnings?.length > 0 && (
            <div className="result-warnings">
              {data.warnings.map((w, i) => (
                <div key={i} className="warning-line"><AlertTriangle size={13} /> {w}</div>
              ))}
            </div>
          )}

          {/* Row-level soft warnings (vehicle uploads use name+missing; leads uploads use message) */}
          {data.rowWarnings?.length > 0 && (
            <div className="row-warnings-block">
              <div className="row-warnings-header">
                <AlertTriangle size={13} className="rw-icon" />
                <strong>{data.rowWarnings.length} row{data.rowWarnings.length !== 1 ? 's' : ''} uploaded with warnings</strong>
                <span className="rw-sub">— pricing rules may not match correctly for these rows</span>
              </div>
              <div className="row-warnings-list">
                {data.rowWarnings.map((w, i) => (
                  <div key={i} className="row-warning-item">
                    <span className="rw-row-num">Row {w.row}</span>
                    {w.message
                      ? <span className="rw-name">{w.message}</span>
                      : <>
                          <span className="rw-name">{w.name}</span>
                          <span className="rw-missing">missing: {w.missing?.join(', ')}</span>
                        </>
                    }
                  </div>
                ))}
              </div>
            </div>
          )}

          <button className="link-btn" onClick={onReset}>Upload another file</button>
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {status === 'error' && data && (
        <div className="result-block result-block--error">
          <div className="result-main">
            <AlertCircle size={20} className="result-icon" />
            <div>
              <div className="result-title">
                {data.code === 'VALIDATION_FAILED'
                  ? `Validation Failed — ${data.errorCount} error(s) found`
                  : 'Upload Failed'}
              </div>
              <div className="result-detail">{data.error}</div>
            </div>
          </div>

          {data.warnings?.length > 0 && (
            <div className="result-warnings">
              {data.warnings.map((w, i) => (
                <div key={i} className="warning-line"><AlertTriangle size={13} /> {w}</div>
              ))}
            </div>
          )}

          {/* Error table */}
          {data.errors?.length > 0 && (
            <div className="error-report">
              <button
                className="error-toggle"
                onClick={() => setShowErrors(v => !v)}
              >
                {showErrors ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showErrors ? 'Hide' : 'Show'} error details ({data.errors.length})
              </button>

              {showErrors && (
                <div className="error-table-wrap">
                  <table className="error-table">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Column</th>
                        <th>Error</th>
                        <th>Row Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.errors.map((err, i) => (
                        <tr key={i}>
                          <td className="err-row-num">{err.row}</td>
                          <td><code>{err.column}</code></td>
                          <td>
                            <span className="err-code">{err.code}</span>
                            <div className="err-msg">{err.message}</div>
                          </td>
                          <td className="err-data">
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {String(err.rowData || '').split('|').map((v, i) => v.trim() && (
                                <span key={i} style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontFamily: 'monospace', whiteSpace: 'nowrap', color: '#374151' }}>
                                  {v.trim()}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <button className="link-btn" onClick={onReset}>Try again</button>
        </div>
      )}

      {/* ── Template download footer ─────────────────────────────────────── */}
      <div className="uc-footer">
        <span className="footer-label">Download template:</span>
        <button className="template-btn" onClick={() => downloadTemplate('csv')} title="Download CSV template">
          <File size={13} /> CSV
        </button>
        <button className="template-btn" onClick={() => downloadTemplate('xlsx')} title="Download Excel template">
          <FileSpreadsheet size={13} /> Excel
        </button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Import Guidelines
// ═════════════════════════════════════════════════════════════════════════════
function ImportGuidelines() {
  return (
    <section className="guidelines card">
      <div className="gl-header">
        <Info size={18} className="gl-icon" />
        <h3>Import Guidelines</h3>
      </div>
      <div className="gl-grid">
        {[
          { title: 'Accepted Formats',    body: 'Upload .csv (UTF-8) or .xlsx (Excel) files. Other formats are rejected.' },
          { title: 'Required Columns',    body: 'Each file type has required columns. Missing any required column rejects the entire file.' },
          { title: 'Column Names',        body: 'Column names are case-insensitive. "Type", "TYPE", and "type" are all valid. Extra columns are ignored.' },
          { title: 'Upsert Behaviour',     body: 'Existing records (matched by identity key) are updated with new values. Truly unchanged records are counted separately. New rows are inserted.' },
          { title: 'All-or-Nothing',      body: 'If any row fails hard validation, the entire upload is rejected. Fix all errors and re-upload.' },
          { title: 'Soft-Required Fields', body: 'Some columns (marked "soft") are not required to upload but affect pricing. Rows missing them are imported with a per-row warning about which pricing rules won\'t apply.' },
          { title: 'File Size Limit',     body: 'Maximum file size is 25 MB. For very large datasets, consider splitting into multiple files.' },
        ].map(({ title, body }) => (
          <div key={title} className="gl-item">
            <strong>{title}</strong>
            <p>{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Styles
