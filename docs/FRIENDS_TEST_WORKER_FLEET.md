# GRIXDroid friends-test worker fleet

## Requested test target

The friends-testing target is **10 real, heartbeat-connected workers**. This is a target, not a count that can be created by inserting database rows. The private worker registry is populated by the worker heartbeat RPC; a worker is active only while its process is running, authenticated, and renewing its heartbeat.

## What is already implemented

- A worker registers itself through `grixdroid_worker_heartbeat`.
- Each worker reports its own ID, label, capacity, and capabilities.
- The queue assigns a request only to a worker with available capacity.
- Worker leases expire and are re-queued when a worker disappears.
- Worker runtime data is stored beneath its configured data root.

## What is required to make ten workers active

1. Provide Android-capable compute for the test fleet. Each worker must have the Android SDK, emulator, required system image, hardware acceleration where available, persistent writable storage, and enough RAM/CPU for its declared device capacity.
2. Run ten worker instances with ten distinct `GRIXDROID_WORKER_ID` values and unique labels. Do not clone one worker ID across processes.
3. Give each instance a private `GRIXDROID_WORKER_API_TOKEN`, Supabase URL, API key and service-role JWT through its secret manager. Never commit credentials to this repository or put them in browser code.
4. Give each instance an isolated data root (or an explicitly isolated per-worker subdirectory) so AVD files and device volumes cannot collide.
5. Confirm each instance is sending heartbeats and appears as ready in the private worker registry before inviting friends.
6. Verify owner isolation, request scheduling, device stop/start, cleanup and worker-loss recovery with test accounts before sharing sessions.

## Why GitHub Actions is not the worker fleet

The Android emulator workflow in this repository is a short-lived CI test. Its runner is shut down after the job and cannot provide persistent browser sessions or a stable public streaming endpoint. Keeping ten Actions jobs open would not create ten durable GRIXDroid workers and is not an acceptable substitute for hosting.

## Current limit

The worker process currently clamps each worker's declared device capacity to four devices. This is a per-worker device limit, **not** a count of worker instances. Ten worker instances would therefore be a separate fleet of ten authenticated processes; it does not mean one machine can safely run ten Android emulators. Start with one device per worker and raise capacity only after measuring host RAM, CPU, storage I/O and stream bandwidth.

## Test-only access

Use dedicated test accounts and test APKs. Do not invite friends until all ten real worker heartbeats, browser streaming, account isolation and cleanup have been verified. A queued device request is not evidence that a device is running.
