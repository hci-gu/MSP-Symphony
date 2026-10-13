import type { PreparedInput } from './mareld-input';
import type { PreparedImpact } from './mareld-impacts';

export const IMPACT_OUTLINE_STYLES = {
  noise: { color: '#57e3ff', lineDash: undefined },
  trawling: { color: '#bdff62', lineDash: [10, 5] }
};

/** Exposed cell edges only: no internal grid/band seams, with holes preserved.
 * Merge straight runs before projecting; coordinates follow the input grid.
 */
export function impactOutlineLines(input: PreparedInput, layer: PreparedImpact): number[][][] {
  const { width, height, cellMetres, extent } = input.grid;
  const active = (row: number, col: number): boolean =>
    row >= 0 &&
    row < height &&
    col >= 0 &&
    col < width &&
    !!input.water[row * width + col] &&
    layer.values[row * width + col] > 0;
  const point = (row: number, col: number): number[] => [
    extent[0] + col * cellMetres,
    extent[3] - row * cellMetres
  ];
  const lines: number[][][] = [];
  for (let row = 0; row <= height; row++) {
    let start = -1;
    for (let col = 0; col <= width; col++) {
      const edge = col < width && active(row - 1, col) !== active(row, col);
      if (edge && start < 0) start = col;
      if (!edge && start >= 0) {
        lines.push([point(row, start), point(row, col)]);
        start = -1;
      }
    }
  }
  for (let col = 0; col <= width; col++) {
    let start = -1;
    for (let row = 0; row <= height; row++) {
      const edge = row < height && active(row, col - 1) !== active(row, col);
      if (edge && start < 0) start = row;
      if (!edge && start >= 0) {
        lines.push([point(start, col), point(row, col)]);
        start = -1;
      }
    }
  }
  return lines;
}
