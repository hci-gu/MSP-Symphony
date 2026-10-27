import { PreparedInput } from '../ecotwin-input';
import { PreparedImpacts } from '../ecotwin-impacts';
import { calculationFixture } from './calculation.fixture';
export function impactFixture(input: PreparedInput): PreparedImpacts {
  return calculationFixture(7, input).input.impacts!;
}
