import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useBodyLock } from '../hooks/useBodyLock.js';
import {
  User, MapPin, Car, Bike, Wrench, Plus, Trash2,
  Info, CheckCircle2, X, ChevronDown, Search, Zap,
  ArrowRight, ArrowLeft, ChevronRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { LEAD_SOURCES } from '../pages/LeadsPage.jsx';
import '../styles/NewLeadModal.css';

// ── helpers ────────────────────────────────────────────────────────────────────
function is2WType(name = '') {
  const n = name.toLowerCase();
  return n.includes('two') || n.includes('2w') || n.includes('2-w')
    || n.includes('bike') || n.includes('scoot') || n.includes('motor');
}

// Segment / fuel-type badge colours (first letter of segment name)
const SEGMENT_BADGE_COLORS = {
  P: { bg: '#fef3c7', color: '#92400e', border: '#fde68a' }, // Petrol  – amber
  D: { bg: '#dbeafe', color: '#1e40af', border: '#bfdbfe' }, // Diesel  – blue
  C: { bg: '#dcfce7', color: '#166534', border: '#bbf7d0' }, // CNG     – green
  E: { bg: '#ede9fe', color: '#5b21b6', border: '#ddd6fe' }, // Electric– violet
};
function segBadgeStyle(letter) {
  return SEGMENT_BADGE_COLORS[letter] || { bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' };
}

// ── Searchable dropdown ────────────────────────────────────────────────────────
function SearchableSelect({
  value, onChange, options = [], placeholder = 'Select…',
  disabled = false, loading = false, emptyMsg = 'No options',
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find(o => String(o.id) === String(value));
  const filtered = query
    ? options.filter(o => o.name.toLowerCase().includes(query.toLowerCase()))
    : options;

  useEffect(() => {
    function onOut(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false); setQuery(''); setFocusedIndex(-1);
      }
    }
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, []);

  // Reset focused index when filtered list changes
  useEffect(() => { setFocusedIndex(-1); }, [query]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex < 0 || !listRef.current) return;
    const item = listRef.current.children[focusedIndex];
    item?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex]);

  function handleOpen() {
    if (disabled || loading) return;
    setOpen(true);
    setFocusedIndex(-1);
    setTimeout(() => inputRef.current?.focus(), 30);
  }

  function close() { setOpen(false); setQuery(''); setFocusedIndex(-1); }

  function pick(id) { onChange(id); close(); }

  function handleTriggerKeyDown(e) {
    if (disabled || loading) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); handleOpen(); }
  }

  function handleInputKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex(i => {
        if (i <= 0) return -1; // back to search input
        return i - 1;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (focusedIndex >= 0 && filtered[focusedIndex]) {
        pick(String(filtered[focusedIndex].id));
      }
    }
  }

  return (
    <div ref={wrapRef} className="ss-wrap">
      <div
        className={`ss-trigger${open ? ' ss-open' : ''}${disabled || loading ? ' ss-disabled' : ''}`}
        onClick={handleOpen}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleTriggerKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={selected ? 'ss-val' : 'ss-ph'} style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0 }}>
          {loading ? 'Loading…' : selected
            ? (<>{selected.badge && (
              <span className="ess-seg-badge" style={{
                ...segBadgeStyle(selected.badge),
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 20, height: 20, borderRadius: '50%',
                fontSize: 10, fontWeight: 800, border: `1.5px solid ${segBadgeStyle(selected.badge).border}`,
                flexShrink: 0,
              }}>{selected.badge}</span>
            )}{selected.name}</>)
            : placeholder}
        </span>
        <ChevronDown size={14} className={`ss-caret${open ? ' ss-caret-up' : ''}`} />
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            className="ss-dropdown"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.13 }}
          >
            <div className="ss-search-row">
              <Search size={13} className="ss-search-icon" />
              <input
                ref={inputRef}
                className="ss-search-input"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Search…"
                aria-autocomplete="list"
              />
              {query && (
                <button className="ss-clear" onMouseDown={() => setQuery('')}>
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="ss-list" ref={listRef} role="listbox">
              {filtered.length === 0 ? (
                <div className="ss-empty">{query ? `No match for "${query}"` : emptyMsg}</div>
              ) : filtered.map((o, idx) => (
                <div
                  key={o.id}
                  role="option"
                  aria-selected={String(o.id) === String(value)}
                  className={`ss-opt${String(o.id) === String(value) ? ' ss-opt-sel' : ''}${idx === focusedIndex ? ' ss-opt-focused' : ''}`}
                  onMouseDown={() => pick(String(o.id))}
                  onMouseEnter={() => setFocusedIndex(idx)}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0 }}>
                    {o.badge && (
                      <span className="ess-seg-badge" style={{
                        ...segBadgeStyle(o.badge),
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 20, height: 20, borderRadius: '50%',
                        fontSize: 10, fontWeight: 800, border: `1.5px solid ${segBadgeStyle(o.badge).border}`,
                        flexShrink: 0,
                      }}>{o.badge}</span>
                    )}
                    {o.name}
                  </span>
                  {String(o.id) === String(value) && <CheckCircle2 size={13} className="ss-tick" />}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
export default function NewLeadModal({ isOpen, onClose, onSuccess }) {
  useBodyLock(isOpen);
  const [step, setStep] = useState(1);   // 1 or 2
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [vehicleClass, setVehicleClass] = useState('4W');
  const [engineCc, setEngineCc] = useState('');
  const [ccCategoryId, setCcCategoryId] = useState(null);
  const [ccPreview, setCcPreview] = useState('');
  const [noCcWarning, setNoCcWarning] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [whatsappSame, setWhatsappSame] = useState(false);
  const [selectedCatId, setSelectedCatId] = useState('');
  const [serviceSearch, setServiceSearch] = useState('');
  const [allServices, setAllServices] = useState([]);
  const [statusList,  setStatusList]  = useState([]);
  const [leadSources, setLeadSources] = useState([]);

  // ── Duplicate detection ────────────────────────────────────────────────────
  const [duplicates,       setDuplicates]       = useState([]);
  const [dupChecking,      setDupChecking]       = useState(false);
  const [existingCustomer, setExistingCustomer]  = useState(null); // { customer_name, mobile, total_appointments, last_appointment }

  const [form, setForm] = useState({
    name: '', mobile: '', whatsapp: '',
    state_id: '', city_id: '', area_id: '',
    vehicle_type_id: '', make_id: '', model_id: '', body_type_id: '',
    segment_ids: [],
    lead_source: '', notes: '', status: '',
    selectedServices: [],
    selectedCategories: [], // { category_id, name } — category-only interests
  });

  const [masters, setMasters] = useState({
    states: [], cities: [], areas: [],
    vehicleTypes: [], makes: [], models: [], bodyTypes: [], segments: [],
    categories: [], services: [], ccCategories: [],
  });

  // ── reset on open ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    setStep(1); setVehicleClass('4W');
    setEngineCc(''); setCcCategoryId(null); setCcPreview(''); setNoCcWarning(false);
    setWhatsappSame(false); setSelectedCatId(''); setServiceSearch(''); setAllServices([]); setError(null); setDuplicates([]); setExistingCustomer(null);
    setForm({
      name: '', mobile: '', whatsapp: '', state_id: '', city_id: '', area_id: '',
      vehicle_type_id: '', make_id: '', model_id: '', body_type_id: '',
      segment_ids: [], lead_source: '', notes: '', status: '',
      selectedServices: [], selectedCategories: [],
    });
    Promise.all([
      api('/api/locations/states'),
      api('/api/vehicles/types'),
      api('/api/vehicles/body-types'),
      api('/api/vehicles/segments'),
      api('/api/cc-categories'),
      api('/api/lead-statuses'),
      api('/api/lead-sources'),
    ]).then(([s, t, b, sg, cc, st, src]) => {
      setStatusList(st.items || []);
      setLeadSources((src.items || []).map(s => s.name));
      setMasters(m => ({
        ...m,
        states: s.items, vehicleTypes: t.items,
        bodyTypes: b.items, segments: sg.items, ccCategories: cc.items || [],
      }));
    }).catch(e => setError(e.message));
  }, [isOpen]);

  useEffect(() => {
    if (form.state_id)
      api(`/api/locations/cities?state_id=${form.state_id}`)
        .then(r => setMasters(m => ({ ...m, cities: r.items })));
    else setMasters(m => ({ ...m, cities: [], areas: [] }));
  }, [form.state_id]);

  useEffect(() => {
    if (form.city_id)
      api(`/api/locations/areas?city_id=${form.city_id}`)
        .then(r => setMasters(m => ({ ...m, areas: r.items })));
    else setMasters(m => ({ ...m, areas: [] }));
  }, [form.city_id]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (form.vehicle_type_id) params.set('type_id', form.vehicle_type_id);
    else params.set('type_class', vehicleClass);
    if (vehicleClass === '4W' && form.body_type_id) {
      params.set('body_type_id', form.body_type_id);
    }
    api(`/api/vehicles/makes?${params.toString()}`)
      .then(r => {
        const items = r.items || [];
        setMasters(m => ({ ...m, makes: items }));
        setForm(f => {
          if (!f.make_id) return f;
          const still = items.some(mk => String(mk.id) === String(f.make_id));
          return still ? f : { ...f, make_id: '', model_id: '' };
        });
      })
      .catch(() => setMasters(m => ({ ...m, makes: [] })));
  }, [form.vehicle_type_id, vehicleClass, form.body_type_id]); // eslint-disable-line

  useEffect(() => {
    if (!form.make_id) {
      setMasters(m => ({ ...m, models: [] })); setModelsLoading(false); return;
    }
    setModelsLoading(true); setMasters(m => ({ ...m, models: [] }));
    const params = new URLSearchParams({ make_id: form.make_id });
    if (vehicleClass === '4W' && form.body_type_id) {
      params.set('body_type_id', form.body_type_id);
    }
    api(`/api/vehicles/models?${params.toString()}`)
      .then(r => setMasters(m => ({ ...m, models: r.items || [] })))
      .catch(() => setMasters(m => ({ ...m, models: [] })))
      .finally(() => setModelsLoading(false));
  }, [form.make_id]); // eslint-disable-line

  useEffect(() => {
    if (!form.model_id) { setNoCcWarning(false); return; }
    const model = masters.models.find(mod => String(mod.id) === String(form.model_id));
    if (!model) return;

    if (vehicleClass === '4W') {
      setForm(f => ({
        ...f,
        ...(model.body_type_id ? { body_type_id: String(model.body_type_id) } : {}),
        ...(model.segment_id ? { segment_ids: [model.segment_id] } : {}),
      }));
      setNoCcWarning(false); return;
    }

    const cc = model.engine_cc ? parseInt(model.engine_cc, 10) : null;
    if (cc && cc > 0) {
      setEngineCc(String(cc)); setCcCategoryId(null); setCcPreview(''); setNoCcWarning(false);
      api('/api/cc-categories/classify', { method: 'POST', body: { cc } })
        .then(r => { if (r.item) { setCcCategoryId(r.item.id); setCcPreview(`${r.item.name} · ${r.item.min_cc}–${r.item.max_cc} cc`); } })
        .catch(() => { });
    } else {
      setEngineCc(''); setCcCategoryId(null); setCcPreview(''); setNoCcWarning(true);
    }
  }, [form.model_id]); // eslint-disable-line

  useEffect(() => {
    if (!masters.vehicleTypes.length || form.vehicle_type_id) return;
    const filtered = masters.vehicleTypes.filter(t => vehicleClass === '2W' ? is2WType(t.name) : !is2WType(t.name));
    if (filtered.length === 1) setForm(f => ({ ...f, vehicle_type_id: String(filtered[0].id) }));
  }, [masters.vehicleTypes]); // eslint-disable-line

  useEffect(() => {
    if (!isOpen) return;
    setSelectedCatId(''); setServiceSearch(''); setAllServices([]);
    setMasters(m => ({ ...m, categories: [], services: [] }));
    Promise.all([
      api(`/api/services/categories?vehicle_class=${vehicleClass}`),
      api(`/api/services/services?vehicle_class=${vehicleClass}&is_active=true`),
    ])
      .then(([cats, svcs]) => {
        setMasters(m => ({ ...m, categories: cats.items || [] }));
        setAllServices(svcs.items || []);
      })
      .catch(() => { });
  }, [vehicleClass, isOpen]); // eslint-disable-line

  useEffect(() => {
    setServiceSearch('');
    if (selectedCatId)
      api(`/api/services/services?category_id=${selectedCatId}&vehicle_class=${vehicleClass}`)
        .then(r => setMasters(m => ({ ...m, services: r.items })));
    else setMasters(m => ({ ...m, services: [] }));
  }, [selectedCatId, vehicleClass]);

  function switchVehicleClass(cls) {
    setVehicleClass(cls);
    const filtered = masters.vehicleTypes.filter(t => cls === '2W' ? is2WType(t.name) : !is2WType(t.name));
    const autoType = filtered.length === 1 ? String(filtered[0].id) : '';
    setForm(f => ({ ...f, vehicle_type_id: autoType, make_id: '', model_id: '', body_type_id: '', segment_ids: [] }));
    setEngineCc(''); setCcCategoryId(null); setCcPreview(''); setNoCcWarning(false);
    setMasters(m => ({ ...m, makes: [], models: [] }));
  }

  async function handleEngineCcBlur() {
    const cc = parseInt(engineCc, 10);
    if (!cc || cc <= 0) { setCcCategoryId(null); setCcPreview(''); return; }
    try {
      const r = await api('/api/cc-categories/classify', { method: 'POST', body: { cc } });
      if (r.item) { setCcCategoryId(r.item.id); setCcPreview(`${r.item.name} · ${r.item.min_cc}–${r.item.max_cc} cc`); }
      else { setCcCategoryId(null); setCcPreview('No category matched'); }
    } catch { setCcCategoryId(null); setCcPreview(''); }
  }

  // ── Step 1 → Next validation ───────────────────────────────────────────────
  function handleNext() {
    setError(null);
    if (!form.mobile || form.mobile.length < 10) return setError('Valid 10-digit mobile number is required');
    setStep(2);
  }

  function addCategory(cat) {
    if (form.selectedCategories.find(c => c.category_id === cat.id)) return;
    setForm(f => ({
      ...f,
      selectedCategories: [...f.selectedCategories, { category_id: cat.id, name: cat.name }],
    }));
  }

  function removeCategory(catId) {
    setForm(f => ({ ...f, selectedCategories: f.selectedCategories.filter(c => c.category_id !== catId) }));
  }

  async function addService(service) {
    if (form.selectedServices.find(s => s.service_id === service.id)) return;
    setLoading(true);
    try {
      const body = {
        service_id: service.id,
        vehicle_type_id: form.vehicle_type_id ? Number(form.vehicle_type_id) : null,
        make_id: form.make_id ? Number(form.make_id) : null,
        model_id: form.model_id ? Number(form.model_id) : null,
        segment_id: form.segment_ids?.length ? Number(form.segment_ids[0]) : null,
        body_type_id: vehicleClass === '4W' && form.body_type_id ? Number(form.body_type_id) : null,
        cc_category_id: vehicleClass === '2W' && ccCategoryId ? ccCategoryId : null,
      };
      const r = await api('/api/leads/price-lookup', { method: 'POST', body });
      setForm(f => ({
        ...f,
        selectedServices: [...f.selectedServices, { service_id: service.id, name: service.name, price: r.price || 0 }],
      }));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  function removeService(sid) {
    setForm(f => ({ ...f, selectedServices: f.selectedServices.filter(s => s.service_id !== sid) }));
  }

  async function handleMobileBlur() {
    const mobile = form.mobile?.trim();
    if (!mobile || mobile.length < 10) { setDuplicates([]); setExistingCustomer(null); return; }
    setDupChecking(true);
    try {
      const [leadsRes, custRes] = await Promise.allSettled([
        api(`/api/leads/check-mobile?mobile=${encodeURIComponent(mobile)}`),
        api(`/api/customers/${encodeURIComponent(mobile)}`),
      ]);
      setDuplicates(leadsRes.status === 'fulfilled' ? (leadsRes.value.duplicates || []) : []);
      setExistingCustomer(custRes.status === 'fulfilled' ? custRes.value.item : null);
    } catch { setDuplicates([]); setExistingCustomer(null); }
    finally { setDupChecking(false); }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await api('/api/leads', {
        method: 'POST',
        body: {
          ...form,
          status: form.status || null,
          state_id: Number(form.state_id) || null,
          city_id: Number(form.city_id) || null,
          area_id: Number(form.area_id) || null,
          vehicle_type_id: Number(form.vehicle_type_id) || null,
          make_id: Number(form.make_id) || null,
          model_id: Number(form.model_id) || null,
          body_type_id: vehicleClass === '4W' ? (Number(form.body_type_id) || null) : null,
          cc_category_id: vehicleClass === '2W' ? (ccCategoryId || null) : null,
          segment_ids: form.segment_ids || [],
          services: form.selectedServices.map(s => ({ service_id: s.service_id, price: s.price })),
          category_ids: form.selectedCategories.map(c => c.category_id),
        },
      });
      onSuccess(); onClose();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  const totalPrice = form.selectedServices.reduce((sum, s) => sum + s.price, 0);
  const fw4wBodyTypes = masters.bodyTypes.filter(b => !is2WType(b.name));
  // Attach fuel-type badge (first letter of segment name) to each model option
  const modelsWithBadge = masters.models.map(m => {
    const seg = masters.segments.find(s => s.id === m.segment_id);
    return seg ? { ...m, badge: seg.name.charAt(0).toUpperCase() } : m;
  });

  // Global search across all services; fall back to category services when no search
  const filteredSvcs = serviceSearch
    ? allServices.filter(s => s.name.toLowerCase().includes(serviceSearch.toLowerCase()))
    : masters.services;

  // quick summary of vehicle for step-2 header breadcrumb
  const makeLabel = masters.makes.find(m => String(m.id) === String(form.make_id))?.name || '';
  const modelLabel = masters.models.find(m => String(m.id) === String(form.model_id))?.name || '';

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="nlm-overlay">
          <motion.div
            className="nlm-shell"
            initial={{ opacity: 0, scale: 0.96, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 24 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* ── header ──────────────────────────────────────────────── */}
            <header className="nlm-header">
              <div className="nlm-header-left">
                <div className="nlm-header-icon"><Zap size={17} /></div>
                <div>
                  <h2 className="nlm-title">Capture New Lead</h2>
                  <p className="nlm-sub">Register customer inquiry &amp; generate estimate</p>
                </div>
              </div>

              {/* Step progress */}
              <div className="nlm-steps">
                <div className={`nlm-step ${step >= 1 ? 'nlm-step--done' : ''} ${step === 1 ? 'nlm-step--active' : ''}`}>
                  <div className="nlm-step-dot">
                    {step > 1 ? <CheckCircle2 size={14} /> : '1'}
                  </div>
                  <span>Details</span>
                </div>
                <div className={`nlm-step-line ${step > 1 ? 'nlm-step-line--done' : ''}`} />
                <div className={`nlm-step ${step === 2 ? 'nlm-step--active' : ''}`}>
                  <div className="nlm-step-dot">2</div>
                  <span>Services</span>
                </div>
              </div>

              <button className="nlm-close" onClick={onClose}><X size={17} /></button>
            </header>

            {/* ── error ───────────────────────────────────────────────── */}
            <AnimatePresence>
              {error && (
                <motion.div
                  className="nlm-error"
                  initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                >
                  <div className="nlm-error-inner">
                    <Info size={14} /> {error}
                    <button onClick={() => setError(null)}><X size={13} /></button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── body ────────────────────────────────────────────────── */}
            <div className="nlm-body">
              <AnimatePresence mode="wait">

                {/* ══════ STEP 1: Customer + Location + Vehicle ══════ */}
                {step === 1 && (
                  <motion.div
                    key="step1"
                    initial={{ opacity: 0, x: 30 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -30 }}
                    transition={{ duration: 0.2 }}
                    className="nlm-step1"
                  >
                    {/* Customer */}
                    <div className="nlm-card">
                      <div className="nlm-card-hd">
                        <div className="nlm-card-icon" style={{ background: '#eff6ff', color: '#2563eb' }}><User size={15} /></div>
                        <span>Customer Information</span>
                      </div>
                      <div className="nlm-grid-3">
                        <div className="nlm-field">
                          <label>Full Name <span className="nlm-opt">(optional)</span></label>
                          <input className="nlm-input" placeholder="Enter customer name"
                            value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                        </div>
                        <div className="nlm-field">
                          <label>Mobile Number <em>*</em></label>
                          <input className="nlm-input" required placeholder="10-digit mobile"
                            value={form.mobile} maxLength={10}
                            onChange={e => {
                              const v = e.target.value.replace(/\D/g, '').slice(0, 10);
                              setDuplicates([]);
                              setForm(f => ({ ...f, mobile: v, ...(whatsappSame ? { whatsapp: v } : {}) }));
                            }}
                            onBlur={handleMobileBlur} />
                          {dupChecking && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, display: 'block' }}>Checking for duplicates…</span>}
                          {duplicates.length > 0 && (
                            <div style={{ marginTop: 6, background: '#fffbeb', border: '1.5px solid #fcd34d', borderRadius: 8, padding: '10px 12px' }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                                ⚠️ Duplicate mobile detected
                              </div>
                              {duplicates.map(d => (
                                <div key={d.id} style={{ fontSize: 12, color: '#78350f', marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <span><strong>{d.name || d.mobile}</strong> · {d.status || 'New Lead'} · by {d.created_by_name || '—'}</span>
                                  <button
                                    type="button"
                                    onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('open-lead-view', { detail: { id: d.id } })); }}
                                    style={{ fontSize: 11, fontWeight: 700, color: '#0891b2', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', textDecoration: 'underline' }}>
                                    View Lead →
                                  </button>
                                </div>
                              ))}
                              <div style={{ fontSize: 11, color: '#92400e', marginTop: 4 }}>You can still save this lead if it's intentional.</div>
                            </div>
                          )}
                          {existingCustomer && (
                            <div style={{ marginTop: 6, background: '#eff6ff', border: '1.5px solid #93c5fd', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: '#1e40af', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                                  👤 Returning customer
                                </div>
                                <div style={{ fontSize: 12, color: '#1d4ed8' }}>
                                  <strong>{existingCustomer.customer_name || existingCustomer.mobile}</strong>
                                  {existingCustomer.total_appointments > 0 && (
                                    <span style={{ color: '#3b82f6', marginLeft: 6 }}>· {existingCustomer.total_appointments} past visit{existingCustomer.total_appointments !== 1 ? 's' : ''}</span>
                                  )}
                                  {existingCustomer.last_appointment && (
                                    <span style={{ color: '#3b82f6', marginLeft: 6 }}>· Last seen {new Date(existingCustomer.last_appointment).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                  )}
                                </div>
                              </div>
                              <a
                                href={`/customers/${existingCustomer.mobile}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', whiteSpace: 'nowrap', textDecoration: 'underline' }}
                              >
                                View Customer →
                              </a>
                            </div>
                          )}
                        </div>
                        <div className="nlm-field">
                          <label className="nlm-wa-lbl">
                            <span>WhatsApp Number</span>
                            <label className="nlm-wa-check">
                              <input type="checkbox" checked={whatsappSame}
                                onChange={e => {
                                  setWhatsappSame(e.target.checked);
                                  if (e.target.checked) setForm(f => ({ ...f, whatsapp: f.mobile }));
                                  else setForm(f => ({ ...f, whatsapp: '' }));
                                }} />
                              Same as mobile
                            </label>
                          </label>
                          <input className="nlm-input" placeholder="10-digit WhatsApp"
                            value={whatsappSame ? form.mobile : form.whatsapp}
                            disabled={whatsappSame} maxLength={10}
                            onChange={e => {
                              const v = e.target.value.replace(/\D/g, '').slice(0, 10);
                              setForm(f => ({ ...f, whatsapp: v }));
                            }} />
                        </div>
                      </div>
                    </div>

                    {/* Location */}
                    <div className="nlm-card">
                      <div className="nlm-card-hd">
                        <div className="nlm-card-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}><MapPin size={15} /></div>
                        <span>Location Details</span>
                      </div>
                      <div className="nlm-grid-3">
                        <div className="nlm-field">
                          <label>State <span className="nlm-opt">(optional)</span></label>
                          <div className="nlm-sel-wrap">
                            <select className="nlm-select" value={form.state_id}
                              onChange={e => setForm({ ...form, state_id: e.target.value, city_id: '', area_id: '' })}>
                              <option value="">Select State</option>
                              {masters.states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                            <ChevronDown size={14} className="nlm-sel-icon" />
                          </div>
                        </div>
                        <div className="nlm-field">
                          <label>City <span className="nlm-opt">(optional)</span></label>
                          <div className="nlm-sel-wrap">
                            <select className="nlm-select" value={form.city_id}
                              onChange={e => setForm({ ...form, city_id: e.target.value, area_id: '' })}
                              disabled={!form.state_id}>
                              <option value="">Select City</option>
                              {masters.cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            <ChevronDown size={14} className="nlm-sel-icon" />
                          </div>
                        </div>
                        <div className="nlm-field">
                          <label>Area <span className="nlm-opt">(optional)</span></label>
                          <div className="nlm-sel-wrap">
                            <select className="nlm-select" value={form.area_id}
                              onChange={e => setForm({ ...form, area_id: e.target.value })}
                              disabled={!form.city_id}>
                              <option value="">Select Area</option>
                              {masters.areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </select>
                            <ChevronDown size={14} className="nlm-sel-icon" />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Vehicle */}
                    <div className="nlm-card">
                      <div className="nlm-card-hd">
                        <div className="nlm-card-icon" style={{ background: '#fef3c7', color: '#d97706' }}>
                          {vehicleClass === '2W' ? <Bike size={15} /> : <Car size={15} />}
                        </div>
                        <span>Vehicle Specification</span>
                        <div className="nlm-vc-toggle">
                          <button type="button"
                            className={`nlm-vc-btn${vehicleClass === '4W' ? ' nlm-vc-btn--on' : ''}`}
                            onClick={() => switchVehicleClass('4W')}>
                            <Car size={12} /> 4-Wheeler
                          </button>
                          <button type="button"
                            className={`nlm-vc-btn${vehicleClass === '2W' ? ' nlm-vc-btn--on' : ''}`}
                            onClick={() => switchVehicleClass('2W')}>
                            <Bike size={12} /> 2-Wheeler
                          </button>
                        </div>
                      </div>

                      <AnimatePresence mode="wait">
                        <motion.div key={vehicleClass}
                          initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.16 }}>

                          {/* 4W */}
                          {vehicleClass === '4W' && (
                            <div className="nlm-veh-grid">
                              {/* Make + Model */}
                              <div className="nlm-field">
                                <label>Make <span className="nlm-opt">(optional)</span></label>
                                <SearchableSelect
                                  value={form.make_id}
                                  onChange={v => setForm(f => ({ ...f, make_id: v, model_id: '' }))}
                                  options={masters.makes} placeholder="Select Make"
                                  disabled={!masters.makes.length}
                                  emptyMsg="No makes available" />
                              </div>
                              <div className="nlm-field">
                                <label>Model <span className="nlm-opt">(optional)</span></label>
                                <SearchableSelect
                                  value={form.model_id}
                                  onChange={v => setForm(f => ({ ...f, model_id: v }))}
                                  options={modelsWithBadge}
                                  placeholder={form.make_id ? 'Select Model' : 'Select a make first'}
                                  disabled={!form.make_id} loading={modelsLoading}
                                  emptyMsg="No models found for this make" />
                              </div>
                              {/* Body Type full width */}
                              <div className="nlm-field nlm-span-full">
                                <label>Body Type <span className="nlm-opt">(optional)</span></label>
                                <SearchableSelect
                                  value={form.body_type_id}
                                  onChange={v => setForm(f => ({ ...f, body_type_id: v, make_id: '', model_id: '' }))}
                                  options={fw4wBodyTypes} placeholder="Select Body Type"
                                  emptyMsg="No body types found" />
                              </div>
                              {/* Segment / Fuel Type — display only, below make/model/body type */}
                              <div className="nlm-field nlm-span-full">
                                <label>Segment / Fuel Type <span className="nlm-opt">(optional)</span></label>
                                <div className="nlm-chips">
                                  {masters.segments.map(s => {
                                    const on = form.segment_ids.includes(s.id);
                                    const ltr = s.name.charAt(0).toUpperCase();
                                    const bsc = segBadgeStyle(ltr);
                                    return (
                                      <span key={s.id}
                                        className={`nlm-chip${on ? ' nlm-chip--on' : ''}`}
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                                        <span style={{
                                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                                          fontSize: 10, fontWeight: 800,
                                          background: on ? 'rgba(255,255,255,0.25)' : bsc.bg,
                                          color: on ? '#fff' : bsc.color,
                                          border: `1.5px solid ${on ? 'rgba(255,255,255,0.4)' : bsc.border}`,
                                        }}>{ltr}</span>
                                        {s.name}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* 2W */}
                          {vehicleClass === '2W' && (
                            <div className="nlm-veh-grid">
                              {/* optional sub-type */}
                              {(() => {
                                const twTypes = masters.vehicleTypes.filter(t => is2WType(t.name));
                                return twTypes.length > 1 ? (
                                  <div className="nlm-field nlm-span-full">
                                    <label>Vehicle Sub-Type</label>
                                    <div className="nlm-sel-wrap">
                                      <select className="nlm-select" value={form.vehicle_type_id}
                                        onChange={e => setForm(f => ({ ...f, vehicle_type_id: e.target.value, make_id: '', model_id: '' }))}>
                                        <option value="">All 2-Wheelers</option>
                                        {twTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                      </select>
                                      <ChevronDown size={14} className="nlm-sel-icon" />
                                    </div>
                                  </div>
                                ) : null;
                              })()}
                              <div className="nlm-field">
                                <label>Make <span className="nlm-opt">(optional)</span></label>
                                <SearchableSelect
                                  value={form.make_id}
                                  onChange={v => setForm(f => ({ ...f, make_id: v, model_id: '' }))}
                                  options={masters.makes} placeholder="Select Make"
                                  disabled={!masters.makes.length} emptyMsg="No makes available" />
                              </div>
                              <div className="nlm-field">
                                <label>Model <span className="nlm-opt">(optional)</span></label>
                                <SearchableSelect
                                  value={form.model_id}
                                  onChange={v => setForm(f => ({ ...f, model_id: v }))}
                                  options={modelsWithBadge}
                                  placeholder={form.make_id ? 'Select Model' : 'Select a make first'}
                                  disabled={!form.make_id} loading={modelsLoading}
                                  emptyMsg="No models found for this make" />
                              </div>
                              {/* Engine CC */}
                              <div className="nlm-field nlm-span-full">
                                <label>Engine CC <span className="nlm-opt">(auto-filled from model)</span></label>
                                <div className="nlm-cc-row">
                                  <input type="number" min="1" max="9999" placeholder="e.g. 350"
                                    value={engineCc}
                                    className={`nlm-input${noCcWarning ? ' nlm-input--warn' : ''}`}
                                    style={{ maxWidth: 180 }}
                                    onChange={e => { setEngineCc(e.target.value); setCcCategoryId(null); setCcPreview(''); setNoCcWarning(false); }}
                                    onBlur={handleEngineCcBlur} />
                                  <AnimatePresence>
                                    {ccPreview && !noCcWarning && (
                                      <motion.span className="nlm-cc-badge"
                                        initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
                                        {ccPreview}
                                      </motion.span>
                                    )}
                                  </AnimatePresence>
                                </div>
                                {noCcWarning && (
                                  <div className="nlm-cc-warn">
                                    <Info size={13} />
                                    <span>No CC stored for this model — enter manually for correct pricing.</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </motion.div>
                      </AnimatePresence>
                    </div>

                    {/* Next button */}
                    <div className="nlm-step-footer">
                      <button type="button" className="nlm-btn-next" onClick={handleNext}>
                        Continue to Services
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* ══════ STEP 2: Services + Estimate ══════ */}
                {step === 2 && (
                  <motion.form
                    key="step2"
                    onSubmit={handleSubmit}
                    initial={{ opacity: 0, x: 30 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -30 }}
                    transition={{ duration: 0.2 }}
                    className="nlm-step2"
                  >
                    {/* vehicle breadcrumb */}
                    <div className="nlm-breadcrumb">
                      <span className="nlm-bc-tag">{vehicleClass === '4W' ? '4-Wheeler' : '2-Wheeler'}</span>
                      {makeLabel && <><ChevronRight size={13} /><span>{makeLabel}</span></>}
                      {modelLabel && <><ChevronRight size={13} /><span className="nlm-bc-model">{modelLabel}</span></>}
                    </div>

                    <div className="nlm-s2-layout">
                      {/* Left: Service picker */}
                      <div className="nlm-svc-panel">
                        <div className="nlm-card-hd" style={{ marginBottom: 0, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
                          <div className="nlm-card-icon" style={{ background: '#fdf4ff', color: '#9333ea' }}><Wrench size={15} /></div>
                          <span>Select Services</span>
                          <span className="nlm-vc-badge">{vehicleClass === '4W' ? '4W' : '2W'} services</span>
                        </div>

                        <div className="nlm-svc-shell">
                          {/* categories */}
                          <div className="nlm-cat-col">
                            <div className="nlm-cat-label">Categories</div>
                            {masters.categories.length === 0 && <div className="nlm-cat-empty">No categories</div>}
                            {masters.categories.map(c => {
                              const isCatAdded = !!form.selectedCategories.find(sc => sc.category_id === c.id);
                              return (
                                <div key={c.id} className="nlm-cat-row">
                                  <button type="button"
                                    className={`nlm-cat-btn${selectedCatId === String(c.id) ? ' nlm-cat-btn--on' : ''}`}
                                    onClick={() => setSelectedCatId(String(c.id))}>
                                    {c.name}
                                  </button>
                                  <button
                                    type="button"
                                    title={isCatAdded ? 'Category added' : 'Add category to lead'}
                                    className={`nlm-cat-add-btn${isCatAdded ? ' nlm-cat-add-btn--on' : ''}`}
                                    onClick={() => isCatAdded ? removeCategory(c.id) : addCategory(c)}
                                  >
                                    {isCatAdded ? <CheckCircle2 size={12} /> : <Plus size={12} />}
                                  </button>
                                </div>
                              );
                            })}
                          </div>

                          {/* services */}
                          <div className="nlm-svc-col">
                            <div className="nlm-svc-search">
                              <Search size={13} className="nlm-svc-si" />
                              <input className="nlm-svc-si-input" placeholder="Search all services…"
                                value={serviceSearch} onChange={e => { setServiceSearch(e.target.value); if (e.target.value) setSelectedCatId(''); }} />
                              {serviceSearch && (
                                <button type="button" className="nlm-svc-clear" onClick={() => setServiceSearch('')}>
                                  <X size={12} />
                                </button>
                              )}
                            </div>
                            <div className="nlm-svc-grid">
                              {!selectedCatId && !serviceSearch && <div className="nlm-svc-prompt">← Pick a category or search above</div>}
                              {(selectedCatId || serviceSearch) && filteredSvcs.length === 0 && (
                                <div className="nlm-svc-prompt">
                                  {serviceSearch ? `No match for "${serviceSearch}"` : 'No services here'}
                                </div>
                              )}
                              {filteredSvcs.map(s => {
                                const isSel = !!form.selectedServices.find(ss => ss.service_id === s.id);
                                return (
                                  <button key={s.id} type="button"
                                    className={`nlm-svc-btn${isSel ? ' nlm-svc-btn--sel' : ''}`}
                                    onClick={() => addService(s)}>
                                    <span className="nlm-svc-name">{s.name}</span>
                                    <span className="nlm-svc-icon">
                                      {isSel ? <CheckCircle2 size={14} /> : <Plus size={14} />}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Right: Summary + Notes + Actions */}
                      <div className="nlm-s2-right">
                        {/* Summary */}
                        <div className="nlm-summary">
                          <div className="nlm-summary-hd">
                            <span>Estimate Summary</span>
                            {(form.selectedServices.length + form.selectedCategories.length) > 0 && (
                              <span className="nlm-svc-count">
                                {form.selectedServices.length > 0 && `${form.selectedServices.length} service${form.selectedServices.length > 1 ? 's' : ''}`}
                                {form.selectedServices.length > 0 && form.selectedCategories.length > 0 && ' · '}
                                {form.selectedCategories.length > 0 && `${form.selectedCategories.length} categor${form.selectedCategories.length > 1 ? 'ies' : 'y'}`}
                              </span>
                            )}
                          </div>

                          {/* Category-only interests */}
                          {form.selectedCategories.length > 0 && (
                            <div className="nlm-cat-interests">
                              <div className="nlm-cat-interests-label">Category Interests</div>
                              {form.selectedCategories.map(c => (
                                <div key={c.category_id} className="nlm-svc-row nlm-cat-interest-row">
                                  <span className="nlm-cat-interest-badge">Category</span>
                                  <span className="nlm-svc-row-name">{c.name}</span>
                                  <button type="button" className="nlm-svc-del" onClick={() => removeCategory(c.category_id)}>
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="nlm-svc-list">
                            {form.selectedServices.length === 0 && form.selectedCategories.length === 0 && (
                              <div className="nlm-svc-empty">No services added yet</div>
                            )}
                            {form.selectedServices.length === 0 && form.selectedCategories.length > 0 && (
                              <div className="nlm-svc-empty" style={{ fontSize: 11, padding: '8px 0' }}>No specific services — team will call customer</div>
                            )}
                            {form.selectedServices.map(s => (
                              <div key={s.service_id} className="nlm-svc-row">
                                <span className="nlm-svc-row-name">{s.name}</span>
                                <strong className="nlm-svc-row-price">₹{s.price.toLocaleString()}</strong>
                                <button type="button" className="nlm-svc-del" onClick={() => removeService(s.service_id)}>
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                          <div className="nlm-total">
                            <span>Total</span>
                            <strong>₹{totalPrice.toLocaleString()}</strong>
                          </div>
                        </div>

                        {/* Status */}
                        <div className="nlm-notes">
                          <label>Lead Status <span className="nlm-opt">(optional)</span></label>
                          <div style={{ position: 'relative' }}>
                            <select
                              style={{
                                width: '100%', padding: '9px 32px 9px 12px',
                                border: '1.5px solid var(--border)', borderRadius: 9,
                                background: 'var(--bg)', color: form.status ? 'var(--text)' : 'var(--text-muted)',
                                fontSize: 14, appearance: 'none', cursor: 'pointer',
                              }}
                              value={form.status}
                              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                              <option value="">Auto (first active status)</option>
                              {statusList.map(s => (
                                <option key={s.id} value={s.name}>{s.name}</option>
                              ))}
                            </select>
                            <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                          </div>
                        </div>

                        {/* Lead Source */}
                        <div className="nlm-notes">
                          <label>Lead Source <span className="nlm-opt">(optional)</span></label>
                          <div style={{ position: 'relative' }}>
                            <select
                              style={{
                                width: '100%', padding: '9px 32px 9px 12px',
                                border: '1.5px solid var(--border)', borderRadius: 9,
                                background: 'var(--bg)', color: form.lead_source ? 'var(--text)' : 'var(--text-muted)',
                                fontSize: 14, appearance: 'none', cursor: 'pointer',
                              }}
                              value={form.lead_source}
                              onChange={e => setForm(f => ({ ...f, lead_source: e.target.value }))}>
                              <option value="">— How did they find us? —</option>
                              {(leadSources.length ? leadSources : LEAD_SOURCES).map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <ChevronDown size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                          </div>
                        </div>

                        {/* Notes */}
                        <div className="nlm-notes">
                          <label>Internal Notes <span className="nlm-opt">(optional)</span></label>
                          <textarea rows={3} placeholder="Any notes about this lead…"
                            value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
                        </div>

                        {/* Actions */}
                        <div className="nlm-s2-actions">
                          <button type="button" className="nlm-btn-back" onClick={() => { setStep(1); setError(null); }}>
                            <ArrowLeft size={15} /> Back
                          </button>
                          <button type="submit" className="nlm-btn-save"
                            disabled={loading}>
                            {loading ? <span className="nlm-spinner" /> : 'Save Lead'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>
            </div>
          </motion.div>

          {/* ── styles ──────────────────────────────────────────────────── */}
        </div>
      )}
    </AnimatePresence>
  );
}
