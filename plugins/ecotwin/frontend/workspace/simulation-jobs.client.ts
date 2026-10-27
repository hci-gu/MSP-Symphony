import { PROFILE } from '../profile';
import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { ECOTWIN_CONFIG } from '../config';
import { ECOTWIN_RUN } from '../shared/run-config';
import type { SimulationConfig } from '../contracts';
import { EcoTwinModel, sampleEvery } from './ecotwin-result';
import { PreparedInput } from './ecotwin-input';

export interface SimulationJob {
  runId: string;
  calculationId: number;
  status: 'queued' | 'running' | 'failed' | 'completed';
  createdAt: number;
  completedSeeds: number;
  replicates: number;
  config: SimulationConfig;
  model: EcoTwinModel;
  error?: string;
}

export interface SimulationRequest {
  version: 'ecotwin-run-v2' | 'ecotwin-preview-v1';
  runId: string;
  input: PreparedInput;
  model: EcoTwinModel;
  config: SimulationConfig;
}

export function fullRunRequest(
  input: PreparedInput,
  model: EcoTwinModel,
  maxSteps: number,
  seed: number
): SimulationRequest {
  return JSON.parse(
    JSON.stringify(
      {
        version: 'ecotwin-run-v2',
        runId: crypto.randomUUID(),
        input,
        model,
        config: {
          maxSteps,
          sampleEvery: sampleEvery(maxSteps),
          seed,
          replicates: PROFILE.replicates,
          tickDurationDays: ECOTWIN_RUN.tickDurationDays,
          mappingVersion: input.impacts?.version
        }
      },
      (_, value) => (ArrayBuffer.isView(value) ? Array.from(value as Uint8Array) : value)
    )
  );
}

@Injectable({ providedIn: 'root' })
export class SimulationJobsClient {
  private readonly config = inject(ECOTWIN_CONFIG);
  private readonly http = inject(HttpClient);
  private url(id: number): string {
    return `${this.config.apiBaseUrl}/calculation/${id}/simulation-jobs`;
  }
  list(id: number): Promise<SimulationJob[]> {
    return firstValueFrom(this.http.get<SimulationJob[]>(this.url(id)).pipe(timeout(30000)));
  }
  submit(request: ReturnType<typeof fullRunRequest>): Promise<SimulationJob> {
    return firstValueFrom(
      this.http
        .put<SimulationJob>(
          `${this.url(request.input.source!.calculationId)}/${request.runId}`,
          request
        )
        .pipe(timeout(120000))
    );
  }
  retry(id: number, runId: string): Promise<SimulationJob> {
    return firstValueFrom(
      this.http.post<SimulationJob>(`${this.url(id)}/${runId}/retry`, {}).pipe(timeout(30000))
    );
  }
}
