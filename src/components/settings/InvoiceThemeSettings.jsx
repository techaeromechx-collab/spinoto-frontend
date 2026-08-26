// Settings > Document Settings — split-pane layout:
//   LEFT  a large live preview of the selected document, re-rendered by the
//         backend from the REAL theme templates as settings change
//   RIGHT a scrollable "Theme Store": document switcher, theme thumbnails, and
//         collapsible sections for colour, display flags, header fields,
//         item columns, terms/signature/bank and global settings
//
// Covers all three documents — estimate, customer invoice, purchase invoice —
// which share one template system (see backend/src/templates/documentAdapter.js).
// Theme, title, numbering, terms and column choices are PER DOCUMENT; logo,
// accent colour, hub naming, page size and footer are GLOBAL, so a company
// can't end up with three differently-branded letterheads.
//
// Backed by:
//   GET/PUT  /api/settings/company                       (document_config)
//   POST/DELETE /api/settings/company/logo
//   POST     /api/settings/company/invoice-theme-preview  (raw HTML preview)
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Palette, Upload, X, Save, Check, Image as ImageIcon, ChevronDown,
  Wand2, FileText, Table, Building2, Plus, Trash2, Globe, ScrollText,
  ZoomIn, ZoomOut, Maximize2,
} from 'lucide-react';
import { api, API_URL, getToken } from '../../api/client.js';
import { useRegisterUnsavedChanges } from '../UnsavedChangesGuard.jsx';

const DOCUMENTS = [
  { key: 'estimate',         label: 'Estimate' },
  { key: 'customer_invoice', label: 'Customer Invoice' },
  { key: 'purchase_invoice', label: 'Purchase Invoice' },
];

// Keep in sync with backend/src/utils/documentConfig.js VALID_THEMES.
const THEMES = [
  { key: 'spinoto',            label: 'Spinoto' },
  { key: 'simple',             label: 'Simple' },
  { key: 'modern',             label: 'Modern' },
  { key: 'luxury',             label: 'Luxury' },
  { key: 'stylish',            label: 'Stylish' },
  { key: 'advanced_gst',       label: 'Advanced GST' },
  { key: 'advanced_gst_tally', label: 'Advanced GST (Tally)' },
  { key: 'advanced_gst_a5',    label: 'Advanced GST (A5)' },
];

const ACCENT_COLORS = [
  '#16b994', // Spinoto house teal
  '#111827', '#166534', '#1d4ed8', '#7e22ce',
  '#b91c1c', '#4338ca', '#c2410c',
];

const INDUSTRY_TYPES = [
  { value: 'automobile', label: 'Automobile' }, { value: 'retail', label: 'Retail' },
  { value: 'pharma', label: 'Pharma' }, { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'services', label: 'Services' }, { value: 'other', label: 'Other' },
];

// Labels describe what the toggle actually does to the printed document.
const THEME_FLAGS = [
  { key: 'show_item_description', label: 'Show item description' },
  { key: 'free_item_qty',         label: 'Show zero-charge lines as FREE' },
  { key: 'show_phone',            label: 'Show phone number' },
  { key: 'show_time',             label: 'Show time alongside the date' },
  { key: 'show_status',           label: 'Show document status' },
  // Only meaningful where there's a customer ledger to total up.
  { key: 'show_party_balance',    label: "Show party's total outstanding", docs: ['customer_invoice'] },
  // Only a customer invoice can consume an advance — an estimate precedes it
  // and a purchase invoice pays the hub.
  { key: 'show_advance_line',     label: 'Show advance applied as its own line', docs: ['customer_invoice'] },
  { key: 'price_history',         label: "Show customer's previous prices",  docs: ['estimate', 'customer_invoice'] },
  { key: 'show_warranty',         label: 'Show warranty & guarantee table',   docs: ['estimate', 'customer_invoice'] },
];

const HEADER_FIELDS = [
  { key: 'vehicle_number',  label: 'Vehicle Number' },
  { key: 'odometer',        label: 'Odometer Reading' },
  { key: 'po_number',       label: 'PO Number' },
  { key: 'eway_bill',       label: 'E-way Bill Number' },
  { key: 'place_of_supply', label: 'Place of Supply (needed for IGST)' },
];

const ITEM_COLUMNS = [
  { key: 'price',    label: 'Rate' },
  { key: 'qty',      label: 'Quantity' },
  { key: 'hsn',      label: 'HSN/SAC' },
  { key: 'taxable',  label: 'Taxable Value' },
  { key: 'tax_split', label: 'Split tax rate columns (CGST %/SGST %)' },
  { key: 'batch_no', label: 'Batch No.' },
  { key: 'mfg_date', label: 'Mfg Date' },
  { key: 'exp_date', label: 'Exp. Date' },
];

const HUB_NAME_MODES = [
  { value: 'branch', label: 'Branch name (e.g. "Spinoto Gota")' },
  { value: 'legal',  label: 'Registered legal name' },
  { value: 'hidden', label: "Don't show the hub" },
];

const LOGO_SOURCES = [
  { value: 'uploaded', label: 'Uploaded logo' },
  { value: 'static',   label: 'Built-in Spinoto logo' },
  { value: 'none',     label: 'No logo' },
];

// Preview zoom. 0.62 fits a full A4 page in the default pane width; the range
// goes low enough to see the whole page at a glance and high enough to read
// 8px print text without opening the PDF.
const ZOOM_MIN = 0.3, ZOOM_MAX = 2, ZOOM_STEP = 0.1;
// Breathing room either side of the page inside the scroll pane.
const FIT_GUTTER = 40;
const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

// Sheet dimensions at 96dpi. The preview iframe must match the sheet the
// backend rendered for, or an A5 theme is previewed in an A4 frame and the
// pane quietly disagrees with the PDF. The backend reports which one it used
// in the X-Page-Size response header (see settings.controller previewInvoiceTheme).
const PAGE_PX = {
  A4: { w: 794, h: 1123 },
  A5: { w: 559, h: 794 },
};
const pagePx = (size) => PAGE_PX[size] || PAGE_PX.A4;

// Ids must stay stable forever — per-document values are keyed by them.
const newId = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

// ─── Building blocks ──────────────────────────────────────────────────────────

function Section({ icon, title, badge, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`its-sec ${open ? 'its-sec--open' : ''}`}>
      <button type="button" className="its-sec-head" onClick={() => setOpen(o => !o)}>
        <span className="its-sec-title">{icon} {title}</span>
        {badge ? <span className="its-badge">{badge}</span> : null}
        <ChevronDown size={16} className="its-sec-chev" />
      </button>
      {open && <div className="its-sec-body">{children}</div>}
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="its-check">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function CustomList({ items, onChange, addLabel, placeholder, prefix, max = 10 }) {
  const add = () => onChange([...items, { id: newId(prefix), label: '', enabled: true }]);
  const patch = (i, next) => onChange(items.map((it, n) => (n === i ? { ...it, ...next } : it)));
  const remove = (i) => onChange(items.filter((_, n) => n !== i));
  return (
    <div className="its-custom">
      {items.map((it, i) => (
        <div className="its-custom-row" key={it.id}>
          <input type="checkbox" checked={it.enabled !== false}
            onChange={e => patch(i, { enabled: e.target.checked })} title="Show on document" />
          <input className="its-input" value={it.label} maxLength={40} placeholder={placeholder}
            onChange={e => patch(i, { label: e.target.value })} />
          <button type="button" className="its-icon-btn" onClick={() => remove(i)} title="Remove">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {items.length < max && (
        <button type="button" className="its-add-link" onClick={add}><Plus size={13} /> {addLabel}</button>
      )}
      {items.some(it => !it.label.trim()) && (
        <div className="its-hint its-hint--warn">Unnamed entries won't appear on the document.</div>
      )}
    </div>
  );
}

// Theme thumbnail. Uses the cacheable GET preview (theme + colour only) so
// flipping a checkbox doesn't refetch nine thumbnails.
function ThemeThumb({ themeKey, accent, docType }) {
  const [html, setHtml] = useState(null);
  const [pageSize, setPageSize] = useState('A4');
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      const qs = `theme=${encodeURIComponent(themeKey)}&color=${encodeURIComponent(accent)}&docType=${encodeURIComponent(docType)}`;
      fetch(`${API_URL}/api/settings/company/invoice-theme-preview?${qs}`,
        { headers: { Authorization: `Bearer ${getToken()}` } })
        .then(async r => {
          if (!r.ok) throw new Error(String(r.status));
          return { html: await r.text(), pageSize: r.headers.get('X-Page-Size') || 'A4' };
        })
        .then(res => { if (!cancelled) { setHtml(res.html); setPageSize(res.pageSize); } })
        .catch(() => {});
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [themeKey, accent, docType]);

  // The thumbnail tile is a fixed box, so an A5 sheet is scaled by its own
  // ratio to land at the same tile height — otherwise the A5 theme's card
  // showed a page cropped to A4's footprint.
  const { w, h } = pagePx(pageSize);
  const thumbZoom = 0.147 * (PAGE_PX.A4.h / h);

  return (
    <div className="its-thumb">
      {html
        ? <iframe title={`${themeKey} thumbnail`} srcDoc={html} className="its-thumb-frame"
            style={{ width: w, height: h, zoom: thumbZoom }}
            scrolling="no" tabIndex={-1} />
        : <div className="its-thumb-ph" />}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function InvoiceThemeSettings() {
  const [company, setCompany] = useState(null);
  const [accent, setAccent]   = useState('#4f46e5');
  const [cfg, setCfg]         = useState(null);   // the full document_config
  const [docType, setDocType] = useState('customer_invoice');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [dirty, setDirty]     = useState(false);
  const [ok, setOk]           = useState(false);
  const [err, setErr]         = useState(null);

  // Tell the settings shell there's unsaved work, so leaving the tab (or the
  // page) prompts instead of silently discarding it. handleSave is a hoisted
  // function declaration, hence usable above its definition.
  useRegisterUnsavedChanges(dirty, handleSave);

  const [signatureUrl, setSignatureUrl] = useState(null);
  const [sigBusy, setSigBusy] = useState(false);
  const [sigErr, setSigErr]   = useState(null);
  const sigInputRef = useRef(null);

  const [logoUrl, setLogoUrl]   = useState(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoErr, setLogoErr]   = useState(null);
  const fileInputRef = useRef(null);

  // Zoom is MEASURED, not a fixed constant.
  //
  // It used to be a hard-coded 0.62, chosen to fit A4 in the default pane
  // width. That was wrong twice over: an A5 sheet is only 70% as wide, so it
  // previewed far smaller than it needed to; and on a narrow window the page
  // simply overflowed. (A CSS media query tried to handle the narrow case by
  // scaling .its-paper, but the component sets `transform` inline, and inline
  // styles beat a stylesheet — so that rule had never once taken effect.)
  //
  // Now the fit is computed from the pane's real width and the current sheet.
  const paneRef = useRef(null);
  const [paneW, setPaneW] = useState(0);
  const [zoom, setZoom] = useState(0.62);
  // Once the user zooms by hand, stop re-fitting under them on every resize.
  // Reset when the sheet changes, since the old zoom is meaningless then.
  const userZoomed = useRef(false);

  const [previewHtml, setPreviewHtml] = useState(null);
  // Reported by the backend per render — the A5 themes and the global page-size
  // setting both change it, so it can't be derived from the theme key alone.
  const [previewPageSize, setPreviewPageSize] = useState('A4');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr]   = useState(false);

  useEffect(() => {
    api('/api/settings/company')
      .then(d => {
        setCompany(d);
        setAccent(d.invoice_accent_color || '#4f46e5');
        setLogoUrl(d.logo_url || null);
        setSignatureUrl(d.signature_url || null);
        setCfg(d.document_config); // always fully resolved by the API
      })
      .catch(() => setErr('Failed to load document settings.'))
      .finally(() => setLoading(false));
  }, []);

  // Live preview — debounced, and the previous render stays on screen while a
  // new one is in flight so the pane doesn't strobe while dragging the colour.
  useEffect(() => {
    if (!cfg) return;
    let cancelled = false;
    setPreviewBusy(true);
    const t = setTimeout(() => {
      fetch(`${API_URL}/api/settings/company/invoice-theme-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ docType, theme: cfg.documents[docType].theme, color: accent, config: cfg }),
      })
        .then(async r => {
          if (!r.ok) throw new Error(String(r.status));
          return { html: await r.text(), pageSize: r.headers.get('X-Page-Size') || 'A4' };
        })
        .then(res => {
          if (cancelled) return;
          setPreviewHtml(res.html);
          setPreviewPageSize(res.pageSize);
          setPreviewErr(false);
        })
        .catch(() => { if (!cancelled) setPreviewErr(true); })
        .finally(() => { if (!cancelled) setPreviewBusy(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [cfg, accent, docType]);

  // Update one field on the CURRENT document.
  const setDoc = useCallback((patch) => {
    setCfg(c => ({ ...c, documents: { ...c.documents, [docType]: { ...c.documents[docType], ...patch } } }));
    setDirty(true);
  }, [docType]);

  // Update one key inside a nested section of the current document.
  const setDocSection = useCallback((section, key, value) => {
    setCfg(c => ({
      ...c,
      documents: {
        ...c.documents,
        [docType]: { ...c.documents[docType], [section]: { ...c.documents[docType][section], [key]: value } },
      },
    }));
    setDirty(true);
  }, [docType]);

  // Track the pane's usable width. ResizeObserver rather than a window resize
  // listener because the pane also changes width when the settings rail or the
  // theme store collapses, which fires no window event.
  useEffect(() => {
    const el = paneRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      // clientWidth, not the border-box from the entry, so a scrollbar
      // appearing doesn't feed its own width back in and oscillate.
      setPaneW(entry.target.clientWidth);
    });
    ro.observe(el);
    setPaneW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const fitZoom = useCallback((size = previewPageSize, width = paneW) => {
    if (!width) return 0.62;                       // pre-measurement fallback
    const exact = (width - FIT_GUTTER) / pagePx(size).w;
    // FLOOR to 2dp, don't round. clampZoom rounds, which can round UP and put
    // the page a few pixels wider than the pane — enough to raise a horizontal
    // scrollbar on the very view that's meant to fit.
    return clampZoom(Math.floor(exact * 100) / 100);
  }, [previewPageSize, paneW]);

  // Re-fit on a width or sheet change, unless the user has taken manual control.
  useEffect(() => {
    if (userZoomed.current) return;
    setZoom(fitZoom());
  }, [fitZoom]);

  // A different sheet invalidates any manual zoom — re-fit regardless.
  useEffect(() => {
    userZoomed.current = false;
    setZoom(fitZoom(previewPageSize, paneW));
    // paneW deliberately omitted: this must fire on a SHEET change only, or it
    // would also reset the user's manual zoom on every resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewPageSize]);

  const zoomBy = useCallback((delta) => {
    userZoomed.current = true;
    setZoom(z => clampZoom(z + delta));
  }, []);

  // Ctrl/⌘ + wheel, as a NATIVE listener with { passive: false }.
  //
  // React registers `wheel` at the root as a PASSIVE listener, so
  // e.preventDefault() inside an onWheel prop silently does nothing — the
  // browser went ahead and zoomed the whole page instead of just the preview.
  // A native listener is the only way to opt out of passive.
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;   // plain scrolling still scrolls
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const zoomToFit = useCallback(() => {
    userZoomed.current = false;
    setZoom(fitZoom());
  }, [fitZoom]);

  const setGlobal = useCallback((key, value) => {
    setCfg(c => ({ ...c, global: { ...c.global, [key]: value } }));
    setDirty(true);
  }, []);

  // Set a flag on a NAMED document rather than the selected one. Needed by the
  // Global section's per-document QR checkboxes, which show all three
  // documents at once instead of following the document switcher.
  const setFlagOn = useCallback((docKey, key, value) => {
    setCfg(c => ({
      ...c,
      documents: {
        ...c.documents,
        [docKey]: { ...c.documents[docKey], flags: { ...c.documents[docKey].flags, [key]: value } },
      },
    }));
    setDirty(true);
  }, []);

  // Returns true/false so the unsaved-changes dialog can tell whether it's
  // safe to continue with the navigation the user was attempting. A failed
  // save must NOT let them leave.
  async function handleSave() {
    if (!company) return false;
    setSaving(true); setErr(null); setOk(false);
    try {
      // Send the FULL company object — the PUT upserts every field in its
      // schema, so a partial payload would blank out company_name/address.
      const cleaned = {
        ...cfg,
        documents: Object.fromEntries(Object.entries(cfg.documents).map(([k, d]) => [k, {
          ...d,
          custom_fields:  (d.custom_fields  || []).filter(f => f.label.trim()),
          custom_columns: (d.custom_columns || []).filter(f => f.label.trim()),
        }])),
      };
      // Narrow endpoint: config + accent only.
      //
      // This used to PUT /api/settings/company with the WHOLE company object,
      // because that route overwrites every column and a partial body would
      // blank out company_name/address. Fine while the tab was super-admin
      // only — but it meant anyone allowed to change a theme could also
      // rewrite the GSTIN. /company/document-config touches neither.
      const res = await api('/api/settings/company/document-config', {
        method: 'PUT',
        body: { invoice_accent_color: accent, document_config: cleaned },
      });
      const updated = res.item || res;
      setCompany(updated);
      if (updated.document_config) setCfg(updated.document_config);
      setDirty(false); setOk(true);
      setTimeout(() => setOk(false), 3000);
      return true;
    } catch (ex) {
      setErr(ex.message || 'Failed to save document settings.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoBusy(true); setLogoErr(null);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const res = await fetch(`${API_URL}/api/settings/company/logo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` }, // no Content-Type — browser sets the boundary
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setLogoUrl(data.logo_url);
      setCfg(c => ({ ...c })); // nudge the preview
    } catch (ex) {
      setLogoErr(ex.message || 'Failed to upload logo.');
    } finally {
      setLogoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleSignatureUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSigBusy(true); setSigErr(null);
    try {
      const fd = new FormData();
      fd.append('signature', file);
      const res = await fetch(`${API_URL}/api/settings/company/signature`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` }, // no Content-Type — browser sets the boundary
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSignatureUrl(data.signature_url);
      setCfg(c => ({ ...c })); // nudge the preview
    } catch (ex) {
      setSigErr(ex.message || 'Failed to upload signature.');
    } finally {
      setSigBusy(false);
      if (sigInputRef.current) sigInputRef.current.value = '';
    }
  }

  async function handleSignatureRemove() {
    setSigBusy(true); setSigErr(null);
    try {
      const res = await fetch(`${API_URL}/api/settings/company/signature`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setSignatureUrl(null);
      setCfg(c => ({ ...c }));
    } catch (ex) {
      setSigErr(ex.message || 'Failed to remove signature.');
    } finally {
      setSigBusy(false);
    }
  }

  async function handleLogoRemove() {
    setLogoBusy(true); setLogoErr(null);
    try {
      const res = await fetch(`${API_URL}/api/settings/company/logo`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setLogoUrl(null);
      setCfg(c => ({ ...c }));
    } catch (ex) {
      setLogoErr(ex.message || 'Failed to remove logo.');
    } finally {
      setLogoBusy(false);
    }
  }

  // A failed load leaves cfg null with loading false. Returning the spinner for
  // that case meant the error alert further down could never render — the user
  // saw "Loading…" forever with no idea anything had gone wrong.
  if (!loading && !cfg) {
    return (
      <div className="its-loading" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
        <div className="prfl-alert prfl-alert--error" style={{ margin: 0 }}>
          {err || 'Could not load document settings.'}
        </div>
        <button className="prfl-btn-ghost" onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }
  if (loading || !cfg) return <div className="its-loading">Loading document settings…</div>;

  const doc = cfg.documents[docType];
  const enabledCount = (obj) => Object.values(obj).filter(Boolean).length;
  const visibleFlags = THEME_FLAGS.filter(f => !f.docs || f.docs.includes(docType));

  return (
    <div className="its-split">
      {/* ══ LEFT — live preview ══ */}
      <div className="its-preview-pane">
        <div className="its-preview-bar">
          <span className="its-preview-label">
            Live Preview {previewBusy && <span className="its-preview-spin">updating…</span>}
          </span>

          <div className="its-zoom">
            <button type="button" title="Zoom out" disabled={zoom <= ZOOM_MIN}
              onClick={() => zoomBy(-ZOOM_STEP)}>
              <ZoomOut size={14} />
            </button>
            <span className="its-zoom-val">{Math.round(zoom * 100)}%</span>
            <button type="button" title="Zoom in" disabled={zoom >= ZOOM_MAX}
              onClick={() => zoomBy(ZOOM_STEP)}>
              <ZoomIn size={14} />
            </button>
            <button type="button" title={`Fit ${previewPageSize} page`}
              disabled={zoom === fitZoom()} onClick={zoomToFit}>
              <Maximize2 size={13} />
            </button>
          </div>

          <button type="button" className="prfl-btn-primary its-save-btn"
            disabled={saving || !dirty} onClick={handleSave}>
            <Save size={14} /> {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>

        {ok  && <div className="prfl-alert prfl-alert--success its-alert">Document settings saved successfully!</div>}
        {err && <div className="prfl-alert prfl-alert--error   its-alert">{err}</div>}

        {/* Ctrl/Cmd + wheel zooms, matching every other document viewer.
            Plain scrolling is left alone so the page still scrolls normally. */}
        {/* Wheel zoom is bound natively in an effect above, not via onWheel —
            React's wheel listener is passive, so preventDefault there is a
            no-op and the browser zooms the whole page. */}
        <div className="its-paper-wrap" ref={paneRef}>
          {previewErr && !previewHtml
            ? <div className="its-preview-err">Preview unavailable.</div>
            : previewHtml
              ? (
                // The sizer reserves the SCALED footprint. A CSS transform
                // doesn't change layout size, so without this the wrapper
                // can't scroll to reach the parts of a zoomed-in page that
                // sit outside the pane.
                <div className="its-paper-sizer"
                  style={{ width: pagePx(previewPageSize).w * zoom, height: pagePx(previewPageSize).h * zoom }}>
                  {/* Width/height are set here rather than in CSS because the
                      sheet changes with the theme (A5 variants) and the global
                      page-size setting. */}
                  <iframe title="Document preview" srcDoc={previewHtml} className="its-paper"
                    style={{
                      width: pagePx(previewPageSize).w,
                      height: pagePx(previewPageSize).h,
                      transform: `scale(${zoom})`,
                    }} />
                </div>
              )
              : <div className="its-preview-err">Rendering preview…</div>}
        </div>
        <p className="its-hint its-hint--center">
          Sample data. Your real documents use this exact layout. Ctrl/⌘ + scroll to zoom.
        </p>
      </div>

      {/* ══ RIGHT — theme store ══ */}
      <div className="its-store">
        <div className="its-store-head">Theme Store</div>

        {/* Document switcher — drives both panes */}
        <div className="its-doctabs">
          {DOCUMENTS.map(d => (
            <button key={d.key} type="button"
              className={`its-doctab ${docType === d.key ? 'its-doctab--on' : ''}`}
              onClick={() => setDocType(d.key)}>
              {d.label}
            </button>
          ))}
        </div>

        <div className="its-strip">
          {THEMES.map(t => (
            <button type="button" key={t.key}
              className={`its-strip-card ${doc.theme === t.key ? 'its-strip-card--on' : ''}`}
              onClick={() => setDoc({ theme: t.key })} title={t.label}>
              <ThemeThumb themeKey={t.key} accent={accent} docType={docType} />
              <span className="its-strip-label">
                {doc.theme === t.key && <Check size={11} />} {t.label}
              </span>
            </button>
          ))}
        </div>

        <Section icon={<Wand2 size={14} />} title="Create Custom Theme">
          <p className="its-hint">
            Design your own layout from scratch — colours, fonts, sections and column order.
          </p>
          <button type="button" className="its-cta" disabled>Create your own theme</button>
          <p className="its-hint its-hint--muted">Coming soon.</p>
        </Section>

        <Section icon={<Palette size={14} />} title="Select Color" defaultOpen>
          <p className="its-hint">Applies to all three documents, so your branding stays consistent.</p>
          <div className="its-swatches">
            {ACCENT_COLORS.map(c => (
              <button type="button" key={c}
                className={`its-swatch ${accent.toLowerCase() === c.toLowerCase() ? 'its-swatch--on' : ''}`}
                style={{ background: c }} onClick={() => { setAccent(c); setDirty(true); }} title={c}>
                {accent.toLowerCase() === c.toLowerCase() && <Check size={14} color="#fff" />}
              </button>
            ))}
            <label className="its-swatch-custom">
              <input type="color" value={accent}
                onChange={e => { setAccent(e.target.value); setDirty(true); }} />
              <span>Custom</span>
            </label>
          </div>
        </Section>

        <Section icon={<FileText size={14} />} title="Theme Settings"
          badge={enabledCount(doc.flags) || null}>
          <label className="its-label">Document title</label>
          <input className="its-input" maxLength={60} value={doc.title || ''}
            onChange={e => setDoc({ title: e.target.value })} />

          <div className="its-two">
            <div>
              <label className="its-label">Number prefix</label>
              <input className="its-input" maxLength={10} value={doc.number_prefix || ''}
                onChange={e => setDoc({ number_prefix: e.target.value })} />
            </div>
            <div>
              <label className="its-label">Digits</label>
              <input className="its-input" type="number" min={0} max={10} value={doc.number_pad}
                onChange={e => setDoc({ number_pad: Number(e.target.value) })} />
            </div>
          </div>

          <div className="its-sub">Display</div>
          {visibleFlags.map(f => (
            <Toggle key={f.key} label={f.label} checked={doc.flags[f.key]}
              onChange={v => setDocSection('flags', f.key, v)} />
          ))}

          {docType === 'purchase_invoice' && (
            <>
              <Toggle label="Show customer rate + commission columns"
                checked={doc.margin_columns}
                onChange={v => setDoc({ margin_columns: v })} />
              <p className="its-hint its-hint--warn">
                Only ever shown on your own copy. A hub viewing their invoice never
                sees these, whatever this is set to.
              </p>
            </>
          )}

          <div className="its-sub">Auto-apply theme for sharing</div>
          <p className="its-hint">
            Use a different theme when this document is shared with a customer,
            leaving your print theme unchanged.
          </p>
          <select className="its-input" value={doc.flags.auto_share_theme || ''}
            onChange={e => setDocSection('flags', 'auto_share_theme', e.target.value || null)}>
            <option value="">Same as selected theme</option>
            {THEMES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </Section>

        <Section icon={<Building2 size={14} />} title="Invoice Details"
          badge={enabledCount(doc.header_fields) || null}>
          <label className="its-label">Industry Type</label>
          <select className="its-input" value={cfg.industry_type}
            onChange={e => { setCfg(c => ({ ...c, industry_type: e.target.value })); setDirty(true); }}>
            {INDUSTRY_TYPES.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
          </select>

          <div className="its-sub">Optional header fields</div>
          {HEADER_FIELDS.map(f => (
            <Toggle key={f.key} label={f.label} checked={doc.header_fields[f.key]}
              onChange={v => setDocSection('header_fields', f.key, v)} />
          ))}

          <div className="its-sub">Custom fields</div>
          <CustomList items={doc.custom_fields || []}
            onChange={l => setDoc({ custom_fields: l })}
            addLabel="Add Custom Field" placeholder="e.g. Job Card No." prefix="cf" />
        </Section>

        <Section icon={<Table size={14} />} title="Item Table Columns"
          badge={enabledCount(doc.item_columns) || null}>
          {ITEM_COLUMNS.map(f => (
            <Toggle key={f.key} label={f.label} checked={doc.item_columns[f.key]}
              onChange={v => setDocSection('item_columns', f.key, v)} />
          ))}

          <div className="its-sub">Discount column</div>
          <select className="its-input" value={doc.item_columns.discount || 'auto'}
            onChange={e => setDocSection('item_columns', 'discount', e.target.value)}>
            <option value="auto">Only when something is discounted</option>
            <option value="always">Always show</option>
            <option value="never">Never show</option>
          </select>
          <p className="its-hint">
            Item name, discount, GST and amount always appear — they're required
            on a GST tax invoice.
          </p>

          <div className="its-sub">Custom columns</div>
          <CustomList items={doc.custom_columns || []}
            onChange={l => setDoc({ custom_columns: l })}
            addLabel="Add Custom Column" placeholder="e.g. Warranty" prefix="cc" />
        </Section>

        {/* Each block is a checkbox that reveals its own fields — an
            unchecked block prints nothing, so a half-filled form can't leave
            an empty heading on the document. */}
        <Section icon={<ScrollText size={14} />} title="Terms, Bank &amp; Signature"
          badge={[doc.show_terms, doc.show_bank, doc.show_signature].filter(Boolean).length || null}>

          <Toggle label="Terms &amp; Conditions" checked={doc.show_terms}
            onChange={v => setDoc({ show_terms: v })} />
          {doc.show_terms && (
            <textarea className="its-input its-textarea" rows={4} maxLength={2000}
              placeholder={'1. Goods once sold will not be taken back or exchanged\n2. All disputes are subject to local jurisdiction only'}
              value={doc.terms} onChange={e => setDoc({ terms: e.target.value })} />
          )}

          <Toggle label="Bank Details" checked={doc.show_bank}
            onChange={v => setDoc({ show_bank: v })} />
          {doc.show_bank && (
            <div className="its-fields">
              {[
                ['account_name', 'Account Name', 'AEROMECHX AUTOMOTIVE PRIVATE LIMITED'],
                ['bank_name',    'Bank',         'ICICI Bank'],
                ['account_no',   'Account No.',  '770405000471'],
                ['ifsc',         'IFSC Code',    'ICIC0007704'],
                ['branch',       'Branch',       'Jagatpur'],
              ].map(([key, label, ph]) => (
                <div key={key}>
                  <label className="its-label">{label}</label>
                  <input className="its-input" maxLength={120} placeholder={ph}
                    value={doc.bank_details?.[key] || ''}
                    onChange={e => setDoc({ bank_details: { ...doc.bank_details, [key]: e.target.value } })} />
                </div>
              ))}
              <p className="its-hint">Only the fields you fill in are printed.</p>
            </div>
          )}

          <Toggle label="Signature" checked={doc.show_signature}
            onChange={v => setDoc({ show_signature: v })} />
          {doc.show_signature && (
            <div className="its-fields">
              <label className="its-label">Signatory label</label>
              <input className="its-input" maxLength={60} value={doc.signature_label}
                onChange={e => setDoc({ signature_label: e.target.value })} />

              <label className="its-label">Signature / stamp image</label>
              {sigErr && <div className="prfl-alert prfl-alert--error its-alert">{sigErr}</div>}
              <div className="its-logo-row">
                <div className="its-logo-box its-logo-box--wide">
                  {signatureUrl
                    ? <img src={signatureUrl.startsWith('http') ? signatureUrl : `${API_URL}${signatureUrl}`} alt="Signature" />
                    : <ImageIcon size={20} />}
                </div>
                <div className="its-logo-actions">
                  <button type="button" className="prfl-btn-ghost prfl-btn-ghost--sm" disabled={sigBusy}
                    onClick={() => sigInputRef.current?.click()}>
                    <Upload size={13} /> {signatureUrl ? 'Replace' : 'Upload'}
                  </button>
                  {signatureUrl && (
                    <button type="button" className="prfl-btn-ghost prfl-btn-ghost--sm" disabled={sigBusy}
                      onClick={handleSignatureRemove}><X size={13} /> Remove</button>
                  )}
                  <span className="its-hint">
                    PNG with a transparent background works best · up to 2 MB
                  </span>
                </div>
                <input ref={sigInputRef} type="file" accept=".jpg,.jpeg,.png,.svg,.webp"
                  style={{ display: 'none' }} onChange={handleSignatureUpload} />
              </div>
              <p className="its-hint">
                Shared across all three documents. Without an image the block
                prints blank signing space above the label.
              </p>
            </div>
          )}
        </Section>

        <Section icon={<Globe size={14} />} title="Global (all documents)">
          <label className="its-label">Hub / branch name shown</label>
          <select className="its-input" value={cfg.global.hub_name_mode}
            onChange={e => setGlobal('hub_name_mode', e.target.value)}>
            {HUB_NAME_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <Toggle label="Show hub GSTIN" checked={cfg.global.show_hub_gstin}
            onChange={v => setGlobal('show_hub_gstin', v)} />

          <div className="its-sub">Logo</div>
          <select className="its-input" value={cfg.global.logo_source}
            onChange={e => setGlobal('logo_source', e.target.value)}>
            {LOGO_SOURCES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          {logoErr && <div className="prfl-alert prfl-alert--error its-alert">{logoErr}</div>}
          <div className="its-logo-row">
            <div className="its-logo-box">
              {logoUrl
                ? <img src={logoUrl.startsWith('http') ? logoUrl : `${API_URL}${logoUrl}`} alt="Company logo" />
                : <ImageIcon size={20} />}
            </div>
            <div className="its-logo-actions">
              <button type="button" className="prfl-btn-ghost prfl-btn-ghost--sm" disabled={logoBusy}
                onClick={() => fileInputRef.current?.click()}>
                <Upload size={13} /> {logoUrl ? 'Replace' : 'Upload'}
              </button>
              {logoUrl && (
                <button type="button" className="prfl-btn-ghost prfl-btn-ghost--sm" disabled={logoBusy}
                  onClick={handleLogoRemove}><X size={13} /> Remove</button>
              )}
              <span className="its-hint">JPG, PNG, SVG or WEBP · up to 2 MB</span>
            </div>
            <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.svg,.webp"
              style={{ display: 'none' }} onChange={handleLogoUpload} />
          </div>

          <div className="its-sub">Page &amp; footer</div>
          <label className="its-label">Page size</label>
          <select className="its-input" value={cfg.global.page_size}
            onChange={e => setGlobal('page_size', e.target.value)}>
            <option value="A4">A4</option>
            <option value="A5">A5</option>
          </select>
          <p className="its-hint">
            Themes ending in "(A5)" always print A5 regardless of this.
          </p>

          <Toggle label="Show amount in words" checked={cfg.global.amount_in_words}
            onChange={v => setGlobal('amount_in_words', v)} />
          <Toggle label="Show QR code" checked={cfg.global.show_qr}
            onChange={v => setGlobal('show_qr', v)} />
          <p className="its-hint">
            Scannable link to the customer's own copy of the document. Needs
            PUBLIC_APP_URL set on the server; without it the QR is skipped.
          </p>
          {/* Per-document exceptions, revealed only once the master is on —
              same pattern as Terms / Bank / Signature. All three live here
              rather than in each document's own section so the whole picture
              is visible at once. */}
          {cfg.global.show_qr && (
            <div className="its-fields">
              <div className="its-fields-label">Show the QR on</div>
              {DOCUMENTS.map(d => (
                <Toggle key={d.key} label={d.label}
                  checked={cfg.documents[d.key].flags.show_qr !== false}
                  onChange={v => setFlagOn(d.key, 'show_qr', v)} />
              ))}
              <p className="its-hint">
                Untick a document to drop its QR while keeping it on the others.
              </p>
            </div>
          )}
          <Toggle label="Show contact details in the footer" checked={cfg.global.footer_contact}
            onChange={v => setGlobal('footer_contact', v)} />
          <Toggle label="Use icons for phone/email (📞 ✉)" checked={cfg.global.footer_contact_icons}
            onChange={v => setGlobal('footer_contact_icons', v)} />
          <p className="its-hint">
            Icons rely on the printer having an emoji font — plain text is safer.
          </p>

          <label className="its-label">Footer note</label>
          <input className="its-input" maxLength={300} value={cfg.global.footer_note}
            onChange={e => setGlobal('footer_note', e.target.value)} />
          <label className="its-label">Footer disclaimer</label>
          <input className="its-input" maxLength={300} value={cfg.global.footer_disclaimer}
            onChange={e => setGlobal('footer_disclaimer', e.target.value)} />
        </Section>
      </div>
    </div>
  );
}
