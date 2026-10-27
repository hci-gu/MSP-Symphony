import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { stepsToDays } from '../shared/run-config';
import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  ViewChild
} from '@angular/core';
import { EcoTwinResult } from './ecotwin-result';
import {
  aggregateBiomass,
  BiomassDisplay,
  biomassLines,
  ensembleLines,
  nearestBiomassFrame
} from './ecotwin-biomass';

@Component({
  selector: 'app-ecotwin-biomass-chart',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ecotwin-biomass-chart.component.html',
  styleUrls: ['./ecotwin-biomass-chart.component.scss']
})
export class EcoTwinBiomassChartComponent {
  readonly stepsToDays = stepsToDays;
  readonly result = input.required<EcoTwinResult>();
  readonly frame = input(0);
  readonly panelCompact = input(false);
  readonly frameChange = output<number>();
  readonly display = signal<BiomassDisplay>('absolute');
  readonly hidden = signal<string[]>([]);
  readonly showTotal = signal(true);
  readonly hoverFrame = signal<number | null>(null);
  readonly expanded = signal(false);
  readonly totals = computed(() => aggregateBiomass(this.result()));
  readonly lines = computed(() =>
    this.result().ensemble
      ? ensembleLines(this.result(), this.hidden(), this.display(), this.showTotal())
      : biomassLines(this.totals(), this.hidden(), this.display(), this.showTotal())
  );
  readonly currentFrame = computed(() =>
    Math.max(0, Math.min(this.result().steps.length - 1, Math.floor(this.frame())))
  );
  readonly activeFrame = computed(() => this.hoverFrame() ?? this.currentFrame());
  readonly activeStep = computed(() => this.result().steps[this.activeFrame()]);
  readonly unit = computed(() =>
    this.display() === 'relative' ? '% of initial biomass' : 'Biomass (tonnes)'
  );
  readonly noInitialBiomass = computed(() => this.lines().some((line) => line.values[0] === null));
  readonly layout = computed(() => {
    const width = this.expanded() ? 900 : 360;
    const height = this.expanded() ? 350 : this.panelCompact() ? 220 : 260;
    return { width, height, left: 48, top: 16, innerWidth: width - 62, innerHeight: height - 60 };
  });
  readonly yMax = computed(() => {
    let max = 0;
    for (const line of this.lines()) {
      for (const value of line.high ?? line.values) max = Math.max(max, value ?? 0);
    }
    return max > 0 ? max * 1.08 : 1;
  });
  readonly yMin = computed(() =>
    Math.min(
      0,
      ...this.lines()
        .flatMap((line) => line.low ?? [])
        .map((value) => value ?? 0)
    )
  );
  readonly xTicks = computed(() => {
    const steps = this.result().steps;
    return Array.from(
      { length: 5 },
      (_, i) => steps[0] + ((steps[steps.length - 1] - steps[0]) * i) / 4
    );
  });
  readonly yTicks = computed(() =>
    Array.from({ length: 5 }, (_, i) => this.yMin() + ((this.yMax() - this.yMin()) * i) / 4)
  );
  readonly paths = computed(() =>
    this.lines().map((line) => ({
      ...line,
      path: this.path(line.values),
      band: this.band(line.low, line.high)
    }))
  );
  readonly tooltipX = computed(() => {
    const x = this.xFor(this.activeStep());
    return Math.max(2, Math.min(this.layout().width - 216, x + 10));
  });

  @ViewChild('expandedDialog', { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  @ViewChild('expandButton') expandButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('closeButton') closeButton?: ElementRef<HTMLButtonElement>;
  private readonly injector = inject(Injector);

  constructor() {
    effect(() => {
      this.result();
      this.hidden.set([]);
      this.hoverFrame.set(null);
    });
  }

  toggleSpecies(id: string): void {
    this.hidden.update((ids) =>
      ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]
    );
  }

  xFor(step: number): number {
    const steps = this.result().steps;
    const { left, innerWidth } = this.layout();
    return left + ((step - steps[0]) / (steps[steps.length - 1] - steps[0] || 1)) * innerWidth;
  }

  yFor(value: number): number {
    const { top, innerHeight } = this.layout();
    return top + (1 - (value - this.yMin()) / (this.yMax() - this.yMin())) * innerHeight;
  }

  path(values: (number | null)[]): string {
    let path = '';
    let connected = false;
    values.forEach((value, index) => {
      if (value === null) {
        connected = false;
        return;
      }
      path += `${connected ? 'L' : 'M'}${this.xFor(this.result().steps[index])},${this.yFor(value)} `;
      connected = true;
    });
    return path;
  }

  band(low?: (number | null)[], high?: (number | null)[]): string {
    if (
      !low ||
      !high ||
      low.some((value) => value === null) ||
      high.some((value) => value === null)
    )
      return '';
    const upper = high.map(
      (value, i) => `${i ? 'L' : 'M'}${this.xFor(this.result().steps[i])},${this.yFor(value!)}`
    );
    const lower = low
      .map((value, i) => `L${this.xFor(this.result().steps[i])},${this.yFor(value!)}`)
      .reverse();
    return [...upper, ...lower, 'Z'].join(' ');
  }

  compact(value: number): string {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
  }

  hover(event: PointerEvent): void {
    this.hoverFrame.set(this.frameAtPointer(event));
  }

  selectFrame(event: MouseEvent): void {
    this.frameChange.emit(this.frameAtPointer(event));
  }

  private frameAtPointer(event: MouseEvent): number {
    const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    const { width, left, innerWidth } = this.layout();
    const fraction = Math.max(
      0,
      Math.min(1, (((event.clientX - rect.left) / rect.width) * width - left) / innerWidth)
    );
    const steps = this.result().steps;
    return nearestBiomassFrame(steps, steps[0] + fraction * (steps[steps.length - 1] - steps[0]));
  }

  keydown(event: KeyboardEvent): void {
    const last = this.result().steps.length - 1;
    const frames: Record<string, number> = {
      ArrowLeft: this.currentFrame() - 1,
      ArrowDown: this.currentFrame() - 1,
      ArrowRight: this.currentFrame() + 1,
      ArrowUp: this.currentFrame() + 1,
      Home: 0,
      End: last
    };
    if (!(event.key in frames)) return;
    event.preventDefault();
    this.hoverFrame.set(null);
    this.frameChange.emit(Math.max(0, Math.min(last, frames[event.key])));
  }

  openExpanded(): void {
    this.expanded.set(true);
    this.dialog.nativeElement.showModal();
    afterNextRender(() => this.closeButton?.nativeElement.focus(), { injector: this.injector });
  }

  closeExpanded(): void {
    this.dialog.nativeElement.close();
  }

  onDialogClose(): void {
    this.expanded.set(false);
    this.hoverFrame.set(null);
    afterNextRender(() => this.expandButton?.nativeElement.focus(), { injector: this.injector });
  }
}
