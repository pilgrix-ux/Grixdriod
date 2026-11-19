-- Owner-scoped browser input queue for real Android cloud devices.
-- Browser sessions may enqueue input only for their own running, streamed device.
-- A trusted worker atomically claims and completes the commands.

create table if not exists public.cloud_device_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id uuid not null,
  command jsonb not null check (
    jsonb_typeof(command) = 'object'
    and command ? 'type'
    and command ->> 'type' in ('tap', 'swipe', 'key', 'text')
  ),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  claimed_by uuid references grixdroid_private.workers (id) on delete restrict,
  claimed_at timestamptz,
  processed_at timestamptz,
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 240),
  created_at timestamptz not null default now(),
  constraint cloud_device_actions_device_owner_fk
    foreign key (device_id, user_id)
    references public.cloud_devices (id, user_id) on delete cascade,
  constraint cloud_device_actions_claim_state_check
    check (
      (status = 'processing' and claimed_by is not null and claimed_at is not null)
      or (status <> 'processing' and claimed_by is null and claimed_at is null)
    ),
  constraint cloud_device_actions_processed_state_check
    check ((status in ('completed', 'failed')) = (processed_at is not null))
);

create index if not exists cloud_device_actions_device_queue_idx
  on public.cloud_device_actions (device_id, status, created_at);
create index if not exists cloud_device_actions_user_created_idx
  on public.cloud_device_actions (user_id, created_at desc);

alter table public.cloud_device_actions enable row level security;
revoke all on table public.cloud_device_actions from anon, authenticated;
grant select on table public.cloud_device_actions to authenticated;
grant insert (device_id, command) on table public.cloud_device_actions to authenticated;
grant all on table public.cloud_device_actions to service_role;

create policy "Users read their own Android device actions"
  on public.cloud_device_actions for select to authenticated
  using ((select auth.uid()) = user_id);

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
  );

create or replace function public.grixdroid_claim_device_actions(
  p_worker_id uuid,
  p_limit integer default 16
)
returns table (
  action_id uuid,
  device_id uuid,
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

  -- Recover commands left processing if a worker stopped unexpectedly.
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
  returning a.id, a.device_id, a.command;
end;
$$;

create or replace function public.grixdroid_finish_device_action(
  p_action_id uuid,
  p_worker_id uuid,
  p_success boolean,
  p_failure_reason text default null
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
  if p_action_id is null or p_worker_id is null or p_success is null then
    raise exception 'action id, worker id and result are required' using errcode = '22023';
  end if;

  update public.cloud_device_actions a
  set status = case when p_success then 'completed' else 'failed' end,
      processed_at = now(),
      failure_reason = case
        when p_success then null
        else left(coalesce(nullif(btrim(p_failure_reason), ''), 'Android input could not be delivered.'), 240)
      end,
      claimed_by = null,
      claimed_at = null
  where a.id = p_action_id
    and a.status = 'processing'
    and a.claimed_by = p_worker_id;
  if not found then
    raise exception 'action is not claimed by this worker' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.grixdroid_claim_device_actions(uuid, integer) from public, anon, authenticated;
revoke all on function public.grixdroid_finish_device_action(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.grixdroid_claim_device_actions(uuid, integer) to service_role;
grant execute on function public.grixdroid_finish_device_action(uuid, uuid, boolean, text) to service_role;

comment on table public.cloud_device_actions is
  'Owner-scoped Android input commands. Browser users can enqueue commands only for their own running devices with a ready stream.';
comment on function public.grixdroid_claim_device_actions(uuid, integer) is
  'Atomically claims pending Android input commands for devices assigned to one trusted worker.';
