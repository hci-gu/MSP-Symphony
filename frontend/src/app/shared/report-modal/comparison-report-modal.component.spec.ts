import { ElementRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DialogConfig } from '../dialog/dialog-config';
import { DialogRef } from '../dialog/dialog-ref';
import { ComparisonReportModalComponent } from './comparison-report-modal.component';

describe('comparison report printing', () => {
  function modal(extensions: Record<string, string> | null = { extensions: "fixture", fixture: "chosen" }) {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DialogConfig,
          useValue: { data: { a: null, b: 9, max: 45, reverse: true, extensions } }
        },
        { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } }
      ]
    });
    return TestBed.runInInjectionContext(() => new ComparisonReportModalComponent());
  }
  it('keeps native comparison printing available and correctly prefixes reverse query parameters', () => {
    const component = modal(null);
    expect(component.printReady).toBeFalse();
    expect(component.param_annex).toBe('?reverse=true');
  });
  it('requires readiness from this iframe and this exact pinned pair, and invalidates it on errors', () => {
    const component = modal();
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    component.iframe = new ElementRef(iframe);
    const state = (
      token: string,
      origin = window.origin,
      source = iframe.contentWindow,
      value = 'ready'
    ) =>
      component.onReportState(
        new MessageEvent('message', {
          origin,
          source,
          data: { type: 'reportState', documentId: token, state: value }
        })
      );
    try {
      expect(component.printReady).toBeFalse();
      state('different pair');
      state(component.documentId, 'https://example.org');
      state(component.documentId, window.origin, window);
      expect(component.printReady).toBeFalse();
      state(component.documentId);
      expect(component.printReady).toBeTrue();
      state(component.documentId, window.origin, iframe.contentWindow, 'error');
      expect(component.printReady).toBeFalse();
    } finally {
      iframe.remove();
    }
  });
});
