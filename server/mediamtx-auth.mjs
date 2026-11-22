#!/usr/bin/env node
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const PUBLISH_TOKEN = process.env.GRIXDROID_STREAM_PUBLISH_TOKEN || '';
const HOST = process.env.GRIXDROID_MEDIAMTX_AUTH_HOST || '127.0.0.1';
const PORT = Math.max(1024, Math.min(65535, Number(process.env.GRIXDROID_MEDIAMTX_AUTH_PORT) || 8890));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function equalSecret(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function send(res, status, body = '') {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end(body);
}

async function readJson(req) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 24 * 1024) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function getDeviceId(pathValue) {
  const parts = String(pathValue || '').replace(/^\/+/, '').split('/');
  return UUID_RE.test(parts[0] || '') ? parts[0] : null;
}

async function verifyViewer(deviceId, accessToken) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !accessToken) return false;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + accessToken,
  };
  const userResponse = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!userResponse.ok) return false;
  const user = await userResponse.json();
  if (!user || typeof user.id !== 'string') return false;

  const query = new URLSearchParams({
    select: 'id,state,stream_state',
    id: 'eq.' + deviceId,
    limit: '1',
  });
  const deviceResponse = await fetch(SUPABASE_URL + '/rest/v1/cloud_devices?' + query.toString(), {
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!deviceResponse.ok) return false;
  const devices = await deviceResponse.json();
  if (!Array.isArray(devices) || devices.length !== 1 ||
      devices[0].id !== deviceId || devices[0].state !== 'running' ||
      devices[0].stream_state !== 'ready') return false;

  // Device ownership alone is not enough: require a current, owner-scoped
  // worker session lease. Workers renew this short lease while the runtime is live.
  const sessionQuery = new URLSearchParams({
    select: 'id,state,expires_at',
    device_id: 'eq.' + deviceId,
    user_id: 'eq.' + user.id,
    state: 'eq.connected',
    expires_at: 'gt.' + new Date().toISOString(),
    limit: '1',
  });
  const sessionResponse = await fetch(SUPABASE_URL + '/rest/v1/cloud_device_sessions?' + sessionQuery.toString(), {
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!sessionResponse.ok) return false;
  const sessions = await sessionResponse.json();
  return Array.isArray(sessions) && sessions.some((session) =>
    session.state === 'connected' &&
    Date.parse(session.expires_at || '') > Date.now()
  );
}

async function handle(req, res) {
  const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, 'ok');
  }
  if (req.method !== 'POST' || url.pathname !== '/auth') return send(res, 404, 'not found');

  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, 'invalid request');
  }

  const action = String(body.action || '');
  const deviceId = getDeviceId(body.path);
  const token = typeof body.token === 'string' ? body.token : '';

  if (!deviceId) return send(res, 401, 'unauthorized');

  // Worker publishing credential. This is stored on trusted hosts only.
  if (action === 'publish') {
    if (equalSecret(token, PUBLISH_TOKEN)) return send(res, 200);
    return send(res, 401, 'unauthorized');
  }

  // Browser playback uses the signed-in user's own Supabase access token.
  if (action === 'read' || action === 'playback') {
    try {
      if (await verifyViewer(deviceId, token)) return send(res, 200);
    } catch {
      // Authentication failures are intentionally indistinguishable from missing access.
    }
    return send(res, 401, 'unauthorized');
  }

  return send(res, 401, 'unauthorized');
}

export function startMediaMtxAuthServer() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for viewer ownership checks.');
  if (PUBLISH_TOKEN.length < 32) throw new Error('Set GRIXDROID_STREAM_PUBLISH_TOKEN to a random secret of at least 32 characters.');
  if (!['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
    throw new Error('The MediaMTX auth callback must remain on loopback. Put it behind MediaMTX on the same host.');
  }

  const server = http.createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, 'internal error');
      else res.destroy();
    });
  });
  server.listen(PORT, HOST, () => {
    process.stdout.write('[grixdroid-media-auth] listening on http://' + HOST + ':' + PORT + '\n');
  });
  return server;
}

if (process.argv[1] && process.argv[1].endsWith('mediamtx-auth.mjs')) {
  try {
    startMediaMtxAuthServer();
  } catch (error) {
    process.stderr.write('[grixdroid-media-auth] ' + (error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  }
}
