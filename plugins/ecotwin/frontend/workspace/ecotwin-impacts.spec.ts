import { impactRequest } from './ecotwin-impacts';
import { calculationFixture } from './testing/calculation.fixture';
import { mapCalculation, compatibility } from './simulation-input-mapping';

describe('saved calculation pressure mapping', () => {
  it('uses north-first effective values, preserves real zero and omits off-domain cells', () => {
    const { input, source, grid } = calculationFixture();
    grid.domainCoverage[3] = 0;
    grid.bands[0].values.splice(0, 4, 0, 100, 50, null);
    grid.bands[0].coverage[3] = 0;
    const mapped = mapCalculation(input, source, grid);
    expect(Array.from(mapped.impacts!.layers[0].values.slice(0, 4))).toEqual([
      0,
      Math.fround(0.2),
      Math.fround(0.1),
      0
    ]);
    expect(mapped.water[3]).toBe(0);
    expect(mapped.nativeGrid!.bands[0].values[2]).toBe(50);
  });
  it('blocks missing/partial pressure support, but accepts a supported zero field', () => {
    const { input, source, grid } = calculationFixture();
    grid.bands[0].values.fill(0);
    expect(mapCalculation(input, source, grid).impacts!.layers[0].bands.length).toBe(0);
    grid.bands[0].coverage[0] = 0.75;
    expect(() => mapCalculation(input, source, grid)).toThrowError(/missing source support/);
    grid.bands[0].coverage[0] = 1;
    grid.bands[0].values[0] = null;
    expect(() => mapCalculation(input, source, grid)).toThrowError(/missing source support/);
  });
  it('rejects unsupported selected pressures, baselines, units and unselected injected bands', () => {
    const { input, source, grid } = calculationFixture();
    for (const number of [4, 7, 14]) {
      source.bands[0].bandNumber = number;
      expect(compatibility(source).join()).toContain('Unsupported selected pressure');
      expect(() => mapCalculation(input, source, grid)).toThrow();
    }
    source.bands[0].bandNumber = 3;
    source.bands[0].units = 'dB';
    expect(compatibility(source).join()).toContain('Unsupported selected pressure');
    source.bands[0].units = 'relative index 0–100';
    grid.bands[0].bandNumber = 7;
    expect(() => mapCalculation(input, source, grid)).toThrowError(/invalid or unexpected/);
    source.baselineName = 'another baseline';
    expect(compatibility(source).join()).toContain('no reviewed');
  });
  it('retains small native changes even when 16-level quantization is unchanged', () => {
    const { input, source, grid } = calculationFixture();
    const before = mapCalculation(input, source, grid);
    grid.bands[0].values[0] = 49.99;
    const slight = mapCalculation(input, source, grid);
    expect(slight.nativeGrid!.bands[0].values[0]).toBe(49.99);
    expect(slight.impacts!.layers[0].values[0]).toBe(before.impacts!.layers[0].values[0]);
    grid.bands[0].values[0] = 25;
    expect(mapCalculation(input, source, grid).impacts!.layers[0].values[0]).toBeCloseTo(0.05);
    expect(before.nativeGrid!.bands[0].values[0]).toBe(50);
  });
  it('resets both engine pressure maps before applying disjoint masks', () => {
    const { input } = calculationFixture();
    const request = impactRequest(input.impacts, 48);
    expect(request.pressures.slice(0, 2).map((p) => p.parameters.intensity)).toEqual([0, 0]);
    for (const layer of input.impacts!.layers) {
      const values = new Float32Array(input.water.length);
      for (const band of layer.bands) {
        expect(request.masks).toContain({ id: band.id, file: `${band.id}.png` });
        band.mask.forEach((value, i) => {
          if (value) {
            expect(values[i]).toBe(0);
            values[i] = band.intensity;
          }
        });
      }
      expect(values).toEqual(layer.values);
    }
  });
  it('rejects stale, misaligned and duplicate exported bands', () => {
    const { input, source, grid } = calculationFixture();
    grid.fingerprint = 'b'.repeat(64);
    expect(() => mapCalculation(input, source, grid)).toThrowError(/does not match/);
    grid.fingerprint = source.fingerprint;
    grid.grid.extent[0] -= 1000;
    expect(() => mapCalculation(input, source, grid)).toThrowError(/does not match/);
    grid.grid.extent[0] += 1000;
    grid.bands.push(grid.bands[0]);
    expect(() => mapCalculation(input, source, grid)).toThrowError(/invalid or unexpected/);
    grid.bands = [];
    expect(() => mapCalculation(input, source, grid)).toThrowError(/missing selected/);
  });
});
