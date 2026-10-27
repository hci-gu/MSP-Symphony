import { EcoTwinResultsComponent } from '../../workspace/ecotwin-results.component';
import { Component, inject, Injector, Input, OnChanges, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Actions, ofType } from '@ngrx/effects';
import { map } from 'rxjs';
import { UserActions } from '@data/user';
import { CalculationActions } from '@data/calculation';
import {
  HostExtension,
  ComparisonContext,
  ComparisonContributionState,
  ReportContext,
  RenderState
} from '@src/app/extensions/extensions';
import { EcoTwinWorkspaceModule } from '../../workspace/workspace.module';
import { EcoTwinMapBridge } from '../../workspace/ecotwin-map.bridge';
import { EcoTwinCapabilities } from '../../capabilities';
import { SimulationComparisonPickerComponent } from '../../comparison/simulation-comparison-picker.component';
import { SimulationComparisonReportComponent } from '../../comparison/simulation-comparison-report.component';
import { SimulationReportAppendixComponent } from '../../reports/simulation-report-appendix.component';
import {
  comparisonQuery,
  SimulationComparisonChoice,
  SimulationComparisonSelection
} from '../../comparison/simulation-comparison';
import { HostLifecycleEvent, PreparationLink } from '../../ports';

export function hostLifecycle() {
  return inject(Actions).pipe(
    ofType(
      UserActions.logoutUser,
      CalculationActions.deleteCalculation,
      CalculationActions.deleteMultipleCalculations
    ),
    map(
      (action): HostLifecycleEvent =>
        action.type === UserActions.logoutUser.type
          ? { type: 'logout' }
          : {
              type: 'calculations-deleted',
              ids:
                'calculationIds' in action
                  ? action.calculationIds
                  : [action.calculationToBeDeleted.id]
            }
    )
  );
}
export function preparationLink(): PreparationLink | null {
  const query = inject(ActivatedRoute).snapshot.queryParamMap;
  const calculation = Number(query.get('calculation'));
  return query.get('tab') === 'mareld-poc' && Number.isInteger(calculation) && calculation > 0
    ? {
        calculation,
        matchCalculation: Number(query.get('matchCalculation')) || undefined,
        matchRun: query.get('matchRun') || undefined
      }
    : null;
}
@Component({
  selector: 'app-ecotwin-workspace-entry',
  standalone: true,
  imports: [EcoTwinWorkspaceModule],
  template: `@if (ready()) {
      @if (capabilities.message()) {
        <p role="status">{{ capabilities.message() }}</p>
      }
      @if (capabilities.value().reporting) {
        <app-ecotwin-panel />
      } @else {
        <button (click)="retry()">Retry</button>
      }
    } @else {
      <p>Loading EcoTwin…</p>
    }`
})
export class EcoTwinWorkspaceEntry {
  readonly capabilities = inject(EcoTwinCapabilities);
  readonly ready = signal(false);
  constructor() {
    void this.capabilities.load().then(() => this.ready.set(true));
  }
  retry(): void {
    this.ready.set(false);
    void this.capabilities.refresh().then(() => this.ready.set(true));
  }
}
@Component({
  selector: 'app-ecotwin-comparison-entry',
  standalone: true,
  imports: [SimulationComparisonPickerComponent],
  template: `@if (available()) {
    <app-simulation-comparison-picker
      [baselineCalculationId]="context.baselineCalculationId"
      [scenarioCalculationId]="context.scenarioCalculationId"
      [implicit]="context.implicit"
      [preparationEnabled]="preparationEnabled()"
      (choiceChange)="choose($event)"
    />
  }`
})
export class EcoTwinComparisonEntry implements OnChanges {
  @Input({ required: true }) context!: ComparisonContext;
  @Input({ required: true }) stateChange!: (state: ComparisonContributionState) => void;
  readonly available = signal(false);
  readonly preparationEnabled = signal(false);
  private choice?: SimulationComparisonChoice;
  private readonly capabilities = inject(EcoTwinCapabilities);
  ngOnChanges(): void {
    if (this.choice) this.choose(this.choice);
    void this.capabilities.load().then((capabilities) => {
      this.preparationEnabled.set(capabilities.execution);
      this.available.set(capabilities.reporting);
    });
  }
  choose(choice: SimulationComparisonChoice): void {
    this.choice = choice;
    const selected = choice.selection;
    const selection =
      choice.enabled &&
      selected &&
      selected.scenarioCalculationId === this.context.scenarioCalculationId &&
      (this.context.implicit ||
        selected.baselineCalculationId === this.context.baselineCalculationId)
        ? selected
        : null;
    const query = Object.fromEntries(new URLSearchParams(comparisonQuery(selection, false)));
    this.stateChange({ valid: !choice.enabled || !!selection, query });
  }
}
@Component({
  selector: 'app-ecotwin-report-entry',
  standalone: true,
  imports: [SimulationReportAppendixComponent, SimulationComparisonReportComponent],
  template: `@if (error()) {
      <section role="alert">
        <h2>EcoTwin unavailable</h2>
        <p>{{ error() }}</p>
        <button (click)="retry()">Retry</button>
      </section>
    }
    @if (available()) {
      @if (context.kind === 'calculation') {
        <app-simulation-report-appendix
          [calculationId]="context.calculationId!"
          [renderState]="renderState"
        />
      } @else if (selection) {
        <app-simulation-comparison-report
          [selection]="selection"
          [implicit]="context.comparison!.implicit"
          [reverse]="context.comparison!.reverse"
          [expectedBaselineId]="context.comparison!.baselineCalculationId"
          [renderState]="renderState"
        />
      }
    }`
})
export class EcoTwinReportEntry implements OnChanges {
  @Input({ required: true }) context!: ReportContext;
  @Input({ required: true }) renderState!: (state: RenderState) => void;
  readonly available = signal(false);
  readonly error = signal('');
  selection: SimulationComparisonSelection | null = null;
  private readonly capabilities = inject(EcoTwinCapabilities);
  private revision = 0;
  ngOnChanges(): void {
    void this.load();
  }
  retry(): void {
    void this.capabilities.refresh().then(() => this.load());
  }
  private async load(): Promise<void> {
    const revision = ++this.revision;
    this.available.set(false);
    this.error.set('');
    const query = this.context.query;
    this.selection =
      this.context.kind === 'comparison' &&
      ['simBase', 'simBaselineRun', 'simScenarioRun'].some((key) => key in query)
        ? {
            baselineCalculationId: Number(query['simBase']),
            scenarioCalculationId: this.context.comparison!.scenarioCalculationId!,
            baselineRunId: query['simBaselineRun'] ?? '',
            scenarioRunId: query['simScenarioRun'] ?? ''
          }
        : null;
    if (this.context.kind === 'comparison' && !this.selection) {
      if (query['extensions']?.split(',').includes('ecotwin')) {
        this.error.set(
          'The report link does not identify both saved simulations. Select them again in Compare calculations.'
        );
        this.renderState('error');
      } else this.renderState('ready');
      return;
    }
    this.renderState('loading');
    const capability = await this.capabilities.load();
    if (revision !== this.revision) return;
    if (capability.reporting) this.available.set(true);
    else {
      this.error.set(this.capabilities.message());
      this.renderState('error');
    }
  }
}
export function ecoTwinExtension(): HostExtension {
  const injector = inject(Injector);
  return {
    id: 'ecotwin',
    workspace: {
      id: 'mareld-poc',
      title: 'EcoTwin',
      icon: 'grid',
      panel: EcoTwinWorkspaceEntry,
      overlay: EcoTwinResultsComponent,
      overlaySidebarControls: true
    },
    attachMap: (lease) => {
      const bridge = injector.get(EcoTwinMapBridge);
      bridge.attach(lease.map, lease.overlayZIndex, lease.padding);
      return () => bridge.detach();
    },
    comparison: EcoTwinComparisonEntry,
    report: EcoTwinReportEntry
  };
}
