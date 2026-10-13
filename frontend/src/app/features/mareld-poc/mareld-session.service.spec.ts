import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { Subject } from 'rxjs';
import { UserActions } from '@data/user';
import { MareldApiClient } from './mareld-api.client';
import { MareldSession } from './mareld-session.service';
import { SymphonyCalculationAdapter } from './symphony-calculation.adapter';
import { SimulationPersistenceClient } from './simulation-persistence.client';
import { SimulationReportData } from '../simulation-reports/simulation-report-data.service';
import { calculationFixture } from './testing/calculation.fixture';
import { MareldResult } from './mareld-result';

import { sessionProviders } from './testing/session.fixture';

describe('calculation-owned simulation session', () => {
  let setup: ReturnType<typeof sessionProviders>, session: MareldSession;
  beforeEach(() => {
    setup = sessionProviders();
    TestBed.configureTestingModule({ providers: setup.providers });
    session = TestBed.inject(MareldSession);
  });
  const completed = (id: number): MareldResult => ({
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

  it('stays dormant until explicit activation/selection and does not run on selection', async () => {
    expect(setup.api.models).not.toHaveBeenCalled();
    expect(setup.adapter.context).not.toHaveBeenCalled();
    await session.discover();
    await session.selectCalculation(7);
    expect(session.input()?.source?.calculationId).toBe(7);
    expect(session.canRun()).toBeTrue();
    expect(setup.api.run).not.toHaveBeenCalled();
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
    let resolve!: (value: MareldResult) => void;
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
  it('retains completed output when saving fails and retries the same identity without another model run', async () => {
    await session.discover();
    await session.selectCalculation(7);
    const result = completed(7);
    setup.api.run.and.resolveTo(result);
    setup.persistence.save.and.rejectWith(new Error('Storage unavailable'));
    await session.run();
    expect(session.result()).toBe(result);
    expect(session.saved()).toBeFalse();
    expect(session.saveError()).toContain('Storage unavailable');
    expect(session.canRun()).toBeFalse();
    setup.persistence.save.and.resolveTo({});
    await session.saveResult();
    expect(session.saved()).toBeTrue();
    expect(setup.api.run).toHaveBeenCalledTimes(1);
    expect(
      setup.persistence.save.calls.allArgs().map((args: [MareldResult]) => args[0].id)
    ).toEqual([result.id, result.id]);
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
    setup.actions.next(UserActions.logoutUser());
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
    expect(session.result()).toBeNull(); // The oldest saved run is available from durable history.
    expect(setup.api.run).toHaveBeenCalledTimes(3);
  });
  it('never evicts two unsaved results or starts a third run', async () => {
    await session.discover();
    setup.persistence.save.and.rejectWith(new Error('Offline'));
    for (const id of [7, 8]) {
      await session.selectCalculation(id);
      setup.api.run.and.resolveTo(completed(id));
      await session.run();
    }
    await session.selectCalculation(9);
    expect(session.selectedId()).toBe(8);
    expect(session.error()).toContain('unsaved');
    await session.selectCalculation(7);
    expect(session.result()?.input.source?.calculationId).toBe(7);
    expect(session.canRun()).toBeFalse();
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
