import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '@src/environments/environment';
import type { CalculationInput } from '../mareld-poc/calculation-input';
import type { PreparedInput } from '../mareld-poc/mareld-input';
import type { EnsembleResult, MareldModel } from '../mareld-poc/mareld-result';

export interface SimulationConfig {
  maxSteps: number;
  sampleEvery: number;
  seed: number;
  replicates?: number;
  tickDurationDays: number;
  mappingVersion: string;
}
export interface SimulationBaseline {
  scenarioCalculationId: number;
  baselineCalculationId: number;
  sourceFingerprint: string;
}
export interface SimulationSummary {
  version: 'ecotwin-report-v1' | 'ecotwin-report-v2';
  ensemble?: EnsembleResult;
  runId: string;
  calculationId: number;
  completedAt: number;
  source: CalculationInput;
  model: MareldModel;
  config: SimulationConfig;
  grid: PreparedInput['grid'];
  steps: number[];
  species: string[];
  units: 'tonnes/cell';
  waterCells: number;
  nativeAreaKm2: number;
  water: number[];
  assumptions: string[];
  totals: number[][];
  maxima: number[];
  pressures: {
    kind: string;
    sourceId: string;
    sourceSha256: string;
    strength: number;
    coverage: number;
    affectedCells: number;
  }[];
  finalBiomassB64?: string;
}

/** Persisted report data and explicit baseline preparation; never calls Eco-evo. */
@Injectable({ providedIn: 'root' })
export class SimulationReportData {
  private readonly http = inject(HttpClient);
  private url(id: number): string {
    return `${environment.apiBaseUrl}/calculation/${id}/simulations`;
  }
  list(id: number): Promise<SimulationSummary[]> {
    return firstValueFrom(this.http.get<SimulationSummary[]>(this.url(id)).pipe(timeout(30000)));
  }
  baseline(id: number): Promise<SimulationBaseline | null> {
    return firstValueFrom(
      this.http
        .get<SimulationBaseline | null>(
          `${environment.apiBaseUrl}/calculation/${id}/simulation-baseline`
        )
        .pipe(timeout(30000))
    );
  }
  createBaseline(id: number): Promise<SimulationBaseline> {
    return firstValueFrom(
      this.http
        .post<SimulationBaseline>(
          `${environment.apiBaseUrl}/calculation/${id}/simulation-baseline`,
          {}
        )
        .pipe(timeout(120000))
    );
  }
  report(id: number, runId: string): Promise<SimulationSummary> {
    return firstValueFrom(
      this.http
        .get<SimulationSummary>(`${this.url(id)}/${encodeURIComponent(runId)}?view=report`)
        .pipe(timeout(30000))
    );
  }
}
