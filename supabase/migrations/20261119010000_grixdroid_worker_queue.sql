-- Atomic worker queue, leases and device completion RPCs.
-- These RPCs are callable only with a server-side Supabase service-role JWT.

create table if not exists grixdroid_private.request_leases (
  request_id uuid primary key references public.cloud_device_requests (id) on delete cascade,
  worker_id uuid not null references grixdroid_private.workers (id) on delete cascade,
  lease_token uuid not null default gen_random_uuid(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

revoke all on table grixdroid_private.request_leases from public, anon, authenticated;
grant all on table grixdroid_private.request_leases to service_role;

create or replace function public.grixdroid_worker_heartbeat(
  p_worker_id uuid,
  p_label text,
  p_capacity integer default 1,
  p_capabilities jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce(auth.jwt() ->> 'role', '');
  v_capacity integer := greatest(1, least(coalesce(p_capacity, 1), 16));
begin
  if v_role <> 'service_role' then
    raise exception 'service_role is required' using errcode = '42501';
  end if;
  if p_worker_id is null or nullif(btrim(p_label), '') is null then
    raise exception 'worker id and label are required' using errcode = '22023';
  end if;

  insert into grixdroid_private.workers (
    id, label, status, capacity, active_devices, capabilities, last_heartbeat_at
  ) values (
    p_worker_id, left(btrim(p_label), 80), 'ready', v_capacity, 0,
    coalesce(p_capabilities, '{}'::jsonb), now()
  )
  on conflict (id) do update set
    label = excluded.label,
    capacity = greatest(grixdroid_private.workers.active_devices, excluded.capacity),
    capabilities = excluded.capabilities,
    last_heartbeat_at = now(),
    status = case
      when grixdroid_private.workers.active_devices >= greatest(grixdroid_private.workers.active_devices, excluded.capacity)
        then 'busy'
      else 'ready'
    end;
end;
$$;

create or replace function public.grixdroid_claim_device_request(p_worker_id uuid)
returns table (
  request_id uuid,
  user_id uuid,
  device_name text,
  profile text,
  lease_token uuid,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce(auth.jwt() ->> 'role', '');
  v_request public.cloud_device_requests%rowtype;
  v_token uuid := gen_random_uuid();
  v_expiry timestamptz := now() + interval '10 minutes';
begin
  if v_role <> 'service_role' then
    raise exception 'service_role is required' using errcode = '42501';
  end if;

  -- Expired claims become eligible for retry.
  delete from grixdroid_private.request_leases l
  where l.expires_at <= now();

  update grixdroid_private.workers w
  set last_heartbeat_at = now()
  where w.id = p_worker_id
    and w.status <> 'draining'
    and w.active_devices < w.capacity;
  if not found then
    return;
  end if;

  select r.* into v_request
  from public.cloud_device_requests r
  where r.status = 'queued'
  order by r.created_at asc
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  insert into grixdroid_private.request_leases (
    request_id, worker_id, lease_token, expires_at
  ) values (
    v_request.id, p_worker_id, v_token, v_expiry
  );

  update public.cloud_device_requests r
  set status = 'claimed', updated_at = now()
  where r.id = v_request.id;

  update grixdroid_private.workers w
  set active_devices = w.active_devices + 1,
      status = case when w.active_devices + 1 >= w.capacity then 'busy' else 'ready' end
  where w.id = p_worker_id;

  return query
  select v_request.id, v_request.user_id, v_request.name, v_request.profile, v_token, v_expiry;
end;
$$;

create or replace function public.grixdroid_complete_device_request(
  p_request_id uuid,
  p_worker_id uuid,
  p_lease_token uuid,
  p_android_release text,
  p_runtime_handle text,
  p_persistent_volume_ref text,
  p_storage_bytes bigint default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce(auth.jwt() ->> 'role', '');
  v_request public.cloud_device_requests%rowtype;
  v_lease grixdroid_private.request_leases%rowtype;
  v_device_id uuid := gen_random_uuid();
begin
  if v_role <> 'service_role' then
    raise exception 'service_role is required' using errcode = '42501';
  end if;

  select l.* into v_lease
  from grixdroid_private.request_leases l
  where l.request_id = p_request_id
    and l.worker_id = p_worker_id
    and l.lease_token = p_lease_token
    and l.expires_at > now()
  for update;
  if not found then
    raise exception 'request lease is missing, expired or owned by another worker' using errcode = '42501';
  end if;

  select r.* into v_request
  from public.cloud_device_requests r
  where r.id = p_request_id and r.status = 'claimed'
  for update;
  if not found then
    raise exception 'request is no longer claimable' using errcode = 'P0002';
  end if;

  insert into public.cloud_devices (
    id, user_id, name, profile, android_release, state, storage_state, storage_bytes
  ) values (
    v_device_id, v_request.user_id, v_request.name, v_request.profile,
    nullif(left(coalesce(p_android_release, ''), 30), ''),
    'running', 'attached', greatest(0, coalesce(p_storage_bytes, 0))
  );

  insert into grixdroid_private.device_runtime (
    device_id, worker_id, runtime_handle, persistent_volume_ref, runtime_metadata, updated_at
  ) values (
    v_device_id, p_worker_id,
    left(coalesce(p_runtime_handle, ''), 240),
    left(coalesce(p_persistent_volume_ref, ''), 500),
    jsonb_build_object('provider', 'android-emulator', 'managed_by', 'grixdroid-worker'),
    now()
  );

  update public.cloud_device_requests r
  set status = 'fulfilled', fulfilled_device_id = v_device_id, failure_reason = null, updated_at = now()
  where r.id = p_request_id;

  delete from grixdroid_private.request_leases l where l.request_id = p_request_id;
  return v_device_id;
end;
$$;

create or replace function public.grixdroid_fail_device_request(
  p_request_id uuid,
  p_worker_id uuid,
  p_lease_token uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce(auth.jwt() ->> 'role', '');
begin
  if v_role <> 'service_role' then
    raise exception 'service_role is required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from grixdroid_private.request_leases l
    where l.request_id = p_request_id
      and l.worker_id = p_worker_id
      and l.lease_token = p_lease_token
      and l.expires_at > now()
    for update
  ) then
    raise exception 'request lease is missing, expired or owned by another worker' using errcode = '42501';
  end if;

  update public.cloud_device_requests r
  set status = 'failed',
      failure_reason = left(coalesce(nullif(btrim(p_reason), ''), 'Worker could not start Android.'), 300),
      updated_at = now()
  where r.id = p_request_id and r.status = 'claimed';

  delete from grixdroid_private.request_leases l where l.request_id = p_request_id;

  update grixdroid_private.workers w
  set active_devices = greatest(0, w.active_devices - 1),
      status = case when greatest(0, w.active_devices - 1) >= w.capacity then 'busy' else 'ready' end,
      last_heartbeat_at = now()
  where w.id = p_worker_id;
end;
$$;

create or replace function public.grixdroid_set_device_state(
  p_device_id uuid,
  p_worker_id uuid,
  p_state text,
  p_android_release text default null,
  p_storage_bytes bigint default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce(auth.jwt() ->> 'role', '');
  v_old_state text;
begin
  if v_role <> 'service_role' then
    raise exception 'service_role is required' using errcode = '42501';
  end if;
  if p_state not in ('running', 'stopped', 'starting', 'stopping', 'error') then
    raise exception 'invalid device state' using errcode = '22023';
  end if;

  select d.state into v_old_state
  from public.cloud_devices d
  join grixdroid_private.device_runtime rt on rt.device_id = d.id
  where d.id = p_device_id and rt.worker_id = p_worker_id
  for update of d;
  if not found then
    raise exception 'device is not assigned to this worker' using errcode = '42501';
  end if;

  update public.cloud_devices d
  set state = p_state,
      android_release = coalesce(nullif(p_android_release, ''), d.android_release),
      storage_bytes = coalesce(p_storage_bytes, d.storage_bytes),
      storage_state = case when p_state = 'error' then 'error' else 'attached' end,
      updated_at = now(),
      last_started_at = case when p_state = 'running' then now() else d.last_started_at end
  where d.id = p_device_id;

  if v_old_state = 'running' and p_state in ('stopped', 'error') then
    update grixdroid_private.workers w
    set active_devices = greatest(0, w.active_devices - 1),
        status = case when greatest(0, w.active_devices - 1) >= w.capacity then 'busy' else 'ready' end
    where w.id = p_worker_id;
  elsif v_old_state in ('stopped', 'error') and p_state = 'running' then
    update grixdroid_private.workers w
    set active_devices = least(w.capacity, w.active_devices + 1),
        status = case when least(w.capacity, w.active_devices + 1) >= w.capacity then 'busy' else 'ready' end
    where w.id = p_worker_id;
  end if;
end;
$$;

revoke all on function public.grixdroid_worker_heartbeat(uuid, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.grixdroid_claim_device_request(uuid) from public, anon, authenticated;
revoke all on function public.grixdroid_complete_device_request(uuid, uuid, uuid, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.grixdroid_fail_device_request(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.grixdroid_set_device_state(uuid, uuid, text, text, bigint) from public, anon, authenticated;

grant execute on function public.grixdroid_worker_heartbeat(uuid, text, integer, jsonb) to service_role;
grant execute on function public.grixdroid_claim_device_request(uuid) to service_role;
grant execute on function public.grixdroid_complete_device_request(uuid, uuid, uuid, text, text, text, bigint) to service_role;
grant execute on function public.grixdroid_fail_device_request(uuid, uuid, uuid, text) to service_role;
grant execute on function public.grixdroid_set_device_state(uuid, uuid, text, text, bigint) to service_role;
