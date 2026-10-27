import { SimulationNotifications } from '../notifications';
import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { ECOTWIN_CONFIG } from '../config';
import {
  decodeResult,
  EnsembleResult,
  EcoTwinModel,
  EcoTwinResult,
  sampleEvery
} from './ecotwin-result';
import { PreparedInput } from './ecotwin-input';
import { ECOTWIN_RUN } from '../shared/run-config';
import type { SimulationConfig, SimulationSummary } from '../contracts';

export interface SavedSimulation {
  version: 'ecotwin-run-v1' | 'ecotwin-run-v2';
  ensemble?: EnsembleResult;
  runId: string;
  completedAt: number;
  model: EcoTwinModel;
  config: SimulationConfig;
  input: PreparedInput;
  result: {
    steps: number[];
    species: string[];
    units: 'tonnes/cell';
    order: 'frame,row,column,species';
    biomassB64: string;
  };
}

export function encodeFloats(values: Float32Array): string {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((v, i) => view.setFloat32(i * 4, v, true));
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(chunks.join(''));
}

export function savedSimulation(result: EcoTwinResult): SavedSimulation {
  if (result.kind === 'preview') throw new Error('Previews are not saved to calculation reports.');
  if (!result.input.source || !result.modelId || !result.completedAt || !result.input.impacts)
    throw new Error('This result has no saved calculation provenance.');
  const maxSteps = result.steps[result.steps.length - 1];
  return {
    version: 'ecotwin-run-v1',
    runId: result.id,
    completedAt: result.completedAt,
    model: { id: result.modelId, name: result.model, species: result.species },
    config: {
      maxSteps,
      sampleEvery: sampleEvery(maxSteps),
      seed: 42,
      tickDurationDays: ECOTWIN_RUN.tickDurationDays,
      mappingVersion: result.input.impacts.version
    },
    input: JSON.parse(
      JSON.stringify(result.input, (_, value) =>
        ArrayBuffer.isView(value) ? Array.from(value as Uint8Array) : value
      )
    ),
    result: {
      steps: result.steps,
      species: result.species,
      units: 'tonnes/cell',
      order: 'frame,row,column,species',
      biomassB64: encodeFloats(result.values)
    }
  };
}

export function restoreSimulation(saved: SavedSimulation): EcoTwinResult {
  const input = saved.input;
  input.water = Uint8Array.from(input.water);
  for (const layer of input.impacts?.layers ?? []) {
    layer.values = Float32Array.from(layer.values);
    for (const band of layer.bands) band.mask = Uint8Array.from(band.mask);
  }
  const result = decodeResult(
    {
      status: 'completed',
      run_id: saved.runId,
      result: {
        dtype: 'float32',
        shape: [
          saved.result.steps.length,
          input.grid.height,
          input.grid.width,
          saved.result.species.length
        ],
        steps: saved.result.steps,
        species: saved.result.species,
        biomass_b64: saved.result.biomassB64
      }
    },
    input,
    saved.result.species,
    saved.config.maxSteps,
    saved.model.name
  );
  return {
    ...result,
    source: 'saved',
    modelId: saved.model.id,
    completedAt: saved.completedAt,
    kind: saved.version === 'ecotwin-run-v2' ? 'ensemble' : 'legacy',
    seed: saved.config.seed,
    ensemble: saved.ensemble
  };
}

@Injectable({ providedIn: 'root' })
export class SimulationPersistenceClient {
  private readonly config = inject(ECOTWIN_CONFIG);
  private readonly notifications = inject(SimulationNotifications);
  private readonly http = inject(HttpClient);
  private url(id: number, runId: string): string {
    return `${this.config.apiBaseUrl}/calculation/${id}/simulations/${encodeURIComponent(runId)}`;
  }
  async save(result: EcoTwinResult): Promise<SimulationSummary> {
    const payload = savedSimulation(result);
    const summary = await firstValueFrom(
      this.http
        .put<SimulationSummary>(this.url(result.input.source!.calculationId, result.id), payload)
        .pipe(timeout(120000))
    );
    // Reports in other tabs/iframes re-read persisted data on this notification or focus.
    this.notifications.publish(summary.calculationId);
    return summary;
  }
  async load(id: number, runId: string): Promise<EcoTwinResult> {
    const payload = await firstValueFrom(
      this.http.get<SavedSimulation>(this.url(id, runId)).pipe(timeout(60000))
    );
    if (payload.runId !== runId || payload.input.source?.calculationId !== id)
      throw new Error('Saved simulation belongs to another calculation.');
    return restoreSimulation(payload);
  }
  async delete(id: number, runId: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(this.url(id, runId)).pipe(timeout(60000)));
    this.notifications.publish(id);
  }
}
