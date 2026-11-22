#!/usr/bin/env node
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const WORKER_ID = '33333333-3333-4333-8333-333333333333';
const API_TOKEN = 'grixdroid-ci-worker-token-keep-local-only-2026';
const SETTING_KEY = 'grixdroid_worker_persistence_probe';
const SETTING_VALUE = 'survives_worker_stop_and_start';

async function run(file, args, options = {}) {
  return execFileAsync(file, args, {
    encoding: options.encoding || 'utf8',
    timeout: options.timeout || 30000,
    maxBuffer: options.maxBuffer || 8 * 1024 * 1024,
    env: options.env || process.env,
  });
}

async function waitFor(check, description, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error('Timed out waiting for ' + description + (lastError ? ': ' + lastError.message : '.'));
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not bind the test control plane.');
  return address.port;
}

async function main() {
  const sdkRoot = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
  const avdHome = process.env.ANDROID_AVD_HOME || path.join(os.homedir(), '.android', 'avd');
  const avdName = process.env.GRIXDROID_SMOKE_AVD_NAME || 'grixdroid-real-android';
  const systemImage = process.env.GRIXDROID_SYSTEM_IMAGE || 'system-images;android-35;google_apis_playstore;x86_64';
  const runnerTemp = process.env.RUNNER_TEMP || os.tmpdir();
  if (!sdkRoot) throw new Error('The Android Emulator smoke job did not provide ANDROID_SDK_ROOT or ANDROID_HOME.');

  const adb = process.env.ADB_PATH || path.join(sdkRoot, 'platform-tools', 'adb');
  const emulator = process.env.EMULATOR_PATH || path.join(sdkRoot, 'emulator', 'emulator');
  const devices = await run(adb, ['devices']);
  const serialMatch = String(devices.stdout).match(/^(emulator-(\d+))\s+device$/m);
  if (!serialMatch) throw new Error('No booted Android Emulator is available for the worker integration test.');
  const serial = serialMatch[1];
  const port = Number(serialMatch[2]);

  const dataRoot = path.join(runnerTemp, 'grixdroid-worker-integration-data');
  const avdConfigPath = path.join(avdHome, avdName + '.avd', 'config.ini');
  const avdConfig = await run(process.execPath, ['-e', "const fs=require('node:fs'); const p=process.argv[1]; const s=fs.readFileSync(p,'utf8'); console.log(s.split(/\\r?\\n/).filter(x=>/^\\s*image\\.sysdir\\.1\\s*=/.test(x)).join('\\n') || 'image.sysdir.1 is missing')", avdConfigPath]);
  console.log('[smoke] AVD home:', avdHome);
  console.log('[smoke] AVD config:', avdConfigPath);
  console.log('[smoke] AVD image:', String(avdConfig.stdout).trim());
  console.log('[smoke] Worker image:', systemImage);
  const deviceDir = path.join(dataRoot, 'devices', REQUEST_ID);
  await mkdir(deviceDir, { recursive: true });
  await writeFile(path.join(deviceDir, 'device.json'), JSON.stringify({
    cloudDeviceId: DEVICE_ID,
    requestId: REQUEST_ID,
    name: 'GRIXDroid CI Android',
    profile: 'compact',
    avdName,
    avdHome,
    deviceDir,
    port,
    serial,
    state: 'running',
    androidRelease: null,
    resolution: { width: 0, height: 0 },
  }, null, 2), { mode: 0o600 });

  // A tiny local PostgREST-shaped control plane keeps this integration test independent
  // from any real Supabase project or production credentials.
  let pendingResolutionAction = null;
  let resolutionActionClaimed = false;
  let resolutionActionResult = null;
  const controlPlane = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    let payload = {};
    try {
      if (chunks.length) payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      res.writeHead(400).end('Invalid test RPC JSON.');
      return;
    }

    const route = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    if (req.method !== 'POST' || !route.startsWith('/rest/v1/rpc/')) {
      res.writeHead(404).end();
      return;
    }
    const rpc = route.slice('/rest/v1/rpc/'.length);
    if (rpc === 'grixdroid_claim_device_request') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('[]');
      return;
    }
    if (rpc === 'grixdroid_claim_device_actions') {
      const claimed = pendingResolutionAction && !resolutionActionClaimed ? [pendingResolutionAction] : [];
      if (claimed.length) resolutionActionClaimed = true;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(claimed));
      return;
    }
    if (rpc === 'grixdroid_finish_device_action') {
      if (payload.p_action_id === pendingResolutionAction?.action_id) {
        resolutionActionResult = {
          success: payload.p_success === true,
          failureReason: payload.p_failure_reason || null,
        };
      }
      res.writeHead(204).end();
      return;
    }
    res.writeHead(204).end();
  });
  const controlPort = await listen(controlPlane);

  const apiPort = await (async () => {
    const { createServer: makeServer } = await import('node:net');
    const probe = makeServer();
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', resolve);
    });
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('Could not allocate a worker API port.');
    await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
    return address.port;
  })();

  const workerEnv = {
    ...process.env,
    ANDROID_SDK_ROOT: sdkRoot,
    GRIXDROID_DATA_ROOT: dataRoot,
    GRIXDROID_SYSTEM_IMAGE: systemImage,
    GRIXDROID_WORKER_ID: WORKER_ID,
    GRIXDROID_WORKER_HOST: '127.0.0.1',
    GRIXDROID_WORKER_PORT: String(apiPort),
    GRIXDROID_WORKER_API_TOKEN: API_TOKEN,
    GRIXDROID_MAX_DEVICES: '1',
    GRIXDROID_POLL_MS: '1500',
    GRIXDROID_ACCEL: 'auto',
    GRIXDROID_GPU_MODE: 'swiftshader_indirect',
    GRIXDROID_ENABLE_SOFTWARE_EMULATION: '0',
    SUPABASE_URL: 'http://127.0.0.1:' + controlPort,
    SUPABASE_SERVICE_ROLE_KEY: 'ci-only-fake-service-role-key',
  };

  let worker = null;
  try {
    worker = spawn(process.execPath, [path.resolve('server/cloud-worker.mjs')], {
      cwd: process.cwd(),
      env: workerEnv,
      stdio: 'inherit',
    });

    await waitFor(async () => {
      if (worker.exitCode !== null) throw new Error('The Android worker exited with code ' + worker.exitCode + '.');
      const response = await fetch('http://127.0.0.1:' + apiPort + '/api/v1/health').catch(() => null);
      return response && response.ok ? true : false;
    }, 'the real Android worker API to start');

    const api = async (method, route) => {
      const response = await fetch('http://127.0.0.1:' + apiPort + route, {
        method,
        headers: { Authorization: 'Bearer ' + API_TOKEN, 'Content-Type': 'application/json' },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error('Worker ' + method + ' ' + route + ' failed (' + response.status + '): ' + (body.error || 'unknown error'));
      return body;
    };

    const listBefore = await waitFor(async () => {
      const result = await api('GET', '/api/v1/devices');
      const device = result.devices?.find((item) => item.id === DEVICE_ID && item.state === 'running');
      return device || false;
    }, 'the restored Android device to report running');

    if (Number(listBefore.androidSdk) < 35 || !listBefore.hasPlayStore || !listBefore.hasGooglePlayServices) {
      throw new Error('Worker did not verify the Android 15 Play Store system image: ' + JSON.stringify(listBefore));
    }

    pendingResolutionAction = {
      action_id: '44444444-4444-4444-8444-444444444444',
      device_id: DEVICE_ID,
      user_id: '55555555-5555-4555-8555-555555555555',
      command: { type: 'resolution', preset: '360p' },
    };
    const actionResult = await waitFor(
      async () => resolutionActionResult || false,
      'the worker to apply the queued 360p display preset',
    );
    if (!actionResult.success) {
      throw new Error('Worker rejected the 360p display preset: ' + (actionResult.failureReason || 'unknown error'));
    }
    const resized = await run(adb, ['-s', serial, 'shell', 'wm', 'size']);
    const resizedMatches = [...String(resized.stdout).matchAll(/(\\d+)\\s*x\\s*(\\d+)/g)];
    const activeSize = resizedMatches[resizedMatches.length - 1];
    if (!activeSize || Number(activeSize[1]) !== 360 || Number(activeSize[2]) !== 800) {
      throw new Error('Worker did not apply the 360p Android display preset: ' + String(resized.stdout).trim());
    }
    console.log('[smoke] Worker action queue applied and verified the 360x800 Android display preset.');

    await run(adb, ['-s', serial, 'shell', 'settings', 'put', 'global', SETTING_KEY, SETTING_VALUE]);
    await run(adb, ['-s', serial, 'shell', 'sync']);

    console.log('[smoke] Asking GRIXDroid worker to stop the Android device without wiping it.');
    const stopped = await api('POST', '/api/v1/devices/' + DEVICE_ID + '/stop');
    if (!stopped.dataPreserved) throw new Error('Worker did not confirm that AVD data was preserved.');
    await run(adb, ['-s', serial, 'wait-for-disconnect'], { timeout: 45000 }).catch(() => {});
    await sleep(1500);

    console.log('[smoke] Asking GRIXDroid worker to start the same AVD again.');
    const restarted = await api('POST', '/api/v1/devices/' + DEVICE_ID + '/start');
    if (restarted.device?.state !== 'running') throw new Error('Worker did not return the restarted device to running state.');

    const retainedValue = String((await run(adb, ['-s', serial, 'shell', 'settings', 'get', 'global', SETTING_KEY])).stdout).trim();
    if (retainedValue !== SETTING_VALUE) {
      throw new Error('Android data did not survive the worker stop/start cycle (found: ' + retainedValue + ').');
    }

    const after = (await api('GET', '/api/v1/devices')).devices?.find((item) => item.id === DEVICE_ID);
    if (!after || after.state !== 'running' || !after.hasPlayStore || !after.hasGooglePlayServices) {
      throw new Error('The restarted real Android device failed its runtime verification.');
    }
    if (after.resolution?.width !== 360 || after.resolution?.height !== 800) {
      throw new Error('Worker metadata did not retain the selected 360p display preset after restart: ' + JSON.stringify(after.resolution));
    }
    const restoredSize = await run(adb, ['-s', serial, 'shell', 'wm', 'size']);
    const restoredMatches = [...String(restoredSize.stdout).matchAll(/(\\d+)\\s*x\\s*(\\d+)/g)];
    const restoredActiveSize = restoredMatches[restoredMatches.length - 1];
    if (!restoredActiveSize || Number(restoredActiveSize[1]) !== 360 || Number(restoredActiveSize[2]) !== 800) {
      throw new Error('Android did not retain the selected 360p display preset after worker restart: ' + String(restoredSize.stdout).trim());
    }

    const screenshot = await run(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
    await writeFile(path.join(runnerTemp, 'grixdroid-playstore.png'), screenshot.stdout);
    const fingerprint = await run(adb, ['-s', serial, 'shell', 'getprop', 'ro.build.fingerprint']);
    await writeFile(path.join(runnerTemp, 'grixdroid-android-fingerprint.txt'), fingerprint.stdout);
    const activities = await run(adb, ['-s', serial, 'shell', 'dumpsys', 'activity', 'activities']);
    await writeFile(path.join(runnerTemp, 'grixdroid-android-activities.txt'), activities.stdout);
    await writeFile(path.join(runnerTemp, 'grixdroid-android-smoke.txt'),
      'Passed: real Android API ' + after.androidSdk + ', Android ' + after.androidRelease +
      ', Play Store + Google Play services verified, and Android Settings data survived GRIXDroid worker stop/start.\n');

    console.log('[smoke] PASS: GRIXDroid worker stopped and restarted real Android ' + after.androidRelease +
      ' with Play Store; the 360p display preset and Android Settings data were retained.');
  } finally {
    if (worker && worker.exitCode === null) {
      worker.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => worker.once('exit', resolve)),
        sleep(10000),
      ]);
      if (worker.exitCode === null) worker.kill('SIGKILL');
    }
    await new Promise((resolve) => controlPlane.close(() => resolve()));
  }
}

main().catch((error) => {
  console.error('[smoke] FAILED:', error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
