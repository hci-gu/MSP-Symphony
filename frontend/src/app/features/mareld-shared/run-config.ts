import config from './run-config.json';

export const MARELD_RUN = config;
export const stepsToDays = (steps: number): number => steps * config.tickDurationDays;
