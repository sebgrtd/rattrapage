import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSocket, type Socket } from 'node:dgram';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { startHub } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { History } from '../src/history.js';
import { Fleet } from '../src/fleet.js';
import { encode } from '../src/protocol.js';

const config = () => ({ ...loadConfig(), udpPort: 0, httpPort: 0, historyFile: '', refreshMs: 100 });
const send = (socket: Socket, port: number, bytes: Buffer) => new Promise<void>((resolve, reject) => socket.send(bytes, port, '127.0.0.1', e => e ? reject(e) : resolve()));
async function until(condition: () => boolean, timeout = 2000) {
  const end = performance.now() + timeout;
  while (!condition() && performance.now() < end) await delay(20);
  assert.ok(condition(), 'Condition not reached before timeout');
}
test('real UDP → decoder → fleet → HTTP/SSE; oversized packet, reconnect and shutdown', async t => {
  const hub = await startHub(config()); t.after(() => hub.close());
  const port = (hub.udp.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${(hub.http.address() as AddressInfo).port}`;
  const socket = createSocket('udp4'); t.after(() => socket.close());
  const initial = await fetch(base + '/api/state').then(r => r.json()) as ReturnType<typeof hub.snapshot>;
  assert.equal(initial.counters.received, 0);
  const page = await fetch(base); assert.equal(page.status, 200); assert.match(await page.text(), /La scène, sous contrôle/);
  assert.equal((await fetch(base + '/missing')).status, 404);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  await send(socket, port, Buffer.alloc(600));
  await send(socket, port, Buffer.from('50480102000700000001000003e800f6', 'hex'));
  await until(() => hub.snapshot().counters.received === 2);
  const response = await fetch(base + '/events');
  const reader = response.body!.getReader();
  const text = new TextDecoder().decode((await reader.read()).value);
  assert.match(text, /"received":2/); assert.match(text, /"invalid":1/);
  await reader.cancel();
  const reconnect = await fetch(base + '/events');
  assert.equal(reconnect.status, 200); await reconnect.body!.cancel();
  const result = await fetch(base + '/api/state').then(r => r.json()) as ReturnType<typeof hub.snapshot>;
  assert.equal(result.totals.stale, 1); // Heartbeat alone carries no measurements.
});
test('CLI simulator exposes every injected fault through a real hub', { timeout: 15000 }, async t => {
  const c = config(); c.offlineMs = 300; c.staleMs = 200;
  c.alerts = c.alerts.map(r => ({ ...r, durationMs: 100 }));
  const hub = await startHub(c); t.after(() => hub.close());
  const port = (hub.udp.address() as AddressInfo).port;
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/simulator.ts', '--port', String(port), '--devices', '10', '--hz', '40', '--duration', '2', '--checksum-rate', '0.08', '--duplicate-rate', '0.1', '--reorder-rate', '0.1', '--anomaly-rate', '0.4', '--stop-device', '7', '--stop-after', '0.3'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = ''; let errors = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { errors += String(chunk); });
  const ended = once(child, 'exit');
  await until(() => hub.snapshot().totals.alert > 0 && hub.snapshot().totals.offline > 0, 6000);
  const s = hub.snapshot();
  assert.equal(s.totals.devices, 10);
  assert.ok(s.counters.invalid > 0); assert.ok(s.counters.lost > 0);
  assert.ok(s.counters.duplicates > 0); assert.ok(s.counters.late > 0);
  assert.equal(s.devices.find(d => d.id === 7)!.status, 'offline');
  const [code] = await ended;
  assert.equal(code, 0, errors);
  assert.match(output, /"sendErrors":0/);
});
test('persisted history survives reopening, rotates and tolerates a truncated final record', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pulsehub-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'history.jsonl');
  const fleet = new Fleet(loadConfig()); const snapshot = fleet.snapshot();
  const bytes = Buffer.byteLength(JSON.stringify({ at: new Date().toISOString(), snapshot }) + '\n');
  const history = new History(path, bytes + 10);
  history.record(snapshot); await history.flush();
  history.record(snapshot); await history.flush();
  assert.equal(history.status.written, 2); assert.equal(history.status.error, '');
  await appendFile(path, '{incomplete');
  const reopened = new History(path, bytes + 10);
  assert.equal((await reopened.read()).length, 2);
});
test('occupied UDP port rejects startup instead of silently running a dead hub', async t => {
  const first = await startHub(config()); t.after(() => first.close());
  await assert.rejects(startHub({ ...config(), udpPort: (first.udp.address() as AddressInfo).port }), /EADDRINUSE/);
});
test('a damaged telemetry cannot overwrite an accepted sample over UDP', async t => {
  const hub = await startHub(config()); t.after(() => hub.close());
  const socket = createSocket('udp4'); t.after(() => socket.close());
  const port = (hub.udp.address() as AddressInfo).port;
  const data = encode({ type: 1, deviceId: 4, seq: 1, uptimeMs: 500, measurements: [{ metricId: 1, value: 4250 }] });
  await send(socket, port, data);
  const bad = Buffer.from(data); bad[16] = 0xff; await send(socket, port, bad);
  await until(() => hub.snapshot().counters.received === 2);
  assert.equal(hub.snapshot().devices[0]!.metrics[0]!.value, 4250);
  assert.equal(hub.snapshot().counters.invalid, 1);
});

test('large fleet SSE snapshots drain normally without reconnecting a healthy browser', { timeout: 8000 }, async t => {
  const hub = await startHub(config()); t.after(() => hub.close());
  for (let id = 1; id <= 100; id++) {
    hub.fleet.receive(encode({ type: 1, deviceId: id, seq: 1, uptimeMs: 50, measurements: [{ metricId: 1, value: 4250 }, { metricId: 2, value: 24000 }, { metricId: 3, value: 3000 }] }));
  }
  const base = `http://127.0.0.1:${(hub.http.address() as AddressInfo).port}`;
  const response = await fetch(base + '/events', { signal: AbortSignal.timeout(5000) });
  const reader = response.body!.getReader();
  let events = ''; let count = 0;
  while (count < 4) {
    const chunk = await reader.read(); assert.equal(chunk.done, false);
    events += new TextDecoder().decode(chunk.value);
    count = events.split('\n\n').length - 1;
  }
  assert.equal(hub.snapshot().service.slowClients, 0);
  assert.equal(hub.snapshot().service.clients, 1);
  await reader.cancel();
});
