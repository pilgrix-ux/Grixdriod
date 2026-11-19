#!/usr/bin/env node
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);
const ADB = process.env.ADB_PATH || 'adb';
const MAX_APK_BYTES = 100 * 1024 * 1024;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const remote = !['127.0.0.1', 'localhost', '::1'].includes(HOST);

if (remote && process.env.GRIXDROID_ALLOW_REMOTE !== '1') {
  throw new Error('Remote binding is disabled. Set GRIXDROID_ALLOW_REMOTE=1 only after configuring access controls.');
}
const API_TOKEN = process.env.GRIXDROID_API_TOKEN || '';
if (remote && API_TOKEN.length < 24) {
  throw new Error('Remote binding requires GRIXDROID_API_TOKEN with at least 24 characters.');
}
const allowedOrigins = new Set(
  (process.env.GRIXDROID_CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map(value => value.trim()).filter(Boolean),
);
const sessions = new Map();

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!allowedOrigins.has(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-APK-Filename');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  return true;
}

function authorized(req) {
  if (!remote) return true;
  const header = req.headers.authorization || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  return supplied.length > 0 && supplied === API_TOKEN;
}

async function run(args, options = {}) {
  try {
    const result = await execFileAsync(ADB, args, {
      encoding: 'utf8',
      timeout: options.timeout || 15000,
      maxBuffer: options.maxBuffer || 2 * 1024 * 1024,
      windowsHide: true,
    });
    return result.stdout || '';
  } catch (error) {
    const stderr = error && error.stderr ? String(error.stderr).trim() : '';
    throw new Error(stderr || (error && error.message) || 'ADB command failed');
  }
}

async function runBuffer(args, maxBuffer = 12 * 1024 * 1024) {
  try {
    const result = await execFileAsync(ADB, args, {
      encoding: 'buffer',
      timeout: 15000,
      maxBuffer,
      windowsHide: true,
    });
    return result.stdout;
  } catch (error) {
    const stderr = error && error.stderr ? String(error.stderr).trim() : '';
    throw new Error(stderr || (error && error.message) || 'ADB screenshot failed');
  }
}

function parseResolution(raw) {
  const matches = [...raw.matchAll(/(\d+)\s*x\s*(\d+)/g)];
  const match = matches[matches.length - 1];
  if (!match) return { width: 0, height: 0 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function listDevices() {
  const output = await run(['devices', '-l']);
  const devices = [];
  for (const line of output.split(/\r?\n/).slice(1)) {
    const match = line.trim().match(/^(\S+)\s+(device|offline|unauthorized)\b(.*)$/);
    if (!match || match[2] !== 'device') continue;
    const serial = match[1];
    const model = await run(['-s', serial, 'shell', 'getprop', 'ro.product.model']);
    const version = await run(['-s', serial, 'shell', 'getprop', 'ro.build.version.release']);
    const sdk = await run(['-s', serial, 'shell', 'getprop', 'ro.build.version.sdk']);
    const wm = await run(['-s', serial, 'shell', 'wm', 'size']);
    const playStore = await run(['-s', serial, 'shell', 'pm', 'path', 'com.android.vending']).catch(() => '');
    const playServices = await run(['-s', serial, 'shell', 'pm', 'path', 'com.google.android.gms']).catch(() => '');
    devices.push({
      serial,
      model: model.trim() || 'Android device',
      androidVersion: version.trim() || 'Unknown',
      sdk: sdk.trim() || 'Unknown',
      resolution: parseResolution(wm),
      hasPlayStore: playStore.trim().length > 0,
      hasGooglePlayServices: playServices.trim().length > 0,
    });
  }
  return devices;
}

function getSession(id) {
  const session = sessions.get(id);
  if (!session) {
    const error = new Error('Session not found or expired. Connect the Android device again.');
    error.statusCode = 404;
    throw error;
  }
  session.lastActiveAt = Date.now();
  return session;
}

function validatePackageName(value) {
  return typeof value === 'string' &&
    value.length <= 180 &&
    /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(value);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32 * 1024) {
      const error = new Error('JSON request is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON body.');
    error.statusCode = 400;
    throw error;
  }
}

async function installApk(req, session) {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'grixdroid-apk-'));
  const apkPath = path.join(tempDir, 'upload.apk');
  let total = 0;
  const source = async function* () {
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX_APK_BYTES) {
        const error = new Error('APK exceeds the 100 MB upload limit.');
        error.statusCode = 413;
        throw error;
      }
      yield chunk;
    }
  };

  try {
    if (Number(req.headers['content-length'] || 0) > MAX_APK_BYTES) {
      const error = new Error('APK exceeds the 100 MB upload limit.');
      error.statusCode = 413;
      throw error;
    }
    await pipeline(Readable.from(source()), createWriteStream(apkPath, { flags: 'wx' }));
    if (total < 4) throw new Error('The uploaded file is empty or not a valid APK.');
    const handle = await open(apkPath, 'r');
    const signature = Buffer.alloc(4);
    await handle.read(signature, 0, 4, 0);
    await handle.close();
    if (signature[0] !== 0x50 || signature[1] !== 0x4b) throw new Error('The file does not look like an APK/ZIP archive.');
    const output = await run(['-s', session.serial, 'install', '-r', apkPath], {
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    });
    if (!/Success/i.test(output)) throw new Error(output.trim() || 'ADB did not confirm installation.');
    return { message: 'APK installed successfully on the connected Android device.', bytes: total };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function handle(req, res) {
  if (!cors(req, res)) return sendJson(res, 403, { error: 'This website origin is not allowed by the bridge.' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  if (!authorized(req)) return sendJson(res, 401, { error: 'A valid bridge access token is required.' });

  const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && pathname === '/api/v1/health') {
    const version = await run(['version']);
    return sendJson(res, 200, { status: 'ok', adb: version.trim(), host: os.platform() });
  }

  if (req.method === 'GET' && pathname === '/api/v1/devices') {
    return sendJson(res, 200, { devices: await listDevices() });
  }

  if (req.method === 'POST' && pathname === '/api/v1/sessions') {
    const body = await readJson(req);
    const devices = await listDevices();
    const device = devices.find(item => item.serial === body.deviceSerial) || devices[0];
    if (!device) return sendJson(res, 409, { error: 'No authorized ADB device is connected to this bridge host.' });
    for (const [oldId, existing] of sessions) {
      if (existing.serial === device.serial) sessions.delete(oldId);
    }
    const session = { id: randomUUID(), serial: device.serial, device, lastActiveAt: Date.now() };
    sessions.set(session.id, session);
    return sendJson(res, 201, {
      id: session.id,
      status: 'connected',
      device,
      expiresAt: new Date(Date.now() + SESSION_IDLE_MS).toISOString(),
    });
  }

  const match = pathname.match(/^\/api\/v1\/sessions\/([a-f0-9-]+)(?:\/(screenshot|actions|apk|launch|packages|logs))?$/i);
  if (match) {
    const id = match[1];
    const action = match[2] || '';
    if (req.method === 'DELETE' && !action) {
      sessions.delete(id);
      return sendJson(res, 200, { status: 'closed' });
    }
    const session = getSession(id);

    if (req.method === 'GET' && action === 'screenshot') {
      const png = await runBuffer(['-s', session.serial, 'exec-out', 'screencap', '-p']);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Content-Length': png.length,
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(png);
    }

    if (req.method === 'POST' && action === 'actions') {
      const body = await readJson(req);
      const width = session.device.resolution.width;
      const height = session.device.resolution.height;
      if (body.type === 'tap') {
        const x = Number(body.x);
        const y = Number(body.y);
        if (![x, y].every(value => Number.isFinite(value) && value >= 0 && value <= 1) || !width || !height) {
          return sendJson(res, 400, { error: 'Invalid touch coordinates or unknown device resolution.' });
        }
        await run(['-s', session.serial, 'shell', 'input', 'tap', String(Math.round(x * width)), String(Math.round(y * height))]);
      } else if (body.type === 'swipe') {
        const values = [body.x, body.y, body.endX, body.endY].map(Number);
        const duration = Math.max(100, Math.min(1000, Number(body.durationMs) || 250));
        if (!values.every(value => Number.isFinite(value) && value >= 0 && value <= 1) || !width || !height) {
          return sendJson(res, 400, { error: 'Invalid swipe coordinates or unknown device resolution.' });
        }
        await run(['-s', session.serial, 'shell', 'input', 'swipe',
          String(Math.round(values[0] * width)), String(Math.round(values[1] * height)),
          String(Math.round(values[2] * width)), String(Math.round(values[3] * height)), String(duration)]);
      } else if (body.type === 'key') {
        const keyCodes = { BACK: '4', HOME: '3', APP_SWITCH: '187', ENTER: '66', VOLUME_UP: '24', VOLUME_DOWN: '25' };
        const code = keyCodes[body.key];
        if (!code) return sendJson(res, 400, { error: 'Unsupported Android key.' });
        await run(['-s', session.serial, 'shell', 'input', 'keyevent', code]);
      } else if (body.type === 'text') {
        if (typeof body.text !== 'string' || body.text.length > 120 || !/^[A-Za-z0-9 .,!?@_:/+\-]*$/.test(body.text)) {
          return sendJson(res, 400, { error: 'Text contains unsupported characters or exceeds 120 characters.' });
        }
        await run(['-s', session.serial, 'shell', 'input', 'text', body.text.replace(/ /g, '%s')]);
      } else {
        return sendJson(res, 400, { error: 'Unsupported device action.' });
      }
      return sendJson(res, 200, { status: 'ok' });
    }

    if (req.method === 'PUT' && action === 'apk') {
      return sendJson(res, 200, await installApk(req, session));
    }

    if (req.method === 'POST' && action === 'launch') {
      const body = await readJson(req);
      if (!validatePackageName(body.packageName)) return sendJson(res, 400, { error: 'Invalid Android package name.' });
      await run(['-s', session.serial, 'shell', 'monkey', '-p', body.packageName, '1']);
      return sendJson(res, 200, { message: 'Launched ' + body.packageName + '.' });
    }

    if (req.method === 'GET' && action === 'packages') {
      const output = await run(['-s', session.serial, 'shell', 'pm', 'list', 'packages', '-3']);
      const packages = output.split(/\r?\n/)
        .map(line => line.trim().replace(/^package:/, ''))
        .filter(validatePackageName)
        .sort();
      return sendJson(res, 200, { packages });
    }

    if (req.method === 'GET' && action === 'logs') {
      const logs = await run(['-s', session.serial, 'logcat', '-d', '-t', '120'], {
        timeout: 20000,
        maxBuffer: 1024 * 1024,
      });
      return sendJson(res, 200, { logs: logs.slice(-80000) });
    }
  }

  return sendJson(res, 404, { error: 'Endpoint not found.' });
}

const server = http.createServer((req, res) => {
  void handle(req, res).catch(error => {
    const status = Number(error.statusCode) || 500;
    const detail = status >= 500
      ? 'Android bridge command failed. Check the bridge terminal and ADB device status.'
      : error.message;
    sendJson(res, status, { error: detail });
  });
});

server.listen(PORT, HOST, () => {
  console.log('GRIXDroid ADB bridge listening at http://' + HOST + ':' + PORT);
  console.log('ADB executable: ' + ADB);
  console.log(remote ? 'Remote mode enabled: protect this host, token and allowed origins.' : 'Loopback mode: only this machine can connect.');
  console.log('Attach an Android phone with USB debugging enabled or start an Android Emulator, then connect from the GRIXDroid website.');
});

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActiveAt > SESSION_IDLE_MS) sessions.delete(id);
  }
}, 60_000).unref();

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
