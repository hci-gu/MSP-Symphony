import {
  biomassLines,
  ensembleBiomassLines,
  speciesColor,
  speciesLabel,
  BiomassSeries
} from '../mareld-poc/mareld-biomass';
import { SimulationSummary } from './simulation-report-data.service';

/** Report graphs use saved totals only; no spatial tensor or live model is needed. */
export function biomassPercentSeries(run: SimulationSummary): BiomassSeries[] {
  const series = run.species.map((name, s) => {
    const totals = run.totals[s];
    if (
      !totals ||
      totals.length !== run.steps.length ||
      totals.some((v) => !Number.isFinite(v) || v < 0)
    )
      throw new Error('Invalid saved biomass summary.');
    return { id: name, name: speciesLabel(name), color: speciesColor(name, s), values: totals };
  });
  return run.ensemble
    ? ensembleBiomassLines({ ...run, ensemble: run.ensemble }, [], 'relative', false)
    : biomassLines(series, [], 'relative', false);
}

export function percentageExtent(lines: BiomassSeries[]): [number, number] {
  return [
    Math.floor(
      Math.min(0, ...lines.flatMap((line) => line.low ?? line.values).map((v) => v ?? 0)) / 25
    ) * 25,
    Math.ceil(
      Math.max(125, ...lines.flatMap((line) => line.high ?? line.values).map((v) => v ?? 0)) / 25
    ) * 25
  ];
}
