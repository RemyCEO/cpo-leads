import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ADMIN_EMAILS = ['remy@strategioai.com', 'helgesenconsulting@gmail.com', 'reppin1388@gmail.com'];
const FREE_LIMIT = 3;

const REGION_MAP = {
  'Saudi Arabia':'Middle East','KSA':'Middle East','UAE':'Middle East','Qatar':'Middle East','Bahrain':'Middle East','Kuwait':'Middle East','Oman':'Middle East','Iraq':'Middle East','Jordan':'Middle East',
  'UK':'Europe','Germany':'Europe','France':'Europe','Italy':'Europe','Spain':'Europe','Netherlands':'Europe','Switzerland':'Europe','Norway':'Europe','Sweden':'Europe',
  'USA':'Americas','Canada':'Americas','Mexico':'Americas','Brazil':'Americas',
  'Nigeria':'Africa','Kenya':'Africa','South Africa':'Africa','Mozambique':'Africa',
  'Australia':'Asia-Pacific','Japan':'Asia-Pacific','Singapore':'Asia-Pacific','India':'Asia-Pacific'
};

function maskJob(j) {
  return {
    id: j.id,
    title: 'Verified Position',
    company: 'Verified Employer',
    location: REGION_MAP[j.country] || 'Undisclosed',
    country: '',
    salary: j.salary ? 'Competitive' : '',
    source: j.source || '',
    source_url: '',
    notes: '',
    description: '',
    requirements: '',
    scraped_at: j.scraped_at,
    posted_at: j.posted_at,
    _masked: true,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const email = (req.query.email || '').toLowerCase().trim();
  const cid = req.query.cid || '';

  // Determine subscription status
  let isPaid = false;
  if (email) {
    if (ADMIN_EMAILS.includes(email)) {
      isPaid = true;
    } else {
      const { data } = await supabase
        .from('subscribers')
        .select('status, current_period_end')
        .eq('email', email)
        .in('status', ['active', 'trialing'])
        .single();

      if (data) {
        if (!data.current_period_end || new Date(data.current_period_end) >= new Date()) {
          isPaid = true;
        }
      } else if (cid) {
        // Fallback: Stripe customer ID match (email-mismatch recovery)
        const fb = await supabase
          .from('subscribers')
          .select('status, current_period_end')
          .eq('stripe_customer_id', cid)
          .in('status', ['active', 'trialing'])
          .single();
        if (fb.data && (!fb.data.current_period_end || new Date(fb.data.current_period_end) >= new Date())) {
          isPaid = true;
        }
      }
    }
  }

  // Fetch jobs
  const { data: jobs, error } = await supabase
    .from('job_listings')
    .select('*')
    .order('scraped_at', { ascending: false })
    .limit(500);

  if (error || !jobs) {
    return res.status(200).json({ jobs: [], paid: isPaid });
  }

  if (isPaid) {
    return res.status(200).json({ jobs, paid: true });
  }

  // Free users: first FREE_LIMIT jobs full, rest masked
  const result = jobs.map((j, i) => i < FREE_LIMIT ? j : maskJob(j));
  return res.status(200).json({ jobs: result, paid: false });
}
