import { stepsToDays } from '../mareld-shared/run-config';
import { Component, computed, DestroyRef, inject } from '@angular/core';
import { environment } from '@src/environments/environment';
import { rasterCanvas } from './mareld-input';
import { BIOMASS_GRADIENT, MAX_STEPS, sampleEvery } from './mareld-result';
import { MareldSession } from './mareld-session.service';
import { MareldMapBridge } from './mareld-map.bridge';
import { speciesLabel } from './mareld-biomass';

@Component({
  selector: 'app-mareld-panel',
  standalone: false,
  templateUrl: './mareld-panel.component.html',
  styleUrls: ['./mareld-panel.component.scss']
})
export class MareldPanelComponent {
  readonly stepsToDays = stepsToDays;
  readonly session = inject(MareldSession);
  readonly map = inject(MareldMapBridge);
  readonly gradient = BIOMASS_GRADIENT;
  readonly defaultModelId = environment.mareldPoc.modelId;
  readonly maxStepsLimit = MAX_STEPS;
  readonly sampleInterval = computed(() => sampleEvery(this.session.maxSteps()));
  readonly preview = computed(() =>
    this.session.input() ? rasterCanvas(this.session.input()!, 'preview').toDataURL() : ''
  );
  readonly canRun = this.session.canRun;
  readonly speciesLabel = speciesLabel;

  constructor() {
    this.map.setActive(true);
    this.session.calculations.refresh();
    this.session.resume();
    if (!this.session.models().length && !this.session.discovering()) {
      void this.session.discover();
    }
    inject(DestroyRef).onDestroy(() => this.map.setActive(false));
  }
}
