import { exampleArea } from './testing/example-area.fixture';
import { transform } from 'ol/proj';
import type { Polygon } from 'geojson';
import {
  GRID_CRS,
  prepareInput,
  rasterCanvas,
  registerGridProjection,
  StudyArea
} from './mareld-input';

describe('MARELD study area rasterization', () => {
  // Asymmetric grid in metres, away from snapping boundaries after reprojection.
  function polygon(rings: number[][][]): StudyArea {
    registerGridProjection();
    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: rings.map((ring) =>
          ring.map(([x, y]) => transform([4321000 + x, 3210000 + y], GRID_CRS, 'EPSG:4326'))
        )
      }
    };
  }
  const outer = [
    [100, 100],
    [4900, 100],
    [4900, 2900],
    [100, 2900],
    [100, 100]
  ];
  const hole = [
    [1100, 1100],
    [1100, 1900],
    [1900, 1900],
    [1900, 1100],
    [1100, 1100]
  ];

  it('prepares the example as exactly 60 by 60 water cells after reprojection', () => {
    const input = prepareInput(exampleArea(), 'Example');
    expect(input.grid.width).toBe(60);
    expect(input.grid.height).toBe(60);
    expect(input.grid.extent[2] - input.grid.extent[0]).toBe(60000);
    expect(input.grid.extent[3] - input.grid.extent[1]).toBe(60000);
    expect(input.waterCells).toBe(3600);
    expect(input.water.every((cell) => cell === 1)).toBeTrue();
  });

  it('keeps north at row zero, preserves holes and uses a metric rectangular grid', () => {
    const input = prepareInput(polygon([outer, hole]), 'Area');
    expect(input.grid.width).toBe(5);
    expect(input.grid.height).toBe(3);
    expect(input.grid.extent).toEqual([4321000, 3210000, 4326000, 3213000]);
    expect(Array.from(input.water)).toEqual([1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(input.waterCells).toBe(14);
    const texture = rasterCanvas(input, 'texture').getContext('2d')!.getImageData(0, 0, 5, 3).data;
    expect(Array.from(texture.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(texture.slice(6 * 4, 7 * 4))).toEqual([255, 255, 255, 255]);
    const depth = rasterCanvas(input, 'depth').getContext('2d')!.getImageData(0, 0, 5, 3).data;
    expect(depth[6 * 4]).toBe(0);
  });

  it('snapshots geometry and supports disconnected multipolygons', () => {
    const a = polygon([
      [
        [100, 2100],
        [900, 2100],
        [900, 2900],
        [100, 2900],
        [100, 2100]
      ]
    ]);
    const b = polygon([
      [
        [4100, 100],
        [4900, 100],
        [4900, 900],
        [4100, 900],
        [4100, 100]
      ]
    ]);
    const feature: StudyArea = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [(a.geometry as Polygon).coordinates, (b.geometry as Polygon).coordinates]
      }
    };
    const input = prepareInput(feature, 'Islands');
    expect(input.waterCells).toBe(2);
    expect(input.water[0]).toBe(1);
    expect(input.water[14]).toBe(1);
    expect(input.geometry.geometry).not.toBe(feature.geometry);
  });

  it('rejects a too-large grid, unclosed rings and an area containing no cell centers', () => {
    expect(() =>
      prepareInput(
        polygon([
          [
            [100, 100],
            [61000, 100],
            [61000, 3000],
            [100, 100]
          ]
        ]),
        'Large'
      )
    ).toThrowError(/smaller area/);
    expect(() => prepareInput(polygon([outer.slice(0, 4)]), 'Open')).toThrowError(/closed/);
    expect(() =>
      prepareInput(
        polygon([
          [
            [100, 100],
            [200, 100],
            [200, 200],
            [100, 100]
          ]
        ]),
        'Small'
      )
    ).toThrowError(/No 1 km cell centers/);
  });
});
