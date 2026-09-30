/**
 * navItems.js — the sidebar, as data.
 *
 * ══ WHY THIS MOVED OUT OF AppShell.jsx ═════════════════════════════════════
 *
 * It belonged there as long as the sidebar was the only thing that needed to
 * know what screens exist. Keyboard shortcuts need the same answer: which
 * destinations there are, what each is called, and which permissions it takes.
 *
 * The alternative was a second list inside the shortcut settings, and this
 * codebase has already paid for that mistake once — utils/leadScope.js carries
 * the note about three copies of the lead rule that "had already drifted". A
 * second copy here fails more quietly still: somebody adds a page to the
 * sidebar, forgets the shortcut table, and half the team has a binding to a
 * screen that is not there.
 *
 * Importing AppShell from the shortcut code instead would have been a circular
 * import — AppShell renders the hook that would import AppShell. So the list
 * moved somewhere neither side owns.
 *
 * ── The contract ──
 *   label        what the sidebar row and the shortcut row both say
 *   to           the route
 *   permissions  ANY of these; an empty array means any signed-in user
 *   icon         a lucide component
 *   section      matches NAV_SECTIONS[].key
 */

import {
  BarChart3, Building2, Calendar, Car, ClipboardCheck, ClipboardList, Clock,
  CreditCard, FileText, LayoutDashboard, MapPin, MessagesSquare, Network,
  Package, Percent, Receipt, ReceiptText, Settings, ShieldCheck, Store, Tag,
  UploadCloud, Users, Users2, Wallet, Wrench,
} from 'lucide-react';

/**
 * Sidebar sections. Fixed order; a header only renders when at least one of
 * its items survives permission filtering.
 *
 *   key         matches NAV_ITEMS[].section
 *   label       shown on the header row. Sentence case, not ALL CAPS: a caption
 *               can be shouty, a button people click should not be.
 *   collapsible false → the items render flat with no header at all. OVERVIEW
 *               holds only Dashboard and Chat, and a dropdown you open to
 *               reveal one link is worse than the link.
 */
export const NAV_SECTIONS = [
  { key: 'OVERVIEW',    label: null,          collapsible: false },
  { key: 'MASTER DATA', label: 'Master Data', collapsible: true  },
  { key: 'WORKFLOW',    label: 'Workflow',    collapsible: true  },
  { key: 'SALES',       label: 'Sales',       collapsible: true  },
  { key: 'ACCOUNTING',  label: 'Accounting',  collapsible: true  },
  { key: 'CUSTOMERS',   label: 'Customers',   collapsible: true  },
  { key: 'SYSTEM',      label: 'System',      collapsible: true  },
  /* Reports sits below the card, flat, the way Dashboard sits above it. It is
     a destination people go to directly and often, and burying it a click deep
     inside System — beside Bulk Upload, which is touched once a quarter — costs
     that click every time to save one row. Same `collapsible: false` path
     OVERVIEW already uses; no new render branch. */
  { key: 'TOOLS',       label: null,          collapsible: false },
];

export const NAV_ITEMS = [
  // ── Overview ──────────────────────────────────────────────────────────────
  { label: 'Dashboard',    to: '/',           permissions: [],                            icon: LayoutDashboard, section: 'OVERVIEW' },
  // OVERVIEW, beside Dashboard, rather than inside a collapsible fold. Chat is
  // checked many times a day and a nav item behind a closed section is a nav
  // item nobody uses. Gated on USE_CHAT exactly as the route is
  // (App.jsx) — one permission, so the sidebar and the page can never disagree.
  { label: 'Chat',         to: '/chat',       permissions: ['USE_CHAT'],                  icon: MessagesSquare,  section: 'OVERVIEW' },

  // ── Master Data ───────────────────────────────────────────────────────────
  // These were `children` of a "Master Data" item nested inside WORKFLOW. With
  // sections themselves collapsible that would have been a dropdown inside a
  // dropdown — two clicks to reach a page. They are now an ordinary section, so
  // the whole nested-item code path is gone.
  //
  // The old parent also carried its own permission list, which had to be kept
  // in union with its children's or the group vanished for someone who could
  // see a page inside it. A section is shown when at least one of its items
  // survives the filter, so there is nothing left to keep in sync.
  { label: 'Locations',            to: '/master/locations',     permissions: ['MANAGE_MASTER_DATA'],                                          icon: MapPin,     section: 'MASTER DATA' },
  { label: 'Vehicles',             to: '/master/vehicles',      permissions: ['VIEW_VEHICLE','CREATE_VEHICLE','UPDATE_VEHICLE','MANAGE_MASTER_DATA'], icon: Car,   section: 'MASTER DATA' },
  { label: 'Services & Pricing',   to: '/master/services',      permissions: ['VIEW_SERVICE','VIEW_PRICING_RULE','MANAGE_MASTER_DATA','MANAGE_PRICING'], icon: Wrench, section: 'MASTER DATA' },
  { label: 'Lead Status',          to: '/master/lead-statuses', permissions: ['MANAGE_MASTER_DATA'],                                          icon: Tag,        section: 'MASTER DATA' },
  { label: 'Departments',          to: '/master/departments',   permissions: ['MANAGE_MASTER_DATA'],                                          icon: Building2,  section: 'MASTER DATA' },
  { label: 'Checklists',           to: '/master/checklists',    permissions: ['MANAGE_MASTER_DATA'],                                          icon: ClipboardCheck, section: 'MASTER DATA' },
  { label: 'Technicians',          to: '/master/technicians',   permissions: ['MANAGE_MASTER_DATA','MANAGE_HUBS','EDIT_HUB'],                 icon: Users,      section: 'MASTER DATA' },
  { label: 'Parts',                to: '/master/parts',         permissions: ['MANAGE_PARTS','CREATE_PART','EDIT_PART','DELETE_PART','MANAGE_MASTER_DATA'], icon: Package, section: 'MASTER DATA' },
  { label: 'Discounts',            to: '/master/discounts',     permissions: ['MANAGE_DISCOUNTS','CREATE_DISCOUNT','EDIT_DISCOUNT','DELETE_DISCOUNT','MANAGE_MASTER_DATA'], icon: Percent, section: 'MASTER DATA' },
  { label: 'Warranty & Guarantee', to: '/master/warranties',    permissions: ['MANAGE_WARRANTIES','CREATE_WARRANTY','EDIT_WARRANTY','DELETE_WARRANTY','MANAGE_MASTER_DATA'], icon: ShieldCheck, section: 'MASTER DATA' },

  // ── Workflow ──────────────────────────────────────────────────────────────
  // Above HUBs: a Workshop is the stage before one, and the nav should read in
  // the order the work happens.
  { label: 'Workshops',    to: '/workshops',    permissions: ['VIEW_WORKSHOP','CREATE_WORKSHOP','EDIT_WORKSHOP','MANAGE_HUBS'], icon: Store, section: 'WORKFLOW' },
  { label: 'HUBs',         to: '/hubs',         permissions: ['VIEW_HUB','MANAGE_HUBS','CREATE_HUB','EDIT_HUB'], icon: Network, section: 'WORKFLOW' },
  { label: 'Leads',        to: '/leads',        permissions: ['VIEW_LEAD','VIEW_TEAM_LEADS','VIEW_OWN_LEADS','CREATE_LEAD'], icon: Users, section: 'WORKFLOW' },
  /* Directly under Leads: it is a view OF leads, and the two are worked
     together. Permissions mirror canFollowUp in routes/lead_events.routes.js —
     offering a tab the API will refuse is worse than not offering it. */
  { label: 'Follow-ups',   to: '/follow-ups',   permissions: ['MANAGE_FOLLOW_UPS','VIEW_LEAD','VIEW_TEAM_LEADS','VIEW_OWN_LEADS','CREATE_LEAD','EDIT_LEAD'], icon: Clock, section: 'WORKFLOW' },
  { label: 'Appointments', to: '/appointments', permissions: ['VIEW_APPOINTMENT','VIEW_LEAD','CREATE_APPOINTMENT'], icon: Calendar, section: 'WORKFLOW' },
  /* Directly under Appointments, and in that order, because that is the order
     the work happens in: an appointment becomes a job card becomes a set of
     inspections.

     Their OWN permissions since migration 203, no longer the appointment's: an
     agent who books and reschedules has no business on the workshop screen, and
     that could not be said while all three shared one code. These two rows also
     differ from each other on purpose — a QC inspector holding VIEW_JOB_CARD +
     VIEW_INSPECTION sees both, while somebody given only the inspection codes
     sees Inspections and not Job Cards, which is right, because the card is
     where parts and labour live.

     Inspections is the QUEUE of runs, not the templates. Master data →
     Checklists is the templates, and the two live in different sections on
     purpose: editing a checklist is a quarterly decision, finding the sheet
     that has been half-answered since Tuesday is a Thursday afternoon. */
  { label: 'Job Cards',    to: '/job-cards',    permissions: ['VIEW_JOB_CARD','EDIT_JOB_CARD'], icon: ClipboardList,  section: 'WORKFLOW' },
  { label: 'Inspections',  to: '/inspections',  permissions: ['VIEW_INSPECTION','EDIT_INSPECTION'], icon: ClipboardCheck, section: 'WORKFLOW' },

  // ── Sales ─────────────────────────────────────────────────────────────────
  { label: 'Estimates',          to: '/estimates',         permissions: ['VIEW_ESTIMATE','CREATE_ESTIMATE','EDIT_ESTIMATE'],     icon: FileText, section: 'SALES' },
  { label: 'Customer Invoices', to: '/customer-invoices', permissions: ['VIEW_INVOICE','CREATE_INVOICE','EDIT_INVOICE'],         icon: Receipt, section: 'SALES' },

  // ── Accounting ────────────────────────────────────────────────────────────
  { label: 'Purchase Invoices', to: '/purchase-invoices', permissions: ['VIEW_PURCHASE_INVOICE','CREATE_PURCHASE_INVOICE','APPROVE_PURCHASE_INVOICE'], icon: ReceiptText, section: 'ACCOUNTING' },
  // Mirrors canView in backend/src/routes/hub_payouts.routes.js — that list is
  // canonical, this one follows it, and test/hubpayoutperms.test.js fails if
  // they differ. VIEW_HUB used to be here and is not on the backend, so the
  // link appeared for people whose every request on the page then 403'd;
  // VIEW_HUB_PAYOUTS was missing, so the permission named for this screen did
  // nothing at all.
  { label: 'Hub Payouts',       to: '/payouts',           permissions: ['VIEW_HUB_PAYOUTS','MANAGE_HUBS','VIEW_PURCHASE_INVOICE','VIEW_PAYMENTS'], icon: Wallet, section: 'ACCOUNTING' },
  { label: 'Hub Ledger',        to: '/payables',          permissions: ['VIEW_PURCHASE_INVOICE','VIEW_HUB_PAYOUTS','MANAGE_HUBS'], icon: Wallet, section: 'ACCOUNTING' },
  // Money IN, beside the two screens for money out.
  //
  // Gated on VIEW_PAYMENTS alone, not the usual any-of list. COLLECT_PAYMENT is
  // an action taken from an invoice a person is already looking at; being
  // trusted to take one payment is not the same as being shown the ledger of
  // every payment the company has ever received.
  { label: 'Payments',          to: '/payments',          permissions: ['VIEW_PAYMENTS'],                                        icon: CreditCard, section: 'ACCOUNTING' },

  // ── Customers ─────────────────────────────────────────────────────────────
  { label: 'Customers',         to: '/customers',         permissions: ['VIEW_CUSTOMER','VIEW_LEAD','CREATE_LEAD'],              icon: Users2, section: 'CUSTOMERS' },
  { label: 'Claims',            to: '/warranty-claims',   permissions: ['VIEW_CLAIM','CREATE_CLAIM','APPROVE_CLAIM','RESOLVE_CLAIM','MANAGE_CLAIMS'], icon: ShieldCheck, section: 'CUSTOMERS' },

  // ── System ────────────────────────────────────────────────────────────────
  { label: 'Bulk Upload', to: '/bulk-upload', permissions: ['BULK_UPLOAD'],             icon: UploadCloud, section: 'SYSTEM' },
  // 'Users'/'My Team' and 'Super Admins' used to be separate top-level items
  // pointing at /users and /super-admins — both pages now live as tabs
  // inside the consolidated Settings module (those two routes just redirect
  // there now). A single 'Settings' entry replaces all three; internal tab
  // visibility (Manage Users / Super Admins / etc.) is gated inside
  // SettingsPage.jsx itself, same as /profile's tabs always were.
  { label: 'Settings',     to: '/settings',     permissions: [],                                                        icon: Settings, section: 'SYSTEM'  },

  // ── Tools (flat, below the card) ──────────────────────────────────────────
  { label: 'Reports',     to: '/reports',     permissions: ['VIEW_REPORTS'],            icon: BarChart3, section: 'TOOLS' },
];
