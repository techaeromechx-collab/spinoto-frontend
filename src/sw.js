/**
 * sw.js — Spinoto Custom Service Worker
 * ─────────────────────────────────────────────────────────────────────────────
 * This file is the source for the service worker in injectManifest mode.
 * Vite-plugin-pwa injects the precache manifest into self.__WB_MANIFEST.
 *
 * Caching strategies are identical to the previous generateSW config.
 * Push notification handling is added at the bottom.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { createHandlerBoundToURL } from 'workbox-precaching';

// ── Core ──────────────────────────────────────────────────────────────────────
self.skipWaiting();
clientsClaim();

// ── Precache (manifest injected by vite-plugin-pwa) ──────────────────────────
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ── SPA navigation fallback ───────────────────────────────────────────────────
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// ── Google Fonts ──────────────────────────────────────────────────────────────
registerRoute(
  /^https:\/\/fonts\.googleapis\.com\/.*/i,
  new CacheFirst({
    cacheName: 'google-fonts-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
  'GET'
);

registerRoute(
  /^https:\/\/fonts\.gstatic\.com\/.*/i,
  new CacheFirst({
    cacheName: 'gstatic-fonts-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
  'GET'
);

/* ── Never cached, whatever the strategy below says ──────────────────────────
 *
 * The rule under this one caches every GET /api/* response for five minutes.
 * That is right for a list of vehicle makes and wrong for a conversation, for
 * two separate reasons:
 *
 *   Staleness. A cache hit means a thread that is five minutes behind, and the
 *   socket nudge that says "there is a new message" would be answered out of
 *   the cache with a reply that does not contain it. The nudge would look
 *   broken when the cache was the thing at fault.
 *
 *   Whose browser this is. `api-cache` is keyed on the URL and nothing else —
 *   not the user, not the token. It survives logout, because logout only clears
 *   localStorage. The next person to sign in on a shared workshop machine, or
 *   the same person on a kiosk, would have the previous user's private messages
 *   sitting in Cache Storage, served to any request that matched the URL.
 *
 * Which is why this is an exclusion list and not a comment asking people to be
 * careful. Anything per-user and private belongs here.
 */
const NEVER_CACHE = [/^\/api\/chat\//];

// ── API (network-first, 5-min cache) ─────────────────────────────────────────
registerRoute(
  ({ url, request }) =>
    url.pathname.startsWith('/api/') &&
    request.method === 'GET' &&
    !NEVER_CACHE.some((re) => re.test(url.pathname)),
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 30,
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 5 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
  'GET'
);

// ── Static images ─────────────────────────────────────────────────────────────
registerRoute(
  /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
  new CacheFirst({
    cacheName: 'images-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
  'GET'
);

// ── Push Notification Handler ─────────────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;

  let data = {};
  try { data = event.data.json(); } catch { data = { title: 'Spinoto', body: event.data.text() }; }

  const title   = data.title || 'Spinoto';
  const options = {
    body:    data.body  || '',
    icon:    '/icons/icon-192x192.png',
    badge:   '/icons/icon-96x96.png',
    tag:     data.type  || 'spinoto',
    renotify: true,
    data:    { url: data.url || '/' },
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification Click Handler ────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // If app already open, focus it and navigate
      for (const client of windowClients) {
        if ('focus' in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
