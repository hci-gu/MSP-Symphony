import { impactOutlineLines } from './ecotwin-impact-outline';
import { biomassFixture } from './testing/biomass.fixture';
import { impactFixture } from './testing/impact.fixture';

describe('ECOTWIN impact footprints', () => {
  function outline(width: number, height: number, values: number[], water?: number[]) {
    const input = biomassFixture().input;
    input.grid = { ...input.grid, width, height, extent: [0, 0, width * 1000, height * 1000] };
    input.water = new Uint8Array(water ?? values.map(() => 1));
    const layer = impactFixture(input).layers[0];
    layer.values = new Float32Array(values);
    return impactOutlineLines(input, layer);
  }

  it('outlines adjoining bands as one footprint without an internal seam', () => {
    expect(outline(2, 1, [10, 20])).toEqual([
      [
        [0, 1000],
        [2000, 1000]
      ],
      [
        [0, 0],
        [2000, 0]
      ],
      [
        [0, 1000],
        [0, 0]
      ],
      [
        [2000, 1000],
        [2000, 0]
      ]
    ]);
  });

  it('preserves an inaccessible hole even if the pressure array contains a value there', () => {
    const lines = outline(3, 3, Array(9).fill(1), [1, 1, 1, 1, 0, 1, 1, 1, 1]);
    expect(lines.length).toBe(8);
    expect(lines).toContain([
      [1000, 2000],
      [2000, 2000]
    ]);
    expect(lines).toContain([
      [1000, 1000],
      [2000, 1000]
    ]);
    expect(lines.reduce((length, [a, b]) => length + Math.hypot(a[0] - b[0], a[1] - b[1]), 0)).toBe(
      16000
    );
  });

  it('keeps disconnected cells separate and emits no footprint for zero pressure', () => {
    expect(outline(3, 1, [1, 0, 1]).length).toBe(8);
    expect(outline(3, 1, [0, 0, 0])).toEqual([]);
  });
});
