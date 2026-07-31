/**
 * Client-side polling intervals.
 *
 * These live here rather than in a component because two separate shells poll
 * the same endpoint: AppShell (the main app) and HubDashboardPage (the hub
 * portal, which App.jsx renders "standalone, no AppShell"). The hub portal
 * cannot inherit AppShell's effect, and importing AppShell just for a number
 * would pull the whole admin shell into the hub route.
 *
 * Why this number matters: the database is serverless (Neon). It bills per
 * hour of uptime and suspends after 5 minutes with no queries. A poll shorter
 * than that keeps it awake permanently — one tab left open overnight was
 * enough to prevent it ever sleeping. Polling is therefore also gated on
 * document.visibilityState wherever these are used.
 *
 * If the database ever moves to flat-rate hosting (a VPS running its own
 * Postgres), these can safely come back down.
 */

/** Unread-notification badge refresh, while the tab is visible. */
export const NOTIF_POLL_MS = 120_000;
