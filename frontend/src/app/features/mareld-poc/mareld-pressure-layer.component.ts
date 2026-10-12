import { Component, inject, Input } from '@angular/core';
import { MareldPressureLayer, windparkMatchesSearch } from './mareld-pressure-layer.service';

@Component({
  selector: 'app-mareld-pressure-layer',
  standalone: false,
  templateUrl: './mareld-pressure-layer.component.html',
  styleUrls: ['./mareld-pressure-layer.component.scss']
})
export class MareldPressureLayerComponent {
  readonly pressure = inject(MareldPressureLayer);
  @Input() search = '';

  get matchesSearch(): boolean {
    return windparkMatchesSearch(this.search);
  }
}
