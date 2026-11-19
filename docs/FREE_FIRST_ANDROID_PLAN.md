# GRIXDroid: free-first Android development plan

## Cost constraint

The project must not depend on the owner renting a KVM server to continue development.

The repository is public. GitHub documents that standard GitHub-hosted runners are free and unlimited for public repositories. We use a standard macOS runner for Android Emulator smoke tests because the Android Emulator uses Apple's Hypervisor.framework on macOS. This avoids requiring a customer-owned or rented Linux KVM host for the development test loop.

References:
- https://docs.github.com/en/actions/concepts/billing-and-usage
- https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- https://developer.android.com/studio/run/emulator-acceleration

## What the free runner does

The workflow at `.github/workflows/android-emulator-smoke.yml`:

1. Starts a temporary Android 15 (API 35) virtual device using the official `google_apis_playstore` system-image target on a GitHub-hosted macOS Intel runner.
2. Waits for Android to finish booting.
3. Verifies that Android Settings, Google Play Store (`com.android.vending`), and Google Play services (`com.google.android.gms`) are installed.
4. Launches the Play Store app through ADB without adding any personal Google account to the CI runner.
5. Saves a screenshot and activity dump as a short-lived workflow artifact.
6. Shuts down the runner and emulator when the job finishes.

Run it from GitHub:
**Actions → Android Emulator Smoke (Free macOS) → Run workflow**.

The first run is also triggered when this workflow file is added or changed on `main`.

## Google Play boundary

The workflow requests Google's official `google_apis_playstore` emulator image. Android's documentation says Play Store-enabled device profiles include both the Google Play Store app and access to Google Play services. The workflow verifies those packages and opens the Store UI.

The CI device is disposable and is not signed in to a Google account. Downloading apps from the Store requires the user to sign in and may depend on account, device, regional, and app-compatibility checks. Never put a personal Google password or account credentials into workflow files, logs, or repository secrets for this smoke test.

This does not copy Google Play into GRIXDroid, and the project must not redistribute Google's proprietary Play Store or Play services packages. A future public cloud-device offering with Google Play needs a separately reviewed, properly authorized distribution/hosting approach; the CI image is a development test image, not permission to bundle GMS in our own server images.

References:
- https://developer.android.com/studio/run/managing-avds
- https://developer.android.com/studio/run/emulator

## Important boundary

This is a real Android Emulator used for development and automated testing. It is **not** a persistent cloud phone and does not provide a public, always-on WebRTC session. GitHub Actions jobs are temporary CI jobs, not a hosting service for visitor sessions. Do not keep a job alive as a substitute for a production server.

Cuttlefish remains a possible production device provider, but it requires a Linux host with KVM. We are not making it a prerequisite for the free development phase.

## Free-first product architecture

Keep the existing browser-native Rust/WebAssembly ARM Lab as a separate experimental feature. Do not label its Dalvik HLE runner as general APK compatibility.

Develop the real Android path in increments:

### Milestone A — Android boot verification

- [x] Add an automated real-Android boot smoke workflow.
- [ ] Run the workflow and confirm the Android boot artifact is produced.
- [ ] Add an Android test APK and verify install, launch, and uninstall with ADB.

### Milestone B — device-provider boundary

Define a provider interface before coupling the UI to a specific VM host. It should cover:
- Create and stop a device session.
- Report session state and device capabilities.
- Upload and install an APK.
- Launch an installed package.
- Return a time-limited screen/input connection.
- Collect logs and screenshots.

The first provider used in CI can be the temporary GitHub Actions emulator for tests only. A CI provider must never be exposed as if it were an always-on user session.

### Milestone C — user-facing streaming prototype

Build the browser device shell and streaming/input integration against a controlled test environment. Keep streaming transport and device lifecycle behind the provider interface.

A visitor-facing service requires a reliable, persistent host with virtualization, storage, bandwidth, monitoring, and isolation. A free CI runner cannot supply that service. Do not launch multi-user cloud sessions until a sustainable host is available.

### Milestone D — operational hardening

Before opening public sessions, implement per-user authorization, isolation, quotas, session timeouts, upload limits, safe file handling, observability, and reliable cleanup.

## Cost policy

- No paid KVM host is required for the current development and CI stage.
- Do not add paid APIs, paid emulator services, or secret-dependent deployment steps without an explicit decision.
- Keep the public browser demo honest about the difference between the experimental ARM Lab and a real Android virtual device.
