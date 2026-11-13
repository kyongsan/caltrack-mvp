import { z } from 'zod';
import { requireUser, json, failure, ApiError } from '@/lib/server';
import { analyzeMeal } from '@/lib/meal-ai';
import { MAX_MEAL_IMAGES, MAX_MEAL_IMAGES_LENGTH, MAX_MEAL_BODY_BYTES } from '@/lib/meal-images';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    await requireUser(req);
    if (Number(req.headers.get('content-length') || 0)>MAX_MEAL_BODY_BYTES) throw new ApiError(413,'写真の枚数かサイズを減らしてください');
    const raw=await req.text();
    if (new TextEncoder().encode(raw).byteLength>MAX_MEAL_BODY_BYTES) throw new ApiError(413,'写真の枚数かサイズを減らしてください');
    const image=z.string().max(MAX_MEAL_IMAGES_LENGTH).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/);
    const input=z.object({text:z.string().max(2000),image:image.optional(),images:z.array(image).max(MAX_MEAL_IMAGES).optional()}).parse(JSON.parse(raw));
    if (input.image && input.images) throw new ApiError(400,'写真の送信形式を確認してください');
    const images=input.images || (input.image?[input.image]:[]);
    if (images.reduce((total,photo)=>total+photo.length,0)>MAX_MEAL_IMAGES_LENGTH) throw new ApiError(413,'写真の枚数かサイズを減らしてください');
    if (!images.length && !input.text.trim()) throw new ApiError(400,'食事の内容か写真を追加してください');
    if (!process.env.OPENAI_API_KEY) throw new ApiError(503,'写真・文章の自動推定は未接続です。カロリーを直接入力して保存できます');
    const analysis=await analyzeMeal(images,input.text);
    return json({analysis});
  } catch(error) { return failure(error); }
}
