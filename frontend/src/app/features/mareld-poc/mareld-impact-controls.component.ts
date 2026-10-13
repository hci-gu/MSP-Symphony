import { Component, computed, inject } from '@angular/core';
import { IMPACT_DEFINITIONS, IMPACT_KINDS, impactPreview } from './mareld-impacts';
import { MareldSession } from './mareld-session.service';

@Component({
  selector: 'app-mareld-impact-controls',
  standalone: false,
  templateUrl: './mareld-impact-controls.component.html',
  styleUrls: ['./mareld-impact-controls.component.scss']
})
export class MareldImpactControlsComponent {
  readonly session = inject(MareldSession);
  readonly cards = computed(() =>
    IMPACT_KINDS.map((kind) => {
      const layer = this.session.preparedImpacts()?.layers.find((item) => item.kind === kind);
      return {
        kind,
        title: IMPACT_DEFINITIONS[kind].title,
        settings: this.session.impactSettings()[kind],
        layer,
        preview: layer && this.session.input() ? impactPreview(this.session.input()!, layer) : ''
      };
    })
  );
}
