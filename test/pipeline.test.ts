import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Fleet } from '../src/fleet.js';
import { loadConfig } from '../src/config.js';
import { encode, type Frame } from '../src/protocol.js';
import { ProcessingPipeline, stepFactories, validatePipeline } from '../src/processing/pipeline.js';
import type { ProcessingContext, StepDefinition, StepFactory } from '../src/processing/types.js';

const aggregate = (id: string, operation: string, maxSamples = 2): StepDefinition => ({ id, type: 'aggregate', metricId: 1, operation, windowMs: 1000, maxSamples });
const frame = (seq: number, temp = 4000): Frame => ({ type: 1, deviceId: 1, seq, uptimeMs: seq * 50, measurements: [{ metricId: 1, value: temp }, { metricId: 2, value: 24000 }, { metricId: 3, value: 3000 }] });

test('JSON pipeline computes mean/min/max on a bounded sliding window and expires it', () => {
  let now = 0;
  const f = new Fleet(loadConfig(undefined, { pipeline: [aggregate('mean', 'mean'), aggregate('min', 'min'), aggregate('max', 'max')] }), () => now);
  f.receive(encode(frame(1, 1000))); now = 100; f.receive(encode(frame(2, 3000))); now = 200; f.receive(encode(frame(3, 5000)));
  assert.deepEqual(f.snapshot().devices[0]!.aggregates.map(a => [a.operation, a.value, a.samples]), [['mean', 4000, 2], ['min', 3000, 2], ['max', 5000, 2]]);
  now = 1200; assert.ok(f.snapshot().devices[0]!.aggregates.every(a => a.stale));
  f.receive(encode({ ...frame(4), type: 2, measurements: [] }));
  assert.deepEqual(f.snapshot().devices[0]!.aggregates, []);
});
test('filter precedes calculations, preserves transport accounting and clears misleading measurements', () => {
  let now = 0;
  const f = new Fleet(loadConfig(undefined, { pipeline: [{ id: 'temperature-range', type: 'filter', metricId: 1, min: 0, max: 6000 }, aggregate('mean', 'mean'), { id: 'alerts', type: 'alerts' }] }), () => now);
  f.receive(encode(frame(1))); now = 50; f.receive(encode(frame(2, 8000)));
  const filtered = f.snapshot();
  assert.equal(filtered.counters.filtered, 1); assert.equal(filtered.counters.accepted, 2); assert.equal(filtered.counters.invalid, 0);
  assert.deepEqual(filtered.devices[0]!.aggregates, []); assert.deepEqual(filtered.devices[0]!.alerts, []);
  assert.equal(filtered.devices[0]!.status, 'stale');
  now = 100; f.receive(encode(frame(3, 5000)));
  assert.equal(f.snapshot().counters.lost, 0);
  assert.equal(f.snapshot().devices[0]!.aggregates[0]!.value, 5000);
});
test('device selection and selected alert rules are configurable without changing Fleet', () => {
  let now = 0;
  const f = new Fleet(loadConfig(undefined, { pipeline: [{ id: 'selection', type: 'filter', excludeDeviceIds: [2] }, { id: 'alerts', type: 'alerts', ruleIds: ['temperature'] }] }), () => now);
  const badVoltage = frame(1); badVoltage.measurements[1]!.value = 18000;
  f.receive(encode(badVoltage)); f.receive(encode({ ...frame(1), deviceId: 2 }));
  now = 1000; f.receive(encode({ ...badVoltage, seq: 2 }));
  assert.equal(f.snapshot().counters.filtered, 1);
  assert.deepEqual(f.snapshot().devices[0]!.alerts, []);
  assert.equal(f.snapshot().devices[1]!.metrics[0]!.value, null);
});
test('invalid pipeline definitions fail at startup instead of silently dropping an operator rule', () => {
  for (const pipeline of [
    [{ id: 'a', type: 'unknown' }],
    [{ id: 'a', type: 'filter' }, { id: 'a', type: 'filter' }],
    [{ id: 'a', type: 'alerts' }, { id: 'b', type: 'filter' }],
    [aggregate('a', 'median')],
    [{ id: 'a', type: 'filter', min: 5, max: 1 }],
    [{ id: 'a', type: 'aggregate', metricId: 1, operation: 'mean', windowMs: 1000, maxSamples: 0 }],
    [{ id: 'a', type: 'alerts', ruleIds: ['missing-rule'] }],
  ]) assert.throws(() => loadConfig(undefined, { pipeline }));
});
test('new processing type plugs into the registry without editing existing steps', () => {
  const calls: string[] = [];
  const custom: StepFactory = { phase: 'compute', validate: raw => ({ id: String(raw.id), type: 'audit' }), create: d => ({ process: () => { calls.push(d.id); return true; } }) };
  const registry = new Map(stepFactories); registry.set('audit', custom);
  const defs = [{ id: 'before', type: 'audit' }, aggregate('mean', 'mean'), { id: 'after', type: 'audit' }];
  const pipeline = new ProcessingPipeline(validatePipeline(defs, registry), registry);
  const context: ProcessingContext = { now: 0, staleMs: 2000, rules: [], metrics: {}, breaches: new Map(), aggregates: {}, windows: new Map() };
  assert.equal(pipeline.process(frame(1), context), true);
  assert.deepEqual(calls, ['before', 'after']); assert.equal(context.aggregates.mean!.value, 4000);
});
test('a new device session starts a new aggregate window', () => {
  let now = 0; const f = new Fleet(loadConfig(), () => now);
  f.receive(encode({ ...frame(300, 9000), uptimeMs: 15000 }));
  for (let seq = 1; seq <= 3; seq++) { now += 50; f.receive(encode({ ...frame(seq, 4000), uptimeMs: seq * 50 })); }
  const d = f.snapshot().devices[0]!;
  assert.equal(d.restarts, 1); assert.equal(d.aggregates[0]!.value, 4000); assert.equal(d.aggregates[0]!.samples, 1);
});
