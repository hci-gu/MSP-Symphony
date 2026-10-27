import { EcoTwinBiomassChartComponent } from './ecotwin-biomass-chart.component';
import { EcoTwinImpactOutlinesComponent } from './ecotwin-impact-outlines.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  afterNextRender,
  Component,
  effect,
  ElementRef,
  HostListener,
  inject,
  Injector,
  signal,
  ViewChild
} from '@angular/core';
import { SimulationWorkspace } from './simulation-workspace';
import { EcoTwinMapBridge } from './ecotwin-map.bridge';
import { BIOMASS_GRADIENT } from './ecotwin-result';
import { speciesLabel } from './ecotwin-biomass';
import { stepsToDays } from '../shared/run-config';

@Component({
  selector: 'app-ecotwin-results',
  standalone: true,
  imports: [CommonModule, FormsModule, EcoTwinBiomassChartComponent, EcoTwinImpactOutlinesComponent],
  templateUrl: './ecotwin-results.component.html',
  styleUrls: ['./ecotwin-results.component.scss']
})
export class EcoTwinResultsComponent {
  readonly session = inject(SimulationWorkspace);
  readonly map = inject(EcoTwinMapBridge);
  readonly collapsed = signal(false);
  readonly speciesLabel = speciesLabel;
  readonly stepsToDays = stepsToDays;
  readonly gradient = BIOMASS_GRADIENT;
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  @ViewChild('graphPanel') graph?: ElementRef<HTMLElement>;
  @ViewChild('playbackTray') tray?: ElementRef<HTMLElement>;

  constructor() {
    effect(() => {
      const result = this.session.result();
      this.collapsed();
      if (result) afterNextRender(() => this.fit(), { injector: this.injector });
    });
  }
  @HostListener('window:resize')
  fit(): void {
    const padding = this.map.viewportPadding();
    const right = this.collapsed() ? 32 : (this.graph?.nativeElement.offsetWidth ?? 0) + 32;
    const bottom = (this.tray?.nativeElement.offsetHeight ?? 0) + 50;
    this.map.fit([padding[0], padding[1] + right, padding[2] + bottom, padding[3] + 26]);
  }
}
