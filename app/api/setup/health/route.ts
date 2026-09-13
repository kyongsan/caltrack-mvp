import { NextResponse } from 'next/server';

export async function GET(){
  return NextResponse.json({
    app: 'ok',
    supabase: 'not_checked',
    openai: 'not_checked',
    slack: 'not_checked'
  });
}
