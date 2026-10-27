import type { SimulationSummary } from '../../contracts';

export function preparationUrl(
  calculationId: number,
  match?: Pick<SimulationSummary, 'calculationId' | 'runId'>
): string {
  const query = new URLSearchParams({ tab: 'mareld-poc', calculation: String(calculationId) });
  if (match) {
    query.set('matchCalculation', String(match.calculationId));
    query.set('matchRun', match.runId);
  }
  return `/map?${query}`;
}
