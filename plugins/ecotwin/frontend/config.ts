import { InjectionToken } from '@angular/core';
export interface EcoTwinConfig {
  apiBaseUrl: string;
  modelId: string;
}
export const DEFAULT_ECOTWIN_CONFIG: EcoTwinConfig = {
  apiBaseUrl: '/symphony-ws/service',
  modelId: 'allminussb'
};
export const ECOTWIN_CONFIG = new InjectionToken<EcoTwinConfig>('EcoTwin configuration', {
  factory: () => DEFAULT_ECOTWIN_CONFIG
});
