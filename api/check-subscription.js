import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://cpo.strategio.site');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const email = req.query.email;
  if (!email) return res.status(400).json({ active: false, error: 'No email provided' });

  const { data, error } = await supabase
    .from('subscribers')
    .select('status, plan, current_period_end')
    .eq('email', email)
    .eq('status', 'active')
    .single();

  if (error || !data) {
    return res.status(200).json({ active: false });
  }

  // Check if subscription is still within period
  if (data.current_period_end && new Date(data.current_period_end) < new Date()) {
    return res.status(200).json({ active: false, expired: true });
  }

  return res.status(200).json({ active: true, plan: data.plan });
}
