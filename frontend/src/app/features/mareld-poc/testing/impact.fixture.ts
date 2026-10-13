import { PreparedInput } from '../mareld-input';
import { PreparedImpacts } from '../mareld-impacts';
import { calculationFixture } from './calculation.fixture';
export function impactFixture(input: PreparedInput): PreparedImpacts {
  return calculationFixture(7, input).input.impacts!;
}
