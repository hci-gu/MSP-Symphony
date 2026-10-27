import { MARELD_RUN } from '../mareld-shared/run-config';
import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, fromEvent, takeUntil, timeout } from 'rxjs';
import { environment } from '@src/environments/environment';
import { PreparedInput } from './mareld-input';
import { fullRunRequest } from './simulation-jobs.client';
import {
  checkBudget,
  decodeResult,
  MareldModel,
  MareldResult,
  MAX_TENSOR_BYTES
} from './mareld-result';

export function apiError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0 || error.status === 502 || error.status === 504)
      return 'The Eco-evo API is unavailable. Check the model server and network connection.';
    let body = error.error;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = null;
      }
    }
    const message =
      typeof body?.message === 'string'
        ? body.message.slice(0, 600)
        : `The API request failed (HTTP ${error.status}).`;
    if (body?.error === 'MODEL_CHECKPOINT_MISMATCH')
      return `This model is incompatible with the server's current project. Choose another model in the Model list and run again. ${message}`;
    if (body?.error === 'MISSING_FILE' && /(?:noise|trawling)-\d+\.png/.test(message))
      return 'Eco-evo could not read the impact masks. Start the model server with the Symphony impact configuration, then retry this calculation.';
    return message;
  }
  if (error instanceof Error && error.name === 'TimeoutError')
    return 'The API timed out. It may still be computing; this request was not retried.';
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

@Injectable({ providedIn: 'root' })
export class MareldApiClient {
  private readonly http = inject(HttpClient);
  private readonly base = environment.mareldPoc.apiUrl;

  async models(): Promise<MareldModel[]> {
    const payload = await firstValueFrom(
      this.http.get<unknown>(`${this.base}/v1/models`).pipe(timeout(MARELD_RUN.discoveryTimeoutMs))
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
    model: MareldModel,
    maxSteps: number,
    signal: AbortSignal,
    seed = 42
  ): Promise<MareldResult> {
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
          `${environment.apiBaseUrl}/calculation/${input.source.calculationId}/simulation-jobs/preview`,
          request,
          { responseType: 'text' }
        )
        .pipe(timeout(MARELD_RUN.runTimeoutMs), takeUntil(fromEvent(signal, 'abort')))
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
