import { EcoTwinImpactOutlinesComponent } from './ecotwin-impact-outlines.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { stepsToDays } from '../shared/run-config';
import { Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { ECOTWIN_CONFIG } from '../config';
import { rasterCanvas } from './ecotwin-input';
import { MAX_STEPS } from './ecotwin-result';
import { SimulationWorkspace } from './simulation-workspace';
import { EcoTwinMapBridge } from './ecotwin-map.bridge';
import { PREPARATION_LINK } from '../ports';

@Component({
  selector: 'app-ecotwin-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, EcoTwinImpactOutlinesComponent],
  templateUrl: './ecotwin-panel.component.html',
  styleUrls: ['./ecotwin-panel.component.scss']
})
export class EcoTwinPanelComponent {
  private readonly config = inject(ECOTWIN_CONFIG);
  readonly stepsToDays = stepsToDays;
  readonly session = inject(SimulationWorkspace);
  readonly map = inject(EcoTwinMapBridge);
  readonly defaultModelId = this.config.modelId;
  readonly maxStepsLimit = MAX_STEPS;
  readonly preview = computed(() =>
    this.session.input() ? rasterCanvas(this.session.input()!, 'preview').toDataURL() : ''
  );
  readonly canRun = this.session.canRun;
  readonly pendingDelete = signal<string | null>(null);

  constructor() {
    effect(() => {
      this.session.selectedId();
      this.pendingDelete.set(null);
    });
    this.map.setActive(true);
    this.session.calculations.refresh();
    this.session.resume();
    if (!this.session.models().length && !this.session.discovering()) {
      void this.session.discover();
    }
    const link = inject(PREPARATION_LINK);
    if (link) void this.session.prepareComparison(link.calculation, link.matchCalculation, link.matchRun);
    inject(DestroyRef).onDestroy(() => this.map.setActive(false));
  }

  async deleteSaved(runId: string): Promise<void> {
    this.pendingDelete.set(null);
    await this.session.deleteSaved(runId);
  }
}
