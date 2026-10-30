import { decode, type DecodeError, type Frame, type MetricId } from './protocol.js';
import type { Config } from './config.js';
import { DeviceSession } from './sequence.js';

interface Metric { value: number; at: number }
interface Device {
  id: number; sequence: DeviceSession; seq: number; uptimeMs: number; lastSeen: number; restarts: number;
  accepted: number; lost: number; duplicates: number; late: number;
  metrics: Partial<Record<MetricId, Metric>>; breaches: Map<string, number>;
}
export class Fleet {
  private readonly devices = new Map<number, Device>();
  private readonly buckets = new Map<number, number>();
  private readonly counters = { received: 0, accepted: 0, invalid: 0, lost: 0, duplicates: 0, late: 0, capacityRejected: 0, restartPending: 0, restarts: 0 };
  private readonly invalidReasons: Partial<Record<DecodeError, number>> = {};
  constructor(private readonly config: Config, private readonly clock: () => number = () => performance.now()) {}

  receive(data: Buffer): void {
    const now = this.clock();
    this.counters.received++;
    const bucket = Math.floor(now / (this.config.rateWindowMs / 20));
    this.buckets.set(bucket, (this.buckets.get(bucket) ?? 0) + 1);
    this.pruneBuckets(bucket);
    const result = decode(data);
    if (!result.ok) {
      this.counters.invalid++;
      this.invalidReasons[result.error] = (this.invalidReasons[result.error] ?? 0) + 1;
      return;
    }
    this.apply(result.frame, now);
  }

  private apply(frame: Frame, now: number): void {
    let device = this.devices.get(frame.deviceId);
    if (!device) {
      if (this.devices.size >= this.config.maxDevices) { this.counters.capacityRejected++; return; }
      device = { id: frame.deviceId, sequence: new DeviceSession(this.config.restart), seq: frame.seq, uptimeMs: frame.uptimeMs, restarts: 0,
        lastSeen: now, accepted: 0, lost: 0, duplicates: 0, late: 0, metrics: {}, breaches: new Map() };
      this.devices.set(device.id, device);
    }
    const result = device.sequence.inspect(frame.seq, frame.uptimeMs, now);
    if (result.kind !== 'accepted') {
      if (result.kind === 'restartPending') { this.counters.restartPending++; return; }
      const key = result.kind === 'duplicate' ? 'duplicates' : 'late';
      device[key]++; this.counters[key]++;
      return;
    }
    if (result.restarted) {
      device.metrics = {}; device.breaches.clear(); device.restarts++; this.counters.restarts++;
    }
    device.seq = frame.seq; device.uptimeMs = frame.uptimeMs; device.lastSeen = now;
    device.accepted++; this.counters.accepted++;
    device.lost += result.lost; this.counters.lost += result.lost;
    for (const measurement of frame.measurements) {
      const previous = device.metrics[measurement.metricId];
      const continuity = previous !== undefined && now - previous.at < this.config.staleMs;
      for (const rule of this.config.alerts.filter(r => r.metricId === measurement.metricId)) {
        if (measurement.value < rule.min || measurement.value > rule.max) {
          if (!continuity || !device.breaches.has(rule.id)) device.breaches.set(rule.id, now);
        } else device.breaches.delete(rule.id);
      }
      device.metrics[measurement.metricId] = { value: measurement.value, at: now };
    }
  }

  private pruneBuckets(current: number): void {
    for (const key of this.buckets.keys()) if (key <= current - 20) this.buckets.delete(key);
  }

  snapshot() {
    const now = this.clock();
    this.pruneBuckets(Math.floor(now / (this.config.rateWindowMs / 20)));
    const devices = [...this.devices.values()].map(d => {
      const ageMs = Math.max(0, now - d.lastSeen);
      const offline = ageMs >= this.config.offlineMs;
      const metrics = ([1, 2, 3] as const).map(id => {
        const m = d.metrics[id];
        return { id, value: m?.value ?? null, ageMs: m ? Math.max(0, now - m.at) : null, stale: !m || now - m.at >= this.config.staleMs };
      });
      const alerts = this.config.alerts.flatMap(rule => {
        const since = d.breaches.get(rule.id);
        const metric = d.metrics[rule.metricId];
        if (offline || since === undefined || !metric || now - metric.at >= this.config.staleMs) return [];
        return [{ id: rule.id, label: rule.label, active: now - since >= rule.durationMs, elapsedMs: Math.max(0, now - since), durationMs: rule.durationMs }];
      });
      const status = offline ? 'offline' : alerts.some(a => a.active) ? 'alert' : metrics.some(m => m.stale) ? 'stale' : alerts.length ? 'watch' : 'online';
      return { id: d.id, seq: d.seq, uptimeMs: d.uptimeMs, ageMs, status, restarts: d.restarts,
        accepted: d.accepted, lost: d.lost, duplicates: d.duplicates, late: d.late, metrics, alerts };
    }).sort((a, b) => a.id - b.id);
    const totals = { devices: devices.length, online: 0, alert: 0, offline: 0, stale: 0, watch: 0 };
    for (const d of devices) totals[d.status as keyof Omit<typeof totals, 'devices'>]++;
    const denominator = this.counters.accepted + this.counters.lost;
    return {
      counters: { ...this.counters }, invalidReasons: { ...this.invalidReasons }, totals, devices,
      ratePerSecond: [...this.buckets.values()].reduce((a, b) => a + b, 0) * 1000 / this.config.rateWindowMs,
      lossPercent: denominator ? 100 * this.counters.lost / denominator : 0,
      invalidPercent: this.counters.received ? 100 * this.counters.invalid / this.counters.received : 0,
    };
  }
}
export type Snapshot = ReturnType<Fleet['snapshot']>;
