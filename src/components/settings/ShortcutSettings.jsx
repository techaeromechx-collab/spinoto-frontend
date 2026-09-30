import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, RotateCcw, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import {
  MOD_LABEL, buildCatalogue, keyOf, keyLabel, keyParts, validate,
} from '../../lib/shortcuts.js';
import {
  useShortcutOverrides, loadShortcutOverrides, setShortcutOverrides,
} from '../../lib/shortcutsStore.js';
import '../../styles/Shortcuts.css';

/**
 * ShortcutSettings — Settings → Keyboard.
 *
 * ══ IT SAYS Alt ON WINDOWS AND Option ON A MAC ═════════════════════════════
 *
 * Both are the same physical key and the same stored binding — 'alt+l' either
 * way. Only the LABEL changes, and it changes in three places that all have to
 * agree: the key cap drawn on the row, the words in the tooltip and for a
 * screen reader, and the instruction at the top of the page. All three come
 * from MOD_GLYPH / MOD_LABEL in lib/shortcuts.js, so there is one answer to
 * "what is this key called here" rather than three strings that drift.
 *
 * A Mac keycap carries the glyph ⌥, so that is what the key cap shows; the
 * tooltip spells "Option" because a glyph is no use to somebody who does not
 * already know it, and no use at all to a screen reader.
 *
 * ══ WHAT IS SAVED ══════════════════════════════════════════════════════════
 *
 * Only what has been changed. A row still on its default writes nothing, so
 * improving a default later reaches everybody who never touched it. Clearing a
 * row back to default DELETES the override rather than storing the default's
 * value — otherwise the two become indistinguishable a version later.
 *
 * ══ AND IT IS THE SAME COPY THE LISTENER USES ══════════════════════════════
 *
 * The map is read from and written to lib/shortcutsStore.js, not held here. With
 * a local useState this panel saved correctly and AppShell's listener carried on
 * answering to the OLD key until the next full page load — a settings page that
 * said Alt+K over an app that still wanted Alt+L, with nothing admitting it.
 * shot22 is what found that; the store's header has the rest.
 */
export default function ShortcutSettings() {
  const { can } = useAuth();
  const overrides = useShortcutOverrides();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const [recording, setRecording] = useState(null);   // the id being rebound
  const [problem, setProblem] = useState(null);       // {id, kind, text, keys}
  const savedTimer = useRef(null);

  const catalogue = useMemo(() => buildCatalogue(can, overrides), [can, overrides]);

  /* A force refetch, not the once-per-load one: somebody who opens this tab is
     entitled to see what another device changed, and it is the only screen where
     a stale map is worth a round trip. */
  useEffect(() => {
    let cancelled = false;
    loadShortcutOverrides({ force: true })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const persist = useCallback(async (next) => {
    setErr('');
    /* Optimistic, and reverted on failure. A shortcut panel that waits for a
       round trip before showing the key you just pressed feels broken in
       exactly the way a shortcut is supposed to fix. */
    const before = overrides;
    setShortcutOverrides(next);
    try {
      const r = await api('/api/me/shortcuts', { method: 'PUT', body: { shortcuts: next } });
      /* The server's copy, not `next` — it trims, and it is the authority on what
         was actually stored. */
      setShortcutOverrides(r.shortcuts || next);
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 1400);
    } catch (e) {
      setShortcutOverrides(before);
      setErr(e?.message || 'Could not save that.');
    }
  }, [overrides]);

  /* ── Recording ───────────────────────────────────────────────────────────
     A window listener in capture phase, so the key never reaches the page's
     own shortcut handler while somebody is choosing one — otherwise pressing
     Alt+L to bind it would also navigate to Leads and leave the settings. */
  useEffect(() => {
    if (!recording) return undefined;

    function onKey(e) {
      if (['Alt', 'Control', 'Meta', 'Shift'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') { setRecording(null); setProblem(null); return; }

      const keys = keyOf(e);
      const bad = validate(keys, { id: recording, catalogue: catalogue.all });

      if (bad === 'browser') {
        setProblem({ id: recording, kind: 'browser', keys,
          text: `${keyLabel(keys)} belongs to your browser.` });
        setRecording(null); return;
      }
      if (bad && bad.startsWith('taken:')) {
        setProblem({ id: recording, kind: 'taken', keys, with: bad.slice(6),
          text: `${keyLabel(keys)} already opens ${bad.slice(6)}.` });
        setRecording(null); return;
      }
      if (bad) {
        setProblem({ id: recording, kind: 'bad', keys, text: bad });
        setRecording(null); return;
      }

      apply(recording, keys);
      setRecording(null); setProblem(null);
    }

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, catalogue.all, overrides]);

  function apply(id, keys) {
    const item = catalogue.all.find((s) => s.id === id);
    const next = { ...overrides };
    /* Back on the default → DELETE the override. Storing the default's own
       value would make "unchanged" and "changed to the same thing" identical,
       and the first would stop tracking the default. */
    if (item && keys === item.def) delete next[id];
    else next[id] = keys;
    persist(next);
  }

  function takeFrom(loserId, id, keys) {
    const next = { ...overrides, [loserId]: '', [id]: keys };
    setProblem(null);
    persist(next);
  }

  function resetOne(id) {
    const next = { ...overrides };
    delete next[id];
    setProblem(null);
    persist(next);
  }

  const modWord = MOD_LABEL.alt;              // "Alt" or "Option"
  const changed = Object.keys(overrides).length;

  if (loading) return <div className="sc-loading">Loading your shortcuts…</div>;

  const Row = ({ s }) => {
    const rec = recording === s.id;
    const p = problem && problem.id === s.id ? problem : null;
    const isChanged = s.id in overrides;
    return (
      <>
        <div className={`sc-row${rec ? ' sc-row--rec' : ''}${p ? ' sc-row--bad' : ''}`}>
          <span className="sc-row-main">
            <span className="sc-row-label">{s.label}</span>
            {s.hint && <span className="sc-row-sub">{s.hint}</span>}
            {isChanged && !s.hint && <span className="sc-row-sub">Changed from default</span>}
          </span>

          {rec ? (
            <span className="sc-recording">Press the keys…</span>
          ) : (
            <button type="button" className="sc-bind" disabled={s.fixed}
                    onClick={() => { setProblem(null); setRecording(s.id); }}
                    /* The words, not the glyph: "Option + L" is readable, and
                       ⌥ is not, to a screen reader or to anybody who has not
                       met the symbol. */
                    title={s.fixed ? 'This one is fixed' : `${keyLabel(s.keys)} — click to change`}
                    aria-label={s.fixed ? `${s.label}: ${keyLabel(s.keys)}, fixed`
                                        : `${s.label}: ${keyLabel(s.keys)}. Click to change.`}>
              {s.keys
                ? keyParts(s.keys).map((k, i) => <kbd key={i}>{k}</kbd>)
                : <span className="sc-unset">Not set</span>}
            </button>
          )}

          {s.fixed ? (
            <span className="sc-fixed">Fixed</span>
          ) : rec ? (
            <button type="button" className="sc-mini" onClick={() => setRecording(null)}>Cancel</button>
          ) : (
            <button type="button" className="sc-mini" disabled={!isChanged}
                    onClick={() => resetOne(s.id)} title="Back to the default">
              <RotateCcw size={11} /> Reset
            </button>
          )}
        </div>

        {p && (
          <div className="sc-problem">
            {p.text}
            {p.kind === 'taken' && (
              <button type="button" className="sc-mini sc-mini--warn"
                      onClick={() => {
                        const loser = catalogue.all.find((x) => x.keys === p.keys && x.id !== s.id);
                        if (loser) takeFrom(loser.id, s.id, p.keys);
                      }}>
                Give it to {s.label}
              </button>
            )}
            <button type="button" className="sc-x" onClick={() => setProblem(null)}
                    aria-label="Dismiss"><X size={12} /></button>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="sc-wrap">
      <header className="sc-head">
        <span className="sc-head-ic"><Keyboard size={16} /></span>
        <div>
          <h3>Keyboard shortcuts</h3>
          {/* The instruction has to name the key the way it is printed on THIS
              machine. "Hold Alt" on a Mac is an instruction nobody can follow. */}
          <p>
            Hold <kbd>{keyParts('alt+a')[0]}</kbd> ({modWord}) and press a letter.
            Click any shortcut to change it.
          </p>
        </div>
        <span className="sc-spacer" />
        {saved && <span className="sc-saved">Saved</span>}
      </header>

      {err && <div className="sc-alert" role="alert">{err}</div>}

      <div className="sc-group">
        <div className="sc-group-h">
          <span className="sc-group-t">Go to</span>
          <span className="sc-group-n">Only the screens your permissions let you open</span>
        </div>
        <div className="sc-rows">
          {catalogue.nav.map((s) => <Row key={s.id} s={s} />)}
        </div>
      </div>

      <div className="sc-group">
        <div className="sc-group-h">
          <span className="sc-group-t">On this page</span>
          <span className="sc-group-n">These wait until you are not typing</span>
        </div>
        <div className="sc-rows">
          {catalogue.actions.map((s) => <Row key={s.id} s={s} />)}
        </div>
      </div>

      <footer className="sc-foot">
        <button type="button" className="sc-mini" disabled={!changed}
                onClick={() => { setProblem(null); persist({}); }}>
          <RotateCcw size={11} /> Reset everything to default
        </button>
        <span className="sc-foot-n">
          {changed === 0 ? 'All on their defaults'
            : `${changed} changed from default`}
        </span>
      </footer>
    </div>
  );
}
