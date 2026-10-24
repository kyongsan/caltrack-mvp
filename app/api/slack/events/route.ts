import { after } from 'next/server';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifySlackSignature, postSlackMessage, downloadSlackFile } from '@/lib/slack';
import { analyzeMealImage } from '@/lib/meal-ai';
import { tokyoDate, dayBounds } from '@/lib/balance';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({ ok: true, route: 'slack-events' });
}

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function ensureUser(slackUserId: string) {
  const supabase = db();
  const { data: found } = await supabase.from('users').select('*').eq('slack_user_id', slackUserId).maybeSingle();
  if (found) return found;
  const ownerEmail = process.env.APP_OWNER_EMAIL?.toLowerCase();
  if (!ownerEmail) throw new Error('APP_OWNER_EMAIL required to link Slack and web records');
  const { data, error } = await supabase.from('users').update({ slack_user_id: slackUserId }).eq('email', ownerEmail).is('slack_user_id', null).select('*').single();
  if (error) throw error;
  return data;
}

async function processEvent(event: any, eventId: string) {
  if (!event || event.bot_id || (event.subtype && event.subtype !== 'file_share')) return;
  if (!['message', 'app_mention'].includes(event.type)) return;
  const allowedUser = process.env.SLACK_USER_ID;
  if (!allowedUser || event.user !== allowedUser) return;
  if (!event.user || !event.channel) return;

  const messageKey = `${process.env.SLACK_WORKSPACE_ID}:${event.channel}:${event.ts || eventId}`;
  const user = await ensureUser(event.user);
  const text = String(event.text || '').replace(/<@[^>]+>/g, '').trim();
  const files = Array.isArray(event.files) ? event.files : [];
  const image = files.find((f: any) => String(f.mimetype || '').startsWith('image/'));

  if (!image) {
    if (/今日.*(どう|収支)|あと.*(食べ|kcal|カロリー)/.test(text)) {
      const { start, end } = dayBounds(tokyoDate());
      const { data: meals, error: queryError } = await db().from('meals').select('total_kcal').eq('user_id', user.id).eq('status','active').gte('eaten_at', start).lt('eaten_at', end);
      if (queryError) throw queryError;
      const intake = (meals || []).reduce((s: number, m: any) => s + Number(m.total_kcal || 0), 0);
      await postSlackMessage(event.channel, `今日の記録済み摂取は *${Math.round(intake)} kcal* です。\n消費カロリーと月間目標を設定すると「あと食べられるkcal」も表示できます。`, event.ts);
    }
    return;
  }

  const fileUrl = image.url_private_download || image.url_private;
  const { data: duplicate, error: duplicateError } = await db().from('meals').select('id').eq('source_event_id', messageKey).maybeSingle();
  if (duplicateError) throw duplicateError;
  if (duplicate) return;
  if (!fileUrl) throw new Error('Slack image URL missing');
  const imageData = await downloadSlackFile(fileUrl);
  const analysis = await analyzeMealImage(imageData, text);
  const now = new Date(Number(event.ts) * 1000).toISOString();
  const supabase = db();
  const { data: meal, error } = await supabase.from('meals').insert({
    user_id: user.id,
    eaten_at: now,
    meal_type: analysis.meal_type || 'unknown',
    source: 'slack',
    source_event_id: messageKey,
    original_text: text || null,
    total_kcal: analysis.total_kcal,
    protein_g: analysis.protein_g ?? null,
    fat_g: analysis.fat_g ?? null,
    carbs_g: analysis.carbs_g ?? null,
  }).select('id').single();
  if (error?.code === '23505') return;
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
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse('invalid json', { status: 400 });
  }

  if (!verifySlackSignature(raw, req.headers.get('x-slack-request-timestamp'), req.headers.get('x-slack-signature'))) {
    return new NextResponse('invalid signature', { status: 401 });
  }
  if (body.type === 'url_verification' && typeof body.challenge === 'string') {
    return new NextResponse(body.challenge, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  if (body.type === 'event_callback' && typeof body.event_id === 'string' && process.env.SLACK_WORKSPACE_ID && body.team_id === process.env.SLACK_WORKSPACE_ID) {
    after(async () => {
      try { await processEvent(body.event, body.event_id); } catch { console.error('Slack event processing failed'); }
    });
  }
  return NextResponse.json({ ok: true });
}
