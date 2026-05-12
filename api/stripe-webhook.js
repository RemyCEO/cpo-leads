import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendWelcomeEmail(email) {
  try {
    await resend.emails.send({
      from: 'CPO Leads <noreply@strategio.site>',
      to: email,
      subject: 'Welcome to CPO Leads — Create Your Account',
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:40px 24px">
  <div style="text-align:center;margin-bottom:32px">
    <h1 style="color:#C9A84C;font-size:28px;margin:0;letter-spacing:2px">CPO LEADS</h1>
    <p style="color:#888;font-size:12px;text-transform:uppercase;letter-spacing:3px;margin-top:4px">Close Protection Intelligence</p>
  </div>
  <div style="background:#12121a;border:1px solid rgba(201,168,76,0.2);border-radius:12px;padding:32px;margin-bottom:24px">
    <h2 style="color:#fff;font-size:20px;margin:0 0 16px">Payment confirmed</h2>
    <p style="color:#ccc;font-size:14px;line-height:1.6;margin:0 0 24px">
      Your subscription is active. Click the button below to create your account — choose your own password and get instant access to the platform.
    </p>
    <div style="background:#0a0a0f;border:1px solid rgba(201,168,76,0.15);border-radius:8px;padding:20px;margin-bottom:24px">
      <p style="color:#888;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px">Your Email</p>
      <p style="color:#fff;font-size:14px;margin:0;font-family:monospace">${email}</p>
    </div>
    <a href="https://cpoleads.com/app.html?signup&paid=true" style="display:block;text-align:center;background:linear-gradient(135deg,#C9A84C,#b8943f);color:#000;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:1px">CREATE YOUR ACCOUNT</a>
    <p style="color:#888;font-size:12px;text-align:center;margin:16px 0 0">Use the same email address you paid with: <strong style="color:#fff">${email}</strong></p>
  </div>
  <p style="color:#666;font-size:12px;text-align:center;margin:0">
    Questions? Reply to this email or contact <a href="mailto:support@strategioai.com" style="color:#C9A84C">support@strategioai.com</a>
  </p>
</div>
</body>
</html>`,
    });
    console.log('Welcome email sent to', email);
  } catch (e) {
    console.error('Resend email error:', e);
  }
}

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
        // Send welcome email with signup link — user creates own password
        await sendWelcomeEmail(customerEmail);
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
