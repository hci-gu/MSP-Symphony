import { exampleArea } from './testing/example-area.fixture';
import { prepareInput } from './ecotwin-input';
import {
  checkBudget,
  decodeResult,
  framePixels,
  MAX_TENSOR_BYTES,
  runSteps,
  sampleEvery
} from './ecotwin-result';

describe('ECOTWIN API result boundary', () => {
  const species = ['codfish', 'pelagicFish'];
  function fixture() {
    const input = prepareInput(exampleArea(), 'Fixture');
    input.grid.width = 5;
    input.grid.height = 3;
    input.water = new Uint8Array(15).fill(1);
    input.water[1] = 0;
    const values = Array.from({ length: 60 }, (_, i) => i);
    function envelope(data = values) {
      const bytes = new Uint8Array(data.length * 4);
      const view = new DataView(bytes.buffer);
      data.forEach((v, i) => view.setFloat32(i * 4, v, true));
      return {
        run_id: 'test',
        status: 'completed',
        result: {
          dtype: 'float32',
          shape: [2, 3, 5, 2],
          steps: [0, 1],
          species,
          biomass_b64: btoa(String.fromCharCode(...bytes))
        }
      };
    }
    return { input, values, envelope };
  }

  it('decodes little endian, rectangular, species-interleaved frames without transposition', () => {
    const f = fixture();
    const result = decodeResult(f.envelope(), f.input, species, 1, 'Test');
    expect(Array.from(result.values)).toEqual(f.values);
    expect(result.maxima).toEqual([58, 59]);
    expect(Array.from(framePixels(result, 1, 1).slice(14 * 4, 15 * 4))).toEqual([
      255, 235, 80, 255
    ]);
    expect(framePixels(result, 0, 0)[3]).toBe(255); // Zero biomass remains visible.
    expect(framePixels(result, 0, 0)[7]).toBe(0); // Excluded cells remain transparent.
    result.values[30] = result.values[0];
    expect(Array.from(framePixels(result, 0, 0).slice(0, 4))).toEqual(
      Array.from(framePixels(result, 1, 0).slice(0, 4))
    );
  });

  it('rejects wrong dimensions, truncated tensors, different species and nonfinite values', () => {
    const f = fixture();
    const wrong = f.envelope();
    wrong.result.shape = [2, 5, 3, 2];
    expect(() => decodeResult(wrong, f.input, species, 1, 'Test')).toThrowError(/incompatible/);
    expect(() =>
      decodeResult(f.envelope(f.values.slice(1)), f.input, species, 1, 'Test')
    ).toThrowError(/size/);
    expect(() =>
      decodeResult(f.envelope(), f.input, [...species].reverse(), 1, 'Test')
    ).toThrowError(/incompatible/);
    f.values[7] = NaN;
    expect(() => decodeResult(f.envelope(), f.input, species, 1, 'Test')).toThrowError(
      /invalid biomass/
    );
  });

  it('includes the final partial sampling interval and enforces the response budget', () => {
    expect(runSteps(5)).toEqual([0, 4, 5]);
    expect(() => runSteps(0)).toThrow();
    expect(() => runSteps(1.5)).toThrow();
    expect(() => runSteps(10001)).toThrow();
    const f = fixture();
    f.input.grid.width = 60;
    f.input.grid.height = 60;
    expect(() => checkBudget(f.input, 64, 240)).toThrowError(/result limit/);
  });

  it('fits 5,000-step and 10,000-step worlds in the budget without dropping the final state', () => {
    const input = prepareInput(exampleArea(), 'Full world');
    expect(sampleEvery(5000)).toBe(100);
    expect(runSteps(5000)).toEqual(Array.from({ length: 51 }, (_, i) => i * 100));
    const partial = runSteps(5001);
    expect(partial[0]).toBe(0);
    expect(partial.slice(-2)).toEqual([4949, 5001]);
    for (const steps of [5000, 5001, 10000]) {
      expect(runSteps(steps).length).toBeLessThanOrEqual(51);
      expect(checkBudget(input, 6, steps) * 4).toBeLessThanOrEqual(MAX_TENSOR_BYTES);
    }
  });
});
