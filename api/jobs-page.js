import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escJson(s) {
  return (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');

  const { data: jobs } = await supabase
    .from('job_listings')
    .select('id, title, company, location, country, salary, notes, source_url, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  const jobList = jobs || [];
  const count = jobList.length;

  // Build JobPosting JSON-LD for each job
  const jsonLdItems = jobList.map(j => {
    const posted = j.created_at ? j.created_at.split('T')[0] : '2026-05-14';
    const desc = (j.notes || j.title || '').slice(0, 500);
    const loc = j.location || j.country || 'Worldwide';
    const countryCode = { 'UK': 'GB', 'US': 'US', 'UAE': 'AE', 'Iraq': 'IQ', 'France': 'FR', 'Germany': 'DE', 'Norway': 'NO', 'Nigeria': 'NG', 'Kenya': 'KE', 'Somalia': 'SO', 'Australia': 'AU', 'Singapore': 'SG', 'Canada': 'CA' }[j.country] || '';

    let salary = '';
    if (j.salary) {
      const m = j.salary.match(/\$?([\d,.]+)/);
      if (m) {
        salary = `,"baseSalary":{"@type":"MonetaryAmount","currency":"USD","value":{"@type":"QuantitativeValue","value":${parseFloat(m[1].replace(/,/g,''))},"unitText":"DAY"}}`;
      }
    }

    return `{
  "@context":"https://schema.org",
  "@type":"JobPosting",
  "title":"${escJson(j.title)}",
  "description":"${escJson(desc)}",
  "datePosted":"${posted}",
  "validThrough":"${new Date(Date.now() + 60*86400000).toISOString().split('T')[0]}",
  "employmentType":"CONTRACTOR",
  "hiringOrganization":{"@type":"Organization","name":"${escJson(j.company || 'Confidential')}"},
  "jobLocation":{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"${escJson(loc)}"${countryCode ? ',"addressCountry":"' + countryCode + '"' : ''}}}${salary},
  "directApply":false,
  "url":"https://cpoleads.com/jobs#${j.id}"
}`;
  });

  // Build job list HTML (basic info only — no contact details, no full notes)
  const jobCards = jobList.map(j => {
    const posted = j.created_at ? new Date(j.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const loc = j.location || j.country || '';
    return `<article class="job" id="${esc(j.id)}">
  <h3>${esc(j.title)}</h3>
  <p class="meta">${esc(j.company || 'Confidential')}${loc ? ' &middot; ' + esc(loc) : ''}${j.salary ? ' &middot; ' + esc(j.salary) : ''}</p>
  <p class="date">Posted ${posted}</p>
  <a href="/app.html" class="apply">View Details & Apply</a>
</article>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Latest Bodyguard & Close Protection Jobs (${count}+ Listings) | CPO Leads</title>
<meta name="description" content="${count}+ bodyguard and close protection jobs updated daily. Executive protection, maritime security, hostile environment contracts from verified employers worldwide.">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://cpoleads.com/jobs">
<meta property="og:type" content="website">
<meta property="og:url" content="https://cpoleads.com/jobs">
<meta property="og:title" content="Latest Bodyguard & Close Protection Jobs | CPO Leads">
<meta property="og:description" content="${count}+ active CP/EP jobs from 30+ sources. Updated daily.">
<meta property="og:image" content="https://cpoleads.com/cpo_leads_logo.png">
<meta name="google-site-verification" content="9XtZ524ao1to2uGMgwbUN8lpPA_s_rqpnjIl-xBIen4" />
${jsonLdItems.map(j => '<script type="application/ld+json">' + j + '</script>').join('\n')}
<link rel="icon" type="image/png" href="/cpo_leads_logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#06080d;--surface:#0a0e1a;--card:rgba(15,20,30,.8);--gold:#C9A84C;--gold-dim:rgba(201,168,76,.15);--gold-border:rgba(201,168,76,.12);--text:#e8e6e3;--muted:#7a7770;--radius:12px}
body{font-family:'Inter',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.7;-webkit-font-smoothing:antialiased}
a{color:var(--gold);text-decoration:none}a:hover{color:#D4AF37}
.container{max-width:900px;margin:0 auto;padding:0 24px}
nav{padding:20px 0;border-bottom:1px solid var(--gold-border)}
nav .container{display:flex;justify-content:space-between;align-items:center}
nav a.logo{font-size:18px;font-weight:800;letter-spacing:1px}
nav a.cta{padding:10px 24px;background:linear-gradient(135deg,var(--gold),#8B7635);color:#06080d;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;border-radius:8px}
.hero{padding:60px 0 40px;text-align:center;border-bottom:1px solid var(--gold-border)}
.hero h1{font-size:clamp(28px,4vw,42px);font-weight:900;line-height:1.15;margin-bottom:12px}
.hero .gold{color:var(--gold)}
.hero p{font-size:17px;color:var(--muted);max-width:680px;margin:0 auto 24px}
.btn{display:inline-block;padding:14px 36px;background:linear-gradient(135deg,var(--gold),#8B7635);color:#06080d;font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;border-radius:8px}
.btn:hover{box-shadow:0 0 30px rgba(201,168,76,.3);color:#06080d}
.breadcrumb{font-size:13px;color:var(--muted);padding:16px 0}
.breadcrumb a{color:var(--muted)}
.breadcrumb span{margin:0 6px}
.jobs-list{padding:40px 0}
.job{background:var(--card);border:1px solid var(--gold-border);border-radius:var(--radius);padding:24px;margin-bottom:16px;transition:all .3s}
.job:hover{border-color:rgba(201,168,76,.3)}
.job h3{font-size:17px;font-weight:700;margin-bottom:6px}
.job .meta{font-size:14px;color:var(--gold);font-weight:600;margin-bottom:4px}
.job .date{font-size:12px;color:var(--muted);margin-bottom:12px}
.job .apply{display:inline-block;padding:8px 20px;background:var(--gold-dim);border:1px solid var(--gold-border);border-radius:8px;font-size:12px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase}
.job .apply:hover{background:rgba(201,168,76,.25)}
.cta-box{text-align:center;padding:48px 24px;background:var(--surface);border:1px solid var(--gold-border);border-radius:var(--radius);margin:20px 0 40px}
.cta-box h2{font-size:24px;font-weight:800;margin-bottom:12px}
.cta-box p{color:var(--muted);margin-bottom:20px}
footer{padding:40px 0;border-top:1px solid var(--gold-border);text-align:center;font-size:13px;color:var(--muted)}
.internal-links{display:flex;flex-wrap:wrap;gap:12px;margin:24px 0;justify-content:center}
.internal-links a{padding:8px 16px;background:var(--gold-dim);border:1px solid var(--gold-border);border-radius:100px;font-size:13px;font-weight:600}
</style>
</head>
<body>
<nav><div class="container"><a href="/" class="logo">CPO LEADS</a><a href="/app.html" class="cta">Full Access</a></div></nav>

<div class="container"><div class="breadcrumb"><a href="/">Home</a><span>/</span>Jobs</div></div>

<section class="hero">
<div class="container">
  <h1>Latest Bodyguard & Close Protection <span class="gold">Jobs</span></h1>
  <p>${count}+ active positions from verified employers worldwide. Updated daily from 30+ sources.</p>
  <a href="/app.html" class="btn">Get Full Access</a>
</div>
</section>

<div class="container">
  <div class="internal-links">
    <a href="/bodyguard-jobs">Bodyguard Jobs</a>
    <a href="/close-protection-jobs">Close Protection Jobs</a>
    <a href="/executive-protection-jobs">Executive Protection Jobs</a>
    <a href="/maritime-security-jobs">Maritime Security Jobs</a>
    <a href="/security-jobs-london">London</a>
    <a href="/security-jobs-dubai">Dubai</a>
  </div>

  <section class="jobs-list">
    ${jobCards}
  </section>

  <div class="cta-box">
    <h2>Want Full Job Details & Direct Contacts?</h2>
    <p>Subscribe to CPO Leads for complete job descriptions, employer contacts, salary details, and application links. 3 days free.</p>
    <a href="/app.html" class="btn">Start Free Trial — $19.90/mo</a>
  </div>
</div>

<footer><div class="container">CPO Leads by StrategioAI &middot; <a href="/">Home</a> &middot; <a href="/bodyguard-jobs">Bodyguard Jobs</a> &middot; <a href="/close-protection-jobs">CP Jobs</a> &middot; <a href="/privacy.html">Privacy</a> &middot; <a href="/terms.html">Terms</a></div></footer>
</body>
</html>`;

  res.status(200).send(html);
}
