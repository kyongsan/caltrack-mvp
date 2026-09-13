import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

type Check = { status: 'ok' | 'not_configured' | 'error'; message?: string };

async function checkSupabase(): Promise<Check> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { status: 'not_configured' };

  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await supabase.from('users').select('id').limit(1);
    if (error) return { status: 'error', message: error.message };
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'unknown error' };
  }
}

async function checkOpenAI(): Promise<Check> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { status: 'not_configured' };

  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text();
      return { status: 'error', message: `HTTP ${res.status}: ${body.slice(0, 180)}` };
    }
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'unknown error' };
  }
}

async function checkSlack(): Promise<Check> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { status: 'not_configured' };

  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      cache: 'no-store',
    });
    const body = await res.json();
    if (!body.ok) return { status: 'error', message: body.error ?? 'Slack auth.test failed' };
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'unknown error' };
  }
}

export async function GET() {
  const [supabase, openai, slack] = await Promise.all([
    checkSupabase(),
    checkOpenAI(),
    checkSlack(),
  ]);

  return NextResponse.json({
    app: { status: 'ok' },
    supabase,
    openai,
    slack,
    checked_at: new Date().toISOString(),
  });
}
