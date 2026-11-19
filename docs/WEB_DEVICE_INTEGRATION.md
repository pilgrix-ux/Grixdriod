# GRIXDroid web device integration

## What this adds

The website includes a Real Android Device panel backed by a private ADB bridge. It connects to a real Android device on a bridge host:

- A physical Android phone connected by USB with USB debugging enabled and authorized.
- An Android Emulator already running on the bridge host.

The connected device remains the actual Android system. If it has Google Play installed, the panel detects that package, reports Play Store availability and provides an Open Google Play Store action. Users can sign in on their own device. GRIXDroid does not copy, bundle, or redistribute Google's proprietary Play Store or Google Play services packages.

Website capabilities:
- Device discovery and short-lived bridge sessions.
- Screen mirroring using ADB screenshots (approximately one frame per second in this first version).
- Tap and swipe input from the browser.
- Back, Home and Recent Apps controls.
- APK upload and installation through adb install.
- Listing and launching installed third-party apps.
- Opening the installed Google Play Store when present.
- Limited text input.
- Recent Android logcat viewing.
- 30-minute idle session cleanup.

## Run the private bridge

Requirements on the bridge host:
- Node.js 20 or newer.
- Android SDK Platform Tools (adb) on PATH.
- A USB-authorized Android phone or an already-running Android Emulator.
- USB debugging enabled on the phone, with the host authorization prompt accepted.

From the repository root:

```bash
npm install
npm run device-bridge
```

The bridge listens on http://127.0.0.1:8787. Open the GRIXDroid website on the same computer and set Bridge API address to that URL. On a different device, loopback points to that different device; it will not reach the bridge computer.

Check the bridge directly at http://127.0.0.1:8787/api/v1/health and list connected devices at http://127.0.0.1:8787/api/v1/devices.

## Remote/private hosting

The bridge defaults to loopback only. Do not expose ADB controls to the public internet without authentication and network protection.

For a private HTTPS reverse-proxy or tunnel setup, configure these environment variables before binding to a non-loopback interface:

```bash
HOST=0.0.0.0
PORT=8787
GRIXDROID_ALLOW_REMOTE=1
GRIXDROID_API_TOKEN=<at-least-24-random-characters>
GRIXDROID_CORS_ORIGINS=https://your-grixdroid-site.example
```

Use the actual website origin in GRIXDROID_CORS_ORIGINS, terminate TLS at a trusted reverse proxy, and restrict network access to trusted users. The bridge token is a bearer credential: do not place a shared production token in public website source code or share it among public users. A public service needs an authenticated server-side session gateway and an isolated Android worker for each user.

The bridge exposes an allowlist of device actions, not arbitrary shell commands. APK uploads are limited to 100 MB, upload files are deleted after installation, and sessions expire after 30 minutes of inactivity.

## API contract

All routes are under /api/v1:

| Method | Route | Purpose |
|---|---|---|
| GET | /health | Bridge and ADB health |
| GET | /devices | Enumerate authorized devices, Play Store and Play services status |
| POST | /sessions | Create a session for a connected device |
| GET | /sessions/:id/screenshot | Fetch a PNG screen image |
| POST | /sessions/:id/actions | Send tap, swipe, key or text input |
| PUT | /sessions/:id/apk | Install a raw APK request body |
| GET | /sessions/:id/packages | List third-party packages |
| POST | /sessions/:id/launch | Launch an installed package |
| GET | /sessions/:id/logs | Read recent logcat output |
| DELETE | /sessions/:id | Close the bridge session |

Remote calls require Authorization: Bearer <token>. Cross-origin access is limited to the explicit allowlist.

## Important limits

This is a working private ADB bridge, not an Appetize-scale public cloud. It does not create virtual devices, provide multi-tenant isolation, or keep a phone alive in the cloud. The bridge host must have a real Android device or emulator attached and remain online. Screen mirroring polls PNG screenshots, so it is lower-frame-rate than WebRTC and is intended as the first integration milestone.

GitHub Actions remains useful for temporary Android CI testing, but its runner is discarded at the end of each job. It is not a persistent user-session host. A public cloud-device product still needs a persistent worker host, authenticated per-user session orchestration, high-frame-rate streaming, isolation, quotas and a properly reviewed approach to Play Store-enabled devices.
