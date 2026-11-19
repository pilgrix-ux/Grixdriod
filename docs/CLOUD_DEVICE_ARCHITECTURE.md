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

## Honest current boundary

This is the control-plane/data-model foundation, not an Appetize.io replacement yet:

- No persistent Android worker is enrolled.
- No device image is being launched for a customer.
- No WebRTC stream is exposed.
- No public network egress/IP isolation is provisioned yet.
- No Google Play packages are redistributed by GRIXDroid.

The next engineering milestone is the worker service and its authenticated job-claim/heartbeat protocol, followed by real Android boot verification and the streaming gateway.
