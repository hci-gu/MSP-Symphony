import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { decodeLayer, MARELD_ASSETS, MARELD_CATALOG } from '../mareld-layers/mareld-layer-data';
import { IMPACT_DEFINITIONS, ImpactKind, ImpactSource } from './mareld-impacts';

/** Read source data independently of map display selection, opacity and clipping. */
@Injectable({ providedIn: 'root' })
export class MareldImpactData {
  private readonly http = inject(HttpClient);
  private readonly sources = new Map<ImpactKind, Promise<ImpactSource>>();

  load(kind: ImpactKind): Promise<ImpactSource> {
    let pending = this.sources.get(kind);
    if (!pending) {
      const layer = MARELD_CATALOG.layers.find(
        (item) => item.id === IMPACT_DEFINITIONS[kind].sourceId
      )!;
      const asset = layer.variants.source;
      pending = firstValueFrom(
        this.http
          .get(`${MARELD_ASSETS}${asset.file}`, {
            responseType: 'arraybuffer'
          })
          .pipe(timeout(15000))
      )
        .then((buffer) => ({
          grid: {
            ...MARELD_CATALOG.grid,
            extent: [...MARELD_CATALOG.grid.extent] as [number, number, number, number]
          },
          raster: decodeLayer(buffer, MARELD_CATALOG.grid.width * MARELD_CATALOG.grid.height),
          file: asset.file,
          sha256: asset.sha256
        }))
        .catch((error) => {
          this.sources.delete(kind);
          throw error;
        });
      this.sources.set(kind, pending);
    }
    return pending;
  }
}
