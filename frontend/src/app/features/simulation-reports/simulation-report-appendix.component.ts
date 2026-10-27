import { CommonModule } from '@angular/common';
import { Component, ElementRef, inject, Input, OnChanges, OnDestroy, signal } from '@angular/core';
import { SimulationReportData } from './simulation-report-data.service';
import { reportFigures, ReportFigure } from './simulation-report-figures';
import { BIOMASS_GRADIENT } from '../mareld-poc/mareld-result';

@Component({
  selector: 'app-simulation-report-appendix',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './simulation-report-appendix.component.html',
  styleUrls: ['./simulation-report-appendix.component.scss']
})
export class SimulationReportAppendixComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) calculationId!: number;
  private readonly data = inject(SimulationReportData);
  private readonly element: ElementRef<HTMLElement> = inject(ElementRef);
  readonly figures = signal<ReportFigure[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly gradient = BIOMASS_GRADIENT;
  private revision = 0;
  private channel = new BroadcastChannel('symphony-simulation-reports');
  private readonly focus = () => {
    if (!this.loading()) void this.load();
  };
  private readonly saved = (event: Event) => {
    if ((event as CustomEvent<number>).detail === this.calculationId) void this.load();
  };

  constructor() {
    this.channel.onmessage = (event) => {
      if (event.data?.calculationId === this.calculationId) void this.load();
    };
    window.addEventListener('focus', this.focus);
    window.addEventListener('simulation-saved', this.saved);
    window.addEventListener('simulation-deleted', this.saved);
  }
  ngOnChanges(): void {
    this.figures.set([]);
    void this.load();
  }
  private notify(state: 'loading' | 'ready' | 'error'): void {
    document.documentElement.dataset['simulationAppendixState'] = state;
    window.parent.postMessage(
      { type: 'simulationAppendixState', calcId: this.calculationId, state },
      window.origin
    );
  }
  async load(): Promise<void> {
    const revision = ++this.revision,
      id = this.calculationId;
    this.loading.set(true);
    this.error.set('');
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
    this.channel.close();
    window.removeEventListener('focus', this.focus);
    window.removeEventListener('simulation-saved', this.saved);
    window.removeEventListener('simulation-deleted', this.saved);
    delete document.documentElement.dataset['simulationAppendixState'];
  }
}
