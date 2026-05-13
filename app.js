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
const STRIPE_MONTHLY = 'https://buy.stripe.com/5kQ6oHf42g8rbKAgWj7AI04';
const STRIPE_YEARLY = 'https://buy.stripe.com/eVq7sL8FE3lF01S35t7AI05';

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
  if(data.user) {
    // Auto-login after signup (email confirmation disabled in Supabase)
    const {data:loginData, error:loginErr} = await sb.auth.signInWithPassword({email,password:pass});
    if(loginErr) {
      // If auto-login fails, still show success
      showAuthSuccess('Account created! You can now log in.');
      showLogin();
      return;
    }
    onAuthSuccess(loginData.user);
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
let _isAdmin = false;
let _subToken = 0; // tamper detection token
let currentJobPage = 1;
const JOBS_PER_PAGE = 25;

// Tamper-resistant subscription check
function _verifySub() { return _isSubscribed && _subToken === _expectedToken(); }
function _expectedToken() { return _isSubscribed ? 7919 : 0; }
function _setSub(val, admin) {
  _isSubscribed = !!val;
  _isAdmin = !!admin;
  _subToken = val ? 7919 : 0;
}

// Re-validate subscription periodically (every 5 min)
setInterval(async () => {
  if (!currentUser) return;
  try {
    const res = await fetch(`/api/check-subscription?email=${encodeURIComponent(currentUser.email)}`);
    const sub = await res.json();
    const wasSub = _isSubscribed;
    _setSub(!!sub.active, sub.plan === 'admin');
    // If subscription lapsed, reload jobs with masked data
    if (wasSub && !_isSubscribed) {
      leads = leads.filter(l => l.category !== 'job');
      persist();
      await loadScrapedJobs();
      showPaywall();
    }
  } catch(e) { /* silent — keep current state */ }
}, 5 * 60 * 1000);

// Central gate — ALL job/apply interactions go through this
function gateApply(e, leadId) {
  if (!_verifySub()) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    showPaywall();
    return false;
  }
  // Auto-add to application tracker
  if (leadId) {
    const l = leads.find(x=>x.id===leadId);
    if (l) {
      const apps = loadTracker();
      const already = apps.some(a => a.company === l.company && a.role === (l.title||l.company));
      if (!already) {
        apps.unshift({
          id: Date.now().toString(36),
          company: l.company||'',
          role: l.title||l.company||'',
          location: l.location||'',
          salary: extractSalary(l.notes)||'',
          contact: l.contact_person||'',
          source: l.source||'',
          status: 'applied',
          applied_at: new Date().toISOString().slice(0,10),
          followups: [],
          notes: ''
        });
        saveTracker(apps);
        showToast('Added to Tracker');
      }
    }
  }
  return true;
}

async function onAuthSuccess(user) {
  currentUser = user;
  document.getElementById('user-email').textContent = user.email;

  // Check subscription in background (admin bypass handled server-side)
  try {
    // Pass Stripe customer ID from URL for email-mismatch recovery
    const _cid = new URLSearchParams(window.location.search).get('cid') || '';
    const res = await fetch(`/api/check-subscription?email=${encodeURIComponent(user.email)}${_cid ? '&cid=' + encodeURIComponent(_cid) : ''}`);
    const sub = await res.json();
    _setSub(!!sub.active, sub.plan === 'admin');
    // Clean URL params after successful auth
    if (_cid && sub.active) window.history.replaceState({}, '', '/app.html');
  } catch(e) {
    console.error('Subscription check failed:', e);
    _setSub(false, false);
  }

  // Let everyone in — Jobs tab is gated separately
  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('paywall-overlay')?.remove();
  const ac = document.getElementById('app-container');
  ac.style.display = '';
  ac.style.opacity = '1';
  await loadScrapedJobs();

  // Show Telegram channel invite for subscribers
  if (_verifySub()) {
    showTelegramInvite(user.email);
  }

  // Populate settings page
  if (typeof initSettings === 'function') initSettings();
}

async function showTelegramInvite(email) {
  try {
    const res = await fetch(`/api/telegram-invite?email=${encodeURIComponent(email)}`);
    const data = await res.json();

    // Update Telegram Community page
    const locked = document.getElementById('telegram-locked');
    const unlocked = document.getElementById('telegram-unlocked');
    const joinBtn = document.getElementById('telegram-join-btn');

    if (data.invite_link && locked && unlocked) {
      locked.style.display = 'none';
      unlocked.style.display = '';
      if (joinBtn) joinBtn.href = data.invite_link;
    }
  } catch(e) {
    console.error('Telegram invite check failed:', e);
  }
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
  pw.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(6,8,13,0.97);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(12px);overflow-y:auto;cursor:pointer';
  pw.onclick = function(e) { if (e.target === pw) pw.remove(); };
  pw.innerHTML = `
    <div onclick="event.stopPropagation()" style="max-width:480px;width:100%;cursor:default;font-family:Inter,system-ui,sans-serif;background:rgba(13,17,23,0.95);border:1px solid rgba(201,168,76,.2);border-radius:16px;padding:32px 24px;box-shadow:0 24px 80px rgba(0,0,0,.6)">
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
    // Server-side gated: free users get masked data, paid users get full data
    const email = currentUser?.email || '';
    const res = await fetch(`/api/jobs?email=${encodeURIComponent(email)}`);
    const result = await res.json();
    const data = result.jobs;
    if (!data || !data.length) return;
    const now = new Date().toISOString();

    // Build set of valid DB IDs
    const dbIds = new Set(data.map(j => j.id));

    // Remove local jobs that no longer exist in DB
    const before = leads.length;
    leads = leads.filter(l => l.category !== 'job' || dbIds.has(l.id));
    const removed = before - leads.length;

    // Sync jobs from DB: add new, update existing titles/data
    let added = 0, updated = 0;
    const localMap = new Map(leads.map((l,i) => [l.id, i]));
    for (const j of data) {
      const idx = localMap.get(j.id);
      const newCompany = (j.company || '') + ' \u2014 ' + (j.title || '');
      if (idx !== undefined) {
        // Update existing job if data changed
        const local = leads[idx];
        if (local.company !== newCompany || local._dbTitle !== (j.title||'') || local.location !== (j.location||'') || local.notes !== ((j.description||'') + (j.salary ? ' ' + j.salary + '.' : '') + (j.requirements ? ' Requirements: ' + j.requirements : ''))) {
          local.company = newCompany;
          local._dbTitle = j.title || '';
          local._dbCompany = j.company || '';
          local._masked = j._masked || false;
          local.website = j.source_url || '';
          local.location = j.location || '';
          local.country = j.country || '';
          local.notes = (j.description || '') + (j.salary ? ' ' + j.salary + '.' : '') + (j.requirements ? ' Requirements: ' + j.requirements : '');
          local.updated_at = j.scraped_at || now;
          updated++;
        }
        continue;
      }
      leads.push({
        id: j.id || uid(),
        company: newCompany,
        _dbTitle: j.title || '',
        _dbCompany: j.company || '',
        _masked: j._masked || false,
        source: j.source || '',
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
    if (added > 0 || removed > 0 || updated > 0) {
      persist();
      refresh();
      console.log(`Jobs sync: +${added} added, ~${updated} updated, -${removed} removed, ${leads.filter(l=>l.category==='job').length} total`);
    }
  } catch(e) { console.error('Failed to load scraped jobs:', e); }
}

// Initialize app — no login required
let _authReady = false;
(async () => {
  const appContainer = document.getElementById('app-container');
  const params = window.location.search;

  // Show auth overlay immediately if ?login or ?signup (no flash)
  if (params.includes('login') || params.includes('signup')) {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.style.display = 'flex';
    if (params.includes('signup')) {
      showSignup();
      if (params.includes('paid=true')) {
        showAuthSuccess('Payment confirmed! Create your account below to get started.');
        const urlEmail = new URLSearchParams(params).get('email');
        if (urlEmail) {
          const signupEmail = document.getElementById('signup-email');
          if (signupEmail) { signupEmail.value = urlEmail; signupEmail.readOnly = true; signupEmail.style.opacity = '0.7'; }
        }
      }
    }
  }

  // Use onAuthStateChange as single source of truth (handles token refresh on reload)
  sb.auth.onAuthStateChange(async (event, session) => {
    if (_authReady) {
      // After init: only react to sign-in/sign-out/token refresh
      if(session && session.user) onAuthSuccess(session.user);
      return;
    }
    _authReady = true;
    if(session && session.user) {
      await onAuthSuccess(session.user);
    } else {
      document.getElementById('auth-overlay').style.display = 'flex';
      document.getElementById('app-container').style.display = 'none';
    }
    // Remove loading screen
    appContainer.style.opacity = '1';
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.style.opacity = '0';
      setTimeout(() => loadingScreen.remove(), 400);
    }
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

const SEED_VERSION = 10;
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

const typeLabels = {security:'Security',management:'Management',agency:'Agency',cpo:'Close Protection',pmc:'PMC / Contract',uhnw:'UHNW / Family Office',corporate:'Corporate EP',maritime:'Maritime',psd:'PSD / Hostile',static:'Static / Residential',government:'Government'};
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
  // Gate premium tabs behind subscription/trial (except jobs — soft paywall)
  if (['guide','strategy','companies','settings'].includes(tab) && !_verifySub()) {
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
  showEl('intel-view', tab==='guide');
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
          ${url?'<a href="'+url+'" target="_blank" class="btn-apply" onclick="if(!gateApply(event,\''+l.id+'\'))return">Apply \u2192</a>':''}
          <button class="btn btn-ghost btn-sm" onclick="openDetail('${l.id}')" style="font-size:11px">Details</button>
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();toggleSaved('${l.id}');renderSaved()" style="font-size:11px;color:var(--red);border-color:rgba(239,68,68,.3)">Remove</button>
          <span class="badge ${job?'badge-job':typeBadge[l.type]||'badge-security'}" style="margin-left:auto">${job?'JOB':typeLabels[l.type]||l.type}</span>
        </div>
      </div>`;
    }).join('') + '</div>';
}

let _intelNews = null;
let _intelFilter = 'all';

async function fetchIntelNews() {
  if (_intelNews) return _intelNews;
  try {
    const r = await fetch('intel_news.json?t=' + Date.now());
    _intelNews = await r.json();
  } catch(e) { _intelNews = []; }
  return _intelNews;
}

function formatIntelDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const diff = Math.floor((Date.now() - d) / (1000*60*60));
    if (diff < 1) return 'Just now';
    if (diff < 24) return diff + 'h ago';
    const days = Math.floor(diff / 24);
    if (days < 7) return days + 'd ago';
    return d.toLocaleDateString('en-GB', {day:'numeric',month:'short'});
  } catch(e) { return ''; }
}

function stripHtml(str) {
  if (!str) return '';
  return str.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function getCatColor(cat) {
  return {'Contractor Intel':'#C9A84C','Security Updates':'#c0392b','World News':'#2980b9'}[cat] || 'var(--muted)';
}

async function renderIntel() {
  const el = document.getElementById('intel-view');
  el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--muted)">Loading intel feed...</div>';
  const news = await fetchIntelNews();
  const categories = [...new Set(news.map(n => n.category).filter(Boolean))];
  const filtered = _intelFilter === 'all' ? news : news.filter(n => n.category === _intelFilter);
  const catCounts = {};
  news.forEach(n => { catCounts[n.category] = (catCounts[n.category]||0)+1; });

  el.innerHTML = `
    <div style="margin-bottom:28px">
      <h1 style="font-size:26px;font-weight:800;margin:0 0 6px">Industry Intel</h1>
      <p style="color:var(--muted);font-size:13px;margin:0">Security news, threat updates & contractor intelligence</p>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap">
      <button onclick="_intelFilter='all';renderIntel()" style="padding:6px 14px;border-radius:20px;border:1px solid ${_intelFilter==='all'?'var(--accent)':'var(--border)'};background:${_intelFilter==='all'?'var(--accent)':'transparent'};color:${_intelFilter==='all'?'#000':'var(--muted)'};font-size:12px;font-weight:600;cursor:pointer">All (${news.length})</button>
      ${categories.map(c => `<button onclick="_intelFilter='${c}';renderIntel()" style="padding:6px 14px;border-radius:20px;border:1px solid ${_intelFilter===c?getCatColor(c):'var(--border)'};background:${_intelFilter===c?getCatColor(c):'transparent'};color:${_intelFilter===c?'#000':'var(--muted)'};font-size:12px;font-weight:600;cursor:pointer">${c} (${catCounts[c]||0})</button>`).join('')}
    </div>
    <div style="display:flex;flex-direction:column;gap:12px">
      ${filtered.length === 0 ? '<div style="text-align:center;padding:40px;color:var(--muted)">No articles found</div>' :
        filtered.map(n => {
          const summary = stripHtml(n.summary).slice(0, 180);
          const cc = getCatColor(n.category);
          return '<a href="'+esc(n.source_url)+'" target="_blank" rel="noopener" style="text-decoration:none;display:block;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 20px;transition:border-color .2s" onmouseover="this.style.borderColor=\''+cc+'\'" onmouseout="this.style.borderColor=\'var(--border)\'">'
            +'<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">'
            +'<div style="flex:1;min-width:0">'
            +'<div style="font-size:14px;font-weight:700;color:var(--fg);margin-bottom:6px;line-height:1.4">'+esc(n.title)+'</div>'
            +(summary ? '<div style="font-size:12px;color:var(--muted);line-height:1.5;margin-bottom:8px">'+esc(summary)+(stripHtml(n.summary).length>180?'...':'')+'</div>' : '')
            +'<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'
            +'<span style="font-size:10px;font-weight:700;color:'+cc+';text-transform:uppercase;letter-spacing:.5px">'+(n.category||'News')+'</span>'
            +'<span style="font-size:11px;color:var(--muted)">'+esc(n.source||'')+'</span>'
            +'<span style="font-size:11px;color:var(--muted)">'+formatIntelDate(n.published_at)+'</span>'
            +'</div></div>'
            +'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" style="flex-shrink:0;margin-top:4px"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>'
            +'</div></a>';
        }).join('')}
    </div>
    <div style="margin-top:24px;text-align:center;padding:16px;color:var(--muted);font-size:11px">
      Updated from Google News, ReliefWeb, BBC & security industry feeds
    </div>
  `;
}

function renderGuide() { renderIntel(); }

const regionMap = {
  'UK':['UK','United Kingdom','England','Scotland','Wales','London','Surrey','Manchester','Birmingham','Leeds','Bristol','Liverpool','Glasgow','Edinburgh','Belfast','Cardiff','Knightsbridge','West Brompton','Melton Mowbray','Mayfair'],
  'USA':['USA','US','United States','New York','Los Angeles','Miami','Chicago','Washington','San Francisco','Seattle','Boston','Houston','Dallas','Atlanta','Denver','Virginia','California','Texas','Florida','Pennsylvania','Massachusetts','Ohio','Tennessee','Colorado','Michigan','South Carolina','Georgia','Illinois','Kansas','Minnesota','New Jersey','Arlington','McLean','Hawthorne','Mountain View','San Carlos','Milpitas','Snowmass','Spokane','Kirkland','Princeton','Gurnee','Downey','Savannah','Greenville','Orrville','Iron Mountain','Everett','Franklin','Charleston'],
  'UAE':['UAE','Dubai','Qatar','Saudi','Saudi Arabia','Bahrain','Kuwait','Oman','Abu Dhabi','Riyadh','Jeddah','Doha','NEOM'],
  'Europe':['EU','Europe','Belgium','France','Germany','Netherlands','Switzerland','Austria','Poland','Italy','Spain','Norway','Denmark','Sweden','Finland','Ireland','Portugal','Greece','Czech','Hungary','Romania','Croatia','Serbia','Bulgaria','Ukraine','Latvia','Lithuania','Estonia','Luxembourg','Malta','Cyprus','Iceland','Paris','Berlin','Munich','Amsterdam','Brussels','Oslo','Stockholm','Copenhagen','Helsinki','Madrid','Rome','Milan','Vienna','Zurich','Geneva','Prague','Warsaw','Budapest','Lisbon','Dublin','Athens'],
  'Africa':['Ghana','Nigeria','Kenya','South Africa','DRC','Angola','Mozambique','Tanzania','Uganda','Ethiopia','Sudan','Somalia','Egypt','Libya','Morocco','Tunisia','Gauteng','Western Cape','Johannesburg','Cape Town','Pretoria','Lagos','Nairobi'],
  'Asia':['Singapore','Japan','China','Hong Kong','India','Philippines','Indonesia','Thailand','Vietnam','Australia','New Zealand','Myanmar','East Asia','Tokyo','Sydney','Melbourne','Bangkok','Kuala Lumpur','Seoul','Taipei','Jakarta','Mumbai','Delhi'],
  'LATAM':['Colombia','Argentina','El Salvador','Guatemala','Brazil','Mexico','Chile','Peru','Ecuador','Panama','Costa Rica','Bogota','Buenos Aires','Mexico City','Sao Paulo','Lima','Santiago'],
  'Canada':['Canada','Toronto','Vancouver','Montreal','Ottawa','Calgary'],
  'International':['International','Global','Globalt','Remote','Worldwide']
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

function applyFilters(resetPage) {
  if (resetPage) currentJobPage = 1;
  const filtered = getFiltered();
  const sortBy = document.getElementById('sort-by').value;
  if(sortBy==='salary') filtered.sort((a,b) => parseSalaryNum(b.notes) - parseSalaryNum(a.notes));
  else if(sortBy==='date') filtered.sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''));
  else if(sortBy==='name') filtered.sort((a,b) => (a.company||'').localeCompare(b.company||''));
  else if(sortBy==='status') {
    const so={ny:0,kontaktet:1,applied:2,interview:3,offer:4,rejected:5};
    filtered.sort((a,b) => (so[a.status]||0) - (so[b.status]||0));
  }
  else filtered.sort((a,b) => (b.created_at||b.scraped_at||'').localeCompare(a.created_at||a.scraped_at||''));
  // Always pin insider/telegram jobs to top
  const pinSources = ['insider source','telegram','insider'];
  const pinned = filtered.filter(l => pinSources.includes((l.source||'').toLowerCase()));
  const rest = filtered.filter(l => !pinSources.includes((l.source||'').toLowerCase()));
  const final = [...pinned, ...rest];
  renderList(final);
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

// Spread out jobs so the same source doesn't cluster together
function diversifySources(list) {
  // Group by date bucket (same day = same group)
  const buckets = new Map();
  for (const item of list) {
    const d = (item.posted_at || item.created_at || '').slice(0, 10);
    if (!buckets.has(d)) buckets.set(d, []);
    buckets.get(d).push(item);
  }
  const result = [];
  for (const [, group] of buckets) {
    if (group.length <= 2) { result.push(...group); continue; }
    // Round-robin by source within each date group
    const bySrc = new Map();
    for (const item of group) {
      const src = extractSource(item) || item.company || '';
      if (!bySrc.has(src)) bySrc.set(src, []);
      bySrc.get(src).push(item);
    }
    const queues = [...bySrc.values()];
    // Sort queues by size descending so largest source gets spread most
    queues.sort((a, b) => b.length - a.length);
    while (queues.some(q => q.length > 0)) {
      for (const q of queues) {
        if (q.length > 0) result.push(q.shift());
      }
    }
  }
  return result;
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
    const FREE_PREVIEW = 3;
    const showAll = _verifySub() || list.length <= FREE_PREVIEW;
    const fullList = showAll ? list : list.slice(0, FREE_PREVIEW);
    const lockedCount = list.length - fullList.length;

    // Pagination for subscribers
    const totalPages = showAll ? Math.ceil(fullList.length / JOBS_PER_PAGE) : 1;
    if (currentJobPage > totalPages) currentJobPage = totalPages;
    if (currentJobPage < 1) currentJobPage = 1;
    const pageStart = (currentJobPage - 1) * JOBS_PER_PAGE;
    const displayList = showAll ? fullList.slice(pageStart, pageStart + JOBS_PER_PAGE) : fullList;

    // Mask details for free users — show enough to create FOMO, not enough to google
    const REGION_MAP = {
      'Saudi Arabia':'Middle East','KSA':'Middle East','UAE':'Middle East','Qatar':'Middle East','Bahrain':'Middle East','Kuwait':'Middle East','Oman':'Middle East','Iraq':'Middle East','Jordan':'Middle East','Lebanon':'Middle East','Israel':'Middle East',
      'UK':'Europe','Germany':'Europe','France':'Europe','Italy':'Europe','Spain':'Europe','Netherlands':'Europe','Switzerland':'Europe','Norway':'Europe','Sweden':'Europe','Denmark':'Europe','Poland':'Europe','Belgium':'Europe','Austria':'Europe','Greece':'Europe','Portugal':'Europe','Ireland':'Europe','Czech Republic':'Europe','Romania':'Europe','Finland':'Europe',
      'USA':'Americas','Canada':'Americas','Mexico':'Americas','Brazil':'Americas','Colombia':'Americas','Argentina':'Americas','Chile':'Americas','Peru':'Americas',
      'Nigeria':'Africa','Kenya':'Africa','South Africa':'Africa','Mozambique':'Africa','Ghana':'Africa','Ethiopia':'Africa','Tanzania':'Africa','Uganda':'Africa','DRC':'Africa','Somalia':'Africa','Libya':'Africa','Egypt':'Africa','Morocco':'Africa','Angola':'Africa','Mali':'Africa','Niger':'Africa','Cameroon':'Africa','Sudan':'Africa',
      'Australia':'Asia-Pacific','Japan':'Asia-Pacific','Singapore':'Asia-Pacific','Philippines':'Asia-Pacific','Indonesia':'Asia-Pacific','Thailand':'Asia-Pacific','Malaysia':'Asia-Pacific','India':'Asia-Pacific','China':'Asia-Pacific','South Korea':'Asia-Pacific','New Zealand':'Asia-Pacific','Papua New Guinea':'Asia-Pacific'
    };
    function maskRegion(loc, country) {
      if (!loc && !country) return 'Undisclosed';
      const c = country || '';
      if (REGION_MAP[c]) return REGION_MAP[c];
      const locLower = (loc||'').toLowerCase();
      if (/gulf|aden|indian ocean|horn of africa|strait|maritime|sea|ocean/.test(locLower)) return 'Maritime';
      if (/middle east|riyadh|dubai|doha|baghdad|jeddah|muscat|abu dhabi|bahrain/i.test(locLower)) return 'Middle East';
      if (/london|paris|berlin|rome|madrid|zurich|oslo|stockholm|munich/i.test(locLower)) return 'Europe';
      if (/new york|washington|houston|los angeles|miami|toronto|bogota/i.test(locLower)) return 'Americas';
      if (/lagos|nairobi|johannesburg|maputo|accra|cairo|casablanca/i.test(locLower)) return 'Africa';
      if (/sydney|tokyo|singapore|manila|bangkok|mumbai|jakarta/i.test(locLower)) return 'Asia-Pacific';
      return country || 'Undisclosed';
    }
    function maskCompany(name) {
      return '\u{1F512} Verified Employer';
    }

    for (const l of displayList) {
      const label = dateLabel(l.posted_at || l.created_at);
      if (label !== lastDateLabel) {
        const count = displayList.filter(j => dateLabel(j.posted_at || j.created_at) === label).length;
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
      const shortDesc = desc.length > 220 ? desc.substring(0,220)+'...' : desc;

      // Mask for free users
      const isFree = !showAll;
      const displayCompany = isFree ? maskCompany(companyName || cleanTitle) : (companyName || '');
      const displayLocation = isFree ? maskRegion(l.location, l.country) : (l.location ? `${flag} ${esc(l.location)}${l.country && l.country!=='UK' && l.country!=='USA' ? ' \u00b7 '+esc(l.country) : ''}` : '');
      const displayDesc = isFree ? '' : shortDesc;

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
              ${displayCompany ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px">${displayCompany}</div>` : ''}
              ${displayLocation ? `<div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-top:4px;display:flex;align-items:center;gap:4px">${isFree ? '\u{1F30D}' : ''} ${displayLocation}</div>` : ''}
            </div>
            ${salary ? `<div style="text-align:right;flex-shrink:0"><div style="font-size:15px;font-weight:800;color:#C9A84C;white-space:nowrap">${esc(salary)}</div><div style="font-size:9px;color:var(--text-muted);margin-top:1px">per annum</div></div>` : '<div style="font-size:11px;color:var(--text-muted);font-style:italic">Competitive</div>'}
          </div>
          ${displayDesc ? `<div style="font-size:12px;color:var(--text-secondary);line-height:1.5;margin-bottom:10px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical">${esc(displayDesc)}</div>` : ''}
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${showAll ? sourceIcon(source) : ''}
            <span style="margin-left:auto;display:flex;align-items:center;gap:6px">
              ${url ? `<a href="${url}" target="_blank" onclick="if(!gateApply(event,'${l.id}'))return" style="background:linear-gradient(135deg,#C9A84C,#8B7635);color:#06080d;padding:5px 14px;border-radius:5px;font-size:10px;font-weight:800;text-decoration:none;letter-spacing:0.5px">APPLY</a>` : ''}
              <select title="Track your application status for this job" onchange="event.stopPropagation();updateStatus('${l.id}',this.value)" style="background:${l.status&&l.status!=='ny'?'rgba(201,168,76,.15)':'rgba(255,255,255,.05)'};border:1px solid ${l.status&&l.status!=='ny'?'rgba(201,168,76,.3)':'rgba(255,255,255,.1)'};border-radius:5px;color:${l.status&&l.status!=='ny'?'#C9A84C':'#888'};padding:4px 8px;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;appearance:auto">
                <option value="ny" ${l.status==='ny'?'selected':''}>Track</option>
                <option value="applied" ${l.status==='applied'?'selected':''}>Applied</option>
                <option value="interview" ${l.status==='interview'?'selected':''}>Interview</option>
                <option value="offer" ${l.status==='offer'?'selected':''}>Offer</option>
                <option value="rejected" ${l.status==='rejected'?'selected':''}>Rejected</option>
              </select>
              <button onclick="event.stopPropagation();toggleSaved('${l.id}');applyFilters();updateSavedCount()" style="background:none;border:none;cursor:pointer;font-size:18px;opacity:${l.saved?'1':'.35'};transition:opacity .15s;padding:0" title="${l.saved?'Unsave':'Save'}">${l.saved?'\u2605':'\u2606'}</button>
            </span>
          </div>
        </div>
      </div>`;
    }
    // Pagination controls
    if (showAll && totalPages > 1) {
      // Build page number buttons
      let pageButtons = '';
      const maxVisible = 7;
      let startP = Math.max(1, currentJobPage - Math.floor(maxVisible / 2));
      let endP = Math.min(totalPages, startP + maxVisible - 1);
      if (endP - startP < maxVisible - 1) startP = Math.max(1, endP - maxVisible + 1);

      if (startP > 1) {
        pageButtons += `<button onclick="currentJobPage=1;applyFilters();document.getElementById('leads').scrollIntoView({behavior:'smooth'})" style="width:32px;height:32px;border-radius:6px;border:1px solid rgba(201,168,76,.3);background:rgba(201,168,76,.1);color:#C9A84C;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">1</button>`;
        if (startP > 2) pageButtons += `<span style="color:var(--text-muted);font-size:12px">...</span>`;
      }
      for (let p = startP; p <= endP; p++) {
        const isActive = p === currentJobPage;
        pageButtons += `<button onclick="currentJobPage=${p};applyFilters();document.getElementById('leads').scrollIntoView({behavior:'smooth'})" style="width:32px;height:32px;border-radius:6px;border:1px solid ${isActive?'#C9A84C':'rgba(201,168,76,.2)'};background:${isActive?'linear-gradient(135deg,#C9A84C,#8B7635)':'rgba(201,168,76,.05)'};color:${isActive?'#06080d':'#C9A84C'};font-size:12px;font-weight:${isActive?'800':'600'};cursor:pointer;font-family:inherit">${p}</button>`;
      }
      if (endP < totalPages) {
        if (endP < totalPages - 1) pageButtons += `<span style="color:var(--text-muted);font-size:12px">...</span>`;
        pageButtons += `<button onclick="currentJobPage=${totalPages};applyFilters();document.getElementById('leads').scrollIntoView({behavior:'smooth'})" style="width:32px;height:32px;border-radius:6px;border:1px solid rgba(201,168,76,.3);background:rgba(201,168,76,.1);color:#C9A84C;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">${totalPages}</button>`;
      }

      html += `<div style="display:flex;justify-content:center;align-items:center;gap:8px;padding:24px 0 16px;flex-wrap:wrap">
        <button onclick="currentJobPage--;applyFilters();document.getElementById('leads').scrollIntoView({behavior:'smooth'})" ${currentJobPage<=1?'disabled':''} style="padding:8px 14px;background:${currentJobPage<=1?'rgba(201,168,76,.05)':'rgba(201,168,76,.15)'};border:1px solid ${currentJobPage<=1?'rgba(201,168,76,.1)':'rgba(201,168,76,.3)'};border-radius:6px;color:${currentJobPage<=1?'rgba(201,168,76,.3)':'#C9A84C'};font-size:12px;font-weight:600;cursor:${currentJobPage<=1?'default':'pointer'};font-family:inherit">&larr;</button>
        ${pageButtons}
        <button onclick="currentJobPage++;applyFilters();document.getElementById('leads').scrollIntoView({behavior:'smooth'})" ${currentJobPage>=totalPages?'disabled':''} style="padding:8px 14px;background:${currentJobPage>=totalPages?'rgba(201,168,76,.05)':'rgba(201,168,76,.15)'};border:1px solid ${currentJobPage>=totalPages?'rgba(201,168,76,.1)':'rgba(201,168,76,.3)'};border-radius:6px;color:${currentJobPage>=totalPages?'rgba(201,168,76,.3)':'#C9A84C'};font-size:12px;font-weight:600;cursor:${currentJobPage>=totalPages?'default':'pointer'};font-family:inherit">&rarr;</button>
      </div>
      <div style="text-align:center;font-size:11px;color:var(--text-muted);padding-bottom:16px">Showing ${pageStart+1}–${Math.min(pageStart+JOBS_PER_PAGE, fullList.length)} of ${fullList.length} jobs</div>`;
    }

    // Soft paywall: show blurred teasers + unlock CTA
    if (!showAll && lockedCount > 0) {
      const teasers = list.slice(FREE_PREVIEW, FREE_PREVIEW + 3);
      html += `<div style="position:relative;margin-top:8px">
        <div style="filter:blur(7px);pointer-events:none;opacity:.35">`;
      for (const t of teasers) {
        const s = extractSalary(t.notes);
        const jt2 = jobType(t);
        html += `<div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:10px;padding:14px 14px 14px 16px;margin-bottom:8px;position:relative;overflow:hidden">
          <div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:${typeStripe[jt2]}"></div>
          <div style="font-size:14px;font-weight:700;color:var(--text-primary)">${esc(t.company)}</div>
          ${s?'<div style="font-size:15px;font-weight:800;color:#C9A84C;margin-top:4px">'+esc(s)+'</div>':''}
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${esc(t.location||'')} ${esc(t.country||'')}</div>
        </div>`;
      }
      html += `</div>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px">
          <svg viewBox="0 0 24 24" fill="none" stroke="#C9A84C" stroke-width="1.5" style="width:40px;height:40px;margin-bottom:12px;opacity:.7"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <div style="font-size:1.3rem;font-weight:800;color:var(--gold);margin-bottom:6px">+${lockedCount} more jobs</div>
          <div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:16px;line-height:1.5">Subscribe to unlock all opportunities, apply links & salary details</div>
          <button onclick="showPaywall()" style="padding:14px 36px;background:linear-gradient(135deg,#C9A84C,#8B7635);color:#06080d;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit;font-size:0.95rem;letter-spacing:0.5px;transition:all .2s" onmouseover="this.style.boxShadow='0 0 30px rgba(201,168,76,.3)'" onmouseout="this.style.boxShadow='none'">UNLOCK ALL JOBS</button>
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
  if (isJob(l) && !_verifySub()) { showPaywall(); return; }
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
  if (isJob(l) && !_verifySub()) { showPaywall(); return; }
  const salary = extractSalary(l.notes);
  const isInsider = l.source === 'INSIDER SOURCE';
  const panel = document.getElementById('detail');
  panel.innerHTML = `
    <div class="detail-header">
      <h2>${esc(l.company)}</h2>
      <button class="close-btn" onclick="closeDetail()">\u2715</button>
    </div>
    ${_isAdmin && isInsider ? `<div style="background:rgba(201,168,76,.1);border:1px solid rgba(201,168,76,.3);border-radius:8px;padding:12px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:#C9A84C;margin-bottom:8px">INSIDER JOB \u2014 REVIEW & EDIT</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <input id="review-title" value="${esc(l._dbTitle||'')}" placeholder="Job title" style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--text);font-size:13px">
        <input id="review-company" value="${esc(l._dbCompany||'')}" placeholder="Company" style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--text);font-size:13px">
        <div style="display:flex;gap:8px">
          <input id="review-location" value="${esc(l.location||'')}" placeholder="Location" style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--text);font-size:13px">
          <input id="review-country" value="${esc(l.country||'')}" placeholder="Country" style="width:120px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--text);font-size:13px">
        </div>
        <textarea id="review-notes" placeholder="Description / notes" rows="3" style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--text);font-size:13px;resize:vertical">${esc(l.notes||'')}</textarea>
        <button onclick="saveInsiderReview('${l.id}')" style="background:linear-gradient(135deg,#C9A84C,#8B7635);color:#06080d;border:none;border-radius:6px;padding:10px;font-weight:700;font-size:13px;cursor:pointer">Save to Database</button>
      </div>
    </div>` : ''}
    <div class="detail-section">
      ${isJob(l)?'<div class="detail-row"><span class="detail-label">Category</span><span class="detail-value"><span class="badge badge-job">JOB LISTING</span></span></div>':''}
      <div class="detail-row"><span class="detail-label">Type</span><span class="detail-value"><span class="badge ${typeBadge[l.type]}">${typeLabels[l.type]||l.type}</span></span></div>
      <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value"><span style="color:${statusColors[l.status]};font-weight:600">${statusLabels[l.status]||l.status||'New'}</span></span></div>
      <div class="detail-row"><span class="detail-label">Priority</span><span class="detail-value" style="font-weight:600;color:${l.priority==='hot'?'var(--red)':l.priority==='low'?'var(--muted)':'var(--amber)'}">${l.priority?l.priority.charAt(0).toUpperCase()+l.priority.slice(1):''}</span></div>
      ${salary?`<div class="detail-row"><span class="detail-label">Salary</span><span class="detail-value salary-tag" style="font-size:15px">${esc(salary)}</span></div>`:''}
      ${l.contact_person?`<div class="detail-row"><span class="detail-label">Contact</span><span class="detail-value">${esc(l.contact_person)}</span></div>`:''}
      ${l.email?`<div class="detail-row"><span class="detail-label">Email</span><span class="detail-value"><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></span></div>`:''}
      ${l.phone?`<div class="detail-row"><span class="detail-label">Phone</span><span class="detail-value"><a href="tel:${esc(l.phone)}">${esc(l.phone)}</a></span></div>`:''}
      ${l.website?`<div class="detail-row"><span class="detail-label">${isJob(l)?'Apply':'Website'}</span><span class="detail-value"><a href="${l.website.startsWith('http')?esc(l.website):'https://'+esc(l.website)}" target="_blank" ${isJob(l)?'onclick="if(!gateApply(event,\''+l.id+'\'))return"':''}>${isJob(l)?'Apply Now \u2192':esc(l.website)}</a></span></div>`:''}
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

async function saveInsiderReview(id) {
  const title = document.getElementById('review-title').value.trim();
  const company = document.getElementById('review-company').value.trim();
  const location = document.getElementById('review-location').value.trim();
  const country = document.getElementById('review-country').value.trim();
  const notes = document.getElementById('review-notes').value.trim();
  if (!title) { document.getElementById('review-title').style.borderColor='#e74c3c'; return; }

  const patch = {title, company: company||'Insider Source', location, country, notes};
  try {
    const {error} = await sb.from('job_listings').update(patch).eq('id', id);
    if (error) throw error;
    const l = leads.find(x=>x.id===id);
    if (l) {
      l.company = patch.company + ' \u2014 ' + patch.title;
      l._dbTitle = patch.title;
      l._dbCompany = patch.company;
      l.location = patch.location;
      l.country = patch.country;
      l.notes = patch.notes;
      l.source = 'INSIDER SOURCE';
      persist();
    }
    closeDetail();
    refresh();
    if (typeof showToast === 'function') showToast('Insider job updated');
  } catch(e) {
    console.error('Failed to save insider review:', e);
    alert('Save failed: ' + (e.message||e));
  }
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
// === APPLICATION TRACKER ===
const TRACKER_KEY = 'cp_app_tracker';

function loadTracker() { return JSON.parse(localStorage.getItem(TRACKER_KEY)||'[]'); }
function saveTracker(apps) { localStorage.setItem(TRACKER_KEY, JSON.stringify(apps)); }

function addApplication(e) {
  if(e) e.preventDefault();
  const get = id => { const el=document.getElementById(id); return el?el.value.trim():''; };
  const company = get('app-company');
  if(!company) return;
  const apps = loadTracker();
  apps.unshift({
    id: Date.now().toString(36),
    company,
    role: get('app-role'),
    location: get('app-location'),
    salary: get('app-salary'),
    contact: get('app-contact'),
    source: get('app-source'),
    status: 'applied',
    applied_at: new Date().toISOString().slice(0,10),
    followups: [],
    notes: ''
  });
  saveTracker(apps);
  renderStrategy();
}

function updateAppStatus(appId, status) {
  const apps = loadTracker();
  const app = apps.find(a=>a.id===appId);
  if(app) { app.status = status; saveTracker(apps); renderStrategy(); }
}

function addFollowup(appId) {
  const apps = loadTracker();
  const app = apps.find(a=>a.id===appId);
  if(!app) return;
  app.followups.push({date: new Date().toISOString().slice(0,10), note: 'Follow-up sent'});
  saveTracker(apps);
  renderStrategy();
}

function deleteApplication(appId) {
  if(!confirm('Remove this application?')) return;
  const apps = loadTracker().filter(a=>a.id!==appId);
  saveTracker(apps);
  renderStrategy();
}

function renderStrategy() {
  const apps = loadTracker();
  const stages = {applied:'Applied',contacted:'Contacted',interview:'Interview',offer:'Offer',rejected:'Rejected',ghosted:'Ghosted'};
  const stageColors = {applied:'#8e44ad',contacted:'#2980b9',interview:'#D4AF37',offer:'#27ae60',rejected:'#c0392b',ghosted:'#52504d'};
  const stageCounts = {};
  Object.keys(stages).forEach(s => stageCounts[s] = apps.filter(a=>a.status===s).length);
  const active = apps.filter(a=>!['rejected','ghosted'].includes(a.status));

  const el = document.getElementById('strategy-view');
  el.innerHTML = '<div style="max-width:900px">'
    +'<div style="margin-bottom:24px"><h1 style="font-size:26px;font-weight:800;margin:0 0 6px">Application Tracker</h1>'
    +'<p style="color:var(--muted);font-size:13px;margin:0">Track your applications, follow-ups & pipeline</p></div>'

    // Pipeline overview
    +'<div style="display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap">'
    +Object.entries(stages).map(function(e){var s=e[0],label=e[1]; return '<div style="flex:1;min-width:80px;text-align:center;padding:12px 8px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius)">'
      +'<div style="font-size:24px;font-weight:800;color:'+stageColors[s]+'">'+stageCounts[s]+'</div>'
      +'<div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">'+label+'</div></div>';}).join('')
    +'</div>'

    // Add new form
    +'<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:24px">'
    +'<h3 style="font-size:14px;font-weight:700;margin:0 0 12px">Log Application</h3>'
    +'<form onsubmit="addApplication(event)" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'
    +'<input id="app-company" placeholder="Company *" required style="padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--fg);font-size:12px;font-family:inherit">'
    +'<input id="app-role" placeholder="Role / Position" style="padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--fg);font-size:12px;font-family:inherit">'
    +'<input id="app-location" placeholder="Location" style="padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--fg);font-size:12px;font-family:inherit">'
    +'<input id="app-salary" placeholder="Salary / Day rate" style="padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--fg);font-size:12px;font-family:inherit">'
    +'<input id="app-contact" placeholder="Contact person" style="padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--fg);font-size:12px;font-family:inherit">'
    +'<input id="app-source" placeholder="Source (LinkedIn, referral...)" style="padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--fg);font-size:12px;font-family:inherit">'
    +'<button type="submit" style="grid-column:1/-1;padding:10px;background:var(--accent);color:#000;border:none;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">+ Add Application</button>'
    +'</form></div>'

    // Applications list
    +'<div style="display:flex;flex-direction:column;gap:10px">'
    +(apps.length === 0 ? '<div style="text-align:center;padding:40px;color:var(--muted)">No applications tracked yet. Log your first one above.</div>' :
      apps.map(function(a) {
        var sc = stageColors[a.status]||'#52504d';
        var daysSince = Math.floor((Date.now()-new Date(a.applied_at))/(1000*60*60*24));
        var needsFollowup = ['applied','contacted'].includes(a.status) && a.followups.length === 0 && daysSince >= 7;
        return '<div style="background:var(--surface);border:1px solid '+(needsFollowup?'#D4AF37':'var(--border)')+';border-radius:var(--radius);padding:16px">'
          +'<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px">'
          +'<div style="flex:1;min-width:0">'
          +'<div style="font-size:15px;font-weight:700;color:var(--fg)">'+esc(a.company)+'</div>'
          +(a.role?'<div style="font-size:12px;color:var(--muted);margin-top:2px">'+esc(a.role)+'</div>':'')
          +'</div>'
          +'<span style="font-size:10px;font-weight:700;color:'+sc+';text-transform:uppercase;letter-spacing:.5px;padding:3px 8px;border:1px solid '+sc+';border-radius:12px">'+esc(stages[a.status]||a.status)+'</span>'
          +'</div>'
          +'<div style="display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--muted);margin-bottom:10px">'
          +(a.location?'<span>'+esc(a.location)+'</span>':'')
          +(a.salary?'<span style="color:var(--accent);font-weight:600">'+esc(a.salary)+'</span>':'')
          +(a.contact?'<span>Contact: '+esc(a.contact)+'</span>':'')
          +(a.source?'<span>via '+esc(a.source)+'</span>':'')
          +'<span>Applied '+esc(a.applied_at)+'</span>'
          +(a.followups.length?'<span>'+a.followups.length+' follow-up'+(a.followups.length>1?'s':'')+'</span>':'')
          +(needsFollowup?'<span style="color:#D4AF37;font-weight:600">Needs follow-up</span>':'')
          +'</div>'
          +'<div style="display:flex;gap:6px;flex-wrap:wrap">'
          +'<select onchange="updateAppStatus(\''+a.id+'\',this.value)" style="padding:4px 8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--fg);font-size:11px;font-family:inherit">'
          +Object.entries(stages).map(function(e){return '<option value="'+e[0]+'"'+(a.status===e[0]?' selected':'')+'>'+e[1]+'</option>';}).join('')
          +'</select>'
          +'<button onclick="addFollowup(\''+a.id+'\')" style="padding:4px 10px;background:none;border:1px solid var(--border);border-radius:4px;color:var(--muted);font-size:11px;cursor:pointer;font-family:inherit">+ Follow-up</button>'
          +'<button onclick="deleteApplication(\''+a.id+'\')" style="padding:4px 8px;background:none;border:1px solid rgba(231,76,60,.2);border-radius:4px;color:#e74c3c;font-size:11px;cursor:pointer;font-family:inherit">Remove</button>'
          +'</div></div>';
      }).join(''))
    +'</div>'

    // Summary
    +(active.length > 0 ? '<div style="margin-top:20px;padding:14px;background:var(--surface);border:1px solid var(--accent);border-radius:var(--radius);font-size:12px;color:var(--muted)">'
      +'<strong style="color:var(--accent)">Active pipeline:</strong> '+active.length+' application'+(active.length>1?'s':'')+' in progress'
      +(apps.filter(function(a){var d=Math.floor((Date.now()-new Date(a.applied_at))/(1000*60*60*24));return ['applied','contacted'].includes(a.status)&&a.followups.length===0&&d>=7;}).length > 0
        ? ' &middot; <span style="color:#D4AF37">'+apps.filter(function(a){var d=Math.floor((Date.now()-new Date(a.applied_at))/(1000*60*60*24));return ['applied','contacted'].includes(a.status)&&a.followups.length===0&&d>=7;}).length+' need follow-up</span>' : '')
      +'</div>' : '')
    +'</div>';
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
  if (e.key === '?') alert('Keyboard shortcuts:\n\nN = New lead\n/ = Global search\nC = Companies\nJ = Jobs\nD = Dashboard\nS = Tracker\nEsc = Close panel');
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

// Initial refresh handled by onAuthSuccess → loadScrapedJobs → refresh()
// Do NOT call refresh() here — subscription state isn't ready yet
