import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '@src/environments/environment';
import { MARELD_RUN } from '../mareld-shared/run-config';
import { SimulationConfig } from '../simulation-reports/simulation-report-data.service';
import { MareldModel, sampleEvery } from './mareld-result';
import { PreparedInput } from './mareld-input';

export interface SimulationJob {
  runId: string;
  calculationId: number;
  status: 'queued' | 'running' | 'failed' | 'completed';
  createdAt: number;
  completedSeeds: number;
  replicates: number;
  config: SimulationConfig;
  model: MareldModel;
  error?: string;
}

export interface SimulationRequest {
  version: 'ecotwin-run-v2' | 'ecotwin-preview-v1';
  runId: string;
  input: PreparedInput;
  model: MareldModel;
  config: SimulationConfig;
}

export function fullRunRequest(
  input: PreparedInput,
  model: MareldModel,
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
          replicates: 10,
          tickDurationDays: MARELD_RUN.tickDurationDays,
          mappingVersion: input.impacts?.version
        }
      },
      (_, value) => (ArrayBuffer.isView(value) ? Array.from(value as Uint8Array) : value)
    )
  );
}

@Injectable({ providedIn: 'root' })
export class SimulationJobsClient {
  private readonly http = inject(HttpClient);
  private url(id: number): string {
    return `${environment.apiBaseUrl}/calculation/${id}/simulation-jobs`;
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
