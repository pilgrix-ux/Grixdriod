-- Private APK upload path and additional real Android emulator controls.
-- APKs are uploaded by the authenticated owner and fetched only by the trusted worker.

alter table public.cloud_device_actions
  drop constraint if exists cloud_device_actions_command_check;

alter table public.cloud_device_actions
  add constraint cloud_device_actions_command_check check (
    jsonb_typeof(command) = 'object'
    and command ? 'type'
    and command ->> 'type' in (
      'tap', 'swipe', 'key', 'text', 'rotate',
      'night_mode', 'font_scale', 'fingerprint', 'install_apk'
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'grixdroid-apks',
  'grixdroid-apks',
  false,
  52428800,
  array['application/vnd.android.package-archive', 'application/octet-stream']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "GRIXDroid users upload their own APKs" on storage.objects;
create policy "GRIXDroid users upload their own APKs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'grixdroid-apks'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and storage.extension(name) = 'apk'
  );

drop policy if exists "Users control only their own running streamed devices" on public.cloud_device_actions;
create policy "Users control only their own running streamed devices"
  on public.cloud_device_actions for insert to authenticated
  with check (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
    and status = 'queued'
    and claimed_by is null
    and claimed_at is null
    and processed_at is null
    and failure_reason is null
    and exists (
      select 1
      from public.cloud_devices d
      where d.id = cloud_device_actions.device_id
        and d.user_id = (select auth.uid())
        and d.state = 'running'
        and d.stream_state = 'ready'
    )
    and (
      command ->> 'type' <> 'install_apk'
      or (
        command ->> 'object_path' like (
          (select auth.uid()::text) || '/' || device_id::text || '/%'
        )
        and exists (
          select 1 from storage.objects so
          where so.bucket_id = 'grixdroid-apks'
            and so.name = command ->> 'object_path'
            and (storage.foldername(so.name))[1] = (select auth.uid()::text)
        )
      )
    )
  );

drop function if exists public.grixdroid_claim_device_actions(uuid, integer);

create function public.grixdroid_claim_device_actions(
  p_worker_id uuid,
  p_limit integer default 16
)
returns table (
  action_id uuid,
  device_id uuid,
  user_id uuid,
  command jsonb
)
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
  if p_worker_id is null then
    raise exception 'worker id is required' using errcode = '22023';
  end if;

  update public.cloud_device_actions a
  set status = 'queued', claimed_by = null, claimed_at = null
  where a.status = 'processing'
    and a.claimed_by = p_worker_id
    and a.claimed_at < now() - interval '30 seconds'
    and exists (
      select 1
      from grixdroid_private.device_runtime rt
      where rt.device_id = a.device_id and rt.worker_id = p_worker_id
    );

  return query
  with candidates as (
    select a.id
    from public.cloud_device_actions a
    join grixdroid_private.device_runtime rt
      on rt.device_id = a.device_id and rt.worker_id = p_worker_id
    join public.cloud_devices d on d.id = a.device_id
    where a.status = 'queued'
      and d.state = 'running'
    order by a.created_at
    limit least(greatest(coalesce(p_limit, 16), 1), 64)
    for update of a skip locked
  )
  update public.cloud_device_actions a
  set status = 'processing',
      claimed_by = p_worker_id,
      claimed_at = now()
  from candidates c
  where a.id = c.id
  returning a.id, a.device_id, a.user_id, a.command;
end;
$$;

revoke all on function public.grixdroid_claim_device_actions(uuid, integer) from public, anon, authenticated;
grant execute on function public.grixdroid_claim_device_actions(uuid, integer) to service_role;

comment on table public.cloud_device_actions is
  'Owner-scoped Android input and APK install commands. Only a trusted worker reads private APK objects and invokes Android package installation.';
