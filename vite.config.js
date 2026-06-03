import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      // ── Registration strategy ────────────────────────────────
      // autoUpdate: silently updates the SW whenever a new build is deployed.
      // No prompt needed – next page load picks up the new version.
      registerType: 'autoUpdate',

      // Include all built assets in the SW precache
      includeAssets: [
        'favicon.ico',
        'apple-touch-icon.png',
        'icons/*.png',
        'offline.html',
      ],

      // ── Dev options ─────────────────────────────────────────
      devOptions: {
        enabled: false,
      },

      // ── Workbox configuration ────────────────────────────────
      workbox: {
        // Precache all Vite build outputs (JS, CSS, HTML)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,woff,ttf}'],

        // Skip waiting so the new SW activates immediately after install
        skipWaiting: true,
        clientsClaim: true,

        // Offline fallback: serve /offline.html for any navigation request
        // that fails when the user is offline
        navigateFallback: '/offline.html',
        navigateFallbackDenylist: [
          // Don't intercept API calls or backend routes
          /^\/api\//,
          /^\/auth\//,
        ],

        // ── Runtime caching strategies ──────────────────────────
        runtimeCaching: [
          // ── Google Fonts ──────────────────────────────────────
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },

          // ── Safe API caching (GET only, network-first) ────────
          // This caches successful API responses so the app shows
          // stale data when offline rather than a blank screen.
          {
            urlPattern: ({ url, request }) =>
              url.pathname.startsWith('/api/') && request.method === 'GET',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              // 30-second timeout — enough for Render free tier cold start
              networkTimeoutSeconds: 30,
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 5, // 5 minutes
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },

          // ── Static image assets ───────────────────────────────
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },

      // ── Web App Manifest ─────────────────────────────────────
      manifest: {
        name: 'Spinoto',
        short_name: 'Spinoto',
        description: 'Spinoto — Lead Management & POS Portal for automotive service hubs',
        theme_color: '#000000',
        background_color: '#ffffff',
        display: 'fullscreen',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        id: '/',

        icons: [
          {
            src: '/icons/icon-72x72.png',
            sizes: '72x72',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-96x96.png',
            sizes: '96x96',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-128x128.png',
            sizes: '128x128',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-144x144.png',
            sizes: '144x144',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-152x152.png',
            sizes: '152x152',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-maskable-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/icon-384x384.png',
            sizes: '384x384',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],

        // Desktop / Chrome OS window colors
        display_override: ['window-controls-overlay', 'standalone', 'browser'],

        // Shortcuts (quick-launch from long-press on Android)
        shortcuts: [
          {
            name: 'Leads',
            short_name: 'Leads',
            description: 'Open Leads',
            url: '/leads',
            icons: [{ src: '/icons/icon-96x96.png', sizes: '96x96' }],
          },
          {
            name: 'Appointments',
            short_name: 'Appts',
            description: 'Open Appointments',
            url: '/appointments',
            icons: [{ src: '/icons/icon-96x96.png', sizes: '96x96' }],
          },
        ],

        // Screenshots for the Chrome install dialog (optional but nice)
        screenshots: [],
      },
    }),
  ],

  server: {
    port: 5173,
    host: true,
  },
});
