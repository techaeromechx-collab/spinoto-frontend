/**
 * Socket.io-client singleton.
 *
 * Usage:
 *   import socket from '../lib/socket';
 *   socket.on('invalidate', ({ topic }) => { ... });
 *   socket.off('invalidate', handler);
 *
 * The connection is lazy — it opens the first time this module is imported
 * and is shared across the entire app.
 */

import { io } from 'socket.io-client';

// Connect to the backend server — same URL the REST client uses.
const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const socket = io(BACKEND_URL, {
  // Don't auto-connect until the user is authenticated.
  // We call socket.connect() in AuthContext after login.
  autoConnect: false,

  /* Who this tab is, so the server can put it in its own user room and nudge
     only the people a change actually concerns (backend/src/socket.js).

     Nothing sensitive rides on the socket either way — the payload is still
     just { topic }. This decides who gets told to re-fetch, nothing more.

     A FUNCTION, not an object, and that is the whole reason it works.
     socket.io re-evaluates `auth` on every connect AND every reconnect, so a
     tab that drops and comes back reconnects with the token that is current
     now. As a plain object the token would be read once, when this module is
     first imported — which on a cold load is before login, so it would be null
     forever, and after a re-login it would still be the previous one.

     No token is fine. The server accepts the connection, the tab keeps every
     broadcast it has always had, and it simply hears nothing about chat.

     The key is spelled out rather than imported as getToken() from
     api/client.js, because client.js imports THIS module for socket.id. That
     cycle resolves in ES modules but only by luck of evaluation order, and a
     broken socket at import time takes the whole app with it. One string is
     the cheaper risk; if it ever changes, it changes in both files. */
  auth: (cb) => cb({ token: localStorage.getItem('spinoto.token') }),

  // Reconnect automatically on drop.
  reconnection: true,
  reconnectionDelay: 2000,
  reconnectionAttempts: 20,
});

export default socket;
