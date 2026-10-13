import catalog from '@assets/mareld-layers/manifest.json';

export type LayerCategory = 'ECOSYSTEM' | 'PRESSURE';
export type LayerVariant = 'source' | 'extended' | 'lower' | 'upper';
export type LayerScope = 'square' | 'park';
export interface Coverage {
  source: number;
  recovered: number;
  inferred: number;
  unknown: number;
}
export interface LayerAsset {
  file: string;
  sha256: string;
  geotiff: string;
  coverage: Record<LayerScope, Coverage>;
}
export interface MareldDataset {
  id: string;
  title: string;
  category: LayerCategory;
  theme: string;
  future: boolean;
  note: string;
  positivePercent: Record<LayerScope, number>;
  extension: {
    method: string;
    sensitivity: string;
    maxDistanceKm: number;
    beyondValidationPercent: number;
    validation: {
      nearest_mae: number;
      regional_median_mae: number;
      max_tested_distance_km: number;
    };
  } | null;
  variants: Partial<Record<LayerVariant, LayerAsset>> & { source: LayerAsset };
}

export const MARELD_CATALOG = catalog as unknown as Omit<typeof catalog, 'layers'> & {
  layers: MareldDataset[];
};
export const MARELD_ASSETS = 'assets/mareld-layers/';
export const INDEX_GRADIENT =
  'linear-gradient(to right, #440154, #3b528b, #21918c, #5ec962, #fde725)';
const COLORS = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37]
];
const PROVENANCE_COLORS = [
  [185, 191, 196],
  [40, 132, 97],
  [44, 114, 190],
  [229, 159, 30]
];

export function matchingLayers(category: LayerCategory, search: string): MareldDataset[] {
  const query = search.trim().toLowerCase();
  return MARELD_CATALOG.layers.filter(
    (layer) =>
      layer.category === category &&
      `mareld ${layer.title} ${layer.theme} ${layer.extension ? 'extended inferred' : ''} ${layer.future ? '2050' : ''}`
        .toLowerCase()
        .includes(query)
  );
}

export function mareldLayersMatch(category: LayerCategory, search: string): boolean {
  return matchingLayers(category, search).length > 0;
}

export interface LayerRaster {
  values: Float32Array;
  provenance: Uint8Array;
}

export function decodeLayer(buffer: ArrayBuffer, cells: number): LayerRaster {
  if (buffer.byteLength !== cells * 5) throw new Error('The MARELD layer has an unexpected size.');
  const view = new DataView(buffer);
  const values = new Float32Array(cells);
  const provenance = new Uint8Array(buffer.slice(cells * 4));
  for (let i = 0; i < cells; i++) {
    const value = view.getFloat32(i * 4, true),
      code = provenance[i];
    if (
      code > 3 ||
      (code > 0 && (!Number.isFinite(value) || value < 0 || value > 100.0001)) ||
      (code === 0 && !Number.isNaN(value))
    )
      throw new Error('The MARELD layer contains invalid values or provenance.');
    values[i] = value;
  }
  return { values, provenance };
}

export function layerPixels(
  raster: LayerRaster,
  width: number,
  parkMask: Uint8Array,
  scope: LayerScope,
  showProvenance: boolean,
  hatch: boolean
): Uint8ClampedArray {
  if (parkMask.length !== raster.values.length)
    throw new Error('The wind-park mask has an unexpected size.');
  const pixels = new Uint8ClampedArray(raster.values.length * 4);
  raster.values.forEach((value, i) => {
    if (scope === 'park' && !parkMask[i]) return;
    const code = raster.provenance[i],
      stripe = ((i % width) + Math.floor(i / width)) % 6 === 0;
    let color: number[];
    if (showProvenance || code === 0) color = PROVENANCE_COLORS[code];
    else {
      const scaled = Math.min(100, value) / 25,
        low = Math.min(3, Math.floor(scaled)),
        t = scaled - low;
      color = COLORS[low].map((v, channel) => v + (COLORS[low + 1][channel] - v) * t);
      if (code === 3 && hatch && stripe) color = [245, 231, 195];
    }
    pixels.set([...color, code === 0 ? (stripe ? 170 : 60) : 235], i * 4);
  });
  return pixels;
}
