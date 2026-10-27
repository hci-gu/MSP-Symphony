import { Provider } from '@angular/core';
import { LEGACY_REQUIRED_EXTENSIONS } from '@src/app/extensions/extensions';
/** Compatibility metadata only: safe to retain after uninstalling the implementation. */
export const LEGACY_LINK_PROVIDERS: Provider[] = [
  {
    provide: LEGACY_REQUIRED_EXTENSIONS,
    multi: true,
    useValue: (query: Record<string, string>) =>
      ['simBase', 'simBaselineRun', 'simScenarioRun'].some((key) => key in query) ? ['ecotwin'] : []
  }
];
