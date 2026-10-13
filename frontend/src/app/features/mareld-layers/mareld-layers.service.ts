import { MareldReviewArea } from '../mareld-shared/review-area';
import { computed, inject, Injectable, linkedSignal, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
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
  private readonly reviewArea = inject(MareldReviewArea);
  private readonly files = new Map<string, Promise<ArrayBuffer>>();
  readonly catalog = MARELD_CATALOG;
  readonly reviewActive = this.reviewArea.selected;
  private readonly selection = linkedSignal<string | null>(() =>
    this.reviewActive() ? this.catalog.defaultLayer : null
  );
  readonly selectedId = this.selection.asReadonly();
  readonly selected = computed(
    () => this.catalog.layers.find((layer) => layer.id === this.selectedId()) ?? null
  );
  private readonly display = signal({
    variant: 'extended' as LayerVariant,
    scope: 'square' as LayerScope,
    opacity: 0.85,
    showProvenance: false,
    hatch: false
  });
  readonly variant = computed(() => this.display().variant);
  readonly effectiveVariant = computed<LayerVariant>(() =>
    this.selected()?.variants[this.variant()] ? this.variant() : 'source'
  );
  readonly asset = computed(() => this.selected()?.variants[this.effectiveVariant()] ?? null);
  readonly scope = computed(() => this.display().scope);
  readonly opacity = computed(() => this.display().opacity);
  readonly showProvenance = computed(() => this.display().showProvenance);
  readonly hatch = computed(() => this.display().hatch);
  private readonly loadState = signal({ loading: false, error: '' });
  readonly loading = computed(() => this.loadState().loading);
  readonly error = computed(() => this.loadState().error);

  readonly coverage = computed(() => this.asset()?.coverage[this.scope()] ?? null);

  updateDisplay(options: Partial<ReturnType<typeof this.display>>): void {
    this.display.update((current) => ({ ...current, ...options }));
  }

  activateContext(): void {
    this.selection.set(this.reviewActive() ? this.catalog.defaultLayer : null);
  }

  clearSelection(): void {
    this.selection.set(null);
  }

  beginLoading(): void {
    this.loadState.set({ loading: true, error: '' });
  }

  finishLoading(error = ''): void {
    this.loadState.set({ loading: false, error });
  }

  toggle(id: string): void {
    this.selection.set(this.selectedId() === id ? null : id);
  }

  reset(): void {
    this.selection.set(null);
    this.finishLoading();
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
