import { Component, inject, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { INDEX_GRADIENT, LayerCategory, MARELD_ASSETS, matchingLayers } from './mareld-layer-data';
import { MareldLayers } from './mareld-layers.service';
import { MareldLayersMap } from './mareld-layers-map.service';

@Component({
  selector: 'app-mareld-layers',
  imports: [CommonModule, FormsModule],
  templateUrl: './mareld-layers.component.html',
  styleUrls: ['./mareld-layers.component.scss']
})
export class MareldLayersComponent {
  readonly state = inject(MareldLayers);
  readonly map = inject(MareldLayersMap);
  readonly assets = MARELD_ASSETS;
  readonly gradient = INDEX_GRADIENT;
  @Input() category: LayerCategory = 'ECOSYSTEM';
  @Input() search = '';

  get layers() {
    return matchingLayers(this.category, this.search);
  }
  get activeLayer() {
    const layer = this.state.selected();
    return layer?.category === this.category ? layer : null;
  }
}
