# GRIXDroid

**A browser-based Android device control workspace with a private ADB bridge and an experimental Rust/WebAssembly ARM lab.**

GRIXDroid can control a real Android phone or an already-running Android Emulator through its ADB bridge: screen mirroring, touch/navigation input, APK installation, app launching and logcat. Its separate Rust/WebAssembly ARM Lab includes a constrained Dalvik HLE experiment; that experiment is not a complete Android operating system or general APK emulator. GRIXDroid does not currently provide always-on public cloud devices.

## Current capabilities

- ARMv7-era CPU core with ARM and Thumb execution
- CP15 and a subset of short-descriptor memory management
- Emulated memory and peripheral paths, including UART, timers, interrupts, and framebuffer/VRAM
- Browser canvas rendering, touch and keyboard input
- CPU state, register, and instruction debugging
- ROM and custom hexadecimal program loading
- Experimental Linux kernel boot plumbing
- APK and DEX parsing with a small Dalvik HLE interpreter for limited workloads

## Important limitations

GRIXDroid is **not a complete Android operating system** and is not a general-purpose APK emulator. It does not provide full Android userspace, ART, zygote, Binder compatibility, SurfaceFlinger, multidex support, or general JNI/native-library execution. Most ordinary Play Store APKs will not run in the browser-native experimental HLE runtime. A separate temporary CI workflow now boots the official Google Play-enabled Android Emulator image and checks that Play Store and Google Play services are present; that CI device is not yet connected to the public website.

The APK runner supports only a narrow subset of DEX instructions and framework calls. Treat this as a systems research prototype, not a replacement for the Android Emulator or a real Android device.

## Cloud device manager foundation

The Cloud Devices workspace and self-hosted Android worker agent now provide the first account-scoped control-plane and host-side runtime foundation:

- Supabase Auth sign-up/sign-in for an individual account.
- Per-account provisioning request history.
- Owner-scoped cloud device and session inventory.
- A database migration with Row Level Security and private worker/runtime metadata.
- Persistent-volume metadata kept separate from browser-visible device records.
- A worker agent that claims queued requests, boots individual Android Emulator AVDs, preserves their writable data directories, and exposes a loopback-only diagnostic API.

The worker code and optional WHIP/WHEP streaming integration are in the repository. The connected GRIXDroid database has the account-scoped schema, including Android version/model selection, but **no persistent Android worker is currently registered**. Until an operator installs the Android SDK images, starts a worker on a durable host and configures streaming, provisioning requests cannot become live Android devices. This is not yet a managed public cloud phone service. See [Cloud device architecture](docs/CLOUD_DEVICE_ARCHITECTURE.md) before configuring a worker.

To configure the workspace, copy `.env.example` to `.env.local`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, and apply the ordered migrations in `supabase/migrations/` to the dedicated GRIXDroid Supabase project. Both `VITE_` values are public and are compiled into the browser bundle: use only the project URL and the `sb_publishable_...` key. Keep every `sb_secret_...` key and legacy `service_role` JWT in server-only worker environment variables. Enable and review Row Level Security for all exposed tables. The worker sends the `sb_secret_...` key in the `apikey` header and the legacy `service_role` JWT separately in the `Authorization` header. Supabase projects may require enabling the `public` schema in Data API settings before the website can query these tables.

## Google sign-in

The workspace supports Google sign-in through Supabase Auth using the PKCE authorization-code flow. Configure the Google OAuth web client in Supabase and add the app origin to Supabase Auth's redirect allow-list before using the button. Keep the Google client secret only in the Supabase provider settings. See [Google Auth setup](docs/GOOGLE_AUTH_SETUP.md).

## Self-hosted Android worker

The cloud worker boots a genuine Android Emulator system image—not the browser-native ARM/Dalvik research runtime—for each queued device request. By default it uses Android 15 (API 35) with Google Play Store, Google Play services and a Pixel 7 virtual device. Device Sandbox can offer Android 12, 12L, 13, 14, 15 and 16 plus Pixel 6–9 / Pro models, but only when the selected system image and AVD model are installed on a recently connected worker. It needs a persistent host with Android SDK Command-line Tools, Emulator, Platform Tools, the selected system images and durable storage. On boot it verifies Android system properties and the expected packages before reporting the device as ready.

```bash
cp .env.worker.example .env.worker
# Edit .env.worker with the dedicated GRIXDroid Supabase URL, a server-only sb_secret API key,
# a legacy service_role JWT for the worker role claim, stable worker UUID, Android SDK path
# and persistent data directory.
npm ci
npm run device-worker
```

Install the default image with `sdkmanager --licenses` and `sdkmanager "platform-tools" "emulator" "system-images;android-35;google_apis_playstore;x86_64"` before starting the worker. For multiple Android releases, install each extra package and set `GRIXDROID_SYSTEM_IMAGES` to the comma-separated system-image package names; set `GRIXDROID_DEVICE_MODELS` to the comma-separated Pixel AVD IDs present in that SDK. The worker advertises only installed choices, and the website never presents uninstalled versions/models as available. Google Play-enabled hosted sessions need a separate terms review; GRIXDroid does not redistribute Google packages. Apply all eight Supabase migrations in order before starting the worker. The Appetize-style live workspace provides a framed Android screen, Show/Hide device controls, developer details, touch/swipe, Home/Power, rotation, dark mode, font sizing, emulator fingerprint input and screenshot capture. APK uploads use the private `grixdroid-apks` bucket (50 MB maximum) and the worker installs the uploaded package with `adb install -r`; APK bytes never go in the database command row. For optional WebRTC, configure the matching scrcpy server JAR, an FFmpeg build with the WHIP muxer, the MediaMTX host and the signed-in viewer endpoint; see [WebRTC streaming setup](docs/WEBRTC_STREAMING.md). For a Linux host without KVM, software CPU emulation is an explicit development-only option and is very slow; see [the worker setup guide](docs/CLOUD_DEVICE_ARCHITECTURE.md). The worker API defaults to loopback and is not directly exposed to website visitors.

## Real Android web integration

The website now includes a **Real Android device** panel. It connects to an Android phone or an already-running Android Emulator through the private ADB bridge in `server/adb-bridge.mjs`.

Start it on a computer with Node.js 20+, Android Platform Tools and an authorized Android device:

```bash
npm install
npm run device-bridge
```

Then use the website panel with `http://127.0.0.1:8787` from that same computer. The panel supports screen mirroring, taps/swipes, navigation keys, APK installation, installed-app launching and logcat. It detects Google Play Store on the attached Android system and offers an Open Google Play Store control when present. See [web device integration setup](docs/WEB_DEVICE_INTEGRATION.md).

This bridge controls an existing phone or emulator; it does not create a persistent cloud phone. The bridge is loopback-only by default. Remote access requires explicit token, HTTPS, origin and network configuration. Never put a shared production bridge token in the public frontend.

## No-cost Android emulator development

GRIXDroid includes an optional real-Android smoke test using a temporary GitHub-hosted macOS runner. macOS uses Apple's Hypervisor.framework, so this development workflow does not require renting a Linux KVM machine.

Run it from **Actions → Android Emulator Smoke (Free macOS) → Run workflow**. It boots an Android API 35 virtual device using Google's `google_apis_playstore` system image, verifies Android Settings, Play Store and Google Play services, launches the Store UI without a personal account, then stops and restarts the same AVD to verify a value in Android's Settings database survives. It saves a short-lived evidence artifact.

This is an automated CI test, **not** an always-on cloud phone or a public streaming service. Standard GitHub-hosted runners are free for public repositories; see [GitHub Actions billing](https://docs.github.com/en/actions/concepts/billing-and-usage). The distinction between the temporary test emulator, private ADB bridge and a future persistent device host is documented in [the free-first Android plan](docs/FREE_FIRST_ANDROID_PLAN.md).

## Android runtime provider strategy

GRIXDroid will use the official Android Emulator as its first cloud-device provider for ordinary APK install, launch and compatibility testing. Cuttlefish is planned as a separate optional provider for AOSP and custom system-image engineering; it is not a drop-in AVD replacement and is not yet implemented or hosted. The browser Rust/WASM ARM Lab remains a separate research feature. See [Android runtime foundation](docs/ANDROID_RUNTIME_FOUNDATION.md) for the provider architecture, Cuttlefish prerequisites, free-first plan and current deployment boundaries.

## Run locally

Requirements: Rust stable, the wasm32-unknown-unknown target, wasm-pack, and Node.js 20 or newer.

```bash
git clone https://github.com/pilgrix-ux/Grixdriod.git
cd Grixdriod
npm ci
npm run dev
```

Open the Vite URL printed in the terminal.

For a production build:

```bash
npm run build
npm run preview
```

Run Rust tests:

```bash
cargo test --locked --lib
```

The production build compiles the Rust crate to WebAssembly, then runs TypeScript checking and Vite.

## Project structure

- src/cpu.rs, src/memory.rs, src/cp15.rs: ARM CPU and memory model
- src/android/: APK/AXML/DEX parsing and constrained Dalvik HLE runtime
- src/lib.rs: WebAssembly exports
- src/main.ts, src/style.css: browser UI and rendering
- server/cloud-worker.mjs: persistent Android Emulator worker agent
- docs/: implementation notes and current support boundaries

## Attribution

GRIXDroid is an adaptation of [NekoDroid](https://github.com/nishal21/NekoDroid), created by Nishal K. The upstream project is distributed under the MIT License. The MIT license and required copyright notice are retained in LICENSE.

GRIXDroid is an independent project and is not affiliated with or endorsed by Google. Android is a trademark of Google LLC.
