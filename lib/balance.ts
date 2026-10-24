export type Meal = { id: string; eaten_at: string; original_text: string | null; total_kcal: number; protein_g: number | null; fat_g: number | null; carbs_g: number | null; meal_type: string | null; source: string | null; status: string; meal_items?: { food_name: string; kcal: number; assumption?: string }[] };
export type Weight = { id: string; measured_at: string; weight_kg: number; body_fat_pct: number | null };
export type Energy = { date: string; value_kcal: number; value_type: string; is_estimated: boolean; created_at?: string };

export function tokyoDate(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function dayBounds(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00+09:00`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('日付が正しくありません');
  const start = new Date(`${date}T00:00:00+09:00`);
  return { start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
}
export function shiftDay(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
export function summary(meals: Meal[], energy: Energy[], date: string, targetIntake: number | null) {
  const dayMeals = meals.filter(m => m.status === 'active' && tokyoDate(new Date(m.eaten_at)) === date);
  const intake = dayMeals.reduce((s, m) => s + Number(m.total_kcal), 0);
  // A measured daily total already includes activity. Never add active kcal on top.
  const total = energy.filter(e => e.date === date && e.value_type === 'total').sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0];
  const expenditure = total ? Number(total.value_kcal) : null;
  return { intake: Math.round(intake), expenditure, balance: expenditure === null ? null : Math.round(intake - expenditure), remaining: targetIntake === null ? null : Math.round(targetIntake - intake), mealCount: dayMeals.length, isEstimated: total?.is_estimated ?? false,
    protein: Math.round(dayMeals.reduce((s,m)=>s+Number(m.protein_g ?? 0),0)), fat: Math.round(dayMeals.reduce((s,m)=>s+Number(m.fat_g ?? 0),0)), carbs: Math.round(dayMeals.reduce((s,m)=>s+Number(m.carbs_g ?? 0),0)) };
}
export function csvCell(value: unknown) {
  const text = String(value ?? '');
  return '"' + (/^[\s]*[=+\-@]/.test(text) ? "'" + text : text).replace(/"/g, '""') + '"';
}
