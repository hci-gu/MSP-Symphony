import { stepsToDays } from '../mareld-shared/run-config';
import { Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { environment } from '@src/environments/environment';
import { rasterCanvas } from './mareld-input';
import { MAX_STEPS } from './mareld-result';
import { MareldSession } from './mareld-session.service';
import { MareldMapBridge } from './mareld-map.bridge';
import { ActivatedRoute } from '@angular/router';

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
  readonly defaultModelId = environment.mareldPoc.modelId;
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
    const query = inject(ActivatedRoute, { optional: true })?.snapshot.queryParamMap;
    const calculation = Number(query?.get('calculation'));
    if (query?.get('tab') === 'mareld-poc' && Number.isInteger(calculation) && calculation > 0)
      void this.session.prepareComparison(
        calculation,
        Number(query.get('matchCalculation')) || undefined,
        query.get('matchRun') || undefined
      );
    inject(DestroyRef).onDestroy(() => this.map.setActive(false));
  }

  async deleteSaved(runId: string): Promise<void> {
    this.pendingDelete.set(null);
    await this.session.deleteSaved(runId);
  }
}
