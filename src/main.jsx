import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import { UploadProvider } from './context/UploadContext.jsx';
import { isDesktop } from './utils/isDesktop.js';
import './styles/app.css';

// ── Google Fonts ─────────────────────────────────────────────────
const fontLink = document.createElement('link');
fontLink.rel = 'stylesheet';
fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
document.head.appendChild(fontLink);

// ── PWA Service Worker Registration ──────────────────────────────
// vite-plugin-pwa with registerType:'autoUpdate' generates a virtual
// module 'virtual:pwa-register' that handles SW registration and
// auto-reloading when a new build is deployed. We import it lazily
// so it has zero effect on the dev server (devOptions.enabled=false).
//
// Skipped in the desktop app. A service worker cannot register on Tauri's
// custom protocol, and everything this one does for the web — precache assets,
// detect a new deploy, reload — is the installer's job on desktop. Registering
// it there would fail silently and leave `registerSW` polling forever.
//
// WEB BEHAVIOUR IS UNCHANGED: in a browser isDesktop() is false, so this reads
// exactly as it did before.
if ('serviceWorker' in navigator && import.meta.env.PROD && !isDesktop()) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      // Called when a new SW is waiting; we reload immediately since
      // registerType is 'autoUpdate' — the SW handles skipWaiting itself.
      onNeedRefresh() {
        // autoUpdate: the new SW already called skipWaiting + clientsClaim,
        // so we can quietly reload to pick up the latest assets.
        window.location.reload();
      },
      onOfflineReady() {
        // Optional: log when the app is fully cached for offline use.
        console.info('[Spinoto PWA] App is ready to work offline.');
      },
      onRegistered(r) {
        if (r) {
          // Poll for updates every hour so long-lived sessions get refreshed.
          setInterval(() => r.update(), 60 * 60 * 1000);
        }
      },
      onRegisterError(error) {
        console.warn('[Spinoto PWA] Service worker registration failed:', error);
      },
    });
  });
}

// ── React Root ───────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <UploadProvider>
          <App />
        </UploadProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
