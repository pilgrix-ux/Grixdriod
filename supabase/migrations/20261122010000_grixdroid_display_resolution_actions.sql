-- Permit only the free display-quality presets in owner-queued device actions.
-- 1080p stays unavailable until subscription entitlements are implemented.

alter table public.cloud_device_actions
  drop constraint if exists cloud_device_actions_command_check;

alter table public.cloud_device_actions
  add constraint cloud_device_actions_command_check check (
    jsonb_typeof(command) = 'object'
    and command ? 'type'
    and command ->> 'type' in (
      'tap', 'swipe', 'key', 'text', 'rotate',
      'night_mode', 'font_scale', 'fingerprint',
      'install_apk', 'resolution'
    )
    and (
      command ->> 'type' <> 'resolution'
      or command ->> 'preset' in ('180p', '360p', '480p', '720p')
    )
  );

comment on constraint cloud_device_actions_command_check on public.cloud_device_actions is
  'Allowlisted Android controls, including only the 180p, 360p, 480p and 720p display presets.';
