import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/LandingPage.css';

/* ─── Hero Dashboard Mockup ─────────────────────────────────────── */
function HeroMockup() {
  const leads = [
    { name: 'Arjun M.',  service: 'Oil Change',    status: 'New',         color: '#16b994' },
    { name: 'Priya S.',  service: 'Brake Service', status: 'In Progress', color: '#f59e0b' },
    { name: 'Rahul V.',  service: 'AC Repair',     status: 'Converted',   color: '#6366f1' },
    { name: 'Sneha J.',  service: 'Tyre Change',   status: 'New',         color: '#16b994' },
  ];
  return (
    <div className="hero-mockup">
      <div className="hero-mockup-chrome">
        <span /><span /><span />
        <div className="hero-mockup-url">spinoto.app / dashboard</div>
      </div>
      <div className="hero-mockup-body">
        {/* sidebar */}
        <div className="hm-sidebar">
          <div className="hm-brand">S</div>
          {['Dashboard','Leads','Customers','Invoices','Reports'].map((item, i) => (
            <div key={item} className={`hm-nav${i === 0 ? ' active' : ''}`}>
              <div className="hm-dot" />{item}
            </div>
          ))}
        </div>
        {/* content */}
        <div className="hm-content">
          <div className="hm-topbar">
            <span className="hm-title">Dashboard</span>
            <div className="hm-avatar">SA</div>
          </div>
          <div className="hm-kpis">
            {[['Total Leads','1,284','+12%',true],['Converted','342','+8%',true],['Revenue','₹4.2L','+21%',true],['Open','57','-3%',false]].map(([l,v,d,up]) => (
              <div key={l} className="hm-kpi">
                <div className="hm-kpi-lbl">{l}</div>
                <div className="hm-kpi-val">{v}</div>
                <div className={`hm-kpi-d${up?' up':' dn'}`}>{d}</div>
              </div>
            ))}
          </div>
          <div className="hm-table-hdr">
            <span>Recent Leads</span><span className="hm-see-all">View all →</span>
          </div>
          {leads.map(l => (
            <div key={l.name} className="hm-row">
              <div className="hm-init" style={{background:l.color+'22',color:l.color}}>{l.name.split(' ').map(w=>w[0]).join('')}</div>
              <div className="hm-name">{l.name}</div>
              <div className="hm-service">{l.service}</div>
              <div className="hm-badge" style={{color:l.color,background:l.color+'18',borderColor:l.color+'40'}}>{l.status}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Feature Mockup: Lead Pipeline ─────────────────────────────── */
function LeadsMockup() {
  const cols = [
    { title: 'New',         color: '#16b994', items: ['Arjun Mehta','Priya Sharma','Kiran Nair'] },
    { title: 'In Progress', color: '#f59e0b', items: ['Rahul Verma','Sneha Joshi'] },
    { title: 'Follow-up',   color: '#6366f1', items: ['Vikram Singh','Anjali Rao'] },
    { title: 'Converted',   color: '#22c55e', items: ['Deepak Kumar'] },
  ];
  return (
    <div className="feat-mockup feat-leads">
      <div className="fm-chrome"><span/><span/><span/></div>
      <div className="fm-leads-body">
        {cols.map(c => (
          <div key={c.title} className="fm-col">
            <div className="fm-col-hdr">
              <span className="fm-col-dot" style={{background:c.color}}/>
              <span className="fm-col-title">{c.title}</span>
              <span className="fm-col-cnt">{c.items.length}</span>
            </div>
            {c.items.map(item => (
              <div key={item} className="fm-card">
                <div className="fm-card-avatar" style={{background:c.color+'22',color:c.color}}>
                  {item.split(' ').map(w=>w[0]).join('')}
                </div>
                <div>
                  <div className="fm-card-name">{item}</div>
                  <div className="fm-card-tag" style={{color:c.color}}>Lead</div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Feature Mockup: Customer Profile ──────────────────────────── */
function CustomerMockup() {
  return (
    <div className="feat-mockup feat-customer">
      <div className="fm-chrome"><span/><span/><span/></div>
      <div className="fm-cust-body">
        <div className="fm-cust-sidebar">
          <div className="fm-cust-avatar">AM</div>
          <div className="fm-cust-name">Arjun Mehta</div>
          <div className="fm-cust-tag">Premium Customer</div>
          <div className="fm-cust-stats">
            <div className="fm-cs"><div className="fm-cs-v">8</div><div className="fm-cs-l">Visits</div></div>
            <div className="fm-cs"><div className="fm-cs-v">₹24k</div><div className="fm-cs-l">Spent</div></div>
            <div className="fm-cs"><div className="fm-cs-v">3</div><div className="fm-cs-l">Vehicles</div></div>
          </div>
          <div className="fm-section-lbl">Vehicles</div>
          {['Honda City – MH12AB1234','Maruti Swift – MH14CD5678'].map(v => (
            <div key={v} className="fm-vehicle">{v}</div>
          ))}
        </div>
        <div className="fm-cust-main">
          <div className="fm-cust-tabs">
            {['History','Invoices','Appointments'].map((t,i) => (
              <div key={t} className={`fm-tab${i===0?' active':''}`}>{t}</div>
            ))}
          </div>
          {[
            ['Oil Change', '12 May 2026', '₹1,200', '#16b994'],
            ['Brake Pad',  '3 Apr 2026',  '₹3,500', '#16b994'],
            ['AC Service', '10 Feb 2026', '₹2,800', '#f59e0b'],
            ['Tyre Set',   '5 Jan 2026',  '₹8,000', '#16b994'],
          ].map(([srv,dt,amt,c]) => (
            <div key={srv+dt} className="fm-history-row">
              <div className="fm-hr-dot" style={{background:c}}/>
              <div className="fm-hr-info">
                <div className="fm-hr-svc">{srv}</div>
                <div className="fm-hr-dt">{dt}</div>
              </div>
              <div className="fm-hr-amt">{amt}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Feature Mockup: Invoice ────────────────────────────────────── */
function InvoiceMockup() {
  return (
    <div className="feat-mockup feat-invoice">
      <div className="fm-chrome"><span/><span/><span/></div>
      <div className="fm-inv-body">
        <div className="fm-inv-header">
          <div>
            <div className="fm-inv-title">Invoice #INV-2026-0142</div>
            <div className="fm-inv-sub">Arjun Mehta · Honda City · MH12AB1234</div>
          </div>
          <div className="fm-inv-status">Paid</div>
        </div>
        <div className="fm-inv-table">
          <div className="fm-inv-th"><span>Service</span><span>Qty</span><span>Rate</span><span>Total</span></div>
          {[
            ['Full Service Kit', '1', '₹1,800', '₹1,800'],
            ['Brake Fluid Top',  '1', '₹350',   '₹350'],
            ['Labour Charges',   '2h','₹400/h', '₹800'],
          ].map(([s,q,r,t]) => (
            <div key={s} className="fm-inv-row">
              <span>{s}</span><span>{q}</span><span>{r}</span><span className="fm-inv-bold">{t}</span>
            </div>
          ))}
          <div className="fm-inv-total">
            <span>Total</span><span className="fm-inv-total-amt">₹2,950</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Module Grid Data ───────────────────────────────────────────── */
const MODULES = [
  { icon:'🎯', label:'Lead Capture',       desc:'Inbound & manual leads with custom status pipeline' },
  { icon:'👥', label:'Customer CRM',       desc:'Full profiles, vehicle history & service records' },
  { icon:'📅', label:'Appointments',       desc:'Book, assign & manage service slots across locations' },
  { icon:'📋', label:'Estimates',          desc:'Create professional estimates in minutes' },
  { icon:'🧾', label:'Customer Invoices',  desc:'Raise, send and track customer billing' },
  { icon:'📦', label:'Purchase Invoices',  desc:'Manage vendor purchases and expenses' },
  { icon:'🏭', label:'Hub Management',     desc:'Multi-location aggregator with portal access' },
  { icon:'💰', label:'Payouts',            desc:'Track and process hub payouts with full audit trail' },
  { icon:'🔧', label:'Parts & Inventory',  desc:'Parts catalogue with pricing and stock control' },
  { icon:'📊', label:'Reports',            desc:'Revenue, lead conversion and team performance' },
  { icon:'👨‍💼', label:'User & Roles',       desc:'Role-based access control with fine-grained permissions' },
  { icon:'⬆️', label:'Bulk Upload',        desc:'Import leads and data in seconds via CSV' },
];

const STEPS = [
  { num:'01', icon:'📥', title:'Capture Leads', desc:'Leads flow in manually, via bulk upload or through your hub network. Every lead is logged, timestamped and assigned instantly.' },
  { num:'02', icon:'⚙️', title:'Manage Pipeline', desc:'Move leads through custom status stages, assign to team members, book appointments and create estimates — all from one screen.' },
  { num:'03', icon:'🧾', title:'Invoice & Close', desc:'Convert estimates to invoices, mark them paid, run payouts to hubs and review performance on your live dashboard.' },
];

/* ─── Main Component ─────────────────────────────────────────────── */
export default function LandingPage() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);

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
            <img src="/logo.svg" alt="Spinoto" style={{ height: 36, width: 'auto', display: 'block' }} />
          </div>
          <div className="lp-nav-links">
            <a href="#features">Features</a>
            <a href="#modules">Modules</a>
            <a href="#how-it-works">How It Works</a>
          </div>
          <div className="lp-nav-right">
            <button className="lp-btn-outline" onClick={() => navigate('/login')}>Sign In</button>
            <button className="lp-btn-primary" onClick={() => navigate('/login')}>Get Started →</button>
          </div>
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          {/* left */}
          <div className="lp-hero-left">
            <div className="lp-hero-badge">
              <span className="lp-badge-dot" />
              Automotive CRM &amp; Service Portal
            </div>
            <h1 className="lp-hero-h1">
              Manage Leads.<br/>
              <span className="lp-gradient-text">Book Appointments.</span><br/>
              Get Paid Faster.
            </h1>
            <p className="lp-hero-sub">
              Spinoto is the all-in-one platform for automotive service centres.
              Track every lead, manage customers, handle invoices and run your
              entire business from one clean portal.
            </p>
            <div className="lp-hero-cta">
              <button className="lp-btn-primary lp-btn-lg" onClick={() => navigate('/login')}>
                Access Your Portal
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </button>
              <a href="#features" className="lp-btn-outline lp-btn-lg">See Features</a>
            </div>
            <div className="lp-hero-trust">
              <div className="lp-stars">{'★★★★★'}<span>4.9 / 5 rating</span></div>
              <span className="lp-trust-divider"/>
              <div className="lp-trust-chip">✓ Multi-Hub Support</div>
              <div className="lp-trust-chip">✓ Role-based Access</div>
            </div>
          </div>
          {/* right */}
          <div className="lp-hero-right">
            <HeroMockup />
          </div>
        </div>
      </section>

      {/* ── SOCIAL PROOF BAR ─────────────────────────────────────── */}
      <section className="lp-proof-bar">
        <div className="lp-proof-inner">
          <span className="lp-proof-label">Trusted by service teams across India</span>
          <div className="lp-proof-divider"/>
          {['Lead Management','CRM','Invoicing','Appointments','Hub Network','Analytics'].map(t => (
            <div key={t} className="lp-proof-tag">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16b994" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              {t}
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURE 1: Lead Management ───────────────────────────── */}
      <section className="lp-feat-section lp-feat-alt-0" id="features">
        <div className="lp-feat-inner">
          <div className="lp-feat-text">
            <div className="lp-sect-label">Lead Management</div>
            <h2 className="lp-feat-h2">Streamline Your Lead Workflow &amp; Pipeline</h2>
            <p className="lp-feat-desc">
              Capture every inbound enquiry and move them through a fully customisable pipeline.
              Assign leads, track status changes and follow up — all in real time.
            </p>
            <ul className="lp-feat-list">
              <li><span className="lp-li-check">✓</span> Custom lead status pipeline</li>
              <li><span className="lp-li-check">✓</span> Bulk CSV import &amp; export</li>
              <li><span className="lp-li-check">✓</span> Team assignment &amp; ownership</li>
              <li><span className="lp-li-check">✓</span> Hub-level lead segmentation</li>
            </ul>
            <button className="lp-btn-primary" onClick={() => navigate('/login')}>Start Managing Leads →</button>
          </div>
          <div className="lp-feat-visual">
            <LeadsMockup />
          </div>
        </div>
      </section>

      {/* ── FEATURE 2: Customer CRM ──────────────────────────────── */}
      <section className="lp-feat-section lp-feat-alt-1">
        <div className="lp-feat-inner lp-feat-reverse">
          <div className="lp-feat-visual">
            <CustomerMockup />
          </div>
          <div className="lp-feat-text">
            <div className="lp-sect-label">Customer CRM</div>
            <h2 className="lp-feat-h2">Deliver an Unforgettable Customer Experience</h2>
            <p className="lp-feat-desc">
              Every customer has a complete profile — vehicles, service history, invoices and
              upcoming appointments. Know your customer before they walk in the door.
            </p>
            <ul className="lp-feat-list">
              <li><span className="lp-li-check">✓</span> 360° customer profiles</li>
              <li><span className="lp-li-check">✓</span> Full vehicle &amp; service history</li>
              <li><span className="lp-li-check">✓</span> Linked invoices &amp; estimates</li>
              <li><span className="lp-li-check">✓</span> Appointment scheduling per customer</li>
            </ul>
            <button className="lp-btn-primary" onClick={() => navigate('/login')}>Open CRM Portal →</button>
          </div>
        </div>
      </section>

      {/* ── FEATURE 3: Invoicing ─────────────────────────────────── */}
      <section className="lp-feat-section lp-feat-alt-0">
        <div className="lp-feat-inner">
          <div className="lp-feat-text">
            <div className="lp-sect-label">Estimates &amp; Invoicing</div>
            <h2 className="lp-feat-h2">Professional Invoicing Built for Service Centres</h2>
            <p className="lp-feat-desc">
              Create estimates in seconds, convert them to invoices with one click and manage
              both customer billing and vendor purchases from a single dashboard.
            </p>
            <ul className="lp-feat-list">
              <li><span className="lp-li-check">✓</span> Estimate-to-invoice conversion</li>
              <li><span className="lp-li-check">✓</span> Customer &amp; purchase invoices</li>
              <li><span className="lp-li-check">✓</span> Parts &amp; labour line items</li>
              <li><span className="lp-li-check">✓</span> Hub payout tracking</li>
            </ul>
            <button className="lp-btn-primary" onClick={() => navigate('/login')}>Start Invoicing →</button>
          </div>
          <div className="lp-feat-visual">
            <InvoiceMockup />
          </div>
        </div>
      </section>

      {/* ── MODULES GRID ─────────────────────────────────────────── */}
      <section className="lp-modules" id="modules">
        <div className="lp-modules-inner">
          <div className="lp-sect-label" style={{textAlign:'center'}}>Everything Included</div>
          <h2 className="lp-modules-h2">
            Streamline <span className="lp-gradient-text">12+ Modules</span> with One Platform
          </h2>
          <p className="lp-modules-sub">
            No patchwork of tools. Every workflow your service centre needs — lead to invoice — lives in one place.
          </p>
          <div className="lp-modules-grid">
            {MODULES.map(m => (
              <div key={m.label} className="lp-module-card">
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
          <div className="lp-sect-label" style={{textAlign:'center'}}>Simple by Design</div>
          <h2 className="lp-hiw-h2">From First Contact to Final Invoice</h2>
          <p className="lp-hiw-sub">Three clear steps. Your entire business lifecycle in one seamless loop.</p>
          <div className="lp-hiw-steps">
            {STEPS.map((s, i) => (
              <React.Fragment key={s.num}>
                <div className="lp-hiw-step">
                  <div className="lp-step-icon">{s.icon}</div>
                  <div className="lp-step-num">{s.num}</div>
                  <h3 className="lp-step-title">{s.title}</h3>
                  <p className="lp-step-desc">{s.desc}</p>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="lp-step-connector">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16b994" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.4">
                      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                    </svg>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </section>

      {/* ── BUILT FOR TEAMS ──────────────────────────────────────── */}
      <section className="lp-teams">
        <div className="lp-teams-inner">
          <div className="lp-sect-label" style={{textAlign:'center'}}>Built for Every Role</div>
          <h2 className="lp-teams-h2">Backed by Smart Role-based Access</h2>
          <div className="lp-teams-grid">
            {[
              { icon:'👑', role:'Super Admin', desc:'Full control over all modules, users, hubs, pricing and reports with no restrictions.' },
              { icon:'🏢', role:'Manager',     desc:'Oversee team leads, manage locations, approve invoices and monitor performance dashboards.' },
              { icon:'📞', role:'Caller / Agent', desc:'Capture and manage assigned leads, book appointments and update status in real time.' },
              { icon:'🏭', role:'Hub Partner',  desc:'Dedicated hub portal to track leads, payouts and performance without accessing the main portal.' },
            ].map(t => (
              <div key={t.role} className="lp-team-card">
                <div className="lp-team-icon">{t.icon}</div>
                <h3 className="lp-team-role">{t.role}</h3>
                <p className="lp-team-desc">{t.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ───────────────────────────────────────────── */}
      <section className="lp-cta">
        <div className="lp-cta-inner">
          <div className="lp-cta-left">
            <h2 className="lp-cta-h2">
              Ready to modernise your<br/>
              <span className="lp-gradient-text">service business?</span>
            </h2>
            <p className="lp-cta-sub">
              Log in now and see why service centres love Spinoto for managing every part of their operation.
            </p>
            <div className="lp-cta-actions">
              <button className="lp-btn-primary lp-btn-lg" onClick={() => navigate('/login')}>
                Access Spinoto Portal
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </button>
            </div>
          </div>
          <div className="lp-cta-right">
            <div className="lp-cta-stats-grid">
              {[['12+','Modules'],['360°','Customer View'],['Multi-Hub','Locations'],['RBAC','Access Control']].map(([v,l]) => (
                <div key={l} className="lp-cta-stat">
                  <div className="lp-cta-stat-v">{v}</div>
                  <div className="lp-cta-stat-l">{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <div className="lp-logo">
              <img src="/favicon.ico" alt="Spinoto" style={{ height: 32, width: 'auto', display: 'block' }} />
            </div>
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
