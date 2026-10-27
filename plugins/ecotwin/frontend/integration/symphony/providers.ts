import { preparationUrl } from './navigation';
import { Provider } from '@angular/core';
import { HOST_EXTENSIONS } from '@src/app/extensions/extensions';
import { CALCULATIONS, HOST_LIFECYCLE, PREPARATION_LINK, NAVIGATION } from '../../ports';
import { ECOTWIN_CONFIG, EcoTwinConfig } from '../../config';
import { SymphonyCalculationAdapter } from './calculation.adapter';
import { ecoTwinExtension, hostLifecycle, preparationLink } from './contributions';
/** The optional distribution is the only caller of this registration interface. */
export function provideEcoTwin(config: EcoTwinConfig): Provider[] {
  return [
    { provide: NAVIGATION, useValue: { prepare: preparationUrl } },
    { provide: ECOTWIN_CONFIG, useValue: config },
    { provide: CALCULATIONS, useExisting: SymphonyCalculationAdapter },
    { provide: HOST_LIFECYCLE, useFactory: hostLifecycle },
    { provide: PREPARATION_LINK, useFactory: preparationLink },
    { provide: HOST_EXTENSIONS, multi: true, useFactory: ecoTwinExtension }
  ];
}
