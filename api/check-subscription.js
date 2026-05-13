import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const email = req.query.email;
  const cid = req.query.cid; // Stripe customer ID for email-mismatch recovery
  if (!email) return res.status(400).json({ active: false, error: 'No email provided' });

  // Admin bypass — server-side only, never exposed to client
  const ADMIN_EMAILS = ['remy@strategioai.com', 'helgesenconsulting@gmail.com', 'reppin1388@gmail.com'];
  if (ADMIN_EMAILS.includes(email.toLowerCase())) {
    return res.status(200).json({ active: true, plan: 'admin' });
  }

  // Try exact email match first
  let { data } = await supabase
    .from('subscribers')
    .select('status, plan, current_period_end')
    .eq('email', email)
    .in('status', ['active', 'trialing'])
    .single();

  // Fallback: match by Stripe customer ID (handles email mismatch)
  if (!data && cid) {
    const fallback = await supabase
      .from('subscribers')
      .select('status, plan, current_period_end')
      .eq('stripe_customer_id', cid)
      .in('status', ['active', 'trialing'])
      .single();
    if (fallback.data) {
      data = fallback.data;
      // Auto-fix: update the subscriber record with the auth email
      await supabase.from('subscribers')
        .update({ email, updated_at: new Date().toISOString() })
        .eq('stripe_customer_id', cid);
    }
  }

  if (!data) {
    return res.status(200).json({ active: false });
  }

  // Check if subscription is still within period
  if (data.current_period_end && new Date(data.current_period_end) < new Date()) {
    return res.status(200).json({ active: false, expired: true });
  }

  return res.status(200).json({ active: true, plan: data.plan });
}
