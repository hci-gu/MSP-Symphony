import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideMockStore } from '@ngrx/store/testing';
import { selectSelectedAreaData } from '@data/area/area.selectors';
import Map from 'ol/Map';
import View from 'ol/View';
import LayerGroup from 'ol/layer/Group';
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import { LayerRaster, MARELD_CATALOG } from './mareld-layer-data';
import { MareldLayers } from './mareld-layers.service';
import { MareldLayersMap } from './mareld-layers-map.service';

describe('MARELD source-layer map lifecycle', () => {
  let state: MareldLayers, bridge: MareldLayersMap, map: Map, native: LayerGroup;
  function fixture(value = 30): { raster: LayerRaster, park: Uint8Array } {
    const n = MARELD_CATALOG.grid.width * MARELD_CATALOG.grid.height;
    return {
      raster: { values: new Float32Array(n).fill(value), provenance: new Uint8Array(n).fill(1) },
      park: new Uint8Array(n).fill(1)
    };
  }
  function image(): ImageLayer<ImageStatic> {
    return (
      map
        .getLayers()
        .getArray()
        .find((layer) => layer.get('id') === 'mareld-area-data') as LayerGroup
    )
      .getLayers()
      .item(0) as ImageLayer<ImageStatic>;
  }
  async function settle() {
    TestBed.tick();
    await Promise.resolve();
    await Promise.resolve();
  }
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideMockStore({ selectors: [{ selector: selectSelectedAreaData, value: [] }] })
      ]
    });
    state = TestBed.inject(MareldLayers);
    bridge = TestBed.inject(MareldLayersMap);
    native = new LayerGroup();
    map = new Map({ layers: [native], view: new View({ center: [0, 0], zoom: 5 }) });
    map.setSize([1200, 800]);
    bridge.attach(map);
  });
  afterEach(() => {
    bridge.detach();
    map.dispose();
  });

  it('georeferences the selected raster and clears it without changing other map layers', async () => {
    const load = spyOn(state, 'load').and.resolveTo(fixture());
    state.toggle('porpoise-north-sea');
    await settle();
    expect(image().getSource()!.getProjection()!.getCode()).toBe('EPSG:3035');
    expect(image().getSource()!.getImageExtent()).toEqual(MARELD_CATALOG.grid.extent);
    const source = image().getSource();
    load.calls.reset();
    state.updateDisplay({ opacity: 0.4 });
    await settle();
    expect(image().getOpacity()).toBe(0.4);
    expect(image().getSource()).toBe(source);
    expect(load).not.toHaveBeenCalled();
    expect(state.loading()).toBeFalse();
    bridge.reset();
    await settle();
    expect(image().getSource()).toBeNull();
    expect(state.selected()).toBeNull();
    bridge.detach();
    expect(map.getLayers().getArray()).toEqual([native]);
    bridge.attach(map);
    bridge.detach();
    expect(map.getLayers().getArray()).toEqual([native]);
  });

  it('discards an older response when another layer has been selected', async () => {
    let resolveOld!: (value: ReturnType<typeof fixture>) => void;
    const old = new Promise<ReturnType<typeof fixture>>((resolve) => {
      resolveOld = resolve;
    });
    spyOn(state, 'load').and.callFake((file) =>
      file.startsWith('porpoise') ? old : Promise.resolve(fixture(80))
    );
    state.toggle('porpoise-north-sea');
    await settle();
    state.toggle('catch-bottom-trawl');
    await settle();
    const current = image().getSource();
    expect(current).not.toBeNull();
    resolveOld(fixture());
    await settle();
    expect(image().getSource()).toBe(current);
    expect(state.selectedId()).toBe('catch-bottom-trawl');
  });

  it('does not restore a pending raster after baseline reset or navigation', async () => {
    let resolve!: (value: ReturnType<typeof fixture>) => void;
    spyOn(state, 'load').and.returnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    state.toggle('cod');
    await settle();
    bridge.detach();
    resolve(fixture());
    await settle();
    expect(map.getLayers().getArray()).toEqual([native]);
    expect(state.loading()).toBeFalse();
    expect(state.selected()).toBeNull();
  });

  it('shows a load error instead of retaining the previous data image', async () => {
    const load = spyOn(state, 'load').and.resolveTo(fixture());
    state.toggle('cod');
    await settle();
    expect(image().getSource()).not.toBeNull();
    load.and.rejectWith(new Error('Unavailable'));
    state.toggle('herring');
    await settle();
    expect(image().getSource()).toBeNull();
    expect(state.error()).toContain('could not be loaded');
    expect(state.loading()).toBeFalse();
  });

  it('keeps an in-flight raster request when opacity changes', async () => {
    let resolve!: (value: ReturnType<typeof fixture>) => void;
    const load = spyOn(state, 'load').and.returnValue(new Promise((done) => (resolve = done)));
    state.toggle('cod');
    await settle();
    const calls = load.calls.count();
    state.updateDisplay({ opacity: 0.25 });
    await settle();
    expect(load.calls.count()).toBe(calls);
    expect(state.loading()).toBeTrue();
    resolve(fixture());
    await settle();
    expect(image().getSource()).not.toBeNull();
    expect(image().getOpacity()).toBe(0.25);
    expect(state.loading()).toBeFalse();
  });
});
