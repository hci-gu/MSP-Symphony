import { EcoTwinResultsComponent } from './ecotwin-results.component';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EcoTwinPanelComponent } from './ecotwin-panel.component';
import { EcoTwinBiomassChartComponent } from './ecotwin-biomass-chart.component';
import { EcoTwinImpactOutlinesComponent } from './ecotwin-impact-outlines.component';

@NgModule({
  imports: [
    CommonModule, FormsModule,
    EcoTwinResultsComponent,
    EcoTwinPanelComponent,
    EcoTwinBiomassChartComponent,
    EcoTwinImpactOutlinesComponent
  ],
  exports: [EcoTwinPanelComponent, EcoTwinResultsComponent]
})
export class EcoTwinWorkspaceModule {}
