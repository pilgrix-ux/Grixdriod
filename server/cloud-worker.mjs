#!/usr/bin/env node
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateAction(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('A JSON action is required.');
  if (body.type === 'tap') {
    const x = Number(body.x);
    const y = Number(body.y);
    if (![x, y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error('Tap coordinates must be between 0 and 1.');
    return { type: 'tap', x, y };
  }
  if (body.type === 'swipe') {
    const values = [body.x, body.y, body.endX, body.endY].map(Number);
    if (!values.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error('Swipe coordinates must be between 0 and 1.');
    const durationMs = Math.max(80, Math.min(1500, Number(body.durationMs) || 250));
    return { type: 'swipe', x: values[0], y: values[1], endX: values[2], endY: values[3], durationMs };
  }
  if (body.type === 'key') {
    const keys = { BACK: '4', HOME: '3', APP_SWITCH: '187', ENTER: '66', POWER: '26' };
    if (!Object.hasOwn(keys, body.key)) throw new Error('Supported keys are BACK, HOME, APP_SWITCH, ENTER and POWER.');
    return { type: 'key', key: body.key, code: keys[body.key] };
  }
  if (body.type === 'rotate') {
    if (!['portrait', 'landscape'].includes(body.orientation)) throw new Error('Rotation must be portrait or landscape.');
    return { type: 'rotate', orientation: body.orientation };
  }
  if (body.type === 'night_mode') {
    if (typeof body.enabled !== 'boolean') throw new Error('Night mode enabled must be true or false.');
    return { type: 'night_mode', enabled: body.enabled };
  }
  if (body.type === 'font_scale') {
    const scale = Number(body.scale);
    if (!Number.isFinite(scale) || scale < 0.85 || scale > 1.3) throw new Error('Font scale must be between 0.85 and 1.3.');
    return { type: 'font_scale', scale };
  }
  if (body.type === 'fingerprint') return { type: 'fingerprint' };
  if (body.type === 'install_apk') {
    const objectPath = String(body.object_path || '');
    const filename = String(body.filename || '');
    const parts = objectPath.split('/');
    if (parts.length !== 3 || !UUID_RE.test(parts[0]) || !UUID_RE.test(parts[1]) ||
        !/^[a-f0-9-]{36}\.apk$/i.test(parts[2]) || path.posix.normalize(objectPath) !== objectPath) {
      throw new Error('APK storage path is invalid.');
    }
    if (!filename || filename.length > 120 || !/\.apk$/i.test(filename) || /[\\/\u0000-\u001f;<>:"|?*]/.test(filename)) {
      throw new Error('APK filename must be a valid .apk filename.');
    }
    return { type: 'install_apk', object_path: objectPath, filename };
  }
  if (body.type === 'text') {
    if (typeof body.text !== 'string' || body.text.length < 1 || body.text.length > 120 || !/^[A-Za-z0-9@._,:/+ =-]+$/.test(body.text)) {
      throw new Error('Text must be 1–120 characters using basic letters, numbers and punctuation.');
    }
    return { type: 'text', text: body.text.replace(/ /g, '%s') };
  }
  throw new Error('Unsupported action type.');
}

export function parseResolution(raw) {
  const matches = [...String(raw || '').matchAll(/(\d+)\s*x\s*(\d+)/g)];
  const match = matches[matches.length - 1];
  return match ? { width: Number(match[1]), height: Number(match[2]) } : { width: 0, height: 0 };
}

export function parseSystemImagePackage(raw) {
  const match = String(raw || '').match(/^system-images;android-(\d+);([a-z0-9_]+);([a-z0-9_]+)$/i);
  if (!match) {
    throw new Error('GRIXDROID_SYSTEM_IMAGE must look like system-images;android-35;google_apis_playstore;x86_64.');
  }
  return {
    apiLevel: Number(match[1]),
    target: match[2],
    abi: match[3],
    relativePath: path.join('system-images', 'android-' + match[1], match[2], match[3]),
    hasPlayStore: match[2].toLowerCase().includes('playstore'),
  };
}

export function androidVersionForApiLevel(apiLevel) {
  const versions = new Map([[31, '12'], [32, '12L'], [33, '13'], [34, '14'], [35, '15'], [36, '16']]);
  const version = versions.get(Number(apiLevel));
  if (!version) throw new Error('Android API level ' + apiLevel + ' is not in the supported GRIXDroid range (31–36).');
  return version;
}

export function resolveAvdManagerPath(sdkRoot, override = '', platform = process.platform) {
  if (override) return override;
  if (!sdkRoot) return 'avdmanager';

  const executable = platform === 'win32' ? 'avdmanager.bat' : 'avdmanager';
  const commandLineTools = path.join(sdkRoot, 'cmdline-tools');
  const candidates = [
    path.join(commandLineTools, 'latest', 'bin', executable),
    path.join(commandLineTools, 'bin', executable),
  ];

  // Android SDK installations may keep the command-line tools in a versioned
  // folder (for example cmdline-tools/19.0/bin) instead of a "latest" alias.
  try {
    const versionedDirectories = readdirSync(commandLineTools, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'latest')
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));

    for (const version of versionedDirectories) {
      candidates.push(path.join(commandLineTools, version, 'bin', executable));
    }
  } catch {
    // Fall through to the standard path so startup can report a useful error.
  }

  // Keep compatibility with older SDK layouts that used tools/bin.
  candidates.push(path.join(sdkRoot, 'tools', 'bin', executable));
  return candidates.find((candidate) => existsSync(candidate)) || 'avdmanager';
}

export function getWorkerConfig(env = process.env) {
  const sdkRoot = env.ANDROID_SDK_ROOT || env.ANDROID_HOME || '';
  const root = path.resolve(env.GRIXDROID_DATA_ROOT || './.grixdroid-worker-data');
  const host = env.GRIXDROID_WORKER_HOST || '127.0.0.1';
  const accel = env.GRIXDROID_ACCEL || 'auto';
  if (!['auto', 'on', 'off'].includes(accel)) throw new Error('GRIXDROID_ACCEL must be auto, on or off.');
  const capacity = Math.max(1, Math.min(4, Number(env.GRIXDROID_MAX_DEVICES) || 1));
  const systemImage = env.GRIXDROID_SYSTEM_IMAGE || 'system-images;android-35;google_apis_playstore;x86_64';
  const systemImagePackages = (env.GRIXDROID_SYSTEM_IMAGES || systemImage)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const systemImages = systemImagePackages.map((packageName) => {
    const parsed = parseSystemImagePackage(packageName);
    return { package: packageName, ...parsed, androidVersion: androidVersionForApiLevel(parsed.apiLevel) };
  });
  if (!systemImages.length || new Set(systemImages.map((image) => image.androidVersion)).size !== systemImages.length) {
    throw new Error('GRIXDROID_SYSTEM_IMAGES must contain one supported system image per Android version.');
  }
  const deviceModels = (env.GRIXDROID_DEVICE_MODELS || 'pixel_7')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const supportedDeviceModels = new Set([
    'pixel_6', 'pixel_6_pro', 'pixel_7', 'pixel_7_pro',
    'pixel_8', 'pixel_8_pro', 'pixel_9', 'pixel_9_pro',
  ]);
  if (!deviceModels.length || deviceModels.some((model) => !supportedDeviceModels.has(model)) ||
      new Set(deviceModels).size !== deviceModels.length) {
    throw new Error('GRIXDROID_DEVICE_MODELS must contain unique supported Pixel AVD IDs (pixel_6 through pixel_9, including Pro variants).');
  }
  return {
    sdkRoot,
    dataRoot: root,
    devicesRoot: path.join(root, 'devices'),
    adb: env.ADB_PATH || (sdkRoot ? path.join(sdkRoot, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb'),
    emulator: env.EMULATOR_PATH || (sdkRoot ? path.join(sdkRoot, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator') : 'emulator'),
    avdManager: resolveAvdManagerPath(sdkRoot, env.AVDMANAGER_PATH || ''),
    systemImage,
    systemImages,
    deviceModels,
    scrcpyServerPath: env.SCRCPY_SERVER_PATH || '',
    scrcpyVersion: env.SCRCPY_VERSION || '',
    ffmpeg: env.FFMPEG_PATH || 'ffmpeg',
    whipBaseUrl: (env.GRIXDROID_WHIP_BASE_URL || '').replace(/\/+$/, ''),
    streamPublishToken: env.GRIXDROID_STREAM_PUBLISH_TOKEN || '',
    accel,
    gpu: env.GRIXDROID_GPU_MODE || 'software',
    host,
    port: Math.max(1024, Math.min(65535, Number(env.GRIXDROID_WORKER_PORT) || 8788)),
    capacity,
    pollMs: Math.max(1500, Math.min(30000, Number(env.GRIXDROID_POLL_MS) || 5000)),
    actionPollMs: Math.max(100, Math.min(2000, Number(env.GRIXDROID_ACTION_POLL_MS) || 350)),
    bootTimeoutMs: Math.max(120000, Math.min(1200000, Number(env.GRIXDROID_BOOT_TIMEOUT_MS) || 600000)),
    workerId: env.GRIXDROID_WORKER_ID || '',
    workerLabel: env.GRIXDROID_WORKER_LABEL || os.hostname(),
    apiToken: env.GRIXDROID_WORKER_API_TOKEN || '',
    controlUrl: (env.SUPABASE_URL || '').replace(/\/+$/, ''),
    apiKey: env.SUPABASE_API_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '',
    serviceRoleJwt: env.SUPABASE_SERVICE_ROLE_JWT || env.SUPABASE_SERVICE_ROLE_KEY || '',
    corsOrigins: new Set((env.GRIXDROID_WORKER_CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((v) => v.trim()).filter(Boolean)),
    allowRemote: env.GRIXDROID_WORKER_ALLOW_REMOTE === '1',
    enableSoftwareEmulation: env.GRIXDROID_ENABLE_SOFTWARE_EMULATION === '1',
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function cors(req, res, config) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!config.corsOrigins.has(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  return true;
}

function authorize(req, token) {
  const header = req.headers.authorization || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  return secureEqual(supplied, token);
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 16 * 1024) {
      const error = new Error('JSON request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } catch {
    const error = new Error('Invalid JSON request body.');
    error.statusCode = 400;
    throw error;
  }
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
    const stderr = error && error.stderr ? String(error.stderr).trim() : '';
    const stdout = error && error.stdout ? String(error.stdout).trim() : '';
    throw new Error(stderr || stdout || error.message || 'Command failed.');
  }
}

async function callRpc(config, name, args) {
  if (!config.controlUrl || !config.apiKey || !config.serviceRoleJwt) throw new Error('Worker control plane is not configured. Set SUPABASE_URL, SUPABASE_API_KEY and SUPABASE_SERVICE_ROLE_JWT on the worker only.');
  const response = await fetch(config.controlUrl + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: {
      apikey: config.apiKey,
      Authorization: 'Bearer ' + config.serviceRoleJwt,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(20000),
    cache: 'no-store',
  });
  const text = await response.text();
  if (!response.ok) throw new Error('Control plane ' + name + ' failed (' + response.status + '): ' + text.slice(0, 400));
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function profileSettings(profile) {
  return profile === 'compact'
    ? { memory: 1536, cores: 1, resolution: '720x1280' }
    : { memory: 2048, cores: 2, resolution: '720x1280' };
}

function spawnEmulator(config, meta) {
  const args = [
    '-avd', meta.avdName,
    '-port', String(meta.port),
    '-no-window',
    '-no-audio',
    '-no-boot-anim',
    '-no-snapshot',
    '-gpu', config.gpu,
  ];
  if (meta.profile === 'compact') args.push('-memory', '1536', '-cores', '1');
  else args.push('-memory', '2048', '-cores', '2');
  if (config.accel === 'off') args.push('-accel', 'off');
  if (config.accel === 'on') args.push('-accel', 'on');

  const avdHome = meta.avdHome;
  const childEnv = {
    ...process.env,
    ANDROID_AVD_HOME: avdHome,
    ANDROID_SDK_ROOT: config.sdkRoot || process.env.ANDROID_SDK_ROOT,
    ANDROID_HOME: config.sdkRoot || process.env.ANDROID_HOME,
  };
  if (config.accel === 'off') childEnv.ANDROID_I_WANT_MY_TCG = 'yes';

  const child = spawn(config.emulator, args, {
    env: childEnv,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  child.stderr.on('data', (chunk) => {
    meta.lastLog = String(chunk).slice(-500);
  });
  child.on('exit', (code, signal) => {
    meta.process = null;
    if (meta.expectedStop) return;
    meta.state = 'error';
    meta.lastError = 'Android Emulator exited unexpectedly (' + (signal || code) + '). ' + (meta.lastLog || '');
    if (meta.cloudDeviceId) {
      void callRpc(config, 'grixdroid_set_device_state', {
        p_device_id: meta.cloudDeviceId,
        p_worker_id: config.workerId,
        p_state: 'error',
        p_android_release: null,
        p_storage_bytes: null,
      }).catch(() => {});
    }
  });
  meta.process = child;
  meta.state = 'starting';
  return child;
}

async function adb(config, serial, args, options = {}) {
  return run(config.adb, ['-s', serial, ...args], options);
}

async function inspectAndroidSystem(config, serial, systemImagePackage = config.systemImage) {
  const readProperty = async (name) => String((await adb(config, serial, ['shell', 'getprop', name])).stdout).trim();
  const androidRelease = await readProperty('ro.build.version.release');
  const androidSdk = Number.parseInt(await readProperty('ro.build.version.sdk'), 10);
  const buildFingerprint = await readProperty('ro.build.fingerprint');
  const deviceModel = await readProperty('ro.product.model');
  const settings = String((await adb(config, serial, ['shell', 'pm', 'path', 'com.android.settings'])).stdout).trim();
  if (!androidRelease || !Number.isInteger(androidSdk) || !buildFingerprint || !settings) {
    throw new Error('The booted image did not pass Android framework verification (build properties or Settings package missing).');
  }

  const image = parseSystemImagePackage(systemImagePackage);
  const playStore = String((await adb(config, serial, ['shell', 'pm', 'path', 'com.android.vending'])).stdout).trim();
  const playServices = String((await adb(config, serial, ['shell', 'pm', 'path', 'com.google.android.gms'])).stdout).trim();
  if (image.hasPlayStore && (!playStore || !playServices)) {
    throw new Error('The configured Play Store Android image booted without the Play Store and Google Play services packages.');
  }

  return {
    androidRelease,
    androidSdk,
    buildFingerprint,
    deviceModel,
    hasPlayStore: Boolean(playStore),
    hasGooglePlayServices: Boolean(playServices),
  };
}

async function waitForBoot(config, meta) {
  const deadline = Date.now() + config.bootTimeoutMs;
  await run(config.adb, ['-s', meta.serial, 'wait-for-device'], { timeout: Math.min(config.bootTimeoutMs, 120000) });
  while (Date.now() < deadline) {
    if (meta.state === 'error') throw new Error(meta.lastError || 'Emulator exited before Android boot completed.');
    if (meta.process && meta.process.exitCode !== null) throw new Error(meta.lastError || 'Emulator exited before Android boot completed.');
    const result = await adb(config, meta.serial, ['shell', 'getprop', 'sys.boot_completed']).catch(() => ({ stdout: '' }));
    if (String(result.stdout).trim() === '1') {
      const system = await inspectAndroidSystem(config, meta.serial, meta.systemImage || config.systemImage);
      const size = await adb(config, meta.serial, ['shell', 'wm', 'size']).catch(() => ({ stdout: '' }));
      return { ...system, resolution: parseResolution(size.stdout) };
    }
    await delay(3000);
  }
  throw new Error('Android did not finish booting before the worker timeout.');
}

async function listAvds(config, avdHome) {
  const env = { ...process.env, ANDROID_AVD_HOME: avdHome, ANDROID_SDK_ROOT: config.sdkRoot, ANDROID_HOME: config.sdkRoot };
  const result = await run(config.emulator, ['-list-avds'], { env });
  return String(result.stdout).split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
}

async function assertSystemImageInstalled(config, systemImagePackage = config.systemImage) {
  const image = parseSystemImagePackage(systemImagePackage);
  const imageDir = path.join(config.sdkRoot, image.relativePath);
  const entries = await readdir(imageDir).catch(() => null);
  if (!entries || (!entries.includes('source.properties') && !entries.includes('package.xml'))) {
    throw new Error('Android system image is not installed: ' + systemImagePackage + '. Install it with sdkmanager before starting the worker.');
  }
  return image;
}

async function verifyAvdImage(config, meta) {
  const image = parseSystemImagePackage(meta.systemImage || config.systemImage);
  const configFile = path.join(meta.avdHome, meta.avdName + '.avd', 'config.ini');
  const avdConfig = await readFile(configFile, 'utf8');
  const match = avdConfig.match(/^image\.sysdir\.1=(.+)$/m);
  const actual = match ? match[1].trim().replace(/\\/g, '/').replace(/\/+$/, '') : '';
  const expected = image.relativePath.replace(/\\/g, '/');
  if (!actual || !actual.endsWith(expected)) {
    throw new Error('Existing AVD ' + meta.avdName + ' was created from a different Android system image. Back up its data and provision a new device to change image targets.');
  }
}

async function ensureAvd(config, meta) {
  await mkdir(meta.avdHome, { recursive: true });
  const existing = await listAvds(config, meta.avdHome);
  if (existing.includes(meta.avdName)) {
    await verifyAvdImage(config, meta);
    return;
  }
  const env = { ...process.env, ANDROID_AVD_HOME: meta.avdHome, ANDROID_SDK_ROOT: config.sdkRoot, ANDROID_HOME: config.sdkRoot };
  const args = ['create', 'avd', '--name', meta.avdName, '--package', meta.systemImage || config.systemImage, '--device', meta.deviceModelId || 'pixel_7', '--force'];
  const child = spawn(config.avdManager, args, { env, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-3000); });
  child.stdin.end('no\n');
  const outcome = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve(true) : reject(new Error(stderr || 'avdmanager failed with exit code ' + code)));
  });
  await verifyAvdImage(config, meta);
  return outcome;
}

async function allocateTcpPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close(() => reject(new Error('Could not allocate a local streaming port.')));
        return;
      }
      const port = address.port;
      probe.close((error) => error ? reject(error) : resolve(port));
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

async function stopWebRTCStream(config, meta) {
  for (const child of [meta.ffmpegProcess, meta.scrcpyProcess]) {
    if (child && child.exitCode === null) child.kill('SIGTERM');
  }
  meta.ffmpegProcess = null;
  meta.scrcpyProcess = null;
  if (meta.streamPort) {
    await run(config.adb, ['-s', meta.serial, 'forward', '--remove', 'tcp:' + meta.streamPort]).catch(() => {});
  }
  meta.streamPort = null;
  if (meta.cloudDeviceId) await setStreamState(config, meta, 'disabled').catch(() => {});
  else meta.streamState = 'disabled';
}

async function startWebRTCStream(config, meta) {
  const enabled = Boolean(config.scrcpyServerPath && config.scrcpyVersion && config.whipBaseUrl && config.streamPublishToken);
  if (!enabled) {
    await setStreamState(config, meta, 'disabled').catch(() => {});
    return;
  }
  let base;
  try { base = new URL(config.whipBaseUrl); } catch { throw new Error('GRIXDROID_WHIP_BASE_URL must be a valid URL.'); }
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) {
    throw new Error('GRIXDROID_WHIP_BASE_URL must use HTTPS (HTTP is allowed only for localhost).');
  }

  await setStreamState(config, meta, 'starting');
  const streamPort = await allocateTcpPort();
  const serverPath = '/data/local/tmp/grixdroid-scrcpy-server.jar';
  await run(config.adb, ['-s', meta.serial, 'push', config.scrcpyServerPath, serverPath], { timeout: 60000 });
  await run(config.adb, ['-s', meta.serial, 'forward', 'tcp:' + streamPort, 'localabstract:scrcpy']);
  meta.streamPort = streamPort;

  const serverArgs = [
    '-s', meta.serial, 'shell',
    'CLASSPATH=' + serverPath,
    'app_process', '/', 'com.genymobile.scrcpy.Server', config.scrcpyVersion,
    'tunnel_forward=true', 'audio=false', 'control=false', 'cleanup=false',
    'raw_stream=true', 'max_size=1280',
  ];
  const scrcpy = spawn(config.adb, serverArgs, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  meta.scrcpyProcess = scrcpy;
  scrcpy.stderr.on('data', (chunk) => { meta.streamError = String(chunk).slice(-500); });
  await delay(800);
  if (scrcpy.exitCode !== null) throw new Error('scrcpy-server exited before the H.264 stream opened.');

  const whipUrl = config.whipBaseUrl.replace(/\/+$/, '') + '/' + meta.cloudDeviceId + '/whip';
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
  if (ffmpeg.exitCode !== null) throw new Error('FFmpeg WHIP publisher exited before the stream became ready. ' + (meta.streamError || ''));
  await setStreamState(config, meta, 'ready');
}

async function pickPort(config) {
  const connected = await run(config.adb, ['devices'], { timeout: 10000 }).catch(() => ({ stdout: '' }));
  const used = new Set([...String(connected.stdout).matchAll(/emulator-(\d+)\s+device/g)].map((m) => Number(m[1])));
  for (let port = 5554; port <= 5584; port += 2) {
    if (!used.has(port)) return port;
  }
  throw new Error('No free Android Emulator console port remains on this worker.');
}

async function persistMeta(meta) {
  const file = path.join(meta.deviceDir, 'device.json');
  const temp = file + '.tmp-' + randomUUID();
  const disk = {
    cloudDeviceId: meta.cloudDeviceId,
    requestId: meta.requestId,
    name: meta.name,
    profile: meta.profile,
    systemImage: meta.systemImage || config.systemImage,
    deviceModelId: meta.deviceModelId || 'pixel_7',
    avdName: meta.avdName,
    avdHome: meta.avdHome,
    deviceDir: meta.deviceDir,
    port: meta.port,
    serial: meta.serial,
    state: meta.state,
    androidRelease: meta.androidRelease || null,
    androidSdk: meta.androidSdk || null,
    buildFingerprint: meta.buildFingerprint || null,
    deviceModel: meta.deviceModel || null,
    hasPlayStore: Boolean(meta.hasPlayStore),
    hasGooglePlayServices: Boolean(meta.hasGooglePlayServices),
    resolution: meta.resolution || { width: 0, height: 0 },
  };
  await writeFile(temp, JSON.stringify(disk, null, 2), { mode: 0o600 });
  await rename(temp, file);
}

async function startExisting(config, meta) {
  await verifyAvdImage(config, meta);
  if (meta.process && meta.process.exitCode === null) return;
  const state = await run(config.adb, ['-s', meta.serial, 'get-state'], { timeout: 4000 }).catch(() => null);
  if (state && String(state.stdout).trim() === 'device') {
    const boot = await waitForBoot(config, { ...meta, process: null });
    Object.assign(meta, boot);
    meta.state = 'running';
    await callRpc(config, 'grixdroid_set_device_state', {
      p_device_id: meta.cloudDeviceId,
      p_worker_id: config.workerId,
      p_state: 'running',
      p_android_release: meta.androidRelease,
      p_storage_bytes: null,
    });
    await startWebRTCStream(config, meta);
    return;
  }
  spawnEmulator(config, meta);
  const boot = await waitForBoot(config, meta);
  Object.assign(meta, boot);
  meta.state = 'running';
  await persistMeta(meta);
  await callRpc(config, 'grixdroid_set_device_state', {
    p_device_id: meta.cloudDeviceId,
    p_worker_id: config.workerId,
    p_state: 'running',
    p_android_release: meta.androidRelease,
    p_storage_bytes: null,
  });
  await startWebRTCStream(config, meta);
}

async function stopDevice(config, meta) {
  if (meta.state === 'stopped') return;
  await stopWebRTCStream(config, meta);
  meta.expectedStop = true;
  await adb(config, meta.serial, ['emu', 'kill'], { timeout: 10000 }).catch(() => {
    if (meta.process && meta.process.exitCode === null) meta.process.kill('SIGTERM');
  });
  const child = meta.process;
  if (child && child.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(15000),
    ]);
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  meta.process = null;
  meta.state = 'stopped';
  meta.expectedStop = false;
  await persistMeta(meta);
  await callRpc(config, 'grixdroid_set_device_state', {
    p_device_id: meta.cloudDeviceId,
    p_worker_id: config.workerId,
    p_state: 'stopped',
    p_android_release: meta.androidRelease || null,
    p_storage_bytes: null,
  });
}

async function installApk(config, meta, normalized, userId, deviceId) {
  if (!UUID_RE.test(userId || '') || !UUID_RE.test(deviceId || '') ||
      !normalized.object_path.startsWith(userId + '/' + deviceId + '/')) {
    throw new Error('APK upload does not belong to this Android device owner.');
  }
  const url = config.controlUrl + '/storage/v1/object/authenticated/grixdroid-apks/' +
    normalized.object_path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(url, {
    headers: { apikey: config.apiKey, Authorization: 'Bearer ' + config.serviceRoleJwt },
    cache: 'no-store',
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error('Could not download uploaded APK from private storage (' + response.status + ').');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 50 * 1024 * 1024) throw new Error('APK file is empty or exceeds the 50 MB limit.');
  const localPath = path.join(meta.deviceDir, 'upload-' + randomUUID() + '.apk');
  try {
    await writeFile(localPath, bytes, { mode: 0o600 });
    const result = await adb(config, meta.serial, ['install', '-r', localPath], { timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
    const output = String(result.stdout || '') + String(result.stderr || '');
    if (!/success/i.test(output)) throw new Error(output.trim() || 'Android package installer did not confirm success.');
    process.stdout.write('[worker] Installed APK ' + normalized.filename + ' on ' + meta.cloudDeviceId + '\\n');
  } finally {
    await rm(localPath, { force: true }).catch(() => {});
  }
}

async function executeAction(config, meta, action, context = {}) {
  const normalized = validateAction(action);
  const width = meta.resolution?.width || 0;
  const height = meta.resolution?.height || 0;
  if (normalized.type === 'tap') {
    if (!width || !height) throw new Error('Device resolution is not ready.');
    await adb(config, meta.serial, ['shell', 'input', 'tap', String(Math.round(normalized.x * width)), String(Math.round(normalized.y * height))]);
  } else if (normalized.type === 'swipe') {
    if (!width || !height) throw new Error('Device resolution is not ready.');
    await adb(config, meta.serial, [
      'shell', 'input', 'swipe',
      String(Math.round(normalized.x * width)), String(Math.round(normalized.y * height)),
      String(Math.round(normalized.endX * width)), String(Math.round(normalized.endY * height)),
      String(normalized.durationMs),
    ]);
  } else if (normalized.type === 'key') {
    await adb(config, meta.serial, ['shell', 'input', 'keyevent', normalized.code]);
  } else if (normalized.type === 'text') {
    await adb(config, meta.serial, ['shell', 'input', 'text', normalized.text]);
  } else if (normalized.type === 'rotate') {
    await adb(config, meta.serial, ['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
    await adb(config, meta.serial, ['shell', 'settings', 'put', 'system', 'user_rotation', normalized.orientation === 'landscape' ? '1' : '0']);
  } else if (normalized.type === 'night_mode') {
    await adb(config, meta.serial, ['shell', 'cmd', 'uimode', 'night', normalized.enabled ? 'yes' : 'no']);
  } else if (normalized.type === 'font_scale') {
    await adb(config, meta.serial, ['shell', 'settings', 'put', 'system', 'font_scale', String(normalized.scale)]);
  } else if (normalized.type === 'fingerprint') {
    await run(config.adb, ['-s', meta.serial, 'emu', 'finger', 'touch', '1']);
  } else if (normalized.type === 'install_apk') {
    await installApk(config, meta, normalized, context.userId, context.deviceId);
  }
}

async function processQueuedDeviceActions(config, instances) {
  const result = await callRpc(config, 'grixdroid_claim_device_actions', {
    p_worker_id: config.workerId,
    p_limit: 24,
  });
  const actions = Array.isArray(result) ? result : [];

  for (const item of actions) {
    let failure = null;
    try {
      const meta = instances.get(item.device_id);
      if (!meta || meta.state !== 'running') {
        throw new Error('Android device is not running on this worker.');
      }
      await executeAction(config, meta, item.command, { userId: item.user_id, deviceId: item.device_id });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    try {
      await callRpc(config, 'grixdroid_finish_device_action', {
        p_action_id: item.action_id,
        p_worker_id: config.workerId,
        p_success: !failure,
        p_failure_reason: failure,
      });
    } catch (error) {
      process.stderr.write(
        '[worker] Could not finish Android input action ' + item.action_id + ': ' +
        (error instanceof Error ? error.message : String(error)) + '\\n',
      );
    }
  }
}

async function readScreenshot(config, meta) {
  if (meta.state !== 'running') throw new Error('Start the Android device before requesting its screen.');
  const result = await adb(config, meta.serial, ['exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, timeout: 20000 });
  return result.stdout;
}

function publicDevice(meta) {
  return {
    id: meta.cloudDeviceId,
    name: meta.name,
    profile: meta.profile,
    state: meta.state,
    androidRelease: meta.androidRelease || null,
    androidSdk: meta.androidSdk || null,
    deviceModel: meta.deviceModel || null,
    hasPlayStore: Boolean(meta.hasPlayStore),
    hasGooglePlayServices: Boolean(meta.hasGooglePlayServices),
    resolution: meta.resolution || { width: 0, height: 0 },
    storage: 'persistent-volume',
    streamState: meta.streamState || 'disabled',
  };
}

async function loadPersistedDevices(config, instances) {
  await mkdir(config.devicesRoot, { recursive: true });
  const dirs = await readdir(config.devicesRoot, { withFileTypes: true });
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const deviceDir = path.join(config.devicesRoot, dir.name);
    try {
      const saved = JSON.parse(await readFile(path.join(deviceDir, 'device.json'), 'utf8'));
      if (!UUID_RE.test(saved.cloudDeviceId) || !UUID_RE.test(saved.requestId) || !Number.isInteger(saved.port)) continue;
      const meta = {
        ...saved,
        deviceDir,
        process: null,
        expectedStop: false,
        state: 'stopped',
        lastLog: '',
      };
      await verifyAvdImage(config, meta);
      const active = await run(config.adb, ['-s', meta.serial, 'get-state'], { timeout: 3000 }).catch(() => null);
      if (active && String(active.stdout).trim() === 'device') {
        const boot = await waitForBoot(config, meta).catch(() => null);
        if (boot) {
          Object.assign(meta, boot);
          meta.state = 'running';
        }
      } else {
        await callRpc(config, 'grixdroid_set_device_state', {
          p_device_id: meta.cloudDeviceId,
          p_worker_id: config.workerId,
          p_state: 'stopped',
          p_android_release: meta.androidRelease || null,
          p_storage_bytes: null,
        }).catch(() => {});
        await persistMeta(meta).catch(() => {});
      }
      instances.set(meta.cloudDeviceId, meta);
    } catch (error) {
      process.stderr.write('[worker] Could not restore Android device from ' + deviceDir + ': ' + (error instanceof Error ? error.message : String(error)) + '\n');
      // Keep the persistent AVD files untouched so an operator can inspect or recover them.
    }
  }
}

async function bootClaim(config, claim, instances) {
  const requestId = claim.request_id;
  const leaseToken = claim.lease_token;
  let leaseTimer = null;
  let meta = null;
  try {
    const renew = async () => callRpc(config, 'grixdroid_renew_device_lease', {
      p_request_id: requestId,
      p_worker_id: config.workerId,
      p_lease_token: leaseToken,
    });
    leaseTimer = setInterval(() => { void renew().catch((error) => process.stderr.write('[lease] ' + error.message + '\n')); }, 60000);
    leaseTimer.unref();

    const deviceDir = path.join(config.devicesRoot, requestId);
    const avdHome = path.join(deviceDir, 'avd-home');
    const avdName = 'grix_' + requestId.replace(/-/g, '').slice(0, 12);
    const port = await pickPort(config);
    const settings = profileSettings(claim.profile);
    meta = {
      requestId,
      cloudDeviceId: '',
      name: claim.device_name,
      profile: claim.profile,
      systemImage: (config.systemImages.find((image) => image.androidVersion === String(claim.android_version)) || {}).package,
      deviceModelId: String(claim.device_model || ''),
      avdName,
      avdHome,
      deviceDir,
      port,
      serial: 'emulator-' + port,
      state: 'provisioning',
      resolution: { width: 0, height: 0 },
      process: null,
      expectedStop: false,
      lastLog: '',
    };
    if (!meta.systemImage) throw new Error('This worker does not have Android ' + claim.android_version + ' installed and enabled.');
    if (!config.deviceModels.includes(meta.deviceModelId)) throw new Error('This worker does not support the requested device model.');
    await assertSystemImageInstalled(config, meta.systemImage);
    await mkdir(deviceDir, { recursive: true });
    await ensureAvd(config, meta);
    spawnEmulator(config, meta);
    const boot = await waitForBoot(config, meta);
    Object.assign(meta, boot);
    const deviceId = await callRpc(config, 'grixdroid_complete_device_request', {
      p_request_id: requestId,
      p_worker_id: config.workerId,
      p_lease_token: leaseToken,
      p_android_release: meta.androidRelease,
      p_device_model: meta.deviceModelId,
      p_runtime_handle: avdName,
      p_persistent_volume_ref: deviceDir,
      p_storage_bytes: 0,
    });
    const normalizedId = typeof deviceId === 'string' ? deviceId.replaceAll('"', '') : '';
    if (!UUID_RE.test(normalizedId)) throw new Error('Control plane did not return a valid cloud device id.');
    meta.cloudDeviceId = normalizedId;
    meta.state = 'running';
    await persistMeta(meta);
    instances.set(meta.cloudDeviceId, meta);
    try {
      await startWebRTCStream(config, meta);
    } catch (streamError) {
      await stopWebRTCStream(config, meta).catch(() => {});
      await setStreamState(config, meta, 'error', streamError instanceof Error ? streamError.message : String(streamError)).catch(() => {});
      process.stderr.write('[worker] WebRTC publisher failed for ' + meta.cloudDeviceId + ': ' + (streamError instanceof Error ? streamError.message : String(streamError)) + '\n');
    }
    await persistMeta(meta);
    process.stdout.write('[worker] Android device ready: ' + meta.name + ' (' + meta.cloudDeviceId + '), Android ' + (meta.androidRelease || 'unknown') + '\n');
  } catch (error) {
    if (meta?.process && meta.process.exitCode === null) {
      meta.expectedStop = true;
      meta.process.kill('SIGTERM');
    }
    await callRpc(config, 'grixdroid_fail_device_request', {
      p_request_id: requestId,
      p_worker_id: config.workerId,
      p_lease_token: leaseToken,
      p_reason: error instanceof Error ? error.message : 'Android worker failed.',
    }).catch((rpcError) => process.stderr.write('[worker] Could not report failure: ' + rpcError.message + '\n'));
    process.stderr.write('[worker] Provisioning failed for request ' + requestId + ': ' + (error instanceof Error ? error.message : String(error)) + '\n');
  } finally {
    if (leaseTimer) clearInterval(leaseTimer);
  }
}

async function heartbeatAndClaim(config, instances) {
  await callRpc(config, 'grixdroid_worker_heartbeat', {
    p_worker_id: config.workerId,
    p_label: config.workerLabel,
    p_capacity: config.capacity,
    p_capabilities: {
      provider: 'android-emulator',
      system_image: config.systemImage,
      system_images: config.systemImages.map((image) => ({
        android_version: image.androidVersion,
        api_level: image.apiLevel,
        package: image.package,
        has_play_store: image.hasPlayStore,
      })),
      device_models: config.deviceModels,
      acceleration: config.accel,
      gpu: config.gpu,
      persistent_data: true,
      api: 1,
    },
  });
  if ([...instances.values()].filter((item) => item.state === 'running' || item.state === 'starting').length >= config.capacity) return null;
  const result = await callRpc(config, 'grixdroid_claim_device_request', { p_worker_id: config.workerId });
  return Array.isArray(result) ? (result[0] || null) : result;
}

async function handleRequest(req, res, config, token, instances) {
  if (!cors(req, res, config)) return sendJson(res, 403, { error: 'Origin not allowed.' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
  const route = url.pathname.replace(/\/+$/, '') || '/';
  if (req.method === 'GET' && route === '/api/v1/health') {
    return sendJson(res, 200, {
      status: 'ok',
      provider: 'android-emulator-worker',
      platform: process.platform,
      activeDevices: [...instances.values()].filter((v) => v.state === 'running').length,
      capacity: config.capacity,
      acceleration: config.accel,
    });
  }
  if (!authorize(req, token)) return sendJson(res, 401, { error: 'Worker API token is required.' });

  if (req.method === 'GET' && route === '/api/v1/devices') {
    return sendJson(res, 200, { devices: [...instances.values()].map(publicDevice) });
  }

  const match = route.match(/^\/api\/v1\/devices\/([0-9a-f-]{36})(?:\/(start|stop|screenshot|actions))?$/i);
  if (!match || !UUID_RE.test(match[1])) return sendJson(res, 404, { error: 'Route not found.' });
  const id = match[1];
  const action = match[2] || '';
  const meta = instances.get(id);
  if (!meta) return sendJson(res, 404, { error: 'Device is not assigned to this worker.' });

  if (req.method === 'POST' && action === 'start') {
    if (meta.state === 'running') return sendJson(res, 200, { device: publicDevice(meta) });
    await startExisting(config, meta);
    await persistMeta(meta);
    return sendJson(res, 200, { device: publicDevice(meta) });
  }
  if (req.method === 'POST' && action === 'stop') {
    await stopDevice(config, meta);
    return sendJson(res, 200, { device: publicDevice(meta), dataPreserved: true });
  }
  if (req.method === 'GET' && action === 'screenshot') {
    const png = await readScreenshot(config, meta);
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
      'Content-Length': png.length,
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end(png);
  }
  if (req.method === 'POST' && action === 'actions') {
    const body = await readJson(req);
    await executeAction(config, meta, body);
    return sendJson(res, 200, { status: 'ok' });
  }
  return sendJson(res, 405, { error: 'Method not allowed.' });
}

export async function startCloudWorker(config = getWorkerConfig()) {
  if (!UUID_RE.test(config.workerId)) throw new Error('Set GRIXDROID_WORKER_ID to a UUID registered in grixdroid_private.workers.');
  if (!config.sdkRoot) throw new Error('Set ANDROID_SDK_ROOT to the Android SDK installation directory.');
  if (!config.controlUrl || !config.apiKey || !config.serviceRoleJwt) throw new Error('Set SUPABASE_URL, SUPABASE_API_KEY and SUPABASE_SERVICE_ROLE_JWT on the worker host. Keep both keys private and never expose them to the browser.');
  const remote = !['127.0.0.1', 'localhost', '::1'].includes(config.host);
  if (remote && (!config.allowRemote || config.apiToken.length < 32)) {
    throw new Error('Remote worker API binding requires GRIXDROID_WORKER_ALLOW_REMOTE=1 and a 32+ character GRIXDROID_WORKER_API_TOKEN behind HTTPS and a private network.');
  }
  if (config.accel === 'off' && !config.enableSoftwareEmulation) {
    throw new Error('Software CPU emulation is very slow. Set GRIXDROID_ENABLE_SOFTWARE_EMULATION=1 to explicitly opt in.');
  }
  const token = config.apiToken || randomBytes(32).toString('hex');
  await mkdir(config.devicesRoot, { recursive: true });

  if (config.scrcpyServerPath || config.whipBaseUrl || config.streamPublishToken) {
    if (!config.scrcpyServerPath || !config.scrcpyVersion || !config.whipBaseUrl || config.streamPublishToken.length < 32) {
      throw new Error('WebRTC requires SCRCPY_SERVER_PATH, SCRCPY_VERSION, GRIXDROID_WHIP_BASE_URL and a 32+ character GRIXDROID_STREAM_PUBLISH_TOKEN.');
    }
    const help = await run(config.ffmpeg, ['-hide_banner', '-h', 'muxer=whip']);
    if (!String(help.stdout).toLowerCase().includes('authorization')) throw new Error('The installed FFmpeg build must include the WHIP muxer with its authorization option.');
  }

  for (const image of config.systemImages) {
    await assertSystemImageInstalled(config, image.package);
  }
  await run(config.emulator, ['-version']);
  try {
    // avdmanager has no top-level --version flag. Use supported list
    // subcommands as non-destructive executable/SDK-tools health checks.
    await run(config.avdManager, ['list', 'avd']);
    const deviceCatalog = await run(config.avdManager, ['list', 'device', '-c']);
    const availableModels = new Set(String(deviceCatalog.stdout).split(/\r?\n/).map((value) => value.trim()).filter(Boolean));
    const missingModels = config.deviceModels.filter((model) => !availableModels.has(model));
    if (missingModels.length) throw new Error('Android SDK does not contain device model(s): ' + missingModels.join(', '));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error('Could not execute Android SDK avdmanager (' + config.avdManager + '): ' + detail + '. Install Android SDK Command-line Tools and ensure avdmanager is on PATH.');
  }
  if (config.accel !== 'off') {
    const accel = await run(config.emulator, ['-accel-check']).catch((error) => ({ stdout: 'acceleration check failed: ' + error.message }));
    if (config.accel === 'on' && /no accelerator|not installed|failed/i.test(String(accel.stdout))) {
      throw new Error('Hardware acceleration is unavailable. Install a supported hypervisor or use the explicit software-emulation development mode.');
    }
  }

  const instances = new Map();
  await loadPersistedDevices(config, instances);
  for (const meta of instances.values()) {
    if (meta.state !== 'running') continue;
    try {
      await startWebRTCStream(config, meta);
    } catch (streamError) {
      await stopWebRTCStream(config, meta).catch(() => {});
      await setStreamState(config, meta, 'error', streamError instanceof Error ? streamError.message : String(streamError)).catch(() => {});
    }
  }
  const server = http.createServer((req, res) => {
    void handleRequest(req, res, config, token, instances).catch((error) => {
      const status = Number(error.statusCode) || 500;
      if (!res.headersSent) sendJson(res, status, { error: error.message || 'Worker request failed.' });
      else res.destroy();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  process.stdout.write('[worker] API listening on http://' + config.host + ':' + config.port + '\n');
  if (!config.apiToken) process.stdout.write('[worker] Local API bearer token (shown once): ' + token + '\n');
  process.stdout.write('[worker] Data root: ' + config.dataRoot + '\n');
  process.stdout.write('[worker] Android image: ' + config.systemImage + '\n');
  process.stdout.write('[worker] Android API level: ' + image.apiLevel + ' | Play Store image: ' + (image.hasPlayStore ? 'required' : 'not included') + '\n');
  process.stdout.write('[worker] Acceleration: ' + config.accel + ' | GPU: ' + config.gpu + '\n');

  let stopping = false;
  let actionPollBusy = false;
  const actionTimer = setInterval(() => {
    if (stopping || actionPollBusy) return;
    if (![...instances.values()].some((meta) => meta.state === 'running')) return;
    actionPollBusy = true;
    void processQueuedDeviceActions(config, instances)
      .catch((error) => {
        process.stderr.write('[worker] Android input poll failed: ' +
          (error instanceof Error ? error.message : String(error)) + '\\n');
      })
      .finally(() => { actionPollBusy = false; });
  }, config.actionPollMs);
  actionTimer.unref();

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(actionTimer);
    server.close();
    process.stdout.write('[worker] Worker API stopped. Android devices and persistent volumes were left intact.\n');
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });

  while (!stopping) {
    try {
      const claim = await heartbeatAndClaim(config, instances);
      if (claim) {
        await bootClaim(config, claim, instances);
        continue;
      }
    } catch (error) {
      process.stderr.write('[worker] Control-plane poll failed: ' + (error instanceof Error ? error.message : String(error)) + '\n');
    }
    await delay(config.pollMs);
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  startCloudWorker().catch((error) => {
    process.stderr.write('[worker] Startup failed: ' + (error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  });
}
