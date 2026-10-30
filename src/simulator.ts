import { createSocket } from 'node:dgram';
import { parseArgs } from 'node:util';
import { numberInRange } from './config.js';
import { encode } from './protocol.js';

async function main() {
  const strings = ['host', 'port', 'devices', 'hz', 'duration', 'seed', 'checksum-rate', 'duplicate-rate', 'reorder-rate', 'anomaly-rate', 'stop-device', 'stop-after', 'heartbeat-every'];
  const options: Record<string, { type: 'string' | 'boolean' }> = Object.fromEntries(strings.map(key => [key, { type: 'string' as const }]));
  options.help = { type: 'boolean' };
  const { values } = parseArgs({ options });
  if (values.help) {
    console.log('npm run simulator -- [--host 127.0.0.1] [--port 9000] [--devices 50] [--hz 20]\n[--duration 0] [--seed 42] [--checksum-rate 0] [--duplicate-rate 0]\n[--reorder-rate 0] [--anomaly-rate 0] [--stop-device 0] [--stop-after 8] [--heartbeat-every 20]\nLes taux sont compris entre 0 et 1. duration=0: illimité. anomaly-rate: fraction des appareils en défaut continu.'); return;
  }
  const number = (key: string, fallback: number, min: number, max: number, integer = true) => numberInRange(values[key] ?? fallback, key, min, max, integer);
  const host = String(values.host ?? '127.0.0.1');
  const port = number('port', 9000, 1, 65535);
  const count = number('devices', 50, 1, 65535);
  const hz = number('hz', 20, 0.1, 1000, false);
  const duration = number('duration', 0, 0, 86400, false);
  const rates = { checksum: number('checksum-rate', 0, 0, 1, false), duplicate: number('duplicate-rate', 0, 0, 1, false), reorder: number('reorder-rate', 0, 0, 1, false), anomaly: number('anomaly-rate', 0, 0, 1, false) };
  const stopDevice = number('stop-device', 0, 0, count);
  const stopAfter = number('stop-after', 8, 0, 86400, false);
  const heartbeatEvery = number('heartbeat-every', 20, 0, 1000000);
  let seed = number('seed', 42, 0, 0xffffffff);
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
  const socket = createSocket('udp4');
  const counters = { generated: 0, sent: 0, sendErrors: 0, corrupted: 0, duplicates: 0, reordered: 0, skippedTicks: 0 };
  const devices = Array.from({ length: count }, (_, i) => ({ id: i + 1, seq: 0, anomalous: (i / count) < rates.anomaly, held: undefined as Buffer | undefined }));
  let pending = 0;
  let stopped = false;
  let timer: NodeJS.Timeout;
  const start = performance.now();
  const interval = 1000 / hz;
  let tickIndex = 0;
  const send = (data: Buffer) => {
    pending++;
    socket.send(data, port, host, error => {
      pending--; if (error) counters.sendErrors++; else counters.sent++;
    });
  };
  const stop = () => {
    if (stopped) return;
    stopped = true; clearTimeout(timer);
    socket.close(() => console.log(JSON.stringify({ ...counters, elapsedSeconds: (performance.now() - start) / 1000, nominalFramesPerSecond: count * hz })));
  };
  socket.on('error', error => { counters.sendErrors++; console.error(error.message); process.exitCode = 1; stop(); });
  const tick = () => {
    if (stopped) return;
    const elapsed = performance.now() - start;
    if (duration > 0 && elapsed >= duration * 1000) { stop(); return; }
    // Never build an unbounded send queue or catch-up burst under saturation.
    if (pending === 0) {
      for (const d of devices) {
        if (d.id === stopDevice && elapsed >= stopAfter * 1000) { d.held = undefined; continue; }
        d.seq = (d.seq + 1) >>> 0;
        const heartbeat = heartbeatEvery > 0 && d.seq % heartbeatEvery === 0;
        const data = encode({ type: heartbeat ? 2 : 1, deviceId: d.id, seq: d.seq, uptimeMs: Math.floor(elapsed) >>> 0,
          measurements: heartbeat ? [] : [
            { metricId: 1, value: Math.round((d.anomalous ? 8200 : 4000) + random() * 600) },
            { metricId: 2, value: Math.round((d.anomalous && d.id % 2 === 0 ? 18500 : 23700) + random() * 600) },
            { metricId: 3, value: Math.round((d.anomalous && d.id % 3 === 0 ? 10000 : 2500) + random() * 500) },
          ] });
        counters.generated++;
        if (random() < rates.checksum) { data[data.length - 1] = data[data.length - 1]! ^ 0xff; counters.corrupted++; }
        if (d.held) { send(data); send(d.held); d.held = undefined; }
        else if (random() < rates.reorder) { d.held = data; counters.reordered++; }
        else send(data);
        if (!d.held && random() < rates.duplicate) { send(data); counters.duplicates++; }
      }
    } else counters.skippedTicks++;
    tickIndex = Math.max(tickIndex + 1, Math.floor((performance.now() - start) / interval) + 1);
    timer = setTimeout(tick, Math.max(0, start + tickIndex * interval - performance.now()));
  };
  socket.bind(0, () => {
    console.log(`Simulateur: ${count} appareils × ${hz} Hz = ${count * hz} trames/s vers ${host}:${port}; seed=${seed}`);
    tick();
  });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
