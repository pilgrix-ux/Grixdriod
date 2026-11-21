# Android runtime foundation for GRIXDroid

## Decision

Use the official Android Emulator as the first supported cloud-device runtime. Keep the browser-based Rust/WebAssembly ARM/Dalvik lab as a separate research tool. Treat Cuttlefish as a later, optional provider for Android platform/system-image engineering.

This is an incremental integration plan, not a claim that Cuttlefish or a public cloud fleet is already deployed.

## Why this order

| Runtime | Best use | GRIXDroid status |
|---|---|---|
| Official Android Emulator | Install, launch and test ordinary Android apps with ADB | Existing worker implementation; first supported provider |
| Cuttlefish | Test AOSP builds, framework changes and custom system images | Future provider; requires Linux/KVM host and separate lifecycle adapter |
| Physical Android device via ADB | Validate behaviour on real hardware | Existing private ADB bridge |
| Rust/WASM ARM Lab | CPU, memory and constrained Dalvik research | Existing experimental feature; not general APK compatibility |

Cuttlefish is not a drop-in replacement for the current Emulator worker. It has its own host tools and lifecycle, including launch_cvd, instance management and ADB connection discovery. Do not route Cuttlefish requests through AVD-specific commands.

## Target architecture

Keep the browser-facing API and account-scoped control plane provider-neutral:

1. **Web workspace** — create device, choose runtime/profile, show status and stream.
2. **Control plane** — authenticate the owner, enforce quotas, queue work and issue short-lived sessions.
3. **Runtime provider** — an isolated worker adapter responsible for create, boot, health, actions, screenshot/stream, stop and delete.
4. **Persistent storage** — private per-device writable data, retained across normal stop/start.
5. **Streaming gateway** — authenticated browser playback; never expose worker APIs, ADB ports, service-role credentials or host paths to browsers.

The first provider remains the current Android Emulator worker. Add a provider identifier to provisioning metadata only as part of a reviewed database migration; do not silently reinterpret existing device rows.

## Provider contract to implement

A future refactor should isolate runtime-specific commands behind a small contract:

- validateHost(config) — verify required host tools, virtualization and images.
- createDevice(request, storage) — create a runtime instance without sharing another user's writable data.
- startDevice(device) / stopDevice(device) — manage lifecycle without wiping persistent data.
- waitUntilReady(device) — verify Android boot and report truthful capabilities.
- runAdb(device, args) — execute allowlisted ADB operations against the correct instance.
- getDisplay(device) — provide screenshot or streaming input for the viewer.
- deleteDevice(device) — remove only the selected device's runtime and storage after an explicit deletion request.

The web/control-plane contract should not depend on avdmanager, emulator, launch_cvd, or provider-specific serial formats.

## Cuttlefish enablement checklist

Before advertising Cuttlefish as available:

- Provide a dedicated Linux worker with KVM and the host capabilities required by the selected Cuttlefish build.
- Install and pin compatible Cuttlefish host tools and matching AOSP/Cuttlefish images.
- Build an adapter for Cuttlefish launch, instance allocation, console/ADB discovery, stop and cleanup.
- Give every device an isolated instance number, private runtime directory and durable writable data.
- Verify boot completion and expose actual Android build properties; do not fabricate a device model or claim hardware-backed identity.
- Connect its display to the existing authenticated streaming gateway.
- Add provider-specific health checks, quota accounting, crash recovery and integration tests.
- Keep Google Play/GMS out of images unless distribution and hosting rights have been independently established. AOSP/Cuttlefish images do not automatically include licensed Google Play components.

## Free-first development

Use the existing GitHub Actions Android Emulator smoke workflow for short-lived CI verification. It is a test job, not a persistent customer device host. Do not keep CI jobs running to simulate unlimited free sessions.

A persistent worker requires a host with suitable virtualization, CPU/RAM, durable storage and network capacity. The software can be open source while hosting still has operating costs. Start with one worker and one concurrent device; measure boot time, memory, CPU, storage growth and session stability before increasing quotas.

## Security and integrity boundaries

- Keep Supabase secret/service-role credentials and worker tokens server-side.
- Keep worker and ADB endpoints private; route user actions through owner-scoped control-plane authorization.
- Enforce per-account concurrency, session lifetime, storage and bandwidth limits.
- Do not implement fingerprint spoofing or attempts to evade Google Play Integrity, device certification or app security checks.
- For tests that require genuine physical-device assurance, use an actual certified physical device under the appropriate test setup.

## Current implementation truth

The repository already contains:
- An Android Emulator worker using Android SDK AVDs.
- Account-scoped provisioning and device/action tables.
- Persistent AVD directories on the worker host.
- APK upload/install and browser device controls.
- A private ADB bridge for attached physical devices or existing emulators.
- A temporary Android Emulator CI smoke workflow.

The repository does **not** yet contain:
- A Cuttlefish runtime adapter.
- An enrolled durable production worker host.
- A configured public streaming gateway and production customer session service.

Keep the UI honest: show a runtime as available only when a healthy worker advertises that provider and the required image/toolchain is installed.
