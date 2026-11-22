# GRIXDroid persistent Linux worker host

This runbook supervises the existing GRIXDroid workers across process crashes and Linux reboots. It does not create or pay for a host. Use a dedicated Linux VM or server with durable storage. Pixel AVD workloads require hardware virtualization (KVM on Linux); do not place AVD data in an ephemeral serverless filesystem or a GitHub Actions workspace.

## Host prerequisites

- Ubuntu/Debian Linux, Node.js 22, npm, Git and Android SDK Command-line Tools.
- Android SDK Platform Tools, Emulator and every enabled Android system image.
- KVM enabled by the host provider and /dev/kvm accessible to the grixdroid service account.
- A persistent disk mounted at /var/lib/grixdroid.
- Outbound HTTPS to the dedicated GRIXDroid Supabase project and MediaMTX host.
- For physical devices: USB passthrough, ADB authorization and udev permissions for a dedicated lab handset.
- For WebRTC: a reachable MediaMTX gateway with HTTPS/WHEP and the required UDP ICE path.

Verify KVM before installing a worker:

```bash
test -c /dev/kvm
ls -l /dev/kvm
id grixdroid
```

If the host provider does not expose KVM, do not expect ten software-emulated AVDs to be usable. Choose a virtualization-capable VM or use the temporary macOS GitHub Actions smoke workflow only for CI verification.

## Install the application and service account

```bash
sudo useradd --system --create-home --home-dir /var/lib/grixdroid/home --shell /usr/sbin/nologin grixdroid
sudo usermod -aG kvm grixdroid
# For a physical USB handset, add the service account to the host's Android USB/plugdev group when present.
getent group plugdev && sudo usermod -aG plugdev grixdroid || true
sudo install -d -o root -g grixdroid -m 0750 /etc/grixdroid

sudo git clone https://github.com/pilgrix-ux/Grixdriod.git /opt/grixdroid
sudo chown -R grixdroid:grixdroid /opt/grixdroid
sudo -u grixdroid npm ci --prefix /opt/grixdroid
```

Install Android SDK components under /opt/android-sdk (or another durable read-only SDK location), accept the relevant Android SDK licenses, and install only the system images you intend to advertise. For example:

```bash
sdkmanager --licenses
sdkmanager "platform-tools" "emulator" "system-images;android-35;google_apis_playstore;x86_64"
```

Google Play-enabled images are subject to Google's terms. GRIXDroid does not redistribute Google proprietary packages.

## Configure and start the Pixel worker

Create the private environment file on the host. Never commit it or copy its secrets into Vite variables.

```bash
sudo install -o root -g grixdroid -m 0640 /opt/grixdroid/.env.worker.example /etc/grixdroid/worker.env
sudoedit /etc/grixdroid/worker.env
```

Set at least:

- Dedicated project SUPABASE_URL, server-only SUPABASE_API_KEY and SUPABASE_SERVICE_ROLE_JWT.
- A newly generated stable worker UUID and descriptive label.
- ANDROID_SDK_ROOT=/opt/android-sdk.
- GRIXDROID_DATA_ROOT=/var/lib/grixdroid.
- Android 15 / Pixel 7 defaults or installed GRIXDROID_SYSTEM_IMAGES and GRIXDROID_DEVICE_MODELS.
- Hardware acceleration GRIXDROID_ACCEL=on or auto.

The first authenticated worker heartbeat creates or updates its private worker registry record. No customer-facing enrollment endpoint is needed. Keep the UUID stable across restarts; never share it with another host.

Install and enable the service:

```bash
sudo install -o root -g root -m 0644 /opt/grixdroid/deploy/systemd/grixdroid-android-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now grixdroid-android-worker
sudo systemctl status grixdroid-android-worker
sudo journalctl -u grixdroid-android-worker -f
```

Confirm the worker's fresh heartbeat and capabilities in the GRIXDroid Cloud Devices selector. A running systemd process alone is not proof that its database heartbeat is current.

## Add a dedicated genuine physical handset (optional)

Only use a dedicated account-free lab handset. Follow [physical device worker setup](PHYSICAL_DEVICE_WORKER.md) to read its exact OEM identity and configure a unique worker ID, USB serial and build fingerprint.

Install the private file:

```bash
sudo install -o root -g grixdroid -m 0640 /opt/grixdroid/.env.physical-worker.example /etc/grixdroid/physical-worker.env
sudoedit /etc/grixdroid/physical-worker.env
```

Do not set GRIXDROID_PHYSICAL_ENABLE_RESET=1 on a personal handset. The worker refuses to start unless reset is explicitly enabled, and reset is destructive. It is controlled test-device cleanup, not a factory restore or a hardened hostile-tenant sandbox.

Install and start the physical-worker unit:

```bash
sudo install -o root -g root -m 0644 /opt/grixdroid/deploy/systemd/grixdroid-physical-device-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now grixdroid-physical-device-worker
sudo journalctl -u grixdroid-physical-device-worker -f
```

Keep the Pixel and physical worker UUIDs distinct. For multiple physical phones, run one service instance/configuration and one USB-attached handset per worker; give each unique state directories and worker IDs. Copy the physical service unit with a distinct service name and environment file for each handset.

## Streaming gateway

Both workers publish to the same configured MediaMTX gateway. Follow [WebRTC streaming setup](WEBRTC_STREAMING.md) to deploy MediaMTX and its loopback auth callback, configure HTTPS/WHEP and ICE/UDP reachability, and set a strong shared stream-publish token in the worker and auth service. Keep the auth callback and worker APIs off the public internet. The browser must never receive service-role or stream-publish credentials.

## Operations

```bash
sudo systemctl restart grixdroid-android-worker
sudo systemctl restart grixdroid-physical-device-worker
sudo systemctl status grixdroid-android-worker grixdroid-physical-device-worker
sudo journalctl -u grixdroid-android-worker --since "30 minutes ago"
sudo journalctl -u grixdroid-physical-device-worker --since "30 minutes ago"
```

Normal Pixel worker restart preserves each AVD directory under /var/lib/grixdroid/devices/ and resumes the same Android data. Do not delete that directory to troubleshoot a session unless you intend to erase that user's device. Back up /var/lib/grixdroid before SDK/system-image upgrades.

The physical worker stops publishing and expires the owner session on shutdown, then resets the dedicated handset. If the phone disconnects or reset fails, the device remains unavailable until the same handset is reconnected and cleanup succeeds.

## What this does not deploy

These files define service supervision only. They do not buy or provision a cloud VM, expose KVM on the hypervisor, attach a physical USB handset, deploy MediaMTX, open firewall/UDP routes, configure DNS/HTTPS, add Supabase secrets or enable Auth leaked-password protection.
