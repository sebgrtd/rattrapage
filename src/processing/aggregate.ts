import { numberInRange, text } from '../config-values.js';
import type { MetricId } from '../protocol.js';
import type { StepDefinition, StepFactory } from './types.js';

interface Definition extends StepDefinition { label: string; metricId: MetricId; operation: 'mean' | 'min' | 'max'; windowMs: number; maxSamples: number }
export const aggregateFactory: StepFactory = {
  phase: 'compute',
  validate(raw): Definition {
    if (raw.operation !== 'mean' && raw.operation !== 'min' && raw.operation !== 'max') throw new Error('aggregate.operation: mean, min ou max attendu');
    return { id: text(raw.id, 'step.id'), type: 'aggregate', label: text(raw.label ?? raw.id, 'aggregate.label'),
      metricId: numberInRange(raw.metricId, 'aggregate.metricId', 1, 3) as MetricId, operation: raw.operation,
      windowMs: numberInRange(raw.windowMs, 'aggregate.windowMs', 100, 3600000),
      maxSamples: numberInRange(raw.maxSamples, 'aggregate.maxSamples', 1, 10000) };
  },
  create(definition) {
    const d = definition as Definition;
    return { process(frame, context) {
      const measurement = frame.measurements.find(m => m.metricId === d.metricId);
      let window = context.windows.get(d.id);
      if (!window && !measurement) return true;
      if (!window) { window = { samples: [], head: 0, sum: 0 }; context.windows.set(d.id, window); }
      if (measurement) { window.samples.push({ value: measurement.value, at: context.now }); window.sum += measurement.value; }
      while (window.head < window.samples.length && (window.samples.length - window.head > d.maxSamples || window.samples[window.head]!.at <= context.now - d.windowMs)) {
        window.sum -= window.samples[window.head++]!.value;
      }
      if (window.head >= d.maxSamples) { window.samples = window.samples.slice(window.head); window.head = 0; }
      const samples = window.samples.length - window.head;
      if (!samples) { delete context.aggregates[d.id]; return true; }
      let value = window.sum / samples;
      if (d.operation !== 'mean') {
        value = window.samples[window.head]!.value;
        for (let i = window.head + 1; i < window.samples.length; i++) value = d.operation === 'min' ? Math.min(value, window.samples[i]!.value) : Math.max(value, window.samples[i]!.value);
      }
      context.aggregates[d.id] = { id: d.id, label: d.label, metricId: d.metricId, operation: d.operation, value, samples, at: window.samples.at(-1)!.at, windowMs: d.windowMs };
      return true;
    } };
  },
};
