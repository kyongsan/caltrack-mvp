import { after } from 'next/server';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifySlackSignature, postSlackMessage, downloadSlackFile } from '@/lib/slack';
import { analyzeMealImage } from '@/lib/meal-ai';

export const dynamic = 'force-dynamic';

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function ensureUser(slackUserId: string) {
  const supabase = db();
  const { data: found } = await supabase.from('users').select('*').eq('slack_user_id', slackUserId).maybeSingle();
  if (found) return found;
  const { data, error } = await supabase.from('users').insert({ slack_user_id: slackUserId, timezone: 'Asia/Tokyo' }).select('*').single();
  if (error) throw error;
  return data;
}

async function processEvent(event: any) {
  if (!event || event.bot_id || event.subtype) return;
  if (!['message', 'app_mention'].includes(event.type)) return;
  const allowedUser = process.env.SLACK_USER_ID;
  if (allowedUser && event.user !== allowedUser) return;
  if (!event.user || !event.channel) return;

  const user = await ensureUser(event.user);
  const text = String(event.text || '').replace(/<@[^>]+>/g, '').trim();
  const files = Array.isArray(event.files) ? event.files : [];
  const image = files.find((f: any) => String(f.mimetype || '').startsWith('image/'));

  if (!image) {
    if (/今日.*(どう|収支)|あと.*(食べ|kcal|カロリー)/.test(text)) {
      const today = new Date().toISOString().slice(0, 10);
      const start = `${today}T00:00:00.000Z`;
      const end = `${today}T23:59:59.999Z`;
      const { data: meals } = await db().from('meals').select('total_kcal').eq('user_id', user.id).gte('eaten_at', start).lte('eaten_at', end);
      const intake = (meals || []).reduce((s: number, m: any) => s + Number(m.total_kcal || 0), 0);
      await postSlackMessage(event.channel, `今日の記録済み摂取は *${Math.round(intake)} kcal* です。\n消費カロリーと月間目標を設定すると「あと食べられるkcal」も表示できます。`, event.ts);
    }
    return;
  }

  const fileUrl = image.url_private_download || image.url_private;
  if (!fileUrl) throw new Error('Slack image URL missing');
  const imageData = await downloadSlackFile(fileUrl);
  const analysis = await analyzeMealImage(imageData, text);
  const now = new Date().toISOString();
  const supabase = db();
  const { data: meal, error } = await supabase.from('meals').insert({
    user_id: user.id,
    eaten_at: now,
    meal_type: analysis.meal_type || 'unknown',
    source: 'slack',
    original_text: text || null,
    total_kcal: analysis.total_kcal,
    protein_g: analysis.protein_g || null,
    fat_g: analysis.fat_g || null,
    carbs_g: analysis.carbs_g || null,
  }).select('id').single();
  if (error) throw error;

  if (analysis.items?.length) {
    const rows = analysis.items.map((i) => ({
      meal_id: meal.id,
      food_name: i.name,
      amount: i.amount ?? null,
      unit: i.unit ?? null,
      kcal: i.kcal,
      protein_g: i.protein_g ?? null,
      fat_g: i.fat_g ?? null,
      carbs_g: i.carbs_g ?? null,
      estimation_method: 'openai_image',
      confidence: 'medium',
      assumption: i.assumption ?? null,
    }));
    const { error: itemError } = await supabase.from('meal_items').insert(rows);
    if (itemError) throw itemError;
  }

  const itemLines = analysis.items.slice(0, 6).map((i) => `• ${i.name}: ${Math.round(i.kcal)} kcal`).join('\n');
  await postSlackMessage(event.channel, `食事を登録しました。\n*推定 ${Math.round(analysis.total_kcal)} kcal*\n${itemLines}`, event.ts);
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySlackSignature(raw, req.headers.get('x-slack-request-timestamp'), req.headers.get('x-slack-signature'))) {
    return new NextResponse('invalid signature', { status: 401 });
  }
  const body = JSON.parse(raw);
  if (body.type === 'url_verification') return NextResponse.json({ challenge: body.challenge });
  if (body.type === 'event_callback') {
    after(async () => {
      try { await processEvent(body.event); } catch (e) { console.error('Slack event failed', e); }
    });
  }
  return NextResponse.json({ ok: true });
}
