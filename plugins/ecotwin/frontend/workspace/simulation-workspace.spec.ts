import { WritableSignal } from '@angular/core';
import { EcoTwinCapabilities } from '../capabilities';
import { SimulationRequest } from './simulation-jobs.client';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { EcoTwinApiClient } from './ecotwin-api.client';
import { SimulationWorkspace } from './simulation-workspace';
import { SimulationPersistenceClient } from './simulation-persistence.client';
import { SimulationReportData } from '../reports/simulation-report-data.service';
import { calculationFixture } from './testing/calculation.fixture';
import { EcoTwinResult } from './ecotwin-result';

import { sessionProviders } from './testing/session.fixture';
import { simulationSummary } from '../comparison/testing/summary.fixture';

describe('calculation-owned simulation session', () => {
  let setup: ReturnType<typeof sessionProviders>, session: SimulationWorkspace;
  beforeEach(() => {
    setup = sessionProviders();
    TestBed.configureTestingModule({ providers: setup.providers });
    session = TestBed.inject(SimulationWorkspace);
  });
  const completed = (id: number): EcoTwinResult => ({
    id: crypto.randomUUID(),
    input: calculationFixture(id).input,
    source: 'live',
    model: 'Test model',
    modelId: 'test',
    completedAt: Date.now(),
    species: ['codfish'],
    steps: [0, 4],
    values: new Float32Array(7200).fill(1),
    maxima: [1]
  });

  it('reads saved history in reporting-only mode without reconstructing inputs or discovering/executing a model', async () => {
    (TestBed.inject(EcoTwinCapabilities).execution as WritableSignal<boolean>).set(false);
    await session.selectCalculation(7);
    await session.discover();
    await session.run(); await session.runFull();
    expect(setup.reports.list).toHaveBeenCalledWith(7);
    expect(setup.adapter.context).not.toHaveBeenCalled();
    expect(setup.adapter.grid).not.toHaveBeenCalled();
    expect(setup.api.models).not.toHaveBeenCalled();
    expect(setup.api.run).not.toHaveBeenCalled();
    expect(setup.jobs.submit).not.toHaveBeenCalled();
  });
  it('stays dormant until explicit activation/selection and does not run on selection', async () => {
    expect(setup.api.models).not.toHaveBeenCalled();
    expect(setup.adapter.context).not.toHaveBeenCalled();
    await session.discover();
    await session.selectCalculation(7);
    expect(session.input()?.source?.calculationId).toBe(7);
    expect(session.canRun()).toBeTrue();
    expect(setup.api.run).not.toHaveBeenCalled();
  });
  it('copies matching settings after shared model discovery without starting a run', async () => {
    const match = simulationSummary();
    match.config.maxSteps = 80;
    match.config.seed = 200;
    setup.reports.list.and.resolveTo([match]);
    const discovering = session.discover();
    await session.prepareComparison(9, 7, match.runId);
    await discovering;
    expect(session.selectedId()).toBe(9);
    expect(session.modelId()).toBe('test');
    expect(session.maxSteps()).toBe(80);
    expect(session.seed()).toBe(200);
    expect(session.preparationNote()).toContain('Settings copied');
    expect(setup.api.run).not.toHaveBeenCalled();
    expect(setup.jobs.submit).not.toHaveBeenCalled();
  });
  it('reports missing matching runs without silently copying different settings', async () => {
    await session.prepareComparison(9, 7, 'deleted');
    expect(session.error()).toContain('no longer available');
    expect(session.preparationNote()).toBe('');
    expect(setup.jobs.submit).not.toHaveBeenCalled();
  });
  it('ignores late matching settings after selecting a different calculation', async () => {
    const match = simulationSummary();
    match.config.maxSteps = 80;
    match.config.seed = 200;
    let resolve!: (runs: (typeof match)[]) => void;
    setup.reports.list.and.callFake(async (id: number) =>
      id === 7 ? new Promise((r) => (resolve = r)) : []
    );
    const preparation = session.prepareComparison(9, 7, match.runId);
    await new Promise((r) => setTimeout(r, 0));
    await session.selectCalculation(8);
    resolve([match]);
    await preparation;
    expect(session.selectedId()).toBe(8);
    expect(session.seed()).toBe(42);
    expect(session.preparationNote()).toBe('');
    expect(session.preparingComparison()).toBeFalse();
  });
  async function openSavedResult() {
    const result = completed(7);
    setup.reports.list.and.resolveTo([{ runId: result.id }]);
    setup.persistence.load.and.resolveTo(result);
    await session.selectCalculation(7);
    await session.openSaved(result.id);
    return result;
  }
  it('deletes the selected saved run, stops playback and clears cached output', async () => {
    const result = await openSavedResult();
    session.togglePlayback();
    expect(session.selectedRunId()).toBe(result.id);
    await session.deleteSaved(result.id);
    expect(setup.persistence.delete).toHaveBeenCalledOnceWith(7, result.id);
    expect(session.history()).toEqual([]);
    expect(session.selectedRunId()).toBeNull();
    expect(session.result()).toBeNull();
    expect(session.playing()).toBeFalse();
    await session.selectCalculation(8);
    await session.selectCalculation(7);
    expect(session.result()).toBeNull();
    expect(session.history()).toEqual([]); // Ignore a stale list response.
  });
  it('keeps the currently displayed run when deleting a different saved run', async () => {
    const result = await openSavedResult();
    setup.reports.list.and.resolveTo([{ runId: result.id }, { runId: 'other' }]);
    await session.loadHistory();
    await session.deleteSaved('other');
    expect(session.result()).toBe(result);
    expect(session.selectedRunId()).toBe(result.id);
    expect(session.history().map((run) => run.runId)).toEqual([result.id]);
  });
  it('retains the saved run and selection after failed deletion and allows retry', async () => {
    const result = await openSavedResult();
    setup.persistence.delete.and.rejectWith(new Error('Access denied'));
    await session.deleteSaved(result.id);
    expect(session.deleteError()).toBe('Access denied');
    expect(session.result()).toBe(result);
    expect(session.history().length).toBe(1);
    expect(session.deletingRunId()).toBeNull();
    setup.persistence.delete.and.resolveTo();
    await session.deleteSaved(result.id);
    expect(session.deleteError()).toBe('');
    expect(session.history()).toEqual([]);
  });
  it('attributes a late deletion to its original calculation without clearing the new selection', async () => {
    const result = await openSavedResult();
    let finish!: () => void;
    setup.persistence.delete.and.returnValue(new Promise<void>((resolve) => (finish = resolve)));
    const deletion = session.deleteSaved(result.id);
    await session.deleteSaved(result.id); // Double click must not send a duplicate request.
    expect(setup.persistence.delete).toHaveBeenCalledTimes(1);
    await session.selectCalculation(8);
    finish();
    await deletion;
    expect(session.selectedId()).toBe(8);
    expect(session.input()?.source?.calculationId).toBe(8);
    await session.selectCalculation(7);
    expect(session.result()).toBeNull();
  });
  it('does not let a late history response resurrect a deleted run', async () => {
    const result = await openSavedResult();
    setup.reports.list.and.resolveTo([{ runId: result.id }, { runId: 'other' }]);
    await session.loadHistory();
    let finish!: (runs: unknown[]) => void;
    setup.reports.list.and.returnValue(new Promise((resolve) => (finish = resolve)));
    const refresh = session.loadHistory();
    await session.deleteSaved('other');
    finish([{ runId: result.id }, { runId: 'other' }]);
    await refresh;
    expect(session.history().map((run) => run.runId)).toEqual([result.id]);
  });
  it('discards late context A after selecting B', async () => {
    let resolve!: (value: unknown) => void;
    setup.adapter.context.and.callFake((id: number) =>
      id === 7 ? new Promise((r) => (resolve = r)) : Promise.resolve(calculationFixture(id).source)
    );
    const first = session.selectCalculation(7);
    await session.selectCalculation(8);
    resolve(calculationFixture(7).source);
    await first;
    expect(session.input()?.source?.calculationId).toBe(8);
  });
  it('discards late grid A after selecting B', async () => {
    let resolve!: (value: unknown) => void;
    setup.adapter.grid.and.callFake((source: { calculationId: number }) =>
      source.calculationId === 7
        ? new Promise((r) => (resolve = r))
        : Promise.resolve(calculationFixture(8).grid)
    );
    const first = session.selectCalculation(7);
    await Promise.resolve();
    await session.selectCalculation(8);
    resolve(calculationFixture(7).grid);
    await first;
    expect(session.input()?.source?.calculationId).toBe(8);
  });
  it('aborts/discards late run A and never saves it against B', async () => {
    await session.discover();
    await session.selectCalculation(7);
    let resolve!: (value: EcoTwinResult) => void;
    setup.api.run.and.returnValue(new Promise((r) => (resolve = r)));
    const pending = session.run();
    const signal = setup.api.run.calls.mostRecent().args[3] as AbortSignal;
    await session.selectCalculation(8);
    expect(signal.aborted).toBeTrue();
    resolve(completed(7));
    await pending;
    expect(session.result()).toBeNull();
    expect(setup.persistence.save).not.toHaveBeenCalled();
  });
  it('replaces previews freely and never saves them or adds report appendices', async () => {
    await session.discover();
    await session.selectCalculation(7);
    setup.api.run.and.resolveTo(completed(7));
    await session.run();
    expect(session.result()?.kind).toBe('preview');
    expect(session.saved()).toBeFalse();
    expect(session.canRun()).toBeTrue();
    await session.saveResult();
    expect(setup.persistence.save).not.toHaveBeenCalled();
    session.seed.set(100);
    expect(session.previewOutdated()).toBeTrue();
    setup.api.run.and.resolveTo(completed(7));
    await session.run();
    expect(session.previewOutdated()).toBeFalse();
    expect(setup.api.run).toHaveBeenCalledTimes(2);
  });
  it('submits a frozen ten-seed job and leaves execution on the server after detaching', async () => {
    await session.discover();
    await session.selectCalculation(7);
    session.setMaxSteps(40);
    session.seed.set(123);
    setup.jobs.submit.and.callFake(async (request: SimulationRequest) => ({
      runId: request.runId,
      calculationId: 7,
      status: 'queued',
      completedSeeds: 0,
      replicates: 10,
      config: request.config
    }));
    setup.jobs.list.and.callFake(async () =>
      setup.jobs.submit.calls.count()
        ? [await setup.jobs.submit.calls.mostRecent().returnValue]
        : []
    );
    await session.runFull();
    const request = setup.jobs.submit.calls.mostRecent().args[0];
    expect(request.config).toEqual(
      jasmine.objectContaining({ seed: 123, maxSteps: 40, replicates: 10 })
    );
    session.seed.set(999);
    session.setMaxSteps(80);
    expect(request.config.seed).toBe(123);
    expect(request.config.maxSteps).toBe(40);
    session.detach();
    expect(setup.api.run).not.toHaveBeenCalled();
    expect(setup.persistence.save).not.toHaveBeenCalled();
  });
  it('retries an uncertain submission with the same frozen identity and recovers server progress', async () => {
    await session.discover();
    await session.selectCalculation(7);
    setup.jobs.submit.and.rejectWith(new Error('Connection lost'));
    await session.runFull();
    const request = setup.jobs.submit.calls.mostRecent().args[0];
    expect(session.submissionUncertain()).toBeTrue();
    expect(session.canRun()).toBeFalse();
    setup.jobs.submit.and.resolveTo({
      runId: request.runId,
      calculationId: 7,
      status: 'queued',
      completedSeeds: 0
    });
    await session.submitFull();
    expect(setup.jobs.submit.calls.mostRecent().args[0]).toBe(request);
    expect(session.submissionUncertain()).toBeFalse();
  });
  it('retains an uncertain submission across map destruction without permitting a new identity', async () => {
    await session.discover();
    await session.selectCalculation(7);
    let reject!: (reason: Error) => void;
    setup.jobs.submit.and.returnValue(new Promise((_, fail) => (reject = fail)));
    const submission = session.runFull();
    session.detach();
    expect(session.submitting()).toBeTrue();
    reject(new Error('Connection interrupted'));
    await submission;
    expect(session.submitting()).toBeFalse();
    expect(session.submissionUncertain()).toBeTrue();
    expect(session.error()).toContain('Connection interrupted');
    expect(session.canRun()).toBeFalse();
  });
  it('loads a completed ensemble and history when the watched job finishes', async () => {
    await session.discover();
    await session.selectCalculation(7);
    const job = { runId: 'full', calculationId: 7, status: 'running', completedSeeds: 3 };
    setup.jobs.list.and.resolveTo([job]);
    await session.loadJobs();
    const result = { ...completed(7), kind: 'ensemble' as const, source: 'saved' as const };
    setup.persistence.load.and.resolveTo(result);
    setup.jobs.list.and.resolveTo([{ ...job, status: 'completed', completedSeeds: 10 }]);
    await session.loadJobs();
    expect(setup.persistence.load).toHaveBeenCalledWith(7, 'full');
    expect(session.result()).toBe(result);
    expect(session.saved()).toBeTrue();
  });
  it('restores calculation settings and results after switching away, and keeps provenance unchanged', async () => {
    await session.discover();
    await session.selectCalculation(7);
    session.setMaxSteps(20);
    const result = completed(7);
    setup.api.run.and.resolveTo(result);
    await session.run();
    await session.selectCalculation(8);
    session.setMaxSteps(40);
    await session.selectCalculation(7);
    expect(session.result()).toBe(result);
    expect(session.maxSteps()).toBe(20);
    expect(setup.api.run).toHaveBeenCalledTimes(1);
    expect(result.input.source!.calculationId).toBe(7);
  });
  it('clears user-scoped output on logout and invalidates pending context', async () => {
    await session.discover();
    await session.selectCalculation(7);
    setup.actions.next({ type: 'logout' });
    expect(session.input()).toBeNull();
    expect(session.models()).toEqual([]);
    expect(session.selectedId()).toBeNull();
  });
  it('pauses playback on suspend while retaining completed output', async () => {
    await session.discover();
    await session.selectCalculation(7);
    setup.api.run.and.resolveTo(completed(7));
    await session.run();
    jasmine.clock().install();
    try {
      session.togglePlayback();
      expect(session.playing()).toBeTrue();
      session.suspend();
      expect(session.playing()).toBeFalse();
      jasmine.clock().tick(1500);
      expect(session.frame()).toBe(0);
      expect(session.result()).not.toBeNull();
    } finally {
      jasmine.clock().uninstall();
    }
  });
  it('invalidates discovery and unfinished preparation on map destruction, then resumes selection', async () => {
    let finishModels!: (models: unknown[]) => void;
    setup.api.models.and.returnValue(new Promise((resolve) => (finishModels = resolve)));
    const discovery = session.discover();
    let finishContext!: (value: unknown) => void;
    setup.adapter.context.and.returnValue(new Promise((resolve) => (finishContext = resolve)));
    const preparation = session.selectCalculation(7);
    session.detach();
    finishModels([{ id: 'late', name: 'Late model', species: ['codfish'] }]);
    finishContext(calculationFixture(7).source);
    await Promise.all([discovery, preparation]);
    expect(session.models()).toEqual([]);
    expect(session.input()).toBeNull();
    setup.adapter.context.and.resolveTo(calculationFixture(7).source);
    session.resume();
    await Promise.resolve();
    await Promise.resolve();
    expect(session.input()?.source?.calculationId).toBe(7);
  });
  it('evicts saved tensors to enforce the total memory budget', async () => {
    await session.discover();
    for (const id of [7, 8, 9]) {
      await session.selectCalculation(id);
      setup.api.run.and.resolveTo({ ...completed(id), values: new Float32Array(2 * 1024 * 1024) });
      await session.run();
    }
    await session.selectCalculation(7);
    expect(session.result()).toBeNull(); // Old previews may be discarded to bound memory.
    expect(setup.api.run).toHaveBeenCalledTimes(3);
  });
  it('clears inaccessible cached results when source authorization is lost', async () => {
    await session.discover();
    await session.selectCalculation(7);
    setup.api.run.and.resolveTo(completed(7));
    await session.run();
    setup.adapter.context.and.rejectWith(new Error('Access denied'));
    await session.selectCalculation(7);
    expect(session.result()).toBeNull();
    expect(session.input()).toBeNull();
    setup.adapter.context.and.resolveTo(calculationFixture(7).source);
    await session.selectCalculation(7);
    expect(session.result()).toBeNull();
  });
});
