import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ScenarioChangesComponent } from './scenario-changes.component';
import { TranslationSetupModule } from "@src/app/app-translation-setup.module";
import { provideMockStore } from "@ngrx/store/testing";
import { provideZonelessChangeDetection } from "@angular/core";
import { BandChange } from '@data/metadata/metadata.interfaces';

describe('ScenarioChangesComponent', () => {
  let fixture: ComponentFixture<ScenarioChangesComponent>,
      component: ScenarioChangesComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [ ScenarioChangesComponent ],
      imports: [TranslationSetupModule],
      providers: [
        provideMockStore({ initialState : { user: {} } }),
        provideZonelessChangeDetection()
      ]
    })
    .compileComponents();
    fixture = TestBed.createComponent(ScenarioChangesComponent);
    component = fixture.componentInstance;
    component.scenarioChanges = {
      baseChanges: {},
      areaChanges: {}
    }
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders category-keyed saved edits even when redundant type fields are absent', () => {
    fixture.componentRef.setInput('bandDict', { PRESSURE: { '3': 'Catch bottom trawl' }, ECOSYSTEM: { '1': 'Porpoise' } });
    fixture.componentRef.setInput('areaDict', new Map([[1, 'Study area']]));
    fixture.componentRef.setInput('scenarioChanges', {
      baseChanges: { PRESSURE: { '3': { multiplier: 0.5 } as BandChange } },
      areaChanges: { 1: { ECOSYSTEM: { '1': { offset: 10 } as BandChange } } }
    });
    fixture.detectChanges();
    const labels = [...fixture.nativeElement.querySelectorAll('.change-label')].map((element: Element) => element.textContent);
    expect(labels).toEqual(['Catch bottom trawl', 'Porpoise']);
    expect(component.allBaseChanges['3'].multiplier).toBe(0.5);
  });
});
