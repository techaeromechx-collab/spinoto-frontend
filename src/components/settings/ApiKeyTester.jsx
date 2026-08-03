import { useState } from 'react';
import { API_URL } from '../../api/client.js';
import { FlaskConical, Play, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

/**
 * Settings → API Keys → Test a key.
 *
 * Answers one question a key's owner always has and otherwise can't check
 * without curl: does this key work, and what does it actually return?
 *
 * Deliberately uses raw fetch, NOT the api() wrapper. api() attaches the
 * logged-in user's Bearer token, which would make every request succeed
 * regardless of the key — a tester that always passes is worse than none.
 * This sends the key and nothing else, exactly as a partner's server would.
 */

const ENDPOINTS = [
  { path: '/api/v1/master/',                  label: 'Key info (scopes)',  scope: 'services:read' },
  { path: '/api/v1/master/services',          label: 'Services',           scope: 'services:read' },
  { path: '/api/v1/master/service-categories',label: 'Service categories', scope: 'services:read' },
  { path: '/api/v1/master/parts',             label: 'Parts',              scope: 'parts:read' },
  { path: '/api/v1/master/vehicles/makes',    label: 'Vehicle makes',      scope: 'vehicles:read' },
  { path: '/api/v1/master/vehicles/models',   label: 'Vehicle models',     scope: 'vehicles:read' },
  { path: '/api/v1/master/discounts',         label: 'Discounts',          scope: 'discounts:read' },
  { path: '/api/v1/master/hubs',              label: 'Hubs',               scope: 'hubs:read' },
  { path: '/api/v1/master/price',             label: 'Price lookup',       scope: 'pricing:read', needsQuery: true },
];

// What a 401/403 actually means, in the words of someone who has to fix it.
const HINTS = {
  401: 'The key is wrong, revoked or expired. Check you pasted all of it — including the part after the last underscore.',
  403: 'The key is real but was not given this scope. Issue a new key with it ticked.',
  404: 'Endpoint not found. Check the backend is running this version.',
  503: 'The server has not run its migrations yet — run npm run db:migrate.',
};

export default function ApiKeyTester() {
  const [key, setKey]       = useState('');
  const [target, setTarget] = useState(ENDPOINTS[0].path);
  const [query, setQuery]   = useState('service_id=&make_id=&model_id=');
  const [busy, setBusy]     = useState(false);
  const [result, setResult] = useState(null);

  const endpoint = ENDPOINTS.find(e => e.path === target) || ENDPOINTS[0];

  async function runTest(e) {
    e?.preventDefault();
    const k = key.trim();
    if (!k) {
      setResult({ kind: 'error', title: 'Paste a key first', body: 'The full key, as you gave it to the integrator.' });
      return;
    }
    setBusy(true);
    setResult(null);

    const url = API_URL + target + (endpoint.needsQuery && query.trim() ? `?${query.trim()}` : '');
    const started = Date.now();
    try {
      const res = await fetch(url, { headers: { 'x-api-key': k } });
      const ms = Date.now() - started;
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* not JSON — show raw */ }

      setResult({
        kind: res.ok ? 'ok' : 'error',
        status: res.status,
        ms,
        url,
        hint: res.ok ? null : HINTS[res.status],
        // Trimmed: this is a "does it work" check, not a data browser. The
        // full payload can be hundreds of rows and would bury the answer.
        body: json ? JSON.stringify(trim(json), null, 2) : (text || '(empty response)'),
        count: json && Array.isArray(json.data) ? json.data.length : null,
        total: json && typeof json.total === 'number' ? json.total : null,
      });
    } catch (err) {
      // fetch only rejects on a network/CORS failure — never on 4xx/5xx.
      setResult({
        kind: 'error',
        title: 'Could not reach the API',
        body: String(err.message || err),
        hint: `Is the backend running at ${API_URL}? If the API is on another domain, its CORS_ORIGIN must allow this page.`,
        url,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ak-test">
      <h4><FlaskConical size={16} /> Test a key</h4>
      <p className="ak-sub">
        Sends a real request with only this key — no login — exactly as the
        holder's server would. Use it to confirm a key works before you send
        it, or to check why theirs doesn't.
      </p>

      <form onSubmit={runTest}>
        <label htmlFor="akt-key">Key</label>
        <input
          id="akt-key" value={key} onChange={e => setKey(e.target.value)}
          placeholder="spk_live_… paste the full key"
          autoComplete="off" spellCheck="false"
        />

        <label htmlFor="akt-ep">Endpoint</label>
        <select id="akt-ep" value={target} onChange={e => setTarget(e.target.value)}>
          {ENDPOINTS.map(e => (
            <option key={e.path} value={e.path}>{e.label} — needs {e.scope}</option>
          ))}
        </select>

        {endpoint.needsQuery && (
          <>
            <label htmlFor="akt-q">Query</label>
            <input
              id="akt-q" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="service_id=12&make_id=5&model_id=64"
              autoComplete="off" spellCheck="false"
            />
            <span className="ak-hint">
              Send every vehicle field you have. With only a service_id you get the
              generic price, not what this customer would be quoted.
            </span>
          </>
        )}

        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <><Loader2 size={14} className="spin" /> Testing…</> : <><Play size={14} /> Send request</>}
        </button>
      </form>

      {result && (
        <div className={`ak-result ak-result-${result.kind}`}>
          <div className="ak-result-head">
            {result.kind === 'ok'
              ? <><CheckCircle2 size={16} /> <b>{result.status} OK</b></>
              : <><AlertTriangle size={16} /> <b>{result.title || `${result.status} ${result.status === 401 ? 'Unauthorized' : result.status === 403 ? 'Forbidden' : 'Error'}`}</b></>}
            {result.ms != null && <span className="ak-ms">{result.ms} ms</span>}
          </div>

          {result.count != null && (
            <p className="ak-sub">
              Returned <b>{result.count}</b> row{result.count === 1 ? '' : 's'}
              {result.total != null && result.total !== result.count && <> of <b>{result.total}</b> total</>}.
            </p>
          )}

          {result.hint && <p className="ak-hint ak-hint-strong">{result.hint}</p>}

          <code className="ak-url">{result.url}</code>
          <pre className="ak-json">{result.body}</pre>
        </div>
      )}
    </div>
  );
}

/** Keep the preview readable — first 3 rows is enough to see the shape. */
function trim(json) {
  if (json && Array.isArray(json.data) && json.data.length > 3) {
    return { ...json, data: [...json.data.slice(0, 3), `…and ${json.data.length - 3} more rows`] };
  }
  return json;
}
