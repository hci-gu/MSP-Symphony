import { computed, inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import type { Feature, Polygon } from 'geojson';
import { State } from '@src/app/app-reducer';
import { selectSelectedAreaData } from '@data/area/area.selectors';
import { SelectableArea } from '@data/area/area.interfaces';
import windpark from '@assets/pressures/mareld-windpark.json';

export const MARELD_WINDPARK = windpark as Feature<Polygon, typeof windpark.properties>;

export function isReviewAreaName(name?: string): boolean {
  return name?.trim().toLowerCase() === windpark.properties.reviewAreaName.toLowerCase();
}

/** Selection context only. Captured-input visibility belongs to the simulation. */
@Injectable({ providedIn: 'root' })
export class MareldReviewArea {
  private readonly areas = inject<Store<State>>(Store).selectSignal(selectSelectedAreaData);
  readonly selected = computed(() =>
    ((this.areas() || []) as SelectableArea[]).some(
      (area) => area?.statePath?.[0] === 'userArea' && isReviewAreaName(area.name)
    )
  );
}
