import { z } from 'zod';
import { requireUser, json, failure, ApiError } from '@/lib/server';
import { analyzeMeal } from '@/lib/meal-ai';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    await requireUser(req);
    if (Number(req.headers.get('content-length') || 0)>4000000) throw new ApiError(413,'写真のサイズを小さくしてください');
    const raw=await req.text();
    if (raw.length>4000000) throw new ApiError(413,'写真のサイズを小さくしてください');
    const input=z.object({text:z.string().max(2000),image:z.string().max(3500000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/).optional()}).parse(JSON.parse(raw));
    if (!input.image && !input.text.trim()) throw new ApiError(400,'食事の内容か写真を追加してください');
    if (!process.env.OPENAI_API_KEY) throw new ApiError(503,'写真・文章の自動推定は未接続です。カロリーを直接入力して保存できます');
    const analysis=await analyzeMeal(input.image,input.text);
    return json({analysis});
  } catch(error) { return failure(error); }
}
