import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MareldPanelComponent } from './mareld-panel.component';
import { MareldPressureLayerComponent } from './mareld-pressure-layer.component';
import { MareldBiomassChartComponent } from './mareld-biomass-chart.component';

@NgModule({
  declarations: [MareldPanelComponent, MareldPressureLayerComponent, MareldBiomassChartComponent],
  imports: [CommonModule, FormsModule],
  exports: [MareldPanelComponent, MareldPressureLayerComponent]
})
export class MareldPocModule {}
