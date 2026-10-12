import { Component, computed, effect, inject } from '@angular/core';
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
  readonly session = inject(MareldSession);
  readonly map = inject(MareldMapBridge);
  readonly gradient = BIOMASS_GRADIENT;
  readonly defaultModelId = environment.mareldPoc.modelId;
  readonly maxStepsLimit = MAX_STEPS;
  readonly sampleInterval = computed(() => sampleEvery(this.session.maxSteps()));
  readonly preview = computed(() =>
    this.session.input() ? rasterCanvas(this.session.input()!, 'preview').toDataURL() : ''
  );
  readonly canRun = computed(
    () =>
      !!this.session.input() &&
      !this.session.busy() &&
      !this.session.discovering() &&
      !this.session.modelError() &&
      this.session.models().some((m) => m.id === this.session.modelId())
  );
  readonly speciesLabel = speciesLabel;

  constructor() {
    effect(() => {
      if (
        !this.session.models().length &&
        !this.session.discovering() &&
        !this.session.modelError()
      ) {
        void this.session.discover();
      }
    });
  }
}
