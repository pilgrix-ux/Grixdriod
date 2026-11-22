# GRIXDroid WebRTC streaming setup

This guide wires the Android worker's screen encoder to MediaMTX and lets the signed-in device owner watch the stream in the GRIXDroid website.

## Components

1. Android Emulator boots and keeps its own persistent AVD data directory.
2. The worker starts the matching scrcpy server on the Android device and reads its raw H.264 stream over a private ADB-forwarded localhost TCP port.
3. FFmpeg publishes that H.264 stream to a per-device MediaMTX WHIP path.
4. MediaMTX serves the device over WHEP/WebRTC.
5. MediaMTX calls `server/mediamtx-auth.mjs` before publish/read. Publishing uses a server-only shared secret. Playback validates the visitor's Supabase access token, device ownership and an active owner-scoped `cloud_device_sessions` row with an unexpired worker lease; the device and stream must also be running.
6. The Cloud Devices page uses the user's access token for WHEP; it never receives the worker publish secret or Supabase service-role key.

## Install host components

Install MediaMTX, FFmpeg with the WHIP muxer, and a scrcpy server JAR on the streaming/worker host. The scrcpy server version must match the `SCRCPY_VERSION` value configured for the worker.

The worker uses these commands/paths:
- `SCRCPY_SERVER_PATH`: local path to the scrcpy server JAR.
- `SCRCPY_VERSION`: exact version string for that JAR.
- `FFMPEG_PATH`: FFmpeg executable path.
- `GRIXDROID_WHIP_BASE_URL`: public HTTPS base URL of the MediaMTX WHIP endpoint, for example `https://stream.example.com`.
- `GRIXDROID_STREAM_PUBLISH_TOKEN`: random secret of at least 32 characters shared only by the worker and the auth service.

The worker starts a continuous H.264 screen stream through the scrcpy server rather than Android's `screenrecord` command. The scrcpy server's raw-stream mode disables its metadata framing so FFmpeg can read the H.264 elementary stream directly. See the [scrcpy developer protocol notes](https://github.com/Genymobile/scrcpy/blob/master/doc/develop.md).

The FFmpeg build must include the WHIP muxer and its `authorization` option. FFmpeg documents WHIP publishing and the authorization option in its [format documentation](https://ffmpeg.org/ffmpeg-formats.html). MediaMTX supports WHIP publishing and WHEP/WebRTC playback; see its [WebRTC publishing guide](https://mediamtx.org/docs/publish/webrtc-clients).

## Start the auth callback

Copy `.env.mediamtx-auth.example` to `.env.mediamtx-auth`. Set:
- `SUPABASE_URL` for the dedicated GRIXDroid project.
- `SUPABASE_PUBLISHABLE_KEY`.
- `GRIXDROID_STREAM_PUBLISH_TOKEN` to the same random value configured on the worker.

Start the callback:

```bash
npm run mediamtx-auth
```

It binds to `127.0.0.1:8890` and exposes only a minimal health route plus the MediaMTX auth callback. Keep it on loopback; MediaMTX should be the only caller.

## Start MediaMTX

Edit `mediamtx.yml` and replace the sample website origin with the actual GRIXDroid website origin. Configure your HTTPS reverse proxy to forward the MediaMTX WebRTC HTTP endpoint to `127.0.0.1:8889`. Make sure the WebRTC UDP listener on port `8189` is reachable from browsers. If the host is behind NAT, set the public address under `webrtcAdditionalHosts` so ICE candidates advertise a reachable address.

Run MediaMTX with the checked-in example config:

```bash
mediamtx mediamtx.yml
```

Do not expose the auth callback on the public network. Do not leave MediaMTX publish/read permissions open to anonymous users; its external HTTP auth callback is the access-control boundary in this example.

## Configure the worker

In `.env.worker`, set the scrcpy/FFmpeg/WHIP variables listed above. Keep the stream publish token private and use HTTPS for a remote MediaMTX endpoint. Start the worker using `npm run device-worker`.

The worker marks `cloud_devices.stream_state` as `ready` only after the scrcpy stream and FFmpeg publisher remain alive through the initial WHIP handshake. Emulator and physical workers also create a device-owner session row and renew its two-minute lease while the worker is live. The auth callback rejects WHEP playback when that lease expires, even if a stale device row still says `running`. The Android device can still boot if streaming is not configured; its stream state remains `disabled` or `error`.

## Configure the website

Add this build-time variable to the website's Vite environment:

```dotenv
VITE_GRIXDROID_WHEP_BASE_URL=https://stream.example.com
```

Rebuild/redeploy the website after changing it. A device card only shows **Open Android screen** when the device is running and its stream state is ready. The browser sends the signed-in user's Supabase access token to WHEP. The MediaMTX auth callback verifies that token with Supabase Auth, then queries the device through the user's own RLS context. A user cannot watch another account's device just by guessing its UUID.

## Browser input controls

The WHEP video track is receive-only. Touch and navigation input travel separately through Supabase:

1. The signed-in browser inserts a small command into `public.cloud_device_actions`.
2. Row Level Security and a composite device/user foreign key allow only the owner of a running device with a ready stream to enqueue commands.
3. The Android worker polls `grixdroid_claim_device_actions` using its server-only service-role JWT, executes each command through ADB, and acknowledges it with `grixdroid_finish_device_action`.
4. Only tap, swipe, Back, Home, Recent Apps, Enter and basic text input are accepted by the worker validator. The worker token and service-role key never enter the browser.

The browser does not call the worker's private HTTP API directly. Input queue polling defaults to 350 ms and can be adjusted with `GRIXDROID_ACTION_POLL_MS`. Commands abandoned during a worker interruption are returned to the queue after a 30-second claim timeout. Device sessions are separate from command claims: workers renew the owner-scoped session lease every 30 seconds, and the lease expires after two minutes without a successful renewal. The physical-device worker uses the same session lease and action queue; see [physical device worker setup](PHYSICAL_DEVICE_WORKER.md).

Apply `supabase/migrations/20261119192634_grixdroid_device_controls.sql` with the other project migrations before enabling browser controls.
## Current boundaries

- This is a self-hosted streaming path; it does not create a MediaMTX server or Android host automatically.
- WebRTC media traffic requires the host's reachable UDP port and enough bandwidth for each active device.
- Device state and volume remain on the worker host; this first implementation does not migrate a volume to a different host.
- There is no public multi-region scheduler, per-user bandwidth metering or production quota/billing layer yet.
- The session lease is a short server-side authorization window, not a tenant data erasure guarantee. Physical handset cleanup is documented separately and is not a hardened multi-tenant sandbox.
- Google Play is not included in the default `google_apis` image. Use only official SDK images under the applicable terms; GRIXDroid does not bundle or redistribute Google proprietary packages.
