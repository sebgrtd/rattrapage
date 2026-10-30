import { readFileSync } from 'node:fs';
import type { MetricId } from './protocol.js';
import type { RestartConfig } from './sequence.js';
import { numberInRange, object, text } from './config-values.js';
import { validatePipeline } from './processing/pipeline.js';
import type { StepDefinition } from './processing/types.js';
export { numberInRange } from './config-values.js';

export interface AlertRule { id: string; label: string; metricId: MetricId; min: number; max: number; durationMs: number }
export interface Config {
  udpHost: string; udpPort: number; httpHost: string; httpPort: number;
  refreshMs: number; offlineMs: number; staleMs: number; rateWindowMs: number;
  maxDevices: number; maxClients: number; historyFile: string; historyIntervalMs: number; historyMaxBytes: number;
  alerts: AlertRule[];
  restart: RestartConfig;
  pipeline: StepDefinition[];
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
    historyMaxBytes: num('historyMaxBytes', 1024, 104857600), alerts, pipeline: validatePipeline(c.pipeline),
    restart: {
      maxUptimeMs: restartNumber('maxUptimeMs', 1, 3600000), maxSequence: restartNumber('maxSequence', 1, 1000000),
      minUptimeDropMs: restartNumber('minUptimeDropMs', 1, 3600000), confirmFrames: restartNumber('confirmFrames', 2, 20),
      confirmWindowMs: restartNumber('confirmWindowMs', 1, 60000), uptimeToleranceMs: restartNumber('uptimeToleranceMs', 0, 60000),
    },
  };
  if (config.staleMs > config.offlineMs) throw new Error('staleMs doit être <= offlineMs');
  for (const step of config.pipeline) {
    if (step.type === 'alerts' && Array.isArray(step.ruleIds) && step.ruleIds.some(id => !ids.has(String(id)))) throw new Error(`Règle inconnue dans l’étape ${step.id}`);
  }
  return config;
}
export function loadConfig(path?: string, overrides: Partial<Config> = {}): Config {
  const base = JSON.parse(readFileSync(new URL('../config/default.json', import.meta.url), 'utf8')) as unknown;
  const custom: unknown = path ? JSON.parse(readFileSync(path, 'utf8')) : {};
  return validateConfig({ ...object(base), ...object(custom), ...overrides });
}
