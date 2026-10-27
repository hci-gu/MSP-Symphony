import { Provider } from '@angular/core';
import { environment } from '@src/environments/environment';
import { LEGACY_LINK_PROVIDERS } from '@ecotwin-distribution/legacy-links';
import { provideEcoTwin } from '@ecotwin/public-api';
export const APPLICATION_EXTENSION_PROVIDERS: Provider[] = [
  ...provideEcoTwin({ apiBaseUrl: environment.apiBaseUrl, modelId: 'allminussb' }),
  ...LEGACY_LINK_PROVIDERS
];
