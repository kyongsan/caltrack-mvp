-- Oura tokens are encrypted by the application; no client role may access them.
create table if not exists public.oura_connections (
  user_id uuid primary key references public.users(id) on delete cascade,
  encrypted_tokens text not null,
  expires_at timestamptz not null,
  last_synced_at timestamptz,
  last_error text,
  lock_id text,
  lock_until timestamptz,
  created_at timestamptz not null default now()
);
alter table public.oura_connections enable row level security;
revoke all on public.oura_connections from public, anon, authenticated;
grant select, insert, update, delete on public.oura_connections to service_role;
-- A nonpartial index lets PostgREST infer the conflict target for retry-safe daily upserts.
create unique index if not exists energy_request_id_full on public.energy_expenditures(user_id,request_id);
