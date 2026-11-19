-- GRIXDroid cloud-device control-plane foundation.
-- Android runtime files remain on isolated worker volumes; this database stores
-- ownership, lifecycle metadata and opaque runtime references only.

create table if not exists public.cloud_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 40),
  profile text not null check (profile in ('compact', 'standard')),
  android_release text,
  state text not null default 'provisioning'
    check (state in ('provisioning', 'stopped', 'starting', 'running', 'stopping', 'error', 'deleting')),
  storage_state text not null default 'pending'
    check (storage_state in ('pending', 'attached', 'snapshotting', 'error')),
  storage_bytes bigint not null default 0 check (storage_bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_started_at timestamptz,
  unique (id, user_id)
);

create table if not exists public.cloud_device_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 40),
  profile text not null default 'standard' check (profile in ('compact', 'standard')),
  status text not null default 'queued'
    check (status in ('queued', 'claimed', 'starting', 'fulfilled', 'failed', 'cancelled')),
  failure_reason text,
  fulfilled_device_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cloud_device_requests_fulfilled_device_fk
    foreign key (fulfilled_device_id, user_id)
    references public.cloud_devices (id, user_id) on delete set null
);

create table if not exists public.cloud_device_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id uuid not null,
  state text not null default 'starting'
    check (state in ('starting', 'connected', 'disconnected', 'expired', 'failed')),
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  last_seen_at timestamptz,
  foreign key (device_id, user_id)
    references public.cloud_devices (id, user_id) on delete cascade
);

create index if not exists cloud_device_requests_user_created_idx
  on public.cloud_device_requests (user_id, created_at desc);
create index if not exists cloud_devices_user_created_idx
  on public.cloud_devices (user_id, created_at desc);
create index if not exists cloud_device_sessions_user_device_idx
  on public.cloud_device_sessions (user_id, device_id, started_at desc);

-- Runtime hostnames, emulator process IDs, volume paths, worker credentials and
-- stream secrets are server-only. Never expose these records through PostgREST.
create schema if not exists grixdroid_private;
revoke all on schema grixdroid_private from public, anon, authenticated;
grant usage on schema grixdroid_private to service_role;

create table if not exists grixdroid_private.workers (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  status text not null default 'offline'
    check (status in ('offline', 'ready', 'busy', 'draining', 'error')),
  capacity integer not null default 1 check (capacity between 1 and 64),
  active_devices integer not null default 0
    check (active_devices >= 0 and active_devices <= capacity),
  capabilities jsonb not null default '{}'::jsonb,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists grixdroid_private.device_runtime (
  device_id uuid primary key references public.cloud_devices (id) on delete cascade,
  worker_id uuid references grixdroid_private.workers (id) on delete set null,
  runtime_handle text,
  persistent_volume_ref text,
  runtime_metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

grant all on all tables in schema grixdroid_private to service_role;

-- Enable RLS on every exposed/public table.
alter table public.cloud_device_requests enable row level security;
alter table public.cloud_devices enable row level security;
alter table public.cloud_device_sessions enable row level security;

-- Requests: users can read and submit their own requests, and cancel only queued requests.
revoke all on table public.cloud_device_requests from anon, authenticated;
grant select, delete on table public.cloud_device_requests to authenticated;
grant insert (name, profile) on table public.cloud_device_requests to authenticated;

create policy "Users read their own cloud device requests"
  on public.cloud_device_requests for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users submit their own cloud device requests"
  on public.cloud_device_requests for insert to authenticated
  with check (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
    and status = 'queued'
    and fulfilled_device_id is null
    and failure_reason is null
  );

create policy "Users cancel only queued cloud device requests"
  on public.cloud_device_requests for delete to authenticated
  using ((select auth.uid()) = user_id and status = 'queued');

-- The worker/control-plane service owns all device lifecycle mutations.
revoke all on table public.cloud_devices from anon, authenticated;
grant select on table public.cloud_devices to authenticated;

create policy "Users read only their own cloud devices"
  on public.cloud_devices for select to authenticated
  using ((select auth.uid()) = user_id);

-- Session rows contain no browser bearer token, stream secret or host address.
revoke all on table public.cloud_device_sessions from anon, authenticated;
grant select on table public.cloud_device_sessions to authenticated;

create policy "Users read only their own cloud device sessions"
  on public.cloud_device_sessions for select to authenticated
  using ((select auth.uid()) = user_id);

-- Service role is reserved for trusted server-side provisioning and workers.
grant all on table public.cloud_device_requests to service_role;
grant all on table public.cloud_devices to service_role;
grant all on table public.cloud_device_sessions to service_role;

comment on table public.cloud_device_requests is
  'User-owned provisioning requests. A queued request is not a running Android device.';
comment on table public.cloud_devices is
  'User-owned Android device inventory; device lifecycle is changed only by trusted workers.';
comment on table public.cloud_device_sessions is
  'Session metadata only. Never store stream bearer tokens or worker network addresses here.';
comment on column grixdroid_private.device_runtime.persistent_volume_ref is
  'Opaque worker-only pointer to a per-device persistent data volume; never return it to browsers.';
