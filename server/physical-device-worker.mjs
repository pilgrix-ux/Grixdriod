#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rm, writeFile, rename, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseResolution, validateAction } from './cloud-worker.mjs';

const execFileAsync = promisify(execFile);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OEM_MANUFACTURERS = Object.freeze({
  samsung_galaxy_s22: 'samsung',
  samsung_galaxy_s23: 'samsung',
  samsung_galaxy_s24: 'samsung',
  samsung_galaxy_s24_ultra: 'samsung',
  oppo_find_x8_pro: 'oppo',
  xiaomi_14_ultra: 'xiaomi',
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function required(env, key) {
  const value = String(env[key] || '').trim();
  if (!value || /replace_with|your[-_ ]/i.test(value)) {
    throw new Error('Set ' + key + ' in .env.physical-worker before starting the physical worker.');
  }
  return value;
}

function positiveInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function getPhysicalWorkerConfig(env = process.env) {
  const deviceModelId = required(env, 'GRIXDROID_PHYSICAL_DEVICE_MODEL').toLowerCase();
  const manufacturer = OEM_MANUFACTURERS[deviceModelId];
  if (!manufacturer) throw new Error('The physical worker model is not in the verified Samsung/OPPO/Xiaomi allowlist.');

  const serial = required(env, 'GRIXDROID_PHYSICAL_DEVICE_SERIAL');
  if (serial.startsWith('emulator-') || serial.includes(':') || serial.length > 128) {
    throw new Error('GRIXDROID_PHYSICAL_DEVICE_SERIAL must be the pinned USB ADB serial, not an emulator or network ADB address.');
  }

  const androidVersion = required(env, 'GRIXDROID_PHYSICAL_ANDROID_VERSION');
  if (!['12', '12L', '13', '14', '15', '16'].includes(androidVersion)) {
    throw new Error('GRIXDROID_PHYSICAL_ANDROID_VERSION must be one of 12, 12L, 13, 14, 15 or 16.');
  }

  const sdkRoot = env.ANDROID_SDK_ROOT || env.ANDROID_HOME || '';
  const dataRoot = path.resolve(env.GRIXDROID_DATA_ROOT || '/var/lib/grixdroid');
  const stateRoot = path.resolve(env.GRIXDROID_PHYSICAL_STATE_DIR || path.join(dataRoot, 'physical-worker'));
  const controlUrl = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const apiKey = env.SUPABASE_API_KEY || '';
  const serviceRoleJwt = env.SUPABASE_SERVICE_ROLE_JWT || '';
  if (!controlUrl || !apiKey || !serviceRoleJwt) {
    throw new Error('Set SUPABASE_URL, SUPABASE_API_KEY and SUPABASE_SERVICE_ROLE_JWT on the physical worker only.');
  }

  const scrcpyServerPath = required(env, 'SCRCPY_SERVER_PATH');
  const scrcpyVersion = required(env, 'SCRCPY_VERSION');
  const whipBaseUrl = String(required(env, 'GRIXDROID_WHIP_BASE_URL')).replace(/\/+$/, '');
  let streamUrl;
  try { streamUrl = new URL(whipBaseUrl); } catch { throw new Error('GRIXDROID_WHIP_BASE_URL must be a valid URL.'); }
  if (streamUrl.protocol !== 'https:' && !(streamUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(streamUrl.hostname))) {
    throw new Error('The physical worker requires HTTPS for remote WHIP publishing.');
  }
  const streamPublishToken = required(env, 'GRIXDROID_STREAM_PUBLISH_TOKEN');
  if (streamPublishToken.length < 32) throw new Error('GRIXDROID_STREAM_PUBLISH_TOKEN must contain at least 32 characters.');

  return {
    workerId: required(env, 'GRIXDROID_WORKER_ID'),
    workerLabel: env.GRIXDROID_WORKER_LABEL || (os.hostname() + '-physical-' + deviceModelId),
    deviceModelId,
    manufacturer,
    serial,
    expectedProductModel: required(env, 'GRIXDROID_PHYSICAL_PRODUCT_MODEL'),
    expectedHardwareModel: required(env, 'GRIXDROID_PHYSICAL_HARDWARE_MODEL'),
    expectedFingerprint: required(env, 'GRIXDROID_PHYSICAL_BUILD_FINGERPRINT'),
    androidVersion,
    // Physical phones are shared only as dedicated, account-free lab devices.
    enableReset: env.GRIXDROID_PHYSICAL_ENABLE_RESET === '1',
    port: positiveInt(env.GRIXDROID_PHYSICAL_WORKER_PORT, 8790, 1024, 65535),
    adb: env.ADB_PATH || (sdkRoot ? path.join(sdkRoot, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb'),
    ffmpeg: env.FFMPEG_PATH || 'ffmpeg',
    scrcpyServerPath,
    scrcpyVersion,
    whipBaseUrl,
    streamPublishToken,
    controlUrl,
    apiKey,
    serviceRoleJwt,
    stateRoot,
    stateFile: path.join(stateRoot, 'current-device.json'),
    pollMs: positiveInt(env.GRIXDROID_POLL_MS, 5000, 1500, 30000),
    actionPollMs: positiveInt(env.GRIXDROID_ACTION_POLL_MS, 350, 100, 2000),
    sessionIdleMs: positiveInt(env.GRIXDROID_PHYSICAL_SESSION_IDLE_MS, 60 * 60 * 1000, 5 * 60 * 1000, 4 * 60 * 60 * 1000),
  };
}

export function parseAdbDeviceList(output) {
  return String(output || '').split(/\r?\n/).slice(1).map((line) => {
    const match = line.trim().match(/^(\S+)\s+(device|offline|unauthorized)\b(.*)$/);
    if (!match) return null;
    return { serial: match[1], state: match[2], details: match[3] || '' };
  }).filter(Boolean);
}

export function expectedManufacturer(deviceModelId) {
  return OEM_MANUFACTURERS[String(deviceModelId || '').toLowerCase()] || null;
}

export function validatePhysicalIdentity(config, identity) {
  if (!identity || typeof identity !== 'object') throw new Error('Android did not return a physical-device identity.');
  const manufacturer = String(identity.manufacturer || '').trim().toLowerCase();
  if (manufacturer !== config.manufacturer) throw new Error('Connected handset manufacturer does not match the configured OEM target.');
  if (String(identity.productModel || '').trim() !== config.expectedProductModel) {
    throw new Error('Connected handset product model does not match the operator-pinned model.');
  }
  if (String(identity.hardwareModel || '').trim() !== config.expectedHardwareModel) {
    throw new Error('Connected handset hardware model does not match the operator-pinned model.');
  }
  if (String(identity.buildFingerprint || '').trim() !== config.expectedFingerprint) {
    throw new Error('Connected handset build fingerprint does not match the operator-pinned firmware build.');
  }
  if (String(identity.androidVersion || '').trim() !== config.androidVersion) {
    throw new Error('Connected handset Android release does not match the configured target.');
  }
  if (String(identity.kernelQemu || '').trim() === '1' || String(identity.bootQemu || '').trim() === '1') {
    throw new Error('A virtual Android runtime cannot register as an OEM physical handset.');
  }
  if (!String(identity.hardwareModel || '').trim() || !String(identity.buildFingerprint || '').trim()) {
    throw new Error('The physical handset did not provide the required hardware model and build fingerprint.');
  }
  return {
    manufacturer,
    androidVersion: String(identity.androidVersion).trim(),
    productModel: String(identity.productModel).trim(),
    hardwareModel: String(identity.hardwareModel).trim(),
    buildFingerprint: String(identity.buildFingerprint).trim(),
    board: String(identity.board || '').trim(),
    resolution: identity.resolution || { width: 0, height: 0 },
  };
}

export function packagesToRemove(currentPackages, baselinePackages) {
  const baseline = new Set(baselinePackages || []);
  return [...new Set(currentPackages || [])].filter((name) => !baseline.has(name) && /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(name));
}

function safePackageList(output) {
  return String(output || '').split(/\r?\n/)
    .map((line) => line.trim().replace(/^package:/, ''))
    .filter((name) => /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(name))
    .sort();
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

async function run(file, args, options = {}) {
  try {
    return await execFileAsync(file, args, {
      encoding: options.encoding || 'utf8',
      timeout: options.timeout || 15000,
      maxBuffer: options.maxBuffer || 4 * 1024 * 1024,
      windowsHide: true,
      env: options.env || process.env,
    });
  } catch (error) {
    const detail = error && error.stderr ? String(error.stderr).trim() : '';
    throw new Error(detail || (error && error.message) || 'Android command failed.');
  }
}

async function adb(config, serial, args, options = {}) {
  return run(config.adb, ['-s', serial, ...args], options);
}

async function callRpc(config, name, args) {
  const response = await fetch(config.controlUrl + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: {
      apikey: config.apiKey,
      Authorization: 'Bearer ' + config.serviceRoleJwt,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error('Control plane ' + name + ' failed (' + response.status + '): ' + text.slice(0, 300));
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function rest(config, table, query = '', options = {}) {
  const response = await fetch(config.controlUrl + '/rest/v1/' + table + query, {
    method: options.method || 'GET',
    headers: {
      apikey: config.apiKey,
      Authorization: 'Bearer ' + config.serviceRoleJwt,
      'Content-Type': 'application/json',
      ...(options.prefer ? { Prefer: options.prefer } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error('Control plane table ' + table + ' failed (' + response.status + '): ' + text.slice(0, 300));
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function serialHash(serial) {
  return createHash('sha256').update(String(serial)).digest('hex');
}

async function connectedDevice(config) {
  const result = await run(config.adb, ['devices', '-l'], { timeout: 10000 });
  const devices = parseAdbDeviceList(result.stdout);
  const match = devices.find((item) => item.serial === config.serial);
  if (!match || match.state !== 'device') return null;
  // USB-only enrollment: reject emulator and network ADB serials. ADB's usb: transport
  // marker is required so a Wi-Fi-debugging endpoint cannot be mistaken for a handset.
  if (!match.details.includes('usb:') || match.serial.startsWith('emulator-') || match.serial.includes(':')) {
    throw new Error('Pinned ADB serial is not attached through a USB transport.');
  }
  return match;
}

async function readProperty(config, serial, property) {
  return String((await adb(config, serial, ['shell', 'getprop', property])).stdout || '').trim();
}

async function inspectDevice(config) {
  const connected = await connectedDevice(config);
  if (!connected) return null;
  const serial = connected.serial;
  const [
    manufacturer, productModel, hardwareModel, buildFingerprint, androidVersion,
    kernelQemu, bootQemu, board, wm, users, accounts,
  ] = await Promise.all([
    readProperty(config, serial, 'ro.product.manufacturer'),
    readProperty(config, serial, 'ro.product.model'),
    readProperty(config, serial, 'ro.product.device'),
    readProperty(config, serial, 'ro.build.fingerprint'),
    readProperty(config, serial, 'ro.build.version.release'),
    readProperty(config, serial, 'ro.kernel.qemu'),
    readProperty(config, serial, 'ro.boot.qemu'),
    readProperty(config, serial, 'ro.product.board'),
    adb(config, serial, ['shell', 'wm', 'size']).then((r) => String(r.stdout || '')),
    adb(config, serial, ['shell', 'pm', 'list', 'users']).then((r) => String(r.stdout || '')),
    adb(config, serial, ['shell', 'dumpsys', 'account']).then((r) => String(r.stdout || '')),
  ]);
  if (/\bAccount\s*\{\s*name\s*=/.test(accounts)) {
    throw new Error('The configured lab handset contains one or more signed-in Android accounts. Remove personal accounts before enrolling it.');
  }
  const userIds = [...users.matchAll(/UserInfo\{(\d+):/g)].map((m) => Number(m[1]));
  if (userIds.length && (userIds.length !== 1 || userIds[0] !== 0)) {
    throw new Error('The lab handset must contain only the primary Android user. Remove extra users/profiles before enrollment.');
  }
  const identity = validatePhysicalIdentity(config, {
    manufacturer, productModel, hardwareModel, buildFingerprint, androidVersion, kernelQemu, bootQemu, board,
    resolution: parseResolution(wm),
  });
  if (!identity.resolution.width || !identity.resolution.height) throw new Error('Could not read the physical handset display resolution.');
  return identity;
}

async function assertStreamingTools(config) {
  await stat(config.scrcpyServerPath);
  const help = await run(config.ffmpeg, ['-hide_banner', '-h', 'muxer=whip']);
  if (!String(help.stdout || '').toLowerCase().includes('authorization')) {
    throw new Error('The installed FFmpeg build must include the WHIP muxer authorization option.');
  }
  await run(config.adb, ['version']);
}

async function allocateTcpPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate a local stream port.')));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function setStreamState(config, meta, state, errorText = '') {
  meta.streamState = state;
  meta.streamError = errorText;
  if (!meta.cloudDeviceId) return;
  await callRpc(config, 'grixdroid_set_device_stream_state', {
    p_device_id: meta.cloudDeviceId,
    p_worker_id: config.workerId,
    p_stream_state: state,
    p_stream_error: errorText,
  });
}

async function stopStream(config, meta) {
  for (const child of [meta.ffmpegProcess, meta.scrcpyProcess]) {
    if (child && child.exitCode === null) child.kill('SIGTERM');
  }
  meta.ffmpegProcess = null;
  meta.scrcpyProcess = null;
  if (meta.streamPort) {
    await run(config.adb, ['-s', config.serial, 'forward', '--remove', 'tcp:' + meta.streamPort]).catch(() => {});
  }
  meta.streamPort = null;
  if (meta.cloudDeviceId) await setStreamState(config, meta, 'disabled').catch(() => {});
}

async function startStream(config, meta) {
  await setStreamState(config, meta, 'starting');
  const streamPort = await allocateTcpPort();
  const serverPath = '/data/local/tmp/grixdroid-scrcpy-server.jar';
  await run(config.adb, ['-s', config.serial, 'push', config.scrcpyServerPath, serverPath], { timeout: 60000 });
  await run(config.adb, ['-s', config.serial, 'forward', 'tcp:' + streamPort, 'localabstract:scrcpy']);
  meta.streamPort = streamPort;

  const serverArgs = [
    '-s', config.serial, 'shell',
    'CLASSPATH=' + serverPath,
    'app_process', '/', 'com.genymobile.scrcpy.Server', config.scrcpyVersion,
    'tunnel_forward=true', 'audio=false', 'control=false', 'cleanup=false',
    'raw_stream=true', 'max_size=1280',
  ];
  const scrcpy = spawn(config.adb, serverArgs, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  meta.scrcpyProcess = scrcpy;
  scrcpy.stderr.on('data', (chunk) => { meta.streamError = String(chunk).slice(-500); });
  await delay(800);
  if (scrcpy.exitCode !== null) throw new Error('scrcpy-server exited before the handset stream opened.');

  const whipUrl = config.whipBaseUrl + '/' + meta.cloudDeviceId + '/whip';
  const input = 'tcp://127.0.0.1:' + streamPort + '?tcp_nodelay=1';
  const ffmpegArgs = [
    '-hide_banner', '-loglevel', 'warning',
    '-fflags', 'nobuffer', '-flags', 'low_delay',
    '-f', 'h264', '-i', input,
    '-an', '-c:v', 'copy',
    '-f', 'whip', '-authorization', config.streamPublishToken,
    whipUrl,
  ];
  const ffmpeg = spawn(config.ffmpeg, ffmpegArgs, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  meta.ffmpegProcess = ffmpeg;
  ffmpeg.stderr.on('data', (chunk) => { meta.streamError = String(chunk).slice(-700); });
  ffmpeg.once('error', (error) => { meta.streamError = error.message; });
  await delay(6000);
  if (ffmpeg.exitCode !== null) throw new Error('FFmpeg WHIP publisher exited before streaming became ready. ' + (meta.streamError || ''));
  await setStreamState(config, meta, 'ready');
}

async function listThirdPartyPackages(config) {
  const result = await adb(config, config.serial, ['shell', 'pm', 'list', 'packages', '-3', '--user', '0']);
  return safePackageList(result.stdout);
}

async function resetTestData(config, baselinePackages) {
  if (!config.enableReset) throw new Error('Physical-device reset is disabled. Set GRIXDROID_PHYSICAL_ENABLE_RESET=1 only on a dedicated lab handset.');
  const currentPackages = await listThirdPartyPackages(config);
  const addedPackages = packagesToRemove(currentPackages, baselinePackages || []);
  for (const packageName of addedPackages) {
    await adb(config, config.serial, ['shell', 'pm', 'uninstall', '--user', '0', packageName]).catch(() => {});
  }
  for (const packageName of baselinePackages || []) {
    await adb(config, config.serial, ['shell', 'pm', 'clear', '--user', '0', packageName]).catch(() => {});
    const safePath = '/sdcard/Android/';
    for (const folder of ['data', 'media', 'obb']) {
      await adb(config, config.serial, ['shell', 'rm', '-rf', safePath + folder + '/' + packageName]).catch(() => {});
    }
  }
  await adb(config, config.serial, ['logcat', '-c']).catch(() => {});
  await adb(config, config.serial, ['shell', 'cmd', 'clipboard', 'clear']).catch(() => {});
  // This handset is dedicated to testing: clear shared user files as well as app-private data.
  for (const folder of ['Download', 'Documents', 'Movies', 'Pictures', 'Music', 'DCIM']) {
    await adb(config, config.serial, ['shell', 'sh', '-c', 'find /sdcard/' + folder + ' -mindepth 1 -maxdepth 1 -exec rm -rf {} +']).catch(() => {});
  }
  return { uninstalledPackages: addedPackages.length, clearedPackages: (baselinePackages || []).length };
}

async function installApk(config, meta, action, userId, deviceId) {
  if (!UUID_RE.test(userId || '') || !UUID_RE.test(deviceId || '') ||
      !action.object_path.startsWith(userId + '/' + deviceId + '/')) {
    throw new Error('APK upload does not belong to this device owner.');
  }
  const url = config.controlUrl + '/storage/v1/object/authenticated/grixdroid-apks/' +
    action.object_path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(url, {
    headers: { apikey: config.apiKey, Authorization: 'Bearer ' + config.serviceRoleJwt },
    cache: 'no-store',
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error('Could not fetch the private APK upload (' + response.status + ').');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 50 * 1024 * 1024) throw new Error('APK file is empty or exceeds the 50 MB limit.');
  const localPath = path.join(config.stateRoot, 'grixdroid-' + randomUUID() + '.apk');
  try {
    await writeFile(localPath, bytes, { mode: 0o600, flag: 'wx' });
    const result = await adb(config, config.serial, ['install', '-r', localPath], { timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
    const output = String(result.stdout || '') + String(result.stderr || '');
    if (!/success/i.test(output)) throw new Error(output.trim() || 'Android package installer did not confirm success.');
  } finally {
    await rm(localPath, { force: true }).catch(() => {});
  }
}

async function executeAction(config, meta, action, userId, deviceId) {
  const normalized = validateAction(action);
  const width = meta.identity.resolution.width;
  const height = meta.identity.resolution.height;
  if (normalized.type === 'fingerprint') throw new Error('Emulator-only fingerprint input is not supported on a physical handset.');
  if (normalized.type === 'tap') {
    await adb(config, config.serial, ['shell', 'input', 'tap', String(Math.round(normalized.x * width)), String(Math.round(normalized.y * height))]);
  } else if (normalized.type === 'swipe') {
    await adb(config, config.serial, [
      'shell', 'input', 'swipe',
      String(Math.round(normalized.x * width)), String(Math.round(normalized.y * height)),
      String(Math.round(normalized.endX * width)), String(Math.round(normalized.endY * height)),
      String(normalized.durationMs),
    ]);
  } else if (normalized.type === 'key') {
    await adb(config, config.serial, ['shell', 'input', 'keyevent', normalized.code]);
  } else if (normalized.type === 'text') {
    await adb(config, config.serial, ['shell', 'input', 'text', normalized.text]);
  } else if (normalized.type === 'rotate') {
    await adb(config, config.serial, ['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
    await adb(config, config.serial, ['shell', 'settings', 'put', 'system', 'user_rotation', normalized.orientation === 'landscape' ? '1' : '0']);
  } else if (normalized.type === 'night_mode') {
    await adb(config, config.serial, ['shell', 'cmd', 'uimode', 'night', normalized.enabled ? 'yes' : 'no']);
  } else if (normalized.type === 'font_scale') {
    await adb(config, config.serial, ['shell', 'settings', 'put', 'system', 'font_scale', String(normalized.scale)]);
  } else if (normalized.type === 'install_apk') {
    await installApk(config, meta, normalized, userId, deviceId);
  }
}

async function createSession(config, meta, userId) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.sessionIdleMs);
  const rows = await rest(config, 'cloud_device_sessions', '', {
    method: 'POST',
    prefer: 'return=representation',
    body: [{
      user_id: userId,
      device_id: meta.cloudDeviceId,
      state: 'connected',
      started_at: now.toISOString(),
      last_seen_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    }],
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || !UUID_RE.test(row.id || '')) throw new Error('Supabase did not create a valid owner-scoped device session.');
  meta.sessionId = row.id;
  meta.lastActivityAt = Date.now();
}

async function touchSession(config, meta) {
  if (!meta.sessionId) return;
  const now = new Date();
  await rest(config, 'cloud_device_sessions', '?id=eq.' + encodeURIComponent(meta.sessionId), {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: {
      last_seen_at: now.toISOString(),
      expires_at: new Date(now.getTime() + config.sessionIdleMs).toISOString(),
    },
  });
}

async function finishSession(config, meta, state) {
  if (!meta.sessionId) return;
  await rest(config, 'cloud_device_sessions', '?id=eq.' + encodeURIComponent(meta.sessionId), {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { state, last_seen_at: new Date().toISOString(), expires_at: new Date().toISOString() },
  }).catch(() => {});
}

async function setDeviceState(config, meta, state) {
  await callRpc(config, 'grixdroid_set_device_state', {
    p_device_id: meta.cloudDeviceId,
    p_worker_id: config.workerId,
    p_state: state,
    p_android_release: meta.identity?.androidVersion || config.androidVersion,
    p_storage_bytes: 0,
  });
}

async function persistCurrent(config, meta) {
  const disk = {
    cloudDeviceId: meta.cloudDeviceId,
    requestId: meta.requestId,
    userId: meta.userId,
    sessionId: meta.sessionId,
    serialHash: serialHash(config.serial),
    deviceModelId: meta.deviceModelId,
    androidVersion: meta.identity.androidVersion,
    productModel: meta.identity.productModel,
    hardwareModel: meta.identity.hardwareModel,
    buildFingerprint: meta.identity.buildFingerprint,
    baselinePackages: meta.baselinePackages,
    lastActivityAt: meta.lastActivityAt,
  };
  const temp = config.stateFile + '.tmp-' + randomUUID();
  await writeFile(temp, JSON.stringify(disk, null, 2), { mode: 0o600, flag: 'wx' });
  await rename(temp, config.stateFile);
}

async function completeCurrentFile(config) {
  await rm(config.stateFile, { force: true });
}

async function cleanupPreviousSession(config, identity) {
  let saved;
  try { saved = JSON.parse(await readFile(config.stateFile, 'utf8')); } catch { return; }
  if (!saved || !UUID_RE.test(saved.cloudDeviceId || '') || saved.serialHash !== serialHash(config.serial)) {
    throw new Error('A previous physical-device session belongs to a different handset configuration. Resolve the worker state file before enrolling another device.');
  }
  const meta = {
    cloudDeviceId: saved.cloudDeviceId,
    sessionId: saved.sessionId,
    identity,
    baselinePackages: Array.isArray(saved.baselinePackages) ? saved.baselinePackages : [],
  };
  await resetTestData(config, meta.baselinePackages);
  await finishSession(config, meta, 'expired');
  await setDeviceState(config, meta, 'stopped');
  await completeCurrentFile(config);
}

async function markCurrentError(config, meta, reason) {
  await stopStream(config, meta).catch(() => {});
  await finishSession(config, meta, 'failed');
  await setDeviceState(config, meta, 'error').catch(() => {});
  process.stderr.write('[physical-worker] Session ended with an error: ' + reason + '\n');
}

async function stopCurrent(config, current, reason = 'stopped') {
  if (!current) return;
  await stopStream(config, current).catch(() => {});
  try {
    const cleanup = await resetTestData(config, current.baselinePackages);
    process.stdout.write('[physical-worker] Reset complete: removed ' + cleanup.uninstalledPackages + ' session-installed apps and cleared ' + cleanup.clearedPackages + ' baseline app data.\n');
    await finishSession(config, current, 'expired');
    await setDeviceState(config, current, 'stopped');
    await completeCurrentFile(config);
  } catch (error) {
    await finishSession(config, current, 'failed');
    await setDeviceState(config, current, 'error').catch(() => {});
    process.stderr.write('[physical-worker] Cleanup failed; handset is not being offered again: ' + safeError(error) + '\n');
  }
  if (reason !== 'shutdown') process.stdout.write('[physical-worker] Physical device session ' + reason + '.\n');
}

async function startClaim(config, claim) {
  const requestId = claim.request_id;
  const leaseToken = claim.lease_token;
  let leaseTimer;
  let meta;
  try {
    const renew = async () => callRpc(config, 'grixdroid_renew_device_lease', {
      p_request_id: requestId,
      p_worker_id: config.workerId,
      p_lease_token: leaseToken,
    });
    leaseTimer = setInterval(() => { void renew().catch((error) => process.stderr.write('[physical-worker] Lease renewal failed: ' + safeError(error) + '\n')); }, 60000);
    leaseTimer.unref();

    const identity = await inspectDevice(config);
    if (!identity) throw new Error('The pinned physical handset disconnected before it could be assigned.');
    if (String(claim.android_version) !== identity.androidVersion || String(claim.device_model) !== config.deviceModelId) {
      throw new Error('The queued request does not match the currently verified physical handset.');
    }
    const baselinePackages = await listThirdPartyPackages(config);
    await resetTestData(config, baselinePackages);

    meta = {
      requestId,
      cloudDeviceId: '',
      sessionId: '',
      userId: claim.user_id,
      deviceModelId: config.deviceModelId,
      identity,
      baselinePackages,
      lastActivityAt: Date.now(),
      streamPort: null,
      streamState: 'starting',
      scrcpyProcess: null,
      ffmpegProcess: null,
    };
    const result = await callRpc(config, 'grixdroid_complete_device_request', {
      p_request_id: requestId,
      p_worker_id: config.workerId,
      p_lease_token: leaseToken,
      p_android_release: identity.androidVersion,
      p_device_model: config.deviceModelId,
      p_runtime_handle: 'physical-usb:' + serialHash(config.serial),
      p_persistent_volume_ref: 'physical-usb:' + serialHash(config.serial),
      p_storage_bytes: 0,
    });
    const deviceId = typeof result === 'string' ? result.replace(/^"+|"+$/g, '') : '';
    if (!UUID_RE.test(deviceId)) throw new Error('The control plane did not return a valid cloud device id.');
    meta.cloudDeviceId = deviceId;
    await startStream(config, meta);
    await createSession(config, meta, claim.user_id);
    await persistCurrent(config, meta);
    process.stdout.write('[physical-worker] Ready: ' + config.deviceModelId + ', Android ' + identity.androidVersion + ', device ' + deviceId + '.\n');
    return meta;
  } catch (error) {
    if (meta?.cloudDeviceId) {
      await stopStream(config, meta).catch(() => {});
      await finishSession(config, meta, 'failed');
      await setDeviceState(config, meta, 'error').catch(() => {});
    }
    await callRpc(config, 'grixdroid_fail_device_request', {
      p_request_id: requestId,
      p_worker_id: config.workerId,
      p_lease_token: leaseToken,
      p_reason: safeError(error),
    }).catch(() => {});
    process.stderr.write('[physical-worker] Provisioning failed for ' + requestId + ': ' + safeError(error) + '\n');
    return null;
  } finally {
    if (leaseTimer) clearInterval(leaseTimer);
  }
}

async function workerHeartbeat(config, identity) {
  const targets = identity ? [{
    verified: true,
    manufacturer: identity.manufacturer,
    hardware_model: identity.hardwareModel,
    build_fingerprint: identity.buildFingerprint,
    android_version: identity.androidVersion,
    device_model: config.deviceModelId,
    product_model: identity.productModel,
    hardware_board: identity.board,
  }] : [];
  await callRpc(config, 'grixdroid_worker_heartbeat', {
    p_worker_id: config.workerId,
    p_label: config.workerLabel,
    p_capacity: 1,
    p_capabilities: {
      provider: 'android-physical',
      device_targets: targets,
      physical_device_count: targets.length,
      physical_device_transport: 'usb',
      exclusive_device_lease: true,
      session_cleanup: 'package-data-and-session-apps',
      remote_stream: 'webrtc',
      api: 1,
    },
  });
}

async function processActions(config, current) {
  const actions = await callRpc(config, 'grixdroid_claim_device_actions', {
    p_worker_id: config.workerId,
    p_limit: 8,
  });
  if (!Array.isArray(actions) || !actions.length) return;
  for (const action of actions) {
    let success = false;
    let reason = '';
    try {
      if (action.device_id !== current.cloudDeviceId) throw new Error('This worker does not own the active session for that device.');
      await executeAction(config, current, action.command, action.user_id, action.device_id);
      current.lastActivityAt = Date.now();
      await touchSession(config, current);
      await persistCurrent(config, current);
      success = true;
    } catch (error) {
      reason = safeError(error).slice(0, 220);
    }
    await callRpc(config, 'grixdroid_finish_device_action', {
      p_action_id: action.action_id,
      p_worker_id: config.workerId,
      p_success: success,
      p_failure_reason: success ? null : reason,
    }).catch((error) => process.stderr.write('[physical-worker] Could not finish input action: ' + safeError(error) + '\n'));
  }
}

async function restoreOrCleanPrevious(config, identity) {
  try {
    await readFile(config.stateFile, 'utf8');
  } catch {
    return;
  }
  if (!identity) return;
  await cleanupPreviousSession(config, identity);
}

async function startPhysicalWorker(config = getPhysicalWorkerConfig()) {
  if (!UUID_RE.test(config.workerId)) throw new Error('GRIXDROID_WORKER_ID must be a stable UUID.');
  if (!config.enableReset) throw new Error('Physical worker startup is blocked until GRIXDROID_PHYSICAL_ENABLE_RESET=1 is explicitly set for a dedicated, account-free lab handset.');
  await mkdir(config.stateRoot, { recursive: true, mode: 0o700 });
  await assertStreamingTools(config);

  let current = null;
  let stopping = false;
  let actionBusy = false;
  let lastIdentity = null;
  const server = (await import('node:http')).createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
    if (req.method === 'GET' && url.pathname === '/api/v1/health') {
      return sendJson(res, 200, {
        status: 'ok',
        provider: 'android-physical-worker',
        model: config.deviceModelId,
        connected: Boolean(lastIdentity),
        activeSession: Boolean(current),
        streamState: current?.streamState || 'disabled',
      });
    }
    return sendJson(res, 404, { error: 'Route not found.' });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '127.0.0.1', resolve);
  });

  process.stdout.write('[physical-worker] Local health endpoint listening on 127.0.0.1.\n');
  process.stdout.write('[physical-worker] One USB handset is pinned to this worker; direct customer ADB access is never exposed.\n');

  const actionTimer = setInterval(() => {
    if (stopping || actionBusy || !current) return;
    actionBusy = true;
    void processActions(config, current)
      .catch((error) => process.stderr.write('[physical-worker] Input queue failed: ' + safeError(error) + '\n'))
      .finally(() => { actionBusy = false; });
  }, config.actionPollMs);
  actionTimer.unref();

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(actionTimer);
    if (current) await stopCurrent(config, current, 'shutdown');
    server.close();
    process.stdout.write('[physical-worker] Stopped. The handset remains powered on; its session apps and data were cleaned up.\n');
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });

  while (!stopping) {
    try {
      // Any ADB or identity-check failure removes this worker's advertised target immediately.
      // The database then stops offering the handset while it is offline or has mismatched firmware.
      const identity = await inspectDevice(config).catch((error) => {
        process.stderr.write('[physical-worker] Handset verification failed; target withdrawn: ' + safeError(error) + '\\n');
        return null;
      });
      lastIdentity = identity;
      if (!identity && current) {
        await markCurrentError(config, current, 'Pinned handset disconnected; reattach it for cleanup before reuse.');
        current = null;
      }
      if (!current && identity) await restoreOrCleanPrevious(config, identity);
      await workerHeartbeat(config, identity);

      if (current) {
        if (Date.now() - current.lastActivityAt > config.sessionIdleMs) {
          await stopCurrent(config, current, 'idle-timeout');
          current = null;
        }
      } else if (identity) {
        const result = await callRpc(config, 'grixdroid_claim_device_request', { p_worker_id: config.workerId });
        const claim = Array.isArray(result) ? (result[0] || null) : result;
        if (claim) current = await startClaim(config, claim);
      }
    } catch (error) {
      process.stderr.write('[physical-worker] Control/ADB loop failed: ' + safeError(error) + '\n');
    }
    await delay(config.pollMs);
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  startPhysicalWorker().catch((error) => {
    process.stderr.write('[physical-worker] Startup failed: ' + safeError(error) + '\n');
    process.exitCode = 1;
  });
}

export { startPhysicalWorker };
