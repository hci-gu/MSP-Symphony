import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MareldMapBridge } from './mareld-map.bridge';
import { MareldPanelComponent } from './mareld-panel.component';
import { MareldPocModule } from './mareld-poc.module';
import { MareldSession } from './mareld-session.service';
import { sessionProviders } from './testing/session.fixture';
import { biomassFixture } from './testing/biomass.fixture';
import { calculationFixture } from './testing/calculation.fixture';

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
  it('highlights the opened run and keeps delete/cancel separate from selection', async () => {
    setup.reports.list.and.resolveTo(
      ['first', 'second'].map((runId) => ({
        runId,
        calculationId: 7,
        completedAt: 1234,
        model: { name: 'Test' },
        config: { maxSteps: 4 }
      }))
    );
    setup.persistence.load.and.callFake(async (_id: number, id: string) => ({
      ...biomassFixture(),
      id,
      input: calculationFixture().input
    }));
    fixture = TestBed.createComponent(MareldPanelComponent);
    const session = TestBed.inject(MareldSession);
    await session.selectCalculation(7);
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    const open = () => host.querySelectorAll<HTMLButtonElement>('.open-run');
    open()[1].click();
    await fixture.whenStable();
    expect(open()[1].getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelectorAll('.saved-run.selected').length).toBe(1);
    expect(host.querySelector('.saved-run.selected')?.textContent).toContain('Selected');
    host.querySelector<HTMLButtonElement>('.delete-run')!.click();
    await fixture.whenStable();
    expect(session.selectedRunId()).toBe('second');
    expect(setup.persistence.delete).not.toHaveBeenCalled();
    const buttons = host.querySelectorAll<HTMLButtonElement>('.delete-confirmation button');
    buttons[1].click(); // Cancel.
    await fixture.whenStable();
    expect(host.querySelector('.delete-confirmation')).toBeNull();
    host.querySelector<HTMLButtonElement>('.delete-run')!.click();
    await fixture.whenStable();
    host.querySelector<HTMLButtonElement>('.delete-confirmation .delete-run')!.click();
    await fixture.whenStable();
    expect(setup.persistence.delete).toHaveBeenCalledOnceWith(7, 'first');
    expect(host.querySelectorAll('.saved-run').length).toBe(1);
    expect(session.selectedRunId()).toBe('second');
  });
});
