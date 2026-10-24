import { json } from '@/lib/server';
export const dynamic = 'force-dynamic';
export function GET() {
  return json({ url: process.env.NEXT_PUBLIC_SUPABASE_URL || null, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || null });
}
