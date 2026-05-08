import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = { api: { bodyParser: false } };

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  const { type, data } = event;

  if (type === 'checkout.session.completed') {
    const session = data.object;
    const customerEmail = session.customer_details?.email || session.customer_email;
    const customerId = session.customer;
    const subscriptionId = session.subscription;

    if (customerEmail) {
      // Check if subscriber exists
      const { data: existing } = await supabase
        .from('subscribers')
        .select('id')
        .eq('email', customerEmail)
        .single();

      if (existing) {
        await supabase.from('subscribers').update({
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          status: 'active',
          updated_at: new Date().toISOString()
        }).eq('email', customerEmail);
      } else {
        await supabase.from('subscribers').insert({
          email: customerEmail,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          status: 'active'
        });
      }
    }
  }

  if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
    const subscription = data.object;
    const customerId = subscription.customer;
    const status = ['active','trialing'].includes(subscription.status) ? subscription.status : subscription.status === 'canceled' ? 'canceled' : subscription.status;
    const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();

    await supabase.from('subscribers').update({
      status,
      current_period_end: periodEnd,
      updated_at: new Date().toISOString()
    }).eq('stripe_customer_id', customerId);
  }

  if (type === 'invoice.payment_failed') {
    const invoice = data.object;
    const customerId = invoice.customer;
    await supabase.from('subscribers').update({
      status: 'past_due',
      updated_at: new Date().toISOString()
    }).eq('stripe_customer_id', customerId);
  }

  res.status(200).json({ received: true });
}
