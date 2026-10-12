import { get as getProjection } from 'ol/proj';
import { register } from 'ol/proj/proj4';
import ImageStatic from 'ol/source/ImageStatic';
import proj4 from 'proj4';

export const GRID_CRS = 'EPSG:3035';

export function registerGridProjection(): void {
  if (!getProjection(GRID_CRS)) {
    proj4.defs(
      GRID_CRS,
      '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs'
    );
    register(proj4);
  }
}

/** North-first RGBA pixels on their original grid; each caller owns its layer. */
export function rasterSource(
  grid: { width: number, height: number, crs: string, extent: number[] },
  pixels: Uint8ClampedArray,
  attribution?: string
): ImageStatic {
  registerGridProjection();
  const canvas = document.createElement('canvas');
  canvas.width = grid.width;
  canvas.height = grid.height;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(grid.width, grid.height);
  image.data.set(pixels);
  context.putImageData(image, 0, 0);
  return new ImageStatic({
    url: canvas.toDataURL('image/png'),
    imageExtent: [...grid.extent],
    projection: grid.crs,
    interpolate: false,
    attributions: attribution
  });
}
