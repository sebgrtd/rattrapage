import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { cpus, platform, release } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import { startHub } from '../src/server.js';
import { loadConfig, numberInRange } from '../src/config.js';

const { values } = parseArgs({ options: { seconds: { type: 'string', default: '10' }, rates: { type: 'string', default: '1000,5000,10000,20000' } } });
const seconds = numberInRange(values.seconds, 'seconds', 2, 120);
const rates = values.rates!.split(',').map(v => numberInRange(v, 'rate', 20, 1000000));
const results = [];
for (const target of rates) {
  // Same host, separate processes. Includes HTTP snapshots and periodic disk persistence.
  const config = loadConfig(undefined, { historyFile: 'tmp/benchmark-history.jsonl', maxDevices: Math.max(4096, Math.ceil(target / 20)) });
  const hub = await startHub({ ...config, udpPort: 0, httpPort: 0 });
  const base = `http://127.0.0.1:${(hub.http.address() as AddressInfo).port}`;
  const samples: number[] = [];
  const httpSamples: number[] = [];
  let busy = false;
  const observe = setInterval(() => {
    if (busy) return;
    busy = true;
    const start = performance.now();
    void fetch(base + '/api/state').then(r => r.json()).then(() => { httpSamples.push(performance.now() - start); }).finally(() => { busy = false; });
    samples.push(process.memoryUsage().rss);
  }, 500);
  let stdout = ''; let stderr = '';
  const started = performance.now();
  try {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/simulator.ts', '--port', String((hub.udp.address() as AddressInfo).port), '--devices', String(Math.ceil(target / 20)), '--hz', '20', '--duration', String(seconds), '--heartbeat-every', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', value => { stdout += String(value); });
    child.stderr.on('data', value => { stderr += String(value); });
    const [code] = await once(child, 'exit');
    if (code !== 0) throw new Error(stderr);
    const lastLine = stdout.trim().split('\n').at(-1)!;
    const emitter = JSON.parse(lastLine) as { sent: number; sendErrors: number; elapsedSeconds: number; skippedTicks: number };
    await delay(300); // Drain datagrams already in flight before taking final counters.
    const state = hub.snapshot();
    const actualRate = emitter.sent / emitter.elapsedSeconds;
    const delivered = emitter.sent ? state.counters.received / emitter.sent : 0;
    const entry = { target, actualFramesPerSecond: Math.round(actualRate), received: state.counters.received,
      sent: emitter.sent, accepted: state.counters.accepted, deliveryPercent: Number((100 * delivered).toFixed(3)), inferredLost: state.counters.lost,
      sendErrors: emitter.sendErrors, skippedTicks: emitter.skippedTicks,
      maxRssMiB: Math.round(Math.max(process.memoryUsage().rss, ...samples) / 1024 / 1024),
      maxHttpMs: Math.round(Math.max(0, ...httpSamples)), elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(2)),
      sustained: delivered >= 0.999 && actualRate >= target * 0.95 && emitter.sendErrors === 0 && state.counters.accepted === state.counters.received };
    results.push(entry); console.log(JSON.stringify(entry));
  } finally {
    clearInterval(observe);
    while (busy) await delay(20);
    await hub.close();
  }
}
const report = { at: new Date().toISOString(), node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model,
  secondsPerStep: seconds, method: 'UDP loopback; separate simulator process; HTTP polling 2 Hz; history enabled; sustained means >=99.9% delivery and >=95% target send rate.', results };
await mkdir('docs', { recursive: true });
await writeFile('docs/benchmark.json', JSON.stringify(report, null, 2) + '\n');
console.log('Rapport écrit dans docs/benchmark.json');
