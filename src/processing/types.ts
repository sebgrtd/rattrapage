import type { Frame, MetricId } from '../protocol.js';
import type { AlertRule } from '../config.js';

export interface Metric { value: number; at: number }
export interface Aggregate { id: string; label: string; metricId: MetricId; operation: string; value: number; samples: number; at: number; windowMs: number }
export interface RollingWindow { samples: Metric[]; head: number; sum: number }
export interface ProcessingState {
  metrics: Partial<Record<MetricId, Metric>>;
  breaches: Map<string, number>;
  aggregates: Record<string, Aggregate>;
  windows: Map<string, RollingWindow>;
}
export interface ProcessingContext extends ProcessingState { now: number; staleMs: number; rules: AlertRule[] }
export interface StepDefinition { id: string; type: string; [key: string]: unknown }
export interface ProcessingStep { process(frame: Frame, context: ProcessingContext): boolean }
export interface StepFactory {
  phase: 'filter' | 'compute';
  validate(raw: Record<string, unknown>): StepDefinition;
  create(definition: StepDefinition): ProcessingStep;
}
