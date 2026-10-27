import { EnsembleResult, MareldResult } from './mareld-result';

export interface BiomassSeries {
  id: string;
  name: string;
  color: string;
  values: (number | null)[];
  low?: (number | null)[];
  high?: (number | null)[];
}
export type BiomassDisplay = 'absolute' | 'relative';

export function speciesLabel(name: string): string {
  return (
    {
      codfish: 'Codfish',
      gadoids: 'Codfish',
      pelagicFish: 'Pelagic fish',
      pelagic_fish: 'Pelagic fish',
      porpoises: 'Porpoises',
      benthic_community: 'Benthic community',
      phytoplankton: 'Phytoplankton',
      zooplankton: 'Zooplankton',
      seabirds: 'Seabirds',
      seals: 'Seals'
    }[name] || name
  );
}

// Same palette and fallback order as Ecotwin's lib/species-colors.ts.
export function speciesColor(name: string, index: number): string {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    {
      phytoplankton: '#67a976',
      zooplankton: '#d8c66d',
      pelagicfish: '#9f6db5',
      codfish: '#4aa3f0',
      gadoids: '#4aa3f0',
      porpoises: '#8586dd',
      seabirds: '#7b78c9'
    }[key] || ['#14b8a6', '#f97316', '#84cc16', '#64748b'][index % 4]
  );
}

/** Sum the same frame,row,column,species tensor used by Ecotwin's BiomassChart.
 * Respect Symphony's captured water mask, including holes and disconnected areas.
 * Aggregate once per result; changing the map frame never rescans the tensor.
 */
export function aggregateBiomass(result: MareldResult): BiomassSeries[] {
  const series = result.species.map((name, index) => ({
    id: name,
    name: speciesLabel(name),
    color: speciesColor(name, index),
    values: new Array<number>(result.steps.length).fill(0)
  }));
  const speciesCount = series.length;
  const cells = result.input.water.length;
  for (let frame = 0; frame < result.steps.length; frame++) {
    for (let cell = 0; cell < cells; cell++) {
      if (!result.input.water[cell]) continue;
      const offset = (frame * cells + cell) * speciesCount;
      for (let species = 0; species < speciesCount; species++) {
        series[species].values[frame] += result.values[offset + species];
      }
    }
  }
  return series;
}

export function biomassLines(
  series: BiomassSeries[],
  hidden: string[],
  display: BiomassDisplay,
  showTotal: boolean
): BiomassSeries[] {
  const selected = series.filter((line) => !hidden.includes(line.id));
  if (!selected.length) return [];
  const lines = [...selected];
  if (showTotal) {
    lines.unshift({
      id: '__total',
      name: 'Total',
      color: '#0f172a',
      values: selected[0].values.map((_, frame) =>
        selected.reduce((sum, line) => sum + (line.values[frame] ?? 0), 0)
      )
    });
  }
  if (display === 'absolute') return lines;
  return lines.map((line) => {
    const initial = line.values[0] ?? 0;
    return {
      ...line,
      values: line.values.map((value) =>
        initial > 0 && value !== null ? (value / initial) * 100 : null
      )
    };
  });
}

export function nearestBiomassFrame(steps: number[], step: number): number {
  let nearest = 0;
  for (let i = 1; i < steps.length; i++) {
    if (Math.abs(steps[i] - step) < Math.abs(steps[nearest] - step)) nearest = i;
  }
  return nearest;
}

/** Recompute intervals after grouping/normalizing each seed, preserving covariance. */
export function ensembleLines(
  result: MareldResult,
  hidden: string[],
  display: BiomassDisplay,
  showTotal: boolean
): BiomassSeries[] {
  const ensemble = result.ensemble;
  if (!ensemble) return biomassLines(aggregateBiomass(result), hidden, display, showTotal);
  return ensembleBiomassLines({ ...result, ensemble }, hidden, display, showTotal);
}

/** Build curves from saved seed totals without requiring the spatial replay tensor. */
export function ensembleBiomassLines(
  result: Pick<MareldResult, 'species' | 'steps'> & { ensemble: EnsembleResult },
  hidden: string[],
  display: BiomassDisplay,
  showTotal: boolean
): BiomassSeries[] {
  const ensemble = result.ensemble;
  const selected = result.species
    .map((name, index) => ({ name, index }))
    .filter((s) => !hidden.includes(s.name));
  if (!selected.length) return [];
  const groups = selected.map((s) => ({
    id: s.name,
    name: speciesLabel(s.name),
    color: speciesColor(s.name, s.index),
    indices: [s.index]
  }));
  if (showTotal)
    groups.unshift({
      id: '__total',
      name: 'Total',
      color: '#0f172a',
      indices: selected.map((s) => s.index)
    });
  return groups.map((group) => {
    const samples = ensemble.totals.map((seed) =>
      result.steps.map((_, frame) => group.indices.reduce((sum, s) => sum + seed[s][frame], 0))
    );
    const undefinedRelative = display === 'relative' && samples.some((seed) => seed[0] <= 0);
    if (display === 'relative' && !undefinedRelative)
      samples.forEach((seed) => {
        const initial = seed[0];
        seed.forEach((value, i) => (seed[i] = (value / initial) * 100));
      });
    const values: (number | null)[] = [],
      low: (number | null)[] = [],
      high: (number | null)[] = [];
    result.steps.forEach((_, frame) => {
      if (undefinedRelative) {
        values.push(null);
        low.push(null);
        high.push(null);
        return;
      }
      const mean = samples.reduce((sum, seed) => sum + seed[frame], 0) / samples.length;
      const variance =
        samples.reduce((sum, seed) => sum + (seed[frame] - mean) ** 2, 0) / (samples.length - 1);
      const half = 2.2621571627409915 * Math.sqrt(variance / samples.length);
      values.push(mean);
      low.push(mean - half);
      high.push(mean + half);
    });
    return { ...group, values, low, high };
  });
}
