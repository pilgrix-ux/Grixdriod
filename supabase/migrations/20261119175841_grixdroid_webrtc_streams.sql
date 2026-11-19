-- Device streaming readiness is separate from Android runtime health.
alter table public.cloud_devices
  add column stream_state text not null default 'disabled'
  check (stream_state in ('disabled', 'starting', 'ready', 'error'));

create or replace function public.grixdroid_set_device_stream_state(
  p_device_id uuid,
  p_worker_id uuid,
  p_stream_state text,
  p_stream_error text default null
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
  if p_stream_state not in ('disabled', 'starting', 'ready', 'error') then
    raise exception 'invalid stream state' using errcode = '22023';
  end if;

  update public.cloud_devices d
  set stream_state = p_stream_state, updated_at = now()
  from grixdroid_private.device_runtime rt
  where d.id = p_device_id
    and rt.device_id = d.id
    and rt.worker_id = p_worker_id;
  if not found then
    raise exception 'device is not assigned to this worker' using errcode = '42501';
  end if;

  update grixdroid_private.device_runtime rt
  set runtime_metadata = jsonb_set(
        coalesce(rt.runtime_metadata, '{}'::jsonb),
        '{stream}',
        jsonb_build_object(
          'state', p_stream_state,
          'error', left(coalesce(p_stream_error, ''), 240),
          'updated_at', now()
        ),
        true
      ),
      updated_at = now()
  where rt.device_id = p_device_id and rt.worker_id = p_worker_id;
end;
$$;

revoke all on function public.grixdroid_set_device_stream_state(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.grixdroid_set_device_stream_state(uuid, uuid, text, text) to service_role;
