#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { constants, accessSync, existsSync, mkdirSync, realpathSync, statfsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getWorkerConfig, parseSystemImagePackage } from './cloud-worker.mjs';

const execFileAsync = promisify(execFile);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const checks = [];
const add = (level, name, detail) => checks.push({ level, name, detail });
const within = (candidate, parent) => {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};

export function isEphemeralDataPath(value) {
  const resolved = path.resolve(value);
  return ['/tmp', '/var/tmp', '/run', '/dev/shm'].some((base) => within(resolved, base));
}

async function command(file, args) {
  return execFileAsync(file, args, { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true });
}

async function main() {
  const config = getWorkerConfig();
  add('info', 'Host platform', os.platform() + ' / ' + os.arch());

  if (process.platform !== 'linux') {
    add('fail', 'Linux worker host', 'This production worker profile expects Linux. Use a Linux host for the KVM deployment.');
  } else {
    add('pass', 'Linux worker host', 'Linux detected.');
  }

  if (process.platform === 'linux') {
    try {
      accessSync('/dev/kvm', constants.R_OK | constants.W_OK);
      add('pass', 'KVM device', '/dev/kvm is present and accessible to this worker user.');
    } catch {
      if (config.accel === 'off' && config.enableSoftwareEmulation) {
        add('warn', 'KVM device', 'Unavailable. Software emulation is explicitly enabled for development only; performance will be poor.');
      } else {
        add('fail', 'KVM device', 'No accessible /dev/kvm. Enable hardware virtualization and grant this service user access to the kvm group.');
      }
    }
  }

  if (!config.sdkRoot || !existsSync(config.sdkRoot)) {
    add('fail', 'Android SDK', 'Set ANDROID_SDK_ROOT to an installed Android SDK directory.');
  } else {
    add('pass', 'Android SDK', 'SDK directory exists.');
    for (const [name, file, args] of [
      ['Android Emulator', config.emulator, ['-version']],
      ['ADB Platform Tools', config.adb, ['version']],
      ['AVD Manager', config.avdManager, ['list', 'avd']],
    ]) {
      try {
        await command(file, args);
        add('pass', name, 'Executable is available.');
      } catch (error) {
        add('fail', name, (error?.message || String(error)).split('\n')[0]);
      }
    }

    try {
      const image = parseSystemImagePackage(config.systemImage);
      const imagePath = path.join(config.sdkRoot, image.relativePath);
      if (existsSync(path.join(imagePath, 'source.properties')) || existsSync(path.join(imagePath, 'package.xml'))) {
        add('pass', 'Android system image', config.systemImage + ' is installed.');
      } else {
        add('fail', 'Android system image', 'Install the configured image with sdkmanager: ' + config.systemImage);
      }
    } catch (error) {
      add('fail', 'Android system image', error.message);
    }

    if (config.accel !== 'off') {
      try {
        const result = await command(config.emulator, ['-accel-check']);
        add('pass', 'Emulator acceleration', (result.stdout || result.stderr || 'Hypervisor check passed.').trim().slice(0, 240));
      } catch (error) {
        add('fail', 'Emulator acceleration', 'The emulator could not confirm a usable hypervisor. ' + (error?.stderr || error?.message || '').toString().trim().slice(0, 240));
      }
    } else if (config.enableSoftwareEmulation) {
      add('warn', 'Emulator acceleration', 'Software mode selected. Do not use this for public/production sessions.');
    } else {
      add('fail', 'Emulator acceleration', 'Software mode requires GRIXDROID_ENABLE_SOFTWARE_EMULATION=1 and is development-only.');
    }
  }

  try {
    mkdirSync(config.dataRoot, { recursive: true, mode: 0o700 });
    const actual = realpathSync(config.dataRoot);
    accessSync(actual, constants.R_OK | constants.W_OK);
    if (isEphemeralDataPath(actual)) {
      add('fail', 'Persistent data directory', 'The resolved data directory is temporary (' + actual + '). Set GRIXDROID_DATA_ROOT to a durable mounted disk.');
    } else {
      const disk = statfsSync(actual);
      const freeBytes = disk.bavail * disk.bsize;
      add('pass', 'Persistent data directory', actual + ' is writable; free space: ' + (freeBytes / (1024 ** 3)).toFixed(1) + ' GiB.');
      if (freeBytes < 10 * 1024 ** 3) add('warn', 'Disk capacity', 'Less than 10 GiB is free. Check capacity before enabling device provisioning.');
    }
  } catch (error) {
    add('fail', 'Persistent data directory', 'Cannot create or write the data directory: ' + error.message);
  }

  if (!UUID_RE.test(config.workerId)) add('fail', 'Worker identity', 'Set GRIXDROID_WORKER_ID to the UUID registered in the private workers table.');
  else add('pass', 'Worker identity', 'Worker UUID is configured.');

  if (!config.controlUrl.startsWith('https://') || !config.apiKey || !config.serviceRoleJwt) {
    add('fail', 'Private control-plane credentials', 'Set HTTPS SUPABASE_URL, SUPABASE_API_KEY and SUPABASE_SERVICE_ROLE_JWT in the worker environment.');
  } else {
    add('pass', 'Private control-plane credentials', 'Server-side credentials are present. Values are not printed.');
  }

  const streamingRequested = Boolean(config.scrcpyServerPath || config.scrcpyVersion || config.whipBaseUrl || config.streamPublishToken);
  if (!streamingRequested) {
    add('warn', 'WebRTC streaming', 'Not configured. Android boot can work, but browser live video will remain disabled.');
  } else {
    if (!config.scrcpyServerPath || !existsSync(config.scrcpyServerPath) || !config.scrcpyVersion || !config.whipBaseUrl || config.streamPublishToken.length < 32) {
      add('fail', 'WebRTC streaming', 'Set a valid SCRCPY_SERVER_PATH, matching SCRCPY_VERSION, HTTPS GRIXDROID_WHIP_BASE_URL and a 32+ character publish token.');
    } else {
      try {
        const result = await command(config.ffmpeg, ['-hide_banner', '-h', 'muxer=whip']);
        if (!((result.stdout || '') + (result.stderr || '')).toLowerCase().includes('authorization')) {
          add('fail', 'FFmpeg WHIP support', 'This FFmpeg build does not advertise the WHIP authorization option.');
        } else {
          add('pass', 'FFmpeg WHIP support', 'WHIP muxer and authorization option are available.');
        }
      } catch (error) {
        add('fail', 'FFmpeg WHIP support', 'Cannot run FFmpeg WHIP check: ' + (error?.message || String(error)).split('\n')[0]);
      }
      let url;
      try { url = new URL(config.whipBaseUrl); } catch {}
      if (!url || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
        add('fail', 'WHIP endpoint', 'Use an HTTPS endpoint (HTTP is allowed only on localhost).');
      } else {
        add('pass', 'WHIP endpoint', 'Endpoint format is valid; network reachability is not tested by this doctor.');
      }
    }
  }

  const failed = checks.filter((item) => item.level === 'fail').length;
  const warned = checks.filter((item) => item.level === 'warn').length;
  for (const item of checks) {
    const tag = item.level.toUpperCase().padEnd(4);
    process.stdout.write('[' + tag + '] ' + item.name + ': ' + item.detail + '\n');
  }
  process.stdout.write('\n' + checks.length + ' checks · ' + (checks.length - failed - warned) + ' passed · ' + warned + ' warnings · ' + failed + ' failed\n');
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    process.stderr.write('[doctor] ' + (error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  });
}
