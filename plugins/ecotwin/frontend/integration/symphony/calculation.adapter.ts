import { Calculations, CalculationChoice } from '../../ports';
import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngrx/store';
import { firstValueFrom, timeout } from 'rxjs';
import { CalculationActions, CalculationSelectors } from '@data/calculation';
import { ECOTWIN_CONFIG } from '../../config';
import {
  CalculationInput,
  CalculationGrid,
  validateManifest
} from '../../workspace/calculation-input';
import { PreparedInput } from '../../workspace/ecotwin-input';
import { CalculationSlice } from '@data/calculation/calculation.interfaces';

@Injectable({ providedIn: 'root' })
export class SymphonyCalculationAdapter implements Calculations {
  private readonly config = inject(ECOTWIN_CONFIG);
  private readonly http = inject(HttpClient);
  private readonly store = inject(Store);
  private readonly nativeCalculations = this.store.selectSignal(
    CalculationSelectors.selectCalculations
  );
  // The native history is scoped to the user's active baseline. This read-only
  // dropdown lookup spans baselines; native store actions retain their original scope.
  private readonly available = signal<CalculationChoice[]>([]);
  readonly calculations = computed(() => {
    const current = new Map(this.nativeCalculations().map((item) => [item.id, item]));
    return this.available()
      .map((item) => {
        const value = current.get(item.id) ?? item;
        return { id: value.id, name: value.name, timestamp: value.timestamp };
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  });
  readonly loading = signal(false);
  readonly error = signal('');
  private revision = 0;

  async refresh(): Promise<void> {
    this.store.dispatch(CalculationActions.fetchCalculations());
    const revision = ++this.revision;
    this.loading.set(true);
    this.error.set('');
    try {
      const items = await firstValueFrom(
        this.http
          .get<CalculationSlice[]>(`${this.config.apiBaseUrl}/extensions/ecotwin/calculations`)
          .pipe(timeout(30000))
      );
      if (revision === this.revision) this.available.set(items);
    } catch {
      if (revision === this.revision)
        this.error.set('Saved calculations could not be loaded. Retry refreshing the list.');
    } finally {
      if (revision === this.revision) this.loading.set(false);
    }
  }
  clear(): void {
    this.revision++;
    this.available.set([]);
    this.loading.set(false);
    this.error.set('');
  }

  async context(id: number): Promise<CalculationInput> {
    const source = await firstValueFrom(
      this.http
        .get<CalculationInput>(`${this.config.apiBaseUrl}/calculation/${id}/inputs`)
        .pipe(timeout(60000))
    );
    validateManifest(source);
    if (source.calculationId !== id)
      throw new Error('The input manifest belongs to another calculation.');
    return source;
  }

  grid(source: CalculationInput, input: PreparedInput): Promise<CalculationGrid> {
    return firstValueFrom(
      this.http
        .post<CalculationGrid>(
          `${this.config.apiBaseUrl}/calculation/${source.calculationId}/input-grid`,
          {
            fingerprint: source.fingerprint,
            grid: input.grid,
            // Ecosystem data is retained as context, never sent as model initialization.
            bands: source.bands.map(({ category, bandNumber }) => ({ category, bandNumber }))
          }
        )
        .pipe(timeout(120000))
    );
  }
}
