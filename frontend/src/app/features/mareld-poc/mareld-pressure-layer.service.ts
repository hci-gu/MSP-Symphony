import { computed, inject, Injectable, linkedSignal } from '@angular/core';
import GeoJSON from 'ol/format/GeoJSON';
import type OlPolygon from 'ol/geom/Polygon';
import { GRID_CRS, registerGridProjection } from '../mareld-shared/map-raster';
import { MareldSession } from './mareld-session.service';

import { isReviewAreaName, MareldReviewArea, MARELD_WINDPARK } from '../mareld-shared/review-area';
export { MARELD_WINDPARK } from '../mareld-shared/review-area';

export function windparkMatchesSearch(search: string): boolean {
  return `${MARELD_WINDPARK.properties.name} ${MARELD_WINDPARK.properties.kind} Energy`
    .toLowerCase()
    .includes(search.trim().toLowerCase());
}

@Injectable({ providedIn: 'root' })
export class MareldPressureLayer {
  private readonly reviewArea = inject(MareldReviewArea);
  private readonly session = inject(MareldSession);
  readonly feature = MARELD_WINDPARK;
  readonly areaKm2 = this.footprintArea();
  readonly reviewAreaActive = computed(
    () => this.reviewArea.selected() || isReviewAreaName(this.session.input()?.name)
  );
  // A manual toggle lasts until the review-area context changes. Tab switches,
  // frame changes and other metadata updates must not force the layer back on.
  private readonly visibility = linkedSignal(() => this.reviewAreaActive());
  readonly visible = this.visibility.asReadonly();

  setVisible(visible: boolean): void {
    this.visibility.set(visible);
  }

  activateContext(): void {
    this.visibility.set(this.reviewAreaActive());
  }

  reset(): void {
    this.visibility.set(false);
  }

  private footprintArea(): number {
    registerGridProjection();
    const polygon = new GeoJSON().readGeometry(this.feature.geometry, {
      dataProjection: 'EPSG:4326',
      featureProjection: GRID_CRS
    }) as OlPolygon;
    return polygon.getArea() / 1e6;
  }
}
