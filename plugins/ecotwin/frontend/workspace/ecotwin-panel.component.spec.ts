import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EcoTwinMapBridge } from './ecotwin-map.bridge';
import { EcoTwinPanelComponent } from './ecotwin-panel.component';
import { EcoTwinWorkspaceModule } from './workspace.module';
import { SimulationWorkspace } from './simulation-workspace';
import { sessionProviders } from './testing/session.fixture';
import { biomassFixture } from './testing/biomass.fixture';
import { calculationFixture } from './testing/calculation.fixture';

describe('EcoTwin calculation picker', () => {
  let fixture: ComponentFixture<EcoTwinPanelComponent>, setup: ReturnType<typeof sessionProviders>;
  const map = { fit: jasmine.createSpy('fit'), setActive: jasmine.createSpy('setActive') };
  beforeEach(() => {
    setup = sessionProviders();
    TestBed.configureTestingModule({
      imports: [EcoTwinWorkspaceModule],
      providers: [
        ...setup.providers,
        provideZonelessChangeDetection(),
        { provide: EcoTwinMapBridge, useValue: map }
      ]
    });
  });
  it('requires a completed calculation and has no area capture or independent pressure controls', async () => {
    fixture = TestBed.createComponent(EcoTwinPanelComponent);
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    expect(setup.api.models).toHaveBeenCalledTimes(1);
    expect(setup.adapter.refresh).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain('Use selected area');
    expect(host.textContent).not.toContain('Try example area');
    expect(host.querySelector('app-ecotwin-impact-controls')).toBeNull();
    expect((host.querySelector('.primary') as HTMLButtonElement).disabled).toBeTrue();
    await TestBed.inject(SimulationWorkspace).selectCalculation(7);
    await fixture.whenStable();
    expect((host.querySelector('.primary') as HTMLButtonElement).disabled).toBeFalse();
    fixture.destroy();
    expect(map.setActive).toHaveBeenCalledWith(false);
  });
  it('keeps discovery errors local and allows a manual retry', async () => {
    setup.api.models.and.rejectWith(new Error('Server unavailable'));
    fixture = TestBed.createComponent(EcoTwinPanelComponent);
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('Server unavailable');
    expect(setup.api.models).toHaveBeenCalledTimes(1);
    setup.api.models.and.resolveTo([{ id: 'test', name: 'Test', species: ['codfish'] }]);
    (
      host.querySelector('[aria-labelledby="ecotwin-model-heading"] button') as HTMLButtonElement
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
    fixture = TestBed.createComponent(EcoTwinPanelComponent);
    const session = TestBed.inject(SimulationWorkspace);
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
