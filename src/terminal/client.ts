import type { LiveSnapshot } from './dashboard.js';
import type { HistoryEntry } from '../history.js';

export function hubUrl(input: string): string {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('URL HTTP(S) du hub attendue, sans identifiants, chemin ni paramètres.');
  }
  return url.origin;
}
export async function readJson(base: string, path: '/api/state' | '/api/history', signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(2000);
  const response = await fetch(base + path, { signal: signal ? AbortSignal.any([timeout, signal]) : timeout });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
export function snapshotResponse(value: unknown): LiveSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Réponse du hub invalide');
  const s = value as LiveSnapshot;
  if (!s.counters || !s.totals || !Array.isArray(s.devices) || !Number.isFinite(s.ratePerSecond) || !Number.isFinite(Date.parse(s.at))) throw new Error('Réponse du hub invalide');
  if (s.devices.some(d => !d || !['online', 'alert', 'offline', 'stale', 'watch'].includes(d.status) || !Array.isArray(d.metrics) || !Array.isArray(d.alerts))) throw new Error('Appareil invalide');
  return s;
}
export function historyResponse(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) throw new Error('Historique invalide');
  return value.map((e: HistoryEntry) => { snapshotResponse({ ...e.snapshot, at: e.at }); return e; });
}
