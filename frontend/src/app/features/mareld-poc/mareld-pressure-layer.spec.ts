import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { MareldLayers } from '../mareld-layers/mareld-layers.service';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import GeoJSON from 'ol/format/GeoJSON';
import type Polygon from 'ol/geom/Polygon';
import { transform } from 'ol/proj';
import { selectSelectedAreaData } from '@data/area/area.selectors';
import { MareldApiClient } from './mareld-api.client';
import { GRID_CRS, prepareInput, registerGridProjection, StudyArea } from './mareld-input';
import { MareldPressureLayer, MARELD_WINDPARK } from './mareld-pressure-layer.service';
import { MareldSession } from './mareld-session.service';
import { SymphonySelectionAdapter } from './symphony-selection.adapter';

describe('MARELD wind-park pressure footprint', () => {
  let store: MockStore;
  let pressure: MareldPressureLayer;
  let session: MareldSession;
  const name = MARELD_WINDPARK.properties.reviewAreaName;

  function selectArea(areaName: string | null, type = 'userArea'): void {
    store.overrideSelector(
      selectSelectedAreaData,
      areaName ? [{ name: areaName, statePath: [type, 1] }] : []
    );
    store.refreshState();
    TestBed.tick();
  }

  function reviewArea(): StudyArea {
    registerGridProjection();
    return {
      type: 'Feature',
      properties: { name },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [4326000, 3873000],
            [4365000, 3873000],
            [4365000, 3912000],
            [4326000, 3912000],
            [4326000, 3873000]
          ].map((point) => transform(point, GRID_CRS, 'EPSG:4326'))
        ]
      }
    };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideMockStore({ selectors: [{ selector: selectSelectedAreaData, value: [] }] }),
        { provide: MareldApiClient, useValue: {} },
        {
          provide: SymphonySelectionAdapter,
          useValue: { capture: async () => prepareInput(reviewArea(), name) }
        }
      ]
    });
    store = TestBed.inject(MockStore);
    pressure = TestBed.inject(MareldPressureLayer);
    session = TestBed.inject(MareldSession);
  });

  it('uses the supplied five-corner footprint inside the larger square review area', () => {
    const ring = pressure.feature.geometry.coordinates[0];
    expect(ring).toEqual([
      [10.73807, 58.01671],
      [10.54526, 58.13823],
      [10.09537, 58.25139],
      [10.67884, 58.25276],
      [10.72402, 58.20089],
      [10.73807, 58.01671]
    ]);
    const square = new GeoJSON().readGeometry(reviewArea().geometry) as Polygon;
    expect(ring.every((point) => square.intersectsCoordinate(point))).toBeTrue();
    expect(pressure.areaKm2).toBeCloseTo(368.906, 2);
    expect(square.intersectsCoordinate([10.1, 58.0])).toBeTrue();
    const footprint = new GeoJSON().readGeometry(pressure.feature.geometry) as Polygon;
    expect(footprint.intersectsCoordinate([10.1, 58.0])).toBeFalse();
  });

  it('shows automatically for the saved review area and respects manual visibility until context changes', () => {
    expect(pressure.visible()).toBeFalse();
    selectArea(name, 'area');
    expect(pressure.visible()).toBeFalse();
    selectArea(name);
    expect(pressure.visible()).toBeTrue();
    expect(session.input()).toBeNull();

    pressure.setVisible(false);
    selectArea(name);
    session.seekFrame(2);
    TestBed.tick();
    expect(pressure.visible()).toBeFalse();

    selectArea('Another area');
    expect(pressure.visible()).toBeFalse();
    selectArea(name);
    expect(pressure.visible()).toBeTrue();
    selectArea(null);
    expect(pressure.visible()).toBeFalse();
  });

  it('keeps the footprint available for a captured review area and releases it for another input', async () => {
    await session.capture();
    TestBed.tick();
    expect(pressure.visible()).toBeTrue();
    selectArea('Another area');
    expect(pressure.visible()).toBeTrue();
    session.clearResult();
    TestBed.tick();
    expect(pressure.visible()).toBeTrue();
    session.useExample();
    TestBed.tick();
    expect(pressure.visible()).toBeFalse();
  });

  it('shares area recognition while retaining different captured-input visibility rules', async () => {
    const layers = TestBed.inject(MareldLayers);
    selectArea(`  ${name.toUpperCase()}  `);
    expect(pressure.visible()).toBeTrue();
    expect(layers.selectedId()).toBe('porpoise-north-sea');
    pressure.setVisible(false);
    layers.toggle('cod');
    selectArea(name);
    expect(pressure.visible()).toBeFalse();
    expect(layers.selectedId()).toBe('cod');

    await session.capture();
    selectArea(null);
    // The selected-area raster clears; the captured review input still owns its footprint.
    expect(layers.selected()).toBeNull();
    expect(pressure.reviewAreaActive()).toBeTrue();
    expect(pressure.visible()).toBeFalse();
    pressure.setVisible(true);
    session.reset();
    TestBed.tick();
    expect(pressure.visible()).toBeFalse();
  });
});
