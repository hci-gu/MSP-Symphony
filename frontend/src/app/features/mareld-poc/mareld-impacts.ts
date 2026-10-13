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
  version: 'hav-west-native-v1';
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
