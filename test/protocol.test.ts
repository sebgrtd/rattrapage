import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checksum, decode, encode, type Frame } from '../src/protocol.js';

test('first decoder test: exact subject heartbeat, device 7, seq 1, uptime 1000, XOR F6', () => {
  const data = Buffer.from('50480102000700000001000003e800f6', 'hex');
  assert.deepEqual(decode(data), { ok: true, frame: { type: 2, deviceId: 7, seq: 1, uptimeMs: 1000, measurements: [] } });
});
const sample: Frame = { type: 1, deviceId: 65535, seq: 0xffffffff, uptimeMs: 0xffffffff, measurements: [{ metricId: 1, value: -1234 }, { metricId: 2, value: 24000 }, { metricId: 3, value: 32767 }] };
test('round trip: big endian, signed int16 and uint32 boundaries', () => {
  const bytes = encode(sample);
  assert.equal(bytes.readInt16BE(16), -1234);
  assert.deepEqual(decode(bytes), { ok: true, frame: sample });
  assert.equal(checksum(bytes), 0);
});
test('reject every truncated prefix and appended bytes', () => {
  const bytes = encode(sample);
  for (let i = 0; i < bytes.length; i++) assert.equal(decode(bytes.subarray(0, i)).ok, false);
  assert.equal(decode(Buffer.concat([bytes, Buffer.from([0])])).ok, false);
  assert.deepEqual(decode(Buffer.alloc(513)), { ok: false, error: 'length' });
});
test('validate magic, version, type, device, count, checksum, metrics and duplicates', () => {
  for (const [offset, value, error] of [[0, 0, 'magic'], [2, 2, 'version'], [3, 3, 'type'], [14, 10, 'length'], [15, 9, 'metric'], [18, 1, 'metric']] as const) {
    const bytes = encode(sample); bytes[offset] = value;
    bytes[bytes.length - 1] = checksum(bytes.subarray(0, -1));
    assert.deepEqual(decode(bytes), { ok: false, error });
  }
  const zero = encode(sample); zero.writeUInt16BE(0, 4); zero[zero.length - 1] = checksum(zero.subarray(0, -1));
  assert.deepEqual(decode(zero), { ok: false, error: 'device' });
  const heartbeat = encode(sample); heartbeat[3] = 2; heartbeat[heartbeat.length - 1] = checksum(heartbeat.subarray(0, -1));
  assert.deepEqual(decode(heartbeat), { ok: false, error: 'count' });
  const corrupt = encode(sample); corrupt[16] = corrupt[16]! ^ 1;
  assert.deepEqual(decode(corrupt), { ok: false, error: 'checksum' });
});
test('empty telemetry is permitted; out-of-range encoding fails explicitly', () => {
  assert.equal(decode(encode({ ...sample, measurements: [] })).ok, true);
  assert.throws(() => encode({ ...sample, deviceId: 0 }));
  assert.throws(() => encode({ ...sample, measurements: [{ metricId: 1, value: 32768 }] }));
});
test('decoder remains total on 10,000 deterministic arbitrary datagrams', () => {
  let seed = 42;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let i = 0; i < 10000; i++) {
    const bytes = Buffer.alloc(random() % 600);
    for (let j = 0; j < bytes.length; j++) bytes[j] = random() & 255;
    assert.doesNotThrow(() => decode(bytes));
  }
});
