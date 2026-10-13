import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { FormBuilder, FormsModule } from '@angular/forms';

import { MainViewComponent } from './main-view.component';
import { MareldPocModule } from '../features/mareld-poc/mareld-poc.module';
import { MareldApiClient } from '../features/mareld-poc/mareld-api.client';
import { environment } from '@src/environments/environment';
import { SharedModule } from '@shared/shared.module';
import { MapComponent } from './map/map.component';
import { MapToolbarComponent } from './map/map-toolbar/map-toolbar.component';
import { MapOpacitySliderComponent } from './map/map-opacity-slider/map-opacity-slider.component';
import { CoreModule } from '../core/core.module';
import { SliderControlsComponent } from './band-selection/slider-controls/slider-controls.component';
import { MatrixSelectionComponent } from './scenario/scenario-area-detail/matrix-selection/matrix-selection.component';
import {
  ToolbarButtonComponent,
  ToolbarZoomButtonsComponent
} from './map/toolbar-button/toolbar-button.component';
import { EcoSliderComponent } from './band-selection/eco-slider/eco-slider.component';
import { TranslationSetupModule } from '@src/app/app-translation-setup.module';
import { AreaSelectionComponent } from './area-selection/area-selection.component';
import { BandSelectionComponent } from './band-selection/band-selection.component';
import { SelectionLayoutComponent } from './selection-layout/selection-layout.component';
import { initialState as metadata } from '@data/metadata/metadata.reducers';
import { initialState as area } from '@data/area/area.reducers';
import { initialState as calculation } from '@data/calculation/calculation.reducers';
import { initialState as scenario } from '@data/scenario/scenario.reducers';
import {
  initialState as config,
  configReducer
} from '@data/systemproperties/systemproperties.reducer';
import { ScenarioEditorComponent } from '@src/app/map-view/scenario/scenario-editor.component';
import { StoreModule } from '@ngrx/store';
import { CalculationHistoryComponent } from '@src/app/map-view/calculation-history/calculation-history.component';
import { ComparisonComponent } from '@src/app/map-view/comparison/comparison.component';
import { MatSelectModule } from '@angular/material/select';
import { MatRadioModule } from '@angular/material/radio';
import { AreaGroupComponent } from '@src/app/map-view/area-selection/area-group/area-group.component';
import { ScenarioListComponent } from '@src/app/map-view/scenario/scenario-list/scenario-list.component';
import { BatchProgressComponent } from './batch-progress-display/batch-progress.component';
import { RouterModule } from '@angular/router';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { AddScenarioAreasComponent } from '@src/app/map-view/scenario/add-scenario-areas/add-scenario-areas.component';
import { SummaryModelSelectionComponent } from './band-selection/summary-model-selection/summary-model-selection.component';
import { SummaryModelAccordionComponent } from './band-selection/summary-model-selection/summary-model-accordion/summary-model-accordion.component';
import { SummaryModelControlsComponent } from './band-selection/summary-model-selection/summary-model-controls/summary-model-controls.component';

describe('MainViewComponent', () => {
  let fixture: ComponentFixture<MainViewComponent>, component: MainViewComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        MareldPocModule,
        SharedModule,
        CoreModule,
        TranslationSetupModule,
        RouterModule.forRoot([]),
        MatSelectModule,
        MatRadioModule,
        MatCheckboxModule,
        FormsModule,
        StoreModule.forRoot({}, {}),
        StoreModule.forFeature('config', configReducer)
      ],
      declarations: [
        MainViewComponent,
        MapComponent,
        ScenarioEditorComponent,
        ScenarioListComponent,
        MapToolbarComponent,
        MapOpacitySliderComponent,
        SliderControlsComponent,
        MatrixSelectionComponent,
        ToolbarZoomButtonsComponent,
        ToolbarButtonComponent,
        EcoSliderComponent,
        AreaGroupComponent,
        AreaSelectionComponent,
        SummaryModelSelectionComponent,
        SummaryModelAccordionComponent,
        SummaryModelControlsComponent,
        BandSelectionComponent,
        SelectionLayoutComponent,
        CalculationHistoryComponent,
        ComparisonComponent,
        BatchProgressComponent,
        AddScenarioAreasComponent
      ],
      providers: [
        FormBuilder,
        {
          provide: MareldApiClient,
          useValue: {
            models: () => Promise.resolve([{ id: 'test', name: 'Test', species: ['codfish'] }])
          }
        },
        provideMockStore({
          initialState: {
            user: { baseline: undefined },
            metadata: metadata,
            calculation: calculation,
            area: area,
            scenario: scenario,
            config: config
          }
        }),
        provideZonelessChangeDetection()
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(MainViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('keeps simulation services dormant and removes supplemental content from native tabs', () => {
    const api = TestBed.inject(MareldApiClient);
    const discover = spyOn(api, 'models').and.callThrough();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-mareld-panel')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-mareld-layers')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-mareld-pressure-layer')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-mareld-layer-legend')).toBeNull();
    expect(discover).not.toHaveBeenCalled();
  });

  it('omits the MARELD tab when the feature is disabled', () => {
    fixture.destroy();
    const enabled = environment.mareldPoc.enabled;
    environment.mareldPoc.enabled = false;
    try {
      fixture = TestBed.createComponent(MainViewComponent);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('#mareld-poc')).toBeNull();
      expect(fixture.nativeElement.querySelector('app-mareld-panel')).toBeNull();
      expect(fixture.nativeElement.querySelector('app-mareld-pressure-layer')).toBeNull();
      expect(fixture.nativeElement.querySelector('app-mareld-layers')).toBeNull();
      expect(fixture.nativeElement.querySelector('app-mareld-layer-legend')).toBeNull();
    } finally {
      environment.mareldPoc.enabled = enabled;
    }
  });
});
