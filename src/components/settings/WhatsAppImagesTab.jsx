import { useState, useEffect, useCallback, useRef } from 'react';
// API_URL and getToken as well as api(): api() hard-sets
// Content-Type: application/json and stringifies the body, so it cannot post a
// file. Same raw-fetch escape hatch the WhatsApp composer uses.
import { api, API_URL, getToken } from '../../api/client.js';
import {
  Loader2, Plus, Trash2, Info, AlertTriangle, Check, X, Pencil, Save,
  ImageOff, Paperclip, Upload,
} from 'lucide-react';

/**
 * Settings → WhatsApp → Image Library.
 *
 * The images an advisor can send from a WhatsApp conversation without
 * uploading anything: the price list, the workshop map, the offer poster.
 *
 * ── Two ways in, and why UPLOAD is the one on the left ──────────────────────
 *
 * WhatsApp does not accept image bytes from us. Interakt has no upload
 * endpoint; the only thing that can be sent is an address WhatsApp's own
 * servers fetch. So the file must be publicly reachable before it can be sent,
 * and what this screen stores is always an address.
 *
 * WHERE that address comes from is the whole difference. Pasting one looks
 * simpler and is not: it asks somebody to copy an exact string out of a
 * different product, and it failed in practice every way it can —
 *
 *   • the filename had spaces, which ImageKit sanitises on upload, so the
 *     address in the design tool is not the address the file lives at
 *   • the file was renamed, and every rename mints a new address
 *   • the new URL was pasted into the MIDDLE of the old one
 *   • the file was uploaded private, and answers 400 to anyone unsigned
 *
 * — and all four save cleanly and fail later, at send time, in front of a
 * customer. Uploading removes all of them at once: the bytes go through this
 * server, the address comes back from ImageKit, and nobody types anything.
 *
 * Pasting stays for the case it is genuinely good at — an image already on
 * ImageKit and already known to work — and is now checked before it saves.
 *
 * ── Why active/inactive as well as delete ───────────────────────────────────
 *
 * They answer different questions. "Not this month" is a Diwali poster in
 * August, and the row should come back in October with its name and URL
 * intact. "This was a mistake" is a wrong link, and it should go. A single
 * delete would force an admin to re-add the poster every year; a single toggle
 * would leave a list of dead rows nobody dares remove.
 *
 * Neither touches messages already sent — wa_messages stores the URL it used at
 * send time, so a customer's chat cannot be blanked from this screen.
 */
export default function WhatsAppImagesTab() {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState('');
  const [ok, setOk]           = useState('');
  const [busy, setBusy]       = useState(false);

  // The add form.
  const [name, setName] = useState('');
  const [url, setUrl]   = useState('');

  // Inline edit: the id being edited and the draft it holds. One at a time,
  // because two half-edited rows is a state nobody can reason about and the
  // Save button would not know which it belongs to.
  const [editId, setEditId]   = useState(null);
  const [edit, setEdit]       = useState({ name: '', imagekit_url: '' });

  // Two-step delete, not a browser confirm(). A native dialog blocks the whole
  // window and reads as a system error; this asks in the row it is about.
  const [confirmId, setConfirmId] = useState(null);

  // The paperclip switch. Loaded and saved on its own — it is a setting about
  // the composer, not a row in this list, and folding it into the list's save
  // would make turning it off wait on unrelated edits.
  const [allowUpload, setAllowUpload] = useState(true);
  const [uploadBusy, setUploadBusy]   = useState(false);

  // Uploading a file INTO the library. Nothing to do with allowUpload above,
  // which is about the advisor's paperclip in the chat — this is an admin
  // adding a library image, and it is always available to them.
  const fileInput = useRef(null);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // all=1 — this screen must show disabled rows, which is the whole point
      // of a manage screen. The router only lets a manager past that flag; an
      // agent asking for it silently gets the active list.
      const [r, cfg] = await Promise.all([
        api('/api/whatsapp/images?all=1'),
        api('/api/whatsapp/library-settings'),
      ]);
      setItems(r.items || []);
      setAllowUpload(cfg.allow_local_upload !== false);
      setErr('');
    } catch (e) {
      setErr(e.message || 'Could not load the image library.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Success notices clear themselves. A "Saved" that stays on screen stops
  // meaning "just now" within about ten seconds and starts meaning nothing.
  useEffect(() => {
    if (!ok) return;
    const t = setTimeout(() => setOk(''), 4000);
    return () => clearTimeout(t);
  }, [ok]);

  async function add() {
    if (!name.trim() || !url.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await api('/api/whatsapp/images', {
        method: 'POST',
        body: { name: name.trim(), imagekit_url: url.trim() },
      });
      setItems(list => [...list, r.item].sort(byName));
      setName(''); setUrl('');
      setOk(`“${r.item.name}” is now available in the chat.`);
    } catch (e) {
      setErr(e.message || 'Could not add that image.');
    }
    setBusy(false);
  }

  /**
   * The file goes through OUR server, not through ImageKit's dashboard.
   *
   * Every failure this feature had in practice came from copying an address by
   * hand: a renamed file, a space ImageKit sanitised on upload, a paste landing
   * in the middle of the old value, a file uploaded private. None of them can
   * happen when the address is never typed.
   */
  async function pickFile(e) {
    const f = e.target.files?.[0];
    // Cleared at once so choosing the SAME file twice still fires a change
    // event — otherwise a failed upload cannot be retried with that file.
    e.target.value = '';
    if (!f) return;

    // Checked here as well as on the server, and that is not belt-and-braces:
    // without it the admin waits through the upload of a 12 MB poster to be
    // told it was too big. The server's copy is the rule; this is the courtesy.
    if (!['image/jpeg', 'image/png'].includes(f.type)) {
      setErr(`WhatsApp accepts JPG and PNG only — that one is ${f.type || 'an unknown type'}.`);
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setErr(`That image is ${(f.size / 1048576).toFixed(1)} MB. The limit is 5 MB.`);
      return;
    }

    // The name field if it has one, otherwise the filename with its extension
    // trimmed off. Not the raw filename: 'Spinoto_CAR SERVICE PRICE-03.png' is
    // a fine picture and a terrible thing to read in a picker.
    const label = name.trim() || f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    if (!label) { setErr('Give the image a name first.'); return; }

    setPicking(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('photo', f);
      fd.append('name', label);

      const res = await fetch(`${API_URL}/api/whatsapp/images/upload`, {
        method: 'POST',
        // No Content-Type — the browser must set it, including the multipart
        // boundary. Setting it by hand is the classic way this fails silently.
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'The image could not be uploaded.');

      setItems(list => [...list, out.item].sort(byName));
      setName(''); setUrl('');
      setOk(`“${out.item.name}” uploaded and ready to send.`);
    } catch (e2) {
      setErr(e2.message || 'The image could not be uploaded.');
    }
    setPicking(false);
  }

  async function patch(id, body, okMsg) {
    setBusy(true); setErr('');
    try {
      const r = await api(`/api/whatsapp/images/${id}`, { method: 'PATCH', body });
      setItems(list => list.map(i => (i.id === id ? r.item : i)).sort(byName));
      if (okMsg) setOk(okMsg);
      return true;
    } catch (e) {
      setErr(e.message || 'Could not save that change.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    setBusy(true); setErr('');
    try {
      await api(`/api/whatsapp/images/${id}`, { method: 'DELETE' });
      setItems(list => list.filter(i => i.id !== id));
      setConfirmId(null);
      setOk('Image removed. Messages already sent are unchanged.');
    } catch (e) {
      setErr(e.message || 'Could not remove that image.');
    }
    setBusy(false);
  }

  function startEdit(it) {
    setConfirmId(null);
    setEditId(it.id);
    setEdit({ name: it.name, imagekit_url: it.imagekit_url });
  }

  async function saveEdit() {
    if (!edit.name.trim() || !edit.imagekit_url.trim()) return;
    const done = await patch(editId, {
      name: edit.name.trim(),
      imagekit_url: edit.imagekit_url.trim(),
    }, 'Image updated.');
    if (done) setEditId(null);
  }

  async function toggleUpload(next) {
    setUploadBusy(true); setErr('');
    try {
      const r = await api('/api/whatsapp/library-settings', {
        method: 'PUT',
        body: { allow_local_upload: next },
      });
      setAllowUpload(r.allow_local_upload !== false);
      setOk(next
        ? 'Advisors can attach photos from their own computer again.'
        : 'The paperclip is hidden. Advisors can now only send images from this library.');
    } catch (e) {
      setErr(e.message || 'Could not change that setting.');
    }
    setUploadBusy(false);
  }

  const active = items.filter(i => i.is_active).length;

  if (loading) {
    return <div className="wai-loading"><Loader2 size={16} className="spin" /> Loading the image library…</div>;
  }

  return (
    <div className="wai">
      <div className="wa-banner wa-banner--info">
        <Info size={15} />
        <div>
          <strong>Images an advisor can send in one tap.</strong> The price list, a workshop
          map, this month's offer. Upload the picture and we put it on ImageKit for you —
          WhatsApp fetches it from there itself, so it has to live at a public address.
          You can paste an address instead if the image is already on ImageKit and you have
          the exact URL.
        </div>
      </div>

      {err && <div className="wa-banner wa-banner--error"><AlertTriangle size={15} /><div>{err}</div></div>}
      {ok  && <div className="wa-banner wai-banner--ok"><Check size={15} /><div>{ok}</div></div>}

      {/* ── Add ──────────────────────────────────────────────────────────── */}
      <div className="wai-add">
        <div className="wai-add-f">
          <label>Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Service price list"
            maxLength={120}
          />
          {/* The one line of guidance that matters, next to the field it is
              about: this name is the only thing the advisor sees in the
              picker, so it has to say what the picture is. */}
          <em>What the advisor picks from. They never see the address.</em>
        </div>

        {/* Upload sits FIRST and carries the primary styling, because it is
            the route that cannot go wrong. Pasting is second and quieter —
            still there, no longer the obvious thing to reach for. */}
        <button
          className="btn btn-primary wai-add-btn"
          onClick={() => fileInput.current?.click()}
          disabled={picking || busy}
        >
          {picking ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
          {picking ? 'Uploading…' : 'Upload image'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png"
          hidden
          onChange={pickFile}
        />
      </div>

      <div className="wai-or">
        <span>or paste an address it already has</span>
      </div>

      <div className="wai-add wai-add--url">
        <div className="wai-add-f wai-add-f--wide">
          <label>ImageKit address</label>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            /* Selects the lot on focus. Nobody edits one character of an
               ImageKit URL — the whole value is always replaced — and a caret
               dropped mid-string means the next paste lands INSIDE the old
               address instead of over it, which produces a 300-character
               hybrid that looks almost right. */
            onFocus={e => e.target.select()}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder="https://ik.imagekit.io/…/price-list.jpg"
            maxLength={2000}
            spellCheck={false}
          />
          <em>
            Use ImageKit's <strong>Copy URL</strong> button rather than typing the name —
            renaming a file there changes its address. We check it loads before saving.
          </em>
        </div>
        <button className="wai-ghost wai-add-btn" onClick={add} disabled={busy || !name.trim() || !url.trim()}>
          {busy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} Add by address
        </button>
      </div>

      {/* ── The library ──────────────────────────────────────────────────── */}
      {items.length === 0 ? (
        <div className="wai-empty">
          <ImageOff size={22} />
          <strong>No images yet</strong>
          <span>
            Upload the two or three you send most often — the price list and the workshop
            map are usually the first. They appear behind the 🖼 button in every WhatsApp
            conversation the moment you add them.
          </span>
        </div>
      ) : (
        <>
          <div className="wai-count">
            {active} available to advisors
            {items.length !== active && ` · ${items.length - active} switched off`}
          </div>

          <div className="wai-grid">
            {items.map(it => (
              <div key={it.id} className={`wai-card${it.is_active ? '' : ' wai-card--off'}`}>
                <div className="wai-thumb">
                  {/* No onError swap to a placeholder. A thumbnail that fails
                      to load here is the SAME failure WhatsApp will hit when
                      it tries to fetch the image, and the browser's broken
                      image is the honest signal — dressing it up as a neutral
                      icon would hide the one problem this screen can catch
                      before a customer does. */}
                  <img src={it.imagekit_url} alt="" loading="lazy" />
                </div>

                {editId === it.id ? (
                  <div className="wai-edit">
                    <input
                      value={edit.name}
                      onChange={e => setEdit(d => ({ ...d, name: e.target.value }))}
                      maxLength={120}
                      placeholder="Name"
                      autoFocus
                    />
                    <input
                      value={edit.imagekit_url}
                      onChange={e => setEdit(d => ({ ...d, imagekit_url: e.target.value }))}
                      /* Same reason as the add field: replacing an address is
                         the only thing anybody does to one, so clicking it
                         should select all of it. */
                      onFocus={e => e.target.select()}
                      maxLength={2000}
                      placeholder="https://…"
                      spellCheck={false}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } }}
                    />
                    <div className="wai-edit-acts">
                      <button className="btn btn-primary" onClick={saveEdit} disabled={busy}>
                        <Save size={13} /> Save
                      </button>
                      <button className="wai-ghost" onClick={() => setEditId(null)} disabled={busy}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="wai-name" title={it.name}>{it.name}</div>
                    <a className="wai-url" href={it.imagekit_url} target="_blank" rel="noreferrer"
                       title={it.imagekit_url}>
                      {it.imagekit_url}
                    </a>

                    <div className="wai-acts">
                      {/* The switch reads as what it does to the ADVISOR, not
                          as a database word. "Active" is a column name;
                          "advisors can send this" is the effect. */}
                      <label className="wai-sw" title={it.is_active
                        ? 'Advisors can send this'
                        : 'Hidden from the chat picker'}>
                        <input
                          type="checkbox"
                          checked={it.is_active}
                          disabled={busy}
                          onChange={() => patch(it.id, { is_active: !it.is_active },
                            it.is_active
                              ? `“${it.name}” is hidden from the chat.`
                              : `“${it.name}” is available in the chat again.`)}
                        />
                        <span />
                        <em>{it.is_active ? 'On' : 'Off'}</em>
                      </label>

                      <button className="wai-icon" onClick={() => startEdit(it)} title="Edit">
                        <Pencil size={13} />
                      </button>

                      {confirmId === it.id ? (
                        <span className="wai-confirm">
                          <button className="wai-del" onClick={() => remove(it.id)} disabled={busy}>
                            Remove
                          </button>
                          <button className="wai-icon" onClick={() => setConfirmId(null)} title="Keep">
                            <X size={13} />
                          </button>
                        </span>
                      ) : (
                        <button className="wai-icon wai-icon--danger"
                                onClick={() => setConfirmId(it.id)} title="Remove">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── The paperclip ────────────────────────────────────────────────────
          Last, because it is about the OTHER way an image reaches a customer,
          and it only makes sense once you have seen what this library holds.

          Off does not merely hide the button. The server refuses the upload
          route as well — otherwise an advisor with the old page still open, or
          anyone who knows the address, could carry on uploading, and the
          setting would be decoration. */}
      <div className={`wai-upload${allowUpload ? '' : ' wai-upload--off'}`}>
        <Paperclip size={16} />
        <div className="wai-upload-txt">
          <strong>Let advisors attach a photo from their own computer</strong>
          <em>
            {allowUpload
              ? 'The paperclip is showing in every WhatsApp chat. Advisors can send a photo of a part, a damaged panel or a job in progress — pictures that could not have been added here in advance.'
              : 'The paperclip is hidden and the upload is refused by the server. Advisors can only send images from the library above — so nothing reaches a customer that you have not approved.'}
          </em>
        </div>
        <label className="wai-sw wai-sw--big">
          <input
            type="checkbox"
            checked={allowUpload}
            disabled={uploadBusy}
            onChange={e => toggleUpload(e.target.checked)}
          />
          <span />
          <em>{uploadBusy ? 'Saving…' : allowUpload ? 'On' : 'Off'}</em>
        </label>
      </div>
    </div>
  );
}

/* The server returns rows ordered by LOWER(name); a row added or renamed
   locally has to land in the same place, or the list reshuffles on the next
   load and the row somebody just edited appears to have moved on its own. */
function byName(a, b) {
  return String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase());
}
