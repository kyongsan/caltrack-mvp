create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text,
  slack_user_id text unique,
  timezone text not null default 'Asia/Tokyo',
  height_cm numeric,
  birth_date date,
  sex_for_bmr_calc text check (sex_for_bmr_calc in ('male','female')),
  activity_factor numeric not null default 1.45,
  created_at timestamptz not null default now()
);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  year_month text not null,
  start_weight numeric,
  target_weight_change_kg numeric not null,
  kcal_per_kg_factor numeric not null default 7500,
  created_at timestamptz not null default now(),
  unique(user_id, year_month)
);

create table if not exists meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  eaten_at timestamptz not null,
  meal_type text,
  source text,
  original_text text,
  image_url text,
  total_kcal numeric not null default 0,
  protein_g numeric,
  fat_g numeric,
  carbs_g numeric,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists meal_items (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references meals(id) on delete cascade,
  food_name text not null,
  amount numeric,
  unit text,
  kcal numeric,
  protein_g numeric,
  fat_g numeric,
  carbs_g numeric,
  estimation_method text,
  confidence text,
  assumption text,
  user_corrected boolean not null default false
);

create table if not exists energy_expenditures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  date date not null,
  value_kcal numeric not null,
  value_type text not null,
  source text not null,
  is_estimated boolean not null default false,
  measured_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists weights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  measured_at timestamptz not null,
  weight_kg numeric not null,
  body_fat_pct numeric,
  source text,
  created_at timestamptz not null default now()
);

create table if not exists medication_definitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  default_dose numeric,
  unit text
);

create table if not exists medication_logs (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null references medication_definitions(id) on delete cascade,
  taken_at timestamptz not null,
  dose numeric,
  status text,
  source text
);

create index if not exists idx_meals_user_eaten_at on meals(user_id, eaten_at desc);
create index if not exists idx_weights_user_measured_at on weights(user_id, measured_at desc);
create index if not exists idx_energy_user_date on energy_expenditures(user_id, date desc);

alter table users enable row level security;
alter table goals enable row level security;
alter table meals enable row level security;
alter table meal_items enable row level security;
alter table energy_expenditures enable row level security;
alter table weights enable row level security;
alter table medication_definitions enable row level security;
alter table medication_logs enable row level security;

-- MVP uses the server-side service-role key only. No public client policies are created yet.
