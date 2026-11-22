# Google Developer Device Platform: real OEM device preflight

GRIXDroid already has a strict physical-device worker for USB-connected lab phones. This guide adds an operator-run path to verify real Samsung, OPPO and Xiaomi hardware hosted by Google's Developer Device Platform (DDP). DDP reservations are metered and currently Preview / Pre-GA. This preflight does **not** enrol a customer-facing cloud worker and does not change the GRIXDroid device selector.

## Real devices currently listed with streaming

The published DDP catalogue currently lists these physical phone configurations with the Streaming capability:

| GRIXDroid preflight ID | Real device | Android API | Android CLI target |
| --- | --- | ---: | --- |
| `samsung_galaxy_s22` | Samsung Galaxy S22 | 36 | `r0q/36` |
| `samsung_galaxy_s22_ultra` | Samsung Galaxy S22 Ultra | 36 | `b0q/36` |
| `samsung_galaxy_s23` | Samsung Galaxy S23 | 35 | `dm1q/35` |
| `samsung_galaxy_s23_plus` | Samsung Galaxy S23+ | 34 | `dm2q/34` |
| `samsung_galaxy_s23_ultra` | Samsung Galaxy S23 Ultra | 34 | `dm3q/34` |
| `samsung_galaxy_s24` | Samsung Galaxy S24 | 36 | `e1q/36` |
| `samsung_galaxy_s24_plus` | Samsung Galaxy S24+ | 36 | `e2q/36` |
| `samsung_galaxy_s24_ultra` | Samsung Galaxy S24 Ultra | 36 | `e3q/36` |
| `oppo_a79_5g` | OPPO A79 5G | 34 | `op573dl1/34` |
| `oppo_a38` | OPPO A38 | 34 | `op5759l1/34` |
| `xiaomi_14` | Xiaomi 14 | 35 | `houji/35` |

Availability is project- and time-dependent. Always check `android device remote models` in the billing-enabled project before relying on a listed target. The catalogue does not currently prove that OPPO Find X8 Pro or Xiaomi 14 Ultra is available; those models must remain unavailable until a genuine source lists them.

## Free-first manual testing through Firebase Spark

Before requesting a metered DDP reservation, use Android Device Streaming from Android Studio with a Firebase project on the Spark plan. Firebase currently includes **30 no-cost Android Device Streaming minutes per project per month**. Check the project's remaining quota before each test. The published additional usage rate on a paid Blaze project is $0.15 per minute, so do not switch plans or enable billing without the account owner's approval.

1. Open Android Studio and sign in with an authorised Google developer account.
2. Open **View → Tool Windows → Device Manager → Select Remote Devices**.
3. Filter the Partner Device Labs catalog for Samsung, OPPO or Xiaomi and select a currently available model that supports Streaming.
4. Connect and test briefly. The remote phone is a genuine physical OEM device, not an emulator.
5. End the session with **Return and Erase Device** so the device is wiped and returned to the lab.

The live catalog currently includes Samsung Galaxy S22/S23/S24 variants, OPPO A79 5G/A38 and Xiaomi 14, but the exact model and OS variant must still be confirmed in the project picker at reservation time.

This Spark route is a manual hardware test. It does **not** connect the phone to GRIXDroid's customer device queue, and the 30-minute allowance is shared at project level. Use it to validate the real OEM target before the separate DDP worker/session integration is built.

Official references:
- [Android Device Streaming and Partner Device Labs](https://developer.android.com/studio/run/android-device-streaming)
- [Firebase Test Lab and Android Device Streaming quotas/pricing](https://firebase.google.com/docs/test-lab/usage-quotas-pricing)

## Billing and access boundary

- DDP is a Preview / Pre-GA service and is subject to Google's preview terms.
- Physical-device streaming is metered. The published Preview rate is currently **US$0.15 per device-minute**. A one-hour reservation could therefore cost about US$9 before any applicable tax or other charges. Confirm the current rate in the Google Cloud pricing page first.
- A Google Cloud project with billing enabled and the required DDP APIs/IAM permissions is required. The person responsible for that Google Cloud billing account must approve and configure it.
- Do not add service-account keys, Google OAuth tokens, or cloud credentials to this repository, Supabase, Vercel frontend variables, or a client browser.
- The smoke command refuses to reserve a device unless `GRIXDROID_DDP_CONFIRM_BILLING=yes` is set and the project has no other active device reservations. That flag records an operator's explicit approval; it is not a budget cap. Use a dedicated project and do not run preflights concurrently.
- Remove the reservation after the test. The script attempts `disconnect` and `remove` in a `finally` block, including when identity verification fails. Check the Google Cloud reservation list after any interrupted run.

## Prepare the Google Cloud project

A billing/account owner must:

1. Create or select the GRIXDroid-specific Google Cloud project.
2. Enable Developer Device Platform / Device Streaming APIs as documented in Google's Quickstart.
3. Grant only the documented roles needed for device streaming and quota/project use.
4. Complete `android auth login` under the authorised operator account on the worker host.
5. Verify `android device remote projects` lists the intended project and `android device remote models` shows the target device. Use a dedicated GRIXDroid test project with no other active device reservations, and run only one preflight at a time.

Do not use a personal Google account or a project belonging to another GRIXDroid product. Do not turn on billing merely to try this test without the account owner's approval.

Official references:
- [Developer Device Platform Quickstart](https://docs.cloud.google.com/developer-device-platform/quickstart)
- [Live physical Device Catalog](https://docs.cloud.google.com/developer-device-platform/device-catalog)
- [Device Streaming API overview](https://docs.cloud.google.com/developer-device-platform/reference/device-streaming)
- [Android CLI remote device commands](https://developer.android.com/tools/agents/android-cli/commands/device_remote)
- [Android CLI create reservation](https://developer.android.com/tools/agents/android-cli/commands/device_remote_create)
- [Google Cloud DDP pricing](https://cloud.google.com/developer-device-platform/pricing)

## Run a one-device identity preflight

On a trusted Linux host with Node.js 20+, Android CLI, Android Platform Tools and authenticated DDP access:

```bash
npm ci
android auth login
android device remote projects
android device remote models
```

Choose one model from the allowlist above. Then set:

```bash
export GRIXDROID_DDP_PROJECT_ID="your-approved-google-cloud-project"
export GRIXDROID_DDP_MODEL="samsung_galaxy_s23"
export GRIXDROID_DDP_CONFIRM_BILLING="yes"
# Optional when Android CLI or adb is not on PATH:
# export ANDROID_CLI_PATH=/path/to/android
# export ADB_PATH=/path/to/adb
npm run device:ddp-smoke
```

Use another supported model ID to test OPPO or Xiaomi. The script snapshots existing reservations and ADB devices, reserves one physical model, waits for its newly connected ADB transport, checks manufacturer/API/product/hardware/build fingerprint and QEMU properties, prints the verified identity, and releases the reservation. It does not install an APK or write user data.

If the command fails after reservation creation, inspect `android device remote list --all` and remove any reservation left behind. The script deliberately refuses to remove multiple newly appeared reservations because it cannot safely determine which one belongs to this invocation.

## What this completes—and what it does not

Completed in this repository:
- A known-good list of genuine OEM device targets backed by the live Google catalogue.
- A guarded preflight command that reserves, connects, verifies real ADB identity and releases a physical device.
- Unit tests for model mapping, ADB/reservation parsing, OEM/API verification and virtual-device rejection.

Not yet connected:
- Google DDP reservations are not yet allocated from GRIXDroid user requests.
- The current `server/physical-device-worker.mjs` deliberately accepts trusted USB devices only. Do not pass a DDP network ADB transport into it or weaken its USB security check.
- The customer-facing browser video path still needs a DDP session adapter, a per-user reservation quota/budget, secure ADB transport management and WHEP/streaming integration.
- Pixel AVD hosting still needs a persistent Linux host with KVM, Android SDK images and durable storage. DDP physical devices do not replace that emulator host.
- MediaMTX still needs a reachable HTTPS/WHEP endpoint and working UDP ICE path before GRIXDroid can show a customer live screen.

For direct USB lab phones, continue to use [the existing physical worker runbook](PHYSICAL_DEVICE_WORKER.md). For Pixel AVDs, use [the persistent Linux worker host runbook](PERSISTENT_WORKER_HOST.md).

Do not advertise a device as live until a real worker heartbeat, a verified device identity, an active owner-scoped session and a ready stream are all present.
