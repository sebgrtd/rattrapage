import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Fleet } from '../src/fleet.js';
import { loadConfig } from '../src/config.js';
import { encode, type Frame } from '../src/protocol.js';
import { Sequencer } from '../src/sequence.js';

const packet = (seq: number, temp = 4200, deviceId = 7) => encode({ type: 1, deviceId, seq, uptimeMs: seq >>> 0,
  measurements: [{ metricId: 1, value: temp }, { metricId: 2, value: 24000 }, { metricId: 3, value: 3000 }] });
test('empty hub starts with every fleet and reception counter at zero', () => {
  const s = new Fleet(loadConfig()).snapshot();
  assert.ok(Object.values(s.counters).every(v => v === 0));
  assert.ok(Object.values(s.totals).every(v => v === 0));
  assert.equal(s.ratePerSecond, 0); assert.equal(s.lossPercent, 0); assert.equal(s.invalidPercent, 0);
});
test('sequence rejects duplicates/late frames, counts holes, isolates devices', () => {
  const f = new Fleet(loadConfig());
  f.receive(packet(10)); f.receive(packet(12)); f.receive(packet(12, 9900)); f.receive(packet(11, 9900)); f.receive(packet(1, 4200, 8));
  const s = f.snapshot();
  assert.deepEqual(s.counters, { received: 5, accepted: 3, invalid: 0, lost: 1, duplicates: 1, late: 1, capacityRejected: 0, restartPending: 0, restarts: 0 });
  assert.equal(s.devices[0]!.metrics[0]!.value, 4200);
});
test('uint32 wrap handles contiguous values, holes and old packets', () => {
  const s = new Sequencer();
  assert.deepEqual(s.inspect(0xfffffffe), { kind: 'accepted', lost: 0 });
  assert.deepEqual(s.inspect(1), { kind: 'accepted', lost: 2 });
  assert.equal(s.inspect(0xffffffff).kind, 'late');
  assert.equal(s.inspect(1).kind, 'duplicate');
  assert.equal(s.inspect(0x80000001).kind, 'late');
});
test('invalid input is counted but cannot create a device or damage last measurements', () => {
  const f = new Fleet(loadConfig()); f.receive(Buffer.alloc(0)); f.receive(packet(1));
  const bad = packet(2, 9900); bad[0] = 0; f.receive(bad);
  assert.equal(f.snapshot().counters.invalid, 2);
  assert.equal(f.snapshot().devices[0]!.seq, 1);
});
test('alert duration, recovery, stale telemetry and offline use an injected clock', () => {
  let now = 0; const f = new Fleet(loadConfig(), () => now);
  f.receive(packet(1, 8000)); assert.equal(f.snapshot().totals.watch, 1);
  now = 1500; f.receive(packet(2, 8000));
  now = 3000; f.receive(packet(3, 8000)); assert.equal(f.snapshot().totals.alert, 1);
  now = 3100; f.receive(packet(4, 5000)); assert.equal(f.snapshot().totals.online, 1);
  now = 5100; assert.equal(f.snapshot().totals.stale, 1);
  now = 6100; assert.equal(f.snapshot().totals.offline, 1);
  assert.equal(f.snapshot().ratePerSecond, 0);
});
test('heartbeats keep device alive, not its measurements; stale gaps reset duration', () => {
  let now = 0; const f = new Fleet(loadConfig(), () => now);
  f.receive(packet(1, 8000));
  const heartbeat: Frame = { type: 2, deviceId: 7, seq: 2, uptimeMs: 2500, measurements: [] };
  now = 2500; f.receive(encode(heartbeat)); assert.equal(f.snapshot().totals.stale, 1);
  now = 3000; f.receive(packet(3, 8000)); assert.equal(f.snapshot().totals.watch, 1);
  assert.equal(f.snapshot().devices[0]!.alerts[0]!.elapsedMs, 0);
});
test('duplicates and late packets do not keep a device artificially alive', () => {
  let now = 0; const f = new Fleet(loadConfig(), () => now); f.receive(packet(10));
  now = 3001; f.receive(packet(10)); f.receive(packet(9));
  assert.equal(f.snapshot().totals.offline, 1);
});
test('registry is bounded and rejected new devices are accounted for', () => {
  const f = new Fleet(loadConfig(undefined, { maxDevices: 1 }));
  f.receive(packet(1, 4200, 1)); f.receive(packet(1, 4200, 2));
  assert.equal(f.snapshot().totals.devices, 1); assert.equal(f.snapshot().counters.capacityRejected, 1);
});
test('configuration fails early on invalid ports, rules and timing', () => {
  assert.throws(() => loadConfig(undefined, { udpPort: -1 }));
  assert.throws(() => loadConfig(undefined, { staleMs: 5000, offlineMs: 1000 }));
  assert.throws(() => loadConfig(undefined, { alerts: [{ id: 'x', label: 'X', metricId: 1, min: 5, max: 1, durationMs: 0 }] }));
});
