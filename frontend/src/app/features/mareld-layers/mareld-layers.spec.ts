import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { selectSelectedAreaData } from '@data/area/area.selectors';
import {
  decodeLayer,
  layerPixels,
  MARELD_ASSETS,
  MARELD_CATALOG,
  matchingLayers
} from './mareld-layer-data';
import { MareldLayers } from './mareld-layers.service';

function binary(values: number[], codes: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(values.length * 5),
    view = new DataView(buffer);
  values.forEach((value, i) => view.setFloat32(i * 4, value, true));
  new Uint8Array(buffer, values.length * 4).set(codes);
  return buffer;
}

describe('MARELD prepared map data', () => {
  it('includes recovered local datasets and limits extrapolation to the two approved smooth layers', () => {
    expect(matchingLayers('ECOSYSTEM', '').length).toBe(13);
    expect(matchingLayers('PRESSURE', '').length).toBe(14);
    expect(
      MARELD_CATALOG.layers.filter((layer) => layer.extension).map((layer) => layer.id)
    ).toEqual(['porpoise-north-sea', 'plankton-pelagic']);
    const pelagic = matchingLayers('PRESSURE', 'pelagic')[0];
    expect(pelagic.positivePercent.park).toBe(0);
    expect(pelagic.positivePercent.square).toBeGreaterThan(0);
    expect(matchingLayers('PRESSURE', '2050').every((layer) => layer.future)).toBeTrue();
    expect(matchingLayers('ECOSYSTEM', '  PLANKTON  ')[0].id).toBe('plankton-pelagic');
    expect(matchingLayers('ECOSYSTEM', 'missing layer')).toEqual([]);
  });

  it('retains source coverage throughout the wind park in every extension variant', () => {
    for (const layer of MARELD_CATALOG.layers) {
      expect(layer.variants.source.coverage.park.unknown).toBe(0);
      for (const variant of Object.values(layer.variants)) {
        expect(variant.coverage.park.inferred).toBe(0);
        expect(variant.coverage.park.unknown).toBe(0);
      }
      if (layer.extension) {
        expect(layer.variants.extended!.coverage.square.inferred).toBeGreaterThan(50);
        expect(layer.extension.maxDistanceKm).toBeGreaterThan(
          layer.extension.validation.max_tested_distance_km
        );
      }
    }
    expect(matchingLayers('ECOSYSTEM', 'Cod')[0].variants.source.coverage.square.unknown).toBe(0);
  });

  it('distinguishes a meaningful source zero from unknown support and retains small source values', () => {
    const raster = decodeLayer(binary([0, NaN, 0.0125, 80], [1, 0, 2, 3]), 4);
    expect(raster.values[2]).toBeCloseTo(0.0125, 6);
    const pixels = layerPixels(raster, 2, new Uint8Array([1, 1, 1, 0]), 'square', false, false);
    expect(pixels[3]).toBe(235); // source zero remains visible
    expect(pixels[7]).toBeLessThan(235); // unknown has a distinct style
    const clipped = layerPixels(raster, 2, new Uint8Array([1, 1, 1, 0]), 'park', false, false);
    expect(clipped[15]).toBe(0);
    expect(clipped[11]).toBe(235);
  });

  it('rejects malformed rasters rather than displaying invented values', () => {
    expect(() => decodeLayer(new ArrayBuffer(4), 1)).toThrowError(/size/);
    expect(() => decodeLayer(binary([NaN], [1]), 1)).toThrowError(/invalid/);
    expect(() => decodeLayer(binary([0], [0]), 1)).toThrowError(/invalid/);
    expect(() => decodeLayer(binary([101], [1]), 1)).toThrowError(/invalid/);
    expect(() => decodeLayer(binary([10], [4]), 1)).toThrowError(/invalid/);
  });

  it('marks inferred cells and exposes recovered cells in the provenance view', () => {
    const raster = decodeLayer(binary([50, 50, 50], [3, 1, 2]), 3);
    const mask = new Uint8Array([1, 1, 1]);
    const hatched = layerPixels(raster, 3, mask, 'square', false, true);
    const plain = layerPixels(raster, 3, mask, 'square', false, false);
    expect(hatched.slice(0, 3)).not.toEqual(plain.slice(0, 3));
    expect(hatched.slice(4)).toEqual(plain.slice(4));
    const origin = layerPixels(raster, 3, mask, 'square', true, false);
    expect(origin.slice(0, 3)).not.toEqual(origin.slice(4, 7));
    expect(origin.slice(4, 7)).not.toEqual(origin.slice(8, 11));
  });
});

describe('MARELD map-only layer state', () => {
  let state: MareldLayers, store: MockStore, http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockStore({ selectors: [{ selector: selectSelectedAreaData, value: [] }] })
      ]
    });
    state = TestBed.inject(MareldLayers);
    store = TestBed.inject(MockStore);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  function select(name: string, type = 'userArea') {
    store.overrideSelector(selectSelectedAreaData, [{ name, statePath: [type, 1] }]);
    store.refreshState();
    TestBed.tick();
  }

  it('automatically shows the review-area layer, preserves manual choices, and releases them on area changes', () => {
    expect(state.selected()).toBeNull();
    select(MARELD_CATALOG.reviewAreaName, 'area');
    expect(state.selected()).toBeNull();
    select(MARELD_CATALOG.reviewAreaName);
    expect(state.selectedId()).toBe('porpoise-north-sea');
    state.toggle('catch-bottom-trawl');
    expect(state.effectiveVariant()).toBe('source');
    select(MARELD_CATALOG.reviewAreaName);
    expect(state.selectedId()).toBe('catch-bottom-trawl');
    state.toggle('catch-bottom-trawl');
    select(MARELD_CATALOG.reviewAreaName);
    expect(state.selected()).toBeNull();
    select('Different area');
    expect(state.selected()).toBeNull();
    select(MARELD_CATALOG.reviewAreaName);
    expect(state.selectedId()).toBe('porpoise-north-sea');
    select('Different area');
    expect(state.selected()).toBeNull();
  });

  it('fetches only selected static assets and reuses them across visual changes', async () => {
    const file = 'cod-source.bin',
      count = MARELD_CATALOG.grid.width * MARELD_CATALOG.grid.height;
    const pending = state.load(file);
    http.expectOne(MARELD_ASSETS + file).flush(binary(Array(count).fill(83), Array(count).fill(1)));
    http.expectOne(MARELD_ASSETS + MARELD_CATALOG.windparkMask).flush(new Uint8Array(count).buffer);
    expect((await pending).raster.values[0]).toBe(83);
    state.scope.set('park');
    expect((await state.load(file)).raster.values[0]).toBe(83);
    http.expectNone(MARELD_ASSETS + file);
  });

  it('allows a failed asset to be retried', async () => {
    const count = MARELD_CATALOG.grid.width * MARELD_CATALOG.grid.height;
    const failure = state.load('cod-source.bin').catch(() => null);
    http
      .expectOne(MARELD_ASSETS + 'cod-source.bin')
      .flush(new ArrayBuffer(0), { status: 503, statusText: 'Unavailable' });
    http.expectOne(MARELD_ASSETS + MARELD_CATALOG.windparkMask).flush(new Uint8Array(count).buffer);
    expect(await failure).toBeNull();
    const retry = state.load('cod-source.bin');
    http
      .expectOne(MARELD_ASSETS + 'cod-source.bin')
      .flush(binary(Array(count).fill(83), Array(count).fill(1)));
    expect((await retry).raster.values[0]).toBe(83);
  });
});
