/**
 * Is this build running inside the Tauri desktop shell?
 *
 * Checks the global Tauri injects rather than importing @tauri-apps/api, so the
 * WEB bundle gains nothing it will never call. That is the whole point of this
 * file: crm.spinoto.ai must be byte-for-byte unaffected by the desktop app
 * existing.
 *
 * `__TAURI_INTERNALS__` is the Tauri 2 global. Tauri 1 used `__TAURI__` — if you
 * find a snippet online checking for that, it is v1 advice and does not apply
 * here. Both are checked anyway, because the cost is one `||` and the failure
 * mode of getting it wrong is silent: `isDesktop()` returns false, the desktop
 * app quietly takes every browser code path, and PDFs stop opening with no
 * error to search for.
 *
 * The `typeof window` guard is for safety under any future SSR or test runner
 * that evaluates modules without a DOM. It costs nothing today.
 */
export function isDesktop() {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

export default isDesktop;
