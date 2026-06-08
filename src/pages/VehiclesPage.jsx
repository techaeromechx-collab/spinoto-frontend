import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { api } from '../api/client.js';
import { useCan } from '../auth/AuthContext.jsx';
import {
  Plus, Search, Edit2, Trash2, UploadCloud, Download,
  AlertCircle, CheckCircle2, X, ChevronDown, ChevronUp,
  AlertTriangle, Info, FileSpreadsheet, File, Car, Bike,
  ToggleLeft, ToggleRight, Pencil, Check, Settings2,
} from 'lucide-react';
import '../styles/VehiclesPage.css';

// ─── Classify vehicle types as 2W or 4W by name pattern ──────────────────────
function is2WType(name = '') {
  const n = name.toLowerCase();
  return n.includes('two') || n.includes('2w') || n.includes('2-w')
      || n.includes('bike') || n.includes('scoot') || n.includes('motor');
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// ─── Permission codes ─────────────────────────────────────────────────────────
const P = {
  view: ['VIEW_VEHICLE', 'MANAGE_MASTER_DATA'],
  create: ['CREATE_VEHICLE', 'MANAGE_MASTER_DATA'],
  update: ['UPDATE_VEHICLE', 'MANAGE_MASTER_DATA'],
  delete: ['DELETE_VEHICLE', 'MANAGE_MASTER_DATA'],
  upload: ['BULK_UPLOAD_VEHICLE', 'BULK_UPLOAD', 'MANAGE_MASTER_DATA'],
};

// ═════════════════════════════════════════════════════════════════════════════
// Page
// ═════════════════════════════════════════════════════════════════════════════
export default function VehiclesPage() {
  // permissions
  const canCreate           = useCan(...P.create);
  const canUpdate           = useCan(...P.update);
  const canDelete           = useCan(...P.delete);
  const canUpload           = useCan(...P.upload);
  const canViewReferenceData = useCan(
    'VIEW_REFERENCE_DATA', 'MANAGE_VEHICLE_TYPES', 'MANAGE_BODY_TYPES',
    'MANAGE_SEGMENTS', 'VIEW_CC_CATEGORY', 'CREATE_CC_CATEGORY',
    'EDIT_CC_CATEGORY', 'DELETE_CC_CATEGORY', 'MANAGE_CC_CATEGORY',
    'MANAGE_MASTER_DATA',
  );
  // Granular write permissions for reference data panels
  const canManageVehicleTypes = useCan('MANAGE_VEHICLE_TYPES', 'MANAGE_MASTER_DATA');
  const canManageBodyTypes    = useCan('MANAGE_BODY_TYPES',    'MANAGE_MASTER_DATA');
  const canManageSegments     = useCan('MANAGE_SEGMENTS',      'MANAGE_MASTER_DATA');
  const canManageCCCategories = useCan('CREATE_CC_CATEGORY', 'EDIT_CC_CATEGORY', 'DELETE_CC_CATEGORY', 'MANAGE_CC_CATEGORY', 'MANAGE_MASTER_DATA');

  // table state
  const [vehicles, setVehicles] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // filters — no filterType; the active tab IS the type filter
  const [search, setSearch] = useState('');
  const [filterMake, setFilterMake] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  // reference lists for dropdowns
  const [refTypes, setRefTypes] = useState([]);
  const [refMakes, setRefMakes] = useState([]);
  const [refSegments, setRefSegments] = useState([]);
  const [refBodyTypes, setRefBodyTypes] = useState([]);

  // modals
  const [editTarget, setEditTarget] = useState(null);  // null=closed, {}=new, {id,...}=edit
  const [deleteTarget, setDeleteTarget] = useState(null);

  // bulk upload state — null=closed, 'tw'=2W panel open, 'fw'=4W panel open
  const [showUpload, setShowUpload] = useState(null);

  // tab view state — 'tw' | 'fw' | 'reference'
  const [activeTab, setActiveTab] = useState('2W');

  // Makes shown in the filter dropdown, scoped to the active tab's vehicle class
  const filteredMakesForFilter = useMemo(() => {
    const twIds = new Set(refTypes.filter(t => is2WType(t.name)).map(t => t.id));
    const fwIds = new Set(refTypes.filter(t => !is2WType(t.name)).map(t => t.id));
    if (activeTab === '2W') return refMakes.filter(m => twIds.has(m.vehicle_type_id));
    if (activeTab === '4W') return refMakes.filter(m => fwIds.has(m.vehicle_type_id));
    return refMakes;
  }, [refMakes, refTypes, activeTab]);

  const loadVehicles = useCallback(async (opts = {}) => {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams();
      const s   = opts.search ?? search;
      const m   = opts.make   ?? filterMake;
      const pg  = opts.page   ?? page;
      const lim = opts.limit  ?? limit;
      const tab = opts.tab    ?? activeTab;
      if (s) p.set('search', s);
      if (m) p.set('make_id', m);
      if (tab === '2W') p.set('type_class', '2W');
      else if (tab === '4W') p.set('type_class', '4W');
      p.set('page', pg);
      p.set('limit', lim);
      const r = await api(`/api/vehicles/records?${p}`);
      setVehicles(r.items);
      setTotal(r.total);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [search, filterMake, page, limit, activeTab]);

  async function loadRefs() {
    // Active-only for dropdowns in the vehicle form
    const [types, makes, segs, bts] = await Promise.all([
      api('/api/vehicles/types'),
      api('/api/vehicles/makes'),
      api('/api/vehicles/segments'),
      api('/api/vehicles/body-types'),
    ]);
    setRefTypes(types.items);
    setRefMakes(makes.items);
    setRefSegments(segs.items);
    setRefBodyTypes(bts.items);
  }

  useEffect(() => { loadVehicles(); loadRefs(); }, []);

  // re-load when filters/page change
  useEffect(() => { loadVehicles(); }, [search, filterMake, page, limit]);

  // Reload ref data every time the Add/Edit modal is opened so newly added or
  // just-activated body types and segments appear immediately without a page refresh
  useEffect(() => { if (editTarget !== null) loadRefs(); }, [editTarget]);

  function handleSearch(v) { setSearch(v); setPage(1); loadVehicles({ search: v, page: 1 }); }
  function handleMakeFilter(v) { setFilterMake(v); setPage(1); loadVehicles({ make: v, page: 1 }); }

  // Switch between 2W / 4W tabs — resets search & make filter, reloads vehicles
  function switchVehicleTab(tab) {
    setActiveTab(tab);
    setFilterMake('');
    setSearch('');
    setPage(1);
    if (tab !== 'reference') {
      loadVehicles({ tab, make: '', search: '', page: 1 });
    }
  }

  async function handleDelete(v) {
    try {
      await api(`/api/vehicles/records/${v.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      loadVehicles();
    } catch (e) {
      alert(e.message);
    }
  }

  // ── CSV export ────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);

  function downloadCSV(rows, filename) {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map(r =>
        headers.map(h => {
          const v = r[h] ?? '';
          return typeof v === 'string' && v.includes(',') ? `"${v}"` : v;
        }).join(',')
      ),
    ].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  async function exportVehicles(vehicleClass) {
    setExporting(true);
    try {
      const r = await api(`/api/vehicles/records?type_class=${vehicleClass}&limit=9999`);
      const items = r.items || [];
      if (vehicleClass === '2W') {
        const rows = items.map(v => ({
          Make:        v.make        || '',
          Model:       v.model       || '',
          'Engine CC': v.engine_cc   || '',
          'CC Category': v.cc_category || '',
          Active:      v.is_active ? 'Yes' : 'No',
        }));
        downloadCSV(rows, 'vehicles-2w.csv');
      } else {
        const rows = items.map(v => ({
          Make:       v.make      || '',
          Model:      v.model     || '',
          Segment:    v.segment   || '',
          'Body Type': v.body_type || '',
          Active:     v.is_active ? 'Yes' : 'No',
        }));
        downloadCSV(rows, 'vehicles-4w.csv');
      }
    } catch (e) {
      alert('Export failed: ' + e.message);
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="vp-page">
      <header className="page-header">
        <div>
          <h2>Vehicle Registry</h2>
          <p>Manage 2W and 4W vehicle records — make, model, segment and body type.</p>
        </div>
        <div className="vp-header-actions">
          {activeTab === '2W' && (
            <button className="btn btn-secondary" onClick={() => exportVehicles('2W')} disabled={exporting}>
              <Download size={15} /> {exporting ? 'Exporting…' : 'Export 2W'}
            </button>
          )}
          {activeTab === '4W' && (
            <button className="btn btn-secondary" onClick={() => exportVehicles('4W')} disabled={exporting}>
              <Download size={15} /> {exporting ? 'Exporting…' : 'Export 4W'}
            </button>
          )}
          {canUpload && activeTab === '2W' && (
            <button className="btn btn-secondary"
              onClick={() => setShowUpload(v => v === '2W' ? null : '2W')}>
              <UploadCloud size={15} /> Bulk Upload 2W
            </button>
          )}
          {canUpload && activeTab === '4W' && (
            <button className="btn btn-secondary"
              onClick={() => setShowUpload(v => v === '4W' ? null : '4W')}>
              <UploadCloud size={15} /> Bulk Upload 4W
            </button>
          )}
          {canCreate && activeTab !== 'reference' && (
            <button className="btn btn-primary" onClick={() => setEditTarget({})}>
              <Plus size={15} /> Add {activeTab === '2W' ? '2W' : '4W'} Vehicle
            </button>
          )}
        </div>
      </header>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div className="vp-tabs">
        <button
          className={`vp-tab-btn ${activeTab === '2W' ? 'active' : ''}`}
          onClick={() => switchVehicleTab('2W')}
        >
          <Bike size={16} /> 2W · Two-Wheeler
        </button>
        <button
          className={`vp-tab-btn ${activeTab === '4W' ? 'active' : ''}`}
          onClick={() => switchVehicleTab('4W')}
        >
          <Car size={16} /> 4W · Four-Wheeler
        </button>
        {canViewReferenceData && (
          <button
            className={`vp-tab-btn ${activeTab === 'reference' ? 'active' : ''}`}
            onClick={() => setActiveTab('reference')}
          >
            <Settings2 size={16} /> Reference Data
          </button>
        )}
      </div>

      {/* ── Bulk Upload Panel ─────────────────────────────────────────────── */}
      {showUpload && canUpload && (
        <BulkUploadPanel
          vehicleClass={showUpload}
          onClose={() => setShowUpload(null)}
          onSuccess={() => { setShowUpload(null); loadVehicles(); loadRefs(); }}
        />
      )}

      {(activeTab === '2W' || activeTab === '4W') && (
        <>
          {/* ── Filters ───────────────────────────────────────────────────────── */}
          <div className="vp-filters card">
            <div className="vp-filter-search">
              <Search size={15} />
              <input
                placeholder={activeTab === '2W'
                  ? 'Search make, model, segment, body type, CC…'
                  : 'Search make, model, segment, body type…'}
                value={search}
                onChange={e => handleSearch(e.target.value)}
              />
              {search && <button className="clear-btn" onClick={() => handleSearch('')}><X size={13} /></button>}
            </div>
            <select value={filterMake} onChange={e => handleMakeFilter(e.target.value)} disabled={!filteredMakesForFilter.length}>
              <option value="">All Makes</option>
              {filteredMakesForFilter.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <span className="vp-count">{total} {activeTab === '2W' ? '2W' : '4W'} record{total !== 1 ? 's' : ''}</span>
          </div>

          {/* ── Table ────────────────────────────────────────────────────────── */}
          <div className="card vp-table-wrap">
            {error && (
              <div className="vp-error"><AlertCircle size={16} /> {error}</div>
            )}
            {loading && !vehicles.length ? (
              <div className="vp-loading">
                <span className="spinner" /> Loading vehicles…
              </div>
            ) : !vehicles.length ? (
              <div className="vp-empty">
                {activeTab === '2W' ? <Bike size={40} /> : <Car size={40} />}
                <p>No {activeTab === '2W' ? 'two-wheeler' : 'four-wheeler'} vehicles found{search || filterMake ? ' — try adjusting your filters' : ''}.</p>
                {canCreate && !search && !filterMake && (
                  <button className="btn btn-primary" onClick={() => setEditTarget({})}>
                    <Plus size={14} /> Add your first {activeTab === '2W' ? '2W' : '4W'} vehicle
                  </button>
                )}
              </div>
            ) : (<>
              {/* ── Desktop table ── */}
              <table className="vp-table">
                <thead>
                  <tr>
                    <th>Make</th>
                    <th>Model</th>
                    {activeTab === '4W' && <th>Segment / Fuel</th>}
                    {activeTab === '4W' && <th>Body Type</th>}
                    {activeTab === '2W' && <th>Engine CC / CC Category</th>}
                    {(canUpdate || canDelete) && <th className="vp-actions-col">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {vehicles.map(v => (
                    <tr key={v.id} className={!v.is_active ? 'row-inactive' : ''}>
                      <td>{v.make}</td>
                      <td className="model-cell">{v.model}</td>
                      {activeTab === '4W' && (
                        <td>{v.segment ? <span className="pill pill-segment">{v.segment}</span> : <span className="null-val">—</span>}</td>
                      )}
                      {activeTab === '4W' && (
                        <td>{v.body_type ? <span className="pill pill-body">{v.body_type}</span> : <span className="null-val">—</span>}</td>
                      )}
                      {activeTab === '2W' && (
                        <td>
                          {v.engine_cc
                            ? <span className="pill-cc">
                                <span className="cc-num-val">{v.engine_cc} cc</span>
                                {v.cc_category ? <span className="cc-cat-tag">{v.cc_category}</span> : null}
                              </span>
                            : v.cc_category
                              ? <span className="pill-cc"><span className="cc-cat-tag">{v.cc_category}</span></span>
                              : <span className="null-val">—</span>}
                        </td>
                      )}
                      {(canUpdate || canDelete) && (
                        <td className="vp-actions-cell">
                          {canUpdate && (
                            <button className="row-btn edit-btn" title="Edit" onClick={() => setEditTarget(v)}>
                              <Edit2 size={14} />
                            </button>
                          )}
                          {canDelete && (
                            <button className="row-btn delete-btn" title="Delete" onClick={() => setDeleteTarget(v)}>
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* ── Mobile card list ── */}
              <div className="vp-mobile-cards">
                {vehicles.map(v => (
                  <div key={v.id} className="vp-mobile-card" style={{ opacity: v.is_active ? 1 : 0.55 }}>
                    <div className="vp-mobile-card-info">
                      <div className="vp-mobile-card-name">{v.make} {v.model}</div>
                      <div className="vp-mobile-card-meta">
                        {activeTab === '4W' && v.segment && (
                          <span className="pill pill-segment">{v.segment}</span>
                        )}
                        {activeTab === '4W' && v.body_type && (
                          <span className="pill pill-body">{v.body_type}</span>
                        )}
                        {activeTab === '2W' && v.engine_cc && (
                          <span className="pill-cc">
                            <span className="cc-num-val">{v.engine_cc} cc</span>
                            {v.cc_category && <span className="cc-cat-tag">{v.cc_category}</span>}
                          </span>
                        )}
                        {activeTab === '2W' && !v.engine_cc && v.cc_category && (
                          <span className="pill-cc"><span className="cc-cat-tag">{v.cc_category}</span></span>
                        )}
                        {!v.is_active && <span style={{ fontSize: 10, color: '#dc2626', fontWeight: 700, background: '#fee2e2', padding: '1px 6px', borderRadius: 4 }}>Inactive</span>}
                      </div>
                    </div>
                    {(canUpdate || canDelete) && (
                      <div className="vp-mobile-card-actions">
                        {canUpdate && (
                          <button className="row-btn edit-btn" title="Edit" onClick={() => setEditTarget(v)}>
                            <Edit2 size={14} />
                          </button>
                        )}
                        {canDelete && (
                          <button className="row-btn delete-btn" title="Delete" onClick={() => setDeleteTarget(v)}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>)}

            {/* Pagination */}
            <div className="vp-pagination-premium">
              <div className="vpp-summary">
                Showing <strong>{total === 0 ? 0 : (page - 1) * limit + 1}</strong> to <strong>{Math.min(page * limit, total)}</strong> of <strong>{total}</strong> vehicles
              </div>

              {totalPages > 1 && (
                <div className="vpp-controls">
                  <button
                    className="vpp-nav-btn"
                    disabled={page === 1}
                    onClick={() => { setPage(1); loadVehicles({ page: 1 }); }}
                    title="First Page"
                  >
                    «
                  </button>
                  <button
                    className="vpp-nav-btn"
                    disabled={page === 1}
                    onClick={() => { const prev = page - 1; setPage(prev); loadVehicles({ page: prev }); }}
                    title="Previous"
                  >
                    ‹
                  </button>

                  {(() => {
                    const pages = [];
                    if (totalPages <= 7) {
                      for (let i = 1; i <= totalPages; i++) pages.push(i);
                    } else {
                      if (page <= 4) {
                        pages.push(1, 2, 3, 4, 5, '...', totalPages);
                      } else if (page >= totalPages - 3) {
                        pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
                      } else {
                        pages.push(1, '...', page - 1, page, page + 1, '...', totalPages);
                      }
                    }

                    return pages.map((p, idx) => {
                      if (p === '...') {
                        return <span key={`dots-${idx}`} className="vpp-dots">...</span>;
                      }
                      return (
                        <button
                          key={p}
                          className={`vpp-page-btn ${page === p ? 'active' : ''}`}
                          onClick={() => { setPage(p); loadVehicles({ page: p }); }}
                        >
                          {p}
                        </button>
                      );
                    });
                  })()}

                  <button
                    className="vpp-nav-btn"
                    disabled={page === totalPages}
                    onClick={() => { const next = page + 1; setPage(next); loadVehicles({ page: next }); }}
                    title="Next"
                  >
                    ›
                  </button>
                  <button
                    className="vpp-nav-btn"
                    disabled={page === totalPages}
                    onClick={() => { setPage(totalPages); loadVehicles({ page: totalPages }); }}
                    title="Last Page"
                  >
                    »
                  </button>
                </div>
              )}

              <div className="vpp-limit">
                <span className="vpp-limit-label">Show</span>
                <select
                  value={limit}
                  onChange={(e) => {
                    const l = Number(e.target.value);
                    setLimit(l);
                    setPage(1);
                    loadVehicles({ limit: l, page: 1 });
                  }}
                  className="vpp-limit-select"
                >
                  {[10, 25, 50, 100].map(l => (
                    <option key={l} value={l}>{l} / page</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Reference Data Management ────────────────────────────────────── */}
      {activeTab === 'reference' && canViewReferenceData && (
        <div className="vp-refdata-section">
          <div className="vp-refdata-heading">
            <Settings2 size={15} />
            <span>Reference Data</span>
            <span className="vp-refdata-hint">Deactivated items are hidden from all dropdowns and forms</span>
          </div>
          <div className="vp-refdata-grid">
            <RefDataPanel
              title="Vehicle Types"
              fetchUrl="/api/vehicles/types?all=true"
              createUrl="/api/vehicles/types"
              updateUrl={id => `/api/vehicles/types/${id}`}
              deleteUrl={id => `/api/vehicles/types/${id}`}
              placeholder="e.g. Two-Wheeler"
              canManage={canManageVehicleTypes}
            />
            <RefDataPanel
              title="Body Types"
              fetchUrl="/api/vehicles/body-types?all=true"
              createUrl="/api/vehicles/body-types"
              updateUrl={id => `/api/vehicles/body-types/${id}`}
              deleteUrl={id => `/api/vehicles/body-types/${id}`}
              placeholder="e.g. Hatchback"
              onChanged={loadRefs}
              canManage={canManageBodyTypes}
            />
            <RefDataPanel
              title="Segments / Fuel Types"
              fetchUrl="/api/vehicles/segments?all=true"
              createUrl="/api/vehicles/segments"
              updateUrl={id => `/api/vehicles/segments/${id}`}
              deleteUrl={id => `/api/vehicles/segments/${id}`}
              placeholder="e.g. Petrol"
              onChanged={loadRefs}
              canManage={canManageSegments}
            />
          </div>

          {/* ── CC Categories — full-width panel ────────────────────────── */}
          <div className="vp-cc-section">
            <div className="vp-cc-heading">
              <span>🏍️ CC Categories (Two-Wheeler Engine Capacity)</span>
              <span className="vp-refdata-hint">Defines price segments by engine CC for Two-Wheelers. Ranges must not overlap.</span>
            </div>
            <CCCategoriesPanel canManage={canManageCCCategories} />
          </div>
        </div>
      )}

      {/* ── Add / Edit Modal ─────────────────────────────────────────────── */}
      {editTarget !== null && (
        <VehicleModal
          vehicle={editTarget}
          refTypes={refTypes}
          refMakes={refMakes}
          refSegments={refSegments}
          refBodyTypes={refBodyTypes}
          defaultTypeClass={editTarget?.id ? null : activeTab}  // pre-set class for new records
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); loadVehicles(); loadRefs(); }}
        />
      )}

      {/* ── Delete Confirm ───────────────────────────────────────────────── */}
      {deleteTarget && (
        <DeleteConfirm
          vehicle={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => handleDelete(deleteTarget)}
        />
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Vehicle Add / Edit Modal
// ═════════════════════════════════════════════════════════════════════════════
function VehicleModal({ vehicle, refTypes, refMakes, refSegments, refBodyTypes, defaultTypeClass, onClose, onSaved }) {
  const isEdit = !!vehicle?.id;

  // Pre-fill vehicle type for new records based on which tab is active
  const defaultTypeName = !isEdit && defaultTypeClass
    ? (defaultTypeClass === '2W'
        ? refTypes.find(t => is2WType(t.name))?.name || ''
        : refTypes.find(t => !is2WType(t.name))?.name || '')
    : '';

  const [form, setForm] = useState({
    type:      vehicle?.type      || defaultTypeName,
    make:      vehicle?.make      || '',
    model:     vehicle?.model     || '',
    // Edit mode: single segment string. Create mode (4W): array of selected segments.
    segment:   vehicle?.segment   || '',
    body_type: vehicle?.body_type || '',
    engine_cc: vehicle?.engine_cc ? String(vehicle.engine_cc) : '',
  });

  // Multi-segment selection for new 4W vehicles
  const [selectedSegments, setSelectedSegments] = useState([]); // array of segment name strings (ref data only)

  // Show Engine CC field only when the selected type is a 2W type
  const selectedTypeIs2W = is2WType(form.type);
  const [saving,      setSaving]      = useState(false);
  const [formErr,     setFormErr]     = useState(null);
  const [saveResult,  setSaveResult]  = useState(null); // { added, skipped }
  const [ccPreview,   setCcPreview]   = useState(
    vehicle?.cc_category ? `${vehicle.cc_category} (${vehicle.min_cc}–${vehicle.max_cc} cc)` : ''
  );

  // Makes filtered by selected type (also allow freetext if type not in list)
  const filteredMakes = useMemo(() => {
    const matchedType = refTypes.find(t => t.name.toLowerCase() === form.type.toLowerCase());
    return matchedType ? refMakes.filter(m => m.vehicle_type_id === matchedType.id) : [];
  }, [refTypes, refMakes, form.type]);

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }));
    if (field === 'type') setForm(f => ({ ...f, type: val, make: '' }));
  }

  // Toggle a ref-data segment chip on/off (create mode only)
  function toggleSegment(name) {
    setSelectedSegments(prev =>
      prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]
    );
  }

  async function handleEngineCcBlur() {
    const cc = parseInt(form.engine_cc, 10);
    if (!cc || cc <= 0) { setCcPreview(''); return; }
    try {
      const r = await api('/api/cc-categories/classify', { method: 'POST', body: { cc } });
      if (r.item) setCcPreview(`${r.item.name} (${r.item.min_cc}–${r.item.max_cc} cc)`);
      else setCcPreview('No category matched');
    } catch { setCcPreview(''); }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormErr(null);
    setSaveResult(null);
    if (!form.type.trim()) return setFormErr("Vehicle type is required.");
    if (!form.make.trim()) return setFormErr("Make is required.");
    if (!form.model.trim()) return setFormErr("Model is required.");

    // 4W create: must have at least one segment selected (only from ref data)
    if (!isEdit && !selectedTypeIs2W && selectedSegments.length === 0) {
      return setFormErr("Select at least one Segment / Fuel type.");
    }
    // 4W edit: segment must be filled and in ref data
    if (isEdit && !selectedTypeIs2W) {
      if (!form.segment.trim()) return setFormErr("Segment / Fuel is required for 4W vehicles.");
      const inRef = refSegments.some(s => s.name.toLowerCase() === form.segment.trim().toLowerCase());
      if (!inRef) return setFormErr("This segment is not in Reference Data. Please first create it in Reference Data → Segments.");
    }
    if (!selectedTypeIs2W && !form.body_type.trim()) return setFormErr("Body Type is required for 4W vehicles.");
    if (!selectedTypeIs2W) {
      const fw4WBodyTypes = refBodyTypes.filter(b => !is2WType(b.name));
      const inRef = fw4WBodyTypes.some(b => b.name.toLowerCase() === form.body_type.trim().toLowerCase());
      if (!inRef) return setFormErr("This body type is not in Reference Data. Please first create it in Reference Data → Body Types.");
    }

    setSaving(true);
    try {
      if (isEdit) {
        // Edit mode — single record update (unchanged)
        const body = {
          type:      form.type.trim(),
          make:      form.make.trim(),
          model:     form.model.trim(),
          segment:   selectedTypeIs2W ? null : (form.segment.trim() || null),
          body_type: selectedTypeIs2W ? null : (form.body_type.trim() || null),
          engine_cc: selectedTypeIs2W ? (parseInt(form.engine_cc, 10) || null) : null,
        };
        await api(`/api/vehicles/records/${vehicle.id}`, { method: 'PATCH', body });
        onSaved();
      } else if (selectedTypeIs2W) {
        // 2W create — no segments
        const body = {
          type:      form.type.trim(),
          make:      form.make.trim(),
          model:     form.model.trim(),
          segment:   null,
          body_type: null,
          engine_cc: parseInt(form.engine_cc, 10) || null,
        };
        await api('/api/vehicles/records', { method: 'POST', body });
        onSaved();
      } else {
        // 4W create — one API call per selected segment
        const base = {
          type:      form.type.trim(),
          make:      form.make.trim(),
          model:     form.model.trim(),
          body_type: form.body_type.trim(),
          engine_cc: null,
        };
        const added   = [];
        const skipped = [];
        for (const seg of selectedSegments) {
          try {
            await api('/api/vehicles/records', { method: 'POST', body: { ...base, segment: seg } });
            added.push(seg);
          } catch (err) {
            // 409 = already exists — record it as skipped, continue with others
            if (err.status === 409 || err.message?.toLowerCase().includes('already exists')) {
              skipped.push(seg);
            } else {
              throw err; // unexpected error — re-throw
            }
          }
        }
        if (added.length > 0) {
          onSaved(); // refresh list
        }
        if (skipped.length > 0) {
          // Show partial result message but don't close the modal
          setSaveResult({ added, skipped });
          setSaving(false);
          return;
        }
      }
    } catch (err) {
      setFormErr(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-header">
          <h3>{isEdit ? 'Edit Vehicle' : 'Add Vehicle'}</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          {formErr && <div className="modal-error"><AlertCircle size={14} /> {formErr}</div>}

          <div className="form-row">
            {/* Type */}
            <div className="form-group">
              <label>Vehicle Type <span className="req">*</span></label>
              <input
                list="type-list"
                value={form.type}
                onChange={e => set('type', e.target.value)}
                placeholder={defaultTypeClass === '2W' ? 'e.g. Two-Wheeler' : 'e.g. Four-Wheeler'}
                autoFocus
              />
              <datalist id="type-list">
                {refTypes
                  .filter(t =>
                    !defaultTypeClass ||
                    (defaultTypeClass === '2W' ? is2WType(t.name) : !is2WType(t.name))
                  )
                  .map(t => <option key={t.id} value={t.name} />)}
              </datalist>
            </div>
            {/* Make */}
            <div className="form-group">
              <label>Make <span className="req">*</span></label>
              <input
                list="make-list"
                value={form.make}
                onChange={e => setForm(f => ({ ...f, make: e.target.value }))}
                placeholder="e.g. Maruti"
              />
              <datalist id="make-list">
                {filteredMakes.map(m => <option key={m.id} value={m.name} />)}
              </datalist>
            </div>
          </div>

          {/* Model */}
          <div className="form-group">
            <label>Model <span className="req">*</span></label>
            <input
              value={form.model}
              onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
              placeholder="e.g. Swift"
            />
          </div>

          {/* Partial-save result banner */}
          {saveResult && (
            <div style={{
              background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 8,
              padding: '10px 14px', marginBottom: 12, fontSize: 13,
            }}>
              {saveResult.added.length > 0 && (
                <div style={{ color: '#166534', marginBottom: saveResult.skipped.length > 0 ? 4 : 0 }}>
                  ✓ Added: <strong>{saveResult.added.join(', ')}</strong>
                </div>
              )}
              {saveResult.skipped.length > 0 && (
                <div style={{ color: '#92400e' }}>
                  ⚠ Already existed (skipped): <strong>{saveResult.skipped.join(', ')}</strong>
                </div>
              )}
            </div>
          )}

          <div className="form-row">
            {/* Segment — 4W only (2W has no fuel type) */}
            {!selectedTypeIs2W && (
            <div className="form-group" style={{ flex: '1 1 100%' }}>
              <label>Segment / Fuel <span className="req">*</span></label>

              {isEdit ? (
                /* Edit mode — dropdown limited to ref data */
                refSegments.length === 0 ? (
                  <div style={{
                    padding: '10px 12px', borderRadius: 8, fontSize: 13,
                    background: 'var(--bg-soft)', border: '1px solid var(--border)', color: '#9a3412',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span>⚠️</span>
                    <span>No fuel types found in Reference Data. Please first create them under <strong>Reference Data → Segments</strong>.</span>
                  </div>
                ) : (
                  <select
                    value={form.segment}
                    onChange={e => setForm(f => ({ ...f, segment: e.target.value }))}
                    style={{ fontSize: 13 }}
                  >
                    <option value="">— Select fuel type —</option>
                    {refSegments.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                )
              ) : (
                /* Create mode — multi-select chips from ref data only */
                refSegments.length === 0 ? (
                  <div style={{
                    padding: '10px 12px', borderRadius: 8, fontSize: 13,
                    background: 'var(--bg-soft)', border: '1px solid var(--border)', color: '#9a3412',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span>⚠️</span>
                    <span>No fuel types found. Please first create them under <strong>Reference Data → Segments</strong>.</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* Ref-data segments as toggle chips — only these are allowed */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {refSegments.map(s => {
                        const active = selectedSegments.includes(s.name);
                        return (
                          <button
                            key={s.id} type="button"
                            onClick={() => toggleSegment(s.name)}
                            style={{
                              padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                              cursor: 'pointer', transition: 'all 0.15s',
                              border: active ? '2px solid var(--primary)' : '2px solid var(--border)',
                              background: active ? 'var(--primary)' : 'var(--bg-soft)',
                              color: active ? '#fff' : 'var(--text-muted)',
                            }}
                          >
                            {s.name}
                          </button>
                        );
                      })}
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Don't see your fuel type? First add it under <strong>Reference Data → Segments</strong>.
                    </span>
                  </div>
                )
              )}
            </div>
            )}

            {/* Body Type — 4W only */}
            {!selectedTypeIs2W && (
              <div className="form-group" style={{ flex: '1 1 100%' }}>
                <label>Body Type <span className="req">*</span></label>
                {(() => {
                  const fw4WBodyTypes = refBodyTypes.filter(b => !is2WType(b.name));
                  if (fw4WBodyTypes.length === 0) {
                    return (
                      <div style={{
                        padding: '10px 12px', borderRadius: 8, fontSize: 13,
                        background: 'var(--bg-soft)', border: '1px solid var(--border)', color: '#9a3412',
                        display: 'flex', alignItems: 'center', gap: 8,
                      }}>
                        <span>⚠️</span>
                        <span>No body types found. Please first create them under <strong>Reference Data → Body Types</strong>.</span>
                      </div>
                    );
                  }
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {fw4WBodyTypes.map(b => {
                          const active = form.body_type === b.name;
                          return (
                            <button
                              key={b.id} type="button"
                              onClick={() => setForm(f => ({ ...f, body_type: active ? '' : b.name }))}
                              style={{
                                padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                                cursor: 'pointer', transition: 'all 0.15s',
                                border: active ? '2px solid var(--primary)' : '2px solid var(--border)',
                                background: active ? 'var(--primary)' : 'var(--bg-soft)',
                                color: active ? '#fff' : 'var(--text-muted)',
                              }}
                            >
                              {b.name}
                            </button>
                          );
                        })}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Don't see your body type? First add it under <strong>Reference Data → Body Types</strong>.
                      </span>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Engine CC — 2W only */}
            {selectedTypeIs2W && (
              <div className="form-group">
                <label>Engine CC <span className="opt">(optional)</span></label>
                <div className="engine-cc-wrap">
                  <input
                    type="number" min="1" max="9999"
                    value={form.engine_cc}
                    onChange={e => { setForm(f => ({ ...f, engine_cc: e.target.value })); setCcPreview(''); }}
                    onBlur={handleEngineCcBlur}
                    placeholder="e.g. 110, 150, 350"
                    className="engine-cc-input"
                  />
                  {ccPreview && <span className="cc-classify-badge">{ccPreview}</span>}
                </div>
                <span className="form-hint">CC category is auto-assigned on save.</span>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving
                ? 'Saving…'
                : isEdit
                  ? 'Save Changes'
                  : (!selectedTypeIs2W && !isEdit && selectedSegments.length > 1)
                    ? `Add ${selectedSegments.length} Vehicles`
                    : 'Add Vehicle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Delete Confirmation
// ═════════════════════════════════════════════════════════════════════════════
function DeleteConfirm({ vehicle, onCancel, onConfirm }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal-box modal-box--sm">
        <div className="modal-header">
          <h3>Delete Vehicle</h3>
          <button className="modal-close" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="delete-confirm-msg">
            Are you sure you want to delete{' '}
            <strong>{vehicle.make} {vehicle.model}</strong>{' '}
            ({vehicle.type})?
          </p>
          <p className="delete-confirm-sub">
            This action cannot be undone and may affect existing leads and pricing records linked to this vehicle.
          </p>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
            <button className="btn btn-danger" onClick={onConfirm}>Yes, Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Bulk Upload Panel (inline, within VehiclesPage)
// ═════════════════════════════════════════════════════════════════════════════
function BulkUploadPanel({ vehicleClass, onClose, onSuccess }) {
  const [status, setStatus] = useState('idle'); // idle|uploading|validating|success|error
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const inputRef = useRef(null);

  const is2W = vehicleClass === '2W';

  // 2W: make, model, engine_cc  (no segment, no body_type, type is auto-set by backend)
  // 4W: make, model, segment, body_type  (no engine_cc, type is auto-set by backend)
  const SAMPLE_COLS = is2W
    ? ['make', 'model', 'engine_cc']
    : ['make', 'model', 'segment', 'body_type'];

  const SAMPLE_ROWS = is2W
    ? [
        { make: 'Honda',         model: 'Activa 6G',    engine_cc: '110' },
        { make: 'Royal Enfield', model: 'Classic 350',  engine_cc: '349' },
        { make: 'Bajaj',         model: 'Pulsar 220',   engine_cc: '220' },
        { make: 'TVS',           model: 'Apache RTR 160', engine_cc: '160' },
      ]
    : [
        { make: 'Maruti',   model: 'Swift',       segment: 'Petrol', body_type: 'Hatchback' },
        { make: 'Hyundai',  model: 'Creta',       segment: 'Diesel', body_type: 'SUV'       },
        { make: 'Tata',     model: 'Nexon',       segment: 'Petrol', body_type: 'SUV'       },
        { make: 'Toyota',   model: 'Fortuner',    segment: 'Diesel', body_type: 'SUV'       },
      ];

  function onDragOver(e) { e.preventDefault(); setDragging(true); }
  function onDragLeave() { setDragging(false); }
  function onDrop(e) { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }

  async function handleFile(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'xlsx'].includes(ext)) {
      setStatus('error');
      setResult({ error: `Invalid format — only .csv and .xlsx accepted. Got: .${ext}`, code: 'INVALID_FILE_FORMAT' });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setStatus('error');
      setResult({ error: 'File size exceeds the 25 MB limit.', code: 'FILE_TOO_LARGE' });
      return;
    }

    setStatus('uploading'); setProgress(0); setResult(null);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const token = localStorage.getItem('spinoto.token');
      const data = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', e => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.upload.addEventListener('load', () => setStatus('validating'));
        xhr.addEventListener('load', () => {
          try { resolve({ ok: xhr.status < 300, data: JSON.parse(xhr.responseText) }); }
          catch { reject(new Error('Invalid response')); }
        });
        xhr.addEventListener('error', () => reject(new Error('Network error')));
        xhr.addEventListener('timeout', () => reject(new Error('Request timed out')));
        xhr.open('POST', `${API_URL}/api/import/vehicles?class=${vehicleClass}`);
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.timeout = 120_000;
        xhr.send(formData);
      });

      setStatus(data.ok ? 'success' : 'error');
      setResult(data.data);
      if (data.ok) setTimeout(onSuccess, 1800);
    } catch (e) {
      setStatus('error');
      setResult({ error: e.message, code: 'NETWORK_ERROR' });
    }
  }

  function downloadTemplate(fmt) {
    const token = localStorage.getItem('spinoto.token');
    fetch(`${API_URL}/api/import/template/vehicles?format=${fmt}&class=${vehicleClass}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.blob()).then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `vehicles_${vehicleClass}_template.${fmt}`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  return (
    <div className="card vp-upload-panel">
      <div className="vp-upload-header">
        <div>
          <strong>Bulk Upload — {is2W ? '2W (Two-Wheeler)' : '4W (Four-Wheeler)'} Vehicles</strong>
          <span className="vp-upload-sub">
            {is2W
              ? 'Accepts .csv and .xlsx · Max 25 MB · Required: make, model · Optional: engine_cc'
              : 'Accepts .csv and .xlsx · Max 25 MB · Required: make, model, segment, body_type'}
          </span>
        </div>
        <button className="modal-close" onClick={onClose}><X size={16} /></button>
      </div>

      {/* Sample format preview */}
      <details className="sample-preview">
        <summary><Info size={13} /> View expected file format</summary>
        <div className="sample-table-wrap">
          <table className="sample-table">
            <thead><tr>{SAMPLE_COLS.map(c => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {SAMPLE_ROWS.map((r, i) => (
                <tr key={i}>{SAMPLE_COLS.map(c => <td key={c}>{r[c]}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sample-note">Column names are case-insensitive. engine_cc auto-assigns CC category (C1–C6) for Two-Wheelers.</p>
      </details>

      {/* Drop zone */}
      {(status === 'idle' || status === 'error') && (
        <div
          className={`drop-zone ${dragging ? 'drop-zone--active' : ''}`}
          onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input ref={inputRef} type="file" accept=".csv,.xlsx" style={{ display: 'none' }}
            onChange={e => { handleFile(e.target.files[0]); e.target.value = ''; }} />
          <UploadCloud size={26} className="dz-icon" />
          <div className="dz-text">{status === 'error' ? 'Try again — drop a new file' : 'Drop file here or click to browse'}</div>
          <div className="dz-sub">CSV or Excel · Max 25 MB</div>
        </div>
      )}

      {/* Progress */}
      {status === 'uploading' && (
        <div className="progress-block">
          <div className="progress-label"><span>Uploading…</span><span>{progress}%</span></div>
          <div className="progress-bar-track"><div className="progress-bar-fill" style={{ width: `${progress}%` }} /></div>
        </div>
      )}

      {/* Validating */}
      {status === 'validating' && (
        <div className="validating-block"><span className="spinner" /><span>Validating data…</span></div>
      )}

      {/* Success */}
      {status === 'success' && result && (
        <div className="result-block result-block--success">
          <div className="result-main">
            <CheckCircle2 size={18} className="result-icon" />
            <div>
              <div className="result-title">Upload Complete</div>
              <div className="result-detail">{result.message}</div>
            </div>
          </div>
          {(result.inserted > 0 || result.updated > 0 || result.unchanged > 0) && (
            <div className="upsert-chips">
              {result.inserted > 0 && <span className="upsert-chip chip--inserted">＋ {result.inserted} inserted</span>}
              {result.updated > 0 && <span className="upsert-chip chip--updated">✎ {result.updated} updated</span>}
              {result.unchanged > 0 && <span className="upsert-chip chip--unchanged">● {result.unchanged} unchanged</span>}
              {result.skippedBlanks > 0 && <span className="upsert-chip chip--skipped">○ {result.skippedBlanks} blank rows skipped</span>}
            </div>
          )}
          {result.warnings?.map((w, i) => (
            <div key={i} className="warning-line"><AlertTriangle size={12} /> {w}</div>
          ))}
          {result.rowWarnings?.length > 0 && (
            <div className="row-warnings-block">
              <div className="row-warnings-header">
                <AlertTriangle size={13} className="rw-icon" />
                <strong>{result.rowWarnings.length} row{result.rowWarnings.length !== 1 ? 's' : ''} uploaded with missing data</strong>
                <span className="rw-sub">— pricing rules may not match for these vehicles</span>
              </div>
              <div className="row-warnings-list">
                {result.rowWarnings.map((w, i) => (
                  <div key={i} className="row-warning-item">
                    <span className="rw-row-num">Row {w.row}</span>
                    <span className="rw-name">{w.name}</span>
                    <span className="rw-missing">missing: {w.missing.join(', ')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {status === 'error' && result && (
        <div className="result-block result-block--error">
          <div className="result-main">
            <AlertCircle size={18} className="result-icon" />
            <div>
              <div className="result-title">{result.errorCount ? `Validation Failed — ${result.errorCount} error(s)` : 'Upload Failed'}</div>
              <div className="result-detail">{result.error}</div>
            </div>
          </div>
          {result.errors?.length > 0 && (
            <div className="error-report">
              <button className="error-toggle" onClick={() => setShowErrors(v => !v)}>
                {showErrors ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {showErrors ? 'Hide' : 'Show'} error details ({result.errors.length})
              </button>
              {showErrors && (
                <div className="error-table-wrap">
                  <table className="error-table">
                    <thead><tr><th>Row</th><th>Column</th><th>Error</th><th>Data</th></tr></thead>
                    <tbody>
                      {result.errors.map((err, i) => (
                        <tr key={i}>
                          <td className="err-row-num">{err.row}</td>
                          <td><code>{err.column}</code></td>
                          <td><span className="err-code">{err.code}</span><div className="err-msg">{err.message}</div></td>
                          <td className="err-data">{err.rowData}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Template downloads */}
      <div className="vp-upload-footer">
        <span className="footer-label">Download template:</span>
        <button className="template-btn" onClick={() => downloadTemplate('csv')}><File size={12} /> CSV</button>
        <button className="template-btn" onClick={() => downloadTemplate('xlsx')}><FileSpreadsheet size={12} /> Excel</button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// CC Categories Panel  (Two-Wheeler engine capacity segmentation)
// Full CRUD with overlap-safe validation. Soft-delete when in use.
// ═════════════════════════════════════════════════════════════════════════════
function CCCategoriesPanel({ canManage = false }) {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [modal,   setModal]   = useState(null);  // null | {} (new) | {id,...} (edit)
  const [saving,  setSaving]  = useState(false);
  const [form,    setForm]    = useState({ name: '', min_cc: '', max_cc: '', description: '' });
  const [formErr, setFormErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api('/api/cc-categories?all=true');
      setItems(r.items || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setForm({ name: '', min_cc: '', max_cc: '', description: '' });
    setFormErr('');
    setModal({});
  }

  function openEdit(item) {
    setForm({ name: item.name, min_cc: String(item.min_cc), max_cc: String(item.max_cc), description: item.description || '' });
    setFormErr('');
    setModal(item);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormErr('');
    const minCc = parseInt(form.min_cc, 10);
    const maxCc = parseInt(form.max_cc, 10);
    if (!form.name.trim())        return setFormErr('Name is required.');
    if (isNaN(minCc) || minCc < 0) return setFormErr('Min CC must be a non-negative number.');
    if (isNaN(maxCc) || maxCc < 1) return setFormErr('Max CC must be a positive number.');
    if (minCc >= maxCc)           return setFormErr('Min CC must be less than Max CC.');

    setSaving(true);
    try {
      const body = { name: form.name.trim(), min_cc: minCc, max_cc: maxCc, description: form.description.trim() || null };
      if (modal?.id) {
        await api(`/api/cc-categories/${modal.id}`, { method: 'PUT', body });
      } else {
        await api('/api/cc-categories', { method: 'POST', body });
      }
      setModal(null);
      load();
    } catch (e) { setFormErr(e.message); }
    finally { setSaving(false); }
  }

  async function handleToggle(item) {
    try {
      await api(`/api/cc-categories/${item.id}`, { method: 'PUT', body: { is_active: !item.is_active } });
      load();
    } catch (e) { setErr(e.message); }
  }

  async function handleDelete(item) {
    if (!confirm(`Delete CC category "${item.name}"? If it is used in pricing rules or vehicles, it will be deactivated instead.`)) return;
    try {
      const r = await api(`/api/cc-categories/${item.id}`, { method: 'DELETE' });
      if (r?.warning) alert(r.warning);
      load();
    } catch (e) { setErr(e.message); }
  }

  const active   = items.filter(i => i.is_active);
  const inactive = items.filter(i => !i.is_active);

  return (
    <div className="cc-panel card">
      <div className="cc-panel-header">
        <span className="cc-panel-title">CC Range Master</span>
        {canManage && (
          <button className="rdp-add-btn" onClick={openAdd}><Plus size={13} /> Add Category</button>
        )}
      </div>

      {err && <div className="rdp-err"><AlertCircle size={12} /> {err}</div>}

      {loading ? (
        <div className="rdp-loading">Loading…</div>
      ) : (
        <div className="cc-table-wrap">
          <table className="cc-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Min CC</th>
                <th>Max CC</th>
                <th>Description</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {active.map(item => (
                <tr key={item.id}>
                  <td><span className="cc-badge">{item.name}</span></td>
                  <td className="cc-num">{item.min_cc}</td>
                  <td className="cc-num">{item.max_cc}</td>
                  <td className="cc-desc">{item.description || <em className="cc-empty">—</em>}</td>
                  <td><span className="cc-status cc-status--active">Active</span></td>
                  <td className="cc-actions">
                    {canManage && (<>
                      <button className="rdp-btn" title="Edit" onClick={() => openEdit(item)}><Pencil size={12} /></button>
                      <button className="rdp-btn rdp-btn--toggle" title="Deactivate" onClick={() => handleToggle(item)}>
                        <ToggleRight size={16} color="#16a34a" />
                      </button>
                      <button className="rdp-btn rdp-btn--del" title="Delete" onClick={() => handleDelete(item)}><Trash2 size={12} /></button>
                    </>)}
                  </td>
                </tr>
              ))}
              {inactive.map(item => (
                <tr key={item.id} className="cc-row--inactive">
                  <td><span className="cc-badge cc-badge--inactive">{item.name}</span></td>
                  <td className="cc-num">{item.min_cc}</td>
                  <td className="cc-num">{item.max_cc}</td>
                  <td className="cc-desc">{item.description || <em className="cc-empty">—</em>}</td>
                  <td><span className="cc-status cc-status--inactive">Inactive</span></td>
                  <td className="cc-actions">
                    {canManage && (
                      <button className="rdp-btn rdp-btn--toggle" title="Reactivate" onClick={() => handleToggle(item)}>
                        <ToggleLeft size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} className="cc-empty-row">No CC categories yet. Click "Add Category" to create one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add / Edit Modal ───────────────────────────────────────────────── */}
      {modal !== null && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal-box modal-box--sm">
            <div className="modal-header">
              <h3>{modal?.id ? 'Edit CC Category' : 'Add CC Category'}</h3>
              <button className="modal-close" onClick={() => setModal(null)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit} className="modal-body">
              {formErr && <div className="modal-error"><AlertCircle size={14} /> {formErr}</div>}

              <div className="form-group">
                <label>Category Name <span className="req">*</span></label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. C1, C2" autoFocus />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Min CC <span className="req">*</span></label>
                  <input type="number" min="0" value={form.min_cc}
                    onChange={e => setForm(f => ({ ...f, min_cc: e.target.value }))}
                    placeholder="e.g. 0" />
                </div>
                <div className="form-group">
                  <label>Max CC <span className="req">*</span></label>
                  <input type="number" min="1" value={form.max_cc}
                    onChange={e => setForm(f => ({ ...f, max_cc: e.target.value }))}
                    placeholder="e.g. 130" />
                </div>
              </div>

              <div className="form-group">
                <label>Description <span className="opt">(optional)</span></label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Entry-level scooters & mopeds" />
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : modal?.id ? 'Save Changes' : 'Add Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Reference Data Panel  (Vehicle Types / Body Types / Segments)
// ═════════════════════════════════════════════════════════════════════════════
function RefDataPanel({ title, fetchUrl, createUrl, updateUrl, deleteUrl, placeholder, onChanged, canManage = false }) {
  const [items,      setItems]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [adding,     setAdding]     = useState(false);   // show "add" input row
  const [newName,    setNewName]    = useState('');
  const [editId,     setEditId]     = useState(null);    // id being renamed
  const [editName,   setEditName]   = useState('');
  const [saving,     setSaving]     = useState(false);
  const [err,        setErr]        = useState('');
  const [confirmDel, setConfirmDel] = useState(null);    // item pending delete confirm
  const addRef  = useRef(null);
  const editRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api(fetchUrl);
      setItems(r.items || []);
    } finally { setLoading(false); }
  }, [fetchUrl]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (adding)  addRef.current?.focus(); },  [adding]);
  useEffect(() => { if (editId)  editRef.current?.focus(); }, [editId]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true); setErr('');
    try {
      await api(createUrl, { method: 'POST', body: { name: newName.trim() } });
      setNewName(''); setAdding(false); load(); onChanged?.();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function handleRename(e) {
    e.preventDefault();
    if (!editName.trim()) return;
    setSaving(true); setErr('');
    try {
      await api(updateUrl(editId), { method: 'PATCH', body: { name: editName.trim() } });
      setEditId(null); setEditName(''); load(); onChanged?.();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function handleToggle(item) {
    try {
      await api(updateUrl(item.id), { method: 'PATCH', body: { is_active: !item.is_active } });
      load(); onChanged?.();
    } catch (e) { setErr(e.message); }
  }

  async function handleDelete(item) {
    setConfirmDel(null);
    setErr('');
    try {
      await api(deleteUrl(item.id), { method: 'DELETE' });
      load(); onChanged?.();
    } catch (e) {
      // FK violation — item is still in use
      setErr(e.message?.includes('violates') || e.message?.includes('foreign')
        ? `Cannot delete "${item.name}" — it is still in use by vehicle records.`
        : e.message);
    }
  }

  const active   = items.filter(i => i.is_active);
  const inactive = items.filter(i => !i.is_active);

  return (
    <div className="rdp-card card">
      <div className="rdp-header">
        <span className="rdp-title">{title}</span>
        {canManage && (
          <button className="rdp-add-btn" onClick={() => { setAdding(true); setEditId(null); }}>
            <Plus size={13} /> Add
          </button>
        )}
      </div>

      {err && <div className="rdp-err"><AlertCircle size={12} /> {err}</div>}

      {loading ? (
        <div className="rdp-loading">Loading…</div>
      ) : (
        <ul className="rdp-list">
          {/* Add row — only when canManage */}
          {adding && canManage && (
            <li className="rdp-item rdp-item--adding">
              <form onSubmit={handleAdd} className="rdp-inline-form">
                <input
                  ref={addRef}
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder={placeholder}
                  className="rdp-input"
                />
                <button type="submit" className="rdp-btn rdp-btn--ok" disabled={saving} title="Save">
                  <Check size={13} />
                </button>
                <button type="button" className="rdp-btn" onClick={() => { setAdding(false); setNewName(''); setErr(''); }} title="Cancel">
                  <X size={13} />
                </button>
              </form>
            </li>
          )}

          {/* Active items */}
          {active.map(item => (
            <li key={item.id} className="rdp-item">
              {editId === item.id ? (
                <form onSubmit={handleRename} className="rdp-inline-form">
                  <input
                    ref={editRef}
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="rdp-input"
                  />
                  <button type="submit" className="rdp-btn rdp-btn--ok" disabled={saving} title="Save">
                    <Check size={13} />
                  </button>
                  <button type="button" className="rdp-btn" onClick={() => { setEditId(null); setErr(''); }} title="Cancel">
                    <X size={13} />
                  </button>
                </form>
              ) : confirmDel?.id === item.id ? (
                /* Inline delete confirmation */
                <div className="rdp-confirm-row">
                  <span className="rdp-confirm-msg">Delete <strong>{item.name}</strong>?</span>
                  <button className="rdp-btn rdp-btn--danger" onClick={() => handleDelete(item)}>Yes, delete</button>
                  <button className="rdp-btn" onClick={() => setConfirmDel(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <span className="rdp-name">{item.name}</span>
                  {canManage && (
                    <div className="rdp-actions">
                      <button className="rdp-btn" title="Rename" onClick={() => { setEditId(item.id); setEditName(item.name); setAdding(false); }}>
                        <Pencil size={12} />
                      </button>
                      <button className="rdp-btn rdp-btn--toggle" title="Deactivate" onClick={() => handleToggle(item)}>
                        <ToggleRight size={16} color="#16a34a" />
                      </button>
                      {deleteUrl && (
                        <button className="rdp-btn rdp-btn--del" title="Delete" onClick={() => { setConfirmDel(item); setErr(''); }}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </li>
          ))}

          {/* Inactive items */}
          {inactive.length > 0 && (
            <>
              <li className="rdp-divider">Inactive</li>
              {inactive.map(item => (
                <li key={item.id} className="rdp-item rdp-item--inactive">
                  {confirmDel?.id === item.id ? (
                    <div className="rdp-confirm-row">
                      <span className="rdp-confirm-msg">Delete <strong>{item.name}</strong>?</span>
                      <button className="rdp-btn rdp-btn--danger" onClick={() => handleDelete(item)}>Yes, delete</button>
                      <button className="rdp-btn" onClick={() => setConfirmDel(null)}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <span className="rdp-name">{item.name}</span>
                      {canManage && (
                        <div className="rdp-actions">
                          <button className="rdp-btn rdp-btn--toggle" title="Reactivate" onClick={() => handleToggle(item)}>
                            <ToggleLeft size={16} />
                          </button>
                          {deleteUrl && (
                            <button className="rdp-btn rdp-btn--del" title="Delete" onClick={() => { setConfirmDel(item); setErr(''); }}>
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </li>
              ))}
            </>
          )}

          {items.length === 0 && !adding && (
            <li className="rdp-empty">No {title.toLowerCase()} yet.</li>
          )}
        </ul>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Styles

