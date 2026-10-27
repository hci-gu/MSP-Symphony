import {
  aggregateBiomass,
  biomassLines,
  nearestBiomassFrame,
  speciesColor
} from './ecotwin-biomass';
import { biomassFixture } from './testing/biomass.fixture';

describe('ECOTWIN population time series', () => {
  it('sums species-interleaved frames only inside the captured water mask', () => {
    const series = aggregateBiomass(biomassFixture());
    expect(series[0].values).toEqual([14, 28, 0]);
    expect(series[1].values).toEqual([140, 70, 0]);
    expect(series.map((line) => line.name)).toEqual(['Codfish', 'Pelagic fish']);
    expect(series.map((line) => line.color)).toEqual(['#4aa3f0', '#9f6db5']);
    expect(speciesColor('benthic_community', 3)).toBe('#64748b');
  });

  it('recomputes the total from visible species and normalizes totals after summing', () => {
    const series = aggregateBiomass(biomassFixture());
    expect(biomassLines(series, [], 'absolute', true)[0].values).toEqual([154, 98, 0]);
    expect(biomassLines(series, ['pelagicFish'], 'absolute', true)[0].values).toEqual([14, 28, 0]);
    const relative = biomassLines(series, [], 'relative', true);
    expect(relative[0].values[1]).toBeCloseTo((98 / 154) * 100);
    expect(relative[1].values).toEqual([100, 200, 0]);
    expect(relative[2].values).toEqual([100, 50, 0]);
    expect(series[0].values).toEqual([14, 28, 0]);
    expect(biomassLines(series, [], 'absolute', false).length).toBe(2);
    expect(biomassLines(series, ['codfish', 'pelagicFish'], 'absolute', true)).toEqual([]);
  });

  it('leaves relative values undefined for a species with zero initial biomass', () => {
    const series = aggregateBiomass(biomassFixture());
    series[0].values[0] = 0;
    const relative = biomassLines(series, [], 'relative', false);
    expect(relative[0].values).toEqual([null, null, null]);
    expect(relative[1].values).toEqual([100, 50, 0]);
    expect(biomassLines(series, [], 'absolute', false)[0].values).toEqual([0, 28, 0]);
  });

  it('selects the nearest actual step, including an uneven final sampling interval', () => {
    expect(nearestBiomassFrame([0, 100, 125], 80)).toBe(1);
    expect(nearestBiomassFrame([0, 100, 125], 121)).toBe(2);
    expect(nearestBiomassFrame([0, 100, 125], -100)).toBe(0);
    expect(nearestBiomassFrame([0, 100, 125], 900)).toBe(2);
  });
});
