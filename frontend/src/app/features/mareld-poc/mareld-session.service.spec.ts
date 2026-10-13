import { TestBed } from '@angular/core/testing';
import { MareldApiClient } from './mareld-api.client';
import { MareldSession } from './mareld-session.service';
import { MareldModel, MareldResult } from './mareld-result';
import { SymphonySelectionAdapter } from './symphony-selection.adapter';
import { biomassFixture } from './testing/biomass.fixture';
import { MareldImpactData } from './mareld-impact-data.service';
import { impactSourceFixture } from './testing/impact.fixture';
import { ImpactSource } from './mareld-impacts';

describe('MARELD session lifecycle', () => {
  let session: MareldSession;
  let api: jasmine.SpyObj<MareldApiClient>;
  let impactData: jasmine.SpyObj<MareldImpactData>;
  beforeEach(() => {
    api = jasmine.createSpyObj('API', ['models', 'run']);
    impactData = jasmine.createSpyObj('Impact data', ['load']);
    TestBed.configureTestingModule({
      providers: [
        { provide: MareldApiClient, useValue: api },
        { provide: MareldImpactData, useValue: impactData },
        {
          provide: SymphonySelectionAdapter,
          useValue: { capture: () => Promise.reject(new Error('Select one area')) }
        }
      ]
    });
    session = TestBed.inject(MareldSession);
  });

  it('runs through the API by default; changing the input clears the result', async () => {
    expect(session.maxSteps()).toBe(5000);
    session.useExample();
    const input = session.input()!;
    expect(input.waterCells).toBe(3600);
    const result = biomassFixture();
    const model = { id: 'model', name: 'Model', species: result.species };
    api.models.and.resolveTo([model]);
    api.run.and.resolveTo(result);
    await session.discover();
    await session.run();
    expect(api.run).toHaveBeenCalledOnceWith(input, model, 5000, jasmine.any(AbortSignal));
    expect(session.result()).toBe(result);
    expect(session.busy()).toBeFalse();
    session.useExample();
    expect(session.result()).toBeNull();
  });

  it('discards a late live response and aborts its browser request after a reset', async () => {
    session.useExample();
    const result = biomassFixture();
    let resolve!: (value: MareldResult) => void;
    api.run.and.returnValue(new Promise((r) => (resolve = r)));
    api.models.and.resolveTo([{ id: 'model', name: 'Model', species: ['codfish'] }]);
    await session.discover();
    const pending = session.run();
    const signal = api.run.calls.mostRecent().args[3];
    expect(session.busy()).toBeTrue();
    session.reset();
    resolve(result);
    await pending;
    expect(signal.aborted).toBeTrue();
    expect(session.result()).toBeNull();
    expect(session.input()).toBeNull();
    expect(session.busy()).toBeFalse();
  });

  it('reports selection and API errors and requires an available model', async () => {
    await session.capture();
    expect(session.error()).toBe('Select one area');
    api.models.and.rejectWith(new Error('No checkpoints'));
    await session.discover();
    expect(session.modelError()).toBe('No checkpoints');
    session.useExample();
    await session.run();
    expect(session.result()).toBeNull();
    expect(session.error()).toContain('Choose an available model');
    expect(api.run).not.toHaveBeenCalled();
  });

  it('prefers the configured test model regardless of discovery order', async () => {
    api.models.and.resolveTo([
      { id: 'codex_api_smoke_20261006', name: 'Smoke test', species: ['codfish'] },
      { id: 'allminussb', name: 'Allminussb', species: ['codfish'] }
    ]);
    await session.discover();
    expect(session.modelId()).toBe('allminussb');
    // Reconnecting must preserve an explicit user selection.
    session.selectModel('codex_api_smoke_20261006');
    await session.discover();
    expect(session.modelId()).toBe('codex_api_smoke_20261006');
  });

  it('keeps model discovery running when an area is captured', async () => {
    let resolve!: (models: MareldModel[]) => void;
    api.models.and.returnValue(new Promise((r) => (resolve = r)));
    const pending = session.discover();
    session.useExample();
    expect(session.discovering()).toBeTrue();
    const models = [{ id: 'test', name: 'Test', species: ['codfish'] }];
    resolve(models);
    await pending;
    expect(session.models()).toEqual(models);
    expect(session.modelId()).toBe('test');
    expect(session.discovering()).toBeFalse();
  });

  it('ignores discovery from a previous session after reset', async () => {
    let resolve!: (models: MareldModel[]) => void;
    api.models.and.returnValue(new Promise((r) => (resolve = r)));
    const pending = session.discover();
    session.reset();
    api.models.and.resolveTo([{ id: 'new', name: 'New', species: ['codfish'] }]);
    await session.discover();
    resolve([{ id: 'old', name: 'Old', species: ['codfish'] }]);
    await pending;
    expect(session.modelId()).toBe('new');
    expect(session.models().map((model) => model.id)).toEqual(['new']);
  });

  it('waits for impact preparation, captures both inputs, and keeps past run settings', async () => {
    session.useExample();
    impactData.load.and.resolveTo(impactSourceFixture(session.input()!));
    api.models.and.resolveTo([{ id: 'test', name: 'Test', species: ['codfish'] }]);
    api.run.and.callFake(async (input) => ({ ...biomassFixture(), input }));
    await session.discover();
    session.setImpactEnabled('noise', true);
    session.setImpactEnabled('trawling', true);
    expect(session.canRun()).toBeFalse();
    await session.prepareImpacts();
    expect(session.canRun()).toBeTrue();
    session.showImpact('noise');
    await session.run();
    expect(session.previewImpact()).toBeNull();
    const snapshot = session.result()!.input.impacts!;
    expect(snapshot.layers.map((layer) => layer.kind)).toEqual(['noise', 'trawling']);
    session.setImpactStrength('noise', 2);
    await session.prepareImpacts();
    expect(snapshot.settings.noise.strength).toBe(1);
    expect(session.preparedImpacts()!.settings.noise.strength).toBe(2);
  });

  it('discards late impact loads after resetting or changing areas', async () => {
    session.useExample();
    const source = impactSourceFixture(session.input()!);
    let resolve!: (value: ImpactSource) => void;
    impactData.load.and.returnValue(new Promise((r) => (resolve = r)));
    session.setImpactEnabled('noise', true);
    const pending = session.prepareImpacts();
    session.reset();
    resolve(source);
    await pending;
    expect(session.preparedImpacts()).toBeNull();
    expect(session.preparingImpacts()).toBeFalse();
    expect(session.impactsEnabled()).toBeFalse();
  });

  it('blocks an enabled input without coverage and recovers when disabled', async () => {
    session.useExample();
    const source = impactSourceFixture(session.input()!);
    source.raster.provenance.fill(0);
    source.raster.values.fill(NaN);
    impactData.load.and.resolveTo(source);
    api.models.and.resolveTo([{ id: 'test', name: 'Test', species: ['codfish'] }]);
    await session.discover();
    session.setImpactEnabled('noise', true);
    await session.prepareImpacts();
    expect(session.impactError()).toContain('No shipping noise source data');
    expect(session.canRun()).toBeFalse();
    await session.run();
    expect(api.run).not.toHaveBeenCalled();
    session.setImpactEnabled('noise', false);
    expect(session.canRun()).toBeTrue();
  });

  describe('simulation replay', () => {
    beforeEach(async () => {
      const result = biomassFixture();
      api.models.and.resolveTo([{ id: 'test', name: 'Test', species: result.species }]);
      api.run.and.resolveTo(result);
      session.useExample();
      await session.discover();
      await session.run();
      jasmine.clock().install();
    });

    afterEach(() => {
      session.pausePlayback();
      jasmine.clock().uninstall();
    });

    it('plays saved frames, stops at the end, and replays from the beginning', () => {
      session.togglePlayback();
      expect(session.playing()).toBeTrue();
      jasmine.clock().tick(500);
      expect(session.frame()).toBe(1);
      jasmine.clock().tick(500);
      expect(session.frame()).toBe(2);
      expect(session.playing()).toBeFalse();
      jasmine.clock().tick(1000);
      expect(session.frame()).toBe(2);
      session.togglePlayback();
      expect(session.frame()).toBe(0);
      expect(session.playing()).toBeTrue();
      jasmine.clock().tick(500);
      expect(session.frame()).toBe(1);
    });

    it('pauses without advancing and pauses on manual timeline selection', () => {
      session.togglePlayback();
      jasmine.clock().tick(500);
      session.togglePlayback();
      jasmine.clock().tick(1000);
      expect(session.frame()).toBe(1);
      expect(session.playing()).toBeFalse();
      session.togglePlayback();
      session.seekFrame(0);
      jasmine.clock().tick(1000);
      expect(session.frame()).toBe(0);
      expect(session.playing()).toBeFalse();
      session.seekFrame(99);
      expect(session.frame()).toBe(2);
    });

    it('stops playback when results are cleared or the session is reset', async () => {
      session.togglePlayback();
      session.clearResult();
      jasmine.clock().tick(1000);
      expect(session.frame()).toBe(0);
      expect(session.playing()).toBeFalse();
      session.togglePlayback();
      expect(session.playing()).toBeFalse();
      await session.run();
      session.togglePlayback();
      session.reset();
      jasmine.clock().tick(1000);
      expect(session.frame()).toBe(0);
      expect(session.playing()).toBeFalse();
    });

    it('stops playback while a replacement simulation runs', async () => {
      const result = biomassFixture();
      const model = { id: 'test', name: 'Test', species: result.species };
      api.models.and.resolveTo([model]);
      await session.discover();
      session.selectModel(model.id);
      api.run.and.resolveTo(result);
      session.togglePlayback();
      await session.run();
      jasmine.clock().tick(1000);
      expect(session.playing()).toBeFalse();
      expect(session.frame()).toBe(0);
      expect(session.result()).toBe(result);
    });
  });
});
