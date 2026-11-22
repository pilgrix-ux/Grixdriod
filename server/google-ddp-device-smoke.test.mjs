import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getGoogleDdpTarget,
  getNewIds,
  parseAdbDevices,
  parseReservationIds,
  verifyGoogleDdpIdentity,
} from '../scripts/google-ddp-device-smoke.mjs';

test('Google DDP maps actual Samsung, OPPO and Xiaomi physical targets', () => {
  assert.equal(getGoogleDdpTarget('samsung_galaxy_s23').cliTarget, 'dm1q/35');
  assert.equal(getGoogleDdpTarget('oppo_a79_5g').cliTarget, 'op573dl1/34');
  assert.equal(getGoogleDdpTarget('xiaomi_14').cliTarget, 'houji/35');
});

test('Google DDP rejects profiles that are not in the published physical-device list', () => {
  assert.throws(() => getGoogleDdpTarget('oppo_find_x8_pro'), /Unsupported Google DDP model/);
});

test('ADB device parsing ignores the header and keeps device states', () => {
  const devices = parseAdbDevices([
    'List of devices attached',
    'emulator-5554 device product:sdk_gphone64_x86_64',
    'localhost:41237 device product:dm1q model:SM_S911B',
    'unauthorized-serial unauthorized usb:1-2',
    '',
  ].join('\n'));
  assert.equal(devices.length, 3);
  assert.equal(devices[1].serial, 'localhost:41237');
  assert.equal(devices[2].state, 'unauthorized');
});

test('reservation parsing handles the Android CLI short output', () => {
  assert.deepEqual(parseReservationIds('abc123xyz\nrsv_987654\n'), ['abc123xyz', 'rsv_987654']);
});

test('only newly created reservation and ADB IDs are returned', () => {
  assert.deepEqual(getNewIds(['old-one'], ['old-one', 'new-one']), ['new-one']);
});

test('physical identity must match the OEM vendor and API level', () => {
  const target = getGoogleDdpTarget('xiaomi_14');
  const identity = verifyGoogleDdpIdentity(target, {
    manufacturer: 'Xiaomi',
    productModel: 'Xiaomi 14',
    hardwareModel: 'houji',
    androidRelease: '15',
    apiLevel: '35',
    buildFingerprint: 'Xiaomi/houji/houji:15/ABC/123:user/release-keys',
    kernelQemu: '0',
    bootQemu: '0',
    resolution: '1200x2670',
  });
  assert.equal(identity.manufacturer, 'xiaomi');
  assert.equal(identity.apiLevel, 35);
  assert.equal(identity.hardwareModel, 'houji');
  assert.throws(() => verifyGoogleDdpIdentity(target, { ...identity, apiLevel: '34' }), /API mismatch/);
});

test('virtual devices cannot pass the physical-device identity gate', () => {
  const target = getGoogleDdpTarget('samsung_galaxy_s23');
  assert.throws(() => verifyGoogleDdpIdentity(target, {
    manufacturer: 'Samsung',
    productModel: 'Galaxy S23',
    hardwareModel: 'dm1q',
    androidRelease: '15',
    apiLevel: '35',
    buildFingerprint: 'Samsung/dm1q/dm1q:15/ABC/123:user/release-keys',
    kernelQemu: '1',
  }), /virtualized Android runtime/);
});
