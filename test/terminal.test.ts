import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { loadConfig } from '../src/config.js';
import { Fleet } from '../src/fleet.js';
import { encode } from '../src/protocol.js';
import { startHub } from '../src/server.js';
import { initialState, renderDashboard, visibleDevices, displayed } from '../src/terminal/dashboard.js';
import { hubUrl, snapshotResponse, historyResponse } from '../src/terminal/client.js';
import { safeText } from '../src/terminal/screen.js';

const fixture = () => {
  const fleet = new Fleet(loadConfig(), () => 1000);
  fleet.receive(encode({ type: 1, deviceId: 9, seq: 1, uptimeMs: 1000, measurements: [{ metricId: 1, value: 4250 }, { metricId: 2, value: 24000 }, { metricId: 3, value: 3000 }] }));
  const state = initialState('http://127.0.0.1:3000');
  state.latest = { ...fleet.snapshot(), at: new Date().toISOString() }; state.connected = true; state.message = '';
  return state;
};
test('terminal renders server values, aggregates, filters and bounded layouts', () => {
  const state = fixture();
  for (const [width, height] of [[120, 38], [80, 28], [72, 28], [40, 15], [180, 65]]) {
    const screen = renderDashboard(state, width!, height!);
    const rows = screen.plain().split('\n');
    assert.equal(rows.length, height); assert.ok(rows.every(row => [...row].length === width));
    assert.equal(safeText(screen.ansi().replaceAll('\r\n', '')), screen.plain().replaceAll('\n', ''));
  }
  const text = renderDashboard(state, 120, 38).plain();
  assert.match(text, /PH-009/); assert.match(text, /42,5 °C/); assert.match(text, /Moy. 10 s: 42,5 °C/);
  state.query = '009'; assert.equal(visibleDevices(state).length, 1);
  state.filter = 'offline'; assert.equal(visibleDevices(state).length, 0);
  assert.match(renderDashboard(state, 80, 28).plain(), /Aucun appareil/);
});
test('paused and historical screens cannot present incoming live data as the frozen snapshot', () => {
  const state = fixture(); state.frozen = state.latest; state.mode = 'pause';
  const original = state.latest!;
  state.latest = { ...original, counters: { ...original.counters, received: 999 } };
  assert.equal(displayed(state)?.counters.received, 1);
  assert.match(renderDashboard(state, 120, 38).plain(), /DONNÉES FIGÉES/);
  state.history = [{ at: original.at, snapshot: original }]; state.mode = 'history';
  assert.equal(displayed(state)?.counters.received, 1);
  assert.match(renderDashboard(state, 120, 38).plain(), /HISTORIQUE 1\/1/);
  state.mode = 'live'; state.connected = false; state.message = 'Connexion perdue';
  const disconnected = renderDashboard(state, 120, 38).plain();
  assert.match(disconnected, /HUB DÉCONNECTÉ/); assert.match(disconnected, /dernières données conservées/);
});
test('API boundary rejects unrelated payloads and terminal text cannot inject escape commands', () => {
  assert.equal(hubUrl('http://localhost:3000/'), 'http://localhost:3000');
  for (const url of ['file:///tmp/data', 'http://user:password@localhost/', 'http://localhost/private', 'http://localhost/?x=1']) assert.throws(() => hubUrl(url));
  assert.throws(() => snapshotResponse({})); assert.throws(() => historyResponse([{ at: 'invalid', snapshot: {} }]));
  assert.equal(safeText('A\x1b[2J\x1b]0;title\x07B\r\n'), 'AB');
  assert.equal(safeText('42\u202f000 · À surveiller —'), '42 000 · À surveiller —');
});
test('CLI --once reads a real hub over HTTP, stays plain in a pipe, and exits', { timeout: 10000 }, async t => {
  const hub = await startHub({ ...loadConfig(), udpPort: 0, httpPort: 0, historyFile: '' }); t.after(() => hub.close());
  hub.fleet.receive(encode({ type: 2, deviceId: 321, seq: 1, uptimeMs: 100, measurements: [] }));
  const port = (hub.http.address() as AddressInfo).port;
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--once', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', c => { stdout += String(c); }); child.stderr.on('data', c => { stderr += String(c); });
  const [code] = await once(child, 'close');
  assert.equal(code, 0, stderr); assert.match(stdout, /PH-321/); assert.match(stdout, /Périmé/);
  assert.ok(!stdout.includes('\x1b')); assert.ok(!stdout.includes('Connexion au hub'));
});
