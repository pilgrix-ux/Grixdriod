-- Keep virtual Pixel AVDs separate from exact OEM firmware targets.
-- The emulator worker can expose Pixel definitions only. OEM models require a
-- physical-device provider to report the exact model/version/build it inspected.

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

  with available_targets as (
    select distinct
      image.value ->> 'android_version' as android_version,
      model.value as device_model
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
      and w.capabilities ->> 'provider' = 'android-emulator'
      and image.value ->> 'android_version' in ('12', '12L', '13', '14', '15', '16')
      and model.value in (
        'pixel_6', 'pixel_6_pro', 'pixel_7', 'pixel_7_pro',
        'pixel_8', 'pixel_8_pro', 'pixel_9', 'pixel_9_pro'
      )

    union

    select distinct
      target.value ->> 'android_version' as android_version,
      target.value ->> 'device_model' as device_model
    from grixdroid_private.workers w
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(w.capabilities -> 'device_targets') = 'array'
        then w.capabilities -> 'device_targets' else '[]'::jsonb end
    ) as target(value)
    where w.status = 'ready'
      and w.active_devices < w.capacity
      and w.last_heartbeat_at > now() - interval '2 minutes'
      and w.capabilities ->> 'provider' = 'android-physical'
      and target.value -> 'verified' = 'true'::jsonb
      and target.value ->> 'android_version' in ('12', '12L', '13', '14', '15', '16')
      and target.value ->> 'device_model' in (
        'samsung_galaxy_s22', 'samsung_galaxy_s23', 'samsung_galaxy_s24', 'samsung_galaxy_s24_ultra',
        'oppo_find_x8_pro', 'xiaomi_14_ultra'
      )
      and lower(coalesce(target.value ->> 'manufacturer', '')) =
        case
          when target.value ->> 'device_model' like 'samsung_%' then 'samsung'
          when target.value ->> 'device_model' = 'oppo_find_x8_pro' then 'oppo'
          when target.value ->> 'device_model' = 'xiaomi_14_ultra' then 'xiaomi'
          else ''
        end
      and length(coalesce(btrim(target.value ->> 'hardware_model'), '')) > 0
      and length(coalesce(btrim(target.value ->> 'build_fingerprint'), '')) > 0
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'android_version', android_version,
      'device_model', device_model
    ) order by android_version, device_model),
    '[]'::jsonb
  )
  into v_targets
  from available_targets;

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
    and (
      exists (
        select 1
        from grixdroid_private.workers w
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(w.capabilities -> 'system_images') = 'array'
            then w.capabilities -> 'system_images' else '[]'::jsonb end
        ) as image(value)
        where w.status = 'ready'
          and w.active_devices < w.capacity
          and w.last_heartbeat_at > now() - interval '2 minutes'
          and w.capabilities ->> 'provider' = 'android-emulator'
          and p_device_model in (
            'pixel_6', 'pixel_6_pro', 'pixel_7', 'pixel_7_pro',
            'pixel_8', 'pixel_8_pro', 'pixel_9', 'pixel_9_pro'
          )
          and image.value ->> 'android_version' = p_android_version
          and (case when jsonb_typeof(w.capabilities -> 'device_models') = 'array'
            then w.capabilities -> 'device_models' else '[]'::jsonb end) ? p_device_model
      )
      or exists (
        select 1
        from grixdroid_private.workers w
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(w.capabilities -> 'device_targets') = 'array'
            then w.capabilities -> 'device_targets' else '[]'::jsonb end
        ) as target(value)
        where w.status = 'ready'
          and w.active_devices < w.capacity
          and w.last_heartbeat_at > now() - interval '2 minutes'
          and w.capabilities ->> 'provider' = 'android-physical'
          and target.value -> 'verified' = 'true'::jsonb
          and target.value ->> 'android_version' = p_android_version
          and target.value ->> 'device_model' = p_device_model
          and p_device_model in (
            'samsung_galaxy_s22', 'samsung_galaxy_s23', 'samsung_galaxy_s24', 'samsung_galaxy_s24_ultra',
            'oppo_find_x8_pro', 'xiaomi_14_ultra'
          )
          and lower(coalesce(target.value ->> 'manufacturer', '')) =
            case
              when p_device_model like 'samsung_%' then 'samsung'
              when p_device_model = 'oppo_find_x8_pro' then 'oppo'
              when p_device_model = 'xiaomi_14_ultra' then 'xiaomi'
              else ''
            end
          and length(coalesce(btrim(target.value ->> 'hardware_model'), '')) > 0
          and length(coalesce(btrim(target.value ->> 'build_fingerprint'), '')) > 0
      )
    );
$target$;
