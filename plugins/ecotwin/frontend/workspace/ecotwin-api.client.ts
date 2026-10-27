import { ECOTWIN_RUN } from '../shared/run-config';
import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, fromEvent, takeUntil, timeout } from 'rxjs';
import { ECOTWIN_CONFIG } from '../config';
import { PreparedInput } from './ecotwin-input';
import { fullRunRequest } from './simulation-jobs.client';
import {
  checkBudget,
  decodeResult,
  EcoTwinModel,
  EcoTwinResult,
  MAX_TENSOR_BYTES
} from './ecotwin-result';

@Injectable({ providedIn: 'root' })
export class EcoTwinApiClient {
  private readonly config = inject(ECOTWIN_CONFIG);
  private readonly http = inject(HttpClient);
  private readonly base = this.config.apiBaseUrl + '/extensions/ecotwin';

  async models(): Promise<EcoTwinModel[]> {
    const payload = await firstValueFrom(
      this.http.get<unknown>(`${this.base}/models`).pipe(timeout(ECOTWIN_RUN.discoveryTimeoutMs))
    );
    if (!Array.isArray(payload)) throw new Error('The API returned an invalid model list.');
    const models = payload
      .filter(
        (m) =>
          typeof m?.id === 'string' &&
          Array.isArray(m.species) &&
          m.species.length > 0 &&
          m.species.every((s: unknown) => typeof s === 'string')
      )
      .map((m) => ({ id: m.id, name: m.name || m.id, species: m.species }));
    if (!models.length)
      throw new Error(
        'No usable models were found. Eco-evo needs compatible policy checkpoints in its results directory.'
      );
    return models;
  }

  async run(
    input: PreparedInput,
    model: EcoTwinModel,
    maxSteps: number,
    signal: AbortSignal,
    seed = 42
  ): Promise<EcoTwinResult> {
    checkBudget(input, model.species.length, maxSteps);
    if (input.impacts && input.impacts.inputId !== input.id)
      throw new Error('Impact inputs belong to a different area. Prepare the impacts again.');
    if (!input.source) throw new Error('Choose a saved calculation for the preview.');
    if (signal.aborted) throw new Error('Request discarded.');
    const request = fullRunRequest(input, model, maxSteps, seed);
    request.version = 'ecotwin-preview-v1';
    request.config.replicates = 1;
    const runId = request.runId;
    const text = await firstValueFrom(
      this.http
        .post(
          `${this.config.apiBaseUrl}/calculation/${input.source.calculationId}/simulation-jobs/preview`,
          request,
          { responseType: 'text' }
        )
        .pipe(timeout(ECOTWIN_RUN.runTimeoutMs), takeUntil(fromEvent(signal, 'abort')))
    );
    if (text.length > MAX_TENSOR_BYTES * 1.4 + 65536)
      throw new Error('The API response exceeds the POC size limit.');
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error('The API returned invalid JSON.');
    }
    return {
      ...decodeResult(payload, input, model.species, maxSteps, model.name),
      kind: 'preview',
      seed,
      id: runId,
      modelId: model.id,
      completedAt: Date.now()
    };
  }
}
