import config from './run-config.json';
import { PROFILE } from '../profile';
export const ECOTWIN_RUN = { ...config, tickDurationDays: PROFILE.tickDurationDays, defaultSteps: PROFILE.defaultSteps, maxSteps: PROFILE.maxSteps };
export const stepsToDays = (steps: number): number => steps * ECOTWIN_RUN.tickDurationDays;
