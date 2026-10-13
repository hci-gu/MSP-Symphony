import { prepareImpact, impactRequest, impactIntensity, ImpactSource } from './mareld-impacts';
import { PreparedInput } from './mareld-input';
import { impactFixture } from './testing/impact.fixture';

describe('MARELD demo impact preparation', () => {
  const input: PreparedInput = {
    id: 'target',
    name: 'Test',
    geometry: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } },
    grid: { crs: 'EPSG:3035', extent: [0, 0, 2000, 2000], width: 2, height: 2, cellMetres: 1000 },
    water: new Uint8Array([1, 1, 1, 0]),
    waterCells: 3
  };
  function source(): ImpactSource {
    return {
      grid: { crs: 'EPSG:3035', extent: [0, 0, 2000, 2000], width: 4, height: 4, cellMetres: 500 },
      raster: {
        values: new Float32Array([
          0, 0, 100, 100, 0, 0, 100, 100, 50, 50, 100, 100, 50, 50, 100, 100
        ]),
        provenance: new Uint8Array(16).fill(1)
      },
      file: 'source.bin',
      sha256: 'hash'
    };
  }

  it('aggregates north-first source cells, preserves zero, and excludes inaccessible cells', () => {
    const layer = prepareImpact(input, 'noise', 1, source());
    expect(Array.from(layer.values)).toEqual([0, 120, 90, 0]);
    expect(layer.coverage).toBe(1);
    expect(layer.affectedCells).toBe(2);
    expect(layer.bands.map((b) => b.level)).toEqual([8, 16]);
    expect(Array.from(layer.bands[0].mask)).toEqual([0, 0, 1, 0]);
  });

  it('uses overlap area for offset grids and zero contribution from unknown/inferred portions', () => {
    const data = source();
    data.grid.extent = [500, 0, 2500, 2000];
    data.raster.values.fill(100);
    data.raster.values[0] = NaN;
    data.raster.provenance[0] = 0;
    data.raster.provenance[4] = 3;
    const layer = prepareImpact(input, 'trawling', 1, data);
    expect(layer.values[0]).toBe(0);
    expect(layer.values[1]).toBeCloseTo(0.2, 6);
    expect(layer.values[2]).toBeCloseTo(0.1, 6);
    expect(layer.coverage).toBeCloseTo(0.5, 6);
  });

  it('distinguishes absent source coverage from a supported all-zero field', () => {
    const data = source();
    data.raster.values.fill(0);
    expect(prepareImpact(input, 'noise', 1, data).coverage).toBe(1);
    data.grid.extent = [10000, 10000, 12000, 12000];
    const outside = prepareImpact(input, 'noise', 1, data);
    expect(outside.coverage).toBe(0);
    expect(outside.bands).toEqual([]);
  });

  it('caps demo noise strength, keeps trawling far below full mortality, and handles strength zero', () => {
    expect(impactIntensity('noise', 16, 2)).toBe(140);
    expect(impactIntensity('trawling', 16, 2)).toBe(0.4);
    expect(prepareImpact(input, 'noise', 0, source()).bands).toEqual([]);
    for (const value of [NaN, -1, 3])
      expect(() => prepareImpact(input, 'noise', value, source())).toThrowError(/between 0 and 2/);
  });

  it('resets both pressure maps before nonoverlapping bands and reproduces the prepared field', () => {
    const prepared = impactFixture(input);
    const request = impactRequest(prepared, 48);
    expect(request.pressures.slice(0, 2).map((p) => p.parameters.intensity)).toEqual([0, 0]);
    for (const layer of prepared.layers) {
      const reconstructed = new Float32Array(input.water.length);
      for (const band of layer.bands) {
        expect(request.masks).toContain({ id: band.id, file: `${band.id}.png` });
        band.mask.forEach((value, i) => {
          if (!value) return;
          expect(reconstructed[i]).toBe(0);
          reconstructed[i] = band.intensity;
        });
      }
      expect(Array.from(reconstructed)).toEqual(Array.from(layer.values));
    }
    expect(
      request.pressures.every(
        (p) => p.time_window.start_step === 0 && p.time_window.end_step === 48
      )
    ).toBeTrue();
    expect(impactRequest(undefined, 48)).toEqual({ masks: [], pressures: [] });
  });
});
