import { Component, HostListener, inject, signal } from '@angular/core';
import { ReportModalComponent } from "@shared/report-modal/report-modal.component";
import { DialogConfig } from '../dialog/dialog-config';

@Component({
  selector: 'app-calculation-report-modal',
  templateUrl: './report-modal.component.html',
  styleUrls: ['./report-modal.component.scss'],
  standalone: false
})
export class CalculationReportModalComponent extends ReportModalComponent {
  private readonly calculationId: number;
  private readonly appendixReady = signal(false);
  @HostListener('window:message', ['$event'])
  onAppendixState(event: MessageEvent): void {
    if (event.origin === window.origin && event.source === this.iframe?.nativeElement.contentWindow &&
        event.data?.type === 'simulationAppendixState' && event.data.calcId === this.calculationId)
      this.appendixReady.set(event.data.state === 'ready');
  }
  override get printReady(): boolean {
    return this.appendixReady();
  }

  constructor() {
    const config = inject(DialogConfig);

    super(window.location.origin+'/report/'+ config.data.id,
      `/report/${config.data.id}`,'report.calculation.title');
    this.calculationId = config.data.id;
  }
}
