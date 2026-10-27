import { ElementRef, ViewChild, Directive, OnDestroy, inject, HostListener, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { DialogRef } from '../dialog/dialog-ref';
import { environment as env } from "@src/environments/environment";
import * as d3 from "d3";

@Directive({ standalone: false })
export abstract class ReportModalComponent implements OnDestroy {
  safeUrl: SafeResourceUrl;
  apiUrl: string;
  titleKey: string;
  param_annex: string;
  @ViewChild('frame') iframe?: ElementRef<HTMLIFrameElement>;

  private readonly dialog = inject(DialogRef);
  private readonly dom = inject(DomSanitizer);
  private readonly url: string;
  readonly documentId = crypto.randomUUID();
  private readonly rendered = signal(false);
  @HostListener('window:message', ['$event'])
  onReportState(event: MessageEvent): void {
    if (event.origin === window.origin && event.source === this.iframe?.nativeElement.contentWindow &&
        event.data?.type === 'reportState' && event.data.documentId === this.documentId)
      this.rendered.set(event.data.state === 'ready');
  }
  private reportUrl(): string {
    const target = new URL(this.url + this.param_annex);
    target.searchParams.set('reportDocument', this.documentId);
    return target.toString();
  }
  private exportQuery(): string {
    const query = new URLSearchParams(this.param_annex);
    return query.has('reverse') ? `?reverse=${encodeURIComponent(query.get('reverse')!)}` : '';
  }

  protected constructor(url: string,
                        pfx: string,
                        titleKey: string,
                        annex?: string) {
    this.url = url;
    this.param_annex = annex || '';
    this.safeUrl = this.dom.bypassSecurityTrustResourceUrl(this.reportUrl());
    this.apiUrl = env.apiBaseUrl + pfx;
    this.titleKey = titleKey;
  }

  ngOnDestroy(): void {
    // clean up d3 chart object refs that will otherwise linger in the DOM
    d3.select('app-pressure-chart svg').selectAll('*').remove();
  }

  getSafeUrl() {
    return this.safeUrl;
  }

  close = () => {
    this.dialog.close();
  };

  async print() {
    const frame = this.iframe?.nativeElement.contentWindow;
    if (!frame || !this.printReady) return;
    await frame.document.fonts.ready;
    await Promise.all(Array.from(frame.document.images).map(img => img.decode().catch(() => undefined)));
    if (this.printReady) frame.print();
  }

  get printReady(): boolean { return this.rendered(); }

  open() {
    window.open(this.reportUrl(), '_blank');
  }

  downloadGeotiff() {
    document.location.href = `${this.apiUrl}/geotiff${this.exportQuery()}`;
  }

  downloadCSV() {
    document.location.href = `${this.apiUrl}/csv${this.exportQuery()}`;
  }
}
