import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/LandingPage.css';

/* ─── Scroll Reveal ──────────────────────────────────────────────── */
function useScrollReveal() {
  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('is-revealed'); }),
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    );
    document.querySelectorAll('[data-reveal]').forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);
}

/* ─── Animated Counter ───────────────────────────────────────────── */
function AnimCounter({ to, prefix = '', suffix = '' }) {
  const [val, setVal] = useState(0);
  const ref  = useRef(null);
  const done = useRef(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !done.current) {
        done.current = true;
        let i = 0;
        const steps = 60, dur = 1600;
        const id = setInterval(() => {
          i++;
          setVal(Math.round((i / steps) * to));
          if (i >= steps) clearInterval(id);
        }, dur / steps);
      }
    }, { threshold: 0.5 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [to]);
  return <span ref={ref}>{prefix}{val}{suffix}</span>;
}

/* ─── Screenshot wrapper — shows real img, falls back to CSS mockup ─ */
function AppScreen({ src, alt, children, className = '' }) {
  const [failed, setFailed] = React.useState(false);
  return failed || !src ? (
    <div className={`app-screen-fallback ${className}`}>{children}</div>
  ) : (
    <img
      src={src}
      alt={alt}
      className={`app-screen-img ${className}`}
      onError={() => setFailed(true)}
    />
  );
}

/* ─── Hero Dashboard Mockup (CSS fallback) ───────────────────────── */
function HeroMockupFallback() {
  return (
    <div className="hm-wrap">
      {/* Sidebar */}
      <div className="hm-sidebar">
        <div className="hm-brand-text">Spinoto</div>
        {[
          { label:'Dashboard', active:true },
          { label:'Master Data' },
          { label:'HUBs' },
          { label:'Leads' },
          { label:'Appointments' },
          { label:'Estimates' },
          { label:'Customer Invoices' },
          { label:'Customers' },
          { label:'Reports' },
          { label:'Users' },
        ].map(({ label, active }) => (
          <div key={label} className={`hm-nav-item${active ? ' active' : ''}`}>{label}</div>
        ))}
        <div className="hm-new-lead-btn">+ New Lead</div>
      </div>
      {/* Main */}
      <div className="hm-main">
        {/* Topbar */}
        <div className="hm-topbar">
          <span className="hm-breadcrumb">Home</span>
          <div className="hm-search">🔍 Search leads, users...</div>
          <div className="hm-topbar-right">
            <div className="hm-notif-badge">99+</div>
            <div className="hm-user-chip">SA <span>Super Admin</span></div>
          </div>
        </div>
        {/* Content */}
        <div className="hm-content">
          <div className="hm-greeting">
            <div>
              <div className="hm-greeting-title">Good morning, <span style={{color:'#16b994'}}>Super</span></div>
              <div className="hm-greeting-date">Monday, 8 June 2026</div>
            </div>
            <div className="hm-action-btn">+ New Lead</div>
          </div>
          {/* KPI row */}
          <div className="hm-kpis">
            {[
              { label:"Today's Appointments", value:'0',    sub:'9 invoices this month' },
              { label:'Monthly Revenue',       value:'₹0',  sub:'Collected this month', color:'#16b994' },
              { label:'Pending Invoices',      value:'17',  sub:'₹33.6k outstanding', color:'#ef4444' },
              { label:'Lead Conversion',       value:'39.7%', sub:'25 of 63 leads', color:'#f59e0b' },
            ].map(({ label, value, sub, color }) => (
              <div key={label} className="hm-kpi-card">
                <div className="hm-kpi-label">{label}</div>
                <div className="hm-kpi-value" style={color ? {color} : {}}>{value}</div>
                <div className="hm-kpi-sub">{sub}</div>
              </div>
            ))}
          </div>
          {/* Stats strip */}
          <div className="hm-stats-strip">
            {['63 Total Leads','₹15k Pipeline','0 Appointments Today','31 Unassigned','8 Converted'].map(s => (
              <span key={s} className="hm-stat-pill">{s}</span>
            ))}
          </div>
          {/* 3-col bottom */}
          <div className="hm-bottom-grid">
            <div className="hm-widget">
              <div className="hm-widget-hdr"><span>● Pipeline Overview</span><span className="hm-widget-link">This Month ▾</span></div>
              <div className="hm-donut-wrap">
                <svg viewBox="0 0 80 80" width="72" height="72">
                  <circle cx="40" cy="40" r="32" fill="none" stroke="#e2e8f0" strokeWidth="10"/>
                  <circle cx="40" cy="40" r="32" fill="none" stroke="#16b994" strokeWidth="10" strokeDasharray="134 67" strokeDashoffset="24" strokeLinecap="round"/>
                </svg>
                <div className="hm-donut-center"><b>4</b><span>Total</span></div>
              </div>
              <div className="hm-pipeline-stats">
                <span>Conversion Rate <b>50%</b></span>
                <span>Pipeline Value <b style={{color:'#16b994'}}>₹6.6k</b></span>
              </div>
            </div>
            <div className="hm-widget">
              <div className="hm-widget-hdr"><span>● Hub Performance</span><span className="hm-widget-link">View all →</span></div>
              {[
                { name:'QuickFix Auto Hub',         leads:10, rev:'₹29.1k', w:90 },
                { name:'SpeedCare Garage',          leads:2,  rev:'₹1.6k',  w:40 },
                { name:'UrbanMoto Service Center',  leads:1,  rev:'—',      w:20 },
                { name:'Ahmedabad Premium HUB',     leads:0,  rev:'—',      w:5  },
              ].map(h => (
                <div key={h.name} className="hm-hub-row">
                  <div className="hm-hub-avatar">{h.name[0]}</div>
                  <div className="hm-hub-info">
                    <div className="hm-hub-name">{h.name}</div>
                    <div className="hm-hub-bar"><div className="hm-hub-fill" style={{width:`${h.w}%`}}/></div>
                  </div>
                  <div className="hm-hub-leads">{h.leads}</div>
                </div>
              ))}
            </div>
            <div className="hm-widget">
              <div className="hm-widget-hdr"><span>● Follow-ups <span className="hm-badge-count">3</span></span></div>
              <div className="hm-fu-tabs">
                {['Today','Tomorrow','This Week'].map((t,i) => (
                  <div key={t} className={`hm-fu-tab${i===0?' active':''}`}>{t}</div>
                ))}
              </div>
              {[
                { init:'R', name:'Raj Patel',   status:'Overdue', tag:'Retargeting' },
                { init:'M', name:'Meera Pillai',status:'Overdue', tag:'Retargeting' },
                { init:'X', name:'XYZ',         status:'Overdue', tag:'Follow-Up'   },
              ].map(f => (
                <div key={f.name} className="hm-fu-row">
                  <div className="hm-fu-init">{f.init}</div>
                  <div className="hm-fu-info">
                    <div className="hm-fu-name">{f.name}</div>
                    <div className="hm-fu-sub">Follow-up scheduled</div>
                  </div>
                  <div className="hm-fu-tag">{f.tag}</div>
                  <div className="hm-fu-done">✓ Done</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Leads Page Mockup (CSS fallback) ──────────────────────────── */
function LeadsMockupFallback() {
  return (
    <div className="page-mock">
      <div className="page-mock-header">
        <div>
          <div className="page-mock-title">Leads</div>
          <div className="page-mock-sub">Real-time overview of all customer inquiries.</div>
        </div>
        <div className="page-mock-btns">
          <div className="page-mock-btn-ghost">↓ Export CSV</div>
          <div className="page-mock-btn-primary">+ Capture New Lead</div>
        </div>
      </div>
      <div className="page-mock-tabs">
        {['Follow-ups 3','Today','Tomorrow','This Week','Custom'].map((t,i) => (
          <div key={t} className={`page-mock-tab${i===1?' active':''}`}>{t}</div>
        ))}
      </div>
      <div className="page-mock-filters">
        <div className="page-mock-search">🔍 Search by name or mobile...</div>
        <div className="page-mock-filter-chip">● All Statuses</div>
        <div className="page-mock-filter-chip">All Sources</div>
        <div className="page-mock-filter-chip">All team members</div>
      </div>
      <div className="page-mock-table">
        <div className="page-mock-th">
          <span>Date</span><span>Customer</span><span>Location</span><span>Vehicle</span><span>Service</span><span>Status</span>
        </div>
        {[
          { date:'04 Jun', name:'5656565654', loc:'Surat',      vehicle:'Hyundai Creta 4W',      svc:'AC Service',    status:'New Lead',              sc:'teal' },
          { date:'01 Jun', name:'xyz',        loc:'—',          vehicle:'Hyundai Tucson 4W',     svc:'Brake Pad',     status:'Follow-Up',             sc:'amber' },
          { date:'01 Jun', name:'Kisha P.',   loc:'Ahmedabad',  vehicle:'Tata Safari 4W',        svc:'Body Work',     status:'Appointment Scheduled', sc:'green' },
          { date:'01 Jun', name:'kishaa',     loc:'Bhopal',     vehicle:'Royal Enfield GT 2W',   svc:'—',             status:'Appointment Scheduled', sc:'green' },
        ].map((r, i) => (
          <div key={i} className="page-mock-row">
            <span className="page-mock-date">{r.date}</span>
            <span className="page-mock-name">{r.name}</span>
            <span>{r.loc}</span>
            <span>{r.vehicle}</span>
            <span>{r.svc}</span>
            <span className={`page-mock-status status-${r.sc}`}>{r.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Appointments Mockup (CSS fallback) ─────────────────────────── */
function ApptMockupFallback() {
  return (
    <div className="page-mock">
      <div className="page-mock-header">
        <div>
          <div className="page-mock-title">📅 Appointments</div>
          <div className="page-mock-sub">Track and manage all customer appointments.</div>
        </div>
        <div className="page-mock-btn-primary">+ New Appointment</div>
      </div>
      <div className="page-mock-table">
        <div className="page-mock-th">
          <span>#</span><span>Customer</span><span>Vehicle</span><span>Hub</span><span>Schedule</span><span>Total</span><span>Status</span>
        </div>
        {[
          { num:'#36', name:'Kisha Prajapati', vehicle:'GJ09EW6763 · Tata Safari',    hub:'QuickFix Auto Hub', date:'13 Jun 2026', total:'₹1,947', status:'Rescheduled',      sc:'amber'  },
          { num:'#35', name:'Sunil Nambiar',   vehicle:'GJ03AS5555 · Hyundai Venue',  hub:'QuickFix Auto Hub', date:'5 Jun 2026',  total:'₹998',   status:'Rescheduled',      sc:'amber'  },
          { num:'#34', name:'Anjali Singh',    vehicle:'GJ09GH5675 · VW Polo',        hub:'QuickFix Auto Hub', date:'3 Jun 2026',  total:'₹998',   status:'Work Completed',   sc:'green'  },
          { num:'#33', name:'Kisha Prajapati', vehicle:'GJ09EW6763 · Tata Safari',    hub:'SpeedCare Garage',  date:'1 Jun 2026',  total:'₹1,598', status:'Work Completed',   sc:'green'  },
          { num:'#31', name:'Deepak Gupta',    vehicle:'JK07GH4567 · Mahindra Scorpio',hub:'QuickFix Auto Hub',date:'17 Jun 2026', total:'₹4,994', status:'Invoice Approved', sc:'purple' },
        ].map(r => (
          <div key={r.num} className="page-mock-row">
            <span className="page-mock-appt-num">{r.num}</span>
            <span>{r.name}</span>
            <span className="page-mock-small">{r.vehicle}</span>
            <span className="page-mock-small">{r.hub}</span>
            <span className="page-mock-small">{r.date}</span>
            <span><b>{r.total}</b></span>
            <span className={`page-mock-status status-${r.sc}`}>{r.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Estimate Mockup (CSS fallback) ─────────────────────────────── */
function EstimateMockupFallback() {
  return (
    <div className="page-mock">
      <div className="page-mock-header">
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div className="page-mock-title">Estimate #27</div>
          <div className="page-mock-status-badge">Work Completed</div>
        </div>
        <div className="page-mock-btn-ghost">🖨 Print</div>
      </div>
      <div className="page-mock-est-grid">
        <div className="page-mock-est-box">
          <div className="page-mock-est-label">BILL TO</div>
          <div><b>Kisha Prajapati</b></div>
          <div className="page-mock-small">8849083612</div>
          <div className="page-mock-small">SpeedCare Garage</div>
        </div>
        <div className="page-mock-est-box">
          <div className="page-mock-est-label">VEHICLE & ESTIMATE</div>
          <div className="page-mock-est-row"><span>Reg. No.</span><b>GJ09EW6763</b></div>
          <div className="page-mock-est-row"><span>Make/Model</span><b>Tata Safari</b></div>
          <div className="page-mock-est-row"><span>Body Type</span><b>SUV (Petrol)</b></div>
          <div className="page-mock-est-row"><span>Date</span><b>02 Jun 2026</b></div>
        </div>
      </div>
      <div className="page-mock-li-table">
        <div className="page-mock-li-hdr">
          <span>SR.</span><span>ITEM</span><span>HSN/SAC</span><span>QTY</span><span>RATE</span><span>TOTAL</span>
        </div>
        <div className="page-mock-li-row">
          <span>1</span>
          <span>Engine Bay Cleaning <span className="page-mock-tag">Service</span></span>
          <span>998714</span><span>1.00</span><span>₹1,799</span><span><b>₹1,799</b></span>
        </div>
      </div>
      <div className="page-mock-totals">
        <div className="page-mock-total-row"><span>Subtotal (ex-GST)</span><span>₹1,524.58</span></div>
        <div className="page-mock-total-row"><span>CGST (9%)</span><span>₹137.21</span></div>
        <div className="page-mock-total-row"><span>SGST (9%)</span><span>₹137.21</span></div>
        <div className="page-mock-total-row grand"><span>Grand Total</span><span style={{color:'#16b994'}}>₹1,799.00</span></div>
      </div>
    </div>
  );
}

/* ─── Data ───────────────────────────────────────────────────────── */
const MODULES = [
  { icon:'🎯', label:'Lead Capture',      desc:'Inbound & manual leads with custom status pipeline' },
  { icon:'👥', label:'Customer CRM',      desc:'Full profiles, vehicle history & service records' },
  { icon:'📅', label:'Appointments',      desc:'Book, assign & manage service slots across locations' },
  { icon:'📋', label:'Estimates',         desc:'Create professional estimates in minutes' },
  { icon:'🧾', label:'Customer Invoices', desc:'Raise, send and track customer billing' },
  { icon:'📦', label:'Purchase Invoices', desc:'Manage vendor purchases and expenses' },
  { icon:'🏭', label:'Hub Management',    desc:'Multi-location aggregator with portal access' },
  { icon:'💰', label:'Payouts',           desc:'Track and process hub payouts with full audit trail' },
  { icon:'🔧', label:'Parts & Inventory', desc:'Parts catalogue with pricing and stock control' },
  { icon:'📊', label:'Reports',           desc:'Revenue, lead conversion and team performance' },
  { icon:'👨‍💼', label:'User & Roles',      desc:'Role-based access control with fine-grained permissions' },
  { icon:'⬆️', label:'Bulk Upload',       desc:'Import leads and data in seconds via CSV' },
];

const STEPS = [
  { num:'01', icon:'📥', title:'Capture Leads',   desc:'Leads flow in manually, via bulk upload or through your hub network. Every lead is logged, timestamped and assigned instantly.' },
  { num:'02', icon:'⚙️', title:'Manage Pipeline', desc:'Move leads through custom status stages, assign to team members, book appointments and create estimates — all from one screen.' },
  { num:'03', icon:'🧾', title:'Invoice & Close',  desc:'Convert estimates to invoices, mark them paid, run payouts to hubs and review performance on your live dashboard.' },
];

/* ─── Main Component ─────────────────────────────────────────────── */
export default function LandingPage() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  useScrollReveal();

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  return (
    <div className="lp">

      {/* ── NAV ──────────────────────────────────────────────────── */}
      <nav className={`lp-nav${scrolled ? ' scrolled' : ''}`}>
        <div className="lp-nav-inner">
          <div className="lp-logo">
            <img src="/logo.svg" alt="Spinoto" style={{ height: 32, width: 'auto', display: 'block' }} />
          </div>
          <div className="lp-nav-links">
            <a href="#features">Features</a>
            <a href="#modules">Modules</a>
            <a href="#how-it-works">How It Works</a>
          </div>
          <div className="lp-nav-right">
            <button className="lp-btn-ghost" onClick={() => navigate('/login')}>Sign In</button>
            <button className="lp-btn-primary" onClick={() => navigate('/login')}>Get Started →</button>
          </div>
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-hero-bg" aria-hidden="true" />
        <div className="lp-hero-inner">

          {/* Badge */}
          <div className="lp-hero-badge">
            <span className="lp-badge-dot" />
            Automotive CRM &amp; Service Portal
          </div>

          {/* Headline */}
          <h1 className="lp-hero-h1">
            <span className="lp-line" style={{animationDelay:'0.05s'}}>Manage Leads.</span>
            <span className="lp-line lp-gradient-text" style={{animationDelay:'0.18s'}}>Book Appointments.</span>
            <span className="lp-line" style={{animationDelay:'0.31s'}}>Get Paid Faster.</span>
          </h1>

          <p className="lp-hero-sub">
            The all-in-one platform for automotive service centres. Track every lead,
            manage customers, handle invoices and run your entire business from one clean portal.
          </p>

          <div className="lp-hero-cta">
            <button className="lp-btn-primary lp-btn-lg" onClick={() => navigate('/login')}>
              Access Your Portal
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>
            <a href="#features" className="lp-btn-ghost lp-btn-lg">Explore Features</a>
          </div>

          {/* Inline trust signals */}
          <div className="lp-hero-trust">
            <div className="lp-trust-item">
              <span className="lp-stars">★★★★★</span>
              <span>4.9 / 5</span>
            </div>
            <div className="lp-trust-sep" />
            <div className="lp-trust-item">✓ Multi-Hub Support</div>
            <div className="lp-trust-sep" />
            <div className="lp-trust-item">✓ Role-based Access</div>
            <div className="lp-trust-sep" />
            <div className="lp-trust-item">✓ 12+ Modules</div>
          </div>

          {/* Full-width perspective screenshot */}
          <div className="lp-hero-screen">
            <div className="lp-screen-chrome">
              <span /><span /><span />
              <span className="lp-screen-url">spinoto.app / dashboard</span>
            </div>
            <div className="lp-hero-screen-inner">
              <AppScreen
                src="/screenshots/dashboard.png"
                alt="Spinoto Dashboard"
                className="hero-screenshot"
              >
                <HeroMockupFallback />
              </AppScreen>
            </div>
          </div>
        </div>
      </section>

      {/* ── PROOF BAR ────────────────────────────────────────────── */}
      <div className="lp-proof-bar">
        <div className="lp-proof-inner">
          <span className="lp-proof-label">Trusted by service teams across India</span>
          <span className="lp-proof-divider" />
          {['Lead Management','CRM','Invoicing','Appointments','Hub Network','Analytics','Bulk Upload'].map(t => (
            <span key={t} className="lp-proof-tag">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16b994" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* ── BENTO FEATURES ───────────────────────────────────────── */}
      <section className="lp-bento" id="features">
        <div className="lp-bento-inner">
          <div className="lp-sect-eyebrow" data-reveal>Platform Features</div>
          <h2 className="lp-bento-h2" data-reveal data-delay="1">
            Built for how workshops<br />actually work
          </h2>
          <p className="lp-bento-sub" data-reveal data-delay="2">
            Every tool your service centre needs — from first lead to final payout — in one cohesive platform.
          </p>

          <div className="lp-bento-grid" data-reveal data-delay="2">

            {/* ── Leads: large card (col 1-2, row 1) ── */}
            <div className="bento-card bento-leads">
              <div className="bento-text">
                <span className="bento-tag">Lead Management</span>
                <h3 className="bento-title">Capture &amp; convert every lead in one pipeline</h3>
                <p className="bento-desc">Custom status stages, team assignment, bulk CSV import and hub-level segmentation — all in real time.</p>
              </div>
              <div className="bento-mockup">
                <AppScreen src="/screenshots/leads.png" alt="Lead Management" className="bento-screenshot">
                  <LeadsMockupFallback />
                </AppScreen>
              </div>
            </div>

            {/* ── CRM stat: small (col 3, row 1) ── */}
            <div className="bento-card bento-stat bento-crm-stat">
              <div className="bento-stat-chip">CRM</div>
              <div className="bento-stat-number">360°</div>
              <div className="bento-stat-label">Customer View</div>
              <p className="bento-stat-desc">Complete profiles with vehicle history, service records and upcoming appointments — all linked.</p>
              <ul className="bento-bullets">
                <li><span className="bento-check">✓</span>Vehicle &amp; service history</li>
                <li><span className="bento-check">✓</span>Linked invoices &amp; estimates</li>
                <li><span className="bento-check">✓</span>Appointment scheduling</li>
              </ul>
            </div>

            {/* ── Invoice stat: small (col 1, row 2) ── */}
            <div className="bento-card bento-stat bento-inv-stat">
              <div className="bento-stat-chip">Billing</div>
              <div className="bento-stat-number">1-Click</div>
              <div className="bento-stat-label">Estimate → Invoice</div>
              <p className="bento-stat-desc">Convert estimates instantly and track payments with a full audit trail from estimate to payout.</p>
              <ul className="bento-bullets">
                <li><span className="bento-check">✓</span>Parts &amp; labour line items</li>
                <li><span className="bento-check">✓</span>Purchase invoices</li>
                <li><span className="bento-check">✓</span>Hub payout tracking</li>
              </ul>
            </div>

            {/* ── CRM: large (col 2-3, row 2) ── */}
            <div className="bento-card bento-crm">
              <div className="bento-text">
                <span className="bento-tag">Customer CRM</span>
                <h3 className="bento-title">Know your customer before they walk in</h3>
                <p className="bento-desc">360° profiles, linked vehicles, full service history and invoices all in one view.</p>
              </div>
              <div className="bento-mockup">
                <AppScreen src="/screenshots/appointments.png" alt="Appointments" className="bento-screenshot">
                  <ApptMockupFallback />
                </AppScreen>
              </div>
            </div>

            {/* ── Hub stat: small (col 1, row 3) ── */}
            <div className="bento-card bento-stat bento-hub-stat">
              <div className="bento-stat-chip">Network</div>
              <div className="bento-stat-number">Multi</div>
              <div className="bento-stat-label">Hub Support</div>
              <p className="bento-stat-desc">Manage multiple service locations and hub partners from a single aggregator portal.</p>
              <ul className="bento-bullets">
                <li><span className="bento-check">✓</span>Hub portal access</li>
                <li><span className="bento-check">✓</span>Location management</li>
                <li><span className="bento-check">✓</span>Payout tracking</li>
              </ul>
            </div>

            {/* ── Invoice: large (col 2-3, row 3) ── */}
            <div className="bento-card bento-invoice">
              <div className="bento-text">
                <span className="bento-tag">Estimates &amp; Invoicing</span>
                <h3 className="bento-title">Professional billing, zero friction</h3>
                <p className="bento-desc">Create estimates in seconds, convert to invoices with one click, manage vendor purchases — all from one dashboard.</p>
              </div>
              <div className="bento-mockup">
                <AppScreen src="/screenshots/estimate.png" alt="Estimate Detail" className="bento-screenshot">
                  <EstimateMockupFallback />
                </AppScreen>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── MODULES ──────────────────────────────────────────────── */}
      <section className="lp-modules" id="modules">
        <div className="lp-modules-inner">
          <div className="lp-sect-eyebrow lp-eyebrow-light" data-reveal>Everything Included</div>
          <h2 className="lp-modules-h2" data-reveal data-delay="1">
            Streamline <span className="lp-gradient-text-light">12+ modules</span><br />with one platform
          </h2>
          <p className="lp-modules-sub" data-reveal data-delay="2">
            No patchwork of tools. Every workflow your service centre needs — lead to invoice — lives in one place.
          </p>
          <div className="lp-modules-grid">
            {MODULES.map((m, i) => (
              <div key={m.label} className="lp-module-card" data-reveal data-delay={String((i % 4) + 1)}>
                <div className="lp-module-num">{String(i + 1).padStart(2, '0')}</div>
                <div className="lp-module-icon">{m.icon}</div>
                <div className="lp-module-label">{m.label}</div>
                <div className="lp-module-desc">{m.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────── */}
      <section className="lp-hiw" id="how-it-works">
        <div className="lp-hiw-inner">
          <div className="lp-sect-eyebrow" style={{margin:'0 auto 16px'}} data-reveal>Simple by Design</div>
          <h2 className="lp-hiw-h2" data-reveal data-delay="1">From first contact to final invoice</h2>
          <p className="lp-hiw-sub" data-reveal data-delay="2">Three clear steps. Your entire business lifecycle in one seamless loop.</p>
          <div className="lp-hiw-steps">
            {STEPS.map((s, i) => (
              <React.Fragment key={s.num}>
                <div className="lp-step" data-reveal data-delay={String(i + 1)}>
                  <div className="lp-step-num">{s.num}</div>
                  <div className="lp-step-icon">{s.icon}</div>
                  <h3 className="lp-step-title">{s.title}</h3>
                  <p className="lp-step-desc">{s.desc}</p>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="lp-step-arrow" aria-hidden="true">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                    </svg>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </section>

      {/* ── TEAMS ────────────────────────────────────────────────── */}
      <section className="lp-teams">
        <div className="lp-teams-inner">
          <div className="lp-sect-eyebrow" style={{margin:'0 auto 16px'}} data-reveal>Built for Every Role</div>
          <h2 className="lp-teams-h2" data-reveal data-delay="1">One platform, every person in your team</h2>
          <div className="lp-teams-grid">
            {[
              { icon:'👑', role:'Super Admin',    desc:'Full control over all modules, users, hubs, pricing and reports with no restrictions.' },
              { icon:'🏢', role:'Manager',        desc:'Oversee team leads, manage locations, approve invoices and monitor performance dashboards.' },
              { icon:'📞', role:'Caller / Agent', desc:'Capture and manage assigned leads, book appointments and update status in real time.' },
              { icon:'🏭', role:'Hub Partner',    desc:'Dedicated hub portal to track leads, payouts and performance without accessing the main portal.' },
            ].map((t, i) => (
              <div key={t.role} className="lp-team-card" data-reveal data-delay={String(i + 1)}>
                <div className="lp-team-icon">{t.icon}</div>
                <h3 className="lp-team-role">{t.role}</h3>
                <p className="lp-team-desc">{t.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────── */}
      <section className="lp-cta">
        <div className="lp-cta-inner">
          <div className="lp-cta-left" data-reveal>
            <h2 className="lp-cta-h2">
              Ready to modernise your<br />
              <span className="lp-cta-accent">service business?</span>
            </h2>
            <p className="lp-cta-sub">
              Log in now and see why service centres love Spinoto for managing every part of their operation.
            </p>
            <button className="lp-cta-btn" onClick={() => navigate('/login')}>
              Access Spinoto Portal
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>
          </div>
          <div className="lp-cta-stats" data-reveal data-delay="2">
            {[
              { to: 12,  suffix: '+', label: 'Modules Included' },
              { to: 360, suffix: '°', label: 'Customer View'    },
            ].map(({ to, suffix, label }) => (
              <div key={label} className="lp-cta-stat">
                <div className="lp-cta-stat-v"><AnimCounter to={to} suffix={suffix} /></div>
                <div className="lp-cta-stat-l">{label}</div>
              </div>
            ))}
            {[
              { v:'Multi-Hub', label:'Location Support'  },
              { v:'RBAC',      label:'Access Control'    },
            ].map(({ v, label }) => (
              <div key={label} className="lp-cta-stat">
                <div className="lp-cta-stat-v">{v}</div>
                <div className="lp-cta-stat-l">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <img src="/logo.svg" alt="Spinoto" style={{ height: 28, width: 'auto', display: 'block' }} />
            <p className="lp-footer-tagline">
              The all-in-one CRM &amp; service management portal for automotive businesses.
            </p>
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-col-title">Product</div>
            {['Leads','Customers','Appointments','Estimates','Invoices','Reports'].map(l => (
              <span key={l} className="lp-footer-link">{l}</span>
            ))}
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-col-title">Platform</div>
            {['Hub Management','User Roles','Bulk Upload','Payouts','Parts & Inventory','Pricing Engine'].map(l => (
              <span key={l} className="lp-footer-link">{l}</span>
            ))}
          </div>
          <div className="lp-footer-col">
            <div className="lp-footer-col-title">Company</div>
            {['About Us','Contact','Privacy Policy','Terms of Service'].map(l => (
              <span key={l} className="lp-footer-link">{l}</span>
            ))}
          </div>
        </div>
        <div className="lp-footer-bottom">
          <span>© 2026 Spinoto Technologies. All rights reserved.</span>
          <span>Built for speed · Designed for service centres</span>
        </div>
      </footer>

    </div>
  );
}
