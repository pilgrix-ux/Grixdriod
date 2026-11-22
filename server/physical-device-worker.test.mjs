import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expectedManufacturer,
  getPhysicalWorkerConfig,
  packagesToRemove,
  parseAdbDeviceList,
  validatePhysicalIdentity,
} from './physical-device-worker.mjs';

const UUID = '11111111-1111-4111-8111-111111111111';

function validEnv(overrides = {}) {
  return {
    GRIXDROID_WORKER_ID: UUID,
    GRIXDROID_PHYSICAL_DEVICE_MODEL: 'samsung_galaxy_s22',
    GRIXDROID_PHYSICAL_DEVICE_SERIAL: 'R58N123456A',
    GRIXDROID_PHYSICAL_ANDROID_VERSION: '14',
    GRIXDROID_PHYSICAL_PRODUCT_MODEL: 'SM-S901B',
    GRIXDROID_PHYSICAL_HARDWARE_MODEL: 'dm1q',
    GRIXDROID_PHYSICAL_BUILD_FINGERPRINT: 'samsung/dm1qxxx/dm1q:14/UP1A.231005.007/S901BXXU9:user/release-keys',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_API_KEY: 'sb_secret_test_only',
    SUPABASE_SERVICE_ROLE_JWT: 'test-service-role-jwt',
    SCRCPY_SERVER_PATH: '/opt/scrcpy/scrcpy-server.jar',
    SCRCPY_VERSION: '3.3.3',
    GRIXDROID_WHIP_BASE_URL: 'https://stream.example.test',
    GRIXDROID_STREAM_PUBLISH_TOKEN: '0123456789abcdef0123456789abcdef',
    GRIXDROID_PHYSICAL_ENABLE_RESET: '1',
    ...overrides,
  };
}

function validIdentity(overrides = {}) {
  return {
    manufacturer: 'samsung',
    productModel: 'SM-S901B',
    hardwareModel: 'dm1q',
    buildFingerprint: 'samsung/dm1qxxx/dm1q:14/UP1A.231005.007/S901BXXU9:user/release-keys',
    androidVersion: '14',
    kernelQemu: '0',
    bootQemu: '0',
    board: 'taro',
    resolution: { width: 1080, height: 2340 },
    ...overrides,
  };
}

test('maps only the approved physical OEM target identifiers', () => {
  assert.equal(expectedManufacturer('samsung_galaxy_s22'), 'samsung');
  assert.equal(expectedManufacturer('samsung_galaxy_s24_ultra'), 'samsung');
  assert.equal(expectedManufacturer('oppo_find_x8_pro'), 'oppo');
  assert.equal(expectedManufacturer('xiaomi_14_ultra'), 'xiaomi');
  assert.equal(expectedManufacturer('pixel_7'), null);
});

test('physical worker configuration requires an allowlisted OEM and a pinned USB serial', () => {
  const config = getPhysicalWorkerConfig(validEnv());
  assert.equal(config.deviceModelId, 'samsung_galaxy_s22');
  assert.equal(config.manufacturer, 'samsung');
  assert.equal(config.serial, 'R58N123456A');
  assert.equal(config.port, 8790);
  assert.equal(config.enableReset, true);
  assert.throws(() => getPhysicalWorkerConfig(validEnv({ GRIXDROID_PHYSICAL_DEVICE_MODEL: 'pixel_7' })), /allowlist/);
  assert.throws(() => getPhysicalWorkerConfig(validEnv({ GRIXDROID_PHYSICAL_DEVICE_SERIAL: '192.0.2.4:5555' })), /pinned USB ADB serial/);
  assert.throws(() => getPhysicalWorkerConfig(validEnv({ GRIXDROID_PHYSICAL_ANDROID_VERSION: '17' })), /must be one of 12, 12L, 13, 14, 15 or 16/);
});

test('reset remains disabled unless the operator explicitly opts in', () => {
  const config = getPhysicalWorkerConfig(validEnv({ GRIXDROID_PHYSICAL_ENABLE_RESET: '0' }));
  assert.equal(config.enableReset, false);
});

test('requires HTTPS for remote streaming and a long publish credential', () => {
  assert.throws(() => getPhysicalWorkerConfig(validEnv({ GRIXDROID_WHIP_BASE_URL: 'http://stream.example.test' })), /requires HTTPS/);
  assert.throws(() => getPhysicalWorkerConfig(validEnv({ GRIXDROID_STREAM_PUBLISH_TOKEN: 'short' })), /at least 32 characters/);
});

test('parses only device records from adb devices output', () => {
  assert.deepEqual(
    parseAdbDeviceList(
      'List of devices attached\nR58N123456A device usb:1-1 product:dm1q model:SM_S901B device:dm1q transport_id:1\nemulator-5554 device product:sdk_gphone64_x86_64\nbad unauthorized usb:1-2\n',
    ),
    [
      { serial: 'R58N123456A', state: 'device', details: ' usb:1-1 product:dm1q model:SM_S901B device:dm1q transport_id:1' },
      { serial: 'emulator-5554', state: 'device', details: ' product:sdk_gphone64_x86_64' },
      { serial: 'bad', state: 'unauthorized', details: ' usb:1-2' },
    ],
  );
});

test('accepts a handset only when the pinned identity matches every configured field', () => {
  const config = getPhysicalWorkerConfig(validEnv());
  const identity = validatePhysicalIdentity(config, validIdentity());
  assert.equal(identity.manufacturer, 'samsung');
  assert.equal(identity.productModel, 'SM-S901B');
  assert.equal(identity.androidVersion, '14');
  assert.deepEqual(identity.resolution, { width: 1080, height: 2340 });
});

test('rejects a mismatched brand, model, build, release or virtual runtime', () => {
  const config = getPhysicalWorkerConfig(validEnv());
  assert.throws(() => validatePhysicalIdentity(config, validIdentity({ manufacturer: 'google' })), /manufacturer/);
  assert.throws(() => validatePhysicalIdentity(config, validIdentity({ productModel: 'SM-S911B' })), /product model/);
  assert.throws(() => validatePhysicalIdentity(config, validIdentity({ hardwareModel: 'dm2q' })), /hardware model/);
  assert.throws(() => validatePhysicalIdentity(config, validIdentity({ buildFingerprint: 'different/build/fingerprint' })), /fingerprint/);
  assert.throws(() => validatePhysicalIdentity(config, validIdentity({ androidVersion: '15' })), /Android release/);
  assert.throws(() => validatePhysicalIdentity(config, validIdentity({ kernelQemu: '1' })), /virtual Android/);
});

test('cleanup removes only newly installed, syntactically safe package names', () => {
  assert.deepEqual(
    packagesToRemove(
      ['com.example.baseline', 'com.example.session', 'com.example.session', 'bad;rm', '../unsafe', 'org.sample.app'],
      ['com.example.baseline'],
    ),
    ['com.example.session', 'org.sample.app'],
  );
});
