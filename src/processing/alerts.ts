import { text } from '../config-values.js';
import type { StepDefinition, StepFactory } from './types.js';

interface Definition extends StepDefinition { ruleIds?: string[] }
export const alertsFactory: StepFactory = {
  phase: 'compute',
  validate(raw): Definition {
    if (raw.ruleIds !== undefined && !Array.isArray(raw.ruleIds)) throw new Error('alerts.ruleIds: tableau attendu');
    return { id: text(raw.id, 'step.id'), type: 'alerts', ruleIds: (raw.ruleIds as unknown[] | undefined)?.map(v => text(v, 'ruleId')) };
  },
  create(definition) {
    const d = definition as Definition;
    const selected = d.ruleIds === undefined ? undefined : new Set(d.ruleIds);
    return { process(frame, context) {
      for (const measurement of frame.measurements) {
        const previous = context.metrics[measurement.metricId];
        const continuous = previous !== undefined && context.now - previous.at < context.staleMs;
        for (const rule of context.rules) {
          if (rule.metricId !== measurement.metricId || (selected && !selected.has(rule.id))) continue;
          if (measurement.value < rule.min || measurement.value > rule.max) {
            if (!continuous || !context.breaches.has(rule.id)) context.breaches.set(rule.id, context.now);
          } else context.breaches.delete(rule.id);
        }
      }
      return true;
    } };
  },
};
