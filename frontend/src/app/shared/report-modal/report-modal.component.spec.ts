import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CalculationReportModalComponent } from './calculation-report-modal.component';
import { IconButtonComponent } from '../icon-button/icon-button.component';
import { IconComponent } from '../icon/icon.component';
import { DialogRef } from '../dialog/dialog-ref';
import { DialogConfig } from '../dialog/dialog-config';
import { provideHttpClient } from '@angular/common/http';
import { provideMockStore } from '@ngrx/store/testing';
import { initialState as metadata } from '@data/metadata/metadata.reducers';
import { TranslationSetupModule } from '@src/app/app-translation-setup.module';
import { provideZonelessChangeDetection } from "@angular/core";

describe('CalculationReportModalComponent', () => {
  let fixture: ComponentFixture<CalculationReportModalComponent>,
      component: CalculationReportModalComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [CalculationReportModalComponent, IconButtonComponent, IconComponent],
      imports: [TranslationSetupModule],
      providers: [
        provideHttpClient(),
        {
          provide: DialogRef,
          useValue: {}
        },
        {
          provide: DialogConfig,
          useValue: {
            data: {
              id: 1
            }
          }
        },
        provideMockStore({
          initialState: {
            metadata,
            user : {}
          }
        }),
        provideZonelessChangeDetection()
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(CalculationReportModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('only enables printing after this report iframe confirms the report is rendered', () => {
    const frame = component.iframe!.nativeElement.contentWindow;
    const message = (origin = window.origin, source = frame, calcId = 1, state = 'ready') =>
      new MessageEvent('message', { origin, source, data: { type: 'reportState', documentId: calcId === 1 ? component.documentId : 'other', state } });
    expect(component.printReady).toBeFalse();
    component.onReportState(message('https://unrelated.invalid'));
    component.onReportState(message(window.origin, window));
    component.onReportState(message(window.origin, frame, 2));
    expect(component.printReady).toBeFalse();
    component.onReportState(message()); expect(component.printReady).toBeTrue();
    component.onReportState(message(window.origin, frame, 1, 'error'));
    expect(component.printReady).toBeFalse();
  });
});
