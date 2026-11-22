# GRIXDroid friends-test worker fleet

## Target

The requested target is **10 real, heartbeat-connected workers** for invited friends to test. A database row or a process that has not completed its authenticated heartbeat is not an active worker.

## Launcher

The repository now includes `scripts/friends-test-fleet.sh`:

- `start` launches ten worker processes on one sufficiently powerful Android-capable host.
- Each process receives a stable, distinct UUID, label, loopback API port, private data directory and device capacity of one.
- `status` checks local processes; it explicitly does not claim that a Supabase heartbeat is healthy.
- `stop` stops the ten local worker processes.

Before starting:

1. Copy `.env.worker.example` to `.env.worker` and supply the server-only Supabase credentials and stream publishing settings.
2. Install the Android SDK, the configured system image, Emulator and ADB on the host.
3. Enable hardware virtualization (KVM on supported Linux hosts or the platform's equivalent).
4. Ensure the host has enough RAM, CPU, durable disk and network bandwidth for ten simultaneous Android instances.
5. Run `bash scripts/friends-test-fleet.sh start`, then inspect each worker log and confirm ten current heartbeats in the private worker registry.
6. Verify the browser streaming gateway, account isolation and device cleanup before sharing access.

The launcher does not install an Android SDK, create a host, configure a streaming gateway or invent worker heartbeats. It cannot make workers active from GitHub alone.

## Capacity and safety

Each process is configured for one Android device. Ten workers therefore mean ten independently running Android worker processes, not ten devices on a free CI runner. The worker's own maximum device capacity remains separately capped at four per process.

GitHub Actions runs temporary tests and shuts down after each job. It cannot host persistent sessions for friends. Do not leave CI jobs running as a substitute for a worker fleet.

Use dedicated test accounts and test APKs. Do not invite friends until all ten worker heartbeats, actual browser streams, owner isolation and cleanup have been verified.
