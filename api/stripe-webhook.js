import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TELEGRAM_BOT_TOKEN = '8647809461:AAGTsrtOCXyauEo5j74X_Cn6Jq3OeLw0Q8I';
const TELEGRAM_CHANNEL_ID = -1003542781934;

async function createTelegramInvite(email, stripeCustomerId) {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createChatInviteLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHANNEL_ID,
        member_limit: 1,
        name: email.substring(0, 32),
      })
    });
    const result = await resp.json();
    if (result.ok) {
      await supabase.from('channel_members').upsert({
        email,
        stripe_customer_id: stripeCustomerId,
        invite_link: result.result.invite_link,
        status: 'pending'
      }, { onConflict: 'email' });
      return result.result.invite_link;
    }
  } catch (e) {
    console.error('Telegram invite error:', e);
  }
  return null;
}

async function kickFromTelegram(stripeCustomerId) {
  try {
    const { data: member } = await supabase
      .from('channel_members')
      .select('telegram_user_id')
      .eq('stripe_customer_id', stripeCustomerId)
      .single();

    if (member?.telegram_user_id) {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/banChatMember`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHANNEL_ID,
          user_id: member.telegram_user_id,
        })
      });
      await supabase.from('channel_members')
        .update({ status: 'kicked' })
        .eq('stripe_customer_id', stripeCustomerId);
    }
  } catch (e) {
    console.error('Telegram kick error:', e);
  }
}

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

      // Generate Telegram invite link for new subscriber
      await createTelegramInvite(customerEmail, customerId);
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

    // Kick from Telegram channel if canceled
    if (status === 'canceled') {
      await kickFromTelegram(customerId);
    }
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
