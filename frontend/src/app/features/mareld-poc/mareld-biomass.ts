import { MareldResult } from './mareld-result';

export interface BiomassSeries {
  id: string;
  name: string;
  color: string;
  values: (number | null)[];
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
