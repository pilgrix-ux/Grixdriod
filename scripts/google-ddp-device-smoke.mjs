#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

export const GOOGLE_DDP_TARGETS = Object.freeze({
  samsung_galaxy_s22: { name: 'Samsung Galaxy S22', cliTarget: 'r0q/36', manufacturer: 'samsung', api: 36 },
  samsung_galaxy_s22_ultra: { name: 'Samsung Galaxy S22 Ultra', cliTarget: 'b0q/36', manufacturer: 'samsung', api: 36 },
  samsung_galaxy_s23: { name: 'Samsung Galaxy S23', cliTarget: 'dm1q/35', manufacturer: 'samsung', api: 35 },
  samsung_galaxy_s23_plus: { name: 'Samsung Galaxy S23+', cliTarget: 'dm2q/34', manufacturer: 'samsung', api: 34 },
  samsung_galaxy_s23_ultra: { name: 'Samsung Galaxy S23 Ultra', cliTarget: 'dm3q/34', manufacturer: 'samsung', api: 34 },
  samsung_galaxy_s24: { name: 'Samsung Galaxy S24', cliTarget: 'e1q/36', manufacturer: 'samsung', api: 36 },
  samsung_galaxy_s24_plus: { name: 'Samsung Galaxy S24+', cliTarget: 'e2q/36', manufacturer: 'samsung', api: 36 },
  samsung_galaxy_s24_ultra: { name: 'Samsung Galaxy S24 Ultra', cliTarget: 'e3q/36', manufacturer: 'samsung', api: 36 },
  oppo_a79_5g: { name: 'OPPO A79 5G', cliTarget: 'op573dl1/34', manufacturer: 'oppo', api: 34 },
  oppo_a38: { name: 'OPPO A38', cliTarget: 'op5759l1/34', manufacturer: 'oppo', api: 34 },
  xiaomi_14: { name: 'Xiaomi 14', cliTarget: 'houji/35', manufacturer: 'xiaomi', api: 35 },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function required(value, name) {
  const result = String(value || '').trim();
  if (!result || /^(replace_with|your[-_ ])/.test(result.toLowerCase())) {
    throw new Error('Set ' + name + ' before starting the real-device preflight.');
  }
  return result;
}

export function getGoogleDdpTarget(modelId) {
  const target = GOOGLE_DDP_TARGETS[String(modelId || '').trim().toLowerCase()];
  if (!target) {
    throw new Error('Unsupported Google DDP model. Choose one of: ' + Object.keys(GOOGLE_DDP_TARGETS).join(', '));
  }
  return target;
}

export function parseAdbDevices(output) {
  return String(output || '').split(/\r?\n/).slice(1).map((line) => {
    const match = line.trim().match(/^(\S+)\s+(device|offline|unauthorized)\b(.*)$/);
    if (!match) return null;
    return { serial: match[1], state: match[2], details: match[3] || '' };
  }).filter(Boolean);
}

export function parseReservationIds(output) {
  return [...new Set(String(output || '').split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z0-9][A-Za-z0-9_-]{5,}$/.test(line)))];
}

export function getNewIds(before, after) {
  const existing = new Set(before || []);
  return [...new Set(after || [])].filter((value) => !existing.has(value));
}

export function verifyGoogleDdpIdentity(target, identity) {
  const manufacturer = String(identity?.manufacturer || '').trim().toLowerCase();
  const api = Number.parseInt(String(identity?.apiLevel || ''), 10);
  const hardwareModel = String(identity?.hardwareModel || '').trim();
  const buildFingerprint = String(identity?.buildFingerprint || '').trim();
  if (!manufacturer.includes(target.manufacturer)) {
    throw new Error('Remote handset manufacturer mismatch: expected ' + target.manufacturer + ', received ' + (manufacturer || 'empty') + '.');
  }
  if (api !== target.api) {
    throw new Error('Remote handset Android API mismatch: expected ' + target.api + ', received ' + (Number.isFinite(api) ? api : 'unknown') + '.');
  }
  if (!hardwareModel || !buildFingerprint) {
    throw new Error('Remote handset did not return its hardware model and complete build fingerprint.');
  }
  if (String(identity.kernelQemu || '').trim() === '1' || String(identity.bootQemu || '').trim() === '1') {
    throw new Error('Google DDP target reported a virtualized Android runtime instead of physical OEM hardware.');
  }
  return {
    manufacturer,
    productModel: String(identity.productModel || '').trim(),
    hardwareModel,
    androidRelease: String(identity.androidRelease || '').trim(),
    apiLevel: api,
    buildFingerprint,
    resolution: String(identity.resolution || '').trim(),
  };
}

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      encoding: 'utf8',
      timeout: options.timeout || 30000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      env: options.env || process.env,
    });
  } catch (error) {
    const detail = String(error?.stderr || error?.stdout || error?.message || 'Command failed.').trim();
    throw new Error(command + ' ' + args.join(' ') + ' failed: ' + detail.slice(0, 900));
  }
}

function parseConfig(env) {
  const projectId = required(env.GRIXDROID_DDP_PROJECT_ID, 'GRIXDROID_DDP_PROJECT_ID');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new Error('GRIXDROID_DDP_PROJECT_ID must be a valid Google Cloud project ID.');
  }
  if (env.GRIXDROID_DDP_CONFIRM_BILLING !== 'yes') {
    throw new Error('This preflight creates a metered physical-device reservation. Set GRIXDROID_DDP_CONFIRM_BILLING=yes only after the Google Cloud billing owner approves the cost.');
  }
  return {
    projectId,
    target: getGoogleDdpTarget(env.GRIXDROID_DDP_MODEL),
    android: env.ANDROID_CLI_PATH || 'android',
    adb: env.ADB_PATH || (env.ANDROID_SDK_ROOT
      ? path.join(env.ANDROID_SDK_ROOT, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
      : 'adb'),
    readyTimeoutMs: Math.max(30000, Math.min(240000, Number(env.GRIXDROID_DDP_READY_TIMEOUT_MS) || 150000)),
  };
}

async function listReservations(config) {
  const result = await run(config.android, [
    'device', 'remote', 'list', '--all', '--short', '--project=' + config.projectId,
  ]);
  return parseReservationIds(result.stdout);
}

async function listAdbDevices(config) {
  const result = await run(config.adb, ['devices', '-l']);
  return parseAdbDevices(result.stdout).filter((item) => item.state === 'device');
}

async function waitForNewValue(readValues, before, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    last = getNewIds(before, await readValues());
    if (last.length === 1) return last[0];
    if (last.length > 1) {
      throw new Error('More than one new ' + label + ' appeared. Refusing to guess which resource belongs to this run.');
    }
    await sleep(2000);
  }
  throw new Error('Timed out waiting for the new ' + label + '. Last observed new values: ' + (last.join(', ') || 'none'));
}

async function readIdentity(config, serial) {
  const property = async (name) => (await run(config.adb, ['-s', serial, 'shell', 'getprop', name])).stdout.trim();
  const [manufacturer, productModel, hardwareModel, androidRelease, apiLevel, buildFingerprint, kernelQemu, bootQemu, resolution] = await Promise.all([
    property('ro.product.manufacturer'),
    property('ro.product.model'),
    property('ro.product.device'),
    property('ro.build.version.release'),
    property('ro.build.version.sdk'),
    property('ro.build.fingerprint'),
    property('ro.kernel.qemu'),
    property('ro.boot.qemu'),
    run(config.adb, ['-s', serial, 'shell', 'wm', 'size']).then((result) => {
      const matches = [...String(result.stdout).matchAll(/(?:Physical|Override) size:\\s*(\\d+x\\d+)/gi)];
      return matches.length ? matches[matches.length - 1][1] : '';
    }),
  ]);
  return verifyGoogleDdpIdentity(config.target, {
    manufacturer, productModel, hardwareModel, androidRelease, apiLevel, buildFingerprint, kernelQemu, bootQemu, resolution,
  });
}

async function releaseReservation(config, reservationId) {
  const issues = [];
  for (const subcommand of ['disconnect', 'remove']) {
    try {
      await run(config.android, [
        'device', 'remote', subcommand, reservationId, '--project=' + config.projectId,
      ], { timeout: 60000 });
    } catch (error) {
      issues.push(error.message);
    }
  }
  return issues;
}

export async function runGoogleDdpSmoke(env = process.env) {
  const config = parseConfig(env);
  const reservationsBefore = await listReservations(config);
  const adbBefore = (await listAdbDevices(config)).map((item) => item.serial);
  let reservationId = null;
  let primaryError = null;

  try {
    process.stdout.write('[grixdroid-ddp] Reserving ' + config.target.name + ' (' + config.target.cliTarget + ').\\n');
    await run(config.android, [
      'device', 'remote', 'create', config.target.cliTarget, '--project=' + config.projectId,
    ], { timeout: config.readyTimeoutMs + 30000 });

    reservationId = await waitForNewValue(
      () => listReservations(config),
      reservationsBefore,
      20000,
      'Google DDP reservation',
    );
    const serial = await waitForNewValue(
      async () => (await listAdbDevices(config)).map((item) => item.serial),
      adbBefore,
      config.readyTimeoutMs,
      'ADB device connection',
    );
    const identity = await readIdentity(config, serial);

    const report = {
      result: 'verified_physical_device',
      provider: 'google-developer-device-platform',
      modelId: env.GRIXDROID_DDP_MODEL,
      modelName: config.target.name,
      reservationId,
      adbSerial: serial,
      identity,
      note: 'Preflight only. This reservation is not enrolled as a GRIXDroid customer worker.',
    };
    process.stdout.write(JSON.stringify(report, null, 2) + '\\n');
    return report;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (!reservationId) {
      try {
        const after = await listReservations(config);
        const created = getNewIds(reservationsBefore, after);
        if (created.length === 1) reservationId = created[0];
        else if (created.length > 1) {
          process.stderr.write('[grixdroid-ddp] Multiple new reservations detected; no reservation was removed automatically. Review and remove them in the Google Cloud account.\\n');
        }
      } catch (cleanupError) {
        process.stderr.write('[grixdroid-ddp] Could not enumerate reservations during cleanup: ' + cleanupError.message + '\\n');
      }
    }
    if (reservationId) {
      const cleanupIssues = await releaseReservation(config, reservationId);
      if (cleanupIssues.length) {
        process.stderr.write('[grixdroid-ddp] Reservation cleanup needs attention: ' + cleanupIssues.join(' | ') + '\\n');
      } else {
        process.stdout.write('[grixdroid-ddp] Remote reservation disconnected and removed.\\n');
      }
    }
    if (primaryError) process.stderr.write('[grixdroid-ddp] Preflight failed; the reservation cleanup was attempted.\\n');
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  runGoogleDdpSmoke().catch((error) => {
    process.stderr.write('[grixdroid-ddp] ' + error.message + '\\n');
    process.exitCode = 1;
  });
}
