import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

const SCOUT_SECRET = process.env.SCOUT_SECRET || 'cpo-scout-2026';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const REPORT_EMAIL = 'strategioai@strategioai.com';
const BATCH_SIZE = 10; // Jobs per run (avoid timeout)

// Find jobs that need enrichment
async function getJobsToEnrich(limit) {
  // Priority: jobs with short/missing notes, no salary, no location, or generic titles
  const { data, error } = await supabase
    .from('job_listings')
    .select('id, title, company, location, country, salary, source, source_url, notes, scraped_at')
    .or('notes.is.null,notes.eq.,salary.is.null,salary.eq.,location.is.null,location.eq.')
    .not('source_url', 'is', null)
    .not('source_url', 'eq', '')
    .order('scraped_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  // Also grab jobs with very short notes (< 50 chars = probably not enriched)
  const { data: shortNotes } = await supabase
    .from('job_listings')
    .select('id, title, company, location, country, salary, source, source_url, notes, scraped_at')
    .not('source_url', 'is', null)
    .not('source_url', 'eq', '')
    .not('notes', 'is', null)
    .order('scraped_at', { ascending: false })
    .limit(100);

  const shortOnes = (shortNotes || []).filter(j =>
    j.notes && j.notes.replace(/Enriched by Scout[^\n]*/g, '').trim().length < 50
  ).slice(0, limit);

  // Merge and dedupe
  const ids = new Set(data.map(j => j.id));
  const merged = [...data];
  for (const j of shortOnes) {
    if (!ids.has(j.id)) { merged.push(j); ids.add(j.id); }
  }

  // Filter out already enriched (but re-enrich if notes is ONLY the tag with no real content)
  return merged.filter(j => {
    const notes = (j.notes || '').replace(/Enriched by Scout[^\n]*/g, '').trim();
    return notes.length < 50;
  }).slice(0, limit);
}

// Fetch page content from a URL
async function fetchPageContent(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const html = await resp.text();
    // Strip HTML tags, keep text
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, 4000); // Keep it under Claude's sweet spot
  } catch (e) {
    return null;
  }
}

// Use Claude to extract structured job info
async function aiEnrichJob(job, pageContent) {
  if (!ANTHROPIC_API_KEY) return null;

  const prompt = `You are a job data enrichment specialist for close protection / executive protection / security jobs.

Given this existing job data and the scraped page content, extract ALL missing information.

EXISTING JOB:
- Title: ${job.title || 'unknown'}
- Company: ${job.company || 'unknown'}
- Location: ${job.location || 'unknown'}
- Country: ${job.country || 'unknown'}
- Salary: ${job.salary || 'unknown'}
- Current notes: ${(job.notes || '').slice(0, 200)}

PAGE CONTENT:
${pageContent || 'No page content available'}

Return ONLY valid JSON (no markdown), with these fields. Use empty string "" if not found:
{
  "title": "clean professional job title",
  "company": "employer/company name",
  "location": "city, region or area",
  "country": "country name",
  "salary": "salary/rate info",
  "description": "2-4 sentence job description covering role, responsibilities, and what they're looking for",
  "requirements": "key requirements (experience, qualifications, certifications)",
  "contact_email": "application email if found",
  "contact_phone": "phone number if found",
  "contact_url": "direct application URL if different from source",
  "employment_type": "full-time/part-time/contract/freelance"
}`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await resp.json();
    const text = data.content?.[0]?.text?.trim();
    if (!text) return null;
    return JSON.parse(text.replace(/^```json?\n?|```$/g, ''));
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = req.query.secret || req.headers['x-scout-secret'];
  if (secret !== SCOUT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const limit = Math.min(parseInt(req.query.limit) || BATCH_SIZE, 20);
  const report = {
    timestamp: new Date().toISOString(),
    jobs_checked: 0,
    jobs_enriched: 0,
    jobs_failed: 0,
    details: [],
  };

  const jobs = await getJobsToEnrich(limit);
  report.jobs_checked = jobs.length;

  if (jobs.length === 0) {
    report.message = 'No jobs need enrichment';
    return res.status(200).json(report);
  }

  for (const job of jobs) {
    try {
      // Fetch page content from source URL
      const pageContent = job.source_url ? await fetchPageContent(job.source_url) : null;

      // AI enrichment
      const enriched = await aiEnrichJob(job, pageContent);
      if (!enriched) {
        report.jobs_failed++;
        report.details.push({ id: job.id, title: job.title, status: 'ai_failed' });
        continue;
      }

      // Build update object — only update fields that are missing/improved
      const update = {};

      if (enriched.title && enriched.title.length > 5 && (!job.title || job.title === 'Insider Job Post' || job.title === 'Security Professional' || job.title === 'Close Protection Operator')) {
        update.title = enriched.title.slice(0, 120);
      }
      if (enriched.company && enriched.company.length > 2 && (!job.company || job.company === 'Insider Source')) {
        update.company = enriched.company.slice(0, 80);
      }
      if (enriched.location && !job.location) {
        update.location = enriched.location.slice(0, 60);
      }
      if (enriched.country && !job.country) {
        update.country = enriched.country.slice(0, 40);
      }
      if (enriched.salary && !job.salary) {
        update.salary = enriched.salary.slice(0, 60);
      }

      // Build rich notes from description + requirements + contact
      const parts = [];
      if (enriched.description) parts.push(enriched.description);
      if (enriched.requirements) parts.push('Requirements: ' + enriched.requirements);
      if (enriched.contact_email) parts.push('Apply: ' + enriched.contact_email);
      if (enriched.contact_phone) parts.push('Phone: ' + enriched.contact_phone);
      if (enriched.contact_url && enriched.contact_url !== job.source_url) parts.push('Apply URL: ' + enriched.contact_url);
      if (enriched.employment_type) parts.push('Type: ' + enriched.employment_type);

      if (parts.length > 0) {
        const existingNotes = (job.notes || '').replace(/Enriched by Scout.*$/, '').trim();
        const newNotes = parts.join('. ');
        // Only update if we have significantly more info
        if (newNotes.length > (existingNotes.length + 20)) {
          update.notes = (newNotes + '. Enriched by Scout ' + new Date().toISOString().slice(0, 10)).slice(0, 500);
        }
      }

      if (Object.keys(update).length > 0) {
        const { error } = await supabase
          .from('job_listings')
          .update(update)
          .eq('id', job.id);

        if (!error) {
          report.jobs_enriched++;
          report.details.push({
            id: job.id,
            title: update.title || job.title,
            status: 'enriched',
            fields_updated: Object.keys(update),
          });
        } else {
          report.jobs_failed++;
          report.details.push({ id: job.id, title: job.title, status: 'db_error', error: error.message });
        }
      } else {
        // Mark as checked so we don't re-process
        await supabase.from('job_listings').update({
          notes: ((job.notes || '') + ' Enriched by Scout ' + new Date().toISOString().slice(0, 10)).slice(0, 500),
        }).eq('id', job.id);
        report.details.push({ id: job.id, title: job.title, status: 'already_complete' });
      }
    } catch (e) {
      report.jobs_failed++;
      report.details.push({ id: job.id, title: job.title, status: 'error', error: e.message });
    }
  }

  // Send daily email report if requested
  if (req.query.email === 'true') {
    try {
      const enrichedList = report.details.filter(d => d.status === 'enriched');
      const failedList = report.details.filter(d => d.status !== 'enriched' && d.status !== 'already_complete');
      const completeList = report.details.filter(d => d.status === 'already_complete');

      const enrichedRows = enrichedList.map(d =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #1a1a2e;color:#fff">${d.title || ''}</td>
         <td style="padding:8px 12px;border-bottom:1px solid #1a1a2e;color:#22c55e">${(d.fields_updated || []).join(', ')}</td></tr>`
      ).join('') || '<tr><td colspan="2" style="padding:8px 12px;color:#888">Ingen jobber enriched denne runden</td></tr>';

      const statusIcon = report.jobs_failed > 0 ? '⚠️' : '✅';

      await resend.emails.send({
        from: 'CPO Scout <noreply@strategio.site>',
        to: REPORT_EMAIL,
        subject: `${statusIcon} CPO Scout — ${report.jobs_enriched} enriched, ${report.jobs_checked} sjekket — ${new Date().toLocaleDateString('nb-NO')}`,
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 20px">
  <div style="text-align:center;margin-bottom:24px">
    <h1 style="color:#3b82f6;font-size:24px;margin:0;letter-spacing:2px">🔍 CPO SCOUT</h1>
    <p style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:3px;margin-top:4px">Job Enrichment Report</p>
  </div>

  <div style="background:#12121a;border:1px solid rgba(59,130,246,0.2);border-radius:12px;padding:24px;margin-bottom:16px;text-align:center">
    <div style="display:flex;justify-content:center;gap:32px">
      <div><div style="font-size:28px;font-weight:800;color:#22c55e">${report.jobs_enriched}</div><div style="color:#888;font-size:11px;text-transform:uppercase">Enriched</div></div>
      <div><div style="font-size:28px;font-weight:800;color:#888">${completeList.length}</div><div style="color:#888;font-size:11px;text-transform:uppercase">Already OK</div></div>
      <div><div style="font-size:28px;font-weight:800;color:${report.jobs_failed > 0 ? '#ef4444' : '#888'}">${report.jobs_failed}</div><div style="color:#888;font-size:11px;text-transform:uppercase">Failed</div></div>
    </div>
    <p style="color:#555;font-size:11px;margin:12px 0 0">${report.timestamp}</p>
  </div>

  <div style="background:#12121a;border:1px solid rgba(59,130,246,0.15);border-radius:12px;padding:20px;margin-bottom:16px">
    <h3 style="color:#3b82f6;font-size:14px;margin:0 0 12px;text-transform:uppercase;letter-spacing:1px">Enriched Jobs</h3>
    <table style="width:100%;border-collapse:collapse">
      <tr style="color:#888;font-size:11px"><th style="text-align:left;padding:6px 12px">Job</th><th style="text-align:left;padding:6px 12px">Fields Updated</th></tr>
      ${enrichedRows}
    </table>
  </div>

  ${failedList.length > 0 ? `<div style="background:#12121a;border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:20px;margin-bottom:16px">
    <h3 style="color:#ef4444;font-size:14px;margin:0 0 12px">Failed</h3>
    <ul style="margin:0;padding:0 0 0 20px;font-size:13px;color:#ef4444">${failedList.map(d => `<li>${d.title || d.id} — ${d.status}${d.error ? ': ' + d.error : ''}</li>`).join('')}</ul>
  </div>` : ''}

  <p style="color:#555;font-size:11px;text-align:center;margin:24px 0 0">CPO Scout — Automated job enrichment for cpoleads.com<br>Powered by StrategioAI</p>
</div></body></html>`,
      });
      report.email_sent = true;
    } catch (e) {
      report.email_sent = false;
      report.email_error = e.message;
    }
  }

  return res.status(200).json(report);
}
