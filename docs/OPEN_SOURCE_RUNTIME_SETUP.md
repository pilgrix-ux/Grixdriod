# GRIXDroid open-source runtime host preflight

GRIXDroid uses existing open-source components rather than a paid emulator API:

- Android Emulator + ADB from the Android SDK for ordinary APK testing.
- KVM on Linux for hardware-accelerated virtualisation.
- Per-device AVD directories under `GRIXDROID_DATA_ROOT` for persistent Android user data.
- scrcpy server for Android display capture.
- FFmpeg's WHIP muxer to publish H.264.
- MediaMTX for WebRTC WHIP ingest and WHEP playback.
- `server/mediamtx-auth.mjs` for worker-publish authentication and signed-in owner checks.

## Run the host doctor

On the Linux machine that will run the worker:

```bash
cp .env.worker.example .env.worker
# Edit .env.worker using private values from the dedicated GRIXDroid backend.
npm ci
npm run device-worker:doctor
```

The doctor checks Linux/KVM access, Android SDK executables, the selected system image, the configured data directory, worker identity, server-only control-plane credentials, and optional scrcpy/FFmpeg WHIP configuration. It never prints secret values. A successful check does not itself enroll or launch a worker; start the worker only after the backend migrations and worker registration are complete.

## Install the open-source runtime

Install the Android SDK command-line tools, then accept the SDK licences and install the selected image:

```bash
sdkmanager --licenses
sdkmanager "platform-tools" "emulator" "cmdline-tools;latest" "system-images;android-35;default;x86_64"
```

The default worker example currently selects the Google Play-enabled image. Google Play and Google Play services are proprietary components; do not redistribute them or assume an open-source licence. For a fully open-source baseline, use the `google_apis` AOSP-compatible SDK image shown above and set `GRIXDROID_SYSTEM_IMAGE=system-images;android-35;default;x86_64`. Features that require Google Play must be tested separately with an appropriately licensed image or a physical device.

Make sure the worker user can access `/dev/kvm` and that `GRIXDROID_DATA_ROOT` points to a durable mounted disk, not a temporary directory or container layer. Keep one concurrent device initially and monitor disk growth.

## Enable browser streaming

Install a scrcpy server JAR matching the exact `SCRCPY_VERSION` expected by the worker, and an FFmpeg build that exposes the WHIP muxer with the `authorization` option. Run MediaMTX with `mediamtx.yml`, configure its public HTTPS reverse proxy and reachable WebRTC UDP port, then run the auth callback:

```bash
npm run mediamtx-auth
```

Configure the same random 32+ character publish token in the worker and auth service. Keep the auth callback bound to loopback. Set `VITE_GRIXDROID_WHEP_BASE_URL` on the website and rebuild it. Do not expose ADB, the worker API, Supabase service-role credentials or the WHIP publish token to browsers.

## Start the worker

```bash
npm run device-worker
```

The worker heartbeat advertises its provider only after startup checks pass. The device's AVD writable data remains on the durable host disk across ordinary stop/start; deleting the device is a separate destructive operation. The emulator's Quick Boot snapshots are disabled in this worker profile, but its writable user-data disk is retained.

## Limits of the free-first setup

The software stack is free/open-source where noted, but a persistent public cloud phone still needs a host with CPU, RAM, storage and bandwidth. GitHub Actions is useful for temporary CI smoke tests, not long-lived customer sessions. Cuttlefish is a separate future provider for AOSP platform engineering; the current worker uses the Android Emulator and does not implement a Cuttlefish adapter.

Official references:
- Android Emulator acceleration and KVM: https://developer.android.com/studio/run/emulator-acceleration
- Android Emulator persistent data options: https://developer.android.com/studio/run/emulator-commandline
- Cuttlefish host requirements: https://source.android.com/docs/devices/cuttlefish/get-started
- MediaMTX: https://github.com/bluenviron/mediamtx
- scrcpy: https://github.com/Genymobile/scrcpy
- FFmpeg: https://ffmpeg.org/
