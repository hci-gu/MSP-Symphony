import { transform } from 'ol/proj';
import { CELL_METRES, GRID_CRS, registerGridProjection, StudyArea } from '../mareld-input';

/** A full 60 × 60 cell synthetic water world, at the model's reference scale. */
export function exampleArea(): StudyArea {
  registerGridProjection();
  const [x, y] = transform([16.6, 56.4], 'EPSG:4326', GRID_CRS);
  const originX = Math.floor(x / CELL_METRES) * CELL_METRES,
    originY = Math.floor(y / CELL_METRES) * CELL_METRES;
  const ring = (points: number[][]) =>
    points.map(([dx, dy]) =>
      transform([originX + dx * CELL_METRES, originY + dy * CELL_METRES], GRID_CRS, 'EPSG:4326')
    );
  return {
    type: 'Feature',
    properties: { name: 'Example 60 × 60 world' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        ring([
          [0, 0],
          [60, 0],
          [60, 60],
          [0, 60],
          [0, 0]
        ])
      ]
    }
  };
}
