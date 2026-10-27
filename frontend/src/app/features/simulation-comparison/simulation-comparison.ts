import { SimulationSummary } from '../simulation-reports/simulation-report-data.service';
import {
  biomassPercentSeries,
  percentageExtent
} from '../simulation-reports/simulation-report-series';
import { BiomassSeries } from '../mareld-poc/mareld-biomass';

export interface SimulationComparisonSelection {
  baselineCalculationId: number;
  scenarioCalculationId: number;
  baselineRunId: string;
  scenarioRunId: string;
}
export interface SimulationComparisonChoice {
  enabled: boolean;
  selection: SimulationComparisonSelection | null;
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (items: string[]) => [...items].sort();

/** Intentional scenario layer changes differ; model, domain and source datasets must match. */
export function comparisonIssues(a: SimulationSummary, b: SimulationSummary): string[] {
  const issues: string[] = [];
  if (a.model.id !== b.model.id) issues.push('Choose the same model version.');
  if (!equal(sorted(a.species), sorted(b.species))) issues.push('The species sets differ.');
  if (
    a.config.maxSteps !== b.config.maxSteps ||
    a.config.tickDurationDays !== b.config.tickDurationDays ||
    a.config.sampleEvery !== b.config.sampleEvery ||
    !equal(a.steps, b.steps)
  )
    issues.push('Use the same duration and sampling times.');
  if (a.config.mappingVersion !== b.config.mappingVersion)
    issues.push('The input mapping versions differ.');
  if (
    a.source.baselineId !== b.source.baselineId ||
    !equal(
      Object.entries(a.source.sourceFingerprints).sort(),
      Object.entries(b.source.sourceFingerprints).sort()
    )
  )
    issues.push('Use the same baseline source datasets.');
  const bands = (r: SimulationSummary) =>
    sorted(
      r.source.bands.map(
        (band) => `${band.category}:${band.bandNumber}:${band.units}:${band.sourceSha256}`
      )
    );
  if (!equal(bands(a), bands(b))) issues.push('The selected input bands differ.');
  if (
    a.grid.crs !== b.grid.crs ||
    a.grid.width !== b.grid.width ||
    a.grid.height !== b.grid.height ||
    a.grid.cellMetres !== b.grid.cellMetres ||
    !equal(a.grid.extent, b.grid.extent) ||
    !equal(a.water, b.water) ||
    !equal(a.source.geometry, b.source.geometry) ||
    Math.abs(a.nativeAreaKm2 - b.nativeAreaKm2) > 1e-6
  )
    issues.push('Use the same calculation area, grid and water domain.');
  if (!!a.ensemble !== !!b.ensemble)
    issues.push('Compare two full ensembles or two legacy single-seed runs.');
  const seeds = (r: SimulationSummary) =>
    [...(r.ensemble?.seeds ?? [r.config.seed])].sort((x, y) => x - y);
  if (!equal(seeds(a), seeds(b))) issues.push('Use the same random seeds on both sides.');
  return issues;
}

export function suggestPair(
  baselines: SimulationSummary[],
  scenarios: SimulationSummary[]
): [SimulationSummary, SimulationSummary] | null {
  const newest = (runs: SimulationSummary[]) =>
    [...runs].sort(
      (a, b) =>
        Number(!!b.ensemble) - Number(!!a.ensemble) ||
        b.completedAt - a.completedAt ||
        b.runId.localeCompare(a.runId)
    );
  for (const scenario of newest(scenarios)) {
    const baseline = newest(baselines).find((run) => !comparisonIssues(run, scenario).length);
    if (baseline) return [baseline, scenario];
  }
  return null;
}

export function comparisonQuery(
  selection: SimulationComparisonSelection | null,
  reverse: boolean
): string {
  const query = new URLSearchParams();
  if (reverse) query.set('reverse', 'true');
  if (selection) {
    query.set('simBase', String(selection.baselineCalculationId));
    query.set('simBaselineRun', selection.baselineRunId);
    query.set('simScenarioRun', selection.scenarioRunId);
  }
  return query.size ? `?${query}` : '';
}

export function comparisonToken(
  selection: SimulationComparisonSelection,
  reverse: boolean
): string {
  return JSON.stringify([
    selection.baselineCalculationId,
    selection.scenarioCalculationId,
    selection.baselineRunId,
    selection.scenarioRunId,
    reverse
  ]);
}

export function preparationUrl(calculationId: number, match?: SimulationSummary): string {
  const query = new URLSearchParams({ tab: 'mareld-poc', calculation: String(calculationId) });
  if (match) {
    query.set('matchCalculation', String(match.calculationId));
    query.set('matchRun', match.runId);
  }
  return `/map?${query}`;
}

export function comparisonFigures(a: SimulationSummary, b: SimulationSummary) {
  const issues = comparisonIssues(a, b);
  if (issues.length) throw new Error(issues.join(' '));
  const left = biomassPercentSeries(a),
    right = biomassPercentSeries(b);
  const lastStep = a.steps.at(-1)!;
  return left.map((line) => {
    const other = right.find((candidate) => candidate.id === line.id)!;
    const [minimum, maximum] = percentageExtent([line, other]);
    const y = (value: number) => 175 - ((value - minimum) / (maximum - minimum)) * 150;
    const point = (frame: number, value: number) =>
      `${45 + (a.steps[frame] / lastStep) * 365},${y(value)}`;
    const curve = (series: BiomassSeries) => {
      if (series.values.some((value) => value === null)) return { path: '', band: '', final: null };
      return {
        path: series.values
          .map((value, frame) => `${frame ? 'L' : 'M'}${point(frame, value!)}`)
          .join(' '),
        band:
          series.high && series.low
            ? [
                ...series.high.map((value, frame) => `${frame ? 'L' : 'M'}${point(frame, value!)}`),
                ...series.low.map((value, frame) => `L${point(frame, value!)}`).reverse(),
                'Z'
              ].join(' ')
            : '',
        final: series.values.at(-1)!
      };
    };
    return {
      id: line.id,
      name: line.name,
      color: line.color,
      minimum,
      maximum,
      initialY: y(100),
      days: lastStep * a.config.tickDurationDays,
      curves: [curve(line), curve(other)]
    };
  });
}
