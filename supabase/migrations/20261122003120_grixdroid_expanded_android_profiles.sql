-- Expand the allowlisted Android virtual-device profiles.
-- These are hardware/screen profiles on an Android system image, not OEM firmware.
alter table public.cloud_device_requests
  drop constraint if exists cloud_device_requests_device_model_check;
alter table public.cloud_devices
  drop constraint if exists cloud_devices_device_model_check;

alter table public.cloud_device_requests
  add constraint cloud_device_requests_device_model_check
  check (device_model in (
    'pixel_6', 'pixel_6_pro', 'pixel_7', 'pixel_7_pro',
    'pixel_8', 'pixel_8_pro', 'pixel_9', 'pixel_9_pro',
    'samsung_galaxy_s22', 'samsung_galaxy_s23', 'samsung_galaxy_s24', 'samsung_galaxy_s24_ultra',
    'oppo_find_x8_pro', 'xiaomi_14_ultra'
  ));

alter table public.cloud_devices
  add constraint cloud_devices_device_model_check
  check (device_model in (
    'pixel_6', 'pixel_6_pro', 'pixel_7', 'pixel_7_pro',
    'pixel_8', 'pixel_8_pro', 'pixel_9', 'pixel_9_pro',
    'samsung_galaxy_s22', 'samsung_galaxy_s23', 'samsung_galaxy_s24', 'samsung_galaxy_s24_ultra',
    'oppo_find_x8_pro', 'xiaomi_14_ultra'
  ));

create or replace function public.grixdroid_get_device_options()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $options$
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
  where w.status = 'ready'
    and w.active_devices < w.capacity
    and w.last_heartbeat_at > now() - interval '2 minutes'
    and image.value ->> 'android_version' in ('12', '12L', '13', '14', '15', '16')
    and model.value in (
      'pixel_6', 'pixel_6_pro', 'pixel_7', 'pixel_7_pro',
      'pixel_8', 'pixel_8_pro', 'pixel_9', 'pixel_9_pro',
      'samsung_galaxy_s22', 'samsung_galaxy_s23', 'samsung_galaxy_s24', 'samsung_galaxy_s24_ultra',
      'oppo_find_x8_pro', 'xiaomi_14_ultra'
    );

  return jsonb_build_object('targets', v_targets);
end;
$options$;

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
    and p_device_model in (
      'pixel_6', 'pixel_6_pro', 'pixel_7', 'pixel_7_pro',
      'pixel_8', 'pixel_8_pro', 'pixel_9', 'pixel_9_pro',
      'samsung_galaxy_s22', 'samsung_galaxy_s23', 'samsung_galaxy_s24', 'samsung_galaxy_s24_ultra',
      'oppo_find_x8_pro', 'xiaomi_14_ultra'
    )
    and exists (
      select 1
      from grixdroid_private.workers w
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(w.capabilities -> 'system_images') = 'array'
          then w.capabilities -> 'system_images' else '[]'::jsonb end
      ) as image(value)
      where w.status = 'ready'
        and w.active_devices < w.capacity
        and w.last_heartbeat_at > now() - interval '2 minutes'
        and image.value ->> 'android_version' = p_android_version
        and (case when jsonb_typeof(w.capabilities -> 'device_models') = 'array'
          then w.capabilities -> 'device_models' else '[]'::jsonb end) ? p_device_model
    );
$target$;