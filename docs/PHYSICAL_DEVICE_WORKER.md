# GRIXDroid physical Android worker

This worker connects **one genuine USB-attached Android handset** to the existing GRIXDroid control plane. It reuses the existing heartbeat, provider-aware claim, lease renewal, completion, failure, device-action and stream-state RPCs. It does not create virtual Samsung/OPPO/Xiaomi profiles.

## Supported hardware targets

The current allowlist is:

- Samsung Galaxy S22, S23, S24 and S24 Ultra
- OPPO Find X8 Pro
- Xiaomi 14 Ultra

The handset must run an Android release supported by the GRIXDroid selector (12, 12L, 13, 14, 15 or 16). The worker reads live Android properties over ADB and compares manufacturer, product model, hardware device name, Android release and the **complete build fingerprint** to operator-pinned values. A mismatch withdraws the target from the selector. Android Emulator and network ADB transports are rejected.

## Dedicated lab handset requirements

Use a handset owned and administered for GRIXDroid testing. Do not enroll a personal phone or a handset containing personal data. Before enrollment:

- Remove Google, OEM cloud, email, banking, messaging and other personal accounts.
- Remove extra Android users, guest profiles and work profiles.
- Enable USB debugging and authorize only the trusted worker host.
- Keep the handset connected through USB; Wi-Fi debugging is not accepted.
- Use a separate worker UUID, state directory and local port for every physical handset.

The worker checks for Android accounts on every inspection. It refuses to advertise a handset with accounts or secondary users.

## Read the device identity

On the trusted worker host, with the phone connected and authorized:

```bash
adb devices -l
adb -s YOUR_USB_SERIAL shell getprop ro.product.manufacturer
adb -s YOUR_USB_SERIAL shell getprop ro.product.model
adb -s YOUR_USB_SERIAL shell getprop ro.product.device
adb -s YOUR_USB_SERIAL shell getprop ro.build.version.release
adb -s YOUR_USB_SERIAL shell getprop ro.build.fingerprint
```

Copy the exact outputs into `.env.physical-worker`:

- `GRIXDROID_PHYSICAL_DEVICE_SERIAL`: USB serial shown by `adb devices -l`
- `GRIXDROID_PHYSICAL_DEVICE_MODEL`: one of the stable IDs from the allowlist above
- `GRIXDROID_PHYSICAL_PRODUCT_MODEL`: exact `ro.product.model`
- `GRIXDROID_PHYSICAL_HARDWARE_MODEL`: exact `ro.product.device`
- `GRIXDROID_PHYSICAL_ANDROID_VERSION`: exact `ro.build.version.release`
- `GRIXDROID_PHYSICAL_BUILD_FINGERPRINT`: exact full `ro.build.fingerprint`

Do not invent or shorten the model or fingerprint. These values are kept in the worker's private configuration and worker capability record; the ADB serial itself is not sent to Supabase (only its SHA-256 digest is used as an opaque runtime handle).

## Install and run

Requirements: Node.js 20+, Android Platform Tools, a USB-connected authorized handset, the same scrcpy server JAR version as `SCRCPY_VERSION`, FFmpeg built with the WHIP muxer and its authorization option, and the existing GRIXDroid MediaMTX gateway.

```bash
cp .env.physical-worker.example .env.physical-worker
# Edit the file and set the exact values from the connected handset.
npm ci
```

Review every value before starting. The example deliberately sets:

```dotenv
GRIXDROID_PHYSICAL_ENABLE_RESET=0
```

Only change it to `1` after confirming that the handset is a dedicated, account-free test device. The worker refuses to start without this explicit opt-in.

Start the worker:

```bash
npm run physical-device-worker
```

The first authenticated heartbeat creates or updates its private worker-registry row. The worker has capacity one and advertises only its verified physical target. It never receives more than one device request at a time. Its local health endpoint binds to loopback only.

## Session isolation and cleanup

The control plane leases a physical handset exclusively to one request at a time. On start, the worker records an owner-scoped `cloud_device_sessions` row with a two-minute renewable lease. It renews the lease while the worker is live. The MediaMTX auth callback requires both the signed-in device owner and a current, unexpired session lease before allowing WebRTC playback. A dead worker therefore stops authorizing new playback after the short lease expires.

At session end or idle timeout, the worker:

- Stops scrcpy and FFmpeg publishing and disables the stream.
- Uninstalls third-party apps installed during that session.
- Clears data for the handset's baseline third-party apps.
- Clears app-scoped Android shared files for those packages.
- Clears common shared user folders (Download, Documents, Movies, Pictures, Music and DCIM), clipboard and logcat.
- Marks the session expired and releases the device's worker capacity.

If the phone is unplugged, its target is withdrawn and the current session is marked failed. The worker keeps the recovery state file; it will not reassign the phone until the same pinned handset is reconnected and cleanup succeeds. If cleanup fails, the handset remains unavailable.

**Cleanup is not a factory reset and is not a hardened Android multi-user sandbox.** Some OEM/system apps, app-specific external paths outside the handled locations, settings, OS logs, network state and firmware state may persist. Do not expose this physical worker to untrusted public users or run sensitive personal apps on it. This implementation is for controlled lab/friends testing on a dedicated handset, not a guarantee that arbitrary hostile tenants cannot recover prior data. A production public device farm needs stronger device-owner/managed-profile controls or verified factory-image restore between tenants, plus a separate network egress boundary.

## Multiple physical phones

Run a separate worker process for each real handset. Give each one a unique `GRIXDROID_WORKER_ID`, `GRIXDROID_PHYSICAL_DEVICE_SERIAL`, `GRIXDROID_PHYSICAL_WORKER_PORT` and `GRIXDROID_PHYSICAL_STATE_DIR`. Do not use the ten-Pixel AVD launcher to start OEM devices.

## Security and operational boundaries

- Keep `.env.physical-worker` on the worker host and out of Git.
- The Supabase secret API key and legacy service-role JWT are server-only.
- Never expose ADB, the worker process API, scrcpy, MediaMTX auth callback or stream-publish token directly to browsers.
- The public stream uses HTTPS; the MediaMTX auth callback remains loopback-only.
- Device owners can enqueue only allowlisted inputs for their own running device; the worker executes and acknowledges the owner-scoped action queue.
- A stable database device record does not mean the handset is online. It is selectable only while its physical worker sends fresh verified heartbeats.

The physical device itself is not a persistent AVD volume. User-installed apps and app data are reset between sessions; the handset firmware and operating system remain as supplied by its manufacturer.
