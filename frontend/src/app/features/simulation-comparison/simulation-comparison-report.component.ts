import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, OnDestroy, inject, signal } from '@angular/core';
import {
  SimulationReportData,
  SimulationSummary
} from '../simulation-reports/simulation-report-data.service';
import {
  comparisonFigures,
  comparisonToken,
  SimulationComparisonSelection
} from './simulation-comparison';
import { apiError } from '../mareld-poc/mareld-api.client';

@Component({
  selector: 'app-simulation-comparison-report',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './simulation-comparison-report.component.html',
  styleUrls: ['./simulation-comparison-report.component.scss']
})
export class SimulationComparisonReportComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) selection!: SimulationComparisonSelection;
  @Input() implicit = false;
  @Input() reverse = false;
  @Input() expectedBaselineId: number | null = null;
  private readonly data = inject(SimulationReportData);
  readonly runs = signal<SimulationSummary[]>([]);
  readonly rows = signal<ReturnType<typeof comparisonFigures>>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly assumptions = signal<string[]>([]);
  private revision = 0;
  private readonly channel = new BroadcastChannel('symphony-simulation-reports');
  private readonly focus = () => {
    if (!this.loading()) void this.load();
  };
  private readonly changed = (event: Event) =>
    this.refreshFor((event as CustomEvent<number>).detail);
  constructor() {
    this.channel.onmessage = (event) => this.refreshFor(event.data?.calculationId);
    window.addEventListener('focus', this.focus);
    window.addEventListener('simulation-saved', this.changed);
    window.addEventListener('simulation-deleted', this.changed);
  }
  ngOnChanges(): void {
    void this.load();
  }
  private refreshFor(id: number): void {
    if (
      this.selection &&
      [this.selection.baselineCalculationId, this.selection.scenarioCalculationId].includes(id)
    )
      void this.load();
  }
  private notify(state: 'loading' | 'ready' | 'error'): void {
    document.documentElement.dataset['simulationComparisonState'] = state;
    window.parent.postMessage(
      {
        type: 'simulationComparisonState',
        token: comparisonToken(this.selection, this.reverse),
        state
      },
      window.origin
    );
  }
  async load(): Promise<void> {
    const revision = ++this.revision,
      selected = this.selection;
    this.loading.set(true);
    this.error.set('');
    this.rows.set([]);
    this.runs.set([]);
    this.notify('loading');
    try {
      if (
        ![selected.baselineCalculationId, selected.scenarioCalculationId].every(
          (id) => Number.isInteger(id) && id > 0
        ) ||
        !selected.baselineRunId ||
        !selected.scenarioRunId
      )
        throw new Error(
          'The report link does not identify both saved simulations. Select them again in Compare calculations.'
        );
      if (this.implicit) {
        const link = await this.data.baseline(selected.scenarioCalculationId);
        if (link?.baselineCalculationId !== selected.baselineCalculationId)
          throw new Error(
            'The saved automatic-baseline counterpart is no longer available for this scenario.'
          );
      } else if (selected.baselineCalculationId !== this.expectedBaselineId) {
        throw new Error('The selected baseline simulation does not belong to this comparison.');
      }
      const [baselines, scenarios] = await Promise.all([
        this.data.list(selected.baselineCalculationId),
        this.data.list(selected.scenarioCalculationId)
      ]);
      const a = baselines.find(
        (run) =>
          run.runId === selected.baselineRunId &&
          run.calculationId === selected.baselineCalculationId
      );
      const b = scenarios.find(
        (run) =>
          run.runId === selected.scenarioRunId &&
          run.calculationId === selected.scenarioCalculationId
      );
      if (!a || !b)
        throw new Error(
          'A selected simulation has been deleted or is unavailable. Select another pair in Compare calculations.'
        );
      const rows = comparisonFigures(a, b);
      if (revision !== this.revision) return;
      this.runs.set(this.reverse ? [b, a] : [a, b]);
      this.rows.set(
        this.reverse ? rows.map((row) => ({ ...row, curves: [...row.curves].reverse() })) : rows
      );
      this.assumptions.set([...new Set([...a.assumptions, ...b.assumptions])]);
      this.loading.set(false);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      if (revision === this.revision) this.notify('ready');
    } catch (error) {
      if (revision === this.revision) {
        this.error.set(apiError(error));
        this.notify('error');
      }
    } finally {
      if (revision === this.revision) this.loading.set(false);
    }
  }
  ngOnDestroy(): void {
    this.revision++;
    this.channel.close();
    window.removeEventListener('focus', this.focus);
    window.removeEventListener('simulation-saved', this.changed);
    window.removeEventListener('simulation-deleted', this.changed);
    delete document.documentElement.dataset['simulationComparisonState'];
  }
}
