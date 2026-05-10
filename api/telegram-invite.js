import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'Email required' });

  // Check if user has active subscription
  const { data: sub } = await supabase
    .from('subscribers')
    .select('status')
    .eq('email', email)
    .single();

  if (!sub || !['active', 'trialing'].includes(sub.status)) {
    return res.json({ invite_link: null });
  }

  // Get invite link from channel_members
  const { data: member } = await supabase
    .from('channel_members')
    .select('invite_link, status')
    .eq('email', email)
    .single();

  if (member?.invite_link) {
    return res.json({ invite_link: member.invite_link, joined: member.status === 'joined' });
  }

  // No invite link yet — generate one
  const TELEGRAM_BOT_TOKEN = '8647809461:AAGTsrtOCXyauEo5j74X_Cn6Jq3OeLw0Q8I';
  const TELEGRAM_CHANNEL_ID = -1003542781934;

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
      const link = result.result.invite_link;
      await supabase.from('channel_members').upsert({
        email,
        invite_link: link,
        status: 'pending'
      }, { onConflict: 'email' });
      return res.json({ invite_link: link, joined: false });
    }
  } catch (e) {
    console.error('Telegram invite error:', e);
  }

  res.json({ invite_link: null });
}
