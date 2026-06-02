import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, Plus, ChevronDown, ChevronRight, Layers, Wrench,
  Tag, IndianRupee, Pencil, Trash2, X, Check, AlertCircle,
  CheckCircle2, ToggleLeft, ToggleRight, ChevronLeft, ChevronRight as ChRight,
  UploadCloud, FileSpreadsheet, File, Info, ChevronUp, AlertTriangle, SlidersHorizontal,
  Car, FileText, Download, Hash,
} from 'lucide-react';
import { api } from '../api/client.js';
import { useCan } from '../auth/AuthContext.jsx';
import '../styles/ServicesPage.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// ── Permission aliases ─────────────────────────────────────────────────────
function usePerms() {
  return {
    canViewService:    useCan('VIEW_SERVICE',         'MANAGE_MASTER_DATA'),
    canCreateService:  useCan('CREATE_SERVICE',        'MANAGE_MASTER_DATA'),
    canUpdateService:  useCan('UPDATE_SERVICE',        'MANAGE_MASTER_DATA'),
    canDeleteService:  useCan('DELETE_SERVICE',        'MANAGE_MASTER_DATA'),
    canViewPricing:    useCan('VIEW_PRICING_RULE',     'MANAGE_PRICING', 'MANAGE_MASTER_DATA'),
    canCreatePricing:  useCan('CREATE_PRICING_RULE',   'MANAGE_PRICING', 'MANAGE_MASTER_DATA'),
    canUpdatePricing:  useCan('UPDATE_PRICING_RULE',   'MANAGE_PRICING', 'MANAGE_MASTER_DATA'),
    canDeletePricing:  useCan('DELETE_PRICING_RULE',   'MANAGE_PRICING', 'MANAGE_MASTER_DATA'),
    canTogglePricing:  useCan('TOGGLE_PRICING_STATUS', 'UPDATE_PRICING_RULE', 'MANAGE_PRICING', 'MANAGE_MASTER_DATA'),
    canBulkPricing:    useCan('BULK_UPLOAD_PRICING',   'MANAGE_PRICING', 'MANAGE_MASTER_DATA'),
  };
}

// ── Toast ──────────────────────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState(null);
  const show = useCallback((msg, type = 'success') => {
    setToast({ msg, type, id: Date.now() });
    setTimeout(() => setToast(null), 4000);
  }, []);
  return { toast, show };
}

// ── Vehicle class helpers ──────────────────────────────────────────────────
function is2WType(name = '') {
  const n = name.toLowerCase();
  return n.includes('two') || n.includes('2w') || n.includes('2-w')
      || n.includes('bike') || n.includes('scoot') || n.includes('motor');
}

// ── Infer vehicle class from an existing pricing rule ────────────────────────
// Used when opening the edit modal for a rule that has vehicle_type_id set.
// The API returns vehicle_type_name alongside each rule, so we use that to
// decide whether to open the modal in 4W ('4W') or 2W ('2W') or universal mode.
function inferRuleVehicleClass(rule) {
  if (!rule?.vehicle_type_id) return 'both';
  const name = (rule.vehicle_type_name || '').toLowerCase();
  if (name.includes('two') || name.includes('2')) return '2W';
  return '4W';
}

// ── Rule type helpers ──────────────────────────────────────────────────────
// Returns a badge colour for any rule_type string, including combinations
// like "Make + Segment" or "Model + Body Type".
// Priority: Model > Make > Segment > Body Type > Universal
function getRuleTypeColor(ruleType) {
  if (!ruleType || ruleType === 'Universal') return { bg: '#f3f4f6', color: '#374151' };
  if (ruleType.includes('Model'))     return { bg: '#ede9fe', color: '#6d28d9' };
  if (ruleType.includes('Make'))      return { bg: '#dbeafe', color: '#1d4ed8' };
  if (ruleType.includes('Segment'))   return { bg: '#dcfce7', color: '#166534' };
  if (ruleType.includes('Body Type')) return { bg: '#fef9c3', color: '#854d0e' };
  return { bg: '#f3f4f6', color: '#374151' };
}

// Live "Applies To" preview used inside the pricing rule modal
function previewAppliesTo(form, { vehicleTypes, makes, models, segments, bodyTypes }) {
  const parts = [];
  const vtObj  = vehicleTypes.find(v => String(v.id) === String(form.vehicle_type_id));
  const mkObj  = makes.find(m => String(m.id) === String(form.make_id));
  const moObj  = models.find(m => String(m.id) === String(form.model_id));
  const segObj = segments.find(s => String(s.id) === String(form.segment_id));
  const btObj  = bodyTypes.find(b => String(b.id) === String(form.body_type_id));

  if (form.model_id && mkObj && moObj) parts.push(`${mkObj.name} ${moObj.name}`);
  else if (form.make_id && mkObj)      parts.push(mkObj.name);
  if (form.segment_id   && segObj)     parts.push(segObj.name);
  if (form.body_type_id && btObj)      parts.push(btObj.name);

  if (parts.length === 0) {
    return vtObj ? `${vtObj.name} Vehicles` : 'All Vehicles';
  }
  return vtObj ? `${vtObj.name} → ${parts.join(' · ')}` : parts.join(' · ');
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════
export default function ServicesPage() {
  const P = usePerms();
  const { toast, show: showToast } = useToast();

  // Left panel state
  const [categories,   setCategories]   = useState([]);
  const [expanded,     setExpanded]     = useState({});   // { catId: bool }
  const [services,     setServices]     = useState({});   // { catId: [...] }
  const [catSearch,    setCatSearch]    = useState('');
  const [loadingCats,  setLoadingCats]  = useState(true);

  // Right panel state
  const [selService,  setSelService]  = useState(null);
  const [selCategory, setSelCategory] = useState(null); // category whose rules are being viewed
  const [activeTab,   setActiveTab]   = useState('overview'); // 'overview' | 'pricing'

  // Modals
  const [catModal,     setCatModal]     = useState(null);  // null | { mode:'create'|'edit', item? }
  const [svcModal,     setSvcModal]     = useState(null);  // null | { mode:'create'|'edit', catId?, item? }
  const [deleteModal,  setDeleteModal]  = useState(null);  // null | { type, item }
  const [pricingModal, setPricingModal] = useState(null);  // null | { mode:'create'|'edit', rule? }
  const [showBulk,     setShowBulk]     = useState(false);

  // ── Load categories ──────────────────────────────────────────────────────
  const loadCategories = useCallback(async () => {
    setLoadingCats(true);
    try {
      const r = await api('/api/services/categories');
      setCategories(r.items);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoadingCats(false); }
  }, [showToast]);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  // ── Load services for a category ─────────────────────────────────────────
  const loadServices = useCallback(async (catId) => {
    if (services[catId]) return; // already loaded
    try {
      const r = await api(`/api/services/services?category_id=${catId}`);
      setServices(prev => ({ ...prev, [catId]: r.items }));
    } catch (e) { showToast(e.message, 'error'); }
  }, [services, showToast]);

  const refreshServices = useCallback(async (catId) => {
    try {
      const r = await api(`/api/services/services?category_id=${catId}`);
      setServices(prev => ({ ...prev, [catId]: r.items }));
    } catch (e) { showToast(e.message, 'error'); }
  }, [showToast]);

  // ── Expand / collapse category ───────────────────────────────────────────
  function toggleCat(cat) {
    const open = !expanded[cat.id];
    setExpanded(prev => ({ ...prev, [cat.id]: open }));
    if (open) loadServices(cat.id);
  }

  // ── Select a service (switch right panel) ─────────────────────────────────
  function selectService(svc) {
    setSelService(svc);
    setSelCategory(null);
    setActiveTab('overview');
    setShowBulk(false);
  }

  // ── Open category rules in right panel ────────────────────────────────────
  function openCategoryRules(cat, e) {
    e.stopPropagation();
    setSelCategory(cat);
    setSelService(null);
    setShowBulk(false);
    setPricingModal(null);
  }

  // ── Update a category in local state (used after pricing_config save) ─────
  function updateCategoryLocal(updated) {
    setCategories(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c));
    setSelCategory(prev => prev?.id === updated.id ? { ...prev, ...updated } : prev);
  }

  // ── Category CRUD ─────────────────────────────────────────────────────────
  async function saveCategory(data) {
    if (catModal.mode === 'create') {
      await api('/api/services/categories', { method: 'POST', body: data });
      showToast('Category created');
    } else {
      await api(`/api/services/categories/${catModal.item.id}`, { method: 'PATCH', body: data });
      showToast('Category updated');
    }
    setCatModal(null);
    loadCategories();
  }

  async function toggleCatStatus(cat, e) {
    e.stopPropagation();
    await api(`/api/services/categories/${cat.id}`, { method: 'PATCH', body: { is_active: !cat.is_active } });
    loadCategories();
  }

  async function deleteCategory(cat) {
    await api(`/api/services/categories/${cat.id}`, { method: 'DELETE' });
    showToast('Category deleted');
    setDeleteModal(null);
    loadCategories();
    if (selService?.category_id === cat.id) setSelService(null);
    if (selCategory?.id === cat.id) setSelCategory(null);
  }

  // ── Service CRUD ──────────────────────────────────────────────────────────
  async function saveService(data) {
    if (svcModal.mode === 'create') {
      const r = await api('/api/services/services', { method: 'POST', body: { category_id: svcModal.catId, ...data } });
      showToast('Service created');
      refreshServices(svcModal.catId);
      selectService(r.item);
    } else {
      const r = await api(`/api/services/services/${svcModal.item.id}`, { method: 'PATCH', body: data });
      showToast('Service updated');
      setSelService(r.item);
      refreshServices(r.item.category_id);
    }
    setSvcModal(null);
  }

  async function toggleServiceStatus(svc, e) {
    e?.stopPropagation();
    const r = await api(`/api/services/services/${svc.id}`, { method: 'PATCH', body: { is_active: !svc.is_active } });
    if (selService?.id === svc.id) setSelService(r.item);
    refreshServices(svc.category_id);
  }

  async function deleteService(svc) {
    await api(`/api/services/services/${svc.id}`, { method: 'DELETE' });
    showToast('Service deleted');
    setDeleteModal(null);
    if (selService?.id === svc.id) setSelService(null);
    refreshServices(svc.category_id);
    loadCategories();
  }

  // ── Filter categories ──────────────────────────────────────────────────────
  const filteredCats = categories.filter(c =>
    c.name.toLowerCase().includes(catSearch.toLowerCase())
  );

  // ── CSV download helper ───────────────────────────────────────────────────
  function downloadCSV(rows, filename) {
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
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Export services CSV ───────────────────────────────────────────────────
  async function exportServices() {
    try {
      const r = await api('/api/services/services?limit=9999');
      const items = r.items || [];
      if (!items.length) { alert('No services to export.'); return; }
      downloadCSV(items.map(s => ({
        Category:              s.category_name || '',
        Service:               s.name          || '',
        'SAC Code':            s.sac_code      || '',
        'Base Price':          s.base_price != null ? s.base_price : '',
        'GST %':               s.gst_percent != null ? s.gst_percent : '',
        'Vehicle Class':       s.vehicle_class || 'All',
        Active:                s.is_active ? 'Yes' : 'No',
        Description:           s.description  || '',
      })), 'services.csv');
    } catch (e) { alert('Export failed: ' + e.message); }
  }

  // ── Export pricing rules CSV ──────────────────────────────────────────────
  async function exportPricing() {
    try {
      const r = await api('/api/pricing');
      const items = r.items || [];
      if (!items.length) { alert('No pricing rules to export.'); return; }
      downloadCSV(items.map(p => ({
        Service:      p.service_name   || '',
        Category:     p.category_name  || '',
        'Vehicle Type': p.vehicle_type_name || 'All',
        'Rule Type':  p.rule_type      || '',
        Make:         p.make_name      || '',
        Model:        p.model_name     || '',
        Segment:      p.segment_name   || '',
        'Body Type':  p.body_type_name || '',
        'Price (₹)':  p.price          || '',
        Active:       p.is_active ? 'Yes' : 'No',
      })), 'pricing-rules.csv');
    } catch (e) { alert('Export failed: ' + e.message); }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="sp-page">
      {/* Toast */}
      {toast && (
        <div className={`sp-toast sp-toast--${toast.type}`} key={toast.id}>
          {toast.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          {toast.msg}
        </div>
      )}

      <header className="page-header">
        <div>
          <h2>Services &amp; Pricing</h2>
          <p>Manage your service catalogue and pricing rules in one place.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="button secondary" onClick={exportServices}>
            <Download size={15} /> Export Services
          </button>
          <button className="button secondary" onClick={exportPricing}>
            <Download size={15} /> Export Pricing
          </button>
          {P.canCreateService && (
            <button className="button primary" onClick={() => setCatModal({ mode: 'create' })}>
              <Plus size={16} /> New Category
            </button>
          )}
        </div>
      </header>

      <div className="sp-layout">
        {/* ══ LEFT PANEL ══════════════════════════════════════════════════ */}
        <aside className="sp-left">
          <div className="sp-search-wrap">
            <Search size={14} className="sp-search-icon" />
            <input
              className="sp-search-input"
              placeholder="Search categories…"
              value={catSearch}
              onChange={e => setCatSearch(e.target.value)}
            />
            {catSearch && (
              <button className="sp-search-clear" onClick={() => setCatSearch('')}><X size={12} /></button>
            )}
          </div>

          <div className="sp-cat-list">
            {loadingCats ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="sp-skel-cat" />
              ))
            ) : filteredCats.length === 0 ? (
              <div className="sp-empty-left">No categories found</div>
            ) : filteredCats.map(cat => (
              <div key={cat.id} className="sp-cat-block">
                {/* Category row */}
                <div
                  className={`sp-cat-row ${!cat.is_active ? 'sp-inactive' : ''}`}
                  onClick={() => toggleCat(cat)}
                >
                  <span className="sp-cat-chevron">
                    {expanded[cat.id] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </span>
                  <Layers size={13} className="sp-cat-icon" />
                  <span className="sp-cat-name">{cat.name}</span>
                  <span className="sp-cat-count">{cat.service_count ?? 0}</span>
                  <div className="sp-cat-actions" onClick={e => e.stopPropagation()}>
                    {P.canViewPricing && (
                      <button
                        className={`sp-act-btn ${selCategory?.id === cat.id ? 'sp-act-btn--active' : ''}`}
                        title="Category pricing rules"
                        onClick={e => openCategoryRules(cat, e)}
                      >
                        <IndianRupee size={12} />
                      </button>
                    )}
                    {P.canUpdateService && (
                      <button className="sp-act-btn" title="Edit category" onClick={() => setCatModal({ mode: 'edit', item: cat })}>
                        <Pencil size={12} />
                      </button>
                    )}
                    {P.canUpdateService && (
                      <button className="sp-act-btn" title="Toggle status" onClick={e => toggleCatStatus(cat, e)}>
                        {cat.is_active ? <ToggleRight size={14} color="var(--ok,#16a34a)" /> : <ToggleLeft size={14} />}
                      </button>
                    )}
                    {P.canDeleteService && (
                      <button className="sp-act-btn sp-act-danger" title="Delete category" onClick={() => setDeleteModal({ type: 'category', item: cat })}>
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Service items */}
                {expanded[cat.id] && (
                  <div className="sp-svc-list">
                    {(services[cat.id] || []).map(svc => (
                      <div
                        key={svc.id}
                        className={`sp-svc-row ${selService?.id === svc.id ? 'sp-svc-row--active' : ''} ${!svc.is_active ? 'sp-inactive' : ''}`}
                        onClick={() => selectService(svc)}
                      >
                        <Wrench size={12} className="sp-svc-icon" />
                        <span className="sp-svc-name">{svc.name}</span>
                        {svc.vehicle_class && svc.vehicle_class !== 'both' && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                            background: svc.vehicle_class === '4W' ? '#dbeafe' : '#dcfce7',
                            color:      svc.vehicle_class === '4W' ? '#1d4ed8' : '#166534',
                            flexShrink: 0,
                          }}>
                            {svc.vehicle_class === '4W' ? '4W' : '2W'}
                          </span>
                        )}
                        <div className="sp-cat-actions" onClick={e => e.stopPropagation()}>
                          {P.canUpdateService && (
                            <button className="sp-act-btn" title="Toggle" onClick={e => toggleServiceStatus(svc, e)}>
                              {svc.is_active ? <ToggleRight size={13} color="var(--ok,#16a34a)" /> : <ToggleLeft size={13} />}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {P.canCreateService && (
                      <button
                        className="sp-add-svc-btn"
                        onClick={() => setSvcModal({ mode: 'create', catId: cat.id })}
                      >
                        <Plus size={12} /> Add Service
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>

        {/* ══ RIGHT PANEL ═════════════════════════════════════════════════ */}
        <main className="sp-right">
          {/* ── Category rules view ──────────────────────────────────────── */}
          {selCategory && !selService && (
            <CategoryPricingPanel
              category={selCategory}
              perms={P}
              showToast={showToast}
              pricingModal={pricingModal}
              setPricingModal={setPricingModal}
              showBulk={showBulk}
              setShowBulk={setShowBulk}
              onUpdateCategory={updateCategoryLocal}
            />
          )}

          {/* ── Service view ─────────────────────────────────────────────── */}
          {selService && (
            <>
              {/* Tabs */}
              <div className="sp-tabs">
                <button
                  className={`sp-tab ${activeTab === 'overview' ? 'sp-tab--active' : ''}`}
                  onClick={() => setActiveTab('overview')}
                >
                  <Tag size={14} /> Overview
                </button>
                {P.canViewPricing && (
                  <button
                    className={`sp-tab ${activeTab === 'pricing' ? 'sp-tab--active' : ''}`}
                    onClick={() => setActiveTab('pricing')}
                  >
                    <IndianRupee size={14} /> Pricing
                  </button>
                )}
              </div>

              {/* ── Overview tab ─────────────────────────────────────────── */}
              {activeTab === 'overview' && (
                <OverviewTab
                  service={selService}
                  perms={P}
                  onEdit={() => setSvcModal({ mode: 'edit', item: selService })}
                  onDelete={() => setDeleteModal({ type: 'service', item: selService })}
                  onToggle={toggleServiceStatus}
                />
              )}

              {/* ── Pricing tab ──────────────────────────────────────────── */}
              {activeTab === 'pricing' && P.canViewPricing && (
                <PricingTab
                  service={selService}
                  category={categories.find(c => c.id === selService.category_id)}
                  perms={P}
                  showToast={showToast}
                  pricingModal={pricingModal}
                  setPricingModal={setPricingModal}
                  showBulk={showBulk}
                  setShowBulk={setShowBulk}
                />
              )}
            </>
          )}

          {/* ── Empty state ──────────────────────────────────────────────── */}
          {!selService && !selCategory && (
            <div className="sp-empty-right">
              <Wrench size={40} />
              <h3>Select a service</h3>
              <p>Choose a service from the left to view details and pricing, or click <IndianRupee size={13} style={{display:'inline',verticalAlign:'middle'}} /> on a category to set category-wide pricing rules.</p>
            </div>
          )}
        </main>
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────── */}
      {catModal && (
        <CategoryModal
          mode={catModal.mode}
          item={catModal.item}
          onSave={saveCategory}
          onClose={() => setCatModal(null)}
        />
      )}
      {svcModal && (
        <ServiceModal
          mode={svcModal.mode}
          item={svcModal.item}
          categories={categories}
          defaultCatId={svcModal.catId}
          onSave={saveService}
          onClose={() => setSvcModal(null)}
        />
      )}
      {deleteModal && (
        <DeleteModal
          type={deleteModal.type}
          item={deleteModal.item}
          onConfirm={() =>
            deleteModal.type === 'category'
              ? deleteCategory(deleteModal.item)
              : deleteService(deleteModal.item)
          }
          onClose={() => setDeleteModal(null)}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ══════════════════════════════════════════════════════════════════════════
function OverviewTab({ service: svc, perms: P, onEdit, onDelete, onToggle }) {
  const vcLabel = svc.vehicle_class === '4W' ? '4W Only'
                : svc.vehicle_class === '2W' ? '2W Only'
                : 'All Vehicles';
  const vcIcon  = svc.vehicle_class === '4W' ? '🚗'
                : svc.vehicle_class === '2W' ? '🏍️'
                : '🚗🏍️';
  const vcColors = svc.vehicle_class === '4W'
    ? { bg: '#dbeafe', color: '#1d4ed8', border: '#bfdbfe' }
    : svc.vehicle_class === '2W'
    ? { bg: '#dcfce7', color: '#166534', border: '#86efac' }
    : { bg: '#f3f4f6', color: '#374151', border: '#e5e7eb' };

  return (
    <div className="sp-ov">
      {/* ── Hero banner ── */}
      <div className="sp-ov-hero">
        <div className="sp-ov-hero-icon">
          <Wrench size={26} strokeWidth={1.8} />
        </div>
        <div className="sp-ov-hero-info">
          <div className="sp-ov-hero-top">
            <h3 className="sp-ov-title">{svc.name}</h3>
          </div>
          <div className="sp-ov-hero-meta">
            <span className="sp-ov-cat-chip">
              <Tag size={11} /> {svc.category_name}
            </span>
            <span className="sp-ov-vc-chip" style={{ background: vcColors.bg, color: vcColors.color, borderColor: vcColors.border }}>
              {vcIcon} {vcLabel}
            </span>
          </div>
        </div>
        <div className="sp-ov-hero-actions">
          {P.canUpdateService && (
            <button className="sp-ov-action-btn sp-ov-action-btn--toggle" onClick={() => onToggle(svc)} title={svc.is_active ? 'Deactivate' : 'Activate'}>
              {svc.is_active ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
              {svc.is_active ? 'Active' : 'Inactive'}
            </button>
          )}
          {P.canUpdateService && (
            <button className="sp-ov-action-btn sp-ov-action-btn--edit" onClick={onEdit}>
              <Pencil size={13} /> Edit
            </button>
          )}
          {P.canDeleteService && (
            <button className="sp-ov-action-btn sp-ov-action-btn--del" onClick={onDelete}>
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>
      </div>

      {/* ── Description card ── */}
      <div className="sp-ov-section">
        <div className="sp-ov-section-label"><FileText size={13} /> Description</div>
        <p className="sp-ov-desc">
          {svc.description || <span className="sp-ov-empty">No description provided for this service.</span>}
        </p>
      </div>

      {/* ── Info chips row ── */}
      <div className="sp-ov-info-row">
        <div className="sp-ov-info-card">
          <div className="sp-ov-info-card-label"><Layers size={12} /> Category</div>
          <div className="sp-ov-info-card-val">{svc.category_name}</div>
        </div>
        <div className="sp-ov-info-card">
          <div className="sp-ov-info-card-label"><Check size={12} /> Status</div>
          <div className="sp-ov-info-card-val">
            <span className={`sp-status-pill ${svc.is_active ? 'sp-status-pill--active' : 'sp-status-pill--inactive'}`}>
              {svc.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
        <div className="sp-ov-info-card">
          <div className="sp-ov-info-card-label"><Car size={12} /> Applies To</div>
          <div className="sp-ov-info-card-val">
            <span className="sp-ov-vc-chip" style={{ background: vcColors.bg, color: vcColors.color, borderColor: vcColors.border }}>
              {vcIcon} {vcLabel}
            </span>
          </div>
        </div>
        <div className="sp-ov-info-card">
          <div className="sp-ov-info-card-label"><IndianRupee size={12} /> GST %</div>
          <div className="sp-ov-info-card-val">
            {svc.gst_percent != null ? `${Number(svc.gst_percent).toFixed(2)}%` : <span className="sp-ov-empty">—</span>}
          </div>
        </div>
        <div className="sp-ov-info-card">
          <div className="sp-ov-info-card-label"><Hash size={12} /> SAC Code</div>
          <div className="sp-ov-info-card-val">
            {svc.sac_code
              ? <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{svc.sac_code}</span>
              : <span className="sp-ov-empty">—</span>
            }
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// PRICING TAB
// ══════════════════════════════════════════════════════════════════════════
// ── Shared pricing rules list (used by both PricingTab and CategoryPricingPanel) ──
function PricingRulesList({ targetId, targetParam, targetName, serviceCategoryId, pricingConfig, perms: P, showToast, pricingModal, setPricingModal, showBulk, setShowBulk, service }) {
  const hasSmartForm = (pricingConfig || []).length > 0;
  const [smartModal, setSmartModal] = useState(false);
  const [rules,        setRules]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [ruleFilter,   setRuleFilter]   = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page,         setPage]         = useState(1);
  const [catRules,     setCatRules]     = useState([]); // category-level fallback rules
  const [showCatRules, setShowCatRules] = useState(false);
  const LIMIT = 50;

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ [targetParam]: targetId, page, limit: LIMIT });
      if (statusFilter) params.set('is_active', statusFilter === 'active' ? 'true' : 'false');
      const r = await api(`/api/pricing?${params}`);
      setRules(r.items || []);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [targetId, targetParam, page, statusFilter, showToast]);

  useEffect(() => { loadRules(); }, [loadRules]);
  useEffect(() => { setPage(1); setSearch(''); setRuleFilter(''); setStatusFilter(''); }, [targetId]);

  // Fetch category-level fallback rules when viewing a service's pricing tab
  useEffect(() => {
    if (targetParam !== 'service_id' || !serviceCategoryId) return;
    api(`/api/pricing?category_id=${serviceCategoryId}&limit=50`)
      .then(r => setCatRules(r.items || []))
      .catch(() => {});
  }, [targetParam, serviceCategoryId]);

  async function handleDelete(rule) {
    if (!window.confirm('Delete this pricing rule?')) return;
    try {
      await api(`/api/pricing/${rule.id}`, { method: 'DELETE' });
      showToast('Pricing rule deleted');
      loadRules();
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function handleToggle(rule) {
    try {
      await api(`/api/pricing/${rule.id}/status`, { method: 'PATCH', body: { is_active: !rule.is_active } });
      loadRules();
    } catch (e) { showToast(e.message, 'error'); }
  }

  // Client-side filter by search + rule type (already paginated server-side by status)
  const filtered = rules.filter(r => {
    const q = search.toLowerCase();
    const matchSearch = !q || r.applies_to.toLowerCase().includes(q) || r.service_name?.toLowerCase().includes(q);
    const matchType   = !ruleFilter || r.rule_type === ruleFilter || r.rule_type?.includes(ruleFilter);
    return matchSearch && matchType;
  });

  return (
    <div className="sp-pricing">
      {/* Category fallback rules banner */}
      {targetParam === 'service_id' && catRules.length > 0 && (
        <div className="sp-cat-fallback-banner">
          <Info size={13} />
          <span>
            This service's category has <strong>{catRules.length} fallback rule{catRules.length !== 1 ? 's' : ''}</strong> — used when no service-specific rule matches.
          </span>
          <button className="sp-link-btn" onClick={() => setShowCatRules(v => !v)}>
            {showCatRules ? 'Hide' : 'Show'} category rules
          </button>
        </div>
      )}

      {/* Inline category rules table */}
      {showCatRules && catRules.length > 0 && (
        <div className="sp-cat-fallback-table">
          <table className="sp-pricing-table">
            <thead>
              <tr><th>Applies To</th><th>Rule Type</th><th className="text-right">Price</th><th>Status</th></tr>
            </thead>
            <tbody>
              {catRules.map(rule => {
                const tc = getRuleTypeColor(rule.rule_type);
                return (
                  <tr key={rule.id} className={!rule.is_active ? 'sp-row-inactive' : ''}>
                    <td><strong>{rule.applies_to}</strong></td>
                    <td><span className="sp-type-badge" style={{ background: tc.bg, color: tc.color }}>{rule.rule_type}</span></td>
                    <td className="text-right sp-price-col">₹ {Number(rule.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td>{rule.is_active ? <span style={{color:'#16a34a',fontSize:12,fontWeight:600}}>Active</span> : <span style={{color:'var(--text-muted)',fontSize:12}}>Inactive</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Toolbar */}
      <div className="sp-pricing-toolbar">
        <div className="sp-pt-left">
          <div className="sp-search-wrap sp-search-wrap--sm">
            <Search size={13} className="sp-search-icon" />
            <input
              className="sp-search-input"
              placeholder="Search rules…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && <button className="sp-search-clear" onClick={() => setSearch('')}><X size={12} /></button>}
          </div>
          <select className="sp-filter-sel" value={ruleFilter} onChange={e => setRuleFilter(e.target.value)}>
            <option value="">All Types</option>
            <option value="Universal">Universal</option>
            <option value="Body Type">Body Type</option>
            <option value="Segment">Segment</option>
            <option value="Make">Make</option>
            <option value="Model">Model</option>
          </select>
          <select className="sp-filter-sel" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="sp-pt-right">
          {P.canBulkPricing && (
            <button className="button secondary" onClick={() => setShowBulk(v => !v)}>
              <UploadCloud size={14} /> Bulk Upload
            </button>
          )}
          {P.canCreatePricing && (
            <button className="button primary" onClick={() => hasSmartForm ? setSmartModal(true) : setPricingModal({ mode: 'create', [targetParam]: targetId })}>
              <Plus size={14} /> Add Rule
            </button>
          )}
        </div>
      </div>

      {/* Bulk upload panel */}
      {showBulk && (
        <PricingBulkPanel
          service={service}
          onClose={() => setShowBulk(false)}
          onSuccess={() => { setShowBulk(false); loadRules(); }}
          showToast={showToast}
        />
      )}

      {/* Table */}
      <div className="sp-pricing-table-wrap">
        <table className="sp-pricing-table">
          <thead>
            <tr>
              <th>Applies To</th>
              <th>Rule Type</th>
              <th className="text-right">Price</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j}><div className="sp-skel-cell" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="sp-table-empty">
                  {rules.length === 0
                    ? (P.canCreatePricing
                        ? <>No pricing rules yet. <button className="sp-link-btn" onClick={() => hasSmartForm ? setSmartModal(true) : setPricingModal({ mode: 'create', [targetParam]: targetId })}>Add the first rule</button>.</>
                        : 'No pricing rules configured.')
                    : 'No rules match your filters.'}
                </td>
              </tr>
            ) : filtered.map((rule, i) => {
              const tc = getRuleTypeColor(rule.rule_type);
              return (
                <tr key={rule.id} className={!rule.is_active ? 'sp-row-inactive' : ''}>
                  <td className="sp-applies-col">
                    <strong>{rule.applies_to}</strong>
                  </td>
                  <td>
                    <span className="sp-type-badge" style={{ background: tc.bg, color: tc.color }}>
                      {rule.rule_type}
                    </span>
                  </td>
                  <td className="text-right sp-price-col">
                    ₹ {Number(rule.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td>
                    <button
                      className="sp-toggle-btn"
                      disabled={!P.canTogglePricing}
                      onClick={() => handleToggle(rule)}
                      title="Toggle status"
                    >
                      {rule.is_active
                        ? <ToggleRight size={20} color="var(--ok,#16a34a)" />
                        : <ToggleLeft size={20} />}
                    </button>
                  </td>
                  <td className="sp-actions-col">
                    {P.canUpdatePricing && (
                      <button className="sp-act-btn" title="Edit" onClick={() => setPricingModal({ mode: 'edit', rule, vehicleClass: inferRuleVehicleClass(rule) })}>
                        <Pencil size={14} />
                      </button>
                    )}
                    {P.canDeletePricing && (
                      <button className="sp-act-btn sp-act-danger" title="Delete" onClick={() => handleDelete(rule)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="sp-pagination">
        <span className="sp-page-info">{filtered.length} rule{filtered.length !== 1 ? 's' : ''}</span>
        <div className="sp-page-btns">
          <button className="sp-page-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft size={14} />
          </button>
          <span>Page {page}</span>
          <button className="sp-page-btn" disabled={rules.length < LIMIT} onClick={() => setPage(p => p + 1)}>
            <ChRight size={14} />
          </button>
        </div>
      </div>

      {/* Smart pricing modal — used when category has a pricing config set */}
      {smartModal && (
        <SmartPricingModal
          config={pricingConfig}
          serviceId={targetParam === 'service_id' ? targetId : null}
          categoryId={targetParam === 'category_id' ? targetId : null}
          targetName={targetName}
          vehicleClass={service?.vehicle_class || 'both'}
          onClose={() => setSmartModal(false)}
          onSaved={() => { setSmartModal(false); loadRules(); showToast('Rule(s) created'); }}
          showToast={showToast}
        />
      )}

      {/* Manual pricing modal — for editing existing rules or when no config set */}
      {pricingModal && (
        <PricingRuleModal
          mode={pricingModal.mode}
          rule={pricingModal.rule}
          serviceId={pricingModal.service_id || (targetParam === 'service_id' ? targetId : null)}
          categoryId={pricingModal.category_id || (targetParam === 'category_id' ? targetId : null)}
          targetName={targetName}
          vehicleClass={pricingModal.vehicleClass || service?.vehicle_class || 'both'}
          onClose={() => setPricingModal(null)}
          onSaved={() => { setPricingModal(null); loadRules(); showToast(pricingModal.mode === 'create' ? 'Rule created' : 'Rule updated'); }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

function PricingTab({ service, category, perms: P, showToast, pricingModal, setPricingModal, showBulk, setShowBulk }) {
  const config = category?.pricing_config || [];

  return (
    <PricingRulesList
      targetId={service.id}
      targetParam="service_id"
      targetName={service.name}
      serviceCategoryId={service.category_id}
      pricingConfig={config}
      perms={P}
      showToast={showToast}
      pricingModal={pricingModal}
      setPricingModal={setPricingModal}
      showBulk={showBulk}
      setShowBulk={setShowBulk}
      service={service}
    />
  );
}

// ══════════════════════════════════════════════════════════════════════════
// CATEGORY PRICING PANEL
// ══════════════════════════════════════════════════════════════════════════
const ALL_DIMS = [
  { key: 'vehicle_type', label: 'Vehicle Type' },
  { key: 'body_type',    label: 'Body Type'    },
  { key: 'segment',      label: 'Segment'      },
  { key: 'make',         label: 'Make'         },
  { key: 'model',        label: 'Model'        },
];

function CategoryPricingPanel({ category, perms: P, showToast, pricingModal, setPricingModal, showBulk, setShowBulk, onUpdateCategory }) {
  const [config,   setConfig]   = useState(category.pricing_config || []);
  const [dimModal, setDimModal] = useState(false);

  useEffect(() => { setConfig(category.pricing_config || []); }, [category.id]);

  async function saveDimConfig(newConfig) {
    const r = await api(`/api/services/categories/${category.id}`, {
      method: 'PATCH', body: { pricing_config: newConfig },
    });
    setConfig(r.item.pricing_config || []);
    onUpdateCategory?.(r.item);
    showToast('Pricing dimensions saved');
  }

  const configLabel = config.length === 0
    ? null
    : config.map(k => ALL_DIMS.find(d => d.key === k)?.label || k).join(' + ');

  return (
    <div className="sp-cat-pricing-wrap">
      <div className="sp-cat-pricing-header">
        <div className="sp-cat-pricing-title-row">
          <div className="sp-cat-pricing-title">
            <Layers size={16} />
            <span>{category.name}</span>
            <span className="sp-cat-pricing-badge">Category Rules</span>
          </div>
          {P.canUpdatePricing && (
            <button className="button secondary sp-cfg-btn" onClick={() => setDimModal(true)}>
              <SlidersHorizontal size={14} /> Configure Dimensions
            </button>
          )}
        </div>
        <p className="sp-cat-pricing-hint">
          Fallback rules for all services in this category.
          {configLabel
            ? <> Pricing by: <strong className="sp-dim-badge">{configLabel}</strong></>
            : <> No dimension configured — <button className="sp-link-btn" onClick={() => setDimModal(true)}>set one now</button>.</>}
        </p>
      </div>

      <PricingRulesList
        targetId={category.id}
        targetParam="category_id"
        targetName={`${category.name} (category)`}
        pricingConfig={config}
        perms={P}
        showToast={showToast}
        pricingModal={pricingModal}
        setPricingModal={setPricingModal}
        showBulk={showBulk}
        setShowBulk={setShowBulk}
      />

      {dimModal && (
        <DimensionConfigModal
          category={category}
          currentConfig={config}
          onSave={async (cfg) => { await saveDimConfig(cfg); setDimModal(false); }}
          onClose={() => setDimModal(false)}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// PRICING RULE MODAL
// ── Lightweight searchable select (used in cascade pricing rows) ────────────
function SearchSel({ value, onChange, options = [], placeholder = 'Select…', disabled = false }) {
  const [q,    setQ]    = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef  = useRef(null);
  const inputRef = useRef(null);

  const sel      = options.find(o => String(o.id) === String(value));
  const filtered = q ? options.filter(o => o.name.toLowerCase().includes(q.toLowerCase())) : options;

  useEffect(() => {
    function onOut(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setQ(''); }
    }
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, []);

  function handleOpen() { if (disabled) return; setOpen(true); setTimeout(() => inputRef.current?.focus(), 20); }

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <div
        className={`sp-input spt-sel${disabled ? ' sp-input--disabled' : ''}`}
        style={{ cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none', gap: 6 }}
        onClick={handleOpen}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, color: sel ? 'var(--text)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
          {disabled ? placeholder : (sel ? (
            <>
              {sel.name}
              {sel.vehicle_type_name && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, flexShrink: 0,
                  background: is2WType(sel.vehicle_type_name) ? '#dcfce7' : '#dbeafe',
                  color:      is2WType(sel.vehicle_type_name) ? '#166534' : '#1d4ed8' }}>
                  {is2WType(sel.vehicle_type_name) ? '2W' : '4W'}
                </span>
              )}
            </>
          ) : placeholder)}
        </span>
        <ChevronDown size={13} style={{ color: 'var(--text-muted)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </div>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--panel)', border: '1.5px solid var(--border)', borderRadius: 10, boxShadow: '0 8px 24px -4px rgba(0,0,0,0.15)', zIndex: 9999, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-soft)' }}>
            <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
              style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 12, color: 'var(--text)', outline: 'none' }} />
            {q && (
              <button onMouseDown={() => setQ('')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, display: 'grid', placeItems: 'center' }}>
                <X size={11} />
              </button>
            )}
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {filtered.length === 0
              ? <div style={{ padding: '12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>No match</div>
              : filtered.map(o => (
                <div key={o.id}
                  onMouseDown={() => { onChange(String(o.id)); setOpen(false); setQ(''); }}
                  style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: String(o.id) === String(value) ? '#eff6ff' : 'transparent', color: String(o.id) === String(value) ? 'var(--primary)' : 'var(--text)', fontWeight: String(o.id) === String(value) ? 600 : 400 }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, overflow: 'hidden' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
                    {o.vehicle_type_name && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, flexShrink: 0,
                        background: is2WType(o.vehicle_type_name) ? '#dcfce7' : '#dbeafe',
                        color:      is2WType(o.vehicle_type_name) ? '#166534' : '#1d4ed8' }}>
                        {is2WType(o.vehicle_type_name) ? '2W' : '4W'}
                      </span>
                    )}
                  </span>
                  {String(o.id) === String(value) && <CheckCircle2 size={12} style={{ color: 'var(--primary)', flexShrink: 0 }} />}
                </div>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
function PricingRuleModal({ mode, rule, serviceId, categoryId, targetName, vehicleClass = 'both', onClose, onSaved, showToast }) {
  // vehicleClass: '2W' | '4W' | 'both'
  // 2W  → CC Category / Price rows, no Body Type, no Segment, 2W-only types+makes
  // 4W  → Body Type + Segment / Price rows, 4W-only types+makes
  // both→ all fields (keep existing behaviour)

  const isTW   = vehicleClass === '2W';
  const isFW   = vehicleClass === '4W';
  const isBoth = vehicleClass === 'both';

  const [vehicleTypes,  setVehicleTypes]  = useState([]);
  const [allBodyTypes,  setAllBodyTypes]  = useState([]);
  const [segments,      setSegments]      = useState([]);
  const [ccCategories,  setCcCategories]  = useState([]);
  const [makes,         setMakes]         = useState([]);
  const [models,        setModels]        = useState([]);

  const [form, setForm] = useState({
    vehicle_type_id: rule?.vehicle_type_id || '',
    body_type_id:    rule?.body_type_id    || '',
    make_id:         rule?.make_id         || '',
    model_id:        rule?.model_id        || '',
    is_active:       rule?.is_active !== undefined ? rule.is_active : true,
  });

  // For 4W/both: segment × price rows
  const [segRows, setSegRows] = useState(
    mode === 'edit'
      ? [{ id: 1, segment_id: rule?.segment_id || '', price: rule?.price || '' }]
      : [{ id: 1, segment_id: '', price: '' }]
  );

  // For 2W: CC category × price rows
  const [ccRows, setCcRows] = useState(
    mode === 'edit'
      ? [{ id: 1, cc_category_id: rule?.cc_category_id || '', price: rule?.price || '' }]
      : [{ id: 1, cc_category_id: '', price: '' }]
  );

  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [saveResults, setSaveResults] = useState(null);

  // Load reference data on mount
  useEffect(() => {
    const calls = [
      api('/api/vehicles/types'),
      api('/api/vehicles/segments'),
    ];
    if (!isTW) calls.push(api('/api/vehicles/body-types'));
    if (!isFW) calls.push(api('/api/cc-categories'));

    Promise.all(calls).then(results => {
      let idx = 0;
      setVehicleTypes(results[idx++].items || []);
      setSegments(results[idx++].items     || []);
      if (!isTW) setAllBodyTypes(results[idx++].items || []);
      if (!isFW) setCcCategories(results[idx++].items || []);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load makes scoped to vehicle class
  useEffect(() => {
    const params = new URLSearchParams();
    if (isTW)                params.set('type_class', '2W');
    else if (isFW)           params.set('type_class', '4W');
    else if (form.body_type_id) params.set('body_type_id', form.body_type_id);
    api(`/api/vehicles/makes?${params}`).then(r => setMakes(r.items || []));
    if (!isTW && form.body_type_id) setForm(f => ({ ...f, make_id: '', model_id: '' }));
  }, [form.body_type_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload models when make changes
  useEffect(() => {
    if (!form.make_id) { setModels([]); setForm(f => ({ ...f, model_id: '' })); return; }
    const params = new URLSearchParams({ make_id: form.make_id });
    if (form.body_type_id) params.set('body_type_id', form.body_type_id);
    api(`/api/vehicles/models?${params}`).then(r => setModels(r.items || []));
  }, [form.make_id, form.body_type_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fill body_type from selected model (4W only)
  useEffect(() => {
    if (!form.model_id || isTW) return;
    const model = models.find(m => String(m.id) === String(form.model_id));
    if (model?.body_type_id && !form.body_type_id) {
      setForm(f => ({ ...f, body_type_id: String(model.body_type_id) }));
    }
  }, [form.model_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const f = v => setForm(p => ({ ...p, ...v }));

  // Segment row helpers (4W / both)
  const addSegRow    = () => setSegRows(r => [...r, { id: Date.now(), segment_id: '', price: '' }]);
  const removeSegRow = id => setSegRows(r => r.filter(row => row.id !== id));
  const updateSegRow = (id, field, val) => setSegRows(r => r.map(row => row.id === id ? { ...row, [field]: val } : row));

  // CC Category row helpers (2W / both)
  const addCcRow    = () => setCcRows(r => [...r, { id: Date.now(), cc_category_id: '', price: '' }]);
  const removeCcRow = id => setCcRows(r => r.filter(row => row.id !== id));
  const updateCcRow = (id, field, val) => setCcRows(r => r.map(row => row.id === id ? { ...row, [field]: val } : row));

  // Filtered vehicle types by class
  const filteredTypes = vehicleTypes.filter(vt => {
    if (isTW) return is2WType(vt.name);
    if (isFW) return !is2WType(vt.name);
    return true;
  });

  // Preview
  const previewBase = previewAppliesTo(
    { ...form, segment_id: '' },
    { vehicleTypes, makes, models, segments, bodyTypes: allBodyTypes }
  );
  const previewColor = getRuleTypeColor((() => {
    const dims = [];
    if (form.model_id)     dims.push('Model');
    else if (form.make_id) dims.push('Make');
    if (form.body_type_id && !isTW) dims.push('Body Type');
    return dims.length ? dims.join(' + ') : (isTW ? 'CC Category' : 'Universal');
  })());

  async function handleSubmit(e) {
    e.preventDefault(); setError('');

    const base = {
      service_id:      serviceId  || null,
      category_id:     categoryId || null,
      vehicle_type_id: form.vehicle_type_id || null,
      make_id:         form.make_id         || null,
      model_id:        form.model_id        || null,
      is_active:       form.is_active,
      // class-specific dimensions
      body_type_id:    !isTW ? (form.body_type_id || null) : null,
      segment_id:      null,       // overridden below for fw/both
      cc_category_id:  null,       // overridden below for tw/both
    };

    if (isTW) {
      // 2W — iterate CC Category rows
      const validRows = ccRows.filter(r => r.price && Number(r.price) > 0);
      if (!validRows.length) { setError('Enter a price for at least one CC Category row.'); return; }
      setSaving(true);
      if (mode === 'edit') {
        try {
          await api(`/api/pricing/${rule.id}`, { method: 'PATCH', body: {
            ...base, cc_category_id: validRows[0].cc_category_id || null, price: Number(validRows[0].price),
          }});
          onSaved();
        } catch (e) { setError(e.message); }
        finally { setSaving(false); }
        return;
      }
      let ok = 0, fail = 0, lastErr = '';
      for (const row of validRows) {
        try {
          await api('/api/pricing', { method: 'POST', body: {
            ...base, cc_category_id: row.cc_category_id || null, price: Number(row.price),
          }});
          ok++;
        } catch (e) { fail++; lastErr = e.message; }
      }
      setSaving(false);
      if (ok > 0 && fail === 0) { onSaved(); return; }
      if (ok > 0) { setSaveResults({ ok, fail, lastErr }); onSaved(); }
      else setError(lastErr || 'All rules failed to save.');
      return;
    }

    // 4W / Both — iterate Segment rows
    const validRows = segRows.filter(r => r.price && Number(r.price) > 0);
    if (!validRows.length) { setError('Enter a price for at least one row.'); return; }
    setSaving(true);
    if (mode === 'edit') {
      try {
        await api(`/api/pricing/${rule.id}`, { method: 'PATCH', body: {
          ...base, segment_id: validRows[0].segment_id || null, price: Number(validRows[0].price),
        }});
        onSaved();
      } catch (e) { setError(e.message); }
      finally { setSaving(false); }
      return;
    }
    let ok = 0, fail = 0, lastErr = '';
    for (const row of validRows) {
      try {
        await api('/api/pricing', { method: 'POST', body: {
          ...base, segment_id: row.segment_id || null, price: Number(row.price),
        }});
        ok++;
      } catch (e) { fail++; lastErr = e.message; }
    }
    setSaving(false);
    if (ok > 0 && fail === 0) { onSaved(); return; }
    if (ok > 0) { setSaveResults({ ok, fail, lastErr }); onSaved(); }
    else setError(lastErr || 'All rules failed to save.');
  }

  // CC row count for button label
  const activeRows = isTW ? ccRows : segRows;

  return (
    <div className="sp-modal-backdrop" onClick={onClose}>
      <div className="sp-modal sp-modal--wide" onClick={e => e.stopPropagation()}>
        <div className="sp-modal-header">
          <h3>{mode === 'create' ? 'Add Pricing Rule' : 'Edit Pricing Rule'}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Vehicle class badge */}
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
              background: isTW ? '#dcfce7' : isFW ? '#dbeafe' : '#f3f4f6',
              color:      isTW ? '#166534' : isFW ? '#1d4ed8' : '#374151',
            }}>
              {isTW ? '🏍️ 2W Pricing' : isFW ? '🚗 4W Pricing' : '🚗🏍️ Universal'}
            </span>
            <button className="sp-modal-close" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        <form className="sp-modal-body" onSubmit={handleSubmit}>
          {error && <div className="sp-form-error"><AlertCircle size={14} /> {error}</div>}

          {/* Target (read-only) */}
          <div className="sp-form-field">
            <label>{categoryId ? 'Category' : 'Service'}</label>
            <input value={targetName || ''} disabled className="sp-input sp-input--disabled" />
          </div>

          {/* ── Dimension hint ────────────────────────────────────────────── */}
          <div className="sp-rule-dims-hint">
            <Info size={12} />
            {isTW
              ? '2W pricing uses CC Category — set Make / Model for specific bike pricing.'
              : isFW
              ? '4W pricing — Body Type auto-fills when you pick a model.'
              : 'Set dimensions below. Specific rules take precedence over broader ones.'}
          </div>

          {/* ── Dimension grid ────────────────────────────────────────────── */}
          <div className="sp-dims-grid">
            {/* Vehicle Type — filtered to class */}
            <div className="sp-form-field">
              <label>Vehicle Type</label>
              <select className="sp-input" value={form.vehicle_type_id}
                onChange={e => f({ vehicle_type_id: e.target.value })}>
                <option value="">Any</option>
                {filteredTypes.map(vt => <option key={vt.id} value={vt.id}>{vt.name}</option>)}
              </select>
            </div>

            {/* Body Type — 4W / both only */}
            {!isTW && (
              <div className="sp-form-field">
                <label>Body Type
                  {form.make_id && !form.body_type_id && (
                    <span className="sp-field-note"> · auto-fills on model select</span>
                  )}
                </label>
                <select className="sp-input" value={form.body_type_id}
                  onChange={e => f({ body_type_id: e.target.value })}>
                  <option value="">Any</option>
                  {allBodyTypes.filter(b => !is2WType(b.name)).map(bt => (
                    <option key={bt.id} value={bt.id}>{bt.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Make */}
            <div className="sp-form-field">
              <label>Make
                {!isTW && form.body_type_id && <span className="sp-field-note"> · filtered by body type</span>}
              </label>
              <select className="sp-input" value={form.make_id}
                onChange={e => f({ make_id: e.target.value, model_id: '' })}>
                <option value="">Any</option>
                {makes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>

            {/* Model */}
            <div className="sp-form-field">
              <label>Model</label>
              <select className="sp-input" value={form.model_id}
                onChange={e => f({ model_id: e.target.value })}
                disabled={!form.make_id}>
                <option value="">{form.make_id ? 'Any' : 'Select make first'}</option>
                {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>

          {/* ── 2W: CC Category × Price rows ─────────────────────────────── */}
          {isTW && (
            <div className="sp-seg-section">
              <div className="sp-seg-header">
                <span className="sp-seg-label">CC Category / Price</span>
                {mode === 'create' && (
                  <button type="button" className="sp-seg-add-btn" onClick={addCcRow}>
                    <Plus size={12} /> Add CC category
                  </button>
                )}
              </div>
              <div className="sp-seg-rows">
                {ccRows.map(row => (
                  <div key={row.id} className="sp-seg-row">
                    <select
                      className="sp-input sp-seg-sel"
                      value={row.cc_category_id}
                      onChange={e => updateCcRow(row.id, 'cc_category_id', e.target.value)}
                    >
                      <option value="">Universal (any CC)</option>
                      {ccCategories.map(c => (
                        <option key={c.id} value={c.id}>{c.name} ({c.min_cc}–{c.max_cc} cc)</option>
                      ))}
                    </select>
                    <div className="sp-price-wrap sp-seg-price">
                      <span className="sp-price-sym">₹</span>
                      <input
                        type="number" min="0.01" step="0.01"
                        className="sp-input sp-input--price"
                        placeholder="0.00"
                        value={row.price}
                        onChange={e => updateCcRow(row.id, 'price', e.target.value)}
                      />
                    </div>
                    {mode === 'create' && ccRows.length > 1 && (
                      <button type="button" className="sp-seg-del" onClick={() => removeCcRow(row.id)}>
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 4W / Both: Segment × Price rows ──────────────────────────── */}
          {!isTW && (
            <div className="sp-seg-section">
              <div className="sp-seg-header">
                <span className="sp-seg-label">Segment / Price</span>
                {mode === 'create' && (
                  <button type="button" className="sp-seg-add-btn" onClick={addSegRow}>
                    <Plus size={12} /> Add segment
                  </button>
                )}
              </div>
              <div className="sp-seg-rows">
                {segRows.map(row => (
                  <div key={row.id} className="sp-seg-row">
                    <select
                      className="sp-input sp-seg-sel"
                      value={row.segment_id}
                      onChange={e => updateSegRow(row.id, 'segment_id', e.target.value)}
                    >
                      <option value="">Universal (any segment)</option>
                      {segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <div className="sp-price-wrap sp-seg-price">
                      <span className="sp-price-sym">₹</span>
                      <input
                        type="number" min="0.01" step="0.01"
                        className="sp-input sp-input--price"
                        placeholder="0.00"
                        value={row.price}
                        onChange={e => updateSegRow(row.id, 'price', e.target.value)}
                      />
                    </div>
                    {mode === 'create' && segRows.length > 1 && (
                      <button type="button" className="sp-seg-del" onClick={() => removeSegRow(row.id)}>
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live preview */}
          <div className="sp-rule-preview">
            <span className="sp-rule-preview-label">Base applies to:</span>
            <span className="sp-type-badge" style={{ background: previewColor.bg, color: previewColor.color }}>
              {previewBase}
            </span>
            {mode === 'create' && activeRows.length > 1 && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                × {activeRows.length} {isTW ? 'CC category' : 'segment'} rules
              </span>
            )}
          </div>

          {/* Status */}
          <div className="sp-form-field sp-form-field--row">
            <label>Status</label>
            <button type="button" className="sp-toggle-btn" onClick={() => f({ is_active: !form.is_active })}>
              {form.is_active
                ? <><ToggleRight size={22} color="var(--ok,#16a34a)" /> <span style={{color:'#16a34a',fontSize:13,fontWeight:600}}>Active</span></>
                : <><ToggleLeft size={22} /> <span style={{color:'var(--text-muted)',fontSize:13}}>Inactive</span></>}
            </button>
          </div>

          <div className="sp-modal-footer">
            <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="button primary" disabled={saving}>
              {saving
                ? 'Saving…'
                : mode === 'create'
                  ? `Create ${activeRows.length > 1 ? activeRows.length + ' Rules' : 'Rule'}`
                  : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// SMART PRICING FORM
// ══════════════════════════════════════════════════════════════════════════

const DIM_LABELS = {
  vehicle_type: 'Vehicle Type', body_type: 'Body Type',
  segment: 'Segment', make: 'Make', model: 'Model',
};

// Returns { fwModes: string[], twMode: string|null }
//
// fwModes — ALL 4W dimension modes configured (can be multiple, e.g.
//   ['checklist_vt', 'cascade'] when Vehicle Type + Make & Model are both on).
//   Empty array means no 4W dim is configured.
//
// twMode  — 'checklist_cc' if CC Category is configured, else null.
//
// When fwModes.length > 1, the SmartPricingModal shows a rule-type picker
// so the user chooses which 4W rule type they're creating in this session.
function detectModes(config) {
  if (!config || config.length === 0) return { fwModes: ['free'], twMode: null };
  const has = k => config.includes(k);

  const fwModes = [];
  if (has('vehicle_type'))            fwModes.push('checklist_vt');
  if (has('body_type'))               fwModes.push('checklist_bt');
  if (has('segment'))                 fwModes.push('checklist_seg');
  if (has('make') || has('model'))    fwModes.push('cascade');

  const twMode = has('cc_category') ? 'checklist_cc' : null;

  if (fwModes.length === 0 && !twMode) return { fwModes: ['free'], twMode: null };

  return { fwModes, twMode };
}

// Label map for fw mode keys
const FW_MODE_LABELS = {
  checklist_vt:  'Vehicle Type',
  checklist_bt:  'Body Type',
  checklist_seg: 'Segment',
  cascade:       'Make & Model',
  free:          'Custom',
};

// Legacy single-mode helper (still used by PricingRuleModal badge etc.)
function detectSmartMode(config) {
  const { fwModes, twMode } = detectModes(config);
  const fwMode = fwModes[0] || 'free';
  return twMode && fwModes.length === 0 ? twMode : fwMode;
}

// ── DimensionConfigModal ──────────────────────────────────────────────────
// Options are tagged with vehicleClass so we can group them correctly when
// a category is set to 'both'.
const DIM_OPTION_LIST = [
  {
    key:   'vehicle_type',
    label: 'Vehicle Type',
    desc:  'Set a separate price for each vehicle type (2-Wheeler, 4-Wheeler, Commercial…)',
    emoji: '🚗',
    dims:  ['vehicle_type'],
    vc:    'both',   // valid for all vehicle classes
  },
  {
    key:   'body_type',
    label: 'Body Type',
    desc:  'Set a separate price for each body style (Hatchback, Sedan, SUV, MUV…)',
    emoji: '🚙',
    dims:  ['body_type'],
    vc:    '4W',     // 4W only
  },
  {
    key:   'segment',
    label: 'Segment (Fuel Type)',
    desc:  'Set a separate price per fuel type — Petrol, Diesel, CNG, Electric…',
    emoji: '⛽',
    dims:  ['segment'],
    vc:    '4W',     // 4W only (fuel segments don't apply to 2W CC pricing)
  },
  {
    key:   'make_model',
    label: 'Make & Model',
    desc:  'Pick make → model, then set price per fuel segment (Petrol, Diesel, CNG…)',
    emoji: '🔧',
    dims:  ['make', 'model'],
    vc:    'both',   // valid for both (user picks make/model from the relevant type)
  },
  {
    key:   'cc_category',
    label: 'CC Category (2W)',
    desc:  'Set a separate price per engine CC range — C1 (0–130 cc) through C6 (1001+ cc)',
    emoji: '🏍️',
    dims:  ['cc_category'],
    vc:    '2W',     // 2W only
  },
];

// Convert a saved pricing_config array → set of selected option keys
function configToSelectedKeys(config) {
  if (!config || config.length === 0) return new Set();
  const keys = new Set();
  if (config.includes('vehicle_type'))                     keys.add('vehicle_type');
  if (config.includes('body_type'))                        keys.add('body_type');
  if (config.includes('segment'))                          keys.add('segment');
  if (config.includes('make') || config.includes('model')) keys.add('make_model');
  if (config.includes('cc_category'))                      keys.add('cc_category');
  return keys;
}

// Merge dims arrays from all selected option keys into a flat unique array
function selectedKeysToDims(selectedKeys) {
  const dims = new Set();
  for (const key of selectedKeys) {
    const opt = DIM_OPTION_LIST.find(o => o.key === key);
    if (opt) opt.dims.forEach(d => dims.add(d));
  }
  return [...dims];
}

function DimensionConfigModal({ category, currentConfig, onSave, onClose }) {
  const vc = category?.vehicle_class || 'both';

  // For 'both': split into 4W group and 2W group so the user understands
  // they are configuring pricing dimensions for each vehicle type separately.
  // For fw/tw: flat list with the irrelevant option hidden.
  const fw4WOptions = DIM_OPTION_LIST.filter(o => o.vc === '4W' || o.vc === 'both');
  const tw2WOptions = DIM_OPTION_LIST.filter(o => o.vc === '2W');
  const flatOptions = DIM_OPTION_LIST.filter(opt => {
    if (vc === '2W') return opt.vc === '2W' || opt.vc === 'both';
    if (vc === '4W') return opt.vc === '4W' || opt.vc === 'both';
    return true;
  });

  const [selected, setSelected] = useState(() => configToSelectedKeys(currentConfig));
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  function toggle(key) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setError('');
  }

  async function handleSave() {
    if (selected.size === 0) { setError('Please select at least one pricing dimension.'); return; }
    setSaving(true); setError('');
    try {
      await onSave(selectedKeysToDims(selected));
    } catch (e) { setError(e.message); setSaving(false); }
  }

  function renderOption(opt) {
    const on = selected.has(opt.key);
    return (
      <label
        key={opt.key}
        className={`spt-cfg-option ${on ? 'spt-cfg-option--on' : ''}`}
      >
        <input
          type="checkbox"
          checked={on}
          onChange={() => toggle(opt.key)}
        />
        <span className="spt-cfg-emoji">{opt.emoji}</span>
        <div className="spt-cfg-text">
          <span className="spt-cfg-label">{opt.label}</span>
          <span className="spt-cfg-desc">{opt.desc}</span>
        </div>
      </label>
    );
  }

  return (
    <div className="sp-modal-backdrop" onClick={onClose}>
      <div className="spt-cfg-modal" onClick={e => e.stopPropagation()}>
        <div className="sp-modal-header">
          <div>
            <h3>Configure Pricing</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{category.name}</p>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20,
                background: vc === '2W' ? '#dcfce7' : vc === '4W' ? '#dbeafe' : '#f3f4f6',
                color:      vc === '2W' ? '#166534' : vc === '4W' ? '#1d4ed8' : '#374151',
              }}>
                {vc === '2W' ? '🏍️ 2W' : vc === '4W' ? '🚗 4W' : '🚗🏍️ Both'}
              </span>
            </div>
          </div>
          <button className="sp-modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="spt-cfg-body">
          <p className="spt-cfg-hint">
            {vc === 'both'
              ? 'Select pricing dimensions for each vehicle type. You can mix 4W and 2W options.'
              : 'How should services in this category be priced? Select all that apply.'}
          </p>
          {error && <div className="sp-form-error"><AlertCircle size={13} /> {error}</div>}

          {/* ── 'Both' → show two labelled groups ────────────────────────── */}
          {vc === 'both' ? (
            <div className="spt-cfg-groups">
              <div className="spt-cfg-group">
                <div className="spt-cfg-group-label">🚗 4-Wheeler pricing</div>
                <div className="spt-cfg-options">
                  {fw4WOptions.map(renderOption)}
                </div>
              </div>
              <div className="spt-cfg-group">
                <div className="spt-cfg-group-label">🏍️ 2-Wheeler pricing</div>
                <div className="spt-cfg-options">
                  {tw2WOptions.map(renderOption)}
                </div>
              </div>
            </div>
          ) : (
            /* ── fw / tw → flat list ─────────────────────────────────────── */
            <div className="spt-cfg-options">
              {flatOptions.map(renderOption)}
            </div>
          )}
        </div>

        <div className="sp-modal-footer" style={{ padding: '0 22px 22px' }}>
          <button className="button secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="button primary" onClick={handleSave} disabled={saving || selected.size === 0}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SmartPricingModal ─────────────────────────────────────────────────────
// Supports two simultaneous sections when pricing_config has both 4W and 2W
// dimensions (e.g. body_type + cc_category for a 'both' category).
// Each section collects its own rules; submit fires all of them at once.
function SmartPricingModal({ config, serviceId, categoryId, targetName, vehicleClass = 'both', onClose, onSaved, showToast }) {
  const { fwModes: rawFwModes, twMode: rawTwMode } = detectModes(config);

  // Filter modes by the service's vehicle_class so a 4W-only service never
  // shows the 2W CC section and a 2W-only service never shows 4W fields.
  const fwModes = vehicleClass === '2W' ? [] : rawFwModes;
  const twMode  = vehicleClass === '4W' ? null : rawTwMode;

  // activeFwMode — which 4W rule type the user is currently building.
  // 'universal' is always available as the first tab so the user can set a
  // base price that applies to all vehicles even when dimensions are configured.
  const [activeFwMode, setActiveFwMode] = useState(fwModes[0] || null);
  const [universalPrice, setUniversalPrice] = useState('');

  const hasBoth      = !!(fwModes.length > 0 && fwModes[0] !== 'free' && twMode);
  const hasMultiFw   = fwModes.length > 1;   // multiple 4W rule types configured
  // Show the rule-type tab strip when there are any real configured modes
  const hasRealModes = fwModes.length > 0 && fwModes[0] !== 'free';
  const base         = { service_id: serviceId || null, category_id: categoryId || null, is_active: true };

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  // Top-level vehicle tab for "both" services (UI only — both tabs' state is always kept)
  const [activeVehicleTab, setActiveVehicleTab] = useState('4W');

  // ── Reference data (load all needed upfront) ──────────────────────────────
  const [vehicleTypes, setVehicleTypes] = useState([]);
  const [bodyTypes,    setBodyTypes]    = useState([]);
  const [segments,     setSegments]     = useState([]);
  const [makes,        setMakes]        = useState([]);
  const [ccCategories, setCcCategories] = useState([]);

  useEffect(() => {
    const p = [];
    if (fwModes.includes('checklist_vt')) p.push(api('/api/vehicles/types').then(r => setVehicleTypes(r.items || [])));
    if (fwModes.includes('checklist_bt')) p.push(api('/api/vehicles/body-types').then(r => setBodyTypes(r.items || [])));
    if (fwModes.includes('checklist_seg') || fwModes.includes('cascade'))
      p.push(api('/api/vehicles/segments').then(r => setSegments(r.items || [])));
    if (fwModes.includes('cascade')) {
      const makeQs = vehicleClass === '4W' ? '?type_class=4W'
                   : vehicleClass === '2W' ? '?type_class=2W'
                   : '';
      p.push(api(`/api/vehicles/makes${makeQs}`).then(r => setMakes(r.items || [])));
    }
    if (twMode === 'checklist_cc') p.push(api('/api/cc-categories').then(r => setCcCategories(r.items || [])));
    Promise.all(p).catch(e => setError(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 4W checklist state { [itemId]: price } ────────────────────────────────
  const [fwChecks, setFwChecks] = useState({});
  const toggleFwCheck  = id => setFwChecks(p => { const n={...p}; n[id]!==undefined?delete n[id]:n[id]=''; return n; });
  const setFwPrice     = (id, v) => setFwChecks(p => ({ ...p, [id]: v }));

  // ── 2W checklist state { [itemId]: price } ────────────────────────────────
  const [twChecks, setTwChecks] = useState({});
  const toggleTwCheck  = id => setTwChecks(p => { const n={...p}; n[id]!==undefined?delete n[id]:n[id]=''; return n; });
  const setTwPrice     = (id, v) => setTwChecks(p => ({ ...p, [id]: v }));

  // ── Cascade state (Make & Model) ──────────────────────────────────────────
  // allModels = full list from API (includes duplicates by name for different segments)
  // models    = deduplicated by name (what the dropdown shows)
  const [cascadeRows, setCascadeRows] = useState([
    { id: 1, make_id: '', model_id: '', models: [], allModels: [], segChecks: {}, price: '' }
  ]);
  async function onCascadeMakeChange(rowId, makeId) {
    setCascadeRows(p => p.map(r => r.id===rowId ? {...r, make_id:makeId, model_id:'', models:[], allModels:[], segChecks:{}, price:''} : r));
    if (!makeId) return;
    const r = await api(`/api/vehicles/models?make_id=${makeId}`);
    const allModels = r.items || [];
    // Deduplicate by name for the dropdown — keep first occurrence of each name
    const seen = new Set();
    const dedupedModels = allModels.filter(m => { if (seen.has(m.name)) return false; seen.add(m.name); return true; });
    setCascadeRows(p => p.map(r2 => r2.id===rowId ? {...r2, models: dedupedModels, allModels} : r2));
  }
  const onCascadeModelChange = (rowId, modelId) =>
    setCascadeRows(p => p.map(r => r.id===rowId ? {...r, model_id:modelId, segChecks:{}, price:''} : r));
  const toggleCascadeSeg = (rowId, segId) =>
    setCascadeRows(p => p.map(r => { if(r.id!==rowId) return r; const n={...r.segChecks}; n[segId]!==undefined?delete n[segId]:n[segId]=''; return {...r,segChecks:n}; }));
  const setCascadeSegPrice = (rowId, segId, v) =>
    setCascadeRows(p => p.map(r => r.id===rowId ? {...r, segChecks:{...r.segChecks,[segId]:v}} : r));
  const setCascadePrice = (rowId, v) =>
    setCascadeRows(p => p.map(r => r.id===rowId ? {...r, price:v} : r));
  const addCascadeRow    = () => setCascadeRows(p => [...p, {id:Date.now(), make_id:'', model_id:'', models:[], allModels:[], segChecks:{}, price:''}]);
  const removeCascadeRow = id => setCascadeRows(p => p.filter(r => r.id!==id));

  // ── Build rules from a checklist state + dimension key ────────────────────
  function checklistRules(checks, dimKey) {
    return Object.entries(checks)
      .filter(([, price]) => price && Number(price) > 0)
      .map(([id, price]) => ({ ...base, [dimKey]: Number(id), price: Number(price) }));
  }

  // ── Submit — collects from active 4W mode + 2W section ───────────────────
  async function handleSubmit(e) {
    e.preventDefault(); setError('');
    const rules = [];

    // Universal tab — single price, no dimensions
    if (activeFwMode === 'universal') {
      const p = Number(universalPrice);
      if (p > 0) rules.push({ ...base, price: p });
    }

    // 4W section rules — only the currently active fw mode
    if (activeFwMode === 'checklist_vt')  rules.push(...checklistRules(fwChecks, 'vehicle_type_id'));
    if (activeFwMode === 'checklist_bt')  rules.push(...checklistRules(fwChecks, 'body_type_id'));
    if (activeFwMode === 'checklist_seg') rules.push(...checklistRules(fwChecks, 'segment_id'));
    if (activeFwMode === 'cascade') {
      for (const row of cascadeRows) {
        if (!row.make_id || !row.model_id) continue;
        const segs = Object.entries(row.segChecks).filter(([,p]) => p && Number(p) > 0);
        if (segs.length > 0) {
          // For each segment price, find the model_id variant that has that segment_id
          // IMPORTANT: restrict search to same model name to avoid picking a different model
          // (e.g. Honda Amaze Petrol instead of Honda City Petrol)
          const selectedModel = (row.models || []).find(m => String(m.id) === String(row.model_id));
          const modelName = selectedModel ? selectedModel.name : null;
          const modelPool = modelName
            ? (row.allModels || []).filter(m => m.name === modelName)
            : (row.allModels || []);
          for (const [segId, price] of segs) {
            const variantModel = modelPool.find(m => String(m.segment_id) === String(segId));
            const resolvedModelId = variantModel ? variantModel.id : Number(row.model_id);
            rules.push({ ...base, make_id: Number(row.make_id), model_id: resolvedModelId, segment_id: Number(segId), price: Number(price) });
          }
        } else if (row.price && Number(row.price) > 0) {
          // Flat price (no segment breakdown) — create one rule per model variant
          // so the price applies to all fuel/segment types of this model name
          const selectedModel = (row.models || []).find(m => String(m.id) === String(row.model_id));
          const variants = selectedModel
            ? (row.allModels || []).filter(m => m.name === selectedModel.name)
            : [{ id: row.model_id }];
          for (const variant of variants)
            rules.push({ ...base, make_id: Number(row.make_id), model_id: Number(variant.id), price: Number(row.price) });
        }
      }
    }

    // 2W section rules
    if (twMode === 'checklist_cc') rules.push(...checklistRules(twChecks, 'cc_category_id'));

    if (rules.length === 0) { setError('Enter at least one price to create a rule.'); return; }

    setSaving(true);
    let ok = 0, fail = 0, lastErr = '';
    for (const rule of rules) {
      try { await api('/api/pricing', { method: 'POST', body: rule }); ok++; }
      catch (e) { fail++; lastErr = e.message; }
    }
    setSaving(false);
    if (ok > 0) {
      showToast(`${ok} rule${ok !== 1 ? 's' : ''} created${fail > 0 ? ` (${fail} skipped)` : ''}`, 'success');
      onSaved();
    } else {
      setError(lastErr || 'All rules failed to save.');
    }
  }

  // ── Reusable checklist renderer ───────────────────────────────────────────
  function renderChecklist(items, checks, onToggle, onPrice, isCC) {
    return (
      <div className="spt-checklist">
        {items.map(item => {
          const checked = checks[item.id] !== undefined;
          return (
            <div key={item.id} className={`spt-check-row ${checked ? 'spt-check-row--on' : ''}`}>
              <label className="spt-check-label">
                <input type="checkbox" checked={checked} onChange={() => onToggle(item.id)} />
                <span className="spt-check-name">
                  {item.name}
                  {isCC && item.min_cc !== undefined && (
                    <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                      {item.min_cc}–{item.max_cc} cc
                    </span>
                  )}
                </span>
              </label>
              {checked && (
                <div className="spt-price-cell">
                  <span className="spt-rupee">₹</span>
                  <input type="number" min="0.01" step="0.01" placeholder="0.00"
                    className="spt-price-input"
                    value={checks[item.id]}
                    onChange={e => onPrice(item.id, e.target.value)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ── Render cascade (Make & Model) ─────────────────────────────────────────
  function renderCascade() {
    return (
      <div className="spt-cascade">
        {cascadeRows.map(row => (
          <div key={row.id} className="spt-cascade-row">
            <div className="spt-cascade-selects">
              <SearchSel
                value={row.make_id}
                onChange={makeId => onCascadeMakeChange(row.id, makeId)}
                options={makes}
                placeholder="Select Make"
              />
              <ChevronRight size={13} className="spt-arrow" />
              <SearchSel
                value={row.model_id}
                onChange={modelId => onCascadeModelChange(row.id, modelId)}
                options={row.models}
                placeholder={row.make_id ? 'Select Model' : '— pick make first —'}
                disabled={!row.make_id}
              />
              {cascadeRows.length > 1 && (
                <button type="button" className="spt-row-del" onClick={() => removeCascadeRow(row.id)}>
                  <X size={13} />
                </button>
              )}
            </div>
            {row.model_id && (() => {
              // Filter segments to only those available for the selected model's name
              // Use allModels (full undeduped list) so all segment variants are found
              const selModel    = row.models.find(m => String(m.id) === String(row.model_id));
              const modelPool   = (row.allModels && row.allModels.length > 0) ? row.allModels : row.models;
              const availSegIds = selModel
                ? new Set(modelPool.filter(m => m.name === selModel.name && m.segment_id).map(m => m.segment_id))
                : new Set();

              // If the selected make is a 2W brand, skip segments entirely — 2W vehicles
              // don't have fuel segments in master data; show flat price instead.
              const selMake = makes.find(m => String(m.id) === String(row.make_id));
              const is2WMake = selMake && /two|2w|bike|scoot|motor/i.test(selMake.vehicle_type_name || '');

              const visibleSegs = is2WMake
                ? []
                : availSegIds.size > 0
                  ? segments.filter(s => availSegIds.has(s.id))
                  : [];

              return (
                <div className="spt-cascade-segs">
                  <div className="spt-segs-label">Set price by segment:</div>
                  {visibleSegs.map(seg => {
                    const checked = row.segChecks[seg.id] !== undefined;
                    return (
                      <div key={seg.id} className={`spt-check-row spt-check-row--sm ${checked ? 'spt-check-row--on' : ''}`}>
                        <label className="spt-check-label">
                          <input type="checkbox" checked={checked} onChange={() => toggleCascadeSeg(row.id, seg.id)} />
                          <span className="spt-check-name">{seg.name}</span>
                        </label>
                        {checked && (
                          <div className="spt-price-cell">
                            <span className="spt-rupee">₹</span>
                            <input type="number" min="0.01" step="0.01" placeholder="0.00"
                              className="spt-price-input"
                              value={row.segChecks[seg.id]}
                              onChange={e => setCascadeSegPrice(row.id, seg.id, e.target.value)} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {visibleSegs.length === 0 && (
                    <div className="spt-cascade-price">
                      <span className="spt-cascade-price-label">Price for this model:</span>
                      <div className="spt-price-cell">
                        <span className="spt-rupee">₹</span>
                        <input type="number" min="0.01" step="0.01" placeholder="0.00"
                          className="spt-price-input" value={row.price}
                          onChange={e => setCascadePrice(row.id, e.target.value)} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        ))}
        <button type="button" className="spt-add-row-btn" onClick={addCascadeRow}>
          <Plus size={12} /> Add another Make / Model
        </button>
      </div>
    );
  }

  // ── Render the 4W form section ────────────────────────────────────────────
  function render4WSection() {
    if (!activeFwMode && !hasRealModes) return null;
    if (activeFwMode === 'free') return null;
    const label = FW_MODE_LABELS[activeFwMode] || '';
    const items = {
      checklist_vt: vehicleTypes,
      checklist_bt: bodyTypes,
      checklist_seg: segments,
    }[activeFwMode] || [];

    return (
      <div className="spt-vehicle-section">
        {/* Tab strip — always shown when real dimensions are configured.
            Universal is always the first tab so a base price can be set. */}
        {hasRealModes && (
          <div className="spt-fw-tabs">
            <button
              type="button"
              className={`spt-fw-tab ${activeFwMode === 'universal' ? 'spt-fw-tab--on' : ''}`}
              onClick={() => { setActiveFwMode('universal'); setFwChecks({}); }}
            >
              Universal
            </button>
            {fwModes.map(m => (
              <button
                key={m}
                type="button"
                className={`spt-fw-tab ${activeFwMode === m ? 'spt-fw-tab--on' : ''}`}
                onClick={() => { setActiveFwMode(m); setFwChecks({}); }}
              >
                {FW_MODE_LABELS[m]}
              </button>
            ))}
          </div>
        )}

        {/* 4-Wheeler label removed — top-level vehicle tab makes the context clear */}

        {/* Universal tab body — single price input, no dimension selection */}
        {activeFwMode === 'universal' && (
          <div className="spt-universal-body">
            <p className="spt-universal-hint">
              Base price for <strong>all vehicles</strong>. More specific rules (Segment, Body Type, Make &amp; Model) will override this.
            </p>
            <div className="spt-price-cell spt-price-cell--lg">
              <span className="spt-rupee">₹</span>
              <input
                type="number" min="0.01" step="0.01" placeholder="0.00"
                className="spt-price-input spt-price-input--lg"
                value={universalPrice}
                onChange={e => setUniversalPrice(e.target.value)}
                autoFocus
              />
            </div>
          </div>
        )}

        {activeFwMode !== 'universal' && (
          activeFwMode === 'cascade'
            ? renderCascade()
            : renderChecklist(items, fwChecks, toggleFwCheck, setFwPrice, false)
        )}
      </div>
    );
  }

  // ── Render the 2W form section ────────────────────────────────────────────
  function render2WSection() {
    if (!twMode) return null;
    return (
      <div className="spt-vehicle-section">
        {/* 2-Wheeler label removed — top-level vehicle tab makes the context clear */}
        {renderChecklist(ccCategories, twChecks, toggleTwCheck, setTwPrice, true)}
      </div>
    );
  }

  const headerLabel = (hasBoth || hasMultiFw)
    ? 'Add Pricing Rule'
    : vehicleClass === '2W'
      ? 'Set Pricing — CC Category (2W)'
      : vehicleClass === '4W' && activeFwMode
        ? FW_MODE_LABELS[activeFwMode] || 'Add Pricing Rule'
        : twMode
          ? 'Set Pricing — CC Category (2W)'
          : FW_MODE_LABELS[activeFwMode] || 'Pricing';

  return (
    <div className="sp-modal-backdrop" onClick={onClose}>
      <div className="spt-modal" onClick={e => e.stopPropagation()}>
        <div className="sp-modal-header">
          <div>
            <h3>Set Pricing — {headerLabel}</h3>
            {targetName && <p className="spt-modal-sub">{targetName}</p>}
          </div>
          <button className="sp-modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <form className="spt-modal-body" onSubmit={handleSubmit}>
          {error && <div className="spt-banner spt-banner--err"><AlertCircle size={13} /> {error}</div>}

          {/* ── Top-level 2W / 4W vehicle tabs (only for "both" services) ── */}
          {hasBoth && (
            <div className="spt-vehicle-tabs">
              <button
                type="button"
                className={`spt-vtab ${activeVehicleTab === '4W' ? 'spt-vtab--on' : ''}`}
                onClick={() => setActiveVehicleTab('4W')}
              >
                🚗 4-Wheeler
              </button>
              <button
                type="button"
                className={`spt-vtab ${activeVehicleTab === '2W' ? 'spt-vtab--on' : ''}`}
                onClick={() => setActiveVehicleTab('2W')}
              >
                🏍️ 2-Wheeler
              </button>
            </div>
          )}

          {/* Hint — only for non-both services with multiple 4W modes */}
          {!hasBoth && hasMultiFw && (
            <div className="spt-both-hint">
              <Info size={12} />
              Select which type of 4W rule to create using the tabs above.
            </div>
          )}

          {/* 4W section — always for fw/tw-only, or when 4W tab active */}
          {(!hasBoth || activeVehicleTab === '4W') && render4WSection()}

          {/* 2W section — always for tw-only, or when 2W tab active */}
          {(!hasBoth || activeVehicleTab === '2W') && render2WSection()}

          <div className="spt-modal-footer">
            <button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="button primary" disabled={saving}>
              {saving ? 'Saving…' : 'Create Rules'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// PRICING BULK UPLOAD PANEL
// ══════════════════════════════════════════════════════════════════════════
function PricingBulkPanel({ service, onClose, onSuccess, showToast }) {
  const inputRef      = useRef(null);
  const [dragging,    setDragging]    = useState(false);
  const [status,      setStatus]      = useState('idle'); // idle|uploading|validating|success|error
  const [progress,    setProgress]    = useState(0);
  const [result,      setResult]      = useState(null);
  const [showErrors,  setShowErrors]  = useState(false);

  const COLS_REQUIRED = ['price', 'rule_type'];
  const COLS_OPTIONAL = ['category', 'service', 'vehicle_type', 'body_type', 'segment', 'make', 'model', 'cc_category', 'is_active'];
  // NOTE: 'category' is optional in the schema but required in practice —
  // every pricing row must have a category. 'service' is conditional:
  // fill it for a service-level rule, leave blank for a category-level rule.

  function onDragOver(e) { e.preventDefault(); setDragging(true); }
  function onDragLeave()  { setDragging(false); }
  function onDrop(e)      { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files[0]); }

  function downloadTemplate(fmt) {
    const token = localStorage.getItem('spinoto.token');
    const url   = `${API_URL}/api/import/template/pricing?format=${fmt}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a   = document.createElement('a');
        a.href    = URL.createObjectURL(blob);
        a.download = `pricing_template.${fmt}`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
  }

  async function upload(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv','xlsx'].includes(ext)) {
      setResult({ error: `Only .csv and .xlsx accepted. Got: .${ext}`, code: 'INVALID_FILE_FORMAT' });
      setStatus('error'); return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setResult({ error: 'File exceeds 25 MB limit.', code: 'FILE_TOO_LARGE' });
      setStatus('error'); return;
    }
    setStatus('uploading'); setProgress(0); setResult(null);
    const formData = new FormData();
    formData.append('file', file);
    const token = localStorage.getItem('spinoto.token');
    try {
      const res = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', e => {
          if (e.lengthComputable) setProgress(Math.round(e.loaded / e.total * 100));
        });
        xhr.upload.addEventListener('load', () => { setStatus('validating'); setProgress(100); });
        xhr.addEventListener('load', () => {
          try { resolve({ ok: xhr.status >= 200 && xhr.status < 300, data: JSON.parse(xhr.responseText) }); }
          catch { reject(new Error('Invalid server response')); }
        });
        xhr.addEventListener('error',   () => reject(new Error('Network error')));
        xhr.open('POST', `${API_URL}/api/import/pricing`);
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.timeout = 120_000;
        xhr.send(formData);
      });
      setResult(res.data);
      setStatus(res.ok ? 'success' : 'error');
      if (res.ok) { showToast('Pricing rules imported successfully'); setTimeout(onSuccess, 1200); }
    } catch(e) {
      setResult({ error: e.message, code: 'NETWORK_ERROR' });
      setStatus('error');
    }
  }

  return (
    <div className="sp-bulk-panel">
      <div className="sp-bulk-header">
        <span className="sp-bulk-title"><UploadCloud size={15} /> Bulk Upload — Pricing Rules</span>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span className="sp-bulk-tmpl-label">Template:</span>
          <button className="sp-tmpl-btn" onClick={() => downloadTemplate('csv')}><File size={12} /> CSV</button>
          <button className="sp-tmpl-btn" onClick={() => downloadTemplate('xlsx')}><FileSpreadsheet size={12} /> Excel</button>
          <button className="sp-act-btn" onClick={onClose}><X size={14} /></button>
        </div>
      </div>

      <div className="sp-bulk-cols">
        {COLS_REQUIRED.map(c => <span key={c} className="sp-bulk-col sp-bulk-col--req">{c}</span>)}
        {COLS_OPTIONAL.map(c => {
          if (c === 'category') return (
            <span key={c} className="sp-bulk-col sp-bulk-col--req" title="Required on every row">
              {c} <em>*</em>
            </span>
          );
          if (c === 'service') return (
            <span key={c} className="sp-bulk-col sp-bulk-col--cond" title="Fill for service-level rule; leave blank for category-level rule">
              {c} <em>(cond)</em>
            </span>
          );
          return <span key={c} className="sp-bulk-col sp-bulk-col--opt">{c} <em>(opt)</em></span>;
        })}
      </div>
      <div className="sp-bulk-rule-modes">
        <span className="sp-bulk-mode-badge sp-bulk-mode-badge--svc">Service-level</span>
        <span className="sp-bulk-mode-tip">category + service → rule for that service only</span>
        <span className="sp-bulk-mode-badge sp-bulk-mode-badge--cat" style={{ marginLeft: 10 }}>Category-level</span>
        <span className="sp-bulk-mode-tip">category only (service blank) → rule for all services in category</span>
      </div>

      {(status === 'idle' || status === 'error') && (
        <div
          className={`sp-drop-zone ${dragging ? 'sp-drop-zone--active' : ''}`}
          onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input ref={inputRef} type="file" accept=".csv,.xlsx" style={{ display:'none' }}
            onChange={e => { upload(e.target.files[0]); e.target.value = ''; }} />
          <UploadCloud size={22} />
          <span>{status === 'error' ? 'Try again — drop a new file' : 'Drop file or click to browse'}</span>
          <span className="muted" style={{ fontSize:12 }}>.csv or .xlsx · Max 25 MB</span>
        </div>
      )}

      {status === 'uploading' && (
        <div className="sp-progress-block">
          <div className="sp-progress-label"><span>Uploading…</span><span>{progress}%</span></div>
          <div className="sp-progress-track"><div className="sp-progress-fill" style={{ width:`${progress}%` }} /></div>
        </div>
      )}

      {status === 'validating' && (
        <div className="sp-validating"><span className="sp-spinner" /> Validating data…</div>
      )}

      {status === 'success' && result && (
        <div className="sp-bulk-result sp-bulk-result--ok">
          <CheckCircle2 size={16} /> Import complete
          <div className="sp-upsert-chips">
            {result.inserted  > 0 && <span className="sp-chip sp-chip--ins">＋ {result.inserted} inserted</span>}
            {result.updated   > 0 && <span className="sp-chip sp-chip--upd">✎ {result.updated} updated</span>}
            {result.unchanged > 0 && <span className="sp-chip sp-chip--unc">● {result.unchanged} unchanged</span>}
          </div>
        </div>
      )}

      {status === 'error' && result && (
        <div className="sp-bulk-result sp-bulk-result--err">
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <AlertCircle size={16} />
            <span>{result.code === 'VALIDATION_FAILED'
              ? `Validation failed — ${result.errorCount} error(s)`
              : 'Upload failed'}</span>
          </div>
          <div style={{ fontSize:13, marginTop:4 }}>{result.error}</div>
          {result.errors?.length > 0 && (
            <>
              <button className="sp-err-toggle" onClick={() => setShowErrors(v => !v)}>
                {showErrors ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {showErrors ? 'Hide' : 'Show'} {result.errors.length} error(s)
              </button>
              {showErrors && (
                <div className="sp-err-table-wrap">
                  <table className="sp-err-table">
                    <thead><tr><th>Row</th><th>Column</th><th>Error</th></tr></thead>
                    <tbody>
                      {result.errors.map((err, i) => (
                        <tr key={i}>
                          <td>{err.row}</td>
                          <td><code>{err.column}</code></td>
                          <td>{err.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// CATEGORY MODAL
// ══════════════════════════════════════════════════════════════════════════
function CategoryModal({ mode, item, onSave, onClose }) {
  const [form, setForm] = useState({
    name:          item?.name          || '',
    description:   item?.description   || '',
    vehicle_class: item?.vehicle_class || 'both',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  async function handleSubmit(e) {
    e.preventDefault(); setError(''); setSaving(true);
    try { await onSave(form); }
    catch(e) { setError(e.message); setSaving(false); }
  }

  return (
    <div className="sp-modal-backdrop" onClick={onClose}>
      <div className="sp-modal sp-modal--sm" onClick={e => e.stopPropagation()}>
        <div className="sp-modal-header">
          <h3>{mode === 'create' ? 'New Category' : 'Edit Category'}</h3>
          <button className="sp-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form className="sp-modal-body" onSubmit={handleSubmit}>
          {error && <div className="sp-form-error"><AlertCircle size={14} /> {error}</div>}
          <div className="sp-form-field">
            <label>Name <span className="sp-req">*</span></label>
            <input className="sp-input" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} required />
          </div>
          <div className="sp-form-field">
            <label>Applies To <span className="sp-req">*</span></label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { v: 'both', label: '🚗🏍️ Both' },
                { v: '4W',   label: '🚗 4W Only' },
                { v: '2W',   label: '🏍️ 2W Only' },
              ].map(({ v, label }) => (
                <button
                  key={v} type="button"
                  onClick={() => setForm(f => ({ ...f, vehicle_class: v }))}
                  style={{
                    flex: 1, padding: '8px 4px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', transition: 'all 0.15s',
                    border: form.vehicle_class === v ? '2px solid var(--primary)' : '2px solid var(--border)',
                    background: form.vehicle_class === v ? 'var(--primary)' : 'var(--bg-soft)',
                    color: form.vehicle_class === v ? '#fff' : 'var(--text-muted)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
              Controls which pricing dimensions are available for this category
            </span>
          </div>
          <div className="sp-form-field">
            <label>Description</label>
            <textarea className="sp-input sp-textarea" rows={2} value={form.description}
              onChange={e => setForm(f => ({...f, description: e.target.value}))} placeholder="Optional…" />
          </div>
          <div className="sp-modal-footer">
            <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="button primary" disabled={saving}>
              {saving ? 'Saving…' : (mode === 'create' ? 'Create' : 'Save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// SERVICE MODAL
// ══════════════════════════════════════════════════════════════════════════
const VC_LABELS = { both: '🚗🏍️ Both (2W + 4W)', fw: '🚗 4W Only', tw: '🏍️ 2W Only' };

function ServiceModal({ mode, item, categories, defaultCatId, onSave, onClose }) {
  const [form, setForm] = useState({
    category_id:   item?.category_id   || defaultCatId || '',
    name:          item?.name          || '',
    description:   item?.description   || '',
    vehicle_class: item?.vehicle_class || 'both',
    gst_percent:   item?.gst_percent   ?? '',
    sac_code:      item?.sac_code      || '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  // Derive the selected category object to know its vehicle_class constraint
  const selectedCategory = categories.find(c => String(c.id) === String(form.category_id));
  const catVc = selectedCategory?.vehicle_class || 'both';

  // Allowed vehicle_class options based on the category's vehicle_class:
  //   4W  → only 4W Only
  //   2W  → only 2W Only
  //   both → all three (Both, 4W Only, 2W Only)
  const allowedVc = catVc === '4W' ? ['4W'] : catVc === '2W' ? ['2W'] : ['both', '4W', '2W'];

  // When the category changes, reset vehicle_class to match the new category's constraint
  function handleCategoryChange(e) {
    const newCatId = e.target.value;
    const newCat = categories.find(c => String(c.id) === String(newCatId));
    const newCatVc = newCat?.vehicle_class || 'both';
    // Determine a valid vehicle_class for the new category
    const newAllowed = newCatVc === '4W' ? ['4W'] : newCatVc === '2W' ? ['2W'] : ['both', '4W', '2W'];
    const newVc = newAllowed.includes(form.vehicle_class) ? form.vehicle_class : newCatVc;
    setForm(f => ({ ...f, category_id: newCatId, vehicle_class: newVc }));
  }

  async function handleSubmit(e) {
    e.preventDefault(); setError(''); setSaving(true);
    try {
      await onSave({
        ...form,
        category_id:   Number(form.category_id),
        gst_percent:   parseFloat(form.gst_percent)   || null,
        sac_code:      form.sac_code.trim() || null,
      });
    }
    catch(e) { setError(e.message); setSaving(false); }
  }

  return (
    <div className="sp-modal-backdrop" onClick={onClose}>
      <div className="sp-modal sp-modal--sm" onClick={e => e.stopPropagation()}>
        <div className="sp-modal-header">
          <h3>{mode === 'create' ? 'New Service' : 'Edit Service'}</h3>
          <button className="sp-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form className="sp-modal-body" onSubmit={handleSubmit}>
          {error && <div className="sp-form-error"><AlertCircle size={14} /> {error}</div>}
          <div className="sp-form-field">
            <label>Category <span className="sp-req">*</span></label>
            <select className="sp-input" value={form.category_id} onChange={handleCategoryChange} required>
              <option value="">Select category…</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="sp-form-field">
            <label>Service Name <span className="sp-req">*</span></label>
            <input className="sp-input" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} required />
          </div>
          <div className="sp-form-field">
            <label>Applies To <span className="sp-req">*</span></label>
            <div style={{ display: 'flex', gap: 8 }}>
              {allowedVc.map(v => (
                <button
                  key={v} type="button"
                  onClick={() => setForm(f => ({...f, vehicle_class: v}))}
                  style={{
                    flex: 1, padding: '8px 4px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', transition: 'all 0.15s',
                    border: form.vehicle_class === v ? '2px solid var(--primary)' : '2px solid var(--border)',
                    background: form.vehicle_class === v ? 'var(--primary)' : 'var(--bg-soft)',
                    color: form.vehicle_class === v ? '#fff' : 'var(--text-muted)',
                  }}
                >
                  {VC_LABELS[v]}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
              Controls which vehicle class can add this service to a lead
            </span>
          </div>
          <div className="sp-form-field">
            <label>Description</label>
            <textarea className="sp-input sp-textarea" rows={3} value={form.description}
              onChange={e => setForm(f => ({...f, description: e.target.value}))} placeholder="Optional…" />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="sp-form-field" style={{ flex: 1 }}>
              <label>GST %</label>
              <input
                className="sp-input"
                type="number"
                min="0"
                max="100"
                step="0.01"
                placeholder="e.g. 18.00"
                value={form.gst_percent}
                onChange={e => setForm(f => ({...f, gst_percent: e.target.value}))}
              />
            </div>
            <div className="sp-form-field" style={{ flex: 1 }}>
              <label>SAC Code <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}>(optional)</span></label>
              <input
                className="sp-input"
                placeholder="e.g. 998714"
                maxLength={20}
                value={form.sac_code}
                onChange={e => setForm(f => ({...f, sac_code: e.target.value}))}
              />
            </div>
          </div>
          <div className="sp-modal-footer">
            <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="button primary" disabled={saving}>
              {saving ? 'Saving…' : (mode === 'create' ? 'Create' : 'Save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// DELETE MODAL
// ══════════════════════════════════════════════════════════════════════════
function DeleteModal({ type, item, onConfirm, onClose }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function handleConfirm() {
    setLoading(true); setError('');
    try { await onConfirm(); }
    catch(e) { setError(e.message); setLoading(false); }
  }

  return (
    <div className="sp-modal-backdrop" onClick={onClose}>
      <div className="sp-modal sp-modal--sm" onClick={e => e.stopPropagation()}>
        <div className="sp-modal-header">
          <h3>Delete {type === 'category' ? 'Category' : 'Service'}</h3>
          <button className="sp-modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="sp-modal-body">
          {error && <div className="sp-form-error"><AlertCircle size={14} /> {error}</div>}
          <p style={{ margin: '0 0 16px', fontSize: 14 }}>
            Are you sure you want to delete <strong>{item.name}</strong>?
            {type === 'category' && ' All services and pricing rules under this category will also be removed.'}
            {type === 'service'  && ' All pricing rules for this service will also be removed.'}
          </p>
          <div className="sp-modal-footer">
            <button className="button secondary" onClick={onClose} disabled={loading}>Cancel</button>
            <button className="button danger" onClick={handleConfirm} disabled={loading}>
              {loading ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// STYLES
