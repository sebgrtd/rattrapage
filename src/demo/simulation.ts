import { encode } from '../protocol.js';

export type DemoAction = 'heat' | 'cool' | 'stop' | 'resume' | 'restart' | 'normal';
interface Device { id: number; seq: number; bootAt: number; hot: boolean; stopped: boolean; restartAt?: number; lastUptime: number }

/** Controls affect future UDP frames only; the hub remains the source of observed state. */
export class InteractiveSimulation {
  private readonly devices: Device[];
  constructor(count: number, private readonly clock = () => performance.now()) {
    if (!Number.isInteger(count) || count < 1 || count > 200) throw new Error('1 à 200 appareils attendus');
    const now = clock();
    this.devices = Array.from({ length: count }, (_, i) => ({ id: i + 1, seq: 0, bootAt: now, hot: false, stopped: false, lastUptime: 0 }));
  }
  act(id: number, action: DemoAction): void {
    const d = this.devices.find(d => d.id === id);
    if (!d) throw new Error('Appareil inconnu');
    if (d.restartAt !== undefined) throw new Error('Redémarrage en cours : attendre sa fin');
    switch (action) {
      case 'heat': d.hot = true; break;
      case 'cool': d.hot = false; break;
      case 'stop': d.stopped = true; break;
      case 'resume': d.stopped = false; break;
      case 'normal': d.hot = false; d.stopped = false; break;
      case 'restart':
        // An early reset cannot be distinguished reliably by the v1 uptime heuristic.
        if (d.seq < 4 || d.lastUptime < 1000) throw new Error('Attendre au moins 1 seconde de télémétrie avant de redémarrer');
        d.restartAt = this.clock() + 1000; d.stopped = false; break;
      default: throw new Error('Action inconnue');
    }
  }
  frames(): Buffer[] {
    const now = this.clock();
    return this.devices.flatMap(d => {
      if (d.restartAt !== undefined) {
        if (now < d.restartAt) return [];
        d.seq = 0; d.bootAt = now; d.lastUptime = 0; d.restartAt = undefined;
      }
      if (d.stopped) return [];
      d.seq = (d.seq + 1) >>> 0; d.lastUptime = Math.floor(now - d.bootAt) >>> 0;
      const phase = now / 1000 + d.id;
      return [encode({ type: 1, deviceId: d.id, seq: d.seq, uptimeMs: d.lastUptime, measurements: [
        { metricId: 1, value: Math.round((d.hot ? 8500 : 4300) + Math.sin(phase) * 150) },
        { metricId: 2, value: Math.round(24000 + Math.sin(phase * 0.7) * 100) },
        { metricId: 3, value: Math.round(2800 + Math.cos(phase * 0.9) * 100) },
      ] })];
    });
  }
  snapshot() {
    return this.devices.map(d => ({ id: d.id, seq: d.seq, hot: d.hot,
      status: d.restartAt !== undefined ? 'restarting' : d.stopped ? 'offline' : 'running',
      restartRemainingMs: d.restartAt === undefined ? 0 : Math.max(0, d.restartAt - this.clock()),
      canRestart: d.restartAt === undefined && d.seq >= 4 && d.lastUptime >= 1000,
    }));
  }
}
