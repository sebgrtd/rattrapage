import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceSession } from '../src/sequence.js';
import { loadConfig } from '../src/config.js';
import { Fleet } from '../src/fleet.js';
import { encode } from '../src/protocol.js';

test('three coherent reset frames confirm a restart without inventing sequence losses', () => {
  const s = new DeviceSession(loadConfig().restart);
  s.inspect(200, 10000, 0);
  assert.equal(s.inspect(1, 0, 50).kind, 'restartPending');
  assert.equal(s.inspect(2, 50, 100).kind, 'restartPending');
  assert.deepEqual(s.inspect(3, 100, 150), { kind: 'accepted', lost: 0, restarted: true });
  assert.deepEqual(s.inspect(4, 150, 200), { kind: 'accepted', lost: 0, restarted: false });
  assert.equal(s.inspect(201, 10050, 210).kind, 'late');
});
test('one delayed packet or copies of the same reset packet cannot restart a device', () => {
  const s = new DeviceSession(loadConfig().restart);
  s.inspect(200, 10000, 0);
  s.inspect(1, 0, 50);
  for (let i = 0; i < 5; i++) assert.equal(s.inspect(1, 0, 60 + i).restarted, false);
  assert.deepEqual(s.inspect(201, 10100, 100), { kind: 'accepted', lost: 0, restarted: false });
});
test('expired candidates and inconsistent uptime progression cannot confirm a reboot', () => {
  const c = loadConfig().restart;
  const s = new DeviceSession(c); s.inspect(500, 20000, 0);
  s.inspect(1, 0, 50); s.inspect(2, 50, 100);
  assert.equal(s.inspect(3, 100, c.confirmWindowMs + 100).kind, 'restartPending');
  assert.equal(s.inspect(4, 4000, c.confirmWindowMs + 150).kind, 'late');
});
test('normal sequence and uptime uint32 wrap are not mistaken for a reboot', () => {
  const s = new DeviceSession(loadConfig().restart);
  s.inspect(0xfffffffe, 0xfffffffe, 0);
  assert.deepEqual(s.inspect(1, 1, 3), { kind: 'accepted', lost: 2, restarted: false });
  assert.equal(s.inspect(0xffffffff, 0xffffffff, 4).kind, 'late');
});
test('confirmed reboot clears stale measurements and alert duration, retaining lifetime counts', () => {
  let now = 0; const fleet = new Fleet(loadConfig(), () => now);
  const send = (seq: number, uptimeMs: number, heartbeat = false) => fleet.receive(encode({ type: heartbeat ? 2 : 1, deviceId: 1, seq, uptimeMs, measurements: heartbeat ? [] : [{ metricId: 1, value: 8500 }, { metricId: 2, value: 24000 }, { metricId: 3, value: 3000 }] }));
  send(200, 10000); now = 1500; send(201, 11500); now = 3000; send(202, 13000);
  assert.equal(fleet.snapshot().totals.alert, 1);
  now = 3050; send(1, 0); now = 3100; send(2, 50); now = 3150; send(3, 100, true);
  const snapshot = fleet.snapshot();
  assert.equal(snapshot.counters.restarts, 1); assert.equal(snapshot.counters.restartPending, 2);
  assert.equal(snapshot.counters.lost, 0); assert.equal(snapshot.counters.accepted, 4);
  assert.equal(snapshot.devices[0]!.restarts, 1); assert.equal(snapshot.devices[0]!.status, 'stale');
  assert.ok(snapshot.devices[0]!.metrics.every(m => m.value === null));
  now = 3200; send(4, 150);
  assert.equal(fleet.snapshot().devices[0]!.alerts[0]!.elapsedMs, 0);
});
