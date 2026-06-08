import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      // ── Registration strategy ────────────────────────────────
      registerType: 'autoUpdate',

      // Use injectManifest so we can add push handlers to the SW
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',

      // Include all built assets in the SW precache
      includeAssets: [
        'favicon.ico',
        'apple-touch-icon.png',
        'icons/*.png',
      ],

      // ── Dev options ─────────────────────────────────────────
      devOptions: {
        enabled: false,
      },

      // ── injectManifest config ────────────────────────────────
      // Caching strategies are defined in src/sw.js directly.
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,woff,ttf}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
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
