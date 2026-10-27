import type { SimulationSummary } from '../../contracts';
import { calculationFixture } from '../../workspace/testing/calculation.fixture';
import { encodeFloats } from '../../workspace/simulation-persistence.client';
export function simulationSummary(): SimulationSummary {
  const source = calculationFixture().source;
  return {
    version: 'ecotwin-report-v1',
    runId: 'run-a',
    calculationId: 7,
    completedAt: 12345,
    source,
    model: { id: 'test', name: 'Test', species: ['codfish', 'plankton'] },
    config: {
      maxSteps: 1,
      sampleEvery: 4,
      seed: 42,
      tickDurationDays: 0.25,
      mappingVersion: 'hav-west-native-v1'
    },
    grid: { crs: 'EPSG:3035', extent: [0, 0, 3000, 3000], width: 3, height: 3, cellMetres: 1000 },
    water: [1, 0, 1, 0, 0, 0, 0, 0, 0],
    waterCells: 2,
    nativeAreaKm2: 1.5,
    steps: [0, 1],
    species: ['codfish', 'plankton'],
    units: 'tonnes/cell',
    assumptions: ['Synthetic depth'],
    pressures: [],
    totals: [
      [2, 4],
      [0, 8]
    ],
    maxima: [2, 4],
    finalBiomassB64: encodeFloats(
      new Float32Array([2, 4, 0, 0, 2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    )
  };
}
