import { Component, inject } from '@angular/core';
import { INDEX_GRADIENT } from './mareld-layer-data';
import { MareldLayers } from './mareld-layers.service';

@Component({
  selector: 'app-mareld-layer-legend',
  template: `
    @if (state.selected(); as layer) {
      <aside class="legend" aria-label="MARELD map legend">
        <div class="heading">
          <strong>{{ layer.title }}</strong
          ><button
            type="button"
            aria-label="Hide MARELD data layer"
            (click)="state.clearSelection()"
          >
            ×
          </button>
        </div>
        @if (state.showProvenance()) {
          <div class="origins">
            <span><i class="source"></i>Source</span><span><i class="recovered"></i>Recovered</span
            ><span><i class="inferred"></i>Inferred</span>
          </div>
        } @else {
          <div class="gradient" [style.background]="gradient"></div>
          <div class="range"><span>0</span><span>Normalized index</span><span>100</span></div>
        }
        <p>Grey hatching: unknown source support</p>
        @if (layer.extension && state.effectiveVariant() !== 'source') {
          <p class="assumption">
            POC extension ·
            {{ state.effectiveVariant() === 'extended' ? 'central' : state.effectiveVariant()
            }}{{ state.hatch() && !state.showProvenance() ? ' · inferred cells hatched' : '' }}
          </p>
        }
        @if (layer.future) {
          <p class="assumption">2050 future scenario</p>
        }
        @if (state.loading()) {
          <p role="status">Loading…</p>
        }
        @if (state.error()) {
          <p role="alert">{{ state.error() }}</p>
        }
      </aside>
    }
  `,
  styles: [
    `
      .legend {
        position: absolute;
        right: 1.5rem;
        bottom: 4.5rem;
        width: 26rem;
        padding: 1rem 1.2rem;
        background: rgba(255, 255, 255, 0.96);
        border: 1px solid #b5cfd1;
        border-radius: 5px;
        box-shadow: 0 1px 7px #0002;
        color: #274454;
        font-size: 1.2rem;
        pointer-events: auto;
      }
      .heading {
        display: flex;
        align-items: center;
        gap: 0.8rem;
        margin-bottom: 0.6rem;
      }
      strong {
        flex: 1;
        font-size: 1.3rem;
      }
      button {
        border: 0;
        background: transparent;
        font-size: 2rem;
        cursor: pointer;
        color: #274454;
      }
      button:focus-visible {
        outline: 2px solid #137b7d;
      }
      .gradient {
        height: 1rem;
        border-radius: 2px;
      }
      .range,
      .origins {
        display: flex;
        justify-content: space-between;
        font-size: 1.1rem;
      }
      p {
        margin: 0.5rem 0 0;
        font-size: 1.1rem;
      }
      .assumption {
        color: #775319;
        font-weight: 600;
      }
      i {
        display: inline-block;
        width: 0.8rem;
        height: 0.8rem;
        margin-right: 0.3rem;
      }
      .source {
        background: #288461;
      }
      .recovered {
        background: #2c72be;
      }
      .inferred {
        background: #e59f1e;
      }
    `
  ]
})
export class MareldLayerLegendComponent {
  readonly state = inject(MareldLayers);
  readonly gradient = INDEX_GRADIENT;
}
