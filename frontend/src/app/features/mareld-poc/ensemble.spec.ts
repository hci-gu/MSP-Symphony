import { ensembleLines } from './mareld-biomass';
import { biomassFixture } from './testing/biomass.fixture';
import { savedSimulation } from './simulation-persistence.client';

describe('ensemble uncertainty', () => {
  function ensembleFixture() {
    const result = biomassFixture();
    result.ensemble = {
      seeds: Array.from({ length: 10 }, (_, i) => 42 + i),
      confidenceLevel: 0.95,
      ciMethod: 'student-t',
      totals: Array.from({ length: 10 }, (_, i) => [
        [i + 1, 2 * (i + 1), 0],
        [10 - i, 2 * (10 - i), 0]
      ]),
      mean: [],
      ciLow: [],
      ciHigh: []
    };
    return result;
  }
  it('uses small-sample intervals and keeps covariance when summing species', () => {
    const lines = ensembleLines(ensembleFixture(), [], 'absolute', true);
    expect(lines[0].values).toEqual([11, 22, 0]);
    expect(lines[0].low).toEqual([11, 22, 0]);
    expect(lines[0].high).toEqual([11, 22, 0]);
    expect(lines[1].values[0]).toBe(5.5);
    expect(lines[1].low![0]).toBeCloseTo(3.33414941, 6);
    expect(lines[1].high![0]).toBeCloseTo(7.66585059, 6);
    expect(ensembleLines(ensembleFixture(), ['pelagicFish'], 'absolute', true)[0].low).toEqual(
      lines[1].low
    );
  });
  it('normalizes each seed before estimating relative uncertainty and handles zero initial biomass', () => {
    const r = ensembleFixture();
    const lines = ensembleLines(r, [], 'relative', false);
    expect(lines[0].values).toEqual([100, 200, 0]);
    expect(lines[0].low).toEqual([100, 200, 0]);
    r.ensemble!.totals[0][0][0] = 0;
    expect(ensembleLines(r, [], 'relative', false)[0].values).toEqual([null, null, null]);
  });
  it('prevents a preview from being persisted even if it has calculation provenance', () => {
    expect(() => savedSimulation({ ...biomassFixture(), kind: 'preview' })).toThrowError(
      /Previews/
    );
  });
});
