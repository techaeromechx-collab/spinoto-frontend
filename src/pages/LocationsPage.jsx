import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { 
  Plus, 
  Search, 
  MapPin, 
  Navigation, 
  LocateFixed,
  Trash2,
  ToggleLeft,
  ToggleRight
} from 'lucide-react';
import '../styles/LocationsPage.css';

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

  useEffect(() => { loadStates(); }, []);
  useEffect(() => { if (selState) loadCities(selState.id); else setCities([]); }, [selState]);
  useEffect(() => { if (selCity) loadAreas(selCity.id); else setAreas([]); }, [selCity]);

  async function loadStates() { const r = await api('/api/locations/states'); setStates(r.items); }
  async function loadCities(sid) { const r = await api(`/api/locations/cities?state_id=${sid}`); setCities(r.items); }
  async function loadAreas(cid) { const r = await api(`/api/locations/areas?city_id=${cid}`); setAreas(r.items); }

  async function addState() { if (!newState) return; await api('/api/locations/states', { method: 'POST', body: { name: newState } }); setNewState(''); loadStates(); }
  async function addCity() { if (!newCity || !selState) return; await api('/api/locations/cities', { method: 'POST', body: { state_id: selState.id, name: newCity } }); setNewCity(''); loadCities(selState.id); }
  async function addArea() { if (!newArea.name || !selCity) return; await api('/api/locations/areas', { method: 'POST', body: { city_id: selCity.id, ...newArea } }); setNewArea({ name: '', pincode: '' }); loadAreas(selCity.id); }

  async function toggleStatus(type, item) {
    const endpoint = `/api/locations/${type}/${item.id}`;
    await api(endpoint, { method: 'PATCH', body: { is_active: !item.is_active } });
    if (type === 'states') loadStates();
    if (type === 'cities') loadCities(selState.id);
    if (type === 'areas') loadAreas(selCity.id);
  }

  const filteredStates = states.filter(s => s.name.toLowerCase().includes(stateSearch.toLowerCase()));
  const filteredCities = cities.filter(c => c.name.toLowerCase().includes(citySearch.toLowerCase()));
  const filteredAreas  = areas.filter(a => a.name.toLowerCase().includes(areaSearch.toLowerCase()));

  return (
    <div className="locations-page">
      <header className="page-header">
        <div>
          <h2>Service Locations</h2>
          <p>Manage the geographic coverage of your operations.</p>
        </div>
      </header>

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
            {filteredStates.map(s => (
              <div 
                key={s.id} 
                className={`pane-item ${selState?.id === s.id ? 'selected' : ''} ${!s.is_active ? 'inactive' : ''}`}
                onClick={() => { setSelState(s); setSelCity(null); }}
              >
                <div className="pane-item-name">
                  <MapPin size={14} />
                  <span>{s.name}</span>
                </div>
                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); toggleStatus('states', s); }}>
                  {s.is_active ? <ToggleRight size={16} color="var(--ok)" /> : <ToggleLeft size={16} />}
                </button>
              </div>
            ))}
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
            ) : filteredCities.map(c => (
              <div 
                key={c.id} 
                className={`pane-item ${selCity?.id === c.id ? 'selected' : ''} ${!c.is_active ? 'inactive' : ''}`}
                onClick={() => setSelCity(c)}
              >
                <div className="pane-item-name">
                  <Navigation size={14} />
                  <span>{c.name}</span>
                </div>
                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); toggleStatus('cities', c); }}>
                  {c.is_active ? <ToggleRight size={16} color="var(--ok)" /> : <ToggleLeft size={16} />}
                </button>
              </div>
            ))}
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
            ) : filteredAreas.map(a => (
              <div 
                key={a.id} 
                className={`pane-item ${!a.is_active ? 'inactive' : ''}`}
              >
                <div className="pane-item-name">
                  <LocateFixed size={14} />
                  <span>{a.name} <small className="muted">({a.pincode || 'No Pin'})</small></span>
                </div>
                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); toggleStatus('areas', a); }}>
                  {a.is_active ? <ToggleRight size={16} color="var(--ok)" /> : <ToggleLeft size={16} />}
                </button>
              </div>
            ))}
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
