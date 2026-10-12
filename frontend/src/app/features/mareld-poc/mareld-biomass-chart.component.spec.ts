import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MareldBiomassChartComponent } from './mareld-biomass-chart.component';
import { biomassFixture } from './testing/biomass.fixture';

describe('MARELD population chart interaction', () => {
  let fixture: ComponentFixture<MareldBiomassChartComponent>;
  let chart: MareldBiomassChartComponent;
  let host: HTMLElement;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [MareldBiomassChartComponent]
    });
    fixture = TestBed.createComponent(MareldBiomassChartComponent);
    chart = fixture.componentInstance;
    host = fixture.nativeElement;
    fixture.componentRef.setInput('result', biomassFixture());
    fixture.componentRef.setInput('frame', 1);
    chart.frameChange.subscribe((frame) => fixture.componentRef.setInput('frame', frame));
    fixture.detectChanges();
  });

  it('renders a total and both species, with a marker synchronized to the map frame', () => {
    const totals = chart.totals();
    expect(host.querySelectorAll('.species-line').length).toBe(3);
    const marker = host.querySelector('.current-marker')!;
    expect(Number(marker.getAttribute('x1'))).toBeCloseTo(chart.xFor(100));
    fixture.componentRef.setInput('frame', 2);
    fixture.detectChanges();
    expect(Number(marker.getAttribute('x1'))).toBeCloseTo(chart.xFor(125));
    expect(chart.totals()).toBe(totals);
  });

  it('supports graph selection with a pointer and the keyboard', () => {
    const svg = host.querySelector('svg')!;
    spyOn(svg, 'getBoundingClientRect').and.returnValue({ left: 100, width: 360 } as DOMRect);
    const clientX = 100 + chart.layout().left + chart.layout().innerWidth * 0.64;
    svg.dispatchEvent(new PointerEvent('pointermove', { clientX }));
    fixture.detectChanges();
    expect(chart.activeStep()).toBe(100);
    expect(host.querySelector('.chart-tooltip')).not.toBeNull();
    svg.dispatchEvent(new MouseEvent('click', { clientX }));
    fixture.detectChanges();
    expect(chart.currentFrame()).toBe(1);
    svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    fixture.detectChanges();
    expect(chart.currentFrame()).toBe(2);
    expect(chart.hoverFrame()).toBeNull();
    svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    fixture.detectChanges();
    expect(chart.currentFrame()).toBe(0);
  });

  it('handles deselection, a zero series, and a replacement result without invalid SVG paths', () => {
    (host.querySelector('[aria-label="Toggle Codfish"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(chart.lines()[0].values).toEqual([140, 70, 0]);
    (host.querySelector('[aria-label="Toggle Pelagic fish"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.querySelector('.empty-chart')).not.toBeNull();
    const zero = biomassFixture();
    zero.values.fill(0);
    fixture.componentRef.setInput('result', zero);
    fixture.detectChanges();
    expect(chart.hidden()).toEqual([]);
    expect(chart.yMax()).toBe(1);
    expect(chart.paths().every((line) => !/NaN|Infinity/.test(line.path))).toBeTrue();
    chart.display.set('relative');
    fixture.detectChanges();
    expect(chart.noInitialBiomass()).toBeTrue();
    expect(chart.paths().every((line) => line.path === '')).toBeTrue();
  });

  it('enlarges the same graph and retains its series selection when closing', async () => {
    (host.querySelector('[aria-label="Toggle Codfish"]') as HTMLButtonElement).click();
    (host.querySelector('[aria-label="Expand population graph"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const dialog = host.querySelector('dialog')!;
    expect(dialog.open).toBeTrue();
    expect(host.querySelectorAll('svg').length).toBe(1);
    const closed = new Promise<void>((resolve) =>
      dialog.addEventListener('close', () => resolve(), { once: true })
    );
    (host.querySelector('[aria-label="Close expanded graph"]') as HTMLButtonElement).click();
    await closed;
    fixture.detectChanges();
    expect(chart.expanded()).toBeFalse();
    expect(chart.hidden()).toEqual(['codfish']);
    expect(host.querySelector('.chart-card svg')).not.toBeNull();
  });
});
