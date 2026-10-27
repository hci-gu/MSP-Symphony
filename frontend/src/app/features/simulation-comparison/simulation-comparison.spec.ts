import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SimulationReportData } from '../simulation-reports/simulation-report-data.service';
import { simulationSummary } from './testing/summary.fixture';
import {
  comparisonFigures,
  comparisonIssues,
  comparisonQuery,
  suggestPair
} from './simulation-comparison';
import { SimulationComparisonPickerComponent } from './simulation-comparison-picker.component';
import { SimulationComparisonReportComponent } from './simulation-comparison-report.component';

describe('simulation comparison', () => {
  const pair = () => {
    const a = simulationSummary(),
      b = simulationSummary();
    b.calculationId = b.source.calculationId = 9;
    b.runId = 'run-b';
    b.source.fingerprint = 'different-scenario';
    b.source.changes = { baseChanges: { PRESSURE: { '1': { multiplier: 0.5 } } }, areaChanges: {} };
    return [a, b];
  };
  it('allows intentional pressure changes and requires matching sources, model, time, domain and seeds', () => {
    const [a, b] = pair();
    expect(comparisonIssues(a, b)).toEqual([]);
    const changes = [
      () => (b.model.id = 'other'),
      () => b.species.pop(),
      () => b.config.maxSteps++,
      () => (b.config.mappingVersion = 'other'),
      () => (b.source.sourceFingerprints['PRESSURE'] = 'changed'),
      () => (b.source.bands[0].units = 'different'),
      () => (b.water[0] = 0),
      () => b.config.seed++
    ];
    changes.forEach((change, index) => {
      change();
      expect(comparisonIssues(a, b).length).toBe(index + 1);
    });
  });
  it('suggests a compatible pair instead of unrelated latest runs, and pins both IDs in the URL', () => {
    const [a, b] = pair(),
      newer = { ...b, runId: 'newer', completedAt: 99999, config: { ...b.config, seed: 99 } };
    expect(suggestPair([a], [b, newer])).toEqual([a, b]);
    expect(
      comparisonQuery(
        {
          baselineCalculationId: 7,
          scenarioCalculationId: 9,
          baselineRunId: a.runId,
          scenarioRunId: b.runId
        },
        true
      )
    ).toBe('?reverse=true&simBase=7&simBaselineRun=run-a&simScenarioRun=run-b');
  });
  it('shares axes across each species pair and handles zero initial biomass', () => {
    const [a, b] = pair();
    b.totals[0][1] = 8;
    const rows = comparisonFigures(a, b);
    expect(rows[0].maximum).toBe(400);
    expect(rows[0].curves.map((curve) => curve.final)).toEqual([200, 400]);
    expect(rows[0].curves.map((curve) => curve.path)).toEqual([
      'M45,137.5 L410,100',
      'M45,137.5 L410,25'
    ]);
    expect(rows[1].curves.every((curve) => !curve.path && curve.final === null)).toBeTrue();
  });
  it('normalizes every seed before calculating the mean and confidence interval', () => {
    const [a, b] = pair();
    for (const run of [a, b]) {
      run.ensemble = {
        seeds: Array.from({ length: 10 }, (_, i) => 42 + i),
        confidenceLevel: 0.95,
        ciMethod: 'student-t',
        totals: Array.from({ length: 10 }, (_, i) => [
          [i < 5 ? 1 : 2, 2],
          [0, 8]
        ]),
        mean: [
          [1.5, 2],
          [0, 8]
        ],
        ciLow: [
          [1, 2],
          [0, 8]
        ],
        ciHigh: [
          [2, 2],
          [0, 8]
        ]
      };
      run.totals = run.ensemble.mean;
    }
    const row = comparisonFigures(a, b)[0];
    expect(row.curves[0].final).toBe(150);
    expect(row.maximum).toBe(200);
    expect(row.curves[0].band).not.toMatch(/NaN|Infinity/);
    expect(Number(row.curves[0].band.split(' ')[1].split(',')[1])).toBeCloseTo(34.22303546575, 5);
  });

  let data: jasmine.SpyObj<SimulationReportData>;
  beforeEach(() => {
    data = jasmine.createSpyObj('Saved data', ['list', 'baseline', 'createBaseline']);
    data.baseline.and.resolveTo(null);
    const [a, b] = pair();
    data.list.and.callFake(async (id) => (id === 7 ? [a] : [b]));
    TestBed.configureTestingModule({
      imports: [SimulationComparisonPickerComponent, SimulationComparisonReportComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: SimulationReportData, useValue: data }
      ]
    });
  });
  it('does no requests before opting in and never creates an automatic baseline on read', async () => {
    const fixture = TestBed.createComponent(SimulationComparisonPickerComponent),
      c = fixture.componentInstance;
    c.scenarioCalculationId = 9;
    fixture.detectChanges();
    expect(data.list).not.toHaveBeenCalled();
    c.setEnabled(true);
    await c.load();
    expect(data.baseline).toHaveBeenCalledWith(9);
    expect(data.createBaseline).not.toHaveBeenCalled();
    expect(c.baselineId()).toBeNull();
  });
  it('keeps a deleted selection pinned and invalid instead of silently switching runs', async () => {
    const fixture = TestBed.createComponent(SimulationComparisonPickerComponent),
      c = fixture.componentInstance;
    c.implicit = false;
    c.baselineCalculationId = 7;
    c.scenarioCalculationId = 9;
    const changes = jasmine.createSpy('choice');
    c.choiceChange.subscribe(changes);
    c.setEnabled(true);
    await c.load();
    expect(changes.calls.mostRecent().args[0].selection.scenarioRunId).toBe('run-b');
    data.list.and.resolveTo([]);
    await c.load();
    expect(c.scenarioRunId()).toBe('run-b');
    expect(changes.calls.mostRecent().args[0].selection).toBeNull();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Selected run is no longer available');
  });
  it('selects a newly completed matching baseline without replacing the selected scenario', async () => {
    const fixture = TestBed.createComponent(SimulationComparisonPickerComponent),
      c = fixture.componentInstance;
    c.implicit = false;
    c.baselineCalculationId = 7;
    c.scenarioCalculationId = 9;
    const [a, b] = pair();
    data.list.and.callFake(async (id) => (id === 7 ? [] : [b]));
    c.setEnabled(true);
    await c.load();
    expect(c.baselineRunId()).toBe('');
    data.list.and.callFake(async (id) => (id === 7 ? [a] : [b]));
    await c.load();
    expect(c.baselineRunId()).toBe(a.runId);
    expect(c.scenarioRunId()).toBe(b.runId);
  });
  it('discards delayed data after the chosen calculation changes', async () => {
    const fixture = TestBed.createComponent(SimulationComparisonPickerComponent),
      c = fixture.componentInstance;
    c.implicit = false;
    c.baselineCalculationId = 7;
    c.scenarioCalculationId = 9;
    let resolve!: (value: ReturnType<typeof pair>) => void;
    data.list.and.returnValue(new Promise((r) => (resolve = r)));
    c.setEnabled(true);
    c.scenarioCalculationId = null;
    c.ngOnChanges();
    resolve(pair());
    await Promise.resolve();
    await Promise.resolve();
    expect(c.scenarioRuns()).toEqual([]);
  });
  async function report(reverse = false) {
    const fixture = TestBed.createComponent(SimulationComparisonReportComponent),
      c = fixture.componentInstance;
    c.selection = {
      baselineCalculationId: 7,
      scenarioCalculationId: 9,
      baselineRunId: 'run-a',
      scenarioRunId: 'run-b'
    };
    c.expectedBaselineId = 7;
    c.reverse = reverse;
    await c.load();
    fixture.detectChanges();
    return fixture;
  }
  it('renders side-by-side persisted graphs, reverses order, and signals print readiness', async () => {
    const fixture = await report(true),
      c = fixture.componentInstance;
    expect(c.runs().map((run) => run.calculationId)).toEqual([9, 7]);
    expect(fixture.nativeElement.querySelectorAll('svg').length).toBe(2);
    expect(document.documentElement.dataset['simulationComparisonState']).toBe('ready');
    expect(fixture.nativeElement.querySelector('figcaption').textContent).toContain(
      'Scenario · #9'
    );
  });
  it('clears graphs and prevents printing when a pinned run is deleted', async () => {
    const fixture = await report(),
      c = fixture.componentInstance;
    data.list.and.resolveTo([]);
    await c.load();
    fixture.detectChanges();
    expect(c.runs()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('deleted or is unavailable');
    expect(document.documentElement.dataset['simulationComparisonState']).toBe('error');
  });
  it('rejects an automatic baseline from a different calculation', async () => {
    const fixture = await report(),
      c = fixture.componentInstance;
    c.implicit = true;
    data.baseline.and.resolveTo({
      scenarioCalculationId: 9,
      baselineCalculationId: 10,
      sourceFingerprint: 'hash'
    });
    await c.load();
    expect(c.error()).toContain('counterpart is no longer available');
    expect(c.rows()).toEqual([]);
  });
});
