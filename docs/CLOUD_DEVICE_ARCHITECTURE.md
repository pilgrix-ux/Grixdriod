# GRIXDroid cloud-device foundation

## What this milestone adds

This milestone introduces the first account-scoped control-plane layer:

- Supabase Auth is used for customer identity.
- Each provisioning request is owned by the authenticated user.
- Device inventory and session metadata are readable only by the device owner.
- Device lifecycle writes are reserved for trusted server-side services.
- Worker records, runtime handles and persistent-volume references live in a private database schema.
- The website has a Cloud Devices workspace for sign-in, device inventory and provisioning requests.
- The Android viewer sends taps, swipes, Back/Home/Recent and text input through a user-owned command queue; service-role-only RPCs keep worker credentials out of the browser.

A queued request is only a durable request record. It is **not** an Android device and does not mean an emulator has booted.

## Runtime layout

The intended system has four separate parts:

1. **Web client** — account sign-in, device inventory, provisioning requests and an interactive WebRTC viewer.
2. **Control plane** — authenticates users, validates quotas, claims provisioning requests, schedules workers and issues short-lived sessions.
3. **Android worker** — runs one or more isolated Android Emulator/Cuttlefish instances and reports health to the control plane.
4. **Persistent volume** — one private writable data volume per device, mounted back to the same device after stop/start or worker recovery.

The existing Rust/WebAssembly ARM Lab remains a separate research feature. The existing ADB bridge remains a private bridge to an already-attached phone or emulator. Neither is a cloud Android worker.

## Persistent storage contract

Every provisioned device must have a stable device ID and a separate persistent-volume reference. The Android data directory must survive a session disconnect, browser logout and normal worker restart. Runtime process memory and ephemeral container files are not a persistence layer.

The public cloud_devices table contains storage state and reported size only. Actual volume paths, runtime handles, worker addresses and streaming credentials belong in the private schema or a trusted worker service. Never return those fields to browser clients.

The first host implementation should use a persistent filesystem volume mounted into the worker container. Object storage can hold snapshots and backups, but it should not be presented as a low-latency block device unless a proper block-volume layer is implemented.

## Account isolation

The migration uses auth.uid() ownership policies:

- A user can list and submit only their own provisioning requests.
- A user can cancel only their own queued requests.
- A user can read only devices and session metadata tied to their own account.
- Browser users cannot change device state, assign workers or alter runtime references.
- Users can enqueue only allowlisted input for their own running device with a ready stream; worker claim/finish RPCs are executable only by `service_role`.
- Service-role credentials must stay in trusted server-side services and must never be included in Vite variables or browser bundles.

The UI keeps access tokens in page memory and refreshes them through Supabase Auth. The website uses only a Supabase publishable key, which is designed for public clients; database RLS is the authorization boundary.

## First host strategy

The current repository does not have a persistent Android worker host. The GitHub Actions Play Store emulator is temporary CI, and the ADB bridge controls an existing attached phone/emulator. Do not use either as a public customer session host.

A future worker should:

1. Enroll with a per-worker credential issued by the control plane.
2. Send heartbeats and capability information.
3. Claim one queued request using a short lease to avoid duplicate provisioning.
4. Create an isolated Android runtime and a separate persistent data volume.
5. Boot Android and report verified properties and storage attachment.
6. Expose a short-lived session through an authenticated streaming gateway.
7. On stop, checkpoint state, detach the volume and release worker capacity without deleting customer data.

The worker defaults to Google's official Android 15 (API 35) `google_apis_playstore` Emulator system image. This is a genuine Android system image with the Android framework/userspace plus the Play Store and Google Play services; it is not the browser-based Dalvik HLE experiment. The worker checks the Android build fingerprint, SDK level, Settings package, and (for this target) Play Store and Play services packages before marking a device ready. Operators may explicitly choose `google_apis` or an AOSP image instead, but those targets do not promise the Play Store. Use of Google Play-enabled images for a public hosted service needs a separate review of Google's applicable terms; GRIXDroid does not copy or redistribute Google proprietary packages.

## Configuration

Copy .env.example to .env.local and set:

- VITE_SUPABASE_URL
- VITE_SUPABASE_PUBLISHABLE_KEY

Only the publishable key belongs in the frontend. Never set VITE_SUPABASE_SERVICE_ROLE_KEY.

Apply the migration in supabase/migrations/20261119000000_grixdroid_cloud_devices.sql to a dedicated GRIXDroid Supabase project. Do not reuse a different application's project without intentionally reviewing ownership, billing and existing data.

**Data API exposure:** Supabase changed the default exposure behavior for newly created tables in 2026. If the project does not expose the public schema through its Data API, explicitly enable the public schema in the project's API settings before using this browser REST integration. The migration grants only the required table privileges and still enforces RLS.


## Android worker agent

The repository now includes `server/cloud-worker.mjs`. It is a host-side Android Emulator supervisor, not a container that magically supplies an Android VM on any hosting provider.

The worker:

- Registers a heartbeat and capability record in the private worker registry.
- Claims one queued request at a time using an atomic database function and a renewable 10-minute lease.
- Creates a distinct AVD home directory for each request under `GRIXDROID_DATA_ROOT/devices/<request-id>/avd-home`.
- Boots the selected official Android Emulator system image, waits for `sys.boot_completed`, verifies Android framework/build properties and expected Google Play packages, then records the device and private runtime/volume reference.
- Leaves the AVD data directory in place when stopped and can start the same AVD again.
- Exposes a loopback-only development API for health, device inventory, screenshots, tap/swipe, navigation keys, text entry, start and stop.

The worker API is not the public customer session gateway. Keep it on loopback or a private network. Public users must not receive the service-role key, worker API token, worker IP address, AVD paths or direct ADB access. Browser screen controls use the owner-scoped `cloud_device_actions` table; the worker polls its private command queue through service-role RPCs, and recovers commands left processing after a worker crash.

### Database setup

The dedicated Supabase project is **Grix emulator**. It is active, and all six GRIXDroid migrations below are recorded in its migration history. Keep these files in sync with the database history:

1. `supabase/migrations/20261119175734_grixdroid_cloud_devices.sql`
2. `supabase/migrations/20261119175837_grixdroid_worker_queue.sql`
3. `supabase/migrations/20261119175841_grixdroid_webrtc_streams.sql`
4. `supabase/migrations/20261119192634_grixdroid_device_controls.sql`
5. `supabase/migrations/20261119194619_grixdroid_apk_install_tools.sql`
6. `supabase/migrations/20261119194706_grixdroid_apk_owner_read_policy.sql`

The worker-queue migration adds service-role-only RPCs for heartbeat, atomic provisioning claims, lease renewal, completion/failure and device-state changes. The device-controls migration adds an owner-scoped command queue. The APK-install migration adds a private `grixdroid-apks` bucket (50 MB per APK), per-account folder policies, APK-install commands and a worker claim RPC that returns the owning user ID. The owner-read policy allows a signed-in user to inspect only their own APK objects. Worker RPCs remain service-role-only and are not callable by `anon` or `authenticated`.

Do not apply these migrations to the unrelated Pilgrix Android or GRIX CODE projects. The dedicated GRIXDroid database is already configured. A persistent Android worker and an HTTPS WebRTC gateway still have to be enrolled for public live sessions.

### Worker host setup

The worker host needs Node.js 20+, Android SDK Command-line Tools, Android Emulator, Android Platform Tools, and a downloaded x86_64 system image. Install/accept the Android SDK packages using the SDK Manager on the host. The worker does not download SDK components itself.

Example SDK components:

```bash
sdkmanager --licenses
sdkmanager "platform-tools" "emulator" "system-images;android-35;google_apis_playstore;x86_64"
```

Then configure the private worker:

```bash
cp .env.worker.example .env.worker
```

Set `SUPABASE_URL`, a server-only `SUPABASE_API_KEY` (`sb_secret_...`) and `SUPABASE_SERVICE_ROLE_JWT` (the legacy service_role JWT used for the worker RPC role claim), `GRIXDROID_WORKER_ID` (a stable UUID), `ANDROID_SDK_ROOT`, and `GRIXDROID_DATA_ROOT`. The worker sends the secret API key only through `apikey` and the JWT only through `Authorization: Bearer`. Keep `.env.worker` out of Git and never copy either value into a `VITE_` variable. A legacy-only `SUPABASE_SERVICE_ROLE_KEY` variable remains available as a temporary fallback.

Start it from the repository root:

```bash
npm ci
npm run device-worker
```

The first heartbeat creates/updates the worker record. The worker then begins claiming queued requests. Its API defaults to `127.0.0.1:8788`; when no local API token is configured, it generates one and prints it once at startup.

### No-KVM development mode

On a Linux host without KVM, the Android Emulator can run in software CPU emulation only with an explicit opt-in. Set:

```dotenv
GRIXDROID_ACCEL=off
GRIXDROID_ENABLE_SOFTWARE_EMULATION=1
GRIXDROID_GPU_MODE=software
GRIXDROID_MAX_DEVICES=1
```

This mode is very slow and is for development experiments, not a practical multi-user production host. Hardware-accelerated Android Emulator instances use the host's supported virtualization facility (KVM on Linux, Hypervisor.Framework on macOS, or WHPX on Windows). See the [Android Emulator command-line options](https://developer.android.com/studio/run/emulator-commandline) and [acceleration guide](https://developer.android.com/studio/run/emulator-acceleration).

The default worker image is `system-images;android-35;google_apis_playstore;x86_64`. The worker refuses to start if that exact SDK package is missing, and it refuses to label a boot successful unless Android's system properties and Settings package are present. For a Play Store target it also verifies `com.android.vending` and `com.google.android.gms`. To use a non-Play-Store build, set `GRIXDROID_SYSTEM_IMAGE` to the exact SDK package and install it first. Existing AVDs are checked against their configured image; changing image targets requires a new device rather than silently reusing an incompatible data disk. GRIXDroid does not bundle or redistribute Google Play or Play services.

### Worker API

The local API uses a bearer token:

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/v1/health` | Minimal worker health |
| GET | `/api/v1/devices` | List devices assigned to this worker |
| POST | `/api/v1/devices/:id/start` | Start an existing device without wiping its data |
| POST | `/api/v1/devices/:id/stop` | Stop a device while retaining its AVD directory |
| GET | `/api/v1/devices/:id/screenshot` | Capture the Android display as PNG |
| POST | `/api/v1/devices/:id/actions` | Allowlisted tap, swipe, navigation key or text action |

This API is intended for host-local development and diagnostics. It is not routed through the website's customer authentication. The scrcpy publisher uses a 1600-pixel maximum long edge so the free 720p portrait preset (720×1600) is not reduced to 1280 pixels before encoding. The browser/device stream still needs a real end-to-end gateway test before advertised as a verified 720p stream. The optional MediaMTX WHIP/WHEP publishing path is separate; see [WebRTC streaming setup](WEBRTC_STREAMING.md). Do not expose the worker API directly to the internet. Remote binding requires explicit opt-in, a long API token, a strict origin list and a trusted HTTPS/private-network gateway.

### Persistence and operational limits

The worker stores the AVD home directory and its writable Android data image below `GRIXDROID_DATA_ROOT`. That root must be backed by durable disk (or a persistent host volume if containerized). Do not put it in `/tmp`, a GitHub Actions workspace, or an ephemeral deployment filesystem. The worker does not pass `-wipe-data` when starting a customer AVD. Back up the data root before changing Android Emulator or system-image versions. The Android CI smoke test writes a value to Android's Settings database, stops and restarts the same AVD without wiping it, and checks that the value and Play Store packages remain present.

The worker is currently a single-host development provider. The WHIP/WHEP integration is optional and requires a separately operated MediaMTX gateway, FFmpeg WHIP support, and a version-matched scrcpy server. It does not yet provide NAT/egress isolation, per-user bandwidth quotas, snapshot/restore across different hosts, APK upload endpoint or multi-host rescheduler. A cloud device can be booted only when this process runs on a host with the required Android SDK image and durable storage.

## Honest current boundary

This is the control-plane/data-model foundation, not an Appetize.io replacement yet:

- No persistent Android worker is enrolled.
- No device image is being launched for a customer.
- No MediaMTX gateway or worker host is deployed; the repository contains an optional WHIP/WHEP streaming integration that still needs host configuration.
- No public network egress/IP isolation is provisioned yet.
- No Google Play packages are redistributed by GRIXDroid.

The database and four migrations are already in place. The next deployment milestone is to enroll a persistent Android worker on a durable host, configure the MediaMTX gateway and Vercel frontend variables, then verify real Android boot, touch control, persistent stop/start and end-to-end WebRTC playback.
