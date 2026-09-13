type MealItem = { name: string; amount?: number; unit?: string; kcal: number; protein_g?: number; fat_g?: number; carbs_g?: number; assumption?: string };
export type MealAnalysis = { meal_type?: string; items: MealItem[]; total_kcal: number; protein_g?: number; fat_g?: number; carbs_g?: number };

export async function analyzeMealImage(imageDataUrl: string, note?: string): Promise<MealAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
  const model = process.env.OPENAI_MEAL_MODEL || 'gpt-4.1-mini';
  const prompt = `You are a nutrition estimation engine. Analyze the meal photo and estimate foods, amounts, kcal, protein, fat, and carbs. User note: ${note || '(none)'}. Return ONLY JSON with keys: meal_type, items, total_kcal, protein_g, fat_g, carbs_g. items must be an array with name, amount, unit, kcal, protein_g, fat_g, carbs_g, assumption. Use reasonable estimates and do not invent certainty.`;
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: imageDataUrl }] }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI request failed: ${res.status} ${await res.text()}`);
  const json: any = await res.json();
  const text = json.output_text || json.output?.flatMap((o: any) => o.content || []).map((c: any) => c.text).filter(Boolean).join('\n');
  if (!text) throw new Error('OpenAI returned no text');
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed.items) || typeof parsed.total_kcal !== 'number') throw new Error('Invalid meal analysis response');
  return parsed as MealAnalysis;
}
