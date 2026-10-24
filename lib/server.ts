import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ApiError(503, 'データ保存先の接続設定が未完了です');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function requireUser(req: Request) {
  const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new ApiError(401, 'ログインしてください');
  const supabase = db();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user || !user.email_confirmed_at || user.is_anonymous) throw new ApiError(401, 'ログインの有効期限が切れています');
  // Access is granted only to a pre-provisioned profile. Never accept a user ID from the client.
  const { data: profile, error: profileError } = await supabase.from('users').select('*').eq('auth_user_id', user.id).maybeSingle();
  if (profileError) throw new ApiError(503, 'データベースの更新が必要です');
  if (profile) return { supabase, user: profile };
  const { data: existing, error: lookupError } = await supabase.from('users').select('*').eq('email', user.email!.toLowerCase()).is('auth_user_id', null).maybeSingle();
  if (lookupError || !existing) throw new ApiError(403, 'このアカウントには利用権限がありません');
  const { data: linked, error: linkError } = await supabase.from('users').update({ auth_user_id: user.id }).eq('id', existing.id).is('auth_user_id', null).select('*').single();
  if (linkError) throw new ApiError(409, 'ログインをやり直してください');
  return { supabase, user: linked };
}
export function failure(error: unknown) {
  if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400 });
  // Do not leak provider messages, SQL, keys, or user data to the browser or logs.
  console.error('CalTrack operation failed', error instanceof Error ? error.name : 'provider_error');
  return NextResponse.json({ error: '処理に失敗しました。接続状態を確認して再試行してください' }, { status: 503 });
}
export function json(data: unknown) { return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } }); }
