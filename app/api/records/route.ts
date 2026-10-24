import { z } from 'zod';
import { requireUser, failure, json, ApiError } from '@/lib/server';
import { dayBounds, tokyoDate, shiftDay } from '@/lib/balance';
export const dynamic = 'force-dynamic';
const numeric = z.number().finite().nonnegative();
const timestamp = z.string().datetime({ offset: true });
const mealSchema = z.object({ kind: z.literal('meal'), id: z.string().uuid().optional(), request_id: z.string().uuid(), eaten_at: timestamp, original_text: z.string().trim().min(1).max(2000), meal_type: z.enum(['breakfast','lunch','dinner','snack']), total_kcal: numeric.max(20000), protein_g: numeric.max(2000).nullable().optional(), fat_g: numeric.max(2000).nullable().optional(), carbs_g: numeric.max(5000).nullable().optional() });
const weightSchema = z.object({ kind: z.literal('weight'), request_id: z.string().uuid(), measured_at: timestamp, weight_kg: numeric.min(20).max(400), body_fat_pct: numeric.max(80).nullable().optional() });
const energySchema = z.object({ kind: z.literal('energy'), request_id: z.string().uuid(), date: z.string(), value_kcal: numeric.min(100).max(20000), is_estimated: z.boolean() });
const settingsSchema = z.object({ kind: z.literal('settings'), target_intake_kcal: numeric.min(1000).max(10000).nullable() });
const medicationSchema = z.object({ kind: z.literal('medication'), request_id: z.string().uuid(), medication_id: z.string().uuid(), taken_at: timestamp, dose: numeric.max(100000) });
const medicationDefinitionSchema = z.object({ kind: z.literal('medication_definition'), request_id:z.string().uuid(), name:z.string().trim().min(1).max(120), default_dose:numeric.max(100000), unit:z.string().trim().min(1).max(20) });
const recordSchema = z.discriminatedUnion('kind', [mealSchema, weightSchema, energySchema, settingsSchema, medicationSchema, medicationDefinitionSchema]);

export async function GET(req: Request) {
  try {
    const { supabase, user } = await requireUser(req);
    const date = new URL(req.url).searchParams.get('date') || tokyoDate();
    let start: string, end: string;
    try { dayBounds(date); start = dayBounds(shiftDay(date, -29)).start; end = dayBounds(date).end; } catch { throw new ApiError(400, '日付を確認してください'); }
    const results = await Promise.all([
      supabase.from('meals').select('*').eq('user_id', user.id).eq('status', 'active').gte('eaten_at', start).lt('eaten_at', end).order('eaten_at', { ascending: false }).limit(2000),
      supabase.from('weights').select('*').eq('user_id', user.id).gte('measured_at', start).lt('measured_at', end).order('measured_at', { ascending: true }).limit(2000),
      supabase.from('energy_expenditures').select('*').eq('user_id', user.id).gte('date', shiftDay(date, -29)).lte('date', date).order('created_at', { ascending: false }).limit(2000),
      supabase.from('medication_definitions').select('*').eq('user_id', user.id),
    ]);
    for (const result of results) if (result.error) throw result.error;
    const medicationIds = (results[3].data || []).map(m => m.id);
    const meds = medicationIds.length ? await supabase.from('medication_logs').select('*').in('medication_id', medicationIds).gte('taken_at', dayBounds(date).start).lt('taken_at', end) : { data: [], error: null };
    if (meds.error) throw meds.error;
    return json({ date, meals: results[0].data, weights: results[1].data, energy: results[2].data, medications: results[3].data, medication_logs: meds.data, profile: { target_intake_kcal: user.target_intake_kcal, timezone: user.timezone } });
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const { supabase, user } = await requireUser(req);
    const input = recordSchema.parse(await req.json());
    if (input.kind === 'settings') {
      const { error } = await supabase.from('users').update({ target_intake_kcal: input.target_intake_kcal }).eq('id', user.id);
      if (error) throw error;
      return json({ ok: true });
    }
    if (input.kind === 'meal' && input.id) {
      const { id, kind, request_id, ...values } = input;
      const { data, error } = await supabase.from('meals').update({ ...values, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id).eq('status','active').select('id').maybeSingle();
      if (error) throw error;
      if (!data) throw new ApiError(404, '記録が見つかりません');
      return json({ ok: true, id: data.id });
    }
    let table: string, values: Record<string, unknown>;
    const { kind, ...rest } = input;
    if (kind === 'meal') { table = 'meals'; const { id, ...meal } = rest as z.infer<typeof mealSchema>; values = { ...meal, user_id: user.id, source: 'web', status: 'active' }; }
    else if (kind === 'weight') { table = 'weights'; values = { ...rest, user_id: user.id, source: 'web' }; }
    else if (kind === 'energy') { try { dayBounds((rest as z.infer<typeof energySchema>).date); } catch { throw new ApiError(400,'日付を確認してください'); } table = 'energy_expenditures'; values = { ...rest, user_id: user.id, source: 'web', value_type: 'total' }; }
    else if (kind === 'medication_definition') { table='medication_definitions'; values={...rest,user_id:user.id}; }
    else {
      const med = input as z.infer<typeof medicationSchema>;
      const { data, error } = await supabase.from('medication_definitions').select('id').eq('id', med.medication_id).eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      if (!data) throw new ApiError(404,'服薬の設定が見つかりません');
      table = 'medication_logs'; values = { ...rest, status: 'taken', source: 'web' };
    }
    const { data, error } = await supabase.from(table).insert(values).select('id').single();
    if (error?.code === '23505') {
      // Verify ownership before treating a unique-key conflict as an idempotent success.
      let query = supabase.from(table).select('id').eq('request_id', input.request_id);
      query = table === 'medication_logs' ? query.eq('medication_id', (input as z.infer<typeof medicationSchema>).medication_id) : query.eq('user_id', user.id);
      const existing = await query.maybeSingle();
      if (existing.data) return json({ ok: true, id: existing.data.id, duplicate: true });
    }
    if (error) throw error;
    return json({ ok: true, id: data.id });
  } catch (error) { return failure(error); }
}
export async function DELETE(req: Request) {
  try {
    const { supabase, user } = await requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(await req.json());
    const { data, error } = await supabase.from('meals').update({ status:'deleted', updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id).eq('status', 'active').select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(404, '記録が見つかりません');
    return json({ ok: true });
  } catch (error) { return failure(error); }
}
