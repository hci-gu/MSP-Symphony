import { CalculationInput, CalculationGrid, validateGrid } from './calculation-input';
import { PreparedInput } from './mareld-input';
import {
  defaultImpactSettings,
  IMPACT_BANDS,
  impactIntensity,
  ImpactKind,
  PreparedImpact
} from './mareld-impacts';

export const MAPPING_VERSION = 'hav-west-native-v1';
export const SIMULATION_ASSUMPTIONS = [
  'Historical normalized pressure indices are averaged within the saved calculation domain, then quantized to 16 positive levels.',
  'Noise (60–120) and trawling (0–0.2) model intensities are experimental; they are not calibrated dB or measured fishing mortality.',
  'Each 1 km cell with any native domain support is treated as one complete water cell. Domain fractions are retained; biomass totals sum these model cells without area weighting.',
  'Depth is synthetic zero. Native ecosystem bands and sensitivity matrices are contextual; initial biomass comes from the model.',
  'The model supplies no checkpoint version; model ID/name do not prove immutable model weights.'
];
const PRESSURES: Record<number, { kind: ImpactKind, source: string }> = {
  3: {
    kind: 'trawling',
    source: 'b0c2bb630a7694306139512667058d275b88ffb8cebe33f21ac66806c9f331bf'
  },
  13: { kind: 'noise', source: '716dbf1e91bb1dcd53b65a790799b8272682ea6eb44a973fa10d2392103d7dc1' }
};

export function compatibility(source: CalculationInput): string[] {
  const errors: string[] = [];
  if (!source.available) errors.push(...source.notes);
  if (source.baselineName !== 'HAV_2019_WEST_LOCAL')
    errors.push('This baseline has no reviewed EcoTwin mapping profile.');
  for (const band of source.bands.filter((b) => b.category === 'PRESSURE')) {
    const mapping = PRESSURES[band.bandNumber];
    if (!mapping || mapping.source !== band.sourceSha256 || band.units !== 'relative index 0–100')
      errors.push(
        `Unsupported selected pressure: ${band.title} (band ${band.bandNumber}). Create another calculation with supported pressures to run this profile.`
      );
  }
  return errors;
}

/** Translate only selected native inputs. Unknown support never becomes zero pressure. */
export function mapCalculation(
  input: PreparedInput,
  source: CalculationInput,
  grid: CalculationGrid
): PreparedInput {
  validateGrid(source, input, grid);
  const errors = compatibility(source);
  if (errors.length) throw new Error(errors.join(' '));
  const water = Uint8Array.from(grid.domainCoverage, (v) => Number(v > 0));
  const waterCells = water.reduce((sum, v) => sum + v, 0);
  if (!waterCells) throw new Error('The saved calculation has no supported native domain cells.');
  const settings = defaultImpactSettings();
  const layers: PreparedImpact[] = [];
  for (const native of source.bands.filter((b) => b.category === 'PRESSURE')) {
    const band = grid.bands.find(
      (b) => b.category === native.category && b.bandNumber === native.bandNumber
    );
    if (!band) throw new Error(`Missing exported pressure: ${native.title}.`);
    const kind = PRESSURES[native.bandNumber].kind;
    const values = new Float32Array(water.length);
    const masks = new Map<number, Uint8Array>();
    for (let i = 0; i < water.length; i++) {
      if (!water[i]) continue;
      const mean = band.values[i];
      if (band.coverage[i] < 1 - 1e-9 || mean === null)
        throw new Error(
          `${native.title} has missing source support inside the calculation domain. A partial-input simulation is not supported.`
        );
      // Native changes may exceed the baseline scale; record saturation explicitly in assumptions.
      const level =
        mean > 0 ? Math.max(1, Math.min(IMPACT_BANDS, Math.round((mean / 100) * IMPACT_BANDS))) : 0;
      if (!level) continue;
      values[i] = impactIntensity(kind, level, 1);
      if (!masks.has(level)) masks.set(level, new Uint8Array(water.length));
      masks.get(level)![i] = 1;
    }
    settings[kind].enabled = true;
    layers.push({
      kind,
      sourceId: `${source.baselineName}:PRESSURE:${native.bandNumber}`,
      sourceFile: `calculation/${source.calculationId}/input-grid`,
      sourceSha256: native.sourceSha256,
      sourceGrid: structuredClone(input.grid),
      strength: 1,
      coverage: 1,
      affectedCells: values.reduce((sum, v) => sum + Number(v > 0), 0),
      values,
      bands: [...masks]
        .sort(([a], [b]) => a - b)
        .map(([level, mask]) => ({
          id: `${kind}-${level.toString().padStart(2, '0')}`,
          level,
          mask,
          intensity: impactIntensity(kind, level, 1)
        }))
    });
  }
  return {
    ...input,
    water,
    waterCells,
    source: structuredClone(source),
    nativeGrid: structuredClone(grid),
    assumptions: [
      ...SIMULATION_ASSUMPTIONS,
      'Values above 100 saturate at the highest model intensity level.'
    ],
    impacts: {
      id: crypto.randomUUID(),
      inputId: input.id,
      version: MAPPING_VERSION,
      settings,
      layers
    }
  };
}
