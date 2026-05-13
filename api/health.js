import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Auth: enkel secret for å beskytte endpointet
const HEALTH_SECRET = process.env.HEALTH_SECRET || 'cpo-guardian-2026';

// Kjente problemer i jobbtitler/beskrivelser
const BAD_TITLE_PATTERNS = [
  /^https?:\/\//i,                    // URL som tittel
  /^\s*$/,                            // Tom tittel
  /^null$/i,                          // Literal "null"
  /^undefined$/i,                     // Literal "undefined"
  /^[\W\d]+$/,                        // Bare tegn/tall
  /^.{0,3}$/,                         // For kort (<4 chars)
  /^.{300,}$/,                        // For lang (>300 chars)
  /test|lorem|asdf|xxx/i,             // Testdata
  /\[object Object\]/i,               // Serialiseringsfeil
  /\\u[\da-f]{4}/i,                   // Unicode escape i tittel
  /^#\d+$/,                           // Bare ID-nummer
  /^follow us/i,                       // Scraper-søppel
  /^sign up to/i,                      // Scraper-søppel
  /^need to advertise/i,               // Scraper-søppel
  /^WARNING/i,                         // Ikke en jobb
  /^subscribe/i,                       // Scraper-søppel
  /^click here/i,                      // Scraper-søppel
  /^share this/i,                      // Scraper-søppel
];

const BAD_NOTES_PATTERNS = [
  /\[object Object\]/i,
  /^null$/i,
  /^undefined$/i,
  /\\u[\da-f]{4}/i,
  /^(.)\1{20,}$/,                     // Gjentatt tegn (aaaaaa...)
  /<script/i,                         // XSS
  /<iframe/i,                         // XSS
];

function checkJobQuality(job) {
  const issues = [];

  // Tittelsjekk
  if (!job.title) {
    issues.push({ field: 'title', issue: 'missing', severity: 'critical' });
  } else {
    for (const pat of BAD_TITLE_PATTERNS) {
      if (pat.test(job.title)) {
        issues.push({ field: 'title', issue: `bad_pattern: ${pat.source}`, value: job.title.substring(0, 80), severity: 'high' });
        break;
      }
    }
  }

  // Duplikat-tittel (sjekkes separat i batch)

  // Notes/beskrivelse-sjekk
  if (job.notes) {
    for (const pat of BAD_NOTES_PATTERNS) {
      if (pat.test(job.notes)) {
        issues.push({ field: 'notes', issue: `bad_pattern: ${pat.source}`, value: job.notes.substring(0, 80), severity: 'medium' });
        break;
      }
    }
  }

  // Source URL sjekk
  if (job.source_url && !/^https?:\/\/.+/.test(job.source_url)) {
    issues.push({ field: 'source_url', issue: 'invalid_url', value: job.source_url.substring(0, 80), severity: 'low' });
  }

  // Land/lokasjon
  if (!job.country && !job.location) {
    issues.push({ field: 'location', issue: 'no_location_or_country', severity: 'low' });
  }

  return issues;
}

function findDuplicates(jobs) {
  const seen = {};
  const dupes = [];
  for (const j of jobs) {
    const key = `${(j.title || '').toLowerCase().trim()}|${(j.company || '').toLowerCase().trim()}`;
    if (seen[key]) {
      dupes.push({ id: j.id, title: j.title, company: j.company, duplicate_of: seen[key] });
    } else {
      seen[key] = j.id;
    }
  }
  return dupes;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth
  const secret = req.query.secret || req.headers['x-health-secret'];
  if (secret !== HEALTH_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const autofix = req.query.autofix === 'true';
  const report = {
    timestamp: new Date().toISOString(),
    status: 'healthy',
    checks: {},
    fixes_applied: [],
    alerts: [],
  };

  // 1. SUPABASE CONNECTION
  try {
    const { count, error } = await supabase
      .from('job_listings')
      .select('*', { count: 'exact', head: true });
    report.checks.supabase = { ok: !error, job_count: count };
    if (error) {
      report.status = 'critical';
      report.alerts.push('Supabase connection failed: ' + error.message);
    } else if (count === 0) {
      report.status = 'warning';
      report.alerts.push('Job listings table is empty!');
    }
  } catch (e) {
    report.checks.supabase = { ok: false, error: e.message };
    report.status = 'critical';
    report.alerts.push('Supabase unreachable: ' + e.message);
  }

  // 2. JOB DATA QUALITY
  try {
    const { data: jobs, error } = await supabase
      .from('job_listings')
      .select('id, title, company, location, country, salary, source, source_url, notes, scraped_at')
      .order('scraped_at', { ascending: false })
      .limit(500);

    if (!error && jobs) {
      const allIssues = [];
      const fixableJobs = [];
      const junkIds = [];

      for (const job of jobs) {
        const issues = checkJobQuality(job);
        if (issues.length > 0) {
          allIssues.push({ job_id: job.id, title: (job.title || '').substring(0, 60), issues });

          // Samle fikserbare problemer
          if (autofix) {
            // Sjekk om tittelen er søppel som bør slettes helt
            const JUNK_PATTERNS = [/^follow us/i, /^sign up to/i, /^need to advertise/i, /^WARNING/i, /^subscribe/i, /^click here/i, /^share this/i];
            const isJunk = job.title && JUNK_PATTERNS.some(p => p.test(job.title));
            if (isJunk) {
              junkIds.push(job.id);
              continue;
            }

            const fixes = {};
            for (const issue of issues) {
              if (issue.field === 'title' && issue.issue === 'missing') {
                if (job.notes && job.notes.length > 10) {
                  fixes.title = job.notes.substring(0, 100).split(/[.\n]/)[0].trim() || 'Close Protection Operator';
                } else {
                  fixes.title = 'Close Protection Operator';
                }
              }
              if (issue.field === 'title' && issue.issue.includes('bad_pattern')) {
                if (/^https?:\/\//i.test(job.title)) {
                  fixes.title = job.notes
                    ? job.notes.substring(0, 100).split(/[.\n]/)[0].trim() || 'Security Professional'
                    : 'Security Professional';
                }
              }
              if (issue.field === 'notes' && issue.issue.includes('bad_pattern')) {
                fixes.notes = job.notes
                  .replace(/<script[^>]*>.*?<\/script>/gi, '')
                  .replace(/<iframe[^>]*>.*?<\/iframe>/gi, '')
                  .replace(/\[object Object\]/gi, '')
                  .trim() || null;
              }
            }
            if (Object.keys(fixes).length > 0) {
              fixableJobs.push({ id: job.id, fixes });
            }
          }
        }
      }

      // Autofix: slett søppel-jobber (ikke ekte stillinger)
      if (autofix && junkIds.length > 0) {
        const { error: junkErr } = await supabase
          .from('job_listings')
          .delete()
          .in('id', junkIds);
        if (!junkErr) {
          report.fixes_applied.push(`Deleted ${junkIds.length} junk/non-job listings`);
        }
      }

      // Duplikat-sjekk
      const dupes = findDuplicates(jobs);

      // Autofix: slett duplikater (behold den med nyeste scraped_at)
      if (autofix && dupes.length > 0) {
        const dupeIds = dupes.map(d => d.id);
        const { error: delErr } = await supabase
          .from('job_listings')
          .delete()
          .in('id', dupeIds);
        if (!delErr) {
          report.fixes_applied.push(`Deleted ${dupeIds.length} duplicate jobs`);
        }
      }

      // Autofix: fiks dårlige titler/notes
      if (autofix && fixableJobs.length > 0) {
        let fixed = 0;
        for (const { id, fixes } of fixableJobs) {
          const { error: upErr } = await supabase
            .from('job_listings')
            .update(fixes)
            .eq('id', id);
          if (!upErr) fixed++;
        }
        if (fixed > 0) {
          report.fixes_applied.push(`Fixed ${fixed} jobs (bad titles/notes)`);
        }
      }

      report.checks.job_quality = {
        total_checked: jobs.length,
        issues_found: allIssues.length,
        duplicates_found: dupes.length,
        issues: allIssues.slice(0, 20), // Max 20 i rapporten
        duplicates: dupes.slice(0, 10),
      };

      if (allIssues.length > 10) {
        report.status = report.status === 'critical' ? 'critical' : 'warning';
        report.alerts.push(`${allIssues.length} jobs with data quality issues`);
      }
      if (dupes.length > 5) {
        report.alerts.push(`${dupes.length} duplicate jobs found`);
      }

      // 3. FRESHNESS — siste jobb bør være < 48 timer gammel
      if (jobs.length > 0) {
        const latest = new Date(jobs[0].scraped_at);
        const hoursAgo = (Date.now() - latest.getTime()) / (1000 * 60 * 60);
        report.checks.freshness = {
          latest_job_age_hours: Math.round(hoursAgo),
          latest_scraped_at: jobs[0].scraped_at,
        };
        if (hoursAgo > 48) {
          report.status = report.status === 'critical' ? 'critical' : 'warning';
          report.alerts.push(`No new jobs in ${Math.round(hoursAgo)} hours — scrapers may be down`);
        }
      }
    }
  } catch (e) {
    report.checks.job_quality = { ok: false, error: e.message };
  }

  // 4. SUBSCRIBER HEALTH
  try {
    const { data: subs, error } = await supabase
      .from('subscribers')
      .select('id, email, status, stripe_customer_id, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (!error && subs) {
      const active = subs.filter(s => s.status === 'active');
      const trialing = subs.filter(s => s.status === 'trialing');
      const canceled = subs.filter(s => s.status === 'canceled');
      const pastDue = subs.filter(s => s.status === 'past_due');
      const noStripe = subs.filter(s => !s.stripe_customer_id && s.status === 'active');

      report.checks.subscribers = {
        total: subs.length,
        active: active.length,
        trialing: trialing.length,
        canceled: canceled.length,
        past_due: pastDue.length,
        missing_stripe_id: noStripe.length,
      };

      if (pastDue.length > 0) {
        report.alerts.push(`${pastDue.length} subscribers with past_due payment`);
      }
      if (noStripe.length > 0) {
        report.alerts.push(`${noStripe.length} active subscribers missing Stripe ID`);
      }
    }
  } catch (e) {
    report.checks.subscribers = { ok: false, error: e.message };
  }

  // 5. STRIPE SYNC CHECK
  try {
    const subscriptions = await stripe.subscriptions.list({ limit: 20, status: 'all' });
    const stripeActive = subscriptions.data.filter(s => ['active', 'trialing'].includes(s.status));

    // Sjekk om Supabase matcher Stripe
    const { data: dbSubs } = await supabase
      .from('subscribers')
      .select('stripe_subscription_id, status')
      .in('status', ['active', 'trialing']);

    const dbSubIds = new Set((dbSubs || []).map(s => s.stripe_subscription_id).filter(Boolean));
    const stripeSubIds = new Set(stripeActive.map(s => s.id));

    const inStripeNotDb = stripeActive.filter(s => !dbSubIds.has(s.id));
    const inDbNotStripe = (dbSubs || []).filter(s => s.stripe_subscription_id && !stripeSubIds.has(s.stripe_subscription_id));

    report.checks.stripe_sync = {
      stripe_active: stripeActive.length,
      db_active: (dbSubs || []).length,
      in_stripe_not_db: inStripeNotDb.length,
      in_db_not_stripe: inDbNotStripe.length,
    };

    // Autofix: synk Stripe → Supabase for manglende
    if (autofix && inStripeNotDb.length > 0) {
      let synced = 0;
      for (const sub of inStripeNotDb) {
        const customer = await stripe.customers.retrieve(sub.customer);
        if (customer.email) {
          const { error: upsertErr } = await supabase.from('subscribers').upsert({
            email: customer.email,
            stripe_customer_id: sub.customer,
            stripe_subscription_id: sub.id,
            status: sub.status,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'email' });
          if (!upsertErr) synced++;
        }
      }
      if (synced > 0) {
        report.fixes_applied.push(`Synced ${synced} missing subscribers from Stripe`);
      }
    }

    if (inStripeNotDb.length > 0) {
      report.status = report.status === 'critical' ? 'critical' : 'warning';
      report.alerts.push(`${inStripeNotDb.length} paying subscribers in Stripe but NOT in database!`);
    }
  } catch (e) {
    report.checks.stripe_sync = { ok: false, error: e.message };
  }

  // 6. API ENDPOINTS CHECK
  const baseUrl = `https://${req.headers.host || 'cpoleads.com'}`;
  const endpoints = [
    { name: 'jobs', url: `${baseUrl}/api/jobs?email=test@test.com` },
    { name: 'check-subscription', url: `${baseUrl}/api/check-subscription?email=test@test.com` },
  ];
  report.checks.endpoints = {};

  for (const ep of endpoints) {
    try {
      const start = Date.now();
      const resp = await fetch(ep.url);
      const ms = Date.now() - start;
      const body = await resp.json();
      report.checks.endpoints[ep.name] = {
        status: resp.status,
        ok: resp.status === 200,
        response_ms: ms,
      };
      if (resp.status !== 200) {
        report.alerts.push(`API ${ep.name} returned ${resp.status}`);
      }
      if (ms > 5000) {
        report.alerts.push(`API ${ep.name} is slow: ${ms}ms`);
      }
    } catch (e) {
      report.checks.endpoints[ep.name] = { ok: false, error: e.message };
      report.status = 'critical';
      report.alerts.push(`API ${ep.name} unreachable: ${e.message}`);
    }
  }

  // 7. STALE JOBS CLEANUP (autofix only)
  if (autofix) {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: staleJobs, error: staleErr } = await supabase
        .from('job_listings')
        .select('id')
        .lt('scraped_at', thirtyDaysAgo);

      if (!staleErr && staleJobs && staleJobs.length > 0) {
        // Ikke slett, bare rapporter — Remy bestemmer
        report.checks.stale_jobs = {
          older_than_30_days: staleJobs.length,
          action: 'reported_only',
        };
        if (staleJobs.length > 50) {
          report.alerts.push(`${staleJobs.length} jobs older than 30 days — consider cleanup`);
        }
      }
    } catch (e) {
      // Ikke kritisk
    }
  }

  // Sett endelig status
  if (report.alerts.length === 0) {
    report.status = 'healthy';
  }

  return res.status(200).json(report);
}
