import { useEffect, useState, useRef } from 'react';
import { api } from '../api/client.js';
import useSync from '../hooks/useSync.js';
import {
  Plus,
  Search,
  MapPin,
  Navigation,
  LocateFixed,
  Trash2,
  Pencil,
  Check,
  X,
  ToggleLeft,
  ToggleRight
} from 'lucide-react';
import '../styles/LocationsPage.css';

// Inline rename input — supports optional pincode field (for areas)
function RenameInput({ value, pincode, onSave, onCancel }) {
  const [val, setVal] = useState(value);
  const [pin, setPin] = useState(pincode ?? '');
  const inputRef = useRef(null);
  const hasPin = pincode !== undefined;

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  function handleKey(e) {
    if (e.key === 'Enter') onSave(val.trim(), hasPin ? pin.trim() : undefined);
    if (e.key === 'Escape') onCancel();
  }

  return (
    <div className="rename-row" onClick={e => e.stopPropagation()}>
      <input
        ref={inputRef}
        className="rename-input"
        value={val}
        placeholder="Name"
        onChange={e => setVal(e.target.value)}
        onKeyDown={handleKey}
      />
      {hasPin && (
        <input
          className="rename-input pincode-input"
          value={pin}
          placeholder="Pincode"
          onChange={e => setPin(e.target.value)}
          onKeyDown={handleKey}
        />
      )}
      <button className="icon-btn ok-btn" onClick={() => onSave(val.trim(), hasPin ? pin.trim() : undefined)} title="Save"><Check size={14} /></button>
      <button className="icon-btn"        onClick={onCancel} title="Cancel"><X size={14} /></button>
    </div>
  );
}

export default function LocationsPage() {
  const [states, setStates] = useState([]);
  const [cities, setCities] = useState([]);
  const [areas, setAreas] = useState([]);

  const [selState, setSelState] = useState(null);
  const [selCity, setSelCity] = useState(null);

  const [stateSearch, setStateSearch] = useState('');
  const [citySearch, setCitySearch] = useState('');
  const [areaSearch, setAreaSearch] = useState('');

  const [newState, setNewState] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newArea, setNewArea] = useState({ name: '', pincode: '' });

  // editingId tracks which row is currently open for rename: { type, id }
  const [editingId, setEditingId] = useState(null);
  // confirmDelete tracks which row is pending delete confirmation: { type, id }
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => { loadStates(); }, []);
  useEffect(() => { if (selState) loadCities(selState.id); else setCities([]); }, [selState]);
  useEffect(() => { if (selCity) loadAreas(selCity.id); else setAreas([]); }, [selCity]);

  // Real-time sync: re-fetch when any other user changes location data.
  const selStateRef = useRef(selState);
  const selCityRef = useRef(selCity);
  useEffect(() => { selStateRef.current = selState; }, [selState]);
  useEffect(() => { selCityRef.current = selCity; }, [selCity]);
  useSync('locations', () => {
    loadStates();
    if (selStateRef.current) loadCities(selStateRef.current.id);
    if (selCityRef.current) loadAreas(selCityRef.current.id);
  });

  async function loadStates() { const r = await api('/api/locations/states'); setStates(r.items); }
  async function loadCities(sid) { const r = await api(`/api/locations/cities?state_id=${sid}`); setCities(r.items); }
  async function loadAreas(cid) { const r = await api(`/api/locations/areas?city_id=${cid}`); setAreas(r.items); }

  async function addState() { if (!newState) return; await api('/api/locations/states', { method: 'POST', body: { name: newState } }); setNewState(''); loadStates(); }
  async function addCity() { if (!newCity || !selState) return; await api('/api/locations/cities', { method: 'POST', body: { state_id: selState.id, name: newCity } }); setNewCity(''); loadCities(selState.id); }
  async function addArea() { if (!newArea.name || !selCity) return; await api('/api/locations/areas', { method: 'POST', body: { city_id: selCity.id, ...newArea } }); setNewArea({ name: '', pincode: '' }); loadAreas(selCity.id); }

  // Optimistic toggle: flip instantly, reconcile via reload on success, roll
  // back visibly on failure. (Previously a failed toggle rejected silently.)
  const [actionError, setActionError] = useState(null);
  useEffect(() => {
    if (!actionError) return;
    const t = setTimeout(() => setActionError(null), 4000);
    return () => clearTimeout(t);
  }, [actionError]);

  async function toggleStatus(type, item) {
    const setterFor = { states: setStates, cities: setCities, areas: setAreas };
    const snapshot = type === 'states' ? states : type === 'cities' ? cities : areas;
    const set = setterFor[type];
    set(prev => prev.map(x => x.id === item.id ? { ...x, is_active: !x.is_active } : x));
    try {
      await api(`/api/locations/${type}/${item.id}`, { method: 'PATCH', body: { is_active: !item.is_active } });
      reload(type); // silent reconcile with server truth
    } catch (e) {
      set(snapshot);
      setActionError(`${e.message || 'Update failed'} — change reverted.`);
    }
  }

  async function rename(type, id, name, pincode) {
    if (!name) return setEditingId(null);
    const body = { name };
    if (pincode !== undefined) body.pincode = pincode || null;
    await api(`/api/locations/${type}/${id}`, { method: 'PATCH', body });
    setEditingId(null);
    reload(type);
  }

  async function deleteItem(type, id) {
    await api(`/api/locations/${type}/${id}`, { method: 'DELETE' });
    setConfirmDelete(null);
    // If we deleted the selected state/city, clear selection
    if (type === 'states' && selState?.id === id) { setSelState(null); setSelCity(null); }
    if (type === 'cities' && selCity?.id === id) { setSelCity(null); }
    reload(type);
  }

  function reload(type) {
    if (type === 'states') loadStates();
    if (type === 'cities') loadCities(selState.id);
    if (type === 'areas') loadAreas(selCity.id);
  }

  const filteredStates = states.filter(s => s.name.toLowerCase().includes(stateSearch.toLowerCase()));
  const filteredCities = cities.filter(c => c.name.toLowerCase().includes(citySearch.toLowerCase()));
  const filteredAreas  = areas.filter(a => a.name.toLowerCase().includes(areaSearch.toLowerCase()));

  // Shared row actions (pencil + toggle + trash)
  function RowActions({ type, item, onSelect }) {
    const isEditing  = editingId?.type === type && editingId?.id === item.id;
    const isDeleting = confirmDelete?.type === type && confirmDelete?.id === item.id;

    if (isEditing) return null; // RenameInput replaces the whole row content

    if (isDeleting) {
      return (
        <div className="delete-confirm" onClick={e => e.stopPropagation()}>
          <span className="delete-confirm-label">Delete?</span>
          <button className="icon-btn danger-btn" onClick={() => deleteItem(type, item.id)} title="Confirm delete"><Check size={14} /></button>
          <button className="icon-btn"            onClick={() => setConfirmDelete(null)}    title="Cancel"><X size={14} /></button>
        </div>
      );
    }

    return (
      <div className="row-actions" onClick={e => e.stopPropagation()}>
        <button className="icon-btn" onClick={() => { onSelect?.(); setEditingId({ type, id: item.id }); }} title="Rename">
          <Pencil size={13} />
        </button>
        <button className="icon-btn" onClick={() => toggleStatus(type, item)} title={item.is_active ? 'Deactivate' : 'Activate'}>
          {item.is_active ? <ToggleRight size={16} color="var(--ok)" /> : <ToggleLeft size={16} />}
        </button>
        <button className="icon-btn danger-btn" onClick={() => setConfirmDelete({ type, id: item.id })} title="Delete">
          <Trash2 size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="locations-page">
      <header className="page-header">
        <div>
          <h2>Service Locations</h2>
          <p>Manage the geographic coverage of your operations.</p>
        </div>
      </header>

      {/* Rollback notice for failed optimistic actions */}
      {actionError && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10,
          padding: '12px 18px', color: '#991b1b', fontWeight: 500, fontSize: 14,
          boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
        }}>
          {actionError}
        </div>
      )}

      <div className="master-layout">
        {/* States Pane */}
        <div className="pane">
          <div className="pane-header">
            <div className="pane-title">
              <h4>States</h4>
              <span className="count">{states.length}</span>
            </div>
            <div className="pane-search">
              <Search size={14} />
              <input placeholder="Search states..." value={stateSearch} onChange={e => setStateSearch(e.target.value)} />
            </div>
          </div>
          <div className="pane-content">
            {filteredStates.map(s => {
              const isEditing = editingId?.type === 'states' && editingId?.id === s.id;
              return (
                <div
                  key={s.id}
                  className={`pane-item ${selState?.id === s.id ? 'selected' : ''} ${!s.is_active ? 'inactive' : ''}`}
                  onClick={() => { if (!isEditing) { setSelState(s); setSelCity(null); } }}
                >
                  {isEditing ? (
                    <RenameInput value={s.name} onSave={v => rename('states', s.id, v)} onCancel={() => setEditingId(null)} />
                  ) : (
                    <>
                      <div className="pane-item-name">
                        <MapPin size={14} />
                        <span>{s.name}</span>
                      </div>
                      <RowActions type="states" item={s} onSelect={() => { setSelState(s); setSelCity(null); }} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="pane-footer">
            <div className="pane-adder">
              <input placeholder="Add new state..." value={newState} onChange={e => setNewState(e.target.value)} onKeyDown={e => e.key === 'Enter' && addState()} />
              <button onClick={addState}><Plus size={16} /></button>
            </div>
          </div>
        </div>

        {/* Cities Pane */}
        <div className="pane">
          <div className="pane-header">
            <div className="pane-title">
              <h4>Cities</h4>
              <span className="count">{cities.length}</span>
            </div>
            <div className="pane-search">
              <Search size={14} />
              <input placeholder="Search cities..." value={citySearch} onChange={e => setCitySearch(e.target.value)} />
            </div>
          </div>
          <div className="pane-content">
            {!selState ? (
              <div className="pane-empty-state">
                <Navigation size={32} />
                <p>Select a state to view cities</p>
              </div>
            ) : filteredCities.map(c => {
              const isEditing = editingId?.type === 'cities' && editingId?.id === c.id;
              return (
                <div
                  key={c.id}
                  className={`pane-item ${selCity?.id === c.id ? 'selected' : ''} ${!c.is_active ? 'inactive' : ''}`}
                  onClick={() => { if (!isEditing) setSelCity(c); }}
                >
                  {isEditing ? (
                    <RenameInput value={c.name} onSave={v => rename('cities', c.id, v)} onCancel={() => setEditingId(null)} />
                  ) : (
                    <>
                      <div className="pane-item-name">
                        <Navigation size={14} />
                        <span>{c.name}</span>
                      </div>
                      <RowActions type="cities" item={c} onSelect={() => setSelCity(c)} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="pane-footer">
            <div className="pane-adder">
              <input disabled={!selState} placeholder="Add new city..." value={newCity} onChange={e => setNewCity(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCity()} />
              <button disabled={!selState} onClick={addCity}><Plus size={16} /></button>
            </div>
          </div>
        </div>

        {/* Areas Pane */}
        <div className="pane">
          <div className="pane-header">
            <div className="pane-title">
              <h4>Areas</h4>
              <span className="count">{areas.length}</span>
            </div>
            <div className="pane-search">
              <Search size={14} />
              <input placeholder="Search areas..." value={areaSearch} onChange={e => setAreaSearch(e.target.value)} />
            </div>
          </div>
          <div className="pane-content">
            {!selCity ? (
              <div className="pane-empty-state">
                <LocateFixed size={32} />
                <p>Select a city to view areas</p>
              </div>
            ) : filteredAreas.map(a => {
              const isEditing = editingId?.type === 'areas' && editingId?.id === a.id;
              return (
                <div
                  key={a.id}
                  className={`pane-item ${!a.is_active ? 'inactive' : ''}`}
                >
                  {isEditing ? (
                    <RenameInput value={a.name} pincode={a.pincode ?? ''} onSave={(v, p) => rename('areas', a.id, v, p)} onCancel={() => setEditingId(null)} />
                  ) : (
                    <>
                      <div className="pane-item-name">
                        <LocateFixed size={14} />
                        <span>{a.name} <small className="muted">({a.pincode || 'No Pin'})</small></span>
                      </div>
                      <RowActions type="areas" item={a} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="pane-footer">
            <div className="pane-adder" style={{ flexDirection: 'column' }}>
              <input disabled={!selCity} placeholder="Area Name" value={newArea.name} onChange={e => setNewArea({...newArea, name: e.target.value})} />
              <div style={{ display: 'flex', gap: 8 }}>
                <input disabled={!selCity} placeholder="Pincode" value={newArea.pincode} onChange={e => setNewArea({...newArea, pincode: e.target.value})} onKeyDown={e => e.key === 'Enter' && addArea()} />
                <button disabled={!selCity} onClick={addArea}><Plus size={16} /></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
