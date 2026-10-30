import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { History, type HistoryMatch } from '../src/history.js';
import { Fleet } from '../src/fleet.js';
import { loadConfig } from '../src/config.js';
import { startHub } from '../src/server.js';

const base = Date.parse('2026-10-30T12:00:00.000Z');
const iso = (offset: number) => new Date(base + offset).toISOString();
const snapshot = new Fleet(loadConfig()).snapshot();
const line = (offset: number) => JSON.stringify({ at: iso(offset), snapshot }) + '\n';

test('time lookup and index cover both retained files beyond the latest 120 records', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pulsehub-time-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'history.jsonl');
  await writeFile(file + '.1', Array.from({ length: 130 }, (_, i) => line(i * 5000)).join(''));
  await writeFile(file, line(650000) + '{truncated');
  const history = new History(file, 10485760);
  const recent = await history.read(); assert.equal(recent.length, 120); assert.equal(recent[0]!.at, iso(55000));
  const index = await history.timestamps(); assert.equal(index.length, 131); assert.equal(index[0], iso(0));
  const match = await history.at(base, 2500);
  assert.equal(match.entry?.at, iso(0)); assert.equal(match.deltaMs, 0);
  assert.equal(match.previousAt, null); assert.equal(match.nextAt, iso(5000));
});

test('nearest lookup has a strict tolerance, deterministic ties and explicit gaps', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pulsehub-gaps-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'history.jsonl');
  // Out-of-order civil timestamps can occur when the system clock changes.
  await writeFile(file, line(5000) + line(0) + line(20000) + JSON.stringify({ at: 'invalid', snapshot }) + '\n');
  const history = new History(file, 10485760);
  assert.deepEqual(await history.timestamps(), [iso(0), iso(5000), iso(20000)]);
  assert.equal((await history.at(base + 2500, 2500)).entry?.at, iso(0));
  assert.equal((await history.at(base + 4900, 2500)).deltaMs, 100);
  assert.equal((await history.at(base + 4900, 2500)).nextAt, iso(20000));
  assert.equal((await history.at(base + 7500, 2500)).entry?.at, iso(5000));
  const gap = await history.at(base + 7501, 2500);
  assert.equal(gap.entry, null); assert.equal(gap.deltaMs, null);
  assert.equal(gap.previousAt, iso(5000)); assert.equal(gap.nextAt, iso(20000));
  assert.equal((await history.at(base - 2501, 2500)).entry, null);
  assert.equal((await history.at(base + 22501, 2500)).entry, null);
});

test('missing or disabled history returns no sample and no invented bounds', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pulsehub-empty-')); t.after(() => rm(dir, { recursive: true, force: true }));
  for (const file of ['', join(dir, 'missing.jsonl')]) {
    const history = new History(file, 10485760);
    assert.deepEqual(await history.timestamps(), []);
    assert.deepEqual(await history.at(base, 2500), { requestedAt: iso(0), entry: null, deltaMs: null, toleranceMs: 2500, previousAt: null, nextAt: null });
  }
});

test('HTTP time lookup validates dates and preserves the CLI history endpoint', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pulsehub-history-http-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'history.jsonl'); await writeFile(file, line(0));
  const hub = await startHub({ ...loadConfig(), udpPort: 0, httpPort: 0, historyFile: file, historyIntervalMs: 60000 });
  t.after(() => hub.close());
  const url = `http://127.0.0.1:${(hub.http.address() as AddressInfo).port}/api/history`;
  const index = await fetch(url + '/index').then(r => r.json()) as { enabled: boolean; intervalMs: number; timestamps: string[] };
  assert.deepEqual(index, { enabled: true, intervalMs: 60000, timestamps: [iso(0)] });
  assert.ok(Array.isArray(await fetch(url).then(r => r.json())));
  const match = await fetch(url + '?at=' + encodeURIComponent(iso(1000))).then(r => r.json()) as HistoryMatch;
  assert.equal(match.entry?.at, iso(0)); assert.equal(match.toleranceMs, 30000);
  for (const invalid of ['', 'tomorrow', '2026-02-30T12:00:00Z', '2026-10-30', '2026-10-30T12:00:00']) {
    assert.equal((await fetch(url + '?at=' + encodeURIComponent(invalid))).status, 400, invalid);
  }
});
