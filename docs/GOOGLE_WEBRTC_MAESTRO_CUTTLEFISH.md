# GRIXDroid: Google WebRTC and Maestro integration plan

## Decision

Use these open-source components for the next integration stage, while keeping the current account-scoped Supabase control plane and Android Emulator worker:

- **Android runtime:** keep the official Android Emulator as the first supported APK runtime. Add Cuttlefish only as a separate provider for AOSP/system-image engineering; it must never be routed through AVD-specific commands.
- **Browser streaming:** prefer Google's `android-emulator-webrtc` client and the matching Emulator Gateway protocol for Android Emulator AVD sessions. The gateway is a separate service: the browser client alone does not stream an emulator. It must authenticate every REST/WebSocket session, terminate sessions on lease expiry, and keep emulator gRPC ports private.
- **Alternative local streaming:** evaluate `serve-emu` for developer-owned devices and local demonstrations. Do not treat it as a production multi-tenant gateway until its auth, isolation, session lifecycle, and deployment behaviour have been audited.
- **UI automation:** use the open-source Maestro CLI for deterministic YAML journeys. Keep ADB for device provisioning, APK installation, package inspection and diagnostics; Maestro replaces Appium for the primary user-journey test layer, not ADB.
- **Physical OEM devices:** retain the existing verified physical-device worker for genuine Samsung/OPPO/Xiaomi firmware. AVD and Cuttlefish profiles must not be presented as exact OEM firmware.

## What is connected now

- Existing Vite + TypeScript workspace and Supabase account/device/session control plane remain in place.
- Existing Android Emulator worker, ADB actions and APK upload/install path remain in place.
- Existing GitHub Actions macOS Android Emulator smoke job remains the no-cost ephemeral Android runtime test.
- This change adds a Maestro smoke flow to that real emulator CI job so the CI device is exercised through an accessibility-driven UI journey.

## What is not connected yet

The following require implementation and deployment; adding a package or a workflow does not make these services live:

1. **Google Emulator Gateway:** deploy a gateway beside the Android Emulator worker, bridge the browser's REST/WebSocket JSEP signalling to the emulator's native gRPC service, and route WebRTC media/data channels. The official browser package is a client/protocol, not a hosted gateway.
2. **Session security:** bind each gateway connection to the existing Supabase owner and renewable session lease; enforce origin checks, short-lived tokens, rate limits and teardown. Never expose emulator gRPC, ADB or worker ports publicly.
3. **Frontend adapter:** integrate the official `Emulator` component only for AVD sessions and preserve the existing workspace UI and device action model. Keep a fallback state when no healthy gateway is registered.
4. **Cuttlefish provider:** add a provider-neutral runtime interface and a separate `launch_cvd` adapter with KVM checks, instance allocation, durable per-device data, ADB discovery, health, cleanup and tests. Do not claim availability until a real KVM worker registers.
5. **Maestro execution service:** run Maestro on an enrolled worker or ephemeral CI runner against the session's authorized ADB target. Store flow results, screenshots and logs as owner-scoped artifacts. Do not accept arbitrary shell commands or user-supplied YAML without validation and isolation.

## Free-first execution

- GitHub Actions can run short-lived Android Emulator + Maestro checks. It cannot provide persistent public device sessions or a guaranteed KVM host.
- Maestro CLI is open source and can run locally or in CI; Maestro Cloud is a separate hosted product and is not required here.
- Google's Android Emulator WebRTC client is open source, but a public gateway still needs compute, networking and secure operations.
- Cuttlefish requires a Linux host with KVM. Do not silently fall back to a fake device or advertise it as available when KVM is absent.
- The existing GitHub-hosted macOS workflow uses Apple's hypervisor and remains the no-cost CI route; it is not a customer device pool.

## CI smoke test

The `.maestro/emulator-smoke.yaml` flow launches Android Settings and asserts that its main screen is visible. The workflow runs it against the temporary Android Emulator after the existing boot and Play Services checks. This proves Maestro can communicate with the CI emulator; it does not yet test a customer-uploaded APK or a deployed cloud session.

## Acceptance criteria for production

- [ ] Google Emulator Gateway is deployed beside an enrolled Android Emulator worker.
- [ ] Browser WebRTC video, audio and touch/keyboard input work through an authenticated, owner-scoped session.
- [ ] Session expiry closes the gateway connection and revokes media access.
- [ ] Maestro runs against the exact allocated device and APK, with screenshots, logs and a downloadable report.
- [ ] Cuttlefish is registered only when a healthy KVM-enabled Cuttlefish worker advertises capacity.
- [ ] Samsung/OPPO/Xiaomi labels are backed by physical-device property verification, never emulator branding.
- [ ] No paid provider or paid hosted testing service is silently enabled.

## Upstream projects

- Google Emulator WebRTC client: https://github.com/google/android-emulator-webrtc
- Google Emulator WebRTC gateway protocol: https://github.com/google/android-emulator-webrtc/blob/master/docs/protocol.md
- Google Android Emulator container/gateway example: https://github.com/google/android-emulator-container-scripts
- Maestro: https://github.com/mobile-dev-inc/Maestro
- Cuttlefish: https://source.android.com/docs/devices/cuttlefish
- Existing GRIXDroid runtime foundation: [ANDROID_RUNTIME_FOUNDATION.md](ANDROID_RUNTIME_FOUNDATION.md)
