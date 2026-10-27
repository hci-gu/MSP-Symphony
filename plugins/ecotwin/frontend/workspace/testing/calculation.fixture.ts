import { CalculationGrid, CalculationInput } from '../calculation-input';
import { PreparedInput, prepareInput } from '../ecotwin-input';
import { exampleArea } from './example-area.fixture';
import { mapCalculation } from '../simulation-input-mapping';

export function calculationFixture(
  id = 7,
  existing?: PreparedInput
): { source: CalculationInput, grid: CalculationGrid, input: PreparedInput } {
  const input = existing ?? prepareInput(exampleArea(), 'Saved calculation');
  const source: CalculationInput = {
    version: 'calculation-input-v1',
    calculationId: id,
    name: `Calculation ${id}`,
    timestamp: 1234567890,
    baselineId: 4,
    baselineName: 'HAV_2019_WEST_LOCAL',
    fingerprint: 'a'.repeat(64),
    geometryCrs: 'EPSG:4326',
    sourceCrs: 'EPSG:3035',
    geometry: input.geometry.geometry,
    suggestedGrid: structuredClone(input.grid),
    bands: [
      {
        category: 'PRESSURE',
        bandNumber: 3,
        title: 'Catch bottom trawl',
        units: 'relative index 0–100',
        sourceSha256: 'b0c2bb630a7694306139512667058d275b88ffb8cebe33f21ac66806c9f331bf'
      },
      {
        category: 'PRESSURE',
        bandNumber: 13,
        title: 'Shipping noise',
        units: 'relative index 0–100',
        sourceSha256: '716dbf1e91bb1dcd53b65a790799b8272682ea6eb44a973fa10d2392103d7dc1'
      }
    ],
    changes: {},
    operation: 'CumulativeImpact',
    operationOptions: {},
    available: true,
    notes: [],
    sourceFingerprints: { PRESSURE: 'b'.repeat(64) }
  };
  const grid: CalculationGrid = {
    version: source.version,
    calculationId: id,
    fingerprint: source.fingerprint,
    grid: structuredClone(input.grid),
    rowOrder: 'north-first',
    domainCoverage: Array.from(input.water),
    bands: source.bands.map((band) => ({
      ...band,
      values: Array.from(input.water, (v) => (v ? 50 : null)),
      coverage: Array.from(input.water)
    }))
  };
  return { source, grid, input: mapCalculation(input, source, grid) };
}
