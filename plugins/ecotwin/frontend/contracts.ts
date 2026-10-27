import type { Polygon, MultiPolygon } from 'geojson';

export interface SimulationConfig {
  maxSteps: number;
  sampleEvery: number;
  seed: number;
  replicates?: number;
  tickDurationDays: number;
  mappingVersion: string;
}
export interface SimulationBaseline {
  scenarioCalculationId: number;
  baselineCalculationId: number;
  sourceFingerprint: string;
}
export interface SimulationSummary {
  version: 'ecotwin-report-v1' | 'ecotwin-report-v2';
  ensemble?: EnsembleResult;
  runId: string;
  calculationId: number;
  completedAt: number;
  source: CalculationInput;
  model: EcoTwinModel;
  config: SimulationConfig;
  grid: SimulationGrid;
  steps: number[];
  species: string[];
  units: 'tonnes/cell';
  waterCells: number;
  nativeAreaKm2: number;
  water: number[];
  assumptions: string[];
  totals: number[][];
  maxima: number[];
  pressures: {
    kind: string;
    sourceId: string;
    sourceSha256: string;
    strength: number;
    coverage: number;
    affectedCells: number;
  }[];
  finalBiomassB64?: string;
}

export interface SimulationGrid {
  crs: string;
  extent: [number, number, number, number];
  width: number;
  height: number;
  cellMetres: number;
}
export interface EcoTwinModel {
  id: string;
  name: string;
  species: string[];
}
export interface EnsembleResult {
  seeds: number[];
  /** [seed][species][frame], summed over the frozen water mask. */
  totals: number[][][];
  confidenceLevel: number;
  ciMethod: 'student-t';
  mean: number[][];
  ciLow: number[][];
  ciHigh: number[][];
}
export interface CalculationBand {
  category: 'ECOSYSTEM' | 'PRESSURE';
  bandNumber: number;
  title: string;
  units: string;
  sourceSha256: string;
}
export interface CalculationInput {
  version: 'calculation-input-v1';
  calculationId: number;
  name: string;
  timestamp: number;
  baselineId: number;
  baselineName: string;
  fingerprint: string;
  geometryCrs: string;
  sourceCrs: string;
  geometry: Polygon | MultiPolygon;
  suggestedGrid: SimulationGrid | null;
  bands: CalculationBand[];
  changes: unknown;
  operation: string;
  operationOptions: Record<string, string>;
  available: boolean;
  notes: string[];
  sourceFingerprints: Record<string, string>;
}
export interface CalculationGridBand extends CalculationBand {
  values: (number | null)[];
  coverage: number[];
}
export interface CalculationGrid {
  version: 'calculation-input-v1';
  calculationId: number;
  fingerprint: string;
  grid: SimulationGrid;
  rowOrder: 'north-first';
  domainCoverage: number[];
  bands: CalculationGridBand[];
}
