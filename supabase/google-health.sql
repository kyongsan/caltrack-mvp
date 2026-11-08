-- Google Health tokens are encrypted by the application; no client role may access them.
create table if not exists public.google_health_connections (
  user_id uuid primary key references public.users(id) on delete cascade,
  encrypted_tokens text not null,
  expires_at timestamptz not null,
  last_synced_at timestamptz,
  last_error text,
  lock_id text,
  lock_until timestamptz,
  created_at timestamptz not null default now()
);
alter table public.google_health_connections enable row level security;
revoke all on public.google_health_connections from public, anon, authenticated;
grant select, insert, update, delete on public.google_health_connections to service_role;
create unique index if not exists weights_request_id_full on public.weights(user_id,request_id);
