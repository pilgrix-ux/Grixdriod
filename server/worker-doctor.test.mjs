import test from 'node:test';
import assert from 'node:assert/strict';
import { isEphemeralDataPath } from './worker-doctor.mjs';

test('rejects temporary paths as persistent Android data locations', () => {
  assert.equal(isEphemeralDataPath('/tmp/grixdroid'), true);
  assert.equal(isEphemeralDataPath('/var/tmp/grixdroid'), true);
  assert.equal(isEphemeralDataPath('/run/grixdroid'), true);
  assert.equal(isEphemeralDataPath('/dev/shm/grixdroid'), true);
});

test('accepts durable-looking data locations outside temporary mount points', () => {
  assert.equal(isEphemeralDataPath('/var/lib/grixdroid'), false);
  assert.equal(isEphemeralDataPath('/srv/grixdroid-data'), false);
  assert.equal(isEphemeralDataPath('/home/worker/grixdroid'), false);
});
