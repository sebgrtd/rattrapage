import { appendFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Snapshot } from './fleet.js';

export interface HistoryEntry { at: string; snapshot: Snapshot }
export interface HistoryMatch {
  requestedAt: string; entry: HistoryEntry | null; deltaMs: number | null;
  toleranceMs: number; previousAt: string | null; nextAt: string | null;
}
/** Periodic snapshots, one pending disk write maximum, two bounded files. */
export class History {
  private pending: Promise<void> | undefined;
  private bytes: number | undefined;
  readonly status = { written: 0, skipped: 0, error: '' };
  constructor(private readonly file: string, private readonly maxBytes: number) {}

  record(snapshot: Snapshot): void {
    if (!this.file) return;
    if (this.pending) { this.status.skipped++; return; }
    const line = JSON.stringify({ at: new Date().toISOString(), snapshot }) + '\n';
    if (Buffer.byteLength(line) > this.maxBytes) { this.status.skipped++; this.status.error = 'Synthèse trop volumineuse pour historyMaxBytes'; return; }
    this.pending = this.write(line).catch((error: unknown) => { this.status.error = error instanceof Error ? error.message : String(error); })
      .finally(() => { this.pending = undefined; });
  }

  private async write(line: string): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    if (this.bytes === undefined) this.bytes = await stat(this.file).then(s => s.size).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return 0; throw e; });
    const size = Buffer.byteLength(line);
    if (this.bytes + size > this.maxBytes) {
      await unlink(this.file + '.1').catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
      await rename(this.file, this.file + '.1').catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
      this.bytes = 0;
    }
    await appendFile(this.file, line, 'utf8');
    this.bytes += size; this.status.written++; this.status.error = '';
  }

  async flush(): Promise<void> { await this.pending; }

  private async scan(visit: (entry: HistoryEntry, time: number) => void): Promise<void> {
    if (!this.file) return;
    await this.flush();
    for (const path of [this.file + '.1', this.file]) {
      const content = await readFile(path, 'utf8').catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return ''; throw e; });
      for (const line of content.split('\n')) {
        if (!line) continue;
        try {
          const entry = JSON.parse(line) as HistoryEntry;
          const time = typeof entry.at === 'string' ? Date.parse(entry.at) : NaN;
          if (Number.isFinite(time) && entry.snapshot?.counters && Array.isArray(entry.snapshot.devices)) visit(entry, time);
        } catch { /* A crash may leave the very last line incomplete. */ }
      }
    }
  }

  async read(limit = 120): Promise<HistoryEntry[]> {
    const entries: HistoryEntry[] = [];
    await this.scan(entry => { entries.push(entry); if (entries.length > limit) entries.shift(); });
    return entries;
  }

  /** Lightweight index of every retained snapshot, including the rotated file. */
  async timestamps(): Promise<string[]> {
    const times = new Set<number>();
    await this.scan((_entry, time) => times.add(time));
    return [...times].sort((a, b) => a - b).map(time => new Date(time).toISOString());
  }

  /** No interpolation or carry-forward through gaps. Ties prefer the older record. */
  async at(time: number, toleranceMs: number): Promise<HistoryMatch> {
    let closest: HistoryEntry | null = null;
    let closestTime = Infinity;
    const times: number[] = [];
    await this.scan((entry, stamp) => {
      times.push(stamp);
      if (Math.abs(stamp - time) < Math.abs(closestTime - time) ||
          (Math.abs(stamp - time) === Math.abs(closestTime - time) && stamp < closestTime)) {
        closest = entry; closestTime = stamp;
      }
    });
    const found = Math.abs(closestTime - time) <= toleranceMs;
    const anchor = found ? closestTime : time;
    let previous = -Infinity;
    let next = Infinity;
    for (const stamp of times) {
      if (stamp < anchor && stamp > previous) previous = stamp;
      if (stamp > anchor && stamp < next) next = stamp;
    }
    return { requestedAt: new Date(time).toISOString(), entry: found ? closest : null,
      deltaMs: found ? closestTime - time : null, toleranceMs,
      previousAt: Number.isFinite(previous) ? new Date(previous).toISOString() : null,
      nextAt: Number.isFinite(next) ? new Date(next).toISOString() : null };
  }
}
