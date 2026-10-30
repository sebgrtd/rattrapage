import { object, text } from '../config-values.js';
import type { Frame } from '../protocol.js';
import { filterFactory } from './filter.js';
import { aggregateFactory } from './aggregate.js';
import { alertsFactory } from './alerts.js';
import type { ProcessingContext, ProcessingStep, StepDefinition, StepFactory } from './types.js';

/** New step types register here; existing steps and Fleet do not need changes. */
export const stepFactories = new Map<string, StepFactory>([
  ['filter', filterFactory], ['aggregate', aggregateFactory], ['alerts', alertsFactory],
]);

export function validatePipeline(value: unknown, registry = stepFactories): StepDefinition[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error('pipeline: tableau de 32 étapes maximum attendu');
  const ids = new Set<string>();
  let computing = false;
  return value.map(input => {
    const raw = object(input);
    const id = text(raw.id, 'pipeline.id');
    const type = text(raw.type, 'pipeline.type');
    const factory = registry.get(type);
    if (!factory) throw new Error(`Type de traitement inconnu: ${type}`);
    if (ids.has(id)) throw new Error(`Étape dupliquée: ${id}`);
    if (computing && factory.phase === 'filter') throw new Error('Les filtres doivent précéder les calculs pour éviter les mises à jour partielles');
    if (factory.phase === 'compute') computing = true;
    ids.add(id);
    return factory.validate(raw);
  });
}

export class ProcessingPipeline {
  private readonly steps: ProcessingStep[];
  constructor(definitions: StepDefinition[], registry = stepFactories) {
    this.steps = validatePipeline(definitions, registry).map(d => registry.get(d.type)!.create(d));
  }
  process(frame: Frame, context: ProcessingContext): boolean {
    for (const step of this.steps) if (!step.process(frame, context)) return false;
    return true;
  }
}
