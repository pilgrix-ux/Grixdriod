# GRIXDroid cloud-device foundation

## What this milestone adds

This milestone introduces the first account-scoped control-plane layer:

- Supabase Auth is used for customer identity.
- Each provisioning request is owned by the authenticated user.
- Device inventory and session metadata are readable only by the device owner.
- Device lifecycle writes are reserved for trusted server-side services.
- Worker records, runtime handles and persistent-volume references live in a private database schema.
- The website has a Cloud Devices workspace for sign-in, device inventory and provisioning requests.

A queued request is only a durable request record. It is **not** an Android device and does not mean an emulator has booted.

## Runtime layout

The intended system has four separate parts:

1. **Web client** — account sign-in, device list, lifecycle controls and a WebRTC viewer.
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

The initial worker target should be an AOSP Android image without bundled Google proprietary applications. Play Store-enabled images require a separately reviewed and authorized distribution/hosting approach; the existing CI smoke test does not grant rights to redistribute Google Play or Google Play services.

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
- Boots the selected Android system image, waits for `sys.boot_completed`, then records the device and private runtime/volume reference.
- Leaves the AVD data directory in place when stopped and can start the same AVD again.
- Exposes a loopback-only development API for health, device inventory, screenshots, tap/swipe, navigation keys, text entry, start and stop.

The worker API is not the public customer session gateway. Keep it on loopback or a private network. Public users must not receive the service-role key, worker API token, worker IP address, AVD paths or direct ADB access.

### Database setup

Apply both migrations, in this order, to a **dedicated GRIXDroid Supabase project**:

1. `supabase/migrations/20261119000000_grixdroid_cloud_devices.sql`
2. `supabase/migrations/20261119010000_grixdroid_worker_queue.sql`

The second migration adds service-role-only RPCs for worker heartbeat, atomic queue claiming, lease renewal, request completion/failure and device-state changes. The functions check the service-role JWT and have execute permission revoked from `public`, `anon` and `authenticated`.

Do not apply these migrations to the unrelated Pilgrix Android or GRIX CODE projects. A dedicated GRIXDroid database has not yet been selected or configured.

### Worker host setup

The worker host needs Node.js 20+, Android SDK Command-line Tools, Android Emulator, Android Platform Tools, and a downloaded x86_64 system image. Install/accept the Android SDK packages using the SDK Manager on the host. The worker does not download SDK components itself.

Example SDK components:

```bash
sdkmanager --licenses
sdkmanager "platform-tools" "emulator" "system-images;android-35;google_apis;x86_64"
```

Then configure the private worker:

```bash
cp .env.worker.example .env.worker
```

Set `SUPABASE_URL`, the server-only legacy `SUPABASE_SERVICE_ROLE_KEY`, `GRIXDROID_WORKER_ID` (a stable UUID), `ANDROID_SDK_ROOT`, and `GRIXDROID_DATA_ROOT`. Keep `.env.worker` out of Git and never copy the service-role key into a `VITE_` variable.

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

The default system image is `google_apis`, not a Play Store image. A worker can be configured with an official Play Store-enabled image only after the operator installs it through the Android SDK and has reviewed the applicable Google terms. GRIXDroid does not bundle or redistribute Google Play or Play services.

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

This API is intended for host-local development and diagnostics. It is not yet routed through the website's customer authentication, and it does not provide a public WebRTC stream. Do not expose it directly to the internet. Remote binding requires explicit opt-in, a long API token, a strict origin list and a trusted HTTPS/private-network gateway.

### Persistence and operational limits

The worker stores the AVD home directory and its writable Android data image below `GRIXDROID_DATA_ROOT`. That root must be backed by durable disk (or a persistent host volume if containerized). Do not put it in `/tmp`, a GitHub Actions workspace, or an ephemeral deployment filesystem. Do not run `-wipe-data` against a customer AVD. Back up the data root before changing Android Emulator or system-image versions.

The worker is currently a single-host development provider. It has no customer WebRTC gateway, NAT/egress isolation, per-user bandwidth quotas, snapshot/restore across different hosts, APK upload endpoint or multi-host rescheduler. A cloud device can be booted only when this process runs on a host with the required Android SDK image and durable storage.

## Honest current boundary

This is the control-plane/data-model foundation, not an Appetize.io replacement yet:

- No persistent Android worker is enrolled.
- No device image is being launched for a customer.
- No WebRTC stream is exposed.
- No public network egress/IP isolation is provisioned yet.
- No Google Play packages are redistributed by GRIXDroid.

The next engineering milestone is the worker service and its authenticated job-claim/heartbeat protocol, followed by real Android boot verification and the streaming gateway.
