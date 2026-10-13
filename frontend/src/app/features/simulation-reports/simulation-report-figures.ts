import { SimulationSummary } from './simulation-report-data.service';
import { speciesColor, speciesLabel } from '../mareld-poc/mareld-biomass';
import { BIOMASS_COLORS } from '../mareld-poc/mareld-result';

export interface ReportSpecies {
  name: string;
  color: string;
  initial: number;
  final: number;
  change: number;
  percent: number | null;
  maximum: number;
  path: string;
  image: string;
}
export interface ReportFigure {
  run: SimulationSummary;
  species: ReportSpecies[];
  chartMaximum: number;
  days: number;
}

/** Fixed, north-first final figures generated solely from persisted output. */
export function reportFigures(run: SimulationSummary): ReportFigure {
  const { width, height } = run.grid;
  const cells = width * height,
    count = run.species.length;
  if (
    run.version !== 'ecotwin-report-v1' ||
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
  const chartMaximum = Math.max(1, ...run.totals.flat());
  const lastStep = run.steps[run.steps.length - 1];
  const species = run.species.map((name, s) => {
    const totals = run.totals[s];
    if (totals.length !== run.steps.length || totals.some((v) => !Number.isFinite(v) || v < 0))
      throw new Error('Invalid saved biomass summary.');
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
      path: totals
        .map(
          (value, frame) =>
            `${frame ? 'L' : 'M'}${60 + (run.steps[frame] / lastStep) * 620},${270 - (value / chartMaximum) * 240}`
        )
        .join(' ')
    };
  });
  return { run, species, chartMaximum, days: lastStep * run.config.tickDurationDays };
}
