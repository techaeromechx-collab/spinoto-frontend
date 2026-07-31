// Unsaved-changes guard.
//
// react-router's useBlocker would be the natural tool for this, but it only
// works with a data router (createBrowserRouter) and main.jsx mounts a plain
// <BrowserRouter>. Rather than migrate the app's whole routing setup for one
// dialog, this guards the exits explicitly: a screen registers its dirty flag
// and its save function, and the surrounding shell wraps each way out in
// guard().
//
// Browser-level exits — closing the tab, refreshing, the hardware back button
// — can't show a custom dialog at all. Browsers deliberately only allow their
// own generic prompt there, and ignore any message you supply. Those go
// through the beforeunload handler below, which is why that case looks
// different from this one.
//
// Usage:
//   <UnsavedChangesProvider>       ...around the shell
//   const guard = useUnsavedGuard();
//   guard(() => setActiveTab(key)) ...at each exit
//   useRegisterUnsavedChanges(dirty, handleSave)  ...in the dirty screen

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { AlertTriangle, Save } from 'lucide-react';
import { useEscapeClose } from '../hooks/useEscapeClose.js';

const UnsavedCtx = createContext(null);

export function UnsavedChangesProvider({ children }) {
  // Held in a ref rather than state on purpose. guard() runs inside click
  // handlers and has to read the CURRENT flag, and re-rendering the entire
  // settings shell every time a child toggles dirty would be pure waste.
  const reg = useRef({ dirty: false, save: null });

  const [pending, setPending] = useState(null); // the deferred navigation
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState(null);

  const register = useCallback((dirty, save) => {
    reg.current = { dirty, save };
  }, []);

  useEffect(() => {
    function onBeforeUnload(e) {
      if (!reg.current.dirty) return;
      e.preventDefault();
      e.returnValue = ''; // still required by older Chrome/Safari
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Catch-all for in-app links we don't own.
  //
  // Calling guard() at each exit point only protects the exits somebody
  // remembered — the sidebar, breadcrumbs, user menu and mobile nav all
  // navigated straight past it and dropped unsaved work silently. A single
  // capture-phase listener covers every <a> in the app, including ones added
  // later, without touching each call site.
  //
  // Deliberately narrow: plain left-clicks on same-origin links only. A
  // modified click (Cmd/Ctrl/Shift/Alt) or middle-click opens a new tab and
  // leaves this one — and its unsaved work — exactly where it was, so there is
  // nothing to protect.
  useEffect(() => {
    function onClickCapture(e) {
      if (!reg.current.dirty) return;
      if (e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const a = e.target?.closest?.('a[href]');
      if (!a) return;
      if (a.target && a.target !== '_self') return;
      if (a.hasAttribute('download')) return;

      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // Same page (or a pure hash change) isn't leaving anything behind.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      e.preventDefault();
      e.stopPropagation();
      setErr(null);
      setPending(() => () => {
        // Re-dispatch rather than calling navigate(): this component sits
        // above the router's context in some trees, and letting the original
        // link handle itself keeps react-router's own semantics intact.
        reg.current = { dirty: false, save: null };
        a.click();
      });
    }
    document.addEventListener('click', onClickCapture, true);
    return () => document.removeEventListener('click', onClickCapture, true);
  }, []);

  // Returns true if the action ran straight away (nothing to save), false if
  // it was deferred behind the dialog. Link handlers use the return value to
  // decide whether to preventDefault().
  const guard = useCallback((action) => {
    if (!reg.current.dirty) { action(); return true; }
    setErr(null);
    // setState treats a bare function as an updater, so the action has to be
    // returned from one rather than passed directly.
    setPending(() => action);
    return false;
  }, []);

  const close = useCallback(() => {
    setPending(null); setErr(null); setBusy(false);
  }, []);

  function discard() {
    const action = pending;
    // Clear the flag before navigating, so the same exit isn't blocked a
    // second time if the dirty screen hasn't unmounted yet.
    reg.current = { dirty: false, save: null };
    close();
    action?.();
  }

  async function saveThenGo() {
    const { save } = reg.current;
    const action = pending;
    if (typeof save !== 'function') { discard(); return; }
    setBusy(true); setErr(null);
    try {
      const result = await save();
      // A save that reports failure keeps the dialog open. Navigating away
      // after a failed save is exactly how you lose the work this dialog
      // exists to protect.
      if (result === false) {
        setErr('Could not save. Your changes are still here.');
        return;
      }
      reg.current = { dirty: false, save: null };
      close();
      action?.();
    } catch (ex) {
      setErr(ex?.message || 'Could not save. Your changes are still here.');
    } finally {
      setBusy(false);
    }
  }

  const value = useMemo(() => ({ register, guard }), [register, guard]);

  return (
    <UnsavedCtx.Provider value={value}>
      {children}
      {pending && (
        <UnsavedDialog
          busy={busy} err={err}
          onCancel={close} onDiscard={discard} onSave={saveThenGo}
        />
      )}
    </UnsavedCtx.Provider>
  );
}

function UnsavedDialog({ busy, err, onCancel, onDiscard, onSave }) {
  // Escape cancels, but not mid-save — that would leave the user unsure
  // whether the write went through.
  useEscapeClose(onCancel, !busy);

  return (
    <div className="uc-overlay" role="dialog" aria-modal="true" aria-labelledby="uc-title">
      <div className="uc-modal">
        <div className="uc-icon"><AlertTriangle size={19} /></div>
        <div className="uc-title" id="uc-title">Do you want to save your changes?</div>
        <div className="uc-body">Your changes will be lost if you don&rsquo;t save them.</div>
        {err && <div className="uc-err">{err}</div>}
        <div className="uc-actions">
          <button type="button" className="prfl-btn-ghost uc-discard"
            onClick={onDiscard} disabled={busy}>
            Don&rsquo;t Save
          </button>
          <div className="uc-spacer" />
          <button type="button" className="prfl-btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="prfl-btn-primary" onClick={onSave} disabled={busy}>
            <Save size={14} /> {busy ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Returns guard(action) for use at an exit point. Outside a provider it
 * degrades to running the action immediately, so callers never need to branch
 * on whether the guard is present.
 */
export function useUnsavedGuard() {
  const ctx = useContext(UnsavedCtx);
  const fallback = useCallback((action) => { action(); return true; }, []);
  return ctx?.guard || fallback;
}

/**
 * Called by the screen that has unsaved work.
 *
 * `save` should resolve truthy (or undefined) on success and return false — or
 * throw — on failure; returning false is what keeps the dialog open.
 */
export function useRegisterUnsavedChanges(dirty, save) {
  const ctx = useContext(UnsavedCtx);
  const register = ctx?.register;

  // The save closure changes on every render. Parking it in a ref means the
  // effect below only re-runs when `dirty` actually flips, while still calling
  // the latest version.
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!register) return undefined;
    register(dirty, () => saveRef.current?.());
    return () => register(false, null);
  }, [register, dirty]);
}
