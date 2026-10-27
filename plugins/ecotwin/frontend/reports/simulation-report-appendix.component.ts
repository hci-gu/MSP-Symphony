import { SimulationNotifications } from '../notifications';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import { Component, ElementRef, inject, Input, OnChanges, OnDestroy, signal } from '@angular/core';
import { SimulationReportData } from './simulation-report-data.service';
import { reportFigures, ReportFigure } from './simulation-report-figures';
import { BIOMASS_GRADIENT } from '../workspace/ecotwin-result';

@Component({
  selector: 'app-simulation-report-appendix',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './simulation-report-appendix.component.html',
  styleUrls: ['./simulation-report-appendix.component.scss']
})
export class SimulationReportAppendixComponent implements OnChanges, OnDestroy {
  @Input() renderState: (state: 'loading' | 'ready' | 'error') => void = () => undefined;
  @Input({ required: true }) calculationId!: number;
  private readonly data = inject(SimulationReportData);
  private readonly element: ElementRef<HTMLElement> = inject(ElementRef);
  readonly figures = signal<ReportFigure[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly gradient = BIOMASS_GRADIENT;
  private revision = 0;
  private readonly notifications = inject(SimulationNotifications);
  private readonly subscription: Subscription;
  constructor() { this.subscription = this.notifications.changed.subscribe(id => { if (id === null ? !this.loading() : id === this.calculationId) void this.load(); }); }
  ngOnChanges(): void {
    this.figures.set([]);
    void this.load();
  }
  private notify(state: 'loading' | 'ready' | 'error'): void { this.renderState(state); }
  async load(): Promise<void> {
    const revision = ++this.revision,
      id = this.calculationId;
    this.loading.set(true);
    this.error.set('');
    this.figures.set([]);
    this.notify('loading');
    try {
      const summaries = await this.data.list(id);
      const figures: ReportFigure[] = [];
      // Fetch only final frames; report loads never materialize complete time tensors.
      for (const summary of summaries) {
        if (revision !== this.revision) return;
        if (summary.calculationId !== id)
          throw new Error('Saved appendix belongs to another calculation.');
        const detail = await this.data.report(id, summary.runId);
        if (detail.calculationId !== id || detail.runId !== summary.runId)
          throw new Error('Saved appendix identity mismatch.');
        figures.push(reportFigures(detail));
      }
      if (revision !== this.revision) return;
      this.figures.set(figures);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      await Promise.all(
        Array.from(this.element.nativeElement.querySelectorAll('img')).map((img) => img.decode())
      );
      if (revision === this.revision) this.notify('ready');
    } catch (error) {
      if (revision === this.revision) {
        this.error.set(
          error instanceof Error ? error.message : 'Saved simulation data is unavailable.'
        );
        this.notify('error');
      }
    } finally {
      if (revision === this.revision) this.loading.set(false);
    }
  }
  ngOnDestroy(): void {
    this.revision++;
    this.subscription.unsubscribe();
  }
}
