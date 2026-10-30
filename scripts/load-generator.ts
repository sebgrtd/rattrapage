import { createSocket } from 'node:dgram';
import { parseArgs } from 'node:util';
import { numberInRange } from '../src/config-values.js';
import { encode, checksum } from '../src/protocol.js';

// Dedicated benchmark sender: bounded reusable buffers and small paced bursts.
// The teaching simulator stays deliberately readable and is no longer the load ceiling.
const { values } = parseArgs({ options: {
  host: { type: 'string', default: '127.0.0.1' }, port: { type: 'string', default: '9000' },
  rate: { type: 'string', default: '10000' }, seconds: { type: 'string', default: '10' },
  devices: { type: 'string', default: '100' }, offset: { type: 'string', default: '0' },
  'max-burst': { type: 'string', default: '256' }, 'max-pending': { type: 'string', default: '1024' },
} });
const rate = numberInRange(values.rate, 'rate', 1, 2000000, false);
const seconds = numberInRange(values.seconds, 'seconds', 1, 120);
const devices = numberInRange(values.devices, 'devices', 1, 65535);
const offset = numberInRange(values.offset, 'offset', 0, 65535 - devices);
const port = numberInRange(values.port, 'port', 1, 65535);
const maxBurst = numberInRange(values['max-burst'], 'max-burst', 1, 4096);
const maxPending = numberInRange(values['max-pending'], 'max-pending', 1, 65536);
const sequences = new Uint32Array(devices);
const pool = Array.from({ length: maxPending }, () => encode({ type: 1, deviceId: 1, seq: 0, uptimeMs: 0,
  measurements: [{ metricId: 1, value: 4250 }, { metricId: 2, value: 24000 }, { metricId: 3, value: 3000 }] }));
const socket = createSocket('udp4');
let generated = 0; let sent = 0; let sendErrors = 0; let pending = 0; let peakPending = 0; let backlog = 0;
let start = 0; let stopping = false; let closed = false; let activeSeconds = 0;
let timer: NodeJS.Timeout;
function finish() {
  if (closed || !stopping || pending) return;
  closed = true;
  socket.close(() => console.log(JSON.stringify({ targetRate: rate, generated, sent, sendErrors, activeSeconds,
    elapsedSeconds: (performance.now() - start) / 1000, peakPending, maxBacklogFrames: backlog })));
}
function stop() { stopping = true; clearTimeout(timer); activeSeconds = (performance.now() - start) / 1000; finish(); }
socket.on('error', error => { console.error(error.message); process.exitCode = 1; stop(); });
function tick() {
  if (stopping) return;
  const elapsed = performance.now() - start;
  if (elapsed >= seconds * 1000) { stop(); return; }
  const due = Math.max(0, Math.floor(elapsed * rate / 1000) - generated);
  backlog = Math.max(backlog, due);
  const count = Math.min(due, maxBurst, pool.length);
  for (let i = 0; i < count; i++) {
    const data = pool.pop()!;
    const index = generated % devices;
    sequences[index] = (sequences[index]! + 1) >>> 0;
    data.writeUInt16BE(offset + index + 1, 4);
    data.writeUInt32BE(sequences[index]!, 6);
    data.writeUInt32BE(Math.floor(elapsed) >>> 0, 10);
    data[data.length - 1] = checksum(data.subarray(0, -1));
    generated++; pending++; peakPending = Math.max(peakPending, pending);
    // Reuse only after the send callback; mutating an in-flight Buffer corrupts datagrams.
    socket.send(data, port, values.host!, error => {
      if (error) sendErrors++; else sent++;
      pending--; pool.push(data); finish();
    });
  }
  timer = setTimeout(tick, 1);
}
socket.bind(0, () => { start = performance.now(); tick(); });
process.once('SIGINT', stop); process.once('SIGTERM', stop);
