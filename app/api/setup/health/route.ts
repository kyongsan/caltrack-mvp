import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

async function checkSupabase() {
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

export async function GET() {
  const supabase = await checkSupabase();
  return NextResponse.json({
    app: 'ok',
    supabase,
    openai: process.env.OPENAI_API_KEY ? 'configured' : 'not_configured',
    slack:
      process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET
        ? 'configured'
        : 'not_configured',
  });
}
