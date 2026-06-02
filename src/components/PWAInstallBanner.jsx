/**
 * PWAInstallBanner
 * ─────────────────
 * Shows a subtle bottom banner on Chrome/Edge/Android when the
 * browser fires the `beforeinstallprompt` event (i.e., the app is
 * installable but not yet installed).
 *
 * - Dismissed permanently via localStorage key.
 * - Never shown on iOS (iOS uses the native "Add to Home Screen" flow).
 * - Never shown when already running in standalone (already installed).
 * - Zero effect on the existing desktop or mobile layout.
 */

import { useEffect, useState } from 'react';

const DISMISSED_KEY = 'spinoto_pwa_install_dismissed';

export default function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible]               = useState(false);

  useEffect(() => {
    // Already installed — standalone mode
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    // Already dismissed
    if (localStorage.getItem(DISMISSED_KEY)) return;

    const handler = (e) => {
      e.preventDefault();          // stop Chrome's mini-infobar
      setDeferredPrompt(e);
      setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      console.info('[Spinoto PWA] User accepted the install prompt.');
    }
    setVisible(false);
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, '1');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="pwa-install-banner" role="dialog" aria-label="Install Spinoto app">
      <img
        className="pwa-install-banner__icon"
        src="/icons/icon-96x96.png"
        alt="Spinoto icon"
      />
      <div className="pwa-install-banner__text">
        <strong>Install Spinoto</strong>
        <span>Add to home screen for quick access</span>
      </div>
      <button className="pwa-install-banner__btn" onClick={handleInstall}>
        Install
      </button>
      <button
        className="pwa-install-banner__close"
        onClick={handleDismiss}
        aria-label="Dismiss install prompt"
      >
        ✕
      </button>
    </div>
  );
}
