import { readFileSync } from 'node:fs';
import type { MetricId } from './protocol.js';
import type { RestartConfig } from './sequence.js';

export interface AlertRule { id: string; label: string; metricId: MetricId; min: number; max: number; durationMs: number }
export interface Config {
  udpHost: string; udpPort: number; httpHost: string; httpPort: number;
  refreshMs: number; offlineMs: number; staleMs: number; rateWindowMs: number;
  maxDevices: number; maxClients: number; historyFile: string; historyIntervalMs: number; historyMaxBytes: number;
  alerts: AlertRule[];
  restart: RestartConfig;
}
export function numberInRange(value: unknown, name: string, min: number, max: number, integer = true): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min || n > max) throw new Error(`${name}: valeur attendue entre ${min} et ${max}`);
  return n;
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Objet JSON attendu');
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) throw new Error(`${name}: texte attendu`);
  return value;
}
export function validateConfig(value: unknown): Config {
  const c = object(value);
  const num = (key: string, min: number, max: number) => numberInRange(c[key], key, min, max);
  const restart = object(c.restart);
  const restartNumber = (key: string, min: number, max: number) => numberInRange(restart[key], `restart.${key}`, min, max);
  if (!Array.isArray(c.alerts)) throw new Error('alerts: tableau attendu');
  const ids = new Set<string>();
  const alerts = c.alerts.map(value => {
    const r = object(value);
    const id = text(r.id, 'alert.id');
    if (ids.has(id)) throw new Error(`Alerte dupliquée: ${id}`);
    ids.add(id);
    const min = numberInRange(r.min, 'alert.min', -32768, 32767);
    const max = numberInRange(r.max, 'alert.max', min, 32767);
    return { id, label: text(r.label, 'alert.label'), metricId: numberInRange(r.metricId, 'metricId', 1, 3) as MetricId,
      min, max, durationMs: numberInRange(r.durationMs, 'durationMs', 0, 3600000) };
  });
  const config: Config = {
    udpHost: text(c.udpHost, 'udpHost'), udpPort: num('udpPort', 1, 65535),
    httpHost: text(c.httpHost, 'httpHost'), httpPort: num('httpPort', 1, 65535),
    refreshMs: num('refreshMs', 100, 10000), offlineMs: num('offlineMs', 100, 3600000),
    staleMs: num('staleMs', 100, 3600000), rateWindowMs: num('rateWindowMs', 100, 60000),
    maxDevices: num('maxDevices', 1, 65535), maxClients: num('maxClients', 1, 100),
    historyFile: text(c.historyFile, 'historyFile', true), historyIntervalMs: num('historyIntervalMs', 1000, 3600000),
    historyMaxBytes: num('historyMaxBytes', 1024, 104857600), alerts,
    restart: {
      maxUptimeMs: restartNumber('maxUptimeMs', 1, 3600000), maxSequence: restartNumber('maxSequence', 1, 1000000),
      minUptimeDropMs: restartNumber('minUptimeDropMs', 1, 3600000), confirmFrames: restartNumber('confirmFrames', 2, 20),
      confirmWindowMs: restartNumber('confirmWindowMs', 1, 60000), uptimeToleranceMs: restartNumber('uptimeToleranceMs', 0, 60000),
    },
  };
  if (config.staleMs > config.offlineMs) throw new Error('staleMs doit être <= offlineMs');
  return config;
}
export function loadConfig(path?: string, overrides: Partial<Config> = {}): Config {
  const base = JSON.parse(readFileSync(new URL('../config/default.json', import.meta.url), 'utf8')) as unknown;
  const custom: unknown = path ? JSON.parse(readFileSync(path, 'utf8')) : {};
  return validateConfig({ ...object(base), ...object(custom), ...overrides });
}
