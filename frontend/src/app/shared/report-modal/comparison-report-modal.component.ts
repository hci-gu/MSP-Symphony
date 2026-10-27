import { Component, inject } from '@angular/core';
import { DialogConfig } from '../dialog/dialog-config';
import { ReportModalComponent } from './report-modal.component';
@Component({ selector: 'app-comparison-report-modal', templateUrl: './report-modal.component.html', styleUrls: ['./report-modal.component.scss'], standalone: false })
export class ComparisonReportModalComponent extends ReportModalComponent {
  constructor() {
    const config = inject(DialogConfig);
    const path = config.data.a === null ? `${config.data.b}` : `${config.data.a}/${config.data.b}`;
    const query = new URLSearchParams(config.data.extensions ?? {});
    if (config.data.a === null && config.data.reverse) query.set('reverse', 'true');
    super(window.location.origin + `/report/compare/${path}/${config.data.max}`, `/report/comparison/${path}`,
      'report.comparison.title', query.size ? `?${query}` : '');
  }
}
