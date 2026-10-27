import { ElementRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DialogConfig } from '../dialog/dialog-config';
import { DialogRef } from '../dialog/dialog-ref';
import { ComparisonReportModalComponent } from './comparison-report-modal.component';
import { comparisonToken } from '../../features/simulation-comparison/simulation-comparison';

describe('comparison report printing', () => {
  const selection = {
    baselineCalculationId: 18,
    scenarioCalculationId: 9,
    baselineRunId: 'a',
    scenarioRunId: 'b'
  };
  function modal(simulation: typeof selection | null = selection) {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DialogConfig,
          useValue: { data: { a: null, b: 9, max: 45, reverse: true, simulation } }
        },
        { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } }
      ]
    });
    return TestBed.runInInjectionContext(() => new ComparisonReportModalComponent());
  }
  it('keeps native comparison printing available and correctly prefixes reverse query parameters', () => {
    const component = modal(null);
    expect(component.printReady).toBeTrue();
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
      component.onComparisonState(
        new MessageEvent('message', {
          origin,
          source,
          data: { type: 'simulationComparisonState', token, state: value }
        })
      );
    try {
      expect(component.printReady).toBeFalse();
      state('different pair');
      state(comparisonToken(selection, true), 'https://example.org');
      state(comparisonToken(selection, true), window.origin, window);
      expect(component.printReady).toBeFalse();
      state(comparisonToken(selection, true));
      expect(component.printReady).toBeTrue();
      state(comparisonToken(selection, true), window.origin, iframe.contentWindow, 'error');
      expect(component.printReady).toBeFalse();
    } finally {
      iframe.remove();
    }
  });
});
