import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MareldPanelComponent } from './mareld-panel.component';
import { MareldBiomassChartComponent } from './mareld-biomass-chart.component';
import { MareldImpactOutlinesComponent } from './mareld-impact-outlines.component';

@NgModule({
  declarations: [MareldPanelComponent, MareldBiomassChartComponent, MareldImpactOutlinesComponent],
  imports: [CommonModule, FormsModule],
  exports: [MareldPanelComponent]
})
export class MareldPocModule {}
