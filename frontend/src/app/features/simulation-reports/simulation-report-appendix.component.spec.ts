import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SimulationReportAppendixComponent } from './simulation-report-appendix.component';
import { SimulationReportData, SimulationSummary } from './simulation-report-data.service';
import { reportFigures } from './simulation-report-figures';
import { calculationFixture } from '../mareld-poc/testing/calculation.fixture';
import { encodeFloats } from '../mareld-poc/simulation-persistence.client';

function summary(): SimulationSummary {
  const source = calculationFixture().source;
  return {
    version: 'ecotwin-report-v1',
    runId: 'run-a',
    calculationId: 7,
    completedAt: 12345,
    source,
    model: { id: 'test', name: 'Test', species: ['codfish', 'plankton'] },
    config: {
      maxSteps: 1,
      sampleEvery: 4,
      seed: 42,
      tickDurationDays: 0.25,
      mappingVersion: 'hav-west-native-v1'
    },
    grid: { crs: 'EPSG:3035', extent: [0, 0, 3000, 3000], width: 3, height: 3, cellMetres: 1000 },
    water: [1, 0, 1, 0, 0, 0, 0, 0, 0],
    waterCells: 2,
    nativeAreaKm2: 1.5,
    steps: [0, 1],
    species: ['codfish', 'plankton'],
    units: 'tonnes/cell',
    assumptions: ['Synthetic depth'],
    pressures: [],
    totals: [
      [2, 4],
      [0, 8]
    ],
    maxima: [2, 4],
    finalBiomassB64: encodeFloats(
      new Float32Array([2, 4, 0, 0, 2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    )
  };
}

describe('static simulation appendix', () => {
  let data: jasmine.SpyObj<SimulationReportData>;
  beforeEach(() => {
    data = jasmine.createSpyObj('Read-only saved data', ['list', 'report']);
    TestBed.configureTestingModule({
      imports: [SimulationReportAppendixComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: SimulationReportData, useValue: data }
      ]
    });
  });
  async function render() {
    const fixture = TestBed.createComponent(SimulationReportAppendixComponent);
    fixture.componentInstance.calculationId = 7;
    fixture.detectChanges();
    await fixture.componentInstance.load();
    fixture.detectChanges();
    return fixture;
  }
  it('renders no appendix or empty heading for a calculation with no saved simulations', async () => {
    data.list.and.resolveTo([]);
    const fixture = await render();
    expect(fixture.nativeElement.querySelector('h1')).toBeNull();
    expect(data.report).not.toHaveBeenCalled();
    expect(document.documentElement.dataset['simulationAppendixState']).toBe('ready');
  });
  it('reads persisted summaries/final frames and renders every run without session/model services', async () => {
    const a = summary(),
      b = { ...summary(), runId: 'run-b', completedAt: 23456 };
    data.list.and.resolveTo([a, b]);
    data.report.and.callFake(async (_id, runId) => (runId === 'run-a' ? a : b));
    const fixture = await render();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelectorAll('.simulation-run').length).toBe(2);
    expect(host.querySelectorAll('figure img').length).toBe(4);
    expect(host.querySelectorAll('svg path').length).toBe(4);
    expect(host.textContent).toContain('Not defined');
    expect(host.textContent).toContain('Synthetic depth');
    expect(document.documentElement.dataset['simulationAppendixState']).toBe('ready');
  });
  it('shows appendix errors and supports retry without representing failure as an empty report', async () => {
    data.list.and.rejectWith(new Error('Offline'));
    const fixture = await render();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Offline');
    expect(document.documentElement.dataset['simulationAppendixState']).toBe('error');
    data.list.and.resolveTo([]);
    await fixture.componentInstance.load();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(document.documentElement.dataset['simulationAppendixState']).toBe('ready');
  });
  it('uses saved zero-initial values and rejects invalid final tensors', () => {
    const run = summary();
    const figures = reportFigures(run);
    expect(figures.species[1].percent).toBeNull();
    expect(figures.species[0].percent).toBe(100);
    expect(figures.species[0].change).toBe(2);
    expect(figures.days).toBe(0.25);
    run.finalBiomassB64 = 'AA==';
    expect(() => reportFigures(run)).toThrowError(/wrong size/);
  });
});
