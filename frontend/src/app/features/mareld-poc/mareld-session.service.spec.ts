import { TestBed } from '@angular/core/testing';
import { MareldApiClient } from './mareld-api.client';
import { MareldSession } from './mareld-session.service';
import { MareldModel, MareldResult } from './mareld-result';
import { SymphonySelectionAdapter } from './symphony-selection.adapter';
import { biomassFixture } from './testing/biomass.fixture';

describe('MARELD session lifecycle', () => {
  let session: MareldSession;
  let api: jasmine.SpyObj<MareldApiClient>;
  beforeEach(() => {
    api = jasmine.createSpyObj('API', ['models', 'run']);
    TestBed.configureTestingModule({
      providers: [
        { provide: MareldApiClient, useValue: api },
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
