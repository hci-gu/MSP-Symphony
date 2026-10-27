import { InjectionToken, Signal } from '@angular/core';
import { EMPTY, Observable } from 'rxjs';
import type { CalculationInput, CalculationGrid } from './workspace/calculation-input';
import type { PreparedInput } from './workspace/ecotwin-input';
export interface CalculationChoice {
  id: number;
  name: string;
  timestamp: number;
}
export interface Calculations {
  calculations: Signal<CalculationChoice[]>;
  loading: Signal<boolean>;
  error: Signal<string>;
  refresh(): Promise<void>;
  clear(): void;
  context(id: number): Promise<CalculationInput>;
  grid(source: CalculationInput, input: PreparedInput): Promise<CalculationGrid>;
}
export const CALCULATIONS = new InjectionToken<Calculations>('EcoTwin calculations');
export type HostLifecycleEvent =
  | { type: 'logout' }
  | { type: 'calculations-deleted', ids: number[] };
export const HOST_LIFECYCLE = new InjectionToken<Observable<HostLifecycleEvent>>(
  'EcoTwin host lifecycle',
  { factory: () => EMPTY }
);
export interface PreparationLink {
  calculation: number;
  matchCalculation?: number;
  matchRun?: string;
}
export const PREPARATION_LINK = new InjectionToken<PreparationLink | null>(
  'EcoTwin preparation link',
  { factory: () => null }
);

export interface Navigation {
  prepare(calculationId: number, match?: { calculationId: number, runId: string }): string;
}
export const NAVIGATION = new InjectionToken<Navigation>('EcoTwin navigation', {
  factory: () => ({ prepare: () => '' })
});
