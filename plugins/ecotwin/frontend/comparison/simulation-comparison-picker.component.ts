import { NAVIGATION } from '../ports';
import { SimulationNotifications } from '../notifications';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SimulationReportData } from '../reports/simulation-report-data.service';
import type { SimulationSummary } from '../contracts';
import { apiError } from '../shared/api-error';
import { comparisonIssues, SimulationComparisonChoice, suggestPair } from './simulation-comparison';

@Component({
  selector: 'app-simulation-comparison-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './simulation-comparison-picker.component.html',
  styleUrls: ['./simulation-comparison-picker.component.scss']
})
export class SimulationComparisonPickerComponent implements OnChanges, OnDestroy {
  @Input() baselineCalculationId: number | null = null;
  @Input() scenarioCalculationId: number | null = null;
  @Input() implicit = true;
  @Input() preparationEnabled = true;
  @Output() choiceChange = new EventEmitter<SimulationComparisonChoice>();
  private readonly navigation = inject(NAVIGATION);
  private readonly data = inject(SimulationReportData);
  readonly enabled = signal(false);
  readonly loading = signal(false);
  readonly creating = signal(false);
  readonly error = signal('');
  readonly baselineId = signal<number | null>(null);
  readonly baselineRuns = signal<SimulationSummary[]>([]);
  readonly scenarioRuns = signal<SimulationSummary[]>([]);
  readonly baselineRunId = signal('');
  readonly scenarioRunId = signal('');
  readonly baselineRun = computed(() =>
    this.baselineRuns().find((run) => run.runId === this.baselineRunId())
  );
  readonly scenarioRun = computed(() =>
    this.scenarioRuns().find((run) => run.runId === this.scenarioRunId())
  );
  readonly issues = computed(() => {
    const a = this.baselineRun(),
      b = this.scenarioRun();
    return a && b ? comparisonIssues(a, b) : [];
  });
  private revision = 0;
  private readonly notifications = inject(SimulationNotifications);
  private readonly subscription: Subscription;
  constructor() {
    this.subscription = this.notifications.changed.subscribe((id) => {
      if (id === null) {
        if (this.enabled() && !this.loading() && !this.creating()) void this.load();
      } else this.refreshFor(id);
    });
  }
  ngOnChanges(): void {
    this.revision++;
    this.baselineRunId.set('');
    this.scenarioRunId.set('');
    this.baselineId.set(null);
    this.baselineRuns.set([]);
    this.scenarioRuns.set([]);
    this.publish();
    if (this.enabled()) void this.load();
  }
  setEnabled(enabled: boolean): void {
    this.enabled.set(enabled);
    this.revision++;
    this.loading.set(false);
    this.publish();
    if (enabled) void this.load();
  }
  choose(side: 'baseline' | 'scenario', id: string): void {
    (side === 'baseline' ? this.baselineRunId : this.scenarioRunId).set(id);
    this.publish();
  }
  private refreshFor(id: number): void {
    if (this.enabled() && (id === this.baselineId() || id === this.scenarioCalculationId))
      void this.load();
  }
  async load(): Promise<void> {
    const revision = ++this.revision,
      scenarioId = this.scenarioCalculationId;
    this.loading.set(true);
    this.error.set('');
    this.publish();
    try {
      if (!scenarioId || (!this.implicit && !this.baselineCalculationId)) return;
      const [link, scenarios] = await Promise.all([
        this.implicit ? this.data.baseline(scenarioId) : Promise.resolve(null),
        this.data.list(scenarioId)
      ]);
      const baselineId = this.implicit
        ? (link?.baselineCalculationId ?? null)
        : this.baselineCalculationId;
      const baselines = baselineId ? await this.data.list(baselineId) : [];
      if (revision !== this.revision) return;
      this.baselineId.set(baselineId);
      const newest = (runs: SimulationSummary[]) =>
        [...runs].sort((a, b) => b.completedAt - a.completedAt);
      this.baselineRuns.set(newest(baselines));
      this.scenarioRuns.set(newest(scenarios));
      // Only suggest on the first selection. A refresh/deletion never replaces a pinned run.
      if (!this.baselineRunId() && !this.scenarioRunId()) {
        const pair = suggestPair(baselines, scenarios);
        this.baselineRunId.set(pair?.[0].runId ?? this.baselineRuns()[0]?.runId ?? '');
        this.scenarioRunId.set(pair?.[1].runId ?? this.scenarioRuns()[0]?.runId ?? '');
      } else if (!this.baselineRunId() && this.scenarioRun()) {
        const pair = suggestPair(baselines, [this.scenarioRun()!]);
        if (pair) this.baselineRunId.set(pair[0].runId);
      } else if (!this.scenarioRunId() && this.baselineRun()) {
        const pair = suggestPair([this.baselineRun()!], scenarios);
        if (pair) this.scenarioRunId.set(pair[1].runId);
      }
    } catch (error) {
      if (revision === this.revision) this.error.set(apiError(error));
    } finally {
      if (revision === this.revision) {
        this.loading.set(false);
        this.publish();
      }
    }
  }
  async createBaseline(): Promise<void> {
    const id = this.scenarioCalculationId;
    if (!this.preparationEnabled || !id || this.creating()) return;
    this.creating.set(true);
    this.error.set('');
    try {
      await this.data.createBaseline(id);
      if (id === this.scenarioCalculationId && this.enabled()) await this.load();
    } catch (error) {
      if (id === this.scenarioCalculationId) this.error.set(apiError(error));
    } finally {
      this.creating.set(false);
      this.publish();
    }
  }
  preparation(side: 'baseline' | 'scenario'): string {
    const id = side === 'baseline' ? this.baselineId() : this.scenarioCalculationId;
    return this.preparationEnabled && id
      ? this.navigation.prepare(id, side === 'baseline' ? this.scenarioRun() : this.baselineRun())
      : '';
  }
  private publish(): void {
    const a = this.baselineRun(),
      b = this.scenarioRun();
    this.choiceChange.emit({
      enabled: this.enabled(),
      selection:
        this.enabled() &&
        !this.loading() &&
        !this.creating() &&
        !this.error() &&
        a &&
        b &&
        !this.issues().length
          ? {
              baselineCalculationId: a.calculationId,
              scenarioCalculationId: b.calculationId,
              baselineRunId: a.runId,
              scenarioRunId: b.runId
            }
          : null
    });
  }
  ngOnDestroy(): void {
    this.revision++;
    this.subscription.unsubscribe();
  }
}
