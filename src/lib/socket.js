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
  // Reconnect automatically on drop.
  reconnection: true,
  reconnectionDelay: 2000,
  reconnectionAttempts: 20,
});

export default socket;
