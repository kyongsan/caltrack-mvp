-- Additive upgrade; existing records and RLS are preserved.
alter table public.users add column if not exists auth_user_id uuid unique references auth.users(id);
alter table public.users add column if not exists target_intake_kcal numeric check (target_intake_kcal between 1000 and 10000);
alter table public.meals add column if not exists request_id uuid;
alter table public.meals add column if not exists source_event_id text;
alter table public.weights add column if not exists request_id uuid;
alter table public.energy_expenditures add column if not exists request_id uuid;
alter table public.medication_logs add column if not exists request_id uuid;
create unique index if not exists meals_request_id on public.meals(user_id, request_id) where request_id is not null;
create unique index if not exists meals_source_event_id on public.meals(source_event_id) where source_event_id is not null;
create unique index if not exists weights_request_id on public.weights(user_id, request_id) where request_id is not null;
create unique index if not exists energy_request_id on public.energy_expenditures(user_id, request_id) where request_id is not null;
create unique index if not exists medication_request_id on public.medication_logs(medication_id, request_id) where request_id is not null;
-- Private records are accessed through authenticated server routes only.
revoke all on public.users, public.goals, public.meals, public.meal_items, public.weights, public.energy_expenditures, public.medication_definitions, public.medication_logs from anon, authenticated;
grant select, insert, update, delete on public.users, public.goals, public.meals, public.meal_items, public.weights, public.energy_expenditures, public.medication_definitions, public.medication_logs to service_role;
alter table public.medication_definitions add column if not exists request_id uuid;
create unique index if not exists medication_definitions_request_id on public.medication_definitions(user_id, request_id) where request_id is not null;
