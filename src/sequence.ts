export type SequenceResult = { kind: 'accepted'; lost: number } | { kind: 'duplicate' | 'late'; lost: 0 };
/** uint32 serial arithmetic: only the forward half of the ring is newer. */
export class Sequencer {
  private last: number | undefined;
  inspect(seq: number): SequenceResult {
    if (this.last === undefined) { this.last = seq; return { kind: 'accepted', lost: 0 }; }
    const delta = (seq - this.last) >>> 0;
    if (delta === 0) return { kind: 'duplicate', lost: 0 };
    if (delta >= 0x80000000) return { kind: 'late', lost: 0 };
    this.last = seq;
    return { kind: 'accepted', lost: delta - 1 };
  }
}

export interface RestartConfig {
  maxUptimeMs: number;
  maxSequence: number;
  minUptimeDropMs: number;
  confirmFrames: number;
  confirmWindowMs: number;
  uptimeToleranceMs: number;
}
type Observation = { seq: number; uptimeMs: number; at: number };
export type SessionResult =
  | { kind: 'accepted'; lost: number; restarted: boolean }
  | { kind: 'duplicate' | 'late' | 'restartPending'; lost: 0; restarted: false };

/** v1 has no boot ID: require a coherent run of reset counters, never one old packet. */
export class DeviceSession {
  private sequence = new Sequencer();
  private last: Observation | undefined;
  private candidate: (Observation & { firstAt: number; count: number }) | undefined;
  private guarded = false;
  constructor(private readonly config: RestartConfig) {}

  inspect(seq: number, uptimeMs: number, now: number): SessionResult {
    const rejected = (kind: 'duplicate' | 'late' | 'restartPending'): SessionResult => ({ kind, lost: 0, restarted: false });
    if (this.candidate && now - this.candidate.firstAt > this.config.confirmWindowMs) this.candidate = undefined;
    if (this.last) {
      const uptimeDelta = (uptimeMs - this.last.uptimeMs) >>> 0;
      const backwards = uptimeDelta >= 0x80000000;
      const reset = backwards && this.last.uptimeMs - uptimeMs >= this.config.minUptimeDropMs
        && uptimeMs <= this.config.maxUptimeMs && seq <= this.config.maxSequence && seq <= this.last.seq;
      if (reset) {
        const c = this.candidate;
        if (!c) this.candidate = { seq, uptimeMs, at: now, firstAt: now, count: 1 };
        else {
          // Duplicated candidates do not vote twice; an inconsistent candidate cannot confirm.
          if (seq <= c.seq || uptimeMs < c.uptimeMs) return rejected('late');
          if (Math.abs((uptimeMs - c.uptimeMs) - (now - c.at)) > this.config.uptimeToleranceMs) {
            this.candidate = undefined;
            return rejected('late');
          }
          this.candidate = { ...c, seq, uptimeMs, at: now, count: c.count + 1 };
        }
        if (this.candidate!.count < this.config.confirmFrames) return rejected('restartPending');
        this.sequence = new Sequencer();
        this.sequence.inspect(seq);
        this.last = { seq, uptimeMs, at: now };
        this.candidate = undefined;
        this.guarded = true;
        return { kind: 'accepted', lost: 0, restarted: true };
      }
      // After a confirmed restart, discard old-session packets whose uptime is in the future.
      // Serial uptime arithmetic preserves the natural uint32 uptime wrap (~49.7 days).
      if (this.guarded && (backwards || uptimeDelta > Math.max(0, now - this.last.at) + this.config.uptimeToleranceMs)) return rejected('late');
    }
    const result = this.sequence.inspect(seq);
    if (result.kind !== 'accepted') return rejected(result.kind);
    this.last = { seq, uptimeMs, at: now };
    this.candidate = undefined;
    return { ...result, restarted: false };
  }
}
