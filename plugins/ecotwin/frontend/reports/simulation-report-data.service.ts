import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { ECOTWIN_CONFIG } from '../config';

import type { SimulationBaseline, SimulationSummary } from '../contracts';

/** Persisted report data and explicit baseline preparation; never calls Eco-evo. */
@Injectable({ providedIn: 'root' })
export class SimulationReportData {
  private readonly config = inject(ECOTWIN_CONFIG);
  private readonly http = inject(HttpClient);
  private url(id: number): string {
    return `${this.config.apiBaseUrl}/calculation/${id}/simulations`;
  }
  list(id: number): Promise<SimulationSummary[]> {
    return firstValueFrom(this.http.get<SimulationSummary[]>(this.url(id)).pipe(timeout(30000)));
  }
  baseline(id: number): Promise<SimulationBaseline | null> {
    return firstValueFrom(
      this.http
        .get<SimulationBaseline | null>(
          `${this.config.apiBaseUrl}/calculation/${id}/simulation-baseline`
        )
        .pipe(timeout(30000))
    );
  }
  createBaseline(id: number): Promise<SimulationBaseline> {
    return firstValueFrom(
      this.http
        .post<SimulationBaseline>(
          `${this.config.apiBaseUrl}/calculation/${id}/simulation-baseline`,
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
