import fixtures from '../contracts/fixtures/hav-west-native-v1.json';
import { mapCalculation } from './workspace/simulation-input-mapping';
import { calculationFixture } from './workspace/testing/calculation.fixture';
import { prepareInput } from './workspace/ecotwin-input';
import { PROFILE } from './profile';

describe('shared scientific profile contract', () => {
  function mapped(kind: string, value: number | null, coverage = 1, domain = 1) {
    const { source, grid } = calculationFixture(7);
    const policy = PROFILE.pressureBands.find((band) => band.kind === kind)!;
    source.bands = source.bands.filter(
      (band) => band.category !== 'PRESSURE' || band.bandNumber === policy.bandNumber
    );
    grid.bands = grid.bands.filter(
      (band) => band.category !== 'PRESSURE' || band.bandNumber === policy.bandNumber
    );
    const band = grid.bands.find((item) => item.category === 'PRESSURE')!;
    band.values.fill(value);
    band.coverage.fill(coverage);
    grid.domainCoverage.fill(domain);
    const input = prepareInput(
      { type: 'Feature', properties: {}, geometry: source.geometry },
      source.name,
      source.suggestedGrid!
    );
    return mapCalculation(input, source, grid);
  }
  for (const sample of fixtures.quantization)
    it(`maps ${sample.kind} ${sample.nativeValue} exactly as the server fixture`, () => {
      const result = mapped(sample.kind, sample.nativeValue);
      const layer = result.impacts!.layers[0];
      expect(layer.values[0]).toBe(sample.float32);
      expect(layer.bands[0]?.level ?? 0).toBe(sample.level);
      expect(layer.bands[0]?.intensity ?? 0).toBeCloseTo(sample.intensity, 12);
    });
  for (const sample of fixtures.invalid)
    it(`rejects ${sample.reason}`, () => {
      expect(() => mapped('trawling', sample.value, sample.coverage)).toThrow();
    });
  for (const sample of fixtures.water.filter((item) => item.water))
    it(`retains fractional native domain ${sample.domainCoverage} as model water`, () => {
      expect(mapped('trawling', 0, 1, sample.domainCoverage).water[0]).toBe(sample.water);
    });
});
