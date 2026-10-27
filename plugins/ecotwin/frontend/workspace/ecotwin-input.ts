import { PROFILE } from '../profile';
import type { SimulationGrid } from '../contracts';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import GeoJSON from 'ol/format/GeoJSON';
import type { Polygon as OlPolygon, MultiPolygon as OlMultiPolygon } from 'ol/geom';
import { GRID_CRS, registerGridProjection } from '../shared/map-raster';
import type { PreparedImpacts } from './ecotwin-impacts';
import type { CalculationInput, CalculationGrid } from './calculation-input';
export { GRID_CRS, registerGridProjection } from '../shared/map-raster';

export const CELL_METRES = PROFILE.grid.cellMetres;
export const MAX_GRID_SIDE = PROFILE.grid.maxCells;
export type StudyArea = Feature<Polygon | MultiPolygon>;
export interface PreparedInput {
  id: string;
  name: string;
  geometry: StudyArea;
  grid: SimulationGrid;
  /** Row zero is the northern row. One means accessible synthetic water. */
  water: Uint8Array;
  waterCells: number;
  source?: CalculationInput;
  nativeGrid?: CalculationGrid;
  assumptions?: string[];
  /** Immutable-by-convention snapshot of the demo inputs submitted with this run. */
  impacts?: PreparedImpacts;
}

export function prepareInput(
  feature: StudyArea,
  name: string,
  exportedGrid?: PreparedInput['grid']
): PreparedInput {
  registerGridProjection();
  if (!feature?.geometry || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) {
    throw new Error('Choose one polygon or multipolygon in the Areas panel.');
  }
  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  let vertices = 0;
  if (!polygons.length) throw new Error('The selected area is empty.');
  for (const polygon of polygons) {
    if (!polygon.length) throw new Error('The selected area has no outer boundary.');
    for (const ring of polygon) {
      vertices += ring.length;
      if (
        ring.length < 4 ||
        ring.some(
          (p) =>
            p.length < 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 85
        ) ||
        ring[0][0] !== ring[ring.length - 1][0] ||
        ring[0][1] !== ring[ring.length - 1][1]
      ) {
        throw new Error('The area must have closed, valid longitude/latitude polygon rings.');
      }
    }
  }
  if (vertices > 20000)
    throw new Error('This area is too complex for the POC. Choose a simpler area.');
  // Snapshot only geometry and display name; never retain live store objects.
  const snapshot: StudyArea = {
    type: 'Feature',
    properties: { name },
    geometry: JSON.parse(JSON.stringify(feature.geometry))
  };
  const projected = new GeoJSON().readGeometry(snapshot.geometry, {
    dataProjection: 'EPSG:4326',
    featureProjection: GRID_CRS
  }) as OlPolygon | OlMultiPolygon;
  if (!(projected.getArea() > 0)) throw new Error('The selected polygon has no valid area.');
  if (
    exportedGrid &&
    (exportedGrid.crs !== GRID_CRS ||
      exportedGrid.cellMetres !== CELL_METRES ||
      exportedGrid.extent.length !== 4 ||
      exportedGrid.width * CELL_METRES !== exportedGrid.extent[2] - exportedGrid.extent[0] ||
      exportedGrid.height * CELL_METRES !== exportedGrid.extent[3] - exportedGrid.extent[1])
  )
    throw new Error('Invalid native calculation grid.');
  const bounds = exportedGrid?.extent ?? projected.getExtent();
  if (!bounds.every(Number.isFinite))
    throw new Error('The selected area cannot be projected to the simulation grid.');
  // A projection round trip can move an exact grid boundary by a fraction of a
  // millimetre. Snap that numerical noise before floor/ceil adds an extra cell.
  const cellBounds = bounds.map((metres) => {
    const cells = metres / CELL_METRES;
    return Math.abs(cells - Math.round(cells)) < 1e-6 ? Math.round(cells) : cells;
  });
  let x0 = Math.floor(cellBounds[0]) * CELL_METRES;
  let y0 = Math.floor(cellBounds[1]) * CELL_METRES;
  const rawWidth = Math.ceil(cellBounds[2]) - x0 / CELL_METRES;
  const rawHeight = Math.ceil(cellBounds[3]) - y0 / CELL_METRES;
  const width = Math.max(3, rawWidth),
    height = Math.max(3, rawHeight);
  if (width > MAX_GRID_SIDE || height > MAX_GRID_SIDE) {
    throw new Error(
      `This area needs a ${width} × ${height} grid. Draw a smaller area (at most 60 × 60 km).`
    );
  }
  x0 -= Math.floor((width - rawWidth) / 2) * CELL_METRES;
  y0 -= Math.floor((height - rawHeight) / 2) * CELL_METRES;
  const extent: [number, number, number, number] = [
    x0,
    y0,
    x0 + width * CELL_METRES,
    y0 + height * CELL_METRES
  ];
  const water = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      water[row * width + col] = Number(
        projected.intersectsCoordinate([
          x0 + (col + 0.5) * CELL_METRES,
          extent[3] - (row + 0.5) * CELL_METRES
        ])
      );
    }
  }
  const waterCells = water.reduce((sum, value) => sum + value, 0);
  if (!waterCells && !exportedGrid)
    throw new Error('No 1 km cell centers fall inside this area. Draw a wider area.');
  return {
    id: crypto.randomUUID(),
    name,
    geometry: snapshot,
    grid: { crs: GRID_CRS, extent, width, height, cellMetres: CELL_METRES },
    water,
    waterCells
  };
}

export function rasterCanvas(
  input: PreparedInput,
  kind: 'texture' | 'depth' | 'preview'
): HTMLCanvasElement {
  const { width, height } = input.grid;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const pixels = context.createImageData(width, height);
  for (let i = 0; i < input.water.length; i++) {
    const value = kind === 'depth' || input.water[i] ? 0 : 255;
    const color =
      kind === 'preview'
        ? input.water[i]
          ? [41, 139, 155]
          : [235, 240, 242]
        : [value, value, value];
    pixels.data.set([...color, 255], i * 4);
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

export function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the input PNG.'))),
      'image/png'
    )
  );
}
