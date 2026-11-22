-- Expose only Android targets installed on a recently-heard-from worker.
-- The requested release/model are part of the queue contract, not cosmetic UI labels.

alter table public.cloud_device_requests
  add column android_version text not null default '15',
  add column device_model text not null default 'pixel_7';

alter table public.cloud_devices
  add column device_model text not null default 'pixel_7';

alter table public.cloud_device_requests
  add constraint cloud_device_requests_android_version_check
    check (android_version in ('12', '12L', '13', '14', '15', '16')),
  add constraint cloud_device_requests_device_model_check
    check (device_model in ('pixel_6', 'pixel_6_pro', 'pixel_7', 'pixel_7_pro', 'pixel_8', 'pixel_8_pro', 'pixel_9', 'pixel_9_pro'));

alter table public.cloud_devices
  add constraint cloud_devices_device_model_check
    check (device_model in ('pixel_6', 'pixel_6_pro', 'pixel_7', 'pixel_7_pro', 'pixel_8', 'pixel_8_pro', 'pixel_9', 'pixel_9_pro'));

-- A browser can discover supported pairs, but cannot inspect worker records directly.
create or replace function public.grixdroid_get_device_options()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_targets jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(distinct jsonb_build_object(
      'android_version', image.value ->> 'android_version',
      'device_model', model.value
    )),
    '[]'::jsonb
  )
  into v_targets
  from grixdroid_private.workers w
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(w.capabilities -> 'system_images') = 'array'
      then w.capabilities -> 'system_images' else '[]'::jsonb end
  ) as image(value)
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(w.capabilities -> 'device_models') = 'array'
      then w.capabilities -> 'device_models' else '[]'::jsonb end
  ) as model(value)
  where w.status in ('ready', 'busy')
    and w.last_heartbeat_at > now() - interval '2 minutes'
    and image.value ->> 'android_version' in ('12', '12L', '13', '14', '15', '16')
    and model.value in ('pixel_6', 'pixel_6_pro', 'pixel_7', 'pixel_7_pro', 'pixel_8', 'pixel_8_pro', 'pixel_9', 'pixel_9_pro');

  return jsonb_build_object('targets', v_targets);
end;
$$;

revoke all on function public.grixdroid_get_device_options() from public, anon;
grant execute on function public.grixdroid_get_device_options() to authenticated;

-- Do not accept a target which no recently active worker says it can create.
-- Use a narrowly granted SECURITY DEFINER predicate because authenticated users
-- deliberately have no USAGE on the private worker schema.
create or replace function public.grixdroid_target_supported(
  p_android_version text,
  p_device_model text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $target$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from grixdroid_private.workers w
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(w.capabilities -> 'system_images') = 'array'
          then w.capabilities -> 'system_images' else '[]'::jsonb end
      ) as image(value)
      where w.status in ('ready', 'busy')
        and w.last_heartbeat_at > now() - interval '2 minutes'
        and image.value ->> 'android_version' = p_android_version
        and (case when jsonb_typeof(w.capabilities -> 'device_models') = 'array'
          then w.capabilities -> 'device_models' else '[]'::jsonb end) ? p_device_model
    );
$target$;

revoke all on function public.grixdroid_target_supported(text, text) from public, anon;
grant execute on function public.grixdroid_target_supported(text, text) to authenticated;

drop policy if exists "Users submit their own cloud device requests" on public.cloud_device_requests;
create policy "Users submit their own cloud device requests"
  on public.cloud_device_requests for insert to authenticated
  with check (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
    and status = 'queued'
    and fulfilled_device_id is null
    and failure_reason is null
    and public.grixdroid_target_supported(android_version, device_model)
  );

revoke insert on table public.cloud_device_requests from authenticated;
grant insert (name, profile, android_version, device_model)
  on table public.cloud_device_requests to authenticated;

-- The worker may only claim a queued request whose target appears in its own heartbeat.
drop function public.grixdroid_claim_device_request(uuid);
create function public.grixdroid_claim_device_request(p_worker_id uuid)
returns table (
  request_id uuid,
  user_id uuid,
  device_name text,
  profile text,
  android_version text,
  device_model text,
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

  with expired as (
    delete from grixdroid_private.request_leases l
    where l.expires_at <= now()
    returning l.request_id, l.worker_id
  ), requeued as (
    update public.cloud_device_requests r
    set status = 'queued', updated_at = now(),
        failure_reason = 'Previous worker lease expired; request returned to queue.'
    from expired e
    where r.id = e.request_id and r.status = 'claimed'
    returning e.worker_id
  ), released as (
    select worker_id, count(*)::integer as slots
    from requeued
    group by worker_id
  )
  update grixdroid_private.workers w
  set active_devices = greatest(0, w.active_devices - released.slots),
      status = case
        when greatest(0, w.active_devices - released.slots) >= w.capacity then 'busy'
        else 'ready'
      end
  from released
  where w.id = released.worker_id;

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
  join grixdroid_private.workers w on w.id = p_worker_id
  where r.status = 'queued'
    and exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(w.capabilities -> 'system_images') = 'array'
          then w.capabilities -> 'system_images' else '[]'::jsonb end
      ) as image(value)
      where image.value ->> 'android_version' = r.android_version
    )
    and case when jsonb_typeof(w.capabilities -> 'device_models') = 'array'
      then w.capabilities -> 'device_models' else '[]'::jsonb end ? r.device_model
  order by r.created_at asc
  for update of r skip locked
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
  select v_request.id, v_request.user_id, v_request.name, v_request.profile,
         v_request.android_version, v_request.device_model, v_token, v_expiry;
end;
$$;

revoke all on function public.grixdroid_claim_device_request(uuid) from public, anon, authenticated;
grant execute on function public.grixdroid_claim_device_request(uuid) to service_role;

-- Include the requested virtual hardware model on the resulting device record.
drop function public.grixdroid_complete_device_request(uuid, uuid, uuid, text, text, text, bigint);
create function public.grixdroid_complete_device_request(
  p_request_id uuid,
  p_worker_id uuid,
  p_lease_token uuid,
  p_android_release text,
  p_device_model text,
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

  if p_device_model is distinct from v_request.device_model then
    raise exception 'worker model does not match the requested device' using errcode = '22023';
  end if;

  insert into public.cloud_devices (
    id, user_id, name, profile, android_release, device_model, state, storage_state, storage_bytes
  ) values (
    v_device_id, v_request.user_id, v_request.name, v_request.profile,
    nullif(left(coalesce(p_android_release, ''), 30), ''),
    v_request.device_model,
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

revoke all on function public.grixdroid_complete_device_request(uuid, uuid, uuid, text, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.grixdroid_complete_device_request(uuid, uuid, uuid, text, text, text, text, bigint) to service_role;
