import type { Polygon, MultiPolygon } from 'geojson';
import type { PreparedInput } from './mareld-input';

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
  suggestedGrid: PreparedInput['grid'] | null;
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
  grid: PreparedInput['grid'];
  rowOrder: 'north-first';
  domainCoverage: number[];
  bands: CalculationGridBand[];
}

export function validateManifest(source: CalculationInput): void {
  if (
    source.version !== 'calculation-input-v1' ||
    source.geometryCrs !== 'EPSG:4326' ||
    !Number.isInteger(source.calculationId) ||
    !/^[a-f0-9]{64}$/.test(source.fingerprint) ||
    !Array.isArray(source.bands)
  )
    throw new Error('Unsupported calculation input manifest.');
}

export function validateGrid(
  source: CalculationInput,
  input: PreparedInput,
  grid: CalculationGrid
): void {
  const cells = input.water.length;
  if (
    grid.version !== source.version ||
    grid.calculationId !== source.calculationId ||
    grid.fingerprint !== source.fingerprint ||
    grid.rowOrder !== 'north-first' ||
    grid.grid.crs !== input.grid.crs ||
    grid.grid.width !== input.grid.width ||
    grid.grid.height !== input.grid.height ||
    grid.grid.cellMetres !== input.grid.cellMetres ||
    JSON.stringify(grid.grid.extent) !== JSON.stringify(input.grid.extent) ||
    grid.domainCoverage.length !== cells ||
    grid.domainCoverage.some((v) => !Number.isFinite(v) || v < 0 || v > 1)
  )
    throw new Error('The exported calculation grid does not match the requested inputs.');
  const keys = new Set<string>();
  for (const band of grid.bands) {
    const key = `${band.category}:${band.bandNumber}`;
    const original = source.bands.find(
      (b) => b.category === band.category && b.bandNumber === band.bandNumber
    );
    if (
      keys.has(key) ||
      !original ||
      original.sourceSha256 !== band.sourceSha256 ||
      original.units !== band.units ||
      band.values.length !== cells ||
      band.coverage.length !== cells ||
      band.values.some((v) => v !== null && (!Number.isFinite(v) || v < 0)) ||
      band.coverage.some((v) => !Number.isFinite(v) || v < 0 || v > 1)
    )
      throw new Error('The exported calculation contains invalid or unexpected band data.');
    keys.add(key);
  }
  if (keys.size !== source.bands.length)
    throw new Error('The exported calculation is missing selected band data.');
}
