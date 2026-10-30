import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { cpus, platform, release } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import { startHub } from '../src/server.js';
import { loadConfig, numberInRange } from '../src/config.js';
import { encode } from '../src/protocol.js';
import { Fleet } from '../src/fleet.js';

const { values } = parseArgs({ options: {
  seconds: { type: 'string', default: '10' }, rates: { type: 'string', default: '1000,10000,40000,80000,160000,320000' },
  workers: { type: 'string', default: '4' }, 'core-seconds': { type: 'string', default: '3' },
  'core-frames': { type: 'string', default: '100000' },
} });
const seconds = numberInRange(values.seconds, 'seconds', 2, 120);
const rates = values.rates!.split(',').map(v => numberInRange(v, 'rate', 20, 1000000));
const workers = numberInRange(values.workers, 'workers', 1, 16);
const coreSeconds = numberInRange(values['core-seconds'], 'core-seconds', 1, 20);
const coreFrames = numberInRange(values['core-frames'], 'core-frames', 1000, 1000000);

function measureCore() {
  const packets = Array.from({ length: coreFrames }, (_, i) => encode({ type: 1, deviceId: i % 100 + 1, seq: Math.floor(i / 100) + 1, uptimeMs: i >>> 0,
    measurements: [{ metricId: 1, value: 4250 }, { metricId: 2, value: 24000 }, { metricId: 3, value: 3000 }] }));
  const config = loadConfig(undefined, { historyFile: '' });
  let processingMs = 0; let accepted = 0; let batches = 0;
  const batchRates: number[] = [];
  // Warm up separately; only receive() is timed, encoding/transport/snapshots are excluded.
  const warmup = new Fleet(config); for (const packet of packets.slice(0, 10000)) warmup.receive(packet);
  while (processingMs < coreSeconds * 1000) {
    const fleet = new Fleet(config);
    const start = performance.now();
    for (const packet of packets) fleet.receive(packet);
    const elapsed = performance.now() - start;
    const snapshot = fleet.snapshot();
    if (snapshot.counters.accepted !== packets.length) throw new Error('Le benchmark métier a rejeté des trames valides');
    processingMs += elapsed; accepted += snapshot.counters.accepted; batches++;
    batchRates.push(Math.round(packets.length * 1000 / elapsed));
  }
  return { accepted, batches, framesPerBatch: packets.length, processingSeconds: Number((processingMs / 1000).toFixed(3)),
    framesPerSecond: Math.round(accepted * 1000 / processingMs), slowestBatchFramesPerSecond: Math.min(...batchRates), fastestBatchFramesPerSecond: Math.max(...batchRates),
    scope: 'Synchronous Fleet.receive: decode, session sequencing, default JSON pipeline and device updates. Prebuilt packets; no UDP, HTTP or persistence. Fresh fleet per batch.' };
}

interface SenderReport { targetRate: number; sent: number; generated: number; sendErrors: number; activeSeconds: number; peakPending: number; maxBacklogFrames: number }
const results = [];
for (const target of rates) {
  const config = loadConfig(undefined, { historyFile: 'tmp/benchmark-isolated-history.jsonl' });
  const hub = await startHub({ ...config, udpPort: 0, httpPort: 0 });
  const base = `http://127.0.0.1:${(hub.http.address() as AddressInfo).port}`;
  const children: ChildProcess[] = [];
  const latencies: number[] = [];
  const memory: number[] = [];
  let busy = false; let httpErrors = 0; let streamErrors = 0;
  const streamAbort = new AbortController();
  const stream = (async () => {
    try {
      const response = await fetch(base + '/events', { signal: streamAbort.signal });
      if (!response.ok) throw new Error('SSE unavailable');
      const reader = response.body!.getReader();
      while (!(await reader.read()).done) { /* Drain one real SSE connection. */ }
      if (!streamAbort.signal.aborted) streamErrors++;
    } catch { if (!streamAbort.signal.aborted) streamErrors++; }
  })();
  const observe = setInterval(() => {
    if (busy) return;
    busy = true; const start = performance.now();
    void fetch(base + '/api/state').then(r => { if (!r.ok) throw new Error('HTTP unavailable'); return r.json(); })
      .then(() => { latencies.push(performance.now() - start); })
      .catch(() => { httpErrors++; }).finally(() => { busy = false; });
    memory.push(process.memoryUsage().rss);
  }, 500);
  try {
    const senders = await Promise.all(Array.from({ length: workers }, async (_, index) => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/load-generator.ts', '--port', String((hub.udp.address() as AddressInfo).port),
        '--rate', String(target / workers), '--seconds', String(seconds), '--offset', String(index * 100)], { stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(child);
      let stdout = ''; let stderr = '';
      child.stdout!.on('data', data => { stdout += String(data); }); child.stderr!.on('data', data => { stderr += String(data); });
      const [code] = await once(child, 'exit'); if (code !== 0) throw new Error(stderr || `Générateur terminé avec ${code}`);
      return JSON.parse(stdout.trim()) as SenderReport;
    }));
    await delay(300);
    const state = hub.snapshot();
    const sent = senders.reduce((n, s) => n + s.sent, 0);
    const offered = senders.reduce((n, s) => n + s.sent / s.activeSeconds, 0);
    const sendErrors = senders.reduce((n, s) => n + s.sendErrors, 0);
    const delivery = sent ? state.counters.received / sent : 0;
    const generatorReachedTarget = offered >= target * 0.95 && sendErrors === 0;
    const receiverKeptUp = delivery >= 0.999 && state.counters.accepted === state.counters.received && httpErrors === 0 && streamErrors === 0 && state.service.slowClients === 0 && state.service.history.error === '';
    const sorted = [...latencies].sort((a, b) => a - b);
    const entry = { target, workers, offeredFramesPerSecond: Math.round(offered), receivedFramesPerSecond: Math.round(offered * delivery), sent,
      received: state.counters.received, accepted: state.counters.accepted, deliveryPercent: Number((100 * delivery).toFixed(4)), inferredLost: state.counters.lost,
      sendErrors, httpErrors, streamErrors, slowClients: state.service.slowClients, historyError: state.service.history.error,
      maxRssMiB: Math.round(Math.max(process.memoryUsage().rss, ...memory) / 1024 / 1024),
      httpP95Ms: Math.round(sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0),
      generatorReachedTarget, receiverKeptUp, sustained: generatorReachedTarget && receiverKeptUp,
      bottleneck: !generatorReachedTarget ? 'generator-or-shared-host' : !receiverKeptUp ? 'receiver-or-UDP-stack' : 'none-observed', senders };
    results.push(entry); console.log(JSON.stringify({ ...entry, senders: undefined }));
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    clearInterval(observe); while (busy) await delay(20);
    streamAbort.abort(); await stream; await hub.close();
  }
}
const core = measureCore();
console.log(JSON.stringify({ core }));
const report = { at: new Date().toISOString(), node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model,
  secondsPerStep: seconds, workers, config: loadConfig(),
  method: 'UDP loopback with disjoint device IDs across dedicated sender processes, bounded reusable buffers, paced small bursts; one SSE reader, HTTP polling 2 Hz, history enabled. Separate synchronous core benchmark excludes encoding and I/O. Sustained: >=95% offered target and >=99.9% delivery with all received packets accepted and no observed HTTP/SSE/history error.',
  results, core };
await mkdir('docs', { recursive: true });
await writeFile('docs/benchmark-isolated.json', JSON.stringify(report, null, 2) + '\n');
console.log('Rapport écrit dans docs/benchmark-isolated.json');
