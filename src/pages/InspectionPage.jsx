import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
/* Staff at /job-cards/…, a hub login at /hub/job-cards/… — same component,
   two route trees. See JobCardPage for the same reasoning. */
import { useAppPaths } from '../lib/appPaths.js';
import SignaturePad from '../components/SignaturePad.jsx';
import {
  ArrowLeft, AlertCircle, CheckCircle2, ClipboardCheck, Check, Minus,
  ChevronDown, ChevronRight, Camera, X, MessageSquare, Lock, Unlock, ShieldCheck,
} from 'lucide-react';
import '../styles/InspectionPage.css';

/* ═══════════════════════════════════════════════════════════════════════════
   Running one checklist.

   EVERY LABEL ON THIS SCREEN COMES FROM THE RUN, NOT FROM THE CODE. The three
   column headings are `label_ok` / `label_attention` / `label_critical` as
   they were when the sheet was started — the 4W sheet says "Needs attention"
   and "Critical", the 2W says "Rectified" and "Not OK", and a hub can change
   either. Hardcoding "OK / Attention / Critical" here would quietly contradict
   the paper the customer is holding.

   The same goes for the option text under each button: "Not glowing", "Low",
   "Replace". Those are the words the technician actually reads, and they are
   per-point.

   A "–" on the printed sheet means that outcome is not offered for that point
   — 23 such cells on the 4W sheet. Those render as a dash here too, not as a
   button that does nothing.
   ═══════════════════════════════════════════════════════════════════════ */

const OUTCOMES = ['ok', 'attention', 'critical'];

function fmt(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

/* ───────────────────────────────────────────────────────────────────────────
   One point
   ─────────────────────────────────────────────────────────────────────── */
function PointRow({ p, labels, locked, onAnswer, onRemark, onPhoto, onDropPhoto }) {
  const [showRemark, setShowRemark] = useState(Boolean(p.remarks));
  const [photoUrl, setPhotoUrl]     = useState('');
  const [addingPhoto, setAddingPhoto] = useState(false);

  const optFor = o => p[`opt_${o}`];

  return (
    <div className={`ip-point ip-point--${p.outcome || 'blank'}`} id={`pt-${p.id}`}>
      <div className="ip-point-label">
        {p.point_label}
        {p.remarks && !showRemark && <span className="ip-remark-peek">{p.remarks}</span>}
      </div>

      <div className="ip-choices">
        {OUTCOMES.map(o => {
          const text = optFor(o);
          /* The dash. Not a disabled button — a disabled button invites a tap
             and then refuses it, which is how people conclude the app is
             broken. The paper prints nothing here, so neither do we. */
          if (!text) return <span key={o} className="ip-choice ip-choice--none" aria-hidden>–</span>;
          return (
            <button key={o} type="button" disabled={locked}
                    className={`ip-choice ip-choice--${o} ${p.outcome === o ? 'is-on' : ''}`}
                    onClick={() => onAnswer(p.id, p.outcome === o ? null : o)}>
              <span className="ip-choice-head">{labels[o]}</span>
              <span className="ip-choice-opt">{text}</span>
            </button>
          );
        })}
        {/* Always offered, on every point, including ones the sheet leaves
            blank. It is what makes "every point answered" a gate nobody can
            get trapped behind — see completeInspection in the controller. */}
        <button type="button" disabled={locked}
                className={`ip-choice ip-choice--na ${p.outcome === 'na' ? 'is-on' : ''}`}
                onClick={() => onAnswer(p.id, p.outcome === 'na' ? null : 'na')}>
          <span className="ip-choice-head"><Minus size={11} /> N/A</span>
          <span className="ip-choice-opt">Doesn't apply</span>
        </button>
      </div>

      <div className="ip-point-extras">
        {!locked && (
          <>
            <button type="button" className="ip-mini" onClick={() => setShowRemark(s => !s)}>
              <MessageSquare size={12} /> {p.remarks ? 'Remark' : 'Add remark'}
            </button>
            <button type="button" className="ip-mini" onClick={() => setAddingPhoto(s => !s)}>
              <Camera size={12} /> Photo{p.photos.length ? ` (${p.photos.length})` : ''}
            </button>
          </>
        )}
        {locked && p.photos.length > 0 && (
          <span className="ip-mini ip-mini--ro"><Camera size={12} /> {p.photos.length}</span>
        )}
      </div>

      {showRemark && !locked && (
        <input className="ip-remark" defaultValue={p.remarks || ''}
               placeholder="What exactly? (optional)"
               onBlur={e => onRemark(p.id, e.target.value.trim())} />
      )}
      {locked && p.remarks && <p className="ip-remark-ro">{p.remarks}</p>}

      {addingPhoto && !locked && (
        <form className="ip-photoadd" onSubmit={e => {
          e.preventDefault();
          if (!photoUrl.trim()) return;
          onPhoto(p.id, photoUrl.trim());
          setPhotoUrl(''); setAddingPhoto(false);
        }}>
          <input value={photoUrl} placeholder="Paste an image URL…"
                 onChange={e => setPhotoUrl(e.target.value)} />
          <button className="button secondary jc-sm" disabled={!photoUrl.trim()}>Add</button>
        </form>
      )}

      {p.photos.length > 0 && (
        <div className="ip-shots">
          {p.photos.map(m => (
            <figure key={m.id}>
              <img src={m.thumb_url || m.url} alt="" loading="lazy" />
              {!locked && <button type="button" onClick={() => onDropPhoto(m.id)}><X size={11} /></button>}
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   The page
   ─────────────────────────────────────────────────────────────────────── */
export default function InspectionPage() {
  const { appointmentId, inspectionId } = useParams();
  const navigate = useNavigate();
  const P = useAppPaths();

  const [card, setCard]       = useState(null);
  const [insp, setInsp]       = useState(null);
  const [techs, setTechs]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [toastMsg, setToast]  = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const [saving, setSaving]   = useState(false);
  const [blockers, setBlockers] = useState(null);
  const [qcOverride, setQcOverride] = useState('');

  const toast = (msg, type = 'success') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    try {
      const c = await api(`/api/job-cards/by-appointment/${appointmentId}`);
      if (!c.item) { setError('This appointment has no job card yet.'); setLoading(false); return; }
      setCard(c.item);
      const r = await api(`/api/job-cards/${c.item.id}/inspections/${inspectionId}`);
      setInsp(r.item);
      api(`/api/technicians?hub_id=${c.item.hub_id}`).then(t => setTechs(t.items || [])).catch(() => {});
      setError('');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [appointmentId, inspectionId]);

  useEffect(() => { load(); }, [load]);

  const locked = insp?.status === 'completed';

  /* ── Autosave ──────────────────────────────────────────────────────────
     Answers accumulate in a ref and go up as ONE request a beat after the
     last tap. A request per tap on a 44-point sheet, over a hub's phone
     connection, is 44 chances for an answer to land nowhere. The ref rather
     than state is deliberate: the timer must see every change, and a state
     read inside a stale closure would not. */
  const pending = useRef(new Map());
  const timer   = useRef(null);

  const flush = useCallback(async () => {
    if (!card || pending.current.size === 0) return;
    const batch = [...pending.current.values()];
    pending.current.clear();
    setSaving(true);
    try {
      const r = await api(`/api/job-cards/${card.id}/inspections/${inspectionId}/results`,
                          { method: 'PUT', body: { results: batch } });
      /* The server's copy wins: option_label is derived there from the run's
         own snapshot, and guessing it here would be a second implementation of
         the same rule waiting to disagree. */
      setInsp(r.item);
    } catch (e) { toast(e.message, 'error'); await load(); }
    finally { setSaving(false); }
  }, [card, inspectionId, load]);

  const queue = useCallback((id, patch) => {
    const prev = pending.current.get(id) || { id };
    pending.current.set(id, { ...prev, ...patch });
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  }, [flush]);

  /* A half-second of unsaved taps must not be lost to a stray back-navigation,
     so the timer is flushed on unmount as well as on its own schedule. */
  useEffect(() => () => { clearTimeout(timer.current); flush(); }, [flush]);

  function answer(id, outcome) {
    /* Painted immediately, saved a beat later. Waiting for the round trip
       before the button moves makes a 44-point sheet feel broken. */
    setInsp(s => ({ ...s, groups: s.groups.map(g => ({ ...g,
      points: g.points.map(p => p.id === id ? { ...p, outcome } : p) })) }));
    queue(id, { outcome });
  }
  function remark(id, remarks) {
    setInsp(s => ({ ...s, groups: s.groups.map(g => ({ ...g,
      points: g.points.map(p => p.id === id ? { ...p, remarks } : p) })) }));
    queue(id, { remarks });
  }

  async function addPhoto(resultId, url) {
    try {
      await api(`/api/job-cards/${card.id}/media`, {
        method: 'POST',
        body: { url, stage: insp.kind === 'intake' ? 'intake' : 'delivery', inspection_result_id: resultId },
      });
      await load();
    } catch (e) { toast(e.message, 'error'); }
  }
  async function dropPhoto(mediaId) {
    try { await api(`/api/job-cards/${card.id}/media/${mediaId}`, { method: 'DELETE' }); await load(); }
    catch (e) { toast(e.message, 'error'); }
  }

  const flat = useMemo(() => insp ? insp.groups.flatMap(g => g.points) : [], [insp]);
  const unanswered = flat.filter(p => p.outcome === null);
  const counts = useMemo(() => ({
    ok:        flat.filter(p => p.outcome === 'ok').length,
    attention: flat.filter(p => p.outcome === 'attention').length,
    critical:  flat.filter(p => p.outcome === 'critical').length,
    na:        flat.filter(p => p.outcome === 'na').length,
  }), [flat]);

  async function complete() {
    await flush();
    try {
      const r = await api(`/api/job-cards/${card.id}/inspections/${inspectionId}/complete`, { method: 'POST' });
      setInsp(r.item); setBlockers(null);
      toast('Inspection completed.');
    } catch (e) {
      /* The server counts the blanks; this screen does not re-count them. It
         shows what came back and jumps to the first one. */
      if (e.data?.unanswered) {
        setBlockers(e.data);
        const first = document.getElementById(`pt-${unanswered[0]?.id}`);
        first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else toast(e.message, 'error');
    }
  }

  async function reopen() {
    const reason = window.prompt('Why is this being reopened? It goes on the job card timeline.');
    if (!reason?.trim()) return;
    try {
      const r = await api(`/api/job-cards/${card.id}/inspections/${inspectionId}/reopen`,
                          { method: 'POST', body: { reason: reason.trim() } });
      setInsp(r.item); toast('Reopened.');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function sign(role, payload, technicianId) {
    const body = {
      ...payload, role,
      stage: insp.kind === 'intake' ? 'intake' : 'qc',
      inspection_id: insp.id,
      signed_by_technician: technicianId || null,
    };
    if (qcOverride.trim()) body.override_reason = qcOverride.trim();
    try {
      await api(`/api/job-cards/${card.id}/signatures`, { method: 'POST', body });
      setQcOverride('');
      await load();
      toast('Signed.');
    } catch (e) {
      /* The two refusals the QC rule can produce are shown in place rather
         than as a toast that vanishes — one of them needs a reason typed
         before the next attempt can succeed. */
      if (e.data?.code === 'OVERRIDE_REASON_REQUIRED' || e.data?.code === 'QC_SIGNER_IS_WORKER') {
        throw new Error(e.message);
      }
      throw e;
    }
  }

  if (loading) return <div className="ip-page"><div className="jc-empty">Loading…</div></div>;
  if (error) return (
    <div className="ip-page">
      <button className="jc-back" onClick={() => navigate(-1)}><ArrowLeft size={15} /> Back</button>
      <div className="jc-err"><AlertCircle size={13} /> {error}</div>
    </div>
  );

  const labels = { ok: insp.label_ok, attention: insp.label_attention, critical: insp.label_critical };
  const qcSig = insp.signatures.find(s => s.role === 'qc');
  const custSig = insp.signatures.find(s => s.role === 'customer');
  const techSig = insp.signatures.find(s => s.role === 'technician');

  return (
    <div className="ip-page">
      {toastMsg && (
        <div className={`jc-toast jc-toast--${toastMsg.type}`}>
          <CheckCircle2 size={14} /> {toastMsg.msg}
        </div>
      )}

      <button className="jc-back" onClick={() => navigate(`${P.jobCards}/${appointmentId}`)}>
        <ArrowLeft size={15} /> Back to job card
      </button>

      <header className="ip-hdr">
        <div>
          <h2><ClipboardCheck size={19} /> {insp.template_name}</h2>
          <div className="ip-hdr-facts">
            <span>{card.job_card_no}</span>
            <span>{card.vehicle_number}</span>
            <span>{insp.kind === 'intake' ? 'Intake inspection' : 'Pre-delivery check'}</span>
            {insp.technician_name && <span>by {insp.technician_name}</span>}
            {insp.completed_at && <span>completed {fmt(insp.completed_at)}</span>}
          </div>
        </div>
        <div className="ip-hdr-right">
          {locked
            ? <span className="ip-badge ip-badge--done"><Lock size={12} /> Completed</span>
            : <span className="ip-badge">{saving ? 'Saving…' : 'Draft — saves as you go'}</span>}
          {locked && <button className="button secondary jc-sm" onClick={reopen}><Unlock size={13} /> Reopen</button>}
        </div>
      </header>

      {/* Sticky, because on a 44-point sheet the thing you most want to know —
          how many are left — is otherwise 3,000px away. */}
      <div className="ip-progress">
        <div className="ip-bar">
          <span style={{ width: `${(insp.point_count ? (flat.length - unanswered.length) / flat.length : 0) * 100}%` }} />
        </div>
        <div className="ip-tally">
          <b>{flat.length - unanswered.length}</b> of {flat.length} answered
          {counts.ok        > 0 && <em className="is-ok">{counts.ok} {labels.ok}</em>}
          {counts.attention > 0 && <em className="is-attention">{counts.attention} {labels.attention}</em>}
          {counts.critical  > 0 && <em className="is-critical">{counts.critical} {labels.critical}</em>}
          {counts.na        > 0 && <em className="is-na">{counts.na} N/A</em>}
        </div>
      </div>

      {blockers && (
        <div className="jc-err ip-blockers">
          <AlertCircle size={13} />
          <span>
            {blockers.error} First: <b>{blockers.unanswered[0].point_label}</b> in {blockers.unanswered[0].group_name}.
          </span>
        </div>
      )}

      {insp.groups.map(g => {
        const left = g.points.filter(p => p.outcome === null).length;
        const shut = collapsed[g.name];
        return (
          <section className="ip-group" key={g.name}>
            <header onClick={() => setCollapsed(c => ({ ...c, [g.name]: !c[g.name] }))}>
              {shut ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              <strong>{g.name}</strong>
              <span className={left ? 'ip-left' : 'ip-left is-done'}>
                {left ? `${left} left` : <><Check size={12} /> done</>}
              </span>
            </header>
            {!shut && (
              <div className="ip-points">
                {g.points.map(p => (
                  <PointRow key={p.id} p={p} labels={labels} locked={locked}
                            onAnswer={answer} onRemark={remark}
                            onPhoto={addPhoto} onDropPhoto={dropPhoto} />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {/* ── Signatures ──────────────────────────────────────────────────── */}
      <section className="ip-sigs">
        <h3><ShieldCheck size={15} /> Signatures</h3>

        <div className="ip-sig-grid">
          <SignedOrPad
            existing={techSig} label="Technician" hint="Who did the work"
            techs={techs} onSign={(p, t) => sign('technician', p, t)} locked={locked} />

          {insp.kind === 'pre_delivery' ? (
            <div className="ip-qc">
              <SignedOrPad
                existing={qcSig} label="Quality check"
                hint="Must be someone other than the technician who did the work"
                techs={techs} onSign={(p, t) => sign('qc', p, t)} locked={locked} />
              {!qcSig && !locked && (
                <label className="ip-override">
                  <span>Super-admin override reason (only if the same person must sign)</span>
                  <input value={qcOverride} onChange={e => setQcOverride(e.target.value)}
                         placeholder="Why is this being overridden?" />
                </label>
              )}
            </div>
          ) : (
            <SignedOrPad
              existing={custSig} label="Customer" hint="Their own hand, on arrival"
              onSign={p => sign('customer', p)} locked={locked} />
          )}
        </div>
      </section>

      {!locked && (
        <footer className="ip-foot">
          <span>{unanswered.length ? `${unanswered.length} still unanswered` : 'Every point answered'}</span>
          <button className="button primary" onClick={complete} disabled={saving}>
            Complete inspection
          </button>
        </footer>
      )}
    </div>
  );
}

/* A signed slot, or the pad to sign it. Kept together so a signed signature
   and an empty one occupy the same place in the layout. */
function SignedOrPad({ existing, label, hint, techs, onSign, locked }) {
  const [tech, setTech] = useState('');
  const [busy, setBusy] = useState(false);

  if (existing) {
    return (
      <div className="ip-signed">
        <div className="ip-signed-hdr"><strong>{label}</strong> <Check size={13} /></div>
        {existing.image_url
          ? <img className="ip-signed-img" src={existing.image_url} alt={`${label} signature`} />
          : <div className="ip-signed-typed">{existing.signer_name}</div>}
        <div className="ip-signed-meta">
          {existing.signer_name} · {fmt(existing.signed_at)}
        </div>
        {existing.override_reason && (
          <div className="ip-signed-override">
            <AlertCircle size={12} /> Overridden: {existing.override_reason}
          </div>
        )}
      </div>
    );
  }
  if (locked) return <div className="ip-signed ip-signed--none"><strong>{label}</strong><em>not signed</em></div>;

  return (
    <div className="ip-sigslot">
      {/* Both columns open with a row of the same height — the technician
          picker on one side, a plain line on the other. Without it the two
          signature pads sit at different heights and the block reads as
          broken rather than as two slots. */}
      <div className="ip-sigslot-top">
        {techs ? (
          <select className="jc-input ip-techpick" value={tech} onChange={e => setTech(e.target.value)}>
            <option value="">Not a listed technician</option>
            {techs.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        ) : (
          <span className="ip-sigslot-note">Signed in person, on the device</span>
        )}
      </div>
      {/* Keyed on the picked technician so choosing one REMOUNTS the pad and
          its name field takes the new default. Without the key `defaultName`
          would only ever be read once, and picking a name from the dropdown
          would visibly do nothing. */}
      <SignaturePad
        key={tech || 'none'}
        label={label} hint={hint} busy={busy}
        defaultName={techs?.find(t => String(t.id) === String(tech))?.name || ''}
        onSign={async p => {
          setBusy(true);
          try { await onSign(p, tech ? Number(tech) : null); }
          finally { setBusy(false); }
        }}
      />
    </div>
  );
}
