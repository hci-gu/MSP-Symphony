import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, inject } from '@angular/core';
import { IMPACT_DEFINITIONS } from './ecotwin-impacts';
import { IMPACT_OUTLINE_STYLES } from './ecotwin-impact-outline';
import { SimulationWorkspace } from './simulation-workspace';

@Component({
  selector: 'app-ecotwin-impact-outlines',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (session.outlineLayers().length) {
      <fieldset>
        <legend>Mask outlines</legend>
        <p>
          {{
            session.mapImpacts().fromResult
              ? 'Footprints used in this result.'
              : 'Footprints of the prepared inputs.'
          }}
          Map display only.
        </p>
        @for (layer of session.outlineLayers(); track layer.kind) {
          <label>
            <input
              type="checkbox"
              [ngModel]="session.impactOutlines()[layer.kind]"
              (ngModelChange)="session.setImpactOutline(layer.kind, $event)"
            />
            <span
              class="swatch"
              aria-hidden="true"
              [class.dashed]="layer.kind === 'trawling'"
              [style.--outline-color]="styles[layer.kind].color"
            ></span>
            {{ definitions[layer.kind].title }} outline
          </label>
        }
      </fieldset>
    }
  `,
  styles: `
    fieldset {
      margin: 16px 0;
      padding: 10px 12px 12px;
      border: 1px solid #cbdce1;
      border-radius: 5px;
    }
    legend {
      font-size: 13px;
      font-weight: 600;
      color: #264c58;
      padding: 0 5px;
    }
    p {
      font-size: 11px;
      line-height: 1.5;
      color: #617680;
      margin: 0 0 12px;
    }
    label {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
      font-size: 12px;
      cursor: pointer;
    }
    input {
      width: 16px;
      height: 16px;
      margin: 0;
      accent-color: #177c87;
    }
    input:focus-visible {
      outline: 2px solid #137c88;
      outline-offset: 3px;
    }
    .swatch {
      display: inline-flex;
      align-items: center;
      width: 30px;
      height: 16px;
      padding: 0 3px;
      border-radius: 3px;
      background: #354550;
    }
    .swatch::after {
      content: '';
      width: 100%;
      border-top: 3px solid var(--outline-color);
    }
    .swatch.dashed::after {
      border-top-style: dashed;
    }
  `
})
export class EcoTwinImpactOutlinesComponent {
  readonly session = inject(SimulationWorkspace);
  readonly styles = IMPACT_OUTLINE_STYLES;
  readonly definitions = IMPACT_DEFINITIONS;
}
