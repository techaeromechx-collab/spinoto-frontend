import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, getToken } from '../api/client.js';
import { useCan } from '../auth/AuthContext.jsx';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import { useDebouncedSearch, useAbortController, isAbortError } from '../hooks/useDebouncedSearch.js';
import { usePageSearch } from '../lib/pageSearchStore.js';
import PaginationBar from '../components/PaginationBar.jsx';
import { useMediaQuery, MOBILE_LIST_QUERY } from '../hooks/useMediaQuery.js';
import {
  Plus, X, Check, Ban, ArrowRightCircle, Trash2, Camera, Pencil,
  AlertTriangle, AlertCircle, ExternalLink, Loader2,
  Building2, Clock, Users2, CreditCard, FileText, Percent, Upload,
  ToggleLeft, ToggleRight, Archive,
} from 'lucide-react';
import '../styles/listLayout.css';
// The Convert dialog is built from the Add HUB form's own classes (hb-field,
// hb-input, hb-section-sep, hb-gst-toggle) so the two look identical. Importing
// the stylesheet beats copying the rules: restyling the hub form restyles this
// too, instead of the two drifting apart.
import '../styles/HubsPage.css';
import '../styles/WorkshopsPage.css';

/**
 * Workshops — candidate hubs.
 *
 * The stage before onboarding: capture the basics of a garage we are talking
 * to, discuss it, and either convert it into a Hub or let it go. Nothing here
 * touches `hubs` until Convert, which is the whole point — a prospect we pass
 * on leaves no row in the table that invoices, payouts and the revenue report
 * all join against.
 *
 * "Add HUB" on the Hubs page is untouched and still creates a hub directly.
 * This is a second path, not a replacement.
 */

const STATUS_TABS = [
  { key: 'all',       label: 'All' },
  { key: 'draft',     label: 'Draft' },
  { key: 'approved',  label: 'Approved' },
  { key: 'rejected',  label: 'Rejected' },
  { key: 'dropped',   label: 'Dropped' },
  { key: 'converted', label: 'Converted' },
];

const STATUS_TONE = {
  draft:     { label: 'Draft',     color: '#64748b' },
  approved:  { label: 'Approved',  color: '#16b994' },
  rejected:  { label: 'Rejected',  color: '#dc2626' },
  dropped:   { label: 'Dropped',   color: '#a16207' },
  converted: { label: 'Converted', color: '#2563eb' },
};

const VEHICLE_OPTS = [
  { value: '2W',   label: '2 Wheeler' },
  { value: '4W',   label: '4 Wheeler' },
  { value: 'both', label: 'Both' },
];

// Same seven as the Add HUB form, in the same order. working_days is stored as
// a comma-joined string ("Mon,Tue,Wed"), so the order here is what gets saved.
const DAY_OPTS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const PAYOUT_TERMS = [
  { value: 'weekly',      label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'net_30',      label: 'Net 30' },
  { value: 'net_60',      label: 'Net 60' },
  { value: 'net_90',      label: 'Net 90' },
  { value: 'net_180',     label: 'Net 180' },
  { value: 'net_365',     label: 'Net 365' },
  { value: 'custom',      label: 'Custom' },
];

// Eleven fields. company_name is NOT here — the registered entity is asked for
// in the Convert popup, where you actually know it.
const EMPTY_FORM = {
  workshop_name: '', person_name: '', contact_number: '',
  owner_name: '', owner_mobile: '',
  state_id: '', city_id: '', area_id: '', vehicle_class: 'both', notes: '',
  // Captured at the workshop stage because whoever visits the site is the
  // person holding the map pin. Copied onto the hub at conversion, and it is
  // what fills the Workshop Location line in the appointment WhatsApp message —
  // a hub without one has that message skipped rather than sent with a blank.
  map_url: '',
};

/**
 * Upload one file. Deliberately not the shared api() wrapper: that sets a JSON
 * content-type, and multer needs the browser to write its own multipart
 * boundary. Same reason HubsPage rolls its own for documents.
 */
async function uploadFile(url, file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: fd,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Upload failed');
  return res.json();
}

export default function WorkshopsPage() {
  const canCreate  = useCan('CREATE_WORKSHOP',  'MANAGE_HUBS');
  const canEdit    = useCan('EDIT_WORKSHOP',    'MANAGE_HUBS');
  const canApprove = useCan('APPROVE_WORKSHOP', 'MANAGE_HUBS');
  const canDelete  = useCan('DELETE_WORKSHOP',  'MANAGE_HUBS');
  // Both, matching the two chained checks on the route — showing a button to
  // someone who will get a 403 is worse than not showing it.
  //
  // Two separate calls, NOT `useCan(a) && useCan(b)`: `&&` short-circuits, so
  // the second hook would go uncalled whenever the first is false. Hook order
  // has to be identical on every render or React pairs up the wrong state.
  const canConvertWs = useCan('CONVERT_WORKSHOP', 'MANAGE_HUBS');
  const canCreateHub = useCan('CREATE_HUB', 'MANAGE_HUBS');
  const canConvert   = canConvertWs && canCreateHub;

  const [items, setItems]   = useState([]);
  const [counts, setCounts] = useState({});
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [tab, setTab]       = useState('all');
  const [filterVc, setFilterVc] = useState('');
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState(null);

  const [modal, setModal]     = useState(null);   // { mode:'add'|'edit', row }
  const [convert, setConvert] = useState(null);   // the row being converted
  const [confirm, setConfirm] = useState(null);   // { row, action }

  const showToast = useCallback((msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  }, []);

  // First argument is the INITIAL VALUE; options are the second. Passing
  // `{ minChars: 2 }` here made the hook treat an object as the initial string
  // and blow up on `.trim()`. 2 is already the default (MIN_SEARCH_CHARS), so
  // there are no options to pass.
  const { input: searchInput, search, setInput: setSearchInput, tooShort, minChars } =
    useDebouncedSearch('');
  // Returns a single function, not an object — calling it aborts the previous
  // request and hands back a fresh AbortSignal. Destructuring it left both
  // names undefined, which is what "signal is not a function" was.
  const abortSignal = useAbortController();

  const onSearchChange = useCallback((v) => { setSearchInput(v); setPage(1); }, [setSearchInput]);
  usePageSearch({
    value: searchInput,
    onChange: onSearchChange,
    placeholder: 'Search workshops',
    hint: tooShort ? `${minChars}+ characters` : '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (tab !== 'all') q.set('status', tab);
      if (filterVc) q.set('vehicle_class', filterVc);
      if (search)   q.set('search', search);
      const res = await api(`/api/workshops?${q}`, { signal: abortSignal() });
      setItems(res.items || []);
      setTotal(res.total || 0);
      setCounts(res.counts || {});
    } catch (e) {
      if (!isAbortError(e)) showToast(e.message || 'Could not load workshops', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, tab, filterVc, search, abortSignal, showToast]);

  // No cleanup returned: the hook aborts on unmount by itself, and the next
  // abortSignal() call cancels whatever is in flight. The old `abort` here was
  // undefined — harmless only because React ignores a non-function return.
  useEffect(() => { load(); }, [load]);

  async function act(row, action, body) {
    try {
      await api(`/api/workshops/${row.id}/${action}`, { method: 'PATCH', body });
      showToast(`${row.workshop_name} — ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'dropped'}`);
      setConfirm(null);
      load();
    } catch (e) { showToast(e.message || 'Action failed', 'error'); }
  }

  async function remove(row) {
    try {
      await api(`/api/workshops/${row.id}`, { method: 'DELETE' });
      showToast(`${row.workshop_name} deleted`);
      setConfirm(null);
      load();
    } catch (e) { showToast(e.message || 'Delete failed', 'error'); }
  }

  // Below 760px the table is REPLACED, not squeezed. Six columns on a 390px
  // screen is a horizontal scrollbar showing two of them; hiding columns just
  // loses the data. Same swap the invoice pages make at the same breakpoint.
  const isNarrow = useMediaQuery(MOBILE_LIST_QUERY);

  // One definition of what actions a row offers, so the table and the cards
  // cannot drift on who may do what.
  const rowActions = (w) => ({
    canEditRow:    w.status !== 'converted' && canEdit,
    canApproveRow: w.status !== 'converted' && canApprove && w.status !== 'approved',
    canRejectRow:  w.status !== 'converted' && canApprove && w.status !== 'rejected',
    canConvertRow: w.status === 'approved'  && canConvert,
    // Drop, and it is NOT the same as reject.
    //
    // Migration 107 draws the distinction deliberately: rejected means "we
    // looked and said no"; dropped means "this went nowhere" — they stopped
    // replying, or we lost interest. Same permission as reject on the backend
    // (EDIT_WORKSHOP / MANAGE_HUBS).
    //
    // This existed on the server and in the tab strip and could not be reached
    // from anywhere: PATCH /:id/drop was wired, dropWorkshop was exported, the
    // "Dropped" tab was there to filter by it — and nothing ever called it, so
    // that tab could only ever be empty.
    canDropRow:    w.status !== 'converted' && w.status !== 'dropped' && canEdit,
    canDeleteRow:  w.status !== 'converted' && canDelete,
  });

  const actionButtons = (w) => {
    const a = rowActions(w);
    return (
      <>
        {a.canEditRow && (
          <button className="ws-icon" title="Edit" aria-label="Edit"
            onClick={() => setModal({ mode: 'edit', row: w })}><Pencil size={14} /></button>
        )}
        {a.canApproveRow && (
          <button className="ws-icon ws-ok" title="Approve" aria-label="Approve"
            onClick={() => act(w, 'approve')}><Check size={15} /></button>
        )}
        {a.canRejectRow && (
          <button className="ws-icon ws-no" title="Reject" aria-label="Reject"
            onClick={() => setConfirm({ row: w, action: 'reject' })}><Ban size={14} /></button>
        )}
        {a.canConvertRow && (
          <button className="btn btn-primary ws-convert" onClick={() => setConvert(w)}>
            <ArrowRightCircle size={14} /> Convert to Hub
          </button>
        )}
        {a.canDropRow && (
          <button className="ws-icon" title="Drop — went nowhere" aria-label="Drop"
            onClick={() => setConfirm({ row: w, action: 'drop' })}><Archive size={14} /></button>
        )}
        {a.canDeleteRow && (
          <button className="ws-icon ws-no" title="Delete" aria-label="Delete"
            onClick={() => setConfirm({ row: w, action: 'delete' })}><Trash2 size={14} /></button>
        )}
      </>
    );
  };

  return (
    <div className="ws-page lb-page">
      {toast && <div className={`ws-toast ws-toast--${toast.kind}`}>{toast.msg}</div>}

      {/* ── Status tabs ── */}
      <div className="ws-tabs" role="tablist">
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`ws-tab${tab === t.key ? ' on' : ''}`}
            onClick={() => { setTab(t.key); setPage(1); }}
          >
            {t.label}
            {/* The counts come from a query that ignores the status filter, so
                these stay put as you click between tabs rather than collapsing
                to zero for every tab but the open one. */}
            <span className="ws-tab-n">{counts[t.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="lb-toolbar">
        <select className="lb-control" value={filterVc}
          onChange={e => { setFilterVc(e.target.value); setPage(1); }}>
          <option value="">All Vehicle Types</option>
          {VEHICLE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <div className="lb-toolbar-right">
          {canCreate && (
            <button type="button" className="lb-control lb-primary"
              onClick={() => setModal({ mode: 'add' })}>
              <Plus size={15} /> Add Workshop
            </button>
          )}
        </div>
      </div>

      <div className="lb-list">
        {/* ── Narrow: cards ── */}
        {isNarrow ? (
          <div className="ws-cards">
            {loading && <div className="ws-empty"><Loader2 size={16} className="ws-spin" /> Loading…</div>}
            {!loading && items.length === 0 && (
              <div className="ws-empty">
                {search ? `No workshops match “${search}”` : 'No workshops yet'}
              </div>
            )}
            {!loading && items.map(w => {
              const tone = STATUS_TONE[w.status] || STATUS_TONE.draft;
              const place = [w.area_name, w.city_name, w.state_name].filter(Boolean).join(', ');
              return (
                <div key={w.id} className="ws-card">
                  <div className="ws-card-top">
                    <div className="ws-card-name">{w.workshop_name}</div>
                    <span className="ws-card-status" style={{ color: tone.color }}>{tone.label}</span>
                  </div>

                  {/* Label + value, so a phone reader is not guessing which
                      number is whose — the table had headers to do that job. */}
                  <dl className="ws-card-meta">
                    <div><dt>Contact</dt><dd>{w.person_name} · {w.contact_number}</dd></div>
                    {place && <div><dt>Location</dt><dd>{place}</dd></div>}
                    <div><dt>Type</dt><dd>{VEHICLE_OPTS.find(o => o.value === w.vehicle_class)?.label || w.vehicle_class}</dd></div>
                  </dl>

                  {w.status === 'rejected' && w.rejection_reason && (
                    /* Wrapped, not truncated. On desktop the full text is a
                       hover away; on a touch screen there is no hover, so
                       clipping it hides the reason entirely. */
                    <div className="ws-card-reason">{w.rejection_reason}</div>
                  )}

                  {w.status === 'converted' && w.converted_hub_id && (
                    <Link className="ws-hublink" to={`/hubs?hub_id=${w.converted_hub_id}`}>
                      {w.converted_hub_code || `Hub #${w.converted_hub_id}`} <ExternalLink size={10} />
                    </Link>
                  )}

                  {Number(w.photo_count) > 0 && (
                    <span className="ws-photos"><Camera size={11} /> {w.photo_count} photo{Number(w.photo_count) > 1 ? 's' : ''}</span>
                  )}

                  <div className="ws-card-actions">{actionButtons(w)}</div>
                </div>
              );
            })}
          </div>
        ) : (
        <table className="ws-table">
          <thead>
            <tr>
              <th>Workshop</th>
              <th>Contact</th>
              <th>Location</th>
              <th>Type</th>
              <th>Status</th>
              <th className="ws-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="ws-empty"><Loader2 size={16} className="ws-spin" /> Loading…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={6} className="ws-empty">
                {search ? `No workshops match “${search}”` : 'No workshops yet'}
              </td></tr>
            )}
            {!loading && items.map(w => {
              const tone = STATUS_TONE[w.status] || STATUS_TONE.draft;
              return (
                <tr key={w.id}>
                  <td>
                    <div className="ws-name">{w.workshop_name}</div>
                    {Number(w.photo_count) > 0 && (
                      <span className="ws-photos"><Camera size={11} /> {w.photo_count}</span>
                    )}
                  </td>
                  <td>
                    <div>{w.person_name}</div>
                    <div className="ws-sub">{w.contact_number}</div>
                  </td>
                  <td className="ws-sub">
                    {[w.area_name, w.city_name, w.state_name].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td>{VEHICLE_OPTS.find(o => o.value === w.vehicle_class)?.label || w.vehicle_class}</td>
                  <td>
                    <span className="ws-status" style={{ color: tone.color }}>{tone.label}</span>
                    {w.status === 'rejected' && w.rejection_reason && (
                      <div className="ws-sub ws-reason" title={w.rejection_reason}>{w.rejection_reason}</div>
                    )}
                    {w.status === 'converted' && w.converted_hub_id && (
                      <Link className="ws-hublink" to={`/hubs?hub_id=${w.converted_hub_id}`}>
                        {w.converted_hub_code || `Hub #${w.converted_hub_id}`} <ExternalLink size={10} />
                      </Link>
                    )}
                  </td>
                  <td className="ws-right">
                    <div className="ws-actions">{actionButtons(w)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        )}

        <PaginationBar
          page={page} total={total} pageSize={pageSize}
          onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }}
          noun="workshop"
        />
      </div>

      {modal && (
        <WorkshopModal
          mode={modal.mode}
          row={modal.row}
          canEdit={canEdit}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
          showToast={showToast}
        />
      )}

      {convert && (
        <ConvertModal
          row={convert}
          onClose={() => setConvert(null)}
          onDone={(hub) => {
            setConvert(null);
            showToast(`${convert.workshop_name} is now hub ${hub.hub_code || `#${hub.hub_id}`}`);
            load();
          }}
          showToast={showToast}
        />
      )}

      {confirm && (
        <ConfirmModal
          confirm={confirm}
          onClose={() => setConfirm(null)}
          onReject={(reason) => act(confirm.row, 'reject', { rejection_reason: reason })}
          onDrop={() => act(confirm.row, 'drop')}
          onDelete={() => remove(confirm.row)}
        />
      )}
    </div>
  );
}

/* ══ Create / edit ══════════════════════════════════════════════════════════ */

function WorkshopModal({ mode, row, onClose, onSaved, showToast }) {
  useEscapeClose(onClose);
  const [form, setForm]   = useState(() => (row ? { ...EMPTY_FORM, ...row } : EMPTY_FORM));
  const [states, setStates] = useState([]);
  const [cities, setCities] = useState([]);
  const [areas, setAreas]   = useState([]);
  const [busy, setBusy]     = useState(false);
  const [photos, setPhotos] = useState(row?.photos || []);

  useEffect(() => { api('/api/locations/states').then(r => setStates(r.items || r)).catch(() => {}); }, []);

  useEffect(() => {
    if (!form.state_id) { setCities([]); return; }
    api(`/api/locations/cities?state_id=${form.state_id}`).then(r => setCities(r.items || r)).catch(() => {});
  }, [form.state_id]);

  useEffect(() => {
    if (!form.city_id) { setAreas([]); return; }
    api(`/api/locations/areas?city_id=${form.city_id}`).then(r => setAreas(r.items || r)).catch(() => {});
  }, [form.city_id]);

  useEffect(() => {
    if (mode === 'edit' && row?.id) {
      api(`/api/workshops/${row.id}`).then(r => setPhotos(r.item?.photos || [])).catch(() => {});
    }
  }, [mode, row?.id]);

  const set = (k) => (e) => setForm(f => ({
    ...f,
    [k]: e.target.value,
    // Clearing the dependants is not tidiness: the previous city belongs to the
    // old state, and submitting that pair is a foreign-key error the user
    // cannot see the cause of.
    ...(k === 'state_id' ? { city_id: '', area_id: '' } : {}),
    ...(k === 'city_id'  ? { area_id: '' } : {}),
  }));

  async function save() {
    setBusy(true);
    try {
      const payload = {};
      for (const k of Object.keys(EMPTY_FORM)) {
        const v = form[k];
        payload[k] = v === '' ? null : v;
      }
      // Required fields must not be sent as null — the server would answer with
      // a type error rather than "this is required".
      for (const k of ['workshop_name', 'person_name', 'contact_number', 'state_id', 'city_id', 'area_id']) {
        if (payload[k] == null) { showToast('Fill in every required field', 'error'); setBusy(false); return; }
      }
      if (mode === 'edit') await api(`/api/workshops/${row.id}`, { method: 'PATCH', body: payload });
      else                 await api('/api/workshops', { method: 'POST', body: payload });
      onSaved();
    } catch (e) {
      showToast(e.message || 'Save failed', 'error');
    } finally { setBusy(false); }
  }

  async function addPhoto(file) {
    if (!row?.id) { showToast('Save the workshop first, then add photos', 'error'); return; }
    try {
      const r = await uploadFile(`/api/workshops/${row.id}/photos`, file);
      setPhotos(p => [...p, r.photo]);
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function dropPhoto(p) {
    try {
      await api(`/api/workshops/${row.id}/photos/${p.id}`, { method: 'DELETE' });
      setPhotos(list => list.filter(x => x.id !== p.id));
    } catch (e) { showToast(e.message, 'error'); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box ws-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{mode === 'edit' ? 'Edit Workshop' : 'Add Workshop'}</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="ws-form">
          <label className="ws-wide">Workshop Name *<input value={form.workshop_name} onChange={set('workshop_name')} maxLength={150} /></label>

          <label>Contact Person *<input value={form.person_name} onChange={set('person_name')} maxLength={120} /></label>
          <label>Contact Number *<input value={form.contact_number} onChange={set('contact_number')} maxLength={10} inputMode="numeric" /></label>

          <label>Owner Name<input value={form.owner_name || ''} onChange={set('owner_name')} maxLength={120} /></label>
          <label>Owner Mobile<input value={form.owner_mobile || ''} onChange={set('owner_mobile')} maxLength={10} inputMode="numeric" /></label>

          <label>State *
            <select value={form.state_id || ''} onChange={set('state_id')}>
              <option value="">Select</option>
              {states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>City *
            <select value={form.city_id || ''} onChange={set('city_id')} disabled={!form.state_id}>
              <option value="">Select</option>
              {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Area *
            <select value={form.area_id || ''} onChange={set('area_id')} disabled={!form.city_id}>
              <option value="">Select</option>
              {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>Vehicle Type *
            <select value={form.vehicle_class} onChange={set('vehicle_class')}>
              {VEHICLE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>

          <label className="ws-wide">Google Maps link
            <input
              value={form.map_url || ''}
              onChange={set('map_url')}
              maxLength={500}
              placeholder="https://maps.app.goo.gl/…"
            />
            <small style={{ color: '#6b7280', fontSize: 11 }}>
              Sent to customers in the appointment WhatsApp message. Carried over
              to the hub when this workshop is converted.
            </small>
          </label>

          <label className="ws-wide">Notes
            <textarea rows={3} value={form.notes || ''} onChange={set('notes')} maxLength={2000} />
          </label>

          {/* Photos only once the row exists — they hang off workshop_id. */}
          {mode === 'edit' && (
            <div className="ws-wide ws-photos-block">
              <div className="ws-photos-hd">
                <span>Site photos <em>({photos.length}/10)</em></span>
                <label className="ws-upload">
                  <Camera size={14} /> Add photo
                  <input type="file" accept="image/*" hidden
                    onChange={e => { const f = e.target.files?.[0]; if (f) addPhoto(f); e.target.value = ''; }} />
                </label>
              </div>
              <div className="ws-photo-grid">
                {photos.length === 0 && <div className="ws-sub">Whoever approves this probably hasn’t seen the place.</div>}
                {photos.map(p => (
                  <div key={p.id} className="ws-photo">
                    <img src={p.file_url} alt={p.caption || p.file_name} />
                    <button onClick={() => dropPhoto(p)} title="Remove"><X size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="ws-modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create workshop'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══ Convert to Hub ═════════════════════════════════════════════════════════ */

/**
 * Asks only for what a Hub needs and a Workshop doesn't carry.
 *
 * rm_user_id is the only field the database insists on. The rate fields are
 * nullable on `hubs`, but leaving all of them empty means purchase invoices
 * fall through to tech-rate mode with null rates and the hub is paid ₹0 —
 * silently, on every invoice. The server refuses that; this mirrors the rule so
 * you find out before filling the form in.
 */
/* ══ Convert to Hub ═════════════════════════════════════════════════════════ */

const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const CONVERT_DOCS = [
  ['aadhaar',         'Aadhaar'],
  ['pan',             'PAN'],
  ['driving_license', 'Driving Licence'],
  ['agreement',       'Agreement'],
  ['gst_certificate', 'GST Certificate'],
  ['bank_proof',      'Bank Proof (Cancelled Cheque)'],
];

const EMPTY_CONVERT = {
  rm_user_id: '', company_name: '',
  open_time: '', close_time: '', working_days: '',
  vehicle_capacity: '', workshop_area_sqft: '', no_of_mechanics: '',
  account_holder_name: '', bank_account_number: '', bank_ifsc: '', bank_name: '',
  has_gst: false, gst_number: '',
  tech_rate_service: '', tech_rate_parts: '',
  commission_percent: '', payout_terms: 'net_30', payout_cycle_days: '',
  is_active: true,
};

/**
 * Field-by-field validation for the Convert form.
 *
 * Mirrors convertSchema on the server. Exported so the rules can be tested
 * without a browser, and so the two cannot drift silently — the ₹0 rule in
 * particular is the difference between a hub that gets paid and one that
 * doesn't.
 */
export function convertErrors(f) {
  const e = {};
  if (!f.rm_user_id) e.rm_user_id = 'Required';

  // NOT cosmetic. purchase_invoices reads commission and tech rates off the
  // hub: commission mode wins above 0, otherwise it falls back to tech-rate
  // mode. With none of them set it does not error — it pays the hub ₹0 on every
  // purchase invoice, silently, forever.
  const commission = f.commission_percent !== '' && Number(f.commission_percent) > 0;
  const techRates  = f.tech_rate_service !== '' || f.tech_rate_parts !== '';
  if (!commission && !techRates) {
    e.commission_percent = 'Set a commission % or take rates — otherwise this hub is paid ₹0 on every purchase invoice';
  }

  if (f.payout_terms === 'custom' && !f.payout_cycle_days) e.payout_cycle_days = 'Required for custom terms';
  if (f.has_gst && f.gst_number.trim() && !GST_REGEX.test(f.gst_number.trim().toUpperCase())) {
    e.gst_number = 'Invalid GST number (e.g. 27AAPFU0939F1ZV)';
  }
  if (f.open_time  && !TIME_REGEX.test(f.open_time))  e.open_time  = 'Use HH:MM';
  if (f.close_time && !TIME_REGEX.test(f.close_time)) e.close_time = 'Use HH:MM';
  if (f.bank_ifsc && f.bank_ifsc.trim() && f.bank_ifsc.trim().length !== 11) e.bank_ifsc = 'IFSC is 11 characters';
  return e;
}

/** Kept for callers that only need "can I submit?" */
export function convertReady(f) {
  const e = convertErrors(f);
  const first = Object.keys(e)[0];
  return first ? e[first] : null;
}

function WsField({ label, req, error, children }) {
  return (
    <div className="hb-field">
      <label>{label}{req && <span className="hb-req"> *</span>}</label>
      {children}
      {error && <span className="hb-field-err"><AlertCircle size={11} /> {error}</span>}
    </div>
  );
}

function ConvertModal({ row, onClose, onDone, showToast }) {
  useEscapeClose(onClose);
  const [users, setUsers] = useState([]);
  const [busy, setBusy]   = useState(false);
  const [docs, setDocs]   = useState({});
  const [form, setForm]   = useState(EMPTY_CONVERT);
  const [touched, setTouched] = useState(false);

  useEffect(() => { api('/api/users/assignable').then(r => setUsers(r.items || r)).catch(() => {}); }, []);

  const errors = convertErrors(form);
  const shown  = touched ? errors : {};
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function go() {
    setTouched(true);
    if (Object.keys(errors).length) {
      showToast(errors[Object.keys(errors)[0]], 'error');
      return;
    }
    setBusy(true);
    try {
      const num = (v) => (v === '' ? null : Number(v));
      const str = (v) => (String(v || '').trim() === '' ? null : String(v).trim());
      const res = await api(`/api/workshops/${row.id}/convert`, {
        method: 'POST',
        body: {
          rm_user_id:          Number(form.rm_user_id),
          company_name:        str(form.company_name),
          commission_percent:  num(form.commission_percent),
          tech_rate_service:   num(form.tech_rate_service),
          tech_rate_parts:     num(form.tech_rate_parts),
          payout_terms:        form.payout_terms,
          payout_cycle_days:   num(form.payout_cycle_days),
          open_time:           str(form.open_time),
          close_time:          str(form.close_time),
          working_days:        str(form.working_days),
          vehicle_capacity:    num(form.vehicle_capacity),
          workshop_area_sqft:  num(form.workshop_area_sqft),
          no_of_mechanics:     num(form.no_of_mechanics),
          has_gst:             !!form.has_gst,
          gst_number:          form.has_gst ? str(form.gst_number) : null,
          bank_account_number: str(form.bank_account_number),
          bank_ifsc:           str(form.bank_ifsc),
          bank_name:           str(form.bank_name),
          account_holder_name: str(form.account_holder_name),
          is_active:           !!form.is_active,
        },
      });

      // Documents upload AFTER the hub exists — hub_documents.hub_id is NOT
      // NULL, so there is nothing to attach them to until now. A failure here
      // leaves a real, working hub missing a document, which is visible and
      // fixable from the Hub page; it does not undo the conversion.
      const pending = Object.entries(docs).filter(([, f]) => f);
      const failed = [];
      for (const [docType, file] of pending) {
        try {
          const fd = new FormData();
          fd.append('file', file);
          fd.append('doc_type', docType);
          const r = await fetch(`/api/hubs/${res.hub_id}/documents`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${getToken()}` },
            body: fd,
          });
          if (!r.ok) throw new Error();
        } catch { failed.push(docType.replace(/_/g, ' ')); }
      }
      if (failed.length) {
        showToast(`Hub created. These documents did not upload — add them from the Hub: ${failed.join(', ')}`, 'error');
      }
      onDone(res);
    } catch (e) {
      showToast(e.message || 'Conversion failed', 'error');
    } finally { setBusy(false); }
  }

  const carried = [
    ['Workshop',      row.workshop_name],
    ['Contact',       `${row.person_name} · ${row.contact_number}`],
    ['Owner',         row.owner_name ? `${row.owner_name}${row.owner_mobile ? ' · ' + row.owner_mobile : ''}` : null],
    ['Location',      [row.area_name, row.city_name, row.state_name].filter(Boolean).join(', ')],
    ['Vehicle Type',  VEHICLE_OPTS.find(o => o.value === row.vehicle_class)?.label],
  ].filter(([, v]) => v);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box ws-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Convert to HUB</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="ws-convert-body">
          {/* What is already known, shown rather than re-typed. Read-only so it
              is obvious this is carrying over, not something to fill in. */}
          <div className="hb-section-sep"><ArrowRightCircle size={12} /> Carried over from the workshop</div>
          <div className="ws-carried">
            {carried.map(([k, v]) => (
              <div key={k}><span>{k}</span><b>{v}</b></div>
            ))}
          </div>

          <div className="hb-section-sep"><Building2 size={12} /> Business Details</div>
          <div className="ws-grid2">
            <WsField label="Company Name">
              <input className="hb-input" value={form.company_name} maxLength={200}
                onChange={e => set('company_name', e.target.value)}
                placeholder="Registered entity, if any" />
            </WsField>
            <WsField label="Relationship Manager (RM)" req error={shown.rm_user_id}>
              <select className={`hb-input${shown.rm_user_id ? ' hb-input--err' : ''}`}
                value={form.rm_user_id} onChange={e => set('rm_user_id', e.target.value)}>
                <option value="">Select</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </WsField>
          </div>

          <div className="hb-section-sep"><Clock size={12} /> Operating Hours</div>
          <div className="ws-grid3">
            <WsField label="Open Time" error={shown.open_time}>
              <input type="time" className={`hb-input${shown.open_time ? ' hb-input--err' : ''}`}
                value={form.open_time} onChange={e => set('open_time', e.target.value)} />
            </WsField>
            <WsField label="Close Time" error={shown.close_time}>
              <input type="time" className={`hb-input${shown.close_time ? ' hb-input--err' : ''}`}
                value={form.close_time} onChange={e => set('close_time', e.target.value)} />
            </WsField>
            <WsField label="Working Days">
              {/* Chips, not free text. Typing "Mon-Sat" produces a string the
                  hub detail view cannot render as chips, and nothing downstream
                  can read as days. */}
              <div className="hb-days-wrap">
                {DAY_OPTS.map(d => {
                  const on = form.working_days.split(',').filter(Boolean).includes(d);
                  return (
                    <label key={d} className={`hb-day-chip${on ? ' hb-day-chip--on' : ''}`}>
                      <input type="checkbox" style={{ display: 'none' }} checked={on}
                        onChange={() => {
                          const cur = new Set(form.working_days.split(',').filter(Boolean));
                          if (on) cur.delete(d); else cur.add(d);
                          // Re-ordered from DAY_OPTS rather than kept in click
                          // order, so "Mon,Tue" never comes out as "Tue,Mon".
                          set('working_days', DAY_OPTS.filter(x => cur.has(x)).join(','));
                        }} />
                      {d}
                    </label>
                  );
                })}
              </div>
            </WsField>
          </div>

          <div className="hb-section-sep"><Users2 size={12} /> Capacity</div>
          <div className="ws-grid3">
            <WsField label="Vehicle Capacity">
              <input type="number" min="0" className="hb-input" value={form.vehicle_capacity}
                onChange={e => set('vehicle_capacity', e.target.value)} />
            </WsField>
            <WsField label="Workshop Area (sq ft)">
              <input type="number" min="0" className="hb-input" value={form.workshop_area_sqft}
                onChange={e => set('workshop_area_sqft', e.target.value)} />
            </WsField>
            <WsField label="No. of Mechanics">
              <input type="number" min="0" className="hb-input" value={form.no_of_mechanics}
                onChange={e => set('no_of_mechanics', e.target.value)} />
            </WsField>
          </div>

          <div className="hb-section-sep"><CreditCard size={12} /> Bank Details</div>
          <div className="ws-grid2">
            <WsField label="Account Holder Name">
              <input className="hb-input" value={form.account_holder_name} maxLength={150}
                onChange={e => set('account_holder_name', e.target.value)} />
            </WsField>
            <WsField label="Account Number">
              <input className="hb-input" value={form.bank_account_number} maxLength={30}
                onChange={e => set('bank_account_number', e.target.value)} />
            </WsField>
            <WsField label="IFSC" error={shown.bank_ifsc}>
              <input className={`hb-input${shown.bank_ifsc ? ' hb-input--err' : ''}`}
                value={form.bank_ifsc} maxLength={11}
                onChange={e => set('bank_ifsc', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))} />
            </WsField>
            <WsField label="Bank Name / Branch">
              <input className="hb-input" value={form.bank_name} maxLength={150}
                onChange={e => set('bank_name', e.target.value)}
                placeholder="e.g. HDFC Bank, Andheri Branch" />
            </WsField>
          </div>

          <div className="hb-section-sep"><FileText size={12} /> GST Details</div>
          <div className="hb-gst-toggle-row">
            <div>
              <div className="hb-toggle-title">Has GST Registration?</div>
              <div className="hb-toggle-hint">Enable if this hub is GST registered</div>
            </div>
            <button
              type="button"
              className={`hb-gst-toggle${form.has_gst ? ' hb-gst-toggle--on' : ''}`}
              onClick={() => setForm(f => ({ ...f, has_gst: !f.has_gst, gst_number: f.has_gst ? '' : f.gst_number }))}
            >
              {form.has_gst
                ? <><ToggleRight size={20} /> Registered</>
                : <><ToggleLeft  size={20} /> Not Registered</>}
            </button>
          </div>
          {form.has_gst && (
            <WsField label="GST Number" error={shown.gst_number}>
              <input className={`hb-input${shown.gst_number ? ' hb-input--err' : ''}`}
                value={form.gst_number} maxLength={15}
                onChange={e => set('gst_number', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15))}
                placeholder="e.g. 27AAPFU0939F1ZV" />
            </WsField>
          )}

          {/* "Take Rate" is the term used everywhere else — the Payouts page
              totals it, and the purchase invoice computes
              Hub Rate = Customer Rate − Take Rate deduction. */}
          <div className="hb-section-sep"><Percent size={12} /> Take Rate</div>
          <div className="ws-rate-note">
            <AlertTriangle size={13} />
            <span>Set a commission % <b>or</b> take rates. With neither, every purchase invoice pays this hub ₹0.</span>
          </div>
          <div className="ws-grid2">
            <WsField label="Service Take Rate %">
              <input type="number" min="0" max="100" step="0.01" className="hb-input"
                value={form.tech_rate_service} onChange={e => set('tech_rate_service', e.target.value)} />
            </WsField>
            <WsField label="Parts Take Rate %">
              <input type="number" min="0" max="100" step="0.01" className="hb-input"
                value={form.tech_rate_parts} onChange={e => set('tech_rate_parts', e.target.value)} />
            </WsField>
          </div>

          <div className="hb-section-sep"><Percent size={12} /> Spinoto Commission Rate</div>
          <div className="ws-grid3">
            <WsField label="Commission %" error={shown.commission_percent}>
              <input type="number" min="0" max="100" step="0.01"
                className={`hb-input${shown.commission_percent ? ' hb-input--err' : ''}`}
                value={form.commission_percent} onChange={e => set('commission_percent', e.target.value)} />
            </WsField>
            <WsField label="Payout Schedule">
              <select className="hb-input" value={form.payout_terms}
                onChange={e => set('payout_terms', e.target.value)}>
                {PAYOUT_TERMS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </WsField>
            {form.payout_terms === 'custom' && (
              <WsField label="Custom Days" req error={shown.payout_cycle_days}>
                <input type="number" min="1" max="3650"
                  className={`hb-input${shown.payout_cycle_days ? ' hb-input--err' : ''}`}
                  value={form.payout_cycle_days} onChange={e => set('payout_cycle_days', e.target.value)} />
              </WsField>
            )}
          </div>

          <div className="hb-section-sep"><Upload size={12} /> KYC Documents</div>
          <div className="ws-docs">
            {CONVERT_DOCS.map(([key, label]) => (
              <label key={key} className="ws-doc-row">
                <span>{label}</span>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png"
                  onChange={e => setDocs(d => ({ ...d, [key]: e.target.files?.[0] || null }))} />
              </label>
            ))}
            <div className="ws-sub">Uploaded once the hub exists. If one fails you can add it from the Hub page.</div>
          </div>

          <div className="hb-section-sep"><Check size={12} /> Status</div>
          <div className="hb-gst-toggle-row">
            <div>
              <div className="hb-toggle-title">Activate immediately?</div>
              {/* Approving the workshop WAS the review, so the hub arrives
                  verified and can go live at once. Turn this off for a hub that
                  is signed but not opening until later. */}
              <div className="hb-toggle-hint">The hub is created verified — no second approval needed</div>
            </div>
            <button type="button"
              className={`hb-gst-toggle${form.is_active ? ' hb-gst-toggle--on' : ''}`}
              onClick={() => set('is_active', !form.is_active)}>
              {form.is_active ? <><ToggleRight size={20} /> Active</> : <><ToggleLeft size={20} /> Inactive</>}
            </button>
          </div>
        </div>

        <div className="ws-modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={go} disabled={busy}>
            {busy ? 'Converting…' : 'Create HUB'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══ Reject / delete confirm ════════════════════════════════════════════════ */

function ConfirmModal({ confirm, onClose, onReject, onDrop, onDelete }) {
  useEscapeClose(onClose);
  const [reason, setReason] = useState('');
  const isReject = confirm.action === 'reject';
  // Drop takes no reason — the backend's dropWorkshop reads only the id — so it
  // is a plain confirm. It is still a confirm rather than a bare button because
  // it moves the workshop into a tab nobody looks at, and an accidental click
  // is otherwise silent.
  const isDrop   = confirm.action === 'drop';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{isReject ? 'Reject workshop' : isDrop ? 'Drop workshop' : 'Delete workshop'}</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0 }}>
            {isReject
              ? <>Rejecting <b>{confirm.row.workshop_name}</b>. Editing it later sends it back to draft.</>
              : isDrop
              ? <>Drop <b>{confirm.row.workshop_name}</b>? Use this when it went nowhere — they stopped
                  replying, or it is not worth pursuing. Rejecting is for when you looked and said no.
                  Nothing is deleted, and you can still find it under the Dropped tab.</>
              : <>Delete <b>{confirm.row.workshop_name}</b>? This can’t be undone.</>}
          </p>
          {isReject && (
            /* Not `ws-wide`: that is grid-column: 1 / -1, which does nothing
               outside .ws-form, and the label had no display of its own — so
               "Reason *" and the textarea sat on one line. */
            <label className="ws-standalone-field">Reason *
              <textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} />
            </label>
          )}
        </div>
        <div className="ws-modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            style={isReject || isDrop ? undefined : { background: '#dc2626' }}
            disabled={isReject && !reason.trim()}
            onClick={() => (isReject ? onReject(reason.trim()) : isDrop ? onDrop() : onDelete())}
          >
            {isReject ? 'Reject' : isDrop ? 'Drop' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
