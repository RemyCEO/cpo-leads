// --- COMPANY OF THE MONTH ---
const COMPANY_OF_MONTH = {
  name: "Gavin de Becker & Associates",
  short: "GDBA",
  tagline: "The gold standard in executive protection since 1978",
  positions: 22,
  salaryRange: "$75K \u2013 $130K",
  offices: "40+",
  description: "Founded by 3x Presidential appointee. Protects the world\u2019s most prominent families. Military and law enforcement experience valued. Immediate openings across LA, NYC, DC, Miami, Seattle, and more.",
  applyUrl: "https://gdba.com/open-positions/",
  filterKey: "Gavin de Becker"
};

// --- SUPABASE AUTH ---
const SB_URL = 'https://afrcpiheobzauwyftksr.supabase.co';
const SB_KEY = 'sb_publishable_fJWFqpHxoux8-FfxuEZH0Q_UxlBylC6';
const STRIPE_MONTHLY = 'https://buy.stripe.com/bJe14n3lk4pJg0Q5dB7AI02';
const STRIPE_YEARLY = 'https://buy.stripe.com/6oUbJ12hg1dxeWMaxV7AI03';

const sb = supabase.createClient(SB_URL, SB_KEY);
let currentUser = null;

function showLogin() { document.getElementById('auth-form-login').style.display=''; document.getElementById('auth-form-signup').style.display='none'; document.getElementById('auth-form-reset').style.display='none'; hideAuthMsg(); }
function showSignup() { document.getElementById('auth-form-login').style.display='none'; document.getElementById('auth-form-signup').style.display=''; document.getElementById('auth-form-reset').style.display='none'; hideAuthMsg(); }
function showReset() { document.getElementById('auth-form-login').style.display='none'; document.getElementById('auth-form-signup').style.display='none'; document.getElementById('auth-form-reset').style.display=''; hideAuthMsg(); }
function hideAuthMsg() { document.getElementById('auth-error').style.display='none'; document.getElementById('auth-success').style.display='none'; }
function showAuthError(msg) { const el=document.getElementById('auth-error'); el.textContent=msg; el.style.display=''; }
function showAuthSuccess(msg) { const el=document.getElementById('auth-success'); el.textContent=msg; el.style.display=''; }

async function authLogin() {
  hideAuthMsg();
  const email = document.getElementById('auth-email').value.trim();
  const pass = document.getElementById('auth-pass').value;
  if(!email||!pass) return showAuthError('Enter email and password');
  // Owner bypass — server-side verified via Supabase auth (same credentials)
  // No hardcoded bypass needed — admin logs in through Supabase like everyone else
  try {
    const {data,error} = await sb.auth.signInWithPassword({email,password:pass});
    if(error) return showAuthError(error.message);
    onAuthSuccess(data.user);
  } catch(e) {
    showAuthError('Connection error. Try again.');
  }
}

async function authSignup() {
  hideAuthMsg();
  const email = document.getElementById('signup-email').value.trim();
  const pass = document.getElementById('signup-pass').value;
  if(!email||!pass) return showAuthError('Enter email and password');
  if(pass.length<6) return showAuthError('Password must be at least 6 characters');
  const {data,error} = await sb.auth.signUp({email,password:pass});
  if(error) return showAuthError(error.message);
  if(data.user && !data.user.confirmed_at) {
    showAuthSuccess('Check your email for confirmation link!');
  } else {
    onAuthSuccess(data.user);
  }
}

async function authReset() {
  hideAuthMsg();
  const email = document.getElementById('reset-email').value.trim();
  if(!email) return showAuthError('Enter your email');
  const {error} = await sb.auth.resetPasswordForEmail(email, {redirectTo: 'https://cpoleads.com/app.html'});
  if(error) return showAuthError(error.message);
  showAuthSuccess('Password reset link sent to your email!');
}

async function authLogout() {
  await sb.auth.signOut();
  currentUser = null;
  document.getElementById('app-container').style.display = 'none';
  document.getElementById('paywall-overlay')?.remove();
  document.getElementById('auth-overlay').style.display = 'flex';
}

let _isSubscribed = false;
const _adminEmails = ['remy@strategioai.com','helgesenconsulting@gmail.com','reppin1388@gmail.com'];

// Central gate — ALL job/apply interactions go through this
function gateApply(e) {
  if (_isSubscribed) return true;
  if (e) { e.preventDefault(); e.stopPropagation(); }
  showPaywall();
  return false;
}

async function onAuthSuccess(user) {
  currentUser = user;
  document.getElementById('user-email').textContent = user.email;

  // Check subscription in background — don't block access
  if (_adminEmails.includes(user.email)) {
    _isSubscribed = true;
  } else {
    try {
      const res = await fetch(`/api/check-subscription?email=${encodeURIComponent(user.email)}`);
      const sub = await res.json();
      _isSubscribed = !!sub.active;
    } catch(e) {
      console.error('Subscription check failed:', e);
      _isSubscribed = false;
    }
  }

  // Let everyone in — Jobs tab is gated separately
  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('paywall-overlay')?.remove();
  document.getElementById('app-container').style.display = '';
  await loadScrapedJobs();
}

async function startTrial(email, plan) {
  const btn = event.target;
  btn.textContent = 'Loading...';
  btn.style.pointerEvents = 'none';
  try {
    const res = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ email, plan: plan || 'monthly' })
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    else { btn.textContent = 'Error — try again'; btn.style.pointerEvents = ''; }
  } catch(e) {
    btn.textContent = 'Error — try again';
    btn.style.pointerEvents = '';
  }
}

function showPaywall() {
  document.getElementById('paywall-overlay')?.remove();

  const features = [
    'Full access to all contract listings worldwide',
    'Curated job matching and recommendations',
    'Verified operator profile with credential badges',
    'End-to-end encrypted messaging with employers',
    'Daily intelligence briefings and threat data',
    'Global threat map and travel risk assessments',
    'Priority intel alerts for your regions and skillset',
    'Elite contractor network and referral access',
    'Direct application to verified employers'
  ];
  const checkSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="#C9A84C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>';
  const featureList = features.map(f => '<li style="display:flex;align-items:center;gap:10px;padding:6px 0;font-size:13px;color:#e8e6e3;line-height:1.4">' + checkSvg + f + '</li>').join('');

  const pw = document.createElement('div');
  pw.id = 'paywall-overlay';
  pw.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(6,8,13,0.97);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(12px);overflow-y:auto';
  pw.innerHTML = `
    <div style="max-width:480px;width:100%;font-family:Inter,system-ui,sans-serif;background:rgba(13,17,23,0.95);border:1px solid rgba(201,168,76,.2);border-radius:16px;padding:32px 24px;box-shadow:0 24px 80px rgba(0,0,0,.6)">
      <div style="text-align:center;margin-bottom:20px">
        <div style="display:inline-block;padding:6px 14px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:2px;background:linear-gradient(135deg,#C9A84C,#8B7635);color:#06080d;margin-bottom:14px">OPERATIONAL ACCESS</div>
        <h2 style="color:#C9A84C;font-size:32px;font-weight:800;margin-bottom:4px">3 Days Free</h2>
        <p style="color:#9a978f;font-size:13px;line-height:1.5;margin-bottom:4px">Then $19.90/month. Cancel anytime — you won't be charged during trial.</p>
        <p style="color:#7a7770;font-size:12px">Or <strong style="color:#e8e6e3">$199/year</strong> after trial — save $40 annually</p>
      </div>
      <ul style="list-style:none;padding:0;margin:0 0 24px;border-top:1px solid rgba(201,168,76,.1);border-bottom:1px solid rgba(201,168,76,.1);padding:16px 0">
        ${featureList}
      </ul>
      <a href="${STRIPE_MONTHLY}" style="display:block;width:100%;padding:16px;background:linear-gradient(135deg,#C9A84C,#8B7635);color:#06080d;border:none;border-radius:8px;font-weight:800;font-size:15px;text-decoration:none;text-align:center;letter-spacing:0.5px;margin-bottom:8px">Start Free Trial — 3 Days Free</a>
      <p style="text-align:center;font-size:11px;color:#7a7770;margin-bottom:16px">Sign up, add a card, explore everything. Charged $19.90/mo after 3 days.</p>
      <div style="text-align:center;padding-top:12px;border-top:1px solid rgba(201,168,76,.08)">
        <p style="font-size:11px;color:#52504b;margin-bottom:12px">Secure payment via Stripe. Cancel anytime.</p>
        <button onclick="document.getElementById('paywall-overlay')?.remove()" style="background:none;border:none;color:#666;cursor:pointer;font-size:12px;font-family:inherit">Back to Dashboard</button>
      </div>
    </div>
  `;
  document.body.appendChild(pw);
}

async function loadScrapedJobs() {
  try {
    const {data, error} = await sb.from('job_listings').select('*').order('scraped_at', {ascending: false}).limit(200);
    if (error || !data || !data.length) return;
    const now = new Date().toISOString();
    let added = 0;
    for (const j of data) {
      // Check if already in local leads by title+company
      const exists = leads.some(l => l.company.toLowerCase().includes(j.company?.toLowerCase() || '???') && l.company.toLowerCase().includes(j.title?.toLowerCase().substring(0,20) || '???'));
      if (exists) continue;
      leads.push({
        id: j.id || uid(),
        company: (j.company || '') + ' \u2014 ' + (j.title || ''),
        type: 'security',
        website: j.source_url || '',
        location: j.location || '',
        country: j.country || '',
        priority: 'medium',
        notes: (j.description || '') + (j.salary ? ' ' + j.salary + '.' : '') + (j.requirements ? ' Requirements: ' + j.requirements : ''),
        category: 'job',
        status: 'ny',
        contact_person: null,
        email: null,
        phone: null,
        saved: false,
        posted_at: j.posted_at || j.scraped_at || now,
        created_at: j.scraped_at || now,
        updated_at: j.scraped_at || now,
      });
      added++;
    }
    if (added > 0) {
      persist();
      refresh();
      console.log('Loaded ' + added + ' fresh jobs from Supabase');
    }
  } catch(e) { console.error('Failed to load scraped jobs:', e); }
}

// Initialize app — no login required
(async () => {
  // Check if user is logged in (for subscription check)
  const {data:{session}} = await sb.auth.getSession();
  if(session && session.user) {
    onAuthSuccess(session.user);
  } else {
    // No session — show app anyway, Jobs tab will be gated
    await loadScrapedJobs();
  }
  sb.auth.onAuthStateChange((event, session) => {
    if(session && session.user) onAuthSuccess(session.user);
  });
})();

// Enter key support on auth forms
document.addEventListener('keydown', e => {
  if(e.key==='Enter') {
    if(document.activeElement.id==='auth-email'||document.activeElement.id==='auth-pass') authLogin();
    if(document.activeElement.id==='signup-email'||document.activeElement.id==='signup-pass') authSignup();
    if(document.activeElement.id==='reset-email') authReset();
  }
});

// --- APP ---
const STORAGE_KEY = 'cp_leads_data';
// SEED_DATA loaded from seed_data.js

function expandSeed(s){
  const now=new Date().toISOString();
  const uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
  return{id:uid(),company:s.c,type:s.t,website:s.w||null,location:s.l||null,country:s.co||null,priority:s.p||'medium',notes:s.n||null,category:s.j?'job':'company',status:'ny',contact_person:s.cp||null,email:s.e||null,phone:s.ph||null,created_at:now,updated_at:now};
}

const SEED_VERSION = 9;
let leads;
if (localStorage.getItem('cp_seed_version') !== String(SEED_VERSION)) {
  // Purge old data and rebuild from clean seed
  leads = SEED_DATA.map(expandSeed);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(leads));
  localStorage.setItem('cp_seed_version', String(SEED_VERSION));
} else {
  leads = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (!leads.length) { leads = SEED_DATA.map(expandSeed); localStorage.setItem(STORAGE_KEY, JSON.stringify(leads)); }
}
// Strip any JobLeads entries that snuck into localStorage
const _before = leads.length;
leads = leads.filter(l => !/jobleads/i.test(l.company || '') && !/jobleads/i.test(l.website || '') && !/jobleads/i.test(l.notes || ''));
if (leads.length < _before) { persist(); console.log('Removed ' + (_before - leads.length) + ' JobLeads entries'); }
let activeTab = 'companies';

const typeLabels = {security:'Security',management:'Management',agency:'Agency'};
const typeBadge = {security:'badge-security',management:'badge-management',agency:'badge-agency'};
const statusColors = {ny:'#52504d',kontaktet:'#2980b9',applied:'#8e44ad',interview:'#D4AF37',offer:'#27ae60',rejected:'#c0392b','s\u00f8kt':'#a855f7',tilbud:'#27ae60',avslag:'#c0392b'};
const statusLabels = {ny:'New',kontaktet:'Contacted',applied:'Applied',interview:'Interview',offer:'Offer',rejected:'Rejected','s\u00f8kt':'Applied',tilbud:'Offer',avslag:'Rejected'};
const priorityOrder = {hot:0,medium:1,low:2};

function isJob(l) { return l.category === 'job' || (l.notes && l.notes.includes('AKTIV STILLING')); }

function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(leads)); }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2); }

let searchTimeout = null;
function globalSearch(query) {
  clearTimeout(searchTimeout);
  const box = document.getElementById('search-results');
  if (!query || query.length < 2) { box.style.display = 'none'; return; }
  searchTimeout = setTimeout(() => {
    const q = query.toLowerCase();
    const results = leads.filter(l => {
      const hay = [l.company,l.contact_person,l.location,l.country,l.notes,l.website,l.email].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    }).slice(0, 15);
    if (!results.length) {
      box.innerHTML = '<div style="padding:16px;color:var(--muted);text-align:center">No results for "'+esc(query)+'"</div>';
    } else {
      box.innerHTML = results.map(l => {
        const job = isJob(l);
        const salary = extractSalary(l.notes);
        return `<div onclick="closeSearch();${job?"switchTab('jobs')":"switchTab('companies')"};openDetail('${l.id}')" style="padding:12px 16px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;align-items:center;gap:10px;transition:background .1s" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background='transparent'">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(l.company)}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">${l.location?esc(l.location):''}${l.country&&l.country!=='UK'&&l.country!=='USA'?' \u00b7 '+esc(l.country):''}</div>
          </div>
          ${salary?'<span style="color:var(--accent);font-weight:700;font-size:12px;white-space:nowrap">'+esc(salary)+'</span>':''}
          <span class="badge ${job?'badge-job':typeBadge[l.type]||'badge-security'}" style="font-size:9px">${job?'JOB':typeLabels[l.type]||l.type}</span>
        </div>`;
      }).join('');
    }
    box.style.display = 'block';
  }, 150);
}

function closeSearch() {
  document.getElementById('global-search').value = '';
  document.getElementById('search-results').style.display = 'none';
}

document.addEventListener('click', e => {
  if (!e.target.closest('#global-search') && !e.target.closest('#search-results')) {
    document.getElementById('search-results').style.display = 'none';
  }
});

document.addEventListener('keydown', e => {
  if (e.key === '/' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
    document.getElementById('global-search').focus();
  }
});

function switchTab(tab) {
  // Gate premium tabs behind subscription/trial
  if (['jobs','guide','strategy'].includes(tab) && !_isSubscribed) {
    showPaywall();
    return;
  }
  activeTab = tab;
  // Safe element toggle — won't crash if element missing
  function showEl(id, show) { const el = document.getElementById(id); if(el) el.style.display = show ? '' : 'none'; }
  ['companies','jobs','saved','guide','dashboard','strategy'].forEach(t => {
    const el = document.getElementById('tab-'+t);
    if(el) el.classList.toggle('active', tab === t);
  });
  showEl('list-view', tab==='companies'||tab==='jobs');
  showEl('saved-view', tab==='saved');
  showEl('guide-view', tab==='guide');
  showEl('dashboard-view', tab==='dashboard');
  showEl('strategy-view', tab==='strategy');
  showEl('stats', tab!=='guide');
  if(tab==='dashboard') renderDashboard();
  else if(tab==='strategy') renderStrategy();
  else if(tab==='saved') renderSaved();
  else if(tab==='guide') renderGuide();
  else refresh();
}

function toggleSaved(id) {
  const idx = leads.findIndex(x=>x.id===id);
  if(idx>=0) { leads[idx].saved = !leads[idx].saved; persist(); }
}

function renderSaved() {
  const el = document.getElementById('saved-view');
  const saved = leads.filter(l => l.saved);
  document.getElementById('count-saved').textContent = saved.length;
  if(!saved.length) {
    el.innerHTML = '<div class="empty" style="padding:60px 20px"><div class="empty-icon" style="font-size:40px;opacity:.5">\u2606</div><div class="empty-text">No saved jobs yet.<br><span style="font-size:12px;color:var(--muted)">Click the star on any job or company to save it here.</span></div></div>';
    return;
  }
  el.innerHTML = '<div style="padding:12px 20px"><h2 style="font-size:16px;margin-bottom:4px">Saved (' + saved.length + ')</h2><p style="font-size:12px;color:var(--muted)">Jobs and companies you\'re interested in applying to</p></div><div class="leads" style="padding:0 20px 100px">' +
    saved.map(l => {
      const salary = extractSalary(l.notes);
      const job = isJob(l);
      const url = l.website ? (l.website.startsWith('http') ? l.website : 'https://'+l.website) : '';
      return `<div class="job-card">
        <div class="job-header">
          <div>
            <div class="job-title" onclick="openDetail('${l.id}')">${esc(l.company)}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">${l.location?esc(l.location):''}${l.country?' \u00b7 '+esc(l.country):''}</div>
          </div>
          ${salary?'<div class="job-salary">'+esc(salary)+'</div>':''}
        </div>
        <div class="job-actions">
          ${url?'<a href="'+url+'" target="_blank" class="btn-apply" onclick="if(!gateApply(event))return">Apply \u2192</a>':''}
          <button class="btn btn-ghost btn-sm" onclick="openDetail('${l.id}')" style="font-size:11px">Details</button>
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();toggleSaved('${l.id}');renderSaved()" style="font-size:11px;color:var(--red);border-color:rgba(239,68,68,.3)">Remove</button>
          <span class="badge ${job?'badge-job':typeBadge[l.type]||'badge-security'}" style="margin-left:auto">${job?'JOB':typeLabels[l.type]||l.type}</span>
        </div>
      </div>`;
    }).join('') + '</div>';
}

function renderGuide() {
  const el = document.getElementById('guide-view');
  el.innerHTML = `
    <h1 style="font-size:28px;font-weight:800;margin-bottom:8px">How to Land a Close Protection Job</h1>
    <p style="color:var(--muted);margin-bottom:32px">The no-BS insider guide. Built from real operator experience.</p>

    <div style="display:flex;flex-direction:column;gap:20px">
    ${[
      {title:'1. Where the Jobs Actually Live',icon:'\u{1F4CD}',content:'<b>Use these:</b> Silent Professionals, Circuit Magazine job board, EP Wired, BBA jobs, ASIS, IPSB, Close Protection World forum.<br><br><b>Skip:</b> Indeed and LinkedIn alone are graveyards for CP apps \u2014 80% of real CP work circulates through closed networks, WhatsApp groups, and direct referrals.<br><br><b>Red flags:</b> Any group asking upfront fees, "training first" schemes, or vague principal descriptions.<br><br><b>Quick Win:</b> Register on Silent Professionals and Circuit Magazine today \u2014 these two sources alone cover 60% of posted EP work.'},
      {title:'2. The CV That Gets Opened',icon:'\u{1F4C4}',content:'<b>Format:</b> 2 pages max. Page 1: contact, summary, key certs, last 3 roles. Page 2: full career, training, languages.<br><br><b>Certs that matter:</b> SIA CP (UK), FPOS-I, HEAT/SSAFE, ASIS CPP/PSP, advanced driving (Tony Scotti, BSR). FAA Part 107 for drone surveillance is increasingly valued.<br><br><b>What gets you binned:</b> Photos in tactical gear, "operator" language, inflated claims, listing references publicly.<br><br><b>Quick Win:</b> Put "References from [named principal type] available on request" \u2014 signals discretion.'},
      {title:'3. The Cold Outreach Playbook',icon:'\u{2709}',content:'<b>Find the right person:</b> Operations Manager, Head of Recruitment, Director of Protective Services \u2014 NOT info@ inbox.<br><br><b>Email structure:</b> Subject: "Experienced CPO \u2014 [Region] availability". Body: 3 lines max value prop + soft close. No attachments on first contact.<br><br><b>Follow-up:</b> 3 touches over 3 weeks, then park. Never chase more than that.<br><br><b>Quick Win:</b> Research 5 target companies on LinkedIn/Companies House today, find the right contact, send a tailored 3-line email.'},
      {title:'4. The Recruiter Game',icon:'\u{1F465}',content:'<b>Family office recruiters:</b> Greycoat Lumleys, Tiger Recruitment, Polo & Tweed, Oplu, Bespoke Britannia \u2014 each operates differently. Register with all of them.<br><br><b>Stay top-of-mind:</b> Send a short monthly "availability email" \u2014 3 lines: current status, availability dates, any new certs/experience.<br><br><b>Reality check:</b> Recruiters earn from placement, not from you. Manage expectations. Never pay upfront fees.<br><br><b>Quick Win:</b> Email your CV to Greycoat Lumleys (info@greycoatlumleys.co.uk) and Tiger (info@tiger-recruitment.co.uk) today.'},
      {title:'5. Networking That Generates Work',icon:'\u{1F91D}',content:'<b>Events worth the flight:</b> Security & Counter Terror Expo (London), ISC East/West (US), Intersec Dubai, Milipol Paris.<br><br><b>The 80/20 rule:</b> 80% of CP jobs come from people you’ve worked alongside. Invest in those relationships.<br><br><b>Referral script:</b> "Hey [name], I’m looking at [company]. Do you know anyone on their team? Would appreciate an intro if it makes sense."<br><br><b>Quick Win:</b> Message 3 former colleagues today and ask what they’re working on. Relationships before transactions.'},
      {title:'6. Building a Brand That Brings Work',icon:'\u{1F464}',content:'<b>LinkedIn:</b> Discreet headline (e.g. "Close Protection | International Operations"), suit photo, short summary signaling discretion and competence. No plate carriers.<br><br><b>"Boring is professional":</b> Principals hire operators who don’t seek attention. No tactical Instagram, no "operator" content.<br><br><b>Quick Win:</b> Update your LinkedIn headline and summary today. Remove any tactical photos.'},
      {title:'7. Geography & Market Rates (2026)',icon:'\u{1F30D}',content:'<b>Where the money is NOW:</b><br>\u2022 UAE/Saudi: $500\u2013800/day (NEOM, Red Sea projects hiring heavily)<br>\u2022 USA corporate: $130\u2013165K/yr (tech, finance, UHNW)<br>\u2022 London family office: \u00a355\u201380K/yr + benefits<br>\u2022 Hostile environment: $800\u20132,000/day (maritime anti-piracy tops)<br>\u2022 LATAM contract: $450\u2013800/day<br><br><b>Saturated:</b> UK domestic event security, generic venue work.<br><br><b>Quick Win:</b> Search GulfTalent and Silent Professionals for your target region today.'},
      {title:'8. The Interview & Vetting Stage',icon:'\u{1F50D}',content:'<b>Background checks:</b> Expect 2\u20136 weeks. Some markets require polygraph (US government contracts).<br><br><b>The principal interview:</b> If you meet the protectee, be calm, professional, minimal. They’re assessing whether they’d be comfortable with you 24/7.<br><br><b>Questions to ask THEM:</b> Rotation pattern, team structure, escalation protocols, equipment provided, insurance coverage.<br><br><b>Quick Win:</b> Prepare a clean 1-page "operations resume" for principal meetings \u2014 no military jargon, just calm competence.'},
      {title:'9. First 90 Days = Next 10 Years',icon:'\u{1F3AF}',content:'<b>The quiet professional reputation:</b> Show up early, kit squared away, zero drama, zero social media from the detail. This is what gets you recommended.<br><br><b>How referrals work:</b> Principals and estate managers talk to each other. One good contract opens 3 more. One bad day can close a region.<br><br><b>Avoid the bottom:</b> Don’t take lowball day-rate contracts just to stay busy. They attract bad teams and worse clients.<br><br><b>Quick Win:</b> On your current/next contract, focus on being the person the team lead calls first for the next job.'},
      {title:'10. Honest Realities',icon:'\u26A0\uFE0F',content:'<b>The industry is small.</b> Burning one bridge can close an entire region. Professionalism is non-negotiable.<br><br><b>Nepotism is real.</b> Accept it. Build your own network instead of fighting it.<br><br><b>Dry seasons happen.</b> Keep 6 months of runway minimum. Don’t panic-take bad contracts.<br><br><b>Everything comes from YOUR pocket:</b> Insurance, kit, training, travel to interviews. Budget accordingly.<br><br><b>Mental health:</b> Long rotations are hard. Plan decompression. This isn’t weakness \u2014 it’s operational readiness.'}
    ].map(s => `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px">
        <h3 style="font-size:16px;font-weight:700;margin-bottom:12px">${s.icon} ${s.title}</h3>
        <div style="font-size:13px;line-height:1.7;color:var(--muted)">${s.content}</div>
      </div>
    `).join('')}
    </div>

    <div style="margin-top:32px;background:var(--surface);border:1px solid var(--accent);border-radius:var(--radius);padding:24px">
      <h2 style="font-size:18px;font-weight:700;margin-bottom:16px;color:var(--accent)">First 30 Days Action Plan</h2>
      <div style="font-size:13px;line-height:2;color:var(--muted)">
        <b style="color:var(--fg)">Week 1:</b><br>
        1. Register: Silent Professionals, Circuit Magazine, CloseProtectionJobs.com<br>
        2. Update LinkedIn (discreet headline, suit photo)<br>
        3. Email CV to: Greycoat Lumleys, Tiger, Polo & Tweed, Oplu<br>
        4. Register on careers.un.org + nato.taleo.net<br>
        5. Apply to 3 active listings from Job Listings tab<br><br>
        <b style="color:var(--fg)">Week 2:</b><br>
        6. Cold outreach to 5 target companies (use playbook above)<br>
        7. Register on GulfTalent + Impactpool<br>
        8. Email Intelligent Protection + Infinite Risks + CourtesyMasters<br>
        9. Apply to GDBA, Constellis, GardaWorld portals<br>
        10. Message 3 former colleagues for referrals<br><br>
        <b style="color:var(--fg)">Week 3:</b><br>
        11. Follow up on week 1 outreach (2nd touch)<br>
        12. Apply to 5 more job listings<br>
        13. Research family office recruiters for your target market<br>
        14. Set LinkedIn job alerts for target keywords<br><br>
        <b style="color:var(--fg)">Week 4:</b><br>
        15. Final follow-up on unanswered outreach (3rd touch)<br>
        16. Send availability email to all registered recruiters<br>
        17. Review and update saved jobs list<br>
        18. Plan next month's targets based on responses<br><br>
        <b style="color:var(--fg)">Ongoing:</b> Check job boards daily. Send monthly availability emails. Keep saved list current.
      </div>
    </div>
  `;
}

const regionMap = {
  'UK':['UK','United Kingdom','England','Scotland','Wales'],
  'USA':['USA','US','United States'],
  'UAE':['UAE','Dubai','Qatar','Saudi','Saudi Arabia','Bahrain','Kuwait','Oman'],
  'Europe':['Belgium','France','Germany','Netherlands','Switzerland','Austria','Poland','Italy','Spain','Norway','Denmark','Sweden','Finland','Ireland','Portugal','Greece','Czech','Hungary','Romania'],
  'Africa':['Ghana','Nigeria','Kenya','South Africa','DRC','Angola','Mozambique','Tanzania','Uganda','Ethiopia','Sudan','Somalia','Egypt','Libya','Morocco','Tunisia'],
  'Asia':['Singapore','Japan','China','Hong Kong','India','Philippines','Indonesia','Thailand','Vietnam','Australia','New Zealand','Myanmar','East Asia'],
  'LATAM':['Colombia','Argentina','El Salvador','Guatemala','Brazil','Mexico','Chile','Peru','Ecuador','Panama','Costa Rica'],
  'International':['International','Global','Globalt']
};

function matchRegion(l, region) {
  if(!region) return true;
  const countries = regionMap[region] || [region];
  const haystack = [l.country, l.location].filter(Boolean).join(' ');
  return countries.some(c => haystack.toLowerCase().includes(c.toLowerCase()));
}

function getFiltered() {
  const search = document.getElementById('search').value.toLowerCase();
  const type = document.getElementById('filter-type').value;
  const status = document.getElementById('filter-status').value;
  const country = document.getElementById('filter-country').value;
  return leads.filter(l => {
    if (activeTab === 'jobs' && !isJob(l)) return false;
    if (activeTab === 'companies' && isJob(l)) return false;
    if (type && l.type !== type) return false;
    if (status && l.status !== status) return false;
    if (country && !matchRegion(l, country)) return false;
    if (search) {
      const hay = [l.company,l.contact_person,l.location,l.country,l.notes].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

function renderStats() {
  const el = document.getElementById('stats');
  const filtered = getFiltered();
  const total = filtered.length;
  const byStatus = {};
  filtered.forEach(l => { const s = statusLabels[l.status]||l.status||'New'; byStatus[s] = (byStatus[s]||0)+1; });
  const chips = [
    {label:'Total',val:total,color:'var(--accent)'},
    ...Object.entries(byStatus).map(([s,c])=>({label:s,val:c,color:statusColors[Object.keys(statusLabels).find(k=>statusLabels[k]===s)||'ny']||'var(--fg)'}))
  ];
  el.innerHTML = chips.map(c=>`<div class="stat"><div class="stat-val" style="color:${c.color}">${c.val}</div><div class="stat-label">${c.label}</div></div>`).join('');

  // Update tab counts
  document.getElementById('count-companies').textContent = leads.filter(l => !isJob(l)).length;
  document.getElementById('count-jobs').textContent = leads.filter(l => isJob(l)).length;
  document.getElementById('count-saved').textContent = leads.filter(l => l.saved).length;
}

function parseSalaryNum(notes) {
  if(!notes) return 0;
  const m = notes.match(/[\$\£]([\d,]+)/);
  return m ? parseInt(m[1].replace(/,/g,'')) : 0;
}

function applyFilters() {
  const filtered = getFiltered();
  const sortBy = document.getElementById('sort-by').value;
  if(sortBy==='salary') filtered.sort((a,b) => parseSalaryNum(b.notes) - parseSalaryNum(a.notes));
  else if(sortBy==='date') filtered.sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''));
  else if(sortBy==='name') filtered.sort((a,b) => (a.company||'').localeCompare(b.company||''));
  else if(sortBy==='status') {
    const so={ny:0,kontaktet:1,applied:2,interview:3,offer:4,rejected:5};
    filtered.sort((a,b) => (so[a.status]||0) - (so[b.status]||0));
  }
  else filtered.sort((a,b) => (priorityOrder[a.priority]||1) - (priorityOrder[b.priority]||1));
  renderList(filtered);
}

function extractSalary(notes) {
  if (!notes) return '';
  const m = notes.match(/\$[\d,.]+[Kk]?(?:\/(?:yr|year|dag|day|hr|t))?(?:\s*[-\u2013]\s*\$[\d,.]+[Kk]?(?:\/(?:yr|year|dag|day|hr|t))?)?|\u00a3[\d,.]+[Kk]?(?:\/(?:yr|year))?(?:\s*[-\u2013]\s*\u00a3[\d,.]+[Kk]?(?:\/(?:yr|year))?)?/);
  return m ? m[0] : '';
}

function extractSource(l) {
  const c = (l.company||'').toLowerCase();
  if (c.includes('silent professionals')) return 'Silent Professionals';
  if (c.includes('gdba') || c.includes('gavin de becker')) return 'GDBA';
  if (c.includes('gardaworld') || c.includes('garda')) return 'GardaWorld';
  if (c.includes('constellis')) return 'Constellis';
  if (c.includes('crisis24')) return 'Crisis24';
  if (c.includes('guildhall') || c.includes('gulftale')) return 'GulfTalent';
  if (c.includes('nato') || c.includes('undss') || c.includes('unops') || c.includes('osce') || c.includes('interpol')) return 'Intl Org';
  if ((l.notes||'').includes('LinkedIn')) return 'LinkedIn';
  if ((l.notes||'').includes('Indeed')) return 'Indeed';
  return '';
}

function getApplyUrl(l) {
  if (!l.website) return '';
  return l.website.startsWith('http') ? l.website : 'https://' + l.website;
}

function renderList(list) {
  const el = document.getElementById('leads');
  if (!list.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">${activeTab==='jobs'?'\u{1F4BC}':'\u{1F6E1}\uFE0F'}</div><div class="empty-text">${activeTab==='jobs'?'No job listings yet':'No companies yet'}</div></div>`;
    return;
  }

  if (activeTab === 'jobs') {
    // Sort by posted_at (source date) descending by default if sort is 'date' or 'priority'
    const sortBy = document.getElementById('sort-by').value;
    if (sortBy === 'date' || sortBy === 'priority') {
      list.sort((a,b) => (b.posted_at||b.created_at||'').localeCompare(a.posted_at||a.created_at||''));
    }

    // Group jobs by posted date
    let html = '';
    let lastDateLabel = '';
    const today = new Date(); today.setHours(0,0,0,0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate()-7);

    function dateLabel(dateStr) {
      if (!dateStr) return 'Unknown date';
      const d = new Date(dateStr); d.setHours(0,0,0,0);
      if (d.getTime() === today.getTime()) return 'Today';
      if (d.getTime() === yesterday.getTime()) return 'Yesterday';
      if (d > weekAgo) {
        const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        return days[d.getDay()];
      }
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    }

    // Job type detection for color stripe
    function jobType(l) {
      const hay = [l.company,l.notes,l.location].filter(Boolean).join(' ').toLowerCase();
      if (/psd|hostile|conflict|armed|combat|deployed/.test(hay)) return 'psd';
      if (/maritime|vessel|ship|offshore|piracy/.test(hay)) return 'maritime';
      if (/residential|static|estate|concierge|gatehouse/.test(hay)) return 'static';
      if (/corporate|event|festival|venue/.test(hay)) return 'corporate';
      return 'ep'; // default executive protection
    }
    const typeStripe = {psd:'#e74c3c',ep:'#C9A84C',maritime:'#3498db',static:'#3ecf8e',corporate:'#a855f7'};
    const typeLabel = {psd:'PSD / HOSTILE',ep:'EXECUTIVE PROTECTION',maritime:'MARITIME',static:'STATIC / RESIDENTIAL',corporate:'CORPORATE'};

    // Country flag emoji
    function countryFlag(country) {
      const flags = {'UK':'\u{1F1EC}\u{1F1E7}','USA':'\u{1F1FA}\u{1F1F8}','UAE':'\u{1F1E6}\u{1F1EA}','Saudi Arabia':'\u{1F1F8}\u{1F1E6}','KSA':'\u{1F1F8}\u{1F1E6}','Qatar':'\u{1F1F6}\u{1F1E6}','France':'\u{1F1EB}\u{1F1F7}','Germany':'\u{1F1E9}\u{1F1EA}','Nigeria':'\u{1F1F3}\u{1F1EC}','Kenya':'\u{1F1F0}\u{1F1EA}','South Africa':'\u{1F1FF}\u{1F1E6}','Australia':'\u{1F1E6}\u{1F1FA}','Canada':'\u{1F1E8}\u{1F1E6}','Iraq':'\u{1F1EE}\u{1F1F6}','Afghanistan':'\u{1F1E6}\u{1F1EB}','Jordan':'\u{1F1EF}\u{1F1F4}','Switzerland':'\u{1F1E8}\u{1F1ED}','Singapore':'\u{1F1F8}\u{1F1EC}','India':'\u{1F1EE}\u{1F1F3}','Brazil':'\u{1F1E7}\u{1F1F7}'};
      return flags[country] || '\u{1F310}';
    }

    // Source icon
    function sourceIcon(src) {
      if (!src) return '';
      if (src.includes('LinkedIn')) return '<span style="background:#0a66c2;color:#fff;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:700">in</span>';
      if (src.includes('Indeed')) return '<span style="background:#2164f3;color:#fff;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:700">iD</span>';
      if (src.includes('Reed')) return '<span style="background:#d4002a;color:#fff;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:700">R</span>';
      if (src.includes('Silent')) return '<span style="background:#1a1a2e;color:#C9A84C;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:700;border:1px solid rgba(201,168,76,.3)">\u{1F6E1}</span>';
      return '<span style="background:rgba(201,168,76,.1);color:#C9A84C;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:600">'+esc(src.substring(0,8))+'</span>';
    }

    // Freshness badge
    function freshBadge(l) {
      const posted = new Date(l.posted_at || l.created_at || 0);
      const hours = (Date.now() - posted.getTime()) / 3600000;
      if (hours < 24) return '<span style="background:linear-gradient(135deg,#C9A84C,#8B7635);color:#06080d;padding:2px 8px;border-radius:3px;font-size:9px;font-weight:800;letter-spacing:1px;animation:pulse 2s infinite">NEW</span>';
      if (hours < 72) return '<span style="background:rgba(231,76,60,.15);color:#e74c3c;padding:2px 8px;border-radius:3px;font-size:9px;font-weight:700;letter-spacing:1px">HOT</span>';
      if (hours < 168) return '';
      return '';
    }

    // Render grouped by date
    for (const l of list) {
      const label = dateLabel(l.posted_at || l.created_at);
      if (label !== lastDateLabel) {
        const count = list.filter(j => dateLabel(j.posted_at || j.created_at) === label).length;
        html += `<div style="padding:16px 0 10px;margin-top:${lastDateLabel?'16px':'0'};display:flex;align-items:center;gap:10px">
          <span style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#C9A84C">${label}</span>
          <span style="background:rgba(201,168,76,.15);color:#C9A84C;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">${count}</span>
          <span style="flex:1;height:1px;background:rgba(201,168,76,.1)"></span>
        </div>`;
        lastDateLabel = label;
      }

      const salary = extractSalary(l.notes);
      const source = extractSource(l);
      const url = getApplyUrl(l);
      const cleanTitle = esc(l.company).replace(/^.*?\u2014\s*/, '');
      const companyName = esc(l.company).includes('\u2014') ? esc(l.company).split('\u2014')[0].trim() : '';
      const jt = jobType(l);
      const flag = countryFlag(l.country);
      const desc = (l.notes||'').replace(/\$[\d,.]+[Kk]?(?:\/\w+)?(?:\s*[-–]\s*\$[\d,.]+[Kk]?(?:\/\w+)?)?/g,'').trim();
      const shortDesc = desc.length > 120 ? desc.substring(0,120)+'...' : desc;

      html += `
      <div onclick="openDetail('${l.id}')" style="position:relative;background:var(--card-bg);border:1px solid var(--card-border);border-radius:10px;padding:0;margin-bottom:8px;cursor:pointer;transition:all .2s;overflow:hidden" onmouseover="this.style.borderColor='rgba(201,168,76,.3)';this.style.transform='translateY(-1px)'" onmouseout="this.style.borderColor='var(--card-border)';this.style.transform='none'">
        <div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:${typeStripe[jt]};border-radius:10px 0 0 10px"></div>
        <div style="padding:14px 14px 14px 16px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
                ${freshBadge(l)}
                <span style="font-size:9px;font-weight:600;letter-spacing:1px;color:${typeStripe[jt]};text-transform:uppercase">${typeLabel[jt]}</span>
              </div>
              <div style="font-size:14px;font-weight:700;color:var(--text-primary);line-height:1.3">${cleanTitle || esc(l.company)}</div>
              ${companyName ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px">${companyName}</div>` : ''}
            </div>
            ${salary ? `<div style="text-align:right;flex-shrink:0"><div style="font-size:15px;font-weight:800;color:#C9A84C;white-space:nowrap">${esc(salary)}</div><div style="font-size:9px;color:var(--text-muted);margin-top:1px">per annum</div></div>` : '<div style="font-size:11px;color:var(--text-muted);font-style:italic">Competitive</div>'}
          </div>
          ${shortDesc ? `<div style="font-size:12px;color:var(--text-secondary);line-height:1.5;margin-bottom:10px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(shortDesc)}</div>` : ''}
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${l.location ? `<span style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:4px">${flag} ${esc(l.location)}${l.country && l.country!=='UK' && l.country!=='USA' ? ' \u00b7 '+esc(l.country) : ''}</span>` : ''}
            ${sourceIcon(source)}
            <span style="margin-left:auto;display:flex;align-items:center;gap:6px">
              ${url ? `<a href="${url}" target="_blank" onclick="if(!gateApply(event))return" style="background:linear-gradient(135deg,#C9A84C,#8B7635);color:#06080d;padding:5px 14px;border-radius:5px;font-size:10px;font-weight:800;text-decoration:none;letter-spacing:0.5px">APPLY</a>` : ''}
              <button onclick="event.stopPropagation();toggleSaved('${l.id}');applyFilters();updateSavedCount()" style="background:none;border:none;cursor:pointer;font-size:18px;opacity:${l.saved?'1':'.35'};transition:opacity .15s;padding:0" title="${l.saved?'Unsave':'Save'}">${l.saved?'\u2605':'\u2606'}</button>
            </span>
          </div>
        </div>
      </div>`;
    }
    el.innerHTML = html;
  } else {
    el.innerHTML = list.map(l => `
      <div class="lead-card" onclick="openDetail('${l.id}')">
        <div class="status-dot" style="background:${statusColors[l.status]||'#52504d'}"></div>
        <div class="lead-info">
          <div class="lead-company">${esc(l.company)}</div>
          <div class="lead-meta">
            ${l.contact_person?'<span>'+esc(l.contact_person)+'</span>':''}
            ${l.location?'<span>'+esc(l.location)+(l.country&&l.country!=='UK'&&l.country!=='USA'?' \u00b7 '+esc(l.country):'')+'</span>':''}
          </div>
        </div>
        <div class="lead-badges">
          <button onclick="event.stopPropagation();toggleSaved('${l.id}');applyFilters();updateSavedCount()" style="background:none;border:none;cursor:pointer;font-size:16px;opacity:${l.saved?'1':'.4'};transition:opacity .15s" title="${l.saved?'Unsave':'Save'}">${l.saved?'\u2605':'\u2606'}</button>
          <span class="badge ${typeBadge[l.type]||'badge-security'}">${typeLabels[l.type]||l.type}</span>
        </div>
      </div>`
    ).join('');
  }
}

function updateSavedCount() {
  document.getElementById('count-saved').textContent = leads.filter(l=>l.saved).length;
}

function updateStatus(id, status) {
  const idx = leads.findIndex(x=>x.id===id);
  if (idx>=0) { leads[idx].status = status; leads[idx].updated_at = new Date().toISOString(); persist(); refresh(); }
}

function esc(s) { if(!s)return''; const d=document.createElement('div');d.textContent=s;return d.innerHTML; }

function openAdd() {
  document.getElementById('modal-title').textContent = activeTab === 'jobs' ? 'New Job Listing' : 'New Company';
  document.getElementById('edit-id').value = '';
  ['f-company','f-contact','f-email','f-phone','f-website','f-location','f-notes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('f-type').value='security';
  document.getElementById('f-status').value='ny';
  document.getElementById('f-priority').value='medium';
  document.getElementById('f-country').value='UK';
  document.getElementById('f-category').value = activeTab === 'jobs' ? 'job' : 'company';
  document.getElementById('modal-bg').classList.add('open');
  setTimeout(()=>document.getElementById('f-company').focus(),100);
}

function openEdit(id) {
  const l = leads.find(x=>x.id===id);
  if(!l)return;
  closeDetail();
  document.getElementById('modal-title').textContent = 'Edit';
  document.getElementById('edit-id').value = id;
  document.getElementById('f-company').value = l.company||'';
  document.getElementById('f-type').value = l.type||'security';
  document.getElementById('f-category').value = l.category||(isJob(l)?'job':'company');
  document.getElementById('f-contact').value = l.contact_person||'';
  document.getElementById('f-email').value = l.email||'';
  document.getElementById('f-phone').value = l.phone||'';
  document.getElementById('f-website').value = l.website||'';
  document.getElementById('f-location').value = l.location||'';
  document.getElementById('f-country').value = l.country||'UK';
  document.getElementById('f-status').value = l.status||'ny';
  document.getElementById('f-priority').value = l.priority||'medium';
  document.getElementById('f-notes').value = l.notes||'';
  document.getElementById('modal-bg').classList.add('open');
}

function closeModal() { const m=document.getElementById('modal-bg'); if(m){m.classList.remove('open');} }

function save() {
  const company = document.getElementById('f-company').value.trim();
  if (!company) { document.getElementById('f-company').style.borderColor='var(--red)'; return; }
  const data = {
    company,
    category: document.getElementById('f-category').value,
    type: document.getElementById('f-type').value,
    contact_person: document.getElementById('f-contact').value.trim()||null,
    email: document.getElementById('f-email').value.trim()||null,
    phone: document.getElementById('f-phone').value.trim()||null,
    website: document.getElementById('f-website').value.trim()||null,
    location: document.getElementById('f-location').value.trim()||null,
    country: document.getElementById('f-country').value.trim()||'UK',
    status: document.getElementById('f-status').value,
    priority: document.getElementById('f-priority').value,
    notes: document.getElementById('f-notes').value.trim()||null
  };
  const editId = document.getElementById('edit-id').value;
  if (editId) {
    const idx = leads.findIndex(x=>x.id===editId);
    if (idx>=0) { leads[idx] = {...leads[idx], ...data, updated_at: new Date().toISOString()}; }
  } else {
    data.id = uid();
    data.created_at = new Date().toISOString();
    data.updated_at = data.created_at;
    leads.unshift(data);
  }
  persist();
  closeModal();
  refresh();
}

function openDetail(id) {
  const l = leads.find(x=>x.id===id);
  if(!l)return;
  // Gate job details behind subscription
  if (isJob(l) && !_isSubscribed) { showPaywall(); return; }
  const salary = extractSalary(l.notes);
  const panel = document.getElementById('detail');
  panel.innerHTML = `
    <div class="detail-header">
      <h2>${esc(l.company)}</h2>
      <button class="close-btn" onclick="closeDetail()">\u2715</button>
    </div>
    <div class="detail-section">
      ${isJob(l)?'<div class="detail-row"><span class="detail-label">Category</span><span class="detail-value"><span class="badge badge-job">JOB LISTING</span></span></div>':''}
      <div class="detail-row"><span class="detail-label">Type</span><span class="detail-value"><span class="badge ${typeBadge[l.type]}">${typeLabels[l.type]||l.type}</span></span></div>
      <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value"><span style="color:${statusColors[l.status]};font-weight:600">${statusLabels[l.status]||l.status||'New'}</span></span></div>
      <div class="detail-row"><span class="detail-label">Priority</span><span class="detail-value" style="font-weight:600;color:${l.priority==='hot'?'var(--red)':l.priority==='low'?'var(--muted)':'var(--amber)'}">${l.priority?l.priority.charAt(0).toUpperCase()+l.priority.slice(1):''}</span></div>
      ${salary?`<div class="detail-row"><span class="detail-label">Salary</span><span class="detail-value salary-tag" style="font-size:15px">${esc(salary)}</span></div>`:''}
      ${l.contact_person?`<div class="detail-row"><span class="detail-label">Contact</span><span class="detail-value">${esc(l.contact_person)}</span></div>`:''}
      ${l.email?`<div class="detail-row"><span class="detail-label">Email</span><span class="detail-value"><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></span></div>`:''}
      ${l.phone?`<div class="detail-row"><span class="detail-label">Phone</span><span class="detail-value"><a href="tel:${esc(l.phone)}">${esc(l.phone)}</a></span></div>`:''}
      ${l.website?`<div class="detail-row"><span class="detail-label">${isJob(l)?'Apply':'Website'}</span><span class="detail-value"><a href="${l.website.startsWith('http')?esc(l.website):'https://'+esc(l.website)}" target="_blank" ${isJob(l)?'onclick="if(!gateApply(event))return"':''}>${isJob(l)?'Apply Now \u2192':esc(l.website)}</a></span></div>`:''}
      ${l.location?`<div class="detail-row"><span class="detail-label">Location</span><span class="detail-value">${esc(l.location)}${l.country?' \u00b7 '+esc(l.country):''}</span></div>`:''}
      ${l.notes?`<div style="margin-top:16px"><div class="detail-label" style="margin-bottom:6px">Notes</div><div style="font-size:13px;color:var(--muted);line-height:1.5;white-space:pre-wrap">${esc(l.notes)}</div></div>`:''}
    </div>
    <div style="display:flex;gap:8px;margin-top:24px">
      <button class="btn btn-ghost" onclick="openEdit('${l.id}')" style="flex:1">Edit</button>
      <button class="btn btn-danger btn-sm" onclick="deleteLead('${l.id}')">Delete</button>
    </div>
    <div style="margin-top:16px;font-size:10px;color:var(--muted)">Added ${new Date(l.created_at).toLocaleDateString('en-GB')}</div>
  `;
  panel.classList.add('open');
  document.getElementById('detail-bg').classList.add('open');
}

function closeDetail() {
  document.getElementById('detail').classList.remove('open');
  document.getElementById('detail-bg').classList.remove('open');
}

function deleteLead(id) {
  if (!confirm('Delete this lead?')) return;
  leads = leads.filter(x=>x.id!==id);
  persist();
  closeDetail();
  refresh();
}

function refresh() {
  renderStats();
  applyFilters();
}

// === EXPORT ===
function toggleExport() {
  document.getElementById('export-menu').classList.toggle('open');
}
document.addEventListener('click', e => {
  if(!e.target.closest('.export-menu')) document.getElementById('export-menu').classList.remove('open');
});

function exportCSV(filter) {
  let data = leads;
  if(filter==='companies') data = leads.filter(l=>!isJob(l));
  else if(filter==='jobs') data = leads.filter(l=>isJob(l));
  const headers = ['Company','Type','Category','Status','Priority','Location','Country','Website','Email','Phone','Contact','Notes','Created'];
  const rows = data.map(l=>[l.company,l.type,l.category||'company',l.status,l.priority,l.location,l.country,l.website,l.email,l.phone,l.contact_person,l.notes,l.created_at].map(v=>'"'+(v||'').replace(/"/g,'""')+'"'));
  const csv = [headers.join(','), ...rows.map(r=>r.join(','))].join('\n');
  downloadFile('cpo_leads_'+filter+'_'+new Date().toISOString().slice(0,10)+'.csv', csv, 'text/csv');
  document.getElementById('export-menu').classList.remove('open');
}

function exportJSON() {
  downloadFile('cpo_leads_backup_'+new Date().toISOString().slice(0,10)+'.json', JSON.stringify(leads,null,2), 'application/json');
  document.getElementById('export-menu').classList.remove('open');
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=name; a.click();
  URL.revokeObjectURL(url);
}

// === DASHBOARD ===
function renderDashboard() {
  const companies = leads.filter(l=>!isJob(l));
  const jobs = leads.filter(l=>isJob(l));
  const all = leads;

  // Status breakdown
  const statusCounts = {};
  all.forEach(l => { const s=statusLabels[l.status]||'New'; statusCounts[s]=(statusCounts[s]||0)+1; });
  const maxStatus = Math.max(...Object.values(statusCounts),1);

  // Region breakdown
  const regionCounts = {};
  all.forEach(l => {
    let region = 'Other';
    for(const [r,countries] of Object.entries(regionMap)) {
      if(matchRegion(l,r)){region=r;break;}
    }
    regionCounts[region]=(regionCounts[region]||0)+1;
  });

  // Type breakdown
  const typeCounts = {};
  all.forEach(l => { const t=typeLabels[l.type]||l.type; typeCounts[t]=(typeCounts[t]||0)+1; });

  // Priority breakdown
  const priCounts = {hot:0,medium:0,low:0};
  all.forEach(l => { priCounts[l.priority||'medium']++; });

  // Salary stats for jobs
  const salaries = jobs.map(j=>parseSalaryNum(j.notes)).filter(s=>s>0);
  const avgSalary = salaries.length ? Math.round(salaries.reduce((a,b)=>a+b,0)/salaries.length) : 0;
  const maxSalary = salaries.length ? Math.max(...salaries) : 0;

  // Top salary jobs
  const topJobs = [...jobs].filter(j=>parseSalaryNum(j.notes)>0).sort((a,b)=>parseSalaryNum(b.notes)-parseSalaryNum(a.notes)).slice(0,5);

  const el = document.getElementById('dashboard-view');
  el.innerHTML = `
  <div class="dash-grid">
    <div class="dash-card">
      <h3>Application Pipeline</h3>
      <div class="dash-pipeline">
        <div class="dash-pipe-stage"><div class="pipe-val" style="color:#52504d">${statusCounts['New']||0}</div><div class="pipe-label">New</div></div>
        <div class="dash-pipe-stage"><div class="pipe-val" style="color:#2980b9">${statusCounts['Contacted']||0}</div><div class="pipe-label">Contacted</div></div>
        <div class="dash-pipe-stage"><div class="pipe-val" style="color:#8e44ad">${statusCounts['Applied']||0}</div><div class="pipe-label">Applied</div></div>
        <div class="dash-pipe-stage"><div class="pipe-val" style="color:#D4AF37">${statusCounts['Interview']||0}</div><div class="pipe-label">Interview</div></div>
        <div class="dash-pipe-stage"><div class="pipe-val" style="color:#27ae60">${statusCounts['Offer']||0}</div><div class="pipe-label">Offer</div></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:16px">
        <div style="text-align:center;flex:1"><div style="font-size:28px;font-weight:800;color:var(--accent)">${companies.length}</div><div style="font-size:10px;color:var(--muted);text-transform:uppercase">Companies</div></div>
        <div style="text-align:center;flex:1"><div style="font-size:28px;font-weight:800;color:var(--amber)">${jobs.length}</div><div style="font-size:10px;color:var(--muted);text-transform:uppercase">Job Listings</div></div>
        <div style="text-align:center;flex:1"><div style="font-size:28px;font-weight:800;color:var(--red)">${priCounts.hot}</div><div style="font-size:10px;color:var(--muted);text-transform:uppercase">Hot Priority</div></div>
      </div>
    </div>

    <div class="dash-card">
      <h3>By Region</h3>
      <div class="dash-regions">
        ${Object.entries(regionCounts).sort((a,b)=>b[1]-a[1]).map(([r,c])=>
          `<div class="region-chip" onclick="document.getElementById('filter-country').value='${r}';switchTab('companies')">${r}<span class="region-count">${c}</span></div>`
        ).join('')}
      </div>
    </div>

    <div class="dash-card">
      <h3>Status Breakdown</h3>
      ${Object.entries(statusCounts).sort((a,b)=>b[1]-a[1]).map(([s,c])=>{
        const color = statusColors[Object.keys(statusLabels).find(k=>statusLabels[k]===s)||'ny']||'#52504d';
        return `<div class="dash-bar"><span class="dash-bar-label">${s}</span><div class="dash-bar-track"><div class="dash-bar-fill" style="width:${Math.round(c/maxStatus*100)}%;background:${color}"></div></div><span class="dash-bar-count" style="color:${color}">${c}</span></div>`;
      }).join('')}
    </div>

    <div class="dash-card">
      <h3>Salary Intel</h3>
      ${salaries.length ? `
        <div style="display:flex;gap:16px;margin-bottom:16px">
          <div style="flex:1;text-align:center"><div style="font-size:24px;font-weight:800;color:var(--accent)">$${avgSalary.toLocaleString()}</div><div style="font-size:10px;color:var(--muted);text-transform:uppercase">Avg Salary</div></div>
          <div style="flex:1;text-align:center"><div style="font-size:24px;font-weight:800;color:var(--accent)">$${maxSalary.toLocaleString()}</div><div style="font-size:10px;color:var(--muted);text-transform:uppercase">Highest</div></div>
        </div>
        <h3 style="margin-top:12px">Top Paying</h3>
        ${topJobs.map(j=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span style="font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(j.company)}</span><span style="color:var(--accent);font-weight:700;font-size:12px;margin-left:8px">${extractSalary(j.notes)}</span></div>`).join('')}
      ` : '<div style="color:var(--muted);font-size:13px">No salary data in job listings</div>'}
    </div>

    <div class="dash-card">
      <h3>By Type</h3>
      ${Object.entries(typeCounts).sort((a,b)=>b[1]-a[1]).map(([t,c])=>{
        const pct = Math.round(c/all.length*100);
        return `<div class="dash-bar"><span class="dash-bar-label">${t}</span><div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pct}%;background:var(--accent)"></div></div><span class="dash-bar-count">${c}</span></div>`;
      }).join('')}
    </div>

    <div class="dash-card">
      <h3>Quick Actions</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn btn-primary btn-sm" onclick="switchTab('jobs')" style="justify-content:center">Browse ${jobs.length} Job Listings</button>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('filter-status').value='ny';switchTab('companies')" style="justify-content:center">Review New Companies (${statusCounts['New']||0})</button>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('sort-by').value='salary';switchTab('jobs')" style="justify-content:center">Jobs by Salary</button>
        <button class="btn btn-ghost btn-sm" onclick="exportCSV('all')" style="justify-content:center">Export All Data</button>
      </div>
    </div>
  </div>

  <div style="margin-top:24px;background:var(--card-bg);border:1px solid var(--card-border);border-radius:12px;padding:20px;overflow:hidden">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div>
        <h3 style="font-size:14px;font-weight:700;color:var(--fg);margin:0">Global Operations Monitor</h3>
        <p style="font-size:11px;color:var(--muted);margin:4px 0 0">Active contracts & threat zones across 7 regions</p>
      </div>
      <div style="display:flex;gap:12px;font-size:10px;color:var(--muted)">
        <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:#C9A84C;display:inline-block"></span> Opportunities</span>
        <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:#c0392b;display:inline-block"></span> Threat Zones</span>
        <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:#2980b9;display:inline-block"></span> Intel Nodes</span>
      </div>
    </div>
    <svg viewBox="0 0 900 440" style="width:100%;height:auto;opacity:.9">
      <rect width="900" height="440" fill="transparent"/>
      <!-- Grid lines -->
      <line x1="0" y1="110" x2="900" y2="110" stroke="rgba(201,168,76,.04)" stroke-width="0.5"/>
      <line x1="0" y1="220" x2="900" y2="220" stroke="rgba(201,168,76,.04)" stroke-width="0.5"/>
      <line x1="0" y1="330" x2="900" y2="330" stroke="rgba(201,168,76,.04)" stroke-width="0.5"/>
      <line x1="225" y1="0" x2="225" y2="440" stroke="rgba(201,168,76,.04)" stroke-width="0.5"/>
      <line x1="450" y1="0" x2="450" y2="440" stroke="rgba(201,168,76,.04)" stroke-width="0.5"/>
      <line x1="675" y1="0" x2="675" y2="440" stroke="rgba(201,168,76,.04)" stroke-width="0.5"/>
      <!-- North America -->
      <circle cx="180" cy="130" r="2" fill="rgba(201,168,76,0.25)"/>
      <circle cx="200" cy="145" r="2.5" fill="rgba(201,168,76,0.3)"/>
      <circle cx="220" cy="140" r="2" fill="rgba(201,168,76,0.2)"/>
      <circle cx="160" cy="150" r="2" fill="rgba(201,168,76,0.2)"/>
      <circle cx="240" cy="160" r="2.5" fill="rgba(201,168,76,0.25)"/>
      <circle cx="170" cy="170" r="2" fill="rgba(201,168,76,0.2)"/>
      <circle class="map-dot" cx="200" cy="145" r="5" fill="#C9A84C" opacity="0.8"><animate attributeName="r" values="5;7;5" dur="3s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.8;0.4;0.8" dur="3s" repeatCount="indefinite"/></circle>
      <text x="200" y="185" fill="rgba(201,168,76,.4)" font-size="9" font-family="Inter,sans-serif" text-anchor="middle">AMERICAS</text>
      <!-- Europe -->
      <circle cx="420" cy="105" r="2" fill="rgba(201,168,76,0.25)"/>
      <circle cx="440" cy="110" r="2.5" fill="rgba(201,168,76,0.3)"/>
      <circle cx="460" cy="105" r="2" fill="rgba(201,168,76,0.2)"/>
      <circle cx="435" cy="120" r="2" fill="rgba(201,168,76,0.25)"/>
      <circle cx="450" cy="95" r="2" fill="rgba(201,168,76,0.2)"/>
      <circle class="map-dot" cx="428" cy="112" r="4.5" fill="#C9A84C" opacity="0.8"><animate attributeName="r" values="4.5;6.5;4.5" dur="3.5s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.8;0.4;0.8" dur="3.5s" repeatCount="indefinite"/></circle>
      <circle class="map-dot" cx="458" cy="118" r="3.5" fill="#2980b9" opacity="0.7"><animate attributeName="r" values="3.5;5;3.5" dur="4s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.7;0.3;0.7" dur="4s" repeatCount="indefinite"/></circle>
      <text x="440" y="145" fill="rgba(201,168,76,.4)" font-size="9" font-family="Inter,sans-serif" text-anchor="middle">EUROPE</text>
      <!-- Middle East -->
      <circle cx="520" cy="170" r="2.5" fill="rgba(201,168,76,0.3)"/>
      <circle cx="535" cy="165" r="2" fill="rgba(201,168,76,0.25)"/>
      <circle cx="540" cy="180" r="2.5" fill="rgba(201,168,76,0.3)"/>
      <circle cx="510" cy="175" r="2" fill="rgba(201,168,76,0.2)"/>
      <circle cx="548" cy="170" r="2" fill="rgba(201,168,76,0.2)"/>
      <circle class="map-dot" cx="530" cy="172" r="5.5" fill="#c0392b" opacity="0.6"><animate attributeName="r" values="5.5;8;5.5" dur="2.5s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.6;0.25;0.6" dur="2.5s" repeatCount="indefinite"/></circle>
      <circle class="map-dot" cx="540" cy="182" r="4" fill="#C9A84C" opacity="0.8"><animate attributeName="r" values="4;6;4" dur="3s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.8;0.4;0.8" dur="3s" repeatCount="indefinite"/></circle>
      <text x="530" y="205" fill="rgba(201,168,76,.4)" font-size="9" font-family="Inter,sans-serif" text-anchor="middle">MIDDLE EAST</text>
      <!-- Africa -->
      <circle cx="450" cy="230" r="2.5" fill="rgba(201,168,76,0.3)"/>
      <circle cx="465" cy="250" r="2" fill="rgba(201,168,76,0.25)"/>
      <circle cx="440" cy="260" r="2.5" fill="rgba(201,168,76,0.3)"/>
      <circle cx="475" cy="220" r="2" fill="rgba(201,168,76,0.2)"/>
      <circle cx="455" cy="280" r="2" fill="rgba(201,168,76,0.2)"/>
      <circle cx="480" cy="270" r="2" fill="rgba(201,168,76,0.2)"/>
      <circle class="map-dot" cx="445" cy="235" r="5" fill="#c0392b" opacity="0.5"><animate attributeName="r" values="5;7.5;5" dur="2.8s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.5;0.2;0.5" dur="2.8s" repeatCount="indefinite"/></circle>
      <circle class="map-dot" cx="490" cy="310" r="3" fill="#C9A84C" opacity="0.7"><animate attributeName="r" values="3;5;3" dur="3.2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.7;0.3;0.7" dur="3.2s" repeatCount="indefinite"/></circle>
      <text x="460" y="305" fill="rgba(201,168,76,.4)" font-size="9" font-family="Inter,sans-serif" text-anchor="middle">AFRICA</text>
      <!-- Central/South Asia -->
      <circle cx="580" cy="160" r="2" fill="rgba(201,168,76,0.2)"/>
      <circle cx="600" cy="170" r="2.5" fill="rgba(201,168,76,0.3)"/>
      <circle cx="620" cy="180" r="2" fill="rgba(201,168,76,0.25)"/>
      <circle cx="590" cy="185" r="2" fill="rgba(201,168,76,0.2)"/>
      <circle class="map-dot" cx="595" cy="168" r="4.5" fill="#c0392b" opacity="0.5"><animate attributeName="r" values="4.5;7;4.5" dur="2.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.5;0.2;0.5" dur="2.6s" repeatCount="indefinite"/></circle>
      <text x="600" y="200" fill="rgba(201,168,76,.4)" font-size="9" font-family="Inter,sans-serif" text-anchor="middle">SOUTH ASIA</text>
      <!-- East Asia / Pacific -->
      <circle cx="700" cy="160" r="2" fill="rgba(201,168,76,0.2)"/>
      <circle cx="720" cy="150" r="2.5" fill="rgba(201,168,76,0.25)"/>
      <circle cx="740" cy="170" r="2" fill="rgba(201,168,76,0.2)"/>
      <circle cx="710" cy="200" r="2.5" fill="rgba(201,168,76,0.3)"/>
      <circle class="map-dot" cx="715" cy="155" r="3.5" fill="#2980b9" opacity="0.6"><animate attributeName="r" values="3.5;5.5;3.5" dur="4s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.6;0.25;0.6" dur="4s" repeatCount="indefinite"/></circle>
      <text x="720" y="190" fill="rgba(201,168,76,.4)" font-size="9" font-family="Inter,sans-serif" text-anchor="middle">ASIA-PACIFIC</text>
      <!-- Australia -->
      <circle cx="740" cy="330" r="2" fill="rgba(201,168,76,0.15)"/>
      <circle cx="760" cy="320" r="2" fill="rgba(201,168,76,0.2)"/>
      <circle cx="750" cy="340" r="2" fill="rgba(201,168,76,0.15)"/>
      <!-- Connection lines -->
      <line x1="200" y1="145" x2="428" y2="112" stroke="rgba(201,168,76,0.06)" stroke-width="0.5"/>
      <line x1="428" y1="112" x2="530" y2="172" stroke="rgba(201,168,76,0.06)" stroke-width="0.5"/>
      <line x1="530" y1="172" x2="595" y2="168" stroke="rgba(201,168,76,0.06)" stroke-width="0.5"/>
      <line x1="595" y1="168" x2="715" y2="155" stroke="rgba(201,168,76,0.06)" stroke-width="0.5"/>
      <line x1="445" y1="235" x2="530" y2="172" stroke="rgba(201,168,76,0.04)" stroke-width="0.5"/>
      <!-- Dynamic region counters -->
      <text x="200" y="195" fill="#C9A84C" font-size="11" font-family="Inter,sans-serif" text-anchor="middle" font-weight="700">${regionCounts['Americas']||regionCounts['USA']||0}</text>
      <text x="440" y="155" fill="#C9A84C" font-size="11" font-family="Inter,sans-serif" text-anchor="middle" font-weight="700">${regionCounts['Europe']||regionCounts['UK']||0}</text>
      <text x="530" y="215" fill="#C9A84C" font-size="11" font-family="Inter,sans-serif" text-anchor="middle" font-weight="700">${regionCounts['Middle East']||0}</text>
      <text x="460" y="315" fill="#C9A84C" font-size="11" font-family="Inter,sans-serif" text-anchor="middle" font-weight="700">${regionCounts['Africa']||0}</text>
      <text x="720" y="200" fill="#C9A84C" font-size="11" font-family="Inter,sans-serif" text-anchor="middle" font-weight="700">${regionCounts['Asia-Pacific']||0}</text>
    </svg>
    <div style="display:flex;justify-content:space-around;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
      ${Object.entries(regionCounts).sort((a,b)=>b[1]-a[1]).slice(0,7).map(([r,c])=>
        '<div style="text-align:center"><div style="font-size:16px;font-weight:800;color:#C9A84C">'+c+'</div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1px">'+r+'</div></div>'
      ).join('')}
    </div>
  </div>`;
}

// === STRATEGY VIEW ===
function renderStrategy() {
  const companies = leads.filter(l=>!isJob(l));
  const jobs = leads.filter(l=>isJob(l));
  const hotCompanies = companies.filter(l=>l.priority==='hot');
  const newCompanies = companies.filter(l=>l.status==='ny');
  const hotJobs = jobs.filter(l=>l.priority==='hot');

  // Best fit scoring — uses operator's saved profile keywords
  const profile = loadProfile();
  const profileText = [profile.background, profile.languages, profile.certifications, profile.deployments, profile.clearance].filter(Boolean).join(' ').toLowerCase();
  const defaultKeywords = ['security','protection','executive','close protection','military','law enforcement'];
  const profileKeywords = profileText ? profileText.split(/[\s,;]+/).filter(w => w.length > 3) : defaultKeywords;
  const fitKeywords = [...new Set(profileKeywords)].slice(0, 20);
  function fitScore(l) {
    const hay = [l.company,l.notes].filter(Boolean).join(' ').toLowerCase();
    return fitKeywords.reduce((sc,kw) => sc + (hay.includes(kw)?1:0), 0);
  }
  const bestFit = [...companies].map(c=>({...c,fit:fitScore(c)})).filter(c=>c.fit>0).sort((a,b)=>b.fit-a.fit).slice(0,10);
  const profileSummary = profileText ? fitKeywords.slice(0,6).join(', ') : 'Fill out your Profile to get personalized matches';

  const el = document.getElementById('strategy-view');
  el.innerHTML = `
  <div class="dash-grid">
    <div class="dash-card" style="grid-column:1/-1">
      <h3>Your Profile Match Score</h3>
      <div style="font-size:13px;color:var(--muted);margin-bottom:16px">Companies ranked by your profile: ${esc(profileSummary)}</div>
      ${bestFit.map((c,i)=>`
        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="switchTab('companies');setTimeout(()=>openDetail('${c.id}'),100)">
          <span style="font-size:20px;font-weight:800;color:var(--accent);width:30px">#${i+1}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:14px">${esc(c.company)}</div>
            <div style="font-size:11px;color:var(--muted)">${c.location?esc(c.location):''} ${c.country?'· '+esc(c.country):''}</div>
          </div>
          <div style="display:flex;gap:4px">${'*'.repeat(c.fit).split('').map(()=>'<span style="color:var(--accent)">&#9733;</span>').join('')}</div>
          <span style="font-size:11px;color:${statusColors[c.status]||'#52504d'};font-weight:600">${statusLabels[c.status]||'New'}</span>
        </div>
      `).join('')}
    </div>

    <div class="dash-card">
      <h3>This Week's Priorities</h3>
      <div style="font-size:13px;color:var(--muted);margin-bottom:12px">${hotCompanies.filter(c=>c.status==='ny').length} hot companies still untouched</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${hotCompanies.filter(c=>c.status==='ny').slice(0,8).map(c=>`
          <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--surface2);border-radius:6px;cursor:pointer" onclick="switchTab('companies');setTimeout(()=>openDetail('${c.id}'),100)">
            <div style="width:6px;height:6px;border-radius:50%;background:var(--red);flex-shrink:0"></div>
            <span style="font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.company)}</span>
            <span style="font-size:10px;color:var(--muted)">${c.location?esc(c.location):''}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="dash-card">
      <h3>Immediate Job Opportunities</h3>
      <div style="font-size:13px;color:var(--muted);margin-bottom:12px">${hotJobs.filter(j=>j.status==='ny').length} hot jobs you haven't applied to</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${hotJobs.filter(j=>j.status==='ny').slice(0,8).map(j=>{
          const salary = extractSalary(j.notes);
          return `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--surface2);border-radius:6px;cursor:pointer" onclick="switchTab('jobs');setTimeout(()=>openDetail('${j.id}'),100)">
            <span style="font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(j.company)}</span>
            ${salary?`<span style="color:var(--accent);font-weight:700;font-size:11px">${esc(salary)}</span>`:''}
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="dash-card">
      <h3>Action Plan Summary</h3>
      <div style="display:flex;flex-direction:column;gap:10px;font-size:13px">
        <div style="padding:12px;background:rgba(192,57,43,.08);border-radius:8px;border-left:3px solid #c0392b">
          <strong style="color:#c0392b">Urgent:</strong> ${hotJobs.filter(j=>j.status==='ny').length} hot jobs + ${hotCompanies.filter(c=>c.status==='ny').length} hot companies need action
        </div>
        <div style="padding:12px;background:rgba(201,168,76,.08);border-radius:8px;border-left:3px solid var(--accent)">
          <strong style="color:var(--accent)">Pipeline:</strong> ${Object.entries({Contacted:leads.filter(l=>l.status==='kontaktet').length,Applied:leads.filter(l=>l.status==='applied').length,Interview:leads.filter(l=>l.status==='interview').length}).filter(([_,c])=>c>0).map(([s,c])=>c+' '+s).join(', ')||'Empty - start reaching out!'}
        </div>
        <div style="padding:12px;background:rgba(41,128,185,.08);border-radius:8px;border-left:3px solid #2980b9">
          <strong style="color:#2980b9">Focus regions:</strong> ${Object.entries(regionMap).map(([r])=>({r,c:leads.filter(l=>matchRegion(l,r)&&l.priority==='hot').length})).filter(x=>x.c>0).sort((a,b)=>b.c-a.c).slice(0,3).map(x=>x.r+' ('+x.c+')').join(', ')}
        </div>
      </div>
    </div>
  </div>`;
}

// === ACTIVITY LOG ===
const ACTIVITY_KEY = 'cp_activity_log';
let activityLog = JSON.parse(localStorage.getItem(ACTIVITY_KEY)||'[]');

function logActivity(leadId, action, detail) {
  activityLog.unshift({leadId, action, detail, time: new Date().toISOString()});
  if(activityLog.length>500) activityLog = activityLog.slice(0,500);
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activityLog));
}

// Wrap updateStatus to log
const _origUpdateStatus = updateStatus;
updateStatus = function(id, status) {
  const l = leads.find(x=>x.id===id);
  if(l) logActivity(id, 'status_change', `${l.company}: ${statusLabels[l.status]||l.status} → ${statusLabels[status]||status}`);
  _origUpdateStatus(id, status);
};

// Keyboard shortcuts: N = new, Esc = close, D = dashboard, ? = help
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  // Ignore when Ctrl/Cmd/Alt is held (copy, paste, etc)
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'n' || e.key === 'N') openAdd();
  if (e.key === 'Escape') { closeModal(); closeDetail(); }
  if (e.key === 'd') switchTab('dashboard');
  if (e.key === 'j') switchTab('jobs');
  if (e.key === 'c') switchTab('companies');
  if (e.key === 's') switchTab('strategy');
  if (e.key === '?') alert('Keyboard shortcuts:\n\nN = New lead\n/ = Global search\nC = Companies\nJ = Jobs\nD = Dashboard\nS = Strategy\nEsc = Close panel');
});

// === OPERATOR PROFILE ===
const PROFILE_KEY = 'cp_operator_profile';
const CV_KEY = 'cp_operator_cv';

function loadProfile() { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}'); }

function saveProfile() {
  const fields = ['callsign','background','clearance','languages','certifications','deployments','weapons','medical','passport','availability'];
  const profile = {};
  fields.forEach(f => {
    const el = document.getElementById('prof-'+f);
    if(el) profile[f] = el.value;
  });
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  showToast('Profile saved');
}

function renderProfile() {
  const profile = loadProfile();
  const fields = ['callsign','background','clearance','languages','certifications','deployments','weapons','medical','passport','availability'];
  fields.forEach(f => {
    const el = document.getElementById('prof-'+f);
    if(el && profile[f]) el.value = profile[f];
  });
  const cvData = localStorage.getItem(CV_KEY);
  const cvStatus = document.getElementById('cv-status');
  if(cvStatus) {
    if(cvData) {
      const cv = JSON.parse(cvData);
      const isPDF = cv.type === 'application/pdf' || cv.name.toLowerCase().endsWith('.pdf');
      cvStatus.innerHTML = `
        <div style="padding:14px;background:rgba(62,207,142,.05);border:1px solid rgba(62,207,142,.2);border-radius:8px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#3ecf8e" stroke-width="1.5" style="flex-shrink:0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <div style="flex:1;min-width:0">
              <div style="font-size:0.8rem;font-weight:600;color:#3ecf8e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cv.name}</div>
              <div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px">Uploaded successfully</div>
            </div>
          </div>
          <div style="display:flex;gap:6px">
            <button onclick="viewCV()" style="flex:1;padding:8px;background:linear-gradient(135deg,#C9A84C,#8B7635);color:#06080d;border:none;border-radius:5px;font-weight:700;cursor:pointer;font-family:inherit;font-size:0.75rem">OPEN CV</button>
            <button onclick="downloadCV()" style="padding:8px 12px;background:none;border:1px solid var(--card-border);border-radius:5px;color:var(--gold);cursor:pointer;font-family:inherit;font-size:0.75rem">Download</button>
            <button onclick="removeCV()" style="padding:8px 12px;background:none;border:1px solid rgba(231,76,60,.2);border-radius:5px;color:#e74c3c;cursor:pointer;font-family:inherit;font-size:0.75rem">Remove</button>
          </div>
          ${isPDF ? '<iframe src="'+cv.data+'" style="width:100%;height:300px;border:none;border-radius:6px;margin-top:10px;background:#fff"></iframe>' : ''}
        </div>`;
    } else {
      cvStatus.innerHTML = '<span style="color:var(--text-secondary);font-size:0.75rem">No CV uploaded yet</span>';
    }
  }
}

function handleCVUpload(input) {
  const file = input.files[0];
  if(!file) return;
  if(file.size > 5*1024*1024) { alert('Max 5MB'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    localStorage.setItem(CV_KEY, JSON.stringify({name:file.name, type:file.type, data:e.target.result}));
    renderProfile();
  };
  reader.readAsDataURL(file);
}

function viewCV() {
  const cv = JSON.parse(localStorage.getItem(CV_KEY)||'null');
  if(!cv) return;
  window.open(cv.data, '_blank');
}

function downloadCV() {
  const cv = JSON.parse(localStorage.getItem(CV_KEY)||'null');
  if(!cv) return;
  const a = document.createElement('a'); a.href = cv.data; a.download = cv.name; a.click();
}

function removeCV() {
  if(confirm('Remove uploaded CV?')) { localStorage.removeItem(CV_KEY); renderProfile(); }
}

// Profile photo
const PHOTO_KEY = 'cp_operator_photo';

function handlePhotoUpload(input) {
  const file = input.files[0];
  if(!file) return;
  if(file.size > 2*1024*1024) { alert('Max 2MB'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    localStorage.setItem(PHOTO_KEY, e.target.result);
    updateProfilePhotos();
  };
  reader.readAsDataURL(file);
}

function updateProfilePhotos() {
  const photo = localStorage.getItem(PHOTO_KEY);
  document.querySelectorAll('.op-avatar').forEach(el => {
    if(photo) { el.src = photo; }
    else { el.src = 'operator_avatar.png'; }
  });
}

// Toast notification
function showToast(msg) {
  let t = document.getElementById('app-toast');
  if(!t) {
    t = document.createElement('div');
    t.id = 'app-toast';
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);padding:12px 28px;background:rgba(15,20,30,.95);backdrop-filter:blur(12px);border:1px solid rgba(201,168,76,.3);border-radius:8px;color:#C9A84C;font-size:0.85rem;font-weight:600;font-family:Inter,system-ui,sans-serif;letter-spacing:0.5px;z-index:9999;opacity:0;transition:all .3s ease;pointer-events:none;box-shadow:0 8px 32px rgba(0,0,0,.4)';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  t.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(20px)';
  }, 2500);
}

refresh();
