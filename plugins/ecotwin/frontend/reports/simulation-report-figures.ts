import type { SimulationSummary } from '../contracts';
import { speciesColor, speciesLabel } from '../workspace/ecotwin-biomass';
import { biomassPercentSeries, percentageExtent } from './simulation-report-series';
import { BIOMASS_COLORS } from '../workspace/ecotwin-result';

export interface ReportSpecies {
  name: string;
  color: string;
  initial: number;
  final: number;
  change: number;
  percent: number | null;
  maximum: number;
  path: string;
  band: string;
  finalLow?: number;
  finalHigh?: number;
  image: string;
}
export interface ReportFigure {
  run: SimulationSummary;
  species: ReportSpecies[];
  chartMaximum: number;
  chartMinimum: number;
  initialY: number;
  unplottedSpecies: string[];
  days: number;
}

/** Fixed, north-first final figures generated solely from persisted output. */
export function reportFigures(run: SimulationSummary): ReportFigure {
  const { width, height } = run.grid;
  const cells = width * height,
    count = run.species.length;
  if (
    !['ecotwin-report-v1', 'ecotwin-report-v2'].includes(run.version) ||
    !run.finalBiomassB64 ||
    cells < 9 ||
    cells > 3600 ||
    !count ||
    count > 64 ||
    run.water.length !== cells ||
    run.steps.length > 52
  )
    throw new Error('Unsupported saved report data.');
  const raw = atob(run.finalBiomassB64);
  if (raw.length !== cells * count * 4) throw new Error('Saved final frame has the wrong size.');
  const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const lines = biomassPercentSeries(run);
  const [chartMinimum, chartMaximum] = percentageExtent(lines);
  const y = (value: number) => 270 - ((value - chartMinimum) / (chartMaximum - chartMinimum)) * 240;
  const lastStep = run.steps[run.steps.length - 1];
  const species = run.species.map((name, s) => {
    const totals = run.totals[s];
    const line = lines[s];
    const plotted = line.values.every((value) => value !== null);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d')!;
    const pixels = context.createImageData(width, height);
    for (let i = 0; i < cells; i++) {
      if (!run.water[i]) continue;
      const value = view.getFloat32((i * count + s) * 4, true);
      if (!Number.isFinite(value) || value < 0) throw new Error('Invalid saved final biomass.');
      const fraction = run.maxima[s] > 0 ? Math.min(1, value / run.maxima[s]) : 0;
      const scaled = fraction * (BIOMASS_COLORS.length - 1);
      const segment = Math.min(BIOMASS_COLORS.length - 2, Math.floor(scaled)),
        t = scaled - segment;
      pixels.data.set(
        [
          ...BIOMASS_COLORS[segment].map((v, c) =>
            Math.round(v * (1 - t) + BIOMASS_COLORS[segment + 1][c] * t)
          ),
          255
        ],
        i * 4
      );
    }
    context.putImageData(pixels, 0, 0);
    const initial = totals[0],
      final = totals[totals.length - 1];
    return {
      name: speciesLabel(name),
      color: speciesColor(name, s),
      initial,
      final,
      change: final - initial,
      percent: initial > 0 ? ((final - initial) / initial) * 100 : null,
      maximum: run.maxima[s],
      image: canvas.toDataURL(),
      finalLow: run.ensemble?.ciLow[s].at(-1),
      finalHigh: run.ensemble?.ciHigh[s].at(-1),
      band:
        plotted && line.high && line.low
          ? [
              ...line.high.map(
                (value, frame) =>
                  `${frame ? 'L' : 'M'}${60 + (run.steps[frame] / lastStep) * 620},${y(value!)}`
              ),
              ...line.low
                .map((value, frame) => `L${60 + (run.steps[frame] / lastStep) * 620},${y(value!)}`)
                .reverse(),
              'Z'
            ].join(' ')
          : '',
      path: plotted
        ? line.values
            .map(
              (value, frame) =>
                `${frame ? 'L' : 'M'}${60 + (run.steps[frame] / lastStep) * 620},${y(value!)}`
            )
            .join(' ')
        : ''
    };
  });
  return {
    run,
    species,
    chartMaximum,
    chartMinimum,
    initialY: y(100),
    unplottedSpecies: species.filter((s) => !s.path).map((s) => s.name),
    days: lastStep * run.config.tickDurationDays
  };
}
