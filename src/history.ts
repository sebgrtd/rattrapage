import { appendFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Snapshot } from './fleet.js';

export interface HistoryEntry { at: string; snapshot: Snapshot }
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

  async read(limit = 120): Promise<HistoryEntry[]> {
    if (!this.file) return [];
    await this.flush();
    const entries: HistoryEntry[] = [];
    for (const path of [this.file + '.1', this.file]) {
      const content = await readFile(path, 'utf8').catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return ''; throw e; });
      for (const line of content.split('\n')) {
        if (!line) continue;
        try {
          const entry = JSON.parse(line) as HistoryEntry;
          if (typeof entry.at === 'string' && entry.snapshot?.counters && Array.isArray(entry.snapshot.devices)) entries.push(entry);
        } catch { /* A crash may leave the very last line incomplete. */ }
      }
    }
    return entries.slice(-limit);
  }
}
