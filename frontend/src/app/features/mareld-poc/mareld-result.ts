import { PreparedInput } from './mareld-input';

import { MARELD_RUN } from '../mareld-shared/run-config';

export const MAX_TENSOR_BYTES = MARELD_RUN.maxTensorBytes;
export const DEFAULT_STEPS = MARELD_RUN.defaultSteps;
export const MAX_STEPS = MARELD_RUN.maxSteps;

/** Compute every simulation step, retaining at most 51 map frames. */
export function sampleEvery(maxSteps: number): number {
  return Math.max(4, Math.ceil(maxSteps / 50));
}
export interface MareldModel {
  id: string;
  name: string;
  species: string[];
}
export interface MareldResult {
  id: string;
  source: 'live' | 'saved';
  modelId?: string;
  completedAt?: number;
  model: string;
  input: PreparedInput;
  species: string[];
  steps: number[];
  values: Float32Array;
  /** One scale maximum per species, held fixed across every frame. */
  maxima: number[];
}

export function runSteps(maxSteps: number): number[] {
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_STEPS)
    throw new Error(`Choose 1–${MAX_STEPS.toLocaleString('en-US')} simulation steps.`);
  const interval = sampleEvery(maxSteps);
  const steps = Array.from({ length: Math.floor(maxSteps / interval) + 1 }, (_, i) => i * interval);
  if (steps[steps.length - 1] !== maxSteps) steps.push(maxSteps);
  return steps;
}

export function checkBudget(input: PreparedInput, species: number, maxSteps: number): number {
  const count = input.grid.width * input.grid.height * species * runSteps(maxSteps).length;
  if (!Number.isInteger(species) || species < 1 || species > 64 || count * 4 > MAX_TENSOR_BYTES) {
    throw new Error('This run exceeds the POC result limit. Reduce the area or number of steps.');
  }
  return count;
}

export function speciesMaxima(values: Float32Array, speciesCount: number): number[] {
  const maxima = new Array<number>(speciesCount).fill(0);
  values.forEach((v, i) => {
    maxima[i % speciesCount] = Math.max(maxima[i % speciesCount], v);
  });
  return maxima;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function decodeResult(
  payload: unknown,
  input: PreparedInput,
  species: string[],
  maxSteps: number,
  model: string
): MareldResult {
  const envelope = record(payload);
  const result = record(envelope.result);
  const expectedSteps = runSteps(maxSteps);
  const count = checkBudget(input, species.length, maxSteps);
  const expectedShape = [expectedSteps.length, input.grid.height, input.grid.width, species.length];
  if (
    envelope?.status !== 'completed' ||
    result?.dtype !== 'float32' ||
    JSON.stringify(result.shape) !== JSON.stringify(expectedShape) ||
    JSON.stringify(result.species) !== JSON.stringify(species) ||
    JSON.stringify(result.steps) !== JSON.stringify(expectedSteps)
  ) {
    throw new Error(
      'The API returned an incompatible result shape, species list, or sampling schedule.'
    );
  }
  const encoded = result.biomass_b64;
  if (typeof encoded !== 'string' || encoded.length !== 4 * Math.ceil((count * 4) / 3))
    throw new Error('The result tensor has an unexpected size.');
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw new Error('The result tensor is not valid base64.');
  }
  if (binary.length !== count * 4)
    throw new Error('The result tensor has an unexpected byte length.');
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const data = new DataView(bytes.buffer);
  const values = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const v = data.getFloat32(i * 4, true);
    if (!Number.isFinite(v) || v < 0)
      throw new Error('The result contains invalid biomass values.');
    values[i] = v;
  }
  return {
    id: String(envelope.run_id || input.id),
    source: 'live',
    model,
    input,
    species: [...species],
    steps: expectedSteps,
    values,
    maxima: speciesMaxima(values, species.length)
  };
}

// Warm, saturated colors separate biomass from the blue sea and green land.
// The map and legend share the same evenly spaced stops and linear biomass scale.
export const BIOMASS_COLORS = [
  [63, 0, 125],
  [145, 30, 180],
  [225, 56, 100],
  [250, 133, 28],
  [255, 235, 80]
];
export const BIOMASS_GRADIENT = `linear-gradient(90deg, ${BIOMASS_COLORS.map((color) => `rgb(${color.join(',')})`).join(', ')})`;
export function framePixels(
  result: MareldResult,
  frame: number,
  species: number
): Uint8ClampedArray {
  const cells = result.input.water.length,
    stride = result.species.length;
  if (
    !Number.isInteger(frame) ||
    frame < 0 ||
    frame >= result.steps.length ||
    !Number.isInteger(species) ||
    species < 0 ||
    species >= stride
  )
    throw new Error('Invalid result frame or species.');
  const pixels = new Uint8ClampedArray(cells * 4);
  const maximum = result.maxima[species];
  for (let i = 0; i < cells; i++) {
    if (!result.input.water[i]) continue;
    const value = result.values[frame * cells * stride + i * stride + species];
    const fraction = maximum > 0 ? Math.min(1, value / maximum) : 0;
    const scaled = fraction * (BIOMASS_COLORS.length - 1);
    const segment = Math.min(BIOMASS_COLORS.length - 2, Math.floor(scaled)),
      t = scaled - segment;
    for (let channel = 0; channel < 3; channel++)
      pixels[i * 4 + channel] = Math.round(
        BIOMASS_COLORS[segment][channel] * (1 - t) + BIOMASS_COLORS[segment + 1][channel] * t
      );
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}
