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

The worker code and optional WHIP/WHEP streaming integration are now in the repository, but no worker host, MediaMTX gateway or dedicated GRIXDroid database has been configured. Until an operator installs the Android SDK and streaming tools, applies all three migrations, and starts the worker on a durable host, provisioning requests remain queued. This is not yet a managed public cloud phone service. See [Cloud device architecture](docs/CLOUD_DEVICE_ARCHITECTURE.md) before configuring a backend.

To configure the workspace, copy `.env.example` to `.env.local`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, and apply all three migrations in `supabase/migrations/` to a dedicated GRIXDroid Supabase project. Never expose a Supabase service-role key to the browser. Supabase projects may require enabling the `public` schema in Data API settings before the website can query these tables.

## Self-hosted Android worker

The cloud worker boots a genuine Android Emulator system image—not the browser-native ARM/Dalvik research runtime—for each queued device request. By default it uses Android 15 (API 35) with Google Play Store and Google Play services. It needs a persistent host with Android SDK Command-line Tools, Emulator, Platform Tools, the exact system image and durable storage. On boot it verifies Android system properties and the expected packages before reporting the device as ready.

```bash
cp .env.worker.example .env.worker
# Edit .env.worker with a dedicated GRIXDroid Supabase URL, server-only service_role key,
# stable worker UUID, Android SDK path and persistent data directory.
npm ci
npm run device-worker
```

Install the image with `sdkmanager --licenses` and `sdkmanager "platform-tools" "emulator" "system-images;android-35;google_apis_playstore;x86_64"` before starting the worker. Google Play-enabled hosted sessions need a separate terms review; GRIXDroid does not redistribute Google packages. Apply all three Supabase migrations in order before starting the worker. For optional WebRTC, configure the matching scrcpy server JAR, an FFmpeg build with the WHIP muxer, the MediaMTX host and the signed-in viewer endpoint; see [WebRTC streaming setup](docs/WEBRTC_STREAMING.md). For a Linux host without KVM, software CPU emulation is an explicit development-only option and is very slow; see [the worker setup guide](docs/CLOUD_DEVICE_ARCHITECTURE.md). The worker API defaults to loopback and is not directly exposed to website visitors.

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
