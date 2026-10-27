import { exampleArea } from '../testing/example-area.fixture';
import { prepareInput } from '../ecotwin-input';
import { EcoTwinResult } from '../ecotwin-result';

export function biomassFixture(): EcoTwinResult {
  const input = prepareInput(exampleArea(), 'Masked area');
  input.grid.width = 3;
  input.grid.height = 3;
  input.water = new Uint8Array([1, 0, 1, 1, 0, 1, 0, 0, 0]);
  input.waterCells = 4;
  const initial = [1, 10, 99, 999, 3, 30, 4, 40, 99, 999, 6, 60, 99, 999, 99, 999, 99, 999];
  return {
    id: 'biomass-fixture',
    source: 'live',
    model: 'Fixture',
    input,
    species: ['codfish', 'pelagicFish'],
    steps: [0, 100, 125],
    values: new Float32Array([
      ...initial,
      ...initial.map((value, i) => value * (i % 2 === 0 ? 2 : 0.5)),
      ...initial.map(() => 0)
    ]),
    maxima: [198, 999]
  };
}
