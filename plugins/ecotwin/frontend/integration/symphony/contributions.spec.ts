import { By } from '@angular/platform-browser';
import { SimulationReportAppendixComponent } from '../../reports/simulation-report-appendix.component';
import { signal, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EcoTwinReportEntry, EcoTwinComparisonEntry, ecoTwinExtension } from './contributions';
import { SimulationComparisonPickerComponent } from '../../comparison/simulation-comparison-picker.component';
import { simulationSummary } from '../../comparison/testing/summary.fixture';
import { EcoTwinCapabilities } from '../../capabilities';
import { SimulationReportData } from '../../reports/simulation-report-data.service';

describe('Symphony contribution adapter', () => {
  it('registers report/map descriptors without constructing map or workspace services', () => {
    TestBed.configureTestingModule({});
    const extension = TestBed.runInInjectionContext(ecoTwinExtension);
    expect(extension.id).toBe('ecotwin');
    expect(extension.report).toBe(EcoTwinReportEntry);
    // No calculation port, NgRx store, HTTP or model dependencies were provided.
  });
  it('reads stored reports with execution disabled and no workspace dependencies', async () => {
    const renderState = jasmine.createSpy('renderState');
    const data = {
      list: jasmine.createSpy('list').and.resolveTo([]),
      report: jasmine.createSpy('report')
    };
    TestBed.configureTestingModule({
      imports: [EcoTwinReportEntry],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: EcoTwinCapabilities,
          useValue: {
            load: () => Promise.resolve({ reporting: true, execution: false }),
            message: signal('Execution disabled')
          }
        },
        { provide: SimulationReportData, useValue: data }
      ]
    });
    const fixture = TestBed.createComponent(EcoTwinReportEntry);
    fixture.componentRef.setInput('context', { kind: 'calculation', calculationId: 7, query: {} });
    fixture.componentRef.setInput('renderState', renderState);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await (
      fixture.debugElement.query(By.directive(SimulationReportAppendixComponent))
        .componentInstance as SimulationReportAppendixComponent
    ).load();
    expect(data.list).toHaveBeenCalledWith(7);
    expect(renderState).toHaveBeenCalledWith('ready');
  });
  it('preserves pinned simulations when reversing and invalidates them when calculations change', async () => {
    const baseline = simulationSummary(),
      scenario = simulationSummary();
    scenario.calculationId = scenario.source.calculationId = 9;
    scenario.runId = 'run-b';
    TestBed.configureTestingModule({
      imports: [EcoTwinComparisonEntry],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: EcoTwinCapabilities,
          useValue: {
            load: () => Promise.resolve({ reporting: true, execution: false })
          }
        },
        {
          provide: SimulationReportData,
          useValue: {
            baseline: async () => ({ baselineCalculationId: 7 }),
            list: async (id: number) => (id === 7 ? [baseline] : id === 9 ? [scenario] : [])
          }
        }
      ]
    });
    const fixture = TestBed.createComponent(EcoTwinComparisonEntry),
      stateChange = jasmine.createSpy('stateChange');
    const context = {
      baselineCalculationId: null,
      scenarioCalculationId: 9,
      implicit: true,
      reverse: false
    };
    fixture.componentRef.setInput('context', context);
    fixture.componentRef.setInput('stateChange', stateChange);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const picker = fixture.debugElement.query(By.directive(SimulationComparisonPickerComponent))
      .componentInstance as SimulationComparisonPickerComponent;
    picker.setEnabled(true);
    await picker.load();
    fixture.detectChanges();
    expect(stateChange.calls.mostRecent().args[0].query['simScenarioRun']).toBe('run-b');
    stateChange.calls.reset();
    fixture.componentRef.setInput('context', { ...context, reverse: true });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(stateChange.calls.mostRecent().args[0]).toEqual({
      valid: true,
      query: {
        extensions: 'ecotwin',
        simBase: '7',
        simBaselineRun: baseline.runId,
        simScenarioRun: 'run-b'
      }
    });
    fixture.componentRef.setInput('context', { ...context, scenarioCalculationId: 11 });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(stateChange.calls.mostRecent().args[0]).toEqual({ valid: false, query: {} });
  });
  it('keeps installed but unavailable report content explicit and unprintable', async () => {
    TestBed.configureTestingModule({
      imports: [EcoTwinReportEntry],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: EcoTwinCapabilities,
          useValue: {
            load: () => Promise.resolve({ reporting: false }),
            message: signal('Server unavailable')
          }
        }
      ]
    });
    const fixture = TestBed.createComponent(EcoTwinReportEntry),
      renderState = jasmine.createSpy('renderState');
    fixture.componentRef.setInput('context', { kind: 'calculation', calculationId: 7, query: {} });
    fixture.componentRef.setInput('renderState', renderState);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Server unavailable');
    expect(renderState).toHaveBeenCalledWith('error');
    expect(renderState).not.toHaveBeenCalledWith('ready');
  });
});
