import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const secret = req.query.secret || req.headers['x-scout-secret'];
  if (secret !== 'cpo-scout-2026') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const { data, error } = await supabase
    .from('job_listings')
    .select('id, title, notes')
    .or('notes.is.null,notes.eq.')
    .limit(5);
  
  return res.status(200).json({ jobs_needing_enrichment: data?.length || 0, jobs: data });
}
