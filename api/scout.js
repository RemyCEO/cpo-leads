import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SCOUT_SECRET = process.env.SCOUT_SECRET || 'cpo-scout-2026';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BATCH_SIZE = 10;

async function getJobsToEnrich(limit) {
  const { data, error } = await supabase
    .from('job_listings')
    .select('id, title, company, location, country, salary, source, source_url, notes, scraped_at')
    .or('notes.is.null,notes.eq.,salary.is.null,salary.eq.,location.is.null,location.eq.')
    .not('source_url', 'is', null)
    .not('source_url', 'eq', '')
    .order('scraped_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  const { data: shortNotes } = await supabase
    .from('job_listings')
    .select('id, title, company, location, country, salary, source, source_url, notes, scraped_at')
    .not('source_url', 'is', null)
    .not('source_url', 'eq', '')
    .not('notes', 'is', null)
    .order('scraped_at', { ascending: false })
    .limit(100);

  const shortOnes = (shortNotes || []).filter(j =>
    j.notes && j.notes.replace(/Enriched by Scout.*/, '').trim().length < 50
  ).slice(0, limit);

  const ids = new Set(data.map(j => j.id));
  const merged = [...data];
  for (const j of shortOnes) {
    if (!ids.has(j.id)) { merged.push(j); ids.add(j.id); }
  }

  return merged.filter(j => {
    const notes = (j.notes || '').replace(/Enriched by Scout.*/, '').trim();
    return notes.length < 50;
  }).slice(0, limit);
}

async function fetchPageContent(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const html = await resp.text();
    return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
  } catch (e) { return null; }
}

async function aiEnrichJob(job, pageContent) {
  if (!ANTHROPIC_API_KEY) return null;
  const prompt = `Extract job info as JSON. Fields: title, company, location, country, salary, description (2-4 sentences), requirements, contact_email, contact_phone, contact_url, employment_type. Use "" if not found.

JOB: ${job.title} at ${job.company || 'unknown'}, ${job.location || 'unknown'}
PAGE: ${(pageContent || 'No content').slice(0, 3000)}`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await resp.json();
    const text = data.content?.[0]?.text?.trim();
    if (!text) return null;
    return JSON.parse(text.replace(/^```json?\n?|```$/g, ''));
  } catch (e) { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const secret = req.query.secret || req.headers['x-scout-secret'];
  if (secret !== SCOUT_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  const limit = Math.min(parseInt(req.query.limit) || BATCH_SIZE, 20);
  const report = { timestamp: new Date().toISOString(), jobs_checked: 0, jobs_enriched: 0, jobs_failed: 0, details: [] };
  const jobs = await getJobsToEnrich(limit);
  report.jobs_checked = jobs.length;
  if (!jobs.length) return res.status(200).json({ ...report, message: 'No jobs need enrichment' });

  for (const job of jobs) {
    try {
      const pageContent = job.source_url ? await fetchPageContent(job.source_url) : null;
      const enriched = await aiEnrichJob(job, pageContent);
      if (!enriched) { report.jobs_failed++; report.details.push({ id: job.id, title: job.title, status: 'ai_failed' }); continue; }

      const update = {};
      if (enriched.title && enriched.title.length > 5 && (!job.title || job.title === 'Insider Job Post')) update.title = enriched.title.slice(0, 120);
      if (enriched.company && enriched.company.length > 2 && (!job.company || job.company === 'Insider Source')) update.company = enriched.company.slice(0, 80);
      if (enriched.location && !job.location) update.location = enriched.location.slice(0, 60);
      if (enriched.country && !job.country) update.country = enriched.country.slice(0, 40);
      if (enriched.salary && !job.salary) update.salary = enriched.salary.slice(0, 60);

      const parts = [];
      if (enriched.description) parts.push(enriched.description);
      if (enriched.requirements) parts.push('Requirements: ' + enriched.requirements);
      if (enriched.contact_email) parts.push('Apply: ' + enriched.contact_email);
      if (enriched.contact_url && enriched.contact_url !== job.source_url) parts.push('Apply URL: ' + enriched.contact_url);
      if (enriched.employment_type) parts.push('Type: ' + enriched.employment_type);

      if (parts.length > 0) {
        const existingNotes = (job.notes || '').replace(/Enriched by Scout.*/, '').trim();
        const newNotes = parts.join('. ');
        if (newNotes.length > (existingNotes.length + 20)) {
          update.notes = (newNotes + '. Enriched by Scout ' + new Date().toISOString().slice(0, 10)).slice(0, 500);
        }
      }

      if (Object.keys(update).length > 0) {
        const { error } = await supabase.from('job_listings').update(update).eq('id', job.id);
        if (!error) { report.jobs_enriched++; report.details.push({ id: job.id, title: update.title || job.title, status: 'enriched', fields_updated: Object.keys(update) }); }
        else { report.jobs_failed++; report.details.push({ id: job.id, title: job.title, status: 'db_error' }); }
      } else {
        const realNotes = (job.notes || '').replace(/Enriched by Scout.*/, '').trim();
        if (realNotes.length >= 50) {
          await supabase.from('job_listings').update({ notes: (realNotes + '. Enriched by Scout ' + new Date().toISOString().slice(0, 10)).slice(0, 500) }).eq('id', job.id);
          report.details.push({ id: job.id, title: job.title, status: 'already_complete' });
        } else {
          report.jobs_failed++;
          report.details.push({ id: job.id, title: job.title, status: 'no_content_found' });
        }
      }
    } catch (e) { report.jobs_failed++; report.details.push({ id: job.id, title: job.title, status: 'error', error: e.message }); }
  }

  return res.status(200).json(report);
}
