import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { State } from '@src/app/app-reducer';
import { selectSelectedAreaData } from '@data/area/area.selectors';
import { SelectableArea } from '@data/area/area.interfaces';
import { prepareInput, PreparedInput, StudyArea } from './mareld-input';

@Injectable({ providedIn: 'root' })
export class SymphonySelectionAdapter {
  private readonly store = inject<Store<State>>(Store);
  async capture(): Promise<PreparedInput> {
    const selected = (await firstValueFrom(
      this.store.select(selectSelectedAreaData)
    )) as SelectableArea[];
    if (selected.length !== 1)
      throw new Error(
        'Select exactly one area in the Areas panel, then return here. You can also use the example area.'
      );
    const area = selected[0];
    return prepareInput(
      area.feature as unknown as StudyArea,
      area.displayName || area.name || 'Selected area'
    );
  }
}
