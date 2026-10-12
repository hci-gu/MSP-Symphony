import { computed, inject, Injectable, linkedSignal, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { State } from '@src/app/app-reducer';
import { selectSelectedAreaData } from '@data/area/area.selectors';
import { SelectableArea } from '@data/area/area.interfaces';
import {
  decodeLayer,
  LayerRaster,
  LayerScope,
  LayerVariant,
  MARELD_ASSETS,
  MARELD_CATALOG
} from './mareld-layer-data';

/** Map-only state; deliberately independent of the simulation session and API. */
@Injectable({ providedIn: 'root' })
export class MareldLayers {
  private readonly http = inject(HttpClient);
  private readonly areas = inject<Store<State>>(Store).selectSignal(selectSelectedAreaData);
  private readonly files = new Map<string, Promise<ArrayBuffer>>();
  readonly catalog = MARELD_CATALOG;
  readonly reviewActive = computed(() =>
    ((this.areas() || []) as SelectableArea[]).some(
      (area) =>
        area?.statePath?.[0] === 'userArea' &&
        area.name?.trim().toLowerCase() === this.catalog.reviewAreaName.toLowerCase()
    )
  );
  readonly selectedId = linkedSignal<string | null>(() =>
    this.reviewActive() ? this.catalog.defaultLayer : null
  );
  readonly selected = computed(
    () => this.catalog.layers.find((layer) => layer.id === this.selectedId()) ?? null
  );
  readonly variant = signal<LayerVariant>('extended');
  readonly effectiveVariant = computed<LayerVariant>(() =>
    this.selected()?.variants[this.variant()] ? this.variant() : 'source'
  );
  readonly asset = computed(() => this.selected()?.variants[this.effectiveVariant()] ?? null);
  readonly scope = signal<LayerScope>('square');
  readonly opacity = signal(0.85);
  readonly showProvenance = signal(false);
  readonly hatch = signal(true);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly coverage = computed(() => this.asset()?.coverage[this.scope()] ?? null);

  toggle(id: string): void {
    this.selectedId.set(this.selectedId() === id ? null : id);
  }

  reset(): void {
    this.selectedId.set(null);
    this.loading.set(false);
    this.error.set('');
  }

  private file(name: string): Promise<ArrayBuffer> {
    let pending = this.files.get(name);
    if (!pending) {
      pending = firstValueFrom(
        this.http.get(`${MARELD_ASSETS}${name}`, { responseType: 'arraybuffer' })
      ).catch((error) => {
        this.files.delete(name);
        throw error;
      });
      this.files.set(name, pending);
    }
    return pending;
  }

  async load(file: string): Promise<{ raster: LayerRaster, park: Uint8Array }> {
    const [data, mask] = await Promise.all([this.file(file), this.file(this.catalog.windparkMask)]);
    const cells = this.catalog.grid.width * this.catalog.grid.height;
    if (mask.byteLength !== cells) throw new Error('The wind-park mask has an unexpected size.');
    const park = new Uint8Array(mask);
    if (park.some((value) => value > 1))
      throw new Error('The wind-park mask contains invalid values.');
    return { raster: decodeLayer(data, cells), park };
  }
}
