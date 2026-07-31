// Data-entry for the optional invoice fields that Settings > Invoice Settings
// can switch on. Those toggles decide what PRINTS; this is where the values
// are actually entered.
//
// Only fields enabled in company_settings.document_config are shown, so the
// panel is invisible (renders null) for a workshop that hasn't turned any on —
// no clutter for anyone not using the feature.
//
// Saves via PATCH /api/customer-invoices/:id/extras, which is deliberately
// separate from the notes PATCH: these fields never affect totals, GST or
// status, so they skip all the recalculation machinery.
import { useState, useEffect } from 'react';
import { Pencil, Save, X, SlidersHorizontal } from 'lucide-react';
import { api } from '../api/client.js';

const lbl = {
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 3,
  display: 'block',
};

export default function InvoiceExtrasEditor({ invoice, config, onSaved, showToast }) {
  const [editing, setEditing] = useState(false);
  const [states, setStates]   = useState([]);
  const [saving, setSaving]   = useState(false);
  const [draft, setDraft]     = useState(null);

  const hf = config?.header_fields || {};
  const ic = config?.item_columns || {};
  const flags = config?.flags || {};
  const customFields  = (config?.custom_fields  || []).filter(f => f.enabled !== false && f.label);
  const customColumns = (config?.custom_columns || []).filter(f => f.enabled !== false && f.label);

  // Which inputs this invoice actually needs. vehicle_number is excluded on
  // purpose — it comes from the appointment/estimate, not hand-entry.
  const showPo    = !!hf.po_number;
  const showEway  = !!hf.eway_bill;
  const showPos   = !!hf.place_of_supply;
  const showBatch = !!ic.batch_no;
  const showMfg   = !!ic.mfg_date;
  const showExp   = !!ic.exp_date;
  const showDesc  = !!flags.show_item_description;
  const showFree  = !!flags.free_item_qty;

  const hasHeader = showPo || showEway || showPos || customFields.length > 0;
  const hasItem   = showBatch || showMfg || showExp || showDesc || showFree || customColumns.length > 0;

  // Loaded lazily and only when the Place of Supply selector is enabled —
  // it's a static 38-row table, not worth fetching on every invoice open.
  useEffect(() => {
    if (!hf.place_of_supply || states.length) return;
    api('/api/settings/gst-states')
      .then(r => setStates(r.items || []))
      .catch(() => {});
  }, [hf.place_of_supply, states.length]);

  // Dates arrive as ISO timestamps but <input type="date"> needs YYYY-MM-DD.
  const toDateInput = (v) => (v ? String(v).slice(0, 10) : '');

  const buildDraft = () => ({
    po_number: invoice.po_number || '',
    eway_bill_number: invoice.eway_bill_number || '',
    place_of_supply_code: invoice.place_of_supply_code || '',
    custom_fields: { ...(invoice.custom_fields || {}) },
    items: (invoice.items || []).map(it => ({
      id: it.id,
      description: it.description,
      item_description: it.item_description || '',
      batch_no: it.batch_no || '',
      mfg_date: toDateInput(it.mfg_date),
      exp_date: toDateInput(it.exp_date),
      is_free: !!it.is_free,
      custom_values: { ...(it.custom_values || {}) },
    })),
  });

  // Re-seed the draft if the invoice reloads (e.g. after a sync) while the
  // editor is closed, so opening it never shows stale values.
  useEffect(() => { if (!editing) setDraft(buildDraft()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [invoice, editing]);

  if (!config || (!hasHeader && !hasItem)) return null;

  const d = draft || buildDraft();
  const patchItem = (id, next) =>
    setDraft(s => ({ ...s, items: s.items.map(i => (i.id === id ? { ...i, ...next } : i)) }));

  async function save() {
    setSaving(true);
    try {
      const body = {};
      if (showPo)   body.po_number        = d.po_number.trim() || null;
      if (showEway) body.eway_bill_number = d.eway_bill_number.trim() || null;
      if (showPos)  body.place_of_supply_code = d.place_of_supply_code || null;
      if (customFields.length) body.custom_fields = d.custom_fields;

      if (hasItem) {
        body.items = d.items.map(i => {
          const o = { id: i.id };
          if (showDesc)  o.item_description = i.item_description.trim() || null;
          if (showBatch) o.batch_no = i.batch_no.trim() || null;
          if (showMfg)   o.mfg_date = i.mfg_date || null;
          if (showExp)   o.exp_date = i.exp_date || null;
          if (showFree)  o.is_free  = i.is_free;
          if (customColumns.length) o.custom_values = i.custom_values;
          return o;
        });
      }

      const r = await api(`/api/customer-invoices/${invoice.id}/extras`, { method: 'PATCH', body });
      onSaved?.(r.item || r);
      setEditing(false);
      showToast?.('Invoice details updated.');
    } catch (err) {
      showToast?.(err.message || 'Failed to update invoice details.', 'error');
    } finally {
      setSaving(false);
    }
  }

  // ── Read-only summary ──
  if (!editing) {
    const chips = [];
    if (showPo && invoice.po_number)          chips.push(['PO Number', invoice.po_number]);
    if (showEway && invoice.eway_bill_number) chips.push(['E-way Bill', invoice.eway_bill_number]);
    if (showPos && invoice.place_of_supply_name) {
      chips.push(['Place of Supply', invoice.place_of_supply_name]);
    }
    for (const f of customFields) {
      const v = (invoice.custom_fields || {})[f.id];
      if (v) chips.push([f.label, v]);
    }

    return (
      <div className="est-no-print" style={{
        background: 'var(--bg-soft)', borderRadius: 8, padding: '12px 14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: chips.length ? 8 : 0 }}>
          <div style={{ ...lbl, marginBottom: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <SlidersHorizontal size={11} /> Invoice Details
          </div>
          <button
            type="button"
            onClick={() => { setDraft(buildDraft()); setEditing(true); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: 0 }}
          >
            <Pencil size={11} /> Edit
          </button>
        </div>
        {chips.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px' }}>
            {chips.map(([k, v]) => (
              <div key={k} style={{ fontSize: 12 }}>
                <span style={{ color: 'var(--text-muted)' }}>{k}: </span>
                <span style={{ fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Not set — these fields are enabled in Invoice Settings but empty on this invoice.
          </div>
        )}
      </div>
    );
  }

  // ── Editor ──
  return (
    <div className="est-no-print" style={{
      background: 'var(--bg-soft)', borderRadius: 8, padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ ...lbl, marginBottom: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <SlidersHorizontal size={11} /> Edit Invoice Details
      </div>

      {hasHeader && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {showPo && (
            <div>
              <label style={lbl}>PO Number</label>
              <input className="form-input" style={{ fontSize: 12 }} value={d.po_number} maxLength={60}
                onChange={e => setDraft(s => ({ ...s, po_number: e.target.value }))} />
            </div>
          )}
          {showEway && (
            <div>
              <label style={lbl}>E-way Bill Number</label>
              <input className="form-input" style={{ fontSize: 12 }} value={d.eway_bill_number} maxLength={60}
                onChange={e => setDraft(s => ({ ...s, eway_bill_number: e.target.value }))} />
            </div>
          )}
          {showPos && (
            <div>
              <label style={lbl}>Place of Supply</label>
              <select className="form-input" style={{ fontSize: 12 }}
                value={d.place_of_supply_code}
                onChange={e => setDraft(s => ({ ...s, place_of_supply_code: e.target.value }))}>
                <option value="">Auto (from customer GSTIN / your state)</option>
                {states.map(st => <option key={st.code} value={st.code}>{st.code} — {st.name}</option>)}
              </select>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.4 }}>
                A state other than yours makes this an inter-state supply — the invoice
                then shows IGST instead of CGST + SGST.
              </div>
            </div>
          )}
          {customFields.map(f => (
            <div key={f.id}>
              <label style={lbl}>{f.label}</label>
              <input className="form-input" style={{ fontSize: 12 }} maxLength={200}
                value={d.custom_fields[f.id] || ''}
                onChange={e => setDraft(s => ({ ...s, custom_fields: { ...s.custom_fields, [f.id]: e.target.value } }))} />
            </div>
          ))}
        </div>
      )}

      {hasItem && d.items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={lbl}>Line items</div>
          {d.items.map(it => (
            <div key={it.id} style={{
              border: '1px solid var(--border)', borderRadius: 7, padding: '9px 11px',
              display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg)',
            }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{it.description}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                {showDesc && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={lbl}>Description</label>
                    <input className="form-input" style={{ fontSize: 12 }} maxLength={500}
                      placeholder="Extra detail printed under the item name"
                      value={it.item_description}
                      onChange={e => patchItem(it.id, { item_description: e.target.value })} />
                  </div>
                )}
                {showBatch && (
                  <div>
                    <label style={lbl}>Batch No.</label>
                    <input className="form-input" style={{ fontSize: 12 }} maxLength={60}
                      value={it.batch_no} onChange={e => patchItem(it.id, { batch_no: e.target.value })} />
                  </div>
                )}
                {showMfg && (
                  <div>
                    <label style={lbl}>Mfg Date</label>
                    <input type="date" className="form-input" style={{ fontSize: 12 }}
                      value={it.mfg_date} onChange={e => patchItem(it.id, { mfg_date: e.target.value })} />
                  </div>
                )}
                {showExp && (
                  <div>
                    <label style={lbl}>Exp. Date</label>
                    <input type="date" className="form-input" style={{ fontSize: 12 }}
                      value={it.exp_date} onChange={e => patchItem(it.id, { exp_date: e.target.value })} />
                  </div>
                )}
                {customColumns.map(c => (
                  <div key={c.id}>
                    <label style={lbl}>{c.label}</label>
                    <input className="form-input" style={{ fontSize: 12 }} maxLength={200}
                      value={it.custom_values[c.id] || ''}
                      onChange={e => patchItem(it.id, { custom_values: { ...it.custom_values, [c.id]: e.target.value } })} />
                  </div>
                ))}
              </div>
              {showFree && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={it.is_free}
                    onChange={e => patchItem(it.id, { is_free: e.target.checked })} />
                  Mark as free — prints “FREE” instead of the amount
                </label>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-primary" style={{ padding: '5px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}
          disabled={saving} onClick={save}>
          <Save size={12} /> {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}
          disabled={saving} onClick={() => { setEditing(false); setDraft(buildDraft()); }}>
          <X size={12} /> Cancel
        </button>
      </div>
    </div>
  );
}
