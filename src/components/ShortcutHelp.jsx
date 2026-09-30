import { Keyboard, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { MOD_LABEL, keyLabel, keyParts } from '../lib/shortcuts.js';
import '../styles/Shortcuts.css';

/**
 * ShortcutHelp — the overlay behind "?".
 *
 * Built from the SAME catalogue the listener uses, so it shows what this reader
 * actually has, including anything they rebound and anything their permissions
 * hide. A cheat sheet assembled from a separate hard-coded list is a cheat
 * sheet that lies the first time somebody changes a key.
 *
 * This is most of the value of the whole feature. A shortcut nobody knows about
 * is dead code, and nobody reads a settings page to find out what exists.
 */
export default function ShortcutHelp({ catalogue, onClose }) {
  const rows = (list) => list.filter((s) => s.keys).map((s) => (
    <div className="sch-row" key={s.id}>
      <span>{s.label}</span>
      <span className="sch-keys" title={keyLabel(s.keys)} aria-label={keyLabel(s.keys)}>
        {keyParts(s.keys).map((k, i) => <kbd key={i}>{k}</kbd>)}
      </span>
    </div>
  ));

  return (
    <div className="sch" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      {/* Backdrop click closes. Escape is handled by the same global listener
          that opened this, in AppShell, so there is one place that knows the
          overlay is open. */}
      <div className="sch-bd" onClick={onClose} />
      <div className="sch-in">
        <header className="sch-h">
          <span className="sch-h-t"><Keyboard size={15} /> Keyboard shortcuts</span>
          <button type="button" className="sc-x" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>

        <div className="sch-b">
          <div className="sch-col">
            <h4>Go to</h4>
            {rows(catalogue.nav)}
          </div>
          <div className="sch-col">
            <h4>On this page</h4>
            {rows(catalogue.actions)}
            <p className="sch-note">
              Hold <kbd>{keyParts('alt+a')[0]}</kbd> ({MOD_LABEL.alt}) with a letter and it works
              even while you are typing. The single keys above wait until you are not.
            </p>
          </div>
        </div>

        <footer className="sch-f">
          <Link to="/settings?tab=keyboard" onClick={onClose}>Change these in Settings → Keyboard</Link>
        </footer>
      </div>
    </div>
  );
}
