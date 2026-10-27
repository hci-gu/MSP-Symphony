import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import Map from 'ol/Map';
import View from 'ol/View';
import LayerGroup from 'ol/layer/Group';
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { EcoTwinMapBridge } from './ecotwin-map.bridge';
import { SimulationWorkspace } from './simulation-workspace';
import { EcoTwinResult } from './ecotwin-result';
import { PreparedInput } from './ecotwin-input';
import { PreparedImpacts } from './ecotwin-impacts';
import { biomassFixture } from './testing/biomass.fixture';
import { impactFixture } from './testing/impact.fixture';

describe('simulation map isolation', () => {
  function setup() {
    const input = signal<PreparedInput | null>(null);
    const result = signal<EcoTwinResult | null>(null);
    const preparedImpacts = signal<PreparedImpacts | null>(null);
    const session = {
      input,
      result,
      preparedImpacts,
      previewImpact: signal<'noise' | 'trawling' | null>(null),
      frame: signal(0),
      species: signal(0),
      opacity: signal(0.8),
      impactOutlines: signal({ noise: false, trawling: false }),
      mapImpacts: computed(() => ({ input: input(), impacts: preparedImpacts() })),
      pausePlayback: jasmine.createSpy('pausePlayback'),
      detach: jasmine.createSpy('detach'),
      reset: () => {
        input.set(null);
        result.set(null);
        preparedImpacts.set(null);
      }
    };
    TestBed.configureTestingModule({
      providers: [{ provide: SimulationWorkspace, useValue: session }]
    });
    const bridge = TestBed.inject(EcoTwinMapBridge);
    // In the application this root service's effect runs before the map mounts.
    TestBed.tick();
    const native = new LayerGroup();
    const map = new Map({ layers: [native], view: new View({ center: [0, 0], zoom: 5 }) });
    map.setSize([1200, 800]);
    bridge.attach(map);
    return { bridge, session, native, map };
  }

  it('adds nothing until activation, then hides all owned layers without changing native layers', () => {
    const { bridge, session, native, map } = setup();
    expect(map.getLayers().getArray()).toEqual([native]);
    const fixture = biomassFixture();
    session.input.set(fixture.input);
    session.result.set(fixture);
    TestBed.tick();
    expect(map.getLayers().getArray()).toEqual([native]);
    bridge.setActive(true);
    const group = map
      .getLayers()
      .getArray()
      .find((layer) => layer.get('id') === 'ecotwin-overlay') as LayerGroup;
    const image = group.getLayers().item(0) as ImageLayer<ImageStatic>;
    expect(image.getSource()!.getImageExtent()).toEqual(fixture.input.grid.extent);
    expect(image.getSource()!.getProjection()!.getCode()).toBe('EPSG:3035');
    bridge.setActive(false);
    expect(group.getVisible()).toBeFalse();
    expect(native.getVisible()).toBeTrue();
    expect(session.pausePlayback).toHaveBeenCalled();
    expect(session.result()).toBe(fixture);
    const fit = spyOn(map.getView(), 'fit');
    bridge.setActive(true);
    expect(group.getVisible()).toBeTrue();
    expect(fit).not.toHaveBeenCalled();
    expect(session.result()).toBe(fixture);
    bridge.detach();
    expect(map.getLayers().getArray()).toEqual([native]);
    expect(session.input()).toBe(fixture.input);
    map.dispose();
  });

  it('uses the host overlay slot and viewport padding for every owned layer', () => {
    const { bridge, session, native, map } = setup();
    bridge.attach(map, 70, () => [10, 20, 30, 240]);
    session.input.set(biomassFixture().input);
    bridge.setActive(true);
    TestBed.tick();
    const group = map.getLayers().item(1) as LayerGroup;
    expect(group.getLayerStatesArray().every((layer) => layer.zIndex === 70)).toBeTrue();
    const fit = spyOn(map.getView(), 'fit');
    bridge.fit();
    expect(fit.calls.mostRecent().args[1]!.padding).toEqual([10, 20, 30, 240]);
    bridge.detach();
    expect(map.getLayers().getArray()).toEqual([native]);
    map.dispose();
  });

  it('reacts to asynchronous input after the map attaches and the empty tab activates', () => {
    const { bridge, session, map } = setup();
    bridge.setActive(true);
    TestBed.tick();
    const fixture = biomassFixture();
    session.input.set(fixture.input);
    session.result.set(fixture);
    TestBed.tick();
    const group = map
      .getLayers()
      .getArray()
      .find((layer) => layer.get('id') === 'ecotwin-overlay') as LayerGroup;
    expect((group.getLayers().item(0) as ImageLayer<ImageStatic>).getSource()).not.toBeNull();
    bridge.detach();
    map.dispose();
  });

  it('owns impact outlines in the same group and never creates the fixed wind-park layer', () => {
    const { bridge, session, map } = setup();
    const fixture = biomassFixture();
    session.input.set(fixture.input);
    session.preparedImpacts.set(impactFixture(fixture.input));
    session.impactOutlines.set({ noise: true, trawling: true });
    bridge.setActive(true);
    TestBed.tick();
    const group = map
      .getLayers()
      .getArray()
      .find((layer) => layer.get('id') === 'ecotwin-overlay') as LayerGroup;
    for (const kind of ['noise', 'trawling']) {
      const outline = group
        .getLayers()
        .getArray()
        .find((layer) => layer.get('id') === `ecotwin-${kind}-outline`) as VectorLayer<VectorSource>;
      expect(outline.getVisible()).toBeTrue();
      expect(outline.getSource()!.getFeatures().length).toBeGreaterThan(0);
    }
    expect(
      map.getAllLayers().some((layer) => layer.get('id') === 'ecotwin-windpark-pressure')
    ).toBeFalse();
    bridge.setActive(false);
    expect(group.getVisible()).toBeFalse();
    bridge.detach();
    map.dispose();
  });
  it('hides cleared result pixels during map animation and can display the next saved run', () => {
    const { bridge, session, native, map } = setup();
    const fixture = biomassFixture();
    session.input.set(fixture.input);
    session.result.set(fixture);
    bridge.setActive(true);
    TestBed.tick();
    const group = map
      .getLayers()
      .getArray()
      .find((layer) => layer.get('id') === 'ecotwin-overlay') as LayerGroup;
    const image = group.getLayers().item(0) as ImageLayer<ImageStatic>;
    expect(image.getVisible()).toBeTrue();
    map.getView().animate({ zoom: 7, duration: 500 });
    session.result.set(null);
    TestBed.tick();
    expect(image.getVisible()).toBeFalse();
    expect(image.getSource()).toBeNull();
    expect(native.getVisible()).toBeTrue();
    session.result.set({ ...fixture, id: 'another-run' });
    TestBed.tick();
    expect(image.getVisible()).toBeTrue();
    expect(image.getSource()).not.toBeNull();
    bridge.detach();
    map.dispose();
  });
});
