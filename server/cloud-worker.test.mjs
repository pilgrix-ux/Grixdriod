import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { androidVersionForApiLevel, getWorkerConfig, parseResolution, parseSystemImagePackage, resolveAvdManagerPath, validateAction } from './cloud-worker.mjs';

test('normalizes tap coordinates without accepting values outside the screen', () => {
  assert.deepEqual(validateAction({ type: 'tap', x: 0.5, y: 0.25 }), { type: 'tap', x: 0.5, y: 0.25 });
  assert.throws(() => validateAction({ type: 'tap', x: 1.01, y: 0 }), /between 0 and 1/);
  assert.throws(() => validateAction({ type: 'tap', x: NaN, y: 0 }), /between 0 and 1/);
});

test('normalizes swipe duration and validates every coordinate', () => {
  assert.deepEqual(
    validateAction({ type: 'swipe', x: 0, y: 0.2, endX: 1, endY: 0.9, durationMs: 5000 }),
    { type: 'swipe', x: 0, y: 0.2, endX: 1, endY: 0.9, durationMs: 1500 },
  );
  assert.throws(() => validateAction({ type: 'swipe', x: 0, y: 0, endX: 2, endY: 1 }), /between 0 and 1/);
});

test('accepts only the Android navigation and power key allowlist', () => {
  assert.deepEqual(validateAction({ type: 'key', key: 'HOME' }), { type: 'key', key: 'HOME', code: '3' });
  assert.deepEqual(validateAction({ type: 'key', key: 'POWER' }), { type: 'key', key: 'POWER', code: '26' });
  assert.throws(() => validateAction({ type: 'key', key: 'SHELL' }), /Supported keys/);
});

test('validates Android rotation, dark mode and font-size controls', () => {
  assert.deepEqual(validateAction({ type: 'rotate', orientation: 'landscape' }), { type: 'rotate', orientation: 'landscape' });
  assert.throws(() => validateAction({ type: 'rotate', orientation: 'upside-down' }), /portrait or landscape/);
  assert.deepEqual(validateAction({ type: 'night_mode', enabled: true }), { type: 'night_mode', enabled: true });
  assert.throws(() => validateAction({ type: 'night_mode', enabled: 'yes' }), /true or false/);
  assert.deepEqual(validateAction({ type: 'font_scale', scale: 1.15 }), { type: 'font_scale', scale: 1.15 });
  assert.throws(() => validateAction({ type: 'font_scale', scale: 2 }), /between 0.85 and 1.3/);
});

test('validates private APK storage paths and file names', () => {
  const uid = '11111111-1111-4111-8111-111111111111';
  const device = '22222222-2222-4222-8222-222222222222';
  const id = '33333333-3333-4333-8333-333333333333';
  assert.deepEqual(validateAction({
    type: 'install_apk',
    object_path: uid + '/' + device + '/' + id + '.apk',
    filename: 'demo.apk',
  }), {
    type: 'install_apk',
    object_path: uid + '/' + device + '/' + id + '.apk',
    filename: 'demo.apk',
  });
  assert.throws(() => validateAction({
    type: 'install_apk',
    object_path: uid + '/../' + id + '.apk',
    filename: 'demo.apk',
  }), /storage path is invalid/);
  assert.throws(() => validateAction({
    type: 'install_apk',
    object_path: uid + '/' + device + '/' + id + '.apk',
    filename: 'demo; reboot.apk',
  }), /valid .apk filename/);
});

test('text action rejects shell metacharacters and escapes spaces for Android input', () => {
  assert.deepEqual(validateAction({ type: 'text', text: 'hello world_1' }), { type: 'text', text: 'hello%sworld_1' });
  assert.throws(() => validateAction({ type: 'text', text: 'hello; reboot' }), /basic letters/);
  assert.throws(() => validateAction({ type: 'text', text: '' }), /basic letters/);
});

test('reads the final active display resolution from adb output', () => {
  assert.deepEqual(parseResolution('Physical size: 1080x2400\nOverride size: 720 x 1600'), { width: 720, height: 1600 });
  assert.deepEqual(parseResolution('unknown'), { width: 0, height: 0 });
});

test('maps Android API levels to selectable Android releases', () => {
  assert.equal(androidVersionForApiLevel(31), '12');
  assert.equal(androidVersionForApiLevel(32), '12L');
  assert.equal(androidVersionForApiLevel(33), '13');
  assert.equal(androidVersionForApiLevel(34), '14');
  assert.equal(androidVersionForApiLevel(35), '15');
  assert.equal(androidVersionForApiLevel(36), '16');
  assert.throws(() => androidVersionForApiLevel(37), /supported GRIXDroid range/);
});

test('parses the official Google Play Android Emulator system image', () => {
  assert.deepEqual(parseSystemImagePackage('system-images;android-35;google_apis_playstore;x86_64'), {
    apiLevel: 35,
    target: 'google_apis_playstore',
    abi: 'x86_64',
    relativePath: path.join('system-images', 'android-35', 'google_apis_playstore', 'x86_64'),
    hasPlayStore: true,
  });
  assert.equal(parseSystemImagePackage('system-images;android-35;google_apis;x86_64').hasPlayStore, false);
  assert.throws(() => parseSystemImagePackage('system-images;android-35;../bad;x86_64'), /must look like/);
});

test('worker config clamps capacity and keeps its API loopback-only by default', () => {
  const config = getWorkerConfig({
    ANDROID_SDK_ROOT: '/opt/android-sdk',
    GRIXDROID_DATA_ROOT: '/var/lib/grixdroid',
    GRIXDROID_MAX_DEVICES: '90',
  });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.capacity, 4);
  assert.equal(config.sdkRoot, '/opt/android-sdk');
  assert.equal(config.dataRoot, path.resolve('/var/lib/grixdroid'));
  assert.match(config.adb, /platform-tools/);
  assert.equal(config.systemImage, 'system-images;android-35;google_apis_playstore;x86_64');
  assert.deepEqual(config.systemImages.map((image) => image.androidVersion), ['15']);
  assert.deepEqual(config.deviceModels, ['pixel_7']);
});

test('worker config exposes only the Android images and device models installed by its operator', () => {
  const config = getWorkerConfig({
    GRIXDROID_SYSTEM_IMAGES: [
      'system-images;android-34;google_apis_playstore;x86_64',
      'system-images;android-35;google_apis_playstore;x86_64',
      'system-images;android-36;google_apis_playstore;x86_64',
    ].join(','),
    GRIXDROID_DEVICE_MODELS: 'pixel_7,pixel_8,pixel_9,samsung_galaxy_s22,samsung_galaxy_s23,samsung_galaxy_s24,samsung_galaxy_s24_ultra,oppo_find_x8_pro,xiaomi_14_ultra',
  });
  assert.deepEqual(config.systemImages.map((image) => image.androidVersion), ['14', '15', '16']);
  assert.deepEqual(config.deviceModels, [
    'pixel_7', 'pixel_8', 'pixel_9',
    'samsung_galaxy_s22', 'samsung_galaxy_s23', 'samsung_galaxy_s24', 'samsung_galaxy_s24_ultra',
    'oppo_find_x8_pro', 'xiaomi_14_ultra',
  ]);
  assert.throws(() => getWorkerConfig({ GRIXDROID_SYSTEM_IMAGES: 'system-images;android-37;google_apis;x86_64' }), /supported GRIXDroid range/);
  assert.throws(() => getWorkerConfig({ GRIXDROID_DEVICE_MODELS: 'pixel_7; rm -rf' }), /supported Android virtual device profile IDs/);
});

test('finds avdmanager in versioned Android SDK command-line tools directories', () => {
  const sdkRoot = mkdtempSync(path.join(os.tmpdir(), 'grixdroid-sdk-tools-'));
  try {
    const older = path.join(sdkRoot, 'cmdline-tools', '12.0', 'bin', 'avdmanager');
    const newer = path.join(sdkRoot, 'cmdline-tools', '19.0', 'bin', 'avdmanager');
    mkdirSync(path.dirname(older), { recursive: true });
    mkdirSync(path.dirname(newer), { recursive: true });
    writeFileSync(older, '');
    writeFileSync(newer, '');

    assert.equal(resolveAvdManagerPath(sdkRoot), newer);
    assert.equal(
      getWorkerConfig({ ANDROID_SDK_ROOT: sdkRoot }).avdManager,
      newer,
    );
  } finally {
    rmSync(sdkRoot, { recursive: true, force: true });
  }
});

test('falls back to avdmanager on PATH when the SDK folder has no command-line tools', () => {
  const sdkRoot = mkdtempSync(path.join(os.tmpdir(), 'grixdroid-sdk-empty-'));
  try {
    assert.equal(resolveAvdManagerPath(sdkRoot), 'avdmanager');
  } finally {
    rmSync(sdkRoot, { recursive: true, force: true });
  }
});

test('prefers the SDK latest alias and honors an explicit avdmanager override', () => {
  const sdkRoot = mkdtempSync(path.join(os.tmpdir(), 'grixdroid-sdk-latest-'));
  try {
    const latest = path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'avdmanager');
    const versioned = path.join(sdkRoot, 'cmdline-tools', '19.0', 'bin', 'avdmanager');
    mkdirSync(path.dirname(latest), { recursive: true });
    mkdirSync(path.dirname(versioned), { recursive: true });
    writeFileSync(latest, '');
    writeFileSync(versioned, '');

    assert.equal(resolveAvdManagerPath(sdkRoot), latest);
    assert.equal(resolveAvdManagerPath(sdkRoot, '/custom/sdk-tools/avdmanager'), '/custom/sdk-tools/avdmanager');
  } finally {
    rmSync(sdkRoot, { recursive: true, force: true });
  }
});

test('worker config bounds the independent Android input polling interval', () => {
  assert.equal(getWorkerConfig({}).actionPollMs, 350);
  assert.equal(getWorkerConfig({ GRIXDROID_ACTION_POLL_MS: '50' }).actionPollMs, 100);
  assert.equal(getWorkerConfig({ GRIXDROID_ACTION_POLL_MS: '9000' }).actionPollMs, 2000);
});

test('worker config keeps the modern Supabase API key separate from its service-role JWT', () => {
  const config = getWorkerConfig({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_API_KEY: 'sb_secret_test_only',
    SUPABASE_SERVICE_ROLE_JWT: 'legacy_service_role_jwt_test_only',
  });
  assert.equal(config.apiKey, 'sb_secret_test_only');
  assert.equal(config.serviceRoleJwt, 'legacy_service_role_jwt_test_only');
});

test('worker config supports the legacy service-role key as a temporary fallback', () => {
  const config = getWorkerConfig({ SUPABASE_SERVICE_ROLE_KEY: 'legacy_service_role_key_test_only' });
  assert.equal(config.apiKey, 'legacy_service_role_key_test_only');
  assert.equal(config.serviceRoleJwt, 'legacy_service_role_key_test_only');
});

test('worker config refuses unknown accelerator modes', () => {
  assert.throws(() => getWorkerConfig({ GRIXDROID_ACCEL: 'turbo' }), /must be auto, on or off/);
});
