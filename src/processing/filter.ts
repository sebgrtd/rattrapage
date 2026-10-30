import { numberInRange, text } from '../config-values.js';
import type { StepDefinition, StepFactory } from './types.js';

interface Definition extends StepDefinition { deviceIds?: number[]; excludeDeviceIds: number[]; metricId?: number; min: number; max: number }
function ids(value: unknown, name: string): number[] {
  if (!Array.isArray(value)) throw new Error(`${name}: tableau attendu`);
  return [...new Set(value.map(v => numberInRange(v, name, 1, 65535)))];
}
export const filterFactory: StepFactory = {
  phase: 'filter',
  validate(raw): Definition {
    const min = numberInRange(raw.min ?? -32768, 'filter.min', -32768, 32767);
    return { id: text(raw.id, 'step.id'), type: 'filter',
      deviceIds: raw.deviceIds === undefined ? undefined : ids(raw.deviceIds, 'deviceIds'),
      excludeDeviceIds: ids(raw.excludeDeviceIds ?? [], 'excludeDeviceIds'),
      metricId: raw.metricId === undefined ? undefined : numberInRange(raw.metricId, 'filter.metricId', 1, 3),
      min, max: numberInRange(raw.max ?? 32767, 'filter.max', min, 32767) };
  },
  create(definition) {
    const d = definition as Definition;
    const allowed = d.deviceIds === undefined ? undefined : new Set(d.deviceIds);
    const excluded = new Set(d.excludeDeviceIds);
    return { process(frame) {
      if ((allowed && !allowed.has(frame.deviceId)) || excluded.has(frame.deviceId)) return false;
      // A metric filter must not reject heartbeats: there is intentionally no value to test.
      if (frame.type === 2 || d.metricId === undefined) return true;
      const measurement = frame.measurements.find(m => m.metricId === d.metricId);
      return measurement !== undefined && measurement.value >= d.min && measurement.value <= d.max;
    } };
  },
};
