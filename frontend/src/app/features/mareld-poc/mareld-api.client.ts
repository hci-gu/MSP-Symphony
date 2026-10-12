import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, fromEvent, takeUntil, timeout } from 'rxjs';
import { environment } from '@src/environments/environment';
import { pngBlob, PreparedInput, rasterCanvas } from './mareld-input';
import {
  checkBudget,
  decodeResult,
  MareldModel,
  MareldResult,
  MAX_TENSOR_BYTES,
  sampleEvery
} from './mareld-result';

export function apiError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0 || error.status === 502 || error.status === 504)
      return 'The MARELD API is unavailable. Check the Eco-evo server and network connection.';
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
      this.http.get<unknown>(`${this.base}/v1/models`).pipe(timeout(15000))
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
    signal: AbortSignal
  ): Promise<MareldResult> {
    checkBudget(input, model.species.length, maxSteps);
    const [texture, depth] = await Promise.all([
      pngBlob(rasterCanvas(input, 'texture')),
      pngBlob(rasterCanvas(input, 'depth'))
    ]);
    if (signal.aborted) throw new Error('Request discarded.');
    const form = new FormData();
    form.append(
      'request',
      JSON.stringify({
        run_id: `symphony-${crypto.randomUUID()}`,
        seed: 42,
        model: { id: model.id },
        grid: { width: input.grid.width, height: input.grid.height },
        time: {
          max_steps: maxSteps,
          sample_every: sampleEvery(maxSteps),
          include_final: true,
          tick_duration_days: 0.25
        },
        species: model.species,
        pressures: [],
        output: {
          dtype: 'float32',
          tensor_order: 'frame,row,column,species',
          replicates: 1,
          include_summary: false
        }
      })
    );
    form.append('texture', texture, 'texture.png');
    form.append('depth', depth, 'depth.png');
    const text = await firstValueFrom(
      this.http
        .post(`${this.base}/v1/runs`, form, { responseType: 'text' })
        .pipe(timeout(30 * 60 * 1000), takeUntil(fromEvent(signal, 'abort')))
    );
    if (text.length > MAX_TENSOR_BYTES * 1.4 + 65536)
      throw new Error('The API response exceeds the POC size limit.');
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error('The API returned invalid JSON.');
    }
    return decodeResult(payload, input, model.species, maxSteps, model.name);
  }
}
