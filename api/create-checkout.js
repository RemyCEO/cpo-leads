import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, plan } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });

  const priceId = plan === 'yearly'
    ? 'price_1TURKWDS54L5Fk1YTDAVR1Cr'
    : 'price_1TURKVDS54L5Fk1YpZV0mFK1';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 3,
      },
      success_url: 'https://cpoleads.com/app.html?login&subscribed=true',
      cancel_url: 'https://cpoleads.com/app.html?login',
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
