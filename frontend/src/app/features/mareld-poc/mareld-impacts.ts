import type { LayerRaster } from '../mareld-layers/mareld-layer-data';
import type { PreparedInput } from './mareld-input';

export type ImpactKind = 'noise' | 'trawling';
export type ImpactSettings = Record<ImpactKind, { enabled: boolean, strength: number }>;
export const IMPACT_KINDS: ImpactKind[] = ['noise', 'trawling'];
export const IMPACT_BANDS = 16;
export const IMPACT_DEFINITIONS = {
  noise: { title: 'Shipping noise', sourceId: 'noise-125hz-shipping', type: 'noise_pressure' },
  trawling: { title: 'Bottom trawling', sourceId: 'catch-bottom-trawl', type: 'trawling_pressure' }
} as const;

export function defaultImpactSettings(): ImpactSettings {
  return { noise: { enabled: false, strength: 1 }, trawling: { enabled: false, strength: 1 } };
}

export interface ImpactSource {
  grid: PreparedInput['grid'];
  raster: LayerRaster;
  file: string;
  sha256: string;
}
export interface ImpactBand {
  id: string;
  level: number;
  intensity: number;
  mask: Uint8Array;
}
export interface PreparedImpact {
  kind: ImpactKind;
  sourceId: string;
  sourceFile: string;
  sourceSha256: string;
  sourceGrid: PreparedInput['grid'];
  strength: number;
  /** Area-weighted source support, relative to all accessible target-cell area. */
  coverage: number;
  affectedCells: number;
  /** Exact band intensities, rounded to the engine's Float32 representation. */
  values: Float32Array;
  bands: ImpactBand[];
}
export interface PreparedImpacts {
  id: string;
  inputId: string;
  version: 'symphony-demo-impacts-v1';
  settings: ImpactSettings;
  layers: PreparedImpact[];
}
export interface ApiPressure {
  id: string;
  type: 'noise_pressure' | 'trawling_pressure';
  scope: { kind: 'whole_grid' } | { kind: 'mask', mask_id: string };
  parameters: { intensity: number };
  time_window: { start_step: number, end_step: number };
}

/** Demo response strengths, not conversions into measured dB or fishing mortality. */
export function impactIntensity(kind: ImpactKind, level: number, strength: number): number {
  if (!level || !strength) return 0;
  const fraction = level / IMPACT_BANDS;
  return kind === 'noise'
    ? Math.min(140, 60 + 60 * fraction * strength)
    : 0.2 * fraction * strength;
}

/** Area-weighted mean over each entire target cell. Unknown area contributes zero.
 * Both shipped inputs are relative indices, so arithmetic aggregation is intentional.
 * Rows run north to south. Polygon access is already captured in input.water.
 */
export function prepareImpact(
  input: PreparedInput,
  kind: ImpactKind,
  strength: number,
  source: ImpactSource
): PreparedImpact {
  if (!Number.isFinite(strength) || strength < 0 || strength > 2)
    throw new Error('Choose an impact strength between 0 and 2.');
  const target = input.grid,
    grid = source.grid;
  if (grid.crs !== target.crs) throw new Error('Impact data must use the simulation projection.');
  const values = new Float32Array(input.water.length);
  const masks = new Map<number, Uint8Array>();
  let knownArea = 0,
    affectedCells = 0;
  for (let row = 0; row < target.height; row++) {
    const top = target.extent[3] - row * target.cellMetres;
    const bottom = top - target.cellMetres;
    for (let col = 0; col < target.width; col++) {
      const i = row * target.width + col;
      if (!input.water[i]) continue;
      const left = target.extent[0] + col * target.cellMetres;
      const right = left + target.cellMetres;
      const r0 = Math.max(0, Math.floor((grid.extent[3] - top) / grid.cellMetres));
      const r1 = Math.min(grid.height, Math.ceil((grid.extent[3] - bottom) / grid.cellMetres));
      const c0 = Math.max(0, Math.floor((left - grid.extent[0]) / grid.cellMetres));
      const c1 = Math.min(grid.width, Math.ceil((right - grid.extent[0]) / grid.cellMetres));
      let weighted = 0;
      for (let r = r0; r < r1; r++) {
        const sourceTop = grid.extent[3] - r * grid.cellMetres;
        const dy = Math.max(
          0,
          Math.min(top, sourceTop) - Math.max(bottom, sourceTop - grid.cellMetres)
        );
        for (let c = c0; c < c1; c++) {
          const j = r * grid.width + c;
          // Use original/recovered source only; never inferred values.
          if (![1, 2].includes(source.raster.provenance[j])) continue;
          const sourceLeft = grid.extent[0] + c * grid.cellMetres;
          const dx = Math.max(
            0,
            Math.min(right, sourceLeft + grid.cellMetres) - Math.max(left, sourceLeft)
          );
          const area = dx * dy;
          weighted += source.raster.values[j] * area;
          knownArea += area;
        }
      }
      const mean = weighted / target.cellMetres ** 2;
      // Keep exact zeros; positive values have at least the first nonzero band.
      const level =
        mean > 0 && strength > 0
          ? Math.max(1, Math.min(IMPACT_BANDS, Math.round((mean / 100) * IMPACT_BANDS)))
          : 0;
      if (!level) continue;
      values[i] = impactIntensity(kind, level, strength);
      if (!masks.has(level)) masks.set(level, new Uint8Array(values.length));
      masks.get(level)![i] = 1;
      affectedCells++;
    }
  }
  return {
    kind,
    sourceId: IMPACT_DEFINITIONS[kind].sourceId,
    sourceFile: source.file,
    sourceSha256: source.sha256,
    sourceGrid: { ...grid, extent: [...grid.extent] },
    strength,
    coverage: Math.min(1, knownArea / (input.waterCells * target.cellMetres ** 2)),
    affectedCells,
    values,
    bands: [...masks]
      .sort(([a], [b]) => a - b)
      .map(([level, mask]) => ({
        id: `${kind}-${level.toString().padStart(2, '0')}`,
        level,
        intensity: impactIntensity(kind, level, strength),
        mask
      }))
  };
}

export function impactRequest(
  impacts: PreparedImpacts | undefined,
  maxSteps: number
): {
  pressures: ApiPressure[];
  masks: { id: string, file: string }[];
} {
  if (!impacts) return { pressures: [], masks: [] };
  const time_window = { start_step: 0, end_step: maxSteps };
  // Reset BOTH maps first, even if only one impact is enabled. Entries are ordered.
  const pressures: ApiPressure[] = IMPACT_KINDS.map((kind) => ({
    id: `${kind}-reset`,
    type: IMPACT_DEFINITIONS[kind].type,
    scope: { kind: 'whole_grid' },
    parameters: { intensity: 0 },
    time_window
  }));
  const masks: { id: string, file: string }[] = [];
  for (const layer of impacts.layers) {
    for (const band of layer.bands) {
      masks.push({ id: band.id, file: `${band.id}.png` });
      pressures.push({
        id: band.id,
        type: IMPACT_DEFINITIONS[layer.kind].type,
        scope: { kind: 'mask', mask_id: band.id },
        parameters: { intensity: band.intensity },
        time_window
      });
    }
  }
  return { pressures, masks };
}

export function impactMaskCanvas(input: PreparedInput, mask: Uint8Array): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = input.grid.width;
  canvas.height = input.grid.height;
  const context = canvas.getContext('2d')!;
  const pixels = context.createImageData(canvas.width, canvas.height);
  mask.forEach((value, i) =>
    pixels.data.set([value ? 255 : 0, value ? 255 : 0, value ? 255 : 0, 255], i * 4)
  );
  context.putImageData(pixels, 0, 0);
  return canvas;
}

export function impactPixels(input: PreparedInput, layer: PreparedImpact): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(input.water.length * 4);
  const maximum = impactIntensity(layer.kind, IMPACT_BANDS, layer.strength);
  const low = layer.kind === 'noise' ? [90, 25, 140] : [145, 40, 30];
  const high = layer.kind === 'noise' ? [255, 210, 95] : [255, 205, 75];
  layer.values.forEach((value, i) => {
    if (!input.water[i]) return;
    const minimum = layer.kind === 'noise' ? 60 : 0;
    const t = maximum > minimum ? Math.max(0, (value - minimum) / (maximum - minimum)) : 0;
    const color = value ? low.map((v, c) => Math.round(v + (high[c] - v) * t)) : [223, 231, 235];
    pixels.set([...color, 255], i * 4);
  });
  return pixels;
}

export function impactPreview(input: PreparedInput, layer: PreparedImpact): string {
  const canvas = document.createElement('canvas');
  canvas.width = input.grid.width;
  canvas.height = input.grid.height;
  const context = canvas.getContext('2d')!;
  const data = context.createImageData(canvas.width, canvas.height);
  data.data.set(impactPixels(input, layer));
  context.putImageData(data, 0, 0);
  return canvas.toDataURL();
}
