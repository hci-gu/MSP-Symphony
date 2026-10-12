import { TestBed } from '@angular/core/testing';
import Map from 'ol/Map';
import View from 'ol/View';
import LayerGroup from 'ol/layer/Group';
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import type Polygon from 'ol/geom/Polygon';
import { transform } from 'ol/proj';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { selectSelectedAreaData } from '@data/area/area.selectors';
import { MareldMapBridge } from './mareld-map.bridge';
import { MareldSession } from './mareld-session.service';
import { MareldApiClient } from './mareld-api.client';
import { SymphonySelectionAdapter } from './symphony-selection.adapter';
import { MareldPressureLayer } from './mareld-pressure-layer.service';
import { biomassFixture } from './testing/biomass.fixture';

describe('MARELD map layer lifecycle', () => {
  it('adds a separate projected layer and removes it without disturbing Symphony layers', async () => {
    const result = biomassFixture();
    TestBed.configureTestingModule({
      providers: [
        provideMockStore({ selectors: [{ selector: selectSelectedAreaData, value: [] }] }),
        {
          provide: MareldApiClient,
          useValue: {
            models: async () => [{ id: 'test', name: 'Test', species: result.species }],
            run: async () => result
          }
        },
        { provide: SymphonySelectionAdapter, useValue: { capture: async () => result.input } }
      ]
    });
    const session = TestBed.inject(MareldSession),
      bridge = TestBed.inject(MareldMapBridge);
    const native = new LayerGroup();
    const map = new Map({ layers: [native], view: new View({ center: [0, 0], zoom: 5 }) });
    map.setSize([1200, 800]);
    bridge.attach(map);
    await session.capture();
    await session.discover();
    await session.run();
    TestBed.tick();
    const group = map
      .getLayers()
      .getArray()
      .find((layer) => layer.get('id') === 'mareld-poc') as LayerGroup;
    const image = group.getLayers().item(0) as ImageLayer<ImageStatic>;
    expect(image.getSource()!.getProjection()!.getCode()).toBe('EPSG:3035');
    expect(image.getSource()!.getImageExtent()).toEqual(session.input()!.grid.extent);
    session.setOpacity(0.35);
    TestBed.tick();
    expect(image.getOpacity()).toBe(0.35);
    session.clearResult();
    TestBed.tick();
    expect(image.getSource()).toBeNull();
    bridge.detach();
    expect(map.getLayers().getArray()).toEqual([native]);
    expect(session.input()).toBeNull();
    bridge.attach(map);
    bridge.detach();
    expect(map.getLayers().getArray()).toEqual([native]);
    map.dispose();
  });

  it('shows the pressure before input capture, above results, and cleans up on reset and detach', () => {
    TestBed.configureTestingModule({
      providers: [
        provideMockStore({ selectors: [{ selector: selectSelectedAreaData, value: [] }] }),
        { provide: MareldApiClient, useValue: {} },
        { provide: SymphonySelectionAdapter, useValue: {} }
      ]
    });
    const store = TestBed.inject(MockStore);
    const pressure = TestBed.inject(MareldPressureLayer);
    const bridge = TestBed.inject(MareldMapBridge);
    const native = new LayerGroup();
    const map = new Map({ layers: [native], view: new View({ center: [0, 0], zoom: 5 }) });
    map.setSize([1200, 800]);
    bridge.attach(map);
    const windpark = map
      .getLayers()
      .getArray()
      .find((layer) => layer.get('id') === 'mareld-windpark-pressure') as VectorLayer<VectorSource>;
    expect(windpark.getVisible()).toBeFalse();
    store.overrideSelector(selectSelectedAreaData, [
      {
        name: pressure.feature.properties.reviewAreaName,
        statePath: ['userArea', 1]
      }
    ]);
    store.refreshState();
    TestBed.tick();
    expect(windpark.getVisible()).toBeTrue();
    expect(windpark.getZIndex()).toBeGreaterThan(native.getZIndex() ?? 0);
    const polygon = windpark.getSource()!.getFeatures()[0].getGeometry() as Polygon;
    expect(polygon.getCoordinates()[0].length).toBe(6);
    const corner = transform(polygon.getCoordinates()[0][0], 'EPSG:3857', 'EPSG:4326');
    expect(corner[0]).toBeCloseTo(10.73807, 5);
    expect(corner[1]).toBeCloseTo(58.01671, 5);

    pressure.setVisible(false);
    TestBed.tick();
    expect(windpark.getVisible()).toBeFalse();
    pressure.setVisible(true);
    bridge.reset();
    TestBed.tick();
    expect(windpark.getVisible()).toBeFalse();
    bridge.detach();
    expect(map.getLayers().getArray()).toEqual([native]);
    bridge.attach(map);
    TestBed.tick();
    const reattached = map
      .getLayers()
      .getArray()
      .find((layer) => layer.get('id') === 'mareld-windpark-pressure');
    expect(reattached!.getVisible()).toBeTrue();
    bridge.detach();
    expect(map.getLayers().getArray()).toEqual([native]);
    map.dispose();
  });
});
