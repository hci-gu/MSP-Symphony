import { provideHttpClient } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MareldApiClient } from './mareld-api.client';
import { MareldMapBridge } from './mareld-map.bridge';
import { MareldPanelComponent } from './mareld-panel.component';
import { MareldPocModule } from './mareld-poc.module';
import { MareldModel } from './mareld-result';
import { MareldSession } from './mareld-session.service';
import { SymphonySelectionAdapter } from './symphony-selection.adapter';

describe('MARELD automatic model selection', () => {
  let fixture: ComponentFixture<MareldPanelComponent>;
  let api: jasmine.SpyObj<MareldApiClient>;
  const models: MareldModel[] = [{ id: 'test', name: 'Test', species: ['codfish'] }];

  beforeEach(() => {
    api = jasmine.createSpyObj('API', ['models', 'run']);
    TestBed.configureTestingModule({
      imports: [MareldPocModule],
      providers: [
        provideHttpClient(),
        provideZonelessChangeDetection(),
        { provide: MareldApiClient, useValue: api },
        { provide: MareldMapBridge, useValue: { fit: () => undefined } },
        { provide: SymphonySelectionAdapter, useValue: {} }
      ]
    });
    fixture = TestBed.createComponent(MareldPanelComponent);
  });

  it('loads models automatically and enables simulation after area selection and discovery', async () => {
    let resolve!: (models: MareldModel[]) => void;
    api.models.and.returnValue(new Promise((r) => (resolve = r)));
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    expect(api.models).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain('Connect to API');
    expect(Array.from(host.querySelectorAll('h3')).map((el) => el.textContent?.trim())).toEqual([
      '1 Area',
      '2 Select model',
      '3 Demo impacts',
      '4 Simulation'
    ]);
    const button = host.querySelector('.primary') as HTMLButtonElement;
    expect(button.disabled).toBeTrue();
    TestBed.inject(MareldSession).useExample();
    fixture.detectChanges();
    expect(button.disabled).toBeTrue();
    resolve(models);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(button.disabled).toBeFalse();
    expect((host.querySelector('#mareld-model') as HTMLSelectElement).value).toBe('test');
    expect(api.models).toHaveBeenCalledTimes(1);
  });

  it('shows discovery errors without repeatedly retrying and recovers with Retry', async () => {
    api.models.and.rejectWith(new Error('Server unavailable'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Server unavailable');
    expect(api.models).toHaveBeenCalledTimes(1);
    api.models.and.resolveTo(models);
    (
      host.querySelector('[aria-labelledby="mareld-model-heading"] button') as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect((host.querySelector('#mareld-model') as HTMLSelectElement).disabled).toBeFalse();
    expect((host.querySelector('#mareld-model') as HTMLSelectElement).value).toBe('test');
    expect(api.models).toHaveBeenCalledTimes(2);
  });
});
