import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MareldMapBridge } from './mareld-map.bridge';
import { MareldPanelComponent } from './mareld-panel.component';
import { MareldPocModule } from './mareld-poc.module';
import { MareldSession } from './mareld-session.service';
import { sessionProviders } from './testing/session.fixture';

describe('EcoTwin calculation picker', () => {
  let fixture: ComponentFixture<MareldPanelComponent>, setup: ReturnType<typeof sessionProviders>;
  const map = { fit: jasmine.createSpy('fit'), setActive: jasmine.createSpy('setActive') };
  beforeEach(() => {
    setup = sessionProviders();
    TestBed.configureTestingModule({
      imports: [MareldPocModule],
      providers: [
        ...setup.providers,
        provideZonelessChangeDetection(),
        { provide: MareldMapBridge, useValue: map }
      ]
    });
  });
  it('requires a completed calculation and has no area capture or independent pressure controls', async () => {
    fixture = TestBed.createComponent(MareldPanelComponent);
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    expect(setup.api.models).toHaveBeenCalledTimes(1);
    expect(setup.adapter.refresh).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain('Use selected area');
    expect(host.textContent).not.toContain('Try example area');
    expect(host.querySelector('app-mareld-impact-controls')).toBeNull();
    expect((host.querySelector('.primary') as HTMLButtonElement).disabled).toBeTrue();
    await TestBed.inject(MareldSession).selectCalculation(7);
    await fixture.whenStable();
    expect((host.querySelector('.primary') as HTMLButtonElement).disabled).toBeFalse();
    fixture.destroy();
    expect(map.setActive).toHaveBeenCalledWith(false);
  });
  it('keeps discovery errors local and allows a manual retry', async () => {
    setup.api.models.and.rejectWith(new Error('Server unavailable'));
    fixture = TestBed.createComponent(MareldPanelComponent);
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('Server unavailable');
    expect(setup.api.models).toHaveBeenCalledTimes(1);
    setup.api.models.and.resolveTo([{ id: 'test', name: 'Test', species: ['codfish'] }]);
    (
      host.querySelector('[aria-labelledby="mareld-model-heading"] button') as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(host.textContent).not.toContain('Server unavailable');
    expect(setup.api.models).toHaveBeenCalledTimes(2);
  });
});
