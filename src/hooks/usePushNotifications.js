/**
 * usePushNotifications.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles the full push subscription lifecycle:
 *  1. Fetch VAPID public key from backend
 *  2. Request notification permission from browser
 *  3. Subscribe via SW pushManager
 *  4. POST subscription to /api/push/subscribe
 *
 * Called once from PushSubscriber.jsx on app load.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect } from 'react';
import { api } from '../api/client.js';

// Convert VAPID base64 public key to Uint8Array (required by pushManager)
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export function usePushNotifications(user) {
  useEffect(() => {
    // Only run when user is logged in and browser supports push
    if (!user?.id) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    // Don't re-subscribe if already done for this user on this device
    const storageKey = `push_subscribed_${user.id}`;
    if (localStorage.getItem(storageKey) === 'true') return;

    // Don't prompt if already denied
    if (Notification.permission === 'denied') return;

    async function subscribe() {
      try {
        // 1. Fetch VAPID public key
        const { key } = await api('/api/push/vapid-public-key');
        if (!key) return;

        // 2. Wait for the SW to be ready
        const registration = await navigator.serviceWorker.ready;

        // 3. Check existing subscription
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
          // 4. Request permission (browser shows the allow/deny prompt)
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') return;

          // 5. Subscribe
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly:      true,
            applicationServerKey: urlBase64ToUint8Array(key),
          });
        }

        // 6. Send subscription to backend
        await api('/api/push/subscribe', {
          method: 'POST',
          body: {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('p256dh')))),
              auth:   btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('auth')))),
            },
          },
        });

        localStorage.setItem(storageKey, 'true');
      } catch (err) {
        // Never crash the app
        console.warn('[PushNotifications] subscription failed:', err.message);
      }
    }

    // Small delay so it doesn't fire during initial page load
    const timer = setTimeout(subscribe, 3000);
    return () => clearTimeout(timer);
  }, [user?.id]);
}
