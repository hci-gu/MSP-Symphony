import { computed, inject, Injectable, linkedSignal } from '@angular/core';
import { Store } from '@ngrx/store';
import type { Feature, Polygon } from 'geojson';
import GeoJSON from 'ol/format/GeoJSON';
import type OlPolygon from 'ol/geom/Polygon';
import { selectSelectedAreaData } from '@data/area/area.selectors';
import { SelectableArea } from '@data/area/area.interfaces';
import { State } from '@src/app/app-reducer';
import windpark from '@assets/pressures/mareld-windpark.json';
import { GRID_CRS, registerGridProjection } from './mareld-input';
import { MareldSession } from './mareld-session.service';

/** Supplemental pressure geometry, without an assumed ecological intensity. */
export const MARELD_WINDPARK = windpark as Feature<Polygon, typeof windpark.properties>;

export function windparkMatchesSearch(search: string): boolean {
  return `${windpark.properties.name} ${windpark.properties.kind} Energy`
    .toLowerCase()
    .includes(search.trim().toLowerCase());
}

function isReviewAreaName(name?: string): boolean {
  return name?.trim().toLowerCase() === windpark.properties.reviewAreaName.toLowerCase();
}

@Injectable({ providedIn: 'root' })
export class MareldPressureLayer {
  private readonly store = inject<Store<State>>(Store);
  private readonly session = inject(MareldSession);
  private readonly selectedAreas = this.store.selectSignal(selectSelectedAreaData);
  readonly feature = MARELD_WINDPARK;
  readonly areaKm2 = this.footprintArea();
  readonly reviewAreaActive = computed(
    () =>
      (this.selectedAreas() as SelectableArea[]).some(
        (area) => area?.statePath?.[0] === 'userArea' && isReviewAreaName(area.name)
      ) || isReviewAreaName(this.session.input()?.name)
  );
  // A manual toggle lasts until the review-area context changes. Tab switches,
  // frame changes and other metadata updates must not force the layer back on.
  readonly visible = linkedSignal(() => this.reviewAreaActive());

  private footprintArea(): number {
    registerGridProjection();
    const polygon = new GeoJSON().readGeometry(this.feature.geometry, {
      dataProjection: 'EPSG:4326',
      featureProjection: GRID_CRS
    }) as OlPolygon;
    return polygon.getArea() / 1e6;
  }
}
