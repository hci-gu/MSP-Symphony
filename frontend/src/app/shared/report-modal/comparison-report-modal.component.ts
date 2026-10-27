import { Component, HostListener, inject, signal } from '@angular/core';
import { DialogConfig } from '../dialog/dialog-config';
import { ReportModalComponent } from '@shared/report-modal/report-modal.component';
import {
  comparisonQuery,
  comparisonToken,
  SimulationComparisonSelection
} from '../../features/simulation-comparison/simulation-comparison';

@Component({
  selector: 'app-comparison-report-modal',
  templateUrl: './report-modal.component.html',
  styleUrls: ['./report-modal.component.scss'],
  standalone: false
})
export class ComparisonReportModalComponent extends ReportModalComponent {
  private readonly token: string | null;
  private readonly comparisonReady = signal(false);
  @HostListener('window:message', ['$event'])
  onComparisonState(event: MessageEvent): void {
    if (
      event.origin === window.origin &&
      event.source === this.iframe?.nativeElement.contentWindow &&
      event.data?.type === 'simulationComparisonState' &&
      event.data.token === this.token
    )
      this.comparisonReady.set(event.data.state === 'ready');
  }
  override get printReady(): boolean {
    return !this.token || this.comparisonReady();
  }

  constructor() {
    const config = inject(DialogConfig);
    const simulation: SimulationComparisonSelection | null = config.data.simulation ?? null;
    const reverse = config.data.a === null && !!config.data.reverse;

    const locationPS =
      config.data.a === null ? `${config.data.b}` : `${config.data.a}/${config.data.b}`;

    super(
      window.location.origin + `/report/compare/${locationPS}/${config.data.max}`,
      `/report/comparison/${locationPS}`,
      'report.comparison.title',
      comparisonQuery(simulation, reverse)
    );
    this.token = simulation ? comparisonToken(simulation, reverse) : null;
  }
}
