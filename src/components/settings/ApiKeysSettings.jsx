import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client.js';
import ApiKeyTester from './ApiKeyTester.jsx';
import { KeyRound, Plus, Copy, Check, Trash2, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

/**
 * Settings → API Keys.
 *
 * Read-only master-data credentials for systems outside this app.
 *
 * The screen is built around one awkward fact: the key exists exactly once,
 * in the create response, and is never recoverable. So the reveal is a modal
 * that must be dismissed deliberately rather than a toast that disappears,
 * and the list can only ever show the prefix.
 */

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtWhen(v) {
  if (!v) return 'Never';
  const d = new Date(v);
  if (isNaN(d)) return 'Never';
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return 'Just now';          // last_used_at is throttled to 15m
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return fmtDate(v);
}

export default function ApiKeysSettings() {
  const [items, setItems]   = useState([]);
  const [scopes, setScopes] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr]       = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', scopes: [], notes: '', expires_at: '' });
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState(null);

  // The one-time reveal. Non-null = modal open.
  const [issued, setIssued] = useState(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const [confirmId, setConfirmId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api('/api/api-keys');
      setItems(r.items || []);
      setScopes(r.available_scopes || {});
      setErr(null);
    } catch (e) {
      // Surface the server's message. A generic string here is what made the
      // Accounting Period tab impossible to diagnose — the 503 telling you to
      // run migrations was being replaced with "Failed to load".
      setErr(e.message || 'Could not load API keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggleScope(code) {
    setForm(f => ({
      ...f,
      scopes: f.scopes.includes(code) ? f.scopes.filter(s => s !== code) : [...f.scopes, code],
    }));
  }

  async function create(e) {
    e?.preventDefault();
    if (!form.name.trim()) return setFormErr('Give the key a name so you can tell them apart later.');
    if (!form.scopes.length) return setFormErr('Pick at least one scope.');
    setSaving(true); setFormErr(null);
    try {
      const r = await api('/api/api-keys', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          scopes: form.scopes,
          notes: form.notes.trim() || null,
          expires_at: form.expires_at || null,
        },
      });
      setIssued(r);                 // reveal BEFORE refreshing — never lose it
      setCopied(false);
      setShowForm(false);
      setForm({ name: '', scopes: [], notes: '', expires_at: '' });
      load();
    } catch (e2) {
      setFormErr(e2.message || 'Could not create the key');
    } finally {
      setSaving(false);
    }
  }

  async function revoke(id) {
    try {
      await api(`/api/api-keys/${id}`, { method: 'DELETE' });
      setConfirmId(null);
      load();
    } catch (e) {
      setErr(e.message || 'Could not revoke the key');
    }
  }

  /**
   * The Clipboard API needs a secure context, so on a plain http:// origin
   * navigator.clipboard is simply absent. Failing silently here left the
   * button doing visibly nothing on the one screen where the user is looking
   * at the only copy of a credential — so a failure has to say so and hand
   * them a manual path instead.
   */
  async function copyKey() {
    setCopyFailed(false);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(issued.key);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyFailed(true);
      // Select it for them, so "copy manually" is Ctrl+C and nothing else.
      try {
        const el = document.getElementById('ak-key-text');
        if (el) {
          const range = document.createRange();
          range.selectNodeContents(el);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } catch { /* selection is a nicety, never a failure path */ }
    }
  }

  if (loading) {
    return <div className="settings-card"><Loader2 className="spin" size={18} /> Loading API keys…</div>;
  }

  // Error state renders INSTEAD of the list, not below an early return — the
  // bug that made a failed load show a blank panel forever.
  if (err && !items.length) {
    return (
      <div className="settings-card">
        <div className="ak-error"><AlertTriangle size={16} /> {err}</div>
        <button className="btn" onClick={load}><RefreshCw size={14} /> Try again</button>
      </div>
    );
  }

  return (
    <div className="settings-card">
      <div className="ak-head">
        <div>
          <h3><KeyRound size={18} /> API Keys</h3>
          <p className="ak-sub">
            Read-only access to your master data for systems outside Spinoto.
            Keys can read but never change anything.
          </p>
        </div>
        {!showForm && (
          <button className="btn btn-primary" onClick={() => { setShowForm(true); setFormErr(null); }}>
            <Plus size={14} /> New key
          </button>
        )}
      </div>

      {err && items.length > 0 && <div className="ak-error"><AlertTriangle size={16} /> {err}</div>}

      {showForm && (
        <form className="ak-form" onSubmit={create}>
          <label htmlFor="ak-name">Name</label>
          <input
            id="ak-name" value={form.name} autoFocus
            placeholder="Partner — XYZ Motors"
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />

          <label>Scopes</label>
          <div className="ak-scopes">
            {Object.entries(scopes).map(([code, s]) => (
              <label key={code} className="ak-scope">
                <input
                  type="checkbox"
                  checked={form.scopes.includes(code)}
                  onChange={() => toggleScope(code)}
                />
                <span>
                  <b>{s.label}</b>
                  <em>{s.description}</em>
                </span>
              </label>
            ))}
          </div>

          <label htmlFor="ak-exp">Expires (optional)</label>
          <input
            id="ak-exp" type="date" value={form.expires_at}
            min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
            onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
          />

          <label htmlFor="ak-notes">Notes (optional)</label>
          <input
            id="ak-notes" value={form.notes} placeholder="Who holds this, and why"
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          />

          {formErr && <div className="ak-error"><AlertTriangle size={15} /> {formErr}</div>}

          <div className="ak-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create key'}
            </button>
            <button type="button" className="btn" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      {!items.length && !showForm && (
        <p className="ak-empty">No API keys yet. Create one to let another system read your services and prices.</p>
      )}

      {!!items.length && (
        <table className="ak-table">
          <thead>
            <tr><th>Name</th><th>Key</th><th>Scopes</th><th>Last used</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {items.map(k => (
              <tr key={k.id} className={k.is_active ? '' : 'ak-dead'}>
                <td>
                  <b>{k.name}</b>
                  {k.notes && <div className="ak-note">{k.notes}</div>}
                </td>
                <td><code>{k.key_prefix}…</code></td>
                <td>
                  {(k.scopes || []).map(s => <span key={s} className="ak-chip">{s.replace(':read', '')}</span>)}
                </td>
                <td>{fmtWhen(k.last_used_at)}</td>
                <td>
                  {k.revoked_at
                    ? <span className="ak-badge ak-badge-dead">Revoked {fmtDate(k.revoked_at)}</span>
                    : k.expires_at && new Date(k.expires_at) <= new Date()
                      ? <span className="ak-badge ak-badge-dead">Expired</span>
                      : <span className="ak-badge ak-badge-live">Active</span>}
                </td>
                <td>
                  {k.is_active && (
                    confirmId === k.id ? (
                      <span className="ak-confirm">
                        <button className="btn btn-danger btn-sm" onClick={() => revoke(k.id)}>Revoke</button>
                        <button className="btn btn-sm" onClick={() => setConfirmId(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button className="btn btn-sm" onClick={() => setConfirmId(k.id)} title="Revoke this key">
                        <Trash2 size={14} />
                      </button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Below the list on purpose: you test a key you already have, so this
          follows creating one rather than competing with it for attention. */}
      <ApiKeyTester />

      {/* One-time reveal. Deliberately a blocking modal with no click-outside
          and no Escape: this is the only moment the key exists, and dismissing
          it by accident means reissuing. */}
      {issued && (
        <div className="ak-overlay">
          <div className="ak-modal">
            <h4><KeyRound size={18} /> Copy this key now</h4>
            <p className="ak-warn">
              <AlertTriangle size={15} />
              {issued.warning}
            </p>
            <div className="ak-keybox">
              <code id="ak-key-text">{issued.key}</code>
              <button className="btn" onClick={copyKey}>
                {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
              </button>
            </div>
            {copyFailed && (
              <p className="ak-error">
                <AlertTriangle size={15} />
                Couldn't copy automatically — the key above is selected, press Ctrl+C (or Cmd+C).
                Automatic copying needs an https:// address.
              </p>
            )}
            <p className="ak-sub">
              Send it to <b>{issued.item?.name}</b> over something private — not email
              if you can avoid it. They send it as an <code>x-api-key</code> header.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => { setIssued(null); setCopied(false); setCopyFailed(false); }}
            >
              I've copied it — close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
