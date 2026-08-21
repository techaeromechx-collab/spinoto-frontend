import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client.js';
// The same pager every list page uses — its size options already start at 10,
// and reusing it means this panel cannot drift from the rest of the app.
import PaginationBar from '../PaginationBar.jsx';
import WhatsAppRoutingTab from './WhatsAppRoutingTab.jsx';
// Their own files rather than two more functions at the bottom of this one.
// This module is already ~2,000 lines and holds five screens; a sixth and a
// seventh in here would mean nobody can open the file to change a label.
import WhatsAppImagesTab from './WhatsAppImagesTab.jsx';
import WhatsAppQuickRepliesTab from './WhatsAppQuickRepliesTab.jsx';
import {
  MessageCircle, Loader2, AlertTriangle, Send, Check, X, RefreshCw, Zap, Info,
  // Retiring a template, and the add-template form.
  Trash2, Plus,
  // The overview cards and the guided flows of the redesigned screen.
  CheckCheck, XCircle, Bot, Pencil, ChevronDown, Settings2,
} from 'lucide-react';
import '../../styles/WhatsAppSettings.css';

/**
 * Settings → WhatsApp.
 *
 * A REGISTRY, not an editor. Meta owns the template body; this screen owns the
 * mapping that fills it and the switches that decide when it is used. There is
 * deliberately no rich-text field anywhere — an editor here would only let staff
 * write messages Meta then refuses to send.
 *
 * ── The screen is designed around one failure mode ───────────────────────────
 *
 * Interakt has no API to read a template's definition, so the variable ORDER is
 * transcribed by hand. Position is the entire contract: variables[0] fills
 * {{1}}. A wrong order does not error — it sends the customer their registration
 * number where the date should be, forever, silently.
 *
 * No validation can catch that; both orders are just strings in an array. Only a
 * human reading a real message can. So the test send is the primary action on
 * every card, and its result renders as a numbered checklist meant to be held up
 * against the WhatsApp message that just arrived.
 */

const VAR_LABELS = {
  customer_name: 'Customer name',
  vehicle: 'Vehicle (make + model)',
  reg_number: 'Registration number',
  date: 'Date',
  time: 'Time',
  service_type: 'Service type',
  workshop_link: 'Workshop location link',
  invoice_link: 'Invoice link',
  amount: 'Amount',
  estimate_amount: 'Estimate amount',
  estimate_link: 'Estimate link',
  voucher_no: 'Receipt / voucher number',
  balance_due: 'Balance due',
  receipt_link: 'Receipt link',
};

/* Sample values, matching backend SAMPLE in whatsapp.controller.js.
   Deliberately mismatched in SHAPE — a date that cannot be read as a
   registration, a registration that cannot be read as a time. A wrong order
   then renders as visibly wrong rather than merely odd. */
const SAMPLE = {
  customer_name: 'TEST Customer', vehicle: 'TEST Hero Passion Pro',
  reg_number: 'GJ01TEST1234', date: '31 December 2026', time: '4:30 PM',
  service_type: 'TEST General Service', workshop_link: 'https://maps.google.com/?q=TEST',
  invoice_link: 'https://example.com/TEST-invoice', amount: '1234',
  estimate_amount: '4321', estimate_link: 'https://example.com/TEST-estimate',
  voucher_no: 'ADV-TEST-0001', balance_due: '567', receipt_link: 'https://example.com/TEST-receipt',
};

const ENTITY_LABELS = {
  lead: 'Lead', appointment: 'Appointment', estimate: 'Estimate',
  invoice: 'Invoice', advance: 'Advance receipt', payment: 'Payment',
};

const TEMPLATE_LABELS = {
  call_not_received: 'Call Not Received',
  appointment_created: 'Appointment Generated',
  appointment_reschedule: 'Appointment Rescheduled',
  // The live registry genuinely spells this with one 's' — it was taken from
  // the Interakt URL, where the code name is misspelled. Label both spellings
  // so neither shows as a raw key.
  appointment_reshedule: 'Appointment Rescheduled',
  pickup_received: 'Pickup Done & Received at Workshop',
  service_completed: 'Service Completed',
  invoice_ready: 'Invoice / Bill',
  estimate_approval: 'Estimate — ask for approval',
  estimate_approve: 'Estimate — confirm approval',
  advance_receipt: 'Advance Receipt',
  invoice_paid: 'Invoice Paid',
  payment_received: 'Payment Received',
};

/**
 * Templates fired from code rather than by an appointment status transition.
 *
 * The value is what the screen shows in place of the dropdown — plain English,
 * because "when does this send?" is the only question an admin has here.
 *
 * FALLBACK ONLY. The authoritative list is served by the backend
 * (`direct_fire` on GET /api/whatsapp/templates, from CODE_FIRED in
 * whatsapp.controller.js) — this local copy exists so the screen still behaves
 * during a deploy where the frontend is newer than the backend. Keeping the
 * list client-side was exactly how it went stale: estimate_approve and
 * advance_receipt were added as code-fired templates, never added here, and
 * their cards grew trigger dropdowns again — the trap migration 128 documents.
 */
const DIRECT_FIRE_FALLBACK = {
  invoice_ready: 'Spinoto approves the invoice',
  estimate_approval: 'Spinoto approves the estimate and it is sent to the customer',
  appointment_reschedule: 'an appointment’s date or time is changed',
  estimate_approve: 'the customer approves their estimate online',
  advance_receipt: 'an advance payment is recorded',
  appointment_created: 'an appointment is created',
};

export default function WhatsAppSettings() {
  const [items, setItems] = useState([]);
  const [varKeys, setVarKeys] = useState([]);
  // Which keys each record type can actually produce, from the server. The flat
  // varKeys list says what the vocabulary IS; this says what is available
  // WHERE, and it is what stops estimate_link being offered on an appointment.
  const [entityKeys, setEntityKeys] = useState({});
  const [entityTypes, setEntityTypes] = useState([]);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState({});
  const [statuses, setStatuses] = useState([]);
  const [leadStatuses, setLeadStatuses] = useState([]);
  // Which templates are fired from code, and the sentence shown instead of the
  // trigger dropdowns. Served by the backend; the fallback covers deploy skew.
  const [directFire, setDirectFire] = useState(DIRECT_FIRE_FALLBACK);
  // 'automations' (when it sends — the day-to-day tab, so it comes first)
  // vs 'templates' (what can be sent) vs 'connection' (credentials).
  const [tab, setTab] = useState('automations');
  // The "is it working?" numbers across the top. Loaded independently of the
  // template list so a stats hiccup cannot blank the configuration screen.
  const [stats, setStats] = useState(null);
  // Bumped by the header's "+ Create automation" button; the Automations tab
  // opens its modal on every change. A counter rather than a boolean so
  // pressing the button again after closing the modal re-opens it.
  const [createSignal, setCreateSignal] = useState(0);
  const [meta, setMeta] = useState({ provider_configured: false, test_number_configured: false });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  // Which template the detail pane shows. Seeded from the first row once
  // loaded — an empty pane on arrival would make the page look broken.
  const [selectedId, setSelectedId] = useState(null);

  // Keyed by template id so two cards can be busy independently.
  const [saving, setSaving] = useState({});
  // A refused save, shown INSIDE the card it belongs to. It used to land only
  // in the page-top banner — off screen from the control that was clicked, so
  // a refusal read as "nothing happened" and got clicked eighteen more times.
  const [cardErr, setCardErr] = useState({});
  const [testing, setTesting] = useState({});
  const [testResult, setTestResult] = useState({});
  const [testTo, setTestTo] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api('/api/whatsapp/templates');
      setItems(r.items || []);
      // Only on first load, or if the selection has vanished — a Reload must
      // not throw the user back to the first template while they are working
      // on the fourth.
      setSelectedId(prev =>
        (prev && (r.items || []).some(t => t.id === prev)) ? prev : (r.items?.[0]?.id ?? null)
      );
      setVarKeys(r.variable_keys || []);
      setEntityKeys(r.entity_variable_keys || {});
      setEntityTypes(r.entity_types || []);
      setStatuses(r.statuses || []);
      setLeadStatuses(r.lead_statuses || []);
      setDirectFire(r.direct_fire || DIRECT_FIRE_FALLBACK);
      setMeta({
        provider_configured: !!r.provider_configured,
        test_number_configured: !!r.test_number_configured,
      });
    } catch (e) {
      setErr(e.message || 'Could not load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const r = await api('/api/whatsapp/stats');
      setStats(r);
    } catch {
      // Cards simply don't render; the configuration below must not care.
      setStats(null);
    }
  }, []);

  useEffect(() => { load(); loadStats(); }, [load, loadStats]);

  async function patch(id, body) {
    setSaving(s => ({ ...s, [id]: true }));
    try {
      const r = await api(`/api/whatsapp/templates/${id}`, { method: 'PATCH', body });
      setItems(list => list.map(t => (t.id === id ? r.item : t)));
      setCardErr(s => ({ ...s, [id]: null }));
    } catch (e) {
      // Into the CARD, beside what was clicked — not the page-top banner.
      setCardErr(s => ({ ...s, [id]: e.message || 'Could not save' }));
    } finally {
      setSaving(s => ({ ...s, [id]: false }));
    }
  }

  async function runTest(id) {
    setTesting(s => ({ ...s, [id]: true }));
    setTestResult(s => ({ ...s, [id]: null }));
    try {
      const r = await api(`/api/whatsapp/templates/${id}/test`, {
        method: 'POST',
        body: testTo[id] ? { to: testTo[id] } : {},
      });
      setTestResult(s => ({ ...s, [id]: r }));
    } catch (e) {
      setTestResult(s => ({ ...s, [id]: { ok: false, error: e.message || 'Test failed' } }));
    } finally {
      setTesting(s => ({ ...s, [id]: false }));
    }
  }

  /* Keys a template may use, given the records it is offered on.
     INTERSECTION, mirroring keysFor() on the server: a template on lead AND
     appointment must render from either, so it may only use what both supply.
     Offering the union here would let someone build a mapping the server then
     refuses — the form would be lying about what is possible. */
  function keysFor(ents) {
    const list = (ents || []).filter(e => entityKeys[e]);
    if (!list.length) return [];
    return list.map(e => entityKeys[e]).reduce((a, b) => a.filter(k => b.includes(k)));
  }

  /* Would this set of record types orphan a variable the template already
     uses? Mirrors variablesNotAllowed on the server — so a chip the server
     would refuse with a 422 is disabled here WITH THE REASON, instead of
     letting the click fail invisibly. (Ticking Appointment on the invoice
     template is the canonical case: an appointment has no invoice link.) */
  function entChangeProblem(t, nextEnts) {
    const allowed = keysFor(nextEnts);
    if (!nextEnts.length || !allowed.length) return null; // same rule as the server
    const used = [...new Set([...(t.variables || []), ...(t.header_variables || [])])];
    const bad = used.filter(k => !allowed.includes(k));
    if (!bad.length) return null;
    const badLabels = bad.map(k => VAR_LABELS[k] || k).join(', ');
    const entLabels = nextEnts.map(e => ENTITY_LABELS[e] || e).join(' + ');
    return `This template uses ${badLabels}, which ${entLabels} records can’t all provide — remove that variable from the order first.`;
  }

  /* The body with this mapping filled in, as HTML-free segments.
     Reading THIS is how a wrong order is caught before a customer sees it —
     the test send proves the plumbing, this shows the meaning. */
  function renderBody(body, vars) {
    // [^{}]+, not [\w ]+ — the approved bodies contain placeholders like
    // {{vehicle Brand & mode}}, and the '&' made the old pattern skip the
    // slot entirely: it rendered as literal text, the count under-reported,
    // and the mismatch warning fired on a correct mapping.
    const parts = String(body || '').split(/(\{\{[^{}]+\}\})/g);
    let n = 0;
    return parts.map((seg, i) => {
      if (!/^\{\{/.test(seg)) return { t: 'text', v: seg, i };
      const k = (vars || [])[n++];
      return k
        ? { t: 'val', v: SAMPLE[k] ?? `TEST_${k}`, k, i }
        : { t: 'gap', v: `nothing mapped for slot ${n}`, i };
    });
  }
  const slotCount = body =>
    (String(body || '').match(/\{\{[^{}]+\}\}/g) || []).length;

  async function create(body) {
    setCreating(true);
    try {
      const r = await api('/api/whatsapp/templates', { method: 'POST', body });
      setItems(list => [...list, r.item]);
      setSelectedId(r.item.id);
      setAdding(false);
      setErr(null);
      return true;
    } catch (e) {
      setErr(e.message || 'Could not add the template');
      return false;
    } finally {
      setCreating(false);
    }
  }

  async function remove(t) {
    // The server hard-deletes a template that never sent and retires one that
    // did. The confirm says which, because "delete" and "hide from this screen
    // but keep for the message log" are different promises.
    const msg = `Retire ${TEMPLATE_LABELS[t.template_key] || t.template_key}?\n\n`
      + 'If it has never sent a message it is deleted outright. If it has, it is kept '
      + 'so the message history can still say what was sent.';
    if (!window.confirm(msg)) return;
    setRemoving(s => ({ ...s, [t.id]: true }));
    try {
      await api(`/api/whatsapp/templates/${t.id}`, { method: 'DELETE' });
      setItems(list => list.filter(x => x.id !== t.id));
      setSelectedId(prev => (prev === t.id ? null : prev));
      setErr(null);
    } catch (e) {
      setErr(e.message || 'Could not retire the template');
    } finally {
      setRemoving(s => ({ ...s, [t.id]: false }));
    }
  }

  /** The list IS the mapping — its order is the data, not a display choice. */
  function moveVar(t, index, delta) {
    const next = [...(t.variables || [])];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    patch(t.id, { variables: next });
  }

  if (loading) {
    return <div className="wa-empty"><Loader2 size={15} className="spin" /> Loading templates…</div>;
  }

  return (
    <div className="wa-page">
      <div className="wa-head">
        <div className="wa-head-row">
          <h2><MessageCircle size={20} /> WhatsApp</h2>
          {/* Beside the title rather than buried in a tab: creating a rule is
              THE action this page exists for. It jumps to the Automations tab
              and opens the form as a modal. */}
          <button
            className="wa-btn wa-btn--primary"
            onClick={() => { setTab('automations'); setCreateSignal(s => s + 1); }}
          >
            <Plus size={13} /> Create automation
          </button>
        </div>
        <p>
          Templates are created and approved in Interakt — this page maps your CRM
          data onto them and controls when they send. To change what a message
          says, edit it in Interakt; Meta has to re-approve it either way.
        </p>
      </div>

      {!meta.provider_configured && (
        <div className="wa-banner wa-banner--warn">
          <AlertTriangle size={15} />
          <div>
            <strong>No API key configured.</strong> Add your Interakt API key in the
            {' '}<strong>Connection</strong> tab (or set <code>INTERAKT_API_KEY</code> in
            the backend environment). Until then nothing sends — messages queue and
            report as failed rather than disappearing silently.
          </div>
        </div>
      )}

      {err && (
        <div className="wa-banner wa-banner--error">
          <AlertTriangle size={15} /><div>{err}</div>
        </div>
      )}

      {/* The page opens with "is it working?" rather than configuration —
          today's traffic and its delivery ladder, straight off wa_messages. */}
      {stats && <StatsRow stats={stats} />}

      {/* Six questions, six tabs: WHEN does it send (the day-to-day one, so it
          comes first), WHAT can be sent automatically, what an advisor can
          send BY HAND — the two library tabs — WHO receives what comes back,
          and IS IT CONNECTED.

          The libraries sit next to Templates because both answer "what may
          leave this number", and apart from it because a template is approved
          by Meta and these are not — putting a library inside the Templates
          tab would be the fastest way to have somebody expect Meta approval
          for a price list. */}
      <div className="wa-tabs">
        <button
          className={`wa-tab ${tab === 'automations' ? 'wa-tab--active' : ''}`}
          onClick={() => setTab('automations')}
        >Automations</button>
        <button
          className={`wa-tab ${tab === 'templates' ? 'wa-tab--active' : ''}`}
          onClick={() => setTab('templates')}
        >Templates</button>
        <button
          className={`wa-tab ${tab === 'images' ? 'wa-tab--active' : ''}`}
          onClick={() => setTab('images')}
        >Image Library</button>
        <button
          className={`wa-tab ${tab === 'quick' ? 'wa-tab--active' : ''}`}
          onClick={() => setTab('quick')}
        >Quick Replies</button>
        <button
          className={`wa-tab ${tab === 'routing' ? 'wa-tab--active' : ''}`}
          onClick={() => setTab('routing')}
        >Routing</button>
        <button
          className={`wa-tab ${tab === 'connection' ? 'wa-tab--active' : ''}`}
          onClick={() => setTab('connection')}
        >Connection</button>
      </div>

      {/* onChanged reloads the template list, whose provider_configured flag
          drives the no-key banner — saving a key must clear it immediately. */}
      {tab === 'connection' && <ConnectionTab onChanged={load} />}

      {/* WHO receives an inbound lead. A fourth question alongside the three
          above, and the only one that is about people rather than messages. */}
      {tab === 'routing' && <WhatsAppRoutingTab />}

      {/* WHAT an advisor may send by hand. Both mounted only while their tab
          is open, so neither fetches on a screen somebody opened to change an
          automation. */}
      {tab === 'images' && <WhatsAppImagesTab />}
      {tab === 'quick'  && <WhatsAppQuickRepliesTab />}

      {tab === 'automations' && <AutomationsTab onChanged={loadStats} createSignal={createSignal} />}

      {tab === 'templates' && (<>

        <div className="wa-banner wa-banner--info">
          <Info size={15} />
          <div>
            <strong>Send a test before switching auto-send on.</strong> Interakt cannot
            tell us the order of variables in an approved template, so the order below
            was typed in by hand. If it is wrong nothing will error — the customer
            simply receives the wrong value in each slot. The test message is the only
            way to catch it.
          </div>
        </div>

        <div className="wa-split">
          {/* Rail — every template's state at once, which is what someone opening
            this page usually came to check. */}
          <div className="wa-rail">
            <div className="wa-rail-hd">
              Templates
              <span className="wa-rail-count">
                {items.filter(t => t.is_enabled).length}/{items.length} on
              </span>
            </div>
            <div className="wa-rail-list">
              {items.map(t => {
                const live = t.is_enabled && t.auto_send;
                return (
                  <button
                    key={t.id}
                    className={`wa-list-item ${t.id === selectedId ? 'wa-list-item--active' : ''}`}
                    onClick={() => setSelectedId(t.id)}
                  >
                    <div className="wa-list-name">
                      {TEMPLATE_LABELS[t.template_key] || t.template_key}
                    </div>
                    <div className="wa-list-state">
                      <span className={`wa-dot ${live ? 'wa-dot--live' : t.is_enabled ? 'wa-dot--manual' : 'wa-dot--off'
                        }`} />
                      <span>{live ? 'Auto' : t.is_enabled ? 'Manual only' : 'Off'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail */}
          <div>
            {items.filter(t => t.id === selectedId).map(t => {
              const busy = saving[t.id];
              const res = testResult[t.id];
              const live = t.is_enabled && t.auto_send;

              return (
                <div
                  key={t.id}
                  className={`wa-card ${live ? 'wa-card--live' : ''} ${!t.is_enabled ? 'wa-card--off' : ''}`}
                >
                  <div className="wa-card-top">
                    <div style={{ minWidth: 0 }}>
                      <div className="wa-card-title">
                        {TEMPLATE_LABELS[t.template_key] || t.template_key}
                        {/* One chip that answers "what state is this in?" without
                      reading two toggles. The Interakt code name and language
                      moved under Advanced mapping — day to day nobody needs
                      them, and two bare inputs at the top of every card made
                      the screen read as an engineer's form. */}
                        <span className={`wa-chip ${live ? 'wa-chip--live' : t.is_enabled ? 'wa-chip--manual' : 'wa-chip--off'
                          }`}>
                          {live ? 'Auto' : t.is_enabled ? 'Manual only' : 'Off'}
                        </span>
                      </div>

                      {/* Templates fired from code show WHEN, not a dropdown.
                    Picking a status for one of these is how two of them were
                    silently broken: the control looked like unfinished
                    configuration, someone filled it in, and the template
                    reported "Auto" while never sending a single message.

                    A status trigger always loads the APPOINTMENT context, so a
                    template needing an estimate's amount or an invoice's link
                    fails the dispatcher's missing-variable check on every fire —
                    and one that has no status transition to hang on, like a
                    reschedule, is simply never called. Neither failure is
                    visible from this screen, which is why the choice is removed
                    rather than merely discouraged. */}
                      {directFire[t.template_key] && (
                        <div className="wa-meta">
                          <span className="wa-meta-label">Fires when</span>
                          <span className="wa-fires-when">{directFire[t.template_key]}</span>
                        </div>
                      )}

                      {/* WHEN a template fires is no longer configured on the card.
                    The old trigger dropdowns wrote two single-value columns —
                    one status per template, one template per moment — and the
                    Automations tab (wa_automations, migration 151) replaced
                    both. Point admins there instead of offering a control
                    that no longer does anything. */}
                      {!directFire[t.template_key] && (
                        <div className="wa-meta">
                          <span className="wa-meta-label">Fires when</span>
                          <span className="wa-fires-when">
                            {t.supports_auto
                              ? 'configured in the Automations tab'
                              : 'nothing yet — add an automation to send this automatically'}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="wa-toggles">
                      {/* Enabling requires a test that passed for THIS mapping.
                    The server refuses it either way (whatsapp.controller.js);
                    disabling the control is so the refusal is visible before
                    the click rather than after it. Switching OFF is never
                    gated — you must always be able to stop a template. */}
                      <label
                        className={`wa-toggle ${t.is_enabled ? 'wa-toggle--on' : ''} ${(busy || (!t.is_enabled && !t.last_tested_at)) ? 'wa-toggle--disabled' : ''}`}
                        title={t.last_tested_at ? '' : 'Send a test to your own number first — a mapping in the wrong order sends cleanly to a real customer.'}
                      >
                        <input
                          type="checkbox" checked={!!t.is_enabled}
                          disabled={busy || (!t.is_enabled && !t.last_tested_at)}
                          onChange={e => patch(t.id, { is_enabled: e.target.checked })}
                        />
                        Enabled
                      </label>
                      {/* Disabled rather than hidden when there is no trigger: a
                    missing control invites "where is the auto option?", a
                    disabled one with a reason answers it. */}
                      <label
                        className={`wa-toggle wa-toggle--auto ${t.auto_send ? 'wa-toggle--on' : ''} ${(busy || !t.supports_auto) ? 'wa-toggle--disabled' : ''}`}
                        title={t.supports_auto ? '' : 'This template has no automatic trigger — it can only be sent by hand.'}
                      >
                        <input
                          type="checkbox" checked={!!t.auto_send} disabled={busy || !t.supports_auto}
                          onChange={e => patch(t.id, { auto_send: e.target.checked })}
                        />
                        <Zap size={11} /> Auto-send
                      </label>
                    </div>
                  </div>

                  {/* A refused save, beside what was clicked. */}
                  {cardErr[t.id] && (
                    <div className="wa-banner wa-banner--error wa-banner--inline" style={{ margin: '0 16px 12px' }}>
                      <AlertTriangle size={13} /><div>{cardErr[t.id]}</div>
                    </div>
                  )}

                  {/* ── What this mapping will actually send ──
                First thing after the header, because it is the one part of the
                card written in the customer's language. The test send proves
                the plumbing; this shows the MEANING, and it updates the
                instant a variable moves. */}
                  {t.body_preview && (
                    <div className="wa-preview">
                      <div className="wa-rendered">
                        {renderBody(t.body_preview, t.variables).map(seg =>
                          seg.t === 'text' ? <span key={seg.i}>{seg.v}</span>
                            : seg.t === 'val' ? <b key={seg.i} title={VAR_LABELS[seg.k] || seg.k}>{seg.v}</b>
                              : <i key={seg.i} className="wa-gap">{seg.v}</i>
                        )}
                      </div>
                      {slotCount(t.body_preview) !== (t.variables || []).length && (
                        <div className="wa-mismatch">
                          Body has {slotCount(t.body_preview)} slot{slotCount(t.body_preview) === 1 ? '' : 's'},
                          {' '}{(t.variables || []).length} mapped — Interakt rejects a count mismatch outright.
                        </div>
                      )}
                      <div className="wa-preview-note">
                        Sample values, in the order this mapping sends them. The approved text in
                        Interakt is what actually sends — this copy goes stale the moment it is
                        edited there.
                      </div>
                    </div>
                  )}

                  {/* ── The guided path from "registered" to "sending" ──
                For a template that is OFF, the next action is always the same
                two steps, so the card says them instead of leaving an admin to
                deduce the rule from a disabled toggle's tooltip. Once enabled,
                the strip disappears and re-testing lives under Advanced. */}
                  {!t.is_enabled && (
                    <div className="wa-guide">
                      <div className="wa-guide-step">
                        <span className={`wa-guide-num ${t.last_tested_at ? 'wa-guide-num--done' : ''}`}>
                          {t.last_tested_at ? <Check size={12} /> : '1'}
                        </span>
                        <div className="wa-guide-text">
                          <strong>Send a test to your own phone.</strong>
                          <div className="wa-guide-sub">
                            Interakt can’t tell us the variable order, so a human reading a real
                            message is the only check that exists.
                          </div>
                        </div>
                      </div>
                      <div className="wa-test wa-test--guide">
                        <input
                          className="wa-input"
                          style={{ width: 160, fontSize: 13, padding: '7px 10px' }}
                          placeholder={meta.test_number_configured ? 'Default test number' : '10-digit mobile'}
                          value={testTo[t.id] || ''}
                          onChange={e => setTestTo(s => ({ ...s, [t.id]: e.target.value }))}
                        />
                        <button
                          className="wa-btn wa-btn--primary"
                          onClick={() => runTest(t.id)}
                          disabled={testing[t.id] || !meta.provider_configured}
                          title={meta.provider_configured ? '' : 'Add the API key in the Connection tab first.'}
                        >
                          {testing[t.id] ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
                          Send test
                        </button>
                      </div>
                      {res && (
                        <div className={`wa-result ${res.ok ? 'wa-result--ok' : 'wa-result--bad'}`}>
                          {res.ok ? (
                            <>
                              <div className="wa-result-h"><Check size={14} /> Sent to {res.sent_to}</div>
                              <div className="wa-result-hint">
                                Check each position against the message you received:
                              </div>
                              <div className="wa-check">
                                {(res.sent_values || []).map(v => (
                                  <div className="wa-check-row" key={v.position}>
                                    <span className="wa-check-pos">{`{{${v.position}}}`}</span>
                                    <span className="wa-check-key">{VAR_LABELS[v.key] || v.key}</span>
                                    <span className="wa-check-val">{v.value}</span>
                                  </div>
                                ))}
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="wa-result-h"><AlertTriangle size={14} /> {res.error_code || 'Failed'}</div>
                              <div style={{ marginTop: 4 }}>{res.error}</div>
                            </>
                          )}
                        </div>
                      )}
                      <div className="wa-guide-step">
                        <span className="wa-guide-num">2</span>
                        <div className="wa-guide-text">
                          <strong>Looks right? Switch <em>Enabled</em> on above.</strong>
                          <div className="wa-guide-sub">
                            {t.last_tested_at
                              ? 'The test passed — the toggle is unlocked.'
                              : 'The toggle stays locked until a test has been sent for this exact mapping.'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Advanced mapping ──
                The engineer's half of the card, folded away: the Interakt code
                name, the language, which records offer it, and the positional
                variable order. Day to day nobody opens this — which is the
                point. It is exactly where you go when a test send looks wrong. */}
                  <details className="wa-adv">
                    <summary>
                      <Settings2 size={13} /> Advanced mapping
                      <ChevronDown size={13} className="wa-adv-chev" />
                    </summary>
                    <div className="wa-adv-body">

                      <div className="wa-section">
                        <div className="wa-section-h">Interakt template</div>
                        <div className="wa-meta">
                          {/* Editable, not display-only. A code name is read by eye off
                    an Interakt URL, so it is the field most likely to be
                    wrong — and needing a migration to fix a typo would be
                    absurd. Saves on blur. */}
                          <input
                            className="wa-input wa-input--code"
                            defaultValue={t.provider_template_name}
                            disabled={busy}
                            title="Interakt code name — the part of app.interakt.ai/template/<name>/view between template/ and /view. Trailing underscores are part of the name."
                            onBlur={e => {
                              const v = e.target.value.trim();
                              if (v && v !== t.provider_template_name) patch(t.id, { provider_template_name: v });
                            }}
                          />
                          <input
                            className="wa-input wa-input--lang"
                            defaultValue={t.language_code}
                            disabled={busy}
                            title="'en' and 'en_US' are different templates to Meta, not variants of one."
                            onBlur={e => {
                              const v = e.target.value.trim();
                              if (v && v !== t.language_code) patch(t.id, { language_code: v });
                            }}
                          />
                        </div>
                        <div className="wa-preview-note" style={{ marginTop: 4 }}>
                          The exact code name from app.interakt.ai — trailing underscores are part
                          of it. Editing either field switches the template off until it is re-tested.
                        </div>
                      </div>

                      {/* ── Which records may send it ──
                Drives the dropdown on the Estimate / Appointment / Lead screens
                (wa_templates.entity_types, migration 147) AND filters the
                variables below. */}
                      <div className="wa-section">
                        <div className="wa-section-h">Shows on</div>
                        <div className="wa-ents">
                          {entityTypes.map(e => {
                            const on = (t.entity_types || []).includes(e);
                            const next = on
                              ? (t.entity_types || []).filter(x => x !== e)
                              : [...(t.entity_types || []), e];
                            // Pre-check what the server would refuse: a chip that would
                            // orphan a mapped variable is disabled with the reason,
                            // rather than 422ing after the click.
                            const problem = entChangeProblem(t, next);
                            return (
                              <button
                                key={e}
                                type="button"
                                className={`wa-ent ${on ? 'wa-ent--on' : ''} ${problem ? 'wa-ent--blocked' : ''}`}
                                disabled={busy || !!problem}
                                title={problem || ''}
                                onClick={() => patch(t.id, { entity_types: next })}
                              >{ENTITY_LABELS[e] || e}</button>
                            );
                          })}
                        </div>
                        {(t.entity_types || []).length === 0 && (
                          <div className="wa-preview-note" style={{ marginTop: 6 }}>
                            Mapped to nothing — this template is offered on no record at all.
                          </div>
                        )}
                      </div>

                      <div className="wa-section">
                        <div className="wa-section-h">Variable order</div>
                        {/* Wrapped so the list can be capped. Each row holds a position
                  marker, a short label and three buttons; left to fill a
                  desktop-width card the marker and the controls that move it
                  ended up a thousand pixels apart. */}
                        <div className="wa-varlist">
                          {(t.variables || []).length === 0 && (
                            <div style={{ fontSize: 13, color: '#9ca3af', padding: '4px 9px' }}>
                              No variables.
                            </div>
                          )}
                          {(t.variables || []).map((k, i) => (
                            <div className="wa-var" key={`${k}-${i}`}>
                              <span className="wa-var-pos">{`{{${i + 1}}}`}</span>
                              <span className="wa-var-name">{VAR_LABELS[k] || k}</span>
                              <span className="wa-var-actions">
                                <button className="wa-mini" disabled={busy || i === 0}
                                  onClick={() => moveVar(t, i, -1)} title="Move up">↑</button>
                                <button className="wa-mini" disabled={busy || i === t.variables.length - 1}
                                  onClick={() => moveVar(t, i, 1)} title="Move down">↓</button>
                                <button className="wa-mini wa-mini--danger" disabled={busy}
                                  onClick={() => patch(t.id, { variables: t.variables.filter((_, j) => j !== i) })}
                                  title="Remove"><X size={12} /></button>
                              </span>
                            </div>
                          ))}
                          <select
                            className="wa-select" value="" disabled={busy}
                            style={{ marginTop: 8 }}
                            onChange={e => {
                              if (e.target.value) patch(t.id, { variables: [...(t.variables || []), e.target.value] });
                              e.target.value = '';
                            }}
                          >
                            <option value="">+ Add variable…</option>
                            {/* Only what these records can produce. Offering the full
                    vocabulary let someone pick estimate_link on an appointment
                    template — valid to save, then missing_variable on every
                    send, on a template that looks correctly configured. */}
                            {(keysFor(t.entity_types).length ? keysFor(t.entity_types) : varKeys)
                              .filter(k => !(t.variables || []).includes(k))
                              .map(k => <option key={k} value={k}>{VAR_LABELS[k] || k}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Re-testing an ENABLED template lives down here — its result
                included. (For a disabled one the whole flow is the guided
                strip above.) */}
                      {t.is_enabled && (
                        <>
                          <div className="wa-test wa-test--adv">
                            <input
                              className="wa-input"
                              style={{ width: 160, fontSize: 13, padding: '7px 10px' }}
                              placeholder={meta.test_number_configured ? 'Default test number' : '10-digit mobile'}
                              value={testTo[t.id] || ''}
                              onChange={e => setTestTo(s => ({ ...s, [t.id]: e.target.value }))}
                            />
                            <button
                              className="wa-btn"
                              onClick={() => runTest(t.id)}
                              disabled={testing[t.id] || !meta.provider_configured}
                            >
                              {testing[t.id] ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
                              Send test
                            </button>
                          </div>
                          {res && (
                            <div className={`wa-result ${res.ok ? 'wa-result--ok' : 'wa-result--bad'}`}>
                              {res.ok ? (
                                <>
                                  <div className="wa-result-h"><Check size={14} /> Sent to {res.sent_to}</div>
                                  <div className="wa-result-hint">
                                    Check each position against the message you received:
                                  </div>
                                  <div className="wa-check">
                                    {(res.sent_values || []).map(v => (
                                      <div className="wa-check-row" key={v.position}>
                                        <span className="wa-check-pos">{`{{${v.position}}}`}</span>
                                        <span className="wa-check-key">{VAR_LABELS[v.key] || v.key}</span>
                                        <span className="wa-check-val">{v.value}</span>
                                      </div>
                                    ))}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="wa-result-h"><AlertTriangle size={14} /> {res.error_code || 'Failed'}</div>
                                  <div style={{ marginTop: 4 }}>{res.error}</div>
                                </>
                              )}
                            </div>
                          )}
                        </>
                      )}

                      {/* Last, and set apart. Retiring is the one action here that
                cannot be undone from this screen. */}
                      <div className="wa-test">
                        <button
                          className="wa-btn wa-btn--danger"
                          style={{ marginLeft: 'auto' }}
                          disabled={busy || removing[t.id] || t.is_enabled}
                          title={t.is_enabled ? 'Switch it off before retiring it.' : 'Retire this template'}
                          onClick={() => remove(t)}
                        >
                          {removing[t.id] ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                          Retire
                        </button>
                      </div>

                    </div>
                  </details>
                </div>
              );
            })}

          </div>
        </div>

        {/* Outside the split box — a page-level action, not part of the detail. */}
        {/* wa-actions, not wa-foot: .wa-foot::before prints "Verify the order",
          which is right above the test-send row it was written for and
          nonsense above Reload. */}
        <div className="wa-actions" style={{ marginTop: 12 }}>
          <button className="wa-btn wa-btn--ghost" onClick={load}>
            <RefreshCw size={13} /> Reload
          </button>
          <button className="wa-btn wa-btn--primary" onClick={() => setAdding(true)}>
            <Plus size={13} /> Add template
          </button>
        </div>

        {adding && (
          <AddTemplateForm
            entityTypes={entityTypes}
            statuses={statuses}
            leadStatuses={leadStatuses}
            keysFor={keysFor}
            renderBody={renderBody}
            slotCount={slotCount}
            busy={creating}
            onCancel={() => setAdding(false)}
            onCreate={create}
          />
        )}

      </>)}
    </div>
  );
}


/**
 * Register an already-approved Interakt template.
 *
 * It does NOT create a template. Meta owns the wording and the approval, and no
 * API on this side can shortcut that — you build the template in Interakt, wait
 * for approval, then tell Spinoto it exists. What this writes is the pointer.
 *
 * Everything here is off by default and stays that way: the created row arrives
 * disabled, and the server will not enable it until a test send has passed for
 * that exact mapping.
 */
function AddTemplateForm({ entityTypes, statuses, leadStatuses, keysFor, renderBody, slotCount, busy, onCancel, onCreate }) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [code, setCode] = useState('');
  const [lang, setLang] = useState('en');
  const [ents, setEnts] = useState([]);
  const [body, setBody] = useState('');
  const [vars, setVars] = useState([]);

  const allowed = keysFor(ents);
  const slots = slotCount(body);

  /* The code name comes out of the URL rather than being typed.
     That string is what the send API matches on — a typo is a 404 at send time,
     on a real customer's message — and trailing underscores are real:
     'appointment_reshedule' in this registry is genuinely spelled with one 's'
     because that is what Interakt's URL says. */
  function takeUrl(v) {
    setUrl(v);
    const m = String(v).match(/template\/([^/?#]+)\/view/);
    if (!m) return;
    setCode(m[1]);
    if (!key) setKey(m[1].replace(/[^a-z0-9_]/gi, '_').replace(/_+$/, '').toLowerCase());
  }

  function toggleEnt(e) {
    const next = ents.includes(e) ? ents.filter(x => x !== e) : [...ents, e];
    setEnts(next);
    // Narrowing the records can orphan a key that was fine a moment ago. Drop
    // it here rather than letting the server refuse the save with an error
    // about a choice the form allowed.
    setVars(v => v.filter(k => keysFor(next).includes(k)));
  }

  function move(i, d) {
    const next = [...vars];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setVars(next);
  }

  const canSave = key && code && ents.length && !busy;

  return (
    <div className="wa-add">
      <div className="wa-add-h">
        <strong>Add an approved template</strong>
        <button className="wa-mini" onClick={onCancel} title="Cancel"><X size={13} /></button>
      </div>

      <div className="wa-banner wa-banner--info" style={{ margin: '0 0 14px' }}>
        <Info size={15} />
        <div>
          This registers a template that already exists and is <strong>approved in
            Interakt</strong>. It does not create one.
        </div>
      </div>

      <div className="wa-add-grid">
        <label className="wa-fld">
          <span>Paste the Interakt URL</span>
          <input className="wa-input" value={url} onChange={e => takeUrl(e.target.value)}
            placeholder="https://app.interakt.ai/template/estimate_approve_/view" />
          <em>The code name is pulled out of the URL so it cannot be mistyped.</em>
        </label>
        <label className="wa-fld">
          <span>Interakt code name</span>
          <input className="wa-input wa-mono" value={code} onChange={e => setCode(e.target.value)}
            placeholder="estimate_approve_" />
          <em>Trailing underscores are real. This must match Interakt exactly.</em>
        </label>
        <label className="wa-fld">
          <span>Key used in code</span>
          <input className="wa-input wa-mono" value={key}
            onChange={e => setKey(e.target.value.toLowerCase())} placeholder="estimate_approve" />
          <em>Lower-case, letters digits underscores. Cannot be changed later.</em>
        </label>
        <label className="wa-fld">
          <span>Language</span>
          <select className="wa-select" value={lang} onChange={e => setLang(e.target.value)}>
            <option value="en">en</option>
            <option value="en_US">en_US</option>
            <option value="hi">hi</option>
            <option value="gu">gu</option>
          </select>
          <em>en and en_US are different templates to Meta, not variants of one.</em>
        </label>
      </div>

      <div className="wa-fld">
        <span>Which records can send it</span>
        <div className="wa-ents">
          {entityTypes.map(e => (
            <button key={e} type="button"
              className={`wa-ent ${ents.includes(e) ? 'wa-ent--on' : ''}`}
              onClick={() => toggleEnt(e)}>{ENTITY_LABELS[e] || e}</button>
          ))}
        </div>
        <em>Decides which dropdown it appears in, and which variables are offered below.</em>
      </div>

      {/* WHEN it sends is not picked here any more — that is an Automations
          row now (the Automations tab), created once the template exists.
          The template arrives manual-only either way, so nothing is lost by
          the second step, and the automation form can then validate the
          pairing against the saved template. */}

      <div className="wa-fld">
        <span>Body, pasted from Interakt</span>
        <textarea className="wa-input wa-textarea" value={body} rows={3}
          onChange={e => setBody(e.target.value)}
          placeholder="Hi {{customer_name}}, thank you for approving your estimate for {{vehicle}}." />
        <em>Stored for reference only, never parsed.</em>
      </div>

      <div className="wa-fld">
        <span>Variables, in the order Meta sends them</span>
        <div className="wa-varlist">
          {vars.length === 0 && (
            <div style={{ fontSize: 13, color: '#9ca3af', padding: '4px 9px' }}>
              Nothing mapped yet.
            </div>
          )}
          {vars.map((k, i) => (
            <div className="wa-var" key={`${k}-${i}`}>
              <span className="wa-var-pos">{`{{${i + 1}}}`}</span>
              <span className="wa-var-name">{VAR_LABELS[k] || k}</span>
              <span className="wa-var-actions">
                <button className="wa-mini" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button className="wa-mini" disabled={i === vars.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button className="wa-mini wa-mini--danger"
                  onClick={() => setVars(v => v.filter((_, j) => j !== i))}><X size={12} /></button>
              </span>
            </div>
          ))}
          {/* Read e.target.value into a local BEFORE resetting the select.
              setVars takes a functional updater, which React runs during a
              later render — by then `e.target.value = ''` has already executed
              and the closure reads the blank. Six selections produced six empty
              strings, which the server then correctly refused with "Invalid
              enum value … received ''".

              The edit card above does not have this bug: it builds the array
              synchronously and passes it to patch(), so the value is read
              before the reset. */}
          <select className="wa-select" value="" style={{ marginTop: 8 }}
            onChange={e => {
              const picked = e.target.value;
              e.target.value = '';
              if (picked) setVars(v => [...v, picked]);
            }}>
            <option value="">+ Add variable…</option>
            {allowed.filter(k => !vars.includes(k))
              .map(k => <option key={k} value={k}>{VAR_LABELS[k] || k}</option>)}
          </select>
        </div>
        <em>
          {ents.length === 0
            ? 'Pick a record type above to see which variables it can supply.'
            : ents.length > 1
              ? 'Two record types, so only the variables BOTH can supply are offered.'
              : 'Only what this record type can actually produce.'}
        </em>
      </div>

      {body && (
        <div className="wa-preview" style={{ margin: '0 0 14px' }}>
          <div className="wa-rendered">
            {renderBody(body, vars).map(seg =>
              seg.t === 'text' ? <span key={seg.i}>{seg.v}</span>
                : seg.t === 'val' ? <b key={seg.i}>{seg.v}</b>
                  : <i key={seg.i} className="wa-gap">{seg.v}</i>
            )}
          </div>
          {slots !== vars.length && (
            <div className="wa-mismatch">
              Body has {slots} slot{slots === 1 ? '' : 's'}, {vars.length} mapped —
              Interakt rejects a count mismatch outright.
            </div>
          )}
        </div>
      )}

      <div className="wa-banner wa-banner--warn" style={{ margin: '0 0 14px' }}>
        <AlertTriangle size={15} />
        <div>
          It is added <strong>switched off</strong>. Send a test to your own number and
          read it against the positions above — the right number of values in the wrong
          order sends cleanly, to a real customer, with the vehicle in the amount slot.
        </div>
      </div>

      <div className="wa-actions">
        <button className="wa-btn wa-btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="wa-btn wa-btn--primary" disabled={!canSave}
          onClick={() => onCreate({
            template_key: key,
            provider_template_name: code,
            language_code: lang,
            entity_types: ents,
            variables: vars,
            body_preview: body || undefined,
            // No trigger fields: WHEN it sends is an Automations row, created
            // in the Automations tab once the template exists.
          })}>
          {busy ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Add template
        </button>
      </div>
    </div>
  );
}


/**
 * Settings → WhatsApp → Automations.
 *
 * One row per "when EVENT happens (matching VALUE), send TEMPLATE to the
 * customer" — wa_automations, migration 151.
 *
 * Layout: the list on the left; the right column is a WhatsApp-style
 * TEMPLATE PREVIEW of whichever automation is clicked — the message the
 * customer would receive, with its {{n}} slots and the variables list under
 * it. Creating and editing happen in a modal, opened from the "+ Create
 * automation" button beside the page title (or the pencil on a row), so the
 * form no longer occupies the column permanently.
 *
 * The template's own Enabled + Auto-send toggles are still the master
 * switches; a row here whose template is switched off shows a warning rather
 * than silently doing nothing.
 */
function AutomationsTab({ onChanged, createSignal }) {
  const [items, setItems] = useState([]);
  const [events, setEvents] = useState({});
  const [templates, setTemplates] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [leadStatuses, setLeadStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState({});

  // Which row the preview panel shows. Seeded to the first row once loaded —
  // an empty phone frame on arrival would make the panel look broken.
  const [previewId, setPreviewId] = useState(null);

  // The modal. open + editingId (null = creating).
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // the automation row being edited, or null

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api('/api/whatsapp/automations');
      setItems(r.items || []);
      setEvents(r.events || {});
      setTemplates(r.templates || []);
      setStatuses(r.statuses || []);
      setLeadStatuses(r.lead_statuses || []);
      setPreviewId(prev =>
        (prev && (r.items || []).some(a => a.id === prev)) ? prev : (r.items?.[0]?.id ?? null)
      );
    } catch (e) {
      setErr(e.message || 'Could not load automations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // The "+ Create automation" button lives beside the page title, outside
  // this component. It bumps a counter; each bump opens the modal fresh.
  useEffect(() => {
    if (createSignal) { setEditing(null); setModalOpen(true); }
  }, [createSignal]);

  async function toggleActive(a) {
    setBusy(s => ({ ...s, [a.id]: true }));
    try {
      const r = await api(`/api/whatsapp/automations/${a.id}`, {
        method: 'PATCH', body: { is_active: !a.is_active },
      });
      setItems(list => list.map(x => (x.id === a.id ? r.item : x)));
      setErr(null);
      onChanged?.();
    } catch (e) {
      setErr(e.message || 'Could not save');
    } finally {
      setBusy(s => ({ ...s, [a.id]: false }));
    }
  }

  async function remove(a) {
    if (!window.confirm('Remove this automation? The template stays; only this "when" rule goes.')) return;
    setBusy(s => ({ ...s, [a.id]: true }));
    try {
      await api(`/api/whatsapp/automations/${a.id}`, { method: 'DELETE' });
      setItems(list => list.filter(x => x.id !== a.id));
      setPreviewId(prev => (prev === a.id ? null : prev));
      setErr(null);
      onChanged?.();
    } catch (e) {
      setErr(e.message || 'Could not remove the automation');
    } finally {
      setBusy(s => ({ ...s, [a.id]: false }));
    }
  }

  function onSaved(item, wasEdit) {
    setItems(list => wasEdit
      ? list.map(x => (x.id === item.id ? item : x))
      : [...list, item]);
    setPreviewId(item.id);
    setModalOpen(false);
    setEditing(null);
    onChanged?.();
  }

  if (loading) {
    return <div className="wa-empty"><Loader2 size={15} className="spin" /> Loading automations…</div>;
  }

  const activeCount = items.filter(a => a.is_active).length;
  const previewAutomation = items.find(a => a.id === previewId) || null;
  const previewTemplate = previewAutomation
    ? templates.find(t => t.id === previewAutomation.template_id) || null
    : null;

  return (
    <div>
      {err && (
        <div className="wa-banner wa-banner--error">
          <AlertTriangle size={15} /><div>{err}</div>
        </div>
      )}

      <div className="wa-auto-split">
        {/* ── The list ── */}
        <div>
          <div className="wa-auto-listhead">
            <span>{items.length} automation{items.length === 1 ? '' : 's'} · {activeCount} active</span>
          </div>

          <div className="wa-auto-list">
            {items.length === 0 && (
              <div className="wa-empty">
                No automations yet — use “+ Create automation” at the top of the page.
              </div>
            )}
            {items.map(a => {
              const ev = events[a.event] || {};
              const templateOff = !a.template_enabled || !a.template_auto_send;
              const matchBroken = ev.match && a.match_value && !a.match_name;
              return (
                <div
                  className={`wa-auto-row wa-auto-row--click ${a.is_active ? '' : 'wa-auto-row--off'} ${previewId === a.id ? 'wa-auto-row--selected' : ''}`}
                  key={a.id}
                  onClick={() => setPreviewId(a.id)}
                >
                  <div className="wa-auto-main">
                    <div className="wa-auto-event">
                      <span className={`wa-chip wa-chip--module wa-chip--${ev.module || 'x'}`}>
                        {MODULE_LABELS[ev.module] || ev.module || '—'}
                      </span>
                      {ev.label || a.event}
                      {a.match_value && (
                        <span className="wa-auto-when"> {a.match_name || a.match_value}</span>
                      )}
                    </div>
                    <div className="wa-auto-template">
                      → sends <strong>{TEMPLATE_LABELS[a.template_key] || a.template_key}</strong>
                      <span className="wa-auto-recipient"> to the customer, immediately</span>
                    </div>
                    {matchBroken && (
                      <div className="wa-auto-warn">
                        <AlertTriangle size={12} /> No active status matches
                        “{a.match_value}” any more — this will never fire until one does.
                      </div>
                    )}
                    {!matchBroken && a.is_active && templateOff && (
                      <div className="wa-auto-warn">
                        <AlertTriangle size={12} /> The template is
                        {!a.template_enabled ? ' switched off' : ' not set to auto-send'} —
                        this automation is on, but nothing sends until that changes
                        on the Templates tab.
                      </div>
                    )}
                  </div>
                  {/* stopPropagation so the controls do not also change the
                      preview selection under the pointer. */}
                  <div className="wa-auto-actions" onClick={e => e.stopPropagation()}>
                    <span className={`wa-chip ${a.is_active ? 'wa-chip--live' : 'wa-chip--off'}`}>
                      {a.is_active ? 'Active' : 'Paused'}
                    </span>
                    <label className={`wa-toggle ${a.is_active ? 'wa-toggle--on' : ''} ${busy[a.id] ? 'wa-toggle--disabled' : ''}`}
                      title={a.is_active ? 'Pause without deleting' : 'Resume'}>
                      <input
                        type="checkbox" checked={!!a.is_active} disabled={busy[a.id]}
                        onChange={() => toggleActive(a)}
                      />
                    </label>
                    <button className="wa-mini" disabled={busy[a.id]}
                      onClick={() => { setEditing(a); setModalOpen(true); }} title="Edit">
                      <Pencil size={12} />
                    </button>
                    <button
                      className="wa-mini wa-mini--danger" disabled={busy[a.id]}
                      onClick={() => remove(a)} title="Remove this automation"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="wa-actions" style={{ marginTop: 10 }}>
            <button className="wa-btn wa-btn--ghost" onClick={load}>
              <RefreshCw size={13} /> Reload
            </button>
          </div>

          {/* What actually went out lately, on the same screen where it is
              configured — a burst of failures should be visible here, not in
              a server log. */}
          <RecentMessages />
        </div>

        {/* ── WhatsApp-style preview of the selected automation's template ── */}
        <WaPreviewPanel automation={previewAutomation} template={previewTemplate} events={events} />
      </div>

      {modalOpen && (
        <AutomationModal
          key={editing ? `edit-${editing.id}` : `new-${createSignal}`}
          editing={editing}
          events={events}
          templates={templates}
          statuses={statuses}
          leadStatuses={leadStatuses}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

const MODULE_LABELS = {
  lead: 'Lead', appointment: 'Appointment', estimate: 'Estimate',
  invoice: 'Invoice', payment: 'Payment',
};

/**
 * The right-hand column: the selected automation's message, drawn the way the
 * customer sees it — business header, chat background, one bubble — with the
 * {{n}} slots highlighted and the variables list underneath.
 *
 * Renders body_preview, the copy of the approved text pasted when the
 * template was registered. Interakt's API cannot return the real body, so
 * this is reference, not source of truth — the caption under the phone says
 * so. Named placeholders in the pasted text are shown as their POSITION
 * ({{1}}, {{2}}…), matching the variables list and matching what Meta
 * actually substitutes on.
 */
function WaPreviewPanel({ automation, template, events }) {
  if (!automation) {
    return (
      <div className="wa-auto-panel">
        <div className="wa-auto-panel-h">Template Preview</div>
        <div className="wa-prev-hint">Click an automation on the left to see the
          message it sends, the way the customer sees it.</div>
      </div>
    );
  }

  const ev = events[automation.event] || {};
  const vars = (template?.variables && Array.isArray(template.variables)) ? template.variables : [];
  const body = template?.body_preview || '';

  /* Split on {{anything}} and re-number the tokens positionally — the pasted
     copy may use names ({{customer_name}}) or numbers; position is the only
     thing Meta actually matches on, and it is what the list below indexes. */
  const segs = [];
  if (body) {
    // [^{}]+ so placeholders like {{vehicle Brand & mode}} are recognised —
    // same fix as renderBody above.
    const parts = String(body).split(/(\{\{[^{}]+\}\})/g);
    let n = 0;
    for (let i = 0; i < parts.length; i++) {
      if (/^\{\{/.test(parts[i])) { n += 1; segs.push({ t: 'var', n, i }); }
      else if (parts[i]) segs.push({ t: 'text', v: parts[i], i });
    }
  }

  return (
    <div className="wa-auto-panel">
      <div className="wa-auto-panel-h">
        Template Preview
        <span className="wa-wachip"><MessageCircle size={11} /> WhatsApp</span>
      </div>
      <div className="wa-prev-sub">
        {ev.label || automation.event}
        {automation.match_value ? ` · ${automation.match_name || automation.match_value}` : ''}
      </div>

      <div className="wa-phone">
        <div className="wa-phone-head">
          <span className="wa-phone-avatar">S</span>
          <div className="wa-phone-who">
            <span className="wa-phone-name">Spinoto <Check size={11} /></span>
            <span className="wa-phone-sub">Business Account</span>
          </div>
        </div>
        <div className="wa-phone-bg">
          <div className="wa-phone-bubble">
            {segs.length > 0 ? (
              <span className="wa-phone-text">
                {segs.map(s =>
                  s.t === 'text'
                    ? <span key={s.i}>{s.v}</span>
                    : <span key={s.i} className="wa-phone-var">{`{{${s.n}}}`}</span>
                )}
              </span>
            ) : (
              <span className="wa-phone-text wa-phone-text--empty">
                No body text saved for <b>{TEMPLATE_LABELS[automation.template_key] || automation.template_key}</b>.
                Paste it from Interakt on the Templates tab (Advanced mapping) and the
                preview will fill in.
              </span>
            )}
            <span className="wa-phone-time">11:30 AM</span>
          </div>
        </div>
      </div>

      <div className="wa-prev-varh">
        Variables ({vars.length})
        <span>what fills each slot</span>
      </div>
      {vars.length === 0 && (
        <div className="wa-prev-hint">No variables mapped — this template sends fixed text.</div>
      )}
      {vars.map((k, i) => (
        <div className="wa-prev-var" key={`${k}-${i}`}>
          <span className="wa-prev-var-pos">{`{{${i + 1}}}`}</span>
          <span className="wa-prev-var-name">{VAR_LABELS[k] || k}</span>
        </div>
      ))}

      <div className="wa-preview-note" style={{ marginTop: 10 }}>
        Reference copy — the approved text in Interakt is what actually sends.
        Sends as <b>{template?.provider_template_name || automation.template_key}</b>
        {template?.language_code ? ` (${template.language_code})` : ''}.
      </div>
    </div>
  );
}

/**
 * Create / edit one automation, in a modal.
 *
 * Same fields and the same server-side pairing validation as before — only
 * the container changed, so the form no longer permanently occupies the
 * preview column. The event is immutable on an existing row (the API is
 * built that way); the modal says so instead of hiding the control.
 */
function AutomationModal({ editing, events, templates, statuses, leadStatuses, onClose, onSaved }) {
  const isEdit = editing != null;
  const [fModule, setFModule] = useState(isEdit ? (events[editing.event]?.module || '') : '');
  const [fEvent, setFEvent] = useState(isEdit ? editing.event : '');
  const [fMatch, setFMatch] = useState(isEdit ? (editing.match_value || '') : '');
  const [fTemplate, setFTemplate] = useState(isEdit ? String(editing.template_id) : '');
  const [fActive, setFActive] = useState(isEdit ? !!editing.is_active : true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const modules = [...new Set(Object.values(events).map(e => e.module))];
  const moduleEvents = Object.entries(events)
    .filter(([, v]) => !fModule || v.module === fModule);
  const spec = events[fEvent] || null;

  /* Only templates whose entity_types can render this event's context —
     mirrors pairingProblem on the server. */
  const compatibleTemplates = templates.filter(t => {
    if (!spec) return false;
    const types = t.entity_types || [];
    return !types.length || types.includes(spec.entity);
  });

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      let item;
      if (!isEdit) {
        const r = await api('/api/whatsapp/automations', {
          method: 'POST',
          body: {
            event: fEvent,
            match_value: spec?.match ? (fMatch || null) : null,
            template_id: Number(fTemplate),
            is_active: fActive,
          },
        });
        item = r.item;
      } else {
        const r = await api(`/api/whatsapp/automations/${editing.id}`, {
          method: 'PATCH',
          body: {
            match_value: spec?.match ? (fMatch || null) : undefined,
            template_id: Number(fTemplate),
            is_active: fActive,
          },
        });
        item = r.item;
      }
      onSaved(item, isEdit);
    } catch (e) {
      setErr(e.message || 'Could not save the automation');
    } finally {
      setSaving(false);
    }
  }

  return (
    /* Clicking the dark backdrop closes; clicks inside the sheet must not. */
    <div className="wa-modal-overlay" onClick={onClose}>
      <div className="wa-modal" onClick={e => e.stopPropagation()}>
        <div className="wa-auto-panel-h">
          {isEdit ? 'Edit automation' : 'Create automation'}
          <button className="wa-mini" onClick={onClose} title="Close"><X size={13} /></button>
        </div>

        {err && (
          <div className="wa-banner wa-banner--error">
            <AlertTriangle size={15} /><div>{err}</div>
          </div>
        )}

        <label className="wa-fld">
          <span>Module</span>
          <select
            className="wa-select" value={fModule}
            disabled={isEdit}
            onChange={e => { setFModule(e.target.value); setFEvent(''); setFMatch(''); setFTemplate(''); }}
          >
            <option value="">— pick a module —</option>
            {modules.map(mo => (
              <option key={mo} value={mo}>{MODULE_LABELS[mo] || mo}</option>
            ))}
          </select>
        </label>

        {fModule && (
          <label className="wa-fld">
            <span>Trigger event</span>
            <select
              className="wa-select" value={fEvent}
              disabled={isEdit}
              onChange={e => { setFEvent(e.target.value); setFMatch(''); setFTemplate(''); }}
            >
              <option value="">— pick an event —</option>
              {moduleEvents.map(([k, v]) => (
                <option key={k} value={k}>{v.label || k}</option>
              ))}
            </select>
            {isEdit && (
              <em>The event can’t change on an existing automation — delete it and
                create a new one instead.</em>
            )}
          </label>
        )}

        {spec?.match === 'appointment_status' && (
          <label className="wa-fld">
            <span>When the status becomes</span>
            <select className="wa-select" value={fMatch} onChange={e => setFMatch(e.target.value)}>
              <option value="">— pick a status —</option>
              {/* Slug, not name — renaming a status must not break the rule.
                  Statuses without a slug cannot trigger; shown disabled so
                  their absence is explained rather than a mystery. */}
              {statuses.map(s => (
                <option key={s.id} value={s.slug || ''} disabled={!s.slug}>
                  {s.name}{s.slug ? '' : '  (no slug — cannot trigger)'}
                </option>
              ))}
            </select>
          </label>
        )}
        {spec?.match === 'lead_status' && (
          <label className="wa-fld">
            <span>When the status becomes</span>
            <select className="wa-select" value={fMatch} onChange={e => setFMatch(e.target.value)}>
              <option value="">— pick a status —</option>
              {/* By NAME — leads.status stores the name, not an id. */}
              {leadStatuses.map(s => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
          </label>
        )}

        {fEvent && (
          <label className="wa-fld">
            <span>Send template</span>
            <select
              className="wa-select" value={fTemplate}
              onChange={e => setFTemplate(e.target.value)}
            >
              <option value="">— pick a template —</option>
              {compatibleTemplates.map(t => (
                <option key={t.id} value={t.id}>
                  {(TEMPLATE_LABELS[t.template_key] || t.template_key)}
                  {t.is_enabled ? '' : '  (switched off)'}
                </option>
              ))}
            </select>
            {compatibleTemplates.length === 0 && (
              <em>No template can render this event — add one on the Templates tab
                with the matching record type first.</em>
            )}
          </label>
        )}

        {fEvent && (
          <div className="wa-fld">
            <span>Send to</span>
            {/* Fixed on purpose. Staff notifications are the push system's
                job, and delayed sends need scheduler work that does not exist
                yet — a dropdown offering either would be a promise the system
                cannot keep. */}
            <div className="wa-auto-fixed">The customer, immediately</div>
          </div>
        )}

        <label className={`wa-toggle ${fActive ? 'wa-toggle--on' : ''}`} style={{ marginTop: 4 }}>
          <input type="checkbox" checked={fActive} onChange={e => setFActive(e.target.checked)} />
          Active
        </label>

        <div className="wa-actions" style={{ marginTop: 14 }}>
          <button className="wa-btn wa-btn--ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="wa-btn wa-btn--primary"
            disabled={saving || !fEvent || !fTemplate || (spec?.match && !fMatch)}
            onClick={save}
          >
            {saving ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
            {isEdit ? 'Save changes' : 'Save automation'}
          </button>
        </div>

        <div className="wa-preview-note" style={{ marginTop: 10 }}>
          The template must also be Enabled + Auto-send on the Templates tab —
          those stay the master switches, so pausing a template pauses every
          automation using it.
        </div>
      </div>
    </div>
  );
}


/**
 * The five "is it working?" cards. Numbers come from /api/whatsapp/stats —
 * rates included, so the cards and the API can never disagree about a
 * denominator. Rendered only when stats loaded; a stats hiccup must not
 * blank the configuration below.
 */
function StatsRow({ stats }) {
  const delta = stats.sent_yesterday
    ? Math.round(((stats.sent_today - stats.sent_yesterday) / stats.sent_yesterday) * 100)
    : null;
  return (
    <div className="wa-stats">
      <div className="wa-stat">
        <span className="wa-stat-ic wa-stat-ic--green"><MessageCircle size={17} /></span>
        <div>
          <div className="wa-stat-label">Sent today</div>
          <div className="wa-stat-value">{stats.sent_today}</div>
          <div className="wa-stat-sub">
            {delta == null ? (stats.queued_now ? `${stats.queued_now} queued` : ' ')
              : `${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)}% vs yesterday`}
          </div>
        </div>
      </div>
      <div className="wa-stat">
        <span className="wa-stat-ic wa-stat-ic--blue"><Send size={16} /></span>
        <div>
          <div className="wa-stat-label">Delivered</div>
          <div className="wa-stat-value">{stats.delivered_today}</div>
          <div className="wa-stat-sub">
            {stats.delivery_rate == null ? ' ' : `${stats.delivery_rate}% delivery rate`}
          </div>
        </div>
      </div>
      <div className="wa-stat">
        <span className="wa-stat-ic wa-stat-ic--teal"><CheckCheck size={17} /></span>
        <div>
          <div className="wa-stat-label">Read</div>
          <div className="wa-stat-value">{stats.read_today}</div>
          <div className="wa-stat-sub">
            {stats.read_rate == null ? ' ' : `${stats.read_rate}% read rate`}
          </div>
        </div>
      </div>
      <div className="wa-stat">
        <span className="wa-stat-ic wa-stat-ic--red"><XCircle size={17} /></span>
        <div>
          <div className="wa-stat-label">Failed</div>
          <div className={`wa-stat-value ${stats.failed_today ? 'wa-stat-value--bad' : ''}`}>
            {stats.failed_today}
          </div>
          <div className={`wa-stat-sub ${stats.failed_today ? 'wa-stat-sub--bad' : ''}`}>
            {stats.failure_rate == null ? ' ' : `${stats.failure_rate}% failure rate`}
          </div>
        </div>
      </div>
      <div className="wa-stat">
        <span className="wa-stat-ic wa-stat-ic--violet"><Bot size={17} /></span>
        <div>
          <div className="wa-stat-label">Active automations</div>
          <div className="wa-stat-value">{stats.automations_active}</div>
          <div className="wa-stat-sub">of {stats.automations_total} total</div>
        </div>
      </div>
    </div>
  );
}


/** Status chip for a message row — mirrors the ladder's meaning at a glance. */
function msgChip(status) {
  if (status === 'read') return <span className="wa-chip wa-chip--live"><CheckCheck size={11} /> Read</span>;
  if (status === 'delivered') return <span className="wa-chip wa-chip--manual"><CheckCheck size={11} /> Delivered</span>;
  if (status === 'sent') return <span className="wa-chip wa-chip--manual"><Check size={11} /> Sent</span>;
  if (status === 'failed') return <span className="wa-chip wa-chip--bad"><XCircle size={11} /> Failed</span>;
  return <span className="wa-chip wa-chip--off">Queued</span>;
}

/**
 * The latest outbound messages across every record. Failures surface here,
 * beside the configuration that caused them, instead of only in a server log.
 */
function RecentMessages() {
  const [items, setItems] = useState([]);
  const [skips, setSkips] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearingLog, setClearingLog] = useState(false);

  // 10/page, matching the shared PaginationBar's default and every other list
  // in the app. `total` drives the pager; `newestId` is what Clear bounds
  // itself by (see clearLog).
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [newestId, setNewestId] = useState(0);

  const load = useCallback(async () => {
    try {
      const offset = (page - 1) * pageSize;
      const r = await api(`/api/whatsapp/messages/recent?limit=${pageSize}&offset=${offset}`);
      setItems(r.items || []);
      setSkips(r.skips || []);
      setTotal(r.total || 0);
      setNewestId(r.newest_id || 0);

      // Clearing, or messages ageing out, can leave you on a page that no
      // longer exists — an empty list under a pager reading "page 4 of 2".
      // Snap back rather than showing nothing and looking broken.
      const lastPage = Math.max(1, Math.ceil((r.total || 0) / pageSize));
      if (page > lastPage) setPage(lastPage);
    } catch { /* the panel simply stays empty */ }
    setLoaded(true);
  }, [page, pageSize]);

  useEffect(() => { load(); }, [load]);

  /**
   * Clear every skip currently on screen.
   *
   * `upto` is the newest id being DISPLAYED, not "everything". A refusal can be
   * recorded between this list rendering and the click landing, and destroying
   * one the user never saw is the exact failure this panel exists to prevent.
   * Anything newer survives and appears in the reload below.
   */
  const clearAll = useCallback(async () => {
    if (!skips.length) return;
    const upto = Math.max(...skips.map(s => s.id));
    setClearing(true);
    try {
      await api(`/api/whatsapp/messages/skips?upto=${upto}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      // Most likely a permission refusal — clearing needs
      // MANAGE_WHATSAPP_TEMPLATES while merely seeing the panel does not, so an
      // advisor can legitimately land here. Say so instead of doing nothing.
      alert(e.message || 'Could not clear the skipped list.');
    }
    setClearing(false);
  }, [skips, load]);

  /**
   * Clear the SENT log.
   *
   * Confirmed, unlike the skips, because this one is not reversible and not
   * harmless: the row being deleted is the unique row that stops the same
   * automation sending the same message to the same customer again. The dialog
   * says that in those words — a "are you sure?" that does not name the
   * consequence is just a speed bump.
   */
  const clearLog = useCallback(async () => {
    if (!items.length) return;
    if (!window.confirm(
      'Clear these sent messages from the log?\n\n' +
      'This deletes the record permanently. Anything cleared can be SENT AGAIN ' +
      'to the customer by the same automation, delivery/read updates for it stop ' +
      'arriving, and the stats above will drop.\n\n' +
      'Messages still queued are kept.'
    )) return;

    // The newest message that existed when this page loaded — NOT the largest
    // id on the current page. On page 3 that would be an old id, and Clear
    // would wipe page 3 downwards while leaving pages 1-2 sitting there.
    const upto = newestId || Math.max(...items.map(m => m.id));
    setClearingLog(true);
    try {
      const r = await api(`/api/whatsapp/messages/log?upto=${upto}`, { method: 'DELETE' });
      // Explain a list that did not empty, instead of leaving it looking broken.
      if (r?.kept) alert(`${r.kept} message${r.kept === 1 ? '' : 's'} still queued — those were kept until they send.`);
      setPage(1);      // whatever is left is now on page 1
      await load();
    } catch (e) {
      alert(e.message || 'Could not clear the log.');
    }
    setClearingLog(false);
  }, [items, newestId, load]);

  const clearLogOne = useCallback(async (id) => {
    // NOT optimistic, unlike the skip rows. A queued message is refused by the
    // server with a 409, and hiding the row first would show a success that did
    // not happen for the one case the user most needs to see.
    try {
      await api(`/api/whatsapp/messages/log/${id}`, { method: 'DELETE' });
      // Reload rather than just dropping the row locally: on a 10-per-page list
      // removing one would leave a 9-row page with the 11th message stranded
      // out of view until something else triggered a fetch.
      await load();
    } catch (e) {
      alert(e.message || 'Could not clear that message.');
    }
    // `load` MUST be a dependency now that it is called here. It is recreated
    // whenever page or pageSize change, so an empty array would freeze the
    // first one — clearing a row on page 3 would silently reload page 1.
  }, [load]);

  const clearOne = useCallback(async (id) => {
    // Optimistic: the row goes now. It is a diagnostic note, so a failed
    // delete costs nothing worse than the row reappearing on the next refresh.
    setSkips(prev => prev.filter(s => s.id !== id));
    try {
      await api(`/api/whatsapp/messages/skips/${id}`, { method: 'DELETE' });
    } catch {
      load();   // put it back — the server still has it
    }
  }, [load]);

  if (!loaded || (!items.length && !skips.length)) return null;

  return (
    <div className="wa-log">
      {/* Refused sends FIRST — each one is an action item with the exact
          reason, which is precisely the thing that used to live only in the
          server terminal. */}
      {skips.length > 0 && (
        <>
          <div className="wa-log-h">
            Skipped — why a message didn’t send
            <span className="wa-log-acts">
              {/* Clearing does not fix anything — the same refusal is recorded
                  again the next time that action is retried. It is an
                  acknowledgement, which is why it reads "Clear" and not
                  "Resolve". */}
              <button
                className="wa-mini wa-mini--danger"
                onClick={clearAll}
                disabled={clearing}
                title="Clear these — they come back if the cause isn't fixed"
              >
                {clearing ? <Loader2 size={12} className="spin" /> : <Trash2 size={12} />}
              </button>
              <button className="wa-mini" onClick={load} title="Refresh"><RefreshCw size={12} /></button>
            </span>
          </div>
          {skips.map(s => (
            <div className="wa-log-row wa-log-row--skip" key={`s${s.id}`} title={s.reason}>
              <div className="wa-log-who">
                <span className="wa-log-name">
                  {TEMPLATE_LABELS[s.template_key] || s.template_key}
                </span>
                <span className="wa-log-num">
                  {s.entity_type ? `${s.entity_type} #${s.entity_id}` : s.event}
                </span>
              </div>
              <span className="wa-log-reason">{s.message || s.reason}</span>
              <span className="wa-log-time">
                {new Date(s.created_at).toLocaleString('en-IN', {
                  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                })}
              </span>
              {/* Per-row, so one that has been dealt with can go without
                  clearing the ones still waiting on a fix. */}
              <button
                className="wa-log-x"
                onClick={() => clearOne(s.id)}
                title="Dismiss this one"
                aria-label="Dismiss this skipped send"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </>
      )}

      {items.length > 0 && (
        <div className="wa-log-h" style={skips.length ? { marginTop: 10 } : undefined}>
          Recent messages
          <span className="wa-log-acts">
            <button
              className="wa-mini wa-mini--danger"
              onClick={clearLog}
              disabled={clearingLog}
              title="Clear the log — deletes the record permanently"
            >
              {clearingLog ? <Loader2 size={12} className="spin" /> : <Trash2 size={12} />}
            </button>
            {/* Refresh lives here only when there is no Skipped section above
                already carrying one — two refresh buttons on one panel is
                noise, and they do exactly the same thing. */}
            {!skips.length && (
              <button className="wa-mini" onClick={load} title="Refresh"><RefreshCw size={12} /></button>
            )}
          </span>
        </div>
      )}
      {items.map(m => (
        <div className="wa-log-row" key={m.id} title={m.error_message || ''}>
          <div className="wa-log-who">
            <span className="wa-log-name">{m.customer_name || m.to_number}</span>
            {m.customer_name && <span className="wa-log-num">{m.to_number}</span>}
          </div>
          <span className="wa-log-tpl">{TEMPLATE_LABELS[m.template_key] || m.template_key}</span>
          <span className="wa-log-ref">{m.entity_type ? `${m.entity_type} #${m.entity_id}` : ''}</span>
          {msgChip(m.status)}
          <span className="wa-log-time">
            {new Date(m.sent_at || m.created_at).toLocaleString('en-IN', {
              day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
            })}
          </span>
          {/* Not rendered for a queued message: the server refuses those, and a
              button whose only outcome is an error message should not be there
              to press. */}
          {m.status !== 'queued' && (
            <button
              className="wa-log-x wa-log-x--sent"
              onClick={() => clearLogOne(m.id)}
              title="Clear this from the log (permanent)"
              aria-label="Clear this message from the log"
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}

      {/* Rendered whenever there are messages at all, not only when there is
          more than one page: the size selector lives in this bar, so hiding it
          under the threshold would trap you at 10/page with no way to change
          it. The bar itself already hides the page buttons at one page. */}
      {total > 0 && (
        <PaginationBar
          page={page}
          total={total}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={setPageSize}
          noun="message"
        />
      )}
    </div>
  );
}


/**
 * Settings → WhatsApp → Connection.
 *
 * The Interakt API key, webhook secret and default test number, without SSH
 * and a restart. The server never returns a stored value — only
 * {configured, last4, source} — so the inputs here are WRITE-ONLY: type a new
 * value to replace, save empty to clear (which falls back to the backend
 * environment variable, shown as source "environment").
 */
function ConnectionTab({ onChanged }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  // Write-only drafts. Empty string = untouched; the clear action sends ''.
  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [testNumber, setTestNumber] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api('/api/whatsapp/provider-settings');
      setState(r);
      setTestNumber(r.test_number?.value || '');
    } catch (e) {
      setErr(e.message || 'Could not load the connection settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(body) {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const r = await api('/api/whatsapp/provider-settings', { method: 'PUT', body });
      setState(r);
      setApiKey('');
      setSecret('');
      setTestNumber(r.test_number?.value || '');
      setSaved(true);
      onChanged?.();
    } catch (e) {
      setErr(e.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  function statusLine(s, secretLike = true) {
    if (!s?.configured) return <span className="wa-conn-state wa-conn-state--off">not set</span>;
    return (
      <span className="wa-conn-state wa-conn-state--on">
        set{secretLike && s.last4 ? <> — ends <code>…{s.last4}</code></> : null}
        {s.source === 'environment' ? ' (from the backend environment)' : ''}
      </span>
    );
  }

  if (loading) {
    return <div className="wa-empty"><Loader2 size={15} className="spin" /> Loading connection…</div>;
  }

  return (
    <div>
      {err && (
        <div className="wa-banner wa-banner--error">
          <AlertTriangle size={15} /><div>{err}</div>
        </div>
      )}
      {saved && (
        <div className="wa-banner wa-banner--info">
          <Check size={15} /><div>Saved. Sends and webhooks use the new values immediately.</div>
        </div>
      )}

      <div className="wa-banner wa-banner--info">
        <Info size={15} />
        <div>
          Stored values are never shown back — only their last characters. Saving a
          field <strong>replaces</strong> the value; using “Clear” removes it and falls
          back to the backend environment variable, if one is set.
        </div>
      </div>

      <div className="wa-auto-add" style={{ marginBottom: 14 }}>
        <div className="wa-section-h wa-step-h">
          <span className={`wa-guide-num ${state?.api_key?.configured ? 'wa-guide-num--done' : ''}`}>
            {state?.api_key?.configured ? <Check size={12} /> : '1'}
          </span>
          Interakt API key
        </div>
        <div className="wa-conn-row">
          <div>{statusLine(state?.api_key)}</div>
          <input
            className="wa-input wa-mono" type="password" autoComplete="new-password"
            placeholder="Paste the API key from Interakt → Settings → Developer"
            value={apiKey} onChange={e => setApiKey(e.target.value)}
          />
          <div className="wa-conn-btns">
            <button className="wa-btn wa-btn--primary" disabled={busy || !apiKey.trim()}
              onClick={() => save({ api_key: apiKey.trim() })}>
              {busy ? <Loader2 size={13} className="spin" /> : <Check size={13} />} Save key
            </button>
            {state?.api_key?.source === 'database' && (
              <button className="wa-btn wa-btn--ghost" disabled={busy}
                title="Remove the stored key and fall back to the environment variable"
                onClick={() => window.confirm('Remove the stored API key? Sending stops unless INTERAKT_API_KEY is set in the backend environment.') && save({ api_key: '' })}>
                Clear
              </button>
            )}
          </div>
        </div>
        <div className="wa-preview-note" style={{ marginTop: 6 }}>
          Paste it exactly as Interakt shows it — it is already base64, and re-encoding
          it is the classic way sends fail with a 401 that looks like a wrong key.
        </div>
      </div>

      <div className="wa-auto-add" style={{ marginBottom: 14 }}>
        <div className="wa-section-h wa-step-h">
          <span className={`wa-guide-num ${state?.webhook_secret?.configured ? 'wa-guide-num--done' : ''}`}>
            {state?.webhook_secret?.configured ? <Check size={12} /> : '2'}
          </span>
          Webhook secret
        </div>
        <div className="wa-conn-row">
          <div>{statusLine(state?.webhook_secret)}</div>
          <input
            className="wa-input wa-mono" type="password" autoComplete="new-password"
            placeholder="The secret configured beside the webhook URL in Interakt"
            value={secret} onChange={e => setSecret(e.target.value)}
          />
          <div className="wa-conn-btns">
            <button className="wa-btn wa-btn--primary" disabled={busy || !secret.trim()}
              onClick={() => save({ webhook_secret: secret.trim() })}>
              {busy ? <Loader2 size={13} className="spin" /> : <Check size={13} />} Save secret
            </button>
            {state?.webhook_secret?.source === 'database' && (
              <button className="wa-btn wa-btn--ghost" disabled={busy}
                onClick={() => window.confirm('Remove the stored webhook secret? Delivery-status updates stop unless INTERAKT_WEBHOOK_SECRET is set in the backend environment.') && save({ webhook_secret: '' })}>
                Clear
              </button>
            )}
          </div>
        </div>
        <div className="wa-preview-note" style={{ marginTop: 6 }}>
          Must match the Interakt dashboard exactly, or delivery statuses silently stop
          arriving — a mismatch is logged on the backend as “signature mismatch”.
        </div>
      </div>

      <div className="wa-auto-add">
        <div className="wa-section-h wa-step-h">
          <span className={`wa-guide-num ${state?.test_number?.configured ? 'wa-guide-num--done' : ''}`}>
            {state?.test_number?.configured ? <Check size={12} /> : '3'}
          </span>
          Default test number
        </div>
        <div className="wa-conn-row">
          <div>{statusLine(state?.test_number, false)}</div>
          <input
            className="wa-input"
            placeholder="10-digit mobile that receives “Send test” messages"
            value={testNumber} onChange={e => setTestNumber(e.target.value)}
          />
          <div className="wa-conn-btns">
            <button className="wa-btn wa-btn--primary" disabled={busy}
              onClick={() => save({ test_number: testNumber.trim() })}>
              {busy ? <Loader2 size={13} className="spin" /> : <Check size={13} />} Save number
            </button>
          </div>
        </div>
        <div className="wa-preview-note" style={{ marginTop: 6 }}>
          Not a secret — shown in full. Every “Send test” on the Templates tab goes here
          unless a different number is typed for that test.
        </div>
      </div>
    </div>
  );
}
