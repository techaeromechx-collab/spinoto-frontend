/**
 * "Something arrived" — sound and a system notification, on whichever of the
 * three things this app is running inside today.
 *
 * ── There is only ONE code path, and that surprised me ──────────────────────
 *
 * Spinoto ships as a browser app AND as a Tauri desktop build, so the obvious
 * design is a branch: `new Notification(...)` in a browser, the Tauri plugin's
 * sendNotification() in the .exe. That is what the Tauri docs read like.
 *
 * It is not what the plugin does. From its own source
 * (@tauri-apps/plugin-notification 2.3.3):
 *
 *     function sendNotification(options) {
 *       if (typeof options === 'string') new window.Notification(options);
 *       else new window.Notification(options.title, options);
 *     }
 *     async function requestPermission() {
 *       return await window.Notification.requestPermission();
 *     }
 *
 * The JS package is a wrapper around the STANDARD API. The actual work is done
 * by the Rust side (tauri-plugin-notification, registered in src-tauri/src/
 * lib.rs) which installs a `window.Notification` shim that routes to the OS.
 *
 * So the standard API is the right call on both platforms, and adding the npm
 * package would be adding a dependency to call something already on `window`.
 *
 * ── What each platform can actually do ──────────────────────────────────────
 *
 *   browser, tab open     Notification API → OS notification
 *   browser, tab closed   Web Push, from the server (sendPush). Not this file.
 *   .exe, running         the same Notification API → Windows toast, via the
 *                         Rust plugin's shim. Nothing here is Tauri-specific
 *                         except the permission check below.
 *   .exe, closed          nothing reaches it. There is no background process,
 *                         and adding one to deliver a toast is not a trade
 *                         worth making. Minimise instead of quitting.
 */

/* ── Are we inside the desktop build? ────────────────────────────────────────
   Used for exactly one thing — the permission check below. __TAURI_INTERNALS__
   is what Tauri v2 injects; v1 used __TAURI__. Both are checked because the
   answer changing silently is worse than the extra clause. */
const isTauri = () =>
  typeof window !== 'undefined' &&
  (window.__TAURI_INTERNALS__ !== undefined || window.__TAURI__ !== undefined);

/* ── The sound ───────────────────────────────────────────────────────────────

   Synthesised rather than an .mp3 in /public, and that is deliberate. A bundled
   asset needs a URL that resolves in the dev server, in the built site, and
   inside the .exe where the app is served from a custom protocol — three places
   to get a path wrong, for two notes. WebAudio has no path.

   One AudioContext, made on first use. Browsers refuse to start one before the
   user has interacted with the page, so constructing it at import time would
   produce a permanently suspended context and no sound ever. */
let ctx = null;

function audio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

/**
 * A two-note rise. Short, quiet, and not a system alert sound — this fires
 * while somebody is working, and anything sharper becomes the thing they mute
 * on day two.
 */
export function playChime() {
  try {
    const ac = audio();
    if (!ac) return;

    // Autoplay policy leaves the context suspended until a gesture. Resuming is
    // a no-op once it is running, and the promise is ignored on purpose: if the
    // user has not clicked anything yet there is nothing to be done about it,
    // and an unhandled rejection in a notification helper is not worth having.
    if (ac.state === 'suspended') ac.resume().catch(() => {});

    const now = ac.currentTime;
    // E5 then A5 — a fourth, which reads as "arrived" rather than "wrong".
    [[659.25, 0], [880, 0.11]].forEach(([hz, at]) => {
      const osc  = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;

      // An envelope, not a straight on/off. A square-edged gate on a sine wave
      // clicks audibly at both ends, which is the difference between a chime
      // and a fault.
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.13, now + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.28);

      osc.connect(gain).connect(ac.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.3);
    });
  } catch { /* a missing sound must never break the badge */ }
}

/* ── The system notification ─────────────────────────────────────────────── */

/** Ask once, remember the answer. */
let permission = null;

/**
 * The one place the desktop build differs.
 *
 * In a browser, Notification.permission is the whole answer. In the .exe it can
 * sit at 'default' while the OS has already decided — Windows grants toast
 * permission to an installed app, and there is no prompt to show. The Rust
 * plugin knows; the DOM does not.
 *
 * So when the DOM says 'default' AND we are in Tauri, ask the plugin directly.
 * This is exactly what the official package's isPermissionGranted() does — the
 * same command string, invoked through @tauri-apps/api, which is already a
 * dependency. Reimplementing four lines beats adding a package to call them.
 */
async function tauriPermissionGranted() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke('plugin:notification|is_permission_granted')) === true;
  } catch {
    // The plugin is not registered, or this build predates it. Falling back to
    // "no notification" is right: a missing toast is a nuisance, and throwing
    // here would take the badge down with it.
    return false;
  }
}

async function ensurePermission() {
  if (permission !== null) return permission;

  try {
    if (typeof Notification === 'undefined') { permission = false; return permission; }

    if (Notification.permission === 'granted') { permission = true;  return permission; }
    if (Notification.permission === 'denied')  { permission = false; return permission; }

    // 'default' — nobody has been asked yet.
    if (isTauri()) {
      permission = await tauriPermissionGranted();
      if (permission) return permission;
    }

    permission = (await Notification.requestPermission()) === 'granted';
    return permission;
  } catch {
    permission = false;
    return permission;
  }
}

/**
 * Raise a system notification.
 *
 * The standard API on both platforms — see the note at the top of this file:
 * inside the .exe, `window.Notification` is the Rust plugin's shim and this
 * becomes a Windows toast.
 */
export async function notifyDesktop({ title, body, onClick }) {
  try {
    if (!(await ensurePermission())) return;

    const n = new Notification(title, {
      body,
      // A tag rather than a stream of toasts. Four messages while somebody is
      // at lunch should leave ONE notification saying so, not four stacked ones
      // they have to dismiss individually.
      tag: 'spinoto-whatsapp',
      renotify: true,
    });

    // Best effort. A browser fires this reliably; the desktop shim reports
    // activation through its own listener with its own permission, so it may
    // not. Not worth wiring that up to focus a window already on screen —
    // clicking the badge is one move away.
    if (onClick) {
      n.onclick = () => { try { window.focus(); n.close(); } catch {} onClick(); };
    }
  } catch { /* never break the caller */ }
}

/**
 * Sound and notification together — the normal call.
 *
 * `silentSystem` skips the OS notification while keeping the sound. Passed when
 * the CRM is the window on screen: the in-app card in the corner has already
 * said it, and a system toast on top would be the same message announced twice
 * — once by us, once by Windows — for somebody who is already looking at it.
 *
 * The chime still plays, because the eye may be on the other half of the
 * screen even when the window is focused.
 */
export async function announce({ title, body, onClick, sound = true, silentSystem = false }) {
  if (sound) playChime();
  if (silentSystem) return;
  await notifyDesktop({ title, body, onClick });
}
