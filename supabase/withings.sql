-- Private Withings connection, accessed only by authenticated server routes.
create table if not exists public.withings_connections (
  user_id uuid primary key references public.users(id) on delete cascade,
  encrypted_tokens text not null,
  expires_at timestamptz not null,
  last_synced_at timestamptz,
  last_error text,
  sync_cursor bigint not null default 0,
  lock_id text,
  lock_until timestamptz,
  created_at timestamptz not null default now()
);
alter table public.withings_connections enable row level security;
revoke all on public.withings_connections from public, anon, authenticated;
grant select, insert, update, delete on public.withings_connections to service_role;
-- PostgREST must be able to infer the conflict target for measurement upserts.
create unique index if not exists weights_request_id_full on public.weights(user_id,request_id);
