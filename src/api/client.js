const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const TOKEN_KEY = 'spinoto.token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/**
 * Thin wrapper around fetch that attaches the JWT and parses JSON.
 * Throws an Error with the server's `error` message on non-2xx responses.
 */
export async function api(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (auth) {
    const token = getToken();
    if (token) opts.headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_URL}${path}`, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }

  if (!res.ok) {
    let msg = (data && data.error) || `HTTP ${res.status}`;

    // Translate raw server errors into human-readable messages
    if (res.status === 403) {
      if (msg.toLowerCase().startsWith('missing permission')) {
        msg = "You don't have permission to do this. Please contact your administrator.";
      } else if (msg.toLowerCase().includes('disabled')) {
        msg = 'Your account has been disabled. Please contact your administrator.';
      }
    } else if (res.status === 401 && !path.includes('/auth/')) {
      // Only show "session expired" for authenticated calls, not for login itself
      msg = 'Your session has expired. Please log in again.';
    }

    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
